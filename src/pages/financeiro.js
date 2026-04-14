import { S } from '../state.js';
import { $c, $d, sc, rolec } from '../utils/formatters.js';
import { GET, POST, DELETE } from '../services/api.js';
import { toast } from '../utils/helpers.js';
import { can, findColab, getColabs } from '../services/auth.js';

// -- Helper: render() via dynamic import --
async function render(){
  const { render:r } = await import('../main.js');
  r();
}

// -- Helpers locais (metas / atividades) --
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

// -- Comissoes & Metas section (extracted to avoid nested template literal issues) --
function renderComissoesMetas(){
  const colabs = getColabs().filter(c=>c.active!==false&&(c.metas?.vendaPct||c.metas?.montagemQtd||c.metas?.expedicaoQtd));
  if(!colabs.length) return '';
  const per = S._finMetaPer||'mes';
  const perLabel = per==='dia'?'Hoje':per==='semana'?'Esta Semana':'Este Mês';
  const barC = p=>p>=100?'var(--leaf)':p>=60?'#F59E0B':'var(--red)';
  const miniBar=(cur,meta)=>{
    if(!meta) return '<span style="color:var(--muted);font-size:10px">—</span>';
    const p=Math.min(100,Math.round(cur/meta*100));
    return `<div style="font-size:11px;font-weight:600;color:${barC(p)}">${cur}/${meta}</div>
    <div style="height:4px;width:70px;background:#E5E7EB;border-radius:2px;overflow:hidden;margin-top:2px;">
      <div style="height:100%;width:${p}%;background:${barC(p)};"></div></div>`;
  };
  return `
<div class="card" style="margin-top:16px;">
  <div class="card-title" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
    <span>💰 Comissões &amp; Metas — ${perLabel}</span>
    <div style="display:flex;gap:6px;">
      <button class="btn btn-ghost btn-sm ${per==='dia'?'btn-primary':''}" id="btn-fin-meta-dia">Hoje</button>
      <button class="btn btn-ghost btn-sm ${per==='semana'?'btn-primary':''}" id="btn-fin-meta-semana">Semana</button>
      <button class="btn btn-ghost btn-sm ${per==='mes'?'btn-primary':''}" id="btn-fin-meta-mes">Mês</button>
    </div>
  </div>
  <div style="overflow-x:auto;">
  <table>
    <thead><tr>
      <th>Colaborador</th><th>Cargo</th>
      <th>Vendas</th><th style="color:var(--leaf)">Comissão</th>
      <th>🌸 Montagem</th><th>📦 Expedição</th>
    </tr></thead>
    <tbody>
    ${colabs.map(c=>{
      const mt=c.metas||{};
      const saved={montagemPer:mt.montagemPer,expedicaoPer:mt.expedicaoPer};
      if(mt.montagemQtd) mt.montagemPer=per;
      if(mt.expedicaoQtd) mt.expedicaoPer=per;
      const st=getColabStats(c);
      mt.montagemPer=saved.montagemPer; mt.expedicaoPer=saved.expedicaoPer;
      return `<tr>
        <td><strong>${c.name}</strong></td>
        <td><span class="tag ${rolec(c.cargo)}" style="font-size:10px">${c.cargo||'—'}</span></td>
        <td>${st.vendas}<div style="font-size:10px;color:var(--muted)">${mt.vendaPct?mt.vendaPct+'%/venda':''}</div></td>
        <td><strong style="color:var(--leaf);font-size:14px">${mt.vendaPct?'R$ '+st.comissao.toFixed(2):'<span style=color:var(--muted)>—</span>'}</strong></td>
        <td>${miniBar(st.montagens,mt.montagemQtd||0)}</td>
        <td>${miniBar(st.expedicoes,mt.expedicaoQtd||0)}</td>
      </tr>`;
    }).join('')}
    </tbody>
  </table>
  </div>
  <div style="font-size:10px;color:var(--muted);margin-top:8px;">* Contagem automática via Produção e Expedição. Comissão sobre total dos pedidos registrados.</div>
</div>`;
}

