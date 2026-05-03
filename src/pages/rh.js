// ── MODULO RH (Recursos Humanos) ─────────────────────────────
// Visao consolidada para o ADM/Gerente:
//   1. Pontos Eletronicos (diario / semanal / mensal) por colaborador
//   2. Comissoes (semanais / mensais) por colaborador
//
// Filtros: por data range, mes, semana, ou colaborador especifico.
import { S } from '../state.js';
import { $c, esc } from '../utils/formatters.js';
import { GET } from '../services/api.js';
import { toast } from '../utils/helpers.js';
import { getColabs } from '../services/auth.js';
import { renderRHFolha, bindRHFolhaEvents } from './rh-folha.js';

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
  ${subBtn('horas',     '⏱️ Relatório de Horas')}
  ${subBtn('feriados',  '🎉 Trabalho em Feriados')}
  ${subBtn('comissoes', '💰 Comissões')}
  ${subBtn('folha',     '🧾 Folha de Pagamento')}
</div>

${sub === 'pontos'    ? renderRHPontos()    : ''}
${sub === 'horas'     ? renderRHHoras()     : ''}
${sub === 'feriados'  ? renderRHFeriados()  : ''}
${sub === 'comissoes' ? renderRHComissoes() : ''}
${sub === 'folha'     ? renderRHFolha()     : ''}
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

