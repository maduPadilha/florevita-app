import { S, ALL_PERMS, PERMS_DEFAULT } from '../state.js';
import { $c, $d, ini, rolec, esc } from '../utils/formatters.js';
import { GET, POST, PUT, DELETE } from '../services/api.js';
import { toast } from '../utils/helpers.js';
import { can, getColabs, saveColabs, findColab, getUserPerms, setUserPerms, fetchAndMergeColabs, pushColabToAPI } from '../services/auth.js';

// ── Helper: render() via dynamic import ───────────────────────
async function render(){
  const { render:r } = await import('../main.js');
  r();
}

// ── Helper: mergeUserExtra via dynamic import ─────────────────
async function _mergeUserExtra(u){
  const { mergeUserExtra } = await import('../services/auth.js');
  return mergeUserExtra(u);
}

// ── Helper: PATCH via dynamic import ──────────────────────────
async function PATCH(path, body){
  const { PATCH:P } = await import('../services/api.js');
  return P(path, body);
}

// ── Helper: getActivities ─────────────────────────────────────
function getActivities(){ return JSON.parse(localStorage.getItem('fv_activities')||'[]'); }

// ── METAS -- calculo de desempenho ────────────────────────────
export function getMetasPeriod(per){
  const now = new Date();
  const start = new Date();
  if(per==='dia'){
    start.setHours(0,0,0,0);
  } else if(per==='semana'){
    const day = now.getDay(); // 0=dom
    start.setDate(now.getDate() - day);
    start.setHours(0,0,0,0);
  } else { // mes
    start.setDate(1); start.setHours(0,0,0,0);
  }
  return start;
}

export function getColabStats(colab){
  if(!colab) return {vendas:0,comissao:0,montagens:0,expedicoes:0};
  const acts = getActivities();
  // Identifica userId do colaborador -- pode ser backendId ou id local
  const ids = new Set([colab.id, colab.backendId].filter(Boolean));
  const emailLow = (colab.email||'').toLowerCase();

  const mPer = colab.metas?.montagemPer || 'dia';
  const ePer = colab.metas?.expedicaoPer || 'dia';
  const mStart = getMetasPeriod(mPer);
  const eStart = getMetasPeriod(ePer);

  let vendas=0, comissao=0, montagens=0, expedicoes=0;
  acts.forEach(a=>{
    const byId   = ids.has(a.userId);
    const byEmail= (a.userEmail||'').toLowerCase()===emailLow;
    const byName = (a.userName||'').toLowerCase()===(colab.name||'').toLowerCase();
    const isMe   = byId || byEmail || byName;
    if(!isMe) return;
    const aDate = new Date(a.date);
    if(a.type==='venda'){
      vendas++;
      // comissaoVenda = porcentagem (ex: 5 = 5% do total)
      const pct = colab.metas?.comissaoVenda||colab.metas?.vendaPct||0;
      comissao += (a.total||0) * (pct/100);
    }
    if(a.type==='montagem' && aDate >= mStart){
      montagens++;
      comissao += colab.metas?.comissaoMontagem||0;
    }
    if(a.type==='expedicao' && aDate >= eStart){
      expedicoes++;
      comissao += colab.metas?.comissaoExpedicao||0;
    }
  });
  return {vendas, comissao, montagens, expedicoes};
}

export function metaBar(atual, meta, label, unit=''){
  if(!meta) return '';
  const pct = Math.min(100, Math.round((atual/meta)*100));
  const cor = pct>=100?'var(--leaf)':pct>=60?'#F59E0B':'var(--red)';
  return`<div style="margin-bottom:6px;">
    <div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:2px;">
      <span>${label}</span>
      <span style="font-weight:700;color:${cor}">${atual}/${meta}${unit} <span style="color:var(--muted)">(${pct}%)</span></span>
    </div>
    <div style="height:5px;background:#E5E7EB;border-radius:3px;overflow:hidden;">
      <div style="height:100%;width:${pct}%;background:${cor};border-radius:3px;transition:width .4s;"></div>
    </div>
  </div>`;
}

// ── MODULO COLABORADORES ──────────────────────────────────────
const MODULOS_COLABS = [
  {k:'dashboard',    l:'📊 Dashboard',        grupo:'Visao'},
  {k:'pdv',          l:'🛒 PDV (Vendas)',      grupo:'Vendas'},
  {k:'orders',       l:'📋 Pedidos',           grupo:'Vendas'},
  {k:'caixa',        l:'💵 Caixa',             grupo:'Vendas'},
  {k:'clients',      l:'👥 Clientes',          grupo:'Cadastros'},
  {k:'products',     l:'🌹 Produtos',          grupo:'Cadastros'},
  {k:'stock',        l:'📦 Estoque',           grupo:'Cadastros'},
  {k:'production',   l:'🌿 Producao',          grupo:'Operacao'},
  {k:'delivery',     l:'📤 Expedicao/Entrega', grupo:'Operacao'},
  {k:'financial',    l:'💰 Financeiro',        grupo:'Financeiro'},
  {k:'reports',      l:'📈 Relatorios',        grupo:'Financeiro'},
  {k:'notasFiscais', l:'🧾 Notas Fiscais',     grupo:'Financeiro'},
  {k:'ponto',        l:'🕐 Ponto',             grupo:'RH'},
  {k:'rh',           l:'🧑‍💼 RH',              grupo:'RH'},
  {k:'whatsapp',     l:'💬 WhatsApp',          grupo:'Config'},
  {k:'backup',       l:'💾 Backup',            grupo:'Config'},
];

const CARGOS_COLABS=['Gerente','Atendimento','Producao','Expedicao','Financeiro','Entregador','Contador'];
const UNIDADES_COLABS=['Loja Novo Aleixo','Loja Allegro Mall','CDLE','Todas'];

// ── Fetch collaborators from API with localStorage fallback ───
// Triggers a ONE-TIME background merge from /api/collaborators
let _colabFetched = false;
function triggerColabFetch(){
  if(_colabFetched) return;
  _colabFetched = true;
  fetchAndMergeColabs().then(merged => {
    if(merged?.length && S.page === 'colaboradores' && !S._modal){
      render();
    }
  }).catch(e => {
    console.warn('[colaboradores] API fetch failed:', e.message);
  });
}

