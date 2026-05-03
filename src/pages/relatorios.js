import { S } from '../state.js';
import { $c, $d, sc, rolec, ini, segc } from '../utils/formatters.js';
import { GET, PUT } from '../services/api.js';
import { toast, searchOrders, renderOrderSearchBar } from '../utils/helpers.js';
import { can, findColab, getColabs } from '../services/auth.js';
import { ZONAS_MANAUS, resolveZona, getTurnoPedido, TURNOS } from '../utils/zonasManaus.js';

// ── Helpers locais (atividades / metas) ──────────────────────
function getActivities(){ return JSON.parse(localStorage.getItem('fv_activities')||'[]'); }

function getMetasPeriod(per){
  const now = new Date();
  const start = new Date();
  if(per==='dia'){
    start.setHours(0,0,0,0);
  } else if(per==='semana'){
    const day = now.getDay();
    start.setDate(now.getDate() - day);
    start.setHours(0,0,0,0);
  } else {
    start.setDate(1); start.setHours(0,0,0,0);
  }
  return start;
}

function getColabStats(colab){
  if(!colab) return {vendas:0,comissao:0,montagens:0,expedicoes:0};
  const acts = getActivities();
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

// Versão que respeita o período escolhido no Relatórios (dia/semana/mes/mes_ant/todos)
// Separa comissão por tipo (venda / montagem / expedição) e total de faturamento de vendas.
function getColabStatsForPeriod(colab, inPeriod){
  const base = {
    vendas:0, fatVendas:0, comissaoVenda:0,
    montagens:0, comissaoMontagem:0,
    expedicoes:0, comissaoExpedicao:0,
    comissaoTotal:0
  };
  if(!colab) return base;
  const acts = getActivities();
  const ids = new Set([colab.id, colab.backendId].filter(Boolean));
  const emailLow = (colab.email||'').toLowerCase();
  const nameLow  = (colab.name ||'').toLowerCase();
  const pctV = Number(colab.metas?.comissaoVenda ?? colab.metas?.vendaPct ?? 0) || 0;
  const vM   = Number(colab.metas?.comissaoMontagem  ?? 0) || 0;
  const vE   = Number(colab.metas?.comissaoExpedicao ?? 0) || 0;

  acts.forEach(a=>{
    if(!inPeriod(a.date)) return;
    const byId   = a.userId && ids.has(a.userId);
    const byEmail= emailLow && (a.userEmail||'').toLowerCase()===emailLow;
    const byName = nameLow  && (a.userName ||'').toLowerCase()===nameLow;
    if(!(byId || byEmail || byName)) return;
    if(a.type==='venda'){
      base.vendas++;
      base.fatVendas += (a.total||0);
      base.comissaoVenda += (a.total||0) * (pctV/100);
    } else if(a.type==='montagem'){
      base.montagens++;
      base.comissaoMontagem += vM;
    } else if(a.type==='expedicao'){
      base.expedicoes++;
      base.comissaoExpedicao += vE;
    }
  });
  base.comissaoTotal = base.comissaoVenda + base.comissaoMontagem + base.comissaoExpedicao;
  return base;
}

function metaBar(atual, meta, label, unit=''){
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

// ── render() via dynamic import ──────────────────────────────
async function render(){
  const { render:r } = await import('../main.js');
  r();
}

// ── RELATÓRIOS CUSTOMIZADOS — API com fallback localStorage ──
export async function getRelatorios() {
  try { const d = await GET('/settings/relatorios'); return d?.value || []; }
  catch { return JSON.parse(localStorage.getItem('fv_relatorios')||'[]'); }
}
export async function saveRelatorios(list) {
  try { await PUT('/settings/relatorios', { value: list }); }
  catch { localStorage.setItem('fv_relatorios', JSON.stringify(list)); }
}

// Versoes sync para compatibilidade com render
function getRelatoriosSync(){ return JSON.parse(localStorage.getItem('fv_relatorios')||'[]'); }
function saveRelatoriosSync(list){ localStorage.setItem('fv_relatorios', JSON.stringify(list)); }

// ── Constantes de relatórios customizados ─────────────────────
const REP_MODULES={
  pedidos:{label:'📋 Pedidos',fields:['orderNumber','createdAt','total','status','payment','type','unit','source','clientName','scheduledDate']},
  clientes:{label:'👥 Clientes',fields:['name','phone','email','segment','createdAt']},
  produtos:{label:'🌹 Produtos',fields:['name','category','salePrice','costPrice','stock','activeOnSite']},
  financeiro:{label:'💰 Financeiro',fields:['date','amount','description','category']},
};
const REP_FIELD_LABELS={
  orderNumber:'Nº Pedido',createdAt:'Data',total:'Total',status:'Status',payment:'Pagamento',
  type:'Tipo',unit:'Unidade',source:'Canal',clientName:'Cliente',scheduledDate:'Data Entrega',
  name:'Nome',phone:'Telefone',email:'E-mail',segment:'Segmento',
  category:'Categoria',salePrice:'Preço Venda',costPrice:'Custo',stock:'Estoque',activeOnSite:'Ativo Site',
  date:'Data',amount:'Valor',description:'Descrição',
};

// ── getReportData ─────────────────────────────────────────────
export function getReportData(rep){
  const period=rep.period||'mes'; const now=new Date();
  const inP=d=>{const dt=new Date(d); if(period==='hoje')return dt.toDateString()===now.toDateString(); if(period==='semana'){const w=new Date(now);w.setDate(now.getDate()-7);return dt>=w;} if(period==='mes')return dt.getMonth()===now.getMonth()&&dt.getFullYear()===now.getFullYear(); return true;};
  const rows=[];
  if((rep.modules||[]).includes('pedidos')) S.orders.filter(o=>inP(o.createdAt)).forEach(o=>{const r={};(rep.fields||[]).filter(f=>REP_MODULES.pedidos.fields.includes(f)).forEach(f=>r[f]=o[f]||'');if(Object.keys(r).length)rows.push({_mod:'pedidos',...r});});
  if((rep.modules||[]).includes('clientes')) S.clients.forEach(c=>{const r={};(rep.fields||[]).filter(f=>REP_MODULES.clientes.fields.includes(f)).forEach(f=>r[f]=c[f]||'');if(Object.keys(r).length)rows.push({_mod:'clientes',...r});});
  if((rep.modules||[]).includes('produtos')) S.products.forEach(p=>{const r={};(rep.fields||[]).filter(f=>REP_MODULES.produtos.fields.includes(f)).forEach(f=>r[f]=p[f]||'');if(Object.keys(r).length)rows.push({_mod:'produtos',...r});});
  return rows.filter(row=>(rep.filters||[]).every(f=>{const v=String(row[f.field]||'').toLowerCase();if(f.op==='eq')return v===String(f.value||'').toLowerCase();if(f.op==='contains')return v.includes(String(f.value||'').toLowerCase());if(f.op==='gt')return parseFloat(row[f.field]||0)>parseFloat(f.value||0);if(f.op==='lt')return parseFloat(row[f.field]||0)<parseFloat(f.value||0);return true;}));
}

// ── renderCustomReports ───────────────────────────────────────
export function renderCustomReports(){
  const reps=getRelatoriosSync(); const view=S._repView||'list';
  if(view==='list') return renderRepList(reps);
  if(view==='builder') return renderRepBuilder();
  if(view==='view') return renderRepView();
  return '';
}

// ── renderRepList ─────────────────────────────────────────────
export function renderRepList(reps){return`
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px;">
  <div><div style="font-family:'Playfair Display',serif;font-size:20px;color:var(--primary);">📋 Meus Relatórios</div>
  <div style="font-size:12px;color:var(--muted);">Crie, personalize e exporte relatórios profissionais</div></div>
  ${S.user?.role==='Administrador'?`<button class="btn btn-primary" onclick="repNew()">+ Novo Relatório</button>`:''}
</div>
${reps.length===0?`<div class="card" style="text-align:center;padding:60px 20px;">
  <div style="font-size:60px;margin-bottom:16px;">📊</div>
  <h3 style="color:var(--primary);margin-bottom:8px;">Nenhum relatório criado</h3>
  <p style="color:var(--muted);font-size:13px;margin-bottom:20px;">Crie relatórios personalizados com campos, filtros e gráficos.</p>
  ${S.user?.role==='Administrador'?`<button class="btn btn-primary" onclick="repNew()">+ Criar Primeiro Relatório</button>`:''}</div>`:`
<div style="display:flex;flex-direction:column;gap:12px;">
${reps.map((r,i)=>`<div class="card" style="padding:16px;">
  <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
    <div style="display:flex;align-items:center;gap:12px;">
      <div style="width:44px;height:44px;border-radius:10px;background:${r.color||'var(--primary)'};display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">📊</div>
      <div>
        <div style="font-weight:700;font-size:15px;">${r.name}</div>
        <div style="font-size:11px;color:var(--muted);">${(r.modules||[]).map(m=>REP_MODULES[m]?.label||m).join(' · ')} · ${r.fields?.length||0} campos · ${r.layout||'tabela'}</div>
        <div style="font-size:10px;color:var(--muted);">${new Date(r.updatedAt||r.createdAt||Date.now()).toLocaleDateString('pt-BR')}</div>
      </div>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;">
      <button class="btn btn-primary btn-sm" onclick="repView(${i})">👁️ Ver</button>
      <button class="btn btn-ghost btn-sm" onclick="repPresent(${i})">🎯 Apresentar</button>
      ${S.user?.role==='Administrador'?`
      <button class="btn btn-ghost btn-sm" onclick="repEdit(${i})">✏️</button>
      <button class="btn btn-ghost btn-sm" onclick="repDuplicate(${i})">📄</button>
      <button class="btn btn-ghost btn-sm" onclick="repDelete(${i})" style="color:var(--red);">🗑️</button>`:''}
    </div>
  </div>
</div>`).join('')}
</div>`}`;}

// ── renderRepBuilder ──────────────────────────────────────────
export function renderRepBuilder(){
  const draft=S._repDraft||{name:'',modules:[],fields:[],filters:[],groupBy:'',layout:'tabela',chartType:'bar',color:'#8B2252',period:'mes',extraFields:[]};
  return`
<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap;">
  <button class="btn btn-ghost btn-sm" onclick="S._repView='list';render()">← Voltar</button>
  <h3 style="font-family:'Playfair Display',serif;color:var(--primary);">${S._repEditIdx!==null?'✏️ Editar':'+ Novo'} Relatório</h3>
</div>
<div class="g2" style="gap:16px;align-items:start;">
  <div>
    <div class="card" style="margin-bottom:14px;">
      <div class="card-title">📝 Identificação</div>
      <div class="fr2" style="gap:10px;">
        <div class="fg" style="grid-column:span 2"><label class="fl">Nome *</label><input class="fi" id="rep-name" value="${draft.name||''}" placeholder="Ex: Vendas por Canal — Mensal"/></div>
        <div class="fg"><label class="fl">Período</label><select class="fi" id="rep-period">${['hoje','semana','mes','todos'].map(p=>`<option value="${p}" ${draft.period===p?'selected':''}>${{hoje:'Hoje',semana:'7 dias',mes:'Este mês',todos:'Todos'}[p]}</option>`).join('')}</select></div>
        <div class="fg"><label class="fl">Cor de destaque</label><input type="color" class="fi" id="rep-color" value="${draft.color||'#8B2252'}" style="height:38px;padding:2px 6px;"/></div>
      </div>
    </div>
    <div class="card" style="margin-bottom:14px;">
      <div class="card-title">🗂️ 1. Módulos</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        ${Object.entries(REP_MODULES).map(([k,m])=>`<label style="display:flex;align-items:center;gap:8px;padding:10px;border:1.5px solid ${(draft.modules||[]).includes(k)?'var(--primary)':'var(--border)'};border-radius:8px;cursor:pointer;background:${(draft.modules||[]).includes(k)?'var(--primary-pale)':'#fff'};">
          <input type="checkbox" class="rep-mod-cb" data-mod="${k}" ${(draft.modules||[]).includes(k)?'checked':''} style="accent-color:var(--primary)"/>
          <span style="font-size:13px;font-weight:500;">${m.label}</span></label>`).join('')}
      </div>
    </div>
    <div class="card" style="margin-bottom:14px;">
      <div class="card-title">📌 2. Campos</div>
      ${Object.entries(REP_MODULES).filter(([k])=>(draft.modules||[]).includes(k)).map(([k,m])=>`
      <div style="margin-bottom:12px;"><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--primary);margin-bottom:6px;">${m.label}</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">
          ${m.fields.map(f=>`<button onclick="repToggleField('${f}')" style="padding:4px 10px;border-radius:20px;border:1.5px solid ${(draft.fields||[]).includes(f)?'var(--primary)':'var(--border)'};background:${(draft.fields||[]).includes(f)?'var(--primary)':'#fff'};color:${(draft.fields||[]).includes(f)?'#fff':'var(--muted)'};font-size:12px;cursor:pointer;">${REP_FIELD_LABELS[f]||f}</button>`).join('')}
        </div>
      </div>`).join('')}
      ${!(draft.modules||[]).length?`<div style="color:var(--muted);font-size:13px;text-align:center;padding:16px;">Selecione módulos acima primeiro</div>`:''}
    </div>
    <div class="card" style="margin-bottom:14px;">
      <div class="card-title">🔍 3. Filtros <button class="btn btn-ghost btn-sm" onclick="repAddFilter()">+ Filtro</button></div>
      ${(draft.filters||[]).map((f,i)=>`<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap;">
        <select class="fi" style="flex:1;" onchange="repUpdateFilter(${i},'field',this.value)">${Object.entries(REP_FIELD_LABELS).map(([k,l])=>`<option value="${k}" ${f.field===k?'selected':''}>${l}</option>`).join('')}</select>
        <select class="fi" style="width:100px;" onchange="repUpdateFilter(${i},'op',this.value)"><option value="eq" ${f.op==='eq'?'selected':''}>= igual</option><option value="contains" ${f.op==='contains'?'selected':''}>contém</option><option value="gt" ${f.op==='gt'?'selected':''}>maior</option><option value="lt" ${f.op==='lt'?'selected':''}>menor</option></select>
        <input class="fi" style="flex:1;" value="${f.value||''}" placeholder="Valor..." onchange="repUpdateFilter(${i},'value',this.value)"/>
        <button class="btn btn-ghost btn-xs" onclick="repRemoveFilter(${i})" style="color:var(--red);">✕</button>
      </div>`).join('')}
      ${!(draft.filters||[]).length?`<div style="color:var(--muted);font-size:12px;">Nenhum filtro</div>`:''}
    </div>
    <div class="card">
      <div class="card-title">🎨 4. Layout</div>
      <div class="fr2" style="gap:10px;">
        <div class="fg"><label class="fl">Layout</label><select class="fi" id="rep-layout"><option value="tabela" ${(draft.layout||'tabela')==='tabela'?'selected':''}>📋 Tabela</option><option value="cards" ${draft.layout==='cards'?'selected':''}>🃏 Cards</option><option value="grafico" ${draft.layout==='grafico'?'selected':''}>📊 Gráfico</option></select></div>
        <div class="fg"><label class="fl">Gráfico</label><select class="fi" id="rep-chart-type"><option value="bar" ${(draft.chartType||'bar')==='bar'?'selected':''}>📊 Barra</option><option value="pie" ${draft.chartType==='pie'?'selected':''}>🍕 Pizza</option><option value="line" ${draft.chartType==='line'?'selected':''}>📈 Linha</option></select></div>
        <div class="fg"><label class="fl">Agrupar por</label><select class="fi" id="rep-groupby"><option value="">Sem agrupamento</option><option value="day" ${draft.groupBy==='day'?'selected':''}>Dia</option><option value="month" ${draft.groupBy==='month'?'selected':''}>Mês</option><option value="status" ${draft.groupBy==='status'?'selected':''}>Status</option><option value="category" ${draft.groupBy==='category'?'selected':''}>Categoria</option><option value="unit" ${draft.groupBy==='unit'?'selected':''}>Unidade</option><option value="payment" ${draft.groupBy==='payment'?'selected':''}>Pagamento</option></select></div>
        <div class="fg"><label class="fl">Campos extras (vírgula)</label><input class="fi" id="rep-extra" value="${(draft.extraFields||[]).join(', ')}" placeholder="Ex: Comanda, Cartão"/></div>
      </div>
    </div>
  </div>
  <div style="position:sticky;top:80px;">
    <div class="card" style="margin-bottom:14px;">
      <div class="card-title">💾 Salvar</div>
      <button class="btn btn-primary" onclick="repSave()" style="width:100%;padding:13px;font-size:15px;margin-bottom:8px;">💾 Salvar Relatório</button>
      <button class="btn btn-ghost" onclick="S._repView='list';render()" style="width:100%;">Cancelar</button>
    </div>
    <div class="card"><div class="card-title">Resumo</div>
      <div style="font-size:12px;color:var(--muted);">Módulos: <strong>${(draft.modules||[]).length}</strong> · Campos: <strong>${(draft.fields||[]).length}</strong> · Filtros: <strong>${(draft.filters||[]).length}</strong></div>
      <div style="margin-top:10px;background:${draft.color||'var(--primary)'};border-radius:6px;height:6px;"></div>
    </div>
  </div>
</div>`;}

// ── renderRepView ─────────────────────────────────────────────
export function renderRepView(){
  const rep=getRelatoriosSync()[S._repViewIdx||0]; if(!rep) return`<div class="card"><p>Relatório não encontrado</p></div>`;
  const rows=getReportData(rep); const fields=rep.fields||[]; const color=rep.color||'#8B2252';
  const total=rows.reduce((s,r)=>s+parseFloat(r.total||r.amount||0),0);
  const grpMap={}; if(rep.groupBy) rows.forEach(r=>{let k=''; if(rep.groupBy==='day')k=new Date(r.createdAt||Date.now()).toLocaleDateString('pt-BR'); else if(rep.groupBy==='month')k=new Date(r.createdAt||Date.now()).toLocaleDateString('pt-BR',{month:'long',year:'numeric'}); else k=r[rep.groupBy]||'—'; if(!grpMap[k])grpMap[k]={key:k,count:0,total:0}; grpMap[k].count++; grpMap[k].total+=parseFloat(r.total||0);});
  const grps=Object.values(grpMap).sort((a,b)=>b.total-a.total); const maxGrp=Math.max(...grps.map(g=>g.total),1);
  return`
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px;">
  <div style="display:flex;align-items:center;gap:10px;"><button class="btn btn-ghost btn-sm" onclick="S._repView='list';render()">← Voltar</button><h3 style="font-family:'Playfair Display',serif;color:var(--primary);">${rep.name}</h3></div>
  <div style="display:flex;gap:8px;flex-wrap:wrap;">
    <button class="btn btn-ghost btn-sm" onclick="repPresent(${S._repViewIdx||0})">🎯 Apresentar</button>
    <button class="btn btn-ghost btn-sm" onclick="repExportCSV(${S._repViewIdx||0})">📊 CSV</button>
    <button class="btn btn-ghost btn-sm" onclick="repExportPDF(${S._repViewIdx||0})">🖨️ PDF</button>
  </div>
</div>
<div class="g4" style="margin-bottom:16px;">
  <div class="mc rose"><div class="mc-label">Registros</div><div class="mc-val">${rows.length}</div></div>
  ${total>0?`<div class="mc leaf"><div class="mc-label">Total</div><div class="mc-val">${$c(total)}</div></div>`:''}
  ${grps.length?`<div class="mc gold"><div class="mc-label">Grupos</div><div class="mc-val">${grps.length}</div></div>`:''}
  <div class="mc blue"><div class="mc-label">Período</div><div class="mc-val" style="font-size:13px;">${{hoje:'Hoje',semana:'7 dias',mes:'Este mês',todos:'Tudo'}[rep.period]||rep.period}</div></div>
</div>
${grps.length?`<div class="card" style="margin-bottom:14px;">
  <div class="card-title">📊 Gráfico — ${rep.groupBy}</div>
  <div style="overflow-x:auto;"><div style="display:flex;gap:4px;align-items:flex-end;min-height:120px;padding:8px 0;">
    ${grps.slice(0,20).map(g=>`<div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1;min-width:36px;">
      <div style="font-size:10px;color:var(--muted);font-weight:600;">${g.count}</div>
      <div style="width:100%;background:${color};border-radius:4px 4px 0 0;height:${Math.round((g.total/maxGrp)*100)}px;min-height:4px;"></div>
      <div style="font-size:9px;color:var(--muted);text-align:center;">${g.key.slice(0,10)}</div>
    </div>`).join('')}
  </div></div>
</div>`:''}
<div class="card">
  <div class="card-title">${rep.name} <span style="font-size:12px;font-weight:400;color:var(--muted);">${rows.length} registro(s)</span></div>
  ${rows.length===0?`<div class="empty"><div class="empty-icon">📊</div><p>Nenhum dado</p></div>`:`
  <div style="overflow-x:auto;"><table><thead><tr>
    ${fields.map(f=>`<th>${REP_FIELD_LABELS[f]||f}</th>`).join('')}
    ${(rep.extraFields||[]).map(ef=>`<th>${ef}</th>`).join('')}
  </tr></thead><tbody>
    ${rows.slice(0,200).map(row=>`<tr>${fields.map(f=>{let v=row[f]||'—'; if(['total','amount','salePrice','costPrice'].includes(f))v=$c(parseFloat(v)||0); if(['createdAt','scheduledDate','date'].includes(f))v=v&&v!=='—'?new Date(v).toLocaleDateString('pt-BR'):'—'; if(f==='status'){const c2={Entregue:'t-green',Cancelado:'t-red','Em produção':'t-yellow',Pendente:'t-gray'}; v=`<span class="tag ${c2[v]||'t-gray'}">${v}</span>`;} return`<td>${v}</td>`;}).join('')}${(rep.extraFields||[]).map(()=>`<td></td>`).join('')}</tr>`).join('')}
  </tbody></table></div>`}
</div>`;}

// ── repNew / repEdit / repView ────────────────────────────────
export function repNew(){S._repView='builder';S._repDraft={name:'',modules:[],fields:[],filters:[],groupBy:'',layout:'tabela',chartType:'bar',color:'#8B2252',period:'mes',extraFields:[]};S._repEditIdx=null;render();}
export function repEdit(i){const rep=getRelatoriosSync()[i];if(!rep)return;S._repView='builder';S._repDraft={...rep};S._repEditIdx=i;render();}
export function repView(i){S._repView='view';S._repViewIdx=i;render();}
export function repToggleField(f){const d=S._repDraft||{};const fields=d.fields||[];d.fields=fields.includes(f)?fields.filter(x=>x!==f):[...fields,f];S._repDraft=d;render();}
export function repAddFilter(){const d=S._repDraft||{};d.filters=[...(d.filters||[]),{field:'status',op:'eq',value:''}];S._repDraft=d;render();}
export function repRemoveFilter(i){const d=S._repDraft||{};d.filters=(d.filters||[]).filter((_,j)=>j!==i);S._repDraft=d;render();}
export function repUpdateFilter(i,key,val){if(S._repDraft?.filters?.[i])S._repDraft.filters[i][key]=val;}

export function repDuplicate(i){const list=getRelatoriosSync();const copy={...list[i],name:list[i].name+' (cópia)',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};list.splice(i+1,0,copy);saveRelatoriosSync(list);saveRelatorios(list);render();toast('📄 Duplicado!');}
export function repDelete(i){if(!confirm('Excluir este relatório?'))return;const list=getRelatoriosSync();list.splice(i,1);saveRelatoriosSync(list);saveRelatorios(list);render();toast('🗑️ Excluído');}

export function repSave(){
  const g=id=>document.getElementById(id);
  const name=g('rep-name')?.value?.trim(); if(!name)return toast('❌ Nome obrigatório',true);
  const modules=[...document.querySelectorAll('.rep-mod-cb:checked')].map(c=>c.dataset.mod);
  if(!modules.length)return toast('⚠️ Selecione ao menos um módulo',true);
  const extra=g('rep-extra')?.value?.split(',').map(s=>s.trim()).filter(Boolean)||[];
  const d=S._repDraft||{};
  const rep={...d,name,modules,layout:g('rep-layout')?.value||'tabela',chartType:g('rep-chart-type')?.value||'bar',groupBy:g('rep-groupby')?.value||'',period:g('rep-period')?.value||'mes',color:g('rep-color')?.value||'#8B2252',extraFields:extra,updatedAt:new Date().toISOString()};
  if(!rep.createdAt)rep.createdAt=new Date().toISOString();
  const list=getRelatoriosSync(); if(S._repEditIdx!==null)list[S._repEditIdx]=rep; else list.unshift(rep);
  saveRelatoriosSync(list);saveRelatorios(list);S._repView='list';S._repDraft=null;S._repEditIdx=null;render();toast('✅ Relatório salvo!');
}

// ── repExportCSV ──────────────────────────────────────────────
export function repExportCSV(i){
  const rep=getRelatoriosSync()[i];if(!rep)return;const rows=getReportData(rep);const fields=rep.fields||[];
  const header=fields.map(f=>REP_FIELD_LABELS[f]||f).join(',');
  const lines=rows.map(r=>fields.map(f=>`"${String(r[f]||'').replace(/"/g,'""')}"`).join(','));
  const csv='\uFEFF'+[header,...lines].join('\n');
  const a=document.createElement('a');a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);a.download=rep.name.replace(/[^a-zA-Z0-9]/g,'_')+'.csv';a.click();toast('✅ CSV exportado!');
}

