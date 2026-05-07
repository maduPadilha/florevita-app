import { S } from '../state.js';
import { $c, $d, sc, ini, esc, paymentStatusBadge, fmtOrderNum } from '../utils/formatters.js';
import { PATCH } from '../services/api.js';
import { toast } from '../utils/helpers.js';
import { can, findColab } from '../services/auth.js';
import { emoji } from '../utils/formatters.js';
import { searchOrders, renderOrderSearchBar } from '../utils/helpers.js';
import { filtrarPedidosParaProducao } from '../utils/unidadeRules.js';

// ── Helper: render() via dynamic import ───────────────────────
async function render(){
  const { render:r } = await import('../main.js');
  r();
}

// ── Helpers locais (metas / atividades) — mesmos do dashboard ─
function getActivities(){ return JSON.parse(localStorage.getItem('fv_activities')||'[]'); }

function getMetasPeriod(per){
  const now = new Date();
  const start = new Date();
  if(per==='dia'){
    start.setHours(0,0,0,0);
  } else if(per==='semana'){
    const day = now.getDay(); // 0=dom
    start.setDate(now.getDate() - day);
    start.setHours(0,0,0,0);
  } else { // mes
    start.setDate(1); start.setHours(0,0,0,0);
  }
  return start;
}

function getColabStats(colab){
  if(!colab) return {vendas:0,comissao:0,montagens:0,expedicoes:0};
  const acts = getActivities();
  const ids = new Set([colab.id, colab.backendId].filter(Boolean));
  const emailLow = (colab.email||'').toLowerCase();

  const mPer = colab.metas?.montagemPer || 'dia';
  const ePer = colab.metas?.expedicaoPer || 'dia';
  const mStart = getMetasPeriod(mPer);
  const eStart = getMetasPeriod(ePer);

  // Cancelados nao contam pra comissoes
  const cancelledIds = new Set(
    (S.orders||[]).filter(o => o.status === 'Cancelado').map(o => String(o._id))
  );

  let vendas=0, comissao=0, montagens=0, expedicoes=0;
  acts.forEach(a=>{
    const byId   = ids.has(a.userId);
    const byEmail= (a.userEmail||'').toLowerCase()===emailLow;
    const byName = (a.userName||'').toLowerCase()===(colab.name||'').toLowerCase();
    const isMe   = byId || byEmail || byName;
    if(!isMe) return;
    if (a.orderId && cancelledIds.has(String(a.orderId))) return;
    const aDate = new Date(a.date);
    if(a.type==='venda'){
      vendas++;
      const pct = colab.metas?.comissaoVenda||colab.metas?.vendaPct||0;
      comissao += (a.total||0) * (pct/100);
    }
    if(a.type==='montagem' && aDate >= mStart){
      montagens++;
      comissao += colab.metas?.comissaoMontagem||0;
    }
    if(a.type==='expedicao' && aDate >= eStart){
      expedicoes++;
      comissao += colab.metas?.comissaoExpedicao||0;
    }
  });
  return {vendas, comissao, montagens, expedicoes};
}

function metaBar(atual, meta, label, unit=''){
  if(!meta) return '';
  const pct = Math.min(100, Math.round((atual/meta)*100));
  const cor = pct>=100?'var(--leaf)':pct>=60?'#F59E0B':'var(--red)';
  return`<div style="margin-bottom:6px;">
    <div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:2px;">
      <span>${label}</span>
      <span style="font-weight:700;color:${cor}">${atual}/${meta}${unit} <span style="color:var(--muted)">(${pct}%)</span></span>
    </div>
    <div style="height:5px;background:#E5E7EB;border-radius:3px;overflow:hidden;">
      <div style="height:100%;width:${pct}%;background:${cor};border-radius:3px;transition:width .4s;"></div>
    </div>
  </div>`;
}

// ── Mostrar imagem em tela cheia ─────────────────────────────
function showFullImg(url){
  S._modal=`<div class="mo" id="mo" onclick="S._modal='';import('../main.js').then(m=>m.render())">
  <div style="background:#fff;border-radius:16px;padding:16px;max-width:500px;width:94%;text-align:center">
    <img src="${url}" style="max-width:100%;max-height:70vh;object-fit:contain;border-radius:8px;"/>
    <div style="margin-top:10px"><button class="btn btn-ghost" onclick="S._modal='';import('../main.js').then(m=>m.render())">Fechar</button></div>
  </div></div>`;
  render();
}

// Expor showFullImg globalmente para onclick inline no HTML
if(typeof window!=='undefined') window.showFullImg = showFullImg;

