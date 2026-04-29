// ── REAL-TIME via Server-Sent Events ─────────────────────────
// Conecta uma vez apos login e mantem aberto. Backend envia push quando
// pedidos sao criados/atualizados/deletados. Reconecta automaticamente
// se a conexao cair (EventSource faz isso nativamente).
//
// Eventos suportados:
//   order:created  → adiciona em S.orders + render
//   order:updated  → substitui em S.orders + render
//   order:deleted  → remove de S.orders + render
//   hello          → conexao confirmada (so loga)

import { S, API } from '../state.js';
import { invalidateCache } from './cache.js';

let _es = null;
let _backoffMs = 1000;

function lightSig(arr){
  return Array.isArray(arr) ? arr.map(o => `${o?._id||''}:${o?.updatedAt||''}`).join('|') : '';
}

async function reRender(){
  try { const { render } = await import('../main.js'); render(); } catch(_){}
}

function blinkSyncDot(color = '#3B82F6'){
  const ind = document.getElementById('sync-dot');
  if (!ind) return;
  ind.style.background = color;
  setTimeout(() => { if(ind) ind.style.background='rgba(255,255,255,.3)'; }, 800);
}

function applyOrderEvent(type, payload) {
  if (!payload) return;
  const list = S.orders || [];

  if (type === 'order:created') {
    if (!list.some(o => o._id === payload._id)) {
      list.unshift(payload);
      S.orders = list;
      invalidateCache('orders');
      blinkSyncDot('#10B981'); // verde para novo
      reRender();
    }
  } else if (type === 'order:updated') {
    const idx = list.findIndex(o => o._id === payload._id);
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...payload };
    } else {
      list.unshift(payload);
    }
    S.orders = list;
    invalidateCache('orders');
    blinkSyncDot('#3B82F6'); // azul para update
    reRender();
  } else if (type === 'order:deleted') {
    S.orders = list.filter(o => o._id !== payload._id);
    invalidateCache('orders');
    blinkSyncDot('#F97316'); // laranja para deletar
    reRender();
  }
}

export function startRealtime() {
  if (_es) { try { _es.close(); } catch(_){} }
  if (!S.token) return; // sem auth, nao tenta

  // EventSource nao aceita header Authorization — passa token via query
  // (validado no middleware do backend). HTTPS garante criptografia.
  const url = `${API}/events?token=${encodeURIComponent(S.token)}`;
  try {
    _es = new EventSource(url, { withCredentials: false });
  } catch (e) {
    console.warn('[realtime] EventSource indisponivel:', e?.message);
    return;
  }

  _es.addEventListener('hello', (e) => {
    console.log('[realtime] conectado:', e.data);
    _backoffMs = 1000; // reset backoff em conexao bem-sucedida
  });

  _es.addEventListener('order:created', (e) => {
    try { applyOrderEvent('order:created', JSON.parse(e.data)); } catch(_){}
  });
  _es.addEventListener('order:updated', (e) => {
    try { applyOrderEvent('order:updated', JSON.parse(e.data)); } catch(_){}
  });
  _es.addEventListener('order:deleted', (e) => {
    try { applyOrderEvent('order:deleted', JSON.parse(e.data)); } catch(_){}
  });

  _es.onerror = () => {
    // Reconnect com backoff exponencial (max 30s). EventSource ja reconecta
    // sozinho a cada ~3s — o close() forca aguardar nosso backoff.
    if (_es) try { _es.close(); } catch(_){}
    _es = null;
    setTimeout(() => { startRealtime(); }, _backoffMs);
    _backoffMs = Math.min(_backoffMs * 2, 30000);
  };
}

export function stopRealtime() {
  if (_es) { try { _es.close(); } catch(_){} _es = null; }
}
