// ── IMPORTACAO DE PEDIDOS (admin) ────────────────────────────
// Tela one-shot para importar pedidos do sistema antigo (PDF parseado)
// para o sistema novo via POST /orders.
//
// Aceita JSON em 3 fontes:
//   1. Carregar de URL pre-definida (/import-pedidos-maes-2026.json)
//   2. Colar no textarea
//   3. Upload de arquivo .json
//
// Mostra preview tabular + botao 'Importar X pedidos'.
// Importa SEQUENCIAL com delay (200ms) e progresso visual.
import { S } from '../state.js';
import { $c } from '../utils/formatters.js';
import { POST, GET } from '../services/api.js';
import { toast } from '../utils/helpers.js';

let _importData = null;
let _importProgress = { running: false, ok: 0, fail: 0, total: 0, current: '' };
let _importResults = []; // [{numero, status, message}]

function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

export function renderImportarPedidos() {
  const ehAdm = S.user?.role==='Administrador' || S.user?.cargo==='admin';
  if (!ehAdm) return `<div class="empty card"><div class="empty-icon">🔒</div><p>Apenas Administrador.</p></div>`;

  const data = _importData;
  const prog = _importProgress;

  return `
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
  <div>
    <div style="font-family:'Playfair Display',serif;font-size:22px;color:#9F1239;">📥 Importar Pedidos do Sistema Antigo</div>
    <div style="font-size:12px;color:var(--muted);">Lança em massa pedidos do PDF antigo no sistema novo</div>
  </div>
</div>

${!data ? `
<div class="card" style="margin-bottom:14px;">
  <div class="card-title">1️⃣ Escolha a fonte do JSON</div>
  <div style="display:grid;gap:10px;">

    <div style="background:#FAFAFA;border:1px solid var(--border);border-radius:8px;padding:14px;">
      <div style="font-weight:700;margin-bottom:6px;">📦 Pedidos Dia das Mães 2026 (pré-carregado)</div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:10px;">20 pedidos do PDF antigo, agendados para 10/05/2026</div>
      <button class="btn btn-primary" id="btn-imp-load-default">⬇️ Carregar JSON pré-pronto</button>
    </div>

    <div style="background:#FAFAFA;border:1px solid var(--border);border-radius:8px;padding:14px;">
      <div style="font-weight:700;margin-bottom:6px;">📄 Upload de arquivo .json</div>
      <input type="file" id="imp-file" accept=".json,application/json" class="fi"/>
    </div>

    <div style="background:#FAFAFA;border:1px solid var(--border);border-radius:8px;padding:14px;">
      <div style="font-weight:700;margin-bottom:6px;">📋 Colar JSON manualmente</div>
      <textarea id="imp-json" class="fi" rows="6" placeholder='[{"sourceOrderNumber":"...","clientName":"...",...}]' style="font-family:Monaco,monospace;font-size:11px;"></textarea>
      <button class="btn btn-ghost btn-sm" id="btn-imp-parse-text" style="margin-top:8px;">Carregar do texto</button>
    </div>
  </div>
</div>
` : `
<div class="card" style="margin-bottom:14px;background:linear-gradient(135deg,#DCFCE7,#F0FDF4);border:1px solid #86EFAC;">
  <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
    <div>
      <div style="font-weight:800;color:#15803D;font-size:16px;">✅ ${data.length} pedidos prontos para importar</div>
      <div style="font-size:11px;color:#15803D;opacity:.8;">Revise abaixo e clique em "Importar tudo"</div>
    </div>
    <div style="display:flex;gap:6px;">
      <button class="btn btn-ghost btn-sm" id="btn-imp-clear">↩️ Limpar</button>
      ${prog.running
        ? `<button class="btn btn-primary" disabled>⏳ Importando ${prog.ok+prog.fail}/${prog.total}...</button>`
        : `<button class="btn btn-primary" id="btn-imp-go" style="font-size:14px;font-weight:800;">📥 Importar ${data.length} pedido(s)</button>`}
    </div>
  </div>
  ${prog.running ? `
  <div style="margin-top:10px;height:8px;background:rgba(255,255,255,.6);border-radius:4px;overflow:hidden;">
    <div style="height:100%;width:${Math.round(((prog.ok+prog.fail)/prog.total)*100)}%;background:#15803D;transition:width .3s;"></div>
  </div>
  <div style="margin-top:6px;font-size:11px;color:#15803D;">
    ✅ ${prog.ok} importados · ❌ ${prog.fail} falhas · Atual: <strong>#${prog.current}</strong>
  </div>
  ` : ''}
</div>

${_importResults.length > 0 ? `
<div class="card" style="margin-bottom:14px;">
  <div class="card-title">📊 Resultado da Importação</div>
  <div style="display:grid;gap:4px;max-height:300px;overflow-y:auto;">
    ${_importResults.map(r => `<div style="display:flex;justify-content:space-between;padding:6px 8px;background:${r.status==='ok'?'#DCFCE7':'#FEE2E2'};border-radius:6px;font-size:12px;">
      <span style="font-weight:600;">${r.status==='ok'?'✅':'❌'} #${r.numero}</span>
      <span style="font-size:11px;color:${r.status==='ok'?'#15803D':'#991B1B'};">${esc(r.message)}</span>
    </div>`).join('')}
  </div>
</div>
` : ''}

<!-- Preview tabular -->
<div class="card">
  <div class="card-title">📋 Preview dos pedidos</div>
  <div style="overflow-x:auto;max-height:600px;">
    <table style="width:100%;font-size:11px;border-collapse:collapse;">
      <thead><tr style="background:#FAFAFA;position:sticky;top:0;">
        <th style="padding:8px;text-align:left;font-size:10px;color:#94A3B8;text-transform:uppercase;">#</th>
        <th style="padding:8px;text-align:left;font-size:10px;color:#94A3B8;text-transform:uppercase;">Pedido</th>
        <th style="padding:8px;text-align:left;font-size:10px;color:#94A3B8;text-transform:uppercase;">Comprador / Fone</th>
        <th style="padding:8px;text-align:left;font-size:10px;color:#94A3B8;text-transform:uppercase;">Destinatário</th>
        <th style="padding:8px;text-align:left;font-size:10px;color:#94A3B8;text-transform:uppercase;">Endereço</th>
        <th style="padding:8px;text-align:left;font-size:10px;color:#94A3B8;text-transform:uppercase;">Itens</th>
        <th style="padding:8px;text-align:right;font-size:10px;color:#94A3B8;text-transform:uppercase;">Total</th>
        <th style="padding:8px;text-align:left;font-size:10px;color:#94A3B8;text-transform:uppercase;">Pgto</th>
        <th style="padding:8px;text-align:center;font-size:10px;color:#94A3B8;text-transform:uppercase;">Entrega</th>
      </tr></thead>
      <tbody>
        ${data.map((o, i) => `<tr style="border-bottom:1px solid #F1F5F9;">
          <td style="padding:6px 8px;color:var(--muted);">${i+1}</td>
          <td style="padding:6px 8px;font-weight:700;color:#9F1239;">#${esc(o.sourceOrderNumber||'')}</td>
          <td style="padding:6px 8px;">
            <div style="font-weight:600;">${esc(o.clientName||'—')}</div>
            <div style="font-size:10px;color:var(--muted);">${esc(o.clientPhone||'')}</div>
          </td>
          <td style="padding:6px 8px;">${esc(o.recipient||'—')}</td>
          <td style="padding:6px 8px;font-size:10px;">${esc((o.deliveryStreet||'')+', '+(o.deliveryNumber||''))}<br/><span style="color:var(--muted);">${esc(o.deliveryNeighborhood||'')}</span></td>
          <td style="padding:6px 8px;font-size:10px;">${(o.items||[]).map(i => esc(i.qty+'× '+i.name)).join('<br/>')}</td>
          <td style="padding:6px 8px;text-align:right;font-weight:700;">${$c(o.total)}</td>
          <td style="padding:6px 8px;font-size:10px;">${esc(o.payment||'')}</td>
          <td style="padding:6px 8px;text-align:center;font-size:10px;">${esc(o.scheduledDate||'')}<br/>${esc(o.scheduledPeriod||'')}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>
</div>
`}
`;
}

export function bindImportarPedidosEvents() {
  const render = () => import('../main.js').then(m => m.render()).catch(()=>{});

  document.getElementById('btn-imp-load-default')?.addEventListener('click', async () => {
    try {
      toast('⏳ Carregando JSON...');
      const r = await fetch('/import-pedidos-maes-2026.json');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      _importData = await r.json();
      toast(`✅ ${_importData.length} pedidos carregados`);
      render();
    } catch(e) {
      toast('❌ Erro ao carregar: ' + e.message, true);
    }
  });

  document.getElementById('imp-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    try {
      const txt = await file.text();
      _importData = JSON.parse(txt);
      if (!Array.isArray(_importData)) throw new Error('JSON precisa ser um array');
      toast(`✅ ${_importData.length} pedidos carregados`);
      render();
    } catch(e) { toast('❌ Erro: ' + e.message, true); }
  });

  document.getElementById('btn-imp-parse-text')?.addEventListener('click', () => {
    const txt = document.getElementById('imp-json')?.value;
    if (!txt) { toast('Cole o JSON primeiro', true); return; }
    try {
      _importData = JSON.parse(txt);
      if (!Array.isArray(_importData)) throw new Error('Precisa ser um array');
      toast(`✅ ${_importData.length} pedidos carregados`);
      render();
    } catch(e) { toast('❌ JSON inválido: ' + e.message, true); }
  });

  document.getElementById('btn-imp-clear')?.addEventListener('click', () => {
    if (_importProgress.running) { toast('Aguarde a importação terminar', true); return; }
    _importData = null;
    _importResults = [];
    _importProgress = { running:false, ok:0, fail:0, total:0, current:'' };
    render();
  });

  document.getElementById('btn-imp-go')?.addEventListener('click', async () => {
    if (!_importData?.length) return;
    if (!confirm(`Importar ${_importData.length} pedidos? Cada um vira um registro novo no sistema.`)) return;
    _importProgress = { running:true, ok:0, fail:0, total:_importData.length, current:'' };
    _importResults = [];
    render();

    for (const p of _importData) {
      _importProgress.current = p.sourceOrderNumber || '?';
      render();
      // Remove campos auxiliares (não enviar)
      const payload = { ...p };
      delete payload.sourceOrderNumber;
      delete payload.createdAtOriginal;
      try {
        const saved = await POST('/orders', payload);
        if (saved && saved._id) {
          _importProgress.ok++;
          _importResults.push({ numero: p.sourceOrderNumber, status:'ok', message: `→ ${saved.orderNumber || saved.numero || saved._id}` });
          // Adiciona ao S.orders para aparecer na listagem
          if (S.orders) S.orders.unshift(saved);
        } else throw new Error('Resposta sem _id');
      } catch(e) {
        _importProgress.fail++;
        _importResults.push({ numero: p.sourceOrderNumber, status:'fail', message: e?.message || String(e) });
      }
      await new Promise(r => setTimeout(r, 250));
    }

    _importProgress.running = false;
    _importProgress.current = '';
    toast(`✅ ${_importProgress.ok} importados · ❌ ${_importProgress.fail} falhas`);
    render();
  });
}
