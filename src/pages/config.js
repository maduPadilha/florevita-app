// ── CONFIGURACOES ────────────────────────────────────────────
import { S, API } from '../state.js';
import { $c, $d } from '../utils/formatters.js';
import { toast, setPage } from '../utils/helpers.js';
import { api } from '../services/api.js';
import { logout } from '../services/auth.js';
import { recarregarDados } from '../services/cache.js';
import { startPolling, stopPolling } from '../services/polling.js';

// ── Helper: render() via dynamic import ───────────────────────
async function render(){
  const { render:r } = await import('../main.js');
  r();
}

// ── DELIVERY FEES (kept in localStorage) ─────────────────────
let DELIVERY_FEES = JSON.parse(localStorage.getItem('fv_delivery_fees')||'{"Manaus":{"Zona Centro":15,"Zona Norte":20,"Zona Sul":18,"Zona Leste":20,"Zona Oeste":18,"Outros":25}}');
function saveDeliveryFees(){ localStorage.setItem('fv_delivery_fees',JSON.stringify(DELIVERY_FEES)); }
export { DELIVERY_FEES, saveDeliveryFees };

// ── CONFIG LOAD/SAVE (migrated to API with localStorage fallback) ──
async function loadConfig(){
  try{
    const data = await api('GET','/settings/config');
    if(data && typeof data === 'object' && Object.keys(data).length > 0){
      localStorage.setItem('fv_config', JSON.stringify(data));
      return data;
    }
  }catch(e){ /* fallback to localStorage */ }
  return JSON.parse(localStorage.getItem('fv_config')||'{}');
}

async function saveConfig(cfg){
  localStorage.setItem('fv_config', JSON.stringify(cfg));
  try{ await api('PUT','/settings/config', cfg); }catch(e){ /* saved locally */ }
}

async function loadNotifCfg(){
  try{
    const data = await api('GET','/settings/notif-cfg');
    if(data && typeof data === 'object' && Object.keys(data).length > 0){
      localStorage.setItem('fv_notif_cfg', JSON.stringify(data));
      return data;
    }
  }catch(e){ /* fallback */ }
  return JSON.parse(localStorage.getItem('fv_notif_cfg')||'{}');
}

