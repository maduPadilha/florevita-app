// ── AUDITORIA & SEGURANCA (admin only) ───────────────────────
import { S } from '../state.js';
import { GET, POST } from '../services/api.js';
import { toast } from '../utils/helpers.js';

async function render() {
  const { render: r } = await import('../main.js');
  r();
}

function isAdmin() {
  return S.user?.role === 'Administrador' || S.user?.cargo === 'admin';
}

// ── STATE LOCAL ─────────────────────────────────────────────
let _logs = [];
let _total = 0;
let _security = [];
let _summary = null;
let _loaded = false;

async function loadLogs(opts = {}) {
  const qs = new URLSearchParams();
  if (S._auditUser)   qs.set('userId',   S._auditUser);
  if (S._auditAction) qs.set('action',   S._auditAction);
  if (S._auditModule) qs.set('module',   S._auditModule);
  if (S._auditRisk)   qs.set('risk',     S._auditRisk);
  if (S._auditDateFrom) qs.set('dateFrom', S._auditDateFrom);
  if (S._auditDateTo)   qs.set('dateTo',   S._auditDateTo);
  if (S._auditQuery)  qs.set('q',        S._auditQuery);
  qs.set('limit', '200');
  try {
    const [data, sec, sum] = await Promise.all([
      GET('/audit-logs?' + qs.toString()),
      GET('/audit-logs/security'),
      GET('/audit-logs/summary'),
    ]);
    _logs = data?.logs || [];
    _total = data?.total || 0;
    _security = sec || [];
    _summary = sum || null;
    _loaded = true;
    render();
  } catch (e) {
    toast('❌ Falha ao carregar logs: ' + (e.message || ''), true);
  }
}

// ── RISK/ACTION BADGES ──────────────────────────────────────
const RISK_STYLES = {
  normal: { bg:'#F0FDF4', fg:'#166534', border:'#86EFAC', label:'Normal' },
  warn:   { bg:'#FFFBEB', fg:'#92400E', border:'#FCD34D', label:'⚠️ Atenção' },
  alert:  { bg:'#FEE2E2', fg:'#991B1B', border:'#FCA5A5', label:'🚨 ALERTA' },
};
const ACTION_LABELS = {
  login: '🔓 Login',
  logout: '🔒 Logout',
  login_failed: '❌ Login falhou',
  view: '👁️ Visualização',
  create: '➕ Criar',
  update: '✏️ Editar',
  delete: '🗑️ Excluir',
  edit_order: '✏️ Editar Pedido',
  clear_audit_logs: '🧹 Limpou Logs',
  emit_nota: '📄 Emitir NF',
  cancel_nota: '🚫 Cancelar NF',
  config_change: '⚙️ Config',
  block_user: '🔒 Bloqueio',
  unlock_user: '🔓 Desbloqueio',
  export: '📤 Export',
  import: '📥 Import',
  other: '—',
};

function riskBadge(risk) {
  const s = RISK_STYLES[risk] || RISK_STYLES.normal;
  return `<span style="background:${s.bg};color:${s.fg};border:1px solid ${s.border};padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700;white-space:nowrap;">${s.label}</span>`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { timeZone: 'America/Manaus' });
}

function deviceIcon(device) {
  if (device === 'Celular') return '📱';
  if (device === 'Tablet')  return '📱';
  if (device === 'TV')      return '📺';
  return '💻';
}

