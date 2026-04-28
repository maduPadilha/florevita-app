import { S, BAIRROS_MANAUS } from '../state.js';
import { $c, $d, sc, ini, esc, fmtOrderNum } from '../utils/formatters.js';
import { PUT, PATCH, DELETE } from '../services/api.js';
import { toast, searchOrders, renderOrderSearchBar } from '../utils/helpers.js';
import { can, findColab } from '../services/auth.js';
import { invalidateCache } from '../services/cache.js';
import { getTurnoPedido } from '../utils/zonasManaus.js';
import { isAdmin, normalizeUnidade, filtrarPedidosParaListagem } from '../utils/unidadeRules.js';

// ── PRIORIDADE por antecedencia ──────────────────────────────
// Quanto mais antigo o pedido (diff entre createdAt e scheduledDate),
// maior a prioridade no dia da execucao. Evita esquecer encomendas
// agendadas com semanas de antecedencia.
export function getOrderPriority(o) {
  if (!o.createdAt || !o.scheduledDate) return { level: 0, days: 0 };
  const diffDays = Math.floor((new Date(o.scheduledDate) - new Date(o.createdAt)) / 86400000);
  if (diffDays >= 14) return { level: 3, days: diffDays, label: '🎯 PRIORIDADE ALTA' };
  if (diffDays >=  7) return { level: 2, days: diffDays, label: '🎯 PRIORIDADE' };
  if (diffDays >=  3) return { level: 1, days: diffDays, label: '📅 ANTECIPADO' };
  return { level: 0, days: diffDays };
}

// Pedido com prioridade + proximo do horario = critico
export function isOrderPriorityCritical(o) {
  const p = getOrderPriority(o);
  if (p.level === 0) return false;
  // Deve ser de hoje (fuso Manaus: offset -4h)
  const nowUtc = Date.now();
  const manausNow = new Date(nowUtc - 4*3600000);
  const manausToday = manausNow.toISOString().slice(0,10);
  const schedDay = new Date(new Date(o.scheduledDate).getTime() - 4*3600000).toISOString().slice(0,10);
  if (schedDay !== manausToday) return false;
  // <= 3h restantes ate o horario promettido = critico
  if (o.scheduledTime && o.scheduledTime !== '00:00') {
    const [h,m] = o.scheduledTime.split(':').map(Number);
    const targetMin = h*60 + m;
    const curMin = manausNow.getUTCHours()*60 + manausNow.getUTCMinutes();
    return (targetMin - curMin) <= 180;
  }
  return true;
}

// Pre-carrega notas fiscais ao abrir a tela Pedidos.
// IMPORTANTE: sempre busca no primeiro render da tela + a cada 10s.
// Isso garante que o botao rosa 🖨️ (nota ja emitida) esteja SEMPRE
// atualizado — critico para nao emitir nota duplicada em outro dispositivo.
// O polling global tambem sincroniza a cada 10s, mas aqui forcamos um
// fetch imediato ao ENTRAR na tela para nao precisar esperar o proximo
// ciclo de polling (que pode estar no meio de um ciclo longo).
let _notasLastLoad = 0;
function preloadNotas() {
  const REFRESH_MS = 10000; // recarrega a cada 10s ao navegar
  const now = Date.now();
  const isStale = (now - _notasLastLoad) > REFRESH_MS;
  if (!isStale && Array.isArray(window.S?._notasFiscais)) return;
  _notasLastLoad = now;
  import('./notas-fiscais.js').then(m => {
    if (m.loadNotas) m.loadNotas({ consultarPendentes: false }).catch(() => {});
  }).catch(() => {});
}

// ── Helper: render() via dynamic import ───────────────────────
async function render(){
  const { render:r } = await import('../main.js');
  r();
}

// ── Helper: setPage via dynamic import ────────────────────────
async function setPage(pg){
  const { setPage:sp } = await import('../main.js');
  sp(pg);
}

// ── Helper: logActivity via dynamic import ────────────────────
async function logActivity(type, order){
  const mod = await import('../utils/helpers.js');
  if(typeof mod.logActivity === 'function') mod.logActivity(type, order);
}

// ── Helper: registrarReceitaVenda ─────────────────────────────
function registrarReceitaVenda(o){
  try{
    const entries = JSON.parse(localStorage.getItem('fv_financial')||'[]');
    // Evita duplicata: verifica se ja existe entrada para este pedido
    if(entries.find(e=>e.orderId===o._id && e.type==='receita')) return;
    const entry = {
      id: 'venda_'+o._id,
      orderId: o._id,
      orderNumber: o.orderNumber,
      type: 'receita',
      categoria: 'Venda',
      descricao: `Venda ${o.orderNumber} — ${o.client?.name||o.clientName||'Cliente'}`,
      valor: o.total||0,
      payment: o.payment||'—',
      unit: o.unit||'—',
      status: 'Recebido',
      date: new Date().toISOString(),
      createdBy: S.user?.name||'Sistema',
    };
    entries.unshift(entry);
    localStorage.setItem('fv_financial', JSON.stringify(entries));
    S.financialEntries = entries;
  }catch(e){ console.warn('registrarReceitaVenda:', e); }
}

// ── Helper: sendDeliveryNotification ──────────────────────────
async function sendDeliveryNotification(order){
  try{
    const mod = await import('../utils/helpers.js');
    if(typeof mod.sendWhatsAppDeliveryConfirm === 'function') mod.sendWhatsAppDeliveryConfirm(order);
  }catch(e){ /* silencioso */ }
}

// ── Helper: printComanda via dynamic import ───────────────────
async function printComanda(orderId){
  try{
    const mod = await import('./impressao.js');
    if(typeof mod.printComanda === 'function') mod.printComanda(orderId);
    else console.error('[pedidos] printComanda nao exportado em impressao.js');
  }catch(e){ console.error('[pedidos] erro ao carregar printComanda:', e); }
}

// ── Helper: printCard via dynamic import ──────────────────────
async function printCard(orderId){
  try{
    const mod = await import('./impressao.js');
    if(typeof mod.printCard === 'function') mod.printCard(orderId);
    else console.error('[pedidos] printCard nao exportado em impressao.js');
  }catch(e){ console.error('[pedidos] erro ao carregar printCard:', e); }
}

