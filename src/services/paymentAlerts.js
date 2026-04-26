// ── ALERTAS DE PAGAMENTO PENDENTE ────────────────────────────
// Verifica a cada 30s se ha pedidos em 'Aguardando Pagamento' /
// 'Aguardando Comprovante' criados ha 10+ minutos. Se sim, mostra
// uma notificacao push no canto inferior direito.
//
// Mensagem varia conforme a origem (PDV vs Site/E-commerce).

import { S } from '../state.js';

const ALREADY_NOTIFIED = new Set(); // orderId — evita notificar 2x o mesmo
const STATUS_PENDENTE = ['Aguardando Pagamento', 'Aguardando Comprovante', 'Ag. Pagamento'];
const TEN_MIN_MS = 10 * 60 * 1000;

let _timer = null;
let _container = null;

function ensureContainer(){
  if (_container && document.body.contains(_container)) return _container;
  _container = document.createElement('div');
  _container.id = 'fv-payment-alerts';
  _container.setAttribute('style', `
    position:fixed;
    bottom:20px;
    right:20px;
    z-index:99999;
    display:flex;
    flex-direction:column;
    gap:10px;
    max-width:380px;
    width:calc(100vw - 40px);
    pointer-events:none;
  `);
  document.body.appendChild(_container);
  return _container;
}

function isFromSite(o){
  const src = String(o.source || '').toLowerCase();
  return src.includes('e-comm') || src.includes('ecomm') || src === 'site' || src === 'website';
}

