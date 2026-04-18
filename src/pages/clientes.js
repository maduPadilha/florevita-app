import { S, BAIRROS_MANAUS } from '../state.js';
import { $c, $d, sc, ini, segc, esc } from '../utils/formatters.js';
import { GET, POST, PUT, DELETE } from '../services/api.js';
import { toast } from '../utils/helpers.js';
import { can } from '../services/auth.js';
import { invalidateCache } from '../services/cache.js';

// ── CSV/JSON Import/Export helpers ────────────────────────────
function toCSV(rows, columns){
  const header = columns.join(';');
  const lines = rows.map(r => columns.map(c => {
    const val = c.split('.').reduce((o,k)=>o?.[k], r) ?? '';
    const str = String(val).replace(/"/g,'""');
    return /[;"\n]/.test(str) ? `"${str}"` : str;
  }).join(';'));
  return '\uFEFF' + header + '\n' + lines.join('\n');
}
function downloadFile(content, filename, mime='text/csv'){
  const blob = new Blob([content], {type: mime});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
function parseCSV(text){
  const lines = text.replace(/^\uFEFF/,'').split(/\r?\n/).filter(l=>l.trim());
  if(!lines.length) return [];
  const header = lines[0].split(';');
  return lines.slice(1).map(line => {
    const values = line.split(';');
    const obj = {};
    header.forEach((h,i) => obj[h.trim()] = (values[i]||'').trim());
    return obj;
  });
}

// ── Helper: render() via dynamic import ───────────────────────
async function render(){
  const { render:r } = await import('../main.js');
  r();
}

// ── Helper: setPage via dynamic import ────────────────────────
async function setPage(pg){
  const { setPage:sp } = await import('../main.js');
  sp(pg);
}

// ── DATAS ESPECIAIS — Funções de acesso (migrado para API) ───
export async function getDatasEspeciais(clientId){
  if(!clientId) return [];
  try {
    const data = await GET('/settings/datas-especiais-'+clientId);
    return data?.value || [];
  } catch {
    // fallback localStorage
    const all = JSON.parse(localStorage.getItem('fv_datas_especiais')||'{}');
    return all[clientId] || [];
  }
}

export async function saveDatasEspeciais(clientId, datas){
  if(!clientId) return;
  try {
    await PUT('/settings/datas-especiais-'+clientId, { value: datas });
  } catch {
    // fallback localStorage
    const all = JSON.parse(localStorage.getItem('fv_datas_especiais')||'{}');
    all[clientId] = datas;
    localStorage.setItem('fv_datas_especiais', JSON.stringify(all));
  }
}

// ── VERIFICA DATAS ESPECIAIS -> gera alertas (executar diariamente) ─
export function checkDatasEspeciaisAlertas(){
  // Leitura sincrona do localStorage como fallback para alertas em render
  const all = JSON.parse(localStorage.getItem('fv_datas_especiais')||'{}');
  const alertas = [];
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const amanha = new Date(hoje); amanha.setDate(hoje.getDate()+1);
  const emDoisDias = new Date(hoje); emDoisDias.setDate(hoje.getDate()+2);

  Object.entries(all).forEach(([clientId, datas])=>{
    const client = S.clients.find(c=>c._id===clientId);
    if(!client) return;
    (datas||[]).forEach(d=>{
      if(!d.data) return;
      // Reconstroi a data com o ANO ATUAL para ver se bate amanha
      const parts = d.data.split('-'); // YYYY-MM-DD ou MM-DD
      const mes = parts.length===3 ? parseInt(parts[1])-1 : parseInt(parts[0])-1;
      const dia = parts.length===3 ? parseInt(parts[2]) : parseInt(parts[1]);
      const dataEsteAno = new Date(hoje.getFullYear(), mes, dia);
      dataEsteAno.setHours(0,0,0,0);
      // Se ja passou este ano, verifica no proximo
      if(dataEsteAno < hoje) dataEsteAno.setFullYear(hoje.getFullYear()+1);

      const diffDias = Math.round((dataEsteAno - hoje) / (1000*60*60*24));

      if(diffDias === 1 || diffDias === 0){
        const urgencia = diffDias === 0 ? 'HOJE' : 'AMANHA';
        alertas.push({
          clientId, client,
          tipo: d.tipo, pessoa: d.pessoa, motivo: d.motivo,
          data: d.data, dataEsteAno, diffDias, urgencia,
        });
      }
    });
  });
  return alertas;
}

// ── Helper sincrono para datas especiais no render ───────────
function getDatasEspeciaisSync(clientId){
  if(!clientId) return [];
  const all = JSON.parse(localStorage.getItem('fv_datas_especiais')||'{}');
  return all[clientId] || [];
}

// ── SISTEMA DE TIERS (CRM) ─────────────────────────────────
// Classifica cliente por quantidade de pedidos concluídos
// Exportado para uso em PDV, Comanda e outros módulos
const TIER_DEFS = {
  diamante:   { tier:'diamante',   label:'Diamante',   icon:'💎', color:'#7C3AED', bg:'#EDE9FE', border:'#C4B5FD' },
  vip:        { tier:'vip',        label:'VIP',        icon:'⭐', color:'#D97706', bg:'#FEF3C7', border:'#FCD34D' },
  recorrente: { tier:'recorrente', label:'Recorrente', icon:'💐', color:'#1D4ED8', bg:'#DBEAFE', border:'#93C5FD' },
  novo:       { tier:'novo',       label:'Novo',       icon:'🌱', color:'#059669', bg:'#D1FAE5', border:'#6EE7B7' },
};

export const TIER_ORDER = ['novo','recorrente','vip','diamante'];

// Permissão para alterar tier manualmente / configurar numeração
// Admin sempre pode; delegável via modulos.clientTier = true
export function canManageClientTier(){
  const u = S.user;
  if(!u) return false;
  if(u.cargo === 'admin' || u.role === 'Administrador') return true;
  if(u.modulos && u.modulos.clientTier === true) return true;
  return false;
}

function tierByCount(totalOrders = 0){
  const n = parseInt(totalOrders) || 0;
  if(n >= 10) return TIER_DEFS.diamante;
  if(n >= 3)  return TIER_DEFS.vip;
  if(n >= 1)  return TIER_DEFS.recorrente;
  return TIER_DEFS.novo;
}

// Aceita número (legado) OU objeto cliente; respeita tierOverride quando definido
export function getClientTier(input = 0){
  if(input && typeof input === 'object'){
    const ov = input.tierOverride;
    if(ov && TIER_DEFS[ov]) return { ...TIER_DEFS[ov], overridden: true };
    return tierByCount(input.totalOrders || 0);
  }
  return tierByCount(input);
}

// Helper: badge HTML do tier (usado em PDV e comanda)
// Aceita número (compat) ou objeto cliente (para respeitar tierOverride)
export function tierBadgeHTML(totalOrdersOrClient, opts = {}){
  const t = getClientTier(totalOrdersOrClient);
  const totalOrders = (totalOrdersOrClient && typeof totalOrdersOrClient === 'object')
    ? (totalOrdersOrClient.totalOrders || 0)
    : totalOrdersOrClient;
  const size = opts.size || 'md'; // xs|sm|md|lg
  const padding = size==='xs' ? '2px 7px' : size==='sm' ? '3px 9px' : size==='lg' ? '6px 14px' : '4px 11px';
  const fontSize = size==='xs' ? '10px' : size==='sm' ? '11px' : size==='lg' ? '14px' : '12px';
  const iconSize = size==='xs' ? '11px' : size==='sm' ? '13px' : size==='lg' ? '18px' : '15px';
  const gap = size==='xs' ? '3px' : '5px';
  const showCount = opts.showCount !== false;
  return `<span title="Nível ${t.label}" style="display:inline-flex;align-items:center;gap:${gap};background:${t.bg};color:${t.color};border:1px solid ${t.border};border-radius:20px;padding:${padding};font-size:${fontSize};font-weight:700;white-space:nowrap;line-height:1.2;">
    <span style="font-size:${iconSize};line-height:1;">${t.icon}</span><span>${t.label}</span>${showCount ? `<span style="opacity:.75;font-weight:500;">· ${totalOrders} ped.</span>` : ''}
  </span>`;
}

// Busca cliente + stats por id/telefone (usado por PDV e comanda)
export function getClientWithStats(identifier){
  if(!identifier) return null;
  const id = identifier._id || identifier;
  const phone = String(identifier.phone || identifier.clientPhone || '').replace(/\D/g,'');

  let client = null;
  if(id && typeof id === 'string'){
    client = (S.clients||[]).find(c => c._id === id);
  }
  if(!client && phone){
    client = (S.clients||[]).find(c => String(c.phone||c.telefone||'').replace(/\D/g,'') === phone);
  }
  if(!client) return null;
  const stats = computeClientStats(client);
  return { ...client, ...stats };
}

// ── ESTATÍSTICAS DE CLIENTE (calculadas dinamicamente a partir de S.orders) ──
function computeClientStats(client){
  const cleanPhone = (p) => (p||'').replace(/\D/g,'');
  const clientPhone = cleanPhone(client.phone || client.telefone);
  const clientId = client._id;
  const clientName = (client.name || client.nome || '').toLowerCase().trim();

  const orders = (S.orders || []).filter(o => {
    // Não conta cancelados nas estatísticas
    if(o.status === 'Cancelado') return false;
    // Match por id/clientId
    if(o.client === clientId || o.clientId === clientId) return true;
    // Match por telefone (mais confiável em pedidos legados)
    if(clientPhone){
      const op = cleanPhone(o.clientPhone || o.cliente?.telefone || '');
      if(op && op === clientPhone) return true;
    }
    // Match por nome exato como fallback (evita match errado)
    if(clientName){
      const on = (o.clientName || o.cliente?.nome || '').toLowerCase().trim();
      if(on && on === clientName) return true;
    }
    return false;
  });

  const totalOrders = orders.length;
  const totalSpent  = orders.reduce((sum, o) => sum + (parseFloat(o.total) || 0), 0);
  // Última compra (mais recente)
  const lastOrder = orders.length > 0
    ? orders.reduce((a, b) => new Date(a.createdAt||0) > new Date(b.createdAt||0) ? a : b)
    : null;
  const ultimaCompra = lastOrder ? lastOrder.createdAt : null;

  return { totalOrders, totalSpent, ultimaCompra, ordersCache: orders };
}

// Enriquece todos os clientes com estatísticas calculadas (não persiste)
function enrichClientsWithStats(clients){
  return clients.map(c => {
    const stats = computeClientStats(c);
    return { ...c, totalOrders: stats.totalOrders, totalSpent: stats.totalSpent, ultimaCompra: stats.ultimaCompra };
  });
}

// ── CLIENTES ─────────────────────────────────────────────────
export function renderClientes(){
  const q = (S._clientSearch||'').toLowerCase();
  // Enriquece clientes com estatísticas calculadas a partir de S.orders
  const clientsWithStats = enrichClientsWithStats(S.clients || []);
  const list = clientsWithStats.filter(c=>!q||c.name?.toLowerCase().includes(q)||c.phone?.includes(q)||c.email?.toLowerCase().includes(q));
  S._filteredClients = list;
  // Se há cliente selecionado, recalcula suas estatísticas (para refletir novos pedidos)
  const sel = S._clientSel
    ? clientsWithStats.find(c => c._id === S._clientSel._id) || S._clientSel
    : null;

  return`
<div style="display:flex;gap:8px;margin-bottom:14px;align-items:center;flex-wrap:wrap;">
  <div class="search-box" style="flex:1;min-width:160px;">
    <span class="si">&#128269;</span>
    <input class="fi" id="cli-search" placeholder="Buscar por nome, telefone ou e-mail..." value="${S._clientSearch||''}"/>
  </div>
  ${S.user?.role === 'Administrador' ? `
    <button class="btn btn-blue btn-sm" id="btn-import-cli">&#128229; Importar</button>
    <button class="btn btn-green btn-sm" id="btn-export-cli">&#128228; Exportar</button>
    <input type="file" id="file-import-cli" accept=".csv,.json" style="display:none" />
  ` : ''}
  <button class="btn btn-primary" id="btn-new-cli">&#10133; Novo Cliente</button>
</div>

<div class="g2">
  <!-- Lista -->
  <div class="card" style="padding:0;overflow:hidden;">
    <div style="padding:12px 14px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">
      <span style="font-weight:600">Clientes <span class="notif">${S.clients.length}</span></span>
      <span style="font-size:11px;color:var(--muted)">${list.length} exibidos</span>
    </div>
    ${list.length===0?`<div class="empty" style="padding:30px"><div class="empty-icon">&#128101;</div><p>Nenhum cliente encontrado</p></div>`:`
    <div style="overflow-x:auto;">
    <table>
      <thead><tr><th>Cliente</th><th>WhatsApp</th><th>Segmento</th><th>Pedidos</th><th></th></tr></thead>
      <tbody>${list.map(c=>`<tr style="cursor:pointer" data-cli="${c._id}">
        <td>
          <div style="display:flex;align-items:center;gap:8px;">
            <div class="av" style="width:30px;height:30px;font-size:11px;">${ini(c.name)}</div>
            <div>
              <div style="font-weight:600;font-size:13px">${c.name}${(()=>{const al=checkDatasEspeciaisAlertas().filter(a=>a.clientId===c._id);const ds=getDatasEspeciaisSync(c._id);return al.length?`<span style="background:var(--red);color:#fff;border-radius:10px;padding:0 5px;font-size:9px;margin-left:4px">&#127874; ${al[0].urgencia}</span>`:ds.length?`<span style="font-size:11px;margin-left:4px;color:var(--muted)">&#127874;&times;${ds.length}</span>`:'';})()}</div>
              ${c.email?`<div style="font-size:10px;color:var(--muted)">${c.email}</div>`:''}
            </div>
          </div>
        </td>
        <td style="color:var(--muted);font-size:12px">${c.phone||'\u2014'}</td>
        <td><span class="tag ${segc(c.segment||'Novo')}">${c.segment||'Novo'}</span></td>
        <td>
          <div style="display:flex;flex-direction:row;align-items:center;gap:6px;white-space:nowrap;">
            <span style="font-weight:800;color:var(--rose);font-size:16px;line-height:1;">${c.totalOrders||0}</span>
            ${tierBadgeHTML(c, {size:'xs', showCount:false})}
          </div>
        </td>
        <td style="white-space:nowrap;">
          <button type="button" class="btn btn-ghost btn-xs btn-edit-cli" data-cid="${c._id}" title="Editar">&#9998;&#65039; Editar</button>
          <button type="button" class="btn-del-cli" data-cid="${c._id}" style="background:var(--red-l);color:var(--red);border:1px solid rgba(220,38,38,.2);border-radius:6px;padding:3px 7px;cursor:pointer;font-size:12px;">&#128465;&#65039; Excluir</button>
        </td>
      </tr>`).join('')}</tbody>
    </table>
    </div>`}
  </div>

  <!-- Painel direito: detalhe ou vazio -->
  ${sel ? `
  <div>
  <div class="card">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <div style="display:flex;align-items:center;gap:10px;">
        <div class="av" style="width:44px;height:44px;font-size:16px;">${ini(sel.name)}</div>
        <div>
          <div style="font-weight:700;font-size:15px">${sel.name}</div>
          <span class="tag ${segc(sel.segment||'Novo')}">${sel.segment||'Novo'}</span>
        </div>
      </div>
      <button class="btn btn-ghost btn-sm" id="btn-cli-close">&times;</button>
    </div>

    ${(()=>{
      const t = getClientTier(sel);
      const canEdit = canManageClientTier();
      return `
      <div style="background:${t.bg};border:2px solid ${t.border};border-radius:12px;padding:12px 14px;margin-bottom:14px;display:flex;align-items:center;gap:12px;">
        <div style="font-size:32px;">${t.icon}</div>
        <div style="flex:1;">
          <div style="font-size:10px;color:${t.color};opacity:.8;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Nível do Cliente${t.overridden?' · manual':''}</div>
          <div style="font-size:18px;font-weight:700;color:${t.color};">${t.label}</div>
          <div style="font-size:11px;color:${t.color};opacity:.85;margin-top:2px;">${sel.totalOrders||0} pedido(s) · ${t.overridden?'nível definido manualmente':'calculado automaticamente'}</div>
        </div>
        ${canEdit ? `<button type="button" class="btn btn-ghost btn-xs" id="btn-edit-tier" data-cid="${sel._id}" title="Alterar nível manualmente">&#9998;&#65039;</button>` : ''}
      </div>`;
    })()}

    <div class="g2" style="margin-bottom:12px;">
      <div><div style="font-size:10px;color:var(--muted)">WhatsApp</div><div style="font-weight:500">${sel.phone||'\u2014'}</div></div>
      <div><div style="font-size:10px;color:var(--muted)">E-mail</div><div style="font-size:12px">${sel.email||'\u2014'}</div></div>
      <div><div style="font-size:10px;color:var(--muted)">Total Pedidos</div><div style="font-size:20px;font-weight:700;color:var(--rose)">${sel.totalOrders||0}</div></div>
      <div><div style="font-size:10px;color:var(--muted)">Total Gasto</div><div style="font-size:16px;font-weight:700;color:var(--leaf)">${$c(sel.totalSpent||0)}</div></div>
      ${sel.birthday?`<div><div style="font-size:10px;color:var(--muted)">Aniversario</div><div style="font-size:12px">&#127874; ${sel.birthday}</div></div>`:''}
      ${sel.cpf?`<div><div style="font-size:10px;color:var(--muted)">CPF</div><div style="font-size:12px">${sel.cpf}</div></div>`:''}
    </div>

    ${sel.address?.street?`<div style="padding:10px;background:var(--cream);border-radius:8px;margin-bottom:12px;font-size:12px;">
      <div style="font-size:10px;color:var(--muted);margin-bottom:3px;">&#128205; Endereco</div>
      ${sel.address.street}, ${sel.address.number} \u2014 ${sel.address.neighborhood}
      ${sel.address.cep?`<span style="color:var(--muted)"> \u00B7 CEP ${sel.address.cep}</span>`:''}
    </div>`:''}

    ${sel.notes?`<div style="padding:10px;background:var(--petal);border-radius:8px;margin-bottom:12px;font-size:12px;">
      <div style="font-size:10px;color:var(--muted);margin-bottom:3px;">&#128221; Observacoes</div>
      ${sel.notes}
    </div>`:''}

    <div style="display:flex;gap:6px;flex-wrap:wrap;">
      <a href="https://wa.me/55${(sel.phone||'').replace(/\\D/g,'')}" target="_blank" class="btn btn-green btn-sm">&#128241; WhatsApp</a>
      <button type="button" class="btn btn-primary btn-sm btn-edit-cli-detail" data-cid="${sel._id}">&#9998;&#65039; Editar</button>
      <button class="btn btn-ghost btn-sm" id="btn-cli-new-order">&#128722; Novo Pedido</button>
      <button type="button" class="btn-del-cli-detail" data-cid="${sel._id}" style="background:var(--red-l);color:var(--red);border:1px solid rgba(220,38,38,.2);border-radius:8px;padding:8px 16px;cursor:pointer;font-size:13px;font-weight:600;">&#128465;&#65039; Excluir</button>
    </div>
  </div>

  ${(()=>{
    const client = sel;
    const clientOrders = S.orders
      .filter(o => {
        if (o.client === client._id || o.clientId === client._id) return true;
        const clientPhone = (client.phone || client.telefone || '').replace(/\D/g,'');
        const orderPhone = (o.clientPhone || o.cliente?.telefone || '').replace(/\D/g,'');
        if (clientPhone && orderPhone && clientPhone === orderPhone) return true;
        return false;
      })
      .sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
    return `
    <div class="card" style="margin-top:16px;">
      <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <span>&#128230; Historico de Compras</span>
        <span style="font-size:11px;color:var(--muted);">${clientOrders.length} ${clientOrders.length===1?'pedido':'pedidos'}</span>
      </div>
      ${clientOrders.length === 0 ? `
        <div style="text-align:center;padding:30px 20px;color:var(--muted);">
          <div style="font-size:36px;margin-bottom:8px;opacity:.5;">&#128203;</div>
          <div style="font-size:13px;">Nenhum pedido registrado</div>
        </div>
      ` : `
        <div style="max-height:500px;overflow-y:auto;">
          ${clientOrders.map(o => {
            const num = ((o.orderNumber||o.numero||'')+'').replace(/^PED-?/i,'');
            const numFmt = num ? '#'+num.padStart(5,'0') : '\u2014';
            const itemsList = (o.items||[]).map(i => `${i.qty||i.quantidade||1}x ${esc(i.name||i.nome||'')}`).join(', ');
            return `
            <div style="border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:10px;background:#fff;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:6px;">
                <div>
                  <span style="font-weight:700;color:var(--rose);font-size:13px;">${numFmt}</span>
                  <span style="color:var(--muted);font-size:11px;margin-left:8px;">${$d(o.createdAt)}</span>
                </div>
                <div style="display:flex;gap:4px;flex-wrap:wrap;">
                  <span class="tag ${sc(o.status)}" style="font-size:9px;">${o.status||'\u2014'}</span>
                  <span class="tag t-gray" style="font-size:9px;">${o.type||'Delivery'}</span>
                </div>
              </div>
              <div style="font-size:12px;color:var(--ink);margin-bottom:6px;line-height:1.4;">
                ${itemsList || '\u2014'}
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:11px;color:var(--muted);">
                ${o.recipient?`<div>&#128100; <strong>Para:</strong> ${esc(o.recipient)}</div>`:''}
                <div>&#128179; ${esc(o.payment || '\u2014')}</div>
                ${o.deliveryNeighborhood?`<div>&#128205; ${esc(o.deliveryNeighborhood)}</div>`:''}
                <div style="text-align:right;font-weight:700;color:var(--ink);font-size:13px;">${$c(o.total||0)}</div>
              </div>
              ${o.notes?`<div style="background:#FEF3C7;border-radius:6px;padding:6px 10px;margin-top:8px;font-size:11px;color:#92400E;">&#9888;&#65039; ${esc(o.notes)}</div>`:''}
              <div style="display:flex;gap:6px;margin-top:8px;">
                <button class="btn btn-ghost btn-xs" data-repeat-order="${o._id}" title="Repetir pedido">&#128260; Repetir</button>
                <button class="btn btn-ghost btn-xs" data-view-order="${o._id}" title="Ver detalhes">&#128065;&#65039; Ver</button>
              </div>
            </div>`;
          }).join('')}
        </div>
      `}
    </div>`;
  })()}
  </div>
  ` : `
  <div class="card" style="display:flex;align-items:center;justify-content:center;flex-direction:column;gap:8px;min-height:220px;color:var(--muted);">
    <div style="font-size:42px">&#128100;</div>
    <div style="font-size:13px">Selecione um cliente para ver detalhes</div>
  </div>`}
</div>`;
}

// ── MODAL: ADICIONAR DATA ESPECIAL ────────────────────────────
export async function showAddDataEspecialModal(clientId, onSave){
  const TIPOS = ['Aniversario','Namoro','Casamento','Dia das Maes','Dia dos Pais','Formatura','Outro'];
  const prevModal = S._modal;
  S._modal=`<div class="mo" id="mo-data" onclick="if(event.target===this){document.getElementById('mo-data').remove();}">
  <div class="mo-box" style="max-width:420px;" onclick="event.stopPropagation()">
    <div style="font-family:'Playfair Display',serif;font-size:17px;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--border);">
      &#127874; Nova Data Especial
    </div>
    <div class="fr2" style="gap:10px;">
      <div class="fg">
        <label class="fl">Tipo da data *</label>
        <select class="fi" id="de-tipo">
          ${TIPOS.map(t=>`<option>${t}</option>`).join('')}
        </select>
      </div>
      <div class="fg">
        <label class="fl">Nome da pessoa *</label>
        <input class="fi" id="de-pessoa" placeholder="Ex: Maria, Esposa, Mae"/>
      </div>
      <div class="fg">
        <label class="fl">Data (dia/mes) *</label>
        <input class="fi" id="de-data" type="date" max="2099-12-31"/>
      </div>
      <div class="fg">
        <label class="fl">Motivo / Observacao</label>
        <input class="fi" id="de-motivo" placeholder="Ex: Bouquet surpresa"/>
      </div>
    </div>
    <div style="background:var(--petal);border-radius:8px;padding:10px;font-size:11px;color:var(--rose);margin-top:8px;margin-bottom:16px;">
      &#128161; O sistema alertara automaticamente 1 dia antes desta data todo ano.
    </div>
    <div style="display:flex;gap:8px;">
      <button class="btn btn-primary" id="btn-de-save" style="flex:1;justify-content:center;">&#128190; Salvar Data</button>
      <button class="btn btn-ghost" id="btn-de-cancel">Cancelar</button>
    </div>
  </div></div>`;
  await render();

  document.getElementById('btn-de-cancel')?.addEventListener('click',()=>{
    S._modal=''; render();
    if(onSave) onSave();
  });
  document.getElementById('btn-de-save')?.addEventListener('click', async ()=>{
    const tipo   = document.getElementById('de-tipo')?.value||'';
    const pessoa = document.getElementById('de-pessoa')?.value?.trim()||'';
    const data   = document.getElementById('de-data')?.value||'';
    const motivo = document.getElementById('de-motivo')?.value?.trim()||'';

    if(!pessoa) return toast('Nome da pessoa e obrigatorio');
    if(!data)   return toast('Data e obrigatoria');

    // Valida data
    const d = new Date(data);
    if(isNaN(d.getTime())) return toast('Data invalida');

    const datas = await getDatasEspeciais(clientId||'');
    // Evita duplicata
    const existe = datas.find(x=>x.tipo===tipo&&x.pessoa===pessoa&&x.data===data);
    if(existe) return toast('Esta data ja esta cadastrada');

    datas.push({tipo, pessoa, data, motivo, criadoEm: new Date().toISOString()});
    await saveDatasEspeciais(clientId||'', datas);
    toast(`Data "${tipo} de ${pessoa}" cadastrada!`);
    S._modal=''; render();
    if(onSave) onSave();
  });
}

// ── MODAL CLIENTE ─────────────────────────────────────────────
export async function showClientModal(client=null){
  const edit = !!client;
  const SEGMENTS = ['Novo','Frequente','VIP','Corporativo','Inativo'];
  const datasSync = getDatasEspeciaisSync(client?._id||'');

  S._modal=`<div class="mo" id="mo" onclick="if(event.target===this){S._modal='';render();}">
  <div class="mo-box" style="max-width:560px;" onclick="event.stopPropagation()">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--border);">
    <div style="font-family:'Playfair Display',serif;font-size:18px;">${edit?'&#9998;&#65039; Editar':'&#10133; Novo'} Cliente</div>
    <button onclick="S._modal='';render();" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--muted)">&times;</button>
  </div>

  <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px;">&#128100; Dados Pessoais</div>
  <div class="fr2">
    <div class="fg" style="grid-column:span 2"><label class="fl">Nome completo *</label>
      <input class="fi" id="cm-name" value="${client?.name||''}" placeholder="Nome do cliente"/></div>
    <div class="fg"><label class="fl">Celular/WhatsApp *</label>
      <input class="fi" id="cm-phone" value="${client?.phone||''}" placeholder="(92) 9xxxx-xxxx"/></div>
    <div class="fg"><label class="fl">CPF <span style="font-size:10px;color:var(--muted);font-weight:400;">(opcional · obrigat\u00F3rio no e-commerce)</span></label>
      <input class="fi" id="cm-cpf" value="${client?.cpf||''}" placeholder="000.000.000-00" maxlength="14" inputmode="numeric"/></div>
    <div class="fg"><label class="fl">Aniversario</label>
      <input class="fi" id="cm-bday" type="date" value="${client?.birthday||''}"/></div>
    <div class="fg"><label class="fl">Segmento</label>
      <select class="fi" id="cm-seg">
        ${SEGMENTS.map(s=>`<option ${client?.segment===s?'selected':''}>${s}</option>`).join('')}
      </select>
    </div>
  </div>

  <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;margin:12px 0 8px;">&#128205; Endereco</div>
  <div class="fr2">
    <div class="fg" style="grid-column:span 2"><label class="fl">Rua</label>
      <input class="fi" id="cm-street" value="${client?.address?.street||''}" placeholder="Rua, Avenida..."/></div>
    <div class="fg"><label class="fl">Numero</label>
      <input class="fi" id="cm-number" value="${client?.address?.number||''}" placeholder="123"/></div>
    <div class="fg"><label class="fl">Bairro</label>
      <input class="fi" id="cm-neigh" value="${client?.address?.neighborhood||''}" placeholder="Bairro"/></div>
    <div class="fg"><label class="fl">CEP</label>
      <input class="fi" id="cm-cep" value="${client?.address?.cep||''}" placeholder="69000-000"/></div>
  </div>

  <!-- ── DATAS ESPECIAIS ──────────────────────────────────── -->
  <hr style="margin:14px 0;border-color:var(--border)"/>
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
    <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;">&#127874; Datas Especiais</div>
    <button type="button" id="btn-add-data-especial" class="btn btn-ghost btn-sm">+ Adicionar data</button>
  </div>
  <div id="datas-especiais-list">
    ${(()=>{
      const datas = datasSync;
      if(!datas.length) return '<div style="font-size:11px;color:var(--muted);padding:8px 0;">Nenhuma data cadastrada.</div>';
      return datas.map((d,i)=>`
      <div class="data-especial-item" style="background:var(--cream);border-radius:8px;padding:8px 10px;margin-bottom:6px;display:flex;align-items:center;gap:8px;">
        <span style="font-size:18px;">${d.tipo==='Aniversario'?'&#127874;':d.tipo==='Namoro'?'&#128149;':d.tipo==='Casamento'?'&#128141;':d.tipo==='Dia das Maes'?'&#128105;':d.tipo==='Dia dos Pais'?'&#128104;':'&#127800;'}</span>
        <div style="flex:1;">
          <div style="font-weight:700;font-size:12px;">${d.tipo} \u2014 ${d.pessoa}</div>
          <div style="font-size:11px;color:var(--muted);">${d.data} ${d.motivo?'\u00B7 '+d.motivo:''}</div>
        </div>
        <button type="button" class="btn-del-data" data-di="${i}" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:14px;">&#128465;&#65039;</button>
      </div>`).join('');
    })()}
  </div>

  <div class="mo-foot">
    <button class="btn btn-primary" id="btn-cm-save" style="flex:1;justify-content:center;">&#128190; ${edit?'Atualizar':'Cadastrar'}</button>
    <button class="btn btn-ghost" id="btn-cm-cancel">Cancelar</button>
  </div>
  </div></div>`;

  await render();
  document.getElementById('btn-cm-cancel')?.addEventListener('click',()=>{S._modal='';render();});
  document.getElementById('btn-cm-save')?.addEventListener('click',()=>saveClient(client?._id));

  // Mascara CPF no modal
  {
    const cpfEl = document.getElementById('cm-cpf');
    if(cpfEl) cpfEl.addEventListener('input', e => { e.target.value = maskCPF(e.target.value); });
  }

  // Datas especiais — adicionar
  document.getElementById('btn-add-data-especial')?.addEventListener('click',()=>{
    showAddDataEspecialModal(client?._id, ()=>showClientModal(client));
  });
  // Datas especiais — remover
  document.querySelectorAll('.btn-del-data').forEach(btn=>btn.addEventListener('click', async ()=>{
    const i = parseInt(btn.dataset.di);
    const datas = await getDatasEspeciais(client?._id||'');
    datas.splice(i,1);
    await saveDatasEspeciais(client?._id||'', datas);
    showClientModal(client);
  }));
}

// ── MASCARA DE CPF ────────────────────────────────────────────
function maskCPF(v){
  const d=(v||'').replace(/\D/g,'').slice(0,11);
  if(d.length>9) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{0,2}).*/,'$1.$2.$3-$4');
  if(d.length>6) return d.replace(/^(\d{3})(\d{3})(\d{0,3}).*/,'$1.$2.$3');
  if(d.length>3) return d.replace(/^(\d{3})(\d{0,3}).*/,'$1.$2');
  return d;
}

// ── SALVAR CLIENTE ────────────────────────────────────────────
export async function saveClient(editId=null){
  const name  = document.getElementById('cm-name')?.value?.trim()||'';
  const phone = document.getElementById('cm-phone')?.value?.trim()||'';
  const cpf   = document.getElementById('cm-cpf')?.value?.trim()||'';
  const bday  = document.getElementById('cm-bday')?.value||'';
  const seg   = document.getElementById('cm-seg')?.value||'Novo';
  const addr  = {
    street:       document.getElementById('cm-street')?.value?.trim()||'',
    number:       document.getElementById('cm-number')?.value?.trim()||'',
    neighborhood: document.getElementById('cm-neigh')?.value?.trim()||'',
    cep:          document.getElementById('cm-cep')?.value?.trim()||'',
    city:         'Manaus',
  };

  if(!name)  return toast('\u274C Nome \u00E9 obrigat\u00F3rio', true);
  if(!phone) return toast('\u274C Celular \u00E9 obrigat\u00F3rio', true);

  // Duplicate check: same name + same phone (digits only)
  const duplicate = S.clients.find(c => {
    if (editId && c._id === editId) return false; // Skip self when editing
    const sameName = (c.name||c.nome||'').toLowerCase().trim() === name.toLowerCase().trim();
    const samePhone = (c.phone||c.telefone||'').replace(/\D/g,'') === phone.replace(/\D/g,'');
    return sameName && samePhone;
  });
  if (duplicate) {
    toast('\u274C J\u00E1 existe um cliente com esse nome e celular', true);
    return;
  }

  S._modal=''; S.loading=true; try{render();}catch(e){}
  try{
    const payload={name,phone,cpf:cpf||undefined,birthday:bday||undefined,segment:seg,address:addr,
      unit:S.user.unit==='Todas'?'Loja Novo Aleixo':S.user.unit};
    let c;
    if(editId){
      c = await PUT('/clients/'+editId, payload);
      S.clients = S.clients.map(x=>x._id===editId?{...x,...payload,...(c||{})}:x);
      if(S._clientSel?._id===editId) S._clientSel={...S._clientSel,...payload,...(c||{})};
    } else {
      // Numeração inicial configurável em /config (apenas permissionados alteram)
      const cfg = JSON.parse(localStorage.getItem('fv_config')||'{}');
      const start = parseInt(cfg.clientCodeStart) || 1;
      // Maior código numérico já existente (ignora formatos não-numéricos)
      const maxExisting = (S.clients||[]).reduce((max, cl) => {
        const m = String(cl.code||'').match(/(\d+)$/);
        const n = m ? parseInt(m[1]) : 0;
        return n > max ? n : max;
      }, 0);
      const nextNum = Math.max(start, maxExisting + 1);
      const code = 'CLI-' + String(nextNum).padStart(4, '0');
      c = await POST('/clients',{...payload,code});
      if(c?._id) S.clients.unshift(c);
    }
    invalidateCache('clients');
    S.loading=false; render();
    toast(editId?`${name} atualizado!`:`${name} cadastrado!`);
  }catch(e){
    S.loading=false; render(); toast('Erro: '+(e.message||''));
  }
}

// ── EXCLUIR CLIENTE ───────────────────────────────────────────
export async function deleteClient(id){
  const c = S.clients.find(x=>x._id===id);
  if(!c) return;
  window._delClientId = id;
  S._modal=`<div class="mo" id="mo" onclick="if(event.target===this){S._modal='';render();}">
  <div class="mo-box" style="max-width:360px;text-align:center;" onclick="event.stopPropagation()">
  <div style="font-size:40px;margin-bottom:10px">&#9888;&#65039;</div>
  <div style="font-family:'Playfair Display',serif;font-size:17px;margin-bottom:6px">Excluir Cliente?</div>
  <div style="font-size:12px;color:var(--muted);margin-bottom:18px;"><strong>${c.name}</strong><br>${c.phone||''}</div>
  <div style="display:flex;gap:8px;justify-content:center;">
    <button class="btn btn-red" id="btn-confirm-del-cli" style="padding:10px 20px;">&#128465;&#65039; Excluir</button>
    <button class="btn btn-ghost" id="btn-cancel-del-cli">Cancelar</button>
  </div></div></div>`;
  await render();

  document.getElementById('btn-confirm-del-cli')?.addEventListener('click',()=>confirmDeleteClient());
  document.getElementById('btn-cancel-del-cli')?.addEventListener('click',()=>{S._modal='';render();});
}

export function confirmDeleteClient(){
  const id = window._delClientId; if(!id) return;
  const c = S.clients.find(x=>x._id===id);
  DELETE('/clients/'+id).then(()=>{
    S.clients=S.clients.filter(x=>x._id!==id);
    if(S._clientSel?._id===id) S._clientSel=null;
    S._modal=''; window._delClientId=null;
    invalidateCache('clients');
    render();
    toast((c?.name||'Cliente')+' excluido');
  }).catch(e=>toast('Erro: '+e.message));
}

// ── OVERRIDE MANUAL DE TIER ───────────────────────────────────
export async function showTierOverrideModal(clientId){
  if(!canManageClientTier()){ toast('Sem permissão para alterar nível'); return; }
  const c = S.clients.find(x=>x._id===clientId);
  if(!c) return;
  const current = c.tierOverride || '';
  const auto = tierByCount(c.totalOrders||0);
  const options = TIER_ORDER.map(k=>{
    const d = TIER_DEFS[k];
    const sel = current===k ? 'selected' : '';
    return `<option value="${k}" ${sel}>${d.icon} ${d.label}</option>`;
  }).join('');
  S._modal = `<div class="mo" id="mo" onclick="if(event.target===this){S._modal='';render();}">
  <div class="mo-box" style="max-width:420px;" onclick="event.stopPropagation()">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
      <div style="font-family:'Playfair Display',serif;font-size:18px;">Alterar Nível</div>
      <button class="btn btn-ghost btn-sm" id="btn-tier-close">&times;</button>
    </div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">
      <strong>${c.name}</strong> — ${c.totalOrders||0} pedido(s)<br>
      Nível automático: ${auto.icon} ${auto.label}
    </div>
    <label style="display:block;font-size:12px;margin-bottom:4px;">Nível manual</label>
    <select class="fi" id="tier-select" style="margin-bottom:10px;">
      <option value="">— Automático (por pedidos) —</option>
      ${options}
    </select>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">
      ${current ? `<button class="btn btn-ghost" id="btn-tier-clear">Remover override</button>` : ''}
      <button class="btn btn-primary" id="btn-tier-save">Salvar</button>
    </div>
  </div></div>`;
  await render();
  document.getElementById('btn-tier-close')?.addEventListener('click',()=>{S._modal='';render();});
  document.getElementById('btn-tier-save')?.addEventListener('click',()=>{
    const val = document.getElementById('tier-select').value;
    saveTierOverride(clientId, val || null);
  });
  document.getElementById('btn-tier-clear')?.addEventListener('click',()=>{
    saveTierOverride(clientId, null);
  });
}

export async function saveTierOverride(clientId, tierKey){
  if(!canManageClientTier()){ toast('Sem permissão'); return; }
  try{
    const payload = { tierOverride: tierKey || null };
    const c = await PUT('/clients/'+clientId, payload);
    S.clients = S.clients.map(x=>x._id===clientId?{...x,tierOverride:payload.tierOverride,...(c||{})}:x);
    if(S._clientSel?._id===clientId) S._clientSel = {...S._clientSel, tierOverride: payload.tierOverride};
    invalidateCache('clients');
    S._modal=''; render();
    toast(tierKey ? 'Nível alterado manualmente' : 'Voltou para nível automático');
  }catch(e){
    toast('Erro: '+(e.message||''));
  }
}

// ── BIND EVENTS (chamado apos render) ─────────────────────────
export function bindClientesEvents(){
  // Search
  document.getElementById('cli-search')?.addEventListener('input', e=>{
    S._clientSearch = e.target.value;
    render();
  });

  // Novo cliente
  document.getElementById('btn-new-cli')?.addEventListener('click',()=>showClientModal());

  // ── Importar (admin) ──
  document.getElementById('btn-import-cli')?.addEventListener('click',()=>{
    document.getElementById('file-import-cli')?.click();
  });
  document.getElementById('file-import-cli')?.addEventListener('change', async e=>{
    const file = e.target.files?.[0]; if(!file) return;
    try{
      const text = await file.text();
      const rows = file.name.toLowerCase().endsWith('.json') ? JSON.parse(text) : parseCSV(text);
      if(!Array.isArray(rows) || !rows.length) return toast('Arquivo vazio ou invalido');
      let ok=0, fail=0;
      for(let i=0;i<rows.length;i++){
        toast(`Importando ${i+1} de ${rows.length}...`);
        const r = rows[i];
        const payload = {
          name:    r.nome || r.name || '',
          phone:   r.telefone || r.phone || '',
          email:   r.email || '',
          cpf:     r.cpf || '',
          address: {
            neighborhood: r['endereco.bairro'] || r.bairro || '',
            city:         r['endereco.cidade'] || r.cidade || 'Manaus',
          },
          unit: S.user?.unit==='Todas' ? 'Loja Novo Aleixo' : (S.user?.unit||'Loja Novo Aleixo'),
        };
        if(!payload.name){ fail++; continue; }
        try{
          const c = await POST('/clients', payload);
          if(c?._id) S.clients.unshift(c);
          ok++;
        }catch(err){ fail++; }
      }
      invalidateCache('clients');
      render();
      toast(`Importados: ${ok} · Falhas: ${fail}`);
    }catch(err){ toast('Erro ao importar: '+(err.message||'')); }
    e.target.value = '';
  });

  // ── Exportar (admin) ──
  document.getElementById('btn-export-cli')?.addEventListener('click',()=>{
    const cols = ['nome','telefone','email','cpf','endereco.bairro','endereco.cidade'];
    const src  = Array.isArray(S._filteredClients) ? S._filteredClients : S.clients;
    const rows = src.map(c=>({
      nome: c.name||'',
      telefone: c.phone||'',
      email: c.email||'',
      cpf: c.cpf||'',
      endereco: { bairro: c.address?.neighborhood||'', cidade: c.address?.city||'' },
    }));
    const csv = toCSV(rows, cols);
    downloadFile(csv, 'clientes-'+new Date().toISOString().split('T')[0]+'.csv');
    toast('Exportados '+rows.length+' clientes');
  });

  // Selecionar cliente na tabela
  document.querySelectorAll('[data-cli]').forEach(row=>{
    row.addEventListener('click', e=>{
      if(e.target.closest('button')) return;
      const id = row.dataset.cli;
      S._clientSel = S.clients.find(c=>c._id===id)||null;
      render();
    });
  });

  // Fechar painel detalhe
  document.getElementById('btn-cli-close')?.addEventListener('click',()=>{
    S._clientSel=null; render();
  });

  // Novo pedido a partir do detalhe
  document.getElementById('btn-cli-new-order')?.addEventListener('click',()=>setPage('pdv'));

  // Override manual de tier (botão no card de nível do detalhe)
  document.getElementById('btn-edit-tier')?.addEventListener('click',()=>{
    const cid = document.getElementById('btn-edit-tier').dataset.cid;
    showTierOverrideModal(cid);
  });

  // Editar da tabela
  document.querySelectorAll('.btn-edit-cli').forEach(btn=>btn.addEventListener('click',()=>{
    const c = S.clients.find(x=>x._id===btn.dataset.cid);
    if(c) showClientModal(c);
  }));

  // Editar do detalhe
  document.querySelectorAll('.btn-edit-cli-detail').forEach(btn=>btn.addEventListener('click',()=>{
    const c = S.clients.find(x=>x._id===btn.dataset.cid);
    if(c) showClientModal(c);
  }));

  // Excluir da tabela
  document.querySelectorAll('.btn-del-cli').forEach(btn=>btn.addEventListener('click',()=>{
    deleteClient(btn.dataset.cid);
  }));

  // Excluir do detalhe
  document.querySelectorAll('.btn-del-cli-detail').forEach(btn=>btn.addEventListener('click',()=>{
    deleteClient(btn.dataset.cid);
  }));

  // Historico de Compras — Repetir pedido
  document.querySelectorAll('[data-repeat-order]').forEach(btn=>btn.addEventListener('click',()=>{
    repeatOrder(btn.dataset.repeatOrder);
  }));

  // Historico de Compras — Ver detalhes
  document.querySelectorAll('[data-view-order]').forEach(btn=>btn.addEventListener('click',()=>{
    if(typeof window.showOrderViewModal === 'function'){
      window.showOrderViewModal(btn.dataset.viewOrder);
    }
  }));
}

// ── REPETIR PEDIDO ────────────────────────────────────────────
export function repeatOrder(orderId){
  const o = S.orders.find(x => x._id === orderId);
  if(!o){ toast('Pedido nao encontrado'); return; }

  import('../state.js').then(m => {
    const PDV = m.PDV;
    if(typeof m.resetPDV === 'function'){ try{ m.resetPDV(); }catch(e){} }

    PDV.cart = (o.items||[]).map((i, idx) => ({
      id: i.product || i.produtoId || 'it_'+idx,
      name: i.name || i.nome || '',
      price: i.unitPrice || i.preco || 0,
      qty:   i.qty   || i.quantidade || 1,
    }));
    PDV.clientId    = o.client || o.clientId || '';
    PDV.clientName  = o.clientName  || o.cliente?.nome     || '';
    PDV.clientPhone = o.clientPhone || o.cliente?.telefone || '';
    PDV.type        = o.type || 'Delivery';
    PDV.street            = o.deliveryStreet       || '';
    PDV.number            = o.deliveryNumber       || '';
    PDV.neighborhood      = o.deliveryNeighborhood || '';
    PDV.cep               = o.deliveryCep          || '';
    PDV.recipient         = o.recipient            || '';
    PDV.recipientPhone    = o.recipientPhone       || '';
    PDV.payment           = o.payment              || PDV.payment;
    PDV.notes             = o.notes                || '';
    PDV.cardMessage       = o.cardMessage          || '';

    setPage('pdv');
    toast('\u2705 Pedido carregado no PDV \u2014 revise e finalize');
  }).catch(err => {
    toast('Erro ao repetir pedido: '+(err?.message||''));
  });
}
