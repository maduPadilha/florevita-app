import { S } from '../state.js';
import { $c, $d, sc, ini } from '../utils/formatters.js';
import { findColab } from '../services/auth.js';

// ── Helpers locais (metas / atividades) ─────────────────────
function getActivities(){ return JSON.parse(localStorage.getItem('fv_activities')||'[]'); }

function getMetasPeriod(per){
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

function getColabStats(colab){
  if(!colab) return {vendas:0,comissao:0,montagens:0,expedicoes:0};
  const acts = getActivities();
  // Identifica userId do colaborador — pode ser backendId ou id local
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

// ── DASHBOARD ────────────────────────────────────────────────
export function renderDashboard(){
  const today = new Date().toDateString();
  const validOrders = S.orders.filter(o=>o.status!=='Cancelado');
  const total = validOrders.reduce((s,o)=>s+(o.total||0),0);
  const hoje = S.orders.filter(o=>new Date(o.createdAt).toDateString()===today).length;
  const avg = validOrders.length ? total/validOrders.length : 0;
  const entregues = S.orders.filter(o=>o.status==='Entregue').length;

  // E-commerce KPIs
  const ecomOrders = validOrders.filter(o=>o.source==='E-commerce'||(o.source||'').toLowerCase().includes('ecomm'));
  const ecomTotal  = ecomOrders.reduce((s,o)=>s+(o.total||0),0);
  const ecomHoje   = ecomOrders.filter(o=>new Date(o.createdAt).toDateString()===today).length;

  // Alerta de dados vazios — mostra botão de recarregar
  const dadosVazios = S.products.length===0 && S.orders.length===0 && S.clients.length===0;
  const alertaVazio = dadosVazios ? `
  <div style="background:#FEF3C7;border:1.5px solid #F59E0B;border-radius:12px;padding:16px 20px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
    <div>
      <div style="font-weight:700;color:#92400E;margin-bottom:4px;">⚠️ Dados não carregados</div>
      <div style="font-size:13px;color:#78350F;">Servidor sem resposta após várias tentativas. Clique em Recarregar ou verifique os Logs no Render (dashboard.render.com).</div>
    </div>
    <button onclick="recarregarDados()" class="btn btn-primary" style="background:#F59E0B;border-color:#F59E0B;white-space:nowrap;">
      🔄 Recarregar Dados
    </button>
  </div>` : '';

  // ── Painel "Minhas Metas" para colaboradores ──────────────
  const colab = findColab(S.user?.email||S.user?._id||'');
  const mt = colab?.metas||{};
  const temMetas = mt.vendaPct||mt.montagemQtd||mt.expedicaoQtd;
  const stats = colab ? getColabStats(colab) : null;

  const minhaMetasPanel = (colab && temMetas && stats) ? `
<div style="background:linear-gradient(135deg,var(--rose-l),var(--petal));border:1px solid rgba(200,115,106,.2);border-radius:var(--rl);padding:14px;margin-bottom:16px;">
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
    <span style="font-size:18px">🎯</span>
    <div>
      <div style="font-family:'Playfair Display',serif;font-size:15px;">Minhas Metas</div>
      <div style="font-size:11px;color:var(--muted)">Olá, ${colab.name.split(' ')[0]}! Veja seu desempenho de hoje.</div>
    </div>
  </div>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px;">
    ${mt.vendaPct?`<div style="background:#fff;border-radius:10px;padding:10px;text-align:center;">
      <div style="font-size:10px;color:var(--muted);margin-bottom:2px;">💰 Comissão acumulada</div>
      <div style="font-size:20px;font-weight:800;color:var(--leaf)">R$ ${stats.comissao.toFixed(2)}</div>
      <div style="font-size:10px;color:var(--muted)">${stats.vendas} vendas · ${mt.vendaPct}% / venda</div>
    </div>`:''}
    ${mt.montagemQtd?`<div style="background:#fff;border-radius:10px;padding:10px;">
      <div style="font-size:10px;color:var(--muted);margin-bottom:4px;">🌸 Montagem / ${mt.montagemPer||'dia'}</div>
      ${metaBar(stats.montagens, mt.montagemQtd, '', '')}
      <div style="font-size:11px;text-align:center;color:var(--muted);margin-top:2px">${stats.montagens} de ${mt.montagemQtd}</div>
    </div>`:''}
    ${mt.expedicaoQtd?`<div style="background:#fff;border-radius:10px;padding:10px;">
      <div style="font-size:10px;color:var(--muted);margin-bottom:4px;">📦 Expedição / ${mt.expedicaoPer||'dia'}</div>
      ${metaBar(stats.expedicoes, mt.expedicaoQtd, '', '')}
      <div style="font-size:11px;text-align:center;color:var(--muted);margin-top:2px">${stats.expedicoes} de ${mt.expedicaoQtd}</div>
    </div>`:''}
  </div>
</div>` : '';

  return`
${alertaVazio}
${minhaMetasPanel}
<div class="g4" style="margin-bottom:16px;">
  <div class="mc rose"><div class="mc-label">Faturamento Total</div><div class="mc-val">${$c(total)}</div><div class="mc-sub">${S.orders.length} pedidos</div></div>
  <div class="mc leaf"><div class="mc-label">Pedidos Hoje</div><div class="mc-val">${hoje}</div><div class="mc-sub">${ecomHoje>0?ecomHoje+' e-commerce':''}</div></div>
  <div class="mc gold"><div class="mc-label">Entregues</div><div class="mc-val">${entregues}</div><div class="mc-sub">Ticket médio ${$c(avg)}</div></div>
  <div class="mc purple"><div class="mc-label">E-commerce</div><div class="mc-val">${$c(ecomTotal)}</div><div class="mc-sub">${ecomOrders.length} pedidos online</div></div>
</div>

${S.user.unit==='Todas'||S.user.role==='Administrador'?`
<div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Vendas por Canal / Unidade</div>
<div class="g4" style="margin-bottom:16px;">
  ${(()=>{
    const canais=[
      {k:'Loja Novo Aleixo',color:'blue'},
      {k:'Loja Allegro Mall',color:'blue'},
      {k:'CDLE',color:'blue'},
      {k:'E-commerce',color:'purple'},
    ];
    return canais.map(c=>{
      const isEcom=c.k==='E-commerce';
      const cOrders=isEcom
        ? S.orders.filter(o=>o.source==='E-commerce'||(o.source||'').toLowerCase().includes('ecomm'))
        : S.orders.filter(o=>o.unit===c.k&&o.source!=='E-commerce');
      const cTotal=cOrders.reduce((s,o)=>s+(o.total||0),0);
      const hojeStr=new Date().toDateString();
      const hojeQ=cOrders.filter(o=>new Date(o.createdAt||o.scheduledDate||Date.now()).toDateString()===hojeStr).length;
      return`<div class="mc ${c.color}"><div class="mc-label" style="font-size:11px">${c.k}</div><div class="mc-val">${$c(cTotal)}</div><div class="mc-sub">${cOrders.length} pedidos${hojeQ?' ('+hojeQ+' hoje)':''}</div></div>`;
    }).join('');
  })()}
</div>`:''}

<div class="card">
    <div class="card-title">Últimos Pedidos <button class="btn btn-outline btn-sm" onclick="setPage('pedidos')">Ver todos</button></div>
    ${S.orders.length===0?`<div class="empty"><div class="empty-icon">📋</div><p>Sem pedidos ainda</p><button class="btn btn-primary btn-sm" onclick="setPage('pdv')" style="margin-top:8px">Criar pedido</button></div>`:`
    <table><thead><tr><th>#</th><th>Cliente</th><th>Bairro</th><th>Total</th><th>Status</th><th>Entregador</th><th>Data</th></tr></thead>
    <tbody>${S.orders.slice(0,8).map(o=>{
      const bairro = o.deliveryNeighborhood || o.endereco?.bairro || o.neighborhood || '';
      return`<tr>
      <td style="color:var(--rose);font-weight:600">${o.orderNumber||o.numero||'—'}</td>
      <td style="font-weight:500">${o.client?.name||o.clientName||o.cliente?.nome||'—'}</td>
      <td style="font-size:11px;color:var(--muted)">${bairro||'—'}</td>
      <td style="font-weight:600">${$c(o.total)}</td>
      <td>${o.status==='Saiu p/ entrega'&&o.driverName
        ?`<div style="display:inline-flex;flex-direction:column;gap:3px;"><span class="tag ${sc(o.status)}">${o.status}</span></div>`
        :o.status==='Entregue'&&o.driverName
        ?`<div style="display:inline-flex;flex-direction:column;gap:3px;"><span class="tag ${sc(o.status)}">${o.status}</span></div>`
        :`<span class="tag ${sc(o.status)}">${o.status}</span>`}</td>
      <td>${o.driverName
        ?(o.status==='Saiu p/ entrega'
          ?`<span style="background:#DBEAFE;color:#1D4ED8;border:1px solid #93C5FD;border-radius:20px;padding:2px 8px;font-size:10px;font-weight:700;">🚚 ${o.driverName}</span>`
          :o.status==='Entregue'
          ?`<span style="background:#DCFCE7;color:#166534;border:1px solid #86EFAC;border-radius:20px;padding:2px 8px;font-size:10px;font-weight:700;">✅ ${o.driverName}</span>`
          :`<span style="font-size:11px;color:var(--muted)">${o.driverName}</span>`)
        :`<span style="color:var(--muted);font-size:11px;">—</span>`}</td>
      <td style="color:var(--muted)">${$d(o.createdAt)}</td>
    </tr>`}).join('')}</tbody></table>`}
  </div>
</div>`;
}