// ── PRODUÇÃO ─────────────────────────────────────────────────
export function renderProducao(){
  const today = new Date();
  today.setHours(0,0,0,0);
  const selectedDate = S._prodDate || today.toISOString().split('T')[0];
  const isToday = selectedDate === today.toISOString().split('T')[0];

  // Painel de meta de montagem do colaborador logado
  const colabLogado = findColab(S.user?.email||S.user?._id||'');
  const mtMontagem = colabLogado?.metas?.montagemQtd||0;
  const statsMontagem = mtMontagem ? getColabStats(colabLogado) : null;
  const metaMontPanel = (mtMontagem && statsMontagem) ? `
<div style="background:linear-gradient(135deg,var(--petal),#fff);border:1px solid rgba(200,115,106,.2);border-radius:var(--rl);padding:12px 14px;margin-bottom:12px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
  <div style="font-size:28px">🌸</div>
  <div style="flex:1;min-width:160px;">
    <div style="font-weight:700;font-size:13px;margin-bottom:4px;">Minha Meta de Montagem — ${colabLogado.metas.montagemPer||'dia'}</div>
    ${metaBar(statsMontagem.montagens, mtMontagem, '')}
    <div style="font-size:11px;color:var(--muted);margin-top:2px;">${statsMontagem.montagens} montados de ${mtMontagem} · ${Math.round(statsMontagem.montagens/mtMontagem*100)}%</div>
  </div>
  ${statsMontagem.montagens>=mtMontagem?`<span style="font-size:22px" title="Meta batida!">🏆</span>`:''}
</div>` : '';

  // Filter orders for selected date
  // Regra: vai para produção se pagamento aprovado/pago/pagar-na-entrega
  // Bloqueia: Cancelado, Negado, Extornado
  const BLOQUEADOS_PROD = ['Cancelado','Negado','Extornado'];
  // "Ag. Pagamento na Entrega" é liberado (cliente vai pagar ao receber)
  const LIBERADOS_PAG = ['Aprovado','Pago','Pago na Entrega','Ag. Pagamento na Entrega'];

  // Filtro STRICT por unidade: cada produção vê apenas pedidos que serão
  // produzidos/retirados na sua unidade. Delivery vai pra CDLE; retiradas
  // vão para a loja de destino; balcão fica na loja onde foi vendido.
  const ordersParaProducao = filtrarPedidosParaProducao(S.user, S.orders);

  const allQueue = ordersParaProducao.filter(o=>{
    if(!['Aguardando','Em preparo','Pronto'].includes(o.status)) return false;
    const payStatus = o.paymentStatus || 'Ag. Pagamento';
    const payMethod = o.payment || o.pagamento?.metodo || '';
    if(BLOQUEADOS_PROD.includes(payStatus)) return false;
    if(LIBERADOS_PAG.includes(payStatus)) return true;
    if(payMethod === 'Pagar na Entrega') return true;
    return false;
  });

  // Pedidos aguardando pagamento (em status de produção mas sem liberação)
  const aguardandoPgto = ordersParaProducao.filter(o=>{
    if(!['Aguardando','Em preparo','Pronto'].includes(o.status)) return false;
    const payStatus = o.paymentStatus || 'Ag. Pagamento';
    const payMethod = o.payment || o.pagamento?.metodo || '';
    if(LIBERADOS_PAG.includes(payStatus)) return false;
    if(BLOQUEADOS_PROD.includes(payStatus)) return false;
    if(payMethod === 'Pagar na Entrega') return false;
    return true;
  });

  const forDate = allQueue.filter(o=>{
    // Pedidos SEM data de entrega = imediatos -> sempre aparecem na producao
    if(!o.scheduledDate) return true;
    const d = new Date(o.scheduledDate);
    d.setHours(0,0,0,0);
    const sel = new Date(selectedDate);
    sel.setHours(0,0,0,0);
    return d.getTime()===sel.getTime();
  });

  const aguardandoPgtoDate = aguardandoPgto.filter(o=>{
    if(!o.scheduledDate) return true;
    const d = new Date(o.scheduledDate);
    d.setHours(0,0,0,0);
    const sel = new Date(selectedDate);
    sel.setHours(0,0,0,0);
    return d.getTime()===sel.getTime();
  });

  const byShift = {
    'Manhã': forDate.filter(o=>o.scheduledPeriod==='Manhã'||!o.scheduledPeriod),
    'Tarde': forDate.filter(o=>o.scheduledPeriod==='Tarde'),
    'Noite': forDate.filter(o=>o.scheduledPeriod==='Noite'),
    'Horário específico': forDate.filter(o=>o.scheduledPeriod==='Horário específico'),
  };

  const activeShift = S._prodShift||'Todos';
  const shiftFiltered0 = activeShift==='Todos' ? forDate : (byShift[activeShift]||[]);
  // Busca por numero, nome ou telefone
  const shiftFiltered = searchOrders(shiftFiltered0, S._orderSearch);

  return`
${metaMontPanel}
<div class="g4" style="margin-bottom:16px;">
  <div class="mc rose"><div class="mc-label">Para ${isToday?'Hoje':'Esta Data'}</div><div class="mc-val">${forDate.length}</div></div>
  <div class="mc gold"><div class="mc-label">Em Produção</div><div class="mc-val">${forDate.filter(o=>o.status==='Em preparo').length}</div></div>
  <div class="mc leaf"><div class="mc-label">Prontos</div><div class="mc-val">${forDate.filter(o=>o.status==='Pronto').length}</div></div>
  <div class="mc purple"><div class="mc-label">Aguardando</div><div class="mc-val">${forDate.filter(o=>o.status==='Aguardando').length}</div></div>
</div>

<div class="card" style="margin-bottom:14px;">
  <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
    <div style="display:flex;gap:6px;align-items:center;">
      <button class="btn btn-sm ${isToday?'btn-primary':'btn-ghost'}" id="btn-prod-today">📅 Hoje</button>
      <input type="date" class="fi" id="prod-date-picker" value="${selectedDate}" style="width:160px;"/>
    </div>
    <div style="display:flex;gap:4px;">
      ${['Todos','Manhã','Tarde','Noite','Horário específico'].map(s=>`
      <button class="btn btn-xs ${activeShift===s?'btn-primary':'btn-ghost'}" data-shift="${s}">
        ${s==='Manhã'?'☀️':s==='Tarde'?'🌤️':s==='Noite'?'🌙':s==='Horário específico'?'🕐':'📋'} ${s}
        ${s!=='Todos'&&byShift[s]?.length?`(${byShift[s].length})`:''}
      </button>`).join('')}
    </div>
    ${renderOrderSearchBar('Buscar pedido, cliente ou telefone...')}
    <button class="btn btn-ghost btn-sm" id="btn-rel-orders">🔄</button>
  </div>
</div>

${shiftFiltered.length===0?`
<div class="empty card">
  <div class="empty-icon">🌿</div>
  <p>${S._orderSearch?'Nenhum resultado para "'+S._orderSearch+'"':'Nenhum pedido para '+(isToday?'hoje':$d(selectedDate))+(activeShift!=='Todos'?' no turno '+activeShift:'')}</p>
</div>`:`

<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px;">
${shiftFiltered.map(o=>{
  const isLate = o.scheduledPeriod==='Manhã' && new Date().getHours()>=12 && o.status!=='Pronto';
  const isUrgent = o.scheduledPeriod==='Tarde' && new Date().getHours()>=16 && o.status!=='Pronto';
  return`
  <div style="background:#fff;border-radius:var(--rl);border:1px solid ${isLate?'var(--red)':isUrgent?'var(--gold)':'var(--border)'};padding:16px;box-shadow:var(--shadow);">
    ${isLate?`<div class="tag t-red" style="margin-bottom:8px">🔴 ATRASADO</div>`:isUrgent?`<div class="tag t-gold" style="margin-bottom:8px">⚡ URGENTE</div>`:''}
    ${o.payment==='Pagar na Entrega'?`<div class="tag t-gold" style="margin-bottom:6px;">💰 Cobrar na Entrega: ${$c(o.total)}</div>`:''}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
      <span style="font-weight:700;color:var(--rose);font-size:16px">${fmtOrderNum(o)}</span>
      <span class="tag ${sc(o.status)}">${o.status}</span>
    </div>

    <div style="display:flex;gap:4px;margin-bottom:8px;flex-wrap:wrap;">
      <span class="tag t-gray">${o.scheduledPeriod||'Sem turno'}</span>
      ${o.scheduledTime?`<span class="tag t-blue">🕐 ${o.scheduledTime}</span>`:''}
      ${o.type==='Delivery'?`<span class="tag t-purple">🚚 Delivery</span>`:`<span class="tag t-gray">🏪 ${o.type||'Balcão'}</span>`}
    </div>

    <!-- PRODUTOS COM FOTO -->
    <div style="margin-bottom:10px;">
      ${(o.items||[]).map(item=>{
        const prod = S.products.find(p=>p._id===item.product||p.name===item.name);
        const img = prod?.imagem || prod?.images?.[0] || prod?.image || '';
        const pid = prod?._id || prod?.id || '';
        return`<div style="display:flex;flex-direction:column;gap:8px;padding:10px;background:var(--cream);border-radius:var(--r);margin-bottom:8px;">
          <div style="display:flex;justify-content:center;">
            ${img
              ?`<img src="${img}" style="width:100%;max-width:280px;height:200px;border-radius:10px;object-fit:contain;background:#fff;border:1px solid var(--border);cursor:zoom-in;" onclick="showFullImg('${img}')" title="Clique para ampliar"/>`
              :`<div class="prod-img-placeholder-prod" data-pid="${pid}" style="width:100%;max-width:280px;height:200px;border-radius:10px;background:var(--rose-l);display:flex;align-items:center;justify-content:center;font-size:60px;">${emoji(prod?.category||item.name)}</div>`}
          </div>
          <div>
            <div style="font-size:14px;font-weight:700;text-align:center;">${item.qty}x ${item.name}</div>
            ${prod?.productionNotes?`<div style="font-size:11px;color:#0369A1;background:#E0F2FE;padding:4px 8px;border-radius:4px;margin-top:4px;">🎨 <strong>Produção:</strong> ${esc(prod.productionNotes)}</div>`:''}
            ${item.notes?`<div style="font-size:11px;color:#92400E;background:#FEF3C7;padding:4px 8px;border-radius:4px;margin-top:4px;">📝 ${esc(item.notes)}</div>`:''}
          </div>
        </div>`;
      }).join('')}
    </div>

    <!-- DESTINATARIO E CARTAO -->
    ${o.recipient?`<div style="font-size:12px;margin-bottom:6px;">👤 <strong>Para:</strong> ${o.recipient}</div>`:''}
    ${o.cardMessage?`<div style="background:var(--petal);border-radius:var(--r);padding:8px 10px;font-size:12px;color:var(--ink2);margin-bottom:8px;font-style:italic;">"${o.cardMessage}"</div>`:''}

    <!-- OBSERVACOES DESTACADAS -->
    ${o.notes || o.productionNotes ? `
    <div style="background:#FEF3C7;border-left:4px solid #F59E0B;border-radius:8px;padding:10px 12px;margin-top:10px;margin-bottom:8px;">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
        <span style="font-size:14px;">⚠️</span>
        <span style="font-size:11px;font-weight:700;color:#92400E;text-transform:uppercase;letter-spacing:.5px;">Observações</span>
      </div>
      <div style="font-size:12px;color:#78350F;line-height:1.4;white-space:pre-wrap;">
        ${o.notes ? esc(o.notes) : ''}
        ${o.notes && o.productionNotes ? '<br>' : ''}
        ${o.productionNotes ? '<strong>Produção:</strong> ' + esc(o.productionNotes) : ''}
      </div>
    </div>` : ''}

    <!-- ENDERECO -->
    ${o.deliveryAddress?`<div style="font-size:11px;color:var(--muted);margin-bottom:10px;">📍 ${o.deliveryAddress}</div>`:''}

    <!-- ACOES -->
    <div style="display:flex;gap:6px;flex-wrap:wrap;">
      ${o.status==='Aguardando'?`<button class="btn btn-primary btn-sm" data-prod-start="${o._id}">▶ Iniciar Produção</button>`:''}
      ${o.status==='Em preparo'?`<button class="btn btn-green btn-sm" data-prod-done="${o._id}">✅ Pronto p/ Expedição</button>`:''}
      ${o.status==='Pronto'?`<div class="tag t-green" style="padding:6px 12px;">✅ Pronto para sair</div>`:''}
    </div>
  </div>`;
}).join('')}
</div>`}

${aguardandoPgtoDate.length>0 ? `
<div class="card" style="margin-top:16px;border-color:#FCD34D;background:#FFFBEB;">
  <div class="card-title" style="color:#92400E;">⏳ Aguardando Pagamento <span style="font-size:11px;color:#B45309;font-weight:600;">(${aguardandoPgtoDate.length} pedido${aguardandoPgtoDate.length===1?'':'s'} bloqueado${aguardandoPgtoDate.length===1?'':'s'} aguardando aprovação)</span></div>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px;margin-top:10px;">
    ${aguardandoPgtoDate.map(o=>`
      <div style="background:#fff;border:1px solid #FCD34D;border-radius:var(--r);padding:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <span style="font-weight:700;color:var(--rose);font-size:13px">${o.orderNumber||'—'}</span>
          ${paymentStatusBadge(o.paymentStatus)}
        </div>
        <div style="font-size:12px;color:var(--ink2);margin-bottom:4px;">${esc(o.clientName||o.cliente?.nome||'—')}</div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:4px;">💳 ${esc(o.payment||'—')} · ${$c(o.total)}</div>
        ${o.scheduledPeriod?`<div style="font-size:11px;color:var(--muted);">🕐 ${esc(o.scheduledPeriod)}${o.scheduledTime?' · '+o.scheduledTime:''}</div>`:''}
      </div>
    `).join('')}
  </div>
</div>` : ''}
`;
}