// ─── RELATORIO DE HORAS (mensal/dia/colab) ──────────────────
// ─── FERIADOS NACIONAIS + MANAUS/AM ─────────────────────────
// Lista de feriados nacionais (fixos) + alguns regionais de Manaus.
// Pascoa/Carnaval/Corpus Christi sao MOVEIS — calculados via algoritmo
// de Gauss para qualquer ano.
function _feriadosDoAno(ano) {
  // Pascoa pelo algoritmo de Gauss (Catholic Easter)
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19*a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2*e + 2*i - h - k) % 7;
  const m = Math.floor((a + 11*h + 22*l) / 451);
  const month = Math.floor((h + l - 7*m + 114) / 31);
  const day = ((h + l - 7*m + 114) % 31) + 1;
  const pascoa = new Date(ano, month-1, day);
  // Datas derivadas
  const carnavalTer = new Date(pascoa); carnavalTer.setDate(pascoa.getDate() - 47);
  const carnavalSeg = new Date(pascoa); carnavalSeg.setDate(pascoa.getDate() - 48);
  const sextaSanta  = new Date(pascoa); sextaSanta.setDate(pascoa.getDate() - 2);
  const corpus      = new Date(pascoa); corpus.setDate(pascoa.getDate() + 60);
  const fmt = (d) => `${ano}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  return [
    { data: `${ano}-01-01`, nome: 'Confraternização Universal',     escopo: 'Nacional' },
    { data: fmt(carnavalSeg), nome: 'Carnaval (segunda)',           escopo: 'Nacional (facultativo)' },
    { data: fmt(carnavalTer), nome: 'Carnaval (terça)',             escopo: 'Nacional (facultativo)' },
    { data: fmt(sextaSanta),  nome: 'Sexta-feira Santa',            escopo: 'Nacional' },
    { data: fmt(pascoa),      nome: 'Páscoa',                       escopo: 'Religioso' },
    { data: `${ano}-04-21`, nome: 'Tiradentes',                     escopo: 'Nacional' },
    { data: `${ano}-05-01`, nome: 'Dia do Trabalho',                escopo: 'Nacional' },
    { data: fmt(corpus),      nome: 'Corpus Christi',               escopo: 'Nacional (facultativo)' },
    { data: `${ano}-07-05`, nome: 'Adesão do Amazonas à Independência', escopo: 'Estadual (AM)' },
    { data: `${ano}-09-05`, nome: 'Elevação do Amazonas à Província', escopo: 'Estadual (AM)' },
    { data: `${ano}-09-07`, nome: 'Independência do Brasil',        escopo: 'Nacional' },
    { data: `${ano}-10-12`, nome: 'Nossa Senhora Aparecida',        escopo: 'Nacional' },
    { data: `${ano}-10-24`, nome: 'Aniversário de Manaus',          escopo: 'Municipal' },
    { data: `${ano}-11-02`, nome: 'Finados',                        escopo: 'Nacional' },
    { data: `${ano}-11-15`, nome: 'Proclamação da República',       escopo: 'Nacional' },
    { data: `${ano}-11-20`, nome: 'Consciência Negra',              escopo: 'Nacional' },
    { data: `${ano}-12-08`, nome: 'Nossa Senhora da Conceição',     escopo: 'Municipal (Manaus)' },
    { data: `${ano}-12-25`, nome: 'Natal',                          escopo: 'Nacional' },
  ];
}

function renderRHFeriados() {
  const ano = Number(S._rhFeriadoAno) || new Date().getFullYear();
  const colabFiltro = S._rhFeriadoColab || '';
  const feriados = _feriadosDoAno(ano);

  const pontos = _pontosCache || [];
  if (!pontos.length) {
    return `<div class="card" style="text-align:center;padding:40px;color:var(--muted);">
      <div style="font-size:36px;">⏳</div><p>Carregando registros de ponto...</p>
    </div>`;
  }

  const colabs = getColabs().filter(c => c.active !== false);
  // Colab de cada registro de ponto (lookup por userId)
  const colabPorId = {};
  colabs.forEach(c => {
    [c._id, c.id, c.backendId].filter(Boolean).forEach(k => { colabPorId[String(k)] = c; });
  });

  // Para cada feriado, lista quem trabalhou (tem qualquer registro
  // chegada/saida naquele dia)
  const dadosFeriados = feriados.map(f => {
    const trabalhou = [];
    for (const r of pontos) {
      const dataReg = r.date || (r.createdAt ? String(r.createdAt).slice(0,10) : '');
      if (dataReg !== f.data) continue;
      // Considera "trabalhou" se tem chegada OU entrada OU saida
      const tem = !!(r.chegada || r.entrada || r.saida || r.saidaAlmoco || r.voltaAlmoco);
      if (!tem) continue;
      const colab = colabPorId[String(r.userId||'')] || { name: r.userName||'?', cargo:'—', _id: r.userId };
      // Aplica filtro de colab se houver
      if (colabFiltro && _colabKey(colab) !== colabFiltro) continue;
      // Calcula horas trabalhadas
      let horasMin = 0;
      if (r.chegada && r.saida) {
        const total = toMin(r.saida) - toMin(r.chegada);
        const almoco = (r.saidaAlmoco && r.voltaAlmoco) ? (toMin(r.voltaAlmoco) - toMin(r.saidaAlmoco)) : 0;
        horasMin = Math.max(0, total - almoco);
      }
      trabalhou.push({
        colab,
        entrada: r.chegada || r.entrada || '',
        saidaAlmoco: r.saidaAlmoco || '',
        voltaAlmoco: r.voltaAlmoco || '',
        saida: r.saida || '',
        horasMin,
      });
    }
    // Ordena por nome
    trabalhou.sort((a,b) => (a.colab.name||'').localeCompare(b.colab.name||''));
    return { ...f, trabalhou };
  });

  // Filtra para mostrar so os que tem alguem que trabalhou (ou todos
  // se o ADM nao filtrou colab — assim ele ve feriados sem trabalho tb)
  const fmtH = (mins) => `${Math.floor(mins/60)}h${String(mins%60).padStart(2,'0')}`;
  const fmtData = (yyyymmdd) => { const [y,m,d] = yyyymmdd.split('-'); const dt = new Date(y,m-1,d); const dn = ['Dom','Seg','Ter','Qua','Qui','Sex','Sab'][dt.getDay()]; return `${d}/${m}/${y} (${dn})`; };

  const totalTrab = dadosFeriados.reduce((s,f) => s+f.trabalhou.length, 0);
  const feriadosComTrab = dadosFeriados.filter(f => f.trabalhou.length>0).length;

  return `
