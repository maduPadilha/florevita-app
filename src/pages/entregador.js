import { S } from '../state.js';
import { $c, $d, sc, ini, esc, fmtOrderNum } from '../utils/formatters.js';
import { PATCH } from '../services/api.js';
import { toast } from '../utils/helpers.js';
import { findColab, _isEntregador } from '../services/auth.js';
import { saveDriverAssignment, mergeDriverAssignments } from '../services/cache.js';

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

// ── Helper: registrarReceitaVenda via dynamic import ──────────
async function registrarReceitaVenda(o){
  try{
    const mod = await import('./financeiro.js');
    if(typeof mod.registrarReceitaVenda === 'function') mod.registrarReceitaVenda(o);
  }catch(e){ console.warn('registrarReceitaVenda:', e); }
}

// ── DELIVERY HELPERS ────────────────────────────────────────
function getDeliveryRisk(order) {
  if (!order.scheduledDate && !order.scheduledTime) return 'none';
  const now = new Date();
  const delivDate = new Date(order.scheduledDate || now);
  const [h, m] = (order.scheduledTime || '23:59').split(':').map(Number);
  delivDate.setHours(h || 23, m || 59, 0, 0);
  const diffMin = (delivDate - now) / 60000;
  if (diffMin < 0) return 'late';
  if (diffMin < 60) return 'critical';
  if (diffMin < 120) return 'warning';
  return 'ok';
}

function sortOrdersByPriority(orders) {
  // 1ª prioridade: ordem definida pela expedição (deliveryOrder)
  // 2ª prioridade: risco de atraso, turno e horário (fallback)
  const hasExpedOrder = orders.some(o => typeof o.deliveryOrder === 'number');
  if(hasExpedOrder){
    return [...orders].sort((a,b) => {
      const oa = (typeof a.deliveryOrder === 'number') ? a.deliveryOrder : 999;
      const ob = (typeof b.deliveryOrder === 'number') ? b.deliveryOrder : 999;
      return oa - ob;
    });
  }
  const riskWeight = {late:0, critical:1, warning:2, ok:3, none:4};
  const periodWeight = {'Manhã':0,'Tarde':1,'Noite':2};
  return [...orders].sort((a, b) => {
    const ra = getDeliveryRisk(a), rb = getDeliveryRisk(b);
    if (riskWeight[ra] !== riskWeight[rb]) return riskWeight[ra] - riskWeight[rb];
    const pa = periodWeight[a.scheduledPeriod] ?? 99;
    const pb = periodWeight[b.scheduledPeriod] ?? 99;
    if (pa !== pb) return pa - pb;
    const ta = a.scheduledTime || '99:99', tb = b.scheduledTime || '99:99';
    return ta.localeCompare(tb);
  });
}

