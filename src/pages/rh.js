// ── MODULO RH (Recursos Humanos) ─────────────────────────────
// Visao consolidada para o ADM/Gerente:
//   1. Pontos Eletronicos (diario / semanal / mensal) por colaborador
//   2. Comissoes (semanais / mensais) por colaborador
//
// Filtros: por data range, mes, semana, ou colaborador especifico.
import { S } from '../state.js';
import { $c } from '../utils/formatters.js';
import { GET } from '../services/api.js';
import { toast } from '../utils/helpers.js';
import { getColabs } from '../services/auth.js';

// ── CACHE ────────────────────────────────────────────────────
let _pontosCache = null;
let _pontosCacheAt = 0;
let _ordersCache = null;
let _ordersCacheAt = 0;

async function loadPontos() {
  if (_pontosCache && (Date.now() - _pontosCacheAt) < 30_000) return _pontosCache;
  try {
    const r = await GET('/ponto').catch(() => null);
    _pontosCache = Array.isArray(r) ? r : (r?.records || r?.data || []);
    _pontosCacheAt = Date.now();
    return _pontosCache;
  } catch { return []; }
}
async function loadOrders() {
  if (_ordersCache && (Date.now() - _ordersCacheAt) < 5*60_000) return _ordersCache;
  try {
    const r = await GET('/orders?limit=2000').catch(() => null);
    _ordersCache = Array.isArray(r) ? r : [];
    _ordersCacheAt = Date.now();
    return _ordersCache;
  } catch { return []; }
}

// ── HELPERS ──────────────────────────────────────────────────
function _colabKey(c) { return String(c?._id || c?.id || c?.backendId || c?.email || c?.name || ''); }
function _isMine(colab, ...vals) {
  if (!colab) return false;
  const ids = new Set([colab._id, colab.id, colab.backendId].filter(Boolean).map(String));
  const emailLow = String(colab.email||'').toLowerCase();
  const nameLow  = String(colab.name ||'').toLowerCase();
  for (const v of vals) {
    if (v == null || v === '') continue;
    const s = String(v); const sLow = s.toLowerCase();
    if (ids.has(s)) return true;
    if (emailLow && sLow === emailLow) return true;
    if (nameLow  && sLow === nameLow)  return true;
  }
  return false;
}

const _PG_APROV = new Set(['Aprovado','Pago','aprovado','pago','Pago na Entrega','Recebido']);

// Calcula range a partir de tipo de filtro
function getRange(tipo, dataBase = new Date()) {
  const d = new Date(dataBase); d.setHours(0,0,0,0);
  let inicio, fim;
  if (tipo === 'dia') {
    inicio = new Date(d);
    fim = new Date(d); fim.setHours(23,59,59,999);
  } else if (tipo === 'semana') {
    const dow = d.getDay();
    inicio = new Date(d); inicio.setDate(d.getDate() - dow);
    fim = new Date(inicio); fim.setDate(inicio.getDate() + 6); fim.setHours(23,59,59,999);
  } else if (tipo === 'mes_ant') {
    inicio = new Date(d.getFullYear(), d.getMonth()-1, 1);
    fim = new Date(d.getFullYear(), d.getMonth(), 0); fim.setHours(23,59,59,999);
  } else if (tipo === 'todos') {
    inicio = new Date(2020,0,1); fim = new Date(2099,11,31,23,59,59,999);
  } else { // mes
    inicio = new Date(d.getFullYear(), d.getMonth(), 1);
    fim = new Date(d.getFullYear(), d.getMonth()+1, 0); fim.setHours(23,59,59,999);
  }
  return { inicio, fim };
}

