// ── HELPERS ──────────────────────────────────────────────────
import { S } from '../state.js';
import { _isEntregador } from '../services/auth.js';

// ── TOAST ────────────────────────────────────────────────────
export function toast(msg, err = false){
  S.toast = { msg, err };
  // Se modal aberto: atualiza toast in-place sem re-render (preserva event listeners)
  if(S._modal){
    let t = document.getElementById('_fv_toast');
    if(!t){
      t = document.createElement('div');
      t.id = '_fv_toast';
      t.className = 'toast';
      document.getElementById('root')?.appendChild(t);
    }
    t.textContent = msg;
    t.style.background = err ? 'var(--red)' : '';
    t.style.display = 'flex';
    clearTimeout(t._timer);
    t._timer = setTimeout(()=>{ t.style.display='none'; S.toast=null; }, 3500);
    return;
  }
  import('../main.js').then(m => m.render()).catch(()=>{});
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(()=>{ S.toast=null; import('../main.js').then(m => m.render()).catch(()=>{}); }, 3500);
}

// ── SET PAGE ─────────────────────────────────────────────────
// Mapa de nomes de página para URL slug
const PAGE_SLUGS = {
  dashboard:'dashboard', pdv:'vendas', caixa:'caixa', pedidos:'pedidos',
  clientes:'clientes', produtos:'produtos', categorias:'categorias',
  estoque:'estoque', producao:'producao', expedicao:'expedicao',
  ponto:'ponto', financeiro:'financeiro', relatorios:'relatorios',
  alertas:'alertas', whatsapp:'whatsapp', usuarios:'usuarios',
  colaboradores:'colaboradores', impressao:'impressao', backup:'backup',
  config:'configuracoes', ecommerce:'ecommerce', orcamento:'orcamentos',
  entregador:'entregador', notasFiscais:'notas-fiscais',
};
// SLUG_TO_PAGE: aceita tanto /vendas (novo) quanto /pdv (legado) para compat
const SLUG_TO_PAGE = Object.fromEntries(Object.entries(PAGE_SLUGS).map(([k,v])=>[v,k]));
SLUG_TO_PAGE['pdv'] = 'pdv'; // redirect legado

// Mapeamento de página → módulo de permissão
// 'alertas' (Notificacoes) NAO requer permissao especifica — qualquer
// usuario logado pode ver suas proprias notificacoes operacionais.
const PAGE_TO_MOD = {
  dashboard:'dashboard', pdv:'pdv', caixa:'caixa', pedidos:'orders',
  clientes:'clients', produtos:'products', categorias:'products',
  estoque:'stock', producao:'production', expedicao:'delivery',
  ponto:'ponto', financeiro:'financial', relatorios:'reports',
  whatsapp:'whatsapp', usuarios:'users',
  colaboradores:'users', impressao:'impressao', backup:'backup',
  config:'config', ecommerce:'ecommerce', orcamento:'orcamentos',
  entregador:'delivery', notasFiscais:'notasFiscais',
  rh:'rh', metas:'reports', meuPainel:'orders',
  alertas:'alertas', auditLogs:'auditLogs', agenteTI:'agenteTI',
};

export function setPage(p, pushHistory=true){
  if(_isEntregador()){ toast('❌ Acesso restrito'); return; }

  // Valida permissão da página destino
  const mod = PAGE_TO_MOD[p];
  if(mod){
    // Import dinâmico do can() para evitar circular dep
    import('../services/auth.js').then(({ can }) => {
      if(!can(mod)){
        toast('🔒 Você não tem permissão para acessar este módulo', true);
        return;
      }
      _doSetPage(p, pushHistory);
    });
    return;
  }
  _doSetPage(p, pushHistory);
}

function _doSetPage(p, pushHistory){
  if(p==='producao') S._prodDate = new Date().toISOString().split('T')[0];
  if(p==='orcamento'){ S._orcView='list'; S._orcDraft=null; S._orcDetail=null; }
  if(p==='relatorios'){ S._repView='list'; S._repDraft=null; }
  if(p==='categorias'){ S._catExpanded=null; }
  S.page=p; S.sidebarOpen=false;
  localStorage.setItem('fv_page', p);
  const slug = PAGE_SLUGS[p] || p;
  if(pushHistory) history.pushState({page:p}, '', '/'+slug);
  import('../main.js').then(m => m.render()).catch(()=>{});
}

// Ler página da URL ao carregar
export function getPageFromURL(){
  const path = window.location.pathname.replace(/^\/+/,'').replace(/\/+$/,'');
  return SLUG_TO_PAGE[path] || null;
}