// ── APP EXCLUSIVO DO ENTREGADOR (sem menu, sem modulos) ───────
export function renderAppEntregador(){
  const myEmail     = (S.user?.email||'').trim().toLowerCase();
  const myName      = (S.user?.name||'').trim().toLowerCase();
  const myFirstName = myName.split(' ')[0];
  const myIds       = new Set([S.user?._id,S.user?.id,S.user?.colabId].filter(Boolean));
  const colab = findColab(myEmail) || findColab(S.user?._id);
  if(colab){ [colab.id,colab.backendId].forEach(id=>{ if(id) myIds.add(id); }); }

  function isMinha(o){
    if(!o||o.status!=='Saiu p/ entrega') return false;
    if(o.driverId&&myIds.has(o.driverId)) return true;
    if(o.driverBackendId&&myIds.has(o.driverBackendId)) return true;
    if(o.driverEmail&&myEmail&&o.driverEmail.toLowerCase()===myEmail) return true;
    const dn=(o.driverName||'').trim().toLowerCase();
    if(!dn) return false;
    if(dn===myName) return true;
    if(myFirstName.length>=3&&dn.includes(myFirstName)) return true;
    if(myFirstName.length>=3&&myName.includes(dn)) return true;
    return false;
  }

  const emRota = S.orders.filter(o=>o.status==='Saiu p/ entrega');
  const minhas = sortOrdersByPriority(emRota.filter(isMinha));
  const nome   = S.user?.name?.split(' ')[0]||'Entregador';
  const urgente= minhas.some(o=>['late','critical'].includes(getDeliveryRisk(o)));
  const diagDrivers = emRota.length>0&&minhas.length===0
    ? [...new Set(emRota.map(o=>o.driverName||o.driverId||'?').filter(Boolean))].join(', ')
    : '';

  // ── ENTREGAS CONCLUIDAS HOJE (fuso Manaus) ─────────────────
  // Reusa isMinha mas aceita status 'Entregue' tambem — filtro de data
  // baseado em updatedAt (quando virou Entregue).
  function isMinhaEntregueHoje(o){
    if(!o || o.status !== 'Entregue') return false;
    // Mesmo match de driver (inline, pq isMinha exige 'Saiu p/ entrega')
    let matchDriver = false;
    if(o.driverId && myIds.has(o.driverId)) matchDriver = true;
    else if(o.driverBackendId && myIds.has(o.driverBackendId)) matchDriver = true;
    else if(o.driverEmail && myEmail && o.driverEmail.toLowerCase() === myEmail) matchDriver = true;
    else {
      const dn=(o.driverName||'').trim().toLowerCase();
      if(dn === myName) matchDriver = true;
      else if(myFirstName.length >= 3 && dn.includes(myFirstName)) matchDriver = true;
      else if(myFirstName.length >= 3 && myName.includes(dn)) matchDriver = true;
    }
    if(!matchDriver) return false;
    // Entregue hoje? compara data de updatedAt com hoje em Manaus
    const updatedAt = o.updatedAt || o.deliveredAt || o.createdAt;
    if(!updatedAt) return false;
    const d = new Date(updatedAt);
    const hoje = new Date();
    const hojeStr = hoje.toLocaleDateString('sv-SE', { timeZone: 'America/Manaus' });
    const dStr = d.toLocaleDateString('sv-SE', { timeZone: 'America/Manaus' });
    return dStr === hojeStr;
  }

  const entreguesHoje = S.orders.filter(isMinhaEntregueHoje);
  const totalEntregasHoje = entreguesHoje.length;
  // Valor total a receber = soma das taxas de entrega dos pedidos do dia
  // (definido no PDV via Zona/Bairro — campo deliveryFee)
  const totalReceberHoje = entreguesHoje.reduce((s, o) =>
    s + (Number(o.deliveryFee || o.taxaEntrega || 0)), 0
  );
  const fmtBR = (v) => 'R$ ' + Number(v).toFixed(2).replace('.', ',');

  return `
<div style="min-height:100vh;background:#0D0D0D;">
  <div style="position:sticky;top:0;z-index:50;background:rgba(13,13,13,.97);
    border-bottom:1px solid rgba(232,145,122,.2);padding:12px 16px;">
    <div style="display:flex;align-items:center;justify-content:space-between;max-width:500px;margin:0 auto;">
      <div style="display:flex;align-items:center;gap:10px;">
        <div class="av" style="width:38px;height:38px;font-size:14px;background:#C8736A;flex-shrink:0;">${ini(S.user?.name||'?')}</div>
        <div>
          <div style="font-size:14px;font-weight:700;color:#F5C0B5">Ola, ${nome}! 🌸</div>
          <div style="font-size:11px;color:rgba(245,192,181,.5)">
            ${minhas.length===0?(S.orders.length===0?'🔄 Carregando...':'Nenhuma entrega designada'):`<span style="color:#4ADE80;font-weight:600">${minhas.length}</span> entrega(s) para voce`}
          </div>
        </div>
      </div>
      <div style="display:flex;gap:6px;">
        <button id="btn-refresh-rota" style="background:rgba(232,145,122,.15);border:1px solid rgba(232,145,122,.3);color:#E8917A;border-radius:8px;padding:7px 12px;font-size:13px;cursor:pointer;">🔄</button>
        <button id="btn-logout" style="background:transparent;border:1px solid rgba(255,255,255,.15);color:rgba(255,255,255,.5);border-radius:8px;padding:7px 10px;font-size:11px;cursor:pointer;">Sair</button>
      </div>
    </div>
  </div>

  <div style="max-width:500px;margin:0 auto;padding:14px;">
    ${urgente?`<div style="background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.4);color:#FCA5A5;border-radius:10px;padding:10px 14px;margin-bottom:12px;font-size:13px;font-weight:600;display:flex;align-items:center;gap:8px;">🚨 Ha entrega(s) com risco de atraso!</div>`:''}

    ${minhas.length > 0 ? `
    <button id="btn-rota-completa" style="width:100%;background:linear-gradient(135deg,#4F46E5,#7C3AED);color:#fff;border:none;padding:14px;border-radius:12px;font-size:14px;font-weight:800;cursor:pointer;margin-bottom:12px;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 4px 14px rgba(124,58,237,.35);">
      🗺️ Formar rota com TODAS as entregas (${minhas.length})
    </button>` : ''}

    ${minhas.length===0?`
    <div style="text-align:center;padding:50px 20px;">
      <div style="font-size:50px;margin-bottom:12px">${S.orders.length===0?'🔄':'✅'}</div>
      <div style="font-size:17px;font-weight:700;color:#F5C0B5;margin-bottom:8px;">${S.orders.length===0?'Carregando entregas...':'Sem entregas designadas'}</div>
      <div style="font-size:12px;color:rgba(245,192,181,.4);line-height:1.6;margin-bottom:16px;">${S.orders.length===0?'Conectando ao servidor...':'As entregas aparecem aqui quando a Expedicao atribuir pedidos ao seu nome.'}</div>
      ${diagDrivers?`<div style="margin-top:8px;padding:10px;background:rgba(255,255,255,.05);border-radius:8px;font-size:11px;color:rgba(255,255,255,.4);text-align:left;">
        📋 Em rota: ${emRota.length} pedido(s)<br>Entregadores: ${diagDrivers}<br>Seu nome: <strong style="color:#E8917A">${S.user?.name}</strong></div>`:''}
      <button id="btn-refresh-rota2" style="background:#C8736A;color:#fff;border:none;border-radius:10px;padding:12px 24px;font-size:13px;font-weight:700;cursor:pointer;margin-top:12px;">🔄 Atualizar Agora</button>
    </div>`
    :minhas.map((o,idx)=>{
      const risk=getDeliveryRisk(o);
      const isUrg=risk==='late'||risk==='critical';
      const addr=encodeURIComponent(o.deliveryAddress||'');
      return `<div style="background:#fff;border-radius:14px;margin-bottom:14px;overflow:hidden;border:2px solid ${isUrg?'#EF4444':'#EDE0DC'};box-shadow:0 2px 12px rgba(0,0,0,.15);">
  <div style="background:${isUrg?'#FEF2F2':'#FDF8F6'};padding:12px 14px;border-bottom:1px solid ${isUrg?'#FECACA':'#EDE0DC'};display:flex;align-items:center;justify-content:space-between;">
    <div style="display:flex;align-items:center;gap:10px;">
      <div style="background:${isUrg?'#EF4444':'#C8736A'};color:#fff;border-radius:50%;width:30px;height:30px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;flex-shrink:0;">${idx+1}</div>
      <div>
        <div style="font-weight:800;font-size:15px;color:${isUrg?'#991B1B':'#C8736A'}">${fmtOrderNum(o)}</div>
        <div style="font-size:10px;color:#9E8070">${o.scheduledPeriod||''} ${o.scheduledDate?'· '+$d(o.scheduledDate):''}</div>
      </div>
    </div>
    ${isUrg?`<span style="background:#EF4444;color:#fff;border-radius:20px;padding:3px 10px;font-size:10px;font-weight:700;">${risk==='late'?'🚨 ATRASADO':'⚠️ URGENTE'}</span>`:'<span style="font-size:18px">🌸</span>'}
  </div>
  <div style="padding:14px;">
    ${(o.items||[]).map(i=>{const p=S.products.find(pr=>pr.name===i.name||pr._id===i.product);return`<div style="display:flex;align-items:center;gap:10px;padding:8px;background:#FDF8F6;border-radius:8px;margin-bottom:6px;">${p?.images?.[0]?`<img src="${p.images[0]}" style="width:44px;height:44px;border-radius:8px;object-fit:contain;background:#fff;flex-shrink:0;">` :`<div style="width:44px;height:44px;border-radius:8px;background:#FAE8E6;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">🌸</div>`}<div style="font-weight:700;font-size:13px">${i.qty}x ${i.name}</div></div>`;}).join('')}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 0;">
      <div style="background:#FDF8F6;border-radius:10px;padding:10px;">
        <div style="font-size:9px;font-weight:700;color:#9E8070;text-transform:uppercase;letter-spacing:1px;margin-bottom:3px;">Para</div>
        <div style="font-size:14px;font-weight:700">${o.recipient||o.clientName||'—'}</div>
      </div>
      <div style="background:#FDF8F6;border-radius:10px;padding:10px;">
        <div style="font-size:9px;font-weight:700;color:#9E8070;text-transform:uppercase;letter-spacing:1px;margin-bottom:3px;">Horario</div>
        <div style="font-size:14px;font-weight:700">${o.scheduledTime||o.scheduledPeriod||'—'}</div>
      </div>
    </div>
    ${(()=>{
      const rawPhone = (o.clientPhone || o.client?.phone || o.client?.telefone || '').replace(/\D/g,'');
      if(!rawPhone) return '';
      const last6 = rawPhone.slice(-6);
      return `<div style="background:#EEF2FF;border:1.5px dashed #6366F1;border-radius:10px;padding:10px 12px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <div>
          <div style="font-size:9px;font-weight:700;color:#4338CA;text-transform:uppercase;letter-spacing:.5px;">📱 Contato do comprador</div>
          <div style="font-size:14px;font-weight:800;color:#1E1B4B;margin-top:2px;">Final: <span style="font-family:monospace;letter-spacing:1px;">${last6}</span></div>
          <div style="font-size:10px;color:#6366F1;margin-top:2px;">Use ao pedir ajuda ou para conferência</div>
        </div>
      </div>`;
    })()}
    <div style="background:#EEF2FF;border-radius:10px;padding:12px;margin-bottom:12px;border:1px solid #C7D2FE;">
      <div style="font-size:9px;font-weight:700;color:#4338CA;text-transform:uppercase;letter-spacing:1px;margin-bottom:5px;">📍 Endereco</div>
      <div style="font-size:13px;font-weight:600;color:#1E1B4B;margin-bottom:3px;">${o.deliveryAddress||'Nao informado'}</div>
      ${o.condName?`<div style="font-size:11px;color:#4338CA;">🏢 ${o.condName}${o.block?` Bl.${o.block}`:''}${o.apt?` Ap.${o.apt}`:''}</div>`:''}
      ${o.reference?`<div style="font-size:11px;color:#6366F1;">Ref: ${o.reference}</div>`:''}
      <a href="https://www.google.com/maps/dir/?api=1&origin=-3.0379889,-59.9516336&destination=${addr}" target="_blank"
        style="display:flex;align-items:center;justify-content:center;gap:8px;margin-top:10px;background:#4F46E5;color:#fff;padding:10px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:700;">
        🗺️ Iniciar Rota
      </a>
    </div>
    ${(()=>{
      const msg = o.cardMessage || o.mensagemCartao || o.cartao || o.cardMsg || '';
      const anonimo = o.identifyClient === false;
      const remetente = (!anonimo) ? (o.client?.name || o.clientName || '') : '';
      if(!msg && !remetente) return '';
      return `<div style="background:#FDF4F0;border:2px solid #C8736A;border-radius:10px;padding:12px;margin-bottom:12px;">
        <div style="font-size:10px;font-weight:800;color:#C8736A;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">💌 Cartão da entrega</div>
        ${msg?`<div style="font-size:13px;font-style:italic;color:#4A2018;line-height:1.4;margin-bottom:6px;">"${msg}"</div>`:'<div style="font-size:11px;color:#9E8070;font-style:italic;margin-bottom:6px;">(sem mensagem)</div>'}
        <div style="font-size:11px;color:#7C2D12;font-weight:700;border-top:1px dashed #E8C5B8;padding-top:6px;">
          ${anonimo ? '👤 Anônimo — <em>não dizer quem enviou</em>' : (remetente ? `De: <strong>${remetente}</strong>` : '')}
        </div>
      </div>`;
    })()}
    ${o.payment==='Pagar na Entrega'?`<div style="background:#FFFBEB;border:2px solid #F59E0B;border-radius:10px;padding:12px;margin-bottom:12px;"><div style="font-size:11px;font-weight:700;color:#92400E;">💰 COBRAR NA ENTREGA</div><div style="font-size:22px;font-weight:800;color:#D97706;margin:4px 0">${$c(o.total)}</div><div style="font-size:12px;color:#78350F">${o.paymentOnDelivery==='Dinheiro'?'💵 Dinheiro':o.paymentOnDelivery==='Levar Maquineta'?'💳 Maquineta':'⚠️ Verificar'}</div></div>`:''}
    <div style="display:flex;gap:8px;align-items:stretch;margin-bottom:8px;">
      <button class="btn btn-blue" data-rota="${o._id}"
        style="flex:1;background:#1E40AF;color:#fff;padding:12px 14px;border:none;border-radius:12px;font-weight:700;font-size:14px;display:flex;align-items:center;justify-content:center;gap:6px;cursor:pointer;min-height:48px;">
        🗺️ Rotas
      </button>
      <button type="button" onclick="showConfirmDeliveryModal('${o._id}')"
        style="flex:1.4;background:#3A7D44;color:#fff;border:none;border-radius:12px;padding:12px 14px;font-size:14px;font-weight:700;cursor:pointer;min-height:48px;">
        ✅ Confirmar Entrega
      </button>
    </div>
    <button type="button" data-help="${o._id}"
      style="width:100%;background:#FEF3C7;border:1.5px solid #F59E0B;color:#92400E;border-radius:10px;padding:10px;font-size:12px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;">
      🆘 Preciso de ajuda nesta entrega
    </button>
  </div>
</div>`;
    }).join('')}

    <!-- ── RESUMO DO DIA (entregas concluidas + valor a receber) ── -->
    ${totalEntregasHoje > 0 ? `
    <div style="margin-top:20px;background:linear-gradient(135deg,#064E3B,#047857);border:2px solid #10B981;border-radius:16px;padding:18px 20px;box-shadow:0 4px 16px rgba(16,185,129,.25);">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
        <span style="font-size:28px;">🏆</span>
        <div>
          <div style="font-size:11px;color:rgba(255,255,255,.7);text-transform:uppercase;letter-spacing:1px;font-weight:700;">Resumo do Dia</div>
          <div style="font-size:15px;color:#fff;font-weight:800;">Suas entregas concluídas hoje</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div style="background:rgba(255,255,255,.1);border-radius:12px;padding:14px;text-align:center;">
          <div style="font-size:10px;color:rgba(255,255,255,.7);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">Entregues</div>
          <div style="font-size:36px;font-weight:900;color:#fff;line-height:1;">${totalEntregasHoje}</div>
          <div style="font-size:10px;color:rgba(255,255,255,.6);margin-top:4px;">entrega${totalEntregasHoje>1?'s':''}</div>
        </div>
        <div style="background:rgba(255,255,255,.15);border-radius:12px;padding:14px;text-align:center;border:2px solid rgba(252,211,77,.5);">
          <div style="font-size:10px;color:rgba(252,211,77,1);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;font-weight:800;">A Receber</div>
          <div style="font-size:24px;font-weight:900;color:#FCD34D;line-height:1.1;">${fmtBR(totalReceberHoje)}</div>
          <div style="font-size:9px;color:rgba(255,255,255,.5);margin-top:4px;">Taxas de entrega</div>
        </div>
      </div>

      <div style="margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,.15);font-size:11px;color:rgba(255,255,255,.6);text-align:center;">
        💚 Parabéns pelo seu trabalho de hoje, ${nome}!
      </div>
    </div>
    ` : ''}
  </div>
</div>
${S.toast?`<div class="toast" style="${S.toast.err?'background:var(--red)':''}">${S.toast.msg}</div>`:''}
${S.loading?`<div class="loading"><div class="spin"></div></div>`:''}
`;
}


