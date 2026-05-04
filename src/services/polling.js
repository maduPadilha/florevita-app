// ── POLLING TEMPO REAL ────────────────────────────────────────
import { S } from '../state.js';
import { GET } from './api.js';
import { getHiddenUsers, mergeUserExtra } from './auth.js';
import { mergeDriverAssignments, saveCachedData } from './cache.js';
import { toast } from '../utils/helpers.js';
import { filtrarPedidosPorUnidade } from '../utils/unidadeRules.js';
import { checkAndRingIfoodOrders } from './ifoodRingtone.js';

let _pollTimer = null, _pollCount = 0;
const POLL_PAGES = ['producao','expedicao','entregador','rota','pedidos','dashboard','caixa','financeiro','colaboradores','relatorios'];

export async function pollData(){
  if(!S.user||!S.token||S.loading||S._modal||S._iaLoading) return;
  _pollCount++;

  // ENTREGADOR: poll otimizado — so pedidos, sem activities/products/etc.
  const cargoLow = String(S.user?.cargo||'').toLowerCase();
  if (cargoLow === 'entregador' || cargoLow.includes('entregador')) {
    try {
      const ords = await GET('/orders?limit=100').catch(() => null);
      if (Array.isArray(ords)) {
        const merged = mergeDriverAssignments(ords);
        const curSig = merged.map(o => (o._id||o.id)+':'+(o.updatedAt||'')+':'+(o.status||'')).join('|');
        if (S._ordersSig !== curSig) {
          S.orders = merged;
          S._ordersSig = curSig;
          import('../main.js').then(m => m.render && m.render()).catch(()=>{});
        }
      }
    } catch(_){}
    return;
  }

  try{
    // A cada ciclo: atualiza pedidos e atividades (sincroniza entre dispositivos)
    const [orders, activities] = await Promise.all([
      GET('/orders').catch(()=>null),
      GET('/activities').catch(()=>null),
    ]);
    let changed = false;
    if(orders){
      const filteredOrders = filtrarPedidosPorUnidade(S.user, orders);
      const merged = mergeDriverAssignments(filteredOrders);
      // Comparacao leve: length + hash dos _id+updatedAt (evita JSON.stringify
      // de 500 pedidos a cada 5s, que trava tablets)
      const curSig = merged.map(o => (o._id||o.id)+':'+(o.updatedAt||'')+':'+(o.status||'')).join('|');
      if (S._ordersSig !== curSig) {
        S.orders = merged;
        S._ordersSig = curSig;
        changed = true;
      }
      // Toca toque de telefone para pedidos iFood novos (ignora primeira carga)
      if(_pollCount > 1){
        try { checkAndRingIfoodOrders(merged); }
        catch(e){ console.warn('[iFood ring] erro:', e); }
      } else {
        // Na primeira carga, marca todos os pedidos iFood existentes como "ja vistos"
        // para nao tocar quando o usuario abre o sistema pela primeira vez.
        try {
          const seen = new Set(JSON.parse(localStorage.getItem('fv_ifood_ringed_ids')||'[]'));
          merged.forEach(o => {
            const isIfood = (o.source === 'iFood') || (o.orderNumber||'').startsWith('IF');
            if(isIfood){
              const id = o._id || o.ifoodOrderId || o.orderNumber;
              if(id) seen.add(id);
            }
          });
          localStorage.setItem('fv_ifood_ringed_ids', JSON.stringify([...seen].slice(-500)));
        } catch(_){}
      }
    }
    // Mescla atividades remotas com cache local — leitores de fv_activities
    // (pedidos.js, expedicao.js, etc.) passam a ver atividades de todos os dispositivos.
    if(Array.isArray(activities)){
      try{
        const local = JSON.parse(localStorage.getItem('fv_activities')||'[]');
        const seen = new Set();
        const result = [];
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
          result.push(a);
        }
        const newStr = JSON.stringify(result);
        if(newStr !== JSON.stringify(local)){
          localStorage.setItem('fv_activities', newStr);
          changed = true;
        }
      }catch(e){ /* ignora */ }
    }

    // A cada 2 ciclos (~16s): atualiza NOTAS FISCAIS (pra o botao rosa aparecer
    // em outros dispositivos logo apos a emissao)
    if(_pollCount%2===0 || _pollCount===1){
      const notas = await GET('/notas-fiscais?limit=200').catch(()=>null);
      if(Array.isArray(notas)){
        const newStr = JSON.stringify(notas);
        const oldStr = JSON.stringify(S._notasFiscais || []);
        if(newStr !== oldStr){
          S._notasFiscais = notas;
          changed = true;
        }
      }
    }

    // Hash leve por _id+updatedAt — evita JSON.stringify() de arrays
    // grandes contendo base64 (foto de produto). JSON.stringify de 200
    // produtos com base64 trava UI 200-500ms a cada 32s. Hash em ~1ms.
    const lightSig = (arr) => Array.isArray(arr)
      ? arr.map(x => `${x?._id||x?.id||''}:${x?.updatedAt||x?.modifiedAt||''}`).join('|')
      : '';

    // A cada 4 ciclos (~32s): atualiza produtos
    if(_pollCount%4===0 || (_pollCount===1 && S.products.length===0)){
      const [products, stock] = await Promise.all([
        GET('/products').catch(()=>null),
        GET('/stock/moves').catch(()=>null),
      ]);
      if(products && products.length > 0){
        if (lightSig(products) !== lightSig(S.products)) {
          S.products = products;
          changed = true;
        }
      }
      if(stock && lightSig(stock) !== lightSig(S.stockMoves)){ S.stockMoves=stock; changed=true; }
      // FINANCIAL ENTRIES: busca do BACKEND e MESCLA com locais (nao
      // pode dropar entradas que so existem em localStorage — ex: salvas
      // offline ou sem _id do backend).
      try {
        const beFe = await GET('/financial/entries').catch(()=>null);
        const localFe = JSON.parse(localStorage.getItem('fv_financial')||'[]');
        if (Array.isArray(beFe)) {
          // Mescla: chave = _id (backend) ou id (local)
          const mapa = new Map();
          // Primeiro local (preserva itens que nao chegaram ao backend)
          localFe.forEach(e => { const k = e._id || e.id; if (k) mapa.set(String(k), e); });
          // Depois backend (sobrepoe)
          beFe.forEach(e => { const k = e._id || e.id; if (k) mapa.set(String(k), e); });
          const merged = [...mapa.values()];
          // Persiste merged em localStorage (fonte da verdade local)
          localStorage.setItem('fv_financial', JSON.stringify(merged));
          if (lightSig(merged) !== lightSig(S.financialEntries)) {
            S.financialEntries = merged; changed = true;
          }
        } else {
          // Backend offline — usa local
          if (lightSig(localFe) !== lightSig(S.financialEntries)) {
            S.financialEntries = localFe; changed = true;
          }
        }
      } catch(_) {
        const localFe = JSON.parse(localStorage.getItem('fv_financial')||'[]');
        if (lightSig(localFe) !== lightSig(S.financialEntries)) {
          S.financialEntries = localFe; changed = true;
        }
      }
    }

    // A cada 8 ciclos (~64s): atualiza clientes (e usuários se admin)
    if(_pollCount%8===0){
      const isAdminUser = S.user && (
        S.user.role === 'Administrador' ||
        S.user.cargo === 'admin' ||
        S.user.cargo === 'Administrador' ||
        S.user.unidade === 'todas' ||
        S.user.unit === 'Todas'
      );
      const [clients, users] = await Promise.all([
        GET('/clients').catch(()=>null),
        isAdminUser ? GET('/users').catch(()=>null) : Promise.resolve(null),
      ]);
      if(clients && clients.length > 0 && lightSig(clients) !== lightSig(S.clients)){
        S.clients = clients; changed = true;
      }
      if(users && users.length > 0){
        const hidden=getHiddenUsers();
        const merged=(users||[]).filter(x=>!hidden.includes(x._id)).map(mergeUserExtra);
        if(lightSig(merged) !== lightSig(S.users)){ S.users=merged; changed=true; }
      }
    }

    // Detecta se a usuaria esta interagindo com um campo de formulario
    // ABERTO (digitando, com select aberto, etc). Re-renderizar nesse
    // momento destrui o input/select e ela perde o que estava fazendo.
    // Especificamente: select de entregador na Expedicao "some" porque
    // o dropdown aberto e re-criado a cada 3s.
    const ae = document.activeElement;
    const userInteracting = ae && (
      ae.tagName === 'INPUT' ||
      ae.tagName === 'SELECT' ||
      ae.tagName === 'TEXTAREA' ||
      ae.isContentEditable
    );

    if(changed && !S.loading && POLL_PAGES.includes(S.page) && !S._modal && !userInteracting){
      try{ const { render } = await import('../main.js'); render(); }catch(e){ console.error('pollData render:', e); }
      // Atualiza cache local com dados frescos
      saveCachedData();
      const ind=document.getElementById('sync-dot');
      if(ind){ind.style.background='#4ade80';setTimeout(()=>{if(ind)ind.style.background='rgba(255,255,255,.3)';},600);}
    } else if (changed && userInteracting) {
      // Usuaria interagindo: marca pendente e re-tenta no proximo ciclo.
      // Sync-dot pisca laranja para mostrar que tem dado novo aguardando.
      const ind=document.getElementById('sync-dot');
      if(ind){ind.style.background='#F59E0B';}
    }
    // Verifica datas especiais no primeiro poll do dia (só se modal não aberto)
    if(_pollCount===1 && !S._modal){
      try{
        const { checkDatasEspeciaisAlertas } = await import('../pages/clientes.js');
        const alertasDatas = checkDatasEspeciaisAlertas();
        if(alertasDatas.length > 0 && !S._datasAlertadas){
          S._datasAlertadas = true;
          alertasDatas.forEach(a=>{
            toast(`${a.icon||'🎂'} ${a.urgencia}: ${a.tipo} de ${a.pessoa} — Cliente ${a.client?.name||''}`, false);
          });
        }
      }catch(e){ console.warn('[poll] checkDatasEspeciaisAlertas não disponível:', e); }
    }
  }catch(e){ console.warn('pollData erro:', e); }
}

export function startPolling(ms=3000){
  stopPolling();
  _pollCount=0;
  // Render Starter: servidor sempre warm, pode acelerar polling.
  // Entregador: 2s (tempo real — designacoes E entregas confirmadas
  // somem rapido; payload e leve com loadData otimizado)
  // Outros: 3s (antes 5s)
  const isDriver = S.user?.role === 'Entregador' || S.user?.cargo === 'entregador';
  const interval = isDriver ? 2000 : ms;
  _pollTimer = setInterval(pollData, interval);
  pollData();
}
export function stopPolling(){ if(_pollTimer){clearInterval(_pollTimer);_pollTimer=null;} }