function fmtData(iso) { if (!iso) return '—'; const [y,m,d] = String(iso).slice(0,10).split('-'); return `${d}/${m}/${y}`; }
function escHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ── CALCULO DE PONTOS POR COLAB E PERIODO ────────────────────
// Retorna lista de dias para a colab no range, com horas trabalhadas.
function pontosColabPeriodo(colab, pontos, inicio, fim) {
  const ck = _colabKey(colab);
  const meusIds = new Set([colab._id, colab.id, colab.backendId].filter(Boolean).map(String));
  const meuEmail = String(colab.email||'').toLowerCase();
  const meusNomes = new Set([(colab.name||'').toLowerCase()].filter(Boolean));

  const meus = pontos.filter(r => {
    const rid = String(r.userId||r.colabId||r.user||'');
    if (rid && meusIds.has(rid)) return true;
    const remail = String(r.userEmail||r.email||'').toLowerCase();
    if (meuEmail && remail === meuEmail) return true;
    const rnome = String(r.userName||r.name||'').toLowerCase();
    if (rnome && meusNomes.has(rnome)) return true;
    return false;
  });

  // Para cada record, monta { data, entrada, saidaAlmoco, voltaAlmoco, saida, horas }
  // Aceita formato consolidado (chegada/saida etc.) ou eventos antigos
  const grupos = {};
  for (const r of meus) {
    const data = r.date || (r.createdAt||'').slice(0,10); if (!data) continue;
    const d = new Date(data + 'T12:00:00');
    if (d < inicio || d > fim) continue;
    if (!grupos[data]) grupos[data] = { data, entrada:'', saidaAlmoco:'', voltaAlmoco:'', saida:'' };
    if (r.chegada || r.entrada || r.saidaAlmoco || r.voltaAlmoco || r.saida) {
      // Formato consolidado
      grupos[data].entrada     = grupos[data].entrada     || r.chegada || r.entrada || '';
      grupos[data].saidaAlmoco = grupos[data].saidaAlmoco || r.saidaAlmoco || '';
      grupos[data].voltaAlmoco = grupos[data].voltaAlmoco || r.voltaAlmoco || '';
      grupos[data].saida       = grupos[data].saida       || r.saida       || '';
    } else if (r.type) {
      // Formato eventos antigo
      const t = String(r.type||'').toLowerCase(); const hora = r.time||'';
      if (t.includes('entrada') || t === 'chegada') grupos[data].entrada = hora;
      else if (t.includes('saida_almoco') || t.includes('saidaalmoco')) grupos[data].saidaAlmoco = hora;
      else if (t.includes('volta_almoco') || t.includes('voltaalmoco') || t === 'volta') grupos[data].voltaAlmoco = hora;
      else if (t.includes('saida')) grupos[data].saida = hora;
    }
  }

  // Calcula horas trabalhadas
  const lista = Object.values(grupos).map(g => ({ ...g, horas: calcHorasStr(g) }));
  return lista.sort((a,b) => a.data.localeCompare(b.data));
}

function toMin(hm) { if (!hm) return 0; const [h,m] = hm.split(':').map(Number); return (h||0)*60 + (m||0); }
function calcHorasStr(g) {
  if (!g.entrada || !g.saida) return '—';
  const total = toMin(g.saida) - toMin(g.entrada);
  const almoco = (g.saidaAlmoco && g.voltaAlmoco) ? (toMin(g.voltaAlmoco) - toMin(g.saidaAlmoco)) : 0;
  const liquido = Math.max(0, total - almoco);
  const hh = Math.floor(liquido/60); const mm = liquido%60;
  return `${hh}h${String(mm).padStart(2,'0')}`;
}

// ── CALCULO DE COMISSOES POR COLAB E PERIODO ─────────────────
function comissoesColabPeriodo(colab, orders, inicio, fim) {
  const m = colab.metas || {};
  const PCT_VENDA  = Number(m.comissaoVenda || m.comissaoPct) || 0;
  const POR_MONT   = Number(m.comissaoMontagem) || 0;
  const POR_EXP    = Number(m.comissaoExpedicao) || 0;
  let vCount=0, vTotal=0, vCom=0, mCount=0, mCom=0, eCount=0, eCom=0;

  for (const o of orders) {
    const dRaw = o.createdAt || o.scheduledDate; if (!dRaw) continue;
    const d = new Date(dRaw); if (d < inicio || d > fim) continue;
    const itQty = (o.items||[]).reduce((s,i)=>s+(Number(i.qty)||1), 0) || 1;

    // VENDAS
    if (_PG_APROV.has(String(o.paymentStatus||''))) {
      const ehMinha = _isMine(colab, o.vendedorId, o.vendedorEmail) ||
        (!o.vendedorId && _isMine(colab, o.createdByColabId, o.createdByEmail, o.criadoPor, o.createdBy, o.createdByName));
      if (ehMinha) {
        vCount++;
        vTotal += Number(o.total)||0;
        vCom   += (Number(o.total)||0) * (PCT_VENDA/100);
      }
    }
    // MONTAGEM
    const st = String(o.status||'').toLowerCase();
    if (['pronto','saiu p/ entrega','entregue'].some(x => st.includes(x))) {
      if (_isMine(colab, o.montadorId, o.montadorEmail, o.montadorNome)) {
        mCount += itQty;
        mCom   += POR_MONT * itQty;
      }
    }
    // EXPEDICAO
    if (st.includes('entregue')) {
      if (_isMine(colab, o.expedidorId, o.expedidorEmail, o.driverColabId, o.driverName)) {
        eCount++;
        eCom += POR_EXP;
      }
    }
  }
  return {
    vendas: vCount, vendaValor: vTotal, vendaComissao: vCom,
    montagens: mCount, montagemComissao: mCom,
    expedicoes: eCount, expedicaoComissao: eCom,
    total: vCom + mCom + eCom,
  };
}