// ── SEARCH ORDERS ────────────────────────────────────────────
// Filtra por numero do pedido, nome do cliente ou telefone (correspondencia exata)
// Busca flexivel em pedidos: numero (parcial), nome (parcial) ou
// ultimos digitos do telefone (a partir de 4 digitos).
// Exemplos:
//   "12"       → acha #0012, #0123, #1200
//   "maria"    → acha todas as Marias
//   "1234"     → acha telefones que TERMINAM em 1234
//   "929123"   → acha telefones que TERMINAM em 929123
// ── BUSCA SERVER-SIDE ────────────────────────────────────────
// Quando o cache local (S.orders) nao contem o pedido antigo, faz uma
// busca no backend em /orders?q=termo e mescla os resultados em S.orders.
// Executado em background (nao bloqueia a UI) — sem duplicacao de pedidos.
let _serverSearchTimer = null;
let _lastServerSearchQ = '';
export function triggerServerOrderSearch(q){
  const term = String(q||'').trim();
  if (term.length < 2) return; // nao busca termos muito curtos
  if (term === _lastServerSearchQ) return; // ja buscou o mesmo termo
  clearTimeout(_serverSearchTimer);
  _serverSearchTimer = setTimeout(async () => {
    try {
      const { GET } = await import('../services/api.js');
      const { S } = await import('../state.js');
      const results = await GET('/orders?q=' + encodeURIComponent(term));
      // Marca termo como buscado SEMPRE (mesmo se vazio) — evita DDoS
      // interno se o usuario continuar digitando algo que nao existe.
      _lastServerSearchQ = term;
      if (!Array.isArray(results) || !results.length) return;
      // Mescla em S.orders (sem duplicar) — novos pedidos sao adicionados
      const known = new Set((S.orders||[]).map(o => String(o._id)));
      let added = 0;
      for (const o of results) {
        if (!known.has(String(o._id))) { S.orders.push(o); added++; }
      }
      if (added) {
        console.log(`[search] +${added} pedidos do servidor para termo "${term}"`);
        const { render } = await import('../main.js');
        render();
      }
    } catch(e) {
      console.warn('[search] servidor indisponivel:', e.message);
    }
  }, 400);
}

// ── DATA SEGURA (sem bug de fuso) ────────────────────────────
// Recebe uma data em qualquer formato comum do sistema e retorna um Date
// fixado em 12:00 do dia LOCAL — evita o bug classico onde 'YYYY-MM-DD'
// e parseado como UTC e em Manaus (UTC-4) volta um dia.
//   '2026-04-29'              → Date local 2026-04-29 12:00
//   '2026-04-29T00:00:00.000Z'→ Date local 2026-04-29 12:00
//   Date | timestamp           → mesma data local 12:00
export function parseLocalDate(input){
  if (!input) return null;
  // Se ja e Date
  if (input instanceof Date) {
    if (isNaN(input.getTime())) return null;
    return new Date(input.getFullYear(), input.getMonth(), input.getDate(), 12, 0, 0);
  }
  const s = String(input);
  // Formato YYYY-MM-DD ou YYYY-MM-DDTxx:yy:zz
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10) - 1;
    const d = parseInt(m[3], 10);
    return new Date(y, mo, d, 12, 0, 0); // 12h LOCAL evita off-by-one
  }
  // Outros formatos: tenta parse padrao + corrige para 12h local
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0);
}