// Expor helpers no window para onclick inline
// IMPORTANTE: NAO sobrescreve window.printComanda/printCard — essas sao
// setadas no main.js com a referencia DIRETA de impressao.js (sincrona).
// Se sobrescrevessemos aqui com o wrapper async local, quebrava os
// onclick="printComanda('id')" dos botoes inline.
if(typeof window !== 'undefined'){
  window.showOrderViewModal = showOrderViewModal;
  window.showEditOrderModal = showEditOrderModal;
  window.setPage = window.setPage || function(pg){ setPage(pg); };

  // Senha de alteracao de pedido. Senha pode ser configurada via env
  // ou por settings — por enquanto fixa em '2233' conforme operacao.
  const PWD_ALTERAR_PEDIDO = '2233';

  // Tenta editar um pedido. Admin/Gerente nao precisa de senha.
  // Demais usuarios sao desafiados com senha 4 digitos.
  window._tryEditOrder = (orderId) => {
    const u = S.user || {};
    const isAdmin = u.role === 'Administrador' || u.cargo === 'admin' || u.cargo === 'Administrador';
    const isGerente = u.role === 'Gerente' || u.cargo === 'Gerente';
    if (isAdmin || isGerente) {
      S._modal = '';
      showEditOrderModal(orderId);
      return;
    }
    const pwd = prompt('🔒 Edição de pedido protegida.\n\nDigite a senha de alteração para continuar:');
    if (pwd === null) return; // cancelou
    if (String(pwd).trim() !== PWD_ALTERAR_PEDIDO) {
      toast('❌ Senha incorreta. Edição bloqueada.', true);
      return;
    }
    S._modal = '';
    showEditOrderModal(orderId);
  };

  // Excluir pedido — APENAS Administrador
  window._tryDeleteOrder = async (orderId, orderNumber) => {
    const u = S.user || {};
    const isAdmin = u.role === 'Administrador' || u.cargo === 'admin' || u.cargo === 'Administrador';
    if (!isAdmin) {
      toast('🔒 Apenas Administrador pode excluir pedidos.', true);
      return;
    }
    const ok = confirm(`Excluir o pedido #${orderNumber || orderId.slice(-5)}?\n\nEsta ação NÃO pode ser desfeita.`);
    if (!ok) return;
    try {
      await DELETE('/orders/' + orderId);
      S.orders = S.orders.filter(x => x._id !== orderId);
      invalidateCache('orders');
      S._modal = '';
      toast('🗑️ Pedido excluído.');
      const { render: r } = await import('../main.js');
      r();
    } catch (e) {
      toast('❌ Erro ao excluir: ' + (e.message||''), true);
    }
  };
}