// ─────────────────────────────────────────────────────────────
//                          RENDER
// ─────────────────────────────────────────────────────────────
export function renderRH() {
  const sub = S._rhSub || 'pontos';
  const subBtn = (k, label) => `<button type="button" class="tab ${sub===k?'active':''}" data-rh-sub="${k}" style="font-size:12px;">${label}</button>`;

  // Dispara cargas em background — re-renderiza quando chega
  if (_pontosCache === null) loadPontos().then(() => import('../main.js').then(m => m.render()).catch(()=>{}));
  if (_ordersCache === null) loadOrders().then(() => import('../main.js').then(m => m.render()).catch(()=>{}));

  return `
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
  <div>
    <div style="font-family:'Playfair Display',serif;font-size:22px;color:#9F1239;">🧑‍💼 RH — Recursos Humanos</div>
    <div style="font-size:12px;color:var(--muted);">Pontos eletrônicos · Comissões · Filtros por período e colab</div>
  </div>
</div>

${renderRHFiltros()}

<div class="tabs" style="margin-bottom:14px;gap:5px;">
  ${subBtn('pontos',    '🕐 Pontos Eletrônicos')}
  ${subBtn('comissoes', '💰 Comissões')}
</div>

${sub === 'pontos'    ? renderRHPontos()    : ''}
${sub === 'comissoes' ? renderRHComissoes() : ''}
`;
}

// ─── FILTROS GLOBAIS ─────────────────────────────────────────
function renderRHFiltros() {
  const periodo  = S._rhPeriodo || 'mes';
  const colabId  = S._rhColabId || '';
  const d1       = S._rhDate1 || '';
  const d2       = S._rhDate2 || '';
  const colabs   = getColabs().filter(c => c.active !== false).sort((a,b) => (a.name||'').localeCompare(b.name||''));

  const perBtn = (k, l) => `<button class="btn btn-sm ${periodo===k?'btn-primary':'btn-ghost'}" data-rh-periodo="${k}">${l}</button>`;

  return `<div class="card" style="margin-bottom:14px;">
  <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;">
    <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;">📅 Período:</div>
    ${perBtn('dia',     'Hoje')}
    ${perBtn('semana',  'Semana')}
    ${perBtn('mes',     'Este Mês')}
    ${perBtn('mes_ant', 'Mês Anterior')}
    ${perBtn('todos',   'Todos')}
    ${perBtn('custom',  '📅 Datas')}

    <div style="margin-left:auto;display:flex;gap:8px;align-items:center;">
      <span style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;">👤 Colab:</span>
      <select class="fi" id="rh-colab" style="width:auto;min-width:200px;">
        <option value="">Todos os colaboradores</option>
        ${colabs.map(c => { const k = _colabKey(c); return `<option value="${k}" ${colabId===k?'selected':''}>${escHtml(c.name||'')} (${escHtml(c.cargo||'')})</option>`; }).join('')}
      </select>
    </div>
  </div>

  ${periodo === 'custom' ? `
  <div style="display:flex;gap:10px;align-items:center;margin-top:10px;padding-top:10px;border-top:1px solid var(--border);">
    <span style="font-size:11px;font-weight:700;color:var(--muted);">📅 Custom:</span>
    <div class="fg" style="margin:0;"><label class="fl" style="font-size:10px;">Início</label>
      <input type="date" class="fi" id="rh-date1" value="${d1}" style="width:auto;"/></div>
    <div class="fg" style="margin:0;"><label class="fl" style="font-size:10px;">Fim</label>
      <input type="date" class="fi" id="rh-date2" value="${d2}" style="width:auto;"/></div>
  </div>` : ''}
</div>`;
}

