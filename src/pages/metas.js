// ── MODULO DE METAS (v2) ──────────────────────────────────────
// Sistema unificado: UMA meta principal por periodo gera AUTOMATICAMENTE
// a distribuicao para os 3 setores (Vendas / Montagem / Expedicao).
//
// Inputs do ADM:
//   - Nome, periodo, datas
//   - Valor total da meta (R$)
//   - Ticket medio (obrigatorio)
//   - Produtos por pedido (default 1)
//   - Ganho desejado por colaborador (sugestao p/ igualar setores)
//
// Auto-calculados (projecao):
//   - Pedidos necessarios = meta / ticket medio
//   - Produtos necessarios = pedidos × produtosPorPedido
//   - Meta por atendente / produtos por montador / pedidos por expedidor
//   - Sugestoes de R$/montagem e R$/expedicao para igualar ganhos
//
// Realizado:
//   - Vendas (vendedorId/createdByColabId em pedidos APROVADOS)
//   - Montagens (montadorId em pedidos com status >= Pronto)
//   - Expedicoes (expedidorId em pedidos Entregue)
//
// Ganho INDIVIDUAL: usa SEMPRE as comissoes do cadastro do colab
//   (comissaoVenda%, comissaoMontagem R$, comissaoExpedicao R$).
//   O "ganho desejado" e apenas uma SUGESTAO para o ADM saber qual
//   valor configurar em cada colab para equilibrar setores.
//
// META EXTRA: bonus % ou R$ fixo, dividido entre atendentes ativas.
//
// Storage: localStorage (fv_metas, fv_metas_extra)
import { S } from '../state.js';
import { $c } from '../utils/formatters.js';
import { toast } from '../utils/helpers.js';
import { getColabs } from '../services/auth.js';

const LS_METAS = 'fv_metas';
const LS_META_EXTRA = 'fv_metas_extra';

// ── STORAGE ──────────────────────────────────────────────────
export function getMetas()      { try { return JSON.parse(localStorage.getItem(LS_METAS) || '[]'); } catch { return []; } }
export function setMetas(arr)   { localStorage.setItem(LS_METAS, JSON.stringify(arr || [])); }
export function getMetasExtra() { try { return JSON.parse(localStorage.getItem(LS_META_EXTRA) || '[]'); } catch { return []; } }
export function setMetasExtra(arr) { localStorage.setItem(LS_META_EXTRA, JSON.stringify(arr || [])); }

// ── PERIODOS ─────────────────────────────────────────────────
export function calcularPeriodo(tipo, dataBase = new Date()) {
  const d = new Date(dataBase); d.setHours(0,0,0,0);
  let inicio, fim;
  if (tipo === 'semanal') {
    const dow = d.getDay();
    inicio = new Date(d); inicio.setDate(d.getDate() - dow);
    fim = new Date(inicio); fim.setDate(inicio.getDate() + 6);
  } else if (tipo === 'quinzenal') {
    if (d.getDate() <= 15) {
      inicio = new Date(d.getFullYear(), d.getMonth(), 1);
      fim    = new Date(d.getFullYear(), d.getMonth(), 15);
    } else {
      inicio = new Date(d.getFullYear(), d.getMonth(), 16);
      fim    = new Date(d.getFullYear(), d.getMonth()+1, 0);
    }
  } else {
    inicio = new Date(d.getFullYear(), d.getMonth(), 1);
    fim    = new Date(d.getFullYear(), d.getMonth()+1, 0);
  }
  fim.setHours(23,59,59,999);
  return { inicio, fim };
}

// ── EQUIPE POR SETOR ─────────────────────────────────────────
// Floricultura enxuta: atendente vende E monta E expede.
// Entregador SEMPRE fica fora de vendas/montagem.
export function getEquipePorSetor(setor) {
  const colabs = getColabs().filter(c => c.active !== false);
  const naoEntregador = c => !String(c.cargo||'').toLowerCase().includes('entregador');
  if (setor === 'vendas') {
    return colabs.filter(c => {
      const car = String(c.cargo||'').toLowerCase();
      return naoEntregador(c) && (car.includes('atend') || car.includes('vend') || car === 'admin' || car === '');
    });
  }
  if (setor === 'montagem')  return colabs.filter(naoEntregador);
  if (setor === 'expedicao') return colabs; // entregadores incluidos aqui
  return colabs;
}

// ── CALCULO PROJECAO (auto-calcs a partir do meta + ticket) ──
export function calcularProjecao(meta) {
  const valorMeta     = Number(meta.valorMeta)    || 0;
  const ticketMedio   = Number(meta.ticketMedio)  || 0;
  const prodPorPedido = Math.max(1, Number(meta.produtosPorPedido) || 1);
  const ganhoDesejado = Number(meta.ganhoDesejado) || 0;

  const pedidosNecessarios  = ticketMedio > 0 ? Math.ceil(valorMeta / ticketMedio) : 0;
  const produtosNecessarios = pedidosNecessarios * prodPorPedido;

  const equipeVendas    = getEquipePorSetor('vendas');
  const equipeMontagem  = getEquipePorSetor('montagem');
  const equipeExpedicao = getEquipePorSetor('expedicao');

  const qtdA = equipeVendas.length    || 1;
  const qtdM = equipeMontagem.length  || 1;
  const qtdE = equipeExpedicao.length || 1;

  const metaPorAtendente    = valorMeta / qtdA;
  const pedidosPorAtendente = Math.ceil(pedidosNecessarios / qtdA);
  const produtosPorMontador = Math.ceil(produtosNecessarios / qtdM);
  const pedidosPorExpedidor = Math.ceil(pedidosNecessarios / qtdE);

  // Sugestoes de pagamento (para igualar ganho ~= ganhoDesejado)
  // Vendas: padrao 1% (regra fixa do enunciado). Mostra tambem
  // quanto cada atendente ganha com 1% sobre a meta dela.
  const sugestaoComissaoVendaPct = 1; // 1% (regra)
  const ganhoAtendente1Pct       = metaPorAtendente * 0.01;
  const sugestaoValorPorMontagem  = produtosPorMontador > 0 ? (ganhoDesejado / produtosPorMontador) : 0;
  const sugestaoValorPorExpedicao = pedidosPorExpedidor > 0 ? (ganhoDesejado / pedidosPorExpedidor) : 0;

  return {
    valorMeta, ticketMedio, prodPorPedido, ganhoDesejado,
    pedidosNecessarios, produtosNecessarios,
    equipeVendas, equipeMontagem, equipeExpedicao,
    qtdA, qtdM, qtdE,
    metaPorAtendente, pedidosPorAtendente,
    produtosPorMontador, pedidosPorExpedidor,
    sugestaoComissaoVendaPct,
    ganhoAtendente1Pct,
    sugestaoValorPorMontagem,
    sugestaoValorPorExpedicao,
  };
}

