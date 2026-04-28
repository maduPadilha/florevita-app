// ── CACHE & DATA LOADING ─────────────────────────────────────
import { S } from '../state.js';
import { GET } from './api.js';
import { toast } from '../utils/helpers.js';
import { getHiddenUsers, mergeUserExtra, fetchAndMergeColabs } from './auth.js';
import { filtrarPedidosPorUnidade } from '../utils/unidadeRules.js';

// ── DRIVER ASSIGNMENTS CACHE ──────────────────────────────────
// Persiste atribuições de entregador localmente — o backend pode não salvar todos os campos
export function getDriverAssignments(){
  try{ return JSON.parse(localStorage.getItem('fv_driver_assignments')||'{}'); }
  catch(e){ return {}; }
}

export function saveDriverAssignment(orderId, data){
  const all = getDriverAssignments();
  all[orderId] = {...(all[orderId]||{}), ...data, _ts: Date.now()};
  localStorage.setItem('fv_driver_assignments', JSON.stringify(all));
}

export function mergeDriverAssignments(orders){
  const assignments = getDriverAssignments();
  return orders.map(o => {
    const saved = assignments[o._id];
    if(!saved) return o;
    // Aplica driverName para todos os status relevantes (inclusive Entregue para relatórios)
    if(['Pronto','Saiu p/ entrega','Entregue'].includes(o.status) || saved.driverName){
      return {
        ...o,
        driverId:        o.driverId        || saved.driverId,
        driverName:      o.driverName      || saved.driverName,
        driverEmail:     o.driverEmail     || saved.driverEmail,
        driverBackendId: o.driverBackendId || saved.driverBackendId,
      };
    }
    return o;
  });
}

// Limpa atribuições antigas (pedidos entregues/cancelados)
export function cleanOldAssignments(){
  const assignments = getDriverAssignments();
  const activeIds = new Set(S.orders.filter(o=>o.status==='Saiu p/ entrega').map(o=>o._id));
  const cleaned = Object.fromEntries(
    Object.entries(assignments).filter(([id]) => activeIds.has(id))
  );
  localStorage.setItem('fv_driver_assignments', JSON.stringify(cleaned));
}

// ── CACHE LOCAL DOS DADOS ─────────────────────────────────────
export function saveCachedData(){
  try{
    const snapshot = {
      products: S.products.slice(0, 300), // limit cached products
      orders:   S.orders.slice(0, 200),
      clients:  S.clients.slice(0, 300),
      users:    S.users,
      savedAt:  Date.now(),
    };
    localStorage.setItem('fv_data_cache', JSON.stringify(snapshot));
  }catch(e){
    // localStorage cheio: tenta salvar versão reduzida
    try{
      localStorage.setItem('fv_data_cache', JSON.stringify({
        products: S.products.slice(0,50),
        orders:   S.orders.slice(0,50),
        clients:  S.clients.slice(0,50),
        savedAt:  Date.now(),
      }));
    }catch(e2){}
  }
}

