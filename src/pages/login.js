import { S, API } from '../state.js';
import { doLogin, getColabs } from '../services/auth.js';
import { ini } from '../utils/formatters.js';

// Cache em memória dos colabs públicos
let _publicColabs = null;

// ── Histórico de acessos por dispositivo ──────────────────────
// Mantém lista ordenada dos últimos e-mails que logaram neste navegador
const RECENT_KEY = 'fv_recent_logins';
function getRecentLogins(){
  try{ return JSON.parse(localStorage.getItem(RECENT_KEY)||'[]'); }
  catch{ return []; }
}
export function addRecentLogin(email){
  if(!email) return;
  const e = email.toLowerCase();
  let list = getRecentLogins().filter(x => x !== e);
  list.unshift(e);
  list = list.slice(0, 10);
  try{ localStorage.setItem(RECENT_KEY, JSON.stringify(list)); }catch{}
}

// Carrega colabs do backend (endpoint público) e re-renderiza
async function loadPublicColabs(){
  if(_publicColabs !== null) return;
  try{
    const res = await fetch(API + '/collaborators/public', {
      method: 'GET',
      signal: AbortSignal.timeout(8000)
    });
    if(res.ok){
      const data = await res.json();
      _publicColabs = Array.isArray(data) ? data : [];
      try{
        const existing = JSON.parse(localStorage.getItem('fv_colabs')||'[]');
        const byEmail = {};
        existing.forEach(c => { if(c.email) byEmail[c.email.toLowerCase()] = c; });
        _publicColabs.forEach(p => {
          const key = (p.email||'').toLowerCase();
          if(!byEmail[key]){
            byEmail[key] = {
              id: 'srv_' + (p._id || Math.random().toString(36).slice(2)),
              apiId: p._id,
              name: p.name,
              email: p.email,
              cargo: p.cargo || 'Atendimento',
              active: true,
            };
          }
        });
        localStorage.setItem('fv_colabs', JSON.stringify(Object.values(byEmail)));
      }catch(e){/* silencioso */}
      import('../main.js').then(m => m.render()).catch(()=>{});
    }
  }catch(e){/* silencioso */}
}

// Ordena colabs: recentes primeiro, depois por ordem alfabética
function getOrderedColabs(){
  let colabs = _publicColabs;
  if(!Array.isArray(colabs) || colabs.length === 0){
    colabs = getColabs().filter(c => c.active !== false);
  }
  const recent = getRecentLogins();
  const recentSet = new Map(recent.map((e,i) => [e, i]));
  return [...colabs].sort((a,b) => {
    const ea = (a.email||'').toLowerCase();
    const eb = (b.email||'').toLowerCase();
    const ra = recentSet.has(ea) ? recentSet.get(ea) : Infinity;
    const rb = recentSet.has(eb) ? recentSet.get(eb) : Infinity;
    if(ra !== rb) return ra - rb;
    return (a.name||'').localeCompare(b.name||'');
  });
}