// -- FINANCEIRO --
export function renderFinanceiro(){
  const unit = ( S.user?.role==='Administrador'||S.user?.cargo==='admin')?S._finUnit||'':S.user.unit;
  const filteredOrders = unit
    ? unit==='E-commerce'
      ? S.orders.filter(o=>o.source==='E-commerce'||(o.source||'').toLowerCase().includes('ecomm'))
      : S.orders.filter(o=>o.unit===unit&&o.source!=='E-commerce')
    : S.orders;
  const receitas = filteredOrders.filter(o=>o.paymentStatus==='Pago').reduce((s,o)=>s+(o.total||0),0);
  const pendente = filteredOrders.filter(o=>o.paymentStatus!=='Pago'&&o.status!=='Cancelado').reduce((s,o)=>s+(o.total||0),0);
  const contas = S.financialEntries||[];
  const contasPagar = contas.filter(c=>c.type==='Despesa');
  const contasReceber = contas.filter(c=>c.type==='Receita');
  const vencidas = contasPagar.filter(c=>c.status==='Pendente'&&c.dueDate&&new Date(c.dueDate)<new Date());

  return `
${vencidas.length>0?`<div class="alert al-err">⚠️ <strong>${vencidas.length} conta(s) vencida(s)!</strong> ${vencidas.map(c=>c.description).join(', ')}</div>`:''}

<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;align-items:center;">
  ${( S.user?.role==='Administrador'||S.user?.cargo==='admin')?`
  <select class="fi" id="fin-unit-filter" style="width:auto;">
    <option value="">Todas as unidades</option>
    <option value="Loja Novo Aleixo">Loja Novo Aleixo</option>
    <option value="Loja Allegro Mall">Loja Allegro Mall</option>
    <option value="CDLE">CDLE</option>
    <option value="E-commerce">E-commerce</option>
  </select>`:''}
  <button class="btn btn-green btn-sm" id="btn-new-receita">+ Receita</button>
  <button class="btn btn-red btn-sm" id="btn-new-despesa">+ Despesa / Conta a Pagar</button>
  <button class="btn btn-ghost btn-sm" id="btn-rel-fin">🔄 Atualizar</button>
</div>

<div class="g4" style="margin-bottom:16px;">
  <div class="mc leaf"><div class="mc-label">Receita Confirmada</div><div class="mc-val">${$c(receitas)}</div></div>
  <div class="mc gold"><div class="mc-label">A Receber</div><div class="mc-val">${$c(pendente)}</div></div>
  <div class="mc red" style="--red:#DC2626;"><div class="mc-label">Contas a Pagar</div><div class="mc-val" style="color:var(--red)">${$c(contasPagar.filter(c=>c.status==='Pendente').reduce((s,c)=>s+(c.value||0),0))}</div></div>
  <div class="mc purple"><div class="mc-label">Ticket Médio</div><div class="mc-val">${$c(filteredOrders.length?(receitas+pendente)/filteredOrders.length:0)}</div></div>
</div>

<div class="g2">
  <div class="card">
    <div class="card-title">💳 Pedidos — Status Financeiro</div>
    ${filteredOrders.length===0?`<div class="empty"><div class="empty-icon">💰</div><p>Sem pedidos</p></div>`:`
    <div class="tw"><table><thead><tr><th>#</th><th>Cliente</th><th>Total</th><th>Pgto</th><th>Status Pgto</th><th>Data</th><th></th></tr></thead>
    <tbody>${filteredOrders.slice(0,15).map(o=>`<tr>
      <td style="color:var(--rose);font-weight:600">${o.orderNumber||'—'}</td>
      <td>${o.client?.name||o.clientName||'—'}</td>
      <td style="font-weight:600">${$c(o.total)}</td>
      <td><span class="tag t-gray">${o.payment||'—'}</span></td>
      <td><span class="tag ${sc(o.paymentStatus||'Pendente')}">${o.paymentStatus||'Pendente'}</span></td>
      <td style="color:var(--muted);font-size:11px">${$d(o.createdAt)}</td>
      <td>${o.paymentStatus!=='Pago'?`<button class="btn btn-green btn-xs" data-mark-paid="${o._id}">✅ Pago</button>`:''}</td>
    </tr>`).join('')}</tbody></table></div>`}
  </div>

  <div>
    <div class="card" style="margin-bottom:14px;">
      <div class="card-title">📋 Contas a Pagar
        <span class="tag t-red">${contasPagar.filter(c=>c.status==='Pendente').length} pendentes</span>
      </div>
      ${contasPagar.length===0?`<div class="empty"><div class="empty-icon">📋</div><p>Nenhuma conta cadastrada</p><button class="btn btn-primary btn-sm" id="btn-new-despesa2" style="margin-top:8px">+ Adicionar conta</button></div>`:`
      ${contasPagar.slice(0,8).map(c=>{
        const vencida = c.status==='Pendente'&&c.dueDate&&new Date(c.dueDate)<new Date();
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);">
          <div>
            <div style="font-size:12px;font-weight:500">${c.description}</div>
            <div style="font-size:10px;color:var(--muted)">${c.category||'—'} · Vence: ${c.dueDate?$d(c.dueDate):'—'}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:13px;font-weight:600;color:${vencida?'var(--red)':'var(--ink)'}">${$c(c.value)}</div>
            <span class="tag ${vencida?'t-red':c.status==='Pago'?'t-green':'t-gold'}">${vencida?'Vencida':c.status}</span>
            ${c.status==='Pendente'?`<button class="btn btn-green btn-xs" data-pay-bill="${c._id}" style="margin-top:3px">Pagar</button>`:''}
          </div>
        </div>`;
      }).join('')}`}
    </div>

    <div class="card">
      <div class="card-title">📊 Resumo por Forma de Pagamento</div>
      ${['Pix','Dinheiro','Crédito','Débito','Link','Cortesia'].map(p=>{
        const tot = filteredOrders.filter(o=>o.payment===p).reduce((s,o)=>s+(o.total||0),0);
        const qty = filteredOrders.filter(o=>o.payment===p).length;
        if(!qty) return '';
        return `<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border);font-size:12px;">
          <span>${p} <span style="color:var(--muted)">(${qty} pedidos)</span></span>
          <span style="font-weight:600">${$c(tot)}</span>
        </div>`;
      }).join('')}
    </div>
  </div>
</div>

${renderComissoesMetas()}`;
}

// -- MODAL FINANCEIRO --
export async function showFinModal(type){
  const cats = type==='Despesa'
    ? ['Insumos','Fixo','Variável','Salário','Fornecedor','Marketing','Manutenção','Outros']
    : ['Vendas','Pré-venda','Outros'];
  S._modal=`<div class="mo" id="mo"><div class="mo-box" onclick="event.stopPropagation()">
  <div class="mo-title">${type==='Receita'?'💰 Nova Receita':'💸 Nova Conta a Pagar'}</div>
  <div class="fg"><label class="fl">Descrição *</label><input class="fi" id="fm-desc" placeholder="${type==='Despesa'?'Ex: Fornecedor de rosas':'Ex: Venda balcão'}"/></div>
  <div class="fr2">
    <div class="fg"><label class="fl">Valor (R$) *</label><input class="fi" type="number" id="fm-value" step="0.01" placeholder="0,00"/></div>
    <div class="fg"><label class="fl">Data de ${type==='Despesa'?'Vencimento':'Recebimento'}</label><input class="fi" type="date" id="fm-date"/></div>
  </div>
  <div class="fr2">
    <div class="fg"><label class="fl">Categoria</label>
      <select class="fi" id="fm-cat">
        ${cats.map(c=>`<option>${c}</option>`).join('')}
      </select>
    </div>
    <div class="fg"><label class="fl">Unidade</label>
      <select class="fi" id="fm-unit">
        <option value="Todas">Todas</option>
        <option value="Loja Novo Aleixo">Loja Novo Aleixo</option>
        <option value="Loja Allegro Mall">Loja Allegro Mall</option>
        <option value="CDLE">CDLE</option>
      </select>
    </div>
  </div>
  ${type==='Despesa'?`<div class="fg"><label class="fl">Fornecedor / Beneficiário</label><input class="fi" id="fm-supplier" placeholder="Nome do fornecedor"/></div>`:''}
  <div class="fg"><label class="fl">Observações</label><textarea class="fi" id="fm-notes" rows="2"></textarea></div>
  <div class="mo-foot">
    <button class="btn ${type==='Receita'?'btn-green':'btn-red'}" id="btn-sv-fin">Salvar ${type}</button>
    <button class="btn btn-ghost" id="btn-mo-close">Cancelar</button>
  </div>
  </div></div>`;
  await render();
  document.getElementById('btn-mo-close')?.addEventListener('click',()=>{S._modal='';render();});
  document.getElementById('btn-sv-fin')?.addEventListener('click', async ()=>{
    const desc=document.getElementById('fm-desc')?.value.trim();
    const value=parseFloat(document.getElementById('fm-value')?.value||0);
    if(!desc) return toast('❌ Descrição obrigatória');
    if(!value||value<=0) return toast('❌ Informe o valor');
    const entry={
      type, description:desc, value,
      dueDate:document.getElementById('fm-date')?.value||null,
      category:document.getElementById('fm-cat')?.value,
      unit:document.getElementById('fm-unit')?.value,
      supplier:document.getElementById('fm-supplier')?.value||'',
      notes:document.getElementById('fm-notes')?.value||'',
      status:'Pendente',
      createdAt:new Date().toISOString()
    };
    try {
      const saved = await POST('/financial/entries', entry);
      if(saved && saved._id) entry._id = saved._id;
      if(!S.financialEntries) S.financialEntries = [];
      S.financialEntries.unshift(entry);
      S._modal=''; render();
      toast(`✅ ${type} cadastrada!`);
    } catch(e){
      console.error('Erro ao salvar entrada financeira:', e);
      toast('❌ Erro ao salvar. Tente novamente.');
    }
  });
}

// -- Registra receita da venda no financeiro ao confirmar entrega --
export async function registrarReceitaVenda(o){
  try{
    let entries = S.financialEntries || [];
    // Evita duplicata: verifica se ja existe entrada para este pedido
    if(entries.find(e=>e.orderId===o._id && e.type==='receita')) return;
    const entry = {
      orderId: o._id,
      orderNumber: o.orderNumber,
      type: 'receita',
      categoria: 'Venda',
      descricao: `Venda ${o.orderNumber} — ${o.client?.name||o.clientName||'Cliente'}`,
      valor: o.total||0,
      payment: o.payment||'—',
      unit: o.unit||'—',
      status: 'Recebido',
      date: new Date().toISOString(),
      createdBy: S.user?.name||'Sistema',
    };
    const saved = await POST('/financial/entries', entry);
    if(saved && saved._id) entry._id = saved._id;
    if(!S.financialEntries) S.financialEntries = [];
    S.financialEntries.unshift(entry);
  }catch(e){ console.warn('registrarReceitaVenda:', e); }
}