export function loadCachedData(){
  try{
    const raw = localStorage.getItem('fv_data_cache');
    if(!raw) return false;
    const cache = JSON.parse(raw);
    const ageMin = (Date.now() - (cache.savedAt||0)) / 60000;

    // ── LIMITE DE CACHE POR TIPO DE DADO ──────────────────────
    // Produtos e preços: máx 5 minutos (dados críticos para venda)
    // Pedidos: máx 2 minutos (operacional)
    // Clientes: máx 15 minutos (menos crítico)
    // Cache expirado totalmente após 30 minutos

    const CACHE_TOTAL_MAX = 1440; // 24h — cache como fallback de emergência
    const CACHE_PRODUCTS  = 1440; // aceita qualquer cache (polling atualiza em bg)
    const CACHE_ORDERS    = 1440; // idem
    const CACHE_CLIENTS   = 1440; // idem

    if(ageMin > CACHE_TOTAL_MAX){
      // Cache muito antigo — limpa e ignora
      if(cache.products?.length || cache.orders?.length || cache.clients?.length){
        console.warn('[cache] Expirado ('+Math.round(ageMin)+'min) — mantido como fallback');
      } else {
        localStorage.removeItem('fv_data_cache');
        return false;
      }
    }

    // Carrega apenas o que ainda está válido
    let loaded = false;

    // Produtos/preços: apenas se cache fresquíssimo (≤5min)
    if(ageMin <= CACHE_PRODUCTS && cache.products?.length > 0){
      S.products = cache.products;
      loaded = true;
    }

    // Pedidos: apenas se cache recente (≤2min)
    if(ageMin <= CACHE_ORDERS && cache.orders?.length > 0){
      const filteredCached = filtrarPedidosPorUnidade(S.user, cache.orders);
      S.orders = mergeDriverAssignments(filteredCached);
      loaded = true;
    }

    // Clientes: aceita cache um pouco mais antigo (≤15min)
    if(ageMin <= CACHE_CLIENTS && cache.clients?.length > 0){
      S.clients = cache.clients;
      loaded = true;
    }

    // Usuários: aceita até 15min
    if(ageMin <= CACHE_CLIENTS && cache.users?.length > 0){
      S.users = cache.users;
    }

    S.financialEntries = JSON.parse(localStorage.getItem('fv_financial')||'[]');

    if(loaded){
      console.log('[cache] '+Math.round(ageMin)+'min: '+S.products.length+' produtos, '+S.orders.length+' pedidos, '+S.clients.length+' clientes');
    }
    return loaded;
  }catch(e){ return false; }
}

// ── INVALIDAÇÃO DE CACHE ─────────────────────────────────────
// Chamado após qualquer operação que modifica produtos, pedidos ou clientes
export function invalidateCache(type='all'){
  // SAFE: apenas marca como expirado, NÃO apaga os dados
  // Dados ficam disponíveis como fallback enquanto servidor responde
  try{
    const raw = localStorage.getItem('fv_data_cache');
    if(!raw) return;
    const cache = JSON.parse(raw);
    cache.savedAt = 0; // expira imediatamente — próxima leitura busca do servidor
    // mas mantém os dados para fallback de emergência
    localStorage.setItem('fv_data_cache', JSON.stringify(cache));
    console.log('[cache] Marcado como expirado (dados mantidos como fallback)');
  }catch(e){}
}

