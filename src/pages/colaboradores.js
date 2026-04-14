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
  {k:'dashboard',  l:'📊 Dashboard',        grupo:'Visao'},
  {k:'pdv',        l:'🛒 PDV / Vendas',      grupo:'Vendas'},
  {k:'orders',     l:'📋 Pedidos',           grupo:'Vendas'},
  {k:'caixa',      l:'💵 Caixa',             grupo:'Vendas'},
  {k:'clients',    l:'👥 Clientes',          grupo:'Cadastros'},
  {k:'products',   l:'🌹 Produtos',          grupo:'Cadastros'},
  {k:'stock',      l:'📦 Estoque',           grupo:'Cadastros'},
  {k:'production', l:'🌿 Producao',          grupo:'Operacao'},
  {k:'delivery',   l:'📤 Expedicao/Entrega', grupo:'Operacao'},
  {k:'financial',  l:'💰 Financeiro',        grupo:'Financeiro'},
  {k:'reports',    l:'📈 Relatorios',        grupo:'Financeiro'},
  {k:'ponto',      l:'🕐 Ponto',             grupo:'RH'},
  {k:'whatsapp',   l:'💬 WhatsApp',          grupo:'Config'},
  {k:'backup',     l:'💾 Backup',            grupo:'Config'},
];

const CARGOS_COLABS=['Gerente','Atendimento','Producao','Expedicao','Financeiro','Entregador'];
const UNIDADES_COLABS=['Loja Novo Aleixo','Loja Allegro Mall','CDLE'];

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
  const isAdmin = S.user?.role==='Administrador' || S.user?.cargo==='admin';
  if(!isAdmin) return`
  <div class="empty card"><div class="empty-icon">🔒</div>
  <p style="font-weight:600">Acesso restrito</p>
  <p style="font-size:12px;margin-top:4px">Somente o Administrador pode gerenciar colaboradores.</p></div>`;

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
<div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:10px;padding:10px 14px;margin-bottom:12px;font-size:11px;color:#1E40AF;">
  💡 <strong>Como funciona o login dos colaboradores:</strong> Ao salvar, o sistema cria a conta no servidor automaticamente. Colaboradores usam o <strong>e-mail + senha</strong> definidos aqui para entrar de qualquer dispositivo. Se algum nao consegue logar, clique em <strong>🔄 Sincronizar Todos</strong>.
</div>

<div style="display:flex;gap:8px;margin-bottom:14px;align-items:center;flex-wrap:wrap;">
  <div class="search-box" style="flex:1;min-width:180px;">
    <span class="si">🔍</span>
    <input class="fi" id="colab-search" placeholder="Buscar colaborador..." value="${S._colabSearch||''}"/>
  </div>
  <button class="btn btn-ghost btn-sm" id="btn-sync-all-colabs" style="white-space:nowrap;">🔄 Sincronizar Todos</button>
  <button class="btn btn-primary" onclick="showColabModal()">➕ Novo Colaborador</button>
</div>

