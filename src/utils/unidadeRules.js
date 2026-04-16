// ── REGRAS DE UNIDADE (FRONTEND) ──────────────────────────────
// Espelho do backend src/utils/unidadeRules.js — fonte única da verdade.
// Controla visualização, criação e opções permitidas por unidade.

export function normalizeUnidade(u) {
  if (!u) return '';
  const s = String(u).toLowerCase().trim();
  if (!s) return '';
  if (s.includes('novo') && s.includes('aleixo')) return 'novo_aleixo';
  if (s.includes('allegro')) return 'allegro';
  if (s.includes('cdle') || (s.includes('centro') && s.includes('distribui'))) return 'cdle';
  if (['novo_aleixo','allegro','cdle'].includes(s)) return s;
  if (['todas','all','*'].includes(s)) return 'todas';
  return s.replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
}

export function labelUnidade(slug) {
  const s = normalizeUnidade(slug);
  return ({
    novo_aleixo: 'Loja Novo Aleixo',
    allegro: 'Loja Allegro Mall',
    cdle: 'CDLE',
    todas: 'Todas',
  })[s] || slug || '—';
}

export function isAdmin(user) {
  if (!user) return false;
  return user.cargo === 'admin'
      || user.role === 'Administrador'
      || user.cargo === 'Administrador'
      || user.unidade === 'todas'
      || user.unit === 'Todas';
}

export function podeCriarPedido(user, tipo, destino) {
  if (isAdmin(user)) return { ok: true };
  const unidade = normalizeUnidade(user?.unidade || user?.unit);
  if (!unidade) return { ok: false, reason: 'Usuário sem unidade definida' };

  const t = (tipo || '').toLowerCase();
  const dest = normalizeUnidade(destino || unidade);

  if (!['balcao','retirada','delivery'].includes(t)) {
    return { ok: false, reason: 'Tipo de pedido inválido' };
  }

  if (unidade === 'novo_aleixo') {
    if (t === 'delivery') return { ok: true };
    if (t === 'retirada' && (dest === 'novo_aleixo' || dest === 'allegro')) return { ok: true };
    if (t === 'balcao' && dest === 'novo_aleixo') return { ok: true };
    if (t === 'balcao' && dest === 'allegro') return { ok: false, reason: 'Novo Aleixo não pode criar balcão de Allegro' };
    return { ok: false, reason: `Novo Aleixo: ${t}/${dest} não permitido` };
  }

  if (unidade === 'allegro') {
    if (t === 'retirada' && dest === 'allegro') return { ok: true };
    if (t === 'balcao' && dest === 'allegro') return { ok: true };
    return { ok: false, reason: 'Allegro: só pode criar balcão ou retirada na própria loja' };
  }

  if (unidade === 'cdle') {
    if (t === 'delivery') return { ok: true };
    return { ok: false, reason: 'CDLE: apenas delivery é permitido' };
  }

  return { ok: false, reason: `Unidade desconhecida: ${unidade}` };
}

export function podeVerPedido(user, pedido) {
  if (isAdmin(user)) return true;
  if (!pedido) return false;
  const userUnit = normalizeUnidade(user?.unidade || user?.unit);
  const orderUnit = normalizeUnidade(pedido.unidade || pedido.unit);
  if (!userUnit) return false;
  return userUnit === orderUnit;
}

export function filtrarPedidosPorUnidade(user, pedidos) {
  if (isAdmin(user)) return pedidos || [];
  const unidade = normalizeUnidade(user?.unidade || user?.unit);
  if (!unidade) return [];
  return (pedidos || []).filter(p => normalizeUnidade(p.unidade || p.unit) === unidade);
}

export function opcoesPermitidas(user) {
  if (isAdmin(user)) {
    return {
      tipos: ['balcao','retirada','delivery'],
      destinos: ['novo_aleixo','allegro','cdle'],
      combinacoes: [
        {tipo:'balcao',   destino:'novo_aleixo'},
        {tipo:'balcao',   destino:'allegro'},
        {tipo:'retirada', destino:'novo_aleixo'},
        {tipo:'retirada', destino:'allegro'},
        {tipo:'delivery', destino:'novo_aleixo'},
        {tipo:'delivery', destino:'allegro'},
        {tipo:'delivery', destino:'cdle'},
      ],
    };
  }
  const unidade = normalizeUnidade(user?.unidade || user?.unit);
  if (unidade === 'novo_aleixo') {
    return {
      tipos: ['balcao','retirada','delivery'],
      destinos: ['novo_aleixo','allegro'],
      combinacoes: [
        {tipo:'balcao',   destino:'novo_aleixo'},
        {tipo:'retirada', destino:'novo_aleixo'},
        {tipo:'retirada', destino:'allegro'},
        {tipo:'delivery', destino:'novo_aleixo'},
      ],
    };
  }
  if (unidade === 'allegro') {
    return {
      tipos: ['balcao','retirada'],
      destinos: ['allegro'],
      combinacoes: [
        {tipo:'balcao',   destino:'allegro'},
        {tipo:'retirada', destino:'allegro'},
      ],
    };
  }
  if (unidade === 'cdle') {
    return {
      tipos: ['delivery'],
      destinos: ['cdle'],
      combinacoes: [
        {tipo:'delivery', destino:'cdle'},
      ],
    };
  }
  return { tipos:[], destinos:[], combinacoes:[] };
}
