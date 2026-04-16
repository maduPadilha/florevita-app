// ── NORMALIZAÇÃO DE NOMES DE PRODUTOS ──────────────────────
// Regras:
// 1. Primeira letra de cada palavra em maiúscula (Title Case)
// 2. Correção de acentuação/ortografia (dicionário)
// 3. Números de 1-9 viram 01-09 quando seguidos de quantidade
// 4. Remove espaços duplicados

// Dicionário de correções comuns (minúsculas → forma correta)
// Ordem de busca: case-insensitive, substitui como palavra inteira
const DICT = {
  // Flores e plantas
  'lirio': 'Lírio',
  'lirios': 'Lírios',
  'girassol': 'Girassol',
  'girassois': 'Girassóis',
  'orquidea': 'Orquídea',
  'orquideas': 'Orquídeas',
  'violeta': 'Violeta',
  'cravo': 'Cravo',
  'dalia': 'Dália',
  'margarida': 'Margarida',
  'margaridas': 'Margaridas',
  'antúrio': 'Antúrio',
  'anturio': 'Antúrio',
  'gerbera': 'Gérbera',
  'gerberas': 'Gérberas',
  'astromelia': 'Astromélia',
  'astromelias': 'Astromélias',

  // Tipos de arranjos
  'buque': 'Buquê',
  'buques': 'Buquês',
  'bouquet': 'Bouquet',
  'cesta': 'Cesta',
  'cestas': 'Cestas',
  'arranjo': 'Arranjo',
  'arranjos': 'Arranjos',
  'box': 'Box',
  'caixa': 'Caixa',
  'jardim': 'Jardim',
  'coroa': 'Coroa',
  'coroas': 'Coroas',
  'ramalhete': 'Ramalhete',
  'ramalhetes': 'Ramalhetes',

  // Ocasiões / expressões comuns
  'cafe': 'Café',
  'manha': 'Manhã',
  'manha,': 'Manhã,',
  'noite': 'Noite',
  'dia': 'Dia',
  'maes': 'Mães',
  'pais': 'Pais',
  'namorados': 'Namorados',
  'mulher': 'Mulher',
  'corporativo': 'Corporativo',
  'romantico': 'Romântico',
  'romantica': 'Romântica',
  'feliz': 'Feliz',
  'aniversario': 'Aniversário',
  'aniversarios': 'Aniversários',
  'condolencias': 'Condolências',
  'parabens': 'Parabéns',
  'especial': 'Especial',
  'premium': 'Premium',
  'luxo': 'Luxo',
  'classico': 'Clássico',
  'classica': 'Clássica',
  'surpresa': 'Surpresa',
  'amor': 'Amor',
  'paixao': 'Paixão',
  'saudade': 'Saudade',
  'saudades': 'Saudades',
  'conquista': 'Conquista',
  'conquistas': 'Conquistas',
  'pascoa': 'Páscoa',
  'natal': 'Natal',
  'noel': 'Noel',
  'comemoracao': 'Comemoração',
  'comemoracoes': 'Comemorações',
  'homenagem': 'Homenagem',

  // Cores
  'vermelha': 'Vermelha',
  'vermelhas': 'Vermelhas',
  'vermelho': 'Vermelho',
  'amarela': 'Amarela',
  'amarelas': 'Amarelas',
  'amarelo': 'Amarelo',
  'branca': 'Branca',
  'brancas': 'Brancas',
  'branco': 'Branco',
  'rosa': 'Rosa',
  'rosas': 'Rosas',
  'roxa': 'Roxa',
  'roxas': 'Roxas',
  'roxo': 'Roxo',
  'azul': 'Azul',
  'azuis': 'Azuis',
  'laranja': 'Laranja',
  'colorida': 'Colorida',
  'coloridas': 'Coloridas',
  'colorido': 'Colorido',

  // Adjetivos
  'bebe': 'Bebê',
  'grande': 'Grande',
  'pequeno': 'Pequeno',
  'pequena': 'Pequena',
  'medio': 'Médio',
  'media': 'Média',
  'simples': 'Simples',
  'duplo': 'Duplo',
  'tradicional': 'Tradicional',
  'moderno': 'Moderno',
  'moderna': 'Moderna',
  'exotica': 'Exótica',
  'exoticas': 'Exóticas',
  'exotico': 'Exótico',
  'elegante': 'Elegante',
  'sofisticado': 'Sofisticado',
  'sofisticada': 'Sofisticada',

  // Artigos / preposições — minúsculas em Title Case
  'da': 'da', 'de': 'de', 'do': 'do', 'das': 'das', 'dos': 'dos',
  'e': 'e', 'com': 'com', 'para': 'para', 'em': 'em',
  'a': 'a', 'o': 'o', 'as': 'as', 'os': 'os',
  'na': 'na', 'no': 'no', 'nas': 'nos', 'nos': 'nos',

  // Abreviações de números escritos
  'um': '01', 'uma': '01', 'dois': '02', 'duas': '02', 'tres': '03',
  'quatro': '04', 'cinco': '05', 'seis': '06', 'sete': '07', 'oito': '08',
  'nove': '09', 'dez': '10', 'doze': '12', 'quinze': '15', 'vinte': '20',
};

