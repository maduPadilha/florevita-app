// ── CONFIGURACOES ────────────────────────────────────────────
import { S, API, DELIVERY_FEES as _DELIVERY_FEES_STATE, saveDeliveryFees as _saveDeliveryFees_STATE, setDeliveryFees } from '../state.js';
import { $c, $d } from '../utils/formatters.js';
import { toast, setPage } from '../utils/helpers.js';
import { api } from '../services/api.js';
import { logout } from '../services/auth.js';
import { canManageClientTier } from './clientes.js';
import { recarregarDados } from '../services/cache.js';
import { startPolling, stopPolling } from '../services/polling.js';

// ── Helper: render() via dynamic import ───────────────────────
async function render(){
  const { render:r } = await import('../main.js');
  r();
}

// ── DELIVERY FEES — fonte única: state.js ─────────────────────
// Usa a mesma referência que o PDV (importada de state.js) para garantir
// que edições no admin refletem imediatamente no cálculo de frete.
const DELIVERY_FEES = _DELIVERY_FEES_STATE;
const saveDeliveryFees = _saveDeliveryFees_STATE;
export { DELIVERY_FEES, saveDeliveryFees };

// ── CONFIG LOAD/SAVE (migrated to API with localStorage fallback) ──
// Exportado para ser chamado ao abrir tela e após login (sync entre dispositivos)
export async function loadConfig(){
  try{
    const data = await api('GET','/settings/config');
    const cfg = data?.value && typeof data.value === 'object' ? data.value : (data || {});
    if(cfg && typeof cfg === 'object' && Object.keys(cfg).length > 0){
      localStorage.setItem('fv_config', JSON.stringify(cfg));
      return cfg;
    }
  }catch(e){ /* fallback to localStorage */ }
  return JSON.parse(localStorage.getItem('fv_config')||'{}');
}

// Lazy sync ao abrir a tela de Configurações — pega a versão mais recente do backend
let _cfgFetched = false;
function triggerConfigFetch(){
  if(_cfgFetched) return;
  _cfgFetched = true;
  loadConfig().then(cfg => {
    // Re-renderiza se a config do backend é diferente da local (pra refletir nos inputs)
    const localStr = localStorage.getItem('fv_config') || '{}';
    if(JSON.stringify(cfg) !== localStr){
      localStorage.setItem('fv_config', JSON.stringify(cfg));
    }
    if(S.page === 'config'){
      import('../main.js').then(m => m.render()).catch(()=>{});
    }
  }).catch(()=>{});
}

async function saveConfig(cfg){
  localStorage.setItem('fv_config', JSON.stringify(cfg));
  // Backend espera { value: ... } para salvar no MongoDB (Settings schema)
  try{ await api('PUT','/settings/config', { value: cfg }); }catch(e){ /* saved locally */ }
}

async function loadNotifCfg(){
  try{
    const data = await api('GET','/settings/notif-cfg');
    const cfg = data?.value && typeof data.value === 'object' ? data.value : (data || {});
    if(cfg && typeof cfg === 'object' && Object.keys(cfg).length > 0){
      localStorage.setItem('fv_notif_cfg', JSON.stringify(cfg));
      return cfg;
    }
  }catch(e){ /* fallback */ }
  return JSON.parse(localStorage.getItem('fv_notif_cfg')||'{}');
}

async function saveNotifCfg(cfg){
  localStorage.setItem('fv_notif_cfg', JSON.stringify(cfg));
  try{ await api('PUT','/settings/notif-cfg', { value: cfg }); }catch(e){ /* saved locally */ }
}

// ── CARREGA BRANDING PÚBLICO (logo + favicon) ────────────────
// Chamado no boot para que logo/favicon fiquem iguais em TODOS os dispositivos,
// mesmo antes do login (não depende de localStorage local).
export async function loadPublicBranding(){
  const url = API + '/settings/public/branding';
  console.log('[branding] chamando:', url);
  try{
    // Wake-up ping (Render free tier pode estar dormindo).
    // Não espera resposta — só acorda.
    fetch(API + '/health').catch(()=>{});

    // Timeout 8s (era 60s). Render Starter ja nao hiberna; query agora
    // tem cache 5min no backend. Se demorar mais que 8s, abandonamos
    // e usamos o branding local (cache do localStorage).
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 8000);
    let res;
    try {
      res = await fetch(url, { method: 'GET', signal: ctrl.signal });
    } finally { clearTimeout(tid); }

    console.log('[branding] HTTP status:', res.status);
    if(!res.ok){
      console.warn('[branding] endpoint não OK — usando cache local');
      return;
    }
    const data = await res.json();
    console.log('[branding] recebido:', { razao: data?.razao, hasLogo: data?.hasLogo, hasFavicon: data?.hasFavicon });
    if(!data || typeof data !== 'object') return;
    const existing = JSON.parse(localStorage.getItem('fv_config')||'{}');
    const merged = { ...existing, razao: data.razao || existing.razao || '' };
    localStorage.setItem('fv_config', JSON.stringify(merged));

    // Logo/favicon: lazy load APENAS se nao tem no localStorage e backend
    // sinalizou que tem. Endpoint separado /branding-images carrega o
    // base64 (pode ser MB). Nao bloqueia login, roda em background.
    if ((data.hasLogo && !existing.loginLogo) || (data.hasFavicon && !existing.favicon)) {
      setTimeout(() => loadPublicBrandingImages().catch(()=>{}), 2000);
    } else {
      applyFaviconFromConfig();
    }
    console.log('[branding] aplicado no localStorage ✅');
  }catch(e){
    console.warn('[branding] fetch erro:', e.name||'', e.message||e);
  }
}

// Carrega imagens (logo + favicon) em background — endpoint separado
// porque pode ser MB de base64 e nao deve bloquear o login.
export async function loadPublicBrandingImages(){
  try {
    const url = API + '/settings/public/branding-images';
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 15000);
    let res;
    try { res = await fetch(url, { signal: ctrl.signal }); }
    finally { clearTimeout(tid); }
    if (!res.ok) return;
    const data = await res.json();
    if (!data || typeof data !== 'object') return;
    const existing = JSON.parse(localStorage.getItem('fv_config')||'{}');
    localStorage.setItem('fv_config', JSON.stringify({
      ...existing,
      loginLogo: data.loginLogo || existing.loginLogo || '',
      favicon:   data.favicon   || existing.favicon   || '',
    }));
    applyFaviconFromConfig();
    console.log('[branding-images] aplicado em background');
  } catch(e) {
    console.warn('[branding-images] erro:', e.message);
  }
}

// ── FAVICON DINÂMICO ─────────────────────────────────────────
// Aplica (ou remove) o favicon personalizado definido em fv_config.favicon
export function applyFaviconFromConfig(){
  try{
    const cfg = JSON.parse(localStorage.getItem('fv_config')||'{}');
    const url = cfg.favicon || '';
    // Remove qualquer favicon antigo adicionado por este script
    document.querySelectorAll('link[rel="icon"][data-fv-custom],link[rel="shortcut icon"][data-fv-custom]').forEach(l => l.remove());
    if(!url) return; // sem favicon customizado — o padrão do index.html continua
    // Adiciona novo link rel="icon" apontando para a URL
    const link = document.createElement('link');
    link.rel = 'icon';
    link.href = url;
    link.setAttribute('data-fv-custom', '1');
    document.head.appendChild(link);
    // Alguns navegadores preferem shortcut icon
    const link2 = document.createElement('link');
    link2.rel = 'shortcut icon';
    link2.href = url;
    link2.setAttribute('data-fv-custom', '1');
    document.head.appendChild(link2);
  }catch(e){ /* silencioso */ }
}

// ── TI STATE ─────────────────────────────────────────────────
let TI = {
  history: [],
  loading: false,
  lastDiag: null,
};

// ── DIAGNOSTICS ──────────────────────────────────────────────
export function tiRenderDiag(){
  const diag = TI.lastDiag;
  if(!diag) return`
  <div style="text-align:center;padding:20px;color:var(--muted);">
    <button id="btn-run-diag" class="btn btn-primary">Rodar Diagnostico Agora</button>
    <div style="font-size:11px;margin-top:8px;">Analisa o estado do sistema em tempo real</div>
  </div>`;

  return`<div style="display:flex;flex-direction:column;gap:8px;">
    ${diag.items.map(item=>`
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--cream);border-radius:8px;border-left:3px solid ${item.status==='ok'?'#22c55e':item.status==='warn'?'#f59e0b':'#ef4444'};">
      <div>
        <div style="font-weight:600;font-size:12px;">${item.label}</div>
        <div style="font-size:11px;color:var(--muted);">${item.detail}</div>
      </div>
      <span class="ti-badge ${item.status==='ok'?'ti-ok':item.status==='warn'?'ti-warn':'ti-err'}">${item.status==='ok'?'OK':item.status==='warn'?'Atencao':'Erro'}</span>
    </div>`).join('')}
  </div>`;
}

export async function tiRunDiagnostics(){
  toast('Rodando diagnostico...');
  const items = [];

  // 1. Dados carregados
  const totalData = (S.orders?.length||0)+(S.products?.length||0)+(S.clients?.length||0);
  items.push({label:'Dados do servidor', status: totalData>0?'ok':'err',
    detail: totalData>0 ? `${S.orders?.length||0} pedidos, ${S.products?.length||0} produtos, ${S.clients?.length||0} clientes` : S.token ? 'Backend sem resposta — clique em Recarregar Dados' : 'Sessao expirada — faca login novamente'});

  // 2. Token de sessao
  const token = S.token || localStorage.getItem('fv2_token');
  items.push({label:'Sessao do usuario', status: token?'ok':'err',
    detail: token ? `Logado como ${S.user?.name||'?'} (${S.user?.role||'?'})` : 'Token ausente — faca login novamente'});

  // 3. Conectividade com backend
  try{
    const res = await fetch('https://florevita-backend-2-0.onrender.com/api/health',{signal:AbortSignal.timeout(8000)});
    const data = await res.json().catch(()=>({}));
    items.push({label:'Backend (Render)', status: data.status==='ok'?'ok':'warn',
      detail: data.status==='ok' ? `Online - DB: ${data.db||'?'}` : 'Respondeu mas com status diferente de OK'});
  }catch(e){
    items.push({label:'Backend (Render)', status:'err',
      detail: 'Nao respondeu em 8s — pode estar dormindo (free tier)'});
  }

  // 4. Modal preso
  items.push({label:'Modal/janela presa', status: S._modal?'warn':'ok',
    detail: S._modal ? 'Ha um modal aberto — pode bloquear botoes' : 'Nenhum modal travado'});

  // 5. IA travada
  items.push({label:'IA Assistente', status: S._iaLoading?'warn':'ok',
    detail: S._iaLoading ? 'IA esta carregando ha mais de 30s — pode estar travada' : 'Sem carregamento pendente'});

  // 6. Rota IA
  try{
    const res = await fetch('https://florevita-backend-2-0.onrender.com/api/ia',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:'ping'}],context:{}}),signal:AbortSignal.timeout(10000)});
    const data = await res.json().catch(()=>({}));
    if(res.status===404)     items.push({label:'Rota IA (/api/ia)', status:'err', detail:'Rota nao encontrada — atualize o app.js no backend'});
    else if(res.status===500) items.push({label:'Rota IA (/api/ia)', status:'warn', detail:'Erro interno — verifique OPENAI_API_KEY no Render'});
    else if(data.reply)      items.push({label:'Rota IA (/api/ia)', status:'ok', detail:'IA funcionando corretamente'});
    else                     items.push({label:'Rota IA (/api/ia)', status:'warn', detail:'Respondeu sem campo reply: '+JSON.stringify(data).slice(0,60)});
  }catch(e){
    items.push({label:'Rota IA (/api/ia)', status:'warn', detail:'Timeout ao testar IA — backend pode estar acordando'});
  }

  // 7. localStorage
  try{
    let total=0;
    for(let k in localStorage){const v=localStorage.getItem(k);if(v)total+=v.length;}
    const kb = total/1024;
    items.push({label:'localStorage', status: kb>4000?'warn':'ok',
      detail: kb.toFixed(0)+'KB usados de ~5000KB maximo'});
  }catch(e){
    items.push({label:'localStorage', status:'warn', detail:'Nao foi possivel ler o localStorage'});
  }

  // 8. Cache de dados
  const cache = localStorage.getItem('fv_data_cache');
  if(cache){
    try{
      const c = JSON.parse(cache);
      const age = Math.round((Date.now()-(c.savedAt||0))/60000);
      items.push({label:'Cache local', status: age>120?'warn':'ok',
        detail: `Cache de ${age} minutos atras com ${c.products?.length||0} produtos`});
    }catch(e){ items.push({label:'Cache local', status:'warn', detail:'Cache corrompido'}); }
  } else {
    items.push({label:'Cache local', status:'warn', detail:'Sem cache — sistema vulneravel a falhas de conexao'});
  }

  TI.lastDiag = {items, time: new Date().toLocaleTimeString('pt-BR')};
  render();

  // Auto-suggest fix via AI
  const erros = items.filter(i=>i.status==='err').map(i=>i.label);
  if(erros.length > 0 && !TI.history.length){
    setTimeout(()=>tiChat(`Diagnostico automatico encontrou estes erros: ${erros.join(', ')}. O que devo fazer?`), 500);
  }
}