// ── SMART ROUTE: GPS + Google Maps ───────────────────────────
export function abrirRota(orderId){
  const o = S.orders.find(x => x._id === orderId);
  if(!o){ toast('❌ Pedido não encontrado', true); return; }

  // Build destination address
  const endereco = o.deliveryAddress
    || [o.deliveryStreet, o.deliveryNumber, o.deliveryNeighborhood, o.deliveryCity||'Manaus', 'AM']
        .filter(Boolean).join(', ')
    || [o.endereco?.rua, o.endereco?.numero, o.endereco?.bairro, o.endereco?.cidade||'Manaus', 'AM']
        .filter(Boolean).join(', ');

  if(!endereco || endereco.trim() === 'Manaus, AM'){
    toast('❌ Endereço de entrega não disponível', true);
    return;
  }

  toast('📍 Obtendo sua localização...');

  // Helper: paint button orange when GPS denied/unavailable
  function markBtnOrange(){
    try{
      document.querySelectorAll(`[data-rota="${orderId}"]`).forEach(b=>{
        b.style.background = '#EA580C';
        b.title = 'GPS indisponível — abrindo sem origem';
      });
    }catch(_){}
  }

  // Fallback: sem geolocation API — parte do endereço da floricultura
  if(!navigator.geolocation){
    const url = 'https://www.google.com/maps/dir/?api=1&origin=' + encodeURIComponent('R. Galiléia, 42 - Novo Aleixo, Manaus - AM, 69098-026') + '&destination=' + encodeURIComponent(endereco);
    window.open(url, '_blank');
    return;
  }

  // Origem padrão: endereço da floricultura (caso GPS falhe)
  const ORIGEM_FALLBACK = 'R. Galiléia, 42 - Novo Aleixo, Manaus - AM, 69098-026';

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const origin = pos.coords.latitude + ',' + pos.coords.longitude;
      const url = 'https://www.google.com/maps/dir/?api=1&origin=' + origin + '&destination=' + encodeURIComponent(endereco) + '&travelmode=driving';
      window.open(url, '_blank');
      toast('🗺️ Abrindo rota no Google Maps...');
    },
    (err) => {
      // GPS falhou — usa endereço da floricultura como origem
      console.warn('GPS error:', err);
      const url = 'https://www.google.com/maps/dir/?api=1&origin=' + encodeURIComponent(ORIGEM_FALLBACK) + '&destination=' + encodeURIComponent(endereco) + '&travelmode=driving';
      window.open(url, '_blank');
      if(err.code === 1){
        toast('⚠️ GPS negado. Partindo da floricultura.', true);
      } else {
        toast('⚠️ GPS indisponível. Partindo da floricultura.', true);
      }
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
  );
}

