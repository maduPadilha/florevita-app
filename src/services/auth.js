import { S, API, PERMS_DEFAULT } from '../state.js';
import { GET, POST, PUT } from './api.js';
import { toast } from '../utils/helpers.js';

// ── SESSION ──────────────────────────────────────────────────
export function saveSession(token, user){
  // Limpa caches que podem ter permissões antigas/obsoletas
  try{
    localStorage.removeItem('fv_colabs');
    localStorage.removeItem('fv_user_extra');
    localStorage.removeItem('fv_perms');
  }catch(e){}

  S.token = token; S.user = user;
  localStorage.setItem('fv2_token', token);
  localStorage.setItem('fv2_user', JSON.stringify(user));
  localStorage.setItem('fv2_last_activity', Date.now().toString());
  // Salva token backend para uso de colaboradores locais
  if(token && !token.startsWith('local_')){
    localStorage.setItem('fv_backend_token', token);
  }
}

export function loadSession(){
  const t = localStorage.getItem('fv2_token');
  const u = localStorage.getItem('fv2_user');
  const lastActivity = parseInt(localStorage.getItem('fv2_last_activity')||'0');
  // Auto-logout após 8 horas de inatividade
  // Estende a sessão automaticamente (não força logout após 8h se token válido)
  if(t && u){
    // Atualiza lastActivity para evitar logout por inatividade
    localStorage.setItem('fv2_last_activity', Date.now().toString());
    // Se o token tem mais de 6h, avisa que vai precisar fazer login em breve
    try{
      const payload = JSON.parse(atob(t.split('.')[1]));
      const expMs = payload.exp * 1000;
      const now   = Date.now();
      const remainMin = Math.round((expMs - now) / 60000);
      if(expMs < now){
        // Token já expirou — limpa e exige novo login
        console.warn('[session] Token JWT expirado — fazendo logout');
        localStorage.removeItem('fv2_token');
        localStorage.removeItem('fv2_user');
        return false;
      }
      if(remainMin < 60 && remainMin > 0){
        setTimeout(()=>toast('⏰ Sessão expira em '+remainMin+'min — salve e refaça login em breve.', true), 3000);
      }
    }catch(_e){}
    S.token = t; S.user = mergeUserExtra(JSON.parse(u));
    // Restaura a página que o usuário estava antes de recarregar
    const savedPage = localStorage.getItem('fv_page');
    if(savedPage) S.page = savedPage;
    // Revalida sessão no backend para atualizar permissões (modulos, role)
    refreshUserFromBackend();
    return true;
  }
  if(t) { localStorage.removeItem('fv2_token'); localStorage.removeItem('fv2_user'); }
  return false;
}

// Revalida user no backend — atualiza S.user com permissões frescas
// Exportado para permitir chamada manual após mudanças de permissão.
export async function refreshUserFromBackend(silent = false){
  if(!S.token) return;
  try{
    const res = await fetch(API+'/auth/validate', {
      headers: { 'Authorization': 'Bearer '+S.token },
      signal: AbortSignal.timeout(10000),
    });
    if(!res.ok){
      // Token inválido/expirado — força logout
      if(res.status === 401){
        console.warn('[auth] Token inválido — fazendo logout');
        localStorage.removeItem('fv2_token');
        localStorage.removeItem('fv2_user');
        S.user = null; S.token = null;
        import('../main.js').then(m => m.render()).catch(()=>{});
      }
      return;
    }
    const d = await res.json().catch(()=>null);
    if(!d?.user) return;

    // Detecta se houve mudança nas permissões
    const oldMod = JSON.stringify(S.user?.modulos || {});
    const newMod = JSON.stringify(d.user?.modulos || {});
    const changed = oldMod !== newMod || S.user?.active !== d.user?.active;

    // Se foi desativado, força logout
    if(d.user.active === false){
      try{ toast('⚠️ Seu acesso foi desativado pelo administrador', true); }catch(_){}
      localStorage.removeItem('fv2_token');
      localStorage.removeItem('fv2_user');
      S.user = null; S.token = null;
      import('../main.js').then(m => m.render()).catch(()=>{});
      return;
    }

    // Merge: dados do backend têm prioridade sobre cache local
    const freshUser = { ...S.user, ...d.user, modulos: d.user.modulos };
    S.user = freshUser;
    localStorage.setItem('fv2_user', JSON.stringify(freshUser));

    // Se mudou permissão enquanto está logado, avisa e re-renderiza
    if(changed && !silent){
      try{ toast('🔄 Suas permissões foram atualizadas'); }catch(_){}
      import('../main.js').then(m => m.render()).catch(()=>{});
    } else if(changed){
      import('../main.js').then(m => m.render()).catch(()=>{});
    }
  }catch(e){ /* offline — mantém cache local */ }
}