// Palavras que devem ficar em minúsculas (preposições, artigos)
const LOWER = new Set([
  'da','de','do','das','dos','e','com','para','em','a','o','as','os',
  'na','no','nas','nos','à','às','ao','aos','ou','um','uma'
]);

// Padroniza números: "3 rosas" → "03 Rosas"
function padronizaNumeros(str) {
  return str.replace(/(^|\s)(\d)(?=\s|$)/g, (_m, pre, d) => pre + '0' + d);
}

// Title Case básico com exceções
function titleCase(str) {
  return str.split(/\s+/).map((word, idx) => {
    if (!word) return word;
    const lower = word.toLowerCase();
    // Aplica dicionário de correções primeiro (case-insensitive, palavra inteira)
    if (DICT[lower] !== undefined) {
      // Se é a primeira palavra, capitaliza mesmo se for preposição
      if (idx === 0 && LOWER.has(lower)) {
        return lower.charAt(0).toUpperCase() + lower.slice(1);
      }
      return DICT[lower];
    }
    // Se for preposição/artigo no meio, mantém em minúsculas
    if (idx > 0 && LOWER.has(lower)) {
      return lower;
    }
    // Title case padrão: primeira letra maiúscula, resto minúsculas
    // Preserva palavras com hífens
    return word.split('-').map(part => {
      if (!part) return part;
      const p = part.toLowerCase();
      if (DICT[p]) return DICT[p];
      return p.charAt(0).toUpperCase() + p.slice(1);
    }).join('-');
  }).join(' ');
}

// Função principal
export function normalizeName(name) {
  if (!name || typeof name !== 'string') return name || '';

  let result = name.trim();

  // 1. Remove espaços duplicados
  result = result.replace(/\s+/g, ' ');

  // 2. Remove caracteres estranhos (mantém acentos, letras, números, hífens, espaços, &, /, ., ,)
  result = result.replace(/[^\p{L}\p{N}\s\-&/.,]/gu, '');

  // 3. Padroniza números 1-9 isolados para 01-09
  result = padronizaNumeros(result);

  // 4. Title Case com dicionário
  result = titleCase(result);

  return result;
}

// Normaliza lista de produtos (uso em massa)
export function normalizeProducts(products) {
  return products.map(p => {
    const newName = normalizeName(p.name || p.nome || '');
    return { ...p, name: newName, nome: newName };
  });
}

// Exemplos de uso (doc):
// normalizeName('buque 3 rosas vermelhas') → 'Buquê 03 Rosas Vermelhas'
// normalizeName('cesta cafe manha') → 'Cesta Café Manhã'
// normalizeName('lirios brancos') → 'Lírios Brancos'