// Expor globalmente para handlers inline
if(typeof window !== 'undefined') window.abrirRota = abrirRota;

// ── BIND: smart route buttons (called after render) ───────────
export function bindRotaButtons(){
  document.querySelectorAll('[data-rota]').forEach(b=>{
    if(b._rotaBound) return;
    b._rotaBound = true;
    b.addEventListener('click', () => abrirRota(b.dataset.rota));
  });
  // Botão "Preciso de ajuda" — WhatsApp para a floricultura
  document.querySelectorAll('[data-help]').forEach(b=>{
    if(b._helpBound) return;
    b._helpBound = true;
    b.addEventListener('click', () => pedirAjudaEntrega(b.dataset.help));
  });
  // Botão "Rota completa" (todas entregas)
  document.getElementById('btn-rota-completa')?.addEventListener('click', abrirRotaCompleta);
}

// ── PEDIR AJUDA: abre WhatsApp da loja com info do pedido ────
export function pedirAjudaEntrega(orderId){
  const o = S.orders.find(x => x._id === orderId);
  if(!o){ toast('Pedido não encontrado'); return; }

  // WhatsApp da loja (config) ou fallback
  const cfg = JSON.parse(localStorage.getItem('fv_config')||'{}');
  let lojaPhone = (cfg.whats || '5592993002433').replace(/\D/g,'');
  if(!lojaPhone.startsWith('55')) lojaPhone = '55' + lojaPhone;

  const endereco = o.deliveryAddress ||
    [o.deliveryStreet, o.deliveryNumber, o.deliveryNeighborhood, o.deliveryCity||'Manaus','AM']
    .filter(Boolean).join(', ') || 'Não informado';

  const destinatario = o.recipient || o.client?.name || o.clientName || '—';
  const recipPhone = o.recipientPhone || '';
  const entregador = S.user?.name || 'Entregador';
  const orderNum = o.orderNumber || o.numero || String(o._id||'').slice(-5);

  // Últimos 6 dígitos do telefone do comprador (não o destinatário)
  const rawBuyerPhone = (o.clientPhone || o.client?.phone || o.client?.telefone || '').replace(/\D/g,'');
  const buyerLast6 = rawBuyerPhone ? rawBuyerPhone.slice(-6) : '';

  const msg = [
    `🆘 *Preciso de ajuda com uma entrega*`,
    ``,
    `👤 *Entregador:* ${entregador}`,
    `📦 *Pedido:* #${orderNum}`,
    buyerLast6 ? `📱 *Tel. comprador (final):* ${buyerLast6}` : '',
    `🎁 *Destinatário:* ${destinatario}${recipPhone?` (${recipPhone})`:''}`,
    `📍 *Endereço:* ${endereco}`,
    o.condName ? `🏢 *Complemento:* ${o.condName}${o.block?' Bl.'+o.block:''}${o.apt?' Ap.'+o.apt:''}` : '',
    o.deliveryReference || o.reference ? `📌 *Referência:* ${o.deliveryReference || o.reference}` : '',
    ``,
    `_Descreva abaixo o problema que está enfrentando..._`,
  ].filter(Boolean).join('\n');

  const url = `https://wa.me/${lojaPhone}?text=${encodeURIComponent(msg)}`;
  window.open(url, '_blank');
  toast('💬 Abrindo WhatsApp da floricultura...');
}

