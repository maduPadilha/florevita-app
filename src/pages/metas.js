// ── MODULO METAS (v3) ────────────────────────────────────────
// Metas individuais — uma meta por colab por periodo.
//
// ADM define:
//   - Colaborador alvo (1 colab)
//   - Periodo: Mensal ou Semanal + datas inicio/fim
//   - Tipo: Vendas (R$) | Produção (qtd produtos montados) | Expedição (qtd entregas)
//   - Valor da meta (numero — R$ para vendas, qtd para outros)
//   - Modo do bonus: Individual (valor pago a essa colab) ou Equipe (valor dividido entre todas que bateram)
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
  return colabs;
}

// ── CALCULO DO REALIZADO ─────────────────────────────────────
export function calcularRealizado(meta, ordersList = S.orders) {
  const orders = Array.isArray(ordersList) ? ordersList : [];
  const { inicio, fim } = (meta.dataInicio && meta.dataFim)
    ? { inicio: new Date(meta.dataInicio+'T00:00:00'), fim: new Date(meta.dataFim+'T23:59:59') }
    : calcularPeriodo(meta.periodoTipo || 'mensal');

  const colab = getColabs().find(c => _colabKey(c) === String(meta.colabId));
  if (!colab) return { realizado:0, pct:0, atingida:false, ultrapassou:false, inicio, fim };

  let realizado = 0;
  for (const o of orders) {
    const dRaw = o.scheduledDate || o.createdAt; if (!dRaw) continue;
    const d = new Date(dRaw); if (d < inicio || d > fim) continue;

    if (meta.tipo === 'vendas') {
      if (!_PG_APROV.has(String(o.paymentStatus||''))) continue;
      const ehMinha = _isMine(colab, o.vendedorId, o.vendedorEmail) ||
        (!o.vendedorId && _isMine(colab, o.createdByColabId, o.createdByEmail, o.criadoPor, o.createdBy, o.createdByName));
      if (ehMinha) realizado += Number(o.total) || 0;
    }
    else if (meta.tipo === 'producao') {
      const st = String(o.status||'').toLowerCase();
      if (!['pronto','saiu p/ entrega','entregue'].some(x => st.includes(x))) continue;
      if (_isMine(colab, o.montadorId, o.montadorEmail, o.montadorNome)) {
        const qty = (o.items||[]).reduce((s,i)=>s+(Number(i.qty)||1), 0) || 1;
        realizado += qty;
      }
    }
    else if (meta.tipo === 'expedicao') {
      const st = String(o.status||'').toLowerCase();
      if (!st.includes('entregue')) continue;
      if (_isMine(colab, o.expedidorId, o.expedidorEmail, o.driverColabId, o.driverName)) realizado += 1;
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

  // Agrupa por colab para exibir em cards organizados
  const byColab = {};
  metas.forEach(m => {
    if (!byColab[m.colabId]) byColab[m.colabId] = [];
    byColab[m.colabId].push(m);
  });

  return `<div style="display:grid;gap:14px;">
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
        <div style="display:grid;gap:10px;">
          ${lista.sort((a,b) => (b.createdAt||0) - (a.createdAt||0)).map(m => {
            const r = calcularRealizado(m);
            const cor    = pctCor(r.pct);
            const corBg  = pctBg(r.pct);
            const status = pctStatus(r.pct);
            const tipoLabel = labelTipo(m.tipo);
            const unit = m.tipo === 'vendas' ? 'R$' : 'un';
            const fmtVal = v => unit==='R$' ? $c(v) : `${Math.round(v)} ${m.tipo==='producao'?'produtos':'entregas'}`;
            const bonusLbl = m.bonusModo === 'individual'
              ? `Bônus individual: <strong>${$c(m.bonusValor)}</strong>`
              : `Bônus de equipe: <strong>${$c(m.bonusValor)}</strong> dividido com quem bater`;
            return `<div style="background:${corBg};border-left:5px solid ${cor};border-radius:8px;padding:12px;">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px;margin-bottom:8px;">
                <div>
                  <div style="font-size:14px;font-weight:800;color:#1E293B;">${tipoLabel} ${status.emoji} ${escHtml(m.nome||'')}</div>
                  <div style="font-size:11px;color:var(--muted);">${labelPeriodo(m.periodoTipo)} · ${fmtData(m.dataInicio)} a ${fmtData(m.dataFim)} · ${bonusLbl}</div>
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
              <div style="height:10px;background:rgba(255,255,255,.6);border-radius:5px;overflow:hidden;">
                <div style="height:100%;width:${Math.min(100,r.pct)}%;background:${cor};transition:width .4s;"></div>
              </div>
              ${r.atingida ? `<div style="margin-top:8px;padding:8px 10px;background:#fff;border:1px solid ${cor};border-radius:6px;font-size:12px;color:${cor};font-weight:700;text-align:center;">
                ${r.ultrapassou ? '🏆 META ULTRAPASSADA' : '🎉 META ATINGIDA'} — Bônus a receber: <span style="font-size:14px;">${$c(m.bonusValor)}</span>
              </div>` : ''}
            </div>`;
          }).join('')}
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

// ─── NOVA META (form) ───────────────────────────────────────
function renderMetasNova() {
  const editId = S._metasEditId || '';
  const meta = editId ? getMetas().find(m => m.id === editId) || {} : {};
  const isEdit = !!meta.id;
  const tipo = meta.tipo || S._metaTipoDraft || 'vendas';
  const colabsDoTipo = colabsPorTipoMeta(tipo);

  return `<div class="card">
    <div class="card-title">${isEdit ? '✏️ Editar Meta' : '➕ Nova Meta'}</div>

    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;">

      <div class="fg" style="grid-column:span 2;">
        <label class="fl">Nome da meta</label>
        <input type="text" class="fi" id="meta-nome" value="${escHtml(meta.nome||'')}" placeholder="Ex: Meta Vendas Mai/2026"/>
      </div>

      <div class="fg">
        <label class="fl">📊 Tipo de meta</label>
        <select class="fi" id="meta-tipo">
          <option value="vendas"    ${tipo==='vendas'   ?'selected':''}>💰 Vendas (R$)</option>
          <option value="producao"  ${tipo==='producao' ?'selected':''}>🌹 Produção / Montagem (qtd produtos)</option>
          <option value="expedicao" ${tipo==='expedicao'?'selected':''}>🚚 Expedição (qtd entregas)</option>
        </select>
      </div>

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

      <div class="fg" style="grid-column:span 2;">
        <label class="fl">🎯 Valor da meta <span style="color:var(--muted);font-size:11px;">(${tipo==='vendas'?'R$':tipo==='producao'?'produtos':'entregas'})</span></label>
        <input type="number" class="fi" id="meta-valor" min="0" step="${tipo==='vendas'?'0.01':'1'}" value="${meta.valorMeta||''}" placeholder="${tipo==='vendas'?'Ex: 30000':tipo==='producao'?'Ex: 200':'Ex: 100'}"/>
      </div>

      <div class="fg">
        <label class="fl">💎 Modo do bônus</label>
        <select class="fi" id="meta-bonus-modo">
          <option value="individual" ${(meta.bonusModo||'individual')==='individual'?'selected':''}>👤 Individual (paga R$ X só a essa colab)</option>
          <option value="equipe"     ${meta.bonusModo==='equipe'?'selected':''}>👥 Equipe (R$ X dividido com todas que baterem)</option>
        </select>
      </div>

      <div class="fg">
        <label class="fl">💰 Valor do bônus (R$)</label>
        <input type="number" class="fi" id="meta-bonus-valor" min="0" step="0.01" value="${meta.bonusValor||''}" placeholder="Ex: 500"/>
      </div>

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

  // Calcula realizado de todas
  const items = metas.map(m => {
    const r = calcularRealizado(m);
    const colab = getColabs().find(c => _colabKey(c) === String(m.colabId));
    return { meta: m, r, colab };
  }).filter(it => it.colab);

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
function labelTipo(t) { return { vendas:'💰 Vendas', producao:'🌹 Produção', expedicao:'🚚 Expedição' }[t] || t; }
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
      if (S._metasSub !== 'nova') S._metasEditId = null;
      render();
    });
  });

  // Trocar tipo no form atualiza a lista de colabs
  document.getElementById('meta-tipo')?.addEventListener('change', e => {
    S._metaTipoDraft = e.target.value;
    render();
  });

  document.getElementById('btn-meta-save')?.addEventListener('click', () => {
    const nome        = document.getElementById('meta-nome')?.value.trim();
    const tipo        = document.getElementById('meta-tipo')?.value;
    const colabId     = document.getElementById('meta-colab')?.value;
    const periodoTipo = document.getElementById('meta-periodo-tipo')?.value;
    const dataInicio  = document.getElementById('meta-data-inicio')?.value;
    const dataFim     = document.getElementById('meta-data-fim')?.value;
    const valorMeta   = Number(document.getElementById('meta-valor')?.value) || 0;
    const bonusModo   = document.getElementById('meta-bonus-modo')?.value;
    const bonusValor  = Number(document.getElementById('meta-bonus-valor')?.value) || 0;
    const visivel     = !!document.getElementById('meta-visivel')?.checked;

    if (!nome)       { toast('Informe o nome da meta', true); return; }
    if (!colabId)    { toast('Selecione uma colaboradora', true); return; }
    if (!dataInicio || !dataFim) { toast('Defina período (datas início e fim)', true); return; }
    if (dataInicio > dataFim) { toast('Data inicial maior que final', true); return; }
    if (!valorMeta || valorMeta <= 0) { toast('Valor da meta deve ser > 0', true); return; }
    if (bonusValor < 0) { toast('Valor do bônus inválido', true); return; }

    const metas = getMetas();
    const editId = S._metasEditId;
    const payload = { nome, tipo, colabId, periodoTipo, dataInicio, dataFim, valorMeta, bonusModo, bonusValor, visivel };
    if (editId) {
      const idx = metas.findIndex(m => m.id === editId);
      if (idx >= 0) {
        metas[idx] = { ...metas[idx], ...payload };
        setMetas(metas);
        toast('✅ Meta atualizada');
      }
    } else {
      metas.push({ id:'mt_'+Date.now()+'_'+Math.random().toString(36).slice(2,7), ...payload, createdAt:Date.now() });
      setMetas(metas);
      toast('✅ Meta criada');
    }
    S._metasEditId = null; S._metasSub = 'list'; S._metaTipoDraft = null;
    render();
  });

  document.getElementById('btn-meta-cancel')?.addEventListener('click', () => {
    S._metasEditId = null; S._metasSub = 'list'; S._metaTipoDraft = null;
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
// Cada colab ve apenas as proprias metas que o ADM marcou como
// VISIVEL (m.visivel === true). Enquanto o ADM nao publica, a meta
// fica privada — so o ADM ve no modulo Metas.
export function renderMetasParaAtendente(user, ordersList = S.orders) {
  const myKey = String(user?._id || user?.id || '');
  const metas = getMetas().filter(m => String(m.colabId) === myKey && m.visivel === true);
  if (!metas.length) return '';

  const blocos = metas.map(m => {
    const r = calcularRealizado(m, ordersList);
    const cor = pctCor(r.pct);
    const corBg = pctBg(r.pct);
    const status = pctStatus(r.pct);
    const tipoLbl = labelTipo(m.tipo);
    const unit = m.tipo === 'vendas' ? 'R$' : 'un';
    const fmtVal = v => unit==='R$' ? $c(v) : `${Math.round(v)} ${m.tipo==='producao'?'produtos':'entregas'}`;
    return `<div style="margin-bottom:10px;padding:12px;background:${corBg};border-left:4px solid ${cor};border-radius:8px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
        <div>
          <div style="font-size:13px;font-weight:800;color:#1E293B;">${tipoLbl} ${status.emoji} ${escHtml(m.nome||'')}</div>
          <div style="font-size:10px;color:var(--muted);">${labelPeriodo(m.periodoTipo)} · ${fmtData(m.dataInicio)} a ${fmtData(m.dataFim)}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:18px;font-weight:900;color:${cor};">${r.pct.toFixed(0)}%</div>
          <div style="font-size:9px;color:${cor};font-weight:700;">${status.label}</div>
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-bottom:4px;">
        <span>Meta: <strong>${fmtVal(m.valorMeta)}</strong></span>
        <span>Realizado: <strong style="color:${cor};">${fmtVal(r.realizado)}</strong></span>
      </div>
      <div style="height:8px;background:rgba(255,255,255,.6);border-radius:4px;overflow:hidden;">
        <div style="height:100%;width:${Math.min(100,r.pct)}%;background:${cor};transition:width .4s;"></div>
      </div>
      ${r.atingida ? `<div style="margin-top:8px;padding:6px 10px;background:#fff;border:1px solid ${cor};border-radius:6px;font-size:12px;color:${cor};font-weight:700;text-align:center;">
        ${r.ultrapassou ? '🏆 ULTRAPASSOU' : '🎉 META ATINGIDA'} — Bônus: ${$c(m.bonusValor)}
      </div>` : ''}
    </div>`;
  }).join('');

  return `
<div class="card" style="margin-top:14px;">
  <div class="card-title">🎯 Minhas Metas</div>
  ${blocos}
</div>`;
}
