// ── NOTAS FISCAIS (NFC-e / NF-e) ─────────────────────────────
import { S } from '../state.js';
import { $c, $d, fmtOrderNum } from '../utils/formatters.js';
import { GET, POST, DELETE } from '../services/api.js';
import { toast } from '../utils/helpers.js';
import { can } from '../services/auth.js';

async function render() { const { render: r } = await import('../main.js'); r(); }

// Carrega notas do backend e cacheia
let _fetchedOnce = false;
async function loadNotas(opts = {}) {
  try {
    const list = await GET('/notas-fiscais?limit=200');
    S._notasFiscais = Array.isArray(list) ? list : [];
    _fetchedOnce = true;
    render();
    if (opts.consultarPendentes !== false) {
      autoConsultarPendentes();
    }
  } catch (e) {
    console.warn('[notas] falha ao carregar:', e);
  }
}

// Consulta SEFAZ em sequência para todas as notas Processando/Pendente
let _consultandoPendentes = false;
async function autoConsultarPendentes() {
  if (_consultandoPendentes) return;
  _consultandoPendentes = true;
  try {
    const pendentes = (S._notasFiscais || []).filter(n =>
      ['Processando','Pendente'].includes(n.status)
    );
    if (pendentes.length === 0) return;
    console.log('[notas] auto-consultando', pendentes.length, 'pendentes');
    for (const n of pendentes) {
      try {
        const resp = await POST('/notas-fiscais/' + n._id + '/consultar', {});
        if (Array.isArray(S._notasFiscais) && resp?.nota) {
          const novoSt = resp.nota.status;
          // Avisa apenas se autorizou ou rejeitou (mudou estado final)
          if (n.status !== novoSt && novoSt === 'Autorizada') {
            toast(`✅ Nota ${resp.nota.numero || ''} autorizada!`);
          } else if (n.status !== novoSt && (novoSt === 'Rejeitada' || novoSt === 'Denegada')) {
            toast(`❌ Nota rejeitada: ${resp.nota.statusMensagem || ''}`, true);
          }
          S._notasFiscais = S._notasFiscais.map(x => x._id === n._id ? resp.nota : x);
        }
      } catch (e) { /* silencioso */ }
    }
    render();
  } finally {
    _consultandoPendentes = false;
  }
}

