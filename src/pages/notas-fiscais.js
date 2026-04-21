// ── NOTAS FISCAIS (NFC-e / NF-e) ─────────────────────────────
import { S } from '../state.js';
import { $c, $d, fmtOrderNum } from '../utils/formatters.js';
import { GET, POST } from '../services/api.js';
import { toast } from '../utils/helpers.js';
import { can } from '../services/auth.js';

async function render() { const { render: r } = await import('../main.js'); r(); }

// Carrega notas do backend e cacheia
let _fetchedOnce = false;
async function loadNotas() {
  try {
    const list = await GET('/notas-fiscais?limit=200');
    S._notasFiscais = Array.isArray(list) ? list : [];
    _fetchedOnce = true;
    render();
  } catch (e) {
    console.warn('[notas] falha ao carregar:', e);
  }
}

// ── UTIL: cor/ícone do status ─────────────────────────────────
function statusBadge(status) {
  const map = {
    'Autorizada':  { bg: '#BBF7D0', fg: '#065F46', ic: '✅' },
    'Processando': { bg: '#FEF3C7', fg: '#78350F', ic: '⏳' },
    'Pendente':    { bg: '#FEF3C7', fg: '#78350F', ic: '⏳' },
    'Rejeitada':   { bg: '#FECACA', fg: '#7F1D1D', ic: '❌' },
    'Cancelada':   { bg: '#1F2937', fg: '#F9FAFB', ic: '🚫' },
    'Denegada':    { bg: '#991B1B', fg: '#FEE2E2', ic: '⛔' },
  };
  const s = map[status] || map['Pendente'];
  return `<span style="display:inline-block;background:${s.bg};color:${s.fg};border-radius:20px;padding:2px 10px;font-size:10px;font-weight:700;white-space:nowrap;">${s.ic} ${status}</span>`;
}

// ── EMITIR nota (via modal simples) ───────────────────────────
export async function emitirNotaFiscal(orderId, tipo = 'NFCe') {
  if (!can('reports') && !can('orders')) {
    toast('Sem permissão para emitir notas fiscais', true);
    return;
  }
  const order = S.orders.find(o => o._id === orderId);
  if (!order) { toast('Pedido não encontrado', true); return; }

  // Valida configuração mínima
  const cfg = JSON.parse(localStorage.getItem('fv_config') || '{}');
  if (!cfg.regimeTributario || !cfg.ncmDefault) {
    toast('⚠️ Configure os dados fiscais em Configurações → Configuração Fiscal primeiro', true);
    setTimeout(() => { window.location.href = '/configuracoes'; }, 1500);
    return;
  }

  const cpfCnpj = (order.cpfCnpj || order.clientCpf || '').replace(/\D/g, '');
  const isPJ = cpfCnpj.length === 14;

  if (tipo === 'NFe' && !isPJ) {
    toast('❌ NF-e requer CNPJ do destinatário. Use NFC-e ou cadastre o CNPJ no cliente.', true);
    return;
  }

  // Modal de confirmação
  S._modal = `<div class="mo" id="mo" onclick="if(event.target===this){S._modal='';window.render&&window.render();}">
    <div class="mo-box" style="max-width:480px;" onclick="event.stopPropagation()">
      <div style="font-family:'Playfair Display',serif;font-size:17px;margin-bottom:4px;">📄 Emitir ${tipo === 'NFCe' ? 'NFC-e (Cupom Fiscal)' : 'NF-e (DANFE)'}</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:14px;">Pedido ${fmtOrderNum(order)} · ${$c(order.total)}</div>

      <div style="background:var(--cream);border-radius:10px;padding:12px 14px;margin-bottom:14px;font-size:12px;">
        <div style="font-weight:700;margin-bottom:4px;">Destinatário</div>
        <div>${order.clientName || '—'}</div>
        <div style="color:var(--muted);">${isPJ ? 'CNPJ' : 'CPF'}: ${cpfCnpj || '—'}</div>
        ${!cpfCnpj && tipo === 'NFCe' ? '<div style="color:var(--gold);font-size:11px;margin-top:4px;">⚠️ Sem CPF — será emitida como "Consumidor sem identificação"</div>' : ''}
      </div>

      <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:10px;padding:10px 12px;font-size:11px;color:#1D4ED8;margin-bottom:14px;">
        🌐 Ambiente atual: <strong>${cfg.certAmbiente === 'producao' ? 'PRODUÇÃO' : 'HOMOLOGAÇÃO (teste)'}</strong> · Gateway: <strong>${cfg.nfeGateway || 'mock'}</strong>
      </div>

      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button type="button" class="btn btn-ghost" onclick="S._modal='';window.render&&window.render();">Cancelar</button>
        <button type="button" class="btn btn-primary" id="btn-emitir-confirm">✅ Emitir ${tipo}</button>
      </div>
    </div></div>`;
  await render();

  document.getElementById('btn-emitir-confirm')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-emitir-confirm');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Emitindo...'; }
    try {
      const resp = await POST('/notas-fiscais/emitir', { orderId, tipo });
      if (resp?.nota?.status === 'Autorizada') {
        toast(`✅ ${tipo} autorizada! Número ${resp.nota.numero}`);
      } else {
        toast(`⚠️ Nota em status: ${resp?.nota?.status || 'indefinido'}`, true);
      }
      S._modal = '';
      // Atualiza lista em memória
      if (!Array.isArray(S._notasFiscais)) S._notasFiscais = [];
      if (resp?.nota) S._notasFiscais.unshift(resp.nota);
      render();
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = '✅ Emitir ' + tipo; }
      toast('❌ Erro: ' + (e.message || 'desconhecido'), true);
    }
  });
}

