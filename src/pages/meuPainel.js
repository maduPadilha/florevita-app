// ── MEU PAINEL ────────────────────────────────────────────────
// Pagina pessoal de cada colaborador (Atendimento) — somente leitura.
// Mostra:
//   1. Historico de Pontos (entrada, saida almoco, volta, saida)
//   2. Comissões / vendas atribuídas no mes
import { S } from '../state.js';
import { $c } from '../utils/formatters.js';
import { GET } from '../services/api.js';

// Cache em memoria dos pontos do user (evita refetch a cada render)
let _pontosCache = null;
let _pontosCacheAt = 0;

async function loadPontos(userId) {
  if (_pontosCache && (Date.now() - _pontosCacheAt) < 60_000) return _pontosCache;
  try {
    const r = await GET('/ponto?userId=' + userId + '&limit=60').catch(() => null);
    _pontosCache = Array.isArray(r) ? r : (r?.records || r?.data || []);
    _pontosCacheAt = Date.now();
    return _pontosCache;
  } catch { return []; }
}

// ── HISTORICO DE PEDIDOS DEDICADO (para acumular comissoes meses anteriores)
// S.orders e limitado a 300 mais recentes (cache global); para o Meu Painel
// precisamos de um historico maior para que colaboradoras com volume alto
// vejam comissoes de meses anteriores. Buscamos ate 2000 pedidos uma vez
// por sessao (cache 5min).
let _ordersHistCache = null;
let _ordersHistCacheAt = 0;
async function loadOrdersHistorico() {
  if (_ordersHistCache && (Date.now() - _ordersHistCacheAt) < 5*60_000) return _ordersHistCache;
  try {
    const r = await GET('/orders?limit=2000').catch(() => null);
    _ordersHistCache = Array.isArray(r) ? r : [];
    _ordersHistCacheAt = Date.now();
    return _ordersHistCache;
  } catch { return []; }
}

// Comissão calculada localmente (S.orders ja foi carregado)
// Considera 3 tipos:
//  - Venda: % sobre vendas em que ele e o vendedorId selecionado no PDV
//  - Montagem: R$ fixo por produto montado (status 'Pronto'/'Em preparo' concluido)
//  - Expedicao: R$ fixo por produto expedido (status 'Saiu p/ entrega' ou 'Entregue')
function calcularComissoes(user, ordersOverride) {
  // Usa historico dedicado se disponivel (mais meses), senao S.orders
  const orders = Array.isArray(ordersOverride) && ordersOverride.length
    ? ordersOverride
    : (Array.isArray(S.orders) ? S.orders : []);
  const myEmail = String(user?.email||'').toLowerCase();
  const myId    = String(user?._id||user?.id||'');
  const myColabId = String(user?.colabId||'');

  const APROVADOS = new Set(['Aprovado','Pago','aprovado','pago']);
  const sou = (o, fieldId, fieldEmail) => {
    const e = String(o[fieldEmail]||'').toLowerCase();
    const id = String(o[fieldId]||'');
    return (e && e === myEmail) || id === myId || id === myColabId;
  };

  // Configs do user (vem de metas)
  const m = user?.metas || {};
  const PCT_VENDA   = Number(m.comissaoVenda || m.comissaoPct) || 0;
  const POR_MONTAGEM   = Number(m.comissaoMontagem) || 0;
  const POR_EXPEDICAO  = Number(m.comissaoExpedicao) || 0;

  // Agrupa por mes
  const porMes = {};
  const ensure = (key) => {
    if (!porMes[key]) porMes[key] = {
      vendaCount:0, vendaTotal:0, vendaComissao:0,
      montagemCount:0, montagemComissao:0,
      expedicaoCount:0, expedicaoComissao:0,
    };
    return porMes[key];
  };

  for (const o of orders) {
    const d = new Date(o.createdAt || o.scheduledDate || Date.now());
    const key = d.toISOString().slice(0,7);
    const itensQty = (o.items||[]).reduce((s,i) => s + (Number(i.qty)||1), 0) || 1;

    // VENDA — pedido aprovado e este user e o vendedor escolhido no PDV
    // Fallback para pedidos ANTIGOS (antes do campo vendedor): usa
    // createdByEmail/createdByColabId/criadoPor.
    const ehMinhaVenda = APROVADOS.has(String(o.paymentStatus||'')) && (
      sou(o, 'vendedorId', 'vendedorEmail') ||
      // Pedidos antigos: usa quem criou o pedido (atendente logada na epoca)
      (!o.vendedorId && (
        sou(o, 'createdByColabId', 'createdByEmail') ||
        String(o.criadoPor||'') === myId
      ))
    );
    if (ehMinhaVenda) {
      const total = Number(o.total) || 0;
      const g = ensure(key);
      g.vendaCount++;
      g.vendaTotal += total;
      g.vendaComissao += total * (PCT_VENDA / 100);
    }

    // MONTAGEM — status >= Pronto e este user e o montador
    const st = String(o.status||'').toLowerCase();
    const montou = ['pronto','saiu p/ entrega','entregue'].some(x => st.includes(x));
    if (montou && POR_MONTAGEM > 0 && sou(o, 'montadorId', 'montadorEmail')) {
      const g = ensure(key);
      g.montagemCount += itensQty;
      g.montagemComissao += POR_MONTAGEM * itensQty;
    }

    // EXPEDICAO — status >= Saiu p/ entrega e este user e o expedidor
    const expediu = ['saiu p/ entrega','entregue'].some(x => st.includes(x));
    if (expediu && POR_EXPEDICAO > 0 && sou(o, 'expedidorId', 'expedidorEmail')) {
      const g = ensure(key);
      g.expedicaoCount += itensQty;
      g.expedicaoComissao += POR_EXPEDICAO * itensQty;
    }
  }

  return Object.entries(porMes)
    .sort((a,b) => b[0].localeCompare(a[0]))
    .map(([mes, v]) => ({
      mes,
      ...v,
      total: v.vendaComissao + v.montagemComissao + v.expedicaoComissao,
    }));
}

