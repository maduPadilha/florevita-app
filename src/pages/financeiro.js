import { S } from '../state.js';
import { $c, $d, sc, rolec, paymentStatusBadge, esc } from '../utils/formatters.js';
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

  // Pedidos cancelados NAO contam pra comissoes
  const cancelledIds = new Set(
    (S.orders||[]).filter(o => o.status === 'Cancelado').map(o => String(o._id))
  );

  let vendas=0, comissao=0, montagens=0, expedicoes=0;
  acts.forEach(a=>{
    const byId   = ids.has(a.userId);
    const byEmail= (a.userEmail||'').toLowerCase()===emailLow;
    const byName = (a.userName||'').toLowerCase()===(colab.name||'').toLowerCase();
    const isMe   = byId || byEmail || byName;
    if(!isMe) return;
    if (a.orderId && cancelledIds.has(String(a.orderId))) return;
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
// Flag para evitar re-fetch a cada render
let _financialEntriesFetched = false;
async function _recuperarLancamentosBackend() {
  try {
    const beFe = await GET('/financial/entries').catch(() => null);
    if (!Array.isArray(beFe)) return;
    const localFe = JSON.parse(localStorage.getItem('fv_financial')||'[]');
    const mapa = new Map();
    localFe.forEach(e => { const k = e._id || e.id; if (k) mapa.set(String(k), e); });
    beFe.forEach(e => { const k = e._id || e.id; if (k) mapa.set(String(k), e); });
    const merged = [...mapa.values()];
    localStorage.setItem('fv_financial', JSON.stringify(merged));
    S.financialEntries = merged;
    import('../main.js').then(m => m.render && m.render()).catch(()=>{});
  } catch(_) {}
}

// Sync RH dados do backend (sobrevive a logout/login). Importante p/
// a aba 'Salarios, Vales e Retiradas' onde a Folha a Pagar precisa
// dos salarios cadastrados para gerar os compromissos automaticos.
let _rhDadosFetchedFin = false;
async function _syncRHDadosFin() {
  if (_rhDadosFetchedFin) return;
  _rhDadosFetchedFin = true;
  try {
    const r = await GET('/settings/rh-dados').catch(() => null);
    const beDados = r?.value || {};
    if (beDados && typeof beDados === 'object' && Object.keys(beDados).length) {
      const local = JSON.parse(localStorage.getItem('fv_rh_dados') || '{}');
      const merged = { ...local, ...beDados };
      localStorage.setItem('fv_rh_dados', JSON.stringify(merged));
      import('../main.js').then(m => m.render && m.render()).catch(()=>{});
    }
  } catch(_) {}
}

export function renderFinanceiro(){
  if (!_financialEntriesFetched) { _financialEntriesFetched = true; _recuperarLancamentosBackend(); }
  // Tambem dispara sync RH (para a aba Salarios funcionar com os dados
  // cadastrados em qualquer dispositivo)
  _syncRHDadosFin();

  const unit = ( S.user?.role==='Administrador'||S.user?.cargo==='admin')?S._finUnit||'':S.user.unit;
  const filteredOrders = unit
    ? unit==='E-commerce'
      ? S.orders.filter(o=>o.source==='E-commerce'||(o.source||'').toLowerCase().includes('ecomm'))
      : S.orders.filter(o=>o.unit===unit&&o.source!=='E-commerce')
    : S.orders;
  // Apenas pagamentos REALMENTE recebidos viram receita
  // "Ag. Pagamento na Entrega" ainda não foi pago — conta como pendente
  const PAGOS = ['Pago','Aprovado','Pago na Entrega'];
  const BLOQUEADOS = ['Cancelado','Negado','Extornado'];
  const receitas = filteredOrders.filter(o=>PAGOS.includes(o.paymentStatus)).reduce((s,o)=>s+(o.total||0),0);
  const pendente = filteredOrders.filter(o=>!PAGOS.includes(o.paymentStatus)&&o.status!=='Cancelado'&&!BLOQUEADOS.includes(o.paymentStatus)).reduce((s,o)=>s+(o.total||0),0);
  // FILTRO 'Conta Pessoal': esconde entradas marcadas como pessoal
  // de qualquer usuario que NAO seja admin (gerente/financeiro/contador
  // tambem nao veem). Backend tolera campo extra 'pessoal'.
  const _ehAdmin = S.user?.role === 'Administrador' || S.user?.cargo === 'admin' || String(S.user?.cargo||'').toLowerCase() === 'administrador';
  const contas = (S.financialEntries||[]).filter(c => _ehAdmin || c.pessoal !== true);
  // Aceita 'Despesa'/'despesa' (compat backend que normaliza para lowercase)
  const _isDespesa = c => String(c.type||'').toLowerCase() === 'despesa';
  const _isReceita = c => String(c.type||'').toLowerCase() === 'receita';
  const contasPagar = contas.filter(_isDespesa);
  const contasReceber = contas.filter(_isReceita);
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
  <button class="btn btn-ghost btn-sm" id="btn-fin-recuperar" title="Busca todos os lançamentos do servidor (recuperação de emergência)">⬇️ Recuperar do servidor</button>
</div>

<div class="g4" style="margin-bottom:16px;">
  <div class="mc leaf"><div class="mc-label">Receita Confirmada</div><div class="mc-val">${$c(receitas)}</div></div>
  <div class="mc gold"><div class="mc-label">A Receber</div><div class="mc-val">${$c(pendente)}</div></div>
  <div class="mc red" style="--red:#DC2626;"><div class="mc-label">Contas a Pagar</div><div class="mc-val" style="color:var(--red)">${$c(contasPagar.filter(c=>c.status==='Pendente').reduce((s,c)=>s+(c.value||0),0))}</div></div>
  <div class="mc purple"><div class="mc-label">Ticket Médio</div><div class="mc-val">${$c(filteredOrders.length?(receitas+pendente)/filteredOrders.length:0)}</div></div>
</div>

${(() => {
  // ── ABAS DO MODULO FINANCEIRO ────────────────────────────
  const aba = S._finAba || 'pedidos';
  const tabBtn = (k, label, badge='') => `<button type="button" class="tab ${aba===k?'active':''}" data-fin-aba="${k}" style="font-size:12px;">${label}${badge}</button>`;
  // Pessoais: aba so para admin
  const pendentesQtd = contasPagar.filter(c => c.status==='Pendente').length;
  const pessoaisQtd = (S.financialEntries||[]).filter(c => c.pessoal===true).length;

  return `
<div class="tabs" style="margin-bottom:14px;gap:5px;flex-wrap:wrap;">
  ${tabBtn('pedidos',   '💳 Pedidos')}
  ${tabBtn('receber',   '⏳ A Receber')}
  ${tabBtn('pagar',     '💸 A Pagar', pendentesQtd?` <span style="background:#DC2626;color:#fff;border-radius:10px;padding:0 6px;font-size:10px;margin-left:4px;">${pendentesQtd}</span>`:'')}
  ${tabBtn('pagas',     '✅ Pagas')}
  ${tabBtn('salarios',  '👥 Salários, Vales e Retiradas')}
  ${_ehAdmin && pessoaisQtd > 0 ? tabBtn('pessoais', '🔒 Contas Pessoais', ` <span style="background:#991B1B;color:#fff;border-radius:10px;padding:0 6px;font-size:10px;margin-left:4px;">${pessoaisQtd}</span>`) : ''}
  ${_ehAdmin && pessoaisQtd === 0 ? tabBtn('pessoais', '🔒 Contas Pessoais') : ''}
</div>

${aba === 'pedidos'  ? renderAbaPedidos(filteredOrders) : ''}
${aba === 'receber'  ? renderAbaContas(contas, 'receber',  _ehAdmin) : ''}
${aba === 'pagar'    ? renderAbaContas(contas, 'pagar',    _ehAdmin) : ''}
${aba === 'pagas'    ? renderAbaContas(contas, 'pagas',    _ehAdmin) : ''}
${aba === 'salarios' ? renderAbaSalarios() : ''}
${aba === 'pessoais' && _ehAdmin ? renderAbaPessoais() : ''}
`;
})()}`;
}

// ── RENDER ABA PEDIDOS — Status Financeiro ─────────────────
function renderAbaPedidos(filteredOrders) {
  return `
<div class="card">
  <div class="card-title">💳 Pedidos — Status Financeiro</div>
  ${filteredOrders.length===0 ? `<div class="empty"><div class="empty-icon">💰</div><p>Sem pedidos</p></div>` : `
  <div class="tw"><table>
    <thead><tr><th>#</th><th>Cliente</th><th>Total</th><th>Pgto</th><th>Status Pgto</th><th>Data</th><th></th></tr></thead>
    <tbody>${filteredOrders.slice(0,50).map(o=>`<tr>
      <td style="color:var(--rose);font-weight:600">${o.orderNumber||'—'}</td>
      <td>${o.client?.name||o.clientName||'—'}</td>
      <td style="font-weight:600">${$c(o.total)}</td>
      <td><span class="tag t-gray">${o.payment||'—'}</span></td>
      <td>${paymentStatusBadge(o.paymentStatus||'Ag. Pagamento')}</td>
      <td style="color:var(--muted);font-size:11px">${$d(o.createdAt)}</td>
      <td>${o.paymentStatus!=='Pago'?`<button class="btn btn-green btn-xs" data-mark-paid="${o._id}">✅ Pago</button>`:''}</td>
    </tr>`).join('')}</tbody>
  </table></div>
  ${filteredOrders.length > 50 ? `<div style="text-align:center;color:var(--muted);font-size:11px;margin-top:8px;">Mostrando 50 de ${filteredOrders.length} pedidos</div>` : ''}
  `}
</div>

<div class="card" style="margin-top:14px;">
  <div class="card-title">📊 Resumo por Forma de Pagamento</div>
  ${['Pix','Link','Cartão','Dinheiro','Pagar na Entrega','Bemol','Giuliana','iFood'].map(p=>{
    const tot = filteredOrders.filter(o=>o.payment===p).reduce((s,o)=>s+(o.total||0),0);
    const qty = filteredOrders.filter(o=>o.payment===p).length;
    if(!qty) return '';
    return `<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border);font-size:12px;">
      <span>${p} <span style="color:var(--muted)">(${qty} pedidos)</span></span>
      <span style="font-weight:600">${$c(tot)}</span>
    </div>`;
  }).join('')}
</div>
`;
}

// ── RENDER ABA CONTAS (a receber / a pagar / pagas) ────────
function renderAbaContas(contas, modo, ehAdmin) {
  // Filtros de periodo
  const periodo = S._finAbaPeriodo || 'todos';
  const d1 = S._finAbaD1 || '';
  const d2 = S._finAbaD2 || '';
  const hoje = new Date();
  let ini = null, fim = null;
  if (periodo === 'dia')    { ini = new Date(hoje); ini.setHours(0,0,0,0); fim = new Date(hoje); fim.setHours(23,59,59,999); }
  else if (periodo === 'semana') { ini = new Date(hoje); ini.setDate(hoje.getDate()-hoje.getDay()); ini.setHours(0,0,0,0); fim = new Date(ini); fim.setDate(ini.getDate()+6); fim.setHours(23,59,59,999); }
  else if (periodo === 'mes')    { ini = new Date(hoje.getFullYear(), hoje.getMonth(), 1); fim = new Date(hoje.getFullYear(), hoje.getMonth()+1, 0, 23,59,59,999); }
  else if (periodo === 'mes_ant'){ ini = new Date(hoje.getFullYear(), hoje.getMonth()-1, 1); fim = new Date(hoje.getFullYear(), hoje.getMonth(), 0, 23,59,59,999); }
  else if (periodo === 'ano')    { ini = new Date(hoje.getFullYear(), 0, 1); fim = new Date(hoje.getFullYear(), 11, 31, 23,59,59,999); }
  else if (periodo === 'custom') { if (d1) ini = new Date(d1+'T00:00:00'); if (d2) fim = new Date(d2+'T23:59:59'); }

  const _isDespesa = c => String(c.type||'').toLowerCase() === 'despesa';
  const _isReceita = c => String(c.type||'').toLowerCase() === 'receita';
  const _isPago    = c => String(c.status||'').toLowerCase() === 'pago' || String(c.status||'').toLowerCase() === 'recebido';
  const _dataRef   = c => c.dueDate || c.date || c.createdAt;
  const _noPeriodo = c => {
    if (!ini && !fim) return true;
    const dr = _dataRef(c); if (!dr) return false;
    const d = new Date(dr);
    if (ini && d < ini) return false;
    if (fim && d > fim) return false;
    return true;
  };

  // Filtra (excluindo pessoais quando nao for admin — ja foi feito antes mas reforço)
  let lista = contas.filter(_noPeriodo);
  if (modo === 'receber')  lista = lista.filter(c => _isReceita(c) && !_isPago(c));
  else if (modo === 'pagar') lista = lista.filter(c => _isDespesa(c) && !_isPago(c));
  else if (modo === 'pagas') lista = lista.filter(c => _isPago(c));

  const totalGeral = lista.reduce((s,c) => s+(Number(c.value||c.valor)||0), 0);
  const titulo = { receber:'⏳ Contas a Receber', pagar:'💸 Contas a Pagar', pagas:'✅ Contas Pagas' }[modo] || '';
  const corBase = modo==='receber' ? '#F59E0B' : modo==='pagar' ? '#DC2626' : '#15803D';

  const perBtn = (k, l) => `<button type="button" class="btn btn-sm ${periodo===k?'btn-primary':'btn-ghost'}" data-fin-aba-periodo="${k}">${l}</button>`;
  const fmtData = (iso) => { if (!iso) return '—'; const d = new Date(iso); if (isNaN(d)) return iso; return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`; };

  return `
<!-- Filtros de periodo -->
<div class="card" style="margin-bottom:14px;padding:12px;background:linear-gradient(135deg,#FAE8E6,#FFF7F5);border:1px solid #FECDD3;">
  <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
    <span style="font-size:11px;font-weight:800;color:#9F1239;text-transform:uppercase;">📅 Período:</span>
    ${perBtn('todos',  'Todos')}
    ${perBtn('dia',    'Hoje')}
    ${perBtn('semana', 'Semana')}
    ${perBtn('mes',    'Mês')}
    ${perBtn('mes_ant','Mês Ant.')}
    ${perBtn('ano',    'Ano')}
    ${perBtn('custom', '📅 Datas')}
    <span style="margin-left:auto;font-size:11px;color:#9F1239;font-weight:700;">${lista.length} registro(s) · ${$c(totalGeral)}</span>
  </div>
  ${periodo === 'custom' ? `
  <div style="display:flex;gap:10px;align-items:center;margin-top:10px;padding-top:10px;border-top:1px dashed #FECDD3;">
    <input type="date" class="fi" id="fin-aba-d1" value="${d1}" style="width:auto;font-size:12px;"/>
    <span style="font-size:11px;color:var(--muted);">a</span>
    <input type="date" class="fi" id="fin-aba-d2" value="${d2}" style="width:auto;font-size:12px;"/>
  </div>
  ` : ''}
</div>

<div class="card">
  <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
    <span>${titulo}</span>
    <span style="font-size:13px;font-weight:900;color:${corBase};">${$c(totalGeral)}</span>
  </div>
  ${lista.length === 0 ? `<div class="empty"><p>Nenhum registro neste período/filtro.</p></div>` : `
  <div style="overflow-x:auto;">
    <table style="width:100%;font-size:12px;border-collapse:collapse;">
      <thead><tr style="background:#FAFAFA;border-bottom:1px solid var(--border);">
        <th style="padding:8px;text-align:left;font-size:10px;color:#94A3B8;text-transform:uppercase;">${modo==='pagas'?'Data Pgto':'Vencimento'}</th>
        <th style="padding:8px;text-align:left;font-size:10px;color:#94A3B8;text-transform:uppercase;">Descrição</th>
        <th style="padding:8px;text-align:left;font-size:10px;color:#94A3B8;text-transform:uppercase;">Categoria</th>
        <th style="padding:8px;text-align:left;font-size:10px;color:#94A3B8;text-transform:uppercase;">Unidade</th>
        <th style="padding:8px;text-align:right;font-size:10px;color:#94A3B8;text-transform:uppercase;">Valor</th>
        <th style="padding:8px;text-align:center;font-size:10px;color:#94A3B8;text-transform:uppercase;">Status</th>
        <th style="padding:8px;text-align:center;font-size:10px;color:#94A3B8;text-transform:uppercase;">Quem</th>
        <th style="padding:8px;text-align:center;font-size:10px;color:#94A3B8;text-transform:uppercase;">Ações</th>
      </tr></thead>
      <tbody>
        ${lista.sort((a,b) => new Date(_dataRef(b)) - new Date(_dataRef(a))).map(c => {
          const valor = Number(c.value||c.valor)||0;
          const eRec = _isReceita(c);
          const pago = _isPago(c);
          const venc = !pago && _isDespesa(c) && c.dueDate && new Date(c.dueDate) < hoje;
          const badgePessoal = c.pessoal ? `<span style="background:#FEE2E2;color:#991B1B;border:1px solid #FCA5A5;border-radius:4px;padding:1px 5px;font-size:9px;font-weight:700;margin-left:4px;">🔒</span>` : '';
          const id = c._id||c.id;
          return `<tr style="border-bottom:1px solid #F1F5F9;${c.pessoal?'background:#FEF2F2;':''}${venc?'background:#FFE4E6;':''}">
            <td style="padding:6px 8px;font-size:11px;color:var(--muted);">${fmtData(_dataRef(c))}</td>
            <td style="padding:6px 8px;font-weight:600;">${esc(c.description||c.descricao||'—')}${badgePessoal}${c.supplier?`<div style="font-size:10px;color:var(--muted);">${esc(c.supplier)}</div>`:''}</td>
            <td style="padding:6px 8px;font-size:11px;">${esc(c.category||c.categoria||'—')}</td>
            <td style="padding:6px 8px;font-size:11px;color:var(--muted);">${esc(c.unit||'Todas')}</td>
            <td style="padding:6px 8px;text-align:right;font-weight:800;color:${eRec?'#15803D':'#991B1B'};">${$c(valor)}</td>
            <td style="padding:6px 8px;text-align:center;">
              <span style="background:${pago?'#DCFCE7':venc?'#FEE2E2':'#FEF3C7'};color:${pago?'#15803D':venc?'#991B1B':'#92400E'};border-radius:6px;padding:2px 7px;font-size:10px;font-weight:700;">${pago?'✅ '+(c.status||'Pago'):venc?'⚠️ Vencida':'⏳ '+(c.status||'Pendente')}</span>
            </td>
            <td style="padding:6px 8px;text-align:center;font-size:10px;color:var(--muted);">${esc(c.createdBy||c.user||'—')}</td>
            <td style="padding:6px 8px;text-align:center;white-space:nowrap;">
              ${!pago && _isDespesa(c) ? `<button class="btn btn-green btn-xs" data-pay-bill="${id}" title="Pagar">💸</button>` : ''}
              ${!pago && eRec ? `<button class="btn btn-green btn-xs" data-receive-bill="${id}" title="Receber">✅</button>` : ''}
              <button class="btn btn-ghost btn-xs" data-fin-edit="${id}" title="Editar" style="color:#1E40AF;">✏️</button>
              <button class="btn btn-ghost btn-xs" data-fin-del="${id}" style="color:var(--red);" title="Excluir">🗑️</button>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>
  `}
</div>
`;
}

// ── RENDER ABA SALARIOS, VALES E RETIRADAS ────────────────
function renderAbaSalarios() {
  return renderFolhaAPagar() + renderVales() + renderComissoesMetas();
}

// ── RENDER ABA CONTAS PESSOAIS (admin only) ───────────────
function renderAbaPessoais() {
  const hoje = new Date();
  const _isDespesa = c => String(c.type||'').toLowerCase() === 'despesa';
  const _isReceita = c => String(c.type||'').toLowerCase() === 'receita';
  const _isPago    = c => String(c.status||'').toLowerCase() === 'pago' || String(c.status||'').toLowerCase() === 'recebido';
  const _dataRef   = c => c.dueDate || c.date || c.createdAt;

  // Apenas pessoais
  const pessoais = (S.financialEntries||[]).filter(c => c.pessoal === true);
  const receberPess = pessoais.filter(c => _isReceita(c) && !_isPago(c));
  const pagarPess   = pessoais.filter(c => _isDespesa(c) && !_isPago(c));
  const pagasPess   = pessoais.filter(c => _isPago(c));

  const totReceber = receberPess.reduce((s,c) => s+(Number(c.value||c.valor)||0), 0);
  const totPagar   = pagarPess.reduce((s,c) => s+(Number(c.value||c.valor)||0), 0);
  const totPagas   = pagasPess.reduce((s,c) => s+(Number(c.value||c.valor)||0), 0);
  const fmtData = (iso) => { if (!iso) return '—'; const d = new Date(iso); if (isNaN(d)) return iso; return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`; };

  if (!pessoais.length) {
    return `<div class="card" style="background:linear-gradient(135deg,#FEE2E2,#FEF2F2);border:1px solid #FCA5A5;text-align:center;padding:40px;">
      <div style="font-size:48px;">🔒</div>
      <p style="margin:10px 0;color:#991B1B;font-weight:700;">Você ainda não cadastrou nenhuma Conta Pessoal.</p>
      <p style="font-size:12px;color:#991B1B;opacity:.85;">Clique em <strong>+ Receita</strong> ou <strong>+ Despesa</strong> e marque o checkbox 🔒 Conta Pessoal. Apenas você (ADM) verá aqui.</p>
    </div>`;
  }

  const renderCard = (lista, titulo, cor, corBg) => `
    <div class="card" style="margin-bottom:14px;border-left:4px solid ${cor};">
      <div class="card-title" style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;">
        <span>${titulo}</span>
        <span style="color:${cor};font-weight:900;">${$c(lista.reduce((s,c)=>s+(Number(c.value||c.valor)||0),0))}</span>
      </div>
      ${lista.length === 0 ? `<div style="text-align:center;padding:14px;color:var(--muted);font-size:12px;">Nenhuma</div>` : `
      <div style="overflow-x:auto;">
        <table style="width:100%;font-size:12px;border-collapse:collapse;">
          <thead><tr style="background:${corBg};">
            <th style="padding:6px 8px;text-align:left;font-size:10px;color:${cor};text-transform:uppercase;">Data</th>
            <th style="padding:6px 8px;text-align:left;font-size:10px;color:${cor};text-transform:uppercase;">Descrição</th>
            <th style="padding:6px 8px;text-align:left;font-size:10px;color:${cor};text-transform:uppercase;">Categoria</th>
            <th style="padding:6px 8px;text-align:right;font-size:10px;color:${cor};text-transform:uppercase;">Valor</th>
            <th style="padding:6px 8px;text-align:center;font-size:10px;color:${cor};text-transform:uppercase;">Ações</th>
          </tr></thead>
          <tbody>
            ${lista.sort((a,b) => new Date(_dataRef(b)) - new Date(_dataRef(a))).map(c => {
              const valor = Number(c.value||c.valor)||0;
              const id = c._id||c.id;
              const eRec = _isReceita(c);
              const pago = _isPago(c);
              return `<tr style="border-bottom:1px solid #F1F5F9;">
                <td style="padding:6px 8px;font-size:11px;color:var(--muted);">${fmtData(_dataRef(c))}</td>
                <td style="padding:6px 8px;font-weight:600;">${esc(c.description||c.descricao||'—')}${c.supplier?`<div style="font-size:10px;color:var(--muted);">${esc(c.supplier)}</div>`:''}</td>
                <td style="padding:6px 8px;font-size:11px;">${esc(c.category||c.categoria||'—')}</td>
                <td style="padding:6px 8px;text-align:right;font-weight:800;color:${cor};">${$c(valor)}</td>
                <td style="padding:6px 8px;text-align:center;white-space:nowrap;">
                  ${!pago && eRec ? `<button class="btn btn-green btn-xs" data-receive-bill="${id}" title="Receber">✅</button>` : ''}
                  ${!pago && _isDespesa(c) ? `<button class="btn btn-green btn-xs" data-pay-bill="${id}" title="Pagar">💸</button>` : ''}
                  <button class="btn btn-ghost btn-xs" data-fin-edit="${id}" title="Editar" style="color:#1E40AF;">✏️</button>
                  <button class="btn btn-ghost btn-xs" data-fin-del="${id}" style="color:var(--red);" title="Excluir">🗑️</button>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      `}
    </div>`;

  return `
<div class="card" style="margin-bottom:14px;background:linear-gradient(135deg,#FEE2E2,#FEF2F2);border:2px solid #FCA5A5;">
  <div style="display:flex;align-items:center;gap:10px;">
    <span style="font-size:32px;">🔒</span>
    <div>
      <div style="font-family:'Playfair Display',serif;font-size:18px;color:#991B1B;">Contas Pessoais</div>
      <div style="font-size:12px;color:#991B1B;opacity:.85;">Apenas você (ADM) vê estas contas. Não aparecem em relatórios da empresa.</div>
    </div>
    <div style="margin-left:auto;text-align:right;">
      <div style="font-size:10px;color:#991B1B;text-transform:uppercase;font-weight:700;">Saldo (Receber − Pagar)</div>
      <div style="font-size:20px;font-weight:900;color:${(totReceber-totPagar)>=0?'#15803D':'#991B1B'};">${$c(totReceber - totPagar)}</div>
    </div>
  </div>
</div>

${renderCard(receberPess, '⏳ Pessoais a Receber', '#F59E0B', '#FEF3C7')}
${renderCard(pagarPess,   '💸 Pessoais a Pagar',   '#DC2626', '#FEE2E2')}
${renderCard(pagasPess,   '✅ Pessoais Pagas',     '#15803D', '#DCFCE7')}
`;
}

// ── CENTRAL FINANCEIRA — listagem com tabs + filtros + grafico ──
function renderCentralFinanceira(contas) {
  const tab     = S._finTab     || 'todas'; // todas | a_receber | recebidas | a_pagar | pagas
  const periodo = S._finPeriodo || 'mes';   // dia | semana | mes | ano | custom | todos
  const cat     = S._finCategoria || '';
  const d1      = S._finCD1 || '';
  const d2      = S._finCD2 || '';

  // Range do periodo
  const hoje = new Date();
  let ini = null, fim = null;
  if (periodo === 'dia')    { ini = new Date(hoje); ini.setHours(0,0,0,0); fim = new Date(hoje); fim.setHours(23,59,59,999); }
  else if (periodo === 'semana') { ini = new Date(hoje); ini.setDate(hoje.getDate()-hoje.getDay()); ini.setHours(0,0,0,0); fim = new Date(ini); fim.setDate(ini.getDate()+6); fim.setHours(23,59,59,999); }
  else if (periodo === 'mes')    { ini = new Date(hoje.getFullYear(), hoje.getMonth(), 1); fim = new Date(hoje.getFullYear(), hoje.getMonth()+1, 0, 23,59,59,999); }
  else if (periodo === 'ano')    { ini = new Date(hoje.getFullYear(), 0, 1); fim = new Date(hoje.getFullYear(), 11, 31, 23,59,59,999); }
  else if (periodo === 'custom') {
    if (d1) ini = new Date(d1+'T00:00:00');
    if (d2) fim = new Date(d2+'T23:59:59');
  }
  // todos: sem filtro

  // Filtra
  const _isDespesa = c => String(c.type||'').toLowerCase() === 'despesa';
  const _isReceita = c => String(c.type||'').toLowerCase() === 'receita';
  const _isPago    = c => String(c.status||'').toLowerCase() === 'pago' || String(c.status||'').toLowerCase() === 'recebido';
  const _dataRef   = c => c.dueDate || c.date || c.createdAt;
  const _noPeriodo = c => {
    if (!ini && !fim) return true;
    const dr = _dataRef(c); if (!dr) return false;
    const d = new Date(dr);
    if (ini && d < ini) return false;
    if (fim && d > fim) return false;
    return true;
  };

  let lista = contas.filter(_noPeriodo);
  if (cat) lista = lista.filter(c => String(c.category||c.categoria||'') === cat);
  if (tab === 'a_receber') lista = lista.filter(c => _isReceita(c) && !_isPago(c));
  else if (tab === 'recebidas') lista = lista.filter(c => _isReceita(c) && _isPago(c));
  else if (tab === 'a_pagar') lista = lista.filter(c => _isDespesa(c) && !_isPago(c));
  else if (tab === 'pagas') lista = lista.filter(c => _isDespesa(c) && _isPago(c));

  // Categorias unicas para filtro
  const categorias = [...new Set(contas.map(c => c.category||c.categoria||'').filter(Boolean))].sort();

  // KPIs do periodo
  const filtPer = contas.filter(_noPeriodo);
  const totReceber = filtPer.filter(c => _isReceita(c) && !_isPago(c)).reduce((s,c)=>s+(Number(c.value||c.valor)||0),0);
  const totRecebido = filtPer.filter(c => _isReceita(c) && _isPago(c)).reduce((s,c)=>s+(Number(c.value||c.valor)||0),0);
  const totPagar = filtPer.filter(c => _isDespesa(c) && !_isPago(c)).reduce((s,c)=>s+(Number(c.value||c.valor)||0),0);
  const totPago = filtPer.filter(c => _isDespesa(c) && _isPago(c)).reduce((s,c)=>s+(Number(c.value||c.valor)||0),0);
  const saldoProj = (totRecebido + totReceber) - (totPago + totPagar);

  // Grafico de projecao: por mes (12 meses contando do mes corrente -6 a +5)
  const meses = [];
  for (let i = -5; i <= 6; i++) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth()+i, 1);
    meses.push({ y: d.getFullYear(), m: d.getMonth(), label: ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][d.getMonth()] + '/' + String(d.getFullYear()).slice(2) });
  }
  const dadosMes = meses.map(({y,m,label}) => {
    const ini2 = new Date(y, m, 1);
    const fim2 = new Date(y, m+1, 0, 23,59,59,999);
    const noMes = c => { const dr = _dataRef(c); if (!dr) return false; const d = new Date(dr); return d>=ini2 && d<=fim2; };
    return {
      label,
      receitas: contas.filter(c => _isReceita(c) && noMes(c)).reduce((s,c)=>s+(Number(c.value||c.valor)||0),0),
      despesas: contas.filter(c => _isDespesa(c) && noMes(c)).reduce((s,c)=>s+(Number(c.value||c.valor)||0),0),
      atual: y === hoje.getFullYear() && m === hoje.getMonth(),
    };
  });
  const maxValMes = Math.max(1, ...dadosMes.map(d => Math.max(d.receitas, d.despesas)));

  const tabBtn = (k, label) => `<button type="button" class="btn btn-sm ${tab===k?'btn-primary':'btn-ghost'}" data-fin-tab="${k}">${label}</button>`;
  const perBtn = (k, label) => `<button type="button" class="btn btn-sm ${periodo===k?'btn-primary':'btn-ghost'}" data-fin-periodo="${k}">${label}</button>`;
  const fmtData = (iso) => { if (!iso) return '—'; const d = new Date(iso); if (isNaN(d)) return iso; return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`; };

  return `
<!-- FILTROS DE PERIODO + CATEGORIA -->
<div class="card" style="margin-bottom:14px;padding:12px;background:linear-gradient(135deg,#FAE8E6,#FFF7F5);border:1px solid #FECDD3;">
  <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px;">
    <span style="font-size:11px;font-weight:800;color:#9F1239;text-transform:uppercase;">📅 Período:</span>
    ${perBtn('dia',    'Hoje')}
    ${perBtn('semana', 'Semana')}
    ${perBtn('mes',    'Mês')}
    ${perBtn('ano',    'Ano')}
    ${perBtn('todos',  'Todos')}
    ${perBtn('custom', '📅 Custom')}
  </div>
  ${periodo === 'custom' ? `
  <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px;">
    <span style="font-size:11px;color:#9F1239;font-weight:700;">📅</span>
    <input type="date" class="fi" id="fin-cd1" value="${d1}" style="width:auto;font-size:12px;"/>
    <span style="font-size:11px;color:var(--muted);">a</span>
    <input type="date" class="fi" id="fin-cd2" value="${d2}" style="width:auto;font-size:12px;"/>
  </div>
  ` : ''}
  <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
    <span style="font-size:11px;font-weight:800;color:#9F1239;text-transform:uppercase;">🏷️ Categoria:</span>
    <select class="fi" id="fin-categoria" style="width:auto;font-size:12px;">
      <option value="">Todas</option>
      ${categorias.map(c => `<option value="${esc(c)}" ${cat===c?'selected':''}>${esc(c)}</option>`).join('')}
    </select>
    <span style="margin-left:auto;font-size:11px;color:var(--muted);">${lista.length} registro(s) no filtro</span>
  </div>
</div>

<!-- KPIs do PERIODO + projecao -->
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin-bottom:14px;">
  <div style="background:#DCFCE7;border:1px solid #86EFAC;border-radius:8px;padding:10px;">
    <div style="font-size:10px;color:#15803D;text-transform:uppercase;font-weight:700;">✅ Recebido no período</div>
    <div style="font-size:18px;font-weight:900;color:#15803D;">${$c(totRecebido)}</div>
  </div>
  <div style="background:#FEF3C7;border:1px solid #FCD34D;border-radius:8px;padding:10px;">
    <div style="font-size:10px;color:#92400E;text-transform:uppercase;font-weight:700;">⏳ A Receber</div>
    <div style="font-size:18px;font-weight:900;color:#92400E;">${$c(totReceber)}</div>
  </div>
  <div style="background:#FEE2E2;border:1px solid #FCA5A5;border-radius:8px;padding:10px;">
    <div style="font-size:10px;color:#991B1B;text-transform:uppercase;font-weight:700;">💸 A Pagar</div>
    <div style="font-size:18px;font-weight:900;color:#991B1B;">${$c(totPagar)}</div>
  </div>
  <div style="background:#F3F4F6;border:1px solid #D1D5DB;border-radius:8px;padding:10px;">
    <div style="font-size:10px;color:#4B5563;text-transform:uppercase;font-weight:700;">🧾 Pago</div>
    <div style="font-size:18px;font-weight:900;color:#4B5563;">${$c(totPago)}</div>
  </div>
  <div style="background:${saldoProj>=0?'#DBEAFE':'#FEE2E2'};border:2px solid ${saldoProj>=0?'#1E40AF':'#DC2626'};border-radius:8px;padding:10px;">
    <div style="font-size:10px;color:${saldoProj>=0?'#1E40AF':'#991B1B'};text-transform:uppercase;font-weight:700;">📊 Saldo projetado</div>
    <div style="font-size:18px;font-weight:900;color:${saldoProj>=0?'#1E40AF':'#991B1B'};">${$c(saldoProj)}</div>
  </div>
</div>

<!-- GRAFICO 12 MESES -->
<div class="card" style="margin-bottom:14px;">
  <div class="card-title" style="margin-bottom:10px;">📊 Projeção Mensal — Receitas vs Despesas (12 meses)</div>
  <div style="display:flex;align-items:flex-end;gap:6px;height:160px;padding:0 8px;border-bottom:2px solid var(--border);">
    ${dadosMes.map(d => {
      const altR = (d.receitas / maxValMes) * 140;
      const altD = (d.despesas / maxValMes) * 140;
      return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;${d.atual?'background:#FAE8E6;border-radius:4px 4px 0 0;padding:0 2px;':''}">
        <div style="display:flex;gap:2px;align-items:flex-end;height:140px;width:100%;">
          <div title="Receitas: ${$c(d.receitas)}" style="flex:1;background:linear-gradient(180deg,#15803D,#86EFAC);height:${altR}px;border-radius:3px 3px 0 0;min-height:${d.receitas>0?'2px':'0'};"></div>
          <div title="Despesas: ${$c(d.despesas)}" style="flex:1;background:linear-gradient(180deg,#DC2626,#FCA5A5);height:${altD}px;border-radius:3px 3px 0 0;min-height:${d.despesas>0?'2px':'0'};"></div>
        </div>
        <div style="font-size:9px;color:${d.atual?'#9F1239':'var(--muted)'};font-weight:${d.atual?'800':'500'};white-space:nowrap;">${d.label}</div>
      </div>`;
    }).join('')}
  </div>
  <div style="display:flex;justify-content:center;gap:14px;margin-top:8px;font-size:11px;">
    <span style="display:inline-flex;align-items:center;gap:4px;"><span style="width:12px;height:12px;background:#15803D;border-radius:2px;"></span>Receitas</span>
    <span style="display:inline-flex;align-items:center;gap:4px;"><span style="width:12px;height:12px;background:#DC2626;border-radius:2px;"></span>Despesas</span>
    <span style="color:var(--muted);">· Mês corrente destacado em rosa</span>
  </div>
</div>

<!-- TABS DE LISTAGEM -->
<div class="card" style="margin-bottom:14px;">
  <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;border-bottom:1px solid var(--border);padding-bottom:10px;">
    ${tabBtn('todas',     'Todas')}
    ${tabBtn('a_receber', '⏳ A Receber')}
    ${tabBtn('recebidas', '✅ Recebidas')}
    ${tabBtn('a_pagar',   '💸 A Pagar')}
    ${tabBtn('pagas',     '🧾 Pagas')}
  </div>
  ${lista.length === 0 ? `<div class="empty" style="padding:30px;"><p>Nenhum registro encontrado neste filtro.</p></div>` : `
  <div style="overflow-x:auto;">
    <table style="width:100%;font-size:12px;border-collapse:collapse;">
      <thead><tr style="background:#FAFAFA;">
        <th style="padding:8px;text-align:left;font-size:10px;color:#94A3B8;text-transform:uppercase;">Data</th>
        <th style="padding:8px;text-align:left;font-size:10px;color:#94A3B8;text-transform:uppercase;">Tipo</th>
        <th style="padding:8px;text-align:left;font-size:10px;color:#94A3B8;text-transform:uppercase;">Descrição</th>
        <th style="padding:8px;text-align:left;font-size:10px;color:#94A3B8;text-transform:uppercase;">Categoria</th>
        <th style="padding:8px;text-align:left;font-size:10px;color:#94A3B8;text-transform:uppercase;">Unidade</th>
        <th style="padding:8px;text-align:right;font-size:10px;color:#94A3B8;text-transform:uppercase;">Valor</th>
        <th style="padding:8px;text-align:center;font-size:10px;color:#94A3B8;text-transform:uppercase;">Status</th>
        <th style="padding:8px;text-align:center;font-size:10px;color:#94A3B8;text-transform:uppercase;">Quem</th>
        <th style="padding:8px;text-align:center;font-size:10px;color:#94A3B8;text-transform:uppercase;">Ação</th>
      </tr></thead>
      <tbody>
        ${lista.sort((a,b) => new Date(_dataRef(b)) - new Date(_dataRef(a))).slice(0,200).map(c => {
          const valor = Number(c.value||c.valor)||0;
          const eRec  = _isReceita(c);
          const pago  = _isPago(c);
          const venc  = !pago && _isDespesa(c) && c.dueDate && new Date(c.dueDate) < hoje;
          const badgePessoal = c.pessoal ? `<span style="background:#FEE2E2;color:#991B1B;border:1px solid #FCA5A5;border-radius:4px;padding:1px 5px;font-size:9px;font-weight:700;margin-left:4px;">🔒</span>` : '';
          return `<tr style="border-bottom:1px solid #F1F5F9;${c.pessoal?'background:#FEF2F2;':''}${venc?'background:#FFE4E6;':''}">
            <td style="padding:6px 8px;font-size:11px;color:var(--muted);">${fmtData(_dataRef(c))}</td>
            <td style="padding:6px 8px;">
              <span style="background:${eRec?'#DCFCE7':'#FEE2E2'};color:${eRec?'#15803D':'#991B1B'};border-radius:6px;padding:2px 7px;font-size:10px;font-weight:700;">${eRec?'💰 Receita':'💸 Despesa'}</span>
            </td>
            <td style="padding:6px 8px;font-weight:600;">${esc(c.description||c.descricao||'—')}${badgePessoal}${c.supplier?`<div style="font-size:10px;color:var(--muted);">${esc(c.supplier)}</div>`:''}</td>
            <td style="padding:6px 8px;font-size:11px;">${esc(c.category||c.categoria||'—')}</td>
            <td style="padding:6px 8px;font-size:11px;color:var(--muted);">${esc(c.unit||'Todas')}</td>
            <td style="padding:6px 8px;text-align:right;font-weight:800;color:${eRec?'#15803D':'#991B1B'};">${$c(valor)}</td>
            <td style="padding:6px 8px;text-align:center;">
              <span style="background:${pago?'#DCFCE7':venc?'#FEE2E2':'#FEF3C7'};color:${pago?'#15803D':venc?'#991B1B':'#92400E'};border-radius:6px;padding:2px 7px;font-size:10px;font-weight:700;">${pago?'✅ '+(c.status||'Pago'):venc?'⚠️ Vencida':'⏳ '+(c.status||'Pendente')}</span>
            </td>
            <td style="padding:6px 8px;text-align:center;font-size:10px;color:var(--muted);">${esc(c.createdBy||c.user||'—')}</td>
            <td style="padding:6px 8px;text-align:center;white-space:nowrap;">
              ${!pago && _isDespesa(c) ? `<button class="btn btn-green btn-xs" data-pay-bill="${c._id||c.id}" title="Pagar">💸</button>` : ''}
              ${!pago && eRec ? `<button class="btn btn-green btn-xs" data-receive-bill="${c._id||c.id}" title="Receber">✅</button>` : ''}
              <button class="btn btn-ghost btn-xs" data-fin-edit="${c._id||c.id}" title="Editar" style="color:#1E40AF;">✏️</button>
              <button class="btn btn-ghost btn-xs" data-fin-del="${c._id||c.id}" style="color:var(--red);" title="Excluir">🗑️</button>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    ${lista.length > 200 ? `<div style="text-align:center;padding:8px;color:var(--muted);font-size:11px;">Mostrando 200 de ${lista.length} registros — refine os filtros.</div>` : ''}
  </div>
  `}
</div>
`;
}

// ── FOLHA A PAGAR (automatico) ───────────────────────────────
// Gera dinamicamente os compromissos de RH:
//   - ADIANTAMENTO: vence dia 20 de CADA MES (50% do salario base)
//   - SALARIO:      vence 5o dia util do MES SEGUINTE (liquido estimado)
// Status:
//   - 'Pago' se ja existe folha (fv_rh_folhas) do tipo correspondente
//     no mesAno marcador
//   - 'Pendente' caso contrario
// Mostra os meses: anterior + corrente + proximo (3 meses de visao)
function renderFolhaAPagar() {
  // So Admin / Gerente / Financeiro / Contador veem
  const role = String(S.user?.role||'').toLowerCase();
  const cargo = String(S.user?.cargo||'').toLowerCase();
  const ehAdm = role === 'administrador' || cargo === 'admin';
  const ehGer = role === 'gerente' || cargo === 'gerente';
  const ehFin = cargo === 'financeiro';
  const ehCnt = cargo === 'contador';
  if (!ehAdm && !ehGer && !ehFin && !ehCnt) return '';

  // Carrega dados RH e folhas existentes
  let dadosAll = {};
  let folhas = [];
  try { dadosAll = JSON.parse(localStorage.getItem('fv_rh_dados')||'{}'); } catch(_){}
  try { folhas = JSON.parse(localStorage.getItem('fv_rh_folhas')||'[]'); } catch(_){}

  // Vales em aberto por colab (vao desconta no salario)
  let vales = [];
  try { vales = JSON.parse(localStorage.getItem('fv_vales')||'[]'); } catch(_){}
  const valesAbertosPorColab = {};
  vales.filter(v => v.status === 'Aberto').forEach(v => {
    const k = String(v.colabKey||'');
    valesAbertosPorColab[k] = (valesAbertosPorColab[k]||0) + (Number(v.valor)||0);
  });

  // INSS calc inline (mesma tabela 2026)
  const _inss = (sal) => {
    const F = [{ate:1621,a:0.075},{ate:2902.84,a:0.09},{ate:4354.27,a:0.12},{ate:8475.55,a:0.14}];
    let restante = Number(sal)||0;
    if (restante <= 0) return 0;
    const teto = F[F.length-1].ate;
    const base = Math.min(restante, teto);
    let valor = 0, anterior = 0;
    for (const f of F) {
      if (base <= anterior) break;
      const trib = Math.min(base, f.ate) - anterior;
      if (trib > 0) valor += trib * f.a;
      anterior = f.ate;
      if (base <= f.ate) break;
    }
    return Math.round(valor*100)/100;
  };

  // Lista de colabs ativos com salario cadastrado
  let colabs = [];
  try { colabs = JSON.parse(localStorage.getItem('fv_colabs')||'[]').filter(c => c.active !== false); } catch(_){}
  const _colabKey = (c) => String(c?._id || c?.id || c?.backendId || c?.email || c?.name || '');
  const colabsComSalario = colabs.filter(c => {
    const d = dadosAll[_colabKey(c)] || {};
    return Number(d.salarioBase) > 0;
  });

  if (!colabsComSalario.length) {
    // Mostra bloco com mensagem ao inves de retornar vazio — assim o
    // usuario entende por que os salarios nao aparecem e como resolver.
    return `
<div class="card" style="margin-top:14px;background:linear-gradient(135deg,#FEF3C7,#FFFBEB);border:1px solid #FCD34D;">
  <div style="display:flex;align-items:flex-start;gap:14px;">
    <div style="font-size:36px;">🗓️</div>
    <div style="flex:1;">
      <div style="font-weight:800;color:#92400E;font-size:16px;">Folha a Pagar (Automático) — Sem dados</div>
      <p style="font-size:13px;color:#92400E;margin:6px 0;">
        Nenhum colaborador tem <strong>salário base cadastrado</strong> no módulo RH ainda.
        Por isso os compromissos de salário e adiantamento de Maio (e qualquer outro mês) não aparecem aqui.
      </p>
      <p style="font-size:11px;color:#92400E;opacity:.85;margin-bottom:10px;">
        Quando você cadastrar o salário base de pelo menos 1 colaboradora em
        <strong>RH → Folha de Pagamento → Dados RH</strong>, os compromissos vão aparecer automaticamente:
      </p>
      <ul style="font-size:11px;color:#92400E;margin:6px 0 12px 18px;line-height:1.6;">
        <li>💵 <strong>Adiantamento</strong> — vence dia <strong>20</strong> de cada mês (50% do salário base)</li>
        <li>💼 <strong>Salário</strong> — vence dia <strong>5</strong> do mês seguinte</li>
      </ul>
      <button class="btn btn-primary btn-sm" onclick="window.S._rhSub='folha';window.S._rhFolhaSub='list';window.setPage('rh');">📄 Ir para Cadastro RH</button>
    </div>
  </div>
</div>`;
  }

  // Gera meses: anterior, corrente, proximo
  const hoje = new Date();
  const meses = [
    new Date(hoje.getFullYear(), hoje.getMonth()-1, 1),
    new Date(hoje.getFullYear(), hoje.getMonth(), 1),
    new Date(hoje.getFullYear(), hoje.getMonth()+1, 1),
  ];
  const mesNomes = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

  // Linhas (uma por compromisso)
  const linhas = [];
  for (const c of colabsComSalario) {
    const k = _colabKey(c);
    const d = dadosAll[k] || {};
    const sal = Number(d.salarioBase)||0;
    const vt = Number(d.valeTransporte)||0;
    const inssV = _inss(sal);
    const valeAbertoTotal = valesAbertosPorColab[k] || 0;
    const valeMes = sal * 0.5; // 50% do salario base = adiantamento padrao
    // Liquido estimado = salario - INSS - VT(desconto = mesmo do adic) - vale do mes - vales abertos compras
    const liquido = sal - inssV - vt - valeMes - valeAbertoTotal;

    for (const mInicio of meses) {
      const y = mInicio.getFullYear();
      const m = mInicio.getMonth(); // 0-11
      const mesAnoStr = `${y}-${String(m+1).padStart(2,'0')}`;
      const mesLbl = `${mesNomes[m]}/${y}`;

      // ADIANTAMENTO — dia 20 do MES (m)
      const dataVencAd = new Date(y, m, 20);
      const folhaAd = folhas.find(f => f.colabKey === k && f.tipo === 'adiantamento' && f.mesAno === mesAnoStr);
      linhas.push({
        colab: c, colabKey: k,
        tipo: 'adiantamento',
        mesAno: mesAnoStr, mesLbl,
        valor: folhaAd?.valorAdiantamento || valeMes,
        dataVenc: dataVencAd,
        pago: !!folhaAd,
        folhaId: folhaAd?.id || null,
      });

      // SALARIO — dia 5 do MES SEGUINTE (m+1)
      const dataVencSal = new Date(y, m+1, 5);
      const folhaSal = folhas.find(f => f.colabKey === k && f.tipo === 'contracheque' && f.mesAno === mesAnoStr);
      linhas.push({
        colab: c, colabKey: k,
        tipo: 'salario',
        mesAno: mesAnoStr, mesLbl,
        valor: folhaSal?.valorLiquido || liquido,
        dataVenc: dataVencSal,
        pago: !!folhaSal,
        folhaId: folhaSal?.id || null,
      });
    }
  }

  // Ordena por data de vencimento crescente (proximas primeiro)
  linhas.sort((a,b) => a.dataVenc - b.dataVenc);

  // FILTROS de periodo da Folha
  const folhaPer = S._folhaPeriodo || 'todos';
  const fd1 = S._folhaD1 || '';
  const fd2 = S._folhaD2 || '';
  let fIni = null, fFim = null;
  if (folhaPer === 'dia')    { fIni = new Date(hoje); fIni.setHours(0,0,0,0); fFim = new Date(hoje); fFim.setHours(23,59,59,999); }
  else if (folhaPer === 'semana') { fIni = new Date(hoje); fIni.setDate(hoje.getDate()-hoje.getDay()); fIni.setHours(0,0,0,0); fFim = new Date(fIni); fFim.setDate(fIni.getDate()+6); fFim.setHours(23,59,59,999); }
  else if (folhaPer === 'mes')    { fIni = new Date(hoje.getFullYear(), hoje.getMonth(), 1); fFim = new Date(hoje.getFullYear(), hoje.getMonth()+1, 0, 23,59,59,999); }
  else if (folhaPer === 'mes_ant'){ fIni = new Date(hoje.getFullYear(), hoje.getMonth()-1, 1); fFim = new Date(hoje.getFullYear(), hoje.getMonth(), 0, 23,59,59,999); }
  else if (folhaPer === 'custom') { if (fd1) fIni = new Date(fd1+'T00:00:00'); if (fd2) fFim = new Date(fd2+'T23:59:59'); }
  if (fIni || fFim) {
    const filtradas = linhas.filter(l => {
      if (fIni && l.dataVenc < fIni) return false;
      if (fFim && l.dataVenc > fFim) return false;
      return true;
    });
    // Reatribui ao array original (linhas e const) — limpa e reinsere
    linhas.length = 0;
    linhas.push(...filtradas);
  }

  // KPIs do bloco
  const totalPendente = linhas.filter(l => !l.pago).reduce((s,l) => s+(l.valor||0), 0);
  const totalAtrasado = linhas.filter(l => !l.pago && l.dataVenc < hoje).reduce((s,l) => s+(l.valor||0), 0);
  const qtdAtrasados = linhas.filter(l => !l.pago && l.dataVenc < hoje).length;

  // Selecionados (em memoria) — chave = colabKey|tipo|mesAno
  const selecChaves = new Set(S._folhaSelecionadas || []);
  const linhaChave = l => `${l.colabKey}|${l.tipo}|${l.mesAno}`;
  const pendentesLinhas = linhas.filter(l => !l.pago);
  const linhasSelecionadas = pendentesLinhas.filter(l => selecChaves.has(linhaChave(l)));
  const valorSelec = linhasSelecionadas.reduce((s,l) => s+(l.valor||0), 0);

  const folhaPerBtn = (k, l) => `<button type="button" class="btn btn-xs ${folhaPer===k?'btn-primary':'btn-ghost'}" data-folha-per="${k}">${l}</button>`;

  return `
<div class="card" style="margin-top:14px;">
  <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:14px;">
    <div>
      <div class="card-title" style="margin:0;">🗓️ Folha a Pagar (Automático)</div>
      <div style="font-size:11px;color:var(--muted);margin-top:2px;">
        💵 Adiantamento: dia <strong>20</strong> · 💼 Salário: <strong>5º dia útil</strong> do mês seguinte · ${colabsComSalario.length} colaborador(es) com salário cadastrado
      </div>
    </div>
    ${linhasSelecionadas.length > 0 ? `
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
      <span style="font-size:12px;color:#15803D;font-weight:700;">✓ ${linhasSelecionadas.length} selec. · ${$c(valorSelec)}</span>
      <button class="btn btn-green btn-sm" id="btn-folha-pagar-lote">💸 Marcar como pago(s)</button>
    </div>
    ` : ''}
  </div>

  <!-- Filtros de período da folha -->
  <div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap;margin-bottom:12px;padding:8px 10px;background:#FAFAFA;border-radius:8px;">
    <span style="font-size:11px;font-weight:700;color:var(--muted);">📅 Filtrar:</span>
    ${folhaPerBtn('todos',   'Todos')}
    ${folhaPerBtn('dia',     'Hoje')}
    ${folhaPerBtn('semana',  'Semana')}
    ${folhaPerBtn('mes',     'Mês')}
    ${folhaPerBtn('mes_ant', 'Mês Ant.')}
    ${folhaPerBtn('custom',  '📅 Datas')}
    ${folhaPer === 'custom' ? `
      <input type="date" class="fi" id="folha-d1" value="${fd1}" style="width:auto;font-size:11px;margin-left:6px;"/>
      <span style="font-size:11px;color:var(--muted);">a</span>
      <input type="date" class="fi" id="folha-d2" value="${fd2}" style="width:auto;font-size:11px;"/>
    ` : ''}
    <span style="margin-left:auto;font-size:11px;color:var(--muted);">${linhas.length} compromisso(s)</span>
  </div>

  <!-- KPIs -->
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:14px;">
    <div style="background:#FEE2E2;border:1px solid #FCA5A5;border-radius:8px;padding:10px 12px;">
      <div style="font-size:10px;color:#991B1B;text-transform:uppercase;font-weight:700;">A pagar (3 meses)</div>
      <div style="font-size:18px;font-weight:900;color:#991B1B;">${$c(totalPendente)}</div>
    </div>
    <div style="background:${qtdAtrasados>0?'#FEE2E2':'#DCFCE7'};border:1px solid ${qtdAtrasados>0?'#FCA5A5':'#86EFAC'};border-radius:8px;padding:10px 12px;">
      <div style="font-size:10px;color:${qtdAtrasados>0?'#991B1B':'#15803D'};text-transform:uppercase;font-weight:700;">Atrasados</div>
      <div style="font-size:18px;font-weight:900;color:${qtdAtrasados>0?'#991B1B':'#15803D'};">${qtdAtrasados} ${qtdAtrasados>0?'⚠️':'✅'}</div>
      ${qtdAtrasados>0?`<div style="font-size:10px;color:#991B1B;">${$c(totalAtrasado)} a regularizar</div>`:''}
    </div>
    <div style="background:#DBEAFE;border:1px solid #93C5FD;border-radius:8px;padding:10px 12px;">
      <div style="font-size:10px;color:#1E40AF;text-transform:uppercase;font-weight:700;">Compromissos</div>
      <div style="font-size:18px;font-weight:900;color:#1E40AF;">${linhas.length}</div>
      <div style="font-size:10px;color:#1E40AF;">${linhas.filter(l=>l.pago).length} pagos · ${linhas.filter(l=>!l.pago).length} pendentes</div>
    </div>
  </div>

  <div style="overflow-x:auto;">
    <table style="width:100%;font-size:12px;border-collapse:collapse;">
      <thead><tr style="background:#FAFAFA;border-bottom:1px solid var(--border);">
        <th style="padding:8px;text-align:center;width:36px;">
          <input type="checkbox" id="folha-sel-todos"
            ${pendentesLinhas.length>0 && pendentesLinhas.every(l => selecChaves.has(linhaChave(l))) ? 'checked' : ''}
            ${pendentesLinhas.length===0?'disabled':''}
            style="width:15px;height:15px;cursor:pointer;accent-color:#15803D;" title="Selecionar todos pendentes"/>
        </th>
        <th style="padding:8px;text-align:left;font-size:10px;color:#94A3B8;text-transform:uppercase;">Vencimento</th>
        <th style="padding:8px;text-align:left;font-size:10px;color:#94A3B8;text-transform:uppercase;">Colab</th>
        <th style="padding:8px;text-align:left;font-size:10px;color:#94A3B8;text-transform:uppercase;">Tipo</th>
        <th style="padding:8px;text-align:left;font-size:10px;color:#94A3B8;text-transform:uppercase;">Mês Ref.</th>
        <th style="padding:8px;text-align:right;font-size:10px;color:#94A3B8;text-transform:uppercase;">Valor</th>
        <th style="padding:8px;text-align:center;font-size:10px;color:#94A3B8;text-transform:uppercase;">Status</th>
        <th style="padding:8px;text-align:center;font-size:10px;color:#94A3B8;text-transform:uppercase;">Ação</th>
      </tr></thead>
      <tbody>
        ${linhas.map(l => {
          const atrasado = !l.pago && l.dataVenc < hoje;
          const dataStr = `${String(l.dataVenc.getDate()).padStart(2,'0')}/${String(l.dataVenc.getMonth()+1).padStart(2,'0')}/${l.dataVenc.getFullYear()}`;
          const chave = linhaChave(l);
          const selecionada = selecChaves.has(chave);
          const tipoBadge = l.tipo === 'adiantamento'
            ? `<span style="background:#FEF3C7;color:#92400E;border-radius:6px;padding:2px 8px;font-size:10px;font-weight:700;">💵 Adiantamento</span>`
            : `<span style="background:#DBEAFE;color:#1E40AF;border-radius:6px;padding:2px 8px;font-size:10px;font-weight:700;">💼 Salário</span>`;
          const statusBadge = l.pago
            ? `<span style="background:#DCFCE7;color:#15803D;border-radius:6px;padding:2px 8px;font-size:10px;font-weight:700;">✅ Pago</span>`
            : atrasado
              ? `<span style="background:#FEE2E2;color:#991B1B;border-radius:6px;padding:2px 8px;font-size:10px;font-weight:700;">⚠️ Atrasado</span>`
              : `<span style="background:#FEF3C7;color:#92400E;border-radius:6px;padding:2px 8px;font-size:10px;font-weight:700;">⏳ A pagar</span>`;
          return `<tr style="border-bottom:1px solid #F1F5F9;${l.pago?'opacity:.6;':''}${atrasado?'background:#FEF2F2;':''}${selecionada?'background:#DCFCE7;':''}">
            <td style="padding:8px;text-align:center;">
              ${l.pago
                ? '<span style="color:#15803D;">✅</span>'
                : `<input type="checkbox" data-folha-sel="${esc(chave)}" ${selecionada?'checked':''}
                    style="width:15px;height:15px;cursor:pointer;accent-color:#15803D;"/>`}
            </td>
            <td style="padding:8px;font-weight:700;color:${atrasado?'#991B1B':'#1E293B'};">${dataStr}</td>
            <td style="padding:8px;font-weight:600;">${esc(l.colab.name||'')}</td>
            <td style="padding:8px;">${tipoBadge}</td>
            <td style="padding:8px;font-size:11px;color:var(--muted);">${esc(l.mesLbl)}</td>
            <td style="padding:8px;text-align:right;font-weight:800;color:${atrasado?'#991B1B':'#1E293B'};">${$c(l.valor)}</td>
            <td style="padding:8px;text-align:center;">${statusBadge}</td>
            <td style="padding:8px;text-align:center;">
              ${l.pago
                ? `<button class="btn btn-ghost btn-xs" data-folha-print="${l.folhaId}" title="Imprimir recibo">🖨️</button>`
                : `<button class="btn btn-primary btn-xs" data-folha-gerar="${l.colabKey}|${l.tipo}|${l.mesAno}" title="Gerar (com formulario detalhado)">💸 Pagar</button>`}
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>

  <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;padding:10px;margin-top:10px;font-size:11px;color:#1E40AF;">
    💡 <strong>Selecione</strong> os compromissos com os checkboxes e clique em <strong>💸 Marcar como pago(s)</strong> para baixar em lote — o sistema pergunta se quer imprimir os recibos. O botão <strong>💸 Pagar</strong> individual abre o formulário detalhado do RH.
  </div>
</div>
`;
}

// ── MODULO VALES ─────────────────────────────────────────────
// Adiantamentos e compras pessoais de colaboradores que ficam
// como saldo a descontar na proxima folha (contracheque).
//
// Storage: localStorage 'fv_vales' — array de:
//   { id, colabKey, colabNome, tipo: 'vale'|'compra', descricao,
//     valor, data, status: 'Aberto'|'Descontado',
//     produtoCode?, produtoNome?, qtd?, descontoColab? (% off do produto),
//     observacao, createdAt }
function _getVales() { try { return JSON.parse(localStorage.getItem('fv_vales')||'[]'); } catch { return []; } }
function _setVales(arr) { localStorage.setItem('fv_vales', JSON.stringify(arr||[])); }

function renderVales() {
  // Visivel para Admin/Gerente/Financeiro/Contador (controle de folha)
  const role = String(S.user?.role||'').toLowerCase();
  const cargo = String(S.user?.cargo||'').toLowerCase();
  const ehAdm = role === 'administrador' || cargo === 'admin' || cargo === 'administrador';
  const ehGer = role === 'gerente' || cargo === 'gerente';
  const ehFin = cargo === 'financeiro';
  const ehCnt = cargo === 'contador';
  if (!ehAdm && !ehGer && !ehFin && !ehCnt) return '';

  const vales = _getVales().sort((a,b) => (b.createdAt||0) - (a.createdAt||0));
  const filtroColab = S._valeFiltroColab || '';
  const filtroStatus = S._valeFiltroStatus || 'todos';
  const filtroTipo = S._valeFiltroTipo || 'todos';

  let lista = vales;
  if (filtroColab) lista = lista.filter(v => v.colabKey === filtroColab);
  if (filtroStatus !== 'todos') lista = lista.filter(v => v.status === filtroStatus);
  if (filtroTipo !== 'todos') lista = lista.filter(v => v.tipo === filtroTipo);

  // Importa getColabs dinamicamente para evitar dep circular
  let colabs = [];
  try { colabs = JSON.parse(localStorage.getItem('fv_colabs')||'[]').filter(c => c.active !== false); } catch (_) {}

  const totalAberto = vales.filter(v => v.status === 'Aberto').reduce((s,v) => s+(v.valor||0), 0);
  const totalDescontado = vales.filter(v => v.status === 'Descontado').reduce((s,v) => s+(v.valor||0), 0);
  // Por colab (em aberto)
  const porColab = {};
  vales.filter(v => v.status === 'Aberto').forEach(v => {
    const k = String(v.colabKey||'');
    if (!porColab[k]) porColab[k] = { nome:v.colabNome||'?', total:0, qtd:0 };
    porColab[k].total += v.valor||0;
    porColab[k].qtd++;
  });
  const lstPorColab = Object.values(porColab).sort((a,b) => b.total - a.total);

  return `
<div class="card" style="margin-top:14px;">
  <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:14px;">
    <div>
      <div class="card-title" style="margin:0;">💵 Vales e Retiradas de Colaboradores</div>
      <div style="font-size:11px;color:var(--muted);margin-top:2px;">Adiantamentos + compras pessoais (descontados na folha)</div>
    </div>
    <button class="btn btn-primary btn-sm" id="btn-novo-vale">➕ Novo Vale / Retirada</button>
  </div>

  <!-- KPIs -->
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:14px;">
    <div style="background:#FEF3C7;border:1px solid #FCD34D;border-radius:8px;padding:10px 12px;">
      <div style="font-size:10px;color:#92400E;text-transform:uppercase;font-weight:700;">Saldo em aberto</div>
      <div style="font-size:18px;font-weight:900;color:#92400E;">${$c(totalAberto)}</div>
      <div style="font-size:10px;color:#92400E;opacity:.7;">a descontar nas folhas</div>
    </div>
    <div style="background:#DCFCE7;border:1px solid #86EFAC;border-radius:8px;padding:10px 12px;">
      <div style="font-size:10px;color:#15803D;text-transform:uppercase;font-weight:700;">Já descontado</div>
      <div style="font-size:18px;font-weight:900;color:#15803D;">${$c(totalDescontado)}</div>
    </div>
    <div style="background:#DBEAFE;border:1px solid #93C5FD;border-radius:8px;padding:10px 12px;">
      <div style="font-size:10px;color:#1E40AF;text-transform:uppercase;font-weight:700;">Colabs com vale aberto</div>
      <div style="font-size:18px;font-weight:900;color:#1E40AF;">${lstPorColab.length}</div>
    </div>
  </div>

  ${lstPorColab.length ? `
  <!-- Resumo por colab (saldos em aberto) -->
  <div style="background:#FAFAFA;border-radius:8px;padding:10px 14px;margin-bottom:14px;">
    <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:6px;">📊 Saldos em aberto por colab</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:6px;">
      ${lstPorColab.map(p => `<div style="background:#fff;border:1px solid var(--border);border-radius:6px;padding:6px 10px;display:flex;justify-content:space-between;align-items:center;font-size:12px;">
        <span style="font-weight:600;">${p.nome}</span>
        <span style="color:#92400E;font-weight:800;">${$c(p.total)} <span style="font-size:9px;font-weight:500;">(${p.qtd})</span></span>
      </div>`).join('')}
    </div>
  </div>
  ` : ''}

  <!-- Filtros -->
  <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px;font-size:12px;">
    <span style="font-size:11px;font-weight:700;color:var(--muted);">🔍</span>
    <select class="fi" id="vale-filtro-colab" style="width:auto;font-size:12px;">
      <option value="">Todos os colabs</option>
      ${colabs.sort((a,b)=>(a.name||'').localeCompare(b.name||'')).map(c => {
        const k = String(c._id||c.id||c.email||c.name||'');
        return `<option value="${k}" ${filtroColab===k?'selected':''}>${c.name||'?'}</option>`;
      }).join('')}
    </select>
    <select class="fi" id="vale-filtro-status" style="width:auto;font-size:12px;">
      <option value="todos">Todos status</option>
      <option value="Aberto"      ${filtroStatus==='Aberto'?'selected':''}>🟡 Aberto</option>
      <option value="Descontado"  ${filtroStatus==='Descontado'?'selected':''}>✅ Descontado</option>
    </select>
    <select class="fi" id="vale-filtro-tipo" style="width:auto;font-size:12px;">
      <option value="todos">Todos tipos</option>
      <option value="vale"   ${filtroTipo==='vale'?'selected':''}>💵 Vale (dinheiro)</option>
      <option value="pix"    ${filtroTipo==='pix'?'selected':''}>📱 PIX</option>
      <option value="compra" ${filtroTipo==='compra'?'selected':''}>🛒 Compra/Retirada</option>
    </select>
    <span style="font-size:11px;color:var(--muted);margin-left:auto;">${lista.length} registro(s)</span>
  </div>

  ${lista.length === 0 ? `
  <div style="text-align:center;padding:30px;color:var(--muted);font-size:13px;">
    Nenhum vale registrado.
  </div>
  ` : `
  <div style="overflow-x:auto;">
    <table style="width:100%;font-size:12px;border-collapse:collapse;">
      <thead><tr style="background:#FAFAFA;border-bottom:1px solid var(--border);">
        <th style="padding:8px;text-align:left;font-size:10px;color:#94A3B8;text-transform:uppercase;">Data</th>
        <th style="padding:8px;text-align:left;font-size:10px;color:#94A3B8;text-transform:uppercase;">Colab</th>
        <th style="padding:8px;text-align:left;font-size:10px;color:#94A3B8;text-transform:uppercase;">Tipo</th>
        <th style="padding:8px;text-align:left;font-size:10px;color:#94A3B8;text-transform:uppercase;">Descrição</th>
        <th style="padding:8px;text-align:right;font-size:10px;color:#94A3B8;text-transform:uppercase;">Valor</th>
        <th style="padding:8px;text-align:center;font-size:10px;color:#94A3B8;text-transform:uppercase;">Status</th>
        <th style="padding:8px;text-align:center;font-size:10px;color:#94A3B8;text-transform:uppercase;">Ações</th>
      </tr></thead>
      <tbody>
        ${lista.map(v => {
          const data = v.data ? v.data.split('-').reverse().join('/') : '—';
          return `<tr style="border-bottom:1px solid #F1F5F9;${v.status==='Descontado'?'opacity:.65;':''}">
            <td style="padding:8px;font-size:11px;color:var(--muted);">${data}</td>
            <td style="padding:8px;font-weight:600;">${esc(v.colabNome||'—')}</td>
            <td style="padding:8px;">
              ${(() => {
                const map = {
                  compra: { bg:'#FEF3C7', fg:'#92400E', l:'🛒 Compra' },
                  pix:    { bg:'#DCFCE7', fg:'#15803D', l:'📱 PIX' },
                  vale:   { bg:'#DBEAFE', fg:'#1E40AF', l:'💵 Vale' },
                };
                const t = map[v.tipo] || map.vale;
                return `<span style="background:${t.bg};color:${t.fg};border-radius:6px;padding:2px 8px;font-size:10px;font-weight:700;">${t.l}</span>`;
              })()}
            </td>
            <td style="padding:8px;">
              <div style="font-size:12px;">${esc(v.descricao||'')}</div>
              ${v.tipo==='compra' && v.produtoNome ? `<div style="font-size:10px;color:var(--muted);">📦 ${v.qtd||1}× ${esc(v.produtoNome)} ${v.descontoColab?`<span style="color:#15803D;">(${v.descontoColab}% desconto)</span>`:''}</div>` : ''}
              ${v.observacao ? `<div style="font-size:10px;color:var(--muted);font-style:italic;">${esc(v.observacao)}</div>`:''}
            </td>
            <td style="padding:8px;text-align:right;font-weight:800;color:${v.status==='Descontado'?'#15803D':'#92400E'};">${$c(v.valor)}</td>
            <td style="padding:8px;text-align:center;">
              <span style="background:${v.status==='Descontado'?'#DCFCE7':'#FEF3C7'};color:${v.status==='Descontado'?'#15803D':'#92400E'};border-radius:6px;padding:2px 8px;font-size:10px;font-weight:700;">${v.status==='Descontado'?'✅':'🟡'} ${v.status}</span>
            </td>
            <td style="padding:8px;text-align:center;white-space:nowrap;">
              ${v.status==='Aberto' ? `<button class="btn btn-ghost btn-xs" data-vale-baixar="${v.id}" title="Marcar como descontado na folha" style="color:#15803D;">✅</button>` : `<button class="btn btn-ghost btn-xs" data-vale-reabrir="${v.id}" title="Reabrir (voltar para Aberto)" style="color:#92400E;">↩️</button>`}
              <button class="btn btn-ghost btn-xs" data-vale-del="${v.id}" style="color:#DC2626;" title="Excluir">🗑️</button>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>
  `}
</div>
`;
}

// -- MODAL PAGAR CONTA — escolhe metodo + caixa (se Dinheiro) --
export function showPagarContaModal(billId) {
  const all = JSON.parse(localStorage.getItem('fv_financial')||'[]');
  const bill = all.find(c => (c._id||c.id) === billId) ||
               (S.financialEntries||[]).find(c => (c._id||c.id) === billId);
  if (!bill) { toast('Conta não encontrada', true); return; }

  // Lista caixas ABERTOS no dia atual (por unidade)
  let caixas = [];
  try { caixas = JSON.parse(localStorage.getItem('fv_caixa')||'[]'); } catch(_){}
  const hoje = new Date().toISOString().split('T')[0];
  const caixasAbertos = caixas.filter(c => c.date === hoje && !c.fechamento);

  const valor = Number(bill.value || bill.valor) || 0;

  S._modal = `<div class="mo" id="mo"><div class="mo-box" onclick="event.stopPropagation()" style="max-width:480px;">
    <div class="mo-title">💳 Pagar Conta</div>

    <div style="background:#FAFAFA;border-radius:8px;padding:12px;margin-bottom:14px;">
      <div style="font-size:11px;color:var(--muted);text-transform:uppercase;font-weight:700;">Conta</div>
      <div style="font-size:14px;font-weight:700;color:#1E293B;margin:4px 0;">${esc(bill.description||bill.descricao||'—')}</div>
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted);">
        <span>${esc(bill.category||bill.categoria||'—')} · ${esc(bill.unit||'Todas')}</span>
        <span style="font-weight:900;font-size:18px;color:#DC2626;">${$c(valor)}</span>
      </div>
    </div>

    <div class="fg">
      <label class="fl">Método de Pagamento *</label>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">
        <button type="button" class="btn btn-ghost" data-pgto-met="Cartão" style="padding:14px 8px;border:2px solid var(--border);text-align:center;font-size:13px;font-weight:700;">
          💳<br/>Cartão
        </button>
        <button type="button" class="btn btn-ghost" data-pgto-met="PIX" style="padding:14px 8px;border:2px solid var(--border);text-align:center;font-size:13px;font-weight:700;">
          📱<br/>PIX
        </button>
        <button type="button" class="btn btn-ghost" data-pgto-met="Dinheiro" style="padding:14px 8px;border:2px solid var(--border);text-align:center;font-size:13px;font-weight:700;">
          💵<br/>Dinheiro
        </button>
      </div>
    </div>

    <!-- Bloco Dinheiro: seleciona caixa -->
    <div id="pgto-bloco-dinheiro" style="display:none;background:#FEF3C7;border:1px solid #FCD34D;border-radius:8px;padding:10px 12px;margin-top:8px;">
      <div style="font-size:12px;font-weight:800;color:#92400E;margin-bottom:8px;">💵 Saída em Dinheiro — escolha o Caixa</div>
      ${caixasAbertos.length === 0 ? `
        <div style="background:#FEE2E2;border:1px solid #FCA5A5;border-radius:6px;padding:10px;color:#991B1B;font-size:12px;text-align:center;">
          ⚠️ Nenhum caixa aberto hoje. Abra um caixa no módulo <strong>Caixa</strong> primeiro.
        </div>
      ` : `
        <select class="fi" id="pgto-caixa">
          <option value="">— Selecione o caixa —</option>
          ${caixasAbertos.map(cx => {
            const sangrias = (cx.movimentos||[]).filter(m=>m.tipo==='Sangria').reduce((s,m)=>s+m.valor,0);
            const supr     = (cx.movimentos||[]).filter(m=>m.tipo==='Suprimento').reduce((s,m)=>s+m.valor,0);
            const fundoApros = Number(cx.fundoInicial||0) - sangrias + supr;
            return `<option value="${cx.id || cx._id || (cx.date+'|'+cx.unit)}">🏪 ${esc(cx.unit||'—')} — Aberto às ${esc(cx.horaAbertura||'—')} — Saldo: ${$c(fundoApros)}</option>`;
          }).join('')}
        </select>
        <div style="font-size:10px;color:#92400E;margin-top:6px;font-style:italic;">
          ℹ️ Será registrada uma <strong>Sangria</strong> automaticamente no caixa selecionado com a descrição da conta.
        </div>
      `}
    </div>

    <div class="fg">
      <label class="fl">Data do pagamento</label>
      <input type="date" class="fi" id="pgto-data" value="${hoje}"/>
    </div>

    <div class="fg">
      <label class="fl">Observação (opcional)</label>
      <input type="text" class="fi" id="pgto-obs" placeholder=""/>
    </div>

    <div class="mo-foot">
      <button class="btn btn-ghost" onclick="document.getElementById('mo').remove();window.S._modal=null;">Cancelar</button>
      <button class="btn btn-green" id="btn-confirmar-pgto" disabled>✅ Confirmar Pagamento</button>
    </div>
  </div></div>`;

  setTimeout(() => {
    let metodoSel = '';
    const blocoD = document.getElementById('pgto-bloco-dinheiro');
    const btnConf = document.getElementById('btn-confirmar-pgto');
    const updateBtn = () => {
      if (!metodoSel) { btnConf.disabled = true; return; }
      if (metodoSel === 'Dinheiro') {
        const caixaId = document.getElementById('pgto-caixa')?.value;
        btnConf.disabled = !caixaId;
      } else {
        btnConf.disabled = false;
      }
    };

    document.querySelectorAll('[data-pgto-met]').forEach(b => b.addEventListener('click', () => {
      metodoSel = b.dataset.pgtoMet;
      // Visual: marca o selecionado
      document.querySelectorAll('[data-pgto-met]').forEach(x => {
        x.style.borderColor = x.dataset.pgtoMet === metodoSel ? 'var(--rose)' : 'var(--border)';
        x.style.background = x.dataset.pgtoMet === metodoSel ? 'var(--rose-l)' : '';
      });
      blocoD.style.display = metodoSel === 'Dinheiro' ? 'block' : 'none';
      updateBtn();
    }));
    document.getElementById('pgto-caixa')?.addEventListener('change', updateBtn);

    document.getElementById('btn-confirmar-pgto')?.addEventListener('click', () => {
      const dataPgto = document.getElementById('pgto-data')?.value || hoje;
      const obs = document.getElementById('pgto-obs')?.value || '';

      // 1) Marca conta como Pago
      const _match = e => (e._id||e.id) === billId;
      const updates = { status:'Pago', paidAt: new Date().toISOString(), metodoPgto: metodoSel, dataPgto, pgtoObs: obs };
      const arr = JSON.parse(localStorage.getItem('fv_financial')||'[]')
        .map(e => _match(e) ? { ...e, ...updates } : e);
      localStorage.setItem('fv_financial', JSON.stringify(arr));
      S.financialEntries = (S.financialEntries||[]).map(e => _match(e) ? { ...e, ...updates } : e);

      // 2) Se Dinheiro: registra Sangria no caixa
      if (metodoSel === 'Dinheiro') {
        const caixaId = document.getElementById('pgto-caixa')?.value;
        const cxArr = JSON.parse(localStorage.getItem('fv_caixa')||'[]');
        const idx = cxArr.findIndex(c => (c.id||c._id||(c.date+'|'+c.unit)) === caixaId);
        if (idx >= 0) {
          if (!cxArr[idx].movimentos) cxArr[idx].movimentos = [];
          const desc = `💸 Pagamento: ${bill.description||bill.descricao||'—'}` + (obs?` (${obs})`:'');
          cxArr[idx].movimentos.push({
            tipo: 'Sangria', valor,
            descricao: desc,
            hora: new Date().toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' }),
            usuario: S.user?.name || 'Sistema',
            origem: 'pagamento_conta',
            billId,
          });
          localStorage.setItem('fv_caixa', JSON.stringify(cxArr));
          // Tambem POST p/ backend (se cair, fica local)
          import('./caixa.js').then(m => {
            if (m.saveCaixaRegistro) m.saveCaixaRegistro(cxArr[idx]).catch(()=>{});
          }).catch(()=>{});
          toast(`✅ Pago em Dinheiro · Sangria registrada no caixa ${cxArr[idx].unit||''}`);
        } else {
          toast('Conta paga mas caixa não encontrado — confira o registro', true);
        }
      } else {
        toast(`✅ Pago via ${metodoSel}`);
      }

      document.getElementById('mo').remove();
      S._modal = null;
      render();
    });
  }, 60);

  render();
}

// -- MODAL VALE / RETIRADA --
export function showValeModal(){
  const colabs = getColabs().filter(c => c.active !== false).sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  const produtos = (S.products||[]).filter(p => p.active !== false).sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  const today = new Date().toISOString().slice(0,10);
  S._modal=`<div class="mo" id="mo"><div class="mo-box" onclick="event.stopPropagation()" style="max-width:540px;">
    <div class="mo-title">💵 Novo Vale / Retirada</div>

    <div class="fr2">
      <div class="fg"><label class="fl">Colaborador *</label>
        <select class="fi" id="vm-colab">
          <option value="">— Selecione —</option>
          ${colabs.map(c => {
            const k = String(c._id||c.id||c.email||c.name||'');
            return `<option value="${k}|${esc(c.name||'')}">${esc(c.name||'')}</option>`;
          }).join('')}
        </select>
      </div>
      <div class="fg"><label class="fl">Tipo *</label>
        <select class="fi" id="vm-tipo">
          <option value="vale">💵 Vale (dinheiro)</option>
          <option value="pix">📱 PIX</option>
          <option value="compra">🛒 Compra/Retirada de produto</option>
        </select>
      </div>
    </div>

    <!-- Bloco para tipo COMPRA -->
    <div id="vm-bloco-compra" style="display:none;background:#FEF3C7;border:1px solid #FCD34D;border-radius:8px;padding:10px;margin:8px 0;">
      <div style="font-size:11px;font-weight:700;color:#92400E;margin-bottom:6px;">🛒 Detalhes da compra (deduzido do salário)</div>
      <div class="fr2">
        <div class="fg"><label class="fl">Produto</label>
          <select class="fi" id="vm-produto">
            <option value="">— Selecione —</option>
            ${produtos.map(p => {
              const code = p.code||p.codigo||'';
              const preco = Number(p.price||p.preco)||0;
              return `<option value="${p._id||p.id}|${esc(code)}|${esc(p.name||'')}|${preco}">${code?'#'+code+' — ':''}${esc(p.name||'')} (R$ ${preco.toFixed(2)})</option>`;
            }).join('')}
          </select>
        </div>
        <div class="fg"><label class="fl">Quantidade</label>
          <input type="number" class="fi" id="vm-qtd" value="1" min="1" step="1"/>
        </div>
      </div>
      <div class="fr2">
        <div class="fg"><label class="fl">% Desconto p/ colab</label>
          <input type="number" class="fi" id="vm-desconto-pct" value="0" min="0" max="100" step="1" placeholder="0"/>
          <div style="font-size:10px;color:#92400E;">% off do preço de venda (ex: 30 = 30% desconto)</div>
        </div>
        <div class="fg"><label class="fl">Valor final (R$)</label>
          <input type="number" class="fi" id="vm-valor-compra" min="0" step="0.01" placeholder="0,00"/>
          <div style="font-size:10px;color:#92400E;">Calculado automaticamente — pode ajustar</div>
        </div>
      </div>
    </div>

    <div class="fr2">
      <div class="fg"><label class="fl">Valor (R$) *</label>
        <input type="number" class="fi" id="vm-valor" min="0" step="0.01" placeholder="0,00"/>
      </div>
      <div class="fg"><label class="fl">Data</label>
        <input type="date" class="fi" id="vm-data" value="${today}"/>
      </div>
    </div>

    <div class="fg"><label class="fl">Descrição *</label>
      <input type="text" class="fi" id="vm-desc" placeholder="Ex: Adiantamento sexta-feira"/>
    </div>

    <div class="fg"><label class="fl">Observação (opcional)</label>
      <input type="text" class="fi" id="vm-obs" placeholder=""/>
    </div>

    <div class="fr2" style="margin-top:14px;">
      <button class="btn btn-ghost" onclick="document.getElementById('mo').remove();window.S._modal=null;">Cancelar</button>
      <button class="btn btn-primary" id="btn-salvar-vale">💾 Salvar Vale</button>
    </div>
  </div></div>`;
  // Bind apos inserir no DOM
  setTimeout(() => {
    const tipoEl = document.getElementById('vm-tipo');
    const blocoCompra = document.getElementById('vm-bloco-compra');
    const prodEl = document.getElementById('vm-produto');
    const qtdEl  = document.getElementById('vm-qtd');
    const descPctEl = document.getElementById('vm-desconto-pct');
    const valorCompraEl = document.getElementById('vm-valor-compra');
    const valorEl = document.getElementById('vm-valor');
    const descEl  = document.getElementById('vm-desc');

    const recalc = () => {
      if (tipoEl.value !== 'compra') return;
      const raw = prodEl.value || '';
      const [pId, pCode, pNome, precoStr] = raw.split('|');
      const preco = Number(precoStr)||0;
      const qtd = Number(qtdEl.value)||1;
      const pct = Number(descPctEl.value)||0;
      const bruto = preco * qtd;
      const liquido = bruto * (1 - pct/100);
      valorCompraEl.value = liquido.toFixed(2);
      valorEl.value = liquido.toFixed(2);
      if (pNome && !descEl.value) descEl.value = `Compra ${qtd}× ${pNome}` + (pct?` (${pct}% off)`:'');
    };

    tipoEl.addEventListener('change', () => {
      blocoCompra.style.display = tipoEl.value === 'compra' ? 'block' : 'none';
      if (tipoEl.value === 'compra') recalc();
    });
    prodEl?.addEventListener('change', recalc);
    qtdEl?.addEventListener('change', recalc);
    descPctEl?.addEventListener('change', recalc);
    valorCompraEl?.addEventListener('change', () => { valorEl.value = valorCompraEl.value; });

    document.getElementById('btn-salvar-vale')?.addEventListener('click', () => {
      const colabRaw = document.getElementById('vm-colab')?.value || '';
      const [colabKey, colabNome] = colabRaw.split('|');
      const tipo  = tipoEl.value;
      const valor = Number(document.getElementById('vm-valor')?.value)||0;
      const data  = document.getElementById('vm-data')?.value || today;
      const desc  = (document.getElementById('vm-desc')?.value||'').trim();
      const obs   = (document.getElementById('vm-obs')?.value||'').trim();

      if (!colabKey) { toast('Selecione o colab', true); return; }
      if (!desc)     { toast('Descrição obrigatória', true); return; }
      if (!valor || valor<=0) { toast('Valor deve ser > 0', true); return; }

      const v = { id:'vl_'+Date.now()+'_'+Math.random().toString(36).slice(2,7),
        colabKey, colabNome, tipo, valor, data,
        descricao: desc, observacao: obs, status:'Aberto', createdAt: Date.now() };

      if (tipo === 'compra') {
        const raw = prodEl.value || '';
        const [pId, pCode, pNome] = raw.split('|');
        v.produtoId = pId||''; v.produtoCode = pCode||''; v.produtoNome = pNome||'';
        v.qtd = Number(qtdEl.value)||1;
        v.descontoColab = Number(descPctEl.value)||0;
      }

      const list = JSON.parse(localStorage.getItem('fv_vales')||'[]');
      list.push(v);
      localStorage.setItem('fv_vales', JSON.stringify(list));
      const lblTipo = { compra:'Compra', pix:'PIX', vale:'Vale' }[tipo] || 'Vale';
      toast(`✅ ${lblTipo} registrada(o)`);
      document.getElementById('mo').remove();
      S._modal = null;
      render();
    });
  }, 50);
  render();
}

// -- MODAL FINANCEIRO --
export async function showFinModal(type, editEntry = null){
  // editEntry: se fornecido, pre-popula campos e UPDATE em vez de CREATE
  const isEdit = !!editEntry;
  const cats = type==='Despesa'
    ? ['Insumos','Fixo','Variável','Salário','Fornecedor','Marketing','Manutenção','Outros']
    : ['Vendas','Pré-venda','Outros'];
  // Valores pre-populados (edicao)
  const v = (k1, k2='') => esc(editEntry?.[k1] ?? editEntry?.[k2] ?? '');
  const escAttr = (s) => esc(s||'');
  const dateVal = isEdit ? (editEntry.date || editEntry.dueDate || '').slice(0,10) : '';
  const valorVal = isEdit ? (editEntry.value ?? editEntry.valor ?? '') : '';
  const catVal = editEntry?.category || editEntry?.categoria || '';
  const unitVal = editEntry?.unit || 'Todas';
  S._modal=`<div class="mo" id="mo"><div class="mo-box" onclick="event.stopPropagation()">
  <div class="mo-title">${isEdit?'✏️ Editar ':''}${type==='Receita'?'💰 Receita':'💸 Conta a Pagar'}</div>
  <div class="fg"><label class="fl">Descrição *</label><input class="fi" id="fm-desc" value="${v('description','descricao')}" placeholder="${type==='Despesa'?'Ex: Fornecedor de rosas':'Ex: Venda balcão'}"/></div>
  <div class="fr2">
    <div class="fg"><label class="fl">Valor (R$) *</label><input class="fi" type="number" id="fm-value" step="0.01" value="${valorVal}" placeholder="0,00"/></div>
    <div class="fg"><label class="fl">Data de ${type==='Despesa'?'Vencimento':'Recebimento'}</label><input class="fi" type="date" id="fm-date" value="${escAttr(dateVal)}"/></div>
  </div>
  <div class="fr2">
    <div class="fg"><label class="fl">Categoria</label>
      <select class="fi" id="fm-cat">
        ${cats.map(c=>`<option ${c===catVal?'selected':''}>${c}</option>`).join('')}
      </select>
    </div>
    <div class="fg"><label class="fl">Unidade</label>
      <select class="fi" id="fm-unit">
        <option value="Todas"             ${unitVal==='Todas'?'selected':''}>Todas</option>
        <option value="Loja Novo Aleixo"  ${unitVal==='Loja Novo Aleixo'?'selected':''}>Loja Novo Aleixo</option>
        <option value="Loja Allegro Mall" ${unitVal==='Loja Allegro Mall'?'selected':''}>Loja Allegro Mall</option>
        <option value="CDLE"              ${unitVal==='CDLE'?'selected':''}>CDLE</option>
      </select>
    </div>
  </div>
  ${type==='Despesa'?`<div class="fg"><label class="fl">Fornecedor / Beneficiário</label><input class="fi" id="fm-supplier" value="${v('supplier')}" placeholder="Nome do fornecedor"/></div>`:''}
  <div class="fg"><label class="fl">Observações</label><textarea class="fi" id="fm-notes" rows="2">${v('notes')}</textarea></div>
  ${(() => {
    // Conta Pessoal: APENAS o ADM pode marcar/cadastrar.
    const ehAdm = S.user?.role==='Administrador' || S.user?.cargo==='admin' || String(S.user?.cargo||'').toLowerCase()==='administrador';
    if (!ehAdm) return '';
    const checked = isEdit && editEntry.pessoal ? 'checked' : '';
    return `<div class="fg">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;background:#FEE2E2;border:2px solid #FCA5A5;border-radius:8px;padding:10px 12px;">
        <input type="checkbox" id="fm-pessoal" ${checked} style="width:18px;height:18px;cursor:pointer;accent-color:#DC2626;"/>
        <span style="font-size:13px;font-weight:700;color:#991B1B;">🔒 Conta Pessoal</span>
        <span style="font-size:11px;color:#991B1B;opacity:.85;margin-left:auto;">Visível apenas para o ADM</span>
      </label>
    </div>`;
  })()}
  <div class="mo-foot">
    <button class="btn ${type==='Receita'?'btn-green':'btn-red'}" id="btn-sv-fin">${isEdit?'💾 Salvar alterações':'Salvar '+type}</button>
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
    const typeLower = String(type).toLowerCase() === 'receita' ? 'receita' : 'despesa';
    const data = document.getElementById('fm-date')?.value || '';
    const updates = {
      type: typeLower,
      description: desc, descricao: desc,
      value: value, valor: value,
      date: data, dueDate: data || null,
      category: document.getElementById('fm-cat')?.value || 'Outros',
      categoria: document.getElementById('fm-cat')?.value || 'Outros',
      unit: document.getElementById('fm-unit')?.value || 'Todas',
      supplier: document.getElementById('fm-supplier')?.value || '',
      notes: document.getElementById('fm-notes')?.value || '',
      pessoal: !!document.getElementById('fm-pessoal')?.checked,
      updatedAt: new Date().toISOString(),
    };
    const btn = document.getElementById('btn-sv-fin');
    if (btn) { btn.disabled = true; btn.textContent = '💾 Salvando...'; }

    if (isEdit) {
      // ── EDIT ─────────────────────────────────────────────────
      const id = editEntry._id || editEntry.id;
      const merged = { ...editEntry, ...updates };
      let savedOk = false;
      try {
        await import('../services/api.js').then(({ PUT }) => PUT('/financial/entries/' + id, merged));
        savedOk = true;
      } catch (e) {
        console.error('PUT falhou, salvando local:', e);
      }
      // Atualiza memoria + localStorage
      const _matches = e => (e._id||e.id) === id;
      S.financialEntries = (S.financialEntries||[]).map(e => _matches(e) ? merged : e);
      try {
        const arr = JSON.parse(localStorage.getItem('fv_financial')||'[]')
          .map(e => _matches(e) ? merged : e);
        localStorage.setItem('fv_financial', JSON.stringify(arr));
      } catch(_){}
      S._modal = ''; render();
      toast(savedOk ? '✅ Lançamento atualizado!' : '⚠️ Atualizado localmente (servidor offline)');
    } else {
      // ── CREATE ───────────────────────────────────────────────
      const entry = { ...updates, status:'Pendente',
        createdBy: S.user?.name || 'Sistema', user: S.user?.name || 'Sistema' };
      if (!entry._id && !entry.id) {
        entry.id = 'fin_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
      }
      let savedOk = false;
      try {
        const saved = await POST('/financial/entries', entry);
        if (saved && saved._id) entry._id = saved._id;
        savedOk = true;
      } catch(e){ console.error('POST falhou, salvando local:', e); }
      if (!S.financialEntries) S.financialEntries = [];
      S.financialEntries.unshift(entry);
      try {
        const arr = JSON.parse(localStorage.getItem('fv_financial')||'[]');
        arr.unshift(entry);
        localStorage.setItem('fv_financial', JSON.stringify(arr));
      } catch(_){}
      S._modal = ''; render();
      toast(savedOk ? `✅ ${type} cadastrada!` : `⚠️ ${type} salva localmente (offline)`);
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
      // Nomes em inglês (schema backend) + PT-BR (compat telas antigas)
      category: 'Venda',
      categoria: 'Venda',
      description: `Venda ${o.orderNumber} — ${o.client?.name||o.clientName||'Cliente'}`,
      descricao: `Venda ${o.orderNumber} — ${o.client?.name||o.clientName||'Cliente'}`,
      value: Number(o.total)||0,
      valor: Number(o.total)||0,
      paymentMethod: o.payment||'—',
      payment: o.payment||'—',
      unit: o.unit||'—',
      status: 'Recebido',
      date: new Date().toISOString().split('T')[0],
      user: S.user?.name||'Sistema',
      createdBy: S.user?.name||'Sistema',
    };
    const saved = await POST('/financial/entries', entry);
    if(saved && saved._id) entry._id = saved._id;
    if(!S.financialEntries) S.financialEntries = [];
    S.financialEntries.unshift(entry);
  }catch(e){ console.warn('registrarReceitaVenda:', e); }
}