<!-- Filtros -->
<div class="card" style="margin-bottom:14px;padding:12px;background:linear-gradient(135deg,#FAE8E6,#FFF7F5);border:1px solid #FECDD3;">
  <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
    <span style="font-size:11px;font-weight:800;color:#9F1239;text-transform:uppercase;">📅 Ano:</span>
    <select class="fi" id="rh-feriado-ano" style="width:auto;font-size:12px;">
      ${[ano-2, ano-1, ano, ano+1].map(y => `<option value="${y}" ${y===ano?'selected':''}>${y}</option>`).join('')}
    </select>
    <span style="font-size:11px;font-weight:800;color:#9F1239;text-transform:uppercase;">👤 Colab:</span>
    <select class="fi" id="rh-feriado-colab" style="width:auto;font-size:12px;">
      <option value="">Todos</option>
      ${colabs.sort((a,b)=>(a.name||'').localeCompare(b.name||'')).map(c => {
        const k = _colabKey(c);
        return `<option value="${k}" ${colabFiltro===k?'selected':''}>${c.name||'?'}</option>`;
      }).join('')}
    </select>
    <span style="margin-left:auto;font-size:11px;color:#9F1239;font-weight:700;">${feriadosComTrab} feriado(s) com trabalho · ${totalTrab} registro(s)</span>
  </div>
</div>

<div style="display:grid;gap:10px;">
${dadosFeriados.map(f => {
  const dt = new Date(f.data+'T12:00:00');
  const passado = dt < new Date();
  const cor = f.trabalhou.length > 0 ? '#DC2626' : passado ? '#94A3B8' : '#15803D';
  const corBg = f.trabalhou.length > 0 ? '#FEE2E2' : passado ? '#F3F4F6' : '#DCFCE7';
  return `<div style="background:${corBg};border-left:5px solid ${cor};border-radius:8px;padding:12px 14px;">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:${f.trabalhou.length?'10px':'0'};">
      <div>
        <div style="font-size:14px;font-weight:800;color:#1E293B;">🎉 ${esc(f.nome)}</div>
        <div style="font-size:11px;color:var(--muted);">📅 ${fmtData(f.data)} · ${esc(f.escopo)}</div>
      </div>
      <div style="text-align:right;">
        ${f.trabalhou.length > 0
          ? `<div style="background:${cor};color:#fff;border-radius:20px;padding:4px 12px;font-size:12px;font-weight:800;">⚠️ ${f.trabalhou.length} trabalhou${f.trabalhou.length>1?'ram':''}</div>`
          : passado
            ? `<span style="font-size:11px;color:var(--muted);">Sem registros</span>`
            : `<span style="font-size:11px;color:#15803D;font-weight:700;">📅 Próximo</span>`}
      </div>
    </div>
    ${f.trabalhou.length > 0 ? `
    <div style="background:#fff;border-radius:6px;padding:8px;margin-top:6px;">
      <table style="width:100%;font-size:12px;border-collapse:collapse;">
        <thead><tr style="border-bottom:1px solid var(--border);">
          <th style="padding:5px 8px;text-align:left;font-size:10px;color:var(--muted);text-transform:uppercase;">Colab</th>
          <th style="padding:5px 8px;text-align:left;font-size:10px;color:var(--muted);text-transform:uppercase;">Cargo</th>
          <th style="padding:5px 8px;text-align:center;font-size:10px;color:var(--muted);text-transform:uppercase;">Entrada</th>
          <th style="padding:5px 8px;text-align:center;font-size:10px;color:var(--muted);text-transform:uppercase;">Almoço</th>
          <th style="padding:5px 8px;text-align:center;font-size:10px;color:var(--muted);text-transform:uppercase;">Retorno</th>
          <th style="padding:5px 8px;text-align:center;font-size:10px;color:var(--muted);text-transform:uppercase;">Saída</th>
          <th style="padding:5px 8px;text-align:right;font-size:10px;color:#DC2626;text-transform:uppercase;">Horas</th>
        </tr></thead>
        <tbody>
        ${f.trabalhou.map(t => `<tr style="border-bottom:1px solid #F1F5F9;">
          <td style="padding:5px 8px;font-weight:700;">${esc(t.colab.name||'')}</td>
          <td style="padding:5px 8px;font-size:11px;color:var(--muted);">${esc(t.colab.cargo||'')}</td>
          <td style="padding:5px 8px;text-align:center;font-family:Monaco,monospace;color:#15803D;">${t.entrada||'—'}</td>
          <td style="padding:5px 8px;text-align:center;font-family:Monaco,monospace;color:#D97706;">${t.saidaAlmoco||'—'}</td>
          <td style="padding:5px 8px;text-align:center;font-family:Monaco,monospace;color:#D97706;">${t.voltaAlmoco||'—'}</td>
          <td style="padding:5px 8px;text-align:center;font-family:Monaco,monospace;color:#DC2626;">${t.saida||'—'}</td>
          <td style="padding:5px 8px;text-align:right;font-weight:800;color:#DC2626;">${t.horasMin?fmtH(t.horasMin):'⚠️ incompl.'}</td>
        </tr>`).join('')}
        </tbody>
        <tfoot><tr style="background:#FEF2F2;font-weight:800;">
          <td colspan="6" style="padding:6px 8px;text-align:right;color:#DC2626;">Total horas em feriado:</td>
          <td style="padding:6px 8px;text-align:right;color:#DC2626;font-size:14px;">${fmtH(f.trabalhou.reduce((s,t)=>s+t.horasMin,0))}</td>
        </tr></tfoot>
      </table>
    </div>
    ` : ''}
  </div>`;
}).join('')}
</div>