// ── RENDER ──────────────────────────────────────────────────
export function renderAuditLogs() {
  if (!isAdmin()) {
    return `<div class="empty card"><div class="empty-icon">🚫</div><p>Apenas administradores podem acessar os logs de auditoria.</p></div>`;
  }

  if (!_loaded) {
    loadLogs();
    return `<div class="card" style="padding:40px 20px;text-align:center;">
      <div style="font-size:36px;margin-bottom:10px;">🔒</div>
      <div>Carregando logs de auditoria...</div>
    </div>`;
  }

  const tab = S._auditTab || 'logs';
  const tabBtn = (k, l) => `<button class="tab ${tab===k?'active':''}" data-audit-tab="${k}">${l}</button>`;

  return `
<div class="card" style="margin-bottom:14px;">
  <div class="card-title">🔒 Auditoria & Segurança
    <span style="font-size:11px;color:var(--muted);font-weight:normal;margin-left:8px;">Somente administradores</span>
  </div>
  <p style="font-size:12px;color:var(--muted);">Todas as ações relevantes do sistema ficam registradas aqui de forma imutável.</p>
</div>

${_summary ? `
<div class="g4" style="margin-bottom:14px;">
  <div class="mc leaf"><div class="mc-label">Eventos hoje</div><div class="mc-val">${_summary.totalHoje}</div></div>
  <div class="mc rose"><div class="mc-label">Últimos 7 dias</div><div class="mc-val">${_summary.totalSemana}</div></div>
  <div class="mc" style="background:#FEE2E2;"><div class="mc-label" style="color:#991B1B;">🚨 Alertas (24h)</div><div class="mc-val" style="color:#991B1B;">${_summary.alertas24h}</div></div>
  <div class="mc" style="background:#1F2937;color:#fff;"><div class="mc-label" style="color:#D1D5DB;">🔒 Bloqueados</div><div class="mc-val" style="color:#fff;">${_summary.bloqueados}</div></div>
</div>
` : ''}

<div class="tabs" style="margin-bottom:14px;">
  ${tabBtn('logs','📋 Logs')}
  ${tabBtn('security','🛡️ Segurança por usuário')}
  ${tabBtn('alerts','🚨 Alertas recentes')}
</div>

${tab === 'logs' ? renderLogsTab() : ''}
${tab === 'security' ? renderSecurityTab() : ''}
${tab === 'alerts' ? renderAlertsTab() : ''}
`;
}