// ── POLLING DE PERMISSÕES ─────────────────────────────────────
// Revalida a cada 60s se o usuário continua autorizado
// e se os módulos foram alterados pelo admin.
let _permPollTimer = null;
export function startPermissionPolling(){
  if(_permPollTimer) return;
  _permPollTimer = setInterval(() => {
    if(S.token && S.user){
      refreshUserFromBackend(true).catch(()=>{});
    }
  }, 60000); // 60 segundos
}
export function stopPermissionPolling(){
  if(_permPollTimer){ clearInterval(_permPollTimer); _permPollTimer = null; }
}

// Atualiza timestamp de atividade em qualquer interação
['click','keydown','touchstart'].forEach(ev=>{
  document.addEventListener(ev, ()=>{
    if(S.token) localStorage.setItem('fv2_last_activity', Date.now().toString());
  }, {passive:true});
});

export function logout(){
  // stopPolling is in polling.js — import dynamically to avoid circular deps
  import('./polling.js').then(m => { if(m.stopPolling) m.stopPolling(); }).catch(()=>{});
  // Para também o polling de permissões
  stopPermissionPolling();
  // Limpa todos os caches de sessão
  try{
    localStorage.removeItem('fv2_token');
    localStorage.removeItem('fv2_user');
    localStorage.removeItem('fv_page');
    localStorage.removeItem('fv_colabs');
    localStorage.removeItem('fv_user_extra');
    localStorage.removeItem('fv_perms');
  }catch(e){}
  S.user = null;
  S.token = null;
  import('../main.js').then(m => m.render());
}

// ── USER EXTRA (role/unit/display name stored locally) ────────
export function getUserExtra(id){
  try{ return JSON.parse(localStorage.getItem('fv_user_extra')||'{}')[id]||{}; }catch(e){ return {}; }
}

export function setUserExtra(id, data){
  try{
    const all = JSON.parse(localStorage.getItem('fv_user_extra')||'{}');
    all[id] = {...(all[id]||{}), ...data};
    localStorage.setItem('fv_user_extra', JSON.stringify(all));
  }catch(e){}
}

export function mergeUserExtra(u){
  if(!u || !u._id) return u;
  const extra = getUserExtra(u._id);
  // Remove campos críticos do extra — SEMPRE vêm do backend (fonte de verdade)
  const safeExtra = {...extra};
  delete safeExtra.modulos;
  delete safeExtra.role;
  delete safeExtra.cargo;
  delete safeExtra.active;
  delete safeExtra.ativo;
  delete safeExtra.isLocalColab;
  return {...u, ...safeExtra};
}