// ── ROTA COMPLETA: Google Maps com todas as entregas designadas ────
// Origem fixa: R. Galiléia, 42 - Novo Aleixo, Manaus - AM, 69098-026
const ORIGEM_ROTA = 'R. Galiléia, 42 - Novo Aleixo, Manaus - AM, 69098-026';

// ── INTEGRACAO GOOGLE MAPS — rota multi-stop otimizada ──────
// Usa o URL scheme oficial do Google Maps (gratuito, sem API key).
// Formato:
//   https://www.google.com/maps/dir/?api=1
//     &origin=LAT,LNG                   (GPS atual ou endereco fallback)
//     &destination=<ultimo endereco>
//     &waypoints=optimize:true|A|B|C    (Google REORDENA automaticamente)
//     &travelmode=driving
//
// Google Maps URL scheme aceita ate 9 waypoints (10 paradas totais).
// Se houver mais, dividimos em chunks e abrimos multiplas rotas.
const MAX_WAYPOINTS = 9;  // limite do Google Maps URL scheme
const MAX_STOPS_PER_URL = MAX_WAYPOINTS + 1; // +1 destination

function enderecoPedido(o) {
  return o.deliveryAddress ||
    [o.deliveryStreet, o.deliveryNumber, o.deliveryNeighborhood, o.deliveryCity||'Manaus', 'AM']
      .filter(Boolean).join(', ');
}