// ─── PONTOS ──────────────────────────────────────────────────
function renderRHPontos() {
  const periodo = S._rhPeriodo || 'mes';
  const colabId = S._rhColabId || '';
  let inicio, fim;
  if (periodo === 'custom' && (S._rhDate1 || S._rhDate2)) {
    inicio = S._rhDate1 ? new Date(S._rhDate1+'T00:00:00') : new Date(2020,0,1);
    fim    = S._rhDate2 ? new Date(S._rhDate2+'T23:59:59') : new Date(2099,11,31);
  } else {
    const r = getRange(periodo); inicio = r.inicio; fim = r.fim;
  }

  const pontos = _pontosCache || [];
  const colabs = getColabs().filter(c => c.active !== false);
  const alvo = colabId ? colabs.filter(c => _colabKey(c) === colabId) : colabs;

  if (!pontos.length) {
    return `<div class="card" style="text-align:center;padding:40px;color:var(--muted);">
      <div style="font-size:36px;">🕐</div><p>Carregando pontos...</p>
    </div>`;
  }

  // Para cada colab, calcula dias do periodo
  const dadosCol = alvo.map(c => {
    const dias = pontosColabPeriodo(c, pontos, inicio, fim);
    const totalDias = dias.length;
    const totalMin = dias.reduce((s,g) => {
      if (!g.entrada || !g.saida) return s;
      const total = toMin(g.saida) - toMin(g.entrada);
      const almoco = (g.saidaAlmoco && g.voltaAlmoco) ? (toMin(g.voltaAlmoco) - toMin(g.saidaAlmoco)) : 0;
      return s + Math.max(0, total - almoco);
    }, 0);
    const totalH = `${Math.floor(totalMin/60)}h${String(totalMin%60).padStart(2,'0')}`;
    return { colab: c, dias, totalDias, totalH };
  }).filter(d => d.dias.length > 0 || colabId); // se filtrou por 1 colab mostra mesmo se vazio

  if (!dadosCol.length) {
    return `<div class="card" style="text-align:center;padding:40px;color:var(--muted);">
      <div style="font-size:36px;">📭</div><p>Nenhum ponto registrado no período.</p>
    </div>`;
  }

  return `<div style="display:grid;gap:14px;">
    ${dadosCol.map(d => `<div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--border);">
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="width:40px;height:40px;border-radius:50%;background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;">${(d.colab.name||'?').charAt(0).toUpperCase()}</div>
          <div>
            <div style="font-size:15px;font-weight:800;">${escHtml(d.colab.name||'')}</div>
            <div style="font-size:11px;color:var(--muted);">${escHtml(d.colab.cargo||'')}</div>
          </div>
        </div>
        <div style="display:flex;gap:14px;">
          <div style="text-align:center;">
            <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Dias</div>
            <div style="font-size:20px;font-weight:900;color:#1E293B;">${d.totalDias}</div>
          </div>
          <div style="text-align:center;">
            <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Horas Trab.</div>
            <div style="font-size:20px;font-weight:900;color:#15803D;">${d.totalH}</div>
          </div>
        </div>
      </div>
      ${d.dias.length === 0 ? `<div style="text-align:center;color:var(--muted);font-size:12px;padding:10px;">Sem pontos no período</div>` : `
      <div style="overflow-x:auto;">
        <table style="width:100%;font-size:12px;border-collapse:collapse;">
          <thead><tr style="background:#FAFAFA;">
            <th style="padding:8px 6px;text-align:left;font-size:10px;color:#94A3B8;text-transform:uppercase;">Data</th>
            <th style="padding:8px 6px;text-align:center;font-size:10px;color:#94A3B8;text-transform:uppercase;">Entrada</th>
            <th style="padding:8px 6px;text-align:center;font-size:10px;color:#94A3B8;text-transform:uppercase;">Almoço</th>
            <th style="padding:8px 6px;text-align:center;font-size:10px;color:#94A3B8;text-transform:uppercase;">Retorno</th>
            <th style="padding:8px 6px;text-align:center;font-size:10px;color:#94A3B8;text-transform:uppercase;">Saída</th>
            <th style="padding:8px 6px;text-align:right;font-size:10px;color:#94A3B8;text-transform:uppercase;">Horas</th>
          </tr></thead>
          <tbody>
            ${d.dias.slice().reverse().map(g => `<tr style="border-bottom:1px solid #F1F5F9;">
              <td style="padding:6px;font-weight:600;font-size:11px;">${fmtData(g.data)}</td>
              <td style="padding:6px;text-align:center;font-family:Monaco,monospace;color:#15803D;font-weight:600;">${g.entrada || '—'}</td>
              <td style="padding:6px;text-align:center;font-family:Monaco,monospace;color:#D97706;">${g.saidaAlmoco || '—'}</td>
              <td style="padding:6px;text-align:center;font-family:Monaco,monospace;color:#D97706;">${g.voltaAlmoco || '—'}</td>
              <td style="padding:6px;text-align:center;font-family:Monaco,monospace;color:#DC2626;font-weight:600;">${g.saida || '—'}</td>
              <td style="padding:6px;text-align:right;font-weight:700;color:#15803D;">${g.horas}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      `}
    </div>`).join('')}
  </div>`;
}

// ─── COMISSOES ───────────────────────────────────────────────
function renderRHComissoes() {
  const periodo = S._rhPeriodo || 'mes';
  const colabId = S._rhColabId || '';
  let inicio, fim;
  if (periodo === 'custom' && (S._rhDate1 || S._rhDate2)) {
    inicio = S._rhDate1 ? new Date(S._rhDate1+'T00:00:00') : new Date(2020,0,1);
    fim    = S._rhDate2 ? new Date(S._rhDate2+'T23:59:59') : new Date(2099,11,31);
  } else {
    const r = getRange(periodo); inicio = r.inicio; fim = r.fim;
  }

  const orders = _ordersCache || [];
  if (!orders.length) {
    return `<div class="card" style="text-align:center;padding:40px;color:var(--muted);">
      <div style="font-size:36px;">💰</div><p>Carregando pedidos...</p>
    </div>`;
  }

  const colabs = getColabs().filter(c => c.active !== false);
  const alvo = colabId ? colabs.filter(c => _colabKey(c) === colabId) : colabs;

  const linhas = alvo.map(c => ({
    colab: c,
    com: comissoesColabPeriodo(c, orders, inicio, fim),
  })).filter(l => l.com.total > 0 || colabId)
    .sort((a,b) => b.com.total - a.com.total);

  const totGeral = linhas.reduce((s,l) => s + l.com.total, 0);

  if (!linhas.length) {
    return `<div class="card" style="text-align:center;padding:40px;color:var(--muted);">
      <div style="font-size:36px;">📭</div><p>Sem comissões no período.</p>
    </div>`;
  }

  return `