// ── CANCELAR nota ─────────────────────────────────────────────
export async function cancelarNotaFiscal(notaId) {
  const motivo = prompt('Motivo do cancelamento (mín 15 caracteres):');
  if (!motivo || motivo.length < 15) {
    toast('❌ Motivo muito curto (mín 15 caracteres)', true);
    return;
  }
  try {
    const resp = await POST('/notas-fiscais/' + notaId + '/cancelar', { motivo });
    toast('🚫 Nota cancelada');
    if (Array.isArray(S._notasFiscais) && resp?.nota) {
      S._notasFiscais = S._notasFiscais.map(n => n._id === notaId ? resp.nota : n);
    }
    render();
  } catch (e) {
    toast('❌ Erro: ' + (e.message || ''), true);
  }
}

// ── RENDER PÁGINA ─────────────────────────────────────────────
export function renderNotasFiscais() {
  if (!can('reports') && S.user?.role !== 'Administrador' && S.user?.cargo !== 'admin') {
    return '<div class="empty card"><div class="empty-icon">🚫</div><p>Sem permissão para Notas Fiscais</p></div>';
  }

  if (!_fetchedOnce) loadNotas();
  const notas = S._notasFiscais || [];

  const filter = S._nfeFilter || 'all';
  const filtered = notas.filter(n => {
    if (filter === 'all') return true;
    if (filter === 'autorizadas') return n.status === 'Autorizada';
    if (filter === 'pendentes') return ['Processando', 'Pendente'].includes(n.status);
    if (filter === 'rejeitadas') return ['Rejeitada', 'Denegada'].includes(n.status);
    if (filter === 'canceladas') return n.status === 'Cancelada';
    if (filter === 'nfce') return n.tipo === 'NFCe';
    if (filter === 'nfe') return n.tipo === 'NFe';
    return true;
  });

  const total = notas.length;
  const autorizadas = notas.filter(n => n.status === 'Autorizada').length;
  const pendentes = notas.filter(n => ['Processando', 'Pendente'].includes(n.status)).length;
  const rejeitadas = notas.filter(n => ['Rejeitada', 'Denegada'].includes(n.status)).length;
  const valorAutorizado = notas
    .filter(n => n.status === 'Autorizada')
    .reduce((s, n) => s + (n.valorTotal || 0), 0);

  const tabBtn = (k, l) => `<button type="button" class="btn ${filter === k ? 'btn-primary' : 'btn-ghost'} btn-sm" data-nfe-filter="${k}">${l}</button>`;

  return `
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px;">
  <div>
    <h2 style="font-family:'Playfair Display',serif;font-size:22px;color:var(--primary);margin:0;">🧾 Notas Fiscais</h2>
    <p style="font-size:13px;color:var(--muted);margin:2px 0 0;">NFC-e (cupom) e NF-e (DANFE) emitidas</p>
  </div>
  <button type="button" class="btn btn-ghost btn-sm" id="btn-reload-nfe">🔄 Atualizar</button>
</div>

<div class="g4" style="margin-bottom:14px;">
  <div class="mc rose"><div class="mc-label">Total emitidas</div><div class="mc-val">${total}</div></div>
  <div class="mc leaf"><div class="mc-label">Autorizadas</div><div class="mc-val">${autorizadas}</div></div>
  <div class="mc gold"><div class="mc-label">Pendentes</div><div class="mc-val">${pendentes}</div></div>
  <div class="mc purple"><div class="mc-label">Valor Autorizado</div><div class="mc-val" style="font-size:16px;">${$c(valorAutorizado)}</div></div>
</div>

<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;">
  ${tabBtn('all', 'Todas')}
  ${tabBtn('autorizadas', '✅ Autorizadas')}
  ${tabBtn('pendentes', '⏳ Pendentes')}
  ${tabBtn('rejeitadas', '❌ Rejeitadas')}
  ${tabBtn('canceladas', '🚫 Canceladas')}
  <span style="width:1px;background:var(--border);margin:0 4px;"></span>
  ${tabBtn('nfce', 'NFC-e')}
  ${tabBtn('nfe', 'NF-e')}
</div>

${filtered.length === 0 ? `
<div class="empty card">
  <div class="empty-icon">🧾</div>
  <p>${total === 0 ? 'Nenhuma nota fiscal emitida ainda.' : 'Nenhuma nota neste filtro.'}</p>
  ${total === 0 ? '<p style="font-size:12px;color:var(--muted);margin-top:8px;">Use o botão "📄 Emitir NFC-e" nos pedidos para começar.</p>' : ''}
</div>` : `
<div class="card">
  <div class="tw"><table>
    <thead><tr>
      <th>Data</th><th>Tipo</th><th>Número</th><th>Pedido</th><th>Destinatário</th><th>Valor</th><th>Status</th><th>Ações</th>
    </tr></thead>
    <tbody>
    ${filtered.map(n => `<tr>
      <td style="font-size:11px;color:var(--muted);white-space:nowrap;">${$d(n.emitidaEm || n.createdAt)}</td>
      <td><span class="tag ${n.tipo === 'NFe' ? 't-purple' : 't-blue'}">${n.tipo === 'NFCe' ? 'NFC-e' : 'NF-e'}</span></td>
      <td style="font-weight:700;">${n.numero || '—'}</td>
      <td style="color:var(--rose);font-weight:700;">${n.orderNumber ? '#' + n.orderNumber : (n.orderId ? n.orderId.slice(-5) : '—')}</td>
      <td>
        <div style="font-size:12px;font-weight:600;">${n.destinatario?.nome || '—'}</div>
        <div style="font-size:10px;color:var(--muted);">${n.destinatario?.cpfCnpj || 'Sem identificação'}</div>
      </td>
      <td style="font-weight:700;">${$c(n.valorTotal || 0)}</td>
      <td>${statusBadge(n.status)}</td>
      <td style="white-space:nowrap;">
        ${n.pdfUrl || n.danfeUrl ? `<a href="${n.danfeUrl || n.pdfUrl}" target="_blank" class="btn btn-ghost btn-xs" title="Ver PDF">📄</a>` : ''}
        ${n.xmlUrl ? `<a href="${n.xmlUrl}" target="_blank" class="btn btn-ghost btn-xs" title="Baixar XML">📥</a>` : ''}
        ${n.status === 'Autorizada' ? `<button type="button" class="btn btn-ghost btn-xs" data-nfe-cancel="${n._id}" style="color:var(--red);" title="Cancelar">🚫</button>` : ''}
      </td>
    </tr>`).join('')}
    </tbody>
  </table></div>
</div>`}

<div style="margin-top:14px;font-size:11px;color:var(--muted);text-align:center;line-height:1.6;">
  💡 Para emitir uma nota, vá na tela <strong>Pedidos</strong> e clique no botão 📄 em cada pedido.<br>
  Ambiente e gateway são definidos em <a href="/configuracoes" style="color:var(--rose);">Configurações → Configuração Fiscal</a>.
</div>`;
}

// ── BIND events da página ─────────────────────────────────────
export function bindNotasFiscaisEvents() {
  document.querySelectorAll('[data-nfe-filter]').forEach(b => {
    b.addEventListener('click', () => {
      S._nfeFilter = b.dataset.nfeFilter;
      render();
    });
  });
  document.getElementById('btn-reload-nfe')?.addEventListener('click', () => {
    _fetchedOnce = false;
    loadNotas();
  });
  document.querySelectorAll('[data-nfe-cancel]').forEach(b => {
    b.addEventListener('click', () => cancelarNotaFiscal(b.dataset.nfeCancel));
  });
}

// Expõe globalmente
if (typeof window !== 'undefined') {
  window.emitirNotaFiscal = emitirNotaFiscal;
  window.cancelarNotaFiscal = cancelarNotaFiscal;
}
