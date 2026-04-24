// ── SYNC DE TAXAS DE ENTREGA COM BACKEND ─────────────────────
// Modulo ISOLADO (zero imports internos) para eliminar qualquer
// dependencia circular. Usa apenas fetch + localStorage + window.
// state.saveDeliveryFees() chama window._syncDeliveryFeesToBackend.
const KEY = 'delivery-fees';
const LS_KEY = 'fv_delivery_fees';

// Busca token de sessao (mesma logica do api.js, inline para nao importar)
function getToken() {
  try {
    return localStorage.getItem('fv2_token') || localStorage.getItem('fv_backend_token') || '';
  } catch(_) { return ''; }
}
function getApiBase() {
  // Hardcoded pra evitar import de state.js
  return 'https://florevita-backend-2-0.onrender.com/api';
}

// Fire-and-forget: envia objeto para o backend
function syncToBackend(feesObj) {
  const token = getToken();
  if (!token) return; // nao logado, nada a fazer
  try {
    fetch(getApiBase() + '/settings/' + KEY, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
      },
      body: JSON.stringify({ value: feesObj }),
    }).catch(e => console.warn('[delivery-fees sync] falha:', e.message));
  } catch (e) { console.warn('[delivery-fees sync] throw:', e.message); }
}

// Carrega do backend e sobrescreve cache local. Backend vence conflitos.
export async function loadDeliveryFeesFromBackend() {
  const token = getToken();
  if (!token) return null;
  try {
    const res = await fetch(getApiBase() + '/settings/' + KEY, {
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!res.ok) return null;
    const resp = await res.json().catch(() => null);
    const remote = (resp && typeof resp === 'object')
      ? (resp.value || resp.data || resp)
      : null;
    if (remote && typeof remote === 'object' && !Array.isArray(remote)) {
      try { localStorage.setItem(LS_KEY, JSON.stringify(remote)); } catch(_){}
      // Notifica state.js (que ja leu o localStorage) a recarregar
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('fv:delivery-fees-updated', { detail: remote }));
      }
      return remote;
    }
  } catch (e) {
    console.warn('[delivery-fees] offline:', e.message || e);
  }
  return null;
}

// Registra a ponte no window para state.saveDeliveryFees() chamar
if (typeof window !== 'undefined') {
  window._syncDeliveryFeesToBackend = syncToBackend;
}