// ── PEDIDOS ──────────────────────────────────────────────────
export function renderPedidos(){
  preloadNotas();
  const today   = new Date(); today.setHours(0,0,0,0);
  const todayStr= today.toISOString().split('T')[0];
  const tmrw    = new Date(today); tmrw.setDate(today.getDate()+1);
  const tmrwStr = tmrw.toISOString().split('T')[0];

  const fStatus  = S._fStatus||'Todos';
  const fBairro  = (S._fBairro||'').toLowerCase().trim();
  const fTurno   = S._fTurno||'';
  const fUnidade = S._fUnidade||'';
  const fCanal   = S._fCanal||'';
  const fPrior   = S._fPrioridade||'';
  const fDate1   = S._fDate1||'';
  const fDate2   = S._fDate2||'';

  // Normaliza scheduledDate para so data (YYYY-MM-DD) para comparacao correta
  const orderDate = o => o.scheduledDate ? o.scheduledDate.substring(0,10) : '';

  // Filtro de unidade para LISTAGEM (Pedidos): mostra pedidos onde
  // a unidade vendeu (saleUnit) OU vai produzir (unidade).
  // Centralizado em utils/unidadeRules.js#filtrarPedidosParaListagem.
  const filtrarUnidade = (lista) => filtrarPedidosParaListagem(S.user, lista);

  let filtered = filtrarUnidade(S.orders).filter(o=>{
    if(fStatus!=='Todos' && o.status!==fStatus) return false;
    if(fBairro && !(o.deliveryNeighborhood||o.deliveryZone||'').toLowerCase().includes(fBairro)) return false;
    if(fTurno) {
      // Filtro de turno considera scheduledTime (horario especifico cai
      // no turno correto conforme o relogio). 'Horario especifico' como
      // filtro: mostra so pedidos com scheduledTime preenchido.
      if (fTurno === 'Horário específico') {
        if (!o.scheduledTime || o.scheduledTime === '00:00') return false;
      } else {
        const tKey = fTurno.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
        const tMap = { 'manha':'manha', 'tarde':'tarde', 'noite':'noite' };
        const alvo = tMap[tKey];
        if (alvo && getTurnoPedido(o) !== alvo) return false;
      }
    }
    if(fUnidade && o.unit!==fUnidade) return false;
    if(fCanal){
      const src=(o.source||'').toLowerCase();
      const tipo=String(o.type||'').toLowerCase();
      // Mapeamento dos canais (PDV foi unificado em WhatsApp/Online)
      if(fCanal==='Balcão' && !(tipo==='balcão' || tipo==='balcao')) return false;
      if(fCanal==='WhatsApp/Online' && !(src.includes('whatsapp') || src==='pdv' || src==='' || src==='online')) return false;
      if(fCanal==='E-commerce' && !(src.includes('ecomm')||src.includes('e-comm')||src==='site')) return false;
      if(fCanal==='iFood' && !src.includes('ifood')) return false;
    }
    if(fPrior && (o.priority||'Normal')!==fPrior) return false;
    // Usa so a parte YYYY-MM-DD da data para comparacao correta
    if(fDate1 && (!o.scheduledDate || orderDate(o) < fDate1)) return false;
    if(fDate2 && (!o.scheduledDate || orderDate(o) > fDate2)) return false;
    return true;
  });
  // Busca por numero, nome ou telefone
  filtered = searchOrders(filtered, S._orderSearch);

  // Ordena por prioridade: criticos → nivel de prioridade → cronologico
  filtered = [...filtered].sort((a, b) => {
    const ca = isOrderPriorityCritical(a), cb = isOrderPriorityCritical(b);
    if (ca !== cb) return ca ? -1 : 1;
    const d = getOrderPriority(b).level - getOrderPriority(a).level;
    if (d !== 0) return d;
    return new Date(b.createdAt) - new Date(a.createdAt); // mais recentes depois
  });

  // Expor filtrados para export (admin)
  S._filteredOrders = filtered;

  const hasFilter = fStatus!=='Todos'||fBairro||fTurno||fUnidade||fCanal||fPrior||fDate1||fDate2||(S._orderSearch||'');

  const cnt = s => S.orders.filter(o=>o.status===s).length;
  const statuses=['Todos','Aguardando','Em preparo','Pronto','Saiu p/ entrega','Entregue','Reentrega','Cancelado'];
  const bairros=[...new Set(S.orders.map(o=>(o.deliveryNeighborhood||o.deliveryZone||'').trim()).filter(Boolean))].sort();

  return`
<div class="tabs" style="flex-wrap:wrap;gap:3px;margin-bottom:10px;">
  ${statuses.map(s=>`<button class="tab ${fStatus===s?'active':''}" data-ped-status="${s}">
    ${s}${s!=='Todos'?`<span style="margin-left:4px;background:${fStatus===s?'rgba(255,255,255,.3)':'var(--border)'};border-radius:10px;padding:0 5px;font-size:10px">${cnt(s)}</span>`:''}</button>`).join('')}
</div>

<div class="card" style="margin-bottom:12px;padding:12px;">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px;">
    <div style="font-size:11px;font-weight:700;color:var(--ink);">🔍 Filtros${hasFilter?` <span style="background:var(--rose);color:#fff;border-radius:10px;padding:0 6px;font-size:10px;margin-left:4px">${filtered.length} resultado(s)</span>`:''}</div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
      ${renderOrderSearchBar()}
      ${hasFilter?`<button id="btn-clear-ped-filters" class="btn btn-ghost btn-sm" style="font-size:10px;color:var(--red);">✕ Limpar</button>`:''}
    </div>
  </div>
  <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;align-items:center;">
    <span style="font-size:10px;font-weight:700;color:var(--muted);">📅 DATA:</span>
    <button class="btn btn-sm ${fDate1===todayStr&&fDate2===todayStr?'btn-primary':'btn-ghost'}" id="btn-ped-hoje">Hoje</button>
    <button class="btn btn-sm ${fDate1===tmrwStr&&fDate2===tmrwStr?'btn-primary':'btn-ghost'}" id="btn-ped-amanha">Amanhã</button>
    <input type="date" class="fi" id="ped-date1" value="${fDate1}" style="width:140px;font-size:11px;"/>
    <span style="font-size:11px;color:var(--muted)">até</span>
    <input type="date" class="fi" id="ped-date2" value="${fDate2}" style="width:140px;font-size:11px;"/>
  </div>
  <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px;">
    <span style="font-size:10px;font-weight:700;color:var(--muted);">⏰ TURNO:</span>
    ${['','Manhã','Tarde','Noite','Horário específico'].map(t=>`<button class="btn btn-sm ${fTurno===t&&t?'btn-primary':fTurno===''&&t===''?'btn-ghost':''}" data-ped-turno="${t}">${t||'Todos'}</button>`).join('')}
  </div>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:6px;">
    <div>
      <label style="font-size:10px;font-weight:700;color:var(--muted);display:block;margin-bottom:3px;">🏘️ BAIRRO</label>
      <input class="fi" id="ped-filter-bairro" value="${S._fBairro||''}" placeholder="Digitar bairro..." style="font-size:11px;" list="bairros-list"/>
      <datalist id="bairros-list">${bairros.map(b=>`<option value="${b}"/>`).join('')}</datalist>
    </div>
    <div>
      <label style="font-size:10px;font-weight:700;color:var(--muted);display:block;margin-bottom:3px;">🏪 UNIDADE</label>
      <select class="fi" id="ped-filter-unidade" style="font-size:11px;">
        <option value="">Todas</option>
        ${['Loja Novo Aleixo','Loja Allegro Mall','CDLE','E-commerce'].map(u=>`<option value="${u}" ${fUnidade===u?'selected':''}>${u}</option>`).join('')}
      </select>
    </div>
    <div>
      <label style="font-size:10px;font-weight:700;color:var(--muted);display:block;margin-bottom:3px;">📲 CANAL</label>
      <select class="fi" id="ped-filter-canal" style="font-size:11px;">
        <option value="">Todos</option>
        ${['WhatsApp/Online','E-commerce','iFood','Balcão'].map(c=>`<option value="${c}" ${fCanal===c?'selected':''}>${c}</option>`).join('')}
      </select>
    </div>
    <div>
      <label style="font-size:10px;font-weight:700;color:var(--muted);display:block;margin-bottom:3px;">⭐ PRIORIDADE</label>
      <select class="fi" id="ped-filter-prioridade" style="font-size:11px;">
        <option value="">Todas</option>
        <option value="Alta" ${fPrior==='Alta'?'selected':''}>🔴 Alta</option>
        <option value="Normal" ${fPrior==='Normal'?'selected':''}>Normal</option>
      </select>
    </div>
  </div>
</div>

<div class="card">
  <div class="card-title">Pedidos <span class="notif">${filtered.length}</span>
    <div style="display:flex;gap:6px">
      <button class="btn btn-ghost btn-sm" id="btn-rel-orders">🔄</button>
      ${S.user?.role === 'Administrador' ? `
        <button class="btn btn-blue btn-sm" id="btn-import-ped">📥 Importar</button>
        <button class="btn btn-green btn-sm" id="btn-export-ped">📤 Exportar</button>
        <input type="file" id="file-import-ped" accept=".csv,.json" style="display:none" />
      ` : ''}
      <button class="btn btn-primary btn-sm" onclick="setPage('pdv')">+ Novo</button>
    </div>
  </div>
  ${filtered.length===0?`<div class="empty"><div class="empty-icon">📋</div>
    <p>${hasFilter?'Nenhum pedido com esses filtros.':'Sem pedidos ainda.'}</p>
    ${hasFilter?`<button class="btn btn-ghost btn-sm" id="btn-clear-ped-filters2" style="margin-top:8px">✕ Limpar filtros</button>`:''}</div>`:`
  <div style="overflow-x:auto;">
  <table>
    <thead><tr>
      <th>#</th><th>Cliente / Dest.</th><th>Bairro</th><th>Unidade</th>
      <th>Itens</th><th>Total</th><th>Entrega</th><th>Canal</th><th>Status</th><th></th>
    </tr></thead>
    <tbody>${filtered.map(o=>{
      const bairroCell=o.deliveryNeighborhood||o.deliveryZone||'—';
      const canal=o.source||'';
      // Detecta canal e escolhe icone (PNG real da pasta /icones)
      // ATENCAO: 'PDV' antigo agora e tratado como WhatsApp/Online
      const canalLow = String(canal).toLowerCase();
      let canalKey = '';
      let canalLabel = '';
      if (canalLow.includes('whatsapp') || canalLow === 'pdv' || canalLow === '') {
        canalKey = 'whatsapp'; canalLabel = 'WhatsApp/Online';
      } else if (canalLow.includes('ifood')) {
        canalKey = 'ifood'; canalLabel = 'iFood';
      } else if (canalLow.includes('ecomm') || canalLow.includes('e-comm') || canalLow === 'site') {
        canalKey = 'ecommerce'; canalLabel = 'E-commerce';
      } else if (o.type === 'Balcão' || o.type === 'Balcao' || canalLow.includes('balc')) {
        canalKey = 'balcao'; canalLabel = 'Balcão';
      } else {
        canalKey = 'whatsapp'; canalLabel = 'WhatsApp/Online';
      }
      const canalIcon = `<img src="/icones/${canalKey}.png" alt="${canalLabel}" title="${canalLabel}" style="width:26px;height:26px;object-fit:contain;vertical-align:middle;"/>`;
      const isPrior=o.priority==='Alta';
      const rawNum=o.orderNumber||o.numero||'';
      const numDigits=String(rawNum).replace(/^PED-?/i,'').replace(/\D/g,'');
      const numDisplay=numDigits?('#'+numDigits.padStart(5,'0')):'—';
      const prio = getOrderPriority(o);
      const prioCritical = prio.level > 0 && isOrderPriorityCritical(o);
      const prioBg = prio.level === 3 ? 'background:#FFFBEB;border-left:4px solid #F59E0B;'
                   : prio.level === 2 ? 'background:#FEF3C7;border-left:3px solid #FB923C;'
                   : prio.level === 1 ? 'background:#FFFDF5;border-left:2px solid #FCD34D;' : '';
      const prioBadgeHtml = prio.level > 0
        ? `<div style="display:inline-flex;align-items:center;gap:3px;background:${prio.level===3?'linear-gradient(135deg,#DC2626,#F59E0B)':prio.level===2?'#FB923C':'#FCD34D'};color:${prio.level>=2?'#fff':'#78350F'};font-size:9px;font-weight:800;padding:2px 7px;border-radius:999px;letter-spacing:.5px;margin-top:3px;${prioCritical?'box-shadow:0 0 10px rgba(245,158,11,.7);animation:prio-pulse 1.2s ease-in-out infinite;':''}" title="Pedido feito ha ${prio.days} dias">${prio.label}${prioCritical?' ⚠️':''}</div>` : '';
      let createdByName=o.createdByName||o.createdBy||o.criadoPorName||o.atendente||o.user||'';
      if(!createdByName&&o.criadoPor&&Array.isArray(S.users)){
        const u=S.users.find(x=>x._id===o.criadoPor);
        if(u)createdByName=u.name||u.nome||'';
      }
      return`<tr style="${isPrior?'background:#FFF7F7;':''}${prioBg}">
        <td style="color:var(--rose);font-weight:600;white-space:nowrap">${isPrior?'🔴 ':''}${numDisplay}${prioBadgeHtml}</td>
        <td>
          <div style="font-weight:500">${o.client?.name||o.clientName||'—'}</div>
          ${o.recipient&&o.recipient!==(o.client?.name||o.clientName)?`<div style="font-size:10px;color:var(--muted)">→ ${o.recipient}</div>`:''}
        </td>
        <td style="font-size:11px;font-weight:600">${bairroCell}</td>
        <td>
          ${(() => {
            // Unidade operacional: para Delivery sempre 'CDLE', para Retirada
            // a loja escolhida (unit do pedido, ja calculado pelo backend).
            const tipo = String(o.type||o.tipo||'').toLowerCase();
            const unidadeOper = tipo === 'delivery' ? 'CDLE' : (o.unit || '—');
            const atendente = o.createdByName || '';
            return `
              <span class="tag t-gray" style="font-size:9px;font-weight:700;" title="Unidade que vai sair o pedido">${unidadeOper}</span>
              ${atendente ? `<div style="font-size:9px;color:#4F46E5;font-weight:600;margin-top:2px;" title="Atendente que lançou o pedido">👤 ${atendente}</div>` : ''}
            `;
          })()}
        </td>
        <td style="color:var(--muted);font-size:11px">${(o.items||[]).map(i=>i.name).join(', ').substring(0,22)||'—'}</td>
        <td style="font-weight:600">${$c(o.total)}</td>
        <td style="font-size:11px">
          ${o.scheduledDate?`<div style="font-weight:600">${$d(o.scheduledDate)}</div>`:''}
          ${o.scheduledPeriod?`<div style="color:var(--muted)">${o.scheduledPeriod}${o.scheduledTime?' · '+o.scheduledTime:''}</div>`:'<span style="color:var(--muted)">—</span>'}
        </td>
        <td style="text-align:center;">${canalIcon}</td>
        <td>
          ${o.status==='Saiu p/ entrega'
            ?`<div style="display:flex;flex-direction:column;gap:3px;"><span class="tag ${sc(o.status)}">${o.status}${o.reentregaCount > 0 ? `<span style="background:#F59E0B;color:#fff;border-radius:10px;padding:1px 6px;font-size:9px;font-weight:700;margin-left:4px;">🔄 ${o.reentregaCount}x</span>` : ''}</span>${o.driverName?`<span style="background:#DBEAFE;color:#1D4ED8;border-radius:20px;padding:2px 8px;font-size:10px;font-weight:700;white-space:nowrap;">🚚 ${o.driverName}</span>`:''}</div>`
            :o.status==='Entregue'
            ?`<div style="display:flex;flex-direction:column;gap:3px;"><span class="tag ${sc(o.status)}">${o.status}${o.reentregaCount > 0 ? `<span style="background:#F59E0B;color:#fff;border-radius:10px;padding:1px 6px;font-size:9px;font-weight:700;margin-left:4px;">🔄 ${o.reentregaCount}x</span>` : ''}</span>${o.driverName?`<span style="background:#DCFCE7;color:#166534;border-radius:20px;padding:2px 8px;font-size:10px;font-weight:700;white-space:nowrap;">✅ ${o.driverName}</span>`:''}</div>`
            :`<span class="tag ${sc(o.status)}">${o.status}${o.reentregaCount > 0 ? `<span style="background:#F59E0B;color:#fff;border-radius:10px;padding:1px 6px;font-size:9px;font-weight:700;margin-left:4px;">🔄 ${o.reentregaCount}x</span>` : ''}</span>`}
        </td>
        <td style="white-space:nowrap">
          <button type="button" class="btn btn-ghost btn-sm" onclick="showOrderViewModal('${o._id}')">👁️ Ver</button>
          <button type="button" class="btn btn-ghost btn-sm" onclick="printComanda('${o._id}')">🖨️</button>
          ${(() => {
            // Permissoes: admin OU colaborador com modulo financial/reports/orders
            const u = S.user || {};
            const isAdm = u.role === 'Administrador' || u.cargo === 'admin';
            const podeEmitir = isAdm || can('financial') || can('reports') || can('orders');
            if (!podeEmitir) return '';
            // Busca nota AUTORIZADA ou PROCESSANDO vinculada a este pedido
            // Compara usando String() porque orderId pode vir como ObjectId
            // ou string do backend (dependendo da consulta/populate).
            const notasDoPedido = (S._notasFiscais || []).filter(n => {
              const nOrderId = n.orderId?._id || n.orderId;
              return String(nOrderId) === String(o._id) ||
                     (n.orderNumber && o.orderNumber && String(n.orderNumber) === String(o.orderNumber));
            });
            const notaAut = notasDoPedido.find(n => n.status === 'Autorizada');
            const notaProc = notasDoPedido.find(n => n.status === 'Processando' || n.status === 'Pendente');
            // Nota autorizada: botao rosa (imprimir) + esconde botoes de emissao
            if (notaAut) {
              const url = notaAut.danfeUrl || notaAut.pdfUrl || '';
              const tipoLabel = notaAut.tipo === 'NFe' ? 'DANFE' : 'Cupom';
              return url
                ? `<a href="${url}" target="_blank" title="Imprimir ${tipoLabel} da nota ${notaAut.numero || ''} — já emitida" style="display:inline-flex;align-items:center;gap:3px;background:#EC4899;color:#fff;border:none;border-radius:6px;padding:4px 9px;font-size:10px;font-weight:700;margin-left:2px;text-decoration:none;">🖨️ ${tipoLabel} ${notaAut.numero?'#'+notaAut.numero:''}</a>`
                : `<span title="Nota ${notaAut.tipo} ${notaAut.numero||''} já autorizada" style="display:inline-flex;align-items:center;gap:3px;background:#EC4899;color:#fff;border-radius:6px;padding:4px 9px;font-size:10px;font-weight:700;margin-left:2px;">✅ ${tipoLabel} emitido</span>`;
            }
            // Nota processando: mostra aguardando + oculta emissao
            if (notaProc) {
              return `<span title="Aguardando SEFAZ autorizar" style="display:inline-flex;align-items:center;gap:3px;background:#F59E0B;color:#fff;border-radius:6px;padding:4px 9px;font-size:10px;font-weight:700;margin-left:2px;">⏳ Processando</span>`;
            }
            // Sem nota: mostra botoes de emissao
            return `
              <button type="button" onclick="emitirNotaFiscal('${o._id}','NFCe')" title="Emitir NFC-e (cupom fiscal — pessoa física)" style="background:#1a3d27;color:#fff;border:none;border-radius:6px;padding:3px 7px;cursor:pointer;font-size:10px;font-weight:700;margin-left:2px;">📄 NFC-e</button>
              <button type="button" onclick="emitirNotaFiscal('${o._id}','NFe')" title="Emitir NF-e com DANFE — requer CNPJ do cliente" style="background:#5B21B6;color:#fff;border:none;border-radius:6px;padding:3px 7px;cursor:pointer;font-size:10px;font-weight:700;margin-left:2px;">📑 NF-e</button>
            `;
          })()}
        </td>
      </tr>`;
    }).join('')}</tbody>
  </table>
  </div>`}
</div>`;
}