// ── repExportPDF ──────────────────────────────────────────────
export function repExportPDF(i){
  const rep=getRelatoriosSync()[i]; if(!rep) return;
  const rows=getReportData(rep); const fields=rep.fields||[]; const color=rep.color||'#8B2252';
  const total=rows.reduce((s,r)=>s+parseFloat(r.total||r.amount||0),0);
  const th=fields.map(f=>'<th>'+(REP_FIELD_LABELS[f]||f)+'</th>').join('');
  const tb=rows.slice(0,500).map(r=>'<tr>'+fields.map(f=>'<td>'+(r[f]||'-')+'</td>').join('')+'</tr>').join('');
  const css='body{font-family:Arial,sans-serif;margin:24px}h1{color:'+color+';font-size:22px}table{width:100%;border-collapse:collapse;font-size:11px;margin-top:16px}th{background:'+color+';color:#fff;padding:7px 8px}td{padding:6px 8px;border-bottom:1px solid #ddd}@media print{@page{margin:1cm}}';
  const kv=total>0?'R$ '+total.toFixed(2).replace('.',','):'';
  const w=window.open('','_blank'); if(!w) return toast('Permita popups para gerar PDF',true);
  w.document.open();
  w.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>'+rep.name+'</title><style>'+css+'</style></head><body>');
  w.document.write('<h1>'+rep.name+'</h1>');
  w.document.write('<p style="color:#999;font-size:12px">'+new Date().toLocaleString('pt-BR')+' · '+rows.length+' registros</p>');
  if(kv) w.document.write('<p><b style="color:'+color+'">Total: '+kv+'</b></p>');
  w.document.write('<table><thead><tr>'+th+'</tr></thead><tbody>'+tb+'</tbody></table>');
  w.document.write('</body></html>');
  w.document.close();
  w.onload=()=>w.print();
}

// ── repPresent ────────────────────────────────────────────────
export function repPresent(i){
  const rep=getRelatoriosSync()[i];if(!rep)return;
  const rows=getReportData(rep);const color=rep.color||'#8B2252';const total=rows.reduce((s,r)=>s+parseFloat(r.total||r.amount||0),0);
  const grpMap={};rows.forEach(r=>{const k=r.unit||r.category||r.status||'Geral';if(!grpMap[k])grpMap[k]={key:k,count:0,total:0};grpMap[k].count++;grpMap[k].total+=parseFloat(r.total||0);});
  const grps=Object.values(grpMap).sort((a,b)=>b.total-a.total).slice(0,8);const maxGrp=Math.max(...grps.map(g=>g.total),1);
  const slides=[
    `<div style="background:linear-gradient(135deg,${color},${color}99);min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;text-align:center;padding:40px;box-sizing:border-box;"><div style="font-size:64px;margin-bottom:20px;">📊</div><h1 style="font-size:clamp(28px,5vw,52px);font-weight:700;margin-bottom:12px;font-family:'Playfair Display',serif;">${rep.name}</h1><p style="font-size:18px;opacity:.85;margin-bottom:8px;">Laços Eternos Floricultura</p><p style="font-size:14px;opacity:.7;">${new Date().toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric'})}</p></div>`,
    `<div style="background:#fff;min-height:100vh;padding:60px;box-sizing:border-box;"><h2 style="color:${color};font-family:'Playfair Display',serif;font-size:36px;margin-bottom:32px;">📋 Resumo</h2><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:20px;"><div style="background:${color}15;border-radius:16px;padding:24px;border-left:6px solid ${color};"><div style="font-size:36px;font-weight:700;color:${color};">${rows.length}</div><div style="font-size:14px;color:#666;">Registros</div></div>${total>0?`<div style="background:${color}15;border-radius:16px;padding:24px;border-left:6px solid ${color};"><div style="font-size:36px;font-weight:700;color:${color};">R$ ${total.toFixed(2).replace('.',',')}</div><div style="font-size:14px;color:#666;">Total</div></div>`:''}<div style="background:${color}15;border-radius:16px;padding:24px;border-left:6px solid ${color};"><div style="font-size:36px;font-weight:700;color:${color};">${grps.length}</div><div style="font-size:14px;color:#666;">Grupos</div></div></div></div>`,
    `<div style="background:#F8F4F2;min-height:100vh;padding:60px;box-sizing:border-box;"><h2 style="color:${color};font-family:'Playfair Display',serif;font-size:36px;margin-bottom:32px;">📊 Análise</h2><div style="background:#fff;border-radius:16px;padding:32px;">${grps.length?`<div style="display:flex;gap:12px;align-items:flex-end;height:280px;padding-bottom:24px;">${grps.map(g=>`<div style="display:flex;flex-direction:column;align-items:center;gap:6px;flex:1;"><div style="font-size:11px;font-weight:700;color:${color};">R$ ${(g.total/1000).toFixed(1)}k</div><div style="width:100%;background:${color};border-radius:6px 6px 0 0;height:${Math.round((g.total/maxGrp)*240)}px;"></div><div style="font-size:10px;color:#666;text-align:center;">${g.key.slice(0,10)}</div></div>`).join('')}</div>`:'<p style="color:#999;text-align:center;padding:40px;">Sem dados</p>'}</div></div>`,
    `<div style="background:#fff;min-height:100vh;padding:60px;box-sizing:border-box;"><h2 style="color:${color};font-family:'Playfair Display',serif;font-size:36px;margin-bottom:32px;">🏆 Destaques</h2><div style="display:flex;flex-direction:column;gap:12px;">${grps.slice(0,6).map((g,i)=>`<div style="display:flex;align-items:center;gap:16px;padding:16px 20px;background:${i===0?color+'15':'#F8F4F2'};border-radius:12px;border-left:4px solid ${color};"><div style="font-size:24px;font-weight:700;color:${color};min-width:28px;">${i+1}</div><div style="flex:1;"><div style="font-weight:700;font-size:16px;">${g.key}</div><div style="font-size:13px;color:#666;">${g.count} registros</div></div><div style="font-weight:700;font-size:18px;color:${color};">R$ ${g.total.toFixed(2).replace('.',',')}</div></div>`).join('')}</div></div>`,
    `<div style="background:linear-gradient(135deg,#1A0A10,${color});min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;text-align:center;padding:40px;box-sizing:border-box;"><div style="font-size:64px;margin-bottom:20px;">🌸</div><h1 style="font-size:clamp(24px,4vw,44px);font-weight:700;margin-bottom:12px;font-family:'Playfair Display',serif;">Laços Eternos Floricultura</h1><p style="font-size:14px;opacity:.7;margin-top:16px;">${rep.name} · ${rows.length} registros</p></div>`,
  ];
  window._repSlides=slides;window._repCurrentSlide=0;
  const overlay=document.createElement('div');
  overlay.id='rep-present-overlay';
  overlay.style.cssText='position:fixed;inset:0;z-index:9999;background:#000;display:flex;flex-direction:column;';
  overlay.innerHTML=`<div id="rep-slide-content" style="flex:1;overflow:auto;">${slides[0]}</div>
  <div style="background:#1A0A10;padding:12px 20px;display:flex;align-items:center;justify-content:space-between;color:#fff;font-size:13px;">
    <button onclick="this.closest('#rep-present-overlay').remove()" style="background:rgba(255,255,255,.1);border:none;color:#fff;padding:8px 16px;border-radius:6px;cursor:pointer;">✕ Fechar (Esc)</button>
    <div style="display:flex;align-items:center;gap:12px;">
      <button onclick="repSlideNav(-1)" style="background:rgba(255,255,255,.15);border:none;color:#fff;width:36px;height:36px;border-radius:50%;cursor:pointer;font-size:18px;">‹</button>
      <span id="rep-slide-num">1 / ${slides.length}</span>
      <button onclick="repSlideNav(1)" style="background:rgba(255,255,255,.15);border:none;color:#fff;width:36px;height:36px;border-radius:50%;cursor:pointer;font-size:18px;">›</button>
    </div>
    <button onclick="window.print()" style="background:rgba(255,255,255,.1);border:none;color:#fff;padding:8px 16px;border-radius:6px;cursor:pointer;">🖨️ Imprimir</button>
  </div>`;
  document.body.appendChild(overlay);
  document.addEventListener('keydown',function repKey(e){if(!document.getElementById('rep-present-overlay')){document.removeEventListener('keydown',repKey);return;}if(e.key==='ArrowRight'||e.key==='ArrowDown')repSlideNav(1);if(e.key==='ArrowLeft'||e.key==='ArrowUp')repSlideNav(-1);if(e.key==='Escape')document.getElementById('rep-present-overlay')?.remove();});
}

// ── repSlideNav ───────────────────────────────────────────────
export function repSlideNav(dir){
  const slides=window._repSlides||[];const n=slides.length;
  window._repCurrentSlide=Math.max(0,Math.min(n-1,(window._repCurrentSlide||0)+dir));
  const c=document.getElementById('rep-slide-content');const num=document.getElementById('rep-slide-num');
  if(c)c.innerHTML=slides[window._repCurrentSlide];if(num)num.textContent=`${window._repCurrentSlide+1} / ${n}`;
}

// ── Sync exports ────────────────────────────────────────────
export { getRelatoriosSync, saveRelatoriosSync };

// ── Window registrations for inline onclick handlers ─────────
window.repNew = repNew;
window.repEdit = repEdit;
window.repView = repView;
window.repToggleField = repToggleField;
window.repAddFilter = repAddFilter;
window.repRemoveFilter = repRemoveFilter;
window.repUpdateFilter = repUpdateFilter;
window.repDuplicate = repDuplicate;
window.repDelete = repDelete;
window.repSave = repSave;
window.repExportCSV = repExportCSV;
window.repExportPDF = repExportPDF;
window.repPresent = repPresent;
window.repSlideNav = repSlideNav;