// ── LOAD DATA — PROGRESSIVE LOADING ──────────────────────────
// Estratégia: carrega CRÍTICOS (orders/clients/users) primeiro e renderiza imediatamente,
// depois carrega NÃO-CRÍTICOS (products/stock/categories/collabs/activities) em background.
// Em caso de cold-start (Render free tier ~35s), usa retry só na fase crítica.
export async function loadData(){
  const _was = S.loading;
  S.loading   = true;

  // ── FASE CRÍTICA: orders + clients + users ────────────────────
  // Tenta até 8 vezes (cold-start Render pode levar ~35s)
  let orders=null, clients=null, users=null;
  let carregouCritico = false;

  for(let n=1; n<=8; n++){
    S._loginMsg = n===1 ? '🌸 Carregando dados...' : `⏳ Aguardando servidor... (${n}/8)`;
    try{ const { render } = await import('../main.js'); render(); }catch(_){}

    // /users e admin-only — para colaboradora nao-admin, nao tenta
    // (evita 403 ruidoso no console). A listagem de entregadores
    // ja vem do endpoint publico /collaborators/public.
    const isAdminUser = S.user && (
      S.user.role === 'Administrador' ||
      S.user.cargo === 'admin' ||
      S.user.cargo === 'Administrador' ||
      S.user.unidade === 'todas' ||
      S.user.unit === 'Todas'
    );
    [orders, clients, users] = await Promise.all([
      GET('/orders?limit=300').catch(()=>null),
      GET('/clients?limit=500').catch(()=>null),
      isAdminUser ? GET('/users').catch(()=>null) : Promise.resolve([]),
    ]);

    const algumOk = [orders, clients, users].some(x => Array.isArray(x));
    if(algumOk){ carregouCritico = true; break; }

    if(n < 8){
      S._loginMsg = `🌸 Servidor aquecendo... (${n}/8)`;
      try{ const { render } = await import('../main.js'); render(); }catch(_){}
      await new Promise(r=>setTimeout(r, 10000));
    }
  }

  // Aplica dados críticos e renderiza imediatamente
  if(Array.isArray(orders))  {
    const filteredOrders = filtrarPedidosPorUnidade(S.user, orders);
    S.orders = mergeDriverAssignments(filteredOrders);
  }
  if(Array.isArray(clients)) S.clients = clients;
  if(Array.isArray(users)){
    const hid = getHiddenUsers();
    S.users = users.filter(x => !hid.includes(x._id)).map(mergeUserExtra);
  }

  S._loginMsg = null;
  S.loading   = _was;
  try{ const { render } = await import('../main.js'); render(); }catch(_){}

  if(carregouCritico){
    console.log(`[load] ✅ crítico: ${S.orders.length}o | ${S.clients.length}c | ${S.users.length}u`);
  } else {
    if(S.products.length||S.orders.length||S.clients.length)
      toast('⚠️ Usando cache. Clique 🔄 para atualizar.', true);
    else
      toast('❌ Servidor sem resposta. Clique 🔄 para tentar novamente.', true);
    return false;
  }

  // ── FASE NÃO-CRÍTICA: products + stock + categories + collabs + activities ──
  // Roda em background, NÃO bloqueia o retorno
  Promise.all([
    GET('/products?limit=1000').catch(()=>null),
    GET('/stock/moves?limit=500').catch(()=>null),
    GET('/categories').catch(()=>null),
    GET('/collaborators').catch(()=>null),
    GET('/activities?limit=200').catch(()=>null),
  ]).then(([products, stock, categories, collabs, activities]) => {
    if(Array.isArray(products) && products.length > 0) S.products   = products;
    if(Array.isArray(stock)    && stock.length    > 0) S.stockMoves = stock;
    // categories/collabs: opcionais — outros módulos cuidam do merge com localStorage

    // Mescla atividades remotas com cache local (visibilidade entre dispositivos)
    if(Array.isArray(activities)){
      try{
        const local = JSON.parse(localStorage.getItem('fv_activities')||'[]');
        const seen = new Set();
        const merged = [];
        const remote = activities.map(a => ({
          id: a.id || a._id || (a.date+'_'+(a.userId||a.user||'')),
          userId: a.userId,
          userName: a.user || a.userName || '',
          userEmail: (a.userEmail||'').toLowerCase(),
          colabId: a.colabId,
          type: a.type,
          orderId: a.orderId,
          orderNumber: a.orderNumber || '—',
          items: a.items || [],
          total: a.total || 0,
          date: a.date,
        }));
        for(const a of [...remote, ...local]){
          const k = a.id || (a.orderId+'|'+a.type+'|'+a.date);
          if(seen.has(k)) continue;
          seen.add(k);
          merged.push(a);
        }
        localStorage.setItem('fv_activities', JSON.stringify(merged));
      }catch(e){ /* ignora */ }
    }

    S.financialEntries = JSON.parse(localStorage.getItem('fv_financial')||'[]');
    saveCachedData();
    console.log(`[load] ✅ background: ${S.products.length}p | stock=${S.stockMoves?.length||0}`);
    try{ import('../main.js').then(m => m.render()); }catch(_){}

    // Fetch and merge collaborators from /api/collaborators (non-blocking)
    fetchAndMergeColabs().then(merged => {
      if(merged?.length) console.log('[load] Colabs synced from API: ' + merged.length);
    }).catch(e => console.warn('[load] Colabs sync skipped:', e.message));
  }).catch(e => console.warn('[load] background falhou:', e));

  return true;
}

// ── RECARREGAR DADOS MANUALMENTE ────────────────────────────
export async function recarregarDados(){
  if(S.loading) return;
  S.loading = true;
  import('../main.js').then(m=>m.render()).catch(()=>{});
  loadData().then(ok=>{
    S.loading = false;
    if(ok) toast(`✅ ${S.products.length} produtos · ${S.orders.length} pedidos · ${S.clients.length} clientes`);
    import('../main.js').then(m=>m.render()).catch(()=>{});
  }).catch(()=>{
    S.loading=false;
    import('../main.js').then(m=>m.render()).catch(()=>{});
  });
}