export function renderColaboradores(){
  // Normaliza role/cargo para comparacao case-insensitive
  const roleLow  = String(S.user?.role  || '').toLowerCase();
  const cargoLow = String(S.user?.cargo || '').toLowerCase();
  const isAdmin = roleLow === 'administrador' || cargoLow === 'admin' || cargoLow === 'administrador';
  const isGerente = roleLow === 'gerente' || cargoLow === 'gerente';
  // Gerente tem acesso READ-ONLY: pode ver lista + Sincronizar, mas nao edita
  const readOnly = !isAdmin && isGerente;
  if (!isAdmin && !isGerente) return`
  <div class="empty card"><div class="empty-icon">🔒</div>
  <p style="font-weight:600">Acesso restrito</p>
  <p style="font-size:12px;margin-top:4px">Somente Administrador ou Gerente podem acessar colaboradores.</p>
  <p style="font-size:10px;margin-top:10px;color:var(--muted);">Seu cargo atual: <strong>${S.user?.cargo||S.user?.role||'—'}</strong></p>
  </div>`;

  // Trigger background fetch from /api/collaborators (merges into localStorage)
  triggerColabFetch();

  // Colaboradores: fv_colabs local (fonte principal) + backend como complemento
  const localColabs = getColabs();
  const localEmails = new Set(localColabs.map(c=>(c.email||'').toLowerCase()));
  const extrasBackend = (S.users||[])
    .filter(u => u.email && !localEmails.has((u.email||'').toLowerCase()))
    .map(u => ({
      id:'cb_'+u._id, backendId:u._id, name:u.name, email:u.email||'',
      cargo:u.role||'Atendimento', unidade:u.unit||'Loja Novo Aleixo',
      active:u.active!==false, senha:'', modulos:{}, metas:{}, _fromBackend:true,
    }));
  const colabs = [...localColabs, ...extrasBackend];
    const q=(S._colabSearch||'').toLowerCase();
  const list=colabs.filter(c=>!q||c.name?.toLowerCase().includes(q)||c.email?.toLowerCase().includes(c.email)||c.cargo?.toLowerCase().includes(q));

  return`
${readOnly ? `
<div style="background:#FFFBEB;border:1px solid #FCD34D;border-radius:10px;padding:10px 14px;margin-bottom:12px;font-size:12px;color:#78350F;">
  👔 <strong>Visualização de Gerente (somente leitura).</strong> Você pode sincronizar colaboradores para ativar em novas máquinas, mas não pode cadastrar, editar ou excluir — somente o administrador.
</div>
` : `
<div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:10px;padding:10px 14px;margin-bottom:12px;font-size:11px;color:#1E40AF;">
  💡 <strong>Como funciona o login dos colaboradores:</strong> Ao salvar, o sistema cria a conta no servidor automaticamente. Colaboradores usam o <strong>e-mail + senha</strong> definidos aqui para entrar de qualquer dispositivo. Se algum nao consegue logar, clique em <strong>🔄 Sincronizar Todos</strong>.
</div>`}

<div style="display:flex;gap:8px;margin-bottom:14px;align-items:center;flex-wrap:wrap;">
  <div class="search-box" style="flex:1;min-width:180px;">
    <span class="si">🔍</span>
    <input class="fi" id="colab-search" placeholder="Buscar colaborador..." value="${S._colabSearch||''}"/>
  </div>
  <button class="btn btn-ghost btn-sm" id="btn-sync-all-colabs" style="white-space:nowrap;">🔄 Sincronizar Todos</button>
  ${!readOnly ? `<button class="btn btn-primary" onclick="showColabModal()">➕ Novo Colaborador</button>` : ''}
</div>

<div class="g3" style="margin-bottom:14px;">
  <div class="mc rose"><div class="mc-label">Total</div><div class="mc-val">${colabs.length}</div></div>
  <div class="mc leaf"><div class="mc-label">Ativos</div><div class="mc-val">${colabs.filter(c=>c.active!==false).length}</div></div>
  <div class="mc gold"><div class="mc-label">Sincronizados</div><div class="mc-val">${colabs.filter(c=>c.apiId||c.backendId).length}</div></div>
</div>

${list.length===0?`<div class="empty card"><div class="empty-icon">👥</div><p>${colabs.length===0?'Nenhum colaborador cadastrado. Clique em ➕ Novo Colaborador para comecar.':'Nenhum resultado.'}</p></div>`:`
<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;">
${list.map(c=>{
  const ativo=c.active!==false;
  const mods=c.modulos||{};
  const qtdAtivos=MODULOS_COLABS.filter(m=>mods[m.k]).length;
  const mt=c.metas||{};
  const stats=getColabStats(c);
  const temMetas = c.cargo==='Entregador'
    ? (mt.valorEntrega>0)
    : (mt.comissaoVenda>0||mt.comissaoMontagem>0||mt.comissaoExpedicao>0||mt.montagemQtd>0||mt.expedicaoQtd>0);
  return`
<div style="background:#fff;border-radius:var(--rl);border:1px solid var(--border);box-shadow:var(--shadow);overflow:hidden;">
  <div style="background:linear-gradient(135deg,var(--rose-l),var(--petal));padding:14px;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--border);">
    <div class="av" style="width:42px;height:42px;font-size:15px;flex-shrink:0;background:${ativo?'var(--rose)':'var(--muted)'};">${ini(c.name)}</div>
    <div style="flex:1;min-width:0;">
      <div style="font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.name}</div>
      <div style="font-size:10px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.email||'sem e-mail'}</div>
    </div>
    <span class="tag ${ativo?'t-green':'t-red'}" style="font-size:9px;flex-shrink:0">${ativo?'Ativo':'Inativo'}</span>
  </div>
  <div style="padding:12px;">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px;font-size:11px;">
      <div>
        <div style="color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px">Cargo</div>
        <span class="tag ${rolec(c.cargo)}" style="font-size:10px">${c.cargo||'—'}</span>
      </div>
      <div>
        <div style="color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px">Unidade</div>
        <div style="font-weight:500;font-size:11px">${c.unidade||'—'}</div>
      </div>
      <div>
        <div style="color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px">Modulos</div>
        <div style="font-weight:600;font-size:11px;color:var(--leaf)">${qtdAtivos} de ${MODULOS_COLABS.length} ativos</div>
      </div>
      <div>
        <div style="color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px">Acesso</div>
        <div style="font-size:10px;font-weight:600;color:${c.senha?'var(--leaf)':'var(--red)'}">
          ${c.senha?'🔑 Senha definida':'⚠️ Sem senha — nao consegue entrar'}
        </div>
      </div>
      <div>
        <div style="color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px">Servidor</div>
        <div style="font-size:10px;font-weight:600;color:${(c.apiId||c.backendId)?'var(--leaf)':'var(--red)'}">
          ${(c.apiId||c.backendId)?'✅ Sincronizado':'❌ Nao sincronizado'}
        </div>
      </div>
      ${c.phone?`<div>
        <div style="color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px">WhatsApp</div>
        <div style="font-size:11px">${c.phone}</div>
      </div>`:''}
    </div>
    ${c.senha?`<div style="background:${(c.apiId||c.backendId)?'#F0FDF4':'#FEF9C3'};border-radius:8px;padding:8px 10px;margin-bottom:10px;border:1px solid ${(c.apiId||c.backendId)?'#86EFAC':'#FDE047'};font-size:10px;color:${(c.apiId||c.backendId)?'#166534':'#854D0E'};">
      ${(c.apiId||c.backendId)
        ? `✅ Pronto! Login funciona de <strong>qualquer dispositivo</strong> com: <strong>${c.email}</strong>`
        : `⚠️ <strong>Nao sincronizado!</strong> Login so funciona neste computador. Clique em 🔄 Sincronizar para liberar acesso em outros dispositivos.`}
    </div>`:`<div style="background:#FEF2F2;border-radius:8px;padding:8px 10px;margin-bottom:10px;border:1px solid #FECACA;font-size:10px;color:#991B1B;">
      ⚠️ <strong>Sem senha!</strong> Clique em ✏️ Editar para definir a senha de acesso.
    </div>`}
    <div style="display:flex;flex-wrap:wrap;gap:3px;margin-bottom:10px;">
      ${MODULOS_COLABS.map(m=>`<span style="padding:2px 6px;border-radius:5px;font-size:9px;font-weight:500;
        background:${mods[m.k]?'var(--rose-l)':'#F3F4F6'};color:${mods[m.k]?'var(--rose-d)':'#9CA3AF'};
        border:1px solid ${mods[m.k]?'rgba(139,34,82,.15)':'#E5E7EB'}">${m.l.split(' ')[0]}</span>`).join('')}
    </div>

    ${temMetas?`
    <div style="background:var(--cream);border-radius:8px;padding:10px;margin-bottom:10px;">
      <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">
        ${c.cargo==='Entregador'?'🚚 Remuneracao':'💰 Comissoes & Metas'}
      </div>
      ${c.cargo==='Entregador'?`
        <div style="font-size:13px;font-weight:700;color:var(--leaf);">R$ ${(mt.valorEntrega||0).toFixed(2)} <span style="font-size:10px;color:var(--muted);font-weight:400;">por entrega · ${stats.expedicoes} entrega(s) confirmada(s)</span></div>
        <div style="font-size:12px;font-weight:700;color:var(--leaf);margin-top:4px;">Total: R$ ${((mt.valorEntrega||0)*stats.expedicoes).toFixed(2)}</div>
      `:`
        ${mt.comissaoVenda?`<div style="font-size:11px;margin-bottom:3px;">💰 Venda: <strong>${mt.comissaoVenda}%</strong>/venda · <span style="color:var(--leaf)">${stats.vendas} vendas = R$ ${stats.comissao.toFixed(2)}</span></div>`:''}
        ${mt.comissaoMontagem?`<div style="font-size:11px;margin-bottom:3px;">🌸 Montagem: <strong>R$ ${(mt.comissaoMontagem||0).toFixed(2)}</strong>/peca · <span style="color:var(--leaf)">${stats.montagens} = R$ ${((mt.comissaoMontagem||0)*stats.montagens).toFixed(2)}</span></div>`:''}
        ${mt.comissaoExpedicao?`<div style="font-size:11px;margin-bottom:3px;">📦 Expedicao: <strong>R$ ${(mt.comissaoExpedicao||0).toFixed(2)}</strong>/pedido · <span style="color:var(--leaf)">${stats.expedicoes} = R$ ${((mt.comissaoExpedicao||0)*stats.expedicoes).toFixed(2)}</span></div>`:''}
        ${mt.montagemQtd?metaBar(stats.montagens, mt.montagemQtd, `🎯 Meta Montagem / ${mt.montagemPer||'dia'}`):''}
        ${mt.expedicaoQtd?metaBar(stats.expedicoes, mt.expedicaoQtd, `🎯 Meta Expedicao / ${mt.expedicaoPer||'dia'}`):''}
        <div style="font-size:11px;font-weight:700;color:var(--leaf);margin-top:4px;">💰 Total comissao: R$ ${stats.comissao.toFixed(2)}</div>
      `}
    </div>`:`<div style="background:var(--cream);border-radius:8px;padding:7px 10px;margin-bottom:10px;font-size:10px;color:var(--muted);">Sem comissoes configuradas — clique em ✏️ Editar para definir.</div>`}

    <div style="display:flex;gap:5px;">
      ${readOnly ? `
        <div style="flex:1;text-align:center;padding:6px;background:var(--cream);border-radius:6px;font-size:10px;color:var(--muted);">
          🔒 Edição restrita ao administrador
        </div>
        ${c.senha&&!(c.apiId||c.backendId)?`<button class="btn btn-ghost btn-sm btn-sync-one" data-sync-colab="${c.id}"
          style="flex-shrink:0;justify-content:center;font-size:11px;border-color:var(--leaf);color:var(--leaf);" title="Sincronizar este colaborador">🔄</button>`:''}
      ` : `
        <button type="button" class="btn btn-primary btn-sm" onclick="showColabModal('${c.id}')" style="flex:1;justify-content:center;font-size:11px;">✏️ Editar & Modulos</button>
        ${c.senha&&!(c.apiId||c.backendId)?`<button class="btn btn-ghost btn-sm btn-sync-one" data-sync-colab="${c.id}"
          style="flex-shrink:0;justify-content:center;font-size:11px;border-color:var(--leaf);color:var(--leaf);">🔄</button>`:
         `<button type="button" class="btn btn-ghost btn-sm" onclick="toggleColab('${c.id}',${ativo})" style="flex:1;justify-content:center;font-size:11px;">${ativo?'🔒 Desativar':'🔓 Ativar'}</button>`}
        <button type="button" onclick="deleteColab('${c.id}')"
          style="background:var(--red-l);color:var(--red);border:1px solid rgba(220,38,38,.2);
          border-radius:8px;padding:6px 9px;cursor:pointer;font-size:12px;flex-shrink:0;">🗑️ Excluir</button>
      `}
    </div>
  </div>
</div>`;
}).join('')}
</div>`}`;
}

// ── MODAL COLABORADOR ──────────────────────────────────────────
export async function showColabModal(colabId=null, overrideCargo=null){
  const colab = colabId ? getColabs().find(c=>c.id===colabId) : null;
  const edit  = !!colab;
  const cargo = overrideCargo || colab?.cargo || 'Atendimento';
  // Defaults POR CARGO quando criando novo colab (sem modulos definidos):
  // Contador → so RH + Notas Fiscais; outros → vazio (ADM marca o que quer)
  let mods = colab?.modulos || {};
  if (!edit && Object.keys(mods).length === 0) {
    if (cargo === 'Contador') mods = { rh: true, notasFiscais: true };
  }

  // Agrupa modulos por grupo
  const grupos={};
  MODULOS_COLABS.forEach(m=>{ if(!grupos[m.grupo])grupos[m.grupo]=[]; grupos[m.grupo].push(m); });

  const modHtml = Object.entries(grupos).map(([g,items])=>`
  <div style="margin-bottom:12px;">
    <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:6px;">${g}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;">
      ${items.map(m=>{
        const on=mods[m.k]===true;
        return`<label class="cl-lbl" data-k="${m.k}" style="display:flex;align-items:center;gap:8px;padding:8px 10px;
          border-radius:8px;cursor:pointer;user-select:none;transition:all .15s;
          border:1px solid ${on?'var(--rose)':'var(--border)'};background:${on?'var(--rose-l)':'#fff'};
          font-size:12px;font-weight:500;">
          <input type="checkbox" class="cl-cb" data-mod="${m.k}" ${on?'checked':''}
            style="accent-color:var(--rose);width:16px;height:16px;flex-shrink:0;cursor:pointer;"/>
          <span>${m.l}</span>
        </label>`;
      }).join('')}
    </div>
  </div>`).join('');

  S._modal=`<div class="mo" id="mo" onclick="if(event.target===this){S._modal='';render();}">
  <div class="mo-box" style="max-width:600px;max-height:92vh;overflow-y:auto;" onclick="event.stopPropagation()">

  <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--border);">
    <div class="av" style="width:42px;height:42px;font-size:16px;background:var(--rose);">${colab?ini(colab.name):'+'}</div>
    <div style="flex:1">
      <div style="font-family:'Playfair Display',serif;font-size:17px;">${edit?'Editar: '+colab.name:'Novo Colaborador'}</div>
      <div style="font-size:11px;color:var(--muted);">Dados e modulos de acesso</div>
    </div>
    <button type="button" onclick="S._modal='';render();"
      style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--muted);line-height:1">×</button>
  </div>

  <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px;">👤 Dados Pessoais</div>
  <div class="fr2" style="margin-bottom:0">
    <div class="fg"><label class="fl">Nome completo *</label>
      <input class="fi" id="cl-name" value="${colab?.name||''}" placeholder="Nome do colaborador"/></div>
    <div class="fg"><label class="fl">E-mail (login) *</label>
      <input class="fi" id="cl-email" type="email" value="${colab?.email||''}" placeholder="email@lacos.com"/>
      <div style="font-size:10px;color:var(--muted);margin-top:2px">Colaborador usa este e-mail para entrar no sistema</div>
    </div>
    <div class="fg">
      <label class="fl">Senha ${edit?'(vazio = manter atual)':'*'}</label>
      <input class="fi" id="cl-pass" type="password" placeholder="Minimo 6 caracteres"/>
      <div style="font-size:10px;color:var(--leaf);margin-top:2px">
        ${edit&&colab?.senha?`✅ Senha ja definida — deixe em branco para manter`:'⚠️ Obrigatorio — colaborador usara esta senha para entrar'}
      </div>
    </div>
    <div class="fg"><label class="fl">WhatsApp</label>
      <input class="fi" id="cl-phone" value="${colab?.phone||''}" placeholder="(92) 9xxxx-xxxx"/></div>
    <div class="fg"><label class="fl">Cargo</label>
      <select class="fi" id="cl-cargo">
        ${CARGOS_COLABS.map(c=>`<option value="${c}" ${cargo===c?'selected':''}>${c}</option>`).join('')}
      </select>
    </div>
    <div class="fg"><label class="fl">Unidade</label>
      <select class="fi" id="cl-unidade">
        ${UNIDADES_COLABS.map(u=>{
          const lbl = u==='Loja Novo Aleixo'?'N. Aleixo':u==='Loja Allegro Mall'?'Allegro':u;
          return `<option value="${u}" ${colab?.unidade===u?'selected':''}>${lbl}</option>`;
        }).join('')}
      </select>
    </div>
  </div>

  <!-- COMISSOES -->
  <hr style="margin:14px 0;border-color:var(--border)"/>

  ${(colab?.cargo==='Entregador')||(cargo==='Entregador')?`
  <!-- ENTREGADOR: apenas valor por entrega -->
  <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px;">
    🚚 Remuneracao — Entregador
  </div>
  <div class="fr2" style="gap:10px;margin-bottom:8px;">
    <div class="fg">
      <label class="fl">💵 Taxa de Entrega (R$) <span style="color:var(--red)">*</span></label>
      <input class="fi" type="number" id="cl-valor-entrega"
        min="0.01" step="0.50" placeholder="Ex: 8,00" required
        value="${colab?.metas?.valorEntrega != null ? colab.metas.valorEntrega : ''}"/>
      <div style="font-size:10px;color:var(--muted);margin-top:3px;">Valor fixo em <strong>R$ (BRL)</strong> pago por cada entrega confirmada no sistema — <strong>obrigatório</strong> para Entregadores</div>
      <div style="font-size:11px;color:var(--leaf);margin-top:4px;font-weight:600;">Pré-visualização: ${(()=>{const v=colab?.metas?.valorEntrega;return (v!=null&&v>0)?('R$ '+Number(v).toFixed(2).replace('.',',')):'<span style="color:var(--red)">R$ 0,00 — defina um valor</span>';})()}</div>
    </div>
    <div class="fg">
      <div style="background:var(--cream);border-radius:8px;padding:12px;font-size:11px;color:var(--muted);">
        ℹ️ O total de entregas e ganhos do entregador e exibido em<br/>
        <strong>Relatorios → 🚚 Entregadores</strong>
      </div>
    </div>
  </div>`:`

  <!-- COLABORADOR COMUM: comissao por venda, montagem e expedicao -->
  <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px;">
    💰 Comissoes por Atividade
    <span style="font-weight:400;font-size:9px;text-transform:none;margin-left:8px;">(R$ por acao — deixe 0 para desativar)</span>
  </div>
  <div class="fr2" style="gap:10px;margin-bottom:8px;">

    <div class="fg">
      <label class="fl">💰 Comissão por Venda (%)</label>
      <input class="fi" type="number" id="cl-comissao-venda"
        min="0" max="100" step="0.5" placeholder="Ex: 5"
        value="${colab?.metas?.comissaoVenda != null ? colab.metas.comissaoVenda : ''}"/>
      <div style="font-size:10px;color:var(--muted);margin-top:3px;">% sobre o valor das vendas em que ele(a) for o <strong>vendedor</strong> selecionado no PDV (não do logado)</div>
    </div>

    <div class="fg">
      <label class="fl">🌸 Comissão por Montagem (R$ por produto)</label>
      <input class="fi" type="number" id="cl-comissao-montagem"
        min="0" step="0.01" placeholder="Ex: 2.50"
        value="${colab?.metas?.comissaoMontagem != null ? colab.metas.comissaoMontagem : ''}"/>
      <div style="font-size:10px;color:var(--muted);margin-top:3px;">Valor fixo R$ recebido <strong>por cada produto montado</strong> (não é % sobre o valor)</div>
    </div>

    <div class="fg">
      <label class="fl">📦 Comissão por Expedição (R$ por produto)</label>
      <input class="fi" type="number" id="cl-comissao-expedicao"
        min="0" step="0.01" placeholder="Ex: 1.50"
        value="${colab?.metas?.comissaoExpedicao != null ? colab.metas.comissaoExpedicao : ''}"/>
      <div style="font-size:10px;color:var(--muted);margin-top:3px;">Valor fixo R$ recebido <strong>por cada produto expedido</strong> (não é % sobre o valor)</div>
    </div>

  </div>

  <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px;margin-top:4px;">
    🎯 Metas de Producao
    <span style="font-weight:400;font-size:9px;text-transform:none;margin-left:8px;">(deixe 0 para desativar)</span>
  </div>
  <div class="fr2" style="gap:10px;margin-bottom:8px;">

    <div class="fg">
      <label class="fl">🌸 Meta de Montagem</label>
      <div style="display:flex;gap:6px;align-items:center;">
        <input class="fi" type="number" id="cl-meta-montagem-qtd"
          min="0" step="1" placeholder="0"
          style="flex:1;"
          value="${colab?.metas?.montagemQtd != null ? colab.metas.montagemQtd : ''}"/>
        <select class="fi" id="cl-meta-montagem-per" style="width:110px;">
          <option value="dia"    ${(colab?.metas?.montagemPer||'dia')==='dia'    ? 'selected' : ''}>Por dia</option>
          <option value="semana" ${(colab?.metas?.montagemPer||'')==='semana'   ? 'selected' : ''}>Por semana</option>
          <option value="mes"    ${(colab?.metas?.montagemPer||'')==='mes'      ? 'selected' : ''}>Por mes</option>
        </select>
      </div>
      <div style="font-size:10px;color:var(--muted);margin-top:3px;">Qtd de montagens esperada no periodo</div>
    </div>

    <div class="fg">
      <label class="fl">📦 Meta de Expedicao</label>
      <div style="display:flex;gap:6px;align-items:center;">
        <input class="fi" type="number" id="cl-meta-expedicao-qtd"
          min="0" step="1" placeholder="0"
          style="flex:1;"
          value="${colab?.metas?.expedicaoQtd != null ? colab.metas.expedicaoQtd : ''}"/>
        <select class="fi" id="cl-meta-expedicao-per" style="width:110px;">
          <option value="dia"    ${(colab?.metas?.expedicaoPer||'dia')==='dia'    ? 'selected' : ''}>Por dia</option>
          <option value="semana" ${(colab?.metas?.expedicaoPer||'')==='semana'   ? 'selected' : ''}>Por semana</option>
          <option value="mes"    ${(colab?.metas?.expedicaoPer||'')==='mes'      ? 'selected' : ''}>Por mes</option>
        </select>
      </div>
      <div style="font-size:10px;color:var(--muted);margin-top:3px;">Qtd de expedicoes esperada no periodo</div>
    </div>

  </div>`}

  <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;margin:16px 0 8px;">🔑 Modulos de Acesso</div>
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
    <span></span>
    <div style="display:flex;gap:6px;">
      <button type="button" onclick="document.querySelectorAll('.cl-cb').forEach(cb=>{cb.checked=true;styleClLbl(cb.closest('label'),true);})"
        style="background:var(--rose);color:#fff;border:none;border-radius:6px;padding:3px 10px;font-size:10px;font-weight:600;cursor:pointer;">✅ Todos</button>
      <button type="button" onclick="document.querySelectorAll('.cl-cb').forEach(cb=>{cb.checked=false;styleClLbl(cb.closest('label'),false);})"
        style="background:var(--cream);color:var(--muted);border:1px solid var(--border);border-radius:6px;padding:3px 10px;font-size:10px;cursor:pointer;">☐ Nenhum</button>
    </div>
  </div>
  <div style="background:var(--cream);border-radius:var(--r);padding:12px;margin-bottom:14px;">
    ${modHtml}
  </div>

  <div style="padding-top:12px;border-top:1px solid var(--border);">
    <div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:12px;">
      <label class="cb" style="cursor:pointer;">
        <input type="checkbox" id="cl-active" ${colab?.active!==false?'checked':''}/>
        <span style="font-size:12px">Colaborador ativo</span>
      </label>
    </div>
    <div style="background:#F0FDF4;border-radius:8px;padding:8px 10px;margin-bottom:10px;font-size:11px;color:#166534;border:1px solid #86EFAC;">
      ✅ A sincronizacao com o servidor e <strong>automatica</strong>. Apos salvar, o colaborador consegue fazer login em <strong>qualquer dispositivo</strong> usando e-mail + senha.
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button type="button" onclick="S._modal='';render();" class="btn btn-ghost">Cancelar</button>
      <button type="button" onclick="saveColabFromModal()" id="btn-cl-save" class="btn btn-primary" style="padding:9px 22px;">
        💾 ${edit?'Atualizar':'Cadastrar'}
      </button>
    </div>
  </div>
  </div></div>`;

  await render();

  // ── RESTAURA draft (se houver) — ao mudar cargo o modal e re-renderizado
  // mas os campos digitados sao recuperados aqui ──────────────────
  if (S._colabDraft) {
    const d = S._colabDraft;
    const set = (id, v) => { const el = document.getElementById(id); if(el && v !== undefined && v !== null) el.value = v; };
    set('cl-name',  d.name);
    set('cl-email', d.email);
    set('cl-pass',  d.pass);
    set('cl-phone', d.phone);
    if (d.unidade) set('cl-unidade', d.unidade);
    set('cl-valor-entrega',      d.valorEntrega);
    set('cl-comissao-venda',     d.comissaoVenda);
    set('cl-comissao-montagem',  d.comissaoMontagem);
    set('cl-comissao-expedicao', d.comissaoExpedicao);
    set('cl-meta-montagem-qtd',  d.montagemQtd);
    set('cl-meta-montagem-per',  d.montagemPer);
    set('cl-meta-expedicao-qtd', d.expedicaoQtd);
    set('cl-meta-expedicao-per', d.expedicaoPer);
    const ckActive = document.getElementById('cl-active');
    if (ckActive && typeof d.active === 'boolean') ckActive.checked = d.active;
    // Restaura modulos checados
    if (d.modulos) {
      document.querySelectorAll('.cl-cb').forEach(cb => {
        const k = cb.dataset.mod;
        if (k in d.modulos) cb.checked = !!d.modulos[k];
      });
    }
    // Limpa o draft apos uso (proxima abertura nao herda)
    S._colabDraft = null;
  }

  // styleClLbl: funcao local disponivel globalmente para os onclick inline
  window.styleClLbl = function(lbl, on){
    if(!lbl) return;
    lbl.style.borderColor=on?'var(--rose)':'var(--border)';
    lbl.style.background =on?'var(--rose-l)':'#fff';
  };

  // Modulos PROIBIDOS para Gerente (apenas admin acessa):
  // whatsapp, backup (estao no modal); users, config, ecommerce, notasFiscais
  // (fora do modal — controlados por can() e PERMS_DEFAULT)
  const GERENTE_BLOCKED_MODS = ['whatsapp','backup'];

  // Ao mudar cargo: re-abre modal preservando TODOS os dados digitados.
  // ANTES de re-renderizar, captura o estado atual do form em S._colabDraft.
  // Depois do render, showColabModal restaura via S._colabDraft.
  document.getElementById('cl-cargo')?.addEventListener('change',()=>{
    const newCargo = document.getElementById('cl-cargo')?.value;
    // Captura draft para nao perder dados ao re-renderizar
    S._colabDraft = {
      name:  document.getElementById('cl-name')?.value || '',
      email: document.getElementById('cl-email')?.value || '',
      pass:  document.getElementById('cl-pass')?.value || '',
      phone: document.getElementById('cl-phone')?.value || '',
      unidade: document.getElementById('cl-unidade')?.value || '',
      // Captura modulos checados
      modulos: (() => {
        const m = {};
        document.querySelectorAll('.cl-cb').forEach(cb => { m[cb.dataset.mod] = cb.checked; });
        return m;
      })(),
      active: document.getElementById('cl-active')?.checked !== false,
      // Captura comissoes/metas
      valorEntrega:     parseFloat(document.getElementById('cl-valor-entrega')?.value) || 0,
      comissaoVenda:    parseFloat(document.getElementById('cl-comissao-venda')?.value) || 0,
      comissaoMontagem: parseFloat(document.getElementById('cl-comissao-montagem')?.value) || 0,
      comissaoExpedicao:parseFloat(document.getElementById('cl-comissao-expedicao')?.value) || 0,
      montagemQtd:      parseInt(document.getElementById('cl-meta-montagem-qtd')?.value) || 0,
      montagemPer:      document.getElementById('cl-meta-montagem-per')?.value || 'dia',
      expedicaoQtd:     parseInt(document.getElementById('cl-meta-expedicao-qtd')?.value) || 0,
      expedicaoPer:     document.getElementById('cl-meta-expedicao-per')?.value || 'dia',
    };

    if(colabId){
      const all=getColabs(); const i=all.findIndex(c=>c.id===colabId);
      if(i>=0){
        const update = {...all[i], cargo:newCargo};
        if(newCargo === 'Gerente'){
          update.unidade = 'Todas';
          update.modulos = {};
          MODULOS_COLABS.forEach(m => {
            if(!GERENTE_BLOCKED_MODS.includes(m.k)) update.modulos[m.k] = true;
          });
        }
        all[i] = update;
        saveColabs(all);
      }
    }
    showColabModal(colabId, newCargo);
  });

  // Quando a tela renderiza e e Gerente, aplica a politica de acesso
  (function(){
    const curCargo = document.getElementById('cl-cargo')?.value;
    if(curCargo === 'Gerente'){
      document.querySelectorAll('.cl-cb').forEach(cb=>{
        const mod = cb.dataset.mod;
        const allow = !GERENTE_BLOCKED_MODS.includes(mod);
        cb.checked = allow;
        window.styleClLbl?.(cb.closest('label'), allow);
      });
      const sel = document.getElementById('cl-unidade');
      if(sel && !sel.value) sel.value = 'Todas';
      const cargoEl = document.getElementById('cl-cargo');
      if(cargoEl && !document.getElementById('cl-gerente-hint')){
        const hint = document.createElement('div');
        hint.id = 'cl-gerente-hint';
        hint.style.cssText = 'font-size:11px;color:#065F46;background:#D1FAE5;padding:8px 10px;border-radius:6px;margin-top:4px;border:1px solid #6EE7B7;line-height:1.5;';
        hint.innerHTML = '👑 <strong>Gerente — Acesso Operacional:</strong> todas unidades · Dashboard · PDV · Pedidos (inclusive emissão NFC-e/NF-e) · Caixa · Clientes · Produtos · Estoque · Produção · Expedição · Financeiro · Relatórios · Ponto.<br><br>🚫 <strong>Sem acesso:</strong> Usuários · Colaboradores · Configurações · E-commerce · Backup · WhatsApp · Notas Fiscais (menu) · Alertas.';
        cargoEl.parentElement.appendChild(hint);
      }
    }
  })();

  // Estilo dos checkboxes ao mudar
  document.querySelectorAll('.cl-cb').forEach(cb=>{
    cb.addEventListener('change',()=>window.styleClLbl(cb.closest('label'),cb.checked));
  });

  // Torna a funcao de salvar acessivel globalmente com o contexto atual
  window.saveColabFromModal = async function(){
    const name  = document.getElementById('cl-name')?.value?.trim()||'';
    const email = document.getElementById('cl-email')?.value?.trim().toLowerCase()||'';
    const pass  = document.getElementById('cl-pass')?.value||'';
    const phone = document.getElementById('cl-phone')?.value?.trim()||'';
    const cargoVal = document.getElementById('cl-cargo')?.value||'Atendimento';
    const unid  = document.getElementById('cl-unidade')?.value||'Loja Novo Aleixo';
    const active= document.getElementById('cl-active')?.checked!==false;

    if(!name)  return toast('❌ Nome obrigatorio');
    if(!email) return toast('❌ E-mail obrigatorio');
    if(!edit && !pass) return toast('❌ Senha obrigatoria para novo colaborador');
    if(!edit && pass.length<6) return toast('❌ Senha minimo 6 caracteres');
    if(edit && pass && pass.length<6) return toast('❌ Nova senha minimo 6 caracteres');

    const modulos={};
    document.querySelectorAll('.cl-cb').forEach(cb=>{ modulos[cb.dataset.mod]=cb.checked; });

    // ── Coleta comissoes conforme tipo de colaborador ──────────
    const isEntregador = cargoVal === 'Entregador';
    const parseVal = id => { const v=document.getElementById(id)?.value; return (v!==''&&v!=null)?parseFloat(v)||0:0; };
    const parseInt2 = id => { const v=document.getElementById(id)?.value; return (v!==''&&v!=null)?parseInt(v)||0:0; };

    // ── VALIDAÇÃO: Taxa de Entrega obrigatória para Entregadores ──
    if (cargoVal === 'Entregador') {
      const valorEntregaRaw = parseVal('cl-valor-entrega');
      if (!valorEntregaRaw || valorEntregaRaw <= 0) {
        toast('❌ Taxa de Entrega é obrigatória para Entregadores', true);
        const el = document.getElementById('cl-valor-entrega');
        if (el) { el.style.borderColor = 'var(--red)'; el.focus(); }
        return;
      }
    }

    const metas = isEntregador ? {
      // Entregador: apenas valor por entrega
      valorEntrega:     parseVal('cl-valor-entrega'),
      // Zera os outros campos
      comissaoVenda:0, comissaoMontagem:0, comissaoExpedicao:0,
      montagemQtd:0, montagemPer:'dia', expedicaoQtd:0, expedicaoPer:'dia',
    } : {
      // Colaborador comum: comissoes + metas de producao
      comissaoVenda:     parseVal('cl-comissao-venda'),
      comissaoMontagem:  parseVal('cl-comissao-montagem'),
      comissaoExpedicao: parseVal('cl-comissao-expedicao'),
      montagemQtd:       parseInt2('cl-meta-montagem-qtd'),
      montagemPer:       document.getElementById('cl-meta-montagem-per')?.value||'dia',
      expedicaoQtd:      parseInt2('cl-meta-expedicao-qtd'),
      expedicaoPer:      document.getElementById('cl-meta-expedicao-per')?.value||'dia',
      // Zera campo de entregador
      valorEntrega:0,
    };

    const all = getColabs();
    let newId = null;
    if(edit){
      const idx=all.findIndex(c=>c.id===colabId);
      if(idx>=0){ all[idx]={...all[idx],name,email,phone,cargo:cargoVal,unidade:unid,active,modulos,metas}; if(pass)all[idx].senha=pass; }
    } else {
      if(all.some(c=>c.email?.toLowerCase()===email)) return toast('❌ E-mail ja cadastrado como colaborador',true);
      newId='cb_'+Date.now();
      all.push({id:newId,name,email,phone,cargo:cargoVal,unidade:unid,active,modulos,metas,senha:pass,criadoEm:new Date().toISOString()});
    }
    saveColabs(all);

    // ── Sync to /api/collaborators (cross-device) ─────────────
    const colabData = all.find(c=>c.id===(newId||colabId));

    // Push collaborator to /api/collaborators — fonte única para login
    const apiRes = await pushColabToAPI(colabData).catch(e => {
      console.warn('[colaboradores] pushColabToAPI falhou:', e.message);
      return null;
    });

    if(apiRes && (apiRes._id || apiRes.id)){
      const upd = getColabs();
      const i = upd.findIndex(c=>c.id===(newId||colabId));
      if(i>=0){ upd[i].apiId = apiRes._id || apiRes.id; saveColabs(upd); }
      toast(`✅ ${name} ${edit?'atualizado':'cadastrado'} e sincronizado! Login em qualquer dispositivo.`);
    } else {
      toast(`⚠️ ${name} salvo localmente. Verifique conexão e clique em 🔄 Sincronizar Todos.`, true);
    }
    S._modal=''; render();
  };  // fim saveColabFromModal
}   // fim showColabModal

export function deleteColab(id){
  const all=getColabs();
  const c=all.find(x=>x.id===id);
  if(!c) return;

  // Guarda id globalmente para os botoes inline do modal
  window._delColabId = id;

  S._modal=`<div class="mo" id="mo" onclick="if(event.target===this){S._modal='';render();}">
  <div class="mo-box" style="max-width:380px;text-align:center;" onclick="event.stopPropagation()">
  <div style="font-size:36px;margin-bottom:10px">⚠️</div>
  <div style="font-family:'Playfair Display',serif;font-size:17px;margin-bottom:6px">Excluir Colaborador?</div>
  <div style="font-size:12px;color:var(--muted);margin-bottom:18px;"><strong>${c.name}</strong><br>${c.email}</div>
  <div style="display:flex;gap:8px;justify-content:center;">
    <button class="btn btn-red" onclick="confirmDeleteColab()" style="padding:10px 20px;">🗑️ Excluir</button>
    <button class="btn btn-ghost" onclick="S._modal='';render();">Cancelar</button>
  </div>
  </div></div>`;
  render();
}

// Funcao global -- sobrevive a qualquer render() do polling
export function confirmDeleteColab(){
  const id = window._delColabId;
  if(!id) return;
  const all = getColabs();
  const c = all.find(x=>x.id===id);

  // Delete from /api/collaborators (fonte única)
  if(c?.apiId){
    DELETE('/collaborators/'+c.apiId).catch(e=>console.warn('[colaboradores] API delete failed', e.message));
  }

  saveColabs(all.filter(x=>x.id!==id));
  S._modal='';
  window._delColabId = null;
  render();
  toast('🗑️ ' + (c?.name||'Colaborador') + ' excluido');
}

export function toggleColab(id, currentActive){
  const all=getColabs();
  const idx=all.findIndex(c=>c.id===id);
  if(idx<0) return;
  all[idx].active=!currentActive;
  saveColabs(all);

  // Sync active state to /collaborators (fonte única)
  const c = all[idx];
  pushColabToAPI(c).catch(()=>{});

  render();
  toast(!currentActive?`✅ ${all[idx].name} ativado!`:`🔒 ${all[idx].name} desativado!`);
}

// ── SYNC DE COLABORADOR PARA O BACKEND ───────────────────────
export async function syncColabToBackend(colabId){
  const all=getColabs();
  const c=all.find(x=>x.id===colabId);
  if(!c) return toast('❌ Colaborador nao encontrado');
  if(!c.senha) return toast('❌ Defina uma senha antes de sincronizar');

  const adminToken = S.token && !S.token.startsWith('local_')
    ? S.token : localStorage.getItem('fv_backend_token');
  if(!adminToken) return toast('❌ Faca login como Administrador primeiro');

  toast('⏳ Sincronizando '+c.name+'...');
  try{
    // Se apiId for stale (ex.: herança do sync antigo para /users), limpa antes de tentar
    // O pushColabToAPI faz fallback PUT → POST, então mesmo com apiId inválido funciona
    const apiRes = await pushColabToAPI(c);
    if(apiRes && (apiRes._id || apiRes.id)){
      const idx = all.findIndex(x=>x.id===colabId);
      if(idx>=0){ all[idx].apiId = apiRes._id || apiRes.id; saveColabs(all); }
      render();
      toast(`✅ ${c.name} sincronizado! Login funciona em qualquer dispositivo.`);
    } else {
      // Se falhou mesmo com fallback, limpa apiId stale para retentativa do zero
      const idx2 = all.findIndex(x=>x.id===colabId);
      if(idx2>=0 && all[idx2].apiId){ all[idx2].apiId = null; saveColabs(all); }
      toast(`❌ Falha ao sincronizar ${c.name}. Veja console (F12) para o motivo exato.`, true);
    }
  }catch(e){
    console.error('[syncColabToBackend erro]', e);
    toast('❌ Erro inesperado: '+(e.message||''), true);
  }
}

export async function syncAllColabs(){
  const adminToken = S.token && !S.token.startsWith('local_')
    ? S.token : localStorage.getItem('fv_backend_token');
  if(!adminToken) return toast('❌ Faca login como Administrador primeiro');

  // First, fetch collaborators from backend API and merge with local
  toast('⏳ Buscando colaboradores do servidor...');
  await fetchAndMergeColabs().catch(()=>{});

  const all=getColabs();
  const pendentes=all.filter(c=>c.senha); // sincroniza TODOS com senha (nao apenas novos)
  if(pendentes.length===0) return toast('❌ Nenhum colaborador com senha definida. Adicione senhas primeiro.');

  toast(`⏳ Sincronizando ${pendentes.length} colaborador(es)... aguarde.`);
  let ok=0, fail=0;

  for(const c of pendentes){
    try{
      // Sync direto para /api/collaborators (backend faz login por Collaborator model)
      // O endpoint legado POST /users não existe mais — Collaborator é fonte única.
      const apiRes = await pushColabToAPI(c);
      if(apiRes && (apiRes._id || apiRes.id)){
        const idx=all.findIndex(x=>x.id===c.id);
        if(idx>=0){ all[idx].apiId = apiRes._id || apiRes.id; }
        ok++;
      } else {
        console.warn('[syncAllColabs falhou]', c.name, c.email, 'pushColabToAPI retornou null');
        fail++;
      }
    }catch(e){
      console.error('[syncAllColabs erro]', c.name, e);
      fail++;
    }
  }

  saveColabs(all);
  render();
  if(fail===0){
    toast(`✅ ${ok} colaborador(es) sincronizado(s) com sucesso!`);
  } else {
    toast(`⚠️ ${ok} sincronizado(s) · ${fail} falha(s). Abra o console (F12) para detalhes.`);
  }
}

// ── Expose functions globally for inline onclick handlers ─────
if(typeof window !== 'undefined'){
  window.showColabModal    = showColabModal;
  window.deleteColab       = deleteColab;
  window.confirmDeleteColab= confirmDeleteColab;
  window.toggleColab       = toggleColab;
  window.syncColabToBackend= syncColabToBackend;
  window.syncAllColabs     = syncAllColabs;
}

// ── Export constants for reuse ────────────────────────────────
export { MODULOS_COLABS, CARGOS_COLABS, UNIDADES_COLABS };
