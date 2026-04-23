// ── RINGTONE IFOOD (telefone antigo) ─────────────────────────
// Gera um toque classico de telefone via Web Audio API:
//   - Dois senos (440Hz + 480Hz) sobrepostos = tom de chamada BR/EUA
//   - Ciclo: 2s tocando + 4s silencio (padrao ITU)
//   - Toca em loop ate o usuario atender (clicar no modal) ou
//     o toque expirar (default 60s)
// Sem dependencia de arquivo de audio — funciona 100% offline e
// sem gesto do usuario apos a primeira interacao com a pagina.

let _ctx = null;
let _osc1 = null, _osc2 = null, _gain = null;
let _ringTimer = null;
let _stopTimer = null;
let _isRinging = false;
let _ackInteraction = false;

// Garante que temos AudioContext + gesto do usuario liberado
function getCtx(){
  if(!_ctx){
    try {
      _ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch(e) { return null; }
  }
  return _ctx;
}

// Liga o AudioContext no primeiro clique/tecla (browsers exigem gesto do usuario)
function unlockAudio(){
  if(_ackInteraction) return;
  _ackInteraction = true;
  const ctx = getCtx();
  if(ctx && ctx.state === 'suspended'){
    ctx.resume().catch(()=>{});
  }
}
// Engancha listeners globais uma vez
if(typeof document !== 'undefined'){
  ['click','keydown','touchstart'].forEach(evt =>
    document.addEventListener(evt, unlockAudio, { once: false, passive: true })
  );
}

// Toca um burst de ring (2s ligado)
function ringBurst(){
  const ctx = getCtx();
  if(!ctx) return;
  if(ctx.state === 'suspended'){ ctx.resume().catch(()=>{}); }

  // Limpa osciladores anteriores
  stopBurst();

  // Dois senos: 440Hz + 480Hz = tom classico de toque
  _osc1 = ctx.createOscillator();
  _osc2 = ctx.createOscillator();
  _gain = ctx.createGain();
  _osc1.type = 'sine'; _osc1.frequency.value = 440;
  _osc2.type = 'sine'; _osc2.frequency.value = 480;
  _osc1.connect(_gain);
  _osc2.connect(_gain);
  _gain.connect(ctx.destination);
  // Envelope: sobe rapido, mantem, desce
  const t0 = ctx.currentTime;
  _gain.gain.setValueAtTime(0, t0);
  _gain.gain.linearRampToValueAtTime(0.25, t0 + 0.05);
  _gain.gain.setValueAtTime(0.25, t0 + 1.95);
  _gain.gain.linearRampToValueAtTime(0, t0 + 2.00);
  _osc1.start(t0);
  _osc2.start(t0);
  _osc1.stop(t0 + 2.05);
  _osc2.stop(t0 + 2.05);
}

function stopBurst(){
  try { _osc1 && _osc1.stop(); } catch(_){}
  try { _osc2 && _osc2.stop(); } catch(_){}
  try { _gain && _gain.disconnect(); } catch(_){}
  _osc1 = _osc2 = _gain = null;
}

// Inicia o loop de ring (burst de 2s + pausa 4s, repete)
export function startRing(maxSeconds = 60){
  if(_isRinging) return;
  _isRinging = true;
  const loop = () => {
    if(!_isRinging) return;
    ringBurst();
    _ringTimer = setTimeout(loop, 6000); // 2s ring + 4s silencio
  };
  loop();
  // Expira automaticamente
  _stopTimer = setTimeout(() => stopRing(), maxSeconds * 1000);
}

export function stopRing(){
  _isRinging = false;
  if(_ringTimer){ clearTimeout(_ringTimer); _ringTimer = null; }
  if(_stopTimer){ clearTimeout(_stopTimer); _stopTimer = null; }
  stopBurst();
}

export function isRinging(){ return _isRinging; }

// ── MODAL VISUAL: "Novo pedido iFood" ────────────────────────
export function showIfoodRingModal(order){
  // Se ja existe um modal desse, acumula
  let existing = document.getElementById('ifood-ring-modal');
  if(existing){
    const list = existing.querySelector('[data-orders-list]');
    if(list && order){
      const row = document.createElement('div');
      row.style.cssText = 'background:#FFF7ED;border:1px solid #FDBA74;border-radius:10px;padding:10px 14px;margin-top:8px;';
      row.innerHTML = `<strong style="color:#C2410C;">IF${order.ifoodDisplayId || order.orderNumber?.replace(/^IF/,'') || '?'}</strong>
        <span style="margin-left:8px;">${order.clientName || 'Cliente iFood'}</span>
        ${order.total ? `<span style="float:right;font-weight:700;color:#065F46;">R$ ${Number(order.total).toFixed(2).replace('.',',')}</span>` : ''}`;
      list.appendChild(row);
    }
    return;
  }

  startRing(90);

  const modal = document.createElement('div');
  modal.id = 'ifood-ring-modal';
  modal.style.cssText = `
    position:fixed;inset:0;z-index:99999;
    background:rgba(0,0,0,.72);
    display:flex;align-items:center;justify-content:center;
    animation:fadein .3s ease;
    padding:20px;
  `;
  modal.innerHTML = `
    <style>
      @keyframes fadein{from{opacity:0;}to{opacity:1;}}
      @keyframes ifood-shake{0%,100%{transform:translateX(0);}25%{transform:translateX(-8px) rotate(-3deg);}75%{transform:translateX(8px) rotate(3deg);}}
      @keyframes ifood-pulse{0%,100%{transform:scale(1);box-shadow:0 0 0 0 rgba(239,68,68,.7);}50%{transform:scale(1.05);box-shadow:0 0 0 18px rgba(239,68,68,0);}}
      @keyframes ifood-ring-icon{0%,100%{transform:rotate(0deg);}10%,30%{transform:rotate(-20deg);}20%,40%{transform:rotate(20deg);}50%{transform:rotate(0deg);}}
    </style>
    <div style="background:#fff;border-radius:24px;padding:36px 40px;max-width:520px;width:100%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.4);border:4px solid #EA1D2C;">
      <div style="font-size:88px;animation:ifood-ring-icon 1s ease-in-out infinite;display:inline-block;">📞</div>
      <div style="font-family:'Playfair Display',serif;font-size:28px;color:#EA1D2C;font-weight:800;margin:8px 0 4px;">
        🍔 Novo pedido iFood!
      </div>
      <div style="font-size:14px;color:var(--muted);margin-bottom:14px;">
        Chegou um pedido agora mesmo. Toque para atender.
      </div>

      <div data-orders-list style="margin:14px 0;text-align:left;max-height:40vh;overflow-y:auto;">
        <div style="background:#FFF7ED;border:1px solid #FDBA74;border-radius:10px;padding:10px 14px;">
          <strong style="color:#C2410C;">IF${order?.ifoodDisplayId || order?.orderNumber?.replace(/^IF/,'') || '?'}</strong>
          <span style="margin-left:8px;">${order?.clientName || 'Cliente iFood'}</span>
          ${order?.total ? `<span style="float:right;font-weight:700;color:#065F46;">R$ ${Number(order.total).toFixed(2).replace('.',',')}</span>` : ''}
        </div>
      </div>

      <button id="ifood-ring-accept"
        style="width:100%;background:linear-gradient(135deg,#22C55E,#16A34A);color:#fff;border:none;border-radius:14px;padding:18px;font-size:18px;font-weight:800;cursor:pointer;letter-spacing:.5px;animation:ifood-pulse 1.2s ease-in-out infinite;">
        ✅ Atender (parar toque)
      </button>
      <button id="ifood-ring-goto"
        style="width:100%;background:#1E293B;color:#fff;border:none;border-radius:12px;padding:12px;font-size:14px;font-weight:700;cursor:pointer;margin-top:10px;">
        📋 Ir para Pedidos
      </button>
      <div style="font-size:10px;color:var(--muted);margin-top:12px;">
        🔕 Toque para automaticamente em 90s
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => {
    stopRing();
    modal.remove();
  };
  modal.querySelector('#ifood-ring-accept')?.addEventListener('click', close);
  modal.querySelector('#ifood-ring-goto')?.addEventListener('click', () => {
    close();
    try { window.setPage?.('pedidos'); } catch(_){}
  });
  // Fechar com ESC
  document.addEventListener('keydown', function onEsc(e){
    if(e.key === 'Escape'){ close(); document.removeEventListener('keydown', onEsc); }
  });
}

// ── DETECTOR DE NOVOS PEDIDOS IFOOD ─────────────────────────
// Guarda Set de IDs ja "tocados" em localStorage (persiste entre reloads)
const SEEN_KEY = 'fv_ifood_ringed_ids';
function getSeen(){
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); }
  catch { return new Set(); }
}
function saveSeen(set){
  // Mantem so os ultimos 500 para nao crescer indefinidamente
  const arr = [...set].slice(-500);
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(arr)); } catch(_){}
}

// Chamado a cada ciclo de polling. Recebe a lista completa de orders atual.
// Dispara ring + modal para pedidos iFood recentes (<=5min) nao vistos.
export function checkAndRingIfoodOrders(orders){
  if(!Array.isArray(orders) || !orders.length) return;
  const seen = getSeen();
  const now = Date.now();
  const novos = [];
  for(const o of orders){
    const isIfood = (o.source === 'iFood') ||
                    (typeof o.orderNumber === 'string' && o.orderNumber.startsWith('IF'));
    if(!isIfood) continue;
    const id = o._id || o.ifoodOrderId || o.orderNumber;
    if(!id || seen.has(id)) continue;
    // So toca pra pedidos recentes (<=10min), evita toque em cargas iniciais
    const createdAt = new Date(o.createdAt || 0).getTime();
    if(createdAt && (now - createdAt) > 10 * 60 * 1000){
      // Pedido antigo — marca como visto sem tocar
      seen.add(id);
      continue;
    }
    // So toca pra status inicial (Aguardando/Em preparo)
    if(o.status && !['Aguardando','Em preparo','Pendente'].includes(o.status)){
      seen.add(id);
      continue;
    }
    seen.add(id);
    novos.push(o);
  }
  saveSeen(seen);
  // Se achou algum novo: modal + ring (o modal acumula se ja estiver aberto)
  for(const o of novos){
    try { showIfoodRingModal(o); }
    catch(e){ console.error('[iFood ring] erro ao mostrar modal:', e); }
  }
}

// Exponibiliza para teste manual via console: window.testIfoodRing()
if(typeof window !== 'undefined'){
  window.testIfoodRing = () => showIfoodRingModal({
    ifoodDisplayId: '999999',
    clientName: 'Teste de Toque',
    total: 99.90,
  });
}
