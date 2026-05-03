// ── MODULO DE METAS ──────────────────────────────────────────
// Sistema completo de metas operacionais + Meta Extra (bonus %).
//
// Tipos de meta:
//   - VENDAS    (por valor R$ ou qtd pedidos) → atendentes
//   - MONTAGEM  (qtd produtos montados)        → equipe producao
//   - EXPEDICAO (qtd pedidos entregues)        → equipe logistica
//
// Periodos: semanal | quinzenal | mensal
// Distribuicao: igualmente entre colaboradores ATIVOS do setor
//
// META EXTRA: bonus em % sobre vendas totais do periodo, dividido
// igualmente entre as ATENDENTES ATIVAS.
//
// Storage: localStorage (fv_metas, fv_metas_extra)
// Calculo: usa S.orders (pagamentos APROVADOS) + getColabs()
//
// Visivel para Atendentes via Meu Painel (read-only).
import { S } from '../state.js';
import { $c } from '../utils/formatters.js';
import { toast } from '../utils/helpers.js';
import { getColabs } from '../services/auth.js';

const LS_METAS = 'fv_metas';
const LS_META_EXTRA = 'fv_metas_extra';

// ── HELPERS DE STORAGE ───────────────────────────────────────
export function getMetas() {
  try { return JSON.parse(localStorage.getItem(LS_METAS) || '[]'); }
  catch { return []; }
}
export function setMetas(arr) {
  localStorage.setItem(LS_METAS, JSON.stringify(arr || []));
}
export function getMetasExtra() {
  try { return JSON.parse(localStorage.getItem(LS_META_EXTRA) || '[]'); }
  catch { return []; }
}
export function setMetasExtra(arr) {
  localStorage.setItem(LS_META_EXTRA, JSON.stringify(arr || []));
}

// ── HELPERS DE PERIODO ───────────────────────────────────────
export function calcularPeriodo(tipo, dataBase = new Date()) {
  const d = new Date(dataBase);
  d.setHours(0,0,0,0);
  let inicio, fim;
  if (tipo === 'semanal') {
    // Domingo = 0
    const diaSem = d.getDay();
    inicio = new Date(d); inicio.setDate(d.getDate() - diaSem);
    fim = new Date(inicio); fim.setDate(inicio.getDate() + 6);
  } else if (tipo === 'quinzenal') {
    // Dia 1-15 ou 16-fim
    if (d.getDate() <= 15) {
      inicio = new Date(d.getFullYear(), d.getMonth(), 1);
      fim    = new Date(d.getFullYear(), d.getMonth(), 15);
    } else {
      inicio = new Date(d.getFullYear(), d.getMonth(), 16);
      fim    = new Date(d.getFullYear(), d.getMonth()+1, 0);
    }
  } else { // mensal
    inicio = new Date(d.getFullYear(), d.getMonth(), 1);
    fim    = new Date(d.getFullYear(), d.getMonth()+1, 0);
  }
  fim.setHours(23,59,59,999);
  return { inicio, fim };
}

const isoSlice = (d) => d ? new Date(d).toISOString().slice(0,10) : '';

// ── EQUIPE POR SETOR ─────────────────────────────────────────
// Atendentes: cargo Atendente / atendimento (vende e tambem monta/expede).
// Producao: qualquer um que monta. Expedicao: qualquer um que expede.
// Como o time da floricultura e enxuto, atendentes participam dos 3.
export function getEquipePorSetor(setor) {
  const colabs = getColabs().filter(c => c.active !== false);
  const naoEntregador = c => {
    const car = String(c.cargo||'').toLowerCase();
    return !car.includes('entregador');
  };
  if (setor === 'vendas') {
    return colabs.filter(c => {
      const car = String(c.cargo||'').toLowerCase();
      return naoEntregador(c) && (car.includes('atend') || car.includes('vend') || car === 'admin' || car === '');
    });
  }
  if (setor === 'montagem') return colabs.filter(naoEntregador);
  if (setor === 'expedicao') return colabs.filter(naoEntregador);
  return colabs;
}

// ── CALCULO REALIZADO ────────────────────────────────────────
const APROVADOS = new Set(['Aprovado','Pago','aprovado','pago','Pago na Entrega']);

function pedidoNoPeriodo(o, inicio, fim) {
  const raw = o.scheduledDate || o.createdAt;
  if (!raw) return false;
  const d = new Date(raw);
  return d >= inicio && d <= fim;
}

