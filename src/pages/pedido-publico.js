// ── PÁGINA PÚBLICA DE PEDIDO (sem login) ────────────────────
// Acessada pelo QR code impresso na comanda.
// URL: /entrega/:orderId — renderizada sem exigir autenticação.

import { S, API } from '../state.js';
import { $c, $d, fmtOrderNum } from '../utils/formatters.js';
import { toast } from '../utils/helpers.js';

const ORIGEM_ROTA = 'R. Galiléia, 42 - Novo Aleixo, Manaus - AM, 69098-026';

// Estado local da página pública
let _publicOrder = null;
let _loading = false;
let _error = null;

// Carrega dados do pedido do endpoint público
async function loadPublicOrder(orderId){
  _loading = true;
  _error = null;
  triggerRender();
  try{
    const res = await fetch(API + '/orders/public/' + orderId, {
      method: 'GET',
      signal: AbortSignal.timeout(12000),
    });
    if(!res.ok){
      _error = res.status === 404 ? 'Pedido não encontrado' : `Erro ${res.status}`;
      _publicOrder = null;
    } else {
      _publicOrder = await res.json();
      _error = null;
    }
  }catch(e){
    _error = 'Falha de conexão — verifique a internet';
    _publicOrder = null;
  }
  _loading = false;
  triggerRender();
}

function triggerRender(){
  import('../main.js').then(m => m.render()).catch(()=>{});
}

// Monta endereço em texto
function formatAddress(o){
  return o.deliveryAddress ||
    [o.deliveryStreet, o.deliveryNumber, o.deliveryNeighborhood, o.deliveryCity||'Manaus','AM']
      .filter(Boolean).join(', ') ||
    'Endereço não informado';
}

// Pedir ajuda via WhatsApp (mesma lógica do app do entregador)
function pedirAjuda(o){
  let lojaPhone = '5592993002433';
  if(!lojaPhone.startsWith('55')) lojaPhone = '55' + lojaPhone;

  const destinatario = o.recipient || o.clientName || '—';
  const recipPhone = o.recipientPhone || '';
  const orderNum = o.orderNumber || o.numero || String(o._id||'').slice(-5);
  const rawBuyerPhone = (o.clientPhone || '').replace(/\D/g,'');
  const buyerLast6 = rawBuyerPhone ? rawBuyerPhone.slice(-6) : '';
  const endereco = formatAddress(o);

  const msg = [
    `🆘 *Preciso de ajuda com uma entrega*`,
    ``,
    `📦 *Pedido:* #${orderNum}`,
    buyerLast6 ? `📱 *Tel. comprador (final):* ${buyerLast6}` : '',
    `🎁 *Destinatário:* ${destinatario}${recipPhone?` (${recipPhone})`:''}`,
    `📍 *Endereço:* ${endereco}`,
    o.condName ? `🏢 *Complemento:* ${o.condName}${o.block?' Bl.'+o.block:''}${o.apt?' Ap.'+o.apt:''}` : '',
    o.deliveryReference ? `📌 *Referência:* ${o.deliveryReference}` : '',
    ``,
    `_Descreva abaixo o problema que está enfrentando..._`,
  ].filter(Boolean).join('\n');

  window.open(`https://wa.me/${lojaPhone}?text=${encodeURIComponent(msg)}`, '_blank');
}

// Abrir rota no Google Maps a partir da floricultura
function abrirRotaPublica(o){
  const endereco = formatAddress(o);
  if(navigator.geolocation){
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const origin = pos.coords.latitude + ',' + pos.coords.longitude;
        window.open(`https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${encodeURIComponent(endereco)}&travelmode=driving`, '_blank');
      },
      () => {
        window.open(`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(ORIGEM_ROTA)}&destination=${encodeURIComponent(endereco)}&travelmode=driving`, '_blank');
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  } else {
    window.open(`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(ORIGEM_ROTA)}&destination=${encodeURIComponent(endereco)}&travelmode=driving`, '_blank');
  }
}

