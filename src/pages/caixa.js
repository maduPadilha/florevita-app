// ── CAIXA ─────────────────────────────────────────────────────
import { S } from '../state.js';
import { $c, $d, fmtOrderNum } from '../utils/formatters.js';
import { GET, POST } from '../services/api.js';
import { toast } from '../utils/helpers.js';
import { can, findColab } from '../services/auth.js';

// ── DATA — migrado de localStorage para API ──────────────────

export async function getCaixaRegistros() {
  try { return await GET('/caixa'); }
  catch { return JSON.parse(localStorage.getItem('fv_caixa') || '[]'); }
}

export async function saveCaixaRegistro(registro) {
  try { return await POST('/caixa', registro); }
  catch {
    // fallback localStorage
    const registros = JSON.parse(localStorage.getItem('fv_caixa') || '[]');
    const idx = registros.findIndex(r => r.id === registro.id);
    if (idx >= 0) registros[idx] = registro; else registros.push(registro);
    localStorage.setItem('fv_caixa', JSON.stringify(registros));
  }
}

// sync version for backward compat
export function getCaixaRegistrosSync() {
  return JSON.parse(localStorage.getItem('fv_caixa') || '[]');
}
export function saveCaixaRegistrosSync(r) {
  localStorage.setItem('fv_caixa', JSON.stringify(r));
}

// ── RENDER ───────────────────────────────────────────────────

export function renderCaixa() {
  const unit = S.user.unit;
  const unitOk = ['Loja Novo Aleixo', 'Loja Allegro Mall'].includes(unit) || (S.user.role === 'Administrador');
  if (!unitOk) return `<div class="empty card"><div class="empty-icon">\uD83D\uDEAB</div><p>Modulo Caixa disponivel apenas para Loja Novo Aleixo e Loja Allegro Mall.</p></div>`;

  const registros = getCaixaRegistrosSync();
  const hoje = new Date().toISOString().split('T')[0];
  const caixaHoje = registros.find(r => r.date === hoje && r.unit === (unit === 'Todas' ? S._caixaUnit || 'Loja Novo Aleixo' : unit));
  const unidadeSel = unit === 'Todas' ? (S._caixaUnit || 'Loja Novo Aleixo') : unit;
  const historico = registros.filter(r => r.unit === unidadeSel).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 15);

  const PAGOS_CX = ['Pago','Aprovado','Pago na Entrega'];
  const pedidosHoje = S.orders.filter(o => {
    const d = new Date(o.createdAt).toISOString().split('T')[0];
    return d === hoje && o.unit === unidadeSel && o.status !== 'Cancelado' && PAGOS_CX.includes(o.paymentStatus);
  });
  const totalVendas = pedidosHoje.reduce((s, o) => s + (o.total || 0), 0);

  // ── DINHEIRO RECEBIDO POR ENTREGADORES (Pago na Entrega + Dinheiro) ──
  const entregasDinheiroHoje = S.orders.filter(o => {
    const d = new Date(o.updatedAt||o.createdAt).toISOString().split('T')[0];
    return d === hoje && o.unit === unidadeSel &&
           o.status === 'Entregue' &&
           o.payment === 'Pagar na Entrega' &&
           o.paymentOnDelivery === 'Dinheiro' &&
           o.paymentStatus === 'Pago na Entrega';
  });
  // Agrupa por entregador
  const dinheiroPorEntregador = {};
  entregasDinheiroHoje.forEach(o => {
    const driver = o.driverName || 'Sem entregador';
    if(!dinheiroPorEntregador[driver]) dinheiroPorEntregador[driver] = { total:0, pedidos:[] };
    dinheiroPorEntregador[driver].total += (o.total||0);
    dinheiroPorEntregador[driver].pedidos.push(o);
  });
  const totalDinheiroEntregadores = Object.values(dinheiroPorEntregador).reduce((s,d) => s + d.total, 0);

  const statusCaixa = !caixaHoje ? 'fechado' : !caixaHoje.fechamento ? 'aberto' : 'encerrado';

  return `
${S.user.role === 'Administrador' ? `
<div style="display:flex;gap:8px;margin-bottom:14px;align-items:center;">
  <label class="fl" style="margin:0">Unidade:</label>
  <select class="fi" id="caixa-unit-sel" style="width:auto;">
    <option value="Loja Novo Aleixo" ${unidadeSel === 'Loja Novo Aleixo' ? 'selected' : ''}>Loja Novo Aleixo</option>
    <option value="Loja Allegro Mall" ${unidadeSel === 'Loja Allegro Mall' ? 'selected' : ''}>Loja Allegro Mall</option>
  </select>