// ── CORRECOES RAPIDAS ────────────────────────────────────────
export function tiFix(tipo){
  switch(tipo){
    case 'cache':
      localStorage.removeItem('fv_data_cache');
      toast('Cache limpo! Recarregando dados...');
      setTimeout(()=>recarregarDados(), 300);
      break;

    case 'state':
      S._modal=''; S.loading=false; S._iaLoading=false;
      clearTimeout(window._iaTimer);
      render();
      toast('Estado do sistema resetado!');
      break;

    case 'modal':
      S._modal='';
      const mr = document.getElementById('modal-root');
      if(mr){ mr.innerHTML=''; mr._currentModal=''; }
      render();
      toast('Modal fechado!');
      break;

    case 'polling':
      stopPolling();
      setTimeout(()=>{ startPolling(3000); toast('Polling reiniciado!'); }, 500);
      break;

    case 'ia':
      S._iaLoading = false;
      clearTimeout(window._iaTimer);
      TI.loading = false;
      render();
      toast('IA resetada! Pode usar normalmente.');
      break;

    case 'recarregar':
      recarregarDados();
      break;

    case 'full':
      // Recuperacao completa
      S._modal=''; S.loading=false; S._iaLoading=false; TI.loading=false;
      clearTimeout(window._iaTimer);
      const mr2 = document.getElementById('modal-root');
      if(mr2){ mr2.innerHTML=''; mr2._currentModal=''; }
      stopPolling();
      setTimeout(async()=>{
        await recarregarDados();
        startPolling(3000);
        toast('Recuperacao completa realizada! Sistema reiniciado.');
      }, 300);
      break;
  }
  setTimeout(()=>render(), 200);
}

// ── CHAT TI ──────────────────────────────────────────────────
export function tiChat(msg){
  if(!msg||!msg.trim()||TI.loading) return;
  msg = msg.trim();
  TI.history = [...TI.history, {role:'user', content:msg}];
  TI.loading = true;
  render();
  setTimeout(()=>{const el=document.getElementById('ti-chat-wrap');if(el)el.scrollTop=el.scrollHeight;},80);

  // Monta contexto do sistema para o especialista TI
  const diagSummary = TI.lastDiag
    ? TI.lastDiag.items.map(i=>`${i.label}: ${i.status==='ok'?'OK':i.detail}`).join('\n')
    : 'Diagnostico nao rodado ainda.';

  const sysContext = `
ESTADO DO SISTEMA AGORA:
- Pedidos: ${S.orders?.length||0} | Produtos: ${S.products?.length||0} | Clientes: ${S.clients?.length||0}
- Usuario: ${S.user?.name||'?'} (${S.user?.role||'?'})
- Modal aberto: ${S._modal?'SIM':'Nao'} | IA carregando: ${S._iaLoading?'SIM':'Nao'}
- Backend: florevita-backend-2-0.onrender.com
- Tecnologia: HTML unico + JavaScript vanilla + MongoDB Atlas + Render

ULTIMO DIAGNOSTICO:
${diagSummary}

CORRECOES DISPONIVEIS (usuario pode executar):
- tiFix('cache') - Limpa cache
- tiFix('state') - Reseta estado
- tiFix('modal') - Fecha modal preso
- tiFix('polling') - Reinicia polling
- tiFix('ia') - Reseta IA
- tiFix('full') - Recuperacao completa
`;

  const systemPrompt = `Voce e o Agente TI especialista da Floricultura Lacos Eternos em Manaus/AM.
Voce e especialista no sistema FloreVita — um ERP em HTML unico com JavaScript vanilla, backend Node.js no Render, MongoDB Atlas e frontend no Vercel.

Sua missao: diagnosticar e resolver bugs, erros e falhas do sistema.

Sempre que identificar um problema:
1. Explique o que esta acontecendo em linguagem simples
2. Diga a causa mais provavel
3. De a solucao passo a passo
4. Mencione qual correcao rapida usar (tiFix) se aplicavel
5. Seja direto e objetivo — sem textos longos desnecessarios

${sysContext}

Responda em portugues brasileiro. Seja tecnico mas acessivel.`;

  fetch('https://florevita-backend-2-0.onrender.com/api/ia', {
    method:'POST',
    headers:{'Content-Type':'application/json', ...(S.token?{'Authorization':'Bearer '+S.token}:{})},
    body: JSON.stringify({
      messages: [...TI.history.map(m=>({role:m.role,content:m.content}))],
      context: {systemPrompt}
    })
  })
  .then(async res=>{
    const text = await res.text();
    let data={};
    try{data=JSON.parse(text);}catch(e){data={error:text.slice(0,100)};}
    if(!res.ok) throw new Error(data.error||'Erro '+res.status);
    return data;
  })
  .then(data=>{
    const reply = data.reply||'Nao consegui analisar o problema agora.';
    TI.history=[...TI.history,{role:'assistant',content:reply}];
  })
  .catch(e=>{
    let errMsg = `Erro ao consultar o especialista: ${e.message}\n\nTente as correcoes rapidas ao lado ou acesse os Logs no Render.`;
    if(e.message.includes('404')) errMsg = 'Rota /api/ia nao existe no backend.\n\nAdicione a rota no app.js do florevita-backend conforme as instrucoes anteriores.';
    TI.history=[...TI.history,{role:'assistant',content:errMsg}];
  })
  .finally(()=>{
    TI.loading=false;
    render();
    setTimeout(()=>{const el=document.getElementById('ti-chat-wrap');if(el)el.scrollTop=el.scrollHeight;},100);
  });
}

// ── RESET DO SISTEMA ─────────────────────────────────────────
export function showResetModal(){
  S._modal = `<div class="mo" id="mo">
  <div class="mo-box" style="max-width:480px;text-align:center;" onclick="event.stopPropagation()">
    <div style="font-size:48px;margin-bottom:10px">&#9888;&#65039;</div>
    <div style="font-family:'Playfair Display',serif;font-size:20px;font-weight:700;color:var(--red);margin-bottom:8px">
      Resetar Sistema
    </div>
    <div style="font-size:13px;color:var(--muted);margin-bottom:20px;line-height:1.6;">
      Essa acao apagara <strong>TODOS os dados</strong> do sistema:<br>
      produtos, clientes, pedidos, colaboradores, estoque e financeiro.<br><br>
      <strong style="color:var(--red)">Essa acao NAO pode ser desfeita!</strong>
    </div>
    <div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;padding:14px;margin-bottom:16px;text-align:left;">
      <div style="font-size:12px;color:var(--red);font-weight:600;margin-bottom:6px;">
        Para confirmar, digite exatamente:
      </div>
      <div style="font-family:monospace;font-size:14px;background:#fff;padding:6px 10px;border-radius:4px;border:1px solid #FECACA;margin-bottom:10px;">
        RESETAR SISTEMA
      </div>
      <input type="text" id="reset-confirm-input" placeholder="Digite aqui..."
        style="width:100%;padding:8px 10px;border:2px solid #ddd;border-radius:6px;font-size:14px;box-sizing:border-box;"/>
    </div>
    <div style="display:flex;gap:10px;justify-content:center;">
      <button class="btn btn-ghost" id="btn-reset-cancel">Cancelar</button>
      <button id="btn-confirm-reset" class="btn btn-red" disabled style="background:var(--red);color:#fff;">
        Confirmar Reset
      </button>
    </div>
  </div></div>`;
  render();
  // Bind after render
  setTimeout(()=>{
    const input = document.getElementById('reset-confirm-input');
    if(input) input.oninput = ()=>{
      const btn = document.getElementById('btn-confirm-reset');
      if(btn) btn.disabled = input.value !== 'RESETAR SISTEMA';
    };
    const cancelBtn = document.getElementById('btn-reset-cancel');
    if(cancelBtn) cancelBtn.onclick = ()=>{ S._modal=''; render(); };
    const confirmBtn = document.getElementById('btn-confirm-reset');
    if(confirmBtn) confirmBtn.onclick = ()=> executeReset();
  },50);
}

export async function executeReset(){
  const input = document.getElementById('reset-confirm-input');
  if(!input || input.value !== 'RESETAR SISTEMA'){
    toast('Digite exatamente: RESETAR SISTEMA');
    return;
  }
  const btn = document.getElementById('btn-confirm-reset');
  if(btn){ btn.disabled=true; btn.textContent='Resetando...'; }
  try{
    await api('POST', '/admin/reset-system', { confirmacao: 'RESETAR SISTEMA' });
    S._modal = '';
    // Limpa todo o localStorage
    localStorage.clear();
    S.products=[]; S.orders=[]; S.clients=[]; S.users=[];
    S.stockMoves=[]; S.financialEntries=[];
    toast('Sistema resetado! Faca login novamente.');
    setTimeout(()=>{ logout(); }, 2000);
  }catch(e){
    toast('Erro: '+(e.message||'Falha no reset'));
    if(btn){ btn.disabled=false; btn.textContent='Confirmar Reset'; }
  }
}

