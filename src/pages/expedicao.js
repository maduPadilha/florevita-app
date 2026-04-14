import { S } from '../state.js';
import { $c, $d, sc, ini, esc } from '../utils/formatters.js';
import { PATCH } from '../services/api.js';
import { toast, searchOrders, renderOrderSearchBar } from '../utils/helpers.js';
import { can, findColab, getColabs } from '../services/auth.js';
import { saveDriverAssignment, mergeDriverAssignments, invalidateCache } from '../services/cache.js';
import { emoji } from '../utils/formatters.js';

// ── Helper: render() via dynamic import ───────────────────────
async function render(){
  const { render:r } = await import('../main.js');
  r();
}

// ── Helper: logActivity via dynamic import ────────────────────
async function logActivity(type, order){
  const mod = await import('../utils/helpers.js');
  if(typeof mod.logActivity === 'function') mod.logActivity(type, order);
}

// ── Helper: printCard via dynamic import ──────────────────────
async function printCard(orderId){
  try{
    const mod = await import('../utils/helpers.js');
    if(typeof mod.printCard === 'function') mod.printCard(orderId);
  }catch(e){ console.warn('printCard nao disponivel'); }
}

// ── Helper: printComanda via dynamic import ───────────────────
async function printComanda(orderId){
  try{
    const mod = await import('../utils/helpers.js');
    if(typeof mod.printComanda === 'function') mod.printComanda(orderId);
  }catch(e){ console.warn('printComanda nao disponivel'); }
}

// ── Helper: sendWhatsAppDeliveryConfirm via dynamic import ────
async function sendWhatsAppDeliveryConfirm(order){
  try{
    const mod = await import('../utils/helpers.js');
    if(typeof mod.sendWhatsAppDeliveryConfirm === 'function') mod.sendWhatsAppDeliveryConfirm(order);
  }catch(e){ /* silencioso */ }
}

// ── Helpers locais (metas / atividades) ───────────────────────
function getActivities(){ return JSON.parse(localStorage.getItem('fv_activities')||'[]'); }

