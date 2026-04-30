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

// Sigla curta + cor para badges visuais (Dashboard, Pedidos, Painel TV).
// Recebe a unidade de venda (saleUnit) ou label de unidade.
export function siglaUnidade(unitOrSlug) {
  const raw = String(unitOrSlug || '').toLowerCase();
  if (!raw) return null;
  if (raw.includes('cdle') || raw.includes('distribui')) return { sigla:'CDLE', cor:'#DC2626', bg:'#FEE2E2' };
  if (raw.includes('aleixo')) return { sigla:'NA',   cor:'#1D4ED8', bg:'#DBEAFE' };
  if (raw.includes('allegro')) return { sigla:'AL',  cor:'#047857', bg:'#D1FAE5' };
  if (raw.includes('ecomm') || raw.includes('e-comm')) return { sigla:'EC', cor:'#6D28D9', bg:'#EDE9FE' };
  return { sigla: raw.slice(0,3).toUpperCase(), cor:'#4B5563', bg:'#F3F4F6' };
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

  // Delivery sempre sai do CDLE (regra de negocio)
  if (t === 'delivery' && dest !== 'cdle') {
    return { ok: false, reason: 'Delivery sempre sai do CDLE' };
  }

  if (unidade === 'novo_aleixo') {
    if (t === 'delivery') return { ok: true }; // cdle
    if (t === 'retirada' && (dest === 'novo_aleixo' || dest === 'allegro')) return { ok: true };
    if (t === 'balcao' && dest === 'novo_aleixo') return { ok: true };
    return { ok: false, reason: `Novo Aleixo: ${t}/${dest} não permitido` };
  }

  if (unidade === 'allegro') {
    if (t === 'delivery') return { ok: true }; // cdle
    // Allegro tambem pode escolher Novo Aleixo como local de retirada
    if (t === 'retirada' && (dest === 'allegro' || dest === 'novo_aleixo')) return { ok: true };
    if (t === 'balcao' && dest === 'allegro') return { ok: true };
    return { ok: false, reason: `Allegro: ${t}/${dest} não permitido` };
  }

  if (unidade === 'cdle') {
    if (t === 'delivery') return { ok: true };
    // CDLE pode cadastrar retirada em qualquer uma das 3 unidades
    if (t === 'retirada' && (dest === 'cdle' || dest === 'novo_aleixo' || dest === 'allegro')) return { ok: true };
    return { ok: false, reason: `CDLE: ${t}/${dest} não permitido` };
  }

  return { ok: false, reason: `Unidade desconhecida: ${unidade}` };
}

// Helper: detecta se um pedido e Delivery (sempre sai do CDLE)
function isDelivery(pedido) {
  const t = String(pedido?.type || pedido?.tipo || '').toLowerCase();
  return t === 'delivery';
}

// REGRA STRICT: cada unidade so ve pedidos onde ELA opera OU vendeu.
// Delivery segue mesma regra (sem mais 'visivel para todas').
export function podeVerPedido(user, pedido) {
  if (isAdmin(user)) return true;
  if (!pedido) return false;
  const userUnit = normalizeUnidade(user?.unidade || user?.unit);
  if (!userUnit) return false;
  const orderUnit = normalizeUnidade(pedido.unidade || pedido.unit);
  const orderSale = normalizeUnidade(pedido.saleUnit);
  return userUnit === orderUnit || userUnit === orderSale;
}

export function filtrarPedidosPorUnidade(user, pedidos) {
  if (isAdmin(user)) return pedidos || [];
  const unidade = normalizeUnidade(user?.unidade || user?.unit);
  if (!unidade) return [];
  return (pedidos || []).filter(p => {
    const oUnit = normalizeUnidade(p.unidade || p.unit);
    const oSale = normalizeUnidade(p.saleUnit);
    return oUnit === unidade || oSale === unidade;
  });
}

// Filtro STRICT para tela de Producao/Expedicao:
//   Cada unidade so VE pedidos que ELA vai produzir/entregar/retirar.
//   - Delivery → unidade='cdle' (CDLE produz e entrega)
//   - Retirada Novo Aleixo → unidade='novo_aleixo' (Novo Aleixo monta)
//   - Retirada Allegro → unidade='allegro' (Allegro monta)
//   - Balcao Novo Aleixo → unidade='novo_aleixo'
//   - Balcao Allegro → unidade='allegro'
// Mesmo que a venda tenha sido feita em outra loja (saleUnit diferente
// de unidade), quem vai PRODUZIR e quem ve aqui.
export function filtrarPedidosParaProducao(user, pedidos) {
  if (isAdmin(user)) return pedidos || [];
  const unidade = normalizeUnidade(user?.unidade || user?.unit);
  if (!unidade) return [];
  return (pedidos || []).filter(p =>
    normalizeUnidade(p.unidade || p.unit) === unidade
  );
}

// Filtro para tela de Pedidos / Dashboard:
//   Mostra pedidos onde a unidade VENDEU (saleUnit) OU vai PRODUZIR (unidade).
//   - Quem vendeu precisa acompanhar e aprovar pagamento
//   - Quem produz precisa acompanhar status do pedido
//   - Delivery e visivel para todos (e operacao da rede)
// STRICT: cada unidade so ve pedidos onde ELA opera (unidade) OU
// vendeu (saleUnit). Sem mais excecao para Delivery.
export function filtrarPedidosParaListagem(user, pedidos) {
  if (isAdmin(user)) return pedidos || [];
  const unidade = normalizeUnidade(user?.unidade || user?.unit);
  if (!unidade || unidade === 'todas') return pedidos || [];
  return (pedidos || []).filter(p => {
    const oUnit = normalizeUnidade(p.unidade || p.unit);
    const oSale = normalizeUnidade(p.saleUnit);
    return oUnit === unidade || oSale === unidade;
  });
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
      destinos: ['novo_aleixo','allegro','cdle'],
      combinacoes: [
        {tipo:'balcao',   destino:'novo_aleixo'},
        {tipo:'retirada', destino:'novo_aleixo'},
        {tipo:'retirada', destino:'allegro'},
        {tipo:'delivery', destino:'cdle'}, // Delivery sempre sai do CDLE
      ],
    };
  }
  if (unidade === 'allegro') {
    return {
      tipos: ['balcao','retirada','delivery'],
      destinos: ['allegro','novo_aleixo','cdle'],
      combinacoes: [
        {tipo:'balcao',   destino:'allegro'},
        {tipo:'retirada', destino:'allegro'},
        {tipo:'retirada', destino:'novo_aleixo'}, // Allegro pode agendar retirada no Aleixo
        {tipo:'delivery', destino:'cdle'},        // Delivery sempre sai do CDLE
      ],
    };
  }
  if (unidade === 'cdle') {
    return {
      tipos: ['retirada','delivery'],
      destinos: ['cdle','novo_aleixo','allegro'],
      combinacoes: [
        {tipo:'retirada', destino:'cdle'},
        {tipo:'retirada', destino:'novo_aleixo'},
        {tipo:'retirada', destino:'allegro'},
        {tipo:'delivery', destino:'cdle'},
      ],
    };
  }
  return { tipos:[], destinos:[], combinacoes:[] };
}