</div>` : ''}

<!-- Status do Caixa -->
<div class="card" style="margin-bottom:16px;border-left:4px solid ${statusCaixa === 'aberto' ? 'var(--leaf)' : statusCaixa === 'encerrado' ? 'var(--muted)' : 'var(--gold)'};">
  <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
    <div>
      <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">${unidadeSel} \u2014 ${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}</div>
      <div style="font-size:20px;font-weight:700;color:${statusCaixa === 'aberto' ? 'var(--leaf)' : statusCaixa === 'encerrado' ? 'var(--muted)' : 'var(--gold)'};">
        ${statusCaixa === 'aberto' ? '\uD83D\uDFE2 Caixa Aberto' : statusCaixa === 'encerrado' ? '\uD83D\uDD12 Caixa Encerrado' : '\uD83D\uDD34 Caixa Fechado'}
      </div>
      ${caixaHoje ? `<div style="font-size:11px;color:var(--muted);margin-top:4px">
        ${caixaHoje.abertura ? 'Aberto as ' + caixaHoje.abertura.hora + ' por ' + caixaHoje.abertura.usuario : ''}
        ${caixaHoje.fechamento ? ' \u00B7 Fechado as ' + caixaHoje.fechamento.hora : ''}
      </div>` : ''}
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      ${statusCaixa === 'fechado' ? `<button class="btn btn-green" id="btn-abrir-caixa">\uD83D\uDCB5 Abrir Caixa</button>` : ''}
      ${statusCaixa === 'aberto' ? `
        <button class="btn btn-outline btn-sm" id="btn-sangria">\uD83D\uDCE4 Sangria</button>
        <button class="btn btn-outline btn-sm" id="btn-suprimento">\uD83D\uDCE5 Suprimento</button>
        <button class="btn btn-red" id="btn-fechar-caixa">\uD83D\uDD12 Fechar Caixa</button>
      ` : ''}
      ${statusCaixa === 'encerrado' ? `<button class="btn btn-ghost btn-sm" id="btn-reimprimir-caixa">\uD83D\uDDA8\uFE0F Reimprimir Fechamento</button>` : ''}
    </div>
  </div>
</div>

<!-- Metricas do dia -->
${caixaHoje ? `
<div class="g4" style="margin-bottom:16px;">
  <div class="mc leaf"><div class="mc-label">Saldo Abertura</div><div class="mc-val">${$c(caixaHoje.abertura?.saldo || 0)}</div></div>
  <div class="mc rose"><div class="mc-label">Vendas PDV (Pago)</div><div class="mc-val">${$c(totalVendas)}</div></div>
  <div class="mc gold"><div class="mc-label">Sangrias</div><div class="mc-val">${$c((caixaHoje.movimentos || []).filter(m => m.tipo === 'Sangria').reduce((s, m) => s + m.valor, 0))}</div></div>
  <div class="mc blue"><div class="mc-label">Saldo Atual Estimado</div><div class="mc-val">${$c(
    (caixaHoje.abertura?.saldo || 0) + totalVendas
    - (caixaHoje.movimentos || []).filter(m => m.tipo === 'Sangria').reduce((s, m) => s + m.valor, 0)
    + (caixaHoje.movimentos || []).filter(m => m.tipo === 'Suprimento').reduce((s, m) => s + m.valor, 0)
  )}</div></div>
</div>

<!-- Dinheiro recebido por entregadores -->
${Object.keys(dinheiroPorEntregador).length > 0 ? `
<div class="card" style="margin-bottom:16px;border-left:4px solid #F97316;background:linear-gradient(135deg,#FFF7ED,#fff);">
  <div class="card-title" style="display:flex;align-items:center;justify-content:space-between;">
    <span>💵 Dinheiro recebido por entregadores</span>
    <span style="background:#F97316;color:#fff;padding:3px 10px;border-radius:12px;font-size:13px;font-weight:800;">${$c(totalDinheiroEntregadores)}</span>
  </div>
  <div style="font-size:11px;color:var(--muted);margin-bottom:10px;">
    Valores recebidos em dinheiro nas entregas de hoje (precisam ser devolvidos ao caixa)
  </div>
  ${Object.entries(dinheiroPorEntregador).sort((a,b)=>b[1].total-a[1].total).map(([driver, info]) => `
  <div style="background:#fff;border:1px solid #FED7AA;border-radius:10px;padding:12px 14px;margin-bottom:8px;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
      <div style="font-weight:700;font-size:14px;color:#7C2D12;">🚚 ${driver}</div>
      <div style="font-weight:800;font-size:16px;color:#F97316;">${$c(info.total)}</div>
    </div>
    <div style="font-size:11px;color:var(--muted);">
      ${info.pedidos.length} entrega(s): ${info.pedidos.map(p => fmtOrderNum(p)).join(', ')}
    </div>
  </div>`).join('')}
</div>` : ''}