// ── RENDERRELATORIOS (principal) ─────────────────────────────
export function renderRelatorios(){
  const period = S._relPeriod||'mes';
  const unit   = S._relUnit||'';
  const tab    = S._relTab||'geral';
  const now    = new Date();

  // Filtro por datas especificas (data inicial + data final)
  // Quando period==='custom', usa S._relDate1 e S._relDate2 (formato YYYY-MM-DD).
  // Qualquer data ausente e tratada como "sem limite" daquele lado.
  const dt1Str = S._relDate1 || '';
  const dt2Str = S._relDate2 || '';

  const inPeriod = d=>{
    const dt=new Date(d);
    if(isNaN(dt.getTime())) return false;
    if(period==='hoje') return dt.toDateString()===now.toDateString();
    if(period==='semana'){const w=new Date(now);w.setDate(now.getDate()-7);return dt>=w;}
    if(period==='mes') return dt.getMonth()===now.getMonth()&&dt.getFullYear()===now.getFullYear();
    if(period==='mes_ant'){const m=now.getMonth()===0?11:now.getMonth()-1;const y=now.getMonth()===0?now.getFullYear()-1:now.getFullYear();return dt.getMonth()===m&&dt.getFullYear()===y;}
    if(period==='custom'){
      // Datas sao YYYY-MM-DD — monta inicio do dia (00:00) e fim do dia (23:59:59)
      if (dt1Str) {
        const ini = new Date(dt1Str + 'T00:00:00');
        if (dt < ini) return false;
      }
      if (dt2Str) {
        const fim = new Date(dt2Str + 'T23:59:59.999');
        if (dt > fim) return false;
      }
      return true;
    }
    return true;
  };

  const base = unit
    ? unit==='E-commerce'
      ? S.orders.filter(o=>o.source==='E-commerce'||(o.source||'').toLowerCase().includes('ecomm'))
      : S.orders.filter(o=>o.unit===unit&&o.source!=='E-commerce')
    : S.orders;
  const filtered= base.filter(o=>inPeriod(o.createdAt));
  // RELATORIOS DE VENDAS = pedidos validos (nao-cancelados) com pagamento
  // CONFIRMADO. Pedidos com paymentStatus 'Aguardando Pagamento' /
  // 'Aguardando Comprovante' NAO entram no faturamento ate confirmar.
  // Status considerados confirmados:
  //   'Aprovado', 'Pago', 'Pago na Entrega', 'Recebido'
  const PAGAMENTOS_CONFIRMADOS = ['Aprovado', 'Pago', 'Pago na Entrega', 'Recebido'];
  const PAGAMENTOS_AG_ENTREGA = ['Ag. Pagamento na Entrega']; // legitimo, mas separado
  const validos = filtered.filter(o => {
    if (o.status === 'Cancelado') return false;
    const ps = String(o.paymentStatus || '').trim();
    // Pagar na entrega (cliente vai pagar quando chegar) — entra somente
    // se a entrega ja foi confirmada (status Entregue)
    if (PAGAMENTOS_AG_ENTREGA.includes(ps)) return o.status === 'Entregue';
    // Sem paymentStatus definido (legado): assume confirmado se status
    // 'Entregue' ou 'Pronto'/'Saiu p/ entrega' (operacao normal antiga)
    if (!ps) return ['Entregue','Pronto','Saiu p/ entrega'].includes(o.status);
    // Demais: so se confirmado
    return PAGAMENTOS_CONFIRMADOS.includes(ps);
  });
  const entregues=filtered.filter(o=>o.status==='Entregue');
  const fat     = validos.reduce((s,o)=>s+(o.total||0),0);
  const ticket  = validos.length ? fat/validos.length : 0;
  const acts    = getActivities().filter(a=>inPeriod(a.date));

  // Produtos
  const byProd={};
  validos.forEach(o=>(o.items||[]).forEach(i=>{
    if(!byProd[i.name])byProd[i.name]={qty:0,rev:0};
    byProd[i.name].qty+=i.qty||1;
    byProd[i.name].rev+=(i.totalPrice||i.unitPrice*(i.qty||1)||0);
  }));
  const prodList=Object.entries(byProd).sort((a,b)=>b[1].rev-a[1].rev);
  const maxRev=prodList[0]?.[1]?.rev||1;

  // Por usuario (colaboradores nao-Entregadores) — comissões calculadas sobre o período
  const colabsAll = getColabs().filter(c=>c.active!==false);
  const selColab  = S._relColab||'';
  const colabsUsr = colabsAll
    .filter(c=>c.cargo!=='Entregador')
    .filter(c=>!selColab || c.id===selColab || c.backendId===selColab || (c.email||'')===selColab);
  const byUser = colabsUsr.map(c=>{
    const st = getColabStatsForPeriod(c, inPeriod);
    return {
      colab:c,
      name:c.name, role:c.cargo||'—', email:c.email||'',
      ...st
    };
  });
  // Fallback: incluir atividades de usuários não cadastrados como colaboradores
  const knownKeys = new Set();
  colabsAll.forEach(c=>{
    if(c.id) knownKeys.add(String(c.id));
    if(c.backendId) knownKeys.add(String(c.backendId));
    if(c.email) knownKeys.add((c.email||'').toLowerCase());
    if(c.name)  knownKeys.add((c.name ||'').toLowerCase());
  });
  const orphanMap={};
  acts.forEach(a=>{
    const k1 = a.userId   ? String(a.userId)            : '';
    const k2 = a.userEmail? (a.userEmail||'').toLowerCase() : '';
    const k3 = a.userName ? (a.userName ||'').toLowerCase() : '';
    if((k1 && knownKeys.has(k1))||(k2 && knownKeys.has(k2))||(k3 && knownKeys.has(k3))) return;
    const key = k1||k2||k3||'—';
    if(!orphanMap[key]) orphanMap[key]={name:a.userName||'Sem cadastro',role:a.userRole||'—',email:a.userEmail||'',vendas:0,fatVendas:0,comissaoVenda:0,montagens:0,comissaoMontagem:0,expedicoes:0,comissaoExpedicao:0,comissaoTotal:0,colab:null};
    if(a.type==='venda'){ orphanMap[key].vendas++; orphanMap[key].fatVendas+=(a.total||0); }
    if(a.type==='montagem') orphanMap[key].montagens++;
    if(a.type==='expedicao') orphanMap[key].expedicoes++;
  });
  if(!selColab) Object.values(orphanMap).forEach(o=>byUser.push(o));

  // Por entregador — usa a TAXA REAL APLICADA em cada pedido (auditoria)
  const byDriver={};
  getColabs().filter(c=>c.cargo==='Entregador'&&c.active!==false).forEach(c=>{
    const key = (c.name||'').trim();
    if(key) byDriver[key]={entregas:0,total:0,ganho:0,valorPorEntrega:c.metas?.valorEntrega||0,colabId:c.id};
  });
  entregues.forEach(o=>{
    // Prioriza a taxa registrada no momento da expedição (auditoria)
    // Fallback: taxa atual do pedido; último fallback: taxa configurada do colab
    const appliedFee = (typeof o.assignedDeliveryFee === 'number') ? o.assignedDeliveryFee
                     : (typeof o.deliveryFee === 'number' ? o.deliveryFee : 0);
    const d=(o.driverName||'').trim();
    if(!d){
      if(!byDriver['Sem entregador'])byDriver['Sem entregador']={entregas:0,total:0,ganho:0,valorPorEntrega:0,colabId:null};
      byDriver['Sem entregador'].entregas++;
      byDriver['Sem entregador'].total+=(o.total||0);
      byDriver['Sem entregador'].ganho+=appliedFee;
      return;
    }
    const key = Object.keys(byDriver).find(k=>k.toLowerCase()===d.toLowerCase()) || d;
    if(!byDriver[key]) byDriver[key]={entregas:0,total:0,ganho:0,valorPorEntrega:0,colabId:null};
    byDriver[key].entregas++;
    byDriver[key].total+=(o.total||0);
    byDriver[key].ganho+=appliedFee;
  });

  // Por pgto
  const byPay={};
  validos.forEach(o=>{const p=o.payment||'—';if(!byPay[p])byPay[p]={qty:0,total:0};byPay[p].qty++;byPay[p].total+=(o.total||0);});

  // Por unidade
  const byUnit={};
  validos.forEach(o=>{
    const u=(o.source==='E-commerce'||(o.source||'').toLowerCase().includes('ecomm'))?'E-commerce':(o.unit||'—');
    if(!byUnit[u])byUnit[u]={qty:0,total:0};
    byUnit[u].qty++;byUnit[u].total+=(o.total||0);
  });

  const periodLabel = period === 'custom'
    ? (dt1Str && dt2Str ? `${dt1Str.split('-').reverse().join('/')} – ${dt2Str.split('-').reverse().join('/')}`
       : dt1Str          ? `A partir de ${dt1Str.split('-').reverse().join('/')}`
       : dt2Str          ? `Até ${dt2Str.split('-').reverse().join('/')}`
       : 'Período personalizado')
    : ({hoje:'Hoje',semana:'Semana',mes:'Este Mês',mes_ant:'Mês Anterior',todos:'Todo o Período'}[period]||'');

  const tabBtn=(k,l)=>`<button class="tab ${tab===k?'active':''}" data-rel-tab="${k}">${l}</button>`;

  return`
<!-- Filtros -->
<div class="card" style="margin-bottom:14px;">
  <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
    <div style="display:flex;gap:3px;">
      ${[{k:'hoje',l:'Hoje'},{k:'semana',l:'Semana'},{k:'mes',l:'Este Mês'},{k:'mes_ant',l:'Mês Ant.'},{k:'todos',l:'Todos'}].map(p=>`
      <button class="btn btn-sm ${period===p.k?'btn-primary':'btn-ghost'}" data-rel-period="${p.k}">${p.l}</button>`).join('')}
      <button class="btn btn-sm ${period==='custom'?'btn-primary':'btn-ghost'}" data-rel-period="custom">📅 Por Datas</button>
    </div>
    ${(( S.user?.role==='Administrador'||S.user?.cargo==='admin')||S.user.role==='Gerente')?`
    <select class="fi" id="rel-unit-filter" style="width:auto;">
      <option value="">Todas as unidades</option>
      <option value="Loja Novo Aleixo" ${unit==='Loja Novo Aleixo'?'selected':''}>N. Aleixo</option>
      <option value="Loja Allegro Mall" ${unit==='Loja Allegro Mall'?'selected':''}>Allegro</option>
      <option value="CDLE" ${unit==='CDLE'?'selected':''}>CDLE</option>
      <option value="E-commerce" ${unit==='E-commerce'?'selected':''}>Site</option>
    </select>`:''}
    <button class="btn btn-ghost btn-sm" onclick="window.print()">🖨️ Imprimir</button>
  </div>

  ${period==='custom' ? `
  <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:10px;padding:10px 12px;background:linear-gradient(135deg,#FDF2F8,#FCE7F3);border:1px solid #F9A8D4;border-radius:8px;">
    <span style="font-size:12px;font-weight:700;color:#9D174D;">📅 Consulta por datas específicas:</span>
    <div class="fg" style="margin:0;">
      <label class="fl" style="font-size:10px;margin-bottom:2px;">Data inicial</label>
      <input type="date" class="fi" id="rel-date-1" value="${dt1Str}" style="width:auto;min-width:150px;"/>
    </div>
    <div class="fg" style="margin:0;">
      <label class="fl" style="font-size:10px;margin-bottom:2px;">Data final</label>
      <input type="date" class="fi" id="rel-date-2" value="${dt2Str}" style="width:auto;min-width:150px;"/>
    </div>
    ${(dt1Str||dt2Str) ? `<button class="btn btn-ghost btn-sm" id="rel-date-clear" style="color:var(--red);">🗑️ Limpar</button>` : ''}
    <span style="font-size:11px;color:var(--muted);font-style:italic;">Aplica a todas as abas de relatório (vendas, produtos, entregadores, etc.)</span>
  </div>` : ''}
</div>

<!-- KPIs -->
<div class="g4" style="margin-bottom:14px;">
  <div class="mc rose"><div class="mc-label">Pedidos</div><div class="mc-val">${filtered.length}</div><div class="mc-sub">${validos.length} válidos</div></div>
  <div class="mc leaf"><div class="mc-label">Faturamento</div><div class="mc-val">${$c(fat)}</div><div class="mc-sub">${periodLabel}</div></div>
  <div class="mc gold"><div class="mc-label">Ticket Médio</div><div class="mc-val">${$c(ticket)}</div></div>
  <div class="mc purple"><div class="mc-label">Entregues</div><div class="mc-val">${entregues.length}</div></div>
</div>

<!-- Tabs de relatorio -->
<div class="tabs" style="margin-bottom:14px;">
  ${tabBtn('geral','📊 Geral')}
  ${tabBtn('usuarios','👩‍💼 Por Usuário')}
  ${tabBtn('entregadores','🚚 Entregadores')}
  ${tabBtn('produtos','🌹 Produtos')}
  ${tabBtn('vendas','💰 Vendas Detail')}
  ${tabBtn('vendasUnidade','🏪 Vendas por Unidade')}
  ${tabBtn('caixa','💵 Caixa Completo')}
  ${tabBtn('montagens','🌿 Montagens')}
  ${tabBtn('clientes','👥 Clientes')}
  ${tabBtn('metas','🎯 Metas')}
  ${(S.user?.cargo==='admin'||S.user?.role==='Administrador'||(S.user?.modulos&&S.user.modulos.reportsOperacao===true))?tabBtn('operacao','⏰ Operação'):''}
  ${tabBtn('altademanda','💐 Alta Demanda')}
  ${tabBtn('porColaborador','👤 Por Colaborador')}
  ${tabBtn('chaoDatas','🌹 Chão de Datas Comemorativas')}
  ${tabBtn('custom','📋 Meus Relatórios')}
</div>

<!-- TAB: GERAL -->
${tab==='geral'?`
<div class="g2">
  <div>
    <div class="card" style="margin-bottom:14px;">
      <div class="card-title">🏆 Mais Vendidos</div>
      ${prodList.length===0?`<div class="empty"><p>Sem dados</p></div>`:
      prodList.slice(0,10).map(([n,{qty,rev}],i)=>`
      <div style="margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;">
          <span><strong style="color:var(--rose)">#${i+1}</strong> ${n}</span>
          <span style="color:var(--muted)">${qty}un · <strong>${$c(rev)}</strong></span>
        </div>
        <div class="pb"><div class="pf" style="width:${Math.round((rev/maxRev)*100)}%;background:${i<3?'var(--rose)':'var(--rose-l)'}"></div></div>
      </div>`).join('')}
    </div>
    <div class="card">
      <div class="card-title">📉 Menos Vendidos</div>
      ${prodList.length===0?`<div class="empty"><p>Sem dados</p></div>`:
      [...prodList].reverse().slice(0,5).map(([n,{qty,rev}])=>`
      <div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border);font-size:12px;">
        <span>${n}</span><span style="color:var(--muted)">${qty}un · ${$c(rev)}</span>
      </div>`).join('')}
    </div>
  </div>
  <div>
    <div class="card" style="margin-bottom:14px;">
      <div class="card-title">💳 Por Forma de Pagamento</div>
      ${Object.entries(byPay).map(([p,{qty,total}])=>`
      <div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border);font-size:12px;">
        <span>${p} <span style="color:var(--muted)">(${qty})</span></span>
        <span style="font-weight:600">${$c(total)}</span>
      </div>`).join('')||`<div class="empty" style="padding:12px"><p>Sem dados</p></div>`}
    </div>
    ${(( S.user?.role==='Administrador'||S.user?.cargo==='admin')||S.user.role==='Gerente')?`
    <div class="card">
      <div class="card-title">🏪 Por Unidade</div>
      ${Object.entries(byUnit).map(([u,{qty,total}])=>`
      <div style="margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;">
          <span style="font-weight:500">${u}</span><span>${qty} pedidos · ${$c(total)}</span>
        </div>
        <div class="pb"><div class="pf" style="width:${Math.round((total/Math.max(...Object.values(byUnit).map(b=>b.total),1))*100)}%;background:var(--leaf)"></div></div>
      </div>`).join('')||`<div class="empty" style="padding:12px"><p>Sem dados</p></div>`}
    </div>`:''}
  </div>
</div>`:''}

<!-- TAB: POR USUARIO / COLABORADORES -->
${tab==='usuarios'?`
<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;align-items:center;">
  <select class="fi" id="rel-colab-filter" style="width:auto;min-width:220px;">
    <option value="">Todos os colaboradores</option>
    ${colabsAll.filter(c=>c.cargo!=='Entregador').map(c=>`<option value="${c.id||c.backendId||c.email}" ${selColab===(c.id||c.backendId||c.email)?'selected':''}>${c.name} — ${c.cargo||'—'}</option>`).join('')}
  </select>
  <div style="font-size:12px;color:var(--muted)">${periodLabel} · ${byUser.length} colaborador(es)</div>
</div>
<div class="card">
  <div class="card-title">👩‍💼 Comissões & Desempenho — ${periodLabel}</div>
  ${byUser.length===0?`<div class="empty"><div class="empty-icon">👩‍💼</div><p>Sem colaboradores ou atividades no período</p></div>`:`
  <div class="tw"><table>
    <thead><tr>
      <th>Colaborador</th><th>Cargo</th>
      <th>Vendas</th><th>Fat. Vendas</th><th>Comissão Vendas</th>
      <th>Montagens</th><th>Comissão Mont.</th>
      <th>Expedições</th><th>Comissão Exp.</th>
      <th>Total Comissão</th>
    </tr></thead>
    <tbody>
    ${[...byUser].sort((a,b)=>(b.comissaoTotal||0)-(a.comissaoTotal||0)).map(u=>{
      const mt=u.colab?.metas||{};
      const pctV=Number(mt.comissaoVenda??mt.vendaPct??0)||0;
      const vM=Number(mt.comissaoMontagem??0)||0;
      const vE=Number(mt.comissaoExpedicao??0)||0;
      return`<tr>
        <td style="font-weight:600">${u.name}${u.email?`<div style="font-size:10px;color:var(--muted)">${u.email}</div>`:''}</td>
        <td><span class="tag ${rolec(u.role)}">${u.role}</span></td>
        <td style="font-weight:600;color:var(--rose)">${u.vendas}</td>
        <td style="color:var(--leaf)">${$c(u.fatVendas)}</td>
        <td style="font-weight:700;color:var(--leaf)">${$c(u.comissaoVenda)}<div style="font-size:10px;color:var(--muted)">${pctV?pctV+'%':'—'}</div></td>
        <td style="color:var(--gold)">${u.montagens}</td>
        <td style="font-weight:700;color:var(--gold)">${$c(u.comissaoMontagem)}<div style="font-size:10px;color:var(--muted)">${vM?'R$ '+vM.toFixed(2)+'/un':'—'}</div></td>
        <td style="color:var(--purple)">${u.expedicoes}</td>
        <td style="font-weight:700;color:var(--purple)">${$c(u.comissaoExpedicao)}<div style="font-size:10px;color:var(--muted)">${vE?'R$ '+vE.toFixed(2)+'/un':'—'}</div></td>
        <td style="font-weight:800;color:var(--primary);font-size:14px">${$c(u.comissaoTotal)}</td>
      </tr>`;}).join('')}
    </tbody>
    <tfoot>
      <tr style="background:var(--cream);font-weight:700;">
        <td colspan="2">TOTAL</td>
        <td>${byUser.reduce((s,u)=>s+u.vendas,0)}</td>
        <td>${$c(byUser.reduce((s,u)=>s+u.fatVendas,0))}</td>
        <td>${$c(byUser.reduce((s,u)=>s+u.comissaoVenda,0))}</td>
        <td>${byUser.reduce((s,u)=>s+u.montagens,0)}</td>
        <td>${$c(byUser.reduce((s,u)=>s+u.comissaoMontagem,0))}</td>
        <td>${byUser.reduce((s,u)=>s+u.expedicoes,0)}</td>
        <td>${$c(byUser.reduce((s,u)=>s+u.comissaoExpedicao,0))}</td>
        <td style="color:var(--primary)">${$c(byUser.reduce((s,u)=>s+u.comissaoTotal,0))}</td>
      </tr>
    </tfoot>
  </table></div>`}
</div>`:''}

<!-- TAB: ENTREGADORES -->
${tab==='entregadores'?`
<!-- Filtro por entregador -->
<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;align-items:center;">
  <select class="fi" id="rel-driver-filter" style="width:auto;min-width:180px;">
    <option value="">Todos os entregadores</option>
    ${Object.keys(byDriver).map(n=>`<option value="${n}" ${S._relDriver===n?'selected':''}>${n}</option>`).join('')}
  </select>
  <div style="font-size:12px;color:var(--muted)">
    ${periodLabel} · ${entregues.length} entrega(s) confirmada(s)
  </div>
</div>

<!-- Resumo por entregador -->
<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;margin-bottom:14px;">
  ${Object.entries(byDriver)
    .filter(([nome])=>!S._relDriver || nome===S._relDriver)
    .sort((a,b)=>b[1].entregas-a[1].entregas).map(([nome,{entregas,total,valorPorEntrega,ganho:ganhoReal}])=>{
    // Usa ganho REAL acumulado das taxas aplicadas em cada pedido (auditoria)
    // Fallback: entregas × taxa atual configurada
    const ganho = (typeof ganhoReal === 'number' && ganhoReal > 0) ? ganhoReal : ((valorPorEntrega||0)*entregas);
    return`
  <div style="background:#fff;border-radius:var(--rl);border:1px solid var(--border);padding:16px;box-shadow:var(--shadow);${entregas===0?'opacity:.7':''}">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
      <div class="av" style="width:38px;height:38px;font-size:14px;background:var(--rose);flex-shrink:0;">${ini(nome)}</div>
      <div>
        <div style="font-weight:700;font-size:13px">${nome}</div>
        <div style="font-size:10px;color:var(--muted)">Entregador${valorPorEntrega?` · R$ ${valorPorEntrega.toFixed(2)}/entrega`:''}</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:11px;">
      <div style="background:var(--leaf-l);border-radius:8px;padding:8px;text-align:center;">
        <div style="font-size:20px;font-weight:800;color:var(--leaf)">${entregas}</div>
        <div style="color:var(--leaf);font-weight:600">Entregas</div>
      </div>
      <div style="background:var(--rose-l);border-radius:8px;padding:8px;text-align:center;">
        <div style="font-size:14px;font-weight:800;color:var(--rose)">${ganho?$c(ganho):$c(total)}</div>
        <div style="color:var(--rose);font-weight:600">${ganho?'Ganho':'Valor total'}</div>
      </div>
    </div>
    ${entregas>0?`<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);font-size:11px;display:flex;justify-content:space-between;">
      <span style="color:var(--muted)">Média por entrega</span>
      <span style="font-weight:700">${$c(total/entregas)}</span>
    </div>`:'<div style="margin-top:8px;font-size:10px;color:var(--muted);text-align:center;">Sem entregas no período</div>'}
    <!-- Mini breakdown diario -->
    ${(()=>{
      const ords = entregues.filter(o=>(o.driverName||'').toLowerCase()===nome.toLowerCase());
      const byDay={};
      ords.forEach(o=>{ const d=$d(o.updatedAt||o.createdAt); if(!byDay[d])byDay[d]=0; byDay[d]++; });
      const days=Object.entries(byDay).sort((a,b)=>b[0].localeCompare(a[0])).slice(0,5);
      if(!days.length) return '';
      return `<div style="margin-top:8px;font-size:10px;">
        <div style="color:var(--muted);margin-bottom:4px;font-weight:600">Últimas entregas por dia:</div>
        ${days.map(([d,n])=>`<div style="display:flex;justify-content:space-between;padding:2px 0;">
          <span style="color:var(--muted)">${d}</span>
          <span style="font-weight:700;color:var(--leaf)">${n} entrega${n>1?'s':''}</span>
        </div>`).join('')}
      </div>`;
    })()}
  </div>`}).join('')}
</div>

${Object.keys(byDriver).length===0?`<div class="empty card"><div class="empty-icon">🚚</div><p>Nenhum entregador cadastrado. Adicione colaboradores com cargo <strong>Entregador</strong> no módulo Colaboradores.</p></div>`:''}

<!-- Detalhe completo de todas as entregas -->
<div class="card">
  <div class="card-title" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
    <span>📋 Histórico Detalhado — ${periodLabel} <span style="font-size:11px;color:var(--muted)">${entregues.length} entrega(s)</span></span>
    ${renderOrderSearchBar('Buscar por nº pedido, cliente ou telefone...')}
  </div>
  ${(()=>{
    const listaEntregas = searchOrders(
      [...entregues]
        .filter(o=>!S._relDriver || (o.driverName||'').toLowerCase()===S._relDriver.toLowerCase())
        .sort((a,b)=>new Date(b.updatedAt||b.createdAt)-new Date(a.updatedAt||a.createdAt)),
      S._orderSearch
    );
    if(!listaEntregas.length) return `<div class="empty"><p>${S._orderSearch?'Nenhum resultado para "'+S._orderSearch+'"':'Sem entregas confirmadas no período'}</p></div>`;
    return`<div class="tw"><table>
    <thead><tr>
      <th>#</th><th>Entregador</th><th>Cliente / Destinatário</th>
      <th>Endereço</th><th>Valor</th><th>Data Entrega</th>
    </tr></thead>
    <tbody>
    ${listaEntregas.map(o=>`<tr>
      <td style="color:var(--rose);font-weight:700">${o.orderNumber}</td>
      <td>
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-size:14px">🚚</span>
          <span style="font-weight:600">${o.driverName||'—'}</span>
        </div>
      </td>
      <td>
        <div style="font-weight:500">${o.recipient||o.client?.name||o.clientName||'—'}</div>
        <div style="font-size:10px;color:var(--muted)">${o.client?.name||o.clientName||''}</div>
      </td>
      <td style="font-size:11px;color:var(--muted);max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${o.deliveryAddress||'—'}</td>
      <td style="font-weight:700;color:var(--rose)">${$c(o.total)}</td>
      <td style="font-size:11px">${$d(o.updatedAt||o.createdAt)}</td>
    </tr>`).join('')}
    </tbody>
  </table></div>`;
  })()}
</div>`:''}

<!-- TAB: PRODUTOS -->
${tab==='produtos'?`
<div class="card">
  <div class="card-title">🌹 Relatório Completo de Produtos — ${periodLabel}</div>
  ${prodList.length===0?`<div class="empty"><div class="empty-icon">🌹</div><p>Sem vendas no período</p></div>`:`
  <div class="tw"><table>
    <thead><tr><th>Ranking</th><th>Produto</th><th>Qtd Vendida</th><th>Receita Total</th><th>% do Total</th></tr></thead>
    <tbody>
    ${prodList.map(([n,{qty,rev}],i)=>`<tr style="${i<3?'background:var(--petal)':''}">
      <td style="font-weight:700;color:${i===0?'var(--gold)':i===1?'var(--muted)':i===2?'#CD7F32':'var(--ink)'}">${i===0?'🥇':i===1?'🥈':i===2?'🥉':'#'+(i+1)}</td>
      <td style="font-weight:600">${n}</td>
      <td><span class="tag t-blue">${qty} un</span></td>
      <td style="font-weight:700;color:var(--leaf)">${$c(rev)}</td>
      <td style="font-size:11px;color:var(--muted)">${fat>0?Math.round((rev/fat)*100):'0'}%</td>
    </tr>`).join('')}
    <tr style="background:var(--cream);font-weight:700;">
      <td colspan="2">TOTAL</td>
      <td>${prodList.reduce((s,[,{qty}])=>s+qty,0)} un</td>
      <td>${$c(fat)}</td>
      <td>100%</td>
    </tr>
    </tbody>
  </table></div>`}
</div>`:''}

<!-- TAB: VENDAS DETALHADO -->
${tab==='vendas'?`
<div class="card">
  <div class="card-title">💰 Vendas Detalhadas — ${periodLabel}
    <span style="font-size:11px;color:var(--muted);">${validos.length} pedidos · ${$c(fat)}</span>
  </div>
  ${validos.length===0?`<div class="empty"><div class="empty-icon">💰</div><p>Sem vendas no período</p></div>`:`
  <div class="tw"><table>
    <thead><tr><th>#</th><th>Cliente</th><th>Unidade</th><th>Itens</th><th>Pgto</th><th>Total</th><th>Status</th><th>Data</th></tr></thead>
    <tbody>
    ${validos.map(o=>`<tr>
      <td style="color:var(--rose);font-weight:600">${o.orderNumber||'—'}</td>
      <td style="font-weight:500">${o.client?.name||o.clientName||'—'}</td>
      <td style="font-size:10px"><span class="tag t-gray">${o.unit||'—'}</span></td>
      <td style="font-size:11px;color:var(--muted)">${(o.items||[]).map(i=>`${i.qty}x ${i.name}`).join(', ').substring(0,30)||'—'}</td>
      <td><span class="tag t-gray" style="font-size:9px">${o.payment||'—'}</span></td>
      <td style="font-weight:600">${$c(o.total)}</td>
      <td><span class="tag ${sc(o.status)}">${o.status}</span></td>
      <td style="font-size:11px">${$d(o.createdAt)}</td>
    </tr>`).join('')}
    </tbody>
  </table></div>`}
</div>`:''}

<!-- TAB: VENDAS POR UNIDADE -->
${tab==='vendasUnidade'?(()=>{
  // Agrega vendas por unidade no periodo (ja filtrado em `validos`).
  // 'validos' EXCLUI 'Cancelado' — pedidos cancelados nao entram aqui.
  const fProdRel = (S._relProdFilter||'').toLowerCase().trim();
  const fValMin  = parseFloat(S._relValMin)||0;
  const fValMax  = parseFloat(S._relValMax)||0;
  const fPagRel  = (S._relPagFilter||'').trim();
  const fDateRel1 = S._relTabDate1||'';
  const fDateRel2 = S._relTabDate2||'';

  const matchesProd = (o) => {
    if (!fProdRel) return true;
    return (o.items||[]).some(i => String(i.name||i.nome||'').toLowerCase().includes(fProdRel));
  };
  const matchesValor = (o) => {
    const t = o.total||0;
    if (fValMin && t < fValMin) return false;
    if (fValMax && t > fValMax) return false;
    return true;
  };
  const matchesPag = (o) => {
    if (!fPagRel) return true;
    const pg = (o.payment || o.paymentMethod || '').toLowerCase();
    return pg.includes(fPagRel.toLowerCase());
  };
  const matchesDate = (o) => {
    if (!fDateRel1 && !fDateRel2) return true;
    const d = String(o.scheduledDate || o.createdAt || '').substring(0, 10);
    if (!d) return false;
    if (fDateRel1 && d < fDateRel1) return false;
    if (fDateRel2 && d > fDateRel2) return false;
    return true;
  };

  // Lista APENAS pedidos validos (sem Cancelados) que passem nos filtros
  const lista = validos.filter(o =>
    matchesProd(o) && matchesValor(o) && matchesPag(o) && matchesDate(o)
  );

  const porUnidade = {};
  lista.forEach(o => {
    const uni = o.saleUnit || o.unit || '—';
    if (!porUnidade[uni]) porUnidade[uni] = { qty:0, total:0, itens:0 };
    porUnidade[uni].qty++;
    porUnidade[uni].total += (o.total||0);
    porUnidade[uni].itens += (o.items||[]).reduce((s,i)=>s+(i.qty||1),0);
  });
  const linhas = Object.entries(porUnidade).sort((a,b)=>b[1].total-a[1].total);
  const totalGeral = linhas.reduce((s,[,d])=>s+d.total, 0);

  // Agregacao por forma de pagamento (cruzado com unidade)
  const porPag = {};
  const pagPorUnidade = {}; // { 'Pix': { 'CDLE': { qty, total }, 'Allegro': {...} } }
  lista.forEach(o => {
    const pg = o.payment || o.paymentMethod || '—';
    const uni = o.saleUnit || o.unit || '—';
    if (!porPag[pg]) porPag[pg] = { qty:0, total:0 };
    porPag[pg].qty++;
    porPag[pg].total += (o.total||0);
    if (!pagPorUnidade[pg]) pagPorUnidade[pg] = {};
    if (!pagPorUnidade[pg][uni]) pagPorUnidade[pg][uni] = { qty:0, total:0 };
    pagPorUnidade[pg][uni].qty++;
    pagPorUnidade[pg][uni].total += (o.total||0);
  });

  const allPagamentos = ['Pix','Cartão','Cartão Crédito','Cartão Débito','Dinheiro','Pagar na Entrega','Boleto'];

  return `
<div class="card" style="margin-bottom:14px;">
  <div class="card-title">🏪 Vendas por Unidade — ${periodLabel}
    <span class="tag" style="background:#D1FAE5;color:#047857;font-size:10px;margin-left:6px;" title="Apenas pedidos com pagamento Aprovado/Pago aparecem nos totais">✅ Pagamento confirmado</span>
    <span class="tag" style="background:#FEE2E2;color:#991B1B;font-size:10px;margin-left:4px;">⛔ Cancelados não contam</span>
  </div>
  <div class="fr3" style="align-items:end;">
    <div class="fg"><label class="fl">📅 Data inicial</label>
      <input type="date" class="fi" id="rep-date1" value="${fDateRel1}"/>
    </div>
    <div class="fg"><label class="fl">📅 Data final</label>
      <input type="date" class="fi" id="rep-date2" value="${fDateRel2}"/>
    </div>
    <div class="fg"><label class="fl">💳 Forma de pagamento</label>
      <select class="fi" id="rep-pag-filter">
        <option value="">Todas</option>
        ${allPagamentos.map(p => `<option value="${p}" ${fPagRel===p?'selected':''}>${p}</option>`).join('')}
      </select>
    </div>
  </div>
  <div class="fr3" style="align-items:end;margin-top:8px;">
    <div class="fg"><label class="fl">🌹 Filtrar por produto</label>
      <input type="text" class="fi" id="rep-prod-filter" placeholder="Ex: Rosa, Buque..." value="${S._relProdFilter||''}"/>
    </div>
    <div class="fg"><label class="fl">Valor mínimo (R$)</label>
      <input type="number" class="fi" id="rep-val-min" placeholder="0" value="${S._relValMin||''}"/>
    </div>
    <div class="fg"><label class="fl">Valor máximo (R$)</label>
      <input type="number" class="fi" id="rep-val-max" placeholder="9999" value="${S._relValMax||''}"/>
    </div>
  </div>
  <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;padding:10px 14px;background:linear-gradient(135deg,#FDF4F7,#fff);border-radius:8px;">
    <div>
      <div style="font-size:11px;color:var(--muted);">Total no período</div>
      <div style="font-size:20px;font-weight:900;color:var(--leaf);">${$c(totalGeral)}</div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:11px;color:var(--muted);">Pedidos válidos (sem Cancelados)</div>
      <div style="font-size:20px;font-weight:900;color:var(--ink);">${lista.length}</div>
    </div>
    ${(fProdRel||fValMin||fValMax||fPagRel||fDateRel1||fDateRel2) ? `<button class="btn btn-ghost btn-sm" id="btn-rep-vu-clear" style="color:var(--red);">🗑️ Limpar filtros</button>` : ''}
  </div>
</div>

<div class="g2">
  <div class="card">
    <div class="card-title">📊 Resumo por Unidade</div>
    ${linhas.length===0 ? `<div class="empty"><p>Nenhuma venda no período.</p></div>` : `
    <div style="overflow-x:auto;"><table>
      <thead><tr><th>Unidade</th><th>Pedidos</th><th>Itens</th><th>Faturamento</th><th>%</th></tr></thead>
      <tbody>
        ${linhas.map(([uni, d]) => `<tr>
          <td><strong>${uni}</strong></td>
          <td>${d.qty}</td>
          <td>${d.itens}</td>
          <td style="color:var(--leaf);font-weight:700;">${$c(d.total)}</td>
          <td>${totalGeral ? Math.round((d.total/totalGeral)*100) : 0}%</td>
        </tr>`).join('')}
      </tbody>
      <tfoot>
        <tr style="background:var(--leaf-l);font-weight:800;">
          <td>🏆 TOTAL GERAL</td>
          <td>${linhas.reduce((s,[,d])=>s+d.qty,0)}</td>
          <td>${linhas.reduce((s,[,d])=>s+d.itens,0)}</td>
          <td style="color:var(--leaf);">${$c(totalGeral)}</td>
          <td>100%</td>
        </tr>
      </tfoot>
    </table></div>`}
  </div>
  <div class="card">
    <div class="card-title">💳 Por Forma de Pagamento</div>
    ${Object.keys(porPag).length===0 ? `<div class="empty"><p>Sem dados.</p></div>` : `
    <div style="overflow-x:auto;"><table>
      <thead><tr><th>Forma</th><th>Pedidos</th><th>Total</th><th>%</th></tr></thead>
      <tbody>
        ${Object.entries(porPag).sort((a,b)=>b[1].total-a[1].total).map(([pg, d]) => `<tr>
          <td><strong>${pg}</strong></td>
          <td>${d.qty}</td>
          <td style="color:var(--leaf);font-weight:700;">${$c(d.total)}</td>
          <td>${totalGeral ? Math.round((d.total/totalGeral)*100) : 0}%</td>
        </tr>`).join('')}
      </tbody>
      <tfoot>
        <tr style="background:#FCE7F0;font-weight:800;">
          <td>💰 TOTAL</td>
          <td>${Object.values(porPag).reduce((s,d)=>s+d.qty,0)}</td>
          <td style="color:var(--leaf);">${$c(totalGeral)}</td>
          <td>100%</td>
        </tr>
      </tfoot>
    </table></div>`}
  </div>
</div>

<div class="card" style="margin-top:14px;">
  <div class="card-title">🔀 Cruzamento: Forma de Pagamento × Unidade</div>
  ${Object.keys(pagPorUnidade).length===0 ? `<div class="empty"><p>Sem dados.</p></div>` : `
  <div style="overflow-x:auto;"><table>
    <thead><tr>
      <th>Forma Pagto.</th>
      ${linhas.map(([uni]) => `<th style="text-align:right;">${uni}</th>`).join('')}
      <th style="text-align:right;background:var(--leaf-l);">Total</th>
    </tr></thead>
    <tbody>
      ${Object.entries(pagPorUnidade).sort((a,b)=>{
        const ta = Object.values(a[1]).reduce((s,d)=>s+d.total,0);
        const tb = Object.values(b[1]).reduce((s,d)=>s+d.total,0);
        return tb - ta;
      }).map(([pg, perUni]) => {
        const linha = linhas.map(([uni]) => {
          const v = perUni[uni];
          return `<td style="text-align:right;font-weight:600;color:var(--leaf);">${v ? $c(v.total) : '—'}</td>`;
        }).join('');
        const totalPg = Object.values(perUni).reduce((s,d)=>s+d.total,0);
        return `<tr>
          <td><strong>${pg}</strong></td>
          ${linha}
          <td style="text-align:right;background:var(--leaf-l);font-weight:800;color:var(--leaf);">${$c(totalPg)}</td>
        </tr>`;
      }).join('')}
    </tbody>
    <tfoot>
      <tr style="background:#FCE7F0;font-weight:800;">
        <td>💰 TOTAL</td>
        ${linhas.map(([,d]) => `<td style="text-align:right;color:var(--leaf);">${$c(d.total)}</td>`).join('')}
        <td style="text-align:right;background:var(--leaf);color:#fff;">${$c(totalGeral)}</td>
      </tr>
    </tfoot>
  </table></div>`}
</div>

<div class="card" style="margin-top:14px;">
  <div class="card-title">📋 Pedidos do período (${lista.length})</div>
  ${lista.length===0 ? `<div class="empty"><p>Nenhum pedido.</p></div>` : `
  <div style="max-height:400px;overflow-y:auto;"><table>
    <thead><tr><th>Pedido</th><th>Unidade</th><th>Cliente</th><th>Pagamento</th><th>Total</th></tr></thead>
    <tbody>
      ${lista.slice(0,200).map(o => `<tr>
        <td><strong>${o.orderNumber||'—'}</strong></td>
        <td><span class="tag t-rose" style="font-size:10px;">${o.saleUnit||o.unit||'—'}</span></td>
        <td style="font-size:11px;">${o.client?.name||o.clientName||'—'}</td>
        <td style="font-size:11px;">${o.payment||'—'}</td>
        <td style="font-weight:600;">${$c(o.total)}</td>
      </tr>`).join('')}
    </tbody>
  </table></div>`}
</div>`;
})():''}

<!-- TAB: CAIXA COMPLETO -->
${tab==='caixa'?(()=>{
  const fUni = (S._relCaixaUnit||'').trim();
  const fPag = (S._relCaixaPag||'').trim();
  const fProdC = (S._relCaixaProd||'').toLowerCase().trim();

  const matchesProdC = (o) => !fProdC || (o.items||[]).some(i => String(i.name||i.nome||'').toLowerCase().includes(fProdC));

  const lista = validos.filter(o =>
    (!fUni || (o.saleUnit||o.unit||'') === fUni) &&
    (!fPag || (o.payment||o.paymentMethod||'') === fPag) &&
    matchesProdC(o)
  );

  const totalGeral = lista.reduce((s,o)=>s+(o.total||0), 0);

  // Agregacoes
  const porPag = {};
  const porUni = {};
  const porProd = {};
  lista.forEach(o => {
    const pg = o.payment || o.paymentMethod || '—';
    porPag[pg] = (porPag[pg] || { qty:0, total:0 });
    porPag[pg].qty++; porPag[pg].total += (o.total||0);

    const uni = o.saleUnit || o.unit || '—';
    porUni[uni] = (porUni[uni] || { qty:0, total:0 });
    porUni[uni].qty++; porUni[uni].total += (o.total||0);

    (o.items||[]).forEach(i => {
      const nm = i.name || i.nome || '—';
      porProd[nm] = (porProd[nm] || { qty:0, total:0 });
      porProd[nm].qty += (i.qty||1);
      porProd[nm].total += (i.totalPrice || i.unitPrice * (i.qty||1) || 0);
    });
  });

  const allUnits = ['CDLE','Loja Novo Aleixo','Loja Allegro Mall','E-commerce'];
  const allPagamentos = ['Pix','Cartão','Cartao','Cartao Credito','Cartao Debito','Dinheiro','Pagar na Entrega','Boleto'];

  return `
<div class="card" style="margin-bottom:14px;">
  <div class="card-title">💵 Relatório de Caixa — ${periodLabel}</div>
  <div class="fr3" style="align-items:end;">
    <div class="fg"><label class="fl">Unidade</label>
      <select class="fi" id="rep-caixa-unit">
        <option value="">Todas</option>
        ${allUnits.map(u => `<option value="${u}" ${fUni===u?'selected':''}>${u}</option>`).join('')}
      </select>
    </div>
    <div class="fg"><label class="fl">Forma de pagamento</label>
      <select class="fi" id="rep-caixa-pag">
        <option value="">Todas</option>
        ${allPagamentos.map(p => `<option value="${p}" ${fPag===p?'selected':''}>${p}</option>`).join('')}
      </select>
    </div>
    <div class="fg"><label class="fl">Produto contém</label>
      <input type="text" class="fi" id="rep-caixa-prod" placeholder="Ex: Rosa..." value="${S._relCaixaProd||''}"/>
    </div>
  </div>
  <div style="margin-top:10px;padding:10px 14px;background:linear-gradient(135deg,#FDF4F7,#fff);border-radius:8px;">
    <div style="font-size:11px;color:var(--muted);">Total no período (${lista.length} pedidos)</div>
    <div style="font-size:22px;font-weight:900;color:var(--leaf);">${$c(totalGeral)}</div>
  </div>
</div>

<div class="g2">
  <div class="card">
    <div class="card-title">💳 Por Forma de Pagamento</div>
    ${Object.keys(porPag).length===0 ? `<div class="empty"><p>Sem dados.</p></div>` : `
    <table><thead><tr><th>Forma</th><th>Pedidos</th><th>Total</th></tr></thead>
      <tbody>${Object.entries(porPag).sort((a,b)=>b[1].total-a[1].total).map(([k,v])=>`
        <tr><td><strong>${k}</strong></td><td>${v.qty}</td><td style="color:var(--leaf);font-weight:700;">${$c(v.total)}</td></tr>
      `).join('')}</tbody>
    </table>`}
  </div>
  <div class="card">
    <div class="card-title">🏪 Por Unidade</div>
    ${Object.keys(porUni).length===0 ? `<div class="empty"><p>Sem dados.</p></div>` : `
    <table><thead><tr><th>Unidade</th><th>Pedidos</th><th>Total</th></tr></thead>
      <tbody>${Object.entries(porUni).sort((a,b)=>b[1].total-a[1].total).map(([k,v])=>`
        <tr><td><strong>${k}</strong></td><td>${v.qty}</td><td style="color:var(--leaf);font-weight:700;">${$c(v.total)}</td></tr>
      `).join('')}</tbody>
    </table>`}
  </div>
</div>

<div class="card" style="margin-top:14px;">
  <div class="card-title">🌹 Por Produto (top 50)</div>
  ${Object.keys(porProd).length===0 ? `<div class="empty"><p>Sem dados.</p></div>` : `
  <div style="max-height:500px;overflow-y:auto;"><table>
    <thead><tr><th>Produto</th><th>Qtd</th><th>Total</th></tr></thead>
    <tbody>${Object.entries(porProd).sort((a,b)=>b[1].total-a[1].total).slice(0,50).map(([k,v])=>`
      <tr><td>${k}</td><td>${v.qty}</td><td style="color:var(--leaf);font-weight:700;">${$c(v.total)}</td></tr>
    `).join('')}</tbody>
  </table></div>`}
</div>`;
})():''}

<!-- TAB: CLIENTES -->
${tab==='clientes'?`
<div class="g2">
  <div class="card">
    <div class="card-title">👥 Top Clientes por Faturamento — ${periodLabel}</div>
    ${(()=>{
      const byClient={};
      validos.forEach(o=>{
        const id=o.client?._id||o.clientId||o.clientName||'—';
        const name=o.client?.name||o.clientName||'—';
        if(!byClient[id])byClient[id]={name,pedidos:0,total:0};
        byClient[id].pedidos++; byClient[id].total+=(o.total||0);
      });
      const sorted=Object.values(byClient).sort((a,b)=>b.total-a.total).slice(0,10);
      const max=sorted[0]?.total||1;
      return sorted.length===0?'<div class="empty"><p>Sem dados no período</p></div>':
      sorted.map((c,i)=>`
      <div style="margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;">
          <span><strong style="color:var(--rose)">#${i+1}</strong> ${c.name}</span>
          <span>${c.pedidos} pedido(s) · <strong>${$c(c.total)}</strong></span>
        </div>
        <div class="pb"><div class="pf" style="width:${Math.round(c.total/max*100)}%;background:var(--rose)"></div></div>
      </div>`).join('');
    })()}
  </div>
  <div>
    <div class="card" style="margin-bottom:14px;">
      <div class="card-title">📊 Resumo de Clientes</div>
      ${(()=>{
        const total=S.clients.length;
        const novos=S.clients.filter(c=>c.segment==='Novo'||!c.segment).length;
        const recorrentes=S.clients.filter(c=>c.segment==='Recorrente').length;
        const vips=S.clients.filter(c=>c.segment==='VIP').length;
        return `
        ${[['Total de Clientes',total,'var(--rose)'],['Novos',novos,'var(--blue)'],
           ['Recorrentes',recorrentes,'var(--leaf)'],['VIP',vips,'var(--gold)']].map(([l,v,c])=>`
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);">
          <span style="font-size:13px">${l}</span>
          <span style="font-size:14px;font-weight:700;color:${c}">${v}</span>
        </div>`).join('')}`;
      })()}
    </div>
    <div class="card">
      <div class="card-title">🔄 Clientes que Mais Compraram</div>
      ${(()=>{
        const clientes = S.clients.map(c=>({
          ...c,
          pedidos: validos.filter(o=>o.client?._id===c._id||o.clientName===c.name).length
        })).filter(c=>c.pedidos>0).sort((a,b)=>b.pedidos-a.pedidos).slice(0,5);
        return clientes.length===0?'<div class="empty"><p>Sem dados</p></div>':
        clientes.map(c=>`
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:12px;">
          <div>
            <div style="font-weight:600">${c.name}</div>
            <div style="color:var(--muted)">${c.phone||'—'}</div>
          </div>
          <span class="tag ${segc(c.segment||'Novo')}">${c.pedidos} pedidos</span>
        </div>`).join('');
      })()}
    </div>
  </div>
</div>`:''}

<!-- TAB: METAS -->
${tab==='metas'?`
<div class="card" style="margin-bottom:14px;">
  <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
    <div style="font-family:'Playfair Display',serif;font-size:16px;">🎯 Ranking — ${(S._relMetaPer||'mes')==='dia'?'Hoje':(S._relMetaPer||'mes')==='semana'?'Semana':'Este Mês'}</div>
    <div style="display:flex;gap:5px;">
      ${['dia','semana','mes'].map(p=>`<button class="btn btn-sm ${(S._relMetaPer||'mes')===p?'btn-primary':'btn-ghost'}" data-meta-per="${p}">${p==='dia'?'Hoje':p==='semana'?'Semana':'Mês'}</button>`).join('')}
    </div>
  </div>
</div>
${(()=>{
  const colabs=getColabs().filter(c=>c.active!==false);
  if(!colabs.length) return '<div class="empty card"><p>Nenhum colaborador cadastrado.</p></div>';
  const per=S._relMetaPer||'mes';
  const perLabel=per==='dia'?'hoje':per==='semana'?'semana':'mês';
  const barC=p=>p>=100?'var(--leaf)':p>=60?'#F59E0B':'var(--red)';
  const rows=colabs.map(c=>{
    const mt=c.metas||{};
    const saved={mP:mt.montagemPer,eP:mt.expedicaoPer};
    if(mt.montagemQtd) mt.montagemPer=per;
    if(mt.expedicaoQtd) mt.expedicaoPer=per;
    const st=getColabStats(c);
    mt.montagemPer=saved.mP; mt.expedicaoPer=saved.eP;
    let pts=0,n=0;
    if(mt.vendaPct&&st.vendas){pts+=100;n++;}
    if(mt.montagemQtd){pts+=Math.min(100,Math.round(st.montagens/(mt.montagemQtd||1)*100));n++;}
    if(mt.expedicaoQtd){pts+=Math.min(100,Math.round(st.expedicoes/(mt.expedicaoQtd||1)*100));n++;}
    return{c,mt,st,score:n?Math.round(pts/n):0};
  }).sort((a,b)=>b.score-a.score);
  const medals=['🥇','🥈','🥉'];
  return '<div style="display:grid;gap:10px;">'+rows.map(({c,mt,st,score},i)=>`
<div style="background:#fff;border-radius:var(--rl);border:1px solid var(--border);padding:14px;box-shadow:var(--shadow);">
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
    <span style="font-size:22px">${medals[i]||'👤'}</span>
    <div class="av" style="width:36px;height:36px;font-size:13px;">${ini(c.name)}</div>
    <div style="flex:1"><div style="font-weight:700;font-size:13px">${c.name}</div>
      <span class="tag ${rolec(c.cargo)}" style="font-size:10px">${c.cargo||'—'}</span></div>
    <div style="text-align:center;">
      <div style="font-size:22px;font-weight:800;color:${barC(score)}">${score}%</div>
      <div style="font-size:10px;color:var(--muted)">desempenho</div>
    </div>
  </div>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;">
    ${mt.vendaPct?`<div style="background:var(--cream);border-radius:8px;padding:8px;text-align:center;">
      <div style="font-size:10px;color:var(--muted)">💰 Comissão</div>
      <div style="font-weight:700;color:var(--leaf);font-size:15px">R$ ${st.comissao.toFixed(2)}</div>
      <div style="font-size:10px;color:var(--muted)">${st.vendas} vendas · ${mt.vendaPct}%</div></div>`:''}
    ${mt.montagemQtd?`<div style="background:var(--cream);border-radius:8px;padding:8px;">
      <div style="font-size:10px;color:var(--muted);margin-bottom:4px">🌸 Montagem/${perLabel}</div>
      ${metaBar(st.montagens,mt.montagemQtd,'')}
      <div style="font-size:10px;color:var(--muted);margin-top:2px;text-align:center">${st.montagens}/${mt.montagemQtd}</div></div>`:''}
    ${mt.expedicaoQtd?`<div style="background:var(--cream);border-radius:8px;padding:8px;">
      <div style="font-size:10px;color:var(--muted);margin-bottom:4px">📦 Expedição/${perLabel}</div>
      ${metaBar(st.expedicoes,mt.expedicaoQtd,'')}
      <div style="font-size:10px;color:var(--muted);margin-top:2px;text-align:center">${st.expedicoes}/${mt.expedicaoQtd}</div></div>`:''}
    ${!mt.vendaPct&&!mt.montagemQtd&&!mt.expedicaoQtd?`<div style="color:var(--muted);font-size:11px;padding:8px;">Sem metas — edite o colaborador.</div>`:''}
  </div>
</div>`).join('')+'</div>';
})()}
`:''}

${tab==='operacao'?renderTabOperacao(period, periodLabel):''}

${tab==='altademanda'?renderTabAltaDemanda():''}

${tab==='porColaborador'?renderPorColaborador(base, period, periodLabel):''}

${tab==='chaoDatas'?renderChaoDatas(base):''}

${tab==='custom'?renderCustomReports():''}

`;
}

