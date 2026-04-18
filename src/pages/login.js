import { S, API } from '../state.js';
import { doLogin, getColabs } from '../services/auth.js';
import { ini } from '../utils/formatters.js';

// Cache em memória dos colabs públicos
let _publicColabs = null;

// Carrega colabs do backend (endpoint público) e re-renderiza
async function loadPublicColabs(){
  if(_publicColabs !== null) return; // já carregou
  try{
    const res = await fetch(API + '/collaborators/public', {
      method: 'GET',
      signal: AbortSignal.timeout(8000)
    });
    if(res.ok){
      const data = await res.json();
      _publicColabs = Array.isArray(data) ? data : [];
      // Salva como cache local (mesmo formato de getColabs)
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
      // Re-renderiza
      import('../main.js').then(m => m.render()).catch(()=>{});
    }
  }catch(e){ /* silencioso — usa fallback local */ }
}

export function renderLogin(){
  const hasBackendToken = !!localStorage.getItem('fv_backend_token');
  // Dispara carregamento assíncrono (sem bloquear render)
  loadPublicColabs();

  // Prefere colabs do backend (se disponíveis); fallback para localStorage
  let colabs = _publicColabs;
  if(!Array.isArray(colabs) || colabs.length === 0){
    colabs = getColabs().filter(c => c.active !== false);
  }

  return`
<div class="auth-wrap">
<div class="auth-card">
  <div class="auth-logo">
    <img src="https://ik.imagekit.io/zt6jfqa5x/logo-floricultura-lacos-eternos.png" alt="Laços Eternos" style="max-width:160px;max-height:80px;object-fit:contain;"/>
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

  ${colabs && colabs.length > 0 ? `
  <div style="margin-top:18px;">
    <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;text-align:center;">
      Entrada rápida — toque no seu nome
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;max-height:240px;overflow-y:auto;padding:4px;">
      ${colabs.map(c=>`
      <button type="button" class="quick-login-card" data-email="${(c.email||'').toLowerCase()}" title="${c.email||''}"
        style="padding:9px 16px;background:#fff;border:1.5px solid var(--border);border-radius:20px;cursor:pointer;font-size:13px;font-weight:600;color:var(--ink);transition:all .15s;white-space:nowrap;">
        ${(c.name||'?').split(' ')[0]}
      </button>`).join('')}
    </div>
  </div>` : `
  <div style="margin-top:14px;text-align:center;font-size:11px;color:var(--muted);">
    🔄 Carregando colaboradores...
  </div>`}

  ${!hasBackendToken ? `
  <div style="margin-top:10px;padding:10px 12px;background:#FFFBEB;border:1px solid #FCD34D;border-radius:8px;font-size:11px;color:#92400E;">
    ⚠️ <strong>Primeira vez neste dispositivo?</strong> Basta fazer login normalmente com seu e-mail e senha.
  </div>` : ''}

  <div style="margin-top:12px;text-align:center;">
    <button id="btn-clear-cache" type="button" style="background:#FEF3C7;border:1px solid #FCD34D;color:#92400E;padding:6px 14px;border-radius:8px;font-size:11px;cursor:pointer;font-weight:600;">
      🧹 Limpar cache (resolve problemas de acesso)
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
    doLogin(document.getElementById('li-email').value, document.getElementById('li-pass').value);
  });
  document.getElementById('li-pass')?.addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('btn-login').click();});
  document.getElementById('btn-clear-cache')?.addEventListener('click',()=>{
    if(confirm('Isso vai limpar todos os dados salvos neste dispositivo e recarregar a página. Continuar?')){
      try{ localStorage.clear(); sessionStorage.clear(); }catch(e){}
      _publicColabs = null;
      location.reload();
    }
  });

  // Botões de login rápido: clica → preenche email → foca senha
  document.querySelectorAll('.quick-login-card').forEach(btn => {
    btn.addEventListener('click', () => {
      const email = btn.getAttribute('data-email');
      const emailEl = document.getElementById('li-email');
      const passEl = document.getElementById('li-pass');
      if(emailEl) emailEl.value = email;
      // Destaca o botão selecionado em rosa
      document.querySelectorAll('.quick-login-card').forEach(b => {
        b.style.borderColor = 'var(--border)';
        b.style.background = '#fff';
        b.style.color = 'var(--ink)';
      });
      btn.style.borderColor = 'var(--rose)';
      btn.style.background = 'var(--rose)';
      btn.style.color = '#fff';
      if(passEl){ passEl.focus(); passEl.value = ''; }
    });
  });
}
