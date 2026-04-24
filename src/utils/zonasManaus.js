// ── ZONAS DE MANAUS (agrupamento geografico para roteirizacao) ────
// Agrupa bairros em 6 zonas baseadas em geografia/proximidade.
// Usado no Dashboard para filtro de "Bairros Proximos" e sugestao
// de rota otimizada.
//
// REFERENCIA: divisao oficial de Manaus (Prefeitura) + ajustes
// praticos para floricultura (bairros vizinhos agrupados quando
// fisicamente proximos mesmo em zonas administrativas diferentes).

export const ZONAS_MANAUS = {
  'Centro-Sul': {
    label: '🏙️ Centro-Sul',
    color: '#EC4899',
    cepPrefixos: ['690', '691'],
    bairros: [
      'Centro', 'Cachoeirinha', 'Praça 14 de Janeiro', 'Praça 14',
      'Educandos', 'Adrianópolis', 'Nossa Senhora das Graças',
      'Nossa Senhora Aparecida', 'São Geraldo', 'Sao Geraldo',
      'Petrópolis', 'Petropolis', 'Parque 10 de Novembro', 'Parque 10',
      'Chapada', 'Aleixo', 'Japiim', 'Raiz', 'Morro da Liberdade',
      'São Francisco', 'Sao Francisco', 'Flores', '14 de Janeiro',
      'Presidente Vargas',
    ],
  },
  'Leste': {
    label: '🌅 Leste',
    color: '#F59E0B',
    cepPrefixos: ['690', '691'],
    bairros: [
      'Jorge Teixeira', 'Armando Mendes', 'Tancredo Neves',
      'São José Operário', 'Sao Jose Operario', 'São José', 'Sao Jose',
      'Colônia Antônio Aleixo', 'Colonia Antonio Aleixo',
      'Gilberto Mestrinho', 'Zumbi', 'Zumbi dos Palmares',
      'Distrito Industrial', 'Distrito Industrial I', 'Distrito Industrial II',
      'Mauazinho', 'Puraquequara',
    ],
  },
  'Norte': {
    label: '🌃 Norte',
    color: '#10B981',
    cepPrefixos: ['690', '691'],
    bairros: [
      'Cidade Nova', 'Novo Aleixo', 'Santa Etelvina', 'Nova Cidade',
      'Monte das Oliveiras', 'Lírio do Vale', 'Lirio do Vale',
      'Aeroporto', 'Colégio Militar', 'Colegio Militar',
      'Novo Israel', 'Nossa Senhora do Perpétuo Socorro',
      'Nova Esperança', 'Nova Esperanca',
    ],
  },
  'Oeste': {
    label: '🌇 Oeste',
    color: '#3B82F6',
    cepPrefixos: ['690', '691'],
    bairros: [
      'Compensa', 'Santo Antônio', 'Santo Antonio', 'São Jorge', 'Sao Jorge',
      'Da Paz', 'Alvorada', 'Redenção', 'Redencao',
      'Glória', 'Gloria', 'Vila da Prata', 'Dom Pedro',
      'Coroado', 'Planalto', 'Lago Azul', 'Lagoa Azul',
      'São Raimundo', 'Sao Raimundo',
    ],
  },
  'Sul': {
    label: '🌴 Sul',
    color: '#8B5CF6',
    cepPrefixos: ['690'],
    bairros: [
      'Ponta Negra', 'Tarumã', 'Taruma', 'Tarumã-Açu', 'Taruma Acu',
      'Colônia Oliveira Machado', 'Colonia Oliveira Machado',
      'Colônia Terra Nova', 'Colonia Terra Nova',
      'Betânia', 'Betania', 'Crespo',
    ],
  },
  'Outros': {
    label: '📍 Outros',
    color: '#94A3B8',
    cepPrefixos: [],
    bairros: [],
  },
};