// ── RELATORIO POR COLABORADOR ────────────────────────────────
function renderPorColaborador(orders, period, periodLabel) {
  const colabId  = S._relColabId  || '';
  const setor    = S._relSetor    || 'todos';
  const ordenar  = S._relOrdenar  || 'data';

  const colabs = (S.colaboradores || []).filter(c => c.active !== false && c.cargo !== 'Entregador');
  const colab  = colabs.find(c => String(c._id) === String(colabId));

  // Filtra pedidos atribuidos ao colab por setor
  let pedidos = [];
  if (colabId) {
    const matchVendedor = (o) => String(o.vendedorId||o.createdByColabId||o.criadoPor||'') === String(colabId);
    const matchMontador = (o) => String(o.montadorId||'') === String(colabId);
    const matchExpedidor = (o) => String(o.expedidorId||'') === String(colabId);
    pedidos = orders.filter(o => {
      if (setor === 'vendas') return matchVendedor(o);
      if (setor === 'montagem') return matchMontador(o);
      if (setor === 'expedicao') return matchExpedidor(o);
      return matchVendedor(o) || matchMontador(o) || matchExpedidor(o);
    });
  }

  // Ordenacao
  const sortFn = {
    data:  (a,b) => new Date(b.createdAt) - new Date(a.createdAt),
    valor: (a,b) => (Number(b.total)||0) - (Number(a.total)||0),
    qtd:   (a,b) => (b.items||[]).reduce((s,i)=>s+i.qty,0) - (a.items||[]).reduce((s,i)=>s+i.qty,0),
  }[ordenar] || ((a,b) => 0);
  pedidos = [...pedidos].sort(sortFn);

  // Totais
  const totalVendas    = pedidos.reduce((s,o) => s + (Number(o.total)||0), 0);
  const totalProdutos  = pedidos.reduce((s,o) => s + (o.items||[]).reduce((x,i)=>x+(Number(i.qty)||0), 0), 0);

  return `
<div class="card" style="margin-bottom:14px;">
  <div class="card-title">👤 Relatório por Colaborador <span style="font-size:11px;color:var(--muted);font-weight:400;">· ${periodLabel}</span></div>
  <div class="g3" style="gap:10px;align-items:end;">
    <div class="fg"><label class="fl">Colaborador</label>
      <select class="fi" id="rel-colab-id">
        <option value="">— Selecione —</option>
        ${colabs.sort((a,b) => (a.name||'').localeCompare(b.name||'')).map(c => `<option value="${c._id}" ${colabId===c._id?'selected':''}>${c.name} (${c.cargo})</option>`).join('')}
      </select>
    </div>
    <div class="fg"><label class="fl">Setor</label>
      <select class="fi" id="rel-setor">
        <option value="todos" ${setor==='todos'?'selected':''}>Todos</option>
        <option value="vendas" ${setor==='vendas'?'selected':''}>💰 Vendas</option>
        <option value="montagem" ${setor==='montagem'?'selected':''}>🌸 Montagem</option>
        <option value="expedicao" ${setor==='expedicao'?'selected':''}>📦 Expedição</option>
      </select>
    </div>
    <div class="fg"><label class="fl">Ordenar por</label>
      <select class="fi" id="rel-ordenar">
        <option value="data" ${ordenar==='data'?'selected':''}>Data (mais recente)</option>
        <option value="valor" ${ordenar==='valor'?'selected':''}>Valor (maior)</option>
        <option value="qtd" ${ordenar==='qtd'?'selected':''}>Quantidade (maior)</option>
      </select>
    </div>
    <button class="btn btn-primary" id="btn-export-por-colab" ${!colabId?'disabled':''}>📤 Exportar CSV</button>
  </div>
</div>

${!colabId ? `
<div class="card" style="text-align:center;padding:40px;color:var(--muted);">
  <div style="font-size:48px;margin-bottom:12px;">👤</div>
  <h3>Selecione um colaborador</h3>
  <p style="font-size:13px;margin-top:6px;">Escolha quem você quer analisar acima.</p>
</div>
` : pedidos.length === 0 ? `
<div class="card" style="text-align:center;padding:40px;color:var(--muted);">
  <div style="font-size:48px;margin-bottom:12px;">📭</div>
  <p>${colab?.name || 'Colaborador'} não tem registros em ${setor==='todos'?'nenhum setor':setor} no período.</p>
</div>
` : `
<div class="card" style="margin-bottom:10px;background:linear-gradient(135deg,#FAE8E6,#FAF7F5);">
  <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;">
    <div>
      <div style="font-size:11px;color:var(--muted);text-transform:uppercase;">Colaborador</div>
      <div style="font-size:18px;font-weight:700;color:#9F1239;">${colab?.name || '—'}</div>
      <div style="font-size:11px;color:var(--muted);">${colab?.cargo || ''}</div>
    </div>
    <div style="text-align:center;">
      <div style="font-size:11px;color:var(--muted);text-transform:uppercase;">Pedidos</div>
      <div style="font-size:24px;font-weight:900;">${pedidos.length}</div>
    </div>
    <div style="text-align:center;">
      <div style="font-size:11px;color:var(--muted);text-transform:uppercase;">Total Vendas</div>
      <div style="font-size:20px;font-weight:900;color:#15803D;">${$c(totalVendas)}</div>
    </div>
    <div style="text-align:center;">
      <div style="font-size:11px;color:var(--muted);text-transform:uppercase;">Produtos</div>
      <div style="font-size:24px;font-weight:900;">${totalProdutos}</div>
    </div>
  </div>
</div>

<div class="card" style="overflow-x:auto;">
  <table style="width:100%;border-collapse:collapse;font-size:12px;">
    <thead><tr style="background:#FAFAFA;border-bottom:1px solid var(--border);">
      <th style="padding:10px;text-align:left;font-size:10px;color:#94A3B8;text-transform:uppercase;">Pedido</th>
      <th style="padding:10px;text-align:left;font-size:10px;color:#94A3B8;text-transform:uppercase;">Cliente</th>
      <th style="padding:10px;text-align:left;font-size:10px;color:#94A3B8;text-transform:uppercase;">Produtos</th>
      <th style="padding:10px;text-align:right;font-size:10px;color:#94A3B8;text-transform:uppercase;">Valor</th>
      <th style="padding:10px;text-align:center;font-size:10px;color:#94A3B8;text-transform:uppercase;">Data Venda</th>
      <th style="padding:10px;text-align:center;font-size:10px;color:#94A3B8;text-transform:uppercase;">Data Expedição</th>
      <th style="padding:10px;text-align:center;font-size:10px;color:#94A3B8;text-transform:uppercase;">Setor</th>
    </tr></thead>
    <tbody>
      ${pedidos.map(o => {
        const setores = [];
        if (String(o.vendedorId||o.createdByColabId||'') === String(colabId)) setores.push('💰');
        if (String(o.montadorId||'') === String(colabId)) setores.push('🌸');
        if (String(o.expedidorId||'') === String(colabId)) setores.push('📦');
        const dataVenda = o.createdAt ? new Date(o.createdAt).toLocaleDateString('pt-BR') : '—';
        const dataExp   = o.expedidoEm ? new Date(o.expedidoEm).toLocaleDateString('pt-BR') : '—';
        return `<tr style="border-bottom:1px solid #F1F5F9;">
          <td style="padding:8px 10px;font-weight:700;color:#7C3AED;">#${o.orderNumber||'—'}</td>
          <td style="padding:8px 10px;">${o.clientName||o.client?.name||'—'}</td>
          <td style="padding:8px 10px;font-size:11px;">${(o.items||[]).map(i => `<div>${i.qty}× ${i.name||'?'} <span style="color:var(--muted);">(${i.code||i.product||'—'})</span> · ${$c(i.unitPrice)} = ${$c(i.totalPrice||i.unitPrice*i.qty)}</div>`).join('')}</td>
          <td style="padding:8px 10px;text-align:right;font-weight:700;">${$c(o.total)}</td>
          <td style="padding:8px 10px;text-align:center;font-size:11px;">${dataVenda}</td>
          <td style="padding:8px 10px;text-align:center;font-size:11px;">${dataExp}</td>
          <td style="padding:8px 10px;text-align:center;font-size:14px;">${setores.join(' ')}</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>
</div>
`}
`;
}

// ── RELATORIO CHAO DE DATAS COMEMORATIVAS ────────────────────
// 3 sub-abas independentes:
//  A. 🌸 Produtos a Montar  — date range + lista alfabética c/ qtd
//  B. 📍 Bairro/Zona        — date range + agrupa por TURNO → ZONA → BAIRRO
//  C. 🖨️ Comandas p/ Imprimir — date range + organização (zona/bairro/turno) + batch print
function renderChaoDatas(orders) {
  const sub = S._chaoSub || 'produtos'; // produtos | zonas | comandas
  const d1  = S._chaoD1 || '';
  const d2  = S._chaoD2 || '';

  // Filtro comum: range de data de entrega (aceita d1==d2 para 1 dia)
  let pedidos = orders;
  if (d1 || d2) {
    pedidos = pedidos.filter(o => {
      const d = String(o.scheduledDate||'').slice(0,10);
      if (!d) return false;
      if (d1 && d < d1) return false;
      if (d2 && d > d2) return false;
      return true;
    });
  }

  const subBtn = (k, label) => `<button type="button" class="tab ${sub===k?'active':''}" data-chao-sub="${k}" style="font-size:12px;">${label}</button>`;

  // Header comum (filtros de data + abas)
  const header = `
<div class="card" style="margin-bottom:14px;">
  <div class="card-title">🌹 Chão de Datas Comemorativas <span style="font-size:11px;color:var(--muted);font-weight:400;">· Produção e logística</span></div>
  <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin-bottom:10px;">
    <div class="fg"><label class="fl">Data de entrega — inicial</label>
      <input type="date" class="fi" id="chao-d1" value="${d1}"/></div>
    <div class="fg"><label class="fl">Data de entrega — final</label>
      <input type="date" class="fi" id="chao-d2" value="${d2}"/></div>
    <button class="btn btn-ghost btn-sm" id="chao-clear-dates">✕ Limpar datas</button>
    <div style="margin-left:auto;font-size:11px;color:var(--muted);">${pedidos.length} pedido(s) no período</div>
  </div>
  <div class="tabs" style="gap:4px;border-top:1px solid var(--border);padding-top:10px;">
    ${subBtn('produtos', '🌸 Produtos a Montar')}
    ${subBtn('zonas',    '📍 Bairro / Zona de Entrega')}
    ${subBtn('comandas', '🖨️ Comandas para Imprimir')}
  </div>
</div>`;

  if (sub === 'produtos') return header + renderChaoProdutos(pedidos);
  if (sub === 'zonas')    return header + renderChaoZonas(pedidos);
  if (sub === 'comandas') return header + renderChaoComandas(pedidos);
  return header;
}

// ─── A) PRODUTOS A MONTAR ───────────────────────────────────
function renderChaoProdutos(pedidos) {
  const ordem = S._chaoProdOrdem || 'alfa'; // alfa | qtd
  // Agrega produtos + lista de pedidos onde aparecem
  const map = {};
  for (const o of pedidos) {
    const num = (o.orderNumber||o.numero||'').toString().replace(/^PED-?/i,'');
    for (const it of (o.items || [])) {
      const key = String(it.code || it.product || it.name || '?');
      if (!map[key]) map[key] = { code: it.code || it.product || '—', name: it.name || '?', qty: 0, pedidos: [] };
      const q = Number(it.qty) || 0;
      map[key].qty += q;
      if (num) map[key].pedidos.push({ num, qty: q });
    }
  }
  let produtos = Object.values(map);
  if (ordem === 'qtd') produtos.sort((a,b) => b.qty - a.qty || a.name.localeCompare(b.name));
  else                 produtos.sort((a,b) => a.name.localeCompare(b.name, 'pt-BR'));

  const totalQtd  = produtos.reduce((s,p) => s+p.qty, 0);
  const totalProd = produtos.length;

  return `
<div class="card" style="margin-bottom:10px;background:linear-gradient(135deg,#FAE8E6,#FAF7F5);">
  <div style="display:flex;justify-content:space-around;flex-wrap:wrap;gap:10px;align-items:center;">
    <div style="text-align:center;">
      <div style="font-size:11px;color:var(--muted);text-transform:uppercase;">Produtos diferentes</div>
      <div style="font-size:24px;font-weight:900;color:#9F1239;">${totalProd}</div>
    </div>
    <div style="text-align:center;">
      <div style="font-size:11px;color:var(--muted);text-transform:uppercase;">Total de unidades a montar</div>
      <div style="font-size:24px;font-weight:900;color:#15803D;">${totalQtd}</div>
    </div>
    <div style="display:flex;gap:6px;align-items:center;">
      <span style="font-size:11px;color:var(--muted);">Ordenar:</span>
      <select class="fi" id="chao-prod-ordem" style="width:auto;font-size:12px;">
        <option value="alfa" ${ordem==='alfa'?'selected':''}>A → Z (alfabética)</option>
        <option value="qtd"  ${ordem==='qtd' ?'selected':''}>Quantidade (maior)</option>
      </select>
      <button class="btn btn-primary btn-sm" id="btn-export-chao-prod">📤 CSV</button>
      <button class="btn btn-ghost btn-sm" id="btn-print-chao-prod">🖨️ Imprimir lista</button>
    </div>
  </div>
</div>

${produtos.length === 0 ? `
<div class="card" style="text-align:center;padding:40px;color:var(--muted);">
  <div style="font-size:48px;margin-bottom:12px;">📭</div>
  <p>Nenhum produto no período selecionado.</p>
</div>
` : `
<div class="card" style="overflow-x:auto;">
  <table style="width:100%;border-collapse:collapse;font-size:13px;">
    <thead><tr style="background:#FAFAFA;border-bottom:1px solid var(--border);">
      <th style="padding:12px;text-align:left;font-size:10px;color:#94A3B8;text-transform:uppercase;width:50px;">#</th>
      <th style="padding:12px;text-align:left;font-size:10px;color:#94A3B8;text-transform:uppercase;width:110px;">Cód. Produto</th>
      <th style="padding:12px;text-align:left;font-size:10px;color:#94A3B8;text-transform:uppercase;">Produto</th>
      <th style="padding:12px;text-align:center;font-size:10px;color:#94A3B8;text-transform:uppercase;width:130px;">Qtd a Montar</th>
      <th style="padding:12px;text-align:left;font-size:10px;color:#94A3B8;text-transform:uppercase;">Cód. Pedido(s)</th>
    </tr></thead>
    <tbody>
      ${produtos.map((p, i) => {
        // Agrupa pedidos repetidos somando quantidades
        const pedAgg = {};
        (p.pedidos||[]).forEach(pp => {
          if (!pedAgg[pp.num]) pedAgg[pp.num] = 0;
          pedAgg[pp.num] += pp.qty;
        });
        const pedHTML = Object.entries(pedAgg)
          .sort((a,b) => a[0].localeCompare(b[0]))
          .map(([num, q]) => `<span style="display:inline-block;background:#FAE8E6;color:#9F1239;border:1px solid #FECDD3;border-radius:6px;padding:2px 7px;font-size:10px;font-weight:700;font-family:Monaco,monospace;margin:1px 2px;">#${num}${q>1?`<span style="color:#15803D;margin-left:4px;">×${q}</span>`:''}</span>`)
          .join('');
        return `
        <tr style="border-bottom:1px solid #F1F5F9;">
          <td style="padding:10px 12px;color:var(--muted);font-size:11px;vertical-align:top;">${i+1}</td>
          <td style="padding:10px 12px;font-family:Monaco,monospace;color:#7C3AED;font-weight:700;vertical-align:top;">${p.code}</td>
          <td style="padding:10px 12px;font-weight:600;vertical-align:top;">${p.name}</td>
          <td style="padding:10px 12px;text-align:center;vertical-align:top;"><span style="display:inline-block;background:#15803D;color:#fff;padding:6px 18px;border-radius:999px;font-weight:900;font-size:15px;min-width:60px;">${p.qty}</span></td>
          <td style="padding:10px 12px;vertical-align:top;">${pedHTML || '<span style="color:var(--muted);">—</span>'}</td>
        </tr>
      `;
      }).join('')}
    </tbody>
  </table>
</div>
<div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:10px;padding:12px;margin-top:10px;font-size:12px;color:#1E40AF;">
  💡 Lista pronta para a equipe de montagem: cada linha indica quantos produtos preparar no período.
</div>
`}`;
}