// Formata uma data do pedido em pt-BR sem bug de fuso.
// fmt: 'curta' (28/04/26), 'longa' (qua, 28 de abril 2026), 'iso' (2026-04-28)
export function formatOrderDate(input, fmt = 'curta'){
  const d = parseLocalDate(input);
  if (!d) return '';
  if (fmt === 'iso') {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  if (fmt === 'longa') {
    return d.toLocaleDateString('pt-BR', { weekday:'long', day:'2-digit', month:'long', year:'numeric' });
  }
  if (fmt === 'comanda') {
    return d.toLocaleDateString('pt-BR', { weekday:'short', day:'2-digit', month:'2-digit', year:'2-digit' });
  }
  return d.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit' });
}

// ── EXCLUSAO COM SENHA ──────────────────────────────────────
// Senha de protecao para colaboradoras nao-admin excluirem registros
// (Cliente / Pedido / Produto / Categoria). Admin nao precisa.
export const SENHA_EXCLUSAO = '2233';

// Cache em memoria por sessao: uma vez digitada a senha correta,
// nao pede de novo no mesmo modulo por 5 minutos (UX — evita prompt
// a cada exclusao em massa).
const _exclSessao = new Map(); // module → expiresAt

// Retorna true se pode excluir (admin OU senha correta digitada agora).
// Mostra prompt nativo se necessario.
export function autorizaExclusao(modulo = 'item') {
  const u = S.user || {};
  const isAdmin = u.role === 'Administrador' || u.cargo === 'admin' || u.cargo === 'Administrador';
  if (isAdmin) return true;

  // Cache de 5 min
  const now = Date.now();
  const exp = _exclSessao.get(modulo) || 0;
  if (now < exp) return true;

  const pwd = prompt(`🔒 Exclusão protegida.\n\nDigite a senha de alteração para excluir este ${modulo}:`);
  if (pwd === null) return false; // cancelou
  if (String(pwd).trim() !== SENHA_EXCLUSAO) {
    toast('❌ Senha incorreta. Exclusão bloqueada.', true);
    return false;
  }
  _exclSessao.set(modulo, now + 5 * 60 * 1000);
  return true;
}

export function searchOrders(orders, q){
  if(!q) return orders;
  const raw = q.trim();
  if(!raw) return orders;
  const t        = raw.toLowerCase();
  const tDigits  = raw.replace(/\D/g,''); // so os digitos do termo buscado
  const tNoHash  = t.replace(/^#/,'');
  const isOnlyDigits = tDigits.length > 0 && tDigits === raw.replace(/\s/g,'');

  return orders.filter(o=>{
    // ─ 1) Numero do pedido (parcial, ignorando zeros a esquerda e '#') ─
    const numRaw = String(o.orderNumber||'').toLowerCase().replace('#','');
    const numDigits = numRaw.replace(/\D/g,'');
    if(tNoHash && (numRaw.includes(tNoHash) || (tDigits && numDigits.includes(tDigits)))) {
      // Evita falso positivo quando termo for telefone longo
      if(tDigits.length <= 6 || numDigits === tDigits) return true;
    }

    // ─ 2) Telefone: aceita ULTIMOS N digitos (a partir de 4) ─
    // Ex: 92999998877 → busca por '8877', '998877', '9998877' todos acham
    const phone = (o.clientPhone||o.client?.phone||o.recipientPhone||'').replace(/\D/g,'');
    if(isOnlyDigits && tDigits.length >= 4 && phone.endsWith(tDigits)) return true;
    // Tambem mantem match exato para telefone completo
    if(tDigits.length >= 8 && phone === tDigits) return true;

    // ─ 3) Nome do cliente / destinatario (parcial, case-insensitive) ─
    const cname = (o.client?.name||o.clientName||'').toLowerCase();
    const rname = (o.recipient||'').toLowerCase();
    if(cname.includes(t) || rname.includes(t)) return true;

    return false;
  });
}

// ── ACTIVITY LOG ─────────────────────────────────────────────
// Registra atividades (montagem/expedição/entrega) no cache local
// e sincroniza com o backend `/api/activities` para visibilidade
// entre dispositivos. Falha silenciosamente se a API estiver offline.
export function getActivities(){
  try{ return JSON.parse(localStorage.getItem('fv_activities')||'[]'); }
  catch(e){ return []; }
}

export function logActivity(type, order){
  if(!S.user || !order) return;
  const activity = {
    id: Date.now()+'_'+Math.random().toString(36).slice(2,7),
    userId: S.user._id,
    userName: S.user.name||S.user.nome||'',
    userRole: S.user.role,
    userEmail: (S.user.email||'').toLowerCase(),
    colabId: S.user.colabId||S.user.id||S.user._id,
    type,
    orderId: order._id,
    orderNumber: order.orderNumber||'—',
    items: order.items||[],
    total: order.total||0,
    date: new Date().toISOString(),
  };
  // Cache local (sempre)
  try{
    const acts = getActivities();
    acts.push(activity);
    localStorage.setItem('fv_activities', JSON.stringify(acts));
  }catch(e){ /* localStorage cheio — ignora */ }

  // Sincroniza com backend (silencioso se offline)
  import('../services/api.js').then(m => {
    if(typeof m.POST !== 'function') return;
    m.POST('/activities', {
      type,
      description: `${type} — ${order.orderNumber||''} ${order.clientName||order.client?.name||''}`.trim(),
      orderId: order._id,
      user: activity.userName,
      userEmail: activity.userEmail,
      userId: activity.userId,
      colabId: activity.colabId,
      total: activity.total,
      items: activity.items,
      date: activity.date,
    }).catch(()=>{ /* fallback: localStorage já tem */ });
  }).catch(()=>{});
}

// ── BARRA DE BUSCA DE PEDIDOS (HTML reutilizavel) ────────────
export function renderOrderSearchBar(placeholder='🔍 Nº pedido · Nome · Últimos 4–6 dígitos do celular'){
  const q = S._orderSearch||'';
  return`<div style="position:relative;max-width:420px;">
    <span style="position:absolute;left:9px;top:50%;transform:translateY(-50%);font-size:14px;pointer-events:none;">🔍</span>
    <input class="fi" id="order-search-input" value="${q}"
      placeholder="${placeholder}"
      title="Busque por: nº do pedido (ex: 0012), nome do cliente (ex: Maria), ou últimos dígitos do celular (ex: 8877 encontra 92 9999-8877)"
      style="padding-left:30px;font-size:12px;"/>
    ${q?`<button id="order-search-clear" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--muted);font-size:16px;line-height:1;" title="Limpar busca">✕</button>`:''}
  </div>`;
}