// Retorna { totalGeral, porColab: { colabId: valor } }
export function calcularRealizado(meta, ordersList = S.orders) {
  const orders = Array.isArray(ordersList) ? ordersList : [];
  const { inicio, fim } = (meta.dataInicio && meta.dataFim)
    ? { inicio: new Date(meta.dataInicio+'T00:00:00'), fim: new Date(meta.dataFim+'T23:59:59') }
    : calcularPeriodo(meta.periodoTipo || 'mensal');

  const porColab = {};
  let totalGeral = 0;

  for (const o of orders) {
    if (!pedidoNoPeriodo(o, inicio, fim)) continue;

    if (meta.tipo === 'vendas') {
      if (!APROVADOS.has(String(o.paymentStatus||''))) continue;
      const colabId = String(o.vendedorId || o.createdByColabId || o.criadoPor || '');
      const valor = meta.tipoVendas === 'qtd' ? 1 : (Number(o.total)||0);
      totalGeral += valor;
      if (colabId) porColab[colabId] = (porColab[colabId]||0) + valor;
    }
    else if (meta.tipo === 'montagem') {
      const st = String(o.status||'').toLowerCase();
      const montou = ['pronto','saiu p/ entrega','entregue'].some(x => st.includes(x));
      if (!montou) continue;
      const colabId = String(o.montadorId||'');
      const qty = (o.items||[]).reduce((s,i) => s+(Number(i.qty)||1), 0) || 1;
      totalGeral += qty;
      if (colabId) porColab[colabId] = (porColab[colabId]||0) + qty;
    }
    else if (meta.tipo === 'expedicao') {
      const st = String(o.status||'').toLowerCase();
      const expediu = st.includes('entregue');
      if (!expediu) continue;
      const colabId = String(o.expedidorId || o.driverColabId || '');
      totalGeral += 1;
      if (colabId) porColab[colabId] = (porColab[colabId]||0) + 1;
    }
  }
  return { totalGeral, porColab, inicio, fim };
}

// ── META EXTRA ──────────────────────────────────────────────
// Calcula valor total bonus = soma vendas aprovadas no periodo × %
// Divide igual entre atendentes ativas.
export function calcularMetaExtra(metaExtra, ordersList = S.orders) {
  const { inicio, fim } = (metaExtra.dataInicio && metaExtra.dataFim)
    ? { inicio: new Date(metaExtra.dataInicio+'T00:00:00'), fim: new Date(metaExtra.dataFim+'T23:59:59') }
    : calcularPeriodo(metaExtra.periodoTipo || 'mensal');

  const orders = Array.isArray(ordersList) ? ordersList : [];
  let totalVendido = 0;
  for (const o of orders) {
    if (!pedidoNoPeriodo(o, inicio, fim)) continue;
    if (!APROVADOS.has(String(o.paymentStatus||''))) continue;
    totalVendido += Number(o.total)||0;
  }
  const pct = Number(metaExtra.percentual)||0;
  const valorBonus = totalVendido * (pct/100);
  const atendentes = getEquipePorSetor('vendas');
  const valorIndividual = atendentes.length ? (valorBonus / atendentes.length) : 0;
  return {
    totalVendido,
    valorBonus,
    valorIndividual,
    qtdAtendentes: atendentes.length,
    atendentes,
    inicio, fim,
  };
}

// ── RENDER (ADMIN) ───────────────────────────────────────────
export function renderMetas() {
  const sub = S._metasSub || 'list'; // list | nova | extra | ranking

  const subBtn = (k, label) => `<button type="button" class="tab ${sub===k?'active':''}" data-metas-sub="${k}" style="font-size:12px;">${label}</button>`;

  return `
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
  <div>
    <div style="font-family:'Playfair Display',serif;font-size:22px;color:#9F1239;">🎯 Metas e Bonificações</div>
    <div style="font-size:12px;color:var(--muted);">Configurar metas operacionais, Meta Extra (bonus) e ver ranking</div>
  </div>
</div>

<div class="tabs" style="margin-bottom:14px;gap:5px;">
  ${subBtn('list',    '📋 Metas Cadastradas')}
  ${subBtn('nova',    '➕ Nova Meta')}
  ${subBtn('extra',   '🌟 Meta Extra')}
  ${subBtn('ranking', '🏆 Ranking')}
</div>

${sub === 'list'    ? renderMetasList()    : ''}
${sub === 'nova'    ? renderMetasNova()    : ''}
${sub === 'extra'   ? renderMetasExtra()   : ''}
${sub === 'ranking' ? renderMetasRanking() : ''}
`;
}