<!-- Movimentos do dia -->
<div class="card" style="margin-bottom:16px;">
  <div class="card-title">\uD83D\uDCCB Movimentos do Dia</div>
  ${pedidosHoje.length === 0 && (caixaHoje.movimentos || []).length === 0 ? `<div class="empty"><p>Nenhum movimento ainda</p></div>` : `
  <div class="tw"><table><thead><tr><th>Hora</th><th>Tipo</th><th>Descricao</th><th>Valor</th></tr></thead><tbody>
    <tr><td>${caixaHoje.abertura?.hora || '\u2014'}</td><td><span class="tag t-green">Abertura</span></td><td>Saldo inicial</td><td style="font-weight:600;color:var(--leaf)">${$c(caixaHoje.abertura?.saldo || 0)}</td></tr>
    ${(caixaHoje.movimentos || []).map(m => `<tr>
      <td>${m.hora}</td>
      <td><span class="tag ${m.tipo === 'Sangria' ? 't-red' : 't-blue'}">${m.tipo}</span></td>
      <td>${m.descricao}</td>
      <td style="font-weight:600;color:${m.tipo === 'Sangria' ? 'var(--red)' : 'var(--blue)'}">${m.tipo === 'Sangria' ? '\u2212' : '+'} ${$c(m.valor)}</td>
    </tr>`).join('')}
    ${pedidosHoje.map(o => `<tr>
      <td>${new Date(o.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</td>
      <td><span class="tag t-rose">Venda</span></td>
      <td>${fmtOrderNum(o)} \u2014 ${o.client?.name || o.clientName || '\u2014'} (${o.payment})</td>
      <td style="font-weight:600;color:var(--rose)">+ ${$c(o.total)}</td>
    </tr>`).join('')}
    ${caixaHoje.fechamento ? `<tr style="background:var(--cream)">
      <td>${caixaHoje.fechamento.hora}</td><td><span class="tag t-gray">Fechamento</span></td>
      <td>Caixa encerrado por ${caixaHoje.fechamento.usuario}</td>
      <td style="font-weight:700">${$c(caixaHoje.fechamento.saldoFinal)}</td>
    </tr>` : ''}
  </tbody></table></div>`}
</div>` : ''}

<!-- Historico -->
<div class="card">
  <div class="card-title">\uD83D\uDCC5 Historico de Caixas</div>
  ${historico.length === 0 ? `<div class="empty"><p>Nenhum caixa registrado ainda</p></div>` : `
  <div class="tw"><table><thead><tr><th>Data</th><th>Unidade</th><th>Abertura</th><th>Fechamento</th><th>Saldo Abertura</th><th>Saldo Final</th><th>Status</th></tr></thead><tbody>
  ${historico.map(r => `<tr>
    <td>${new Date(r.date + 'T12:00').toLocaleDateString('pt-BR')}</td>
    <td style="font-size:11px">${r.unit}</td>
    <td>${r.abertura?.hora || '\u2014'}</td>
    <td>${r.fechamento?.hora || '\u2014'}</td>
    <td>${$c(r.abertura?.saldo || 0)}</td>
    <td style="font-weight:600">${r.fechamento ? $c(r.fechamento.saldoFinal) : '\u2014'}</td>
    <td><span class="tag ${r.fechamento ? 't-gray' : 't-green'}">${r.fechamento ? 'Encerrado' : 'Aberto'}</span></td>
  </tr>`).join('')}
  </tbody></table></div>`}
</div>`;
}

// ── BIND EVENTS ──────────────────────────────────────────────

export function bindCaixaEvents() {
  const render = () => import('../main.js').then(m => m.render()).catch(() => {});
  const unit = S.user.unit === 'Todas' ? (S._caixaUnit || 'Loja Novo Aleixo') : S.user.unit;
  const hoje = new Date().toISOString().split('T')[0];

  // Selector unidade (admin)
  document.getElementById('caixa-unit-sel')?.addEventListener('change', e => {
    S._caixaUnit = e.target.value;
    render();
  });

  // Abrir Caixa
  {
    const _el = document.getElementById('btn-abrir-caixa');
    if (_el) _el.onclick = () => {
      S._modal = `<div class="mo" id="mo"><div class="mo-box" style="max-width:420px" onclick="event.stopPropagation()">
        <div class="mo-title">\uD83D\uDCB5 Abrir Caixa \u2014 ${unit}</div>
        <div class="alert al-info" style="margin-bottom:14px;">Informe o fundo de caixa (troco disponivel no inicio do dia).</div>
        <div class="fg"><label class="fl">Fundo de Caixa (R$) *</label>
          <input class="fi" id="cx-saldo" type="number" step="0.01" placeholder="0,00" value="0" style="font-size:20px;text-align:center;font-weight:700;"/>
        </div>
        <div class="mo-foot">
          <button class="btn btn-green" id="btn-cx-confirm" style="flex:1;justify-content:center;padding:11px">\u2705 Abrir Caixa</button>
          <button class="btn btn-ghost" id="btn-mo-close">Cancelar</button>
        </div>
      </div></div>`;
      render();
      setTimeout(() => {
        document.getElementById('btn-mo-close')?.addEventListener('click', () => { S._modal = ''; render(); });
        document.getElementById('cx-saldo')?.focus();
        document.getElementById('btn-cx-confirm')?.addEventListener('click', () => {
          const saldo = parseFloat(document.getElementById('cx-saldo')?.value) || 0;
          const registros = getCaixaRegistrosSync();
          const existente = registros.find(r => r.date === hoje && r.unit === unit);
          if (existente) { toast('\u26A0\uFE0F Caixa ja aberto hoje!'); S._modal = ''; render(); return; }
          const newReg = {
            id: Date.now() + '', date: hoje, unit,
            abertura: { hora: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }), usuario: S.user.name, saldo },
            movimentos: [], fechamento: null
          };
          registros.push(newReg);
          saveCaixaRegistrosSync(registros);
          saveCaixaRegistro(newReg).catch(() => {});
          S._modal = '';
          toast('\u2705 Caixa aberto com fundo de ' + $c(saldo));
          render();
        });
      }, 50);
    };
  }

  // Sangria
  {
    const _el = document.getElementById('btn-sangria');
    if (_el) _el.onclick = () => {
      S._modal = `<div class="mo" id="mo"><div class="mo-box" style="max-width:420px" onclick="event.stopPropagation()">
        <div class="mo-title">\uD83D\uDCE4 Sangria de Caixa</div>
        <div class="fg"><label class="fl">Valor (R$) *</label><input class="fi" id="cx-val" type="number" step="0.01" placeholder="0,00" value=""/></div>
        <div class="fg"><label class="fl">Motivo *</label>
          <select class="fi" id="cx-desc">
            <option value="Recolhimento">Recolhimento</option>
            <option value="Pagamento fornecedor">Pagamento fornecedor</option>
            <option value="Despesa operacional">Despesa operacional</option>
            <option value="Outro">Outro...</option>
          </select>
        </div>
        <div class="mo-foot">
          <button class="btn btn-red" id="btn-cx-confirm" style="flex:1;justify-content:center">\u2705 Registrar Sangria</button>
          <button class="btn btn-ghost" id="btn-mo-close">Cancelar</button>
        </div>
      </div></div>`;
      render();
      setTimeout(() => {
        document.getElementById('btn-mo-close')?.addEventListener('click', () => { S._modal = ''; render(); });
        document.getElementById('btn-cx-confirm')?.addEventListener('click', () => {
          const valor = parseFloat(document.getElementById('cx-val')?.value) || 0;
          if (!valor || valor <= 0) return toast('\u274C Informe o valor da sangria');
          const desc = document.getElementById('cx-desc')?.value || 'Recolhimento';
          const registros = getCaixaRegistrosSync();
          const idx = registros.findIndex(r => r.date === hoje && r.unit === unit && !r.fechamento);
          if (idx < 0) return toast('\u274C Caixa nao esta aberto');
          registros[idx].movimentos.push({
            tipo: 'Sangria', valor, descricao: desc,
            hora: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
            usuario: S.user.name
          });
          saveCaixaRegistrosSync(registros);
          saveCaixaRegistro(registros[idx]).catch(() => {});
          S._modal = '';
          toast('\uD83D\uDCE4 Sangria de ' + $c(valor) + ' registrada');
          render();
        });
      }, 50);
    };
  }

  // Suprimento
  {
    const _el = document.getElementById('btn-suprimento');
    if (_el) _el.onclick = () => {
      S._modal = `<div class="mo" id="mo"><div class="mo-box" style="max-width:420px" onclick="event.stopPropagation()">
        <div class="mo-title">\uD83D\uDCE5 Suprimento de Caixa</div>
        <div class="fg"><label class="fl">Valor (R$) *</label><input class="fi" id="cx-val" type="number" step="0.01" placeholder="0,00" value=""/></div>
        <div class="fg"><label class="fl">Motivo *</label>
          <select class="fi" id="cx-desc">
            <option value="Reforco de caixa">Reforco de caixa</option>
            <option value="Troco adicional">Troco adicional</option>
            <option value="Outro">Outro...</option>
          </select>
        </div>
        <div class="mo-foot">
          <button class="btn btn-blue" id="btn-cx-confirm" style="flex:1;justify-content:center">\u2705 Registrar Suprimento</button>
          <button class="btn btn-ghost" id="btn-mo-close">Cancelar</button>
        </div>
      </div></div>`;
      render();
      setTimeout(() => {
        document.getElementById('btn-mo-close')?.addEventListener('click', () => { S._modal = ''; render(); });
        document.getElementById('btn-cx-confirm')?.addEventListener('click', () => {
          const valor = parseFloat(document.getElementById('cx-val')?.value) || 0;
          if (!valor || valor <= 0) return toast('\u274C Informe o valor do suprimento');
          const desc = document.getElementById('cx-desc')?.value || 'Reforco de caixa';
          const registros = getCaixaRegistrosSync();
          const idx = registros.findIndex(r => r.date === hoje && r.unit === unit && !r.fechamento);
          if (idx < 0) return toast('\u274C Caixa nao esta aberto');
          registros[idx].movimentos.push({
            tipo: 'Suprimento', valor, descricao: desc,
            hora: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
            usuario: S.user.name
          });
          saveCaixaRegistrosSync(registros);
          saveCaixaRegistro(registros[idx]).catch(() => {});
          S._modal = '';
          toast('\uD83D\uDCE5 Suprimento de ' + $c(valor) + ' registrado');
          render();
        });
      }, 50);
    };
  }

  // Fechar Caixa
  {
    const _el = document.getElementById('btn-fechar-caixa');
    if (_el) _el.onclick = () => {
      const registros = getCaixaRegistrosSync();
      const reg = registros.find(r => r.date === hoje && r.unit === unit && !r.fechamento);
      const PAGOS_F = ['Pago','Aprovado','Pago na Entrega'];
      const hoje_vendas = S.orders.filter(o => {
        const d = new Date(o.createdAt).toISOString().split('T')[0];
        return d === hoje && o.unit === unit && o.status !== 'Cancelado' && PAGOS_F.includes(o.paymentStatus);
      });
      const totalVendas = hoje_vendas.reduce((s, o) => s + (o.total || 0), 0);

      // Dinheiro recebido por entregadores (não está no caixa ainda)
      const entregasDin = S.orders.filter(o => {
        const d = new Date(o.updatedAt||o.createdAt).toISOString().split('T')[0];
        return d === hoje && o.unit === unit && o.status === 'Entregue' &&
               o.payment === 'Pagar na Entrega' && o.paymentOnDelivery === 'Dinheiro' &&
               o.paymentStatus === 'Pago na Entrega';
      });
      const dinPorDriver = {};
      entregasDin.forEach(o => {
        const drv = o.driverName || 'Sem entregador';
        if(!dinPorDriver[drv]) dinPorDriver[drv] = 0;
        dinPorDriver[drv] += (o.total||0);
      });
      const totalDinEntreg = Object.values(dinPorDriver).reduce((s,v) => s+v, 0);

      const saldoFundo = reg?.abertura?.saldo || 0;
      const sangrias = (reg?.movimentos || []).filter(m => m.tipo === 'Sangria').reduce((s, m) => s + m.valor, 0);
      const suprimentos = (reg?.movimentos || []).filter(m => m.tipo === 'Suprimento').reduce((s, m) => s + m.valor, 0);
      const saldoEsperado = saldoFundo + totalVendas - sangrias + suprimentos;

      S._modal = `<div class="mo" id="mo"><div class="mo-box" style="max-width:500px" onclick="event.stopPropagation()">
        <div class="mo-title">\uD83D\uDD12 Fechar Caixa \u2014 ${unit}</div>
        <div style="background:var(--cream);border-radius:var(--r);padding:14px;margin-bottom:14px;">
          ${[['Fundo de abertura', $c(saldoFundo), 'var(--muted)'],
             ['Vendas PDV (pagas)', $c(totalVendas), 'var(--leaf)'],
             ['Sangrias', '\u2212 ' + $c(sangrias), 'var(--red)'],
             ['Suprimentos', '+ ' + $c(suprimentos), 'var(--blue)'],
             ['Saldo esperado', $c(saldoEsperado), 'var(--rose)'],
          ].map(([l, v, c]) => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px;">
            <span style="color:var(--muted)">${l}</span><span style="font-weight:700;color:${c}">${v}</span>
          </div>`).join('')}
        </div>

        ${totalDinEntreg > 0 ? `
        <div style="background:linear-gradient(135deg,#FFF7ED,#fff);border:2px solid #F97316;border-radius:12px;padding:12px 14px;margin-bottom:14px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <span style="font-weight:700;color:#7C2D12;font-size:13px;">💵 Dinheiro com entregadores</span>
            <span style="background:#F97316;color:#fff;padding:2px 10px;border-radius:10px;font-weight:800;font-size:13px;">${$c(totalDinEntreg)}</span>
          </div>
          <div style="font-size:11px;color:#7C2D12;margin-bottom:8px;">Valores a recolher dos entregadores ao final do dia:</div>
          ${Object.entries(dinPorDriver).sort((a,b)=>b[1]-a[1]).map(([drv, val]) => `
          <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:12px;">
            <span style="color:#78350F;">🚚 ${drv}</span>
            <strong style="color:#F97316;">${$c(val)}</strong>
          </div>`).join('')}
        </div>` : ''}

        <div class="fg"><label class="fl">Saldo Fisico Contado (R$) *</label>
          <input class="fi" id="cx-saldo" type="number" step="0.01" placeholder="0,00" value="${saldoEsperado.toFixed(2)}" style="font-size:20px;text-align:center;font-weight:700;"/>
          <div id="cx-diff" style="font-size:12px;margin-top:4px;text-align:center;"></div>
        </div>
        <div class="mo-foot">
          <button class="btn btn-red" id="btn-cx-confirm" style="flex:1;justify-content:center;padding:11px">\uD83D\uDD12 Confirmar Fechamento</button>
          <button class="btn btn-ghost" id="btn-mo-close">Cancelar</button>
        </div>
      </div></div>`;
      render();
      setTimeout(() => {
        document.getElementById('btn-mo-close')?.addEventListener('click', () => { S._modal = ''; render(); });
        document.getElementById('cx-saldo')?.addEventListener('input', e => {
          const contado = parseFloat(e.target.value) || 0;
          const diff = contado - saldoEsperado;
          const el = document.getElementById('cx-diff');
          if (el) el.innerHTML = `Diferenca: <strong style="color:${Math.abs(diff) < 0.01 ? 'var(--leaf)' : diff < 0 ? 'var(--red)' : 'var(--gold)'}">${diff >= 0 ? '+' : ''}${$c(diff)}</strong>`;
        });
        document.getElementById('btn-cx-confirm')?.addEventListener('click', () => {
          const saldoFinal = parseFloat(document.getElementById('cx-saldo')?.value) || 0;
          if (!reg) { toast('\u274C Caixa nao encontrado'); S._modal = ''; render(); return; }
          const idx = registros.indexOf(reg);
          registros[idx].fechamento = {
            hora: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
            usuario: S.user.name,
            saldoFinal,
            saldoEsperado,
            diferenca: saldoFinal - saldoEsperado
          };
          saveCaixaRegistrosSync(registros);
          saveCaixaRegistro(registros[idx]).catch(() => {});
          S._modal = '';
          toast('\uD83D\uDD12 Caixa encerrado com sucesso!');
          render();
        });
      }, 50);
    };
  }

  // Reimprimir
  {
    const _el = document.getElementById('btn-reimprimir-caixa');
    if (_el) _el.onclick = () => window.print();
  }
}
