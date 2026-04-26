// ── STORE DE NOTIFICACOES (persistente) ──────────────────────
// Centraliza todas as notificacoes do sistema. Tempo exibido no card
// usa firstSeenAt POR USUARIO — assim 'fulana' que loga 16 min depois
// ve '⏱️ 16 min', enquanto outra usuaria que viu na hora ve '⏱️ agora'.
//
// Cada notificacao: {
//   id, type, title, body, ts (criacao global),
//   read, dismissed,
//   firstSeenAt: { [userId]: number },  // primeira visualizacao por user
//   meta: { ... }
// }

const STORAGE_KEY = 'fv_notifications_v1';
const MAX_NOTIFS  = 200; // limite p/ nao explodir localStorage

// Helper: obtem o usuario logado (lazy import para evitar circular)
function getCurrentUser(){
  try {
    const raw = localStorage.getItem('fv_session');
    if (!raw) return null;
    return JSON.parse(raw)?.user || null;
  } catch(_) { return null; }
}
function getCurrentUid(){
  const u = getCurrentUser();
  return u ? String(u._id || u.id || u.email || 'anon') : 'anon';
}

let _cache = null;
const _listeners = new Set();

function load(){
  if (_cache) return _cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    _cache = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(_cache)) _cache = [];
  } catch(_) { _cache = []; }
  return _cache;
}

function persist(){
  if (!_cache) return;
  // Mantem so as MAX_NOTIFS mais recentes (corte por ts desc)
  if (_cache.length > MAX_NOTIFS) {
    _cache.sort((a,b) => (b.ts||0) - (a.ts||0));
    _cache = _cache.slice(0, MAX_NOTIFS);
  }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_cache)); } catch(_){}
  _listeners.forEach(fn => { try { fn(); } catch(_){} });
}

// Backend: registra evento de notificacao (fire-and-forget)
async function recordEventBackend(notifId, notifType, action, meta){
  try {
    const { POST } = await import('./api.js');
    POST('/notifications/events', { notifId, notifType, action, meta }).catch(()=>{});
  } catch(_){}
}

// Adiciona uma nova notificacao (se ja existe pelo id, mantem firstSeenAt
// existentes e atualiza ts da ultima exibicao em meta.lastShownAt).
export function addNotification(n){
  if (!n || !n.id) return;
  const list = load();
  const idx = list.findIndex(x => x.id === n.id);
  const merged = {
    id: n.id,
    type: n.type || 'info',
    title: n.title || '',
    body: n.body || '',
    ts: n.ts || Date.now(),
    read: false,
    dismissed: false,
    firstSeenAt: {},
    meta: n.meta || {},
  };
  if (idx >= 0) {
    // Preserva firstSeenAt e read entre re-emissoes
    merged.firstSeenAt = list[idx].firstSeenAt || {};
    merged.read = list[idx].read;
    merged.dismissed = false;
    // Atualiza meta.lastShownAt
    merged.meta = { ...(list[idx].meta||{}), ...(n.meta||{}), lastShownAt: Date.now() };
    list[idx] = merged;
  } else {
    merged.meta.lastShownAt = Date.now();
    list.push(merged);
  }
  persist();
}

// Marca que o usuario ATUAL viu esta notificacao pela primeira vez agora.
// Se ja tinha firstSeenAt, mantem o valor antigo. Tambem dispara evento
// 'seen' no backend (apenas na primeira vez).
export function markSeenByCurrentUser(notifId){
  const uid = getCurrentUid();
  const list = load();
  const it = list.find(n => n.id === notifId);
  if (!it) return null;
  if (!it.firstSeenAt) it.firstSeenAt = {};
  if (!it.firstSeenAt[uid]) {
    it.firstSeenAt[uid] = Date.now();
    persist();
    recordEventBackend(notifId, it.type, 'seen', it.meta);
  }
  return it.firstSeenAt[uid];
}

// Retorna o timestamp que o usuario ATUAL deve usar para calcular '⏱️ X min'
// — primeira vez que ela viu esta notif (ou agora se nunca viu).
export function getFirstSeenForCurrent(notifId){
  const uid = getCurrentUid();
  const list = load();
  const it = list.find(n => n.id === notifId);
  if (!it || !it.firstSeenAt) return Date.now();
  return it.firstSeenAt[uid] || Date.now();
}

// Lista todas as notificacoes (mais recentes primeiro)
// opts.includeDismissed = true para mostrar tambem as descartadas
export function getNotifications(opts = {}){
  const list = load();
  const filtered = opts.includeDismissed ? list : list.filter(n => !n.dismissed);
  return [...filtered].sort((a,b) => (b.ts||0) - (a.ts||0));
}

// Conta de nao-lidas (para o badge do sino)
export function getUnreadCount(){
  return load().filter(n => !n.dismissed && !n.read).length;
}

// Marca uma notificacao como lida + grava evento backend
export function markAsRead(id){
  const list = load();
  const it = list.find(n => n.id === id);
  if (it && !it.read) {
    it.read = true; persist();
    recordEventBackend(id, it.type, 'read', it.meta);
  }
}

// Marca TODAS como lidas
export function markAllAsRead(){
  const list = load();
  let changed = false;
  list.forEach(n => {
    if (!n.read) {
      n.read = true; changed = true;
      recordEventBackend(n.id, n.type, 'read', n.meta);
    }
  });
  if (changed) persist();
}

// Descartar + grava evento backend
export function dismissNotification(id){
  const list = load();
  const it = list.find(n => n.id === id);
  if (it && !it.dismissed) {
    it.dismissed = true; it.read = true; persist();
    recordEventBackend(id, it.type, 'dismissed', it.meta);
  }
}

// Registra clique (whatsapp / open-order) sem mudar estado da notif
export function recordClick(id, action){
  const list = load();
  const it = list.find(n => n.id === id);
  if (!it) return;
  recordEventBackend(id, it.type, action, it.meta);
}

// Limpar TODAS — esvazia o store
export function clearAllNotifications(){
  _cache = [];
  try { localStorage.removeItem(STORAGE_KEY); } catch(_){}
  _listeners.forEach(fn => { try { fn(); } catch(_){} });
}

// Subscribe (re-render quando o store muda)
export function onNotificationsChange(fn){
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}