function getMetasPeriod(per){
  const now = new Date();
  const start = new Date();
  if(per==='dia'){
    start.setHours(0,0,0,0);
  } else if(per==='semana'){
    const day = now.getDay();
    start.setDate(now.getDate() - day);
    start.setHours(0,0,0,0);
  } else {
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

  let vendas=0, comissao=0, montagens=0, expedicoes=0;
  acts.forEach(a=>{
    const byId   = ids.has(a.userId);
    const byEmail= (a.userEmail||'').toLowerCase()===emailLow;
    const byName = (a.userName||'').toLowerCase()===(colab.name||'').toLowerCase();
    const isMe   = byId || byEmail || byName;
    if(!isMe) return;
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

// ── ENTREGADORES ─────────────────────────────────────────────
export function getEntregadores(){
  // Do backend
  const fromBackend = S.users.filter(u => u.role==='Entregador' && u.active!==false)
    .map(u => ({id: u._id, _id: u._id, name: u.name, fonte: 'backend'}));
  // Dos colaboradores locais
  const fromColabs = getColabs().filter(c => c.cargo==='Entregador' && c.active!==false)
    .map(c => ({id: c.id, _id: c.id, name: c.name, fonte: 'colab'}));
  // Junta sem duplicar pelo nome
  const names = new Set(fromBackend.map(u => u.name.trim().toLowerCase()));
  const extras = fromColabs.filter(c => !names.has(c.name.trim().toLowerCase()));
  return [...fromBackend, ...extras];
}

// ── RENDER EXPEDIÇÃO ─────────────────────────────────────────
export function renderExpedicao(){
  const today = new Date();
  today.setHours(0,0,0,0);
  const selectedDate = S._expDate || today.toISOString().split('T')[0];
  const isToday = selectedDate === today.toISOString().split('T')[0];

  // Pedidos prontos para expedir na data selecionada
  const forDate = S.orders.filter(o=>{
    if(o.status==='Cancelado'||o.type==='Balcão') return false;
    if(o.type!=='Delivery'&&o.type!=='Retirada') return false;
    if(!o.scheduledDate) return isToday;
    const d = new Date(o.scheduledDate);
    d.setHours(0,0,0,0);
    const sel = new Date(selectedDate);
    sel.setHours(0,0,0,0);
    return d.getTime()===sel.getTime();
  });

  const emProducao = forDate.filter(o=>['Aguardando','Em preparo'].includes(o.status));
  const prontos0 = forDate.filter(o=>o.status==='Pronto');
  const emRota0 = forDate.filter(o=>o.status==='Saiu p/ entrega');
  // Busca por numero, nome ou telefone
  const prontos = searchOrders(prontos0, S._orderSearch);
  const emRota  = searchOrders(emRota0,  S._orderSearch);
  const entregadores = getEntregadores();

  // Meta de expedicao do colaborador logado
  const colabLogadoExp = findColab(S.user?.email||S.user?._id||'');
  const mtExp = colabLogadoExp?.metas?.expedicaoQtd||0;
  const statsExp = mtExp ? getColabStats(colabLogadoExp) : null;
  const metaExpPanel = (mtExp && statsExp) ? `
<div style="background:linear-gradient(135deg,#F0FDF4,#fff);border:1px solid #86EFAC;border-radius:var(--rl);padding:12px 14px;margin-bottom:12px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
  <div style="font-size:28px">📦</div>
  <div style="flex:1;min-width:160px;">
    <div style="font-weight:700;font-size:13px;margin-bottom:4px;">Minha Meta de Expedição — ${colabLogadoExp.metas.expedicaoPer||'dia'}</div>
    ${metaBar(statsExp.expedicoes, mtExp, '')}
    <div style="font-size:11px;color:var(--muted);margin-top:2px;">${statsExp.expedicoes} expedidos de ${mtExp} · ${Math.round(statsExp.expedicoes/mtExp*100)}%</div>
  </div>
  ${statsExp.expedicoes>=mtExp?`<span style="font-size:22px" title="Meta batida!">🏆</span>`:''}
</div>` : '';

  return`
${metaExpPanel}
<div class="g4" style="margin-bottom:16px;">
  <div class="mc leaf"><div class="mc-label">Prontos p/ Saída</div><div class="mc-val">${prontos.length}</div></div>
  <div class="mc gold"><div class="mc-label">Em Rota</div><div class="mc-val">${emRota.length}</div></div>
  <div class="mc rose"><div class="mc-label">Entregues Hoje</div><div class="mc-val">${S.orders.filter(o=>o.status==='Entregue'&&new Date(o.createdAt).toDateString()===new Date().toDateString()).length}</div></div>
  <div class="mc purple"><div class="mc-label">Entregadores</div><div class="mc-val">${entregadores.length}</div></div>
</div>

<div class="card" style="margin-bottom:14px;">
  <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
    <button class="btn btn-sm ${isToday?'btn-primary':'btn-ghost'}" id="btn-exp-today">📅 Hoje</button>
    <input type="date" class="fi" id="exp-date-picker" value="${selectedDate}" style="width:160px;"/>
    ${renderOrderSearchBar('Buscar pedido, cliente ou telefone...')}
    <button class="btn btn-ghost btn-sm" id="btn-rel-orders">🔄 Atualizar</button>
  </div>
</div>

${forDate.length===0?`
<div class="empty card">
  <div class="empty-icon">📤</div>
  <p>Nenhuma entrega ${isToday?'para hoje':'para '+$d(selectedDate)}</p>
</div>`:`

${emProducao.length>0?`
<div class="alert al-warn" style="margin-bottom:14px;">
  ⚠️ <strong>${emProducao.length} pedido(s) ainda em produção</strong> para ${isToday?'hoje':$d(selectedDate)}:
  ${emProducao.map(o=>`<span style="margin-left:8px;font-weight:600">${o.orderNumber}</span>`).join('')}
</div>`:''}

<div class="g2">
  <div>
    <div class="card">
      <div class="card-title">📦 Prontos para Expedir
        <span class="notif">${prontos.length}</span>
      </div>
      ${prontos.length===0?`<div class="empty"><p>Nenhum pedido pronto</p></div>`:''}
      ${prontos.map(o=>`
      <div style="background:var(--leaf-l);border-radius:var(--r);padding:14px;margin-bottom:10px;border:1px solid rgba(45,106,79,.2);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-weight:700;color:var(--rose);font-size:15px">${o.orderNumber}</span>
            ${o.isPriority?`<span class="tag t-red">🔴 PRIORIDADE</span>`:''}
          </div>
          <div style="display:flex;gap:4px;flex-wrap:wrap;">
            <span class="tag t-gold">${o.scheduledPeriod||'—'}</span>
            ${o.scheduledTime?`<span class="tag t-blue">🕐 ${o.scheduledTime}</span>`:''}
          </div>
        </div>

        <div style="font-size:13px;font-weight:600;margin-bottom:4px">${o.client?.name||o.clientName||'—'}</div>
        ${o.recipient?`<div style="font-size:12px;color:var(--muted)">👤 Para: ${o.recipient}</div>`:''}
        <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">📍 ${o.deliveryAddress||'Retirada'}</div>

        <!-- FOTOS DOS PRODUTOS -->
        <div style="margin-bottom:10px;">
          ${(o.items||[]).map(i=>{
            const prod=S.products.find(p=>p._id===i.product||p.name===i.name);
            return`<div style="display:flex;align-items:center;gap:10px;padding:8px;background:var(--cream);border-radius:var(--r);margin-bottom:6px;">
              ${prod?.images?.[0]
                ?`<img src="${prod.images[0]}" style="width:52px;height:52px;border-radius:8px;object-fit:cover;flex-shrink:0;border:1px solid var(--border)"/>`
                :`<div style="width:52px;height:52px;border-radius:8px;background:var(--rose-l);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">${emoji(prod?.category||'')}</div>`}
              <div>
                <div style="font-size:13px;font-weight:600">${i.qty}x ${i.name}</div>
                ${prod?.productionNotes?`<div style="font-size:11px;color:var(--muted)">${prod.productionNotes}</div>`:''}
              </div>
            </div>`;
          }).join('')}
        </div>

        ${o.cardMessage?`
        <div style="background:var(--petal);border-radius:var(--r);padding:10px 12px;margin-bottom:10px;border-left:3px solid var(--rose);">
          <div style="font-size:10px;color:var(--rose);font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">💌 Mensagem do Cartão</div>
          <div style="font-size:12px;font-style:italic;color:var(--ink2)">"${o.cardMessage}"</div>
          ${o.identifyClient!==false?`<div style="font-size:10px;color:var(--muted);margin-top:4px">✅ Identificar remetente: ${o.client?.name||o.clientName||'—'}</div>`:`<div style="font-size:10px;color:var(--muted);margin-top:4px">👤 Envio anônimo</div>`}
        </div>`:''}

        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">
          <button class="btn btn-sm ${S._printedCard?.[o._id]?'btn-green':'btn-outline'}"
            data-print-card="${o._id}"
            title="Imprimir Cartão"
            style="display:flex;align-items:center;gap:4px;">
            🖨️ Cartão ${S._printedCard?.[o._id]?'<span style=\"font-size:10px\">(✅ Impresso)</span>':''}
          </button>
          <button class="btn btn-sm ${S._printedComanda?.[o._id]?'btn-green':'btn-outline'}"
            data-print-comanda="${o._id}"
            title="Imprimir Comanda de Entrega"
            style="display:flex;align-items:center;gap:4px;">
            🖨️ Comanda ${S._printedComanda?.[o._id]?'<span style=\"font-size:10px\">(✅ Impresso)</span>':''}
          </button>
        </div>

        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <select class="fi" id="exp-driver-${o._id}" style="flex:1;min-width:160px;padding:6px 10px;font-size:12px;">
            <option value="">⚠️ Escolher entregador *</option>
            ${entregadores.map(u=>`<option value="${u.id}" data-name="${u.name}">${u.name}${u.fonte==='colab'?' 📋':''}</option>`).join('')}
          </select>
          <button class="btn btn-primary btn-sm" data-expedir="${o._id}">🚚 Expedir</button>
        </div>
      </div>`).join('')}
    </div>
  </div>

  <div>
    <div class="card">
      <div class="card-title">🚚 Em Rota
        <span class="notif">${emRota.length}</span>
      </div>
      ${emRota.length===0?`<div class="empty"><p>Nenhum pedido em rota</p></div>`:''}
      ${emRota.map(o=>`
      <div style="background:var(--purple-l);border-radius:var(--r);padding:12px;margin-bottom:8px;border:1px solid rgba(124,58,237,.2);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <span style="font-weight:700;color:var(--rose)">${o.orderNumber}</span>
          <div style="display:flex;gap:6px;align-items:center;">
            ${o.driverName?`<span style="background:var(--blue);color:#fff;border-radius:20px;padding:2px 10px;font-size:11px;font-weight:600;">🚚 ${o.driverName}</span>`:''}
            <span class="tag t-purple">Em Rota</span>
          </div>
        </div>
        <div style="font-size:12px;font-weight:500">${o.client?.name||o.clientName||'—'}</div>
        ${o.recipient?`<div style="font-size:11px;color:var(--muted)">Para: ${o.recipient}</div>`:''}
        <div style="font-size:11px;color:var(--muted);margin-bottom:8px;">📍 ${o.deliveryAddress||'—'}</div>
        <div style="font-size:11px;margin-bottom:8px;"><strong>Itens:</strong> ${(o.items||[]).map(i=>`${i.qty}x ${i.name}`).join(', ')}</div>
        ${o.payment==='Pagar na Entrega'?`<div style="background:var(--gold-l);border-radius:6px;padding:6px 10px;font-size:11px;font-weight:700;color:var(--gold);margin-bottom:8px;">💰 COBRAR: ${$c(o.total)} — ${o.paymentOnDelivery||'Ver forma'}</div>`:''}
        <div style="display:flex;gap:6px;">
          <button class="btn btn-green btn-sm" data-open-confirm="${o._id}">✅ Confirmar Entrega</button>
          <a href="https://www.google.com/maps/dir/?api=1&origin=-3.0379889,-59.9516336&destination=${encodeURIComponent(o.deliveryAddress||'')}" target="_blank" class="btn btn-blue btn-sm">🗺️ Rota</a>
        </div>
      </div>`).join('')}
    </div>
  </div>
</div>`}`;
}


// ── MODAL CONFIRMAR ENTREGA ────────────────────────────────────
export async function showConfirmDeliveryModal(orderId){
  const o = S.orders.find(x=>x._id===orderId);
  if(!o) return;
  S._modal=`<div class="mo" id="mo"><div class="mo-box" style="max-width:480px;" onclick="event.stopPropagation()">
  <div class="mo-title">✅ Confirmar Entrega — ${o.orderNumber}</div>

  <div style="background:var(--cream);border-radius:var(--r);padding:12px;margin-bottom:14px;font-size:12px;">
    <div style="font-weight:600;margin-bottom:4px;">📦 ${(o.items||[]).map(i=>`${i.qty}x ${i.name}`).join(', ')}</div>
    <div style="color:var(--muted);">👤 Para: ${o.recipient||o.client?.name||o.clientName||'—'}</div>
    <div style="color:var(--muted);">📍 ${o.deliveryAddress||'—'}</div>
    ${o.payment==='Pagar na Entrega'?`<div style="color:var(--gold);font-weight:600;margin-top:6px;">💰 Cobrar ${$c(o.total)} — ${o.paymentOnDelivery||'Verificar forma'}</div>`:''}
  </div>

  <div class="fg">
    <label class="fl">Quem recebeu? <span style="color:var(--red)">*</span></label>
    <input class="fi" id="conf-receiver" placeholder="Nome de quem assinou / recebeu o pedido" autocomplete="off"/>
    <div style="font-size:10px;color:var(--muted);margin-top:3px;">Obrigatório — anote o nome de quem recebeu na porta</div>
  </div>

  <div class="fg">
    <label class="fl">📷 Foto da entrega <span style="font-size:10px;color:var(--muted)">(opcional)</span></label>
    <div style="border:2px dashed var(--border);border-radius:var(--r);padding:16px;text-align:center;cursor:pointer;transition:all .2s;" id="photo-drop-zone" onclick="document.getElementById('conf-photo-input').click()">
      <div id="photo-preview-wrap">
        <div style="font-size:28px;margin-bottom:6px;">📷</div>
        <div style="font-size:12px;color:var(--muted);">Toque para tirar foto ou escolher da galeria</div>
      </div>
    </div>
    <input type="file" id="conf-photo-input" accept="image/*" capture="environment" style="display:none"/>
  </div>

  <div class="mo-foot">
    <button class="btn btn-green" id="btn-do-confirm" style="flex:1;justify-content:center;padding:11px;font-size:14px;">
      ✅ Confirmar Entrega
    </button>
    <button class="btn btn-ghost" id="btn-mo-close">Cancelar</button>
  </div>
  </div></div>`;
  await render();

  document.getElementById('btn-mo-close')?.addEventListener('click',()=>{S._modal='';render();});

  // Preview da foto
  let photoBase64 = '';
  document.getElementById('conf-photo-input')?.addEventListener('change',e=>{
    const file = e.target.files?.[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = ev=>{
      photoBase64 = ev.target.result;
      const wrap = document.getElementById('photo-preview-wrap');
      if(wrap) wrap.innerHTML=`<img src="${photoBase64}" style="max-width:100%;max-height:200px;border-radius:8px;object-fit:contain;"/>
        <div style="font-size:11px;color:var(--leaf);margin-top:6px;">✅ Foto adicionada — toque para trocar</div>`;
      const zone = document.getElementById('photo-drop-zone');
      if(zone){ zone.style.borderColor='var(--leaf)'; zone.style.background='var(--leaf-l)'; }
    };
    reader.readAsDataURL(file);
  });

  // Confirmar
  document.getElementById('btn-do-confirm')?.addEventListener('click',async()=>{
    const receiver = document.getElementById('conf-receiver')?.value?.trim();
    if(!receiver){
      document.getElementById('conf-receiver').style.borderColor='var(--red)';
      document.getElementById('conf-receiver').focus();
      toast('❌ Informe quem recebeu o pedido', true);
      return;
    }
    // Salva confirmacao localmente (quem recebeu + foto)
    const confirmations = JSON.parse(localStorage.getItem('fv_deliveries')||'{}');
    confirmations[orderId] = { receiver, photo: photoBase64||null, confirmedAt: new Date().toISOString(), confirmedBy: S.user.name };
    localStorage.setItem('fv_deliveries', JSON.stringify(confirmations));

    S._modal=''; render();
    const { advanceOrder } = await import('./pedidos.js');
    await advanceOrder(orderId);
    toast('✅ Entrega confirmada! Recebido por: '+receiver);
  });
}

// ── BIND EVENTS (chamado pelo app.js após render) ─────────────
export function bindExpedicaoEvents(){
  // Filtro de data
  {const _el=document.getElementById('btn-exp-today');if(_el)_el.onclick=()=>{
    S._expDate='';render();
  };}
  document.getElementById('exp-date-picker')?.addEventListener('change',e=>{
    S._expDate=e.target.value;render();
  });

  // Atualizar pedidos
  {const _el=document.getElementById('btn-rel-orders');if(_el)_el.onclick=async()=>{
    const { GET:get } = await import('../services/api.js');
    S.loading=true;render();S.orders=await get('/orders');S.loading=false;render();
  };}

  // Imprimir Cartao e Comanda na Expedicao
  document.querySelectorAll('[data-print-card]').forEach(b=>{b.onclick=()=>printCard(b.dataset.printCard);});
  document.querySelectorAll('[data-print-comanda]').forEach(b=>{b.onclick=()=>printComanda(b.dataset.printComanda);});

  // Botao Expedir — salva todos os identificadores do entregador
  document.querySelectorAll('[data-expedir]').forEach(b=>{b.onclick=async()=>{
    const orderId = b.dataset.expedir;
    const driverSelect = document.getElementById('exp-driver-'+orderId);
    const driverId = driverSelect?.value;
    if(!driverId){
      toast('⚠️ Selecione um entregador antes de expedir!',true);
      if(driverSelect){driverSelect.style.border='2px solid var(--red)';setTimeout(()=>{driverSelect.style.border='';},2000);}
      return;
    }
    // Busca entregador em backend users E colaboradores locais
    const allDrivers = getEntregadores();
    const driver = allDrivers.find(u=>u.id===driverId || u._id===driverId);
    const driverName = driver?.name || driverSelect?.selectedOptions?.[0]?.dataset?.name || '';

    // Tambem pega o backendId se for colaborador local
    const colabDriver = getColabs().find(c=>c.id===driverId);
    const driverBackendId = colabDriver?.backendId || null;
    const driverEmail     = colabDriver?.email     || null;

    // Payload com todos os identificadores para garantir match no filtro
    const payload = {
      status:'Saiu p/ entrega',
      driverId,
      driverName,
      ...(driverBackendId ? {driverBackendId} : {}),
      ...(driverEmail     ? {driverEmail}     : {}),
    };

    try{
      await PATCH('/orders/'+orderId+'/status', payload);
      // Tenta tambem salvar driverName diretamente no documento do pedido
      // para garantir que o Painel TV e outros clientes vejam o entregador
      if(driverName){
        PATCH('/orders/'+orderId, {driverName, driverId}).catch(()=>{});
      }
      // Salva atribuicao localmente para garantir persistencia mesmo se o backend nao retornar os campos
      saveDriverAssignment(orderId, payload);
      S.orders=S.orders.map(o=>o._id===orderId?{...o,...payload}:o);
      const expedOrder = S.orders.find(o=>o._id===orderId);
      if(expedOrder) logActivity('expedicao', expedOrder);
      render();
      toast('🚚 Pedido expedido para '+driverName+'!');
    }catch(e){ toast('❌ Erro ao expedir: '+(e.message||''), true); }
  }});

  // Confirmar entrega (Em Rota -> Entregue)
  document.querySelectorAll('[data-open-confirm]').forEach(b=>{b.onclick=()=>showConfirmDeliveryModal(b.dataset.openConfirm);});
  document.querySelectorAll('[data-confirm]').forEach(b=>{b.onclick=()=>showConfirmDeliveryModal(b.dataset.confirm);});

  {const _el=document.getElementById('btn-save-msg');if(_el)_el.onclick=()=>{
    const msg=document.getElementById('delivery-msg-template')?.value;
    if(msg){localStorage.setItem('fv_delivery_msg',msg);toast('✅ Mensagem salva!');}
  };}

  // Busca de pedidos — debounce para nao perder foco ao digitar
  const _si = document.getElementById('order-search-input');
  if(_si){
    let _searchTimer=null;
    _si.addEventListener('input', e=>{
      S._orderSearch=e.target.value;
      clearTimeout(_searchTimer);
      _searchTimer=setTimeout(()=>{ render(); setTimeout(()=>{ const el=document.getElementById('order-search-input'); if(el){el.focus();el.setSelectionRange(el.value.length,el.value.length);} },10); }, 300);
    });
    _si.addEventListener('keydown', e=>{ if(e.key==='Escape'){S._orderSearch='';render();} if(e.key==='Enter'){clearTimeout(_searchTimer);render();} });
  }
  {const _el=document.getElementById('order-search-clear');if(_el)_el.onclick=()=>{S._orderSearch='';render();};}
}