export function renderLogin(){
  const hasBackendToken = !!localStorage.getItem('fv_backend_token');
  // Logo customizada via config (admin pode definir em /configuracoes)
  const cfg = JSON.parse(localStorage.getItem('fv_config')||'{}');
  const logoUrl = cfg.loginLogo || cfg.logoLogin || '';

  loadPublicColabs();

  const ordered = getOrderedColabs();
  const showingAll = S._loginShowAll === true;
  const visible = showingAll ? ordered : ordered.slice(0, 3);
  const hasMore = ordered.length > 3;

  const renderColabCard = (c) => `
    <button type="button" class="quick-login-card" data-email="${(c.email||'').toLowerCase()}"
      style="width:100%;background:#fff;border:1.5px solid var(--border);border-radius:14px;padding:12px 14px;cursor:pointer;text-align:left;display:flex;align-items:center;gap:12px;transition:all .15s;margin-bottom:8px;">
      <div class="av" style="width:40px;height:40px;font-size:13px;background:var(--rose);color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0;">${ini(c.name||'?')}</div>
      <div style="flex:1;min-width:0;overflow:hidden;">
        <div style="font-weight:700;font-size:13px;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${c.name||'—'}</div>
        <div style="font-size:11px;color:var(--rose);font-weight:600;margin-top:1px;">${c.cargo||'Colaborador'}</div>
        <div style="font-size:10px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px;">${c.email||''}</div>
      </div>
      <span style="font-size:18px;color:var(--muted);flex-shrink:0;">›</span>
    </button>`;

  return`
<div class="auth-wrap">
<div class="auth-card">
  <div class="auth-logo">
    ${logoUrl
      ? `<img src="${logoUrl}" alt="Logo" style="max-width:260px;max-height:160px;object-fit:contain;"/>`
      : `<div style="font-family:'Playfair Display',serif;font-size:26px;color:var(--rose);font-weight:600;">Laços Eternos 🌸</div>`}
    <span class="sub" style="margin-top:4px;">Sistema de Gestão</span>
  </div>

  ${S.loading
    ? `<div style="text-align:center;padding:30px"><div class="spin"></div><div style="margin-top:12px;font-size:12px;color:var(--muted)">Entrando...</div></div>`
    : `
  <div class="fg">
    <label class="fl">E-mail</label>
    <input class="fi" id="li-email" type="email" placeholder="seu@email.com" autocomplete="username"/>
  </div>
  <div class="fg">
    <label class="fl">Senha</label>
    <input class="fi" id="li-pass" type="password" placeholder="••••••" autocomplete="current-password"/>
  </div>
  <button class="btn btn-primary" id="btn-login"
    style="width:100%;justify-content:center;padding:13px;font-size:15px;margin-top:6px;border-radius:12px;">
    Entrar
  </button>

  ${visible.length > 0 ? `
  <div style="margin-top:20px;">
    <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;text-align:center;">
      ${showingAll ? 'Todos os colaboradores' : 'Entrada rápida'}
    </div>
    <div style="display:flex;flex-direction:column;gap:0;${showingAll ? 'max-height:320px;overflow-y:auto;padding:2px;' : ''}">
      ${visible.map(renderColabCard).join('')}
    </div>
    ${hasMore && !showingAll ? `
    <button type="button" id="btn-login-more"
      style="width:100%;background:transparent;border:1px dashed var(--border);border-radius:12px;padding:10px;cursor:pointer;font-size:12px;color:var(--muted);font-weight:600;margin-top:2px;">
      ⬇️ Ver mais (${ordered.length - 3} colaboradores)
    </button>` : ''}
    ${showingAll ? `
    <button type="button" id="btn-login-less"
      style="width:100%;background:transparent;border:1px dashed var(--border);border-radius:12px;padding:8px;cursor:pointer;font-size:11px;color:var(--muted);margin-top:6px;">
      ⬆️ Recolher
    </button>` : ''}
  </div>` : `
  <div style="margin-top:14px;text-align:center;font-size:11px;color:var(--muted);">
    🔄 Carregando colaboradores...
  </div>`}

  ${!hasBackendToken ? `
  <div style="margin-top:14px;padding:10px 12px;background:#FFFBEB;border:1px solid #FCD34D;border-radius:8px;font-size:11px;color:#92400E;">
    ⚠️ <strong>Primeira vez?</strong> Use seu e-mail e senha normalmente.
  </div>` : ''}

  <div style="margin-top:12px;text-align:center;">
    <button id="btn-clear-cache" type="button" style="background:#FEF3C7;border:1px solid #FCD34D;color:#92400E;padding:6px 14px;border-radius:8px;font-size:11px;cursor:pointer;font-weight:600;">
      🧹 Limpar cache
    </button>
  </div>

  ${S._loginMsg ? `
  <div style="margin-top:14px;padding:14px 16px;background:linear-gradient(135deg,#FDF4F7,#FDE8EF);border:1.5px solid #F4A7B9;border-radius:12px;text-align:center;">
    <div style="font-size:22px;margin-bottom:6px;display:inline-block;animation:spin 2s linear infinite;">🌸</div>
    <div style="font-size:13px;font-weight:600;color:#8B2252;">${S._loginMsg}</div>
    <div style="font-size:11px;color:#C8436A;margin-top:4px;">Por favor, não feche esta tela</div>
  </div>` : ''}`}
</div></div>`;}

export function bindLogin(){
  document.getElementById('btn-login')?.addEventListener('click',()=>{
    const email = document.getElementById('li-email').value;
    const pass  = document.getElementById('li-pass').value;
    // Salva o email no histórico (mesmo que o login falhe — melhora UX geral)
    if(email && email.includes('@')) addRecentLogin(email);
    doLogin(email, pass);
  });
  document.getElementById('li-pass')?.addEventListener('keydown',e=>{
    if(e.key==='Enter') document.getElementById('btn-login').click();
  });
  document.getElementById('btn-clear-cache')?.addEventListener('click',()=>{
    if(confirm('Isso vai limpar todos os dados salvos neste dispositivo e recarregar a página. Continuar?')){
      try{ localStorage.clear(); sessionStorage.clear(); }catch(e){}
      _publicColabs = null;
      location.reload();
    }
  });

  // Ver mais / Recolher
  document.getElementById('btn-login-more')?.addEventListener('click',()=>{
    S._loginShowAll = true;
    import('../main.js').then(m => m.render()).catch(()=>{});
  });
  document.getElementById('btn-login-less')?.addEventListener('click',()=>{
    S._loginShowAll = false;
    import('../main.js').then(m => m.render()).catch(()=>{});
  });

  // Cards de login rápido: clica → preenche email → foca senha
  document.querySelectorAll('.quick-login-card').forEach(btn => {
    btn.addEventListener('click', () => {
      const email = btn.getAttribute('data-email');
      const emailEl = document.getElementById('li-email');
      const passEl = document.getElementById('li-pass');
      if(emailEl) emailEl.value = email;
      document.querySelectorAll('.quick-login-card').forEach(b => {
        b.style.borderColor = 'var(--border)';
        b.style.background = '#fff';
      });
      btn.style.borderColor = 'var(--rose)';
      btn.style.background = 'var(--rose-l)';
      if(passEl){ passEl.focus(); passEl.value = ''; }
    });
  });
}