// ─── B) BAIRRO / ZONA DE ENTREGA ────────────────────────────
function renderChaoZonas(pedidos) {
  // Agrupa: TURNO → ZONA → BAIRRO → pedidos
  const turnosOrdem = ['manha','tarde','noite','sem'];
  const buckets = {};
  for (const t of turnosOrdem) buckets[t] = {};

  for (const o of pedidos) {
    const t = getTurnoPedido(o);
    const z = resolveZona(o);
    const b = (o.deliveryNeighborhood || o.deliveryZone || 'Sem bairro').trim() || 'Sem bairro';
    if (!buckets[t][z]) buckets[t][z] = {};
    if (!buckets[t][z][b]) buckets[t][z][b] = [];
    buckets[t][z][b].push(o);
  }

  const totalP = pedidos.length;

  let html = `
<div class="card" style="margin-bottom:10px;background:linear-gradient(135deg,#FAE8E6,#FAF7F5);">
  <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
    <div>
      <div style="font-size:11px;color:var(--muted);text-transform:uppercase;">Total de entregas</div>
      <div style="font-size:24px;font-weight:900;color:#9F1239;">${totalP}</div>
    </div>
    <div style="font-size:12px;color:var(--muted);max-width:380px;text-align:right;">
      Pedidos organizados por <strong>turno → zona → bairro</strong> para facilitar o roteiro do entregador.
    </div>
    <button class="btn btn-primary btn-sm" id="btn-export-chao-zonas">📤 CSV</button>
  </div>
</div>`;

  if (totalP === 0) {
    html += `<div class="card" style="text-align:center;padding:40px;color:var(--muted);">
      <div style="font-size:48px;margin-bottom:12px;">📭</div>
      <p>Nenhuma entrega no período selecionado.</p>
    </div>`;
    return html;
  }

  for (const t of turnosOrdem) {
    const zonas = buckets[t];
    const zonasKeys = Object.keys(zonas);
    if (!zonasKeys.length) continue;
    const meta = TURNOS[t];
    const totalTurno = zonasKeys.reduce((s,z) => s + Object.values(zonas[z]).reduce((x,arr)=>x+arr.length,0), 0);

    html += `<div class="card" style="margin-bottom:12px;border-left:6px solid ${meta.color};">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;padding-bottom:8px;border-bottom:2px solid ${meta.color}33;">
        <span style="font-size:18px;font-weight:900;color:${meta.color};">${meta.label}</span>
        <span style="background:${meta.color};color:#fff;border-radius:20px;padding:3px 12px;font-size:12px;font-weight:800;">${totalTurno} entrega${totalTurno>1?'s':''}</span>
      </div>`;

    // Ordena zonas: pelos keys de ZONAS_MANAUS, "Outros" no fim
    const zonasOrd = zonasKeys.sort((a,b) => {
      if (a === 'Outros') return 1;
      if (b === 'Outros') return -1;
      return a.localeCompare(b, 'pt-BR');
    });

    for (const zk of zonasOrd) {
      const zMeta = ZONAS_MANAUS[zk] || { label: zk, color:'#64748B' };
      const bairros = zonas[zk];
      const bairrosOrd = Object.keys(bairros).sort((a,b)=>a.localeCompare(b,'pt-BR'));
      const totalZona = Object.values(bairros).reduce((s,arr)=>s+arr.length,0);

      html += `<div style="margin-bottom:10px;background:${zMeta.color}08;border-radius:8px;padding:10px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          <span style="background:${zMeta.color};color:#fff;border-radius:6px;padding:2px 10px;font-size:11px;font-weight:800;">${zMeta.label}</span>
          <span style="font-size:11px;color:var(--muted);font-weight:700;">${totalZona} entrega(s)</span>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead><tr style="background:#fff;border-bottom:1px solid ${zMeta.color}33;">
            <th style="padding:6px 8px;text-align:left;font-size:10px;color:#64748B;text-transform:uppercase;">Bairro</th>
            <th style="padding:6px 8px;text-align:left;font-size:10px;color:#64748B;text-transform:uppercase;">Pedido</th>
            <th style="padding:6px 8px;text-align:left;font-size:10px;color:#64748B;text-transform:uppercase;">Produto(s)</th>
            <th style="padding:6px 8px;text-align:center;font-size:10px;color:#64748B;text-transform:uppercase;">Hora</th>
          </tr></thead>
          <tbody>`;

      for (const bn of bairrosOrd) {
        const lista = bairros[bn].sort((a,b) => String(a.scheduledTime||'99').localeCompare(String(b.scheduledTime||'99')));
        const totalBairro = lista.length;
        lista.forEach((o, idx) => {
          const num = (o.orderNumber||o.numero||'').toString().replace(/^PED-?/i,'');
          const prods = (o.items||[]).map(i => `${i.qty}× ${i.name||'?'}`).join(' · ');
          const hora = (o.scheduledTime && o.scheduledTime!=='00:00') ? o.scheduledTime : (o.scheduledPeriod || '—');
          // Badge de contagem aparece SOMENTE na primeira linha do bairro
          const bairroCell = idx === 0
            ? `<span style="font-weight:700;color:#1E293B;">${bn}</span> <span style="display:inline-block;background:${zMeta.color};color:#fff;border-radius:10px;padding:1px 7px;font-size:10px;font-weight:800;margin-left:4px;">${totalBairro}</span>`
            : '';
          html += `<tr style="border-bottom:1px solid #F1F5F9;background:${idx%2?'rgba(255,255,255,.5)':'transparent'};">
            <td style="padding:6px 8px;">${bairroCell}</td>
            <td style="padding:6px 8px;color:#7C3AED;font-weight:700;font-family:Monaco,monospace;">#${num||'—'}</td>
            <td style="padding:6px 8px;color:#475569;">${prods||'—'}</td>
            <td style="padding:6px 8px;text-align:center;font-weight:700;color:${meta.color};">${hora}</td>
          </tr>`;
        });
      }
      html += `</tbody></table></div>`;
    }
    html += `</div>`;
  }
  return html;
}