// ─── A) LISTA DE METAS ───────────────────────────────────────
function renderMetasList() {
  const metas = getMetas();
  if (!metas.length) {
    return `<div class="card" style="text-align:center;padding:40px;color:var(--muted);">
      <div style="font-size:48px;margin-bottom:12px;">🎯</div>
      <p>Nenhuma meta cadastrada ainda.</p>
      <button class="btn btn-primary" data-metas-sub="nova" style="margin-top:10px;">➕ Criar primeira meta</button>
    </div>`;
  }

  return `<div style="display:grid;gap:12px;">
    ${metas.sort((a,b) => (b.createdAt||0) - (a.createdAt||0)).map(m => {
      const realiz = calcularRealizado(m);
      const equipe = getEquipePorSetor(m.tipo);
      const metaPorColab = (Number(m.valorTotal)||0) / (equipe.length || 1);
      const pctTotal = m.valorTotal ? Math.min(100, (realiz.totalGeral / m.valorTotal) * 100) : 0;
      const cor = pctTotal >= 80 ? '#15803D' : pctTotal >= 50 ? '#F59E0B' : '#DC2626';
      const setorIcon = { vendas:'💰', montagem:'🌸', expedicao:'📦' }[m.tipo] || '🎯';
      const unit = m.tipo === 'vendas' && m.tipoVendas !== 'qtd' ? 'R$' : 'un';

      return `<div class="card" style="border-left:5px solid ${cor};">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px;margin-bottom:10px;">
          <div>
            <div style="font-size:16px;font-weight:800;color:#1E293B;">${setorIcon} ${escHtml(m.nome)}</div>
            <div style="font-size:11px;color:var(--muted);margin-top:2px;">
              ${labelTipo(m.tipo)} · ${labelPeriodo(m.periodoTipo)} ·
              ${m.dataInicio?fmtData(m.dataInicio):''} a ${m.dataFim?fmtData(m.dataFim):''}
            </div>
          </div>
          <div style="display:flex;gap:6px;">
            <button class="btn btn-ghost btn-sm" data-metas-edit="${m.id}">✏️ Editar</button>
            <button class="btn btn-ghost btn-sm" data-metas-del="${m.id}" style="color:#DC2626;">🗑️ Excluir</button>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:10px;">
          <div style="background:#F1F5F9;border-radius:8px;padding:10px;">
            <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Meta total</div>
            <div style="font-size:16px;font-weight:800;color:#1E293B;">${unit==='R$'?$c(m.valorTotal):(m.valorTotal+' un')}</div>
          </div>
          <div style="background:#FAE8E6;border-radius:8px;padding:10px;">
            <div style="font-size:10px;color:#9F1239;text-transform:uppercase;">Equipe (${equipe.length})</div>
            <div style="font-size:13px;font-weight:700;color:#9F1239;">${unit==='R$'?$c(metaPorColab):(Math.round(metaPorColab)+' un')} <span style="font-size:10px;font-weight:400;">por pessoa</span></div>
          </div>
          <div style="background:${cor}22;border-radius:8px;padding:10px;">
            <div style="font-size:10px;color:${cor};text-transform:uppercase;">Realizado</div>
            <div style="font-size:16px;font-weight:800;color:${cor};">${unit==='R$'?$c(realiz.totalGeral):(realiz.totalGeral+' un')}</div>
          </div>
          <div style="background:${cor}22;border-radius:8px;padding:10px;text-align:center;">
            <div style="font-size:10px;color:${cor};text-transform:uppercase;">Atingido</div>
            <div style="font-size:22px;font-weight:900;color:${cor};">${pctTotal.toFixed(0)}%</div>
          </div>
        </div>

        <div style="height:10px;background:#E2E8F0;border-radius:5px;overflow:hidden;margin-bottom:8px;">
          <div style="height:100%;width:${pctTotal}%;background:${cor};transition:width .4s;"></div>
        </div>

        <details style="margin-top:6px;">
          <summary style="cursor:pointer;font-size:11px;color:var(--muted);font-weight:700;">Ver desempenho individual da equipe (${equipe.length})</summary>
          <div style="margin-top:8px;display:grid;gap:5px;">
            ${equipe.map(c => {
              const r = realiz.porColab[String(c._id)] || 0;
              const pctC = metaPorColab ? Math.min(100, (r/metaPorColab)*100) : 0;
              const cc = pctC >= 80 ? '#15803D' : pctC >= 50 ? '#F59E0B' : '#DC2626';
              return `<div style="display:flex;align-items:center;gap:8px;font-size:12px;">
                <div style="flex:1;font-weight:600;">${escHtml(c.name||'')}</div>
                <div style="width:120px;height:6px;background:#E2E8F0;border-radius:3px;overflow:hidden;">
                  <div style="height:100%;width:${pctC}%;background:${cc};"></div>
                </div>
                <div style="width:50px;text-align:right;color:${cc};font-weight:700;">${pctC.toFixed(0)}%</div>
                <div style="width:80px;text-align:right;font-size:11px;color:var(--muted);">${unit==='R$'?$c(r):(r+' un')}</div>
              </div>`;
            }).join('')}
          </div>
        </details>
      </div>`;
    }).join('')}
  </div>`;
}