// Confirmar entrega publicamente
async function confirmarEntregaPublica(o){
  const isPagarEntrega = (o.payment === 'Pagar na Entrega');
  let paymentReceived = false;

  if(isPagarEntrega){
    paymentReceived = confirm(`💰 PAGAR NA ENTREGA: ${$c(o.total)}\n\nO cliente pagou o valor?\n\nOK = Sim, recebi\nCancelar = Não pagou ainda`);
    if(!paymentReceived){
      alert('❌ Só é possível confirmar a entrega após receber o pagamento.');
      return;
    }
  }

  const receiverName = prompt('Nome de quem recebeu o pedido:');
  if(!receiverName || !receiverName.trim()){
    alert('❌ Informe o nome de quem recebeu');
    return;
  }

  try{
    const res = await fetch(API + '/orders/public/' + o._id + '/deliver', {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ receiverName: receiverName.trim(), paymentReceived }),
    });
    if(!res.ok){ throw new Error('HTTP ' + res.status); }
    const data = await res.json();
    _publicOrder = data.order || _publicOrder;
    if(_publicOrder) _publicOrder.status = 'Entregue';
    triggerRender();
    alert(`✅ Entrega confirmada!\nRecebido por: ${receiverName}${isPagarEntrega?'\n💰 Pagamento confirmado.':''}`);
  }catch(e){
    alert('❌ Erro ao confirmar: ' + (e.message||''));
  }
}

// Expor handlers globalmente para onclick inline
if(typeof window !== 'undefined'){
  window._pubPedirAjuda = () => _publicOrder && pedirAjuda(_publicOrder);
  window._pubAbrirRota = () => _publicOrder && abrirRotaPublica(_publicOrder);
  window._pubConfirmarEntrega = () => _publicOrder && confirmarEntregaPublica(_publicOrder);
}

// Detecta se URL é /entrega/:id e retorna o orderId
export function getPublicOrderIdFromURL(){
  const path = window.location.pathname;
  const m = path.match(/^\/+entrega\/([A-Za-z0-9_-]+)/i);
  return m ? m[1] : null;
}