// ── REALIZADO ────────────────────────────────────────────────
const APROVADOS = new Set(['Aprovado','Pago','aprovado','pago','Pago na Entrega']);

function pedidoNoPeriodo(o, inicio, fim) {
  const raw = o.scheduledDate || o.createdAt; if (!raw) return false;
  const d = new Date(raw); return d >= inicio && d <= fim;
}

// Retorna realizado por setor + por colab. Usa SEMPRE comissao do cadastro.
export function calcularRealizado(meta, ordersList = S.orders) {
  const orders = Array.isArray(ordersList) ? ordersList : [];
  const { inicio, fim } = (meta.dataInicio && meta.dataFim)
    ? { inicio: new Date(meta.dataInicio+'T00:00:00'), fim: new Date(meta.dataFim+'T23:59:59') }
    : calcularPeriodo(meta.periodoTipo || 'mensal');

  // Mapa de comissoes por colab (do cadastro)
  const colabs = getColabs();
  const comById = {};
  for (const c of colabs) {
    const m = c.metas || {};
    comById[String(c._id)] = {
      pctVenda: Number(m.comissaoVenda || m.comissaoPct) || 0,
      porMontagem: Number(m.comissaoMontagem) || 0,
      porExpedicao: Number(m.comissaoExpedicao) || 0,
    };
  }
  const com = id => comById[String(id)] || { pctVenda:0, porMontagem:0, porExpedicao:0 };

  // Acumuladores
  let totalVendido = 0, qtdPedidosAprovados = 0;
  let qtdProdutosMontados = 0, qtdEntregas = 0;
  const porColabVendas    = {}; // { id: { qty, valor, ganho } }
  const porColabMontagem  = {};
  const porColabExpedicao = {};

  for (const o of orders) {
    if (!pedidoNoPeriodo(o, inicio, fim)) continue;
    const itemsQty = (o.items||[]).reduce((s,i) => s + (Number(i.qty)||1), 0) || 1;

    // VENDAS (somente aprovados)
    if (APROVADOS.has(String(o.paymentStatus||''))) {
      const total = Number(o.total) || 0;
      totalVendido += total;
      qtdPedidosAprovados++;
      const id = String(o.vendedorId || o.createdByColabId || o.criadoPor || '');
      if (id) {
        if (!porColabVendas[id]) porColabVendas[id] = { qty:0, valor:0, ganho:0 };
        porColabVendas[id].qty++;
        porColabVendas[id].valor += total;
        porColabVendas[id].ganho += total * (com(id).pctVenda/100);
      }
    }

    // MONTAGENS (status >= Pronto)
    const st = String(o.status||'').toLowerCase();
    const montou = ['pronto','saiu p/ entrega','entregue'].some(x => st.includes(x));
    if (montou) {
      const id = String(o.montadorId||'');
      qtdProdutosMontados += itemsQty;
      if (id) {
        if (!porColabMontagem[id]) porColabMontagem[id] = { qty:0, ganho:0 };
        porColabMontagem[id].qty += itemsQty;
        porColabMontagem[id].ganho += com(id).porMontagem * itemsQty;
      }
    }

    // EXPEDICAO (status Entregue)
    if (st.includes('entregue')) {
      const id = String(o.expedidorId || o.driverColabId || '');
      qtdEntregas++;
      if (id) {
        if (!porColabExpedicao[id]) porColabExpedicao[id] = { qty:0, ganho:0 };
        porColabExpedicao[id].qty++;
        porColabExpedicao[id].ganho += com(id).porExpedicao;
      }
    }
  }

  return {
    inicio, fim,
    totalVendido, qtdPedidosAprovados,
    qtdProdutosMontados, qtdEntregas,
    porColabVendas, porColabMontagem, porColabExpedicao,
    // % atingido sobre a meta principal
    pctMeta: meta.valorMeta ? Math.min(100, (totalVendido/Number(meta.valorMeta))*100) : 0,
  };
}

// ── META EXTRA ──────────────────────────────────────────────
// 2 modos: 'percentual' ou 'valor'. Sempre dividido entre atendentes.
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
  const modo = metaExtra.modo || 'percentual';
  let valorBonus = 0, pctAplicado = 0;
  if (modo === 'valor') {
    valorBonus = Number(metaExtra.valorFixo) || 0;
  } else {
    pctAplicado = Number(metaExtra.percentual) || 0;
    valorBonus = totalVendido * (pctAplicado/100);
  }
  const atendentes = getEquipePorSetor('vendas');
  const valorIndividual = atendentes.length ? (valorBonus / atendentes.length) : 0;
  return { modo, totalVendido, pctAplicado, valorBonus, valorIndividual,
    qtdAtendentes: atendentes.length, atendentes, inicio, fim };
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
    <div style="font-family:'Playfair Display',serif;font-size:22px;color:#9F1239;">🎯 Metas e Bonificações</div>
    <div style="font-size:12px;color:var(--muted);">Meta principal · Auto-distribuição · Meta Extra · Ranking</div>
  </div>
</div>