// ── LOGIN ────────────────────────────────────────────────────
export async function doLogin(email, pass){
  const emailClean = (email||'').trim().toLowerCase();
  const passClean  = (pass||'').trim();
  if(!emailClean || !passClean){
    toast('❌ Informe e-mail e senha', true); return;
  }

  // Mostra spinner com mensagem informativa
  S.loading = true;
  S._loginMsg = '🔄 Conectando ao servidor...';
  import('../main.js').then(m => m.render());

  // ── PASSO 1: Backend (timeout estendido para acordar o Render) ──
  let backendOk = false;
  let backendErr = '';
  try{
    // Tenta acordar o servidor antes (warm-up ping)
    const warmup = await fetch(API+'/auth/login', {
      method:'POST', signal: AbortSignal.timeout(35000),  // 35s para Render acordar
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({email:emailClean, password:passClean})
    });
    const d = await warmup.json().catch(()=>null);

    if(d?.token){
      backendOk = true;
      const user = mergeUserExtra(d.user||{});
      user.email = user.email || emailClean;

      // Se backend retornou dados completos (role + modulos), usa sem override.
      // Apenas aplica colab local como fallback se backend não tiver esses campos.
      const hasBackendPerms = user.modulos && typeof user.modulos === 'object';
      if(!hasBackendPerms){
        const colab = findColab(emailClean);
        if(colab){
          if(colab.active===false){
            S.loading=false; S._loginMsg=null;
            import('../main.js').then(m => m.render());
            toast('❌ Acesso desativado pelo Administrador.', true); return;
          }
          user.name         = colab.name    || user.name;
          user.role         = colab.cargo   || user.role;
          user.unit         = colab.unidade || user.unit;
          user.modulos      = colab.modulos || {};
          user.isLocalColab = true;
          user.colabId      = colab.id;
          user.email        = colab.email   || user.email;
          // Registra backendId no cadastro local
          if(user._id && !colab.backendId){
            const all = getColabs();
            const idx = all.findIndex(c=>c.id===colab.id);
            if(idx>=0){ all[idx].backendId=user._id; saveColabs(all); }
          }
        }
      }

      // Salva token para uso de outros colaboradores no mesmo navegador
      if(d.token && !d.token.startsWith('local_')){
        localStorage.setItem('fv_backend_token', d.token);
      }

      saveSession(d.token, user);
      // Registra login bem-sucedido no histórico local (para mostrar recentes)
      try { const { addRecentLogin } = await import('../pages/login.js');
        addRecentLogin(user.email || emailClean); } catch(_){}
      S.loading=true; S._loginMsg='🌸 Carregando...';
      import('../main.js').then(m => m.render());

      // loadData is in data.js — import dynamically
      const { loadData } = await import('./cache.js');
      await loadData().catch(()=>{});
      // Sincroniza config do servidor (certificado, CSC, tokens, logo, etc)
      // para garantir que admin vê os mesmos dados em qualquer dispositivo
      import('../pages/config.js').then(m => m.loadConfig()).catch(()=>{});
      S.loading=false; S._loginMsg=null;
      _redirectAfterLogin(user, colab);
      import('../main.js').then(m => m.render());
      import('./polling.js').then(m => m.startPolling(8000));
      startPermissionPolling();
      if(!colab){
        import('../pages/backup.js').then(m => { if(m.startAutoBackup) m.startAutoBackup(); }).catch(()=>{});
      }
      toast('✅ Bem-vindo(a), '+user.name+'!');
      // Mensagem motivacional do dia (com delay para render completar)
      setTimeout(()=>{
        import('../main.js').then(m => {
          if(m.showMensagemMotivacional) m.showMensagemMotivacional(user.name, user._id||user.email);
        }).catch(()=>{});
      }, 600);
      if(_isEntregador()) setTimeout(()=>{
        GET('/orders').then(o=>{ if(o?.length){ S.orders=o; import('../main.js').then(m => m.render()); } }).catch(()=>{});
      }, 1500);
      return;
    } else if(d?.message){
      backendErr = d.message;
    }
  }catch(err){
    // Guarda o tipo de erro para diagnóstico (NÃO trava o loading — só registra o erro)
    if(err.name==='TimeoutError'||err.name==='AbortError'){
      backendErr = 'timeout';
    } else {
      backendErr = err.message||'';
    }
  }

  // ── PASSO 2: Colaborador local (fv_colabs) ──────────────────
  // Funciona mesmo offline, mas requer que o admin tenha cadastrado
  // no módulo Colaboradores neste mesmo navegador.
  const colabs = getColabs();
  const colab = colabs.find(c=>(c.email||'').trim().toLowerCase()===emailClean);

  if(colab){
    if(!colab.senha){
      S.loading=false; S._loginMsg=null;
      import('../main.js').then(m => m.render());
      toast('❌ Sem senha definida. Peça ao admin para configurar no módulo Colaboradores.', true); return;
    }
    if(colab.senha.trim() !== passClean){
      S.loading=false; S._loginMsg=null;
      import('../main.js').then(m => m.render());
      toast('❌ Senha incorreta.', true); return;
    }
    if(colab.active===false){
      S.loading=false; S._loginMsg=null;
      import('../main.js').then(m => m.render());
      toast('❌ Acesso desativado. Fale com o Administrador.', true); return;
    }

    const cachedToken = localStorage.getItem('fv_backend_token');
    const user = {
      _id: colab.backendId||colab.id, id: colab.id,
      colabId: colab.id,
      name: colab.name, email: colab.email,
      role: colab.cargo||'Atendimento',
      unit: colab.unidade||'Loja Novo Aleixo',
      active: true, isLocalColab: true,
    };

    if(cachedToken){
      saveSession(cachedToken, user);
      S.user.isLocalColab = true;
      S.loading=true; S._loginMsg='🌸 Carregando dados...';
      import('../main.js').then(m => m.render());
      try{
        const { loadData } = await import('./cache.js');
        await loadData();
      }catch(e){}
    } else {
      saveSession('local_'+colab.id, user);
    }

    S.loading=false; S._loginMsg=null;
    _redirectAfterLogin(user, colab);
    import('../main.js').then(m => m.render());
    import('./polling.js').then(m => m.startPolling(8000));
    toast('✅ Bem-vindo(a), '+user.name+'!'+(cachedToken?'':' (modo offline)'));
    // Mensagem motivacional do dia
    setTimeout(()=>{
      import('../main.js').then(m => {
        if(m.showMensagemMotivacional) m.showMensagemMotivacional(user.name, colab.id||user.email);
      }).catch(()=>{});
    }, 600);
    if(_isEntregador()) setTimeout(()=>{
      GET('/orders').then(o=>{ if(o?.length){ S.orders=o; import('../main.js').then(m => m.render()); } }).catch(()=>{});
    }, 1500);
    return;
  }

  // ── Falhou em tudo: mensagem clara ───────────────────────────
  S.loading=false; S._loginMsg=null;
  import('../main.js').then(m => m.render());

  if(backendErr==='timeout'){
    toast('⏱️ Servidor demorando a responder (pode estar acordando). Aguarde 30s e tente novamente. Se o erro persistir, verifique sua conexão.', true);
  } else if(backendErr && /senha|password|invalid|incorrect|unauthorized|wrong/i.test(backendErr)){
    toast('❌ E-mail ou senha incorretos. Verifique os dados e tente novamente.', true);
  } else if(backendErr && /not found|no user|user not|404/i.test(backendErr)){
    toast('❌ Usuário não encontrado no sistema central.\n\nPeça ao Administrador para:\n1. Ir em Colaboradores\n2. Clicar em 🔄 Sincronizar Todos', true);
  } else if(!colabs.length){
    toast('❌ Acesso negado. Este dispositivo não reconhece seu cadastro.\n\nPeça ao Administrador para clicar em 🔄 Sincronizar Todos no módulo Colaboradores.', true);
  } else {
    toast('❌ Acesso negado. Verifique e-mail e senha, ou peça ao Administrador para sincronizar seu cadastro (🔄 Sincronizar Todos).', true);
  }
}