// Monta URL do Google Maps para uma sequencia de paradas
// com optimize:true — o Google reordena automaticamente pelo menor trajeto
function montarUrlRotaOtimizada(origin, paradas) {
  if (!paradas.length) return null;
  const destino = paradas[paradas.length - 1];
  const waypoints = paradas.slice(0, -1);
  let url = `https://www.google.com/maps/dir/?api=1`
    + `&origin=${encodeURIComponent(origin)}`
    + `&destination=${encodeURIComponent(destino)}`
    + `&travelmode=driving`;
  if (waypoints.length > 0) {
    // optimize:true = Google reordena waypoints pela rota mais curta
    url += `&waypoints=optimize:true|${waypoints.map(w => encodeURIComponent(w)).join('|')}`;
  }
  return url;
}

// Coleta pedidos do entregador logado em "Saiu p/ entrega"
function minhasEntregas() {
  const myEmail = (S.user?.email||'').trim().toLowerCase();
  const myName  = (S.user?.name||'').trim().toLowerCase();
  const myFirst = myName.split(' ')[0];
  const myIds   = new Set([S.user?._id, S.user?.id, S.user?.colabId].filter(Boolean));

  return S.orders.filter(o => {
    if (o.status !== 'Saiu p/ entrega') return false;
    if (o.driverId && myIds.has(o.driverId)) return true;
    if (o.driverEmail && myEmail && o.driverEmail.toLowerCase() === myEmail) return true;
    const dn = (o.driverName||'').trim().toLowerCase();
    if (!dn) return false;
    if (dn === myName) return true;
    if (myFirst.length >= 3 && dn.includes(myFirst)) return true;
    return false;
  });
}

// Ordena usando (1) deliveryOrder da expedicao, (2) horario agendado,
// (3) urgencia. Google ainda vai re-otimizar via optimize:true — isso
// eh so um primeiro ordenamento para exibicao no modal.
function ordenarParaRota(pedidos) {
  return [...pedidos].sort((a, b) => {
    const oa = (typeof a.deliveryOrder === 'number') ? a.deliveryOrder : 999;
    const ob = (typeof b.deliveryOrder === 'number') ? b.deliveryOrder : 999;
    if (oa !== ob) return oa - ob;
    const ha = a.scheduledTime || '99:99';
    const hb = b.scheduledTime || '99:99';
    return ha.localeCompare(hb);
  });
}

// Abre a rota com preview: modal mostra ordem, tempo estimado, destinos.
// Entregador clica "Iniciar Rota" e abre Google Maps com optimize:true.
export function abrirRotaCompleta() {
  const minhas = minhasEntregas();
  if (minhas.length === 0) {
    toast('❌ Nenhuma entrega designada para você');
    return;
  }
  const ordered = ordenarParaRota(minhas);

  // Dispara o preview modal (que captura GPS e abre Google Maps no click)
  showRotaPreview(ordered);
}