<div class="tabs" style="margin-bottom:14px;gap:5px;">
  ${subBtn('list',    '📋 Metas')}
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

  return `<div style="display:grid;gap:14px;">
    ${metas.sort((a,b) => (b.createdAt||0) - (a.createdAt||0)).map(m => {
      const p = calcularProjecao(m);
      const r = calcularRealizado(m);
      const cor = r.pctMeta >= 80 ? '#15803D' : r.pctMeta >= 50 ? '#F59E0B' : '#DC2626';

      // Detalhe individual da equipe (vendas)
      const detalheVendas = p.equipeVendas.map(c => {
        const v = r.porColabVendas[String(c._id)] || { qty:0, valor:0, ganho:0 };
        const pct = p.metaPorAtendente ? Math.min(100, (v.valor/p.metaPorAtendente)*100) : 0;
        const cc = pct >= 80 ? '#15803D' : pct >= 50 ? '#F59E0B' : '#DC2626';
        return `<div style="display:flex;align-items:center;gap:8px;font-size:11px;padding:4px 0;">
          <div style="flex:1;font-weight:600;">${escHtml(c.name||'')}</div>
          <div style="width:90px;text-align:right;color:var(--muted);">${$c(v.valor)}</div>
          <div style="width:120px;height:6px;background:#E2E8F0;border-radius:3px;overflow:hidden;">
            <div style="height:100%;width:${pct}%;background:${cc};"></div>
          </div>
          <div style="width:50px;text-align:right;color:${cc};font-weight:700;">${pct.toFixed(0)}%</div>
          <div style="width:80px;text-align:right;color:#15803D;font-weight:700;">${$c(v.ganho)}</div>
        </div>`;
      }).join('');

      const detalheMontagem = p.equipeMontagem.map(c => {
        const v = r.porColabMontagem[String(c._id)] || { qty:0, ganho:0 };
        const pct = p.produtosPorMontador ? Math.min(100, (v.qty/p.produtosPorMontador)*100) : 0;
        const cc = pct >= 80 ? '#15803D' : pct >= 50 ? '#F59E0B' : '#DC2626';
        return `<div style="display:flex;align-items:center;gap:8px;font-size:11px;padding:4px 0;">
          <div style="flex:1;font-weight:600;">${escHtml(c.name||'')}</div>
          <div style="width:90px;text-align:right;color:var(--muted);">${v.qty} prod</div>
          <div style="width:120px;height:6px;background:#E2E8F0;border-radius:3px;overflow:hidden;">
            <div style="height:100%;width:${pct}%;background:${cc};"></div>
          </div>
          <div style="width:50px;text-align:right;color:${cc};font-weight:700;">${pct.toFixed(0)}%</div>
          <div style="width:80px;text-align:right;color:#15803D;font-weight:700;">${$c(v.ganho)}</div>
        </div>`;
      }).join('');

      const detalheExpedicao = p.equipeExpedicao.map(c => {
        const v = r.porColabExpedicao[String(c._id)] || { qty:0, ganho:0 };
        const pct = p.pedidosPorExpedidor ? Math.min(100, (v.qty/p.pedidosPorExpedidor)*100) : 0;
        const cc = pct >= 80 ? '#15803D' : pct >= 50 ? '#F59E0B' : '#DC2626';
        return `<div style="display:flex;align-items:center;gap:8px;font-size:11px;padding:4px 0;">
          <div style="flex:1;font-weight:600;">${escHtml(c.name||'')}</div>
          <div style="width:90px;text-align:right;color:var(--muted);">${v.qty} entregas</div>
          <div style="width:120px;height:6px;background:#E2E8F0;border-radius:3px;overflow:hidden;">
            <div style="height:100%;width:${pct}%;background:${cc};"></div>
          </div>
          <div style="width:50px;text-align:right;color:${cc};font-weight:700;">${pct.toFixed(0)}%</div>
          <div style="width:80px;text-align:right;color:#15803D;font-weight:700;">${$c(v.ganho)}</div>
        </div>`;
      }).join('');

      return `<div class="card" style="border-left:5px solid ${cor};">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px;margin-bottom:12px;">
          <div>
            <div style="font-size:17px;font-weight:800;color:#1E293B;">🎯 ${escHtml(m.nome)}</div>
            <div style="font-size:11px;color:var(--muted);margin-top:2px;">
              ${labelPeriodo(m.periodoTipo)} · ${fmtData(m.dataInicio)} a ${fmtData(m.dataFim)}
            </div>
          </div>
          <div style="display:flex;gap:6px;">
            <button class="btn btn-ghost btn-sm" data-metas-edit="${m.id}">✏️ Editar</button>
            <button class="btn btn-ghost btn-sm" data-metas-del="${m.id}" style="color:#DC2626;">🗑️ Excluir</button>
          </div>
        </div>

        <!-- LINHA 1: Visão geral -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-bottom:12px;">
          <div style="background:#F1F5F9;border-radius:8px;padding:10px;">
            <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Meta total</div>
            <div style="font-size:18px;font-weight:800;color:#1E293B;">${$c(p.valorMeta)}</div>
          </div>
          <div style="background:#EDE9FE;border-radius:8px;padding:10px;">
            <div style="font-size:10px;color:#5B21B6;text-transform:uppercase;">Ticket médio</div>
            <div style="font-size:18px;font-weight:800;color:#5B21B6;">${$c(p.ticketMedio)}</div>
          </div>
          <div style="background:#DBEAFE;border-radius:8px;padding:10px;">
            <div style="font-size:10px;color:#1E40AF;text-transform:uppercase;">Pedidos meta</div>
            <div style="font-size:18px;font-weight:800;color:#1E40AF;">${p.pedidosNecessarios}</div>
          </div>
          <div style="background:#FFE4E6;border-radius:8px;padding:10px;">
            <div style="font-size:10px;color:#9F1239;text-transform:uppercase;">Produtos meta</div>
            <div style="font-size:18px;font-weight:800;color:#9F1239;">${p.produtosNecessarios}</div>
          </div>
          <div style="background:${cor}22;border-radius:8px;padding:10px;text-align:center;">
            <div style="font-size:10px;color:${cor};text-transform:uppercase;">Realizado</div>
            <div style="font-size:14px;font-weight:700;color:${cor};">${$c(r.totalVendido)}</div>
            <div style="font-size:22px;font-weight:900;color:${cor};">${r.pctMeta.toFixed(0)}%</div>
          </div>
        </div>

        <div style="height:10px;background:#E2E8F0;border-radius:5px;overflow:hidden;margin-bottom:14px;">
          <div style="height:100%;width:${r.pctMeta}%;background:${cor};transition:width .4s;"></div>
        </div>

        <!-- LINHA 2: 3 setores lado a lado -->
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;">

          <!-- VENDAS -->
          <div style="background:#FAFAFA;border:1px solid var(--border);border-radius:8px;padding:12px;">
            <div style="font-size:13px;font-weight:800;color:#15803D;margin-bottom:6px;">💰 Vendas (${p.qtdA})</div>
            <div style="font-size:11px;color:var(--muted);line-height:1.6;">
              Meta/atendente: <strong>${$c(p.metaPorAtendente)}</strong><br/>
              Pedidos/atendente: <strong>${p.pedidosPorAtendente}</strong><br/>
              <span style="color:#15803D;">Comissão padrão: 1% (~${$c(p.ganhoAtendente1Pct)})</span>
            </div>
            <details style="margin-top:8px;">
              <summary style="cursor:pointer;font-size:10px;color:var(--muted);font-weight:700;">Ver desempenho</summary>
              <div style="margin-top:6px;">${detalheVendas || '<div style="color:var(--muted);font-size:11px;">Sem equipe</div>'}</div>
            </details>
          </div>

          <!-- MONTAGEM -->
          <div style="background:#FAFAFA;border:1px solid var(--border);border-radius:8px;padding:12px;">
            <div style="font-size:13px;font-weight:800;color:#92400E;margin-bottom:6px;">🌹 Montagem (${p.qtdM})</div>
            <div style="font-size:11px;color:var(--muted);line-height:1.6;">
              Produtos/montador: <strong>${p.produtosPorMontador}</strong><br/>
              ${p.ganhoDesejado > 0 ? `<span style="color:#92400E;">Sugestão: <strong>${$c(p.sugestaoValorPorMontagem)}</strong>/produto<br/>(p/ ganho ${$c(p.ganhoDesejado)})</span>` : '<span style="color:var(--muted);font-size:10px;">Define ganho-alvo p/ ver sugestão</span>'}
            </div>
            <details style="margin-top:8px;">
              <summary style="cursor:pointer;font-size:10px;color:var(--muted);font-weight:700;">Ver desempenho</summary>
              <div style="margin-top:6px;">${detalheMontagem || '<div style="color:var(--muted);font-size:11px;">Sem equipe</div>'}</div>
            </details>
          </div>

          <!-- EXPEDICAO -->
          <div style="background:#FAFAFA;border:1px solid var(--border);border-radius:8px;padding:12px;">
            <div style="font-size:13px;font-weight:800;color:#1E40AF;margin-bottom:6px;">🚚 Expedição (${p.qtdE})</div>
            <div style="font-size:11px;color:var(--muted);line-height:1.6;">
              Pedidos/entregador: <strong>${p.pedidosPorExpedidor}</strong><br/>
              ${p.ganhoDesejado > 0 ? `<span style="color:#1E40AF;">Sugestão: <strong>${$c(p.sugestaoValorPorExpedicao)}</strong>/entrega<br/>(p/ ganho ${$c(p.ganhoDesejado)})</span>` : '<span style="color:var(--muted);font-size:10px;">Define ganho-alvo p/ ver sugestão</span>'}
            </div>
            <details style="margin-top:8px;">
              <summary style="cursor:pointer;font-size:10px;color:var(--muted);font-weight:700;">Ver desempenho</summary>
              <div style="margin-top:6px;">${detalheExpedicao || '<div style="color:var(--muted);font-size:11px;">Sem equipe</div>'}</div>
            </details>
          </div>
        </div>

        <div style="margin-top:10px;font-size:11px;color:var(--muted);background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;padding:8px 12px;">
          ℹ️ Os ganhos individuais usam a comissão configurada no <strong>cadastro de cada colaborador</strong> (% venda, R$/montagem, R$/expedição). As "sugestões" mostram o valor ideal para igualar os ganhos entre setores.
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