// ─── B) NOVA META (ou EDITAR) ────────────────────────────────
function renderMetasNova() {
  const editId = S._metasEditId || '';
  const meta = editId ? getMetas().find(m => m.id === editId) || {} : {};
  const isEdit = !!meta.id;

  return `<div class="card">
    <div class="card-title">${isEdit ? '✏️ Editar Meta' : '➕ Nova Meta'}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">

      <div class="fg">
        <label class="fl">Nome da meta</label>
        <input type="text" class="fi" id="meta-nome" value="${escHtml(meta.nome||'')}" placeholder="Ex: Meta Mai/2026 — Vendas"/>
      </div>

      <div class="fg">
        <label class="fl">Tipo de meta</label>
        <select class="fi" id="meta-tipo">
          <option value="vendas"    ${meta.tipo==='vendas'   ?'selected':''}>💰 Vendas (atendentes)</option>
          <option value="montagem"  ${meta.tipo==='montagem' ?'selected':''}>🌸 Montagem (produção)</option>
          <option value="expedicao" ${meta.tipo==='expedicao'?'selected':''}>📦 Expedição (logística)</option>
        </select>
      </div>

      <div class="fg" id="fg-tipo-vendas" style="${meta.tipo&&meta.tipo!=='vendas'?'display:none;':''}">
        <label class="fl">Medir vendas por</label>
        <select class="fi" id="meta-tipo-vendas">
          <option value="valor" ${meta.tipoVendas!=='qtd'?'selected':''}>Valor (R$)</option>
          <option value="qtd"   ${meta.tipoVendas==='qtd'?'selected':''}>Quantidade de pedidos</option>
        </select>
      </div>

      <div class="fg">
        <label class="fl">Período</label>
        <select class="fi" id="meta-periodo-tipo">
          <option value="semanal"   ${meta.periodoTipo==='semanal'  ?'selected':''}>Semanal</option>
          <option value="quinzenal" ${meta.periodoTipo==='quinzenal'?'selected':''}>Quinzenal</option>
          <option value="mensal"    ${(meta.periodoTipo||'mensal')==='mensal'?'selected':''}>Mensal</option>
        </select>
      </div>

      <div class="fg">
        <label class="fl">Data início</label>
        <input type="date" class="fi" id="meta-data-inicio" value="${meta.dataInicio||''}"/>
      </div>

      <div class="fg">
        <label class="fl">Data fim</label>
        <input type="date" class="fi" id="meta-data-fim" value="${meta.dataFim||''}"/>
      </div>

      <div class="fg" style="grid-column:span 2;">
        <label class="fl">Valor total da meta <span style="color:var(--muted);font-weight:400;font-size:11px;">(R$ para vendas-valor, quantidade para montagem/expedição/vendas-qtd)</span></label>
        <input type="number" class="fi" id="meta-valor-total" min="0" step="0.01" value="${meta.valorTotal||''}" placeholder="Ex: 100000 (vendas) ou 500 (un)"/>
      </div>
    </div>

    <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:10px;padding:12px;margin-top:14px;font-size:12px;color:#1E40AF;">
      💡 A meta será dividida <strong>igualmente</strong> entre os colaboradores ativos do setor escolhido.
      O sistema atualiza o realizado automaticamente conforme as vendas, montagens e expedições acontecem.
    </div>

    <div style="display:flex;gap:8px;margin-top:14px;">
      <button class="btn btn-primary" id="btn-meta-save">${isEdit?'💾 Salvar alterações':'➕ Criar meta'}</button>
      <button class="btn btn-ghost" id="btn-meta-cancel">Cancelar</button>
    </div>
  </div>`;
}

