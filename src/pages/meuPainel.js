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

// Comissão calculada localmente (S.orders ja foi carregado)
function calcularComissoes(user) {
  const orders = Array.isArray(S.orders) ? S.orders : [];
  const myEmail = String(user?.email||'').toLowerCase();
  const myId    = String(user?._id||user?.id||'');
  const myColabId = String(user?.colabId||'');

  const APROVADOS = new Set(['Aprovado','Pago','aprovado','pago']);
  // Filtra pedidos vendidos por este colaborador E aprovados
  const meus = orders.filter(o => {
    const okPay = APROVADOS.has(String(o.paymentStatus||''));
    if (!okPay) return false;
    const e = String(o.createdByEmail||'').toLowerCase();
    return e === myEmail
        || String(o.criadoPor||'') === myId
        || String(o.createdByColabId||'') === myColabId;
  });
  // Agrupa por mes
  const porMes = {};
  for (const o of meus) {
    const d = new Date(o.createdAt || o.scheduledDate || Date.now());
    const key = d.toISOString().slice(0,7); // YYYY-MM
    if (!porMes[key]) porMes[key] = { count:0, total:0 };
    porMes[key].count++;
    porMes[key].total += Number(o.total) || 0;
  }
  // Percentual padrao (admin pode configurar futuramente em settings)
  const PCT = Number(user?.metas?.comissaoPct) || 2; // 2% default
  return Object.entries(porMes)
    .sort((a,b) => b[0].localeCompare(a[0]))
    .map(([mes, v]) => ({
      mes,
      count: v.count,
      total: v.total,
      comissao: v.total * (PCT/100),
      pct: PCT,
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
  const pontosRaw = _pontosCache || [];
  const pontos = agruparPontosPorDia(pontosRaw);
  const comissoes = calcularComissoes(u);
  const totalAcumulado = comissoes.reduce((s,c) => s + c.comissao, 0);
  const totalVendas    = comissoes.reduce((s,c) => s + c.total, 0);
  const qtdPedidos     = comissoes.reduce((s,c) => s + c.count, 0);

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
    <div style="display:flex;gap:8px;margin-bottom:14px;">
      <div style="flex:1;background:var(--cream);border-radius:8px;padding:10px;text-align:center;">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Pedidos aprovados</div>
        <div style="font-size:20px;font-weight:900;color:var(--ink);">${qtdPedidos}</div>
      </div>
      <div style="flex:1;background:var(--cream);border-radius:8px;padding:10px;text-align:center;">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Total em vendas</div>
        <div style="font-size:18px;font-weight:900;color:var(--ink);">${$c(totalVendas)}</div>
      </div>
    </div>
    ${comissoes.length === 0 ? `
      <div style="text-align:center;padding:24px;color:var(--muted);font-size:12px;">
        Nenhuma venda aprovada ainda neste período.
      </div>
    ` : `
    <div style="overflow-x:auto;">
      <table style="width:100%;font-size:12px;border-collapse:collapse;">
        <thead><tr style="background:#FAFAFA;border-bottom:1px solid var(--border);">
          <th style="padding:10px 6px;text-align:left;font-size:10px;color:#94A3B8;text-transform:uppercase;letter-spacing:.5px;">Mês</th>
          <th style="padding:10px 6px;text-align:center;font-size:10px;color:#94A3B8;text-transform:uppercase;letter-spacing:.5px;">Pedidos</th>
          <th style="padding:10px 6px;text-align:right;font-size:10px;color:#94A3B8;text-transform:uppercase;letter-spacing:.5px;">Vendas</th>
          <th style="padding:10px 6px;text-align:center;font-size:10px;color:#94A3B8;text-transform:uppercase;letter-spacing:.5px;">%</th>
          <th style="padding:10px 6px;text-align:right;font-size:10px;color:#94A3B8;text-transform:uppercase;letter-spacing:.5px;">Comissão</th>
        </tr></thead>
        <tbody>
          ${comissoes.map(c => `
            <tr style="border-bottom:1px solid #F1F5F9;">
              <td style="padding:10px 6px;font-weight:600;">${fmtMes(c.mes)}</td>
              <td style="text-align:center;padding:10px 6px;">${c.count}</td>
              <td style="text-align:right;padding:10px 6px;color:var(--muted);">${$c(c.total)}</td>
              <td style="text-align:center;padding:10px 6px;"><span style="background:#DBEAFE;color:#1E40AF;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700;">${c.pct}%</span></td>
              <td style="text-align:right;padding:10px 6px;font-weight:900;color:#15803D;">${$c(c.comissao)}</td>
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