// Modal de preview da rota
function showRotaPreview(ordered) {
  // Remove modal existente
  const existing = document.getElementById('rota-preview-modal');
  if (existing) existing.remove();

  const totalParadas = ordered.length;
  const precisaDividir = totalParadas > MAX_STOPS_PER_URL;
  const numRotas = Math.ceil(totalParadas / MAX_STOPS_PER_URL);

  const urgentes = ordered.filter(o => {
    const r = (typeof getDeliveryRisk === 'function') ? getDeliveryRisk(o) : 'ok';
    return r === 'late' || r === 'critical';
  }).length;

  const modal = document.createElement('div');
  modal.id = 'rota-preview-modal';
  modal.style.cssText = `
    position:fixed;inset:0;z-index:10000;
    background:rgba(0,0,0,.85);
    display:flex;align-items:center;justify-content:center;
    padding:16px;
  `;

  modal.innerHTML = `
    <div style="background:#0D0D0D;border:1px solid rgba(232,145,122,.35);border-radius:16px;max-width:500px;width:100%;max-height:92vh;overflow-y:auto;color:#F5C0B5;">

      <!-- Header -->
      <div style="padding:16px;border-bottom:1px solid rgba(232,145,122,.25);display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-size:17px;font-weight:800;">🗺️ Rota Otimizada</div>
          <div style="font-size:11px;color:rgba(245,192,181,.55);">Google Maps vai reorganizar pela menor distância</div>
        </div>
        <button id="rota-close" style="background:none;border:none;color:rgba(245,192,181,.6);font-size:24px;cursor:pointer;line-height:1;">×</button>
      </div>

      <!-- KPIs -->
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:14px;">
        <div style="background:rgba(124,58,237,.18);border:1px solid rgba(124,58,237,.4);border-radius:10px;padding:10px;text-align:center;">
          <div style="font-size:22px;font-weight:800;color:#A78BFA;">${totalParadas}</div>
          <div style="font-size:10px;color:rgba(245,192,181,.6);">entregas</div>
        </div>
        <div style="background:rgba(234,88,12,.15);border:1px solid rgba(234,88,12,.4);border-radius:10px;padding:10px;text-align:center;">
          <div style="font-size:22px;font-weight:800;color:#FB923C;">${urgentes}</div>
          <div style="font-size:10px;color:rgba(245,192,181,.6);">urgentes</div>
        </div>
        <div style="background:rgba(74,222,128,.15);border:1px solid rgba(74,222,128,.4);border-radius:10px;padding:10px;text-align:center;">
          <div style="font-size:22px;font-weight:800;color:#4ADE80;">${numRotas}</div>
          <div style="font-size:10px;color:rgba(245,192,181,.6);">rota${numRotas>1?'s':''}</div>
        </div>
      </div>

      ${precisaDividir ? `
        <div style="margin:0 14px 10px;background:rgba(245,158,11,.15);border:1px solid rgba(245,158,11,.4);color:#FCD34D;border-radius:10px;padding:10px 12px;font-size:11px;">
          ⚠️ Google Maps aceita no máximo 10 paradas por rota. Suas ${totalParadas} entregas serão divididas em ${numRotas} rotas.
        </div>
      ` : ''}

      <!-- Lista de paradas -->
      <div style="padding:0 14px;max-height:350px;overflow-y:auto;">
        <div style="font-size:11px;font-weight:700;color:rgba(245,192,181,.6);margin-bottom:8px;text-transform:uppercase;letter-spacing:1px;">📍 Ordem inicial (Maps vai otimizar)</div>
        ${ordered.map((o, i) => {
          const risk = (typeof getDeliveryRisk === 'function') ? getDeliveryRisk(o) : 'ok';
          const isUrg = risk === 'late' || risk === 'critical';
          const bairro = o.deliveryNeighborhood || '';
          const rua = o.deliveryStreet || '';
          const num = o.deliveryNumber || '';
          const hora = o.scheduledTime || '';
          return `
            <div style="display:flex;gap:10px;padding:9px;background:rgba(255,255,255,.03);border-radius:8px;margin-bottom:6px;align-items:center;border-left:3px solid ${isUrg ? '#EF4444' : '#C8736A'};">
              <div style="background:${isUrg ? '#EF4444' : '#C8736A'};color:#fff;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:11px;flex-shrink:0;">${i+1}</div>
              <div style="flex:1;min-width:0;">
                <div style="font-weight:700;font-size:12px;color:#F5C0B5;">${o.recipient || o.clientName || '—'}</div>
                <div style="font-size:10px;color:rgba(245,192,181,.55);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                  ${rua}${num ? ', '+num : ''}${bairro ? ' · '+bairro : ''}
                </div>
              </div>
              ${hora ? `<div style="font-size:11px;font-weight:700;color:${isUrg ? '#FCA5A5' : '#FCD34D'};white-space:nowrap;">⏰ ${hora}</div>` : ''}
            </div>
          `;
        }).join('')}
      </div>

      <!-- Botoes -->
      <div style="padding:14px;border-top:1px solid rgba(232,145,122,.2);">
        <button id="btn-iniciar-rota" style="width:100%;background:linear-gradient(135deg,#10B981,#059669);color:#fff;border:none;padding:16px;border-radius:12px;font-size:15px;font-weight:800;cursor:pointer;box-shadow:0 4px 14px rgba(16,185,129,.35);">
          🚀 Iniciar Rota no Google Maps
        </button>
        <div style="text-align:center;margin-top:10px;font-size:10px;color:rgba(245,192,181,.45);">
          Navegação passo a passo · Captura sua localização atual como ponto de partida
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.querySelector('#rota-close').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

  modal.querySelector('#btn-iniciar-rota').addEventListener('click', () => {
    iniciarNavegacaoGoogleMaps(ordered, () => modal.remove());
  });
}

// Captura GPS e abre Google Maps com optimize:true
function iniciarNavegacaoGoogleMaps(ordered, onDone) {
  const enderecos = ordered.map(enderecoPedido).filter(Boolean);
  if (enderecos.length === 0) {
    toast('❌ Endereços das entregas não disponíveis');
    return;
  }

  // Divide em lotes de 10 paradas se ultrapassar o limite do Google Maps URL
  const lotes = [];
  for (let i = 0; i < enderecos.length; i += MAX_STOPS_PER_URL) {
    lotes.push(enderecos.slice(i, i + MAX_STOPS_PER_URL));
  }

  const abrirLotes = (origin) => {
    lotes.forEach((lote, idx) => {
      const url = montarUrlRotaOtimizada(origin, lote);
      if (!url) return;
      // Delay entre aberturas para nao ser bloqueado pelo popup blocker
      setTimeout(() => window.open(url, '_blank'), idx * 600);
      // Para os proximos lotes, origem e o ultimo endereco do lote anterior
      if (idx < lotes.length - 1) origin = lote[lote.length - 1];
    });
    toast(`🗺️ Abrindo ${lotes.length > 1 ? lotes.length + ' rotas' : 'rota'} no Google Maps...`);
    if (onDone) onDone();
  };

  // Tenta GPS, senao usa floricultura como origem
  if (navigator.geolocation) {
    toast('📍 Capturando sua localização...');
    navigator.geolocation.getCurrentPosition(
      (pos) => abrirLotes(pos.coords.latitude + ',' + pos.coords.longitude),
      () => abrirLotes(ORIGEM_ROTA),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
    );
  } else {
    abrirLotes(ORIGEM_ROTA);
  }
}

if(typeof window !== 'undefined'){
  window.pedirAjudaEntrega = pedirAjudaEntrega;
  window.abrirRotaCompleta = abrirRotaCompleta;
}

// ── FULL IMG ─────────────────────────────────────────────────
export function showFullImg(url){
  S._modal=`<div class="mo" id="mo" onclick="S._modal='';render()">
  <div style="background:#fff;border-radius:16px;padding:16px;max-width:500px;width:94%;text-align:center">
    <img src="${url}" style="max-width:100%;max-height:70vh;object-fit:contain;border-radius:8px;"/>
    <div style="margin-top:10px"><button class="btn btn-ghost" onclick="S._modal='';render()">Fechar</button></div>
  </div></div>`;
  render();
}


// ── CONFIRMACAO DE ENTREGA VIA QR CODE ──────────────────────
export async function confirmDeliveryByQR(orderId){
  const o = S.orders.find(x=>x._id===orderId);
  if(!o){ toast('❌ Pedido nao encontrado neste dispositivo.', true); return; }
  if(o.status==='Entregue'){ toast(`✅ Pedido ${o.orderNumber} ja esta marcado como Entregue.`); return; }

  // Mostra modal de confirmacao
  S._modal=`<div class="mo" id="mo" onclick="if(event.target===this){S._modal='';render();}">
  <div class="mo-box" style="max-width:400px;text-align:center;" onclick="event.stopPropagation()">
    <div style="font-size:48px;margin-bottom:8px;">✅</div>
    <div style="font-family:'Playfair Display',serif;font-size:20px;margin-bottom:6px;">Confirmar Entrega</div>
    <div style="font-size:14px;color:var(--muted);margin-bottom:4px;">Pedido <strong>${o.orderNumber}</strong></div>
    <div style="font-size:16px;font-weight:700;margin-bottom:4px;">${o.recipient||o.client?.name||'—'}</div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:20px;">${[o.deliveryStreet, o.deliveryNeighborhood].filter(Boolean).join(', ')||'Endereco nao informado'}</div>
    <div style="background:var(--petal);border-radius:8px;padding:10px;margin-bottom:16px;font-size:12px;color:var(--rose);">
      🔔 Ao confirmar, o pedido sera marcado como <strong>Entregue</strong> automaticamente no sistema.
    </div>
    <div style="display:flex;gap:8px;justify-content:center;">
      <button class="btn btn-primary" id="btn-qr-confirm" style="padding:12px 24px;font-size:15px;">✅ Confirmar Entrega</button>
      <button class="btn btn-ghost" onclick="S._modal='';render();">Cancelar</button>
    </div>
  </div></div>`;
  await render();

  document.getElementById('btn-qr-confirm')?.addEventListener('click', async()=>{
    S._modal=''; S.loading=true; render();
    try{
      await PATCH('/orders/'+orderId+'/status',{status:'Entregue'});
      const oUpdated = {...o, status:'Entregue'};
      S.orders = S.orders.map(x=>x._id===orderId?oUpdated:x);
      S.loading=false; render();
      toast(`🎉 Entrega de ${o.orderNumber} confirmada com sucesso!`);
      // Log atividade e receita
      logActivity('expedicao', oUpdated);
      registrarReceitaVenda(oUpdated);
    }catch(e){
      S.loading=false; render();
      toast('❌ Erro ao confirmar: '+(e.message||''), true);
    }
  });
}