// ─── C) META EXTRA ───────────────────────────────────────────
function renderMetasExtra() {
  const extras = getMetasExtra();

  return `
<div class="card" style="margin-bottom:14px;background:linear-gradient(135deg,#FEF3C7,#FFFBEB);border:2px solid #FCD34D;">
  <div style="display:flex;align-items:center;gap:10px;">
    <span style="font-size:32px;">🌟</span>
    <div>
      <div style="font-family:'Playfair Display',serif;font-size:18px;color:#92400E;">Meta Extra — Bônus por % sobre vendas</div>
      <div style="font-size:12px;color:#92400E;opacity:.8;">% sobre vendas totais aprovadas no período. Valor dividido <strong>igualmente</strong> entre as atendentes ativas.</div>
    </div>
  </div>
</div>

<div class="card" style="margin-bottom:14px;">
  <div class="card-title">➕ Nova Meta Extra</div>
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;">
    <div class="fg" style="grid-column:span 2;">
      <label class="fl">Nome</label>
      <input type="text" class="fi" id="extra-nome" placeholder="Ex: Bônus Dia das Mães"/>
    </div>
    <div class="fg">
      <label class="fl">Percentual (%)</label>
      <input type="number" class="fi" id="extra-pct" min="0.01" max="100" step="0.01" placeholder="Ex: 1.5"/>
    </div>
    <div class="fg">
      <label class="fl">Período</label>
      <select class="fi" id="extra-periodo-tipo">
        <option value="semanal">Semanal</option>
        <option value="quinzenal">Quinzenal</option>
        <option value="mensal" selected>Mensal</option>
      </select>
    </div>
    <div class="fg">
      <label class="fl">Data início</label>
      <input type="date" class="fi" id="extra-data-inicio"/>
    </div>
    <div class="fg">
      <label class="fl">Data fim</label>
      <input type="date" class="fi" id="extra-data-fim"/>
    </div>
    <div class="fg" style="grid-column:span 2;display:flex;align-items:flex-end;">
      <button class="btn btn-primary" id="btn-extra-save" style="width:100%;">🌟 Criar Meta Extra</button>
    </div>
  </div>
</div>

<div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:8px;">📋 Metas Extras Cadastradas</div>

${extras.length === 0 ? `
<div class="card" style="text-align:center;padding:30px;color:var(--muted);">
  <p>Nenhuma Meta Extra cadastrada.</p>
</div>
` : `
<div style="display:grid;gap:10px;">
  ${extras.sort((a,b) => (b.createdAt||0) - (a.createdAt||0)).map(e => {
    const r = calcularMetaExtra(e);
    return `<div class="card" style="border-left:5px solid #F59E0B;background:#FFFBEB;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px;margin-bottom:10px;">
        <div>
          <div style="font-size:16px;font-weight:800;color:#92400E;">🌟 ${escHtml(e.nome)}</div>
          <div style="font-size:11px;color:#92400E;opacity:.8;margin-top:2px;">
            ${e.percentual}% · ${labelPeriodo(e.periodoTipo)} ·
            ${e.dataInicio?fmtData(e.dataInicio):''} a ${e.dataFim?fmtData(e.dataFim):''}
          </div>
        </div>
        <button class="btn btn-ghost btn-sm" data-extra-del="${e.id}" style="color:#DC2626;">🗑️ Excluir</button>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;">
        <div style="background:#fff;border-radius:8px;padding:10px;border:1px solid #FCD34D;">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Vendido no período</div>
          <div style="font-size:16px;font-weight:800;color:#92400E;">${$c(r.totalVendido)}</div>
        </div>
        <div style="background:#fff;border-radius:8px;padding:10px;border:1px solid #FCD34D;">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Bônus total (${e.percentual}%)</div>
          <div style="font-size:16px;font-weight:800;color:#15803D;">${$c(r.valorBonus)}</div>
        </div>
        <div style="background:#fff;border-radius:8px;padding:10px;border:1px solid #FCD34D;">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Atendentes ativas</div>
          <div style="font-size:16px;font-weight:800;color:#1E293B;">${r.qtdAtendentes}</div>
        </div>
        <div style="background:#15803D;border-radius:8px;padding:10px;color:#fff;">
          <div style="font-size:10px;text-transform:uppercase;opacity:.85;">Cada atendente recebe</div>
          <div style="font-size:18px;font-weight:900;">${$c(r.valorIndividual)}</div>
        </div>
      </div>

      <details style="margin-top:8px;">
        <summary style="cursor:pointer;font-size:11px;color:#92400E;font-weight:700;">Ver atendentes que recebem (${r.qtdAtendentes})</summary>
        <div style="margin-top:8px;display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:6px;">
          ${r.atendentes.map(c => `<div style="background:#fff;border:1px solid #FCD34D;border-radius:6px;padding:6px 10px;font-size:11px;display:flex;justify-content:space-between;align-items:center;">
            <span style="font-weight:600;">👤 ${escHtml(c.name||'')}</span>
            <span style="font-weight:800;color:#15803D;">${$c(r.valorIndividual)}</span>
          </div>`).join('')}
        </div>
      </details>
    </div>`;
  }).join('')}
</div>
`}`;
}