// ─── C) COMANDAS PARA IMPRIMIR ──────────────────────────────
function renderChaoComandas(pedidos) {
  const org = S._chaoComandaOrg || 'turno'; // turno | zona | bairro

  // Ordena pedidos conforme organização
  let ordenados = [...pedidos];
  if (org === 'turno') {
    const w = { manha:0, tarde:1, noite:2, sem:3 };
    ordenados.sort((a,b) => {
      const ta = w[getTurnoPedido(a)], tb = w[getTurnoPedido(b)];
      if (ta !== tb) return ta - tb;
      return String(a.scheduledTime||'99').localeCompare(String(b.scheduledTime||'99'));
    });
  } else if (org === 'zona') {
    ordenados.sort((a,b) => {
      const za = resolveZona(a), zb = resolveZona(b);
      if (za !== zb) return za.localeCompare(zb,'pt-BR');
      const ba = (a.deliveryNeighborhood||''), bb = (b.deliveryNeighborhood||'');
      return ba.localeCompare(bb,'pt-BR');
    });
  } else { // bairro
    ordenados.sort((a,b) => {
      const ba = (a.deliveryNeighborhood||a.deliveryZone||'zzz'), bb = (b.deliveryNeighborhood||b.deliveryZone||'zzz');
      return ba.localeCompare(bb,'pt-BR');
    });
  }

  // Agrupa para exibição (header de seção)
  const groupKey = (o) => {
    if (org === 'turno') return TURNOS[getTurnoPedido(o)]?.label || '—';
    if (org === 'zona')  return ZONAS_MANAUS[resolveZona(o)]?.label || '—';
    return o.deliveryNeighborhood || o.deliveryZone || 'Sem bairro';
  };
  const grupos = {};
  for (const o of ordenados) {
    const k = groupKey(o);
    if (!grupos[k]) grupos[k] = [];
    grupos[k].push(o);
  }

  return `
<div class="card" style="margin-bottom:10px;background:linear-gradient(135deg,#FAE8E6,#FAF7F5);">
  <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
    <div>
      <div style="font-size:11px;color:var(--muted);text-transform:uppercase;">Comandas no período</div>
      <div style="font-size:24px;font-weight:900;color:#9F1239;">${ordenados.length}</div>
    </div>
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
      <span style="font-size:11px;color:var(--muted);font-weight:700;">Organizar por:</span>
      <select class="fi" id="chao-comanda-org" style="width:auto;font-size:12px;">
        <option value="turno"  ${org==='turno' ?'selected':''}>⏰ Turno</option>
        <option value="zona"   ${org==='zona'  ?'selected':''}>🗺️ Zona</option>
        <option value="bairro" ${org==='bairro'?'selected':''}>📍 Bairro</option>
      </select>
      <button class="btn btn-primary btn-sm" id="btn-print-chao-comandas" ${ordenados.length===0?'disabled':''}>🖨️ Imprimir TODAS na ordem</button>
    </div>
  </div>
</div>

${ordenados.length === 0 ? `
<div class="card" style="text-align:center;padding:40px;color:var(--muted);">
  <div style="font-size:48px;margin-bottom:12px;">📭</div>
  <p>Nenhum pedido no período selecionado.</p>
</div>
` : `
<div class="card">
  ${Object.entries(grupos).map(([gk, lista]) => `
    <div style="margin-bottom:14px;">
      <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:#FAFAFA;border-radius:8px;margin-bottom:6px;border-left:4px solid var(--rose);">
        <span style="font-weight:800;color:var(--ink);font-size:13px;">${gk}</span>
        <span style="background:var(--rose);color:#fff;border-radius:20px;padding:2px 10px;font-size:11px;font-weight:700;">${lista.length} entrega(s)</span>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead><tr style="background:#fff;border-bottom:1px solid var(--border);">
          <th style="padding:6px 8px;text-align:left;font-size:10px;color:#64748B;text-transform:uppercase;width:90px;">Pedido</th>
          <th style="padding:6px 8px;text-align:left;font-size:10px;color:#64748B;text-transform:uppercase;">Cliente / Destinatário</th>
          <th style="padding:6px 8px;text-align:left;font-size:10px;color:#64748B;text-transform:uppercase;">Bairro</th>
          <th style="padding:6px 8px;text-align:center;font-size:10px;color:#64748B;text-transform:uppercase;width:90px;">Hora</th>
          <th style="padding:6px 8px;text-align:center;font-size:10px;color:#64748B;text-transform:uppercase;width:100px;">Imprimir</th>
        </tr></thead>
        <tbody>
          ${lista.map(o => {
            const num = (o.orderNumber||o.numero||'').toString().replace(/^PED-?/i,'');
            const cli = o.clientName || o.client?.name || '—';
            const dst = o.recipient && o.recipient !== cli ? ` → ${o.recipient}` : '';
            const bairro = o.deliveryNeighborhood || o.deliveryZone || '—';
            const hora = (o.scheduledTime && o.scheduledTime!=='00:00') ? o.scheduledTime : (o.scheduledPeriod || '—');
            return `<tr style="border-bottom:1px solid #F1F5F9;">
              <td style="padding:6px 8px;color:#7C3AED;font-weight:700;font-family:Monaco,monospace;">#${num||'—'}</td>
              <td style="padding:6px 8px;font-weight:600;">${cli}<span style="color:#059669;font-weight:500;font-size:11px;">${dst}</span></td>
              <td style="padding:6px 8px;color:#475569;">${bairro}</td>
              <td style="padding:6px 8px;text-align:center;font-weight:700;color:#1E40AF;">${hora}</td>
              <td style="padding:6px 8px;text-align:center;">
                <button class="btn btn-ghost btn-xs" data-chao-print="${o._id}" title="Imprimir esta comanda">🖨️</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `).join('')}
</div>

<div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:10px;padding:12px;margin-top:10px;font-size:12px;color:#1E40AF;">
  💡 Use <strong>🖨️ Imprimir TODAS na ordem</strong> para enviar todas as comandas para a impressora seguindo a organização escolhida (turno / zona / bairro).
</div>
`}`;
}

// ── TAB ALTA DEMANDA: Relatorio para datas especiais ──────────
// Dia das Maes, Namorados, Natal, Dia da Mulher — ou data custom.
// Agrega todos os dados do PDV com filtros por produto, bairro,
// horario e data de entrega.
function renderTabAltaDemanda(){
  // Datas especiais (ano corrente) — ajuste automaticamente para o proximo ano
  // quando a data atual ja passou. Usa fuso Manaus (UTC-4) para determinar "hoje".
  const now = new Date();
  const manausNow = new Date(now.getTime() - (4*60 + now.getTimezoneOffset())*60000);
  const thisYear = manausNow.getFullYear();

  // Dia das Maes BR = 2o domingo de maio
  const maesDate = (y) => {
    const d = new Date(y, 4, 1); // 1 de maio
    // avanca ate primeiro domingo
    while (d.getDay() !== 0) d.setDate(d.getDate()+1);
    d.setDate(d.getDate()+7); // segundo domingo
    return d.toISOString().slice(0,10);
  };
  const presets = [
    { key: 'maes',      label: '💐 Dia das Mães',     emoji: '💐', date: maesDate(thisYear) },
    { key: 'namorados', label: '💕 Dia dos Namorados', emoji: '💕', date: `${thisYear}-06-12` },
    { key: 'mulher',    label: '🌹 Dia da Mulher',    emoji: '🌹', date: `${thisYear}-03-08` },
    { key: 'pais',      label: '🎩 Dia dos Pais',     emoji: '🎩', date: (y=>{
        const d=new Date(y,7,1); while(d.getDay()!==0) d.setDate(d.getDate()+1); d.setDate(d.getDate()+7); return d.toISOString().slice(0,10);
      })(thisYear) },
    { key: 'natal',     label: '🎄 Natal',            emoji: '🎄', date: `${thisYear}-12-24` },
    { key: 'valentines',label: '❤️ Valentines Day',   emoji: '❤️', date: `${thisYear}-02-14` },
    { key: 'finados',   label: '🕯️ Finados',          emoji: '🕯️', date: `${thisYear}-11-02` },
  ];

  const selPreset = S._relAltaPreset ?? 'maes';
  const customDate = S._relAltaDate || '';
  const rangeDays  = parseInt(S._relAltaRange, 10) || 3; // dias antes da data
  const fProd   = (S._relAltaProd  || '').toLowerCase().trim();
  const fBairro = (S._relAltaBairro|| '').toLowerCase().trim();
  const fHora1  = S._relAltaHora1 || '';
  const fHora2  = S._relAltaHora2 || '';
  const fTurno  = S._relAltaTurno  || '';     // manha | tarde | noite
  const fPrio   = S._relAltaPrio   || '';     // antecipado | urgente | ultima
  const fStatus = S._relAltaStatus || '';
  const fSecao  = S._relAltaSecao  || 'resumo'; // resumo | producao | entregas | priorizacao | rota | alertas

  // ── HELPERS de turno/priorizacao/rota ──
  // Turnos oficiais: Manha 07-12, Tarde 12:01-18, Noite 18:01-20
  const getTurno = (hm) => {
    if(!hm || hm==='00:00') return '—';
    const [hh, mm] = hm.split(':').map(Number);
    const mins = hh * 60 + (mm || 0);
    if(mins >= 7*60  && mins <= 12*60) return 'manha';
    if(mins >  12*60 && mins <= 18*60) return 'tarde';
    if(mins >  18*60 && mins <= 20*60) return 'noite';
    return '—';
  };
  const turnoLabel = { manha: '🌅 Manhã', tarde: '🌤️ Tarde', noite: '🌙 Noite', '—': 'Sem horário' };

  // Prioridade a partir do diff criado vs entregar
  const getPrioLevel = (o) => {
    if(!o.createdAt || !o.scheduledDate) return { key:'normal', label:'Normal', days:0 };
    const dd = Math.floor((new Date(o.scheduledDate) - new Date(o.createdAt))/86400000);
    if(dd >= 14) return { key:'antecipado', label:'🎯 Antecipado', days:dd };
    if(dd >= 3)  return { key:'antecipado', label:'📅 Antecipado', days:dd };
    if(dd === 0) return { key:'ultima', label:'⚡ Última hora', days:0 };
    return { key:'urgente', label:'🔥 Urgente', days:dd };
  };

  // Zona geografica (regioes de Manaus) — agrupa bairros para roteirizacao
  const getZona = (bairro) => {
    const b = (bairro||'').toLowerCase().trim();
    if(!b) return 'Sem bairro';
    // Centro-Sul
    if(/centro|cachoeirinha|nossa senhora|praca|praça|14 de janeiro|mauazinho|educand|rio negro|adrianopolis|adrianópolis|petropolis|petrópolis|sao geraldo|são geraldo|chapada|parque 10|aleixo/.test(b))
      return 'Centro-Sul';
    // Zona Leste
    if(/jorge teixeira|armando|aleixo|sao jose|são josé|tancredo|colonia|colônia|zumbi|mauazinho|flores|gilberto mestrinho|distrito/.test(b))
      return 'Leste';
    // Zona Norte
    if(/novo aleixo|santa etelvina|cidade nova|monte das|aeroporto|lirio|lírio|nova cidade/.test(b))
      return 'Norte';
    // Zona Oeste
    if(/compensa|santo antonio|santo antônio|sao jorge|são jorge|da paz|glória|gloria|alvorada|redencao|redenção|coroado|planalto|dom pedro/.test(b))
      return 'Oeste';
    return 'Outros';
  };

  // Determina data alvo
  let targetDate = customDate;
  if (!customDate && selPreset) {
    const p = presets.find(x => x.key === selPreset);
    if (p) targetDate = p.date;
  }

  // Janela: (targetDate - rangeDays) ate targetDate
  const targetD = targetDate ? new Date(targetDate + 'T12:00:00') : null;
  const startD  = targetD ? new Date(targetD.getTime() - rangeDays*86400000) : null;

  const inRange = (iso) => {
    if (!iso || !startD || !targetD) return false;
    const d = new Date(iso);
    const dDay = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
    const sDay = new Date(startD.getFullYear(), startD.getMonth(), startD.getDate(), 0);
    const tDay = new Date(targetD.getFullYear(), targetD.getMonth(), targetD.getDate(), 23, 59);
    return dDay >= sDay && dDay <= tDay;
  };

  // Base: pedidos com scheduledDate dentro da janela
  let altos = S.orders.filter(o => o.scheduledDate && inRange(o.scheduledDate));

  // Filtros
  if (fProd) {
    altos = altos.filter(o =>
      (o.items||[]).some(i => (i.name||'').toLowerCase().includes(fProd))
    );
  }
  if (fBairro) {
    altos = altos.filter(o =>
      ((o.deliveryNeighborhood||o.deliveryZone||'').toLowerCase()).includes(fBairro)
    );
  }
  if (fHora1 || fHora2) {
    altos = altos.filter(o => {
      const h = o.scheduledTime;
      if (!h || h === '00:00') return false;
      if (fHora1 && h < fHora1) return false;
      if (fHora2 && h > fHora2) return false;
      return true;
    });
  }
  if (fTurno) {
    altos = altos.filter(o => getTurno(o.scheduledTime) === fTurno);
  }
  if (fPrio) {
    altos = altos.filter(o => getPrioLevel(o).key === fPrio);
  }
  if (fStatus) {
    altos = altos.filter(o => o.status === fStatus);
  }

  // KPIs
  const totalPedidos  = altos.length;
  const totalFat      = altos.filter(o => o.status !== 'Cancelado').reduce((s,o)=>s+(Number(o.total)||0),0);
  const ticket        = totalPedidos ? totalFat/totalPedidos : 0;
  const entregues     = altos.filter(o => o.status === 'Entregue').length;
  const cancelados    = altos.filter(o => o.status === 'Cancelado').length;
  const pendentes     = altos.filter(o => !['Entregue','Cancelado'].includes(o.status)).length;

  // Agregacoes
  const byProd = {};
  altos.forEach(o => (o.items||[]).forEach(i => {
    const n = i.name || '—';
    if (!byProd[n]) byProd[n] = { qty:0, rev:0 };
    byProd[n].qty += Number(i.qty)||1;
    byProd[n].rev += Number(i.totalPrice) || (Number(i.unitPrice)||0)*(Number(i.qty)||1);
  }));
  const prodList = Object.entries(byProd).sort((a,b)=>b[1].qty-a[1].qty);

  const byBairro = {};
  altos.forEach(o => {
    const b = o.deliveryNeighborhood || o.deliveryZone || '—';
    byBairro[b] = (byBairro[b]||0) + 1;
  });
  const bairroList = Object.entries(byBairro).sort((a,b)=>b[1]-a[1]);

  const byHora = {};
  altos.forEach(o => {
    const h = (o.scheduledTime || '').slice(0,2);
    if (!h || h === '00') return;
    byHora[h+'h'] = (byHora[h+'h']||0) + 1;
  });
  const horaList = Object.entries(byHora).sort((a,b)=>a[0].localeCompare(b[0]));

  const byDia = {};
  altos.forEach(o => {
    const d = (o.scheduledDate||'').slice(0,10);
    byDia[d] = (byDia[d]||0) + 1;
  });
  const diaList = Object.entries(byDia).sort((a,b)=>a[0].localeCompare(b[0]));

  // Lista de bairros disponiveis (para autocomplete)
  const bairros = [...new Set(S.orders.map(o=>(o.deliveryNeighborhood||'').trim()).filter(Boolean))].sort();

  const formatDia = iso => {
    if (!iso) return '—';
    const d = new Date(iso + 'T12:00:00');
    return d.toLocaleDateString('pt-BR',{weekday:'short', day:'2-digit', month:'short'});
  };

  return `
<div class="card" style="margin-bottom:14px;">
  <div class="card-title">💐 Relatório de Alta Demanda</div>
  <p style="font-size:12px;color:var(--muted);margin-bottom:12px;">
    Datas especiais concentram volume enorme em poucos dias. Este relatório organiza todos os pedidos do PDV para planejamento e análise.
  </p>

  <!-- Presets -->
  <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;">
    ${presets.map(p => `
      <button class="btn btn-sm ${selPreset===p.key && !customDate ? 'btn-primary' : 'btn-ghost'}"
        data-rel-alta-preset="${p.key}" style="font-weight:600;">${p.label}</button>
    `).join('')}
  </div>

  <!-- Filtros -->
  <div class="g3" style="gap:10px;margin-bottom:8px;">
    <div class="fg">
      <label class="fl">🗓️ Data alvo (custom)</label>
      <input type="date" class="fi" id="rel-alta-date" value="${customDate || targetDate || ''}"/>
    </div>
    <div class="fg">
      <label class="fl">📅 Dias antes p/ análise</label>
      <select class="fi" id="rel-alta-range">
        ${[1,2,3,5,7,10,14].map(n=>`<option value="${n}" ${rangeDays===n?'selected':''}>${n} dia${n>1?'s':''} antes</option>`).join('')}
      </select>
    </div>
    <div class="fg">
      <label class="fl">🌹 Produto</label>
      <input type="text" class="fi" id="rel-alta-prod" placeholder="Buscar produto..." value="${fProd}"/>
    </div>
  </div>
  <div class="g3" style="gap:10px;margin-bottom:8px;">
    <div class="fg">
      <label class="fl">📍 Bairro</label>
      <input type="text" class="fi" id="rel-alta-bairro" placeholder="Buscar bairro..." value="${fBairro}" list="rel-alta-bairros"/>
      <datalist id="rel-alta-bairros">${bairros.map(b=>`<option value="${b}">`).join('')}</datalist>
    </div>
    <div class="fg">
      <label class="fl">🕐 Horário de</label>
      <input type="time" class="fi" id="rel-alta-hora1" value="${fHora1}"/>
    </div>
    <div class="fg">
      <label class="fl">🕐 Até</label>
      <input type="time" class="fi" id="rel-alta-hora2" value="${fHora2}"/>
    </div>
  </div>
  <div class="g3" style="gap:10px;margin-bottom:12px;">
    <div class="fg">
      <label class="fl">⏰ Turno</label>
      <select class="fi" id="rel-alta-turno">
        <option value="">Todos</option>
        <option value="manha" ${fTurno==='manha'?'selected':''}>🌅 Manhã (07h–12h)</option>
        <option value="tarde" ${fTurno==='tarde'?'selected':''}>🌤️ Tarde (12h–18h)</option>
        <option value="noite" ${fTurno==='noite'?'selected':''}>🌙 Noite (18h–20h)</option>
      </select>
    </div>
    <div class="fg">
      <label class="fl">🎯 Prioridade</label>
      <select class="fi" id="rel-alta-prio">
        <option value="">Todas</option>
        <option value="antecipado" ${fPrio==='antecipado'?'selected':''}>📅 Antecipado (3+ dias antes)</option>
        <option value="urgente"    ${fPrio==='urgente'?'selected':''}>🔥 Urgente (1–2 dias)</option>
        <option value="ultima"     ${fPrio==='ultima'?'selected':''}>⚡ Última hora (mesmo dia)</option>
      </select>
    </div>
    <div class="fg">
      <label class="fl">📊 Status</label>
      <select class="fi" id="rel-alta-status">
        <option value="">Todos</option>
        ${['Aguardando','Em preparo','Pronto','Saiu p/ entrega','Entregue','Cancelado'].map(s=>`<option value="${s}" ${fStatus===s?'selected':''}>${s}</option>`).join('')}
      </select>
    </div>
  </div>

  <div style="display:flex;gap:8px;justify-content:space-between;align-items:center;flex-wrap:wrap;">
    <div style="font-size:12px;color:var(--muted);">
      ${targetDate ? `📌 Janela: <strong>${formatDia(startD?.toISOString().slice(0,10))}</strong> até <strong>${formatDia(targetDate)}</strong>` : 'Escolha uma data'}
    </div>
    <div style="display:flex;gap:6px;">
      <button class="btn btn-ghost btn-sm" id="btn-rel-alta-clear">✕ Limpar filtros</button>
      <button class="btn btn-green btn-sm" id="btn-rel-alta-export">📤 Exportar CSV</button>
      <button class="btn btn-ghost btn-sm" onclick="window.print()">🖨️ Imprimir</button>
    </div>
  </div>
</div>

${!targetDate ? `
<div class="empty card"><div class="empty-icon">💐</div><p>Selecione uma data especial ou escolha uma data custom.</p></div>
` : `

<!-- Stash para export -->
${(()=>{ S._lastAltaDemandaOrders = altos; return ''; })()}

<!-- KPIs -->
<div class="g4" style="margin-bottom:14px;">
  <div class="mc rose"><div class="mc-label">Pedidos no período</div><div class="mc-val">${totalPedidos}</div></div>
  <div class="mc leaf"><div class="mc-label">Faturamento</div><div class="mc-val">${$c(totalFat)}</div></div>
  <div class="mc gold"><div class="mc-label">Ticket Médio</div><div class="mc-val">${$c(ticket)}</div></div>
  <div class="mc purple"><div class="mc-label">Entregues</div><div class="mc-val">${entregues}</div><div class="mc-sub">${pendentes} pendentes · ${cancelados} cancelados</div></div>
</div>

<!-- Abas de secao operacional -->
<div class="tabs" style="margin-bottom:14px;">
  ${['resumo','producao','entregas','priorizacao','rota','alertas'].map(k => {
    const labels = {resumo:'📊 Resumo', producao:'🏭 Produção', entregas:'🚚 Entregas', priorizacao:'🎯 Priorização', rota:'🗺️ Roteirização', alertas:'🚨 Alertas'};
    return `<button class="tab ${fSecao===k?'active':''}" data-rel-alta-secao="${k}">${labels[k]}</button>`;
  }).join('')}
</div>

${fSecao==='resumo' ? `
<!-- ── SECAO: RESUMO ── -->
<div class="g4" style="margin-bottom:14px;">
  <div class="mc leaf"><div class="mc-label">🌅 Manhã</div><div class="mc-val">${altos.filter(o=>getTurno(o.scheduledTime)==='manha').length}</div></div>
  <div class="mc gold"><div class="mc-label">🌤️ Tarde</div><div class="mc-val">${altos.filter(o=>getTurno(o.scheduledTime)==='tarde').length}</div></div>
  <div class="mc purple"><div class="mc-label">🌙 Noite</div><div class="mc-val">${altos.filter(o=>getTurno(o.scheduledTime)==='noite').length}</div></div>
  <div class="mc rose"><div class="mc-label">🌹 Itens a produzir</div><div class="mc-val">${(()=>{let t=0;altos.forEach(o=>(o.items||[]).forEach(i=>t+=Number(i.qty)||1));return t;})()}</div></div>
</div>

<div class="g2">
  <!-- Produtos -->
  <div class="card">
    <div class="card-title">🌹 Produtos Mais Vendidos <span class="notif">${prodList.length}</span></div>
    ${prodList.length===0 ? `<div class="empty"><p>Sem produtos no filtro.</p></div>` : `
    <div style="max-height:360px;overflow-y:auto;">
      <table style="width:100%;font-size:12px;">
        <thead><tr style="text-align:left;border-bottom:1px solid var(--border);">
          <th style="padding:6px 4px;">#</th><th>Produto</th><th style="text-align:right;">Qtde</th><th style="text-align:right;">Receita</th>
        </tr></thead>
        <tbody>
        ${prodList.map(([n, {qty, rev}], i) => `
          <tr style="border-bottom:1px solid var(--border);">
            <td style="padding:6px 4px;color:var(--rose);font-weight:700;">#${i+1}</td>
            <td>${n}</td>
            <td style="text-align:right;font-weight:600;">${qty}</td>
            <td style="text-align:right;color:var(--leaf);font-weight:700;">${$c(rev)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`}
  </div>

  <!-- Por horario -->
  <div class="card">
    <div class="card-title">🕐 Distribuição por Horário</div>
    ${horaList.length===0 ? `<div class="empty"><p>Sem horários específicos.</p></div>` : `
    <div style="padding:4px 0;">
      ${(()=>{
        const maxH = Math.max(...horaList.map(([,v])=>v), 1);
        return horaList.map(([h, v]) => `
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:12px;">
            <div style="width:44px;font-weight:700;">${h}</div>
            <div class="pb" style="flex:1;"><div class="pf" style="width:${(v/maxH)*100}%;background:var(--rose);"></div></div>
            <div style="width:38px;text-align:right;font-weight:600;">${v}</div>
          </div>`).join('');
      })()}
    </div>`}
  </div>
</div>

<div class="g2" style="margin-top:14px;">
  <!-- Por bairro -->
  <div class="card">
    <div class="card-title">📍 Pedidos por Bairro <span class="notif">${bairroList.length}</span></div>
    ${bairroList.length===0 ? `<div class="empty"><p>Sem bairros.</p></div>` : `
    <div style="max-height:300px;overflow-y:auto;padding:4px 0;">
      ${(()=>{
        const maxB = bairroList[0]?.[1] || 1;
        return bairroList.slice(0,20).map(([b, v]) => `
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;font-size:12px;">
            <div style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${b}</div>
            <div class="pb" style="width:100px;"><div class="pf" style="width:${(v/maxB)*100}%;background:var(--leaf);"></div></div>
            <div style="width:34px;text-align:right;font-weight:700;">${v}</div>
          </div>`).join('');
      })()}
    </div>`}
  </div>

  <!-- Por dia -->
  <div class="card">
    <div class="card-title">📅 Pedidos por Data de Entrega</div>
    ${diaList.length===0 ? `<div class="empty"><p>Sem dados.</p></div>` : `
    <div style="padding:4px 0;">
      ${(()=>{
        const maxD = Math.max(...diaList.map(([,v])=>v), 1);
        return diaList.map(([d, v]) => {
          const isTarget = d === targetDate;
          return `
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:12px;${isTarget?'font-weight:800;color:var(--rose);':''}">
            <div style="width:110px;">${formatDia(d)}${isTarget?' 🎯':''}</div>
            <div class="pb" style="flex:1;"><div class="pf" style="width:${(v/maxD)*100}%;background:${isTarget?'var(--rose)':'var(--gold)'};"></div></div>
            <div style="width:38px;text-align:right;font-weight:700;">${v}</div>
          </div>`;
        }).join('');
      })()}
    </div>`}
  </div>
</div>

<!-- TODOS OS PEDIDOS (lista completa) -->
<div class="card" style="margin-top:14px;">
  <div class="card-title">📋 Pedidos no período <span class="notif">${altos.length}</span></div>
  ${altos.length===0 ? `<div class="empty"><div class="empty-icon">📋</div><p>Nenhum pedido nos filtros aplicados.</p></div>` : `
  <div style="overflow-x:auto;">
    <table>
      <thead><tr>
        <th>#</th><th>Cliente</th><th>Destinatário</th><th>Produto</th>
        <th>Bairro</th><th>Entrega</th><th>Horário</th><th>Total</th>
        <th>Canal</th><th>Status</th>
      </tr></thead>
      <tbody>
        ${altos.sort((a,b)=>(a.scheduledDate||'').localeCompare(b.scheduledDate||'') || (a.scheduledTime||'').localeCompare(b.scheduledTime||'')).map(o => {
          const prod = (o.items||[]).map(i=>i.name).filter(Boolean).slice(0,2).join(', ') || '—';
          const canal = o.source || 'PDV';
          return `<tr>
            <td style="color:var(--rose);font-weight:700;white-space:nowrap;">#${o.orderNumber||'—'}</td>
            <td>${o.client?.name || o.clientName || '—'}</td>
            <td style="font-size:11px;">${o.recipient || '—'}</td>
            <td style="font-size:11px;max-width:200px;">${prod}</td>
            <td style="font-size:11px;">${o.deliveryNeighborhood||o.deliveryZone||'—'}</td>
            <td style="font-size:11px;">${formatDia(o.scheduledDate)}</td>
            <td style="font-size:11px;font-weight:700;">${o.scheduledTime||'—'}${o.scheduledTimeEnd?'–'+o.scheduledTimeEnd:''}</td>
            <td style="font-weight:700;color:var(--leaf);">${$c(o.total||0)}</td>
            <td style="font-size:10px;">${canal}</td>
            <td><span class="tag ${sc(o.status)}" style="font-size:10px;">${o.status}</span></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>`}
</div>
` : ''}

${fSecao==='producao' ? `
<!-- ── SECAO: PRODUCAO ── -->
${(()=>{
  // Agrupa por produto (ordem alfabetica) com qtd total e pedidos vinculados
  const prodMap = {};
  altos.filter(o => !['Cancelado'].includes(o.status)).forEach(o => {
    (o.items||[]).forEach(i => {
      const n = i.name || '—';
      if(!prodMap[n]) prodMap[n] = { qty:0, pedidos:new Set(), itens:[] };
      prodMap[n].qty += Number(i.qty)||1;
      prodMap[n].pedidos.add(o.orderNumber||o._id);
      prodMap[n].itens.push({ orderNumber:o.orderNumber, qty:Number(i.qty)||1, obs:i.observacao||i.obs||'' });
    });
  });
  const prodEntries = Object.entries(prodMap).sort((a,b) => a[0].localeCompare(b[0],'pt-BR'));
  const totalItens = prodEntries.reduce((s,[,v])=>s+v.qty, 0);
  const repetidos  = prodEntries.filter(([,v]) => v.qty >= 3).length;

  // Lotes sugeridos: agrupar pedidos por data+turno
  const lotes = {};
  altos.filter(o => !['Cancelado','Entregue'].includes(o.status)).forEach(o => {
    const d = (o.scheduledDate||'').slice(0,10);
    const t = getTurno(o.scheduledTime);
    const key = `${d}__${t}`;
    if(!lotes[key]) lotes[key] = { date:d, turno:t, pedidos:[], itens:0 };
    lotes[key].pedidos.push(o);
    lotes[key].itens += (o.items||[]).reduce((s,i)=>s+(Number(i.qty)||1),0);
  });
  const lotesList = Object.values(lotes).sort((a,b)=>
    (a.date||'').localeCompare(b.date||'') ||
    ['manha','tarde','noite','—'].indexOf(a.turno) - ['manha','tarde','noite','—'].indexOf(b.turno)
  );

  return `
  <div class="g4" style="margin-bottom:14px;">
    <div class="mc rose"><div class="mc-label">Produtos distintos</div><div class="mc-val">${prodEntries.length}</div></div>
    <div class="mc leaf"><div class="mc-label">Total de itens</div><div class="mc-val">${totalItens}</div></div>
    <div class="mc gold"><div class="mc-label">Itens repetidos (3+)</div><div class="mc-val">${repetidos}</div></div>
    <div class="mc purple"><div class="mc-label">Lotes sugeridos</div><div class="mc-val">${lotesList.length}</div></div>
  </div>

  <div class="card" style="margin-bottom:14px;">
    <div class="card-title">🌹 Produtos a Produzir <span class="notif">${prodEntries.length}</span>
      <span style="font-size:11px;font-weight:400;color:var(--muted);margin-left:6px;">Ordem alfabética · Destaque para repetidos</span>
    </div>
    ${prodEntries.length===0 ? `<div class="empty"><p>Sem itens para produção.</p></div>` : `
    <table style="width:100%;font-size:12px;">
      <thead><tr style="text-align:left;border-bottom:2px solid var(--border);">
        <th style="padding:8px 6px;">Produto</th>
        <th style="text-align:center;">Qtde total</th>
        <th style="text-align:center;">Pedidos</th>
        <th>Quebra por pedido</th>
      </tr></thead>
      <tbody>
        ${prodEntries.map(([n, v]) => {
          const isRepeat = v.qty >= 3;
          const bg = isRepeat ? 'background:#FFFBEB;' : '';
          return `<tr style="border-bottom:1px solid var(--border);${bg}">
            <td style="padding:8px 6px;font-weight:600;">
              ${isRepeat ? '⚠️ ' : ''}${n}
              ${isRepeat ? '<span style="font-size:9px;font-weight:800;color:#92400E;margin-left:6px;background:#FCD34D;padding:2px 6px;border-radius:999px;">REPETIDO</span>' : ''}
            </td>
            <td style="text-align:center;font-size:16px;font-weight:800;color:var(--rose);">${v.qty}</td>
            <td style="text-align:center;color:var(--muted);">${v.pedidos.size}</td>
            <td style="font-size:11px;color:var(--muted);">
              ${v.itens.slice(0,6).map(it=>`#${it.orderNumber||'—'}×${it.qty}${it.obs?' <em title="'+it.obs.replace(/"/g,'&quot;')+'">📝</em>':''}`).join(' · ')}
              ${v.itens.length>6 ? ` <span>+${v.itens.length-6}</span>` : ''}
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`}
  </div>

  <div class="card">
    <div class="card-title">📦 Lotes Sugeridos de Produção <span class="notif">${lotesList.length}</span>
      <span style="font-size:11px;font-weight:400;color:var(--muted);margin-left:6px;">Pedidos agrupados por data + turno · Sugestão de ordem de execução</span>
    </div>
    ${lotesList.length===0 ? `<div class="empty"><p>Sem lotes.</p></div>` : `
    <div style="display:flex;flex-direction:column;gap:10px;">
      ${lotesList.map((l, idx) => {
        const tColor = l.turno==='manha' ? 'var(--gold)' : l.turno==='tarde' ? 'var(--rose)' : l.turno==='noite' ? 'var(--purple,#7C3AED)' : 'var(--muted)';
        return `
        <div style="border:1px solid var(--border);border-left:4px solid ${tColor};border-radius:10px;padding:12px 14px;background:var(--cream);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <div>
              <span style="font-size:13px;font-weight:800;">LOTE ${idx+1}</span>
              <span style="font-size:12px;margin-left:8px;">${formatDia(l.date)} · ${turnoLabel[l.turno]||'—'}</span>
            </div>
            <div style="font-size:11px;color:var(--muted);">
              <strong style="color:var(--ink);font-size:13px;">${l.pedidos.length}</strong> pedidos ·
              <strong style="color:var(--rose);font-size:13px;">${l.itens}</strong> itens
            </div>
          </div>
          <div style="font-size:11px;color:var(--muted);">
            ${l.pedidos.slice(0,12).map(o=>`<span style="background:#fff;padding:2px 6px;border-radius:6px;margin-right:3px;display:inline-block;margin-bottom:2px;">#${o.orderNumber||'—'} ${o.scheduledTime||''}</span>`).join('')}
            ${l.pedidos.length>12 ? `<span>+${l.pedidos.length-12}</span>` : ''}
          </div>
        </div>`;
      }).join('')}
    </div>`}
  </div>
  `;
})()}
` : ''}

${fSecao==='entregas' ? `
<!-- ── SECAO: ENTREGAS ── -->
${(()=>{
  // Ordena por data → turno → horario
  const entregas = [...altos].filter(o => !['Cancelado'].includes(o.status)).sort((a,b)=>{
    const d = (a.scheduledDate||'').localeCompare(b.scheduledDate||'');
    if(d!==0) return d;
    const tA = ['manha','tarde','noite','—'].indexOf(getTurno(a.scheduledTime));
    const tB = ['manha','tarde','noite','—'].indexOf(getTurno(b.scheduledTime));
    if(tA!==tB) return tA-tB;
    return (a.scheduledTime||'99:99').localeCompare(b.scheduledTime||'99:99');
  });

  // Agrupa por data + turno
  const groups = {};
  entregas.forEach(o => {
    const key = (o.scheduledDate||'—')+'__'+getTurno(o.scheduledTime);
    if(!groups[key]) groups[key] = { date:o.scheduledDate, turno:getTurno(o.scheduledTime), pedidos:[] };
    groups[key].pedidos.push(o);
  });

  return Object.values(groups).map(g => `
    <div class="card" style="margin-bottom:14px;">
      <div class="card-title">
        📅 ${formatDia(g.date)} · ${turnoLabel[g.turno]||'—'}
        <span class="notif">${g.pedidos.length}</span>
      </div>
      <div style="overflow-x:auto;">
        <table style="width:100%;font-size:12px;">
          <thead><tr style="text-align:left;border-bottom:2px solid var(--border);">
            <th style="padding:6px;">Horário</th>
            <th>#</th>
            <th>Cliente / Destinatário</th>
            <th>Endereço</th>
            <th>Bairro</th>
            <th>Produto</th>
            <th>Obs</th>
            <th>Status</th>
          </tr></thead>
          <tbody>
            ${g.pedidos.map(o => {
              const prod = (o.items||[]).map(i=>`${i.name} ×${i.qty||1}`).join(' · ') || '—';
              const obs  = o.obsPedido || o.obs || o.observacao || '';
              const endereco = [o.deliveryStreet, o.deliveryNumber].filter(Boolean).join(', ')
                || o.deliveryAddress || o.address || '—';
              return `<tr style="border-bottom:1px solid var(--border);">
                <td style="padding:6px;font-weight:800;color:var(--rose);white-space:nowrap;">${o.scheduledTime||'—'}${o.scheduledTimeEnd?'–'+o.scheduledTimeEnd:''}</td>
                <td style="font-weight:700;">#${o.orderNumber||'—'}</td>
                <td>
                  <div style="font-weight:600;">${o.client?.name || o.clientName || '—'}</div>
                  ${o.recipient ? `<div style="font-size:10px;color:var(--muted);">→ ${o.recipient}</div>`:''}
                </td>
                <td style="font-size:11px;max-width:200px;">${endereco}</td>
                <td style="font-size:11px;">${o.deliveryNeighborhood||'—'}</td>
                <td style="font-size:11px;max-width:240px;">${prod}</td>
                <td style="font-size:11px;max-width:180px;color:#92400E;${obs?'background:#FFFBEB;padding:4px 6px;border-radius:6px;':''}">${obs||'—'}</td>
                <td><span class="tag ${sc(o.status)}" style="font-size:9px;">${o.status}</span></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `).join('') || `<div class="empty card"><div class="empty-icon">🚚</div><p>Sem entregas no período.</p></div>`;
})()}
` : ''}

${fSecao==='priorizacao' ? `
<!-- ── SECAO: PRIORIZACAO ── -->
${(()=>{
  // Classifica por prioridade
  const manausNow = new Date(Date.now() - 4*3600000);
  const hojeStr = manausNow.toISOString().slice(0,10);

  const proximoHorario = (o) => {
    if((o.scheduledDate||'').slice(0,10) !== hojeStr) return Infinity;
    if(!o.scheduledTime || o.scheduledTime==='00:00') return Infinity;
    const [h,m]=o.scheduledTime.split(':').map(Number);
    const curMins = manausNow.getUTCHours()*60 + manausNow.getUTCMinutes();
    return (h*60+m) - curMins;
  };

  const classificados = altos.filter(o=>!['Cancelado','Entregue'].includes(o.status)).map(o => ({
    order: o,
    prio:  getPrioLevel(o),
    proxMin: proximoHorario(o),
  }));

  // Ordem sugerida: primeiro os que vao "estourar" (proxMin <= 180), depois por prioridade
  classificados.sort((a,b) => {
    const ca = a.proxMin <= 180 ? 0 : 1;
    const cb = b.proxMin <= 180 ? 0 : 1;
    if(ca !== cb) return ca - cb;
    // Antecipado > Urgente > Ultima > Normal
    const order = { antecipado:0, urgente:1, ultima:2, normal:3 };
    const d = (order[a.prio.key]??99) - (order[b.prio.key]??99);
    if(d!==0) return d;
    return a.proxMin - b.proxMin;
  });

  const antecipados = classificados.filter(c=>c.prio.key==='antecipado');
  const urgentes    = classificados.filter(c=>c.prio.key==='urgente');
  const ultimas     = classificados.filter(c=>c.prio.key==='ultima');
  const risco       = classificados.filter(c=>c.proxMin>=0 && c.proxMin<=180);

  const renderRow = (c) => {
    const o = c.order;
    const prod = (o.items||[]).map(i=>`${i.name} ×${i.qty||1}`).join(' · ') || '—';
    const isRisk = c.proxMin>=0 && c.proxMin<=180;
    const bg = isRisk ? 'background:#FEF2F2;border-left:4px solid #DC2626;' :
               c.prio.key==='antecipado' ? 'background:#FFFBEB;border-left:4px solid #F59E0B;' :
               c.prio.key==='ultima' ? 'background:#FEE2E2;border-left:3px solid #EF4444;' : '';
    return `<tr style="border-bottom:1px solid var(--border);${bg}">
      <td style="padding:8px 6px;font-weight:800;color:var(--rose);">#${o.orderNumber||'—'}</td>
      <td>
        <span style="font-weight:700;">${c.prio.label}</span>
        ${c.prio.days ? `<span style="font-size:10px;color:var(--muted);margin-left:4px;">(${c.prio.days}d antes)</span>`:''}
      </td>
      <td style="font-size:11px;">${o.client?.name || o.clientName || '—'}</td>
      <td style="font-size:11px;">${o.deliveryNeighborhood||'—'}</td>
      <td style="font-size:11px;font-weight:700;">${formatDia(o.scheduledDate)} ${o.scheduledTime||''}</td>
      <td style="${isRisk?'color:#DC2626;font-weight:800;':'color:var(--muted);'}font-size:11px;">
        ${isRisk ? (c.proxMin<0 ? '🚨 ATRASADO' : `⚠️ ${c.proxMin}min`) : (c.proxMin===Infinity?'—':`${c.proxMin}min`)}
      </td>
      <td style="font-size:11px;max-width:220px;">${prod}</td>
    </tr>`;
  };

  return `
  <div class="g4" style="margin-bottom:14px;">
    <div class="mc gold"><div class="mc-label">📅 Antecipados</div><div class="mc-val">${antecipados.length}</div></div>
    <div class="mc rose"><div class="mc-label">🔥 Urgentes</div><div class="mc-val">${urgentes.length}</div></div>
    <div class="mc purple"><div class="mc-label">⚡ Última hora</div><div class="mc-val">${ultimas.length}</div></div>
    <div class="mc" style="background:linear-gradient(135deg,#DC2626,#F59E0B);color:#fff;"><div class="mc-label" style="color:rgba(255,255,255,.85);">🚨 Risco de atraso</div><div class="mc-val" style="color:#fff;">${risco.length}</div></div>
  </div>

  <div class="card">
    <div class="card-title">🎯 Ordem Sugerida de Produção/Entrega <span class="notif">${classificados.length}</span>
      <span style="font-size:11px;font-weight:400;color:var(--muted);margin-left:6px;">Pedidos em risco no topo · siga de cima para baixo</span>
    </div>
    ${classificados.length===0 ? `<div class="empty"><p>Sem pedidos pendentes.</p></div>` : `
    <div style="overflow-x:auto;">
      <table style="width:100%;font-size:12px;">
        <thead><tr style="text-align:left;border-bottom:2px solid var(--border);">
          <th style="padding:6px;">#</th><th>Prioridade</th><th>Cliente</th>
          <th>Bairro</th><th>Entrega</th><th>Tempo</th><th>Produto</th>
        </tr></thead>
        <tbody>${classificados.map(renderRow).join('')}</tbody>
      </table>
    </div>`}
  </div>
  `;
})()}
` : ''}

${fSecao==='rota' ? `
<!-- ── SECAO: ROTEIRIZACAO ── -->
${(()=>{
  const emRota = altos.filter(o => !['Cancelado','Entregue'].includes(o.status));
  const porZona = {};
  emRota.forEach(o => {
    const z = getZona(o.deliveryNeighborhood);
    if(!porZona[z]) porZona[z] = {};
    const b = o.deliveryNeighborhood || '—';
    if(!porZona[z][b]) porZona[z][b] = [];
    porZona[z][b].push(o);
  });

  const zonaOrder = ['Centro-Sul','Leste','Norte','Oeste','Outros','Sem bairro'];
  const zonaColors = {'Centro-Sul':'#EC4899','Leste':'#F59E0B','Norte':'#10B981','Oeste':'#3B82F6','Outros':'#8B5CF6','Sem bairro':'#94A3B8'};

  const zonas = zonaOrder.filter(z=>porZona[z]);

  return `
  <div class="card" style="margin-bottom:14px;">
    <div class="card-title">🗺️ Roteirização Sugerida <span class="notif">${emRota.length} entregas</span>
      <span style="font-size:11px;font-weight:400;color:var(--muted);margin-left:6px;">Agrupadas por zona · Sequência sugerida: Centro → Leste → Norte → Oeste</span>
    </div>
    <p style="font-size:11px;color:var(--muted);margin:6px 0 0;">
      💡 <strong>Dica:</strong> Organize um entregador por zona. Dentro de cada zona, ordene por horário mais cedo primeiro.
    </p>
  </div>

  ${zonas.map((z, idx) => {
    const bairrosZona = Object.entries(porZona[z]).sort((a,b)=>b[1].length - a[1].length);
    const totalPedZona = Object.values(porZona[z]).reduce((s,arr)=>s+arr.length,0);
    return `
    <div class="card" style="margin-bottom:14px;border-left:5px solid ${zonaColors[z]};">
      <div class="card-title" style="color:${zonaColors[z]};">
        Zona ${idx+1}: ${z}
        <span class="notif" style="background:${zonaColors[z]};color:#fff;">${totalPedZona} pedidos</span>
      </div>
      ${bairrosZona.map(([bairro, pedidos]) => {
        // Ordena pedidos do bairro por horario
        pedidos.sort((a,b) => (a.scheduledTime||'99').localeCompare(b.scheduledTime||'99'));
        return `
        <div style="margin-bottom:10px;background:var(--cream);padding:10px 12px;border-radius:10px;">
          <div style="font-weight:700;margin-bottom:6px;font-size:12px;">📍 ${bairro} <span style="color:var(--muted);font-weight:400;">(${pedidos.length})</span></div>
          <div style="display:flex;flex-direction:column;gap:4px;font-size:11px;">
            ${pedidos.map((o,i) => `
              <div style="display:flex;gap:8px;align-items:center;padding:4px 8px;background:#fff;border-radius:6px;">
                <span style="background:${zonaColors[z]};color:#fff;width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;font-weight:800;font-size:10px;">${i+1}</span>
                <span style="font-weight:700;">${o.scheduledTime||'—'}</span>
                <span style="color:var(--rose);font-weight:700;">#${o.orderNumber||'—'}</span>
                <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                  ${o.recipient || o.client?.name || o.clientName || '—'}
                  ${o.deliveryStreet ? `· <span style="color:var(--muted);">${o.deliveryStreet}${o.deliveryNumber?', '+o.deliveryNumber:''}</span>` : ''}
                </span>
              </div>`).join('')}
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }).join('') || `<div class="empty card"><div class="empty-icon">🗺️</div><p>Sem entregas para rotear.</p></div>`}
  `;
})()}
` : ''}

${fSecao==='alertas' ? `
<!-- ── SECAO: ALERTAS ── -->
${(()=>{
  const manausNow = new Date(Date.now() - 4*3600000);
  const hojeStr = manausNow.toISOString().slice(0,10);
  const pendentesList = altos.filter(o=>!['Cancelado','Entregue'].includes(o.status));

  // 1) Pedidos antigos (7+ dias) ainda pendentes
  const antigos = pendentesList.filter(o => {
    const age = (Date.now() - new Date(o.createdAt).getTime()) / 86400000;
    return age >= 7 && (o.scheduledDate||'').slice(0,10) >= hojeStr;
  }).sort((a,b)=>new Date(a.createdAt) - new Date(b.createdAt));

  // 2) Picos de horario (mais de N pedidos no mesmo horario)
  const porHora = {};
  pendentesList.forEach(o => {
    if((o.scheduledDate||'').slice(0,10) !== hojeStr) return;
    const h = (o.scheduledTime||'').slice(0,2);
    if(!h || h==='00') return;
    porHora[h] = (porHora[h]||0) + 1;
  });
  const picos = Object.entries(porHora).filter(([,v]) => v >= 5).sort((a,b)=>b[1]-a[1]);

  // 3) Gargalos: status estagnados
  const emPreparo   = pendentesList.filter(o => o.status === 'Em preparo');
  const muitoPronto = pendentesList.filter(o => {
    if(o.status !== 'Pronto') return false;
    const age = (Date.now() - new Date(o.updatedAt||o.createdAt).getTime()) / 60000;
    return age > 90;
  });
  const semEntregador = pendentesList.filter(o =>
    o.status === 'Pronto' && !o.driverName && !o.driver
  );

  // 4) Pedidos do dia sem horario
  const semHora = pendentesList.filter(o =>
    (o.scheduledDate||'').slice(0,10) === hojeStr && (!o.scheduledTime || o.scheduledTime === '00:00')
  );

  // 5) Gargalos de bairro: bairro com muitos pedidos pro mesmo turno
  const porBairroTurno = {};
  pendentesList.forEach(o => {
    if((o.scheduledDate||'').slice(0,10) !== hojeStr) return;
    const k = (o.deliveryNeighborhood||'—')+'/'+getTurno(o.scheduledTime);
    porBairroTurno[k] = (porBairroTurno[k]||0) + 1;
  });
  const gargalosBairro = Object.entries(porBairroTurno).filter(([,v])=>v>=4).sort((a,b)=>b[1]-a[1]);

  return `
  <div class="g3" style="margin-bottom:14px;">
    <div class="mc" style="background:#FEF2F2;border-left:5px solid #DC2626;">
      <div class="mc-label" style="color:#7F1D1D;">📅 Pedidos antigos</div>
      <div class="mc-val" style="color:#7F1D1D;">${antigos.length}</div>
      <div class="mc-sub" style="color:#991B1B;">Feitos há 7+ dias</div>
    </div>
    <div class="mc" style="background:#FFFBEB;border-left:5px solid #F59E0B;">
      <div class="mc-label" style="color:#78350F;">⚡ Picos de horário</div>
      <div class="mc-val" style="color:#78350F;">${picos.length}</div>
      <div class="mc-sub" style="color:#92400E;">5+ pedidos na mesma hora</div>
    </div>
    <div class="mc" style="background:#FDF2F8;border-left:5px solid #EC4899;">
      <div class="mc-label" style="color:#831843;">🧱 Gargalos</div>
      <div class="mc-val" style="color:#831843;">${muitoPronto.length + semEntregador.length + gargalosBairro.length}</div>
      <div class="mc-sub" style="color:#9D174D;">Operacionais identificados</div>
    </div>
  </div>

  <!-- Pedidos antigos -->
  <div class="card" style="margin-bottom:14px;${antigos.length===0?'opacity:.6;':''}">
    <div class="card-title">📅 Pedidos Antigos (risco de esquecer)
      <span class="notif">${antigos.length}</span>
    </div>
    ${antigos.length===0 ? `<div class="empty"><p>✅ Nenhum pedido antigo pendente.</p></div>` : `
    <table style="width:100%;font-size:12px;">
      <thead><tr style="text-align:left;border-bottom:1px solid var(--border);">
        <th style="padding:6px;">#</th><th>Criado há</th><th>Cliente</th>
        <th>Entrega</th><th>Status</th>
      </tr></thead>
      <tbody>
        ${antigos.map(o => {
          const days = Math.floor((Date.now()-new Date(o.createdAt).getTime())/86400000);
          return `<tr style="border-bottom:1px solid var(--border);background:#FEF2F2;">
            <td style="padding:8px 6px;font-weight:800;color:var(--rose);">#${o.orderNumber||'—'}</td>
            <td style="font-weight:700;color:#DC2626;">${days} dias</td>
            <td>${o.client?.name||o.clientName||'—'}</td>
            <td>${formatDia(o.scheduledDate)} ${o.scheduledTime||''}</td>
            <td><span class="tag ${sc(o.status)}" style="font-size:10px;">${o.status}</span></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`}
  </div>

  <div class="g2">
    <!-- Picos -->
    <div class="card">
      <div class="card-title">⚡ Picos de Horário (hoje)
        <span class="notif">${picos.length}</span>
      </div>
      ${picos.length===0 ? `<div class="empty"><p>Distribuição tranquila.</p></div>` : `
      <div>
        ${picos.map(([h, v]) => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:#FFFBEB;border-radius:8px;margin-bottom:6px;border:1px solid #FCD34D;">
            <div style="font-weight:800;font-size:16px;color:#78350F;">${h}:00 – ${h}:59</div>
            <div style="font-size:13px;color:#92400E;"><strong style="font-size:20px;">${v}</strong> pedidos</div>
          </div>`).join('')}
        <div style="margin-top:8px;padding:10px;background:var(--cream);border-radius:8px;font-size:11px;color:var(--muted);">
          💡 <strong>Dica:</strong> Escalone produção iniciando 1h30 antes desses horários. Considere pedir ao cliente para flexibilizar o horário em pedidos ainda não produzidos.
        </div>
      </div>`}
    </div>

    <!-- Gargalos -->
    <div class="card">
      <div class="card-title">🧱 Gargalos Operacionais</div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${muitoPronto.length > 0 ? `
          <div style="background:#FEF2F2;border-left:4px solid #DC2626;padding:10px 12px;border-radius:8px;">
            <div style="font-weight:700;font-size:12px;color:#7F1D1D;">🚨 ${muitoPronto.length} pedidos "Prontos" há mais de 90 min sem sair</div>
            <div style="font-size:11px;color:#991B1B;margin-top:2px;">
              ${muitoPronto.slice(0,6).map(o=>`#${o.orderNumber||'—'}`).join(' · ')}${muitoPronto.length>6?` +${muitoPronto.length-6}`:''}
            </div>
          </div>` : ''}
        ${semEntregador.length > 0 ? `
          <div style="background:#FFFBEB;border-left:4px solid #F59E0B;padding:10px 12px;border-radius:8px;">
            <div style="font-weight:700;font-size:12px;color:#78350F;">🚚 ${semEntregador.length} prontos sem entregador atribuído</div>
            <div style="font-size:11px;color:#92400E;margin-top:2px;">
              ${semEntregador.slice(0,6).map(o=>`#${o.orderNumber||'—'}`).join(' · ')}${semEntregador.length>6?` +${semEntregador.length-6}`:''}
            </div>
          </div>` : ''}
        ${semHora.length > 0 ? `
          <div style="background:#F3F4F6;border-left:4px solid #6B7280;padding:10px 12px;border-radius:8px;">
            <div style="font-weight:700;font-size:12px;color:#1F2937;">⏱️ ${semHora.length} pedidos de hoje sem horário definido</div>
            <div style="font-size:11px;color:#374151;margin-top:2px;">
              ${semHora.slice(0,6).map(o=>`#${o.orderNumber||'—'}`).join(' · ')}${semHora.length>6?` +${semHora.length-6}`:''}
            </div>
          </div>` : ''}
        ${gargalosBairro.length > 0 ? `
          <div style="background:#FDF2F8;border-left:4px solid #EC4899;padding:10px 12px;border-radius:8px;">
            <div style="font-weight:700;font-size:12px;color:#831843;">📍 Concentração de bairro/turno</div>
            <div style="font-size:11px;color:#9D174D;margin-top:4px;">
              ${gargalosBairro.slice(0,5).map(([k,v])=>{
                const [b,t] = k.split('/');
                return `<div>${b} <span style="color:var(--muted);">·</span> ${turnoLabel[t]||'—'} → <strong>${v} pedidos</strong></div>`;
              }).join('')}
            </div>
          </div>` : ''}
        ${muitoPronto.length + semEntregador.length + semHora.length + gargalosBairro.length === 0 ?
          `<div style="background:var(--leaf-l);border:1px solid var(--leaf);padding:14px;border-radius:8px;text-align:center;color:var(--leaf);font-weight:700;">
            ✅ Operação sem gargalos detectados
          </div>` : ''}
      </div>
    </div>
  </div>
  `;
})()}
` : ''}

`}
`;
}

// ── Exporta Alta Demanda para CSV ─────────────────────────────
export function exportAltaDemandaCSV(){
  const targetDate = S._relAltaDate || '';
  const data = S._lastAltaDemandaOrders || S.orders.filter(o => o.scheduledDate === targetDate);
  if (!data.length) { toast('Sem dados para exportar'); return; }
  const header = ['Numero','Cliente','Destinatario','Produto','Qtd','Bairro','Data Entrega','Horario','Total','Pagamento','Canal','Status','Criado em'];
  const rows = data.map(o => {
    const prod = (o.items||[]).map(i=>`${i.name} (${i.qty||1}x)`).join(' | ');
    const qty  = (o.items||[]).reduce((s,i)=>s+(Number(i.qty)||1),0);
    return [
      o.orderNumber||'',
      o.client?.name || o.clientName || '',
      o.recipient || '',
      prod,
      qty,
      o.deliveryNeighborhood || o.deliveryZone || '',
      (o.scheduledDate||'').slice(0,10),
      o.scheduledTime || '',
      Number(o.total||0).toFixed(2),
      o.payment || '',
      o.source || 'PDV',
      o.status || '',
      (o.createdAt||'').slice(0,19).replace('T',' '),
    ];
  });
  const csv = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `alta-demanda-${targetDate||'custom'}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast('📤 CSV exportado');
}

// ── TAB OPERAÇÃO: Análise de Ponto/Horas/Pontualidade ─────────
function renderTabOperacao(period, periodLabel){
  // Permissão: só admin ou reportsOperacao
  const canSee = S.user?.cargo==='admin' || S.user?.role==='Administrador' ||
                 (S.user?.modulos && S.user.modulos.reportsOperacao===true);
  if(!canSee) return `<div class="card"><div class="empty">Sem permissão</div></div>`;

  const records = JSON.parse(localStorage.getItem('fv_ponto') || '[]');
  if(!records.length) return `<div class="card"><div class="empty"><p>Nenhum registro de ponto disponível</p></div></div>`;

  const now = new Date();
  const dt1Str = S._relDate1 || '';
  const dt2Str = S._relDate2 || '';
  const inPeriod = d => {
    if(!d) return false;
    const dt = new Date(d + (d.length===10 ? 'T12:00' : ''));
    if(period==='hoje') return dt.toDateString()===now.toDateString();
    if(period==='semana'){ const w=new Date(now); w.setDate(now.getDate()-7); return dt>=w; }
    if(period==='mes') return dt.getMonth()===now.getMonth() && dt.getFullYear()===now.getFullYear();
    if(period==='mes_ant'){
      const m = now.getMonth()===0?11:now.getMonth()-1;
      const y = now.getMonth()===0?now.getFullYear()-1:now.getFullYear();
      return dt.getMonth()===m && dt.getFullYear()===y;
    }
    if(period==='custom'){
      if (dt1Str && dt < new Date(dt1Str + 'T00:00:00')) return false;
      if (dt2Str && dt > new Date(dt2Str + 'T23:59:59.999')) return false;
      return true;
    }
    return true;
  };

  const filtered = records.filter(r => r.date && inPeriod(r.date));

  // Mescla registros duplicados do mesmo colab no mesmo dia
  const byUserDay = {};
  filtered.forEach(r => {
    const k = (r.userId || r.userName) + '|' + r.date;
    if(!byUserDay[k]) byUserDay[k] = [];
    byUserDay[k].push(r);
  });
  const mergedRecords = Object.values(byUserDay).map(group => {
    if(group.length === 1) return group[0];
    const sorted = [...group].sort((a,b) => new Date(a.updatedAt||a.createdAt||0) - new Date(b.updatedAt||b.createdAt||0));
    const merged = { ...sorted[0] };
    for(const r of sorted.slice(1)){
      ['chegada','saidaAlmoco','voltaAlmoco','saida'].forEach(k => { if(r[k]) merged[k] = r[k]; });
    }
    return merged;
  });

  // Importa helpers do ponto (carregado dinâmico via window.FV ou direto)
  const toMin = t => { if(!t) return 0; const [h,m] = t.split(':').map(Number); return h*60+m; };
  const fmtHrs = (mins) => mins<=0 ? '0h00min' : `${Math.floor(mins/60)}h${String(mins%60).padStart(2,'0')}min`;
  const calcMin = r => {
    if(!r.chegada || !r.saida) return 0;
    const total = toMin(r.saida) - toMin(r.chegada);
    const almoco = (r.saidaAlmoco && r.voltaAlmoco) ? (toMin(r.voltaAlmoco)-toMin(r.saidaAlmoco)) : 0;
    const liq = total - almoco;
    return liq>0 ? liq : 0;
  };

  const schedules = JSON.parse(localStorage.getItem('fv_ponto_schedules')||'{}');

  // Agrega por colaborador
  const byUser = {};
  mergedRecords.forEach(r => {
    const k = r.userId || r.userName;
    if(!byUser[k]) byUser[k] = {
      userId: r.userId, name: r.userName||'—', role: r.userRole||'—',
      dias:0, diasCompletos:0, diasIncompletos:0, totalMin:0,
      atrasos:0, minAtrasoTotal:0, horasExtras:0,
      sched: schedules[r.userId] || null,
      registros: []
    };
    byUser[k].registros.push(r);
  });

  Object.values(byUser).forEach(u => {
    u.registros.forEach(r => {
      const m = calcMin(r);
      if(m>0){ u.totalMin += m; u.diasCompletos++; }
      else if(r.chegada){ u.diasIncompletos++; }
      u.dias++;
      // Atraso
      if(u.sched?.entrada && r.chegada){
        const esp = toMin(u.sched.entrada);
        const real = toMin(r.chegada);
        if(real > esp + 5){ u.atrasos++; u.minAtrasoTotal += (real-esp); }
      }
      // Horas extras (considera jornada de 8h = 480min)
      if(m > 480) u.horasExtras += (m - 480);
    });
  });

  const ranking = Object.values(byUser).sort((a,b) => b.totalMin - a.totalMin);
  const maxMin = ranking.length ? Math.max(...ranking.map(u => u.totalMin)) : 1;

  const totalColabs = ranking.length;
  const totalMinGeral = ranking.reduce((s,u) => s+u.totalMin, 0);
  const totalAtrasos  = ranking.reduce((s,u) => s+u.atrasos, 0);
  const totalDiasComp = ranking.reduce((s,u) => s+u.diasCompletos, 0);
  const totalExtras   = ranking.reduce((s,u) => s+u.horasExtras, 0);

  // Seleção de colab para drill-down
  const selColabId = S._relOpColab || '';
  const selColab = ranking.find(u => u.userId === selColabId);

  return `
<div class="g2" style="margin-bottom:14px;">
  <div class="mc rose"><div class="mc-label">Colaboradores</div><div class="mc-val">${totalColabs}</div></div>
  <div class="mc leaf"><div class="mc-label">Horas Totais</div><div class="mc-val">${fmtHrs(totalMinGeral)}</div></div>
  <div class="mc gold"><div class="mc-label">Atrasos</div><div class="mc-val">${totalAtrasos}</div></div>
  <div class="mc purple"><div class="mc-label">Horas Extras</div><div class="mc-val">${fmtHrs(totalExtras)}</div></div>
</div>

<div class="card" style="margin-bottom:14px;">
  <div class="card-title">🏆 Ranking de Horas Trabalhadas — ${periodLabel}</div>
  ${ranking.length===0 ? '<div class="empty"><p>Sem dados no período</p></div>' :
    ranking.map(u => {
      const pct = Math.round((u.totalMin/maxMin)*100);
      const pontualidade = u.dias>0 ? Math.round(((u.dias-u.atrasos)/u.dias)*100) : 100;
      const pontColor = pontualidade>=90 ? 'var(--leaf)' : pontualidade>=75 ? '#D97706' : 'var(--red)';
      return `
      <div style="margin-bottom:12px;padding:10px;background:var(--cream);border-radius:8px;cursor:pointer;border:1.5px solid ${selColabId===u.userId?'var(--rose)':'transparent'};transition:all .15s;"
        onclick="S._relOpColab='${u.userId===selColabId?'':u.userId}';window.render&&window.render();">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;flex-wrap:wrap;gap:8px;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-weight:700;font-size:13px;">${u.name}</span>
            <span style="font-size:10px;color:var(--muted);">${u.role}</span>
          </div>
          <div style="display:flex;gap:10px;font-size:11px;flex-wrap:wrap;">
            <span style="color:var(--muted)">📅 ${u.diasCompletos}d</span>
            <span style="color:${pontColor};font-weight:700">🎯 ${pontualidade}%</span>
            ${u.atrasos>0?`<span style="color:#D97706">⏰ ${u.atrasos}</span>`:''}
            ${u.horasExtras>0?`<span style="color:var(--leaf)">⚡ +${fmtHrs(u.horasExtras)}</span>`:''}
            <span style="font-weight:800;color:var(--ink)">${fmtHrs(u.totalMin)}</span>
          </div>
        </div>
        <div style="height:6px;background:#fff;border-radius:3px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,var(--rose),var(--rose-d));"></div>
        </div>
      </div>`;
    }).join('')
  }
  <div style="font-size:11px;color:var(--muted);text-align:center;margin-top:8px;">Clique em um colaborador para ver detalhes</div>
</div>

${selColab ? `
<div class="card" style="margin-bottom:14px;border:2px solid var(--rose);">
  <div class="card-title">👤 Detalhes — ${selColab.name}
    <button style="margin-left:auto;background:transparent;border:1px solid var(--border);padding:4px 10px;border-radius:6px;font-size:11px;cursor:pointer;" onclick="S._relOpColab='';window.render&&window.render();">✕ Fechar</button>
  </div>
  <div class="g2" style="margin-bottom:14px;">
    <div class="mc leaf"><div class="mc-label">Horas Trabalhadas</div><div class="mc-val">${fmtHrs(selColab.totalMin)}</div></div>
    <div class="mc gold"><div class="mc-label">Horas Extras</div><div class="mc-val">${fmtHrs(selColab.horasExtras)}</div></div>
    <div class="mc rose"><div class="mc-label">Dias Completos</div><div class="mc-val">${selColab.diasCompletos}</div></div>
    <div class="mc purple"><div class="mc-label">Atrasos</div><div class="mc-val">${selColab.atrasos}</div></div>
  </div>
  ${selColab.minAtrasoTotal>0?`<div style="background:#FFF8E1;border:1px solid #FCD34D;border-radius:8px;padding:10px 14px;font-size:12px;color:#92400E;margin-bottom:10px;">
    ⏰ Total acumulado de atraso: <strong>${fmtHrs(selColab.minAtrasoTotal)}</strong>
  </div>`:''}
  <div class="tw"><table>
    <thead><tr><th>Data</th><th>Entrada</th><th>S. Almoço</th><th>V. Almoço</th><th>Saída</th><th>Total</th></tr></thead>
    <tbody>
      ${selColab.registros.sort((a,b)=>b.date.localeCompare(a.date)).map(r => {
        const m = calcMin(r);
        return `<tr>
          <td>${new Date(r.date+'T12:00').toLocaleDateString('pt-BR')}</td>
          <td>${r.chegada||'—'}</td>
          <td>${r.saidaAlmoco||'—'}</td>
          <td>${r.voltaAlmoco||'—'}</td>
          <td>${r.saida||'—'}</td>
          <td style="font-weight:700">${m>0?fmtHrs(m):'—'}</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table></div>
</div>`:''}

${totalAtrasos>0?`
<div style="background:#FFF8E1;border:1px solid #FCD34D;border-radius:10px;padding:12px 16px;font-size:13px;color:#92400E;">
  ⚠️ <strong>Alerta de pontualidade:</strong> ${totalAtrasos} atraso(s) detectado(s) no período. Considere conversar com quem teve mais ocorrências.
</div>`:''}
`;
}