<div class="g3" style="margin-bottom:14px;">
  <div class="mc rose"><div class="mc-label">Total</div><div class="mc-val">${colabs.length}</div></div>
  <div class="mc leaf"><div class="mc-label">Ativos</div><div class="mc-val">${colabs.filter(c=>c.active!==false).length}</div></div>
  <div class="mc gold"><div class="mc-label">Sincronizados</div><div class="mc-val">${colabs.filter(c=>c.backendId).length}</div></div>
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
        <div style="font-size:10px;font-weight:600;color:${c.backendId?'var(--leaf)':'var(--red)'}">
          ${c.backendId?'✅ Sincronizado':'❌ Nao sincronizado'}
        </div>
      </div>
      ${c.phone?`<div>
        <div style="color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px">WhatsApp</div>
        <div style="font-size:11px">${c.phone}</div>
      </div>`:''}
    </div>
    ${c.senha?`<div style="background:${c.backendId?'#F0FDF4':'#FEF9C3'};border-radius:8px;padding:8px 10px;margin-bottom:10px;border:1px solid ${c.backendId?'#86EFAC':'#FDE047'};font-size:10px;color:${c.backendId?'#166534':'#854D0E'};">
      ${c.backendId
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
      <button type="button" class="btn btn-primary btn-sm" onclick="showColabModal('${c.id}')" style="flex:1;justify-content:center;font-size:11px;">✏️ Editar & Modulos</button>
      ${c.senha&&!c.backendId?`<button class="btn btn-ghost btn-sm btn-sync-one" data-sync-colab="${c.id}"
        style="flex-shrink:0;justify-content:center;font-size:11px;border-color:var(--leaf);color:var(--leaf);">🔄</button>`:
       `<button type="button" class="btn btn-ghost btn-sm" onclick="toggleColab('${c.id}',${ativo})" style="flex:1;justify-content:center;font-size:11px;">${ativo?'🔒 Desativar':'🔓 Ativar'}</button>`}
      <button type="button" onclick="deleteColab('${c.id}')"
        style="background:var(--red-l);color:var(--red);border:1px solid rgba(220,38,38,.2);
        border-radius:8px;padding:6px 9px;cursor:pointer;font-size:12px;flex-shrink:0;">🗑️ Excluir</button>
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
  const mods  = colab?.modulos||{};

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
        ${UNIDADES_COLABS.map(u=>`<option value="${u}" ${colab?.unidade===u?'selected':''}>${u}</option>`).join('')}
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
      <label class="fl">💵 Valor por entrega (R$)</label>
      <input class="fi" type="number" id="cl-valor-entrega"
        min="0" step="0.50" placeholder="Ex: 8.00"
        value="${colab?.metas?.valorEntrega != null ? colab.metas.valorEntrega : ''}"/>
      <div style="font-size:10px;color:var(--muted);margin-top:3px;">Valor fixo R$ pago por cada entrega confirmada no sistema</div>
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
      <label class="fl">💰 Comissao por Venda (%)</label>
      <input class="fi" type="number" id="cl-comissao-venda"
        min="0" max="100" step="0.5" placeholder="Ex: 5"
        value="${colab?.metas?.comissaoVenda != null ? colab.metas.comissaoVenda : ''}"/>
      <div style="font-size:10px;color:var(--muted);margin-top:3px;">Ex: 5 = 5% sobre o valor total de cada venda</div>
    </div>

    <div class="fg">
      <label class="fl">🌸 Comissao por Montagem (R$)</label>
      <input class="fi" type="number" id="cl-comissao-montagem"
        min="0" step="0.01" placeholder="Ex: 2.50"
        value="${colab?.metas?.comissaoMontagem != null ? colab.metas.comissaoMontagem : ''}"/>
      <div style="font-size:10px;color:var(--muted);margin-top:3px;">Valor R$ recebido por cada pedido montado (status "Pronto")</div>
    </div>

    <div class="fg">
      <label class="fl">📦 Comissao por Expedicao (R$)</label>
      <input class="fi" type="number" id="cl-comissao-expedicao"
        min="0" step="0.01" placeholder="Ex: 1.50"
        value="${colab?.metas?.comissaoExpedicao != null ? colab.metas.comissaoExpedicao : ''}"/>
      <div style="font-size:10px;color:var(--muted);margin-top:3px;">Valor R$ recebido por cada pedido expedido</div>
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

  // styleClLbl: funcao local disponivel globalmente para os onclick inline
  window.styleClLbl = function(lbl, on){
    if(!lbl) return;
    lbl.style.borderColor=on?'var(--rose)':'var(--border)';
    lbl.style.background =on?'var(--rose-l)':'#fff';
  };

  // Ao mudar cargo: re-abre modal preservando dados digitados
  document.getElementById('cl-cargo')?.addEventListener('change',()=>{
    const newCargo = document.getElementById('cl-cargo')?.value;
    if(colabId){
      const all=getColabs(); const i=all.findIndex(c=>c.id===colabId);
      if(i>=0){ all[i]={...all[i],cargo:newCargo}; saveColabs(all); }
    }
    showColabModal(colabId, newCargo);
  });

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

    // Push collaborator to /api/collaborators using shared helper
    await pushColabToAPI(colabData).catch(e => {
      console.warn('[colaboradores] API /collaborators save failed, falling back to /users', e.message);
    });

    // ── Sincroniza com backend /users (legacy) ───────────────
    const adminToken = S.token && !S.token.startsWith('local_') ? S.token : localStorage.getItem('fv_backend_token');
    const senhaAtual = pass || colabData?.senha || '';

    if(adminToken && senhaAtual){
      try{
        // Busca no S.users local E tenta buscar do backend pelo email
        const existing = S.users.find(u=>(u.email||'').toLowerCase()===email.toLowerCase());
        const payload = {name, email, phone, active, unit:unid, password:senhaAtual};
        let bu = null;
        let syncErr = '';

        // 1. Tenta atualizar se ja existe no backend
        if(existing?._id){
          const putPayload = {...payload, ...(pass?{password:pass}:{})};
          bu = await PUT('/users/'+existing._id, putPayload).catch(e=>{syncErr=e.message;return null});
          if(!bu) bu = await PATCH('/users/'+existing._id, putPayload).catch(e=>{syncErr=e.message;return null});
        }

        // 2. Se nao existe OU atualizacao falhou → cria novo (tenta varios roles)
        if(!bu){
          // Tenta com o cargo correto primeiro, depois fallback
          const CARGO_ROLE = {
            'Atendimento':'Atendimento','Gerente':'Gerente','Administrador':'Administrador',
            'Producao':'Producao','Producao':'Producao','Expedicao':'Expedicao','Expedicao':'Expedicao',
            'Financeiro':'Financeiro','Entregador':'Entregador','Vendas':'Vendas',
          };
          const tryRoles = [CARGO_ROLE[cargoVal]||cargoVal,'Atendimento','Gerente'];
          for(const role of [...new Set(tryRoles)]){
            bu = await POST('/users', {...payload, role}).catch(e=>{syncErr=e.message;return null});
            if(bu?._id) break;
          }
        }

        if(bu?._id){
          const upd=getColabs();
          const i=upd.findIndex(c=>c.id===(newId||colabId));
          if(i>=0){ upd[i].backendId=bu._id; saveColabs(upd); }
          const merged = await _mergeUserExtra(bu);
          S.users=[...S.users.filter(u=>u._id!==bu._id), merged];
          toast(`✅ ${name} salvo e sincronizado! Login funciona em qualquer dispositivo.`);
          S._modal=''; render(); return;
        }

        // Sync falhou -- salvar erro detalhado no console para debug
        console.warn('[Sync falhou]', name, email, syncErr);
        toast(`⚠️ ${name} salvo localmente. Para aparecer em outros PCs clique em 🔄 Sincronizar Todos.`, true);
      }catch(e){
        console.error('[Sync erro inesperado]', e);
        toast(`⚠️ ${name} salvo localmente. Erro: ${e.message||'desconhecido'}`);
      }
    } else if(!adminToken){
      toast(edit?`✅ ${name} atualizado!`:`✅ ${name} cadastrado! Faca login como admin para sincronizar.`);
    } else {
      toast(edit?`✅ ${name} atualizado!`:`✅ ${name} cadastrado com sucesso!`);
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

  // Try to delete from API as well
  if(c?.apiId){
    DELETE('/collaborators/'+c.apiId).catch(e=>console.warn('[colaboradores] API delete failed', e.message));
  }
  if(c?.backendId){
    DELETE('/users/'+c.backendId).catch(e=>console.warn('[colaboradores] Backend user delete failed', e.message));
  }
  if(c?.apiId){
    DELETE('/collaborators/'+c.apiId).catch(e=>console.warn('[colaboradores] API collaborator delete failed', e.message));
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

  // Sync active state to both /collaborators and /users APIs
  const c = all[idx];
  pushColabToAPI(c).catch(()=>{});
  if(c.backendId){
    PUT('/users/'+c.backendId, {active:!currentActive}).catch(()=>{});
  }

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
    const email = (c.email||'').toLowerCase().trim();
    const existing = S.users.find(u=>(u.email||'').toLowerCase()===email);

    // Backend so aceita estes valores no enum unit (CDLE nao e aceito pelo backend)
    const BACKEND_VALID_UNITS = ['Loja Novo Aleixo','Loja Allegro Mall','Todas'];
    const rawUnit = c.unidade||c.unit||'Loja Novo Aleixo';
    const unit = BACKEND_VALID_UNITS.includes(rawUnit) ? rawUnit : 'Loja Novo Aleixo';

    // Mapeia cargo para role do backend
    const CARGO_TO_ROLE = {
      'Atendimento':'Atendimento','Gerente':'Gerente','Administrador':'Administrador',
      'Producao':'Producao','Producao':'Producao','Expedicao':'Expedicao','Expedicao':'Expedicao',
      'Financeiro':'Financeiro','Entregador':'Entregador','Vendas':'Vendas',
    };
    const role = CARGO_TO_ROLE[c.cargo] || c.cargo || 'Atendimento';

    const payload = {
      name: c.name, email, phone: c.phone||'',
      active: c.active!==false,
      unit,
      role,
      password: c.senha,
    };
    let bu = null;
    let syncErr = '';

    // 1. Tenta atualizar se existe no backend
    if(existing?._id){
      bu = await PUT('/users/'+existing._id, payload).catch(e=>{syncErr=e.message;return null});
      if(!bu) bu = await PATCH('/users/'+existing._id, payload).catch(e=>{syncErr=e.message;return null});
    }

    // 2. Se nao existe ou falhou → cria com o role correto primeiro, depois fallback
    if(!bu){
      const rolesToTry = [role, 'Atendimento', 'Vendas', 'Producao', 'Expedicao', 'Financeiro', 'Entregador', 'Gerente'];
      const uniqueRoles = [...new Set(rolesToTry)];
      for(const r of uniqueRoles){
        bu = await POST('/users', {...payload, role: r}).catch(e=>{syncErr=e.message;return null});
        if(bu?._id) break;
      }
    }

    if(bu?._id){
      const idx=all.findIndex(x=>x.id===colabId);
      if(idx>=0){ all[idx].backendId=bu._id; saveColabs(all); }
      const merged = await _mergeUserExtra(bu);
      S.users=[...S.users.filter(u=>u._id!==bu._id), merged];

      // Sync to /api/collaborators using pushColabToAPI
      const updAll = getColabs();
      const updColab = updAll.find(x=>x.id===colabId);
      if(updColab){
        updColab.backendId = bu._id;
        await pushColabToAPI(updColab);
      }

      render();
      toast(`✅ ${c.name} sincronizado! Login funciona em qualquer dispositivo.`);
    } else {
      console.warn('[syncColabToBackend falhou]', c.name, email, syncErr);
      toast(`❌ Falha ao sincronizar ${c.name}. Erro: ${syncErr||'verifique o console (F12)'}`, true);
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
      const email=(c.email||'').toLowerCase().trim();
      const existing=S.users.find(u=>(u.email||'').toLowerCase()===email);
      const payload={name:c.name, email, phone:c.phone||'',
        active:c.active!==false, unit:c.unidade||'Loja Novo Aleixo', password:c.senha};
      let bu=null;
      let syncErr='';

      // 1. Tenta atualizar se existe
      if(existing?._id){
        bu=await PUT('/users/'+existing._id, payload).catch(e=>{syncErr=e.message;return null});
        if(!bu) bu=await PATCH('/users/'+existing._id, payload).catch(e=>{syncErr=e.message;return null});
      }

      // 2. Se nao existe ou falhou → cria novo
      if(!bu){
        for(const role of ['Atendimento','Vendas','Producao','Expedicao','Financeiro','Entregador','Gerente','Administrador']){
          bu=await POST('/users',{...payload,role}).catch(e=>{syncErr=e.message;return null});
          if(bu?._id) break;
        }
      }

      if(bu?._id){
        const idx=all.findIndex(x=>x.id===c.id);
        if(idx>=0){ all[idx].backendId=bu._id; }
        const merged = await _mergeUserExtra(bu);
        S.users=[...S.users.filter(u=>u._id!==bu._id), merged];

        // Sync to /api/collaborators using pushColabToAPI
        const colabToSync = all.find(x=>x.id===c.id);
        if(colabToSync){
          colabToSync.backendId = bu._id;
          const apiRes = await pushColabToAPI(colabToSync);
          if(apiRes && (apiRes._id || apiRes.id)){
            const ui=all.findIndex(x=>x.id===c.id);
            if(ui>=0){ all[ui].apiId = apiRes._id || apiRes.id; }
          }
        }

        ok++;
      } else {
        console.warn('[syncAllColabs falhou]', c.name, email, syncErr);
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