async function saveNotifCfg(cfg){
  localStorage.setItem('fv_notif_cfg', JSON.stringify(cfg));
  try{ await api('PUT','/settings/notif-cfg', cfg); }catch(e){ /* saved locally */ }
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
      setTimeout(()=>{ startPolling(8000); toast('Polling reiniciado!'); }, 500);
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
        startPolling(8000);
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
      <div class="fg"><label class="fl">Endereco</label><input class="fi" id="cfg-addr" value="${cfg.addr||''}" placeholder="Rua, numero — Manaus/AM"/></div>
      <div class="fg"><label class="fl">E-mail</label><input class="fi" id="cfg-email" value="${cfg.email||''}" placeholder="contato@lacoseternos.com.br"/></div>
      <button class="btn btn-primary" id="btn-save-cfg">Salvar Dados</button>
    </div>

    <!-- IA CONFIG — via OpenAI (chave no backend) -->
    <div class="card" style="margin-bottom:14px;border:1px solid rgba(45,106,79,.3)">
      <div class="card-title">Flora IA — Configuracao
        <span class="tag t-green">Via OpenAI (GPT-4o)</span>
      </div>
      <div class="alert al-ok" style="margin-bottom:10px;">
        <strong>IA configurada e segura.</strong> A chave da OpenAI fica protegida no servidor backend — nunca exposta no navegador.
      </div>
      <div style="font-size:13px;color:var(--muted);line-height:1.8;">
        <div><strong>Para ativar:</strong> No Render - seu servico backend - <strong>Environment - Add Variable</strong></div>
        <div style="background:var(--cream);border-radius:6px;padding:8px 12px;margin:8px 0;font-family:monospace;font-size:12px;">OPENAI_API_KEY = sk-...</div>
        <div>Obtenha a chave em <strong>platform.openai.com</strong> - API Keys</div>
      </div>
      <div style="margin-top:10px;display:flex;gap:8px;">
        <a href="https://platform.openai.com/api-keys" target="_blank" class="btn btn-outline btn-sm">Obter chave OpenAI</a>
      </div>
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
      <div class="card-title">Taxas de Entrega</div>
      ${Object.entries(DELIVERY_FEES).map(([city,zones])=>`
      <div style="background:var(--cream);border-radius:8px;padding:10px;margin-bottom:10px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <div style="font-weight:700;font-size:12px;color:var(--ink)">${city}</div>
          <div style="display:flex;gap:4px;">
            <button class="btn btn-ghost btn-xs btn-add-zone-city" data-city="${city}" title="Nova zona">+ Zona</button>
            ${city!=='Manaus'?`<button class="btn btn-xs btn-del-city" data-city="${city}" style="background:var(--red-l);color:var(--red);border:1px solid rgba(220,38,38,.2);border-radius:6px;padding:3px 7px;font-size:11px;" title="Excluir cidade">&#128465;</button>`:''}
          </div>
        </div>
        ${Object.entries(zones).map(([zone,fee])=>`
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:5px;">
          <span style="flex:1;font-size:12px;font-weight:500">${zone}</span>
          <input type="number" value="${fee}" step="0.50" style="width:75px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;" data-fee-city="${city}" data-fee-zone="${zone}" class="fee-input"/>
          <span style="font-size:11px;color:var(--muted)">R$</span>
          <button class="btn btn-xs btn-del-zone" data-city="${city}" data-zone="${zone}" style="background:var(--red-l);color:var(--red);border:1px solid rgba(220,38,38,.2);border-radius:6px;padding:3px 5px;font-size:10px;" title="Excluir">&#10005;</button>
        </div>`).join('')}
      </div>`).join('')}
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">
        <button class="btn btn-primary btn-sm" id="btn-save-fees">Salvar Taxas</button>
        <button class="btn btn-ghost btn-sm" id="btn-add-zone">+ Nova Zona em Manaus</button>
        <button class="btn btn-ghost btn-sm" id="btn-add-city">Nova Cidade</button>
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

  // Excluir cidade
  document.querySelectorAll('.btn-del-city').forEach(b=>{b.onclick=()=>{
    const city=b.dataset.city;
    if(!city||city==='Manaus') return toast('Nao e possivel excluir Manaus');
    delete DELIVERY_FEES[city];
    saveDeliveryFees(); render(); toast(`Cidade "${city}" removida`);
  }});

  // Nova zona numa cidade especifica
  document.querySelectorAll('.btn-add-zone-city').forEach(b=>{b.onclick=()=>{
    const city = b.dataset.city;
    S._modal=`<div class="mo" id="mo"><div class="mo-box" style="max-width:380px;" onclick="event.stopPropagation()">
    <div class="mo-title">Nova Zona em ${city}</div>
    <div class="fg"><label class="fl">Nome da zona *</label><input class="fi" id="zone-name" placeholder="Ex: Ponta Negra"/></div>
    <div class="fg"><label class="fl">Taxa (R$) *</label><input class="fi" type="number" id="zone-fee" step="0.50" placeholder="0.00"/></div>
    <div class="mo-foot">
      <button class="btn btn-primary" id="btn-zone-save">Adicionar</button>
      <button class="btn btn-ghost" id="btn-mo-close">Cancelar</button>
    </div></div></div>`;
    render();
    {const _el=document.getElementById('btn-mo-close');if(_el)_el.onclick=()=>{S._modal='';render();};}
    {const _el=document.getElementById('btn-zone-save');if(_el)_el.onclick=()=>{
      const zone=document.getElementById('zone-name')?.value?.trim();
      const fee=parseFloat(document.getElementById('zone-fee')?.value)||0;
      if(!zone) return toast('Informe o nome da zona');
      if(!DELIVERY_FEES[city]) DELIVERY_FEES[city]={};
      DELIVERY_FEES[city][zone]=fee;
      saveDeliveryFees(); S._modal=''; render(); toast(`Zona "${zone}" adicionada em ${city}`);
    };}
  }});

  // Nova zona em Manaus (botao principal)
  {const _el=document.getElementById('btn-add-zone');if(_el)_el.onclick=async()=>{
    S._modal=`<div class="mo" id="mo"><div class="mo-box" style="max-width:380px;" onclick="event.stopPropagation()">
    <div class="mo-title">Nova Zona — Manaus</div>
    <div class="fg"><label class="fl">Nome da zona *</label><input class="fi" id="zone-name" placeholder="Ex: Taruma"/></div>
    <div class="fg"><label class="fl">Taxa (R$) *</label><input class="fi" type="number" id="zone-fee" step="0.50" placeholder="0.00"/></div>
    <div class="mo-foot">
      <button class="btn btn-primary" id="btn-zone-save">Adicionar</button>
      <button class="btn btn-ghost" id="btn-mo-close">Cancelar</button>
    </div></div></div>`;
    await render();
    document.getElementById('btn-mo-close')?.addEventListener('click',()=>{S._modal='';render();});
    document.getElementById('btn-zone-save')?.addEventListener('click',()=>{
      const zone=document.getElementById('zone-name')?.value?.trim();
      const fee=parseFloat(document.getElementById('zone-fee')?.value)||0;
      if(!zone) return toast('Informe o nome da zona');
      if(!DELIVERY_FEES['Manaus']) DELIVERY_FEES['Manaus']={};
      DELIVERY_FEES['Manaus'][zone]=fee;
      saveDeliveryFees(); S._modal=''; render(); toast(`Zona "${zone}" adicionada`);
    });
  };}

  // Nova cidade
  {const _el=document.getElementById('btn-add-city');if(_el)_el.onclick=async()=>{
    S._modal=`<div class="mo" id="mo"><div class="mo-box" style="max-width:380px;" onclick="event.stopPropagation()">
    <div class="mo-title">Nova Cidade</div>
    <div class="fg"><label class="fl">Nome da cidade *</label><input class="fi" id="city-name" placeholder="Ex: Manacapuru"/></div>
    <div class="fg"><label class="fl">Primeira zona</label><input class="fi" id="city-zone" placeholder="Ex: Centro"/></div>
    <div class="fg"><label class="fl">Taxa (R$)</label><input class="fi" type="number" id="city-fee" step="0.50" placeholder="0.00"/></div>
    <div class="mo-foot">
      <button class="btn btn-primary" id="btn-city-save">Adicionar</button>
      <button class="btn btn-ghost" id="btn-mo-close">Cancelar</button>
    </div></div></div>`;
    await render();
    document.getElementById('btn-mo-close')?.addEventListener('click',()=>{S._modal='';render();});
    document.getElementById('btn-city-save')?.addEventListener('click',()=>{
      const city=document.getElementById('city-name')?.value?.trim();
      const zone=document.getElementById('city-zone')?.value?.trim()||'Centro';
      const fee=parseFloat(document.getElementById('city-fee')?.value)||0;
      if(!city) return toast('Informe o nome da cidade');
      DELIVERY_FEES[city]={[zone]:fee};
      saveDeliveryFees(); S._modal=''; render(); toast(`Cidade "${city}" adicionada`);
    });
  };}

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
    };
    await saveConfig(cfg);
    toast('Dados salvos!');
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
    toast('Testando conexao...');
    try{
      const res = await fetch('https://florevita-backend-2-0.onrender.com/api/health',{signal:AbortSignal.timeout(8000)});
      const data = await res.json().catch(()=>({}));
      if(data.status==='ok') toast('Backend online! DB: '+(data.db||'OK'));
      else toast('Backend respondeu mas status diferente de OK');
    }catch(e){
      toast('Backend nao respondeu — pode estar dormindo');
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
