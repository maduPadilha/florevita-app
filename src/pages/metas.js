// ── MODULO METAS (v3.1) ──────────────────────────────────────
// Metas individuais OU por unidade.
//
// ADM define:
//   - Escopo: 👤 Colaboradora individual | 🏪 Unidade (loja inteira)
//   - Alvo: colab (se escopo colab) ou unidade (se escopo unidade)
//   - Periodo: Mensal ou Semanal + datas inicio/fim
//   - Tipo: Vendas (R$) | Produção (qtd produtos) | Expedição (qtd entregas)
//   - Valor da meta
//   - Modo do bonus: Individual ou Equipe
//   - Valor do bonus (R$)
//
// Sistema:
//   - Calcula realizado em tempo real sobre S.orders
//   - Alerta colorido por % atingido:
//        🔴 < 50%   🟡 50-79%   🟢 80-99%   💎 100-129%   🏆 ≥ 130%
//   - Bonus individual: paga R$ X quando colab atinge >= 100%
//   - Bonus equipe: soma os bonus de todas que atingiram, divide igualmente
//
// Storage: localStorage 'fv_metas_v3' (chave nova p/ nao bater com versao antiga)
import { S } from '../state.js';
import { $c } from '../utils/formatters.js';
import { toast } from '../utils/helpers.js';
import { getColabs } from '../services/auth.js';
import { normalizeUnidade, labelUnidade } from '../utils/unidadeRules.js';

// Lista canonica de unidades disponiveis para meta
// Slug 'todas' agrega TODAS as unidades (sem filtro por unit/saleUnit).
export const UNIDADES_META = [
  { slug: 'todas',         label: '🌐 Todas as Unidades' },
  { slug: 'cdle',          label: 'CDLE' },
  { slug: 'novo_aleixo',   label: 'Loja Novo Aleixo' },
  { slug: 'allegro',       label: 'Loja Allegro Mall' },
  { slug: 'ecommerce',     label: 'E-commerce' },
];

const LS_METAS = 'fv_metas_v3';

// ── STORAGE ──────────────────────────────────────────────────
export function getMetas()    { try { return JSON.parse(localStorage.getItem(LS_METAS) || '[]'); } catch { return []; } }
export function setMetas(arr) { localStorage.setItem(LS_METAS, JSON.stringify(arr || [])); }

// ── PERIODO ──────────────────────────────────────────────────
export function calcularPeriodo(tipo, dataBase = new Date()) {
  const d = new Date(dataBase); d.setHours(0,0,0,0);
  let inicio, fim;
  if (tipo === 'semanal') {
    const dow = d.getDay();
    inicio = new Date(d); inicio.setDate(d.getDate() - dow);
    fim = new Date(inicio); fim.setDate(inicio.getDate() + 6);
  } else { // mensal
    inicio = new Date(d.getFullYear(), d.getMonth(), 1);
    fim    = new Date(d.getFullYear(), d.getMonth()+1, 0);
  }
  fim.setHours(23,59,59,999);
  return { inicio, fim };
}

// ── HELPERS DE IDENTIFICACAO ─────────────────────────────────
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
function _colabKey(c) { return String(c?._id || c?.id || c?.backendId || c?.email || c?.name || ''); }

const _PG_APROV = new Set(['Aprovado','Pago','aprovado','pago','Pago na Entrega','Recebido']);

// Cargos por tipo de meta — quem pode ser alvo
export function colabsPorTipoMeta(tipo) {
  const colabs = getColabs().filter(c => c.active !== false);
  const norm = (s) => String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
  const car = c => norm(c.cargo);
  const isAtend  = c => car(c).includes('atend');
  const isProd   = c => car(c).includes('producao') || car(c).includes('montad');
  const isExp    = c => car(c).includes('expedicao');
  const isEntreg = c => car(c).includes('entregador');
  if (tipo === 'vendas')    return colabs.filter(c => isAtend(c));
  if (tipo === 'producao')  return colabs.filter(c => (isAtend(c) || isProd(c)) && !isEntreg(c));
  if (tipo === 'expedicao') return colabs.filter(c => (isAtend(c) || isExp(c))  && !isEntreg(c));
  if (tipo === 'produto')   return colabs.filter(c => isAtend(c)); // mesma lista de vendas
  return colabs;
}

// ── CALCULO DO REALIZADO ─────────────────────────────────────
export function calcularRealizado(meta, ordersList = S.orders) {
  const orders = Array.isArray(ordersList) ? ordersList : [];
  const { inicio, fim } = (meta.dataInicio && meta.dataFim)
    ? { inicio: new Date(meta.dataInicio+'T00:00:00'), fim: new Date(meta.dataFim+'T23:59:59') }
    : calcularPeriodo(meta.periodoTipo || 'mensal');

  const escopo = meta.escopo || 'colab';
  let colab = null;
  let unidadeSlug = null;

  if (escopo === 'colab') {
    colab = getColabs().find(c => _colabKey(c) === String(meta.colabId));
    if (!colab) return { realizado:0, pct:0, atingida:false, ultrapassou:false, inicio, fim };
  } else if (escopo === 'unidade') {
    unidadeSlug = String(meta.unidade||'').toLowerCase() === 'todas'
      ? 'todas'
      : normalizeUnidade(meta.unidade);
    if (!unidadeSlug) return { realizado:0, pct:0, atingida:false, ultrapassou:false, inicio, fim };
  }

  // Helper: pedido pertence a unidade? ('todas' => sempre true)
  const pedidoNaUnidade = (o) => {
    if (!unidadeSlug) return false;
    if (unidadeSlug === 'todas') return true;
    if (unidadeSlug === 'ecommerce') {
      const src = String(o.source||'').toLowerCase();
      return src.includes('ecomm') || src === 'site' || src === 'e-commerce';
    }
    const u  = normalizeUnidade(o.unit || o.unidade);
    const su = normalizeUnidade(o.saleUnit);
    return u === unidadeSlug || su === unidadeSlug;
  };

  // Helper: item bate com produto-alvo da meta?
  const itemBateProduto = (it) => {
    const codeAlvo = String(meta.produtoCode||'').toUpperCase().trim();
    const idAlvo   = String(meta.produtoId||'').trim();
    const nomeAlvo = String(meta.produtoNome||'').toLowerCase().trim();
    if (idAlvo) {
      if (String(it.product||it._id||it.productId||'') === idAlvo) return true;
    }
    if (codeAlvo) {
      if (String(it.code||'').toUpperCase().trim() === codeAlvo) return true;
    }
    if (nomeAlvo) {
      if (String(it.name||'').toLowerCase().trim() === nomeAlvo) return true;
    }
    return false;
  };

  let realizado = 0;
  for (const o of orders) {
    const dRaw = o.scheduledDate || o.createdAt; if (!dRaw) continue;
    const d = new Date(dRaw); if (d < inicio || d > fim) continue;

    if (meta.tipo === 'vendas') {
      if (!_PG_APROV.has(String(o.paymentStatus||''))) continue;
      let bate;
      if (escopo === 'unidade') bate = pedidoNaUnidade(o);
      else bate = _isMine(colab, o.vendedorId, o.vendedorEmail) ||
        (!o.vendedorId && _isMine(colab, o.createdByColabId, o.createdByEmail, o.criadoPor, o.createdBy, o.createdByName));
      if (bate) realizado += Number(o.total) || 0;
    }
    else if (meta.tipo === 'producao') {
      const st = String(o.status||'').toLowerCase();
      if (!['pronto','saiu p/ entrega','entregue'].some(x => st.includes(x))) continue;
      const bate = escopo === 'unidade' ? pedidoNaUnidade(o)
        : _isMine(colab, o.montadorId, o.montadorEmail, o.montadorNome);
      if (bate) {
        const qty = (o.items||[]).reduce((s,i)=>s+(Number(i.qty)||1), 0) || 1;
        realizado += qty;
      }
    }
    else if (meta.tipo === 'expedicao') {
      const st = String(o.status||'').toLowerCase();
      if (!st.includes('entregue')) continue;
      const bate = escopo === 'unidade' ? pedidoNaUnidade(o)
        : _isMine(colab, o.expedidorId, o.expedidorEmail, o.driverColabId, o.driverName);
      if (bate) realizado += 1;
    }
    else if (meta.tipo === 'produto') {
      // Conta UNIDADES vendidas de um produto especifico em pedidos APROVADOS
      if (!_PG_APROV.has(String(o.paymentStatus||''))) continue;
      // Filtro por escopo:
      let pedidoBate;
      if (escopo === 'unidade') pedidoBate = pedidoNaUnidade(o);
      else pedidoBate = _isMine(colab, o.vendedorId, o.vendedorEmail) ||
        (!o.vendedorId && _isMine(colab, o.createdByColabId, o.createdByEmail, o.criadoPor, o.createdBy, o.createdByName));
      if (!pedidoBate) continue;
      // Soma qty dos items que batem com o produto-alvo
      for (const it of (o.items||[])) {
        if (itemBateProduto(it)) realizado += Number(it.qty)||1;
      }
    }
  }
  const valorMeta = Number(meta.valorMeta) || 0;
  const pct = valorMeta ? (realizado / valorMeta) * 100 : 0;
  return { realizado, pct, atingida: pct >= 100, ultrapassou: pct >= 130, inicio, fim };
}