// ─── D) RANKING ──────────────────────────────────────────────
function renderMetasRanking() {
  const setor = S._metasRankingSetor || 'vendas';
  const metas = getMetas().filter(m => m.tipo === setor);
  const equipe = getEquipePorSetor(setor);

  // Agrega realizado de TODAS as metas ativas do setor
  const ranking = equipe.map(c => {
    let totalReal = 0, totalMeta = 0;
    metas.forEach(m => {
      const r = calcularRealizado(m);
      const meta = (Number(m.valorTotal)||0) / (equipe.length || 1);
      totalReal += r.porColab[String(c._id)] || 0;
      totalMeta += meta;
    });
    const pct = totalMeta ? Math.min(100, (totalReal/totalMeta)*100) : 0;
    return { c, totalReal, totalMeta, pct };
  }).sort((a,b) => b.pct - a.pct || b.totalReal - a.totalReal);

  const setorIcon = { vendas:'💰', montagem:'🌸', expedicao:'📦' }[setor];
  const unit = setor === 'vendas' && metas.every(m => m.tipoVendas !== 'qtd') ? 'R$' : 'un';

  return `
<div class="card" style="margin-bottom:14px;">
  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
    <div style="font-weight:700;color:var(--ink);">Setor:</div>
    ${[
      {k:'vendas',l:'💰 Vendas'},
      {k:'montagem',l:'🌸 Montagem'},
      {k:'expedicao',l:'📦 Expedição'},
    ].map(s => `<button class="btn btn-sm ${setor===s.k?'btn-primary':'btn-ghost'}" data-metas-rank="${s.k}">${s.l}</button>`).join('')}
    <div style="margin-left:auto;font-size:11px;color:var(--muted);">${metas.length} meta(s) cadastrada(s)</div>
  </div>
</div>

${ranking.length === 0 ? `
<div class="card" style="text-align:center;padding:40px;color:var(--muted);">
  <div style="font-size:48px;margin-bottom:12px;">🏆</div>
  <p>Nenhum colaborador ativo neste setor.</p>
</div>
` : `
<div style="display:grid;gap:10px;">
  ${ranking.map((r, i) => {
    const medal = ['🥇','🥈','🥉'][i] || `${i+1}º`;
    const cor = r.pct >= 80 ? '#15803D' : r.pct >= 50 ? '#F59E0B' : '#DC2626';
    return `<div class="card" style="border-left:5px solid ${cor};">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:8px;">
        <div style="font-size:28px;width:48px;text-align:center;">${medal}</div>
        <div style="flex:1;">
          <div style="font-size:15px;font-weight:800;color:#1E293B;">${escHtml(r.c.name||'')}</div>
          <div style="font-size:11px;color:var(--muted);">${escHtml(r.c.cargo||'—')} · ${setorIcon} ${unit==='R$'?$c(r.totalReal):(r.totalReal+' un')} de ${unit==='R$'?$c(r.totalMeta):(Math.round(r.totalMeta)+' un')}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:24px;font-weight:900;color:${cor};">${r.pct.toFixed(0)}%</div>
          <div style="font-size:10px;color:var(--muted);">atingido</div>
        </div>
      </div>
      <div style="height:8px;background:#E2E8F0;border-radius:4px;overflow:hidden;">
        <div style="height:100%;width:${r.pct}%;background:${cor};transition:width .4s;"></div>
      </div>
    </div>`;
  }).join('')}
</div>
`}`;
}

// ── HELPERS DE FORMATACAO ────────────────────────────────────
function escHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fmtData(iso) { if (!iso) return '—'; const [y,m,d] = iso.split('-'); return `${d}/${m}/${y}`; }
function labelTipo(t) { return { vendas:'💰 Vendas', montagem:'🌸 Montagem', expedicao:'📦 Expedição' }[t] || t; }
function labelPeriodo(p) { return { semanal:'Semanal', quinzenal:'Quinzenal', mensal:'Mensal' }[p] || p; }