// ── REDIRECT AFTER LOGIN ─────────────────────────────────────
export function _redirectAfterLogin(user, colab){
  const cargo = colab?.cargo || user.role || '';
  if(cargo==='Entregador' || user.role==='Entregador'){
    S.page='entregador'; return;
  }
  const mods = colab?.modulos||{};
  const MAP = [['dashboard','dashboard'],['pdv','pdv'],['orders','pedidos'],
    ['production','producao'],['delivery','expedicao'],['caixa','caixa'],
    ['financial','financeiro'],['stock','estoque'],['reports','relatorios'],['ponto','ponto']];
  const first = MAP.find(([m])=>mods[m]);
  if(first) S.page=first[1];
}

// ── USUÁRIOS OCULTADOS (excluídos localmente) ─────────────────
export function getHiddenUsers(){
  try{ return JSON.parse(localStorage.getItem('fv_hidden_users')||'[]'); }catch(e){ return []; }
}

export function addHiddenUser(id){
  const h = getHiddenUsers();
  if(!h.includes(id)){ h.push(id); localStorage.setItem('fv_hidden_users', JSON.stringify(h)); }
}

export function removeHiddenUser(id){
  const h = getHiddenUsers().filter(x => x !== id);
  localStorage.setItem('fv_hidden_users', JSON.stringify(h));
}

export function toggleUser(userId){
  const hidden = getHiddenUsers();
  if(hidden.includes(userId)) removeHiddenUser(userId);
  else addHiddenUser(userId);
  import('../main.js').then(m => m.render());
}

export function isHiddenUser(id){ return getHiddenUsers().includes(id); }

// ── PERMISSÕES POR USUÁRIO (localStorage) ────────────────────
export function getUserPerms(userId){
  const stored = JSON.parse(localStorage.getItem('fv_perms')||'{}');
  const p = stored[userId];
  // Retorna null se não existe OU se é array vazio (sem permissões definidas)
  return (p && p.length > 0) ? p : null;
}

export function setUserPerms(userId, perms){
  const stored = JSON.parse(localStorage.getItem('fv_perms')||'{}');
  stored[userId] = perms;
  localStorage.setItem('fv_perms', JSON.stringify(stored));
}

// ── COLABORADORES — armazenamento local + backend sync ───────
export function getColabs(){
  try{ return JSON.parse(localStorage.getItem('fv_colabs')||'[]'); }catch(e){ return []; }
}