// Calcula bonus efetivo a pagar a cada colab (considera modo equipe)
export function calcularBonusPagar(meta, ordersList = S.orders) {
  const colabs = colabsPorTipoMeta(meta.tipo);
  const colab = colabs.find(c => _colabKey(c) === String(meta.colabId)) ||
                getColabs().find(c => _colabKey(c) === String(meta.colabId));
  const r = calcularRealizado(meta, ordersList);
  if (!r.atingida) return { ...r, colab, bonusReceber: 0 };
  const bonusInfo = Number(meta.bonusValor) || 0;
  // Para 'equipe' o calculo de "dividir" precisa do conjunto de todas as
  // metas-irmas (mesmo nome ou mesmo periodo). Aqui tratamos UMA meta;
  // a UI da view abaixo agrupa quando precisa.
  return { ...r, colab, bonusReceber: bonusInfo };
}

// ─────────────────────────────────────────────────────────────
//                          RENDER
// ─────────────────────────────────────────────────────────────
export function renderMetas() {
  const sub = S._metasSub || 'list';
  const subBtn = (k, label) => `<button type="button" class="tab ${sub===k?'active':''}" data-metas-sub="${k}" style="font-size:12px;">${label}</button>`;

  return `
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
  <div>
    <div style="font-family:'Playfair Display',serif;font-size:22px;color:#9F1239;">🎯 Metas</div>
    <div style="font-size:12px;color:var(--muted);">Metas individuais por colaboradora · Bônus configurado pelo ADM</div>
  </div>
</div>

<div class="tabs" style="margin-bottom:14px;gap:5px;">
  ${subBtn('list', '📋 Metas Cadastradas')}
  ${subBtn('nova', '➕ Nova Meta')}
  ${subBtn('rank', '🏆 Quem Bateu a Meta')}
</div>

${sub === 'list' ? renderMetasList() : ''}
${sub === 'nova' ? renderMetasNova() : ''}
${sub === 'rank' ? renderMetasRank() : ''}
`;
}