<div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:10px;padding:10px;margin-top:14px;font-size:11px;color:#1E40AF;">
  💡 <strong>Como funciona:</strong> O sistema cruza a tabela de feriados (Nacional + AM + Manaus) com os pontos batidos.
  Quem aparece "trabalhou" tem direito a hora extra/folga compensatória conforme acordo trabalhista. Use para auditar
  e calcular adicionais devidos.
</div>
`;
}

function renderRHHoras() {
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
  if (!pontos.length) {
    return `<div class="card" style="text-align:center;padding:40px;color:var(--muted);">
      <div style="font-size:36px;">⏱️</div><p>Carregando registros...</p>
    </div>`;
  }

  const colabs = getColabs().filter(c => c.active !== false);
  const alvo = colabId ? colabs.filter(c => _colabKey(c) === colabId) : colabs;

  // Para cada colab, calcula totais + lista de dias
  const dadosCol = alvo.map(c => {
    const dias = pontosColabPeriodo(c, pontos, inicio, fim);
    const minPorDia = dias.map(g => {
      if (!g.entrada || !g.saida) return { data: g.data, min: 0, completo: false };
      const total = toMin(g.saida) - toMin(g.entrada);
      const almoco = (g.saidaAlmoco && g.voltaAlmoco) ? (toMin(g.voltaAlmoco) - toMin(g.saidaAlmoco)) : 0;
      const liquido = Math.max(0, total - almoco);
      return { data: g.data, min: liquido, completo: true,
        entrada: g.entrada, saidaAlmoco: g.saidaAlmoco, voltaAlmoco: g.voltaAlmoco, saida: g.saida };
    });
    const totalMin = minPorDia.reduce((s,d) => s+d.min, 0);
    const diasCompletos = minPorDia.filter(d => d.completo).length;
    const diasIncompletos = minPorDia.length - diasCompletos;
    return { colab: c, minPorDia, totalMin, diasCompletos, diasIncompletos, totalDias: minPorDia.length };
  }).filter(d => d.totalDias > 0 || colabId)
    .sort((a,b) => b.totalMin - a.totalMin);

  if (!dadosCol.length) {
    return `<div class="card" style="text-align:center;padding:40px;color:var(--muted);">
      <div style="font-size:36px;">📭</div><p>Nenhum ponto registrado no período selecionado.</p>
    </div>`;
  }

  const totalGeralMin = dadosCol.reduce((s,d) => s+d.totalMin, 0);
  const totalGeralDias = dadosCol.reduce((s,d) => s+d.diasCompletos, 0);
  const fmtH = (mins) => `${Math.floor(mins/60)}h${String(mins%60).padStart(2,'0')}`;

  return `