// ─── B) NOVA META (ou EDITAR) ────────────────────────────────
function renderMetasNova() {
  const editId = S._metasEditId || '';
  const meta = editId ? getMetas().find(m => m.id === editId) || {} : {};
  const isEdit = !!meta.id;

  // Preview live (S._metaDraft) — atualizado pelo input listener
  const draft = isEdit ? meta : (S._metaDraft || {});
  const previewProj = (Number(draft.valorMeta)>0 && Number(draft.ticketMedio)>0)
    ? calcularProjecao(draft) : null;

  return `<div class="card">
    <div class="card-title">${isEdit ? '✏️ Editar Meta' : '➕ Nova Meta'}</div>

    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;">
      <div class="fg" style="grid-column:span 2;">
        <label class="fl">Nome da meta</label>
        <input type="text" class="fi" id="meta-nome" value="${escHtml(draft.nome||'')}" placeholder="Ex: Meta semanal Mai/2026"/>
      </div>

      <div class="fg">
        <label class="fl">Período</label>
        <select class="fi" id="meta-periodo-tipo">
          <option value="semanal"   ${draft.periodoTipo==='semanal'  ?'selected':''}>Semanal</option>
          <option value="quinzenal" ${draft.periodoTipo==='quinzenal'?'selected':''}>Quinzenal</option>
          <option value="mensal"    ${(draft.periodoTipo||'mensal')==='mensal'?'selected':''}>Mensal</option>
        </select>
      </div>
      <div class="fg">
        <label class="fl">Data início</label>
        <input type="date" class="fi" id="meta-data-inicio" value="${draft.dataInicio||''}"/>
      </div>
      <div class="fg">
        <label class="fl">Data fim</label>
        <input type="date" class="fi" id="meta-data-fim" value="${draft.dataFim||''}"/>
      </div>

      <div class="fg" style="grid-column:span 2;">
        <label class="fl">💰 Valor total da meta (R$)</label>
        <input type="number" class="fi" id="meta-valor" min="0" step="0.01" value="${draft.valorMeta||''}" placeholder="Ex: 150000"/>
      </div>

      <div class="fg">
        <label class="fl">📊 Ticket médio (R$) <span style="color:#DC2626;">*</span></label>
        <input type="number" class="fi" id="meta-ticket" min="0" step="0.01" value="${draft.ticketMedio||''}" placeholder="Ex: 189.90"/>
        <div style="font-size:10px;color:var(--muted);margin-top:3px;">Obrigatório — usado para calcular pedidos necessários</div>
      </div>
      <div class="fg">
        <label class="fl">🌹 Produtos por pedido (média)</label>
        <input type="number" class="fi" id="meta-prodped" min="1" step="0.1" value="${draft.produtosPorPedido||1}" placeholder="1"/>
        <div style="font-size:10px;color:var(--muted);margin-top:3px;">Default 1. Use 1.5 se cada pedido tem em média 1.5 produtos</div>
      </div>

      <div class="fg" style="grid-column:span 2;">
        <label class="fl">🎁 Ganho desejado por colaborador (R$) <span style="color:var(--muted);font-weight:400;font-size:11px;">opcional — usado para sugerir valores de comissão</span></label>
        <input type="number" class="fi" id="meta-ganho" min="0" step="0.01" value="${draft.ganhoDesejado||''}" placeholder="Ex: 300"/>
        <div style="font-size:10px;color:var(--muted);margin-top:3px;">O sistema sugere quanto pagar por montagem e expedição para cada colab ganhar ~este valor</div>
      </div>
    </div>

    ${previewProj ? `
      <div style="margin-top:14px;background:linear-gradient(135deg,#FAE8E6,#FFF7F5);border:1px solid #FECDD3;border-radius:10px;padding:14px;">
        <div style="font-size:12px;font-weight:800;color:#9F1239;text-transform:uppercase;margin-bottom:10px;">📊 Projeção Automática</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;font-size:12px;">
          <div><div style="color:var(--muted);font-size:10px;text-transform:uppercase;">Pedidos necessários</div><div style="font-weight:800;font-size:18px;color:#1E40AF;">${previewProj.pedidosNecessarios}</div></div>
          <div><div style="color:var(--muted);font-size:10px;text-transform:uppercase;">Produtos a montar</div><div style="font-weight:800;font-size:18px;color:#9F1239;">${previewProj.produtosNecessarios}</div></div>
          <div><div style="color:var(--muted);font-size:10px;text-transform:uppercase;">Meta/atendente</div><div style="font-weight:800;font-size:14px;color:#15803D;">${$c(previewProj.metaPorAtendente)}</div><div style="font-size:9px;color:var(--muted);">${previewProj.qtdA} atendente(s)</div></div>
          <div><div style="color:var(--muted);font-size:10px;text-transform:uppercase;">Produtos/montador</div><div style="font-weight:800;font-size:14px;color:#92400E;">${previewProj.produtosPorMontador}</div><div style="font-size:9px;color:var(--muted);">${previewProj.qtdM} montador(es)</div></div>
          <div><div style="color:var(--muted);font-size:10px;text-transform:uppercase;">Pedidos/entregador</div><div style="font-weight:800;font-size:14px;color:#1E40AF;">${previewProj.pedidosPorExpedidor}</div><div style="font-size:9px;color:var(--muted);">${previewProj.qtdE} entregador(es)</div></div>
        </div>
        ${previewProj.ganhoDesejado > 0 ? `
          <div style="margin-top:12px;padding-top:10px;border-top:1px dashed #FECDD3;">
            <div style="font-size:11px;color:#9F1239;font-weight:700;margin-bottom:6px;">🎁 Sugestões para ganho de ${$c(previewProj.ganhoDesejado)} por colaborador:</div>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;font-size:11px;">
              <div style="background:#fff;border-radius:6px;padding:8px;text-align:center;">
                <div style="color:var(--muted);font-size:10px;">💰 Comissão Vendas</div>
                <div style="font-weight:800;color:#15803D;font-size:14px;">1%</div>
                <div style="font-size:10px;color:var(--muted);">≈ ${$c(previewProj.ganhoAtendente1Pct)} por atendente</div>
              </div>
              <div style="background:#fff;border-radius:6px;padding:8px;text-align:center;">
                <div style="color:var(--muted);font-size:10px;">🌹 R$/Montagem</div>
                <div style="font-weight:800;color:#92400E;font-size:14px;">${$c(previewProj.sugestaoValorPorMontagem)}</div>
                <div style="font-size:10px;color:var(--muted);">por produto</div>
              </div>
              <div style="background:#fff;border-radius:6px;padding:8px;text-align:center;">
                <div style="color:var(--muted);font-size:10px;">🚚 R$/Expedição</div>
                <div style="font-weight:800;color:#1E40AF;font-size:14px;">${$c(previewProj.sugestaoValorPorExpedicao)}</div>
                <div style="font-size:10px;color:var(--muted);">por entrega</div>
              </div>
            </div>
            <div style="font-size:10px;color:var(--muted);margin-top:6px;font-style:italic;">⚠️ Configure os valores em <strong>Colaboradores → editar colab</strong>. O sistema usa SEMPRE o valor cadastrado em cada colab.</div>
          </div>
        ` : ''}
      </div>
    ` : `
      <div style="margin-top:14px;font-size:12px;color:var(--muted);text-align:center;padding:14px;background:#FAFAFA;border-radius:8px;">
        💡 Preencha <strong>Valor da meta</strong> e <strong>Ticket médio</strong> para ver a projeção automática.
      </div>
    `}

    <div style="display:flex;gap:8px;margin-top:14px;">
      <button class="btn btn-primary" id="btn-meta-save">${isEdit?'💾 Salvar alterações':'➕ Criar meta'}</button>
      <button class="btn btn-ghost" id="btn-meta-cancel">Cancelar</button>
    </div>
  </div>`;
}