// ── AVANÇAR STATUS DO PEDIDO ──────────────────────────────────
export async function advanceOrder(id){
  const o=S.orders.find(x=>x._id===id);if(!o)return;
  const nxt={'Aguardando':'Em preparo','Em preparo':'Pronto','Pronto':'Saiu p/ entrega','Saiu p/ entrega':'Entregue'};
  const ns=nxt[o.status];if(!ns)return toast('Pedido já finalizado');
  try{
    await PATCH('/orders/'+id+'/status',{status:ns});
    S.orders=S.orders.map(x=>x._id===id?{...x,status:ns}:x);
    const updated=S.orders.find(x=>x._id===id);
    // Log atividade por etapa
    if(ns==='Pronto')         logActivity('montagem',  updated||o);
    if(ns==='Saiu p/ entrega') logActivity('expedicao', updated||o);
    if(ns==='Entregue'){
      // Notifica cliente
      if(updated) sendDeliveryNotification(updated);
      // Registra entrada financeira automatica (receita da venda)
      registrarReceitaVenda(updated||o);
    }
    render();
    toast('✅ Status: '+ns);
  }catch(e){ toast('❌ Erro ao avançar status'); console.error(e); }
}

// ── VISUALIZAR PEDIDO (modal completo somente leitura) ────────
export function showOrderViewModal(orderId){
  const o = S.orders.find(x=>x._id===orderId);
  if(!o) return toast('❌ Pedido não encontrado');

  const statusColors = {
    'Aguardando':'#F1F5F9','Em preparo':'#FEF3C7','Pronto':'#DBEAFE',
    'Saiu p/ entrega':'#EDE9FE','Entregue':'#D1FAE5','Cancelado':'#FEE2E2'
  };
  const bgColor = statusColors[o.status]||'#F9FAFB';

  S._modal=`<div class="mo" id="mo" onclick="if(event.target===this){S._modal='';render();}">
  <div class="mo-box" style="max-width:580px;max-height:92vh;overflow-y:auto;" onclick="event.stopPropagation()">

  <!-- Header -->
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--border);">
    <div>
      <div style="font-family:'Playfair Display',serif;font-size:18px;color:var(--rose)">Pedido ${fmtOrderNum(o)}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:2px">${$d(o.createdAt)} — ${o.unit||'—'}</div>
    </div>
    <div style="display:flex;align-items:center;gap:8px;">
      <span class="tag ${sc(o.status)}">${o.status}</span>
      <button onclick="S._modal='';render();" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--muted)">×</button>
    </div>
  </div>

  <!-- Cliente e Destinatario -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">
    <div style="background:var(--cream);border-radius:10px;padding:12px;">
      <div style="font-size:9px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:5px;">👤 Cliente / Remetente</div>
      <div style="font-weight:600">${o.client?.name||o.clientName||'—'}</div>
      <div style="font-size:11px;color:var(--muted)">${o.clientPhone||o.client?.phone||'—'}</div>
      ${o.identifyClient===false?'<div style="font-size:10px;color:var(--rose);margin-top:3px;">🔒 Anônimo no cartão</div>':''}
    </div>
    <div style="background:var(--petal);border-radius:10px;padding:12px;">
      <div style="font-size:9px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:5px;">🎁 Destinatário</div>
      <div style="font-weight:600">${o.recipient||'—'}</div>
      <div style="font-size:11px;color:var(--muted)">${o.scheduledDate?$d(o.scheduledDate)+' · '+( o.scheduledPeriod||''):'Sem data'}</div>
      ${o.scheduledTime?`<div style="font-size:11px;color:var(--muted)">${o.scheduledTime}</div>`:''}
    </div>
  </div>

  <!-- Itens -->
  <div style="margin-bottom:14px;">
    <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">🌸 Itens do Pedido</div>
    ${(o.items||[]).map(i=>{
      const p=S.products.find(pr=>pr.name===i.name||pr._id===i.product);
      return`<div style="display:flex;align-items:center;gap:10px;padding:10px;background:var(--cream);border-radius:8px;margin-bottom:6px;">
        ${p?.images?.[0]?`<img src="${p.images[0]}" style="width:50px;height:50px;border-radius:8px;object-fit:contain;background:#fff;flex-shrink:0;">`:`<div style="width:50px;height:50px;border-radius:8px;background:var(--rose-l);display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0;">🌸</div>`}
        <div style="flex:1">
          <div style="font-weight:700">${i.qty}x ${i.name}</div>
          ${i.totalPrice?`<div style="font-size:11px;color:var(--muted)">${$c(i.totalPrice)}</div>`:''}
        </div>
      </div>`;
    }).join('')}
  </div>

  <!-- Endereco -->
  ${o.deliveryAddress?`
  <div style="background:#EEF2FF;border-radius:10px;padding:12px;margin-bottom:14px;border:1px solid #C7D2FE;">
    <div style="font-size:10px;font-weight:700;color:#4338CA;text-transform:uppercase;letter-spacing:1px;margin-bottom:5px;">📍 Endereço de Entrega</div>
    <div style="font-weight:600;color:#1E1B4B">${o.deliveryAddress}</div>
    ${o.condName?`<div style="font-size:12px;color:#4338CA;margin-top:3px;">🏢 ${o.condName}${o.block?' — Bloco '+o.block:''} ${o.apt?'Ap '+o.apt:''}</div>`:''}
    ${o.reference?`<div style="font-size:11px;color:#6366F1;margin-top:2px;">Ref: ${o.reference}</div>`:''}
    <a href="https://www.google.com/maps/dir/?api=1&origin=-3.0379889,-59.9516336&destination=${encodeURIComponent(o.deliveryAddress)}" target="_blank"
      style="display:inline-flex;align-items:center;gap:6px;margin-top:8px;background:#4F46E5;color:#fff;padding:8px 12px;border-radius:8px;text-decoration:none;font-size:12px;font-weight:600;">
      🗺️ Ver no Maps
    </a>
  </div>`:''}

  <!-- Mensagem cartao -->
  ${o.cardMessage?`
  <div style="background:var(--petal);border-left:3px solid var(--rose);border-radius:8px;padding:12px;margin-bottom:14px;">
    <div style="font-size:10px;font-weight:700;color:var(--rose);text-transform:uppercase;letter-spacing:1px;margin-bottom:5px;">💌 Mensagem do Cartão</div>
    <div style="font-size:14px;font-style:italic;color:var(--ink2);line-height:1.7">"${o.cardMessage}"</div>
  </div>`:''}

  <!-- Financeiro -->
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px;">
    <div style="background:var(--cream);border-radius:8px;padding:10px;text-align:center;">
      <div style="font-size:9px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Subtotal</div>
      <div style="font-weight:700;font-size:15px">${$c(o.subtotal||o.total)}</div>
    </div>
    ${o.discount?`<div style="background:#FEF3C7;border-radius:8px;padding:10px;text-align:center;">
      <div style="font-size:9px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Desconto</div>
      <div style="font-weight:700;font-size:15px;color:var(--gold)">-${$c(o.discount)}</div>
    </div>`:''}
    <div style="background:var(--rose-l);border-radius:8px;padding:10px;text-align:center;">
      <div style="font-size:9px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Total</div>
      <div style="font-weight:800;font-size:18px;color:var(--rose)">${$c(o.total)}</div>
    </div>
  </div>

  <!-- Pagamento e Entregador -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">
    <div style="background:var(--cream);border-radius:8px;padding:10px;">
      <div style="font-size:9px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">💳 Pagamento</div>
      <div style="font-weight:600;font-size:13px">${o.payment||'—'}</div>
      ${o.payment==='Pagar na Entrega'?`<div style="font-size:11px;color:var(--gold)">${o.paymentOnDelivery||''}</div>`:''}
    </div>
    ${o.driverName?`<div style="background:var(--cream);border-radius:8px;padding:10px;">
      <div style="font-size:9px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">🚚 Entregador</div>
      <div style="font-weight:600;font-size:13px">${o.driverName}</div>
    </div>`:''}
  </div>

  ${o.notes?`<div style="background:var(--cream);border-radius:8px;padding:10px;margin-bottom:14px;">
    <div style="font-size:9px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">📝 Observações</div>
    <div style="font-size:12px">${o.notes}</div>
  </div>`:''}

  ${o.reentregaCount > 0 ? `
  <div style="background:#FEF3C7;border-left:4px solid #F59E0B;border-radius:8px;padding:12px;margin-top:12px;margin-bottom:14px;">
    <div style="font-weight:700;font-size:13px;color:#92400E;margin-bottom:6px;">
      🔄 Reentrega (${o.reentregaCount}x)
    </div>
    <div style="font-size:12px;color:#78350F;margin-bottom:4px;">
      <strong>Último motivo:</strong> ${esc(o.reentregaMotivo || '—')}
    </div>
    ${o.reentregas && o.reentregas.length > 0 ? `
      <details style="margin-top:6px;">
        <summary style="cursor:pointer;font-size:11px;color:#92400E;">Ver histórico (${o.reentregas.length})</summary>
        <div style="margin-top:6px;padding:6px 10px;background:#FEF9E7;border-radius:6px;font-size:11px;">
          ${o.reentregas.map(r => `<div style="margin-bottom:3px;">📅 ${new Date(r.date).toLocaleString('pt-BR')} — ${esc(r.motivo)} <em style="color:var(--muted);">(${r.user})</em></div>`).join('')}
        </div>
      </details>
    ` : ''}
  </div>` : ''}

  <div class="mo-foot">
    <button class="btn btn-primary" onclick="window._tryEditOrder('${o._id}')">✏️ Editar Pedido</button>
    <button class="btn btn-ghost" onclick="printComanda('${o._id}')">🖨️ Comanda</button>
    <button class="btn btn-ghost" onclick="printCard('${o._id}')">💌 Cartão</button>
    ${(S.user?.role==='Administrador'||S.user?.cargo==='admin') ? `<button class="btn btn-ghost" style="color:var(--red);border-color:var(--red);" onclick="window._tryDeleteOrder('${o._id}','${(o.orderNumber||'').replace(/'/g,'')}')">🗑️ Excluir</button>` : ''}
    <button class="btn btn-ghost" id="btn-mo-close-view">Fechar</button>
  </div>
  </div></div>`;

  render();
  setTimeout(()=>{
    document.getElementById('btn-mo-close-view')?.addEventListener('click',()=>{S._modal='';render();});
  },0);
}