// ── BINDINGS DE EVENTOS ──────────────────────────────────────
export function bindMetasEvents() {
  const render = () => import('../main.js').then(m => m.render()).catch(()=>{});

  // Sub-abas
  document.querySelectorAll('[data-metas-sub]').forEach(b => {
    b.addEventListener('click', () => {
      S._metasSub = b.dataset.metasSub;
      if (S._metasSub !== 'nova') S._metasEditId = null;
      render();
    });
  });

  // Mostrar/ocultar tipo-vendas conforme tipo
  document.getElementById('meta-tipo')?.addEventListener('change', (e) => {
    const fg = document.getElementById('fg-tipo-vendas');
    if (fg) fg.style.display = e.target.value === 'vendas' ? '' : 'none';
  });

  // Salvar meta (criar ou editar)
  document.getElementById('btn-meta-save')?.addEventListener('click', () => {
    const nome = document.getElementById('meta-nome')?.value.trim();
    const tipo = document.getElementById('meta-tipo')?.value;
    const tipoVendas = document.getElementById('meta-tipo-vendas')?.value;
    const periodoTipo = document.getElementById('meta-periodo-tipo')?.value;
    const dataInicio = document.getElementById('meta-data-inicio')?.value;
    const dataFim = document.getElementById('meta-data-fim')?.value;
    const valorTotal = Number(document.getElementById('meta-valor-total')?.value) || 0;

    // Validacoes
    if (!nome) { toast('Informe o nome da meta', true); return; }
    if (!dataInicio || !dataFim) { toast('Defina período (data início e fim)', true); return; }
    if (dataInicio > dataFim) { toast('Data inicial maior que final', true); return; }
    if (!valorTotal || valorTotal <= 0) { toast('Informe um valor total válido', true); return; }
    const equipe = getEquipePorSetor(tipo);
    if (!equipe.length) { toast('Não há colaboradores ativos no setor selecionado', true); return; }

    const metas = getMetas();
    const editId = S._metasEditId;
    if (editId) {
      const idx = metas.findIndex(m => m.id === editId);
      if (idx >= 0) {
        metas[idx] = { ...metas[idx], nome, tipo, tipoVendas, periodoTipo, dataInicio, dataFim, valorTotal };
        setMetas(metas);
        toast('✅ Meta atualizada');
      }
    } else {
      metas.push({
        id: 'mt_' + Date.now() + '_' + Math.random().toString(36).slice(2,7),
        nome, tipo, tipoVendas, periodoTipo, dataInicio, dataFim, valorTotal,
        createdAt: Date.now(),
      });
      setMetas(metas);
      toast('✅ Meta criada');
    }
    S._metasEditId = null;
    S._metasSub = 'list';
    render();
  });

  document.getElementById('btn-meta-cancel')?.addEventListener('click', () => {
    S._metasEditId = null;
    S._metasSub = 'list';
    render();
  });

  // Editar meta
  document.querySelectorAll('[data-metas-edit]').forEach(b => {
    b.addEventListener('click', () => {
      S._metasEditId = b.dataset.metasEdit;
      S._metasSub = 'nova';
      render();
    });
  });

  // Excluir meta
  document.querySelectorAll('[data-metas-del]').forEach(b => {
    b.addEventListener('click', () => {
      if (!confirm('Excluir esta meta? Esta ação não pode ser desfeita.')) return;
      const id = b.dataset.metasDel;
      setMetas(getMetas().filter(m => m.id !== id));
      toast('🗑️ Meta excluída');
      render();
    });
  });

  // Meta Extra — criar
  document.getElementById('btn-extra-save')?.addEventListener('click', () => {
    const nome = document.getElementById('extra-nome')?.value.trim();
    const percentual = Number(document.getElementById('extra-pct')?.value) || 0;
    const periodoTipo = document.getElementById('extra-periodo-tipo')?.value;
    const dataInicio = document.getElementById('extra-data-inicio')?.value;
    const dataFim = document.getElementById('extra-data-fim')?.value;

    if (!nome) { toast('Informe o nome da Meta Extra', true); return; }
    if (!percentual || percentual <= 0 || percentual > 100) { toast('Percentual inválido (0,01 a 100)', true); return; }
    if (!dataInicio || !dataFim) { toast('Defina período (data início e fim)', true); return; }
    if (dataInicio > dataFim) { toast('Data inicial maior que final', true); return; }
    const atendentes = getEquipePorSetor('vendas');
    if (!atendentes.length) { toast('Não há atendentes ativas para receber a Meta Extra', true); return; }

    const extras = getMetasExtra();
    extras.push({
      id: 'mx_' + Date.now() + '_' + Math.random().toString(36).slice(2,7),
      nome, percentual, periodoTipo, dataInicio, dataFim,
      createdAt: Date.now(),
    });
    setMetasExtra(extras);
    toast('🌟 Meta Extra criada');
    render();
  });

  // Meta Extra — excluir
  document.querySelectorAll('[data-extra-del]').forEach(b => {
    b.addEventListener('click', () => {
      if (!confirm('Excluir esta Meta Extra?')) return;
      setMetasExtra(getMetasExtra().filter(e => e.id !== b.dataset.extraDel));
      toast('🗑️ Meta Extra excluída');
      render();
    });
  });

  // Ranking — trocar setor
  document.querySelectorAll('[data-metas-rank]').forEach(b => {
    b.addEventListener('click', () => {
      S._metasRankingSetor = b.dataset.metasRank;
      render();
    });
  });
}

