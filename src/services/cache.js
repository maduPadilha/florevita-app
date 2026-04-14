// ── CACHE & DATA LOADING ─────────────────────────────────────
import { S } from '../state.js';
import { GET } from './api.js';
import { toast } from '../utils/helpers.js';
import { getHiddenUsers, mergeUserExtra, fetchAndMergeColabs } from './auth.js';

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
      products: S.products,
      orders:   S.orders.slice(0,300),
      clients:  S.clients.slice(0,500),
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
      S.orders = mergeDriverAssignments(cache.orders);
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

// ── LOAD DATA COM RETRY AUTOMÁTICO ───────────────────────────
// O Render free tier "dorme" após 15min e demora ~35s para acordar.
// Esta função tenta até 4 vezes antes de cair no cache.
export async function loadData(){
  const _was = S.loading;
  S.loading   = true;

  for(let n=1; n<=8; n++){
    S._loginMsg = n===1 ? '🌸 Carregando dados...' : `⏳ Aguardando servidor... (${n}/8)`;
    try{ const { render } = await import('../main.js'); render(); }catch(_){}

    // Busca todos os dados simultaneamente
    const [p, o, c, u, sm, ac] = await Promise.all([
      GET('/products').catch(()=>null),
      GET('/orders').catch(()=>null),
      GET('/clients').catch(()=>null),
      GET('/users').catch(()=>null),
      GET('/stock/moves').catch(()=>null),
      GET('/activities').catch(()=>null),
    ]);

    // Mescla atividades vindas do backend com cache local (visibilidade entre dispositivos)
    if(Array.isArray(ac)){
      try{
        const local = JSON.parse(localStorage.getItem('fv_activities')||'[]');
        const seen = new Set();
        const merged = [];
        // Normaliza atividades do backend para o mesmo shape do cache local
        const remote = ac.map(a => ({
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

    // Log para diagnóstico
    console.log(`[load] tentativa ${n}: p=${JSON.stringify(p)?.substring(0,50)} o=${o?.length} c=${c?.length} u=${u?.length}`);

    // Aplica dados que vieram
    let carregou = false;
    if(Array.isArray(p) && p.length > 0){ S.products = p; carregou = true; }
    if(Array.isArray(o) && o.length > 0){ S.orders   = mergeDriverAssignments(o); carregou = true; }
    if(Array.isArray(c) && c.length > 0){ S.clients  = c; carregou = true; }
    if(Array.isArray(u) && u.length > 0){
      const hid = getHiddenUsers();
      S.users = u.filter(x=>!hid.includes(x._id)).map(mergeUserExtra);
    }
    if(Array.isArray(sm) && sm.length > 0) S.stockMoves = sm;
    S.financialEntries = JSON.parse(localStorage.getItem('fv_financial')||'[]');

    // Servidor respondeu mas produtos vieram vazios — tenta mais vezes
    const servidorRespondeu = [p,o,c,u].some(x => x !== null);
    if(servidorRespondeu && !Array.isArray(p)){
      // Produtos retornaram null (erro) — continua tentando
      console.warn('[load] /products retornou null — tentando novamente');
    } else if(servidorRespondeu && Array.isArray(p) && p.length === 0 && n < 8){
      // Produtos retornaram vazio — aguarda e tenta de novo
      console.warn('[load] /products retornou [] vazio — aguardando e tentando novamente');
      S._loginMsg = `🌸 Aguardando produtos do servidor... (${n}/8)`;
      try{ const { render } = await import('../main.js'); render(); }catch(_){}
      await new Promise(r=>setTimeout(r, 8000));
      continue;
    }

    if(carregou){
      S._loginMsg = null;
      S.loading   = _was;
      saveCachedData();
      try{ const { render } = await import('../main.js'); render(); }catch(_){}
      console.log(`[load] ✅ ${n}ª: ${S.products.length}p | ${S.orders.length}o | ${S.clients.length}c | ${S.users.length}u`);

      // Fetch and merge collaborators from /api/collaborators (non-blocking)
      fetchAndMergeColabs().then(merged => {
        if(merged?.length){
          console.log('[load] Colabs synced from API: ' + merged.length);
        }
      }).catch(e => console.warn('[load] Colabs sync skipped:', e.message));

      return true;
    }

    // Servidor não respondeu
    if(n < 8){
      S._loginMsg = `🌸 Servidor aquecendo... (${n}/8)`;
      try{ const { render } = await import('../main.js'); render(); }catch(_){}
      await new Promise(r=>setTimeout(r, 10000));
    }
  }

  S._loginMsg = null;
  S.loading   = _was;
  if(S.products.length||S.orders.length||S.clients.length)
    toast('⚠️ Usando cache. Clique 🔄 para atualizar.', true);
  else
    toast('❌ Servidor sem resposta. Clique 🔄 para tentar novamente.', true);
  return false;
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