export function saveColabs(list){ localStorage.setItem('fv_colabs', JSON.stringify(list)); }

// Fetch collaborators from /api/collaborators and merge with localStorage
export async function fetchAndMergeColabs(){
  try {
    const apiColabs = await GET('/collaborators').catch(()=>null);
    if(!Array.isArray(apiColabs) || apiColabs.length === 0) return getColabs();

    const local = getColabs();
    const merged = [...local];

    // Index local colabs by email and apiId for fast lookup
    const byEmail = {};
    const byApiId = {};
    local.forEach((c, i) => {
      if(c.email) byEmail[c.email.toLowerCase().trim()] = i;
      if(c.apiId) byApiId[c.apiId] = i;
    });

    let changed = false;
    apiColabs.forEach(ac => {
      const acEmail = (ac.email||'').toLowerCase().trim();
      const acId = ac._id || ac.id;
      const existIdx = byApiId[acId] ?? (acEmail ? byEmail[acEmail] : undefined);

      if(existIdx !== undefined){
        // Update existing local entry with backend data (backend wins for most fields)
        const loc = merged[existIdx];
        let updated = false;
        if(ac.name && ac.name !== loc.name){ loc.name = ac.name; updated = true; }
        if(acEmail && acEmail !== (loc.email||'').toLowerCase().trim()){ loc.email = ac.email; updated = true; }
        if(ac.cargo && ac.cargo !== loc.cargo){ loc.cargo = ac.cargo; updated = true; }
        if(ac.unidade && ac.unidade !== loc.unidade){ loc.unidade = ac.unidade; updated = true; }
        if(ac.active !== undefined && ac.active !== loc.active){ loc.active = ac.active; updated = true; }
        if(ac.modulos && JSON.stringify(ac.modulos) !== JSON.stringify(loc.modulos)){ loc.modulos = ac.modulos; updated = true; }
        if(ac.metas && JSON.stringify(ac.metas) !== JSON.stringify(loc.metas)){ loc.metas = ac.metas; updated = true; }
        if(ac.telefone && !loc.telefone){ loc.telefone = ac.telefone; updated = true; }
        if(ac.phone && !loc.phone){ loc.phone = ac.phone; updated = true; }
        if(ac.pix && !loc.pix){ loc.pix = ac.pix; updated = true; }
        if(ac.comissao !== undefined && loc.comissao === undefined){ loc.comissao = ac.comissao; updated = true; }
        if(acId && !loc.apiId){ loc.apiId = acId; updated = true; }
        if(ac.backendId && !loc.backendId){ loc.backendId = ac.backendId; updated = true; }
        // Sync senha from backend if local has none (allows cross-device login)
        if(ac.senha && !loc.senha){ loc.senha = ac.senha; updated = true; }
        if(updated) changed = true;
      } else {
        // New collaborator from backend — add to local
        merged.push({
          id: 'cb_api_' + acId,
          apiId: acId,
          backendId: ac.backendId || '',
          name: ac.name || '',
          email: ac.email || '',
          phone: ac.phone || ac.telefone || '',
          cargo: ac.cargo || 'Atendimento',
          unidade: ac.unidade || 'Loja Novo Aleixo',
          active: ac.active !== false,
          modulos: ac.modulos || {},
          metas: ac.metas || {},
          senha: ac.senha || '',
          pix: ac.pix || '',
          comissao: ac.comissao,
          telefone: ac.telefone || ac.phone || '',
          _syncedFromAPI: true,
        });
        changed = true;
      }
    });

    if(changed){
      saveColabs(merged);
      console.log('[sync] Colabs merged from API: ' + merged.length + ' total');
    }
    return merged;
  } catch(e){
    console.warn('[fetchAndMergeColabs] error:', e.message);
    return getColabs();
  }
}