export function renderPedidoPublico(){
  const orderId = getPublicOrderIdFromURL();
  if(!orderId){
    return `<div style="padding:40px;text-align:center;">
      <h2>Link inválido</h2>
      <p>Escaneie o QR code da comanda para ver os detalhes da entrega.</p>
    </div>`;
  }

  // Carrega se ainda não carregou OU se é outro pedido
  if(!_loading && (!_publicOrder || _publicOrder._id !== orderId) && !_error){
    loadPublicOrder(orderId);
  }

  const cfg = JSON.parse(localStorage.getItem('fv_config')||'{}');
  const logoUrl = cfg.loginLogo || '';

  if(_loading){
    return `<div style="min-height:100vh;background:#0D0D0D;display:flex;align-items:center;justify-content:center;">
      <div style="text-align:center;color:#F5C0B5;">
        <div style="font-size:50px;margin-bottom:12px;">🔄</div>
        <div style="font-size:15px;font-weight:600;">Carregando pedido...</div>
      </div>
    </div>`;
  }

  if(_error || !_publicOrder){
    return `<div style="min-height:100vh;background:#0D0D0D;display:flex;align-items:center;justify-content:center;padding:20px;">
      <div style="text-align:center;color:#FCA5A5;max-width:360px;">
        <div style="font-size:50px;margin-bottom:12px;">⚠️</div>
        <div style="font-size:17px;font-weight:700;margin-bottom:8px;">${_error||'Pedido não encontrado'}</div>
        <div style="font-size:12px;color:rgba(245,192,181,.6);margin-bottom:16px;">
          Verifique se o QR code está íntegro e tente novamente.
        </div>
        <button onclick="location.reload()" style="background:#C8736A;color:#fff;border:none;padding:12px 24px;border-radius:10px;font-weight:700;cursor:pointer;">🔄 Tentar novamente</button>
      </div>
    </div>`;
  }

  const o = _publicOrder;
  const rawBuyerPhone = (o.clientPhone||'').replace(/\D/g,'');
  const buyerLast6 = rawBuyerPhone ? rawBuyerPhone.slice(-6) : '';
  const anonimo = o.identifyClient === false;
  const msg = o.cardMessage || '';
  const remetente = !anonimo ? (o.clientName||'') : '';
  const isEntregue = o.status === 'Entregue';
  const isPagarEntrega = (o.payment === 'Pagar na Entrega');
  const trocoInfo = (isPagarEntrega && o.paymentOnDelivery==='Dinheiro' && o.trocoPara && parseFloat(o.trocoPara) > (o.total||0))
    ? ` · Troco p/ R$ ${parseFloat(o.trocoPara).toFixed(2).replace('.',',')} (levar R$ ${(parseFloat(o.trocoPara)-(o.total||0)).toFixed(2).replace('.',',')})`
    : '';

  return `
<div style="min-height:100vh;background:#0D0D0D;padding-bottom:30px;">
  <!-- Header -->
  <div style="background:rgba(13,13,13,.97);border-bottom:1px solid rgba(232,145,122,.2);padding:14px 16px;">
    <div style="max-width:500px;margin:0 auto;text-align:center;">
      ${logoUrl ? `<img src="${logoUrl}" alt="Laços Eternos" style="max-height:50px;margin-bottom:6px;"/>` : `<div style="font-family:'Playfair Display',serif;font-size:18px;color:#F5C0B5;font-weight:600;">Laços Eternos 🌸</div>`}
      <div style="font-size:10px;color:rgba(245,192,181,.6);letter-spacing:1px;text-transform:uppercase;">Pedido para entrega</div>
    </div>
  </div>

  <div style="max-width:500px;margin:0 auto;padding:14px;">
    <!-- Card principal -->
    <div style="background:#fff;border-radius:14px;overflow:hidden;border:2px solid ${isEntregue?'#3A7D44':'#C8736A'};box-shadow:0 4px 16px rgba(0,0,0,.25);">
      <div style="background:${isEntregue?'#F0FDF4':'#FDF8F6'};padding:12px 14px;border-bottom:1px solid ${isEntregue?'#BBF7D0':'#EDE0DC'};display:flex;align-items:center;justify-content:space-between;">
        <div>
          <div style="font-weight:800;font-size:18px;color:${isEntregue?'#166534':'#C8736A'};">${fmtOrderNum(o)}</div>
          <div style="font-size:11px;color:#9E8070;">${o.scheduledPeriod||''} ${o.scheduledDate?'· '+$d(o.scheduledDate):''}${o.scheduledTime?' · '+o.scheduledTime:''}</div>
        </div>
        ${isEntregue ? `<span style="background:#3A7D44;color:#fff;border-radius:20px;padding:4px 12px;font-size:11px;font-weight:700;">✅ ENTREGUE</span>` : `<span style="font-size:22px;">🌸</span>`}
      </div>
      <div style="padding:14px;">
        <!-- Itens -->
        ${(o.items||[]).map(i=>`<div style="display:flex;align-items:center;gap:10px;padding:8px;background:#FDF8F6;border-radius:8px;margin-bottom:6px;">
          <div style="width:44px;height:44px;border-radius:8px;background:#FAE8E6;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">🌸</div>
          <div>
            <div style="font-weight:700;font-size:13px;">${i.qty}x ${i.name}</div>
            ${i.complement?`<div style="font-size:11px;color:#6B7280;">${i.complement}</div>`:''}
          </div>
        </div>`).join('')}

        <!-- Destinatário + Horário -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 0;">
          <div style="background:#FDF8F6;border-radius:10px;padding:10px;">
            <div style="font-size:9px;font-weight:700;color:#9E8070;text-transform:uppercase;letter-spacing:1px;margin-bottom:3px;">Para</div>
            <div style="font-size:14px;font-weight:700;">${o.recipient||o.clientName||'—'}</div>
          </div>
          <div style="background:#FDF8F6;border-radius:10px;padding:10px;">
            <div style="font-size:9px;font-weight:700;color:#9E8070;text-transform:uppercase;letter-spacing:1px;margin-bottom:3px;">Horário</div>
            <div style="font-size:14px;font-weight:700;">${o.scheduledTime||o.scheduledPeriod||'—'}</div>
          </div>
        </div>

        <!-- Contato do comprador (últimos 6) -->
        ${buyerLast6 ? `
        <div style="background:#EEF2FF;border:1.5px dashed #6366F1;border-radius:10px;padding:10px 12px;margin-bottom:12px;">
          <div style="font-size:9px;font-weight:700;color:#4338CA;text-transform:uppercase;letter-spacing:.5px;">📱 Contato do comprador</div>
          <div style="font-size:14px;font-weight:800;color:#1E1B4B;margin-top:2px;">Final: <span style="font-family:monospace;letter-spacing:1px;">${buyerLast6}</span></div>
        </div>` : ''}

        <!-- Endereço -->
        <div style="background:#EEF2FF;border-radius:10px;padding:12px;margin-bottom:12px;border:1px solid #C7D2FE;">
          <div style="font-size:9px;font-weight:700;color:#4338CA;text-transform:uppercase;letter-spacing:1px;margin-bottom:5px;">📍 Endereço</div>
          <div style="font-size:13px;font-weight:600;color:#1E1B4B;margin-bottom:3px;">${formatAddress(o)}</div>
          ${o.condName?`<div style="font-size:11px;color:#4338CA;">🏢 ${o.condName}${o.block?` Bl.${o.block}`:''}${o.apt?` Ap.${o.apt}`:''}</div>`:''}
          ${o.deliveryReference?`<div style="font-size:11px;color:#6366F1;">Ref: ${o.deliveryReference}</div>`:''}
        </div>

        <!-- Cartão -->
        ${(msg || remetente || anonimo) ? `
        <div style="background:#FDF4F0;border:2px solid #C8736A;border-radius:10px;padding:12px;margin-bottom:12px;">
          <div style="font-size:10px;font-weight:800;color:#C8736A;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">💌 Cartão da entrega</div>
          ${msg?`<div style="font-size:13px;font-style:italic;color:#4A2018;line-height:1.4;margin-bottom:6px;">"${msg}"</div>`:'<div style="font-size:11px;color:#9E8070;font-style:italic;margin-bottom:6px;">(sem mensagem)</div>'}
          <div style="font-size:11px;color:#7C2D12;font-weight:700;border-top:1px dashed #E8C5B8;padding-top:6px;">
            ${anonimo ? '👤 Anônimo — <em>não dizer quem enviou</em>' : (remetente ? `De: <strong>${remetente}</strong>` : '')}
          </div>
        </div>` : ''}

        <!-- Pagamento na entrega -->
        ${isPagarEntrega && !isEntregue ? `
        <div style="background:#FFFBEB;border:2px solid #F59E0B;border-radius:10px;padding:12px;margin-bottom:12px;">
          <div style="font-size:11px;font-weight:700;color:#92400E;">💰 COBRAR NA ENTREGA</div>
          <div style="font-size:24px;font-weight:800;color:#D97706;margin:4px 0;">${$c(o.total)}</div>
          <div style="font-size:12px;color:#78350F;">${o.paymentOnDelivery==='Dinheiro'?'💵 Dinheiro':o.paymentOnDelivery==='Levar Maquineta'?'💳 Maquineta':'⚠️ Verificar'}${trocoInfo}</div>
        </div>` : ''}

        <!-- Ações -->
        ${!isEntregue ? `
        <div style="display:flex;gap:8px;margin-bottom:8px;">
          <button onclick="window._pubAbrirRota()" style="flex:1;background:#1E40AF;color:#fff;border:none;border-radius:12px;padding:12px;font-size:13px;font-weight:700;cursor:pointer;">
            🗺️ Rota
          </button>
          <button onclick="window._pubConfirmarEntrega()" style="flex:1.4;background:#3A7D44;color:#fff;border:none;border-radius:12px;padding:12px;font-size:13px;font-weight:700;cursor:pointer;">
            ✅ Confirmar Entrega
          </button>
        </div>
        <button onclick="window._pubPedirAjuda()" style="width:100%;background:#FEF3C7;border:1.5px solid #F59E0B;color:#92400E;border-radius:10px;padding:10px;font-size:12px;font-weight:700;cursor:pointer;">
          🆘 Preciso de ajuda nesta entrega
        </button>` : `
        <div style="text-align:center;padding:16px;background:#F0FDF4;border-radius:10px;color:#166534;font-weight:700;font-size:14px;">
          ✅ Esta entrega já foi confirmada
        </div>`}
      </div>
    </div>

    <div style="text-align:center;margin-top:14px;font-size:10px;color:rgba(245,192,181,.4);">
      🌸 Laços Eternos Floricultura<br>
      <a href="/login" style="color:rgba(245,192,181,.7);text-decoration:none;">Acessar sistema completo →</a>
    </div>
  </div>
</div>`;
}