// Polling inteligente pós-emissão: 3s, 7s, 15s (pra capturar autorização rápida)
function dispatchPosEmissaoPolling(notaId) {
  const delays = [3000, 7000, 15000];
  delays.forEach(ms => {
    setTimeout(() => {
      if (S.page !== 'notasFiscais') return;
      const nota = (S._notasFiscais || []).find(n => n._id === notaId);
      if (!nota || !['Processando','Pendente'].includes(nota.status)) return;
      consultarStatusNota(notaId).catch(()=>{});
    }, ms);
  });
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

  // Tenta achar CPF/CNPJ no pedido OU no cadastro do cliente vinculado
  const clientId = order.client?._id || order.client || order.clientId;
  const clientRec = clientId ? S.clients.find(c =>
    c._id === clientId || c.id === clientId
  ) : null;
  // Fallback: match por telefone se não tiver ID
  const cleanPhone = (order.clientPhone || '').replace(/\D/g,'');
  const clientByPhone = !clientRec && cleanPhone
    ? S.clients.find(c => (c.phone||c.telefone||'').replace(/\D/g,'') === cleanPhone)
    : null;
  const client = clientRec || clientByPhone;

  // Tipo vem do cadastro do cliente (ou do pedido, se foi copiado)
  const tipoPessoa = (order.clientTipoPessoa || client?.tipoPessoa || 'PF').toUpperCase();
  const isPJ = tipoPessoa === 'PJ';

  // Documento: se PJ, pega CNPJ; se PF, pega CPF
  const cpfCnpj = (
    order.cpfCnpj ||
    order.clientCpf ||
    order.client?.cpf ||
    (isPJ ? client?.cnpj : client?.cpf) ||
    ''
  ).replace(/\D/g, '');

  // UF do cliente (para detectar interestadual)
  const ufCliente = (client?.address?.state || client?.address?.uf || 'AM').toUpperCase();
  const isInterestadual = ufCliente !== 'AM';

  if (tipo === 'NFe' && !isPJ) {
    toast('❌ NF-e requer cliente cadastrado como Pessoa Jurídica (com CNPJ).', true);
    return;
  }
  if (tipo === 'NFe' && cpfCnpj.length !== 14) {
    toast('❌ CNPJ do cliente não está cadastrado ou é inválido.', true);
    return;
  }
  // NFC-e é tradicionalmente para venda presencial no estado.
  // Se cliente for de outro estado, sugere NF-e.
  if (tipo === 'NFCe' && isInterestadual) {
    const prosseguir = confirm(
      `⚠️ Cliente é de ${ufCliente} (fora do AM).\n\n` +
      `NFC-e (cupom fiscal) é para venda presencial DENTRO do estado.\n` +
      `Para venda interestadual o correto é NF-e (DANFE).\n\n` +
      `Deseja continuar emitindo a NFC-e mesmo assim?`
    );
    if (!prosseguir) return;
  }

  // Valores iniciais do pedido (editáveis no modal)
  const iniProdutos = Number(order.subtotal || order.total || 0);
  const iniFrete = Number(order.deliveryFee || 0);
  const iniDesconto = Number(order.discount || 0);

  // Modal de confirmação com valores editáveis
  S._modal = `<div class="mo" id="mo" onclick="if(event.target===this){S._modal='';window.render&&window.render();}">
    <div class="mo-box" style="max-width:520px;max-height:90vh;overflow-y:auto;" onclick="event.stopPropagation()">
      <div style="font-family:'Playfair Display',serif;font-size:17px;margin-bottom:4px;">📄 Emitir ${tipo === 'NFCe' ? 'NFC-e (Cupom Fiscal)' : 'NF-e (DANFE)'}</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:14px;">Pedido ${fmtOrderNum(order)}</div>

      <div style="background:var(--cream);border-radius:10px;padding:12px 14px;margin-bottom:14px;font-size:12px;">
        <div style="font-weight:700;margin-bottom:4px;">Destinatário ${isPJ ? '🏢' : '👤'}</div>
        <div>${order.clientName || '—'}</div>
        <div style="color:var(--muted);">${isPJ ? 'CNPJ' : 'CPF'}: ${cpfCnpj || '—'}</div>
        ${client?.address?.city ? `<div style="color:var(--muted);font-size:11px;margin-top:2px;">📍 ${client.address.city}/${ufCliente}${isInterestadual?` <span style="color:#D97706;font-weight:700;">— INTERESTADUAL · CFOP 6102</span>`:''}</div>` : ''}
        ${!cpfCnpj && tipo === 'NFCe' ? '<div style="color:var(--gold);font-size:11px;margin-top:4px;">⚠️ Sem CPF — será emitida como "Consumidor sem identificação"</div>' : ''}
      </div>

      <!-- Valores editáveis (ajuste só na NOTA, não altera o pedido) -->
      <div style="background:#FFFBEB;border:1.5px solid #FCD34D;border-radius:10px;padding:12px 14px;margin-bottom:14px;">
        <div style="font-size:11px;font-weight:700;color:#92400E;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">💰 Valores da Nota</div>
        <div style="font-size:10px;color:#78350F;margin-bottom:10px;line-height:1.4;">
          Editável antes de emitir — não altera o pedido, só o que vai pra SEFAZ.
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div>
            <label style="font-size:10px;color:#78350F;font-weight:600;">Valor produtos</label>
            <div style="display:flex;align-items:center;gap:4px;">
              <span style="font-size:11px;color:var(--muted);">R$</span>
              <input type="number" step="0.01" min="0" id="nfe-val-produtos" value="${iniProdutos.toFixed(2)}"
                style="flex:1;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-weight:700;"/>
            </div>
          </div>
          <div>
            <label style="font-size:10px;color:#78350F;font-weight:600;">Valor frete (embutido)</label>
            <div style="display:flex;align-items:center;gap:4px;">
              <span style="font-size:11px;color:var(--muted);">R$</span>
              <input type="number" step="0.01" min="0" id="nfe-val-frete" value="${iniFrete.toFixed(2)}"
                style="flex:1;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px;"/>
            </div>
          </div>
        </div>
        <div style="margin-top:10px;padding-top:10px;border-top:1px dashed #FCD34D;display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:12px;font-weight:700;color:#92400E;">Total da nota:</span>
          <span id="nfe-val-total" style="font-size:16px;font-weight:800;color:#065F46;">${$c(iniProdutos + iniFrete - iniDesconto)}</span>
        </div>
      </div>

      <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:10px;padding:10px 12px;font-size:11px;color:#1D4ED8;margin-bottom:14px;">
        🌐 Ambiente: <strong>${cfg.certAmbiente === 'producao' ? 'PRODUÇÃO' : 'HOMOLOGAÇÃO (teste)'}</strong> · Gateway: <strong>${cfg.nfeGateway || 'mock'}</strong>
      </div>

      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button type="button" class="btn btn-ghost" onclick="S._modal='';window.render&&window.render();">Cancelar</button>
        <button type="button" class="btn btn-primary" id="btn-emitir-confirm">✅ Emitir ${tipo}</button>
      </div>
    </div></div>`;
  await render();

  // Recalcula total ao editar valor produtos ou frete
  const recalcTotal = () => {
    const p = parseFloat(document.getElementById('nfe-val-produtos')?.value) || 0;
    const f = parseFloat(document.getElementById('nfe-val-frete')?.value) || 0;
    const total = p + f - iniDesconto;
    const el = document.getElementById('nfe-val-total');
    if(el) el.textContent = `R$ ${total.toFixed(2).replace('.',',')}`;
  };
  document.getElementById('nfe-val-produtos')?.addEventListener('input', recalcTotal);
  document.getElementById('nfe-val-frete')?.addEventListener('input', recalcTotal);

  document.getElementById('btn-emitir-confirm')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-emitir-confirm');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Emitindo...'; }
    try {
      const destinatario = {
        tipo: isPJ ? 'PJ' : 'PF',
        cpfCnpj: cpfCnpj,
        nome: order.clientName || client?.name || '',
        email: order.clientEmail || client?.email || '',
        telefone: order.clientPhone || client?.phone || '',
        inscEstadual: client?.inscEstadual || '',
      };
      // Overrides dos valores (editados pelo usuário no modal)
      const valorProdutos = parseFloat(document.getElementById('nfe-val-produtos')?.value) || 0;
      const valorFrete = parseFloat(document.getElementById('nfe-val-frete')?.value) || 0;
      const overrideValores = { valorProdutos, valorFrete };
      let resp;
      try {
        resp = await POST('/notas-fiscais/emitir', { orderId, tipo, destinatario, overrideValores });
      } catch (err) {
        // 409 = já existe nota Processando/Autorizada → se for Processando/Rejeitada,
        // pergunta se quer descartar e tentar de novo
        const msg = err.message || '';
        if (/já tem|processando/i.test(msg)) {
          // Busca a nota existente para permitir descartar
          const existentes = (S._notasFiscais || []).filter(n =>
            n.orderId === orderId && n.tipo === tipo &&
            ['Processando','Pendente','Rejeitada','Denegada'].includes(n.status)
          );
          if (existentes.length > 0) {
            if (btn) { btn.disabled = false; btn.textContent = '✅ Emitir ' + tipo; }
            const ok = confirm(
              `Já existe uma NFC-e anterior deste pedido com status "${existentes[0].status}".\n\n` +
              `Deseja DESCARTAR a anterior e tentar emitir novamente?`
            );
            if (!ok) { S._modal=''; render(); return; }
            if (btn) { btn.disabled = true; btn.textContent = '🗑️ Descartando anterior...'; }
            await descartarNotaFiscal(existentes[0]._id, true);
            if (btn) btn.textContent = '⏳ Re-emitindo...';
            resp = await POST('/notas-fiscais/emitir', { orderId, tipo, destinatario, overrideValores });
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      }
      if (resp?.nota?.status === 'Autorizada') {
        toast(`✅ ${tipo} autorizada! Número ${resp.nota.numero}`);
      } else if (resp?.nota?.status === 'Processando') {
        toast(`⏳ ${tipo} em processamento — atualiza em segundos...`);
        // Polling automático pra capturar autorização assim que Focus responder
        if (resp?.nota?._id) dispatchPosEmissaoPolling(resp.nota._id);
      } else {
        toast(`⚠️ Status: ${resp?.nota?.status || 'indefinido'}`, true);
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

// ── VER detalhes da nota (modal) ──────────────────────────────
export function verDetalhesNota(notaId) {
  const n = (S._notasFiscais || []).find(x => x._id === notaId);
  if (!n) { toast('Nota não encontrada'); return; }

  const sMap = {
    'Autorizada':  { cor: '#065F46', bg: '#BBF7D0', ic: '✅' },
    'Processando': { cor: '#78350F', bg: '#FEF3C7', ic: '⏳' },
    'Rejeitada':   { cor: '#7F1D1D', bg: '#FECACA', ic: '❌' },
    'Cancelada':   { cor: '#F9FAFB', bg: '#1F2937', ic: '🚫' },
    'Denegada':    { cor: '#FEE2E2', bg: '#991B1B', ic: '⛔' },
    'Pendente':    { cor: '#78350F', bg: '#FEF3C7', ic: '⏳' },
  };
  const st = sMap[n.status] || sMap.Pendente;

  S._modal = `<div class="mo" id="mo" onclick="if(event.target===this){S._modal='';window.render&&window.render();}">
    <div class="mo-box" style="max-width:580px;max-height:85vh;overflow-y:auto;" onclick="event.stopPropagation()">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <div>
          <div style="font-family:'Playfair Display',serif;font-size:18px;">${n.tipo === 'NFCe' ? 'NFC-e' : 'NF-e'} — ${n.numero || '—'}</div>
          <div style="font-size:11px;color:var(--muted);">Série ${n.serie || '001'} · ${n.ambiente === 'producao' ? '🔵 PRODUÇÃO' : '🟡 HOMOLOGAÇÃO'}</div>
        </div>
        <span style="background:${st.bg};color:${st.cor};padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700;">${st.ic} ${n.status}</span>
      </div>

      ${n.statusMensagem ? `
      <div style="background:${n.status === 'Rejeitada' || n.status === 'Denegada' ? '#FEF2F2' : 'var(--cream)'};border-left:3px solid ${n.status === 'Rejeitada' ? '#DC2626' : 'var(--rose)'};padding:10px 12px;margin-bottom:14px;font-size:12px;border-radius:6px;">
        <strong>Mensagem:</strong> ${n.statusMensagem}
        ${n.codigoRetorno ? `<br><small>Código SEFAZ: ${n.codigoRetorno}</small>` : ''}
      </div>` : ''}

      ${n.chave ? `
      <div style="margin-bottom:14px;">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">🔑 Chave de acesso</div>
        <div style="background:var(--cream);padding:8px 10px;border-radius:6px;font-family:monospace;font-size:11px;word-break:break-all;">${n.chave}</div>
      </div>` : ''}

      <div class="g2" style="margin-bottom:14px;">
        <div>
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Destinatário</div>
          <div style="font-weight:600;">${n.destinatario?.nome || '—'}</div>
          <div style="font-size:11px;color:var(--muted);">${n.destinatario?.cpfCnpj ? (n.destinatario.tipo === 'PJ' ? 'CNPJ: ' : 'CPF: ') + n.destinatario.cpfCnpj : 'Sem identificação'}</div>
        </div>
        <div>
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Valor total</div>
          <div style="font-weight:700;font-size:18px;color:var(--leaf);">${$c(n.valorTotal || 0)}</div>
        </div>
      </div>

      <div style="margin-bottom:14px;">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">📦 Itens (${(n.itens || []).length})</div>
        <div class="tw"><table style="font-size:11px;">
          <thead><tr><th>Descrição</th><th>Qtd</th><th>Unit.</th><th>Total</th></tr></thead>
          <tbody>
            ${(n.itens || []).map(it => `<tr>
              <td>${it.descricao || '—'}</td>
              <td>${Number(it.quantidade || 0).toLocaleString('pt-BR')}</td>
              <td>${$c(it.valorUnitario || 0)}</td>
              <td style="font-weight:600;">${$c(it.valorTotal || 0)}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;padding-top:12px;border-top:1px solid var(--border);">
        ${n.pdfUrl || n.danfeUrl ? `
          <button type="button" class="btn btn-primary btn-sm" onclick="window.open('${n.danfeUrl || n.pdfUrl}','_blank')">🖨️ Imprimir / PDF</button>` : ''}
        ${n.xmlUrl ? `
          <button type="button" class="btn btn-ghost btn-sm" onclick="window.open('${n.xmlUrl}','_blank')">📥 Baixar XML</button>` : ''}
        ${(n.pdfUrl || n.xmlUrl) && n.destinatario?.email ? `
          <button type="button" class="btn btn-ghost btn-sm" onclick="window.enviarNotaEmail('${n._id}')">📧 Enviar por e-mail</button>` : ''}
        ${n.chave ? `
          <button type="button" class="btn btn-ghost btn-sm" onclick="navigator.clipboard.writeText('${n.chave}').then(()=>window._fvToast&&window._fvToast('🔑 Chave copiada'))">📋 Copiar chave</button>` : ''}
        ${['Processando','Pendente'].includes(n.status) ? `
          <button type="button" class="btn btn-ghost btn-sm" onclick="window.consultarStatusNota('${n._id}')">🔄 Consultar SEFAZ</button>` : ''}
        ${n.status === 'Autorizada' ? `
          <button type="button" class="btn btn-ghost btn-sm" onclick="window.cancelarNotaFiscal('${n._id}')" style="color:var(--red);border-color:var(--red);">🚫 Cancelar nota</button>` : ''}
        ${['Processando','Pendente','Rejeitada','Denegada'].includes(n.status) ? `
          <button type="button" class="btn btn-ghost btn-sm" onclick="window.descartarNotaFiscal('${n._id}').then(()=>{S._modal='';window.render&&window.render();})" style="color:var(--red);">🗑️ Descartar</button>` : ''}
        <button type="button" class="btn btn-ghost btn-sm" style="margin-left:auto;" onclick="S._modal='';window.render&&window.render();">Fechar</button>
      </div>
    </div></div>`;
  render();
}

// ── ENVIAR nota por e-mail ────────────────────────────────────
export async function enviarNotaEmail(notaId) {
  const n = (S._notasFiscais || []).find(x => x._id === notaId);
  if (!n) return;
  const email = n.destinatario?.email;
  if (!email) { toast('Destinatário sem e-mail cadastrado'); return; }
  // Focus tem endpoint para envio por email; por ora abre o mailto como fallback
  const subj = encodeURIComponent(`Sua NFC-e #${n.numero} — Laços Eternos`);
  const body = encodeURIComponent(
    `Olá ${n.destinatario?.nome || ''},\n\n` +
    `Segue sua nota fiscal referente à compra:\n\n` +
    `Número: ${n.numero}\n` +
    `Chave de acesso: ${n.chave || '—'}\n` +
    `Valor: ${$c(n.valorTotal || 0)}\n\n` +
    (n.danfeUrl ? `DANFE (PDF): ${n.danfeUrl}\n` : '') +
    (n.xmlUrl ? `XML: ${n.xmlUrl}\n\n` : '\n') +
    `Obrigada pela preferência! 🌸\nLaços Eternos Floricultura`
  );
  window.location.href = `mailto:${email}?subject=${subj}&body=${body}`;
}

// ── DESCARTAR TODAS notas nao-autorizadas (limpeza) ──────────
export async function descartarTodasNotas() {
  const pendentes = (S._notasFiscais || []).filter(n =>
    ['Processando','Pendente','Rejeitada','Denegada','Cancelada'].includes(n.status)
  ).length;
  if (pendentes === 0) { toast('Nenhuma nota para limpar'); return; }
  if (!confirm(`Descartar ${pendentes} nota(s) nao autorizadas?\n\nNotas Autorizadas NAO serao afetadas.`)) return;
  try {
    const resp = await DELETE('/notas-fiscais/limpar/nao-autorizadas');
    toast(`🧹 ${resp?.deletedCount || pendentes} nota(s) removida(s)`);
    _fetchedOnce = false;
    await loadNotas();
  } catch (e) {
    toast('❌ Erro: ' + (e.message || ''), true);
  }
}

// ── DESCARTAR nota (Processando/Rejeitada/Pendente) ──────────
export async function descartarNotaFiscal(notaId, silencioso = false) {
  if (!silencioso) {
    if (!confirm('Descartar esta nota?\n\n(Só funciona em notas Processando/Rejeitada/Pendente. Autorizadas precisam ser canceladas oficialmente.)')) return;
  }
  try {
    await DELETE('/notas-fiscais/' + notaId);
    if (Array.isArray(S._notasFiscais)) {
      S._notasFiscais = S._notasFiscais.filter(n => n._id !== notaId);
    }
    if (!silencioso) toast('🗑️ Nota descartada');
    render();
  } catch (e) {
    toast('❌ ' + (e.message || 'Erro ao descartar'), true);
    throw e;
  }
}

// ── CONSULTAR status na Focus (re-busca na SEFAZ) ────────────
export async function consultarStatusNota(notaId, opts = {}) {
  const silencioso = opts.silencioso === true;
  try {
    if (!silencioso) toast('🔄 Consultando SEFAZ...');
    const resp = await POST('/notas-fiscais/' + notaId + '/consultar', {});
    const prev = (S._notasFiscais || []).find(n => n._id === notaId);
    if (Array.isArray(S._notasFiscais) && resp?.nota) {
      S._notasFiscais = S._notasFiscais.map(n => n._id === notaId ? resp.nota : n);
    }
    const st = resp?.nota?.status || '—';
    // Só avisa se NÃO for silencioso, OU se o status MUDOU de Processando para algo terminal
    const statusChanged = prev && prev.status !== st && ['Autorizada','Rejeitada','Denegada','Cancelada'].includes(st);
    if (!silencioso) {
      if (st === 'Autorizada') toast('✅ Autorizada!');
      else if (st === 'Rejeitada' || st === 'Denegada') toast(`❌ ${st}: ${resp.nota?.statusMensagem || ''}`, true);
      else toast(`⏳ Status: ${st}`);
    } else if (statusChanged) {
      // Auto-poll detectou mudança — avisa só quando autoriza
      if (st === 'Autorizada') toast(`✅ Nota ${resp.nota?.numero || ''} autorizada!`);
      else if (st === 'Rejeitada' || st === 'Denegada') toast(`❌ Nota rejeitada: ${resp.nota?.statusMensagem || ''}`, true);
    }
    render();
  } catch (e) {
    if (!silencioso) toast('❌ Erro: ' + (e.message || ''), true);
  }
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

  if (!_fetchedOnce) {
    loadNotas();
  } else {
    // Se já carregou, re-consulta pendentes em background (reentrada na tela)
    autoConsultarPendentes();
  }
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
  <div style="display:flex;gap:6px;">
    <button type="button" class="btn btn-ghost btn-sm" id="btn-reload-nfe">🔄 Atualizar</button>
    <button type="button" class="btn btn-ghost btn-sm" id="btn-limpar-nfe" style="color:var(--red);border:1px solid var(--red);">🧹 Limpar testes</button>
  </div>
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
        <button type="button" class="btn btn-ghost btn-xs" data-nfe-ver="${n._id}" title="Ver detalhes">👁️</button>
        ${n.pdfUrl || n.danfeUrl ? `<a href="${n.danfeUrl || n.pdfUrl}" target="_blank" class="btn btn-ghost btn-xs" title="Imprimir / PDF">🖨️</a>` : ''}
        ${n.xmlUrl ? `<a href="${n.xmlUrl}" target="_blank" class="btn btn-ghost btn-xs" title="Baixar XML">📥</a>` : ''}
        ${['Processando','Pendente'].includes(n.status) ? `<button type="button" class="btn btn-ghost btn-xs" data-nfe-consultar="${n._id}" title="Consultar status na SEFAZ" style="color:var(--blue);">🔄</button>` : ''}
        ${n.status === 'Autorizada' ? `<button type="button" class="btn btn-ghost btn-xs" data-nfe-cancel="${n._id}" style="color:var(--red);" title="Cancelar oficialmente na SEFAZ">🚫</button>` : ''}
        ${['Processando','Pendente','Rejeitada','Denegada'].includes(n.status) ? `<button type="button" class="btn btn-ghost btn-xs" data-nfe-descartar="${n._id}" style="color:var(--red);" title="Descartar (permite re-emitir)">🗑️</button>` : ''}
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
  document.getElementById('btn-reload-nfe')?.addEventListener('click', async () => {
    toast('🔄 Atualizando... (consultando SEFAZ)');
    _fetchedOnce = false;
    await loadNotas();
    toast('✅ Lista atualizada');
  });
  document.getElementById('btn-limpar-nfe')?.addEventListener('click', descartarTodasNotas);
  document.querySelectorAll('[data-nfe-cancel]').forEach(b => {
    b.addEventListener('click', () => cancelarNotaFiscal(b.dataset.nfeCancel));
  });
  document.querySelectorAll('[data-nfe-consultar]').forEach(b => {
    b.addEventListener('click', () => consultarStatusNota(b.dataset.nfeConsultar));
  });
  document.querySelectorAll('[data-nfe-descartar]').forEach(b => {
    b.addEventListener('click', () => descartarNotaFiscal(b.dataset.nfeDescartar));
  });
  document.querySelectorAll('[data-nfe-ver]').forEach(b => {
    b.addEventListener('click', () => verDetalhesNota(b.dataset.nfeVer));
  });

  // Auto-consulta notas em Processando a cada 5s (ate virarem Autorizada/Rejeitada)
  clearInterval(window._nfeAutoPoll);
  const pendentes = (S._notasFiscais || []).filter(n => ['Processando','Pendente'].includes(n.status));
  if (pendentes.length > 0 && S.page === 'notasFiscais') {
    window._nfeAutoPoll = setInterval(() => {
      if (S.page !== 'notasFiscais') { clearInterval(window._nfeAutoPoll); return; }
      const ainda = (S._notasFiscais || []).filter(n => ['Processando','Pendente'].includes(n.status));
      if (ainda.length === 0) { clearInterval(window._nfeAutoPoll); return; }
      // Consulta TODAS pendentes silenciosamente (só avisa se mudar de status)
      ainda.forEach(n => consultarStatusNota(n._id, { silencioso: true }).catch(()=>{}));
    }, 5000);
  }
}

// Expõe globalmente
if (typeof window !== 'undefined') {
  window.emitirNotaFiscal = emitirNotaFiscal;
  window.cancelarNotaFiscal = cancelarNotaFiscal;
  window.consultarStatusNota = consultarStatusNota;
  window.descartarNotaFiscal = descartarNotaFiscal;
  window.verDetalhesNota = verDetalhesNota;
  window.enviarNotaEmail = enviarNotaEmail;
  window._fvToast = toast;
}