function fmtMes(yyyymm) {
  const [y, m] = yyyymm.split('-');
  const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  return `${meses[Number(m)-1]} / ${y}`;
}

function fmtData(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('pt-BR', { timeZone: 'America/Manaus', day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
  } catch { return iso; }
}

function fmtHora(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Manaus', hour:'2-digit', minute:'2-digit' });
  } catch { return '—'; }
}

// Agrupa registros (type+date+time) por data, montando entrada/almoco/volta/saida
function agruparPontosPorDia(records) {
  const grupos = {};
  for (const r of records) {
    const data = r.date || (r.createdAt ? r.createdAt.slice(0,10) : '');
    if (!data) continue;
    if (!grupos[data]) grupos[data] = { data, entrada:'', saidaAlmoco:'', voltaAlmoco:'', saida:'' };
    const t = String(r.type||'').toLowerCase();
    const hora = r.time || '';
    if (t.includes('entrada')) grupos[data].entrada = hora;
    else if (t.includes('saida_almoco') || t.includes('saidaalmoco') || (t === 'almoco' && !grupos[data].saidaAlmoco)) grupos[data].saidaAlmoco = hora;
    else if (t.includes('volta_almoco') || t.includes('voltaalmoco') || t === 'volta') grupos[data].voltaAlmoco = hora;
    else if (t.includes('saida')) grupos[data].saida = hora;
  }
  return Object.values(grupos).sort((a,b) => b.data.localeCompare(a.data));
}

