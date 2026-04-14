// ── POLLING TEMPO REAL ────────────────────────────────────────
import { S } from '../state.js';
import { GET } from './api.js';
import { getHiddenUsers, mergeUserExtra } from './auth.js';
import { mergeDriverAssignments, saveCachedData } from './cache.js';
import { toast } from '../utils/helpers.js';

let _pollTimer = null, _pollCount = 0;
const POLL_PAGES = ['producao','expedicao','entregador','rota','pedidos','dashboard','caixa','financeiro','colaboradores','relatorios'];

export async function pollData(){
  if(!S.user||!S.token||S.loading||S._modal||S._iaLoading) return;
  _pollCount++;
  try{
    // A cada ciclo: atualiza pedidos e atividades (sincroniza entre dispositivos)
    const [orders, activities] = await Promise.all([
      GET('/orders').catch(()=>null),
      GET('/activities').catch(()=>null),
    ]);
    let changed = false;
    if(orders){
      const merged = mergeDriverAssignments(orders);
      if(JSON.stringify(merged)!==JSON.stringify(S.orders)){
        S.orders=merged; changed=true;
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

    // A cada 4 ciclos (~32s): atualiza produtos (ou no ciclo 1 se sem produtos)
    if(_pollCount%4===0 || (_pollCount===1 && S.products.length===0)){
      const [products, stock] = await Promise.all([
        GET('/products').catch(()=>null),
        GET('/stock/moves').catch(()=>null),
      ]);
      // Produtos: sempre atualiza se o servidor trouxe dados
      // (nunca ignora mesmo que seja igual — preços podem ter mudado)
      if(products && products.length > 0){
        const productsStr = JSON.stringify(products);
        if(productsStr !== JSON.stringify(S.products)){
          S.products=products;
          changed=true;
        }
      }
      if(products && products.length === 0 && S.products.length === 0){ /* genuinamente vazio */ }
      if(stock && JSON.stringify(stock)!==JSON.stringify(S.stockMoves)){ S.stockMoves=stock; changed=true; }
      const fe = JSON.parse(localStorage.getItem('fv_financial')||'[]');
      if(JSON.stringify(fe)!==JSON.stringify(S.financialEntries)){ S.financialEntries=fe; changed=true; }
    }

    // A cada 8 ciclos (~64s): atualiza clientes e usuários
    if(_pollCount%8===0){
      const [clients, users] = await Promise.all([
        GET('/clients').catch(()=>null),
        GET('/users').catch(()=>null),
      ]);
      // Só atualiza se trouxe dados reais
      if(clients && clients.length > 0 && JSON.stringify(clients)!==JSON.stringify(S.clients)){ S.clients=clients; changed=true; }
      if(users && users.length > 0){
        const hidden=getHiddenUsers();
        const merged=(users||[]).filter(x=>!hidden.includes(x._id)).map(mergeUserExtra);
        if(JSON.stringify(merged)!==JSON.stringify(S.users)){ S.users=merged; changed=true; }
      }
    }

    if(changed && !S.loading && POLL_PAGES.includes(S.page) && !S._modal){
      try{ const { render } = await import('../main.js'); render(); }catch(e){ console.error('pollData render:', e); }
      // Atualiza cache local com dados frescos
      saveCachedData();
      const ind=document.getElementById('sync-dot');
      if(ind){ind.style.background='#4ade80';setTimeout(()=>{if(ind)ind.style.background='rgba(255,255,255,.3)';},600);}
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

export function startPolling(ms=8000){ stopPolling(); _pollCount=0; _pollTimer=setInterval(pollData,ms); }
export function stopPolling(){ if(_pollTimer){clearInterval(_pollTimer);_pollTimer=null;} }