// ── Helpers de busca ─────────────────────────────────────────
function normalize(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // tira acentos
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Cache normalizado de bairros → zona
const _bairroToZona = (() => {
  const map = {};
  for (const [zonaKey, zona] of Object.entries(ZONAS_MANAUS)) {
    if (zonaKey === 'Outros') continue;
    zona.bairros.forEach(b => { map[normalize(b)] = zonaKey; });
  }
  return map;
})();

// ── API PUBLICA ─────────────────────────────────────────────

// Retorna a zona do bairro informado (com fuzzy matching)
export function getZonaByBairro(bairro) {
  if (!bairro) return 'Outros';
  const norm = normalize(bairro);
  // Match exato primeiro
  if (_bairroToZona[norm]) return _bairroToZona[norm];
  // Match parcial: se o bairro do pedido contém o nome de algum bairro mapeado
  for (const [bairroMap, zona] of Object.entries(_bairroToZona)) {
    if (norm.includes(bairroMap) || bairroMap.includes(norm)) return zona;
  }
  return 'Outros';
}

// Retorna a zona por CEP (fallback quando bairro nao bate)
export function getZonaByCep(cep) {
  const c = String(cep || '').replace(/\D/g, '');
  if (c.length < 5) return 'Outros';
  // Prefixos dos CEPs de Manaus (690xx e 691xx)
  const prefix3 = c.slice(0, 3);
  for (const [zonaKey, zona] of Object.entries(ZONAS_MANAUS)) {
    if (zona.cepPrefixos.includes(prefix3)) return zonaKey;
  }
  return 'Outros';
}

// Resolve a zona usando bairro primeiro, cep como fallback
export function resolveZona(pedido) {
  const bairro = pedido?.deliveryNeighborhood || pedido?.deliveryZone || pedido?.bairro || '';
  const zonaPorBairro = getZonaByBairro(bairro);
  if (zonaPorBairro !== 'Outros') return zonaPorBairro;
  return getZonaByCep(pedido?.deliveryCep || pedido?.cep);
}

// Retorna lista de bairros unicos presentes nos pedidos informados,
// agrupados por zona para UI de filtro.
export function bairrosAgrupados(pedidos) {
  const grupos = {};
  for (const zonaKey of Object.keys(ZONAS_MANAUS)) grupos[zonaKey] = new Set();
  pedidos.forEach(p => {
    const bairro = (p.deliveryNeighborhood || p.deliveryZone || '').trim();
    if (!bairro) return;
    const zona = resolveZona(p);
    grupos[zona].add(bairro);
  });
  // Converte para objeto: { zona: [bairros ordenados] }
  const result = {};
  for (const [k, set] of Object.entries(grupos)) {
    if (set.size > 0) result[k] = [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }
  return result;
}

// ── ROTEIRIZACAO SUGERIDA ─────────────────────────────────────
// Regras de priorizacao dentro da zona:
//  1. Urgencia (atrasados primeiro, depois proximos do horario)
//  2. Turno (manha > tarde > noite)
//  3. Horario de entrega crescente
//  4. Agrupa por bairro (entregador nao volta no mesmo bairro)
export function roteirizarZona(pedidos) {
  const TURNO_ORDEM = { 'manha': 0, 'manhã': 0, 'tarde': 1, 'noite': 2, '—': 3, '': 3 };

  // Calcula urgencia: 0=atrasado, 1=em risco, 2=normal
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const getUrgencia = (p) => {
    if (!p.scheduledTime || p.scheduledTime === '00:00') return 2;
    const [h, m] = p.scheduledTime.split(':').map(Number);
    const alvo = h * 60 + m;
    const diff = alvo - nowMins;
    if (diff < 0)  return 0;  // atrasado
    if (diff <= 45) return 1; // em risco
    return 2;                 // normal
  };

  const normTurno = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  return [...pedidos].sort((a, b) => {
    // 1. Urgencia
    const u = getUrgencia(a) - getUrgencia(b);
    if (u !== 0) return u;
    // 2. Turno
    const tA = TURNO_ORDEM[normTurno(a.scheduledPeriod)] ?? 3;
    const tB = TURNO_ORDEM[normTurno(b.scheduledPeriod)] ?? 3;
    if (tA !== tB) return tA - tB;
    // 3. Horario crescente
    const hA = a.scheduledTime || '99:99';
    const hB = b.scheduledTime || '99:99';
    if (hA !== hB) return hA.localeCompare(hB);
    // 4. Agrupa por bairro
    const bA = (a.deliveryNeighborhood || '').toLowerCase();
    const bB = (b.deliveryNeighborhood || '').toLowerCase();
    return bA.localeCompare(bB);
  });
}

// Agrupa uma lista de pedidos em zonas + roteiriza cada zona.
// Retorna: [{ zona, label, color, pedidos: [...roteirizados], count }]
export function agruparEroteirizar(pedidos) {
  const grupos = {};
  for (const zonaKey of Object.keys(ZONAS_MANAUS)) grupos[zonaKey] = [];
  pedidos.forEach(p => grupos[resolveZona(p)].push(p));

  const result = [];
  // Ordem geografica: Centro-Sul → Leste → Norte → Oeste → Sul → Outros
  const ordemGeo = ['Centro-Sul', 'Leste', 'Norte', 'Oeste', 'Sul', 'Outros'];
  for (const zonaKey of ordemGeo) {
    const lista = grupos[zonaKey];
    if (!lista.length) continue;
    const zona = ZONAS_MANAUS[zonaKey];
    result.push({
      zona: zonaKey,
      label: zona.label,
      color: zona.color,
      pedidos: roteirizarZona(lista),
      count: lista.length,
    });
  }
  return result;
}

// ── TURNO DO PEDIDO ─────────────────────────────────────────
// Prioriza scheduledPeriod (manha/tarde/noite). Se nao tiver,
// tenta inferir pelo scheduledTime.
export function getTurnoPedido(pedido) {
  const p = String(pedido?.scheduledPeriod || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (p.includes('manh')) return 'manha';
  if (p.includes('tard')) return 'tarde';
  if (p.includes('noit')) return 'noite';
  // Fallback: infere pelo horario
  const t = String(pedido?.scheduledTime || '');
  if (t && t !== '00:00') {
    const [h] = t.split(':').map(Number);
    if (h >= 6 && h < 12) return 'manha';
    if (h >= 12 && h < 18) return 'tarde';
    if (h >= 18 && h < 23) return 'noite';
  }
  return 'sem';
}

// Turno atual baseado na hora de Manaus
export function getTurnoAtual() {
  const now = new Date();
  const h = parseInt(now.toLocaleString('en-US', {
    timeZone: 'America/Manaus', hour: '2-digit', hour12: false,
  }), 10);
  if (h >= 0  && h < 11) return 'manha';   // ate 10:59 = manha
  if (h >= 11 && h < 17) return 'tarde';   // 11:00-16:59 = tarde
  if (h >= 17 && h < 23) return 'noite';   // 17:00-22:59 = noite
  return 'noite'; // madrugada: mantem noite (caso operacao estenda)
}

// Labels e cores de turnos
export const TURNOS = {
  manha: { label: '🌅 Manhã',   color: '#F59E0B', ordem: 0 },
  tarde: { label: '🌤️ Tarde',  color: '#3B82F6', ordem: 1 },
  noite: { label: '🌙 Noite',  color: '#7C3AED', ordem: 2 },
  sem:   { label: '📋 Sem turno', color: '#6B7280', ordem: 3 },
};

// Agrupa pedidos PRIMEIRO por TURNO, DEPOIS por zona dentro do turno.
// Retorna: [{ turno, turnoLabel, turnoColor, zonas: [...], totalPedidos }]
export function agruparPorTurnoEZona(pedidos) {
  const gruposTurno = { manha: [], tarde: [], noite: [], sem: [] };
  pedidos.forEach(p => {
    const t = getTurnoPedido(p);
    gruposTurno[t].push(p);
  });

  const result = [];
  const ordem = ['manha', 'tarde', 'noite', 'sem'];
  for (const t of ordem) {
    const lista = gruposTurno[t];
    if (!lista.length) continue;
    const zonas = agruparEroteirizar(lista); // reaproveita a zona+rota
    const turnoMeta = TURNOS[t];
    result.push({
      turno: t,
      turnoLabel: turnoMeta.label,
      turnoColor: turnoMeta.color,
      zonas,
      totalPedidos: lista.length,
    });
  }
  return result;
}