// ── RENDER CONFIG ────────────────────────────────────────────
export function renderConfig(){
  // Busca config atualizada do backend em background (1ª vez que abre a tela)
  triggerConfigFetch();
  const cfg = JSON.parse(localStorage.getItem('fv_config')||'{}');
  return`
<div class="g2">
  <div>
    <div class="card" style="margin-bottom:14px;">
      <div class="card-title">Dados da Empresa</div>
      <div class="fg"><label class="fl">Razao Social</label><input class="fi" id="cfg-razao" value="${cfg.razao||'Lacos Eternos Floricultura'}" placeholder="Razao Social"/></div>
      <div class="fr2">
        <div class="fg"><label class="fl">CNPJ</label><input class="fi" id="cfg-cnpj" value="${cfg.cnpj||''}" placeholder="00.000.000/0001-00"/></div>
        <div class="fg"><label class="fl">Inscricao Estadual</label><input class="fi" id="cfg-ie" value="${cfg.ie||''}" placeholder="IE"/></div>
      </div>
      <div class="fg"><label class="fl">WhatsApp</label><input class="fi" id="cfg-whats" value="${cfg.whats||'5592993002433'}" placeholder="5592993002433"/></div>
      <div class="fg"><label class="fl">Endereço completo <span style="font-size:10px;color:var(--muted);font-weight:400;">(para exibição)</span></label><input class="fi" id="cfg-addr" value="${cfg.addr||''}" placeholder="Rua, numero — Manaus/AM"/></div>

      <!-- Campos estruturados para emissão fiscal -->
      <div style="background:#FFFBEB;border:1px solid #F59E0B;border-radius:8px;padding:10px;margin-bottom:10px;">
        <div style="font-size:10px;font-weight:700;color:#92400E;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">📮 Endereço para NFC-e/NF-e (campos separados obrigatórios)</div>
        <div class="fr2">
          <div class="fg"><label class="fl">CEP <span style="color:var(--red)">*</span></label>
            <input class="fi" id="cfg-cep" value="${cfg.cep||''}" placeholder="69046-000" maxlength="9"/></div>
          <div class="fg"><label class="fl">Rua / Logradouro <span style="color:var(--red)">*</span></label>
            <input class="fi" id="cfg-rua" value="${cfg.rua||''}" placeholder="R. Brasileia"/></div>
          <div class="fg"><label class="fl">Número <span style="color:var(--red)">*</span></label>
            <input class="fi" id="cfg-numero" value="${cfg.numero||''}" placeholder="17"/></div>
          <div class="fg"><label class="fl">Complemento</label>
            <input class="fi" id="cfg-complemento" value="${cfg.complemento||''}" placeholder="QD D3 LT 17"/></div>
          <div class="fg"><label class="fl">Bairro <span style="color:var(--red)">*</span></label>
            <input class="fi" id="cfg-bairro" value="${cfg.bairro||'Novo Aleixo'}" placeholder="Novo Aleixo"/></div>
          <div class="fg"><label class="fl">Cidade</label>
            <input class="fi" id="cfg-cidade" value="${cfg.cidade||'Manaus'}" placeholder="Manaus"/></div>
        </div>
      </div>

      <div class="fg"><label class="fl">E-mail</label><input class="fi" id="cfg-email" value="${cfg.email||''}" placeholder="contato@lacoseternos.com.br"/></div>
      <button class="btn btn-primary" id="btn-save-cfg">Salvar Dados</button>
    </div>

    ${(S.user?.cargo==='admin'||S.user?.role==='Administrador') ? `
    <div class="card" style="margin-bottom:14px;background:linear-gradient(135deg,#FEF3C7,#FEF9E7);border:1px solid #F59E0B;">
      <div class="card-title">🔧 Manutenção — Corrigir Pedidos Antigos</div>
      <div style="font-size:11px;color:#78350F;margin-bottom:10px;line-height:1.5;">
        Varre todos os pedidos do tipo <strong>Retirada</strong> e corrige a unidade operacional
        para bater com o local de retirada (pickupUnit). Útil apenas para pedidos antigos
        lançados antes da regra atual. <strong>Não afeta pedidos novos.</strong>
      </div>
      <button class="btn btn-primary" id="btn-migrate-retirada-units" style="background:#F59E0B;">
        🔧 Executar Correção
      </button>
      <div id="migrate-retirada-result" style="margin-top:10px;font-size:12px;"></div>
    </div>

    <!-- Renumerar codigos de produto -->
    <div class="card" style="margin-bottom:14px;background:linear-gradient(135deg,#DBEAFE,#EFF6FF);border:1px solid #3B82F6;">
      <div class="card-title">🏷️ Padronizar Códigos de Produto (LE0001)</div>
      <div style="font-size:11px;color:#1E40AF;margin-bottom:10px;line-height:1.5;">
        Renumera <strong>TODOS</strong> os produtos no formato <strong>LE0001, LE0002, LE0003...</strong>
        Ordenado por data de cadastro (mais antigos primeiro). A partir daí, novos produtos
        recebem código automático sequencial. <strong>Ação irreversível</strong> — códigos antigos serão substituídos.
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-ghost btn-sm" id="btn-migrate-codes-dryrun" style="border:1px solid #3B82F6;color:#1E40AF;">
          👀 Simular (não aplica)
        </button>
        <button class="btn btn-primary btn-sm" id="btn-migrate-codes" style="background:#3B82F6;">
          🏷️ Aplicar Renumeração
        </button>
        <button class="btn btn-ghost btn-sm" id="btn-recover-codes" style="border:1px solid #DC2626;color:#991B1B;" title="Use se a migração foi interrompida e os produtos sumiram/ficaram com TEMP">
          🚑 Recuperar Códigos (emergência)
        </button>
      </div>
      <div id="migrate-codes-result" style="margin-top:10px;font-size:12px;"></div>
    </div>

    <!-- ── E-COMMERCE (admin only) ─────────────────────────────── -->
    ${(S.user?.role==='Administrador') ? `
    <div class="card" style="margin-bottom:14px;background:linear-gradient(135deg,#FAF7F5,#FFF);border:1px solid #FECDD3;">
      <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;">
        <span>🛒 E-commerce <span style="font-size:10px;background:#9F1239;color:#fff;padding:2px 6px;border-radius:6px;font-weight:700;">ADM</span></span>
      </div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:12px;">Configurações da loja online (floriculturalacoseternos.com.br).</div>

      <!-- MODO: catálogo ou loja completa -->
      <div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:10px;">
        <div style="font-weight:700;font-size:12px;color:var(--ink);margin-bottom:6px;">⚙️ MODO DE OPERAÇÃO</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
          <label style="display:flex;flex-direction:column;background:var(--cream);border:2px solid transparent;border-radius:8px;padding:10px;cursor:pointer;" id="ec-mode-cat-label">
            <div style="display:flex;align-items:center;gap:6px;"><input type="radio" name="ec-mode" value="catalogo" id="ec-mode-cat" style="accent-color:#C8736A;"/><strong style="font-size:12px;">📚 Catálogo Online</strong></div>
            <div style="font-size:10px;color:var(--muted);margin-top:4px;">Apenas vitrine de produtos. Cliente pede pelo WhatsApp. Sem checkout/pagamento.</div>
          </label>
          <label style="display:flex;flex-direction:column;background:var(--cream);border:2px solid transparent;border-radius:8px;padding:10px;cursor:pointer;" id="ec-mode-loja-label">
            <div style="display:flex;align-items:center;gap:6px;"><input type="radio" name="ec-mode" value="loja" id="ec-mode-loja" style="accent-color:#C8736A;"/><strong style="font-size:12px;">🛒 Loja Completa</strong></div>
            <div style="font-size:10px;color:var(--muted);margin-top:4px;">Cliente compra direto no site, paga via Pix/cartão (Mercado Pago).</div>
          </label>
        </div>
      </div>

      <label style="display:flex;align-items:center;gap:10px;background:#fff;border:1px solid var(--border);border-radius:10px;padding:10px;margin-bottom:8px;cursor:pointer;">
        <input type="checkbox" id="ec-accepting" style="width:18px;height:18px;accent-color:#15803D;"/>
        <div style="flex:1;">
          <div style="font-weight:700;font-size:13px;">🟢 Aceitando pedidos / contatos</div>
          <div style="font-size:10px;color:var(--muted);">Desligue para pausar (loja mostra mensagem de fechado)</div>
        </div>
      </label>

      <!-- Mensagem WhatsApp ao pedir -->
      <div class="fg"><label class="fl">Mensagem padrão do WhatsApp ao pedir</label>
        <input class="fi" id="ec-wpp-order-msg" placeholder="Olá! Fiquei interessado(a) no(s) produto(s) abaixo. Pode me ajudar?"/></div>

      <!-- Datas bloqueadas para entrega -->
      <div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:10px;margin-bottom:10px;">
        <div style="font-weight:700;font-size:12px;color:var(--ink);margin-bottom:6px;">📅 Datas bloqueadas para entrega</div>
        <div style="font-size:10px;color:var(--muted);margin-bottom:8px;">Adicione datas em que NÃO entregamos (feriados, folgas, eventos).</div>
        <div style="display:flex;gap:6px;margin-bottom:8px;">
          <input type="date" id="ec-block-date-input" class="fi" style="flex:1;font-size:12px;"/>
          <button type="button" id="btn-add-blocked-date" class="btn btn-primary btn-sm">+ Bloquear</button>
        </div>
        <div id="ec-blocked-dates-list" style="display:flex;flex-wrap:wrap;gap:5px;min-height:24px;"></div>
      </div>

      <div class="fr2" style="gap:8px;">
        <div class="fg"><label class="fl">Frete fixo (R$)</label>
          <input class="fi" type="number" step="0.01" id="ec-delivery-fee" placeholder="15.00"/></div>
        <div class="fg"><label class="fl">Frete grátis acima de (R$)</label>
          <input class="fi" type="number" step="0.01" id="ec-free-above" placeholder="0 = desativado"/></div>
      </div>
      <div class="fg"><label class="fl">Pedido mínimo (R$)</label>
        <input class="fi" type="number" step="0.01" id="ec-min-order" placeholder="0 = sem mínimo"/></div>
      <div class="fg"><label class="fl">Mensagem do frete (visível no checkout)</label>
        <input class="fi" id="ec-shipping-note" placeholder="Entrega em toda Manaus. Taxa fixa."/></div>
      <div class="fg"><label class="fl">Mensagem quando fechado</label>
        <input class="fi" id="ec-closed-msg" placeholder="No momento estamos fora do horário online."/></div>

      <!-- ── APARÊNCIA DO SITE ─────────────────────────── -->
      <details style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:10px;margin-bottom:10px;">
        <summary style="cursor:pointer;font-weight:700;font-size:12px;color:var(--ink);padding:4px 0;">🎨 Aparência do Site</summary>
        <div class="fr2" style="gap:8px;margin-top:8px;">
          <div class="fg"><label class="fl">Nome do Site</label>
            <input class="fi" id="ec-site-name" placeholder="Floricultura Laços Eternos"/></div>
          <div class="fg"><label class="fl">Tagline / Subtítulo</label>
            <input class="fi" id="ec-site-tagline" placeholder="Flores que dizem tudo por você"/></div>
        </div>
        <div class="fr2" style="gap:8px;">
          <div class="fg"><label class="fl">Cor Principal</label>
            <input class="fi" id="ec-color-primary" type="color" value="#C8736A" style="height:38px;padding:2px;"/></div>
          <div class="fg"><label class="fl">Cor Secundária</label>
            <input class="fi" id="ec-color-secondary" type="color" value="#B8915E" style="height:38px;padding:2px;"/></div>
        </div>
        <div class="fg"><label class="fl">URL do Logo (PNG/SVG)</label>
          <input class="fi" id="ec-site-logo" placeholder="https://... ou cole base64"/></div>
        <div class="fg"><label class="fl">URL do Favicon</label>
          <input class="fi" id="ec-site-favicon" placeholder="https://... ou cole base64"/></div>
      </details>

      <!-- ── HERO (banner principal) ─────────────────────── -->
      <details style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:10px;margin-bottom:10px;">
        <summary style="cursor:pointer;font-weight:700;font-size:12px;color:var(--ink);padding:4px 0;">🖼️ Banner Principal (Hero)</summary>
        <div class="fg"><label class="fl">Título Principal</label>
          <input class="fi" id="ec-hero-title" placeholder="Surpreenda quem você ama"/></div>
        <div class="fg"><label class="fl">Subtítulo</label>
          <input class="fi" id="ec-hero-subtitle" placeholder="Buquês, cestas e arranjos..."/></div>
        <div class="fg"><label class="fl">URL da Imagem Hero</label>
          <input class="fi" id="ec-hero-banner" placeholder="https://..."/></div>
      </details>

      <!-- ── DEPOIMENTOS ──────────────────────────────────── -->
      <details style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:10px;margin-bottom:10px;">
        <summary style="cursor:pointer;font-weight:700;font-size:12px;color:var(--ink);padding:4px 0;">⭐ Depoimentos / Avaliações</summary>
        <div id="ec-reviews-list" style="margin-top:8px;display:flex;flex-direction:column;gap:6px;"></div>
        <button type="button" class="btn btn-ghost btn-sm" id="btn-add-review" style="margin-top:6px;">+ Adicionar Depoimento</button>
      </details>

      <!-- ── PÁGINAS INSTITUCIONAIS ──────────────────────── -->
      <details style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:10px;margin-bottom:10px;">
        <summary style="cursor:pointer;font-weight:700;font-size:12px;color:var(--ink);padding:4px 0;">📄 Páginas Institucionais</summary>
        <div style="font-size:10px;color:var(--muted);margin:4px 0 8px;">Edite os textos das páginas: Quem Somos, Trocas e Devoluções, Política de Privacidade, etc.</div>
        <div id="ec-pages-list" style="display:flex;flex-direction:column;gap:6px;"></div>
        <button type="button" class="btn btn-ghost btn-sm" id="btn-add-page" style="margin-top:6px;">+ Adicionar Página</button>
      </details>

      <button class="btn btn-primary" id="btn-save-ecommerce" style="width:100%;margin-top:6px;">💾 Salvar E-commerce</button>
      <div id="ecommerce-status" style="margin-top:6px;font-size:11px;text-align:center;color:var(--muted);"></div>
    </div>
    ` : ''}

    <!-- ── INTEGRAÇÕES E APIs (admin only) ──────────────────────── -->
    ${(S.user?.role==='Administrador') ? `
    <div class="card" style="margin-bottom:14px;background:linear-gradient(135deg,#FEFAF8,#FFF);border:1px solid #FECDD3;">
      <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;">
        <span>🌐 Integrações e APIs <span style="font-size:10px;background:#9F1239;color:#fff;padding:2px 6px;border-radius:6px;font-weight:700;">ADM</span></span>
      </div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:14px;">Tokens secretos ficam apenas no servidor. IDs públicos são lidos pelo e-commerce automaticamente.</div>

      <!-- Google -->
      <div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:10px;">
        <div style="font-weight:700;font-size:13px;color:#4285F4;margin-bottom:8px;">📊 Google</div>
        <div class="fr2" style="gap:8px;">
          <div class="fg"><label class="fl">Google Analytics 4 ID</label>
            <input class="fi" id="int-ga-id" placeholder="G-XXXXXXXXXX"/></div>
          <div class="fg"><label class="fl">Tag Manager ID</label>
            <input class="fi" id="int-gtm-id" placeholder="GTM-XXXXXXX"/></div>
        </div>
        <div class="fg"><label class="fl">Google Ads — ID de Conversão</label>
          <input class="fi" id="int-gads-id" placeholder="AW-XXXXXXXXX/yyyyyyy"/></div>
      </div>

      <!-- Meta + Shopping Feed -->
      <div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:10px;">
        <div style="font-weight:700;font-size:13px;color:#1877F2;margin-bottom:8px;">📘 Meta (Facebook / Instagram)</div>
        <div class="fr2" style="gap:8px;">
          <div class="fg"><label class="fl">Meta Pixel ID</label>
            <input class="fi" id="int-meta-pixel" placeholder="123456789012345"/></div>
          <div class="fg"><label class="fl">Conversions API Token <span style="font-size:9px;color:var(--red);">(secreto)</span></label>
            <input class="fi" id="int-meta-token" type="password" placeholder="EAAB..."/></div>
        </div>
        <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;padding:8px 10px;margin-top:8px;">
          <div style="font-size:11px;color:#1E40AF;font-weight:700;margin-bottom:4px;">🛍️ Facebook / Instagram Shopping</div>
          <div style="font-size:10px;color:#3730A3;line-height:1.4;">URL do feed (use no Catalog Manager):</div>
          <input readonly value="https://florevita-backend-2-0.onrender.com/api/public/feed/facebook.xml" style="width:100%;margin-top:4px;padding:5px 8px;border:1px solid #BFDBFE;border-radius:5px;background:#fff;font-size:10px;font-family:monospace;color:#1E40AF;cursor:pointer;" onclick="this.select();document.execCommand('copy');alert('URL copiada — cole no Catalog Manager do Facebook')"/>
          <div style="font-size:9px;color:#1E40AF;margin-top:4px;">Como ativar: Business Manager → Catálogos → Criar → URL do feed → Frequência: Diária</div>
        </div>
      </div>

      <!-- Mercado Pago -->
      <div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:10px;">
        <div style="font-weight:700;font-size:13px;color:#009EE3;margin-bottom:8px;">💳 Mercado Pago</div>
        <div class="fg"><label class="fl">Access Token <span style="font-size:9px;color:var(--red);">(secreto)</span></label>
          <input class="fi" id="int-mp-token" type="password" placeholder="APP_USR-..."/></div>
        <div class="fg"><label class="fl">Public Key</label>
          <input class="fi" id="int-mp-public" placeholder="APP_USR-..."/></div>
        <div style="font-size:10px;color:var(--muted);background:#F0F9FF;padding:6px 8px;border-radius:6px;">
          ℹ️ Webhook automático: <code>https://florevita-backend-2-0.onrender.com/api/public/mp/webhook</code>
        </div>
      </div>

      <!-- WhatsApp -->
      <div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:10px;">
        <div style="font-weight:700;font-size:13px;color:#25D366;margin-bottom:8px;">💬 WhatsApp</div>
        <div class="fg"><label class="fl">Número (com DDI+DDD, sem espaços)</label>
          <input class="fi" id="int-wpp-num" placeholder="5592993002433"/></div>
        <div class="fg"><label class="fl">Mensagem padrão de saudação</label>
          <input class="fi" id="int-wpp-msg" placeholder="Olá! Quero comprar 🌹"/></div>
      </div>

      <button class="btn btn-primary" id="btn-save-integracoes" style="width:100%;">
        💾 Salvar Integrações
      </button>
      <div id="integracoes-status" style="margin-top:8px;font-size:11px;text-align:center;color:var(--muted);"></div>
    </div>
    ` : ''}

    <div class="card" style="margin-bottom:14px;">
      <div class="card-title">🖼️ Logo da Tela de Login</div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:10px;line-height:1.5;">
        Imagem exibida no topo da tela de login. Use PNG/JPG quadrado ou retangular horizontal.
      </div>
      ${cfg.loginLogo ? `
      <div style="text-align:center;margin-bottom:12px;padding:16px;background:var(--cream);border-radius:10px;">
        <img src="${cfg.loginLogo}" alt="Logo atual" style="max-width:200px;max-height:100px;object-fit:contain;"/>
        <div style="font-size:10px;color:var(--muted);margin-top:6px;">Prévia</div>
      </div>` : `
      <div style="text-align:center;margin-bottom:12px;padding:22px;background:var(--cream);border-radius:10px;color:var(--muted);font-size:12px;">
        🖼️ Nenhuma logo definida — usando texto padrão
      </div>`}

      <div class="fg">
        <label class="fl">URL da imagem</label>
        <input class="fi" id="cfg-login-logo" value="${cfg.loginLogo||''}" placeholder="https://..."/>
        <div style="font-size:10px;color:var(--muted);margin-top:4px;">Cole aqui o link direto da imagem (ex: ImgBB, Cloudinary, Imgur)</div>
      </div>

      <div class="fg">
        <label class="fl">Ou envie um arquivo (máx 2MB)</label>
        <input type="file" id="cfg-login-logo-file" accept="image/png,image/jpeg,image/webp,image/svg+xml"
          style="width:100%;padding:8px;border:1px dashed var(--border);border-radius:8px;font-size:12px;cursor:pointer;"/>
        <div style="font-size:10px;color:var(--muted);margin-top:4px;">A imagem será convertida e salva localmente no navegador</div>
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-primary" id="btn-save-login-logo">💾 Salvar Logo</button>
        ${cfg.loginLogo ? `<button class="btn btn-ghost" id="btn-clear-login-logo" style="color:var(--red);">🗑️ Remover</button>`:''}
      </div>
    </div>

    <div class="card" style="margin-bottom:14px;">
      <div class="card-title">🔖 Favicon (ícone da aba do navegador)</div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:10px;line-height:1.5;">
        Ícone exibido na aba do navegador. Use imagem <strong>quadrada</strong> (32×32, 64×64, 128×128 ou 256×256).
      </div>
      ${cfg.favicon ? `
      <div style="text-align:center;margin-bottom:12px;padding:16px;background:var(--cream);border-radius:10px;">
        <img src="${cfg.favicon}" alt="Favicon atual" style="width:64px;height:64px;object-fit:contain;border-radius:8px;border:1px solid var(--border);background:#fff;padding:4px;"/>
        <div style="font-size:10px;color:var(--muted);margin-top:6px;">Prévia 64×64</div>
      </div>` : `
      <div style="text-align:center;margin-bottom:12px;padding:22px;background:var(--cream);border-radius:10px;color:var(--muted);font-size:12px;">
        🌸 Nenhum favicon definido — usando padrão
      </div>`}

      <div class="fg">
        <label class="fl">URL da imagem</label>
        <input class="fi" id="cfg-favicon" value="${cfg.favicon||''}" placeholder="https://..."/>
        <div style="font-size:10px;color:var(--muted);margin-top:4px;">Link direto da imagem (PNG, JPG, ICO ou SVG)</div>
      </div>

      <div class="fg">
        <label class="fl">Ou envie um arquivo quadrado (máx 500KB)</label>
        <input type="file" id="cfg-favicon-file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/x-icon,image/vnd.microsoft.icon"
          style="width:100%;padding:8px;border:1px dashed var(--border);border-radius:8px;font-size:12px;cursor:pointer;"/>
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-primary" id="btn-save-favicon">💾 Salvar Favicon</button>
        ${cfg.favicon ? `<button class="btn btn-ghost" id="btn-clear-favicon" style="color:var(--red);">🗑️ Remover</button>`:''}
      </div>
    </div>` : ''}

    ${canManageClientTier() ? `
    <div class="card" style="margin-bottom:14px;">
      <div class="card-title">&#128101; Numera\u00E7\u00E3o de Clientes</div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:10px;line-height:1.5;">
        N\u00FAmero inicial usado ao gerar c\u00F3digos de novos clientes (ex: CLI-1001).<br>
        Apenas usu\u00E1rios com permiss\u00E3o podem alterar.
      </div>
      <div class="fr2">
        <div class="fg">
          <label class="fl">N\u00FAmero inicial</label>
          <input class="fi" id="cfg-client-code-start" type="number" min="1" step="1" value="${cfg.clientCodeStart||1}" placeholder="1"/>
        </div>
        <div class="fg">
          <label class="fl">Pr\u00F3ximo c\u00F3digo (preview)</label>
          <input class="fi" id="cfg-client-code-preview" value="CLI-${String(Math.max(cfg.clientCodeStart||1, (S.clients?.length||0) + (cfg.clientCodeStart||1))).padStart(4,'0')}" disabled/>
        </div>
      </div>
      <button class="btn btn-primary" id="btn-save-client-code-start">Salvar Numera\u00E7\u00E3o</button>
    </div>` : ''}

    <div class="card" style="margin-bottom:14px;">
      <div class="card-title">🧾 Configuração Fiscal
        <span class="tag ${(cfg.regimeTributario&&cfg.ncmDefault)?'t-green':'t-gold'}">${(cfg.regimeTributario&&cfg.ncmDefault)?'Preenchido':'Incompleto'}</span>
      </div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:12px;line-height:1.5;">
        Dados tributários usados para gerar NFC-e e NF-e. Confirme com seu contador.
      </div>

      <div class="fr2">
        <div class="fg"><label class="fl">Regime Tributário <span style="color:var(--red)">*</span></label>
          <select class="fi" id="cfg-regime">
            <option value="">Selecione...</option>
            <option value="1" ${cfg.regimeTributario==='1'?'selected':''}>Simples Nacional</option>
            <option value="2" ${cfg.regimeTributario==='2'?'selected':''}>Simples Nacional — excesso sublimite</option>
            <option value="3" ${cfg.regimeTributario==='3'?'selected':''}>Regime Normal (Lucro Presumido/Real)</option>
            <option value="4" ${cfg.regimeTributario==='4'?'selected':''}>MEI</option>
          </select>
        </div>
        <div class="fg"><label class="fl">CNAE principal</label>
          <input class="fi" id="cfg-cnae" value="${cfg.cnae||''}" placeholder="4774-1/00"/>
        </div>
      </div>

      <div class="fr2">
        <div class="fg"><label class="fl">NCM padrão dos produtos</label>
          <input class="fi" id="cfg-ncm-default" value="${cfg.ncmDefault||'06031100'}" placeholder="06031100"/>
          <div style="font-size:10px;color:var(--muted);margin-top:2px;">Ex: 06031100 (rosas), 06031900 (outras flores), 06029089 (plantas)</div>
        </div>
        <div class="fg"><label class="fl">CFOP venda dentro do estado</label>
          <input class="fi" id="cfg-cfop" value="${cfg.cfopDefault||'5102'}" placeholder="5102"/>
          <div style="font-size:10px;color:var(--muted);margin-top:2px;">5102 = Venda merc. adquirida de terceiros</div>
        </div>
      </div>

      <div class="fr2">
        <div class="fg"><label class="fl">CSOSN / CST ICMS</label>
          <input class="fi" id="cfg-csosn" value="${cfg.csosnDefault||'102'}" placeholder="102"/>
          <div style="font-size:10px;color:var(--muted);margin-top:2px;">102 = Simples sem permissão crédito · 400 = Não tributada</div>
        </div>
        <div class="fg"><label class="fl">Alíquota ICMS (%)</label>
          <input class="fi" id="cfg-icms" type="number" step="0.01" value="${cfg.icmsAliquota||0}" placeholder="0"/>
          <div style="font-size:10px;color:var(--muted);margin-top:2px;">Em Simples: deixe 0 (imposto já embutido no DAS)</div>
        </div>
      </div>

      <div class="fr2">
        <div class="fg"><label class="fl">Origem da mercadoria</label>
          <select class="fi" id="cfg-origem">
            <option value="0" ${(cfg.origemMercadoria||'0')==='0'?'selected':''}>0 — Nacional</option>
            <option value="1" ${cfg.origemMercadoria==='1'?'selected':''}>1 — Estrangeira (import direta)</option>
            <option value="2" ${cfg.origemMercadoria==='2'?'selected':''}>2 — Estrangeira (mercado interno)</option>
          </select>
        </div>
        <div class="fg"><label class="fl">Unidade comercial padrão</label>
          <input class="fi" id="cfg-unidade" value="${cfg.unidadeComercial||'UN'}" placeholder="UN" maxlength="6"/>
          <div style="font-size:10px;color:var(--muted);margin-top:2px;">UN, PC, KG, MT, etc.</div>
        </div>
      </div>

      <div class="fg"><label class="fl">Provedor de emissão (gateway)</label>
        <select class="fi" id="cfg-nfe-gateway">
          <option value="mock" ${(cfg.nfeGateway||'mock')==='mock'?'selected':''}>Mock (testes — não envia à SEFAZ)</option>
          <option value="focus" ${cfg.nfeGateway==='focus'?'selected':''}>Focus NFe (produção)</option>
        </select>
      </div>

      ${cfg.nfeGateway==='focus' ? `
      <div class="fg"><label class="fl">Token Focus NFe</label>
        <input class="fi" id="cfg-focus-token" type="password" value="${cfg.focusToken||''}" placeholder="Cole o token aqui"/>
        <div style="font-size:10px;color:var(--muted);margin-top:2px;">
          Obter em <a href="https://app.focusnfe.com.br" target="_blank" style="color:var(--rose);">app.focusnfe.com.br</a> → sua empresa → Tokens
        </div>
      </div>` : ''}

      <!-- CSC — obrigatório para NFC-e -->
      <div style="background:#FEF3C7;border:1.5px solid #F59E0B;border-radius:10px;padding:12px;margin-bottom:14px;">
        <div style="font-size:12px;font-weight:700;color:#92400E;margin-bottom:6px;">🔑 CSC — Código de Segurança do Contribuinte (NFC-e)</div>
        <div style="font-size:11px;color:#78350F;margin-bottom:10px;line-height:1.5;">
          Gerado no portal da SEFAZ/AM. Obrigatório para emitir NFC-e (cupom fiscal).
        </div>
        <div class="fr2">
          <div class="fg"><label class="fl">CSC ID</label>
            <input class="fi" id="cfg-csc-id" value="${cfg.cscId||'1'}" placeholder="1" maxlength="10"/>
            <div style="font-size:10px;color:var(--muted);margin-top:2px;">Normalmente 1 ou 000001</div>
          </div>
          <div class="fg"><label class="fl">CSC Token</label>
            <input class="fi" id="cfg-csc-token" type="password" value="${cfg.cscToken||''}" placeholder="Código alfanumérico"/>
            <div style="font-size:10px;color:var(--muted);margin-top:2px;">Ex: A1B2C3D4E5F6...</div>
          </div>
        </div>
      </div>

      <button class="btn btn-primary" id="btn-save-fiscal">💾 Salvar Config Fiscal</button>
    </div>

    <!-- ── INTEGRACAO IFOOD ── -->
    <div class="card" style="margin-bottom:14px;">
      <div class="card-title">🍔 Integração iFood
        <span id="ifood-status-tag" class="tag" style="font-size:10px;">...</span>
      </div>
      <div class="alert al-info" style="margin-bottom:12px;">
        Cadastre as credenciais do <strong>Portal do Desenvolvedor iFood</strong> (developer.ifood.com.br).
        O sistema consulta novos pedidos a cada 30 segundos e importa automaticamente.
      </div>
      <div class="fr2">
        <div class="fg">
          <label class="fl">Client ID *</label>
          <input type="text" class="fi" id="ifood-client-id" placeholder="abc123-def456-..."/>
        </div>
        <div class="fg">
          <label class="fl">Client Secret *</label>
          <input type="password" class="fi" id="ifood-client-secret" placeholder="(deixe em branco para manter)"/>
        </div>
      </div>
      <div class="fr2" style="margin-top:10px;">
        <div class="fg">
          <label class="fl">Merchant IDs (virgulado)</label>
          <input type="text" class="fi" id="ifood-merchants" placeholder="id-loja-1, id-loja-2"/>
          <div style="font-size:10px;color:var(--muted);margin-top:3px;">Se vazio, recebe de todas as lojas associadas à conta.</div>
        </div>
        <div class="fg">
          <label class="fl">Ambiente</label>
          <select class="fi" id="ifood-ambiente">
            <option value="producao">Produção</option>
            <option value="sandbox">Sandbox (teste)</option>
          </select>
        </div>
      </div>
      <div style="display:flex;gap:20px;align-items:center;margin-top:12px;flex-wrap:wrap;">
        <label style="display:flex;gap:6px;align-items:center;cursor:pointer;">
          <input type="checkbox" id="ifood-polling"/>
          <span>🔄 Polling ativo (recebe pedidos automaticamente)</span>
        </label>
        <label style="display:flex;gap:6px;align-items:center;cursor:pointer;">
          <input type="checkbox" id="ifood-autoaccept"/>
          <span>✅ Auto-aceitar pedidos (recomendado)</span>
        </label>
      </div>
      <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;">
        <button class="btn btn-primary" id="btn-save-ifood">💾 Salvar iFood</button>
        <button class="btn btn-ghost" id="btn-test-ifood">🔌 Testar conexão</button>
        <button class="btn btn-ghost" id="btn-poll-ifood">⚡ Forçar polling agora</button>
        <button class="btn btn-ghost" id="btn-log-ifood">📜 Ver log de eventos</button>
      </div>
      <div id="ifood-telemetry" style="margin-top:12px;font-size:11px;color:var(--muted);padding:8px;background:var(--cream);border-radius:8px;display:none;"></div>
    </div>

    <div class="card" style="margin-bottom:14px;">
      <div class="card-title">Certificado Digital (NF-e / NFC-e)
        <span class="tag ${cfg.certData?'t-green':'t-red'}">${cfg.certData?'Configurado':'Nao configurado'}</span>
      </div>
      <div class="alert al-info" style="margin-bottom:12px;">Necessario para emissao de NF-e e NFC-e. Faca o upload do arquivo <strong>.pfx</strong> do seu certificado A1.</div>

      ${cfg.certData?`
      <div class="alert al-ok" style="margin-bottom:12px;">
        Certificado carregado: <strong>${cfg.certNome||'certificado.pfx'}</strong><br>
        <span style="font-size:11px">Vencimento: ${cfg.certVencimento||'Verificar'} - Ambiente: ${cfg.certAmbiente||'Homologacao'}</span>
      </div>`:''}

      <div style="border:1px solid var(--border);border-radius:var(--r);padding:14px;margin-bottom:12px;">
        <div style="font-weight:600;font-size:12px;margin-bottom:10px;color:var(--ink2);">Upload do Certificado (.pfx)</div>

        <label for="cert-file" style="display:block;cursor:pointer;">
          <div class="img-up" id="cert-drop-zone" style="margin-bottom:10px;cursor:pointer;">
            <div id="cert-drop-label">
              <div style="font-size:28px;margin-bottom:6px">&#128274;</div>
              <div style="font-size:13px;font-weight:500">${cfg.certData?'Clique para trocar o certificado':'Clique aqui para selecionar o arquivo .pfx'}</div>
              <div style="font-size:11px;color:var(--muted);margin-top:4px">Certificado A1 — formato .pfx ou .p12</div>
            </div>
          </div>
        </label>
        <input type="file" id="cert-file" accept=".pfx,.p12"
          style="width:100%;padding:6px;border:1px dashed var(--border);border-radius:8px;font-size:12px;cursor:pointer;margin-bottom:10px;"
          title="Selecionar certificado .pfx ou .p12"/>
        <div class="fr2">
          <div class="fg"><label class="fl">Senha do Certificado *</label>
            <input class="fi" id="cert-pass" type="password" placeholder="Senha do .pfx" value="${cfg.certPass||''}"/>
          </div>
          <div class="fg"><label class="fl">Ambiente</label>
            <select class="fi" id="cert-ambiente">
              <option value="homologacao" ${cfg.certAmbiente==='homologacao'?'selected':''}>Homologacao (teste)</option>
              <option value="producao" ${cfg.certAmbiente==='producao'?'selected':''}>Producao</option>
            </select>
          </div>
          <div class="fg"><label class="fl">Serie NF-e</label>
            <input class="fi" id="cert-serie-nfe" placeholder="001" value="${cfg.certSerieNFe||'001'}"/>
          </div>
          <div class="fg"><label class="fl">Serie NFC-e</label>
            <input class="fi" id="cert-serie-nfce" placeholder="001" value="${cfg.certSerieNFCe||'001'}"/>
          </div>
        </div>
        <div class="fg"><label class="fl">CNPJ do Emitente</label>
          <input class="fi" id="cert-cnpj" placeholder="00.000.000/0001-00" value="${cfg.cnpj||''}"/>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-primary" id="btn-save-cert" style="flex:1;justify-content:center;">Salvar Certificado</button>
          ${cfg.certData?`<button class="btn btn-ghost" id="btn-test-cert">Testar</button>
          <button class="btn btn-red btn-sm" id="btn-del-cert">&#128465;</button>`:''}
        </div>
      </div>

      <div style="font-size:11px;color:var(--muted);line-height:1.6;padding:10px;background:var(--cream);border-radius:8px;">
        <strong>Importante:</strong> O certificado fica salvo localmente neste navegador. Para emissao real de NF-e/NFC-e, o backend precisa estar configurado com a biblioteca <strong>DFe</strong> ou <strong>NFePHP</strong> e conectado a SEFAZ/AM.
      </div>
    </div>

  <div>
    <div class="card" style="margin-bottom:14px;">
      <div class="card-title">&#128666; Taxas de Entrega
        <span style="font-size:11px;color:var(--muted);font-weight:normal;">Totalmente edit\u00E1vel</span>
      </div>

      ${Object.keys(DELIVERY_FEES).length === 0 ? `
        <div style="text-align:center;padding:30px 20px;background:var(--cream);border-radius:10px;margin-bottom:12px;">
          <div style="font-size:36px;margin-bottom:8px;opacity:.5;">&#128666;</div>
          <div style="font-size:13px;font-weight:600;color:var(--ink);margin-bottom:4px;">Nenhuma taxa cadastrada</div>
          <div style="font-size:11px;color:var(--muted);">Adicione uma cidade para come\u00E7ar</div>
        </div>
      ` : ''}

      ${Object.entries(DELIVERY_FEES).map(([city,zones])=>`
      <div style="background:var(--cream);border-radius:10px;padding:12px;margin-bottom:10px;border:1px solid var(--border);">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--border);">
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="font-size:16px;">\uD83C\uDFD9\uFE0F</span>
            <div style="font-weight:700;font-size:13px;color:var(--ink)">${city}</div>
            <span style="font-size:10px;color:var(--muted);background:#fff;padding:2px 6px;border-radius:4px;">${Object.keys(zones).length} ${Object.keys(zones).length===1?'zona':'zonas'}</span>
          </div>
          <div style="display:flex;gap:4px;">
            <button class="btn btn-ghost btn-xs btn-add-zone-city" data-city="${city}" title="Adicionar zona/bairro">+ Zona</button>
            <button class="btn btn-xs btn-del-city" data-city="${city}" style="background:var(--red-l);color:var(--red);border:1px solid rgba(220,38,38,.2);border-radius:6px;padding:3px 7px;font-size:11px;" title="Excluir cidade inteira">&#128465;</button>
          </div>
        </div>
        ${Object.keys(zones).length === 0 ? `
          <div style="text-align:center;padding:16px;color:var(--muted);font-size:12px;font-style:italic;">Nenhuma zona cadastrada. Clique em "+ Zona" acima.</div>
        ` : Object.entries(zones).map(([zone,fee])=>`
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;padding:6px 8px;background:#fff;border-radius:6px;">
          <span style="flex:1;font-size:12px;font-weight:500;color:var(--ink);">${zone}</span>
          <span style="font-size:11px;color:var(--muted);">R$</span>
          <input type="number" value="${fee}" step="0.50" min="0" style="width:80px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;text-align:right;" data-fee-city="${city}" data-fee-zone="${zone}" class="fee-input"/>
          <button class="btn btn-xs btn-del-zone" data-city="${city}" data-zone="${zone}" style="background:var(--red-l);color:var(--red);border:1px solid rgba(220,38,38,.2);border-radius:6px;padding:3px 6px;font-size:10px;" title="Excluir zona">&#10005;</button>
        </div>`).join('')}
      </div>`).join('')}

      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px;padding-top:10px;border-top:1px solid var(--border);">
        <button class="btn btn-primary btn-sm" id="btn-save-fees">\uD83D\uDCBE Salvar Taxas</button>
        <button class="btn btn-ghost btn-sm" id="btn-add-city">\u2795 Nova Cidade</button>
        <button class="btn btn-xs btn-reset-fees" style="background:var(--red-l);color:var(--red);border:1px solid rgba(220,38,38,.2);border-radius:6px;padding:4px 10px;font-size:11px;margin-left:auto;" title="Limpar tudo">\uD83D\uDDD1\uFE0F Limpar Tudo</button>
      </div>
    </div>

    <div class="card" style="margin-bottom:14px;">
      <div class="card-title">Integracoes</div>
      ${[
        {n:'iFood',i:'&#127829;',s:'Configurar'},
        {n:'Giuliana Flores',i:'&#127799;',s:'Configurar'},
        {n:'WhatsApp Business',i:'&#128172;',s:'Configurar'},
        {n:'Google Maps',i:'&#128506;',s:'Configurar'},
        {n:'Mercado Pago',i:'&#128179;',s:'Configurar'},
        {n:'Cloudinary (Fotos)',i:'&#128247;',s:'Configurar'},
      ].map(i=>`
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);">
        <div style="display:flex;align-items:center;gap:8px;"><span style="font-size:16px">${i.i}</span><span style="font-size:12px;font-weight:500">${i.n}</span></div>
        <button class="btn btn-ghost btn-sm">${i.s}</button>
      </div>`).join('')}
    </div>

    <div class="card">
      <div class="card-title">Sistema</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:6px">Backend: <strong style="color:var(--leaf)">florevita-backend-2-0.onrender.com</strong></div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:12px">Banco: <strong style="color:var(--leaf)">MongoDB Atlas</strong></div>
      <button class="btn btn-green btn-sm" id="btn-test-api">Testar Conexao</button>
      <hr/>
      <div class="card-title" style="font-size:13px;margin-top:10px">Sugerir Melhoria</div>
      <textarea class="fi" id="sug-txt" placeholder="Sua ideia..." rows="3"></textarea>
      <button class="btn btn-outline btn-sm" id="btn-sug" style="margin-top:8px">Enviar</button>
    </div>

    <div class="card" style="border-color:var(--red);border-style:dashed;">
      <div class="card-title" style="color:var(--red);">Reset do Sistema</div>
      <p style="font-size:12px;color:var(--muted);margin-bottom:12px">Apaga TODOS os dados do sistema (produtos, pedidos, clientes, etc). Esta acao e irreversivel.</p>
      <button class="btn btn-red btn-sm" id="btn-reset-system">Resetar Sistema</button>
    </div>
  </div>
</div>`;
}

// ── BIND CONFIG PAGE ACTIONS ─────────────────────────────────
export function bindConfigActions(){
  // ── E-COMMERCE CONFIG (admin) ──────────────────────────────
  // Estado local de datas bloqueadas (array de YYYY-MM-DD)
  let _ecBlockedDates = [];
  const _renderBlockedList = () => {
    const list = document.getElementById('ec-blocked-dates-list');
    if (!list) return;
    list.innerHTML = _ecBlockedDates.length
      ? _ecBlockedDates.map(d => `<span style="display:inline-flex;align-items:center;gap:4px;background:#FEE2E2;color:#991B1B;padding:3px 8px;border-radius:12px;font-size:11px;font-weight:700;">📅 ${d}<button type="button" data-del-date="${d}" style="background:rgba(220,38,38,.2);border:none;color:#991B1B;width:16px;height:16px;border-radius:50%;cursor:pointer;font-size:11px;line-height:1;padding:0;">×</button></span>`).join('')
      : '<span style="font-size:11px;color:var(--muted);font-style:italic;">Nenhuma data bloqueada.</span>';
    list.querySelectorAll('[data-del-date]').forEach(b => {
      b.onclick = () => { _ecBlockedDates = _ecBlockedDates.filter(x => x !== b.dataset.delDate); _renderBlockedList(); };
    });
  };
  // Botao adicionar data
  {const _el = document.getElementById('btn-add-blocked-date'); if (_el) _el.onclick = () => {
    const inp = document.getElementById('ec-block-date-input');
    const v = inp?.value;
    if (!v) return;
    if (!_ecBlockedDates.includes(v)) _ecBlockedDates.push(v);
    _ecBlockedDates.sort();
    if (inp) inp.value = '';
    _renderBlockedList();
  };}
  // Highlight do modo selecionado
  const _applyModeHighlight = () => {
    const cat  = document.getElementById('ec-mode-cat');
    const loja = document.getElementById('ec-mode-loja');
    const lblCat  = document.getElementById('ec-mode-cat-label');
    const lblLoja = document.getElementById('ec-mode-loja-label');
    if (lblCat)  lblCat.style.borderColor  = cat?.checked  ? '#C8736A' : 'transparent';
    if (lblLoja) lblLoja.style.borderColor = loja?.checked ? '#C8736A' : 'transparent';
  };
  document.querySelectorAll('input[name="ec-mode"]').forEach(r => r.onchange = _applyModeHighlight);

  // Estado local para reviews + pages
  let _ecReviews = [];
  let _ecPages = [];
  const _renderReviews = () => {
    const list = document.getElementById('ec-reviews-list');
    if (!list) return;
    list.innerHTML = _ecReviews.map((r, i) => `
      <div style="background:var(--cream);border-radius:8px;padding:8px;display:flex;flex-direction:column;gap:4px;">
        <div style="display:flex;gap:6px;">
          <input value="${(r.name||'').replace(/"/g,'&quot;')}" placeholder="Nome do cliente" data-rev-name="${i}" style="flex:1;padding:4px 6px;border:1px solid var(--border);border-radius:5px;font-size:11px;"/>
          <select data-rev-stars="${i}" style="padding:4px 6px;border:1px solid var(--border);border-radius:5px;font-size:11px;">
            ${[5,4,3,2,1].map(n=>`<option value="${n}" ${(r.stars||5)===n?'selected':''}>${'★'.repeat(n)}</option>`).join('')}
          </select>
          <button type="button" data-rev-del="${i}" style="background:#FEE2E2;border:none;color:#991B1B;width:28px;border-radius:5px;cursor:pointer;">×</button>
        </div>
        <textarea data-rev-text="${i}" placeholder="Texto do depoimento" rows="2" style="padding:4px 6px;border:1px solid var(--border);border-radius:5px;font-size:11px;resize:vertical;">${(r.text||'').replace(/</g,'&lt;')}</textarea>
      </div>
    `).join('');
    list.querySelectorAll('[data-rev-name]').forEach(el => el.oninput = e => _ecReviews[+el.dataset.revName].name = e.target.value);
    list.querySelectorAll('[data-rev-text]').forEach(el => el.oninput = e => _ecReviews[+el.dataset.revText].text = e.target.value);
    list.querySelectorAll('[data-rev-stars]').forEach(el => el.onchange = e => _ecReviews[+el.dataset.revStars].stars = +e.target.value);
    list.querySelectorAll('[data-rev-del]').forEach(b => b.onclick = () => { _ecReviews.splice(+b.dataset.revDel,1); _renderReviews(); });
  };
  {const _el = document.getElementById('btn-add-review'); if (_el) _el.onclick = () => { _ecReviews.push({ name:'', stars:5, text:'' }); _renderReviews(); };}

  const _renderPages = () => {
    const list = document.getElementById('ec-pages-list');
    if (!list) return;
    list.innerHTML = _ecPages.map((p, i) => `
      <div style="background:var(--cream);border-radius:8px;padding:8px;display:flex;flex-direction:column;gap:4px;">
        <div style="display:flex;gap:6px;">
          <input value="${(p.title||'').replace(/"/g,'&quot;')}" placeholder="Título (ex: Quem Somos)" data-pg-title="${i}" style="flex:2;padding:4px 6px;border:1px solid var(--border);border-radius:5px;font-size:11px;"/>
          <input value="${(p.slug||'').replace(/"/g,'&quot;')}" placeholder="URL (ex: quem-somos)" data-pg-slug="${i}" style="flex:1;padding:4px 6px;border:1px solid var(--border);border-radius:5px;font-size:11px;"/>
          <button type="button" data-pg-del="${i}" style="background:#FEE2E2;border:none;color:#991B1B;width:28px;border-radius:5px;cursor:pointer;">×</button>
        </div>
        <textarea data-pg-content="${i}" placeholder="Conteúdo (suporta quebras de linha)" rows="4" style="padding:4px 6px;border:1px solid var(--border);border-radius:5px;font-size:11px;resize:vertical;">${(p.content||'').replace(/</g,'&lt;')}</textarea>
      </div>
    `).join('');
    list.querySelectorAll('[data-pg-title]').forEach(el => el.oninput = e => _ecPages[+el.dataset.pgTitle].title = e.target.value);
    list.querySelectorAll('[data-pg-slug]').forEach(el => el.oninput = e => _ecPages[+el.dataset.pgSlug].slug = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,'-'));
    list.querySelectorAll('[data-pg-content]').forEach(el => el.oninput = e => _ecPages[+el.dataset.pgContent].content = e.target.value);
    list.querySelectorAll('[data-pg-del]').forEach(b => b.onclick = () => { _ecPages.splice(+b.dataset.pgDel,1); _renderPages(); });
  };
  {const _el = document.getElementById('btn-add-page'); if (_el) _el.onclick = () => {
    _ecPages.push({ title:'', slug:'', content:'' });
    _renderPages();
  };}

  (async () => {
    if (S.user?.role !== 'Administrador') return;
    try {
      const r = await api('GET', '/settings/ecommerce');
      const cfg = r?.value || {};
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v ?? ''; };
      const setCb = (id, v) => { const el = document.getElementById(id); if (el) el.checked = v !== false; };
      const mode = cfg.mode === 'loja' ? 'loja' : 'catalogo';
      const r1 = document.getElementById('ec-mode-' + (mode === 'loja' ? 'loja' : 'cat'));
      if (r1) r1.checked = true;
      _applyModeHighlight();
      setCb('ec-accepting', cfg.acceptingOrders);
      set('ec-delivery-fee',   cfg.deliveryFee);
      set('ec-free-above',     cfg.freeShippingAbove);
      set('ec-min-order',      cfg.minOrderValue);
      set('ec-shipping-note',  cfg.shippingNote);
      set('ec-closed-msg',     cfg.closedMessage);
      set('ec-wpp-order-msg',  cfg.whatsappOrderMsg);
      // Aparencia
      set('ec-site-name',      cfg.siteName);
      set('ec-site-tagline',   cfg.siteTagline);
      set('ec-color-primary',  cfg.colorPrimary || '#C8736A');
      set('ec-color-secondary',cfg.colorSecondary || '#B8915E');
      set('ec-site-logo',      cfg.siteLogo);
      set('ec-site-favicon',   cfg.siteFavicon);
      set('ec-hero-title',     cfg.heroTitle);
      set('ec-hero-subtitle',  cfg.heroSubtitle);
      set('ec-hero-banner',    cfg.heroBanner);
      _ecBlockedDates = Array.isArray(cfg.blockedDates) ? [...cfg.blockedDates] : [];
      _ecReviews = Array.isArray(cfg.reviews) ? cfg.reviews.map(r=>({...r})) : [];
      _ecPages   = Array.isArray(cfg.pages)   ? cfg.pages.map(p=>({...p}))   : [];
      _renderBlockedList();
      _renderReviews();
      _renderPages();
    } catch(_){}
  })();

  // Salvar E-commerce
  {const _el = document.getElementById('btn-save-ecommerce'); if (_el) _el.onclick = async () => {
    const get = (id) => document.getElementById(id)?.value?.trim() || '';
    const modeRadio = document.querySelector('input[name="ec-mode"]:checked');
    const value = {
      mode: modeRadio?.value === 'loja' ? 'loja' : 'catalogo',
      acceptingOrders: document.getElementById('ec-accepting')?.checked !== false,
      deliveryFee:       Number(get('ec-delivery-fee')) || 0,
      freeShippingAbove: Number(get('ec-free-above'))   || 0,
      minOrderValue:     Number(get('ec-min-order'))    || 0,
      shippingNote: get('ec-shipping-note') || 'Entrega em toda Manaus. Taxa fixa.',
      closedMessage: get('ec-closed-msg') || 'No momento estamos fora do horário online.',
      whatsappOrderMsg: get('ec-wpp-order-msg') || 'Olá! Fiquei interessado(a) no(s) produto(s) abaixo. Pode me ajudar?',
      blockedDates: [..._ecBlockedDates],
      // Aparencia
      siteName:       get('ec-site-name') || 'Floricultura Laços Eternos',
      siteTagline:    get('ec-site-tagline') || 'Flores que dizem tudo por você',
      siteLogo:       get('ec-site-logo'),
      siteFavicon:    get('ec-site-favicon'),
      colorPrimary:   get('ec-color-primary')   || '#C8736A',
      colorSecondary: get('ec-color-secondary') || '#B8915E',
      heroTitle:      get('ec-hero-title') || 'Surpreenda quem você ama',
      heroSubtitle:   get('ec-hero-subtitle') || 'Buquês, cestas e arranjos com entrega rápida em Manaus',
      heroBanner:     get('ec-hero-banner'),
      reviews:        _ecReviews.filter(r => r.name && r.text),
      pages:          _ecPages.filter(p => p.title && p.slug),
    };
    const status = document.getElementById('ecommerce-status');
    if (status) status.textContent = 'Salvando...';
    try {
      await api('PUT', '/settings/ecommerce', { value });
      if (status) { status.textContent = '✅ Salvo! Loja online reflete em até 60s.'; status.style.color = '#15803D'; }
      toast('✅ E-commerce salvo');
    } catch(e) {
      if (status) { status.textContent = '❌ '+(e.message||'erro'); status.style.color = '#DC2626'; }
      toast('❌ Erro ao salvar', true);
    }
  };}

  // ── INTEGRAÇÕES E APIs (admin) ────────────────────────────────
  // Carrega valores salvos no banco
  (async () => {
    if (S.user?.role !== 'Administrador') return;
    try {
      const r = await api('GET', '/settings/integracoes');
      const cfg = r?.value || {};
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v||''; };
      set('int-ga-id',     cfg.google?.analyticsId);
      set('int-gtm-id',    cfg.google?.tagManagerId);
      set('int-gads-id',   cfg.google?.adsConversionId);
      set('int-meta-pixel',cfg.meta?.pixelId);
      set('int-meta-token',cfg.meta?.conversionsToken);
      set('int-mp-token',  cfg.mercadoPago?.accessToken);
      set('int-mp-public', cfg.mercadoPago?.publicKey);
      set('int-wpp-num',   cfg.whatsapp?.number);
      set('int-wpp-msg',   cfg.whatsapp?.defaultMessage);
    } catch(_){}
  })();

  // Salvar integracoes
  {const _el=document.getElementById('btn-save-integracoes'); if(_el) _el.onclick = async () => {
    const get = (id) => document.getElementById(id)?.value?.trim() || '';
    const value = {
      google: {
        analyticsId:     get('int-ga-id'),
        tagManagerId:    get('int-gtm-id'),
        adsConversionId: get('int-gads-id'),
      },
      meta: {
        pixelId:          get('int-meta-pixel'),
        conversionsToken: get('int-meta-token'),
      },
      mercadoPago: {
        accessToken: get('int-mp-token'),
        publicKey:   get('int-mp-public'),
      },
      whatsapp: {
        number: get('int-wpp-num') || '5592993002433',
        defaultMessage: get('int-wpp-msg'),
      },
    };
    const status = document.getElementById('integracoes-status');
    if (status) status.textContent = 'Salvando...';
    try {
      await api('PUT', '/settings/integracoes', { value });
      if (status) { status.textContent = '✅ Salvo! E-commerce já reflete em até 5min.'; status.style.color = '#15803D'; }
      toast('✅ Integrações salvas');
    } catch(e) {
      if (status) { status.textContent = '❌ '+(e.message||'erro'); status.style.color = '#DC2626'; }
      toast('❌ Erro ao salvar', true);
    }
  };}

  // Reset system
  {const _el=document.getElementById('btn-reset-system');if(_el)_el.onclick=()=>showResetModal();}

  // Save delivery fees
  {const _el=document.getElementById('btn-save-fees');if(_el)_el.onclick=()=>{
    document.querySelectorAll('.fee-input').forEach(inp=>{
      const city=inp.dataset.feeCity,zone=inp.dataset.feeZone,val=parseFloat(inp.value)||0;
      if(city&&zone&&DELIVERY_FEES[city])DELIVERY_FEES[city][zone]=val;
    });
    saveDeliveryFees();toast('Taxas salvas!');
  };}

  // Excluir zona especifica
  document.querySelectorAll('.btn-del-zone').forEach(b=>{b.onclick=()=>{
    const city=b.dataset.city, zone=b.dataset.zone;
    if(!city||!zone) return;
    delete DELIVERY_FEES[city][zone];
    saveDeliveryFees(); render(); toast(`Zona "${zone}" removida`);
  }});

  // Excluir cidade (qualquer uma)
  document.querySelectorAll('.btn-del-city').forEach(b=>{b.onclick=()=>{
    const city=b.dataset.city;
    if(!city) return;
    if(!confirm(`Excluir a cidade "${city}" e todas as suas zonas/taxas?`)) return;
    delete DELIVERY_FEES[city];
    saveDeliveryFees(); render(); toast(`Cidade "${city}" removida`);
  }});

  // Nova zona numa cidade especifica
  document.querySelectorAll('.btn-add-zone-city').forEach(b=>{b.onclick=async()=>{
    const city = b.dataset.city;
    S._modal=`<div class="mo" id="mo" onclick="if(event.target===this){S._modal='';render();}"><div class="mo-box" style="max-width:380px;" onclick="event.stopPropagation()">
    <div class="mo-title">Nova Zona em ${city}</div>
    <div class="fg"><label class="fl">Nome da zona *</label><input class="fi" id="zone-name" placeholder="Ex: Ponta Negra" autofocus/></div>
    <div class="fg"><label class="fl">Taxa (R$) *</label><input class="fi" type="number" id="zone-fee" step="0.50" min="0" placeholder="0.00"/></div>
    <div class="mo-foot">
      <button class="btn btn-primary" id="btn-zone-save">Adicionar</button>
      <button class="btn btn-ghost" id="btn-mo-close">Cancelar</button>
    </div></div></div>`;
    await render();
    document.getElementById('btn-mo-close')?.addEventListener('click',()=>{S._modal='';render();});
    document.getElementById('btn-zone-save')?.addEventListener('click',()=>{
      const zone=document.getElementById('zone-name')?.value?.trim();
      const fee=parseFloat(document.getElementById('zone-fee')?.value)||0;
      if(!zone) return toast('Informe o nome da zona',true);
      if(!DELIVERY_FEES[city]) DELIVERY_FEES[city]={};
      DELIVERY_FEES[city][zone]=fee;
      saveDeliveryFees();
      S._modal='';
      render();
      toast(`Zona "${zone}" adicionada em ${city}`);
    });
    // Enter no campo de taxa salva
    document.getElementById('zone-fee')?.addEventListener('keydown',e=>{
      if(e.key==='Enter'){ e.preventDefault(); document.getElementById('btn-zone-save')?.click(); }
    });
    document.getElementById('zone-name')?.focus();
  }});

  // Limpar todas as taxas
  document.querySelectorAll('.btn-reset-fees').forEach(b=>{b.onclick=()=>{
    if(!confirm('Tem certeza que deseja APAGAR TODAS as taxas de entrega? Esta a\u00E7\u00E3o n\u00E3o pode ser desfeita.')) return;
    Object.keys(DELIVERY_FEES).forEach(k=>delete DELIVERY_FEES[k]);
    saveDeliveryFees(); render(); toast('Todas as taxas foram removidas');
  };});

  // Nova cidade
  {const _el=document.getElementById('btn-add-city');if(_el)_el.onclick=async()=>{
    S._modal=`<div class="mo" id="mo" onclick="if(event.target===this){S._modal='';render();}"><div class="mo-box" style="max-width:380px;" onclick="event.stopPropagation()">
    <div class="mo-title">Nova Cidade</div>
    <div class="fg"><label class="fl">Nome da cidade *</label><input class="fi" id="city-name" placeholder="Ex: Manacapuru" autofocus/></div>
    <div class="fg"><label class="fl">Primeira zona (opcional)</label><input class="fi" id="city-zone" placeholder="Ex: Centro"/></div>
    <div class="fg"><label class="fl">Taxa (R$)</label><input class="fi" type="number" id="city-fee" step="0.50" min="0" placeholder="0.00"/></div>
    <div class="mo-foot">
      <button class="btn btn-primary" id="btn-city-save">Adicionar</button>
      <button class="btn btn-ghost" id="btn-mo-close">Cancelar</button>
    </div></div></div>`;
    await render();
    document.getElementById('btn-mo-close')?.addEventListener('click',()=>{S._modal='';render();});
    document.getElementById('btn-city-save')?.addEventListener('click',()=>{
      const city=document.getElementById('city-name')?.value?.trim();
      const zone=document.getElementById('city-zone')?.value?.trim();
      const fee=parseFloat(document.getElementById('city-fee')?.value)||0;
      if(!city) return toast('Informe o nome da cidade',true);
      if(!DELIVERY_FEES[city]) DELIVERY_FEES[city]={};
      if(zone) DELIVERY_FEES[city][zone]=fee;
      saveDeliveryFees();
      S._modal='';
      render();
      toast(`Cidade "${city}" adicionada`);
    });
    document.getElementById('city-fee')?.addEventListener('keydown',e=>{
      if(e.key==='Enter'){ e.preventDefault(); document.getElementById('btn-city-save')?.click(); }
    });
    document.getElementById('city-name')?.focus();
  };}

  // CEP da empresa: auto-preenche via ViaCEP + mascara
  {
    const cepEl = document.getElementById('cfg-cep');
    if(cepEl){
      let lastCep = '';
      const buscar = async (cep) => {
        try{
          const res = await fetch('https://viacep.com.br/ws/'+cep+'/json/');
          if(!res.ok) return;
          const data = await res.json();
          if(data?.erro) return;
          const set = (id, val) => {
            const el = document.getElementById(id);
            if(el && val && !el.value.trim()) el.value = val;
          };
          set('cfg-rua', data.logradouro);
          set('cfg-bairro', data.bairro);
          const cidadeEl = document.getElementById('cfg-cidade');
          if(cidadeEl && data.localidade) cidadeEl.value = data.localidade;
          toast('📍 Endereço preenchido pelo CEP');
        }catch(e){/* silencioso */}
      };
      cepEl.addEventListener('input', e => {
        const d = e.target.value.replace(/\D/g,'').slice(0,8);
        e.target.value = d.length > 5 ? d.slice(0,5) + '-' + d.slice(5) : d;
        if(d.length === 8 && d !== lastCep){ lastCep = d; buscar(d); }
      });
    }
  }

  // Botao de migracao de retiradas antigas (ADM only)
  {const _el=document.getElementById('btn-migrate-retirada-units');if(_el)_el.onclick=async()=>{
    if(S.user?.cargo!=='admin' && S.user?.role!=='Administrador'){ toast('Sem permissão'); return; }
    const out = document.getElementById('migrate-retirada-result');
    if(!confirm('Varrer pedidos de retirada antigos e corrigir a unidade operacional?\n\nEssa operação é segura — só atualiza pedidos onde o local de retirada não bate com a unidade atual.')) return;
    _el.disabled = true;
    _el.textContent = '🔧 Processando...';
    try {
      const { POST } = await import('../services/api.js');
      const r = await POST('/orders/admin/migrate-retirada-units', {});
      out.innerHTML = `<div style="padding:10px;background:#D1FAE5;border:1px solid #10B981;border-radius:8px;color:#065F46;">
        ✅ Correção concluída!<br>
        <strong>${r.analisados}</strong> pedidos de retirada analisados,
        <strong>${r.corrigidos}</strong> corrigidos.
      </div>`;
      toast(`✅ ${r.corrigidos} pedidos corrigidos`);
    } catch(err){
      out.innerHTML = `<div style="padding:10px;background:#FEE2E2;border:1px solid #EF4444;border-radius:8px;color:#991B1B;">❌ Erro: ${err.message}</div>`;
      toast('❌ Erro na migração: '+err.message, true);
    } finally {
      _el.disabled = false;
      _el.textContent = '🔧 Executar Correção';
    }
  };}

  // Migracao de codigos de produto LE0001
  const _runMigrateCodes = async (dryRun) => {
    const out = document.getElementById('migrate-codes-result');
    const btnDry = document.getElementById('btn-migrate-codes-dryrun');
    const btnApp = document.getElementById('btn-migrate-codes');
    if(S.user?.cargo!=='admin' && S.user?.role!=='Administrador'){ toast('Sem permissão'); return; }
    if (!dryRun && !confirm('Renumerar TODOS os produtos no formato LE0001+?\n\nEsta ação substituirá os códigos atuais e é IRREVERSÍVEL.')) return;
    if (btnDry) btnDry.disabled = true;
    if (btnApp) btnApp.disabled = true;
    if (out) out.innerHTML = '<div style="padding:8px;color:var(--muted);">⏳ Processando...</div>';
    try {
      const { POST } = await import('../services/api.js');
      const url = '/products/admin/migrate-codes' + (dryRun ? '?dryRun=true' : '');
      const r = await POST(url, {});
      if (dryRun) {
        out.innerHTML = `<div style="padding:10px;background:#FEF9C3;border:1px solid #FACC15;border-radius:8px;color:#713F12;">
          🔍 <strong>Simulação:</strong> ${r.totalProdutos} produtos analisados, <strong>${r.mudancasNecessarias}</strong> precisam mudar.<br>
          ${r.amostra?.length ? `<details style="margin-top:6px;"><summary style="cursor:pointer;">Ver amostra</summary><ul style="margin:6px 0;padding-left:20px;">${r.amostra.map(m=>`<li><strong>${m.codeAntigo}</strong> → <strong>${m.codeNovo}</strong> (${m.nome})</li>`).join('')}</ul></details>` : ''}
        </div>`;
        toast(`👀 Simulação: ${r.mudancasNecessarias} produtos precisam mudar`);
      } else {
        out.innerHTML = `<div style="padding:10px;background:#D1FAE5;border:1px solid #10B981;border-radius:8px;color:#065F46;">
          ✅ <strong>Renumeração concluída!</strong><br>
          ${r.totalProdutos} produtos · ${r.atualizados} códigos atualizados · próximo será <strong>${r.proximoCodigo}</strong>.
        </div>`;
        toast(`✅ ${r.atualizados} códigos atualizados`);
        // Invalida cache de produtos para forçar reload
        const { invalidateCache } = await import('../services/cache.js');
        invalidateCache('products');
      }
    } catch(err){
      out.innerHTML = `<div style="padding:10px;background:#FEE2E2;border:1px solid #EF4444;border-radius:8px;color:#991B1B;">🚨 Erro: ${err.message}</div>`;
      toast('🚨 Erro: '+err.message, true);
    } finally {
      if (btnDry) btnDry.disabled = false;
      if (btnApp) btnApp.disabled = false;
    }
  };
  document.getElementById('btn-migrate-codes-dryrun')?.addEventListener('click', () => _runMigrateCodes(true));
  document.getElementById('btn-migrate-codes')?.addEventListener('click', () => _runMigrateCodes(false));

  // Recuperação emergencial (corrige produtos com __TMP_*)
  document.getElementById('btn-recover-codes')?.addEventListener('click', async () => {
    const out = document.getElementById('migrate-codes-result');
    if(S.user?.cargo!=='admin' && S.user?.role!=='Administrador'){ toast('Sem permissão'); return; }
    if (!confirm('Recuperar códigos de produto?\n\nReatribui LE0001+ para TODOS os produtos por ordem de cadastro.\nUse esta opção se a migração anterior foi interrompida.')) return;
    if (out) out.innerHTML = '<div style="padding:8px;color:var(--muted);">⏳ Recuperando...</div>';
    try {
      const { POST } = await import('../services/api.js');
      const r = await POST('/products/admin/recover-codes', {});
      out.innerHTML = `<div style="padding:10px;background:#D1FAE5;border:1px solid #10B981;border-radius:8px;color:#065F46;">
        ✅ <strong>Recuperação concluída!</strong><br>
        ${r.totalProdutos} produtos · ${r.tempEncontrados||0} corrigidos · próximo: <strong>${r.proximoCodigo}</strong>.
      </div>`;
      toast(`✅ Recuperação OK — ${r.totalProdutos} produtos`);
      const { invalidateCache } = await import('../services/cache.js');
      invalidateCache('products');
    } catch(err){
      out.innerHTML = `<div style="padding:10px;background:#FEE2E2;border:1px solid #EF4444;border-radius:8px;color:#991B1B;">🚨 Erro: ${err.message}</div>`;
      toast('🚨 Erro na recuperação: '+err.message, true);
    }
  });

  // Save config (migrated to API)
  {const _el=document.getElementById('btn-save-cfg');if(_el)_el.onclick=async()=>{
    const existing = JSON.parse(localStorage.getItem('fv_config')||'{}');
    const cfg={
      ...existing,
      razao:document.getElementById('cfg-razao')?.value,
      cnpj:document.getElementById('cfg-cnpj')?.value,
      ie:document.getElementById('cfg-ie')?.value,
      whats:document.getElementById('cfg-whats')?.value,
      addr:document.getElementById('cfg-addr')?.value,
      email:document.getElementById('cfg-email')?.value,
      // Endereço estruturado (para emissão fiscal)
      cep:         document.getElementById('cfg-cep')?.value?.replace(/\D/g,'') || '',
      rua:         document.getElementById('cfg-rua')?.value?.trim() || '',
      numero:      document.getElementById('cfg-numero')?.value?.trim() || '',
      complemento: document.getElementById('cfg-complemento')?.value?.trim() || '',
      bairro:      document.getElementById('cfg-bairro')?.value?.trim() || '',
      cidade:      document.getElementById('cfg-cidade')?.value?.trim() || 'Manaus',
    };
    await saveConfig(cfg);
    toast('Dados salvos!');
  };}

  // Save logo de login via URL digitada (só admin)
  {const _el=document.getElementById('btn-save-login-logo');if(_el)_el.onclick=async()=>{
    if(S.user?.cargo!=='admin' && S.user?.role!=='Administrador'){ toast('Sem permissão'); return; }
    const existing = JSON.parse(localStorage.getItem('fv_config')||'{}');
    const url = (document.getElementById('cfg-login-logo')?.value||'').trim();
    if(!url){ toast('❌ Cole uma URL ou use o upload de arquivo', true); return; }
    const cfg = { ...existing, loginLogo: url };
    await saveConfig(cfg);
    toast('🖼️ Logo salva!');
    render();
  };}
  // Upload de arquivo → converte para base64 e SALVA DIRETO (sem precisar de botão)
  {const _el=document.getElementById('cfg-login-logo-file');if(_el)_el.onchange=async(e)=>{
    const f = e.target.files?.[0];
    if(!f) return;
    if(S.user?.cargo!=='admin' && S.user?.role!=='Administrador'){ toast('Sem permissão'); return; }
    if(f.size > 2*1024*1024){ toast('❌ Arquivo maior que 2MB', true); return; }
    toast('⏳ Processando imagem...');
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try{
        const base64 = ev.target.result;
        const existing = JSON.parse(localStorage.getItem('fv_config')||'{}');
        const cfg = { ...existing, loginLogo: base64 };
        await saveConfig(cfg);
        toast('✅ Logo enviada e salva!');
        render();
      }catch(err){
        toast('❌ Erro ao salvar: '+(err.message||''), true);
      }
    };
    reader.onerror = () => toast('❌ Erro ao ler o arquivo', true);
    reader.readAsDataURL(f);
  };}
  {const _el=document.getElementById('btn-clear-login-logo');if(_el)_el.onclick=async()=>{
    if(!confirm('Remover a logo customizada?')) return;
    const existing = JSON.parse(localStorage.getItem('fv_config')||'{}');
    const cfg = { ...existing, loginLogo: '' };
    await saveConfig(cfg);
    toast('🗑️ Logo removida');
    render();
  };}

  // ── FAVICON (só admin) ────────────────────────────────────────
  {const _el=document.getElementById('btn-save-favicon');if(_el)_el.onclick=async()=>{
    if(S.user?.cargo!=='admin' && S.user?.role!=='Administrador'){ toast('Sem permissão'); return; }
    const existing = JSON.parse(localStorage.getItem('fv_config')||'{}');
    const url = (document.getElementById('cfg-favicon')?.value||'').trim();
    if(!url){ toast('❌ Cole uma URL ou use o upload de arquivo', true); return; }
    const cfg = { ...existing, favicon: url };
    await saveConfig(cfg);
    applyFaviconFromConfig();
    toast('🔖 Favicon salvo!');
    render();
  };}
  {const _el=document.getElementById('cfg-favicon-file');if(_el)_el.onchange=async(e)=>{
    const f = e.target.files?.[0];
    if(!f) return;
    if(S.user?.cargo!=='admin' && S.user?.role!=='Administrador'){ toast('Sem permissão'); return; }
    if(f.size > 500*1024){ toast('❌ Arquivo maior que 500KB (use imagem menor)', true); return; }
    toast('⏳ Processando favicon...');
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try{
        const base64 = ev.target.result;
        const existing = JSON.parse(localStorage.getItem('fv_config')||'{}');
        const cfg = { ...existing, favicon: base64 };
        await saveConfig(cfg);
        applyFaviconFromConfig();
        toast('✅ Favicon enviado e salvo!');
        render();
      }catch(err){
        toast('❌ Erro ao salvar: '+(err.message||''), true);
      }
    };
    reader.onerror = () => toast('❌ Erro ao ler o arquivo', true);
    reader.readAsDataURL(f);
  };}
  // Save config fiscal
  // ── IFOOD: carregar config + bindings ────────────────────
  (async () => {
    try {
      const { GET } = await import('../services/api.js');
      const data = await GET('/ifood/config').catch(() => null);
      if (!data) return;
      document.getElementById('ifood-client-id').value = data.clientId || '';
      document.getElementById('ifood-client-secret').placeholder = data.hasSecret ? '••••••••••  (configurado — deixe vazio para manter)' : 'Cole o Client Secret';
      document.getElementById('ifood-merchants').value = (data.merchantIds||[]).join(', ');
      document.getElementById('ifood-ambiente').value = data.ambiente || 'producao';
      document.getElementById('ifood-polling').checked = !!data.pollingEnabled;
      document.getElementById('ifood-autoaccept').checked = !!data.autoAccept;
      // Tag de status
      const tag = document.getElementById('ifood-status-tag');
      if (tag) {
        if (data.pollingEnabled && data.tokenValid) {
          tag.className = 'tag t-green'; tag.textContent = '● Ativa';
        } else if (data.clientId && data.hasSecret) {
          tag.className = 'tag t-yellow'; tag.textContent = '○ Pausada';
        } else {
          tag.className = 'tag t-red'; tag.textContent = 'Não configurada';
        }
      }
      // Telemetria
      const tel = document.getElementById('ifood-telemetry');
      if (tel && (data.lastPollingAt || data.errorCount)) {
        tel.style.display = 'block';
        tel.innerHTML = `
          <div><strong>Último polling:</strong> ${data.lastPollingAt ? new Date(data.lastPollingAt).toLocaleString('pt-BR') : '—'}</div>
          <div><strong>Último evento recebido:</strong> ${data.lastEventAt ? new Date(data.lastEventAt).toLocaleString('pt-BR') : '—'}</div>
          ${data.errorCount ? `<div style="color:var(--red)"><strong>Erros:</strong> ${data.errorCount} — ${data.lastError||''}</div>` : '<div style="color:var(--leaf)"><strong>✅ Sem erros recentes</strong></div>'}
        `;
      }
    } catch (e) { console.warn('[iFood config] load falhou:', e); }
  })();

  {const _el=document.getElementById('btn-save-ifood');if(_el)_el.onclick=async()=>{
    const { PUT } = await import('../services/api.js');
    const clientSecret = document.getElementById('ifood-client-secret').value.trim();
    const body = {
      clientId: document.getElementById('ifood-client-id').value.trim(),
      merchantIds: document.getElementById('ifood-merchants').value.split(',').map(s=>s.trim()).filter(Boolean),
      ambiente: document.getElementById('ifood-ambiente').value,
      pollingEnabled: document.getElementById('ifood-polling').checked,
      autoAccept: document.getElementById('ifood-autoaccept').checked,
    };
    if (clientSecret) body.clientSecret = clientSecret;
    try {
      await PUT('/ifood/config', body);
      toast('✅ Configuração iFood salva');
      render();
    } catch (e) { toast('❌ Erro: ' + e.message, true); }
  };}
  {const _el=document.getElementById('btn-test-ifood');if(_el)_el.onclick=async()=>{
    const { POST } = await import('../services/api.js');
    _el.disabled = true; _el.textContent = '⏳ Testando...';
    try {
      const r = await POST('/ifood/test', {});
      toast(r.success ? '✅ Conexão OK! Token: ' + r.token : '❌ ' + r.error, !r.success);
    } catch(e){ toast('❌ ' + e.message, true); }
    _el.disabled = false; _el.textContent = '🔌 Testar conexão';
  };}
  {const _el=document.getElementById('btn-poll-ifood');if(_el)_el.onclick=async()=>{
    const { POST } = await import('../services/api.js');
    _el.disabled = true; _el.textContent = '⏳ Consultando...';
    try {
      const r = await POST('/ifood/poll', {});
      toast(`✅ Polled ${r.polled||0} · Processados ${r.processed||0} · Erros ${r.errors||0}`);
      if ((r.processed||0) > 0) setTimeout(() => window.location.reload(), 1500);
    } catch(e){ toast('❌ ' + e.message, true); }
    _el.disabled = false; _el.textContent = '⚡ Forçar polling agora';
  };}
  {const _el=document.getElementById('btn-log-ifood');if(_el)_el.onclick=async()=>{
    const { GET } = await import('../services/api.js');
    try {
      const events = await GET('/ifood/events');
      const w = window.open('', '_blank', 'width=900,height=700');
      if (!w) return toast('Pop-up bloqueado', true);
      w.document.write(`
        <html><head><title>Log iFood</title>
        <style>body{font-family:system-ui;padding:16px;background:#0F172A;color:#F1F5F9;}
        table{width:100%;border-collapse:collapse;font-size:12px;}
        th,td{padding:6px;border-bottom:1px solid #334155;text-align:left;}
        th{background:#1E293B;position:sticky;top:0;}
        .ok{color:#4ADE80;} .err{color:#F87171;}
        </style></head><body>
        <h2>🍔 Log de Eventos iFood (últimos ${events.length})</h2>
        <table><thead><tr>
          <th>Data</th><th>Evento</th><th>Order iFood</th><th>Status</th><th>Pedido local</th><th>Erro</th>
        </tr></thead><tbody>
        ${events.map(e => `<tr>
          <td>${new Date(e.createdAt).toLocaleString('pt-BR')}</td>
          <td><strong>${e.fullCode||e.code}</strong></td>
          <td style="font-family:monospace;">${e.orderId}</td>
          <td>${e.processed?'<span class=ok>✅ Processado</span>':'<span class=err>⏳ Pendente</span>'} ${e.acknowledged?'<span class=ok>📬 Ack</span>':''}</td>
          <td>${e.localOrderId||'—'}</td>
          <td class=err>${e.error||''}</td>
        </tr>`).join('')}
        </tbody></table>
        </body></html>
      `);
    } catch(e){ toast('❌ ' + e.message, true); }
  };}

  {const _el=document.getElementById('btn-save-fiscal');if(_el)_el.onclick=async()=>{
    const existing = JSON.parse(localStorage.getItem('fv_config')||'{}');
    const cfg = {
      ...existing,
      regimeTributario:   document.getElementById('cfg-regime')?.value || '',
      cnae:               document.getElementById('cfg-cnae')?.value?.trim() || '',
      ncmDefault:         document.getElementById('cfg-ncm-default')?.value?.replace(/\D/g,'') || '',
      cfopDefault:        document.getElementById('cfg-cfop')?.value?.replace(/\D/g,'') || '',
      csosnDefault:       document.getElementById('cfg-csosn')?.value?.replace(/\D/g,'') || '',
      icmsAliquota:       parseFloat(document.getElementById('cfg-icms')?.value) || 0,
      origemMercadoria:   document.getElementById('cfg-origem')?.value || '0',
      unidadeComercial:   document.getElementById('cfg-unidade')?.value?.trim()?.toUpperCase() || 'UN',
      nfeGateway:         document.getElementById('cfg-nfe-gateway')?.value || 'mock',
      focusToken:         document.getElementById('cfg-focus-token')?.value?.trim() || existing.focusToken || '',
      cscId:              document.getElementById('cfg-csc-id')?.value?.trim() || '1',
      cscToken:           document.getElementById('cfg-csc-token')?.value?.trim() || existing.cscToken || '',
    };
    await saveConfig(cfg);
    toast('✅ Configuração fiscal salva!');
    render();
  };}

  {const _el=document.getElementById('btn-clear-favicon');if(_el)_el.onclick=async()=>{
    if(!confirm('Remover o favicon customizado?')) return;
    const existing = JSON.parse(localStorage.getItem('fv_config')||'{}');
    const cfg = { ...existing, favicon: '' };
    await saveConfig(cfg);
    applyFaviconFromConfig();
    toast('🗑️ Favicon removido — usando padrão');
    render();
  };}

  // Save client code start (permissioned)
  {const _el=document.getElementById('btn-save-client-code-start');if(_el)_el.onclick=async()=>{
    if(!canManageClientTier()){ toast('Sem permissão'); return; }
    const existing = JSON.parse(localStorage.getItem('fv_config')||'{}');
    const val = parseInt(document.getElementById('cfg-client-code-start')?.value)||1;
    const cfg = { ...existing, clientCodeStart: Math.max(1, val) };
    await saveConfig(cfg);
    toast('Numeração salva!');
    render();
  };}

  // IA Key handlers
  {const _el=document.getElementById('btn-clear-ia-key');if(_el)_el.onclick=async()=>{
    const cfg = JSON.parse(localStorage.getItem('fv_config')||'{}');
    await saveConfig(cfg);
    toast('Chave da IA removida'); render();
  };}
  {const _el=document.getElementById('btn-test-ia');if(_el)_el.onclick=async()=>{
    toast('Testando IA...');
    // sendChat would need to be imported if used; for now navigate to IA page
    setPage('ia');
  };}

  // ── Certificado Digital — binding robusto ────────────────
  if(!window._certState) window._certState = { base64: null, nome: null, size: null };

  const certFileEl = document.getElementById('cert-file');
  if(certFileEl){
    const newInput = certFileEl.cloneNode(true);
    certFileEl.parentNode.replaceChild(newInput, certFileEl);
    newInput.addEventListener('change', e=>{
      const f = e.target.files?.[0];
      if(!f) return;
      if(!f.name.match(/\.(pfx|p12)$/i))
        return toast('Selecione um arquivo .pfx ou .p12');

      const reader = new FileReader();
      reader.onload = ev => {
        const result = ev.target.result;
        let b64;
        if(typeof result === 'string'){
          b64 = result.includes(',') ? result.split(',')[1] : btoa(result);
        } else {
          const bytes = new Uint8Array(result);
          let binary = '';
          bytes.forEach(byte => binary += String.fromCharCode(byte));
          b64 = btoa(binary);
        }
        window._certState = { base64: b64, nome: f.name, size: f.size };

        const lbl = document.getElementById('cert-drop-label');
        if(lbl) lbl.innerHTML = `
          <div style="font-size:28px;margin-bottom:6px">&#9989;</div>
          <div style="font-size:13px;font-weight:700;color:var(--leaf)">${f.name}</div>
          <div style="font-size:11px;color:var(--muted)">${(f.size/1024).toFixed(1)} KB - Clique para trocar</div>`;
        const zone = document.getElementById('cert-drop-zone');
        if(zone){ zone.style.borderColor='var(--leaf)'; zone.style.background='var(--leaf-l)'; }
        toast('Arquivo carregado: '+f.name);
      };
      reader.onerror = () => toast('Erro ao ler o arquivo');
      reader.readAsArrayBuffer(f);
    });
  }

  {const _el=document.getElementById('btn-save-cert');if(_el)_el.onclick=async()=>{
    const pass      = document.getElementById('cert-pass')?.value||'';
    const ambiente  = document.getElementById('cert-ambiente')?.value||'homologacao';
    const serieNFe  = document.getElementById('cert-serie-nfe')?.value||'001';
    const serieNFCe = document.getElementById('cert-serie-nfce')?.value||'001';
    const cnpj      = document.getElementById('cert-cnpj')?.value||'';

    const existingCfg = JSON.parse(localStorage.getItem('fv_config')||'{}');
    const certB64 = window._certState.base64 || existingCfg.certData;

    if(!certB64) return toast('Selecione o arquivo .pfx primeiro');
    if(!pass)    return toast('Informe a senha do certificado');

    const cfg = {
      ...existingCfg,
      certData:        certB64,
      certNome:        window._certState.nome || existingCfg.certNome || 'certificado.pfx',
      certPass:        pass,
      certAmbiente:    ambiente,
      certSerieNFe:    serieNFe,
      certSerieNFCe:   serieNFCe,
      cnpj:            cnpj || existingCfg.cnpj,
      certVencimento:  'Verificar via backend',
    };
    await saveConfig(cfg);
    window._certState = { base64: null, nome: null, size: null };
    toast('Certificado digital salvo com sucesso!');
    render();
  };}
  {const _el=document.getElementById('btn-del-cert');if(_el)_el.onclick=async()=>{
    const cfg = JSON.parse(localStorage.getItem('fv_config')||'{}');
    delete cfg.certData; delete cfg.certPass; delete cfg.certNome;
    await saveConfig(cfg);
    window._certState = { base64: null, nome: null, size: null };
    toast('Certificado removido'); render();
  };}
  {const _el=document.getElementById('btn-test-cert');if(_el)_el.onclick=()=>{
    toast('Testando certificado... Requer backend configurado com NFePHP ou DFe.');
  };}
  {const _el=document.getElementById('btn-sug');if(_el)_el.onclick=()=>{toast('Sugestao enviada!');document.getElementById('sug-txt').value='';};}

  // Notif template
  document.getElementById('notif-template')?.addEventListener('input',e=>{
    const preview=document.getElementById('notif-preview');
    if(preview) preview.textContent=e.target.value.replace(/{nome}/gi,'Maria').replace(/{produto}/gi,'Buque Premium').replace(/{data}/gi,new Date().toLocaleDateString('pt-BR')).replace(/{floricultura}/gi,'Lacos Eternos');
  });
  {const _el=document.getElementById('btn-save-notif');if(_el)_el.onclick=async()=>{
    const t=document.getElementById('notif-template')?.value;
    if(t){
      await saveNotifCfg({template:t});
      toast('Mensagem salva!');
    }
  };}

  // Test API connection
  {const _el=document.getElementById('btn-test-api');if(_el)_el.onclick=async()=>{
    toast('⏳ Testando conexao...');
    const t0 = Date.now();
    try{
      const res = await fetch('https://florevita-backend-2-0.onrender.com/api/health',{
        signal: AbortSignal.timeout(35000),  // 35s para dar tempo de acordar o Render
      });
      const data = await res.json().catch(()=>({}));
      const ms = Date.now() - t0;
      // Backend retorna { ok: true, ts, uptime, db? }
      if(res.ok && (data.ok === true || data.status === 'ok')){
        const uptimeMin = Math.round((data.uptime||0)/60);
        toast(`✅ Backend online! (${ms}ms) · Uptime: ${uptimeMin}min${data.db?' · DB: '+data.db:''}`);
      } else {
        toast(`⚠️ Backend respondeu HTTP ${res.status} — ${JSON.stringify(data).slice(0,100)}`, true);
      }
    }catch(e){
      if(e.name === 'TimeoutError' || e.name === 'AbortError'){
        toast('⏱️ Backend demorou mais de 35s (pode estar acordando) — tente novamente em 10s', true);
      } else {
        toast(`❌ Sem conexao: ${e.message || 'erro desconhecido'}`, true);
      }
    }
  };}

  // TI Diagnostics button
  {const _el=document.getElementById('btn-run-diag');if(_el)_el.onclick=()=>tiRunDiagnostics();}

  // TI Fix buttons
  document.querySelectorAll('[data-ti-fix]').forEach(b=>{
    b.onclick=()=>tiFix(b.dataset.tiFix);
  });

  // TI Chat send
  {const _el=document.getElementById('btn-ti-send');if(_el)_el.onclick=()=>{
    const input=document.getElementById('ti-chat-input');
    if(input&&input.value.trim()){ tiChat(input.value.trim()); input.value=''; }
  };}
  {const _el=document.getElementById('ti-chat-input');if(_el)_el.onkeydown=(e)=>{
    if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); document.getElementById('btn-ti-send')?.click(); }
  };}
}
