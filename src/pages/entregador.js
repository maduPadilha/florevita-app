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
        <div style="font-size:14px;font-weight:700">${o.scheduledPeriod||'—'}</div>
      </div>
    </div>
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
    ${o.cardMessage?`<div style="background:#FDF4F0;border-left:3px solid #C8736A;border-radius:8px;padding:10px;margin-bottom:12px;"><div style="font-size:9px;font-weight:700;color:#C8736A;text-transform:uppercase;margin-bottom:3px;">💌 Mensagem</div><div style="font-size:12px;font-style:italic;color:#4A2018">"${o.cardMessage}"</div></div>`:''}
    ${o.payment==='Pagar na Entrega'?`<div style="background:#FFFBEB;border:2px solid #F59E0B;border-radius:10px;padding:12px;margin-bottom:12px;"><div style="font-size:11px;font-weight:700;color:#92400E;">💰 COBRAR NA ENTREGA</div><div style="font-size:22px;font-weight:800;color:#D97706;margin:4px 0">${$c(o.total)}</div><div style="font-size:12px;color:#78350F">${o.paymentOnDelivery==='Dinheiro'?'💵 Dinheiro':o.paymentOnDelivery==='Levar Maquineta'?'💳 Maquineta':'⚠️ Verificar'}</div></div>`:''}
    <div style="display:flex;gap:8px;align-items:stretch;">
      <button
        class="btn btn-blue"
        data-rota="${o._id}"
        style="flex:1;background:#1E40AF;color:#fff;padding:12px 14px;border:none;border-radius:12px;font-weight:700;font-size:14px;display:flex;align-items:center;justify-content:center;gap:6px;cursor:pointer;min-height:48px;"
      >
        🗺️ Rotas
      </button>
      <button type="button" onclick="showConfirmDeliveryModal('${o._id}')"
        style="flex:1.4;background:#3A7D44;color:#fff;border:none;border-radius:12px;padding:12px 14px;font-size:14px;font-weight:700;cursor:pointer;min-height:48px;">
        ✅ Confirmar Entrega
      </button>
    </div>
  </div>
</div>`;
    }).join('')}
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

  // Fallback: open maps without origin
  if(!navigator.geolocation){
    markBtnOrange();
    const url = 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(endereco);
    window.open(url, '_blank');
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const origin = pos.coords.latitude + ',' + pos.coords.longitude;
      const url = 'https://www.google.com/maps/dir/?api=1&origin=' + origin + '&destination=' + encodeURIComponent(endereco) + '&travelmode=driving';
      window.open(url, '_blank');
      toast('🗺️ Abrindo rota no Google Maps...');
    },
    (err) => {
      // Permission denied or error — fallback without origin
      console.warn('GPS error:', err);
      markBtnOrange();
      const url = 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(endereco) + '&travelmode=driving';
      window.open(url, '_blank');
      if(err.code === 1){
        toast('⚠️ Permissão de localização negada. Abrindo mapa sem origem.', true);
      } else {
        toast('⚠️ GPS indisponível. Abrindo mapa...', true);
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