export function renderMeuPainel() {
  const u = S.user || {};
  const nome = u.name || u.nome || 'Colaborador';
  const cargo = u.cargo || u.role || '';

  // Dispara carga assincrona dos pontos (re-render quando chega)
  if (!_pontosCache && u._id) {
    loadPontos(u._id).then(() => {
      import('../main.js').then(m => m.render()).catch(()=>{});
    });
  }
  // Dispara carga do historico (ate 2000 pedidos) para acumular meses anteriores
  if (!_ordersHistCache) {
    loadOrdersHistorico().then(() => {
      import('../main.js').then(m => m.render()).catch(()=>{});
    });
  }
  const pontosRaw = _pontosCache || [];
  const pontos = agruparPontosPorDia(pontosRaw);
  const comissoes = calcularComissoes(u, _ordersHistCache);
  const totalAcumulado = comissoes.reduce((s,c) => s + c.total, 0);
  const totalVendaCom  = comissoes.reduce((s,c) => s + c.vendaComissao, 0);
  const totalMontCom   = comissoes.reduce((s,c) => s + c.montagemComissao, 0);
  const totalExpCom    = comissoes.reduce((s,c) => s + c.expedicaoComissao, 0);
  const qtdPedidos     = comissoes.reduce((s,c) => s + c.vendaCount, 0);

  return `
<div class="card" style="background:linear-gradient(135deg,#FAE8E6,#FAF7F5);border:1px solid #FECDD3;margin-bottom:14px;">
  <div style="display:flex;align-items:center;gap:14px;">
    <div style="width:60px;height:60px;border-radius:50%;background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:700;">
      ${nome.charAt(0).toUpperCase()}
    </div>
    <div style="flex:1;">
      <div style="font-family:'Playfair Display',serif;font-size:20px;color:#9F1239;">Olá, ${nome.split(' ')[0]} 🌹</div>
      <div style="font-size:12px;color:var(--muted);">${cargo}</div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;">Comissão acumulada</div>
      <div style="font-size:22px;font-weight:900;color:#15803D;">${$c(totalAcumulado)}</div>
    </div>
  </div>
</div>

<div class="g2" style="gap:14px;">
  <!-- COMISSOES -->
  <div class="card">
    <div class="card-title">💰 Minhas Vendas e Comissões</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:14px;">
      <div style="background:#DCFCE7;border-radius:8px;padding:10px;text-align:center;">
        <div style="font-size:9px;color:#15803D;font-weight:700;text-transform:uppercase;">💰 Vendas (%)</div>
        <div style="font-size:14px;font-weight:900;color:#15803D;">${$c(totalVendaCom)}</div>
        <div style="font-size:9px;color:#15803D;opacity:.7;">${qtdPedidos} pedidos</div>
      </div>
      <div style="background:#FEF3C7;border-radius:8px;padding:10px;text-align:center;">
        <div style="font-size:9px;color:#92400E;font-weight:700;text-transform:uppercase;">🌸 Montagem (R$)</div>
        <div style="font-size:14px;font-weight:900;color:#92400E;">${$c(totalMontCom)}</div>
        <div style="font-size:9px;color:#92400E;opacity:.7;">por produto</div>
      </div>
      <div style="background:#DBEAFE;border-radius:8px;padding:10px;text-align:center;">
        <div style="font-size:9px;color:#1E40AF;font-weight:700;text-transform:uppercase;">📦 Expedição (R$)</div>
        <div style="font-size:14px;font-weight:900;color:#1E40AF;">${$c(totalExpCom)}</div>
        <div style="font-size:9px;color:#1E40AF;opacity:.7;">por produto</div>
      </div>
    </div>
    ${comissoes.length === 0 ? `
      <div style="text-align:center;padding:24px;color:var(--muted);font-size:12px;">
        Nenhuma comissão registrada ainda neste período.
      </div>
    ` : `
    <div style="overflow-x:auto;">
      <table style="width:100%;font-size:12px;border-collapse:collapse;">
        <thead><tr style="background:#FAFAFA;border-bottom:1px solid var(--border);">
          <th style="padding:10px 6px;text-align:left;font-size:10px;color:#94A3B8;text-transform:uppercase;letter-spacing:.5px;">Mês</th>
          <th style="padding:10px 6px;text-align:right;font-size:10px;color:#15803D;text-transform:uppercase;letter-spacing:.5px;" title="Vendas como vendedor selecionado no PDV">💰 Venda</th>
          <th style="padding:10px 6px;text-align:right;font-size:10px;color:#92400E;text-transform:uppercase;letter-spacing:.5px;">🌸 Montagem</th>
          <th style="padding:10px 6px;text-align:right;font-size:10px;color:#1E40AF;text-transform:uppercase;letter-spacing:.5px;">📦 Expedição</th>
          <th style="padding:10px 6px;text-align:right;font-size:10px;color:#94A3B8;text-transform:uppercase;letter-spacing:.5px;">Total</th>
        </tr></thead>
        <tbody>
          ${comissoes.map(c => `
            <tr style="border-bottom:1px solid #F1F5F9;">
              <td style="padding:10px 6px;font-weight:600;">${fmtMes(c.mes)}</td>
              <td style="text-align:right;padding:10px 6px;color:#15803D;">${$c(c.vendaComissao)}<br/><span style="font-size:9px;color:var(--muted);">${c.vendaCount} vendas</span></td>
              <td style="text-align:right;padding:10px 6px;color:#92400E;">${$c(c.montagemComissao)}<br/><span style="font-size:9px;color:var(--muted);">${c.montagemCount} produtos</span></td>
              <td style="text-align:right;padding:10px 6px;color:#1E40AF;">${$c(c.expedicaoComissao)}<br/><span style="font-size:9px;color:var(--muted);">${c.expedicaoCount} produtos</span></td>
              <td style="text-align:right;padding:10px 6px;font-weight:900;color:#15803D;">${$c(c.total)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    `}
    <div style="font-size:10px;color:var(--muted);margin-top:10px;text-align:center;font-style:italic;">
      🔒 Apenas leitura. Comissões calculadas sobre pedidos com pagamento aprovado.
    </div>
  </div>

  <!-- PONTOS -->
  <div class="card">
    <div class="card-title">⏰ Meus Pontos (últimos 30 dias)</div>
    ${pontos.length === 0 ? `
      <div style="text-align:center;padding:24px;color:var(--muted);font-size:12px;">
        Carregando registros de ponto...
      </div>
    ` : `
    <div style="overflow-x:auto;">
      <table style="width:100%;font-size:12px;border-collapse:collapse;">
        <thead><tr style="background:#FAFAFA;border-bottom:1px solid var(--border);">
          <th style="padding:10px 6px;text-align:left;font-size:10px;color:#94A3B8;text-transform:uppercase;letter-spacing:.5px;">Data</th>
          <th style="padding:10px 6px;text-align:center;font-size:10px;color:#94A3B8;text-transform:uppercase;letter-spacing:.5px;">Entrada</th>
          <th style="padding:10px 6px;text-align:center;font-size:10px;color:#94A3B8;text-transform:uppercase;letter-spacing:.5px;">Almoço</th>
          <th style="padding:10px 6px;text-align:center;font-size:10px;color:#94A3B8;text-transform:uppercase;letter-spacing:.5px;">Retorno</th>
          <th style="padding:10px 6px;text-align:center;font-size:10px;color:#94A3B8;text-transform:uppercase;letter-spacing:.5px;">Saída</th>
        </tr></thead>
        <tbody>
          ${pontos.slice(0, 30).map(p => `
            <tr style="border-bottom:1px solid #F1F5F9;">
              <td style="padding:8px 6px;font-weight:600;font-size:11px;">${(p.data||'').split('-').reverse().join('/')}</td>
              <td style="text-align:center;padding:8px 6px;font-family:Monaco,monospace;color:#15803D;font-weight:600;">${p.entrada || '—'}</td>
              <td style="text-align:center;padding:8px 6px;font-family:Monaco,monospace;color:#D97706;">${p.saidaAlmoco || '—'}</td>
              <td style="text-align:center;padding:8px 6px;font-family:Monaco,monospace;color:#D97706;">${p.voltaAlmoco || '—'}</td>
              <td style="text-align:center;padding:8px 6px;font-family:Monaco,monospace;color:#DC2626;font-weight:600;">${p.saida || '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    `}
    <div style="font-size:10px;color:var(--muted);margin-top:10px;text-align:center;font-style:italic;">
      🔒 Apenas leitura. Para registrar ponto use o módulo "Ponto Eletrônico".
    </div>
  </div>
</div>
`;
}