// Push a single collaborator to the /api/collaborators backend
export async function pushColabToAPI(colab){
  if(!colab) return null;
  try {
    const payload = {
      name: colab.name, email: colab.email, phone: colab.phone || colab.telefone || '',
      active: colab.active !== false, cargo: colab.cargo, unidade: colab.unidade,
      modulos: colab.modulos, metas: colab.metas, senha: colab.senha || '',
      backendId: colab.backendId || '', pix: colab.pix || '',
      comissao: colab.comissao, telefone: colab.telefone || colab.phone || '',
    };
    let res = null;
    let lastErr = '';

    // 1) Se já tem apiId, tenta atualizar
    if(colab.apiId){
      try { res = await PUT('/collaborators/' + colab.apiId, payload); }
      catch(e){ lastErr = 'PUT: '+e.message; res = null; }
    }

    // 2) Se não criou/atualizou, tenta criar
    if(!res){
      try { res = await POST('/collaborators', payload); }
      catch(e){ lastErr = 'POST: '+e.message; res = null; }
    }

    if(res && (res._id || res.id)){
      const all = getColabs();
      const idx = all.findIndex(c => c.id === colab.id || c.email === colab.email);
      if(idx >= 0){
        all[idx].apiId = res._id || res.id;
        saveColabs(all);
      }
      return res;
    }

    console.warn('[pushColabToAPI]', colab.name, colab.email, '→', lastErr || 'resposta sem _id');
  } catch(e){
    console.warn('[pushColabToAPI] exception:', colab?.name, e.message);
  }
  return null;
}

export function findColab(emailOrId){
  const all = getColabs();
  const q = (emailOrId||'').trim().toLowerCase();
  return all.find(c =>
    c.email?.trim().toLowerCase() === q ||
    c.id === emailOrId ||
    c.backendId === emailOrId
  ) || null;
}

export function _isEntregador(){
  if(S.user?.role==='Entregador') return true;
  // Verifica cargo no registro de colaborador (caso role venha diferente do backend)
  const c = findColab(S.user?.email||S.user?._id);
  return c?.cargo==='Entregador';
}

export function can(mod){
  if(!S.user) return false;

  // Admin: cargo='admin' do backend
  if(S.user.cargo==='admin') return true;
  if(S.user.role==='Administrador') return true;

  // Entregador: acesso restrito
  if(_isEntregador()) return mod==='delivery' || mod==='ponto' || mod==='rota';

  // Colaborador: usa modulos do backend (Collaborator.modulos) se existir
  if(S.user.modulos && typeof S.user.modulos === 'object' && Object.keys(S.user.modulos).length > 0){
    return S.user.modulos[mod]===true;
  }

  // Fallback: permissões padrão por role (quando backend não retornou modulos)
  const p = PERMS_DEFAULT[S.user.role]||[];
  return p.includes('*')||p.includes(mod);
}

// DESABILITADO: essa função criava fv_colabs com PERMS_DEFAULT
// dando módulos errados aos colaboradores. Agora as permissões
// vêm exclusivamente do backend (Collaborator.modulos).
export function autoSyncColabsFromUsers(){
  return; // no-op
  // eslint-disable-next-line no-unreachable
  try{
    if(!S.users?.length) return;
    const existing = getColabs();
    const existingByEmail = {};
    const existingById    = {};
    existing.forEach(c=>{
      if(c.email) existingByEmail[(c.email||'').toLowerCase()] = c;
      if(c.backendId) existingById[c.backendId] = c;
    });
    let changed = false;

    S.users.forEach(u=>{
      if(!u.email || !u.name) return;
      const email = u.email.toLowerCase();
      const found = existingByEmail[email] || existingById[u._id];

      if(found){
        // Atualiza dados que podem ter mudado (email, nome, cargo)
        let updated = false;
        if(found.name !== u.name){ found.name = u.name; updated = true; }
        if((found.email||'').toLowerCase() !== email){ found.email = email; updated = true; }
        if(found.backendId !== u._id){ found.backendId = u._id; updated = true; }
        if(u.role && found.cargo !== u.role){ found.cargo = u.role; updated = true; }
        if(u.unit && found.unidade !== u.unit){ found.unidade = u.unit; updated = true; }
        if(updated) changed = true;
      } else {
        // Cria novo colaborador local baseado no usuário do backend
        const cargo   = u.role || 'Atendimento';
        const mods    = PERMS_DEFAULT[cargo] || [];
        const modObj  = {};
        mods.filter(m=>m!=='*').forEach(m=>{ modObj[m]=true; });
        existing.push({
          id:        'cb_sync_'+u._id,
          backendId: u._id,
          name:      u.name,
          email:     email,
          cargo:     cargo,
          unidade:   u.unit || 'Loja Novo Aleixo',
          active:    u.active !== false,
          senha:     '',
          modulos:   modObj,
          _synced:   true,
        });
        existingByEmail[email] = existing[existing.length-1];
        changed = true;
      }
    });

    if(changed){
      saveColabs(existing);
      console.log('[sync] fv_colabs atualizado: '+existing.length+' colaboradores');
    }
  }catch(e){ console.warn('[sync] autoSyncColabs:', e.message); }
}
