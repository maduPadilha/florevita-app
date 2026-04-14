import { S } from '../state.js';
import { $c, $d, sc, rolec, ini, segc } from '../utils/formatters.js';
import { GET, PUT } from '../services/api.js';
import { toast, searchOrders, renderOrderSearchBar } from '../utils/helpers.js';
import { can, findColab, getColabs } from '../services/auth.js';

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

  const inPeriod = d=>{
    const dt=new Date(d);
    if(period==='hoje') return dt.toDateString()===now.toDateString();
    if(period==='semana'){const w=new Date(now);w.setDate(now.getDate()-7);return dt>=w;}
    if(period==='mes') return dt.getMonth()===now.getMonth()&&dt.getFullYear()===now.getFullYear();
    if(period==='mes_ant'){const m=now.getMonth()===0?11:now.getMonth()-1;const y=now.getMonth()===0?now.getFullYear()-1:now.getFullYear();return dt.getMonth()===m&&dt.getFullYear()===y;}
    return true;
  };

  const base = unit
    ? unit==='E-commerce'
      ? S.orders.filter(o=>o.source==='E-commerce'||(o.source||'').toLowerCase().includes('ecomm'))
      : S.orders.filter(o=>o.unit===unit&&o.source!=='E-commerce')
    : S.orders;
  const filtered= base.filter(o=>inPeriod(o.createdAt));
  const validos = filtered.filter(o=>o.status!=='Cancelado');
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

  // Por usuario (atividades)
  const byUser={};
  acts.forEach(a=>{
    if(!byUser[a.userId])byUser[a.userId]={name:a.userName,role:a.userRole,vendas:0,fat:0,montagens:0,expedicoes:0};
    if(a.type==='venda'){byUser[a.userId].vendas++;byUser[a.userId].fat+=(a.total||0);}
    if(a.type==='montagem') byUser[a.userId].montagens++;
    if(a.type==='expedicao') byUser[a.userId].expedicoes++;
  });

  // Por entregador
  const byDriver={};
  getColabs().filter(c=>c.cargo==='Entregador'&&c.active!==false).forEach(c=>{
    const key = (c.name||'').trim();
    if(key) byDriver[key]={entregas:0,total:0,valorPorEntrega:c.metas?.valorEntrega||0,colabId:c.id};
  });
  entregues.forEach(o=>{
    const d=(o.driverName||'').trim();
    if(!d){ if(!byDriver['Sem entregador'])byDriver['Sem entregador']={entregas:0,total:0,valorPorEntrega:0,colabId:null}; byDriver['Sem entregador'].entregas++;byDriver['Sem entregador'].total+=(o.total||0); return; }
    const key = Object.keys(byDriver).find(k=>k.toLowerCase()===d.toLowerCase()) || d;
    if(!byDriver[key]) byDriver[key]={entregas:0,total:0,valorPorEntrega:0,colabId:null};
    byDriver[key].entregas++;
    byDriver[key].total+=(o.total||0);
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

  const periodLabel={hoje:'Hoje',semana:'Semana',mes:'Este Mês',mes_ant:'Mês Anterior',todos:'Todo o Período'}[period]||'';

  const tabBtn=(k,l)=>`<button class="tab ${tab===k?'active':''}" data-rel-tab="${k}">${l}</button>`;

  return`
<!-- Filtros -->
<div class="card" style="margin-bottom:14px;">
  <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
    <div style="display:flex;gap:3px;">
      ${[{k:'hoje',l:'Hoje'},{k:'semana',l:'Semana'},{k:'mes',l:'Este Mês'},{k:'mes_ant',l:'Mês Ant.'},{k:'todos',l:'Todos'}].map(p=>`
      <button class="btn btn-sm ${period===p.k?'btn-primary':'btn-ghost'}" data-rel-period="${p.k}">${p.l}</button>`).join('')}
    </div>
    ${(( S.user?.role==='Administrador'||S.user?.cargo==='admin')||S.user.role==='Gerente')?`
    <select class="fi" id="rel-unit-filter" style="width:auto;">
      <option value="">Todas as unidades</option>
      <option value="Loja Novo Aleixo">Loja Novo Aleixo</option>
      <option value="Loja Allegro Mall">Loja Allegro Mall</option>
      <option value="CDLE">CDLE</option>
      <option value="E-commerce">E-commerce</option>
    </select>`:''}
    <button class="btn btn-ghost btn-sm" onclick="window.print()">🖨️ Imprimir</button>
  </div>
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
  ${tabBtn('montagens','🌿 Montagens')}
  ${tabBtn('clientes','👥 Clientes')}
  ${tabBtn('metas','🎯 Metas')}
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

<!-- TAB: POR USUARIO -->
${tab==='usuarios'?`
<div class="card">
  <div class="card-title">👩‍💼 Desempenho por Usuário — ${periodLabel}</div>
  ${Object.keys(byUser).length===0?`<div class="empty"><div class="empty-icon">👩‍💼</div><p>Sem atividades registradas no período</p></div>`:`
  <div class="tw"><table>
    <thead><tr><th>Funcionário</th><th>Cargo</th><th>Vendas</th><th>Faturamento</th><th>Montagens</th><th>Expedições</th><th>Ticket Médio</th></tr></thead>
    <tbody>
    ${Object.values(byUser).sort((a,b)=>b.fat-a.fat).map(u=>`<tr>
      <td style="font-weight:600">${u.name}</td>
      <td><span class="tag ${rolec(u.role)}">${u.role}</span></td>
      <td style="font-weight:600;color:var(--rose)">${u.vendas}</td>
      <td style="font-weight:700;color:var(--leaf)">${$c(u.fat)}</td>
      <td style="color:var(--gold)">${u.montagens}</td>
      <td style="color:var(--purple)">${u.expedicoes}</td>
      <td>${$c(u.vendas?u.fat/u.vendas:0)}</td>
    </tr>`).join('')}
    </tbody>
  </table></div>`}
</div>`:''}

<!-- TAB: ENTREGADORES -->
${tab==='entregadores'?`
<!-- Filtro por entregador -->
<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;align-items:center;">
  <select class="fi" id="rel-driver-filter" style="width:auto;min-width:180px;">
    <option value="">Todos os entregadores</option>
    ${Object.keys(byDriver).map(n=>`<option value="${n}" ${(S._relDriver||''===n)?'selected':''}>${n}</option>`).join('')}
  </select>
  <div style="font-size:12px;color:var(--muted)">
    ${periodLabel} · ${entregues.length} entrega(s) confirmada(s)
  </div>
</div>

<!-- Resumo por entregador -->
<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;margin-bottom:14px;">
  ${Object.entries(byDriver).sort((a,b)=>b[1].entregas-a[1].entregas).map(([nome,{entregas,total,valorPorEntrega}])=>{
    const ganho = (valorPorEntrega||0)*entregas;
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
      [...entregues].sort((a,b)=>new Date(b.updatedAt||b.createdAt)-new Date(a.updatedAt||a.createdAt)),
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

${tab==='custom'?renderCustomReports():''}

`;
}