function fmtNumOrder(o){
  const raw = o.orderNumber || o.numero || '';
  const s = String(raw).replace(/^#/,'').replace(/^PED-?/i,'');
  const m = s.match(/\d+/);
  if (m) return '#' + m[0].padStart(5,'0');
  return '#' + (o._id ? String(o._id).slice(-5).toUpperCase() : '—');
}

// Mensagens padrao (humanizadas) ja prontas para o WhatsApp.
// Pega o primeiro nome do cliente (mais natural).
function primeiroNome(nomeCompleto){
  return String(nomeCompleto||'').trim().split(/\s+/)[0] || '';
}

function mensagemWhatsAppSite(cli, num){
  const nome = primeiroNome(cli) || 'tudo bem';
  return `Oi ${nome}! 🌸\n\nAqui é da Floricultura Laços Eternos. Vimos que você fez o pedido ${num} no nosso site, mas o pagamento ainda não consta como confirmado. 💛\n\nGostaríamos de te ajudar a finalizar a compra! Posso te enviar o link do Pix ou tirar alguma dúvida que esteja te impedindo de concluir? 🌷\n\nEstamos por aqui pra te atender com todo carinho!`;
}

function mensagemWhatsAppPdv(cli, num){
  const nome = primeiroNome(cli) || 'tudo bem';
  return `Olá ${nome}! 🌸\n\nAqui é da Floricultura Laços Eternos. Estamos com o pedido ${num} reservado no seu nome, mas o pagamento ainda não foi confirmado por aqui. 💛\n\nVocê já conseguiu efetuar o Pix/transferência? Se precisar do comprovante ou de qualquer ajuda, é só nos avisar — estamos aqui para te atender com carinho! 🌷`;
}

function showNotification(o){
  const container = ensureContainer();
  const num = fmtNumOrder(o);
  const cli = o.clientName || o.client?.name || 'Cliente';
  const phone = o.clientPhone || o.client?.phone || '';
  const total = (o.total || 0).toFixed(2).replace('.', ',');
  const fromSite = isFromSite(o);

  // 2 mensagens distintas
  const titulo = fromSite
    ? `🌐 Pedido do site ${num} aguardando`
    : `💳 Pedido ${num} aguardando pagamento`;

  const corpo = fromSite
    ? `Cliente <strong>${cli}</strong> fez um pedido no site (R$ ${total}) e ainda não pagou. Entre em contato para confirmar interesse e oferecer ajuda no pagamento.`
    : `Pedido de <strong>${cli}</strong> (R$ ${total}) está há mais de 10 minutos sem confirmação. Confira se o pagamento foi realizado ou entre em contato com o cliente para verificar.`;

  // Mensagem WhatsApp pre-preenchida (humanizada)
  const wppMsg = fromSite ? mensagemWhatsAppSite(cli, num) : mensagemWhatsAppPdv(cli, num);
  const wppPhone = String(phone).replace(/\D/g,'');
  const wppHref = `https://wa.me/55${wppPhone}?text=${encodeURIComponent(wppMsg)}`;

  const corHeader = fromSite ? '#7C3AED' : '#D97706';
  const corBg     = fromSite ? '#F5F3FF' : '#FFFBEB';
  const corBorder = fromSite ? '#C4B5FD' : '#FCD34D';

  const card = document.createElement('div');
  card.setAttribute('data-order-id', o._id);
  card.setAttribute('style', `
    background:${corBg};
    border:2px solid ${corBorder};
    border-radius:12px;
    overflow:hidden;
    box-shadow:0 8px 24px rgba(0,0,0,.18);
    pointer-events:auto;
    animation:fv-slide-in .35s cubic-bezier(.2,.8,.2,1);
    font-family:'DM Sans', sans-serif;
  `);
  card.innerHTML = `
    <style>
      @keyframes fv-slide-in { from { transform:translateX(120%); opacity:0; } to { transform:translateX(0); opacity:1; } }
      @keyframes fv-pulse-dot { 0%,100% { opacity:1; transform:scale(1); } 50% { opacity:.4; transform:scale(.85); } }
    </style>
    <div style="background:${corHeader};color:#fff;padding:8px 14px;display:flex;justify-content:space-between;align-items:center;gap:8px;">
      <div style="display:flex;align-items:center;gap:8px;font-weight:800;font-size:13px;">
        <span style="width:8px;height:8px;background:#fff;border-radius:50%;animation:fv-pulse-dot 1.2s infinite;"></span>
        ${titulo}
      </div>
      <button data-fv-close style="background:rgba(255,255,255,.25);color:#fff;border:none;width:24px;height:24px;border-radius:6px;cursor:pointer;font-size:14px;line-height:1;">×</button>
    </div>
    <div style="padding:12px 14px;font-size:12px;color:#1F2937;line-height:1.5;">
      ${corpo}
      <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">
        ${phone ? `<a href="${wppHref}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:4px;background:#25D366;color:#fff;text-decoration:none;padding:6px 12px;border-radius:8px;font-size:11px;font-weight:700;">📱 WhatsApp</a>` : ''}
        <button data-fv-open-order="${o._id}" style="background:#fff;color:${corHeader};border:1px solid ${corBorder};padding:6px 12px;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;">📋 Ver pedido</button>
      </div>
    </div>
  `;
  container.appendChild(card);

  card.querySelector('[data-fv-close]')?.addEventListener('click', () => {
    card.style.animation = 'fv-slide-in .25s cubic-bezier(.4,0,.6,1) reverse';
    setTimeout(() => card.remove(), 240);
  });
  card.querySelector('[data-fv-open-order]')?.addEventListener('click', () => {
    // Limpa TODOS os filtros para garantir que o pedido apareca
    S.page = 'pedidos';
    S._fStatus = 'Todos';
    S._fBairro = '';
    S._fTurno = '';
    S._fUnidade = '';
    S._fCanal = '';
    S._fPrioridade = '';
    S._fDate1 = '';
    S._fDate2 = '';
    // Busca pelo numero (sem zeros a esquerda — o searchOrders ja lida com isso)
    const numClean = num.replace(/^#/,'').replace(/^0+/,'') || num.replace(/^#/,'');
    S._orderSearch = numClean;
    // Garante que o pedido esta em S.orders (mescla via fetch backend)
    import('../utils/helpers.js').then(m => m.triggerServerOrderSearch?.(numClean)).catch(()=>{});
    import('../main.js').then(m => m.render());
    card.remove();
  });

  // Auto-dismiss apos 60s (notificacao continua valida — voltara em 30s)
  setTimeout(() => {
    if (document.body.contains(card)) {
      card.style.animation = 'fv-slide-in .3s reverse';
      setTimeout(() => card.remove(), 290);
    }
  }, 60000);
}

function check(){
  if (!Array.isArray(S.orders)) return;
  const now = Date.now();
  for (const o of S.orders) {
    if (!o || !o._id) continue;
    if (!STATUS_PENDENTE.includes(o.paymentStatus)) {
      // Se nao esta mais pendente, libera para futura notificacao caso volte
      ALREADY_NOTIFIED.delete(o._id);
      continue;
    }
    if (ALREADY_NOTIFIED.has(o._id)) continue;
    const created = new Date(o.createdAt || 0).getTime();
    if (!created || isNaN(created)) continue;
    const ageMs = now - created;
    if (ageMs >= TEN_MIN_MS) {
      ALREADY_NOTIFIED.add(o._id);
      try { showNotification(o); } catch(e) { console.warn('[paymentAlerts]', e); }
    }
  }
}

export function startPaymentAlerts(){
  if (_timer) return;
  // Primeira verificacao apos 5s (da tempo de carregar pedidos)
  setTimeout(check, 5000);
  _timer = setInterval(check, 30000); // a cada 30s
  console.log('[paymentAlerts] iniciado — verifica pedidos pendentes a cada 30s');
}

export function stopPaymentAlerts(){
  if (_timer) { clearInterval(_timer); _timer = null; }
}