<!-- KPI consolidado do periodo -->
<div class="card" style="margin-bottom:14px;background:linear-gradient(135deg,#DBEAFE,#EFF6FF);border:2px solid #93C5FD;">
  <div style="display:flex;justify-content:space-around;align-items:center;flex-wrap:wrap;gap:14px;">
    <div style="text-align:center;">
      <div style="font-size:11px;color:#1E40AF;text-transform:uppercase;font-weight:700;">Colaboradores</div>
      <div style="font-size:28px;font-weight:900;color:#1E40AF;">${dadosCol.length}</div>
    </div>
    <div style="text-align:center;">
      <div style="font-size:11px;color:#1E40AF;text-transform:uppercase;font-weight:700;">Dias Trabalhados (total)</div>
      <div style="font-size:28px;font-weight:900;color:#1E40AF;">${totalGeralDias}</div>
    </div>
    <div style="text-align:center;">
      <div style="font-size:11px;color:#15803D;text-transform:uppercase;font-weight:700;">Horas Trabalhadas (total)</div>
      <div style="font-size:28px;font-weight:900;color:#15803D;">${fmtH(totalGeralMin)}</div>
    </div>
    <div style="text-align:center;">
      <div style="font-size:11px;color:#1E40AF;text-transform:uppercase;font-weight:700;">Período</div>
      <div style="font-size:14px;font-weight:700;color:#1E40AF;">${fmtData(inicio.toISOString())}<br/>→ ${fmtData(fim.toISOString())}</div>
    </div>
  </div>
</div>

<!-- Tabela RESUMO por colab -->
<div class="card" style="margin-bottom:14px;">
  <div class="card-title">📊 Resumo por Colaboradora — ${dadosCol.length} pessoa(s)</div>
  <div style="overflow-x:auto;">
    <table style="width:100%;font-size:12px;border-collapse:collapse;">
      <thead><tr style="background:#FAFAFA;border-bottom:2px solid var(--border);">
        <th style="padding:10px;text-align:left;font-size:10px;color:#94A3B8;text-transform:uppercase;">Colaborador</th>
        <th style="padding:10px;text-align:right;font-size:10px;color:#94A3B8;text-transform:uppercase;">Cargo</th>
        <th style="padding:10px;text-align:right;font-size:10px;color:#94A3B8;text-transform:uppercase;">Dias Completos</th>
        <th style="padding:10px;text-align:right;font-size:10px;color:#94A3B8;text-transform:uppercase;">Dias Incompletos</th>
        <th style="padding:10px;text-align:right;font-size:10px;color:#15803D;text-transform:uppercase;">Total Horas</th>
        <th style="padding:10px;text-align:right;font-size:10px;color:#94A3B8;text-transform:uppercase;">Média/dia</th>
      </tr></thead>
      <tbody>
        ${dadosCol.map(d => {
          const media = d.diasCompletos > 0 ? Math.round(d.totalMin / d.diasCompletos) : 0;
          return `<tr style="border-bottom:1px solid #F1F5F9;">
            <td style="padding:10px;font-weight:700;">${escHtml(d.colab.name||'')}</td>
            <td style="padding:10px;text-align:right;font-size:11px;color:var(--muted);">${escHtml(d.colab.cargo||'')}</td>
            <td style="padding:10px;text-align:right;color:#15803D;font-weight:700;">${d.diasCompletos}</td>
            <td style="padding:10px;text-align:right;color:${d.diasIncompletos>0?'#DC2626':'var(--muted)'};font-weight:600;">${d.diasIncompletos}</td>
            <td style="padding:10px;text-align:right;color:#15803D;font-weight:900;font-size:14px;">${fmtH(d.totalMin)}</td>
            <td style="padding:10px;text-align:right;color:#475569;font-weight:600;">${fmtH(media)}</td>
          </tr>`;
        }).join('')}
      </tbody>
      <tfoot><tr style="background:#FAFAFA;font-weight:800;">
        <td style="padding:10px;">TOTAL</td>
        <td></td>
        <td style="padding:10px;text-align:right;">${dadosCol.reduce((s,d)=>s+d.diasCompletos,0)}</td>
        <td style="padding:10px;text-align:right;">${dadosCol.reduce((s,d)=>s+d.diasIncompletos,0)}</td>
        <td style="padding:10px;text-align:right;color:#15803D;font-size:15px;">${fmtH(totalGeralMin)}</td>
        <td></td>
      </tr></tfoot>
    </table>
  </div>
</div>