<div class="card" style="margin-bottom:14px;background:linear-gradient(135deg,#DCFCE7,#F0FDF4);border:2px solid #86EFAC;">
  <div style="display:flex;justify-content:space-between;align-items:center;">
    <div>
      <div style="font-size:11px;color:#15803D;text-transform:uppercase;font-weight:700;">Total de Comissões no Período</div>
      <div style="font-size:28px;font-weight:900;color:#15803D;">${$c(totGeral)}</div>
    </div>
    <div style="text-align:right;font-size:13px;color:#15803D;">
      ${linhas.length} colaborador(es)<br/>
      <span style="font-size:11px;opacity:.8;">${fmtData(inicio.toISOString())} → ${fmtData(fim.toISOString())}</span>
    </div>
  </div>
</div>

<div class="card" style="overflow-x:auto;">
  <table style="width:100%;font-size:12px;border-collapse:collapse;">
    <thead><tr style="background:#FAFAFA;border-bottom:2px solid var(--border);">
      <th style="padding:10px;text-align:left;font-size:10px;color:#94A3B8;text-transform:uppercase;">Colaborador</th>
      <th style="padding:10px;text-align:right;font-size:10px;color:#15803D;text-transform:uppercase;" title="Vendas">💰 Vendas</th>
      <th style="padding:10px;text-align:right;font-size:10px;color:#15803D;text-transform:uppercase;">Comissão Vendas</th>
      <th style="padding:10px;text-align:right;font-size:10px;color:#92400E;text-transform:uppercase;">🌹 Montagens</th>
      <th style="padding:10px;text-align:right;font-size:10px;color:#92400E;text-transform:uppercase;">Comissão Mont.</th>
      <th style="padding:10px;text-align:right;font-size:10px;color:#1E40AF;text-transform:uppercase;">🚚 Entregas</th>
      <th style="padding:10px;text-align:right;font-size:10px;color:#1E40AF;text-transform:uppercase;">Comissão Exp.</th>
      <th style="padding:10px;text-align:right;font-size:10px;color:#9F1239;text-transform:uppercase;">Total</th>
    </tr></thead>
    <tbody>
      ${linhas.map(l => `<tr style="border-bottom:1px solid #F1F5F9;">
        <td style="padding:10px;">
          <div style="font-weight:700;">${escHtml(l.colab.name||'')}</div>
          <div style="font-size:10px;color:var(--muted);">${escHtml(l.colab.cargo||'')}</div>
        </td>
        <td style="padding:10px;text-align:right;color:#15803D;font-weight:600;">${l.com.vendas}<div style="font-size:10px;color:var(--muted);">${$c(l.com.vendaValor)}</div></td>
        <td style="padding:10px;text-align:right;color:#15803D;font-weight:800;">${$c(l.com.vendaComissao)}</td>
        <td style="padding:10px;text-align:right;color:#92400E;font-weight:600;">${l.com.montagens}</td>
        <td style="padding:10px;text-align:right;color:#92400E;font-weight:800;">${$c(l.com.montagemComissao)}</td>
        <td style="padding:10px;text-align:right;color:#1E40AF;font-weight:600;">${l.com.expedicoes}</td>
        <td style="padding:10px;text-align:right;color:#1E40AF;font-weight:800;">${$c(l.com.expedicaoComissao)}</td>
        <td style="padding:10px;text-align:right;color:#9F1239;font-weight:900;font-size:14px;">${$c(l.com.total)}</td>
      </tr>`).join('')}
    </tbody>
    <tfoot><tr style="background:#FAFAFA;font-weight:800;">
      <td style="padding:10px;">TOTAL</td>
      <td style="padding:10px;text-align:right;">${linhas.reduce((s,l)=>s+l.com.vendas,0)}</td>
      <td style="padding:10px;text-align:right;color:#15803D;">${$c(linhas.reduce((s,l)=>s+l.com.vendaComissao,0))}</td>
      <td style="padding:10px;text-align:right;">${linhas.reduce((s,l)=>s+l.com.montagens,0)}</td>
      <td style="padding:10px;text-align:right;color:#92400E;">${$c(linhas.reduce((s,l)=>s+l.com.montagemComissao,0))}</td>
      <td style="padding:10px;text-align:right;">${linhas.reduce((s,l)=>s+l.com.expedicoes,0)}</td>
      <td style="padding:10px;text-align:right;color:#1E40AF;">${$c(linhas.reduce((s,l)=>s+l.com.expedicaoComissao,0))}</td>
      <td style="padding:10px;text-align:right;color:#9F1239;font-size:15px;">${$c(totGeral)}</td>
    </tr></tfoot>
  </table>
</div>

<div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:10px;padding:10px;margin-top:12px;font-size:11px;color:#1E40AF;">
  💡 As comissões usam os valores cadastrados em cada colaboradora (Comissão por Venda %, R$/Montagem, R$/Expedição).
</div>
`;
}

// ── BINDINGS ─────────────────────────────────────────────────
export function bindRHEvents() {
  const render = () => import('../main.js').then(m => m.render()).catch(()=>{});

  document.querySelectorAll('[data-rh-sub]').forEach(b => {
    b.addEventListener('click', () => { S._rhSub = b.dataset.rhSub; render(); });
  });
  document.querySelectorAll('[data-rh-periodo]').forEach(b => {
    b.addEventListener('click', () => { S._rhPeriodo = b.dataset.rhPeriodo; render(); });
  });
  document.getElementById('rh-colab')?.addEventListener('change', e => {
    S._rhColabId = e.target.value; render();
  });
  document.getElementById('rh-date1')?.addEventListener('change', e => { S._rhDate1 = e.target.value; render(); });
  document.getElementById('rh-date2')?.addEventListener('change', e => { S._rhDate2 = e.target.value; render(); });
}