// ── VIEW PARA ATENDENTE (usado em Meu Painel) ────────────────
// Retorna HTML compacto: metas individuais + meta extra que ela recebe
export function renderMetasParaAtendente(user, ordersList = S.orders) {
  const metas = getMetas();
  const extras = getMetasExtra();
  const myId = String(user?._id || user?.id || '');

  // Filtra metas onde a colab participa (segundo o setor)
  const minhasMetas = metas.filter(m => {
    const equipe = getEquipePorSetor(m.tipo);
    return equipe.some(c => String(c._id) === myId);
  });

  if (!minhasMetas.length && !extras.length) return '';

  return `
<div class="card" style="margin-top:14px;">
  <div class="card-title">🎯 Minhas Metas</div>

  ${minhasMetas.length === 0 ? `
    <div style="color:var(--muted);font-size:12px;padding:12px;text-align:center;">Nenhuma meta ativa pra você no momento.</div>
  ` : minhasMetas.map(m => {
    const realiz = calcularRealizado(m, ordersList);
    const equipe = getEquipePorSetor(m.tipo);
    const metaPorColab = (Number(m.valorTotal)||0) / (equipe.length || 1);
    const meuReal = realiz.porColab[myId] || 0;
    const pct = metaPorColab ? Math.min(100, (meuReal/metaPorColab)*100) : 0;
    const cor = pct >= 80 ? '#15803D' : pct >= 50 ? '#F59E0B' : '#DC2626';
    const setorIcon = { vendas:'💰', montagem:'🌸', expedicao:'📦' }[m.tipo];
    const unit = m.tipo === 'vendas' && m.tipoVendas !== 'qtd' ? 'R$' : 'un';

    return `<div style="margin-bottom:12px;padding:12px;background:#FAFAFA;border-radius:8px;border-left:4px solid ${cor};">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
        <div>
          <div style="font-size:14px;font-weight:700;color:#1E293B;">${setorIcon} ${escHtml(m.nome)}</div>
          <div style="font-size:10px;color:var(--muted);">${labelPeriodo(m.periodoTipo)} · ${fmtData(m.dataInicio)} a ${fmtData(m.dataFim)}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:20px;font-weight:900;color:${cor};">${pct.toFixed(0)}%</div>
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-bottom:4px;">
        <span>Minha meta: <strong>${unit==='R$'?$c(metaPorColab):(Math.round(metaPorColab)+' un')}</strong></span>
        <span>Realizei: <strong style="color:${cor};">${unit==='R$'?$c(meuReal):(meuReal+' un')}</strong></span>
      </div>
      <div style="height:8px;background:#E2E8F0;border-radius:4px;overflow:hidden;">
        <div style="height:100%;width:${pct}%;background:${cor};transition:width .4s;"></div>
      </div>
    </div>`;
  }).join('')}

  ${extras.length > 0 ? `
    <div style="margin-top:14px;font-size:11px;font-weight:700;color:#92400E;text-transform:uppercase;letter-spacing:1px;">🌟 Meta Extra (Bônus)</div>
    ${extras.map(e => {
      const r = calcularMetaExtra(e, ordersList);
      // So mostra se a colab e atendente
      const ehAtendente = r.atendentes.some(c => String(c._id) === myId);
      if (!ehAtendente) return '';
      return `<div style="margin-top:8px;padding:14px;background:linear-gradient(135deg,#FEF3C7,#FFFBEB);border:2px solid #FCD34D;border-radius:10px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
          <div>
            <div style="font-size:14px;font-weight:800;color:#92400E;">🌟 ${escHtml(e.nome)}</div>
            <div style="font-size:10px;color:#92400E;opacity:.8;">${e.percentual}% sobre vendas · ${fmtData(e.dataInicio)} a ${fmtData(e.dataFim)}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:10px;color:#92400E;text-transform:uppercase;">Você vai receber</div>
            <div style="font-size:22px;font-weight:900;color:#15803D;">${$c(r.valorIndividual)}</div>
          </div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:11px;color:#92400E;background:#fff;padding:6px 10px;border-radius:6px;">
          <span>Vendido: <strong>${$c(r.totalVendido)}</strong></span>
          <span>Bônus total: <strong style="color:#15803D;">${$c(r.valorBonus)}</strong></span>
          <span>÷ ${r.qtdAtendentes} atendentes</span>
        </div>
      </div>`;
    }).join('')}
  ` : ''}
</div>`;
}