// ─── C) META EXTRA ───────────────────────────────────────────
function renderMetasExtra() {
  const extras = getMetasExtra();
  const modo = S._extraModo || 'percentual';
  const modoBtn = (k, label) => `<button type="button" class="btn btn-sm ${modo===k?'btn-primary':'btn-ghost'}" data-extra-modo="${k}">${label}</button>`;

  return `
<div class="card" style="margin-bottom:14px;background:linear-gradient(135deg,#FEF3C7,#FFFBEB);border:2px solid #FCD34D;">
  <div style="display:flex;align-items:center;gap:10px;">
    <span style="font-size:32px;">🌟</span>
    <div>
      <div style="font-family:'Playfair Display',serif;font-size:18px;color:#92400E;">Meta Extra — Bônus</div>
      <div style="font-size:12px;color:#92400E;opacity:.8;">% sobre vendas ou valor R$ fixo. Dividido <strong>igualmente</strong> entre atendentes ativas.</div>
    </div>
  </div>
</div>

<div class="card" style="margin-bottom:14px;">
  <div class="card-title">➕ Nova Meta Extra</div>
  <div style="margin-bottom:14px;">
    <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:6px;">Tipo</div>
    <div style="display:flex;gap:6px;">
      ${modoBtn('percentual', '📊 Percentual (%)')}
      ${modoBtn('valor',      '💵 Valor fixo (R$)')}
    </div>
  </div>

  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;">
    <div class="fg" style="grid-column:span 2;">
      <label class="fl">Nome</label>
      <input type="text" class="fi" id="extra-nome" placeholder="Ex: Bônus Dia das Mães"/>
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
      <label class="fl">${modo==='percentual'?'Percentual (%)':'Valor fixo (R$)'}</label>
      ${modo==='percentual'
        ? `<input type="number" class="fi" id="extra-pct" min="0.01" max="100" step="0.01" placeholder="Ex: 1.5"/>`
        : `<input type="number" class="fi" id="extra-valor-fixo" min="0.01" step="0.01" placeholder="Ex: 5000"/>`}
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
<div class="card" style="text-align:center;padding:30px;color:var(--muted);"><p>Nenhuma Meta Extra cadastrada.</p></div>
` : `
<div style="display:grid;gap:10px;">
  ${extras.sort((a,b) => (b.createdAt||0) - (a.createdAt||0)).map(e => {
    const r = calcularMetaExtra(e);
    const modoLabel = r.modo==='valor' ? `💵 R$ fixo` : `📊 ${r.pctAplicado}% sobre vendas`;
    return `<div class="card" style="border-left:5px solid #F59E0B;background:#FFFBEB;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px;margin-bottom:10px;">
        <div>
          <div style="font-size:16px;font-weight:800;color:#92400E;">🌟 ${escHtml(e.nome)}</div>
          <div style="font-size:11px;color:#92400E;opacity:.8;">${modoLabel} · ${labelPeriodo(e.periodoTipo)} · ${fmtData(e.dataInicio)} a ${fmtData(e.dataFim)}</div>
        </div>
        <button class="btn btn-ghost btn-sm" data-extra-del="${e.id}" style="color:#DC2626;">🗑️ Excluir</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;">
        <div style="background:#fff;border-radius:8px;padding:10px;border:1px solid #FCD34D;">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Vendido</div>
          <div style="font-size:15px;font-weight:800;color:#92400E;">${$c(r.totalVendido)}</div>
        </div>
        <div style="background:#fff;border-radius:8px;padding:10px;border:1px solid #FCD34D;">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Bônus total</div>
          <div style="font-size:15px;font-weight:800;color:#15803D;">${$c(r.valorBonus)}</div>
        </div>
        <div style="background:#fff;border-radius:8px;padding:10px;border:1px solid #FCD34D;">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Atendentes</div>
          <div style="font-size:15px;font-weight:800;">${r.qtdAtendentes}</div>
        </div>
        <div style="background:#15803D;border-radius:8px;padding:10px;color:#fff;">
          <div style="font-size:10px;text-transform:uppercase;opacity:.85;">Cada uma recebe</div>
          <div style="font-size:18px;font-weight:900;">${$c(r.valorIndividual)}</div>
        </div>
      </div>
      <details style="margin-top:8px;">
        <summary style="cursor:pointer;font-size:11px;color:#92400E;font-weight:700;">Ver atendentes (${r.qtdAtendentes})</summary>
        <div style="margin-top:6px;display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:6px;">
          ${r.atendentes.map(c => `<div style="background:#fff;border:1px solid #FCD34D;border-radius:6px;padding:6px 10px;font-size:11px;display:flex;justify-content:space-between;">
            <span>👤 ${escHtml(c.name||'')}</span>
            <span style="color:#15803D;font-weight:800;">${$c(r.valorIndividual)}</span>
          </div>`).join('')}
        </div>
      </details>
    </div>`;
  }).join('')}
</div>`}`;
}

// ─── D) RANKING ──────────────────────────────────────────────
function renderMetasRanking() {
  const setor = S._metasRankingSetor || 'vendas';
  const metas = getMetas();
  if (!metas.length) {
    return `<div class="card" style="text-align:center;padding:40px;color:var(--muted);">
      <div style="font-size:48px;margin-bottom:12px;">🏆</div>
      <p>Sem metas cadastradas. Crie uma meta para gerar o ranking.</p>
    </div>`;
  }

  const equipe = getEquipePorSetor(setor);
  // Agrega de TODAS as metas
  const totaisCol = {};
  let metaIndividualSetor = 0;
  for (const m of metas) {
    const p = calcularProjecao(m);
    const r = calcularRealizado(m);
    if (setor === 'vendas')    metaIndividualSetor += p.metaPorAtendente;
    if (setor === 'montagem')  metaIndividualSetor += p.produtosPorMontador;
    if (setor === 'expedicao') metaIndividualSetor += p.pedidosPorExpedidor;
    const fonte = setor === 'vendas' ? r.porColabVendas
                : setor === 'montagem' ? r.porColabMontagem
                : r.porColabExpedicao;
    for (const id of Object.keys(fonte)) {
      if (!totaisCol[id]) totaisCol[id] = { qty:0, valor:0, ganho:0 };
      totaisCol[id].qty   += fonte[id].qty   || 0;
      totaisCol[id].valor += fonte[id].valor || 0;
      totaisCol[id].ganho += fonte[id].ganho || 0;
    }
  }

  const ranking = equipe.map(c => {
    const v = totaisCol[String(c._id)] || { qty:0, valor:0, ganho:0 };
    const realizado = setor === 'vendas' ? v.valor : v.qty;
    const pct = metaIndividualSetor ? Math.min(100, (realizado/metaIndividualSetor)*100) : 0;
    return { c, realizado, qty:v.qty, valor:v.valor, ganho:v.ganho, pct };
  }).sort((a,b) => b.pct - a.pct || b.realizado - a.realizado);

  const setorMeta = { vendas:'💰 Vendas', montagem:'🌹 Montagem', expedicao:'🚚 Expedição' }[setor];
  const unit = setor === 'vendas' ? 'R$' : 'un';

  return `