// ─── LISTA ──────────────────────────────────────────────────
function renderMetasList() {
  const metas = getMetas();
  if (!metas.length) {
    return `<div class="card" style="text-align:center;padding:40px;color:var(--muted);">
      <div style="font-size:48px;margin-bottom:12px;">🎯</div>
      <p>Nenhuma meta cadastrada ainda.</p>
      <button class="btn btn-primary" data-metas-sub="nova" style="margin-top:10px;">➕ Criar primeira meta</button>
    </div>`;
  }

  // Agrupa: primeiro Unidades, depois Colaboradoras
  const metasUnidade = metas.filter(m => (m.escopo||'colab') === 'unidade');
  const metasColab   = metas.filter(m => (m.escopo||'colab') === 'colab');

  // Sub-agrupamento por unidade ou por colab
  const byUnidade = {};
  metasUnidade.forEach(m => {
    const k = String(m.unidade||'—');
    if (!byUnidade[k]) byUnidade[k] = [];
    byUnidade[k].push(m);
  });
  const byColab = {};
  metasColab.forEach(m => {
    if (!byColab[m.colabId]) byColab[m.colabId] = [];
    byColab[m.colabId].push(m);
  });

  // Render comum: 1 card de meta
  const renderCardMeta = (m) => {
    const r = calcularRealizado(m);
    const cor    = pctCor(r.pct);
    const corBg  = pctBg(r.pct);
    const status = pctStatus(r.pct);
    const tipoLabel = labelTipo(m.tipo);
    const unit = m.tipo === 'vendas' ? 'R$' : 'un';
    const fmtVal = v => unit==='R$' ? $c(v) : `${Math.round(v)} ${m.tipo==='producao'?'produtos':m.tipo==='produto'?'un':'entregas'}`;
    const bonusLbl = m.bonusModo === 'individual' ? '👤 Bônus individual' : '👥 Bônus de equipe (dividido)';
    const prodTag = m.tipo === 'produto'
      ? `<div style="display:inline-block;margin-top:3px;background:#FEF3C7;color:#92400E;border:1px solid #FCD34D;border-radius:6px;padding:2px 8px;font-size:10px;font-weight:700;">📦 ${m.produtoCode?'#'+m.produtoCode+' · ':''}${escHtml(m.produtoNome||'(produto)')}</div>`
      : '';
    return `<div style="background:${corBg};border-left:5px solid ${cor};border-radius:8px;padding:12px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px;margin-bottom:8px;">
        <div>
          <div style="font-size:14px;font-weight:800;color:#1E293B;">${tipoLabel} ${status.emoji} ${escHtml(m.nome||'')}</div>
          <div style="font-size:11px;color:var(--muted);">${labelPeriodo(m.periodoTipo)} · ${fmtData(m.dataInicio)} a ${fmtData(m.dataFim)}</div>
          ${prodTag}
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
          ${m.visivel
            ? `<button class="btn btn-ghost btn-sm" data-metas-toggle="${m.id}" title="Visível p/ a colab — clique para OCULTAR" style="background:#DCFCE7;color:#15803D;border:1px solid #86EFAC;">👁️ Visível</button>`
            : `<button class="btn btn-ghost btn-sm" data-metas-toggle="${m.id}" title="Privada (só ADM vê) — clique para PUBLICAR no Meu Painel" style="background:#F1F5F9;color:#64748B;border:1px solid #CBD5E1;">🔒 Privada</button>`}
          <button class="btn btn-ghost btn-sm" data-metas-edit="${m.id}">✏️</button>
          <button class="btn btn-ghost btn-sm" data-metas-del="${m.id}" style="color:#DC2626;">🗑️</button>
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-bottom:4px;">
        <span>Meta: <strong>${fmtVal(m.valorMeta)}</strong></span>
        <span>Realizado: <strong style="color:${cor};">${fmtVal(r.realizado)}</strong></span>
        <span style="color:${cor};font-weight:800;">${r.pct.toFixed(0)}% · ${status.label}</span>
      </div>
      <div style="height:10px;background:rgba(255,255,255,.6);border-radius:5px;overflow:hidden;margin-bottom:8px;">
        <div style="height:100%;width:${Math.min(100,r.pct)}%;background:${cor};transition:width .4s;"></div>
      </div>
      <!-- BLOCO DE BONUS — sempre visivel, destacado quando atingida -->
      <div style="background:#fff;border:2px solid ${r.atingida?cor:'#E2E8F0'};border-radius:8px;padding:10px 12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
        <div>
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;font-weight:700;">${bonusLbl}</div>
          <div style="font-size:11px;color:#475569;">${r.atingida ? `${r.ultrapassou?'🏆 ULTRAPASSADA — paga agora':'🎉 ATINGIDA — paga agora'}` : '⏳ Receberá ao bater 100%'}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:10px;color:var(--muted);">${r.atingida ? 'A pagar' : 'Valor do bônus'}</div>
          <div style="font-size:20px;font-weight:900;color:${r.atingida ? '#15803D' : '#1E293B'};">${$c(m.bonusValor)}</div>
        </div>
      </div>
    </div>`;
  };

  // ── RESUMO: quanto cada colab vai receber se TODAS as metas dela baterem
  const resumoPorColab = {};
  metas.forEach(m => {
    if ((m.escopo||'colab') !== 'colab') return;
    const k = String(m.colabId);
    if (!resumoPorColab[k]) resumoPorColab[k] = { total:0, atingido:0, qtd:0, qtdAtingidas:0 };
    const r = calcularRealizado(m);
    resumoPorColab[k].total    += Number(m.bonusValor)||0;
    if (r.atingida) {
      resumoPorColab[k].atingido     += Number(m.bonusValor)||0;
      resumoPorColab[k].qtdAtingidas += 1;
    }
    resumoPorColab[k].qtd += 1;
  });
  const resumoLista = Object.entries(resumoPorColab).map(([cid, v]) => {
    const c = getColabs().find(x => _colabKey(x) === cid);
    return { colab: c, ...v };
  }).filter(it => it.colab).sort((a,b) => b.total - a.total);

  const totalPotencial = resumoLista.reduce((s,r) => s+r.total, 0);
  const totalAtingido  = resumoLista.reduce((s,r) => s+r.atingido, 0);

  return `<div style="display:grid;gap:14px;">

    ${resumoLista.length ? `
    <div class="card" style="background:linear-gradient(135deg,#DCFCE7,#F0FDF4);border:2px solid #86EFAC;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:12px;">
        <div>
          <div style="font-family:'Playfair Display',serif;font-size:18px;color:#15803D;">💚 Resumo de Bônus</div>
          <div style="font-size:11px;color:#15803D;opacity:.8;">Quanto cada uma vai receber se atingir as metas</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:10px;color:#15803D;text-transform:uppercase;font-weight:700;">Já garantido</div>
          <div style="font-size:22px;font-weight:900;color:#15803D;">${$c(totalAtingido)}</div>
          <div style="font-size:10px;color:#15803D;opacity:.7;">de ${$c(totalPotencial)} potencial</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px;">
        ${resumoLista.map(it => {
          const cor = it.qtdAtingidas === it.qtd ? '#15803D' : it.qtdAtingidas > 0 ? '#F59E0B' : '#94A3B8';
          return `<div style="background:#fff;border:1px solid ${cor};border-radius:8px;padding:10px 12px;display:flex;justify-content:space-between;align-items:center;gap:8px;">
            <div style="flex:1;min-width:0;">
              <div style="font-weight:700;font-size:13px;color:#1E293B;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">👤 ${escHtml(it.colab.name||'')}</div>
              <div style="font-size:10px;color:var(--muted);">${it.qtdAtingidas}/${it.qtd} meta(s) batida(s)</div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:9px;color:var(--muted);">${it.atingido > 0 ? 'A receber' : 'Potencial'}</div>
              <div style="font-size:15px;font-weight:900;color:${cor};">${$c(it.atingido > 0 ? it.atingido : it.total)}</div>
              ${it.atingido > 0 && it.atingido < it.total ? `<div style="font-size:9px;color:var(--muted);">+${$c(it.total - it.atingido)} possível</div>` : ''}
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>
    ` : ''}

    ${Object.keys(byUnidade).length ? `
    <div style="font-size:12px;font-weight:800;color:#1E293B;text-transform:uppercase;letter-spacing:1px;background:linear-gradient(90deg,#FAE8E6,transparent);padding:6px 12px;border-radius:6px;">🏪 Metas por Unidade</div>
    ${Object.entries(byUnidade).map(([slug, lista]) => {
      const lbl = labelUnidade(slug) || slug;
      return `<div class="card">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid var(--border);">
          <div style="width:42px;height:42px;border-radius:8px;background:linear-gradient(135deg,#9F1239,#E11D48);color:#fff;display:flex;align-items:center;justify-content:center;font-size:20px;">🏪</div>
          <div style="flex:1;">
            <div style="font-size:16px;font-weight:800;color:#1E293B;">${escHtml(lbl)}</div>
            <div style="font-size:11px;color:var(--muted);">Unidade · ${lista.length} meta(s)</div>
          </div>
        </div>
        <div style="display:grid;gap:10px;">${lista.sort((a,b) => (b.createdAt||0) - (a.createdAt||0)).map(renderCardMeta).join('')}</div>
      </div>`;
    }).join('')}
    ` : ''}

    ${Object.keys(byColab).length ? `
    <div style="font-size:12px;font-weight:800;color:#1E293B;text-transform:uppercase;letter-spacing:1px;background:linear-gradient(90deg,#DBEAFE,transparent);padding:6px 12px;border-radius:6px;">👤 Metas Individuais</div>
    ${Object.entries(byColab).map(([colabId, lista]) => {
      const colab = getColabs().find(c => _colabKey(c) === String(colabId));
      const nome = colab?.name || '— colab removido —';
      const cargo = colab?.cargo || '';
      return `<div class="card">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid var(--border);">
          <div style="width:42px;height:42px;border-radius:50%;background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;">
            ${(nome||'').charAt(0).toUpperCase()}
          </div>
          <div style="flex:1;">
            <div style="font-size:16px;font-weight:800;color:#1E293B;">${escHtml(nome)}</div>
            <div style="font-size:11px;color:var(--muted);">${escHtml(cargo)} · ${lista.length} meta(s) ativa(s)</div>
          </div>
        </div>
        <div style="display:grid;gap:10px;">${lista.sort((a,b) => (b.createdAt||0) - (a.createdAt||0)).map(renderCardMeta).join('')}</div>
      </div>`;
    }).join('')}
    ` : ''}
  </div>`;
}

// Captura os dados do bloco PACOTE (3 sub-metas) em S._metaPacoteDraft.
function _capturarPacoteDraft() {
  const tipos = ['vendas','producao','expedicao'];
  const draft = S._metaPacoteDraft || {};
  for (const t of tipos) {
    const ativoEl = document.querySelector(`[data-pacote-ativo="${t}"]`);
    const valorEl = document.querySelector(`[data-pacote-valor="${t}"]`);
    const bonusEl = document.querySelector(`[data-pacote-bonus="${t}"]`);
    if (!ativoEl && !valorEl && !bonusEl) continue;
    draft[t] = {
      ativo:      ativoEl ? !!ativoEl.checked : (draft[t]?.ativo !== false),
      valorMeta:  Number(valorEl?.value) || 0,
      bonusValor: Number(bonusEl?.value) || 0,
    };
  }
  S._metaPacoteDraft = draft;
}

// Captura todos os campos do form atual em S._metaDraft (preserva
// dados ao re-renderizar por mudanca de tipo/escopo/etc).
function _capturarFormDraft() {
  const get = id => document.getElementById(id);
  if (!get('meta-nome')) return; // form nao montado
  // Produto vem encodado como "id|code|nome"
  const prodRaw = get('meta-produto')?.value || '';
  const [pId, pCode, pNome] = prodRaw.split('|');
  S._metaDraft = {
    nome:        get('meta-nome')?.value || '',
    tipo:        get('meta-tipo')?.value || '',
    colabId:     get('meta-colab')?.value || '',
    unidade:     get('meta-unidade')?.value || '',
    produtoId:   pId   || S._metaDraft?.produtoId   || '',
    produtoCode: pCode || S._metaDraft?.produtoCode || '',
    produtoNome: pNome || S._metaDraft?.produtoNome || '',
    periodoTipo: get('meta-periodo-tipo')?.value || '',
    dataInicio:  get('meta-data-inicio')?.value || '',
    dataFim:     get('meta-data-fim')?.value || '',
    valorMeta:   Number(get('meta-valor')?.value) || 0,
    bonusModo:   get('meta-bonus-modo')?.value || '',
    bonusValor:  Number(get('meta-bonus-valor')?.value) || 0,
    visivel:     !!get('meta-visivel')?.checked,
  };
}

// ─── NOVA META (form) ───────────────────────────────────────
function renderMetasNova() {
  const editId = S._metasEditId || '';
  // Editando: usa a meta cadastrada. Criando: usa S._metaDraft (campos
  // preservados entre re-renders quando ADM troca tipo/escopo).
  const meta = editId
    ? getMetas().find(m => m.id === editId) || {}
    : (S._metaDraft || {});
  const isEdit = !!meta.id;
  const tipo = meta.tipo || S._metaTipoDraft || 'vendas';
  const escopo = meta.escopo || S._metaEscopoDraft || 'colab';
  const colabsDoTipo = colabsPorTipoMeta(tipo);
  // Modo PACOTE — so disponivel para colab + criando (nao edicao):
  // ADM define vendas + producao + expedicao numa unica vez.
  const modoPacote = !isEdit && escopo === 'colab' && (S._metaModoPacote === true);

  const escopoBtn = (k, label, icon) => `<button type="button" class="btn btn-sm ${escopo===k?'btn-primary':'btn-ghost'}" data-meta-escopo="${k}" style="flex:1;">${icon} ${label}</button>`;
  const modoBtn = (val, label) => `<button type="button" class="btn btn-sm ${(modoPacote===val)?'btn-primary':'btn-ghost'}" data-meta-modo-pacote="${val}" style="flex:1;">${label}</button>`;

  return `<div class="card">
    <div class="card-title">${isEdit ? '✏️ Editar Meta' : '➕ Nova Meta'}</div>

    <!-- Seletor de escopo -->
    <div style="margin-bottom:14px;">
      <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:6px;">Para quem é a meta?</div>
      <div style="display:flex;gap:6px;">
        ${escopoBtn('colab',   'Colaboradora individual', '👤')}
        ${escopoBtn('unidade', 'Unidade (loja inteira)',  '🏪')}
      </div>
    </div>

    ${escopo === 'colab' && !isEdit ? `
    <!-- Toggle: meta unica vs pacote (3 metas de uma vez) -->
    <div style="margin-bottom:14px;background:linear-gradient(135deg,#FAE8E6,#FAF7F5);border:1px solid #FECDD3;border-radius:10px;padding:10px 12px;">
      <div style="font-size:11px;font-weight:700;color:#9F1239;text-transform:uppercase;margin-bottom:6px;">📋 Modo de cadastro</div>
      <div style="display:flex;gap:6px;">
        ${modoBtn(false, '🎯 Meta única (1 tipo)')}
        ${modoBtn(true,  '📦 Pacote (Vendas + Produção + Expedição)')}
      </div>
      <div style="font-size:10px;color:#9F1239;margin-top:6px;font-style:italic;">${modoPacote
        ? '💡 Pacote: você define meta+bônus para Vendas, Produção e Expedição. Salvar criará 1 meta para cada tipo marcado.'
        : '💡 Meta única: só 1 tipo (vendas, produção, expedição ou produto específico).'}</div>
    </div>
    ` : ''}

    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;">

      <div class="fg" style="grid-column:span 2;">
        <label class="fl">Nome da meta</label>
        <input type="text" class="fi" id="meta-nome" value="${escHtml(meta.nome||'')}" placeholder="${escopo==='unidade'?'Ex: Meta CDLE Mai/2026':'Ex: Meta Vendas Jessica Mai/2026'}"/>
      </div>

      ${!modoPacote ? `
      <div class="fg">
        <label class="fl">📊 Tipo de meta</label>
        <select class="fi" id="meta-tipo">
          <option value="vendas"    ${tipo==='vendas'   ?'selected':''}>💰 Vendas (R$)</option>
          <option value="producao"  ${tipo==='producao' ?'selected':''}>🌹 Produção / Montagem (qtd produtos)</option>
          <option value="expedicao" ${tipo==='expedicao'?'selected':''}>🚚 Expedição (qtd entregas)</option>
          <option value="produto"   ${tipo==='produto'  ?'selected':''}>📦 Produto Específico (qtd vendida)</option>
        </select>
      </div>
      ` : ''}

      ${escopo === 'colab' ? `
      <div class="fg">
        <label class="fl">👤 Colaboradora</label>
        <select class="fi" id="meta-colab">
          <option value="">— Selecione —</option>
          ${colabsDoTipo.sort((a,b)=>(a.name||'').localeCompare(b.name||'')).map(c => {
            const k = _colabKey(c);
            return `<option value="${k}" ${String(meta.colabId)===k?'selected':''}>${escHtml(c.name)} (${escHtml(c.cargo||'')})</option>`;
          }).join('')}
        </select>
      </div>
      ` : `
      <div class="fg">
        <label class="fl">🏪 Unidade</label>
        <select class="fi" id="meta-unidade">
          <option value="">— Selecione —</option>
          ${UNIDADES_META.map(u => `<option value="${u.slug}" ${String(meta.unidade)===u.slug?'selected':''}>${u.label}</option>`).join('')}
        </select>
      </div>
      `}

      <div class="fg">
        <label class="fl">📅 Período</label>
        <select class="fi" id="meta-periodo-tipo">
          <option value="semanal" ${meta.periodoTipo==='semanal'?'selected':''}>Semanal</option>
          <option value="mensal"  ${(meta.periodoTipo||'mensal')==='mensal'?'selected':''}>Mensal</option>
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

      ${tipo === 'produto' && !modoPacote ? `
      <div class="fg" style="grid-column:span 2;">
        <label class="fl">📦 Produto-alvo <span style="color:var(--red)">*</span></label>
        <select class="fi" id="meta-produto">
          <option value="">— Selecione um produto —</option>
          ${(S.products||[]).filter(p => p.active !== false).sort((a,b) => (a.name||'').localeCompare(b.name||'')).map(p => {
            const code = p.code || p.codigo || '';
            const sel = (String(meta.produtoId||'') === String(p._id||p.id) || (code && code === meta.produtoCode));
            return `<option value="${p._id||p.id}|${code}|${escHtml(p.name||'')}" ${sel?'selected':''}>${code?'#'+code+' — ':''}${escHtml(p.name||'?')}</option>`;
          }).join('')}
        </select>
        <div style="font-size:10px;color:var(--muted);margin-top:3px;">O sistema soma a quantidade vendida deste produto no período (pedidos aprovados).</div>
      </div>
      ` : ''}

      ${!modoPacote ? `
      <div class="fg" style="grid-column:span 2;">
        <label class="fl">🎯 Valor da meta <span style="color:var(--muted);font-size:11px;">(${
          tipo==='vendas'    ? 'R$' :
          tipo==='producao'  ? 'qtd produtos' :
          tipo==='expedicao' ? 'qtd entregas' :
          tipo==='produto'   ? 'unidades do produto' : ''})</span></label>
        <input type="number" class="fi" id="meta-valor" min="0" step="${tipo==='vendas'?'0.01':'1'}" value="${meta.valorMeta||''}" placeholder="${
          tipo==='vendas'    ? 'Ex: 30000' :
          tipo==='producao'  ? 'Ex: 200'   :
          tipo==='expedicao' ? 'Ex: 100'   :
          tipo==='produto'   ? 'Ex: 50 (vender 50 unidades)' : 'Ex: 100'}"/>
      </div>
      ` : ''}

      <div class="fg">
        <label class="fl">💎 Modo do bônus</label>
        <select class="fi" id="meta-bonus-modo">
          <option value="individual" ${(meta.bonusModo||'individual')==='individual'?'selected':''}>👤 Individual (paga R$ X só a essa colab)</option>
          <option value="equipe"     ${meta.bonusModo==='equipe'?'selected':''}>👥 Equipe (R$ X dividido com todas que baterem)</option>
        </select>
      </div>

      ${!modoPacote ? `
      <div class="fg">
        <label class="fl">💰 Valor do bônus (R$)</label>
        <input type="number" class="fi" id="meta-bonus-valor" min="0" step="0.01" value="${meta.bonusValor||''}" placeholder="Ex: 500"/>
      </div>
      ` : ''}

      ${modoPacote ? `
      <!-- PACOTE: 3 sub-metas (Vendas + Producao + Expedicao) -->
      <div style="grid-column:span 2;background:#FAFAFA;border:1px solid var(--border);border-radius:10px;padding:12px;">
        <div style="font-size:12px;font-weight:800;color:#1E293B;margin-bottom:10px;text-transform:uppercase;">🎯 Defina meta + bônus para cada tipo</div>
        ${[
          { k:'vendas',    label:'💰 Vendas',    unit:'R$', step:'0.01', placeMeta:'30000', placeBonus:'500' },
          { k:'producao',  label:'🌹 Produção',  unit:'qtd', step:'1',    placeMeta:'200',   placeBonus:'300' },
          { k:'expedicao', label:'🚚 Expedição', unit:'qtd', step:'1',    placeMeta:'100',   placeBonus:'200' },
        ].map(t => {
          const draft = (S._metaPacoteDraft && S._metaPacoteDraft[t.k]) || {};
          const ativo = draft.ativo !== false; // default: marcado
          return `<div style="background:#fff;border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:8px;">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:6px;">
              <input type="checkbox" data-pacote-ativo="${t.k}" ${ativo?'checked':''} style="width:18px;height:18px;cursor:pointer;accent-color:var(--rose);"/>
              <span style="font-size:13px;font-weight:700;color:#1E293B;">${t.label}</span>
            </label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
              <div>
                <label style="font-size:10px;color:var(--muted);font-weight:700;">Meta (${t.unit})</label>
                <input type="number" class="fi" data-pacote-valor="${t.k}" min="0" step="${t.step}" value="${draft.valorMeta||''}" placeholder="Ex: ${t.placeMeta}"/>
              </div>
              <div>
                <label style="font-size:10px;color:var(--muted);font-weight:700;">💰 Bônus (R$)</label>
                <input type="number" class="fi" data-pacote-bonus="${t.k}" min="0" step="0.01" value="${draft.bonusValor||''}" placeholder="Ex: ${t.placeBonus}"/>
              </div>
            </div>
          </div>`;
        }).join('')}
        <div style="font-size:10px;color:var(--muted);font-style:italic;margin-top:6px;">⚠️ Apenas tipos com meta &gt; 0 e checkbox marcada serão criados. O nome ganha sufixo automático (ex: 'Meta Jessica · 💰 Vendas').</div>
      </div>
      ` : ''}

      <div class="fg" style="grid-column:span 2;">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;background:#FEF3C7;border:1px solid #FCD34D;border-radius:8px;padding:10px 12px;">
          <input type="checkbox" id="meta-visivel" ${meta.visivel?'checked':''} style="width:18px;height:18px;cursor:pointer;accent-color:#F59E0B;"/>
          <span style="font-size:13px;font-weight:600;color:#92400E;">
            👁️ Publicar no Meu Painel da colaboradora
          </span>
          <span style="font-size:11px;color:#92400E;opacity:.8;margin-left:auto;">
            Se desmarcado, a meta fica privada — só você (ADM) vê.
          </span>
        </label>
      </div>
    </div>

    <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:10px;padding:10px;margin-top:14px;font-size:12px;color:#1E40AF;">
      ℹ️ O bônus é pago automaticamente quando a colaboradora atinge <strong>100%</strong> da meta.
      Cores indicam progresso: 🔴 &lt;50% · 🟡 50-79% · 🟢 80-99% · 💎 100-129% · 🏆 ≥130%.
    </div>

    <div style="display:flex;gap:8px;margin-top:14px;">
      <button class="btn btn-primary" id="btn-meta-save">${isEdit?'💾 Salvar alterações':'➕ Criar meta'}</button>
      <button class="btn btn-ghost" id="btn-meta-cancel">Cancelar</button>
    </div>
  </div>`;
}

// ─── RANKING / QUEM BATEU ───────────────────────────────────
function renderMetasRank() {
  const metas = getMetas();
  if (!metas.length) {
    return `<div class="card" style="text-align:center;padding:40px;color:var(--muted);">
      <p>Sem metas cadastradas.</p>
    </div>`;
  }

  // Calcula realizado de todas (separa metas de colab das de unidade)
  const allItems = metas.map(m => {
    const r = calcularRealizado(m);
    const escopo = m.escopo || 'colab';
    const colab = escopo === 'colab' ? getColabs().find(c => _colabKey(c) === String(m.colabId)) : null;
    return { meta: m, r, colab, escopo };
  });
  const itemsUnidade = allItems.filter(it => it.escopo === 'unidade');
  const items = allItems.filter(it => it.escopo === 'colab' && it.colab);

  // Bonus a pagar — calcula por modo
  // Individual: cada uma que bateu recebe meta.bonusValor
  // Equipe: agrupa por (nome+periodo+tipo), divide o bonus entre quem bateu nesse grupo
  const bonusPorColab = {}; // colabKey -> { nome, total, detalhes:[{label, valor}] }
  // Helper p/ adicionar
  const addBonus = (colab, label, valor) => {
    const k = _colabKey(colab);
    if (!bonusPorColab[k]) bonusPorColab[k] = { colab, nome:colab.name, total:0, detalhes:[] };
    bonusPorColab[k].total += valor;
    bonusPorColab[k].detalhes.push({ label, valor });
  };

  // Individual
  items.filter(it => (it.meta.bonusModo||'individual') === 'individual' && it.r.atingida)
       .forEach(it => addBonus(it.colab, `${labelTipo(it.meta.tipo)} · ${it.meta.nome||''}`, Number(it.meta.bonusValor)||0));

  // Equipe — agrupa metas com mesmo nome+tipo+periodo
  const grupos = {};
  items.filter(it => it.meta.bonusModo === 'equipe').forEach(it => {
    const gk = `${it.meta.nome}|${it.meta.tipo}|${it.meta.dataInicio}|${it.meta.dataFim}`;
    if (!grupos[gk]) grupos[gk] = { metas:[], bonusTotal: Number(it.meta.bonusValor)||0 };
    grupos[gk].metas.push(it);
  });
  Object.entries(grupos).forEach(([gk, g]) => {
    const bateram = g.metas.filter(it => it.r.atingida);
    if (!bateram.length) return;
    const por = g.bonusTotal / bateram.length;
    bateram.forEach(it => addBonus(it.colab, `🤝 Equipe · ${labelTipo(it.meta.tipo)} · ${it.meta.nome||''}`, por));
  });

  const ranking = Object.values(bonusPorColab).sort((a,b) => b.total - a.total);
  const totalAPagar = ranking.reduce((s,r) => s+r.total, 0);

  // Tambem mostra metas NAO batidas (pra acompanhamento)
  const naoBateram = items.filter(it => !it.r.atingida).sort((a,b) => b.r.pct - a.r.pct);

  return `
<div class="card" style="margin-bottom:14px;background:linear-gradient(135deg,#DCFCE7,#F0FDF4);border:2px solid #86EFAC;">
  <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
    <div>
      <div style="font-size:11px;color:#15803D;text-transform:uppercase;font-weight:700;">Total de bônus a pagar</div>
      <div style="font-size:28px;font-weight:900;color:#15803D;">${$c(totalAPagar)}</div>
    </div>
    <div style="font-size:13px;color:#15803D;text-align:right;">
      <strong>${ranking.length}</strong> colab(s) bateram metas<br/>
      <strong>${naoBateram.length}</strong> ainda em andamento
    </div>
  </div>
</div>

<div class="card" style="margin-bottom:14px;">
  <div class="card-title">🏆 Quem Bateu a Meta — Bônus a Receber</div>
  ${ranking.length === 0 ? `
    <div style="text-align:center;padding:30px;color:var(--muted);font-size:13px;">
      Ninguém atingiu meta ainda neste período.
    </div>
  ` : `
    <div style="display:grid;gap:8px;">
      ${ranking.map((r,i) => {
        const medal = ['🥇','🥈','🥉'][i] || `${i+1}º`;
        return `<div style="background:#FAFAFA;border-left:4px solid #15803D;border-radius:8px;padding:10px 14px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div style="display:flex;align-items:center;gap:10px;">
              <span style="font-size:22px;">${medal}</span>
              <span style="font-weight:800;font-size:14px;">${escHtml(r.nome)}</span>
            </div>
            <div style="font-size:18px;font-weight:900;color:#15803D;">${$c(r.total)}</div>
          </div>
          <div style="margin-top:6px;font-size:11px;color:var(--muted);display:flex;flex-direction:column;gap:2px;">
            ${r.detalhes.map(d => `<div>• ${escHtml(d.label)} → <strong style="color:#15803D;">${$c(d.valor)}</strong></div>`).join('')}
          </div>
        </div>`;
      }).join('')}
    </div>
  `}
</div>

${itemsUnidade.length > 0 ? `
<div class="card" style="margin-bottom:14px;">
  <div class="card-title">🏪 Metas por Unidade</div>
  <div style="display:grid;gap:8px;">
    ${itemsUnidade.sort((a,b) => b.r.pct - a.r.pct).map(it => {
      const cor = pctCor(it.r.pct);
      const status = pctStatus(it.r.pct);
      const lbl = labelUnidade(it.meta.unidade) || it.meta.unidade;
      const unit = it.meta.tipo === 'vendas' ? 'R$' : 'un';
      const fmtVal = v => unit==='R$' ? $c(v) : `${Math.round(v)} ${it.meta.tipo==='producao'?'produtos':'entregas'}`;
      return `<div style="background:#FAFAFA;border-left:4px solid ${cor};border-radius:8px;padding:10px 14px;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
          <div style="display:flex;align-items:center;gap:10px;">
            <span style="font-size:22px;">🏪</span>
            <div>
              <div style="font-weight:800;font-size:14px;">${escHtml(lbl)} <span style="color:var(--muted);font-weight:400;font-size:11px;">· ${labelTipo(it.meta.tipo)} · ${escHtml(it.meta.nome||'')}</span></div>
              <div style="font-size:11px;color:var(--muted);">Meta: <strong>${fmtVal(it.meta.valorMeta)}</strong> · Realizado: <strong style="color:${cor};">${fmtVal(it.r.realizado)}</strong></div>
            </div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:20px;font-weight:900;color:${cor};">${it.r.pct.toFixed(0)}% ${status.emoji}</div>
            ${it.r.atingida ? `<div style="font-size:11px;color:${cor};font-weight:700;">Bônus: ${$c(it.meta.bonusValor)}</div>` : ''}
          </div>
        </div>
        <div style="height:6px;background:#E2E8F0;border-radius:3px;overflow:hidden;margin-top:8px;">
          <div style="height:100%;width:${Math.min(100,it.r.pct)}%;background:${cor};"></div>
        </div>
      </div>`;
    }).join('')}
  </div>
</div>
` : ''}

${naoBateram.length > 0 ? `
<div class="card">
  <div class="card-title">⏳ Metas em Andamento</div>
  <div style="display:grid;gap:6px;">
    ${naoBateram.map(it => {
      const cor = pctCor(it.r.pct);
      const status = pctStatus(it.r.pct);
      return `<div style="display:flex;align-items:center;gap:10px;padding:8px;background:#FAFAFA;border-radius:6px;">
        <div style="flex:1;">
          <div style="font-size:13px;font-weight:600;">${escHtml(it.colab.name)} <span style="color:var(--muted);font-weight:400;font-size:11px;">· ${labelTipo(it.meta.tipo)} · ${escHtml(it.meta.nome||'')}</span></div>
        </div>
        <div style="width:120px;height:6px;background:#E2E8F0;border-radius:3px;overflow:hidden;">
          <div style="height:100%;width:${it.r.pct}%;background:${cor};"></div>
        </div>
        <div style="width:50px;text-align:right;color:${cor};font-weight:700;font-size:12px;">${it.r.pct.toFixed(0)}%</div>
        <div style="width:30px;text-align:center;font-size:14px;">${status.emoji}</div>
      </div>`;
    }).join('')}
  </div>
</div>
` : ''}
`;
}

// ── HELPERS DE FORMATACAO ────────────────────────────────────
function escHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fmtData(iso) { if (!iso) return '—'; const [y,m,d] = iso.split('-'); return `${d}/${m}/${y}`; }
function labelTipo(t) { return { vendas:'💰 Vendas', producao:'🌹 Produção', expedicao:'🚚 Expedição', produto:'📦 Produto' }[t] || t; }
function labelPeriodo(p) { return { semanal:'Semanal', mensal:'Mensal' }[p] || p; }

function pctCor(pct) {
  if (pct >= 130) return '#B45309'; // dourado intenso (🏆)
  if (pct >= 100) return '#7C3AED'; // roxo (💎)
  if (pct >= 80)  return '#15803D'; // verde
  if (pct >= 50)  return '#F59E0B'; // amarelo
  return '#DC2626'; // vermelho
}
function pctBg(pct) {
  if (pct >= 130) return 'linear-gradient(135deg,#FEF3C7,#FDE68A)';
  if (pct >= 100) return 'linear-gradient(135deg,#EDE9FE,#DDD6FE)';
  if (pct >= 80)  return 'linear-gradient(135deg,#DCFCE7,#BBF7D0)';
  if (pct >= 50)  return 'linear-gradient(135deg,#FEF3C7,#FDE68A)';
  return 'linear-gradient(135deg,#FEE2E2,#FECACA)';
}
function pctStatus(pct) {
  if (pct >= 130) return { emoji:'🏆', label:'ULTRAPASSOU FORTE' };
  if (pct >= 100) return { emoji:'💎', label:'META ATINGIDA' };
  if (pct >= 80)  return { emoji:'🟢', label:'Quase lá' };
  if (pct >= 50)  return { emoji:'🟡', label:'No meio' };
  return { emoji:'🔴', label:'Inicial' };
}

// ── BINDINGS ─────────────────────────────────────────────────
export function bindMetasEvents() {
  const render = () => import('../main.js').then(m => m.render()).catch(()=>{});

  document.querySelectorAll('[data-metas-sub]').forEach(b => {
    b.addEventListener('click', () => {
      S._metasSub = b.dataset.metasSub;
      if (S._metasSub !== 'nova') {
        S._metasEditId = null;
        S._metaDraft = null;
        S._metaTipoDraft = null;
        S._metaEscopoDraft = null;
        S._metaPacoteDraft = null;
        S._metaModoPacote = false;
      }
      render();
    });
  });

  // Trocar tipo no form atualiza a lista de colabs (preservando dados)
  document.getElementById('meta-tipo')?.addEventListener('change', e => {
    _capturarFormDraft();
    S._metaTipoDraft = e.target.value;
    if (S._metaDraft) S._metaDraft.tipo = e.target.value;
    render();
  });

  // Trocar escopo (colab/unidade) re-renderiza o form (preservando dados)
  document.querySelectorAll('[data-meta-escopo]').forEach(b => {
    b.addEventListener('click', () => {
      _capturarFormDraft();
      S._metaEscopoDraft = b.dataset.metaEscopo;
      if (S._metaDraft) S._metaDraft.escopo = b.dataset.metaEscopo;
      // Modo pacote so vale para colab
      if (b.dataset.metaEscopo !== 'colab') S._metaModoPacote = false;
      render();
    });
  });

  // Toggle modo pacote (colab apenas) — captura dados antes de re-render
  document.querySelectorAll('[data-meta-modo-pacote]').forEach(b => {
    b.addEventListener('click', () => {
      _capturarFormDraft();
      _capturarPacoteDraft();
      S._metaModoPacote = (b.dataset.metaModoPacote === 'true');
      render();
    });
  });

  // Captura inputs do pacote em mudancas
  document.querySelectorAll('[data-pacote-ativo],[data-pacote-valor],[data-pacote-bonus]').forEach(el => {
    el.addEventListener('change', _capturarPacoteDraft);
  });

  // Captura draft ao digitar/blur em qualquer campo do form (defensivo)
  ['meta-nome','meta-colab','meta-unidade','meta-produto','meta-periodo-tipo',
   'meta-data-inicio','meta-data-fim','meta-valor','meta-bonus-modo',
   'meta-bonus-valor','meta-visivel'
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', _capturarFormDraft);
  });

  document.getElementById('btn-meta-save')?.addEventListener('click', () => {
    const escopo      = S._metaEscopoDraft || 'colab';
    const editId      = S._metasEditId;
    const isPacote    = !editId && escopo === 'colab' && S._metaModoPacote === true;
    const nome        = document.getElementById('meta-nome')?.value.trim();
    const colabId     = escopo === 'colab'   ? document.getElementById('meta-colab')?.value    : '';
    const unidade     = escopo === 'unidade' ? document.getElementById('meta-unidade')?.value  : '';
    const periodoTipo = document.getElementById('meta-periodo-tipo')?.value;
    const dataInicio  = document.getElementById('meta-data-inicio')?.value;
    const dataFim     = document.getElementById('meta-data-fim')?.value;
    const bonusModo   = document.getElementById('meta-bonus-modo')?.value;
    const visivel     = !!document.getElementById('meta-visivel')?.checked;

    // Validacoes comuns
    if (!nome)       { toast('Informe o nome da meta', true); return; }
    if (escopo === 'colab'   && !colabId)  { toast('Selecione uma colaboradora', true); return; }
    if (escopo === 'unidade' && !unidade)  { toast('Selecione uma unidade', true); return; }
    if (!dataInicio || !dataFim) { toast('Defina período (datas início e fim)', true); return; }
    if (dataInicio > dataFim) { toast('Data inicial maior que final', true); return; }

    const metas = getMetas();
    const baseId = () => 'mt_'+Date.now()+'_'+Math.random().toString(36).slice(2,7);

    if (isPacote) {
      // ── MODO PACOTE: cria 1 meta por tipo ativo ───────────────
      _capturarPacoteDraft();
      const tipos = ['vendas','producao','expedicao'];
      const tipoLabels = { vendas:'💰 Vendas', producao:'🌹 Produção', expedicao:'🚚 Expedição' };
      const ativos = tipos.filter(t => {
        const d = S._metaPacoteDraft?.[t];
        return d && d.ativo !== false && (Number(d.valorMeta)||0) > 0;
      });
      if (!ativos.length) { toast('Marque ao menos 1 tipo com valor > 0', true); return; }
      let criadas = 0;
      for (const t of ativos) {
        const d = S._metaPacoteDraft[t];
        const bonusValor = Number(d.bonusValor) || 0;
        if (bonusValor < 0) continue;
        metas.push({
          id: baseId(),
          nome: `${nome} · ${tipoLabels[t]}`,
          escopo: 'colab', tipo: t, colabId,
          unidade: '', produtoId:'', produtoCode:'', produtoNome:'',
          periodoTipo, dataInicio, dataFim,
          valorMeta: Number(d.valorMeta)||0,
          bonusModo, bonusValor, visivel,
          createdAt: Date.now(),
        });
        criadas++;
      }
      setMetas(metas);
      toast(`✅ ${criadas} meta(s) criada(s) em pacote`);
    } else {
      // ── MODO META UNICA (ou edicao) ───────────────────────────
      const tipo       = document.getElementById('meta-tipo')?.value;
      const valorMeta  = Number(document.getElementById('meta-valor')?.value) || 0;
      const bonusValor = Number(document.getElementById('meta-bonus-valor')?.value) || 0;
      const prodRaw = document.getElementById('meta-produto')?.value || '';
      const [produtoId, produtoCode, produtoNome] = prodRaw.split('|');

      if (tipo === 'produto' && !produtoId && !produtoCode && !produtoNome) { toast('Selecione um produto-alvo', true); return; }
      if (!valorMeta || valorMeta <= 0) { toast('Valor da meta deve ser > 0', true); return; }
      if (bonusValor < 0) { toast('Valor do bônus inválido', true); return; }

      const payload = { nome, escopo, tipo, colabId, unidade,
        produtoId: produtoId||'', produtoCode: produtoCode||'', produtoNome: produtoNome||'',
        periodoTipo, dataInicio, dataFim, valorMeta, bonusModo, bonusValor, visivel };

      if (editId) {
        const idx = metas.findIndex(m => m.id === editId);
        if (idx >= 0) {
          metas[idx] = { ...metas[idx], ...payload };
          setMetas(metas);
          toast('✅ Meta atualizada');
        }
      } else {
        metas.push({ id: baseId(), ...payload, createdAt: Date.now() });
        setMetas(metas);
        toast('✅ Meta criada');
      }
    }

    S._metasEditId = null; S._metasSub = 'list';
    S._metaTipoDraft = null; S._metaEscopoDraft = null;
    S._metaDraft = null; S._metaPacoteDraft = null; S._metaModoPacote = false;
    render();
  });

  document.getElementById('btn-meta-cancel')?.addEventListener('click', () => {
    S._metasEditId = null; S._metasSub = 'list';
    S._metaTipoDraft = null; S._metaEscopoDraft = null;
    S._metaDraft = null; S._metaPacoteDraft = null; S._metaModoPacote = false;
    render();
  });

  document.querySelectorAll('[data-metas-edit]').forEach(b => {
    b.addEventListener('click', () => {
      S._metasEditId = b.dataset.metasEdit; S._metasSub = 'nova';
      render();
    });
  });

  document.querySelectorAll('[data-metas-del]').forEach(b => {
    b.addEventListener('click', () => {
      if (!confirm('Excluir esta meta?')) return;
      setMetas(getMetas().filter(m => m.id !== b.dataset.metasDel));
      toast('🗑️ Meta excluída');
      render();
    });
  });

  // Toggle visivel/privada — publica ou oculta no Meu Painel
  document.querySelectorAll('[data-metas-toggle]').forEach(b => {
    b.addEventListener('click', () => {
      const id = b.dataset.metasToggle;
      const metas = getMetas();
      const idx = metas.findIndex(m => m.id === id);
      if (idx < 0) return;
      metas[idx].visivel = !metas[idx].visivel;
      setMetas(metas);
      toast(metas[idx].visivel ? '👁️ Meta publicada no Meu Painel' : '🔒 Meta ocultada (privada)');
      render();
    });
  });
}

// ── VIEW ATENDENTE (Meu Painel) ──────────────────────────────
// Cada colab ve as proprias metas individuais + as metas da unidade
// dela (e as 'todas') desde que o ADM tenha publicado (m.visivel===true).
//
// Mostra:
//   - Nome da meta + tipo
//   - Unidade (se for meta de unidade)
//   - Valor da meta + realizado + % com barra colorida
//   - Bonus INDIVIDUAL DELA (se modo equipe, mostra a parte dela)
export function renderMetasParaAtendente(user, ordersList = S.orders) {
  const myKey = String(user?._id || user?.id || '');
  const myUnitSlug = normalizeUnidade(user?.unidade || user?.unit) || '';
  const allVisiveis = getMetas().filter(m => m.visivel === true);

  // 1) Metas individuais dela
  const minhasIndiv = allVisiveis.filter(m =>
    (m.escopo||'colab') === 'colab' && String(m.colabId) === myKey
  );

  // 2) Metas de unidade onde ela participa: 'todas' OU unidade dela
  const minhasUnid = allVisiveis.filter(m => {
    if ((m.escopo||'colab') !== 'unidade') return false;
    const slug = String(m.unidade||'').toLowerCase();
    if (slug === 'todas') return true;
    return slug === myUnitSlug;
  });

  const metas = [...minhasIndiv, ...minhasUnid];
  if (!metas.length) return '';

  // Helper: calcula a parte do bonus que ESTA colab vai receber
  // - bonus individual: valor cheio
  // - bonus equipe (colab): bonusValor / qtd_no_grupo (mesmo nome+tipo+periodo)
  // - bonus equipe (unidade): bonusValor / qtd_atendentes_da_unidade
  const calcularMinhaParte = (m) => {
    const total = Number(m.bonusValor) || 0;
    if ((m.bonusModo||'individual') === 'individual') return { share: total, divisor: 1 };
    if ((m.escopo||'colab') === 'unidade') {
      // Atendentes da unidade — para 'todas' usa todas
      const slug = String(m.unidade||'').toLowerCase();
      let qtd;
      if (slug === 'todas') qtd = colabsPorTipoMeta('vendas').length || 1;
      else {
        qtd = colabsPorTipoMeta('vendas').filter(c => normalizeUnidade(c.unidade||c.unit) === slug).length || 1;
      }
      return { share: total / qtd, divisor: qtd };
    }
    // bonus equipe entre colabs: agrupa metas-irmas (mesmo nome+tipo+periodo)
    const grupo = allVisiveis.filter(x =>
      (x.escopo||'colab') === 'colab' &&
      x.bonusModo === 'equipe' &&
      x.nome === m.nome &&
      x.tipo === m.tipo &&
      x.dataInicio === m.dataInicio &&
      x.dataFim === m.dataFim
    );
    const qtd = grupo.length || 1;
    return { share: total / qtd, divisor: qtd };
  };

  const blocos = metas.map(m => {
    const r = calcularRealizado(m, ordersList);
    const cor = pctCor(r.pct);
    const corBg = pctBg(r.pct);
    const status = pctStatus(r.pct);
    const tipoLbl = labelTipo(m.tipo);
    const unit = m.tipo === 'vendas' ? 'R$' : 'un';
    const fmtVal = v => unit==='R$' ? $c(v) : `${Math.round(v)} ${m.tipo==='producao'?'produtos':m.tipo==='produto'?'un':'entregas'}`;
    const ehUnid = (m.escopo||'colab') === 'unidade';
    const lblUnid = ehUnid
      ? (String(m.unidade||'').toLowerCase()==='todas' ? '🌐 Todas as Unidades' : ('🏪 ' + (labelUnidade(m.unidade) || m.unidade)))
      : '';
    const tagProduto = m.tipo === 'produto'
      ? `<div style="display:inline-block;margin-top:3px;background:#FEF3C7;color:#92400E;border:1px solid #FCD34D;border-radius:6px;padding:2px 7px;font-size:10px;font-weight:700;">📦 ${m.produtoCode?'#'+m.produtoCode+' · ':''}${escHtml(m.produtoNome||'')}</div>`
      : '';

    const minha = calcularMinhaParte(m);
    const bonusLbl = (m.bonusModo||'individual') === 'individual'
      ? `Seu bônus`
      : `Sua parte (1 de ${minha.divisor})`;

    return `<div style="margin-bottom:10px;padding:12px;background:${corBg};border-left:4px solid ${cor};border-radius:8px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;flex-wrap:wrap;gap:8px;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:800;color:#1E293B;">${tipoLbl} ${status.emoji} ${escHtml(m.nome||'')}</div>
          <div style="font-size:10px;color:var(--muted);">${labelPeriodo(m.periodoTipo)} · ${fmtData(m.dataInicio)} a ${fmtData(m.dataFim)}</div>
          ${ehUnid ? `<div style="display:inline-block;margin-top:3px;background:#FAE8E6;color:#9F1239;border:1px solid #FECDD3;border-radius:6px;padding:2px 8px;font-size:10px;font-weight:700;">${lblUnid}</div>` : ''}
          ${tagProduto}
        </div>
        <div style="text-align:right;">
          <div style="font-size:22px;font-weight:900;color:${cor};">${r.pct.toFixed(0)}%</div>
          <div style="font-size:9px;color:${cor};font-weight:700;">${status.label}</div>
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-bottom:4px;">
        <span>Meta: <strong>${fmtVal(m.valorMeta)}</strong></span>
        <span>Realizado: <strong style="color:${cor};">${fmtVal(r.realizado)}</strong></span>
      </div>
      <div style="height:8px;background:rgba(255,255,255,.6);border-radius:4px;overflow:hidden;margin-bottom:8px;">
        <div style="height:100%;width:${Math.min(100,r.pct)}%;background:${cor};transition:width .4s;"></div>
      </div>
      <!-- BLOCO DE BONUS — sempre visivel, so o valor que ELA recebe -->
      <div style="background:#fff;border:2px solid ${r.atingida?cor:'#E2E8F0'};border-radius:8px;padding:10px 12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
        <div>
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;font-weight:700;">${bonusLbl}</div>
          <div style="font-size:11px;color:#475569;">${r.atingida ? `${r.ultrapassou?'🏆 ULTRAPASSOU — receba já':'🎉 ATINGIDA — receba já'}` : '⏳ Receberá ao bater 100%'}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:9px;color:var(--muted);">${r.atingida ? 'A receber' : 'Vai receber'}</div>
          <div style="font-size:22px;font-weight:900;color:${r.atingida ? '#15803D' : '#1E293B'};">${$c(minha.share)}</div>
        </div>
      </div>
    </div>`;
  }).join('');

  return `
<div class="card" style="margin-top:14px;">
  <div class="card-title">🎯 Minhas Metas</div>
  ${blocos}
</div>`;
}