function renderLogsTab() {
  const users = [...new Set(_logs.map(l => l.userName).filter(Boolean))].sort();
  const modules = [...new Set(_logs.map(l => l.module).filter(Boolean))].sort();
  const actions = Object.keys(ACTION_LABELS);

  return `
<div class="card" style="margin-bottom:14px;">
  <div class="card-title">Filtros</div>
  <div class="g3" style="gap:10px;margin-bottom:8px;">
    <div class="fg"><label class="fl">🔍 Buscar</label>
      <input class="fi" id="audit-q" value="${S._auditQuery||''}" placeholder="Nome, e-mail, IP..."/>
    </div>
    <div class="fg"><label class="fl">👤 Colaborador</label>
      <select class="fi" id="audit-user">
        <option value="">Todos</option>
        ${users.map(u => `<option value="${u}" ${S._auditUser===u?'selected':''}>${u}</option>`).join('')}
      </select>
    </div>
    <div class="fg"><label class="fl">⚡ Ação</label>
      <select class="fi" id="audit-action">
        <option value="">Todas</option>
        ${actions.map(a => `<option value="${a}" ${S._auditAction===a?'selected':''}>${ACTION_LABELS[a]}</option>`).join('')}
      </select>
    </div>
  </div>
  <div class="g3" style="gap:10px;">
    <div class="fg"><label class="fl">📁 Módulo</label>
      <select class="fi" id="audit-module">
        <option value="">Todos</option>
        ${modules.map(m => `<option value="${m}" ${S._auditModule===m?'selected':''}>${m}</option>`).join('')}
      </select>
    </div>
    <div class="fg"><label class="fl">🚦 Nível de risco</label>
      <select class="fi" id="audit-risk">
        <option value="">Todos</option>
        <option value="normal" ${S._auditRisk==='normal'?'selected':''}>✅ Normal</option>
        <option value="warn"   ${S._auditRisk==='warn'?'selected':''}>⚠️ Atenção</option>
        <option value="alert"  ${S._auditRisk==='alert'?'selected':''}>🚨 Alerta</option>
      </select>
    </div>
    <div class="fg" style="display:flex;gap:6px;">
      <div style="flex:1;"><label class="fl">📅 De</label>
        <input type="date" class="fi" id="audit-date-from" value="${S._auditDateFrom||''}"/>
      </div>
      <div style="flex:1;"><label class="fl">Até</label>
        <input type="date" class="fi" id="audit-date-to" value="${S._auditDateTo||''}"/>
      </div>
    </div>
  </div>
  <div style="margin-top:10px;display:flex;gap:6px;justify-content:flex-end;">
    <button class="btn btn-ghost btn-sm" id="btn-audit-clear">✕ Limpar</button>
    <button class="btn btn-primary btn-sm" id="btn-audit-apply">🔍 Aplicar filtros</button>
  </div>
</div>

<div class="card">
  <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;">
    <span>📋 Registros <span class="notif">${_logs.length} de ${_total}</span></span>
    ${S.user?.role === 'Administrador' ? `<button class="btn btn-sm" id="btn-clear-audit" style="background:#DC2626;color:#fff;">🗑️ Limpar Registros</button>` : ''}
  </div>
  ${_logs.length === 0 ? `<div class="empty"><p>Nenhum log com esses filtros.</p></div>` : `
  <div style="overflow-x:auto;">
    <table style="width:100%;font-size:11px;">
      <thead><tr style="text-align:left;border-bottom:2px solid var(--border);">
        <th style="padding:6px;">Data/Hora</th>
        <th>Colaborador</th>
        <th>Ação</th>
        <th>Módulo</th>
        <th>Dispositivo</th>
        <th>IP</th>
        <th>Risco</th>
        <th>Detalhes</th>
      </tr></thead>
      <tbody>
        ${_logs.map(l => {
          const riskRow = l.risk === 'alert' ? 'background:#FEF2F2;' :
                         l.risk === 'warn' ? 'background:#FFFBEB;' : '';
          return `<tr style="border-bottom:1px solid var(--border);${riskRow}">
            <td style="padding:7px 6px;white-space:nowrap;font-variant-numeric:tabular-nums;">${fmtDate(l.createdAt)}</td>
            <td>
              <div style="font-weight:600;">${l.userName || '—'}</div>
              <div style="font-size:10px;color:var(--muted);">${l.userEmail || ''}</div>
            </td>
            <td><span style="font-weight:600;">${ACTION_LABELS[l.action] || l.action}</span>${l.blocked ? '<br><span style="background:#DC2626;color:#fff;font-size:9px;padding:1px 5px;border-radius:4px;">BLOQUEADO</span>' : ''}</td>
            <td>${l.module || '—'}</td>
            <td>${deviceIcon(l.device)} ${l.device}<br><span style="font-size:9px;color:var(--muted);">${l.browser} · ${l.os}</span></td>
            <td style="font-family:monospace;font-size:10px;">${l.ip || '—'}</td>
            <td>${riskBadge(l.risk)}
              ${l.riskReasons?.length ? `<div style="font-size:9px;color:var(--muted);margin-top:3px;">${l.riskReasons.join(' · ')}</div>` : ''}
            </td>
            <td style="font-size:10px;max-width:280px;">
              ${l.meta?.orderNumber ? `<div style="font-weight:600;color:var(--rose);">Pedido ${l.meta.orderNumber}</div>` : ''}
              ${Array.isArray(l.meta?.diff) && l.meta.diff.length ? l.meta.diff.slice(0, 5).map(d => {
                const de  = String(d.de  ?? '—').slice(0, 40);
                const para= String(d.para?? '—').slice(0, 40);
                return `<div style="margin-top:2px;"><strong>${d.campo}:</strong> <span style="color:#991B1B;text-decoration:line-through;">${de}</span> → <span style="color:#065F46;font-weight:600;">${para}</span></div>`;
              }).join('') + (l.meta.diff.length > 5 ? `<div style="color:var(--muted);">+${l.meta.diff.length-5} alterações</div>` : '') : ''}
              ${l.meta?.apagados !== undefined ? `<div><strong>Logs apagados:</strong> ${l.meta.apagados}</div>` : ''}
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>`}
</div>
  `;
}

function renderSecurityTab() {
  if (!_security.length) return `<div class="card empty"><p>Nenhum usuário com atividade registrada.</p></div>`;

  const scoreColor = (s) => {
    if (s >= 80) return '#991B1B';
    if (s >= 60) return '#D97706';
    if (s >= 30) return '#F59E0B';
    return '#166534';
  };

  return `
<div class="card">
  <div class="card-title">🛡️ Score de Risco por Colaborador
    <span style="font-size:11px;font-weight:normal;color:var(--muted);margin-left:6px;">Ordenado por maior risco</span>
  </div>
  <div style="display:flex;flex-direction:column;gap:10px;">
    ${_security.map(s => `
      <div style="border:2px solid ${s.blocked ? '#DC2626' : 'var(--border)'};border-radius:10px;padding:14px;background:${s.blocked ? '#FEF2F2' : '#fff'};">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
          <div>
            <div style="font-weight:700;font-size:14px;">${s.userName || s.userEmail}
              ${s.blocked ? '<span style="background:#DC2626;color:#fff;font-size:10px;padding:2px 8px;border-radius:999px;margin-left:6px;">🔒 BLOQUEADO</span>' : ''}
            </div>
            <div style="font-size:11px;color:var(--muted);">${s.userEmail}</div>
            ${s.blocked ? `<div style="font-size:11px;color:#991B1B;margin-top:4px;"><strong>Motivo:</strong> ${s.blockedReason} · ${fmtDate(s.blockedAt)}</div>` : ''}
          </div>
          <div style="text-align:right;">
            <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;">Score</div>
            <div style="font-size:28px;font-weight:800;color:${scoreColor(s.riskScore)};">${s.riskScore}</div>
            <div style="font-size:10px;font-weight:600;color:${scoreColor(s.riskScore)};text-transform:uppercase;">${s.riskLevel||'low'}</div>
          </div>
        </div>
        <div style="display:flex;gap:16px;margin-top:10px;padding-top:10px;border-top:1px dashed var(--border);font-size:11px;">
          <div><strong>${s.knownDevices?.length || 0}</strong> dispositivo${s.knownDevices?.length===1?'':'s'}</div>
          <div><strong>${s.knownIps?.length || 0}</strong> IP${s.knownIps?.length===1?'':'s'}</div>
          <div><strong style="color:#991B1B;">${s.alertCount || 0}</strong> alerta${s.alertCount===1?'':'s'}</div>
        </div>
        ${s.knownDevices?.length ? `
          <details style="margin-top:8px;">
            <summary style="font-size:11px;color:var(--muted);cursor:pointer;">Ver dispositivos conhecidos</summary>
            <div style="margin-top:6px;display:flex;flex-direction:column;gap:4px;">
              ${s.knownDevices.map(d => `
                <div style="display:flex;gap:8px;align-items:center;padding:6px 8px;background:var(--cream);border-radius:6px;font-size:11px;">
                  <span>${deviceIcon(d.device)}</span>
                  <span style="flex:1;">${d.browser} · ${d.os} · <span style="color:var(--muted);">${d.loginCount || 0}x</span></span>
                  ${d.trusted ? '<span style="background:#D1FAE5;color:#065F46;padding:1px 6px;border-radius:4px;font-size:9px;font-weight:600;">✓ CONFIÁVEL</span>' : `<button class="btn btn-ghost btn-xs" data-trust="${s.userId}|${d.deviceId}">Marcar confiável</button>`}
                </div>
              `).join('')}
            </div>
          </details>
        ` : ''}
        ${s.blocked ? `
          <div style="margin-top:10px;display:flex;justify-content:flex-end;">
            <button class="btn btn-primary btn-sm" data-unblock="${s.userId}">🔓 Desbloquear ${s.userName || s.userEmail}</button>
          </div>
        ` : ''}
      </div>
    `).join('')}
  </div>
</div>
  `;
}

function renderAlertsTab() {
  const alerts = _logs.filter(l => l.risk === 'alert');
  if (!alerts.length) {
    return `<div class="card" style="padding:40px;text-align:center;">
      <div style="font-size:56px;margin-bottom:12px;">✅</div>
      <div style="font-size:16px;font-weight:700;">Nenhum alerta no período</div>
      <div style="font-size:12px;color:var(--muted);">Operação segura!</div>
    </div>`;
  }

  return `
<div class="card">
  <div class="card-title" style="color:#991B1B;">🚨 Alertas de Segurança <span class="notif" style="background:#DC2626;color:#fff;">${alerts.length}</span></div>
  <div style="display:flex;flex-direction:column;gap:8px;">
    ${alerts.map(a => `
      <div style="background:#FEF2F2;border-left:5px solid #DC2626;border-radius:8px;padding:12px 14px;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
          <div style="font-weight:700;color:#7F1D1D;">${a.userName || a.userEmail || 'Desconhecido'} · ${ACTION_LABELS[a.action] || a.action}</div>
          <div style="font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums;">${fmtDate(a.createdAt)}</div>
        </div>
        <div style="font-size:11px;color:#991B1B;margin-top:4px;">
          ${deviceIcon(a.device)} ${a.device} · ${a.browser} · ${a.os} · IP <strong>${a.ip}</strong>
        </div>
        ${a.riskReasons?.length ? `<div style="font-size:11px;color:#7F1D1D;margin-top:4px;font-style:italic;">⚠️ ${a.riskReasons.join(' · ')}</div>` : ''}
      </div>
    `).join('')}
  </div>
</div>
  `;
}

// ── BIND EVENTS ─────────────────────────────────────────────
export function bindAuditLogsEvents() {
  document.querySelectorAll('[data-audit-tab]').forEach(b => {
    b.onclick = () => { S._auditTab = b.dataset.auditTab; render(); };
  });

  const apply = () => {
    S._auditQuery    = document.getElementById('audit-q')?.value || '';
    S._auditUser     = document.getElementById('audit-user')?.value || '';
    S._auditAction   = document.getElementById('audit-action')?.value || '';
    S._auditModule   = document.getElementById('audit-module')?.value || '';
    S._auditRisk     = document.getElementById('audit-risk')?.value || '';
    S._auditDateFrom = document.getElementById('audit-date-from')?.value || '';
    S._auditDateTo   = document.getElementById('audit-date-to')?.value || '';
    loadLogs();
  };
  document.getElementById('btn-audit-apply')?.addEventListener('click', apply);

  // Botao Limpar Registros — admin only, dupla confirmacao
  document.getElementById('btn-clear-audit')?.addEventListener('click', async () => {
    if (S.user?.role !== 'Administrador') return toast('❌ Apenas Administrador', true);
    const opt = prompt('Apagar registros de quanto tempo atras?\n\nDigite o numero de DIAS (ex: 30 = mais antigos que 30 dias)\nOu deixe VAZIO e clique OK para apagar TODOS.\n\nCancelar para abortar.');
    if (opt === null) return;
    const olderThanDays = opt.trim() ? parseInt(opt) : 0;
    const msg = olderThanDays > 0
      ? `Apagar logs com mais de ${olderThanDays} dias?`
      : 'APAGAR TODOS OS REGISTROS DE AUDITORIA? Essa acao e irreversivel.';
    if (!confirm(msg)) return;
    const conf = prompt('Para confirmar, digite a palavra: LIMPAR');
    if (conf !== 'LIMPAR') return toast('Cancelado', true);
    try {
      const { api } = await import('../services/api.js');
      const r = await api('DELETE', '/audit-logs/clear', { confirm: 'LIMPAR', olderThanDays });
      toast(`✅ ${r.deleted || 0} registros apagados`);
      loadLogs();
    } catch (e) { toast('❌ ' + e.message, true); }
  });
  document.getElementById('btn-audit-clear')?.addEventListener('click', () => {
    S._auditQuery=''; S._auditUser=''; S._auditAction=''; S._auditModule='';
    S._auditRisk=''; S._auditDateFrom=''; S._auditDateTo=''; loadLogs();
  });

  document.querySelectorAll('[data-unblock]').forEach(b => {
    b.onclick = async () => {
      const userId = b.dataset.unblock;
      if (!confirm('Desbloquear este colaborador?')) return;
      try {
        await POST('/audit-logs/unblock/' + userId, {});
        toast('✅ Colaborador desbloqueado');
        loadLogs();
      } catch (e) { toast('❌ ' + e.message, true); }
    };
  });

  document.querySelectorAll('[data-trust]').forEach(b => {
    b.onclick = async () => {
      const [userId, deviceId] = b.dataset.trust.split('|');
      try {
        await POST('/audit-logs/trust-device/' + userId, { deviceId });
        toast('✅ Dispositivo marcado como confiável');
        loadLogs();
      } catch (e) { toast('❌ ' + e.message, true); }
    };
  });
}