// ── EDITAR PEDIDO (modal completo) ────────────────────────────
export function showEditOrderModal(orderId){
  const o = S.orders.find(x=>x._id===orderId);
  if(!o) return toast('❌ Pedido não encontrado');

  const statuses = ['Aguardando','Em preparo','Pronto','Saiu p/ entrega','Entregue','Reentrega','Cancelado'];
  const periods  = ['Manhã','Tarde','Noite','Urgente','Horário específico'];
  const payments = ['Pix','Link','Cartão','Dinheiro','Pagar na Entrega','Bemol','Giuliana','iFood'];

  // Monta linhas de itens editaveis
  const itemRows = (o.items||[]).map((it,i)=>`
  <div style="display:flex;align-items:center;gap:8px;padding:8px;background:var(--cream);border-radius:8px;margin-bottom:6px;">
    <div class="av" style="width:36px;height:36px;font-size:14px;background:var(--rose-l);color:var(--rose);flex-shrink:0;">${it.qty}</div>
    <div style="flex:1;font-size:13px;font-weight:600">${it.name}</div>
    <div style="font-size:12px;color:var(--muted);white-space:nowrap">${$c(it.totalPrice||it.price*it.qty||0)}</div>
    <input type="number" class="fi eo-qty" data-idx="${i}" value="${it.qty}" min="1"
      style="width:60px;padding:5px 8px;font-size:12px;" title="Qtd"/>
    <button class="btn btn-red btn-xs eo-remove-item" data-idx="${i}" title="Remover">✕</button>
  </div>`).join('');

  S._modal=`<div class="mo" id="mo" onclick="if(event.target===this){S._modal='';render();}">
  <div class="mo-box" style="max-width:620px;max-height:94vh;overflow-y:auto;" onclick="event.stopPropagation()">

  <!-- Titulo -->
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--border);">
    <div>
      <div style="font-family:'Playfair Display',serif;font-size:18px;">✏️ Editar Pedido — ${fmtOrderNum(o)}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:2px">${o.client?.name||o.clientName||'—'}</div>
    </div>
    <button onclick="S._modal='';render();" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--muted)">×</button>
  </div>

  <!-- STATUS + DATA -->
  <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px;">📋 Status e Data</div>
  <div class="fr2" style="margin-bottom:14px;">
    <div class="fg"><label class="fl">Status</label>
      <select class="fi" id="eo-status">
        ${statuses.map(s=>`<option value="${s}" ${o.status===s?'selected':''}>${s==='Reentrega'?'🔄 Reentrega':s}</option>`).join('')}
      </select>
    </div>
    <div class="fg"><label class="fl">Período de Entrega</label>
      <select class="fi" id="eo-period">
        ${periods.map(p=>`<option ${o.scheduledPeriod===p?'selected':''}>${p}</option>`).join('')}
      </select>
    </div>
    <div class="fg"><label class="fl">Data de Entrega</label>
      <input class="fi" type="date" id="eo-date" value="${o.scheduledDate?o.scheduledDate.split('T')[0]:''}"/>
    </div>
    <div class="fg"><label class="fl">Horário Específico</label>
      <input class="fi" id="eo-time" placeholder="Ex: 14:30" value="${o.scheduledTime||''}"/>
    </div>
  </div>

  <!-- DESTINATARIO + REMETENTE -->
  <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px;">👤 Destinatário e Remetente</div>
  <div class="fr2" style="margin-bottom:14px;">
    <div class="fg"><label class="fl">Destinatário (Para quem vai)</label>
      <input class="fi" id="eo-recipient" value="${o.recipient||''}" placeholder="Nome de quem vai receber"/>
    </div>
    <div class="fg"><label class="fl">Identificar remetente no cartão?</label>
      <select class="fi" id="eo-identify">
        <option value="true"  ${o.identifyClient!==false?'selected':''}>✅ Sim — mostrar no cartão</option>
        <option value="false" ${o.identifyClient===false?'selected':''}>🚫 Não — anônimo</option>
      </select>
    </div>
  </div>

  <!-- ENDERECO -->
  <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px;">📍 Endereço de Entrega</div>
  <div class="fr2" style="margin-bottom:14px;">
    <div class="fg" style="grid-column:span 2"><label class="fl">Endereço completo</label>
      <input class="fi" id="eo-addr" value="${o.deliveryAddress||''}" placeholder="Rua, número, bairro"/>
    </div>
    <div class="fg"><label class="fl">Referência / Complemento</label>
      <input class="fi" id="eo-ref" value="${o.reference||''}" placeholder="Próximo a..."/>
    </div>
    <div class="fg">
      <label class="fl">Condomínio?</label>
      <select class="fi" id="eo-condo">
        <option value="false" ${!o.isCondominium?'selected':''}>Não</option>
        <option value="true"  ${o.isCondominium?'selected':''}>Sim</option>
      </select>
    </div>
    <div class="fg" id="eo-block-wrap" style="${o.isCondominium?'':'display:none'}">
      <label class="fl">Nome do Condomínio *</label>
      <input class="fi" id="eo-cond-name" value="${o.condName||''}" placeholder="Ex: Condomínio Mirante do Rio"/>
    </div>
    <div class="fg" id="eo-block-wrap2" style="${o.isCondominium?'':'display:none'}">
      <label class="fl">Bloco *</label>
      <input class="fi" id="eo-block" value="${o.block||''}" placeholder="Bloco"/>
    </div>
    <div class="fg" id="eo-apt-wrap" style="${o.isCondominium?'':'display:none'}">
      <label class="fl">Apartamento *</label>
      <input class="fi" id="eo-apt" value="${o.apt||''}" placeholder="Ap. 101"/>
    </div>
  </div>

  <!-- PAGAMENTO -->
  <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px;">💳 Pagamento</div>
  <div class="fr2" style="margin-bottom:14px;">
    <div class="fg"><label class="fl">Forma de pagamento</label>
      <select class="fi" id="eo-payment">
        ${payments.map(p=>`<option ${o.payment===p?'selected':''}>${p}</option>`).join('')}
      </select>
    </div>
    <div class="fg"><label class="fl">Desconto (R$)</label>
      <input class="fi" type="number" id="eo-discount" value="${o.discount||0}" min="0" step="0.50"/>
    </div>
    <div class="fg"><label class="fl">Total do Pedido (R$)</label>
      <input class="fi" type="number" id="eo-total" value="${o.total||0}" step="0.10"/>
    </div>
  </div>

  <!-- ITENS -->
  <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px;">🌸 Itens do Pedido</div>
  <div id="eo-items-list" style="margin-bottom:10px;">${itemRows}</div>
  <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;">
    <select class="fi" id="eo-add-product" style="flex:1;min-width:160px;">
      <option value="">➕ Adicionar produto...</option>
      ${S.products.filter(p=>p.active!==false).map(p=>`<option value="${p._id}" data-name="${p.name}" data-price="${p.salePrice||p.price||0}">${p.name} — ${$c(p.salePrice||0)}</option>`).join('')}
    </select>
    <button class="btn btn-ghost btn-sm" id="btn-eo-add-item">➕ Adicionar</button>
  </div>

  <!-- MENSAGEM CARTAO + OBS -->
  <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px;">💌 Cartão e Observações</div>
  <div class="fr2" style="margin-bottom:8px;">
    <div class="fg" style="grid-column:span 2"><label class="fl">Mensagem do Cartão</label>
      <textarea class="fi" id="eo-card" rows="2" placeholder="Mensagem para o destinatário...">${o.cardMessage||''}</textarea>
    </div>
    <div class="fg" style="grid-column:span 2"><label class="fl">Observações internas</label>
      <textarea class="fi" id="eo-notes" rows="2" placeholder="Instruções de montagem, cuidados especiais...">${o.notes||''}</textarea>
    </div>
  </div>

  <div class="mo-foot">
    <button class="btn btn-primary" id="btn-eo-save" style="flex:1;justify-content:center;padding:11px;">
      💾 Salvar Alterações
    </button>
    <button class="btn btn-ghost" id="btn-eo-cancel">Cancelar</button>
  </div>
  </div></div>`;

  render();

  setTimeout(()=>{
    // Fechar
    document.getElementById('btn-eo-cancel')?.addEventListener('click',()=>{S._modal='';render();});

    // Toggle condominio
    document.getElementById('eo-condo')?.addEventListener('change',e=>{
      const show = e.target.value==='true';
      ['eo-block-wrap','eo-block-wrap2','eo-apt-wrap'].forEach(id=>{
        const el=document.getElementById(id);
        if(el) el.style.display=show?'':'none';
      });
    });

    // Remover item
    document.querySelectorAll('.eo-remove-item').forEach(btn=>btn.addEventListener('click',()=>{
      const idx=parseInt(btn.dataset.idx);
      const items=[...(o.items||[])];
      items.splice(idx,1);
      o.items=items;
      showEditOrderModal(orderId); // re-abre com itens atualizados
    }));

    // Adicionar item
    document.getElementById('btn-eo-add-item')?.addEventListener('click',()=>{
      const sel=document.getElementById('eo-add-product');
      const pid=sel?.value; if(!pid) return;
      const prod=S.products.find(p=>p._id===pid); if(!prod) return;
      const items=[...(o.items||[])];
      const ex=items.find(i=>i.product===pid||i.name===prod.name);
      if(ex) ex.qty++;
      else items.push({product:pid,name:prod.name,price:prod.salePrice||0,qty:1,totalPrice:prod.salePrice||0});
      o.items=items;
      showEditOrderModal(orderId);
    });

    // Salvar
    document.getElementById('btn-eo-save')?.addEventListener('click',async()=>{
      // Le qtds atualizadas dos itens
      const itemsEl=document.querySelectorAll('.eo-qty');
      const items=[...(o.items||[])].map((it,i)=>{
        const qEl=document.querySelector(`.eo-qty[data-idx="${i}"]`);
        const qty=qEl?parseInt(qEl.value)||1:it.qty;
        return{...it,qty,totalPrice:(it.price||0)*qty};
      });

      const payload={
        status:         document.getElementById('eo-status')?.value,
        scheduledDate:  document.getElementById('eo-date')?.value,
        scheduledPeriod:document.getElementById('eo-period')?.value,
        scheduledTime:  document.getElementById('eo-time')?.value,
        recipient:      document.getElementById('eo-recipient')?.value?.trim(),
        identifyClient: document.getElementById('eo-identify')?.value!=='false',
        deliveryAddress:document.getElementById('eo-addr')?.value?.trim(),
        reference:      document.getElementById('eo-ref')?.value?.trim(),
        isCondominium:  document.getElementById('eo-condo')?.value==='true',
        condName:       document.getElementById('eo-cond-name')?.value?.trim(),
        block:          document.getElementById('eo-block')?.value?.trim(),
        apt:            document.getElementById('eo-apt')?.value?.trim(),
        payment:        document.getElementById('eo-payment')?.value,
        discount:       parseFloat(document.getElementById('eo-discount')?.value)||0,
        total:          parseFloat(document.getElementById('eo-total')?.value)||o.total,
        cardMessage:    document.getElementById('eo-card')?.value?.trim(),
        notes:          document.getElementById('eo-notes')?.value?.trim(),
        items,
      };

      S._modal=''; S.loading=true; try{render();}catch(e){}
      try{
        const updated = await PUT('/orders/'+orderId, payload).catch(async()=>{
          // Se PUT falhar tenta PATCH
          return await PATCH('/orders/'+orderId, payload);
        });
        S.orders=S.orders.map(x=>x._id===orderId?{...x,...payload,...(updated||{})}:x);
        S.loading=false; render(); toast('✅ Pedido '+o.orderNumber+' atualizado!');
      }catch(e){
        S.loading=false; render(); toast('❌ Erro ao salvar: '+(e.message||''));
      }
    });
  },0);
}