<!-- DETALHE: dia a dia de cada colab (expandivel) -->
<div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:8px;letter-spacing:.5px;">📅 Detalhe Dia a Dia (clique para expandir)</div>
<div style="display:grid;gap:8px;">
  ${dadosCol.map(d => `
  <details class="card" style="padding:0;">
    <summary style="padding:12px 14px;cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
      <div style="display:flex;align-items:center;gap:10px;">
        <div style="width:32px;height:32px;border-radius:50%;background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;">${(d.colab.name||'?').charAt(0).toUpperCase()}</div>
        <div>
          <div style="font-weight:700;font-size:13px;">${escHtml(d.colab.name||'')}</div>
          <div style="font-size:10px;color:var(--muted);">${escHtml(d.colab.cargo||'')} · ${d.totalDias} dia(s) registrado(s)</div>
        </div>
      </div>
      <div style="display:flex;gap:14px;align-items:center;">
        <div style="text-align:right;">
          <div style="font-size:9px;color:var(--muted);text-transform:uppercase;">Total Mês</div>
          <div style="font-size:18px;font-weight:900;color:#15803D;">${fmtH(d.totalMin)}</div>
        </div>
        <span style="font-size:18px;color:var(--muted);">▼</span>
      </div>
    </summary>
    <div style="padding:0 14px 14px;border-top:1px solid var(--border);">
      <table style="width:100%;font-size:12px;border-collapse:collapse;margin-top:10px;">
        <thead><tr style="background:#FAFAFA;">
          <th style="padding:8px;text-align:left;font-size:10px;color:#94A3B8;text-transform:uppercase;">Data</th>
          <th style="padding:8px;text-align:center;font-size:10px;color:#94A3B8;text-transform:uppercase;">Entrada</th>
          <th style="padding:8px;text-align:center;font-size:10px;color:#94A3B8;text-transform:uppercase;">Almoço</th>
          <th style="padding:8px;text-align:center;font-size:10px;color:#94A3B8;text-transform:uppercase;">Retorno</th>
          <th style="padding:8px;text-align:center;font-size:10px;color:#94A3B8;text-transform:uppercase;">Saída</th>
          <th style="padding:8px;text-align:right;font-size:10px;color:#15803D;text-transform:uppercase;">Horas</th>
        </tr></thead>
        <tbody>
          ${d.minPorDia.slice().reverse().map(g => `<tr style="border-bottom:1px solid #F1F5F9;${g.completo?'':'background:#FEF3C7;'}">
            <td style="padding:6px 8px;font-weight:600;">${fmtData(g.data)}</td>
            <td style="padding:6px 8px;text-align:center;font-family:Monaco,monospace;color:#15803D;">${g.entrada||'—'}</td>
            <td style="padding:6px 8px;text-align:center;font-family:Monaco,monospace;color:#D97706;">${g.saidaAlmoco||'—'}</td>
            <td style="padding:6px 8px;text-align:center;font-family:Monaco,monospace;color:#D97706;">${g.voltaAlmoco||'—'}</td>
            <td style="padding:6px 8px;text-align:center;font-family:Monaco,monospace;color:#DC2626;">${g.saida||'—'}</td>
            <td style="padding:6px 8px;text-align:right;font-weight:800;color:${g.completo?'#15803D':'#DC2626'};">${g.completo?fmtH(g.min):'⚠️ incompl.'}</td>
          </tr>`).join('')}
        </tbody>
        <tfoot><tr style="background:#DCFCE7;font-weight:800;">
          <td colspan="5" style="padding:8px;text-align:right;color:#15803D;">Total ${escHtml(d.colab.name||'')}:</td>
          <td style="padding:8px;text-align:right;color:#15803D;font-size:14px;">${fmtH(d.totalMin)}</td>
        </tr></tfoot>
      </table>
    </div>
  </details>
  `).join('')}
</div>

<div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:10px;padding:10px;margin-top:14px;font-size:11px;color:#1E40AF;">
  💡 <strong>Cálculo:</strong> Horas trabalhadas = (Saída − Entrada) − (Volta Almoço − Saída Almoço). Dias com pontos faltando aparecem em amarelo como <strong>incompletos</strong>.
</div>
`;
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

  // Aba Feriados — filtros proprios
  document.getElementById('rh-feriado-ano')?.addEventListener('change', e => { S._rhFeriadoAno = e.target.value; render(); });
  document.getElementById('rh-feriado-colab')?.addEventListener('change', e => { S._rhFeriadoColab = e.target.value; render(); });

  // Sub-modulo Folha de Pagamento (binds proprios)
  if (S._rhSub === 'folha') {
    try { bindRHFolhaEvents(); } catch (e) { console.error('bindRHFolhaEvents', e); }
  }
}