<div class="card" style="margin-bottom:14px;">
  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
    <div style="font-weight:700;color:var(--ink);">Setor:</div>
    ${[
      {k:'vendas',l:'💰 Vendas'},
      {k:'montagem',l:'🌹 Montagem'},
      {k:'expedicao',l:'🚚 Expedição'},
    ].map(s => `<button class="btn btn-sm ${setor===s.k?'btn-primary':'btn-ghost'}" data-metas-rank="${s.k}">${s.l}</button>`).join('')}
    <div style="margin-left:auto;font-size:11px;color:var(--muted);">${setorMeta} · ${metas.length} meta(s) · ${equipe.length} colaborador(es)</div>
  </div>
</div>

${ranking.length === 0 ? `
<div class="card" style="text-align:center;padding:40px;color:var(--muted);">
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
          <div style="font-size:11px;color:var(--muted);">${escHtml(r.c.cargo||'—')} · ${unit==='R$'?$c(r.realizado):(r.realizado+' '+(setor==='montagem'?'produtos':'entregas'))}</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:12px;color:var(--muted);">Ganho</div>
          <div style="font-size:14px;font-weight:800;color:#15803D;">${$c(r.ganho)}</div>
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

// ── HELPERS ──────────────────────────────────────────────────
function escHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fmtData(iso) { if (!iso) return '—'; const [y,m,d] = iso.split('-'); return `${d}/${m}/${y}`; }
function labelPeriodo(p) { return { semanal:'Semanal', quinzenal:'Quinzenal', mensal:'Mensal' }[p] || p; }

// ── BINDINGS ─────────────────────────────────────────────────
export function bindMetasEvents() {
  const render = () => import('../main.js').then(m => m.render()).catch(()=>{});

  // Sub-abas
  document.querySelectorAll('[data-metas-sub]').forEach(b => {
    b.addEventListener('click', () => {
      S._metasSub = b.dataset.metasSub;
      if (S._metasSub !== 'nova') { S._metasEditId = null; S._metaDraft = null; }
      render();
    });
  });

  // Live preview do form Nova Meta — atualiza S._metaDraft a cada input
  const _atualizaDraft = () => {
    S._metaDraft = {
      nome:        document.getElementById('meta-nome')?.value || '',
      periodoTipo: document.getElementById('meta-periodo-tipo')?.value || 'mensal',
      dataInicio:  document.getElementById('meta-data-inicio')?.value || '',
      dataFim:     document.getElementById('meta-data-fim')?.value || '',
      valorMeta:   Number(document.getElementById('meta-valor')?.value) || 0,
      ticketMedio: Number(document.getElementById('meta-ticket')?.value) || 0,
      produtosPorPedido: Number(document.getElementById('meta-prodped')?.value) || 1,
      ganhoDesejado: Number(document.getElementById('meta-ganho')?.value) || 0,
    };
    render();
  };
  ['meta-valor','meta-ticket','meta-prodped','meta-ganho'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', _atualizaDraft);
      el.addEventListener('blur', _atualizaDraft);
    }
  });

  // Salvar meta
  document.getElementById('btn-meta-save')?.addEventListener('click', () => {
    const nome        = document.getElementById('meta-nome')?.value.trim();
    const periodoTipo = document.getElementById('meta-periodo-tipo')?.value;
    const dataInicio  = document.getElementById('meta-data-inicio')?.value;
    const dataFim     = document.getElementById('meta-data-fim')?.value;
    const valorMeta   = Number(document.getElementById('meta-valor')?.value) || 0;
    const ticketMedio = Number(document.getElementById('meta-ticket')?.value) || 0;
    const produtosPorPedido = Number(document.getElementById('meta-prodped')?.value) || 1;
    const ganhoDesejado = Number(document.getElementById('meta-ganho')?.value) || 0;

    // Validacoes (regras de negocio do enunciado)
    if (!nome) { toast('Informe o nome da meta', true); return; }
    if (!dataInicio || !dataFim) { toast('Defina período (datas início e fim)', true); return; }
    if (dataInicio > dataFim) { toast('Data inicial maior que final', true); return; }
    if (!valorMeta || valorMeta <= 0) { toast('Valor da meta deve ser > 0', true); return; }
    if (!ticketMedio || ticketMedio <= 0) { toast('Ticket médio é obrigatório', true); return; }
    if (!getEquipePorSetor('vendas').length) { toast('Não há atendentes ativos', true); return; }

    const metas = getMetas();
    const editId = S._metasEditId;
    const payload = { nome, periodoTipo, dataInicio, dataFim, valorMeta, ticketMedio, produtosPorPedido, ganhoDesejado };

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
    S._metasEditId = null; S._metasSub = 'list'; S._metaDraft = null;
    render();
  });

  document.getElementById('btn-meta-cancel')?.addEventListener('click', () => {
    S._metasEditId = null; S._metasSub = 'list'; S._metaDraft = null;
    render();
  });

  document.querySelectorAll('[data-metas-edit]').forEach(b => {
    b.addEventListener('click', () => {
      S._metasEditId = b.dataset.metasEdit; S._metasSub = 'nova'; S._metaDraft = null;
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

  // Meta Extra
  document.querySelectorAll('[data-extra-modo]').forEach(b => {
    b.addEventListener('click', () => { S._extraModo = b.dataset.extraModo; render(); });
  });
  document.getElementById('btn-extra-save')?.addEventListener('click', () => {
    const modo = S._extraModo || 'percentual';
    const nome = document.getElementById('extra-nome')?.value.trim();
    const periodoTipo = document.getElementById('extra-periodo-tipo')?.value;
    const dataInicio = document.getElementById('extra-data-inicio')?.value;
    const dataFim = document.getElementById('extra-data-fim')?.value;
    if (!nome) { toast('Informe o nome', true); return; }
    if (!dataInicio || !dataFim) { toast('Defina período', true); return; }
    if (dataInicio > dataFim) { toast('Data inicial maior que final', true); return; }
    if (!getEquipePorSetor('vendas').length) { toast('Sem atendentes ativas', true); return; }

    const payload = { id:'mx_'+Date.now()+'_'+Math.random().toString(36).slice(2,7),
      nome, modo, periodoTipo, dataInicio, dataFim, createdAt: Date.now() };
    if (modo === 'percentual') {
      const pct = Number(document.getElementById('extra-pct')?.value) || 0;
      if (!pct || pct <= 0 || pct > 100) { toast('Percentual inválido (0,01 a 100)', true); return; }
      payload.percentual = pct;
    } else {
      const v = Number(document.getElementById('extra-valor-fixo')?.value) || 0;
      if (!v || v <= 0) { toast('Valor fixo deve ser > 0', true); return; }
      payload.valorFixo = v;
    }
    setMetasExtra([...getMetasExtra(), payload]);
    toast('🌟 Meta Extra criada');
    S._extraModo = 'percentual';
    render();
  });
  document.querySelectorAll('[data-extra-del]').forEach(b => {
    b.addEventListener('click', () => {
      if (!confirm('Excluir esta Meta Extra?')) return;
      setMetasExtra(getMetasExtra().filter(e => e.id !== b.dataset.extraDel));
      toast('🗑️ Meta Extra excluída');
      render();
    });
  });

  // Ranking
  document.querySelectorAll('[data-metas-rank]').forEach(b => {
    b.addEventListener('click', () => { S._metasRankingSetor = b.dataset.metasRank; render(); });
  });
}

// ─── VIEW ATENDENTE (Meu Painel) ─────────────────────────────
export function renderMetasParaAtendente(user, ordersList = S.orders) {
  const metas = getMetas();
  const extras = getMetasExtra();
  const myId = String(user?._id || user?.id || '');
  if (!metas.length && !extras.length) return '';

  // Para cada meta, identificar em quais setores ele participa
  const blocosMeta = metas.map(m => {
    const p = calcularProjecao(m);
    const r = calcularRealizado(m, ordersList);
    const ehAtendente  = p.equipeVendas.some(c => String(c._id) === myId);
    const ehMontador   = p.equipeMontagem.some(c => String(c._id) === myId);
    const ehExpedidor  = p.equipeExpedicao.some(c => String(c._id) === myId);
    if (!ehAtendente && !ehMontador && !ehExpedidor) return '';

    const linhaSetor = (label, cor, realizado, metaInd, unitSuf, ganho) => {
      const pct = metaInd ? Math.min(100, (realizado/metaInd)*100) : 0;
      const cc = pct >= 80 ? '#15803D' : pct >= 50 ? '#F59E0B' : '#DC2626';
      return `<div style="margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:4px;">
          <span style="font-size:12px;font-weight:700;color:${cor};">${label}</span>
          <span style="font-size:11px;color:var(--muted);">${realizado}${unitSuf} de <strong>${metaInd}${unitSuf}</strong> · Ganho: <strong style="color:#15803D;">${$c(ganho)}</strong> · <strong style="color:${cc};">${pct.toFixed(0)}%</strong></span>
        </div>
        <div style="height:8px;background:#E2E8F0;border-radius:4px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:${cc};transition:width .4s;"></div>
        </div>
      </div>`;
    };

    let linhas = '';
    if (ehAtendente) {
      const v = r.porColabVendas[myId] || { valor:0, ganho:0 };
      linhas += linhaSetor('💰 Vendas', '#15803D', Math.round(v.valor), Math.round(p.metaPorAtendente), ' R$', v.ganho);
    }
    if (ehMontador) {
      const v = r.porColabMontagem[myId] || { qty:0, ganho:0 };
      linhas += linhaSetor('🌹 Montagem', '#92400E', v.qty, p.produtosPorMontador, ' prod', v.ganho);
    }
    if (ehExpedidor) {
      const v = r.porColabExpedicao[myId] || { qty:0, ganho:0 };
      linhas += linhaSetor('🚚 Expedição', '#1E40AF', v.qty, p.pedidosPorExpedidor, ' entregas', v.ganho);
    }

    return `<div style="margin-bottom:12px;padding:12px;background:#FAFAFA;border-radius:8px;border-left:4px solid var(--rose);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <div>
          <div style="font-size:13px;font-weight:800;color:#1E293B;">🎯 ${escHtml(m.nome)}</div>
          <div style="font-size:10px;color:var(--muted);">${labelPeriodo(m.periodoTipo)} · ${fmtData(m.dataInicio)} a ${fmtData(m.dataFim)}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:10px;color:var(--muted);">Equipe atingiu</div>
          <div style="font-size:18px;font-weight:900;color:${r.pctMeta>=80?'#15803D':r.pctMeta>=50?'#F59E0B':'#DC2626'};">${r.pctMeta.toFixed(0)}%</div>
        </div>
      </div>
      ${linhas}
    </div>`;
  }).join('');

  // Meta Extras
  const blocosExtra = extras.map(e => {
    const r = calcularMetaExtra(e, ordersList);
    if (!r.atendentes.some(c => String(c._id) === myId)) return '';
    const modoLbl = r.modo==='valor' ? `R$ fixo` : `${r.pctAplicado}% sobre vendas`;
    return `<div style="margin-top:8px;padding:14px;background:linear-gradient(135deg,#FEF3C7,#FFFBEB);border:2px solid #FCD34D;border-radius:10px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
        <div>
          <div style="font-size:14px;font-weight:800;color:#92400E;">🌟 ${escHtml(e.nome)}</div>
          <div style="font-size:10px;color:#92400E;opacity:.8;">${modoLbl} · ${fmtData(e.dataInicio)} a ${fmtData(e.dataFim)}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:10px;color:#92400E;text-transform:uppercase;">Você vai receber</div>
          <div style="font-size:22px;font-weight:900;color:#15803D;">${$c(r.valorIndividual)}</div>
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;font-size:11px;color:#92400E;background:#fff;padding:6px 10px;border-radius:6px;">
        <span>Vendido: <strong>${$c(r.totalVendido)}</strong></span>
        <span>Bônus total: <strong style="color:#15803D;">${$c(r.valorBonus)}</strong></span>
        <span>÷ ${r.qtdAtendentes} atendentes</span>
      </div>
    </div>`;
  }).join('');

  if (!blocosMeta && !blocosExtra) return '';

  return `
<div class="card" style="margin-top:14px;">
  <div class="card-title">🎯 Minhas Metas</div>
  ${blocosMeta || `<div style="color:var(--muted);font-size:12px;padding:12px;text-align:center;">Nenhuma meta ativa para você no momento.</div>`}
  ${blocosExtra ? `<div style="margin-top:14px;font-size:11px;font-weight:700;color:#92400E;text-transform:uppercase;letter-spacing:1px;">🌟 Meta Extra (Bônus)</div>${blocosExtra}` : ''}
</div>`;
}
