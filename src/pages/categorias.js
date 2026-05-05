import { S } from '../state.js';
import { GET, POST, PUT, DELETE } from '../services/api.js';
import { toast } from '../utils/helpers.js';

// ── Helper: render() via dynamic import ───────────────────────
async function render(){
  const { render:r } = await import('../main.js');
  r();
}

// ── CONSTANTES ────────────────────────────────────────────────
const CAT_KEY = 'fv_categorias';
const CAT_CFG_KEY = 'fv_cat_cfg';
const CAT_DEFAULT = ['Rosa','Buqu\u00ea','Orqu\u00eddea','Planta','Kit','Vaso','Flor','Coroa','Cesta','Embalagem','Adicional','Arranjo','Bouquet Premium','Decora\u00e7\u00e3o','Outro'];

// ── CRUD CATEGORIAS (API com fallback localStorage) ───────────
export async function getCategorias(){
  try {
    const data = await GET('/categories');
    if(Array.isArray(data) && data.length > 0){
      localStorage.setItem(CAT_KEY, JSON.stringify(data));
      return data;
    }
  } catch(e){ /* fallback */ }
  const s = JSON.parse(localStorage.getItem(CAT_KEY)||'null');
  return s || CAT_DEFAULT;
}

// ── Sync lazy: busca no backend e faz merge com localStorage ──
export async function getCategoriasFromAPI(){
  try {
    const data = await GET('/categories');
    if(Array.isArray(data) && data.length > 0){
      // Normaliza itens: backend pode devolver objetos { _id, name } ou strings
      const apiList = data.map(function(item){
        if(typeof item === 'string') return { name: item };
        return item || {};
      }).filter(function(it){ return it && it.name; });

      const local = getCategoriasSync();
      // local pode ser array de strings (default) ou array de objetos
      const localNorm = local.map(function(item){
        if(typeof item === 'string') return { name: item };
        return item || {};
      }).filter(function(it){ return it && it.name; });

      const merged = apiList.map(function(apiCat){
        const localCat = localNorm.find(function(l){ return l.name === apiCat.name; });
        return Object.assign({}, apiCat, (localCat || {}), { _id: apiCat._id, name: apiCat.name });
      });
      // Adiciona categorias locais que não estão no backend
      localNorm.forEach(function(lc){
        if(!apiList.find(function(d){ return d.name === lc.name; })) merged.push(lc);
      });
      localStorage.setItem(CAT_KEY, JSON.stringify(merged));
      return merged;
    }
  } catch(e){ /* silent */ }
  return getCategoriasSync();
}

// ── Trigger lazy fetch on page open ────────────────────────────
let _catFetched = false;
function triggerCatFetch(){
  if(_catFetched) return;
  _catFetched = true;
  getCategoriasFromAPI().then(function(){
    if(S.page === 'categorias') render();
  }).catch(function(){});
}

export async function saveCategorias(list){
  localStorage.setItem(CAT_KEY, JSON.stringify(list));
  try { await POST('/categories', { categories: list }); } catch(e){ /* silent */ }
}

export async function getCatCfg(){
  try {
    const data = await GET('/settings/categorias-cfg');
    if(data && typeof data === 'object' && Object.keys(data).length > 0){
      localStorage.setItem(CAT_CFG_KEY, JSON.stringify(data));
      return data;
    }
  } catch(e){ /* fallback */ }
  return JSON.parse(localStorage.getItem(CAT_CFG_KEY)||'{}');
}

export async function saveCatCfg(cfg){
  localStorage.setItem(CAT_CFG_KEY, JSON.stringify(cfg));
  try { await POST('/settings/categorias-cfg', cfg); } catch(e){ /* silent */ }
}

// ── Sync helpers (para uso inline onde async n\u00e3o \u00e9 poss\u00edvel) ──
function getCategoriasSync(){ const s=JSON.parse(localStorage.getItem(CAT_KEY)||'null'); return s||CAT_DEFAULT; }
// Nome da categoria (aceita string ou objeto { name })
function catName(c){ return (c && typeof c === 'object') ? (c.name || '') : (c || ''); }
function getCatCfgSync(){ return JSON.parse(localStorage.getItem(CAT_CFG_KEY)||'{}'); }

export function isCatAtiva(nome){ const cfg=getCatCfgSync(); return cfg[nome]?.activeOnSite!==false; }

// ── MODAL ─────────────────────────────────────────────────────
export function showCatModal(idx){
  var cats   = getCategoriasSync();
  var isEdit = idx !== undefined && idx !== null;
  var val    = isEdit ? catName(cats[parseInt(idx)]) : '';
  var title  = isEdit ? '\u270f\ufe0f Editar Categoria' : '\ud83c\udff7\ufe0f Nova Categoria';
  var btnTxt = isEdit ? '\ud83d\udcbe Salvar Altera\u00e7\u00e3o' : '\u2705 Criar Categoria';
  var idxVal = isEdit ? parseInt(idx) : 'null';

  S._modal = '<div class="mo" id="mo" onclick="if(event.target===this){S._modal=\'\';render();}">'
    + '<div class="mo-box" style="max-width:400px;" onclick="event.stopPropagation()">'
    + '<div style="font-family:\'Playfair Display\',serif;font-size:17px;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--border);">'
    + title
    + '</div>'
    + '<div class="fg">'
    + '<label class="fl">Nome da categoria *</label>'
    + '<input class="fi" id="cat-name-input" placeholder="Ex: Buqu\u00ea Premium" value="' + val + '"/>'
    + '</div>'
    + '<div style="display:flex;gap:8px;margin-top:16px;">'
    + '<button type="button" class="btn btn-primary" style="flex:1;" onclick="saveCatFromModal(' + idxVal + ')">' + btnTxt + '</button>'
    + '<button type="button" class="btn btn-ghost" onclick="S._modal=\'\';render();">Cancelar</button>'
    + '</div></div></div>';
  render();
  setTimeout(function(){ var el=document.getElementById('cat-name-input'); if(el){el.focus();el.select();} }, 100);
}

// ── SALVAR DO MODAL ───────────────────────────────────────────
export function saveCatFromModal(idx){
  var input = document.getElementById('cat-name-input');
  if(!input){ toast('Erro: campo n\u00e3o encontrado', true); return; }
  var name = input.value.trim();
  if(!name){ toast('\u274c Digite o nome da categoria', true); return; }
  var cats = getCategoriasSync();
  var cfg  = getCatCfgSync();
  if(idx === null || idx === 'null' || idx === undefined){
    if(cats.some(function(c){ return catName(c) === name; })){ toast('\u26a0\ufe0f Categoria j\u00e1 existe', true); return; }
    cats.push(name);
    cfg[name] = {activeOnSystem: true, activeOnEcommerce: true};
    toast('\u2705 Categoria criada: ' + name);
  } else {
    var i   = parseInt(idx);
    var old = catName(cats[i]);
    if(cats[i] && typeof cats[i] === 'object') cats[i] = Object.assign({}, cats[i], { name: name });
    else cats[i] = name;
    if(old !== name){
      cfg[name] = cfg[old] || {activeOnSystem: true, activeOnEcommerce: true};
      delete cfg[old];
      S.products = S.products.map(function(p){
        if(p.category === old) return Object.assign({}, p, {category: name});
        if(Array.isArray(p.categories)) return Object.assign({}, p, {categories: p.categories.map(function(c){ return c===old?name:c; })});
        return p;
      });
    }
    toast('\u2705 Categoria atualizada: ' + name);
  }
  saveCategorias(cats);
  saveCatCfg(cfg);
  S._modal = ''; render();
}

// ── DELETAR ───────────────────────────────────────────────────
export async function deleteCat(idx){
  var cats  = getCategoriasSync();
  var cat   = catName(cats[parseInt(idx)]);
  // Validacao de exclusao: admin direto, demais com senha 2233
  var { autorizaExclusao } = await import('../utils/helpers.js');
  if (!autorizaExclusao('categoria')) return;
  var total = S.products.filter(function(p){
    return Array.isArray(p.categories) ? p.categories.indexOf(cat)>=0 : p.category===cat;
  }).length;
  if(total > 0 && !confirm('A categoria "' + cat + '" tem ' + total + ' produto(s). Excluir mesmo assim?')) return;
  cats.splice(parseInt(idx), 1);
  saveCategorias(cats);
  var cfg = getCatCfgSync(); delete cfg[cat]; saveCatCfg(cfg);
  toast('\ud83d\uddd1\ufe0f Categoria "' + cat + '" removida');
  render();
}

// ── LIMPEZA: dedup + remove inúteis ──────────────────────────
// Lista de categorias inúteis que vieram por engano (turnos, horários, etc)
const CAT_INUTIL = ['horario','horarios','horário','horários','turno','turnos','manha','manhã','tarde','noite','periodo','período','hora','horas'];

// Normalização básica: minúscula, sem acento, sem espaços extras
function _basicNorm(s){
  if(!s) return '';
  return String(s).toLowerCase().trim()
    .normalize('NFD').replace(/[̀-ͯ]/g,'')
    .replace(/\s+/g,' ');
}

// Gera múltiplas formas (stems) pra detectar plurais variados em PT-BR.
// Ex: "buquê" → ["buque"], "buquês" → ["buques","buque"]
// Ex: "flor" → ["flor"], "flores" → ["flores","flore","flor"]
function _stems(s){
  const n = _basicNorm(s);
  const out = new Set([n]);
  if(n.length > 3 && n.endsWith('s')) out.add(n.slice(0,-1));   // plural simples: rosas→rosa, buques→buque
  if(n.length > 4 && n.endsWith('es')) out.add(n.slice(0,-2));  // plural -es: flores→flor
  if(n.length > 4 && n.endsWith('oes')) out.add(n.slice(0,-3)+'ao'); // -ões → -ão (corações→coracao)
  return [...out];
}

export async function limparCategorias(){
  if(!confirm('🧹 LIMPAR CATEGORIAS\n\nIsto vai:\n• Remover categorias inúteis (Horários, Turnos, etc)\n• Mesclar duplicatas (ex: Buquê + Buquês = Buquê)\n• Atualizar produtos pra usar o nome canônico\n\nContinuar?')) return;

  var cats = getCategoriasSync();
  var nomes = cats.map(catName).filter(Boolean);

  // 1) Remove inúteis
  var antes = nomes.length;
  nomes = nomes.filter(function(n){ return CAT_INUTIL.indexOf(_basicNorm(n)) < 0; });
  var inuteis = antes - nomes.length;

  // 2) Union-Find por stems comuns: agrupa nomes com qualquer stem em comum
  //    Ex: "Buquê" stems=[buque], "Buquês" stems=[buques,buque] → comum "buque" → grupo único
  var parent = {};
  var find = function(x){ return parent[x]===x ? x : (parent[x] = find(parent[x])); };
  var union = function(a,b){ var ra=find(a), rb=find(b); if(ra!==rb) parent[ra]=rb; };

  nomes.forEach(function(n){ parent[n] = n; });
  for(var i=0; i<nomes.length; i++){
    var sa = _stems(nomes[i]);
    for(var j=i+1; j<nomes.length; j++){
      var sb = _stems(nomes[j]);
      if(sa.some(function(x){ return sb.indexOf(x) >= 0; })) union(nomes[i], nomes[j]);
    }
  }
  // Agrupa por raiz
  var grupos = {};
  nomes.forEach(function(n){
    var r = find(n);
    if(!grupos[r]) grupos[r] = [];
    grupos[r].push(n);
  });

  // 3) Para cada grupo, escolhe canônico (o que tem MAIS produtos, ou o mais bem formatado)
  var canonicalMap = {}; // variante → canônico
  var finais = [];
  var dupsRemovidas = 0;

  Object.keys(grupos).forEach(function(k){
    var variantes = grupos[k];
    if(variantes.length === 1){
      finais.push(variantes[0]);
      canonicalMap[variantes[0]] = variantes[0];
      return;
    }
    // Escolhe canônico: o com mais produtos. Em empate, o que tem acento (mais "bonito")
    var melhor = variantes[0];
    var melhorScore = -1;
    variantes.forEach(function(v){
      var qtd = S.products.filter(function(p){
        return Array.isArray(p.categories) ? p.categories.indexOf(v)>=0 : p.category===v;
      }).length;
      var temAcento = /[áéíóúâêôãõç]/i.test(v) ? 0.5 : 0;
      var score = qtd + temAcento + (v.charAt(0)===v.charAt(0).toUpperCase() ? 0.1 : 0);
      if(score > melhorScore){ melhorScore = score; melhor = v; }
    });
    finais.push(melhor);
    variantes.forEach(function(v){ canonicalMap[v] = melhor; });
    dupsRemovidas += variantes.length - 1;
  });

  // 4) Atualiza produtos: troca todas as variantes pelo canônico
  var prodsAtualizados = 0;
  S.products = S.products.map(function(p){
    var changed = false;
    var np = Object.assign({}, p);
    if(p.category && canonicalMap[p.category] && canonicalMap[p.category] !== p.category){
      np.category = canonicalMap[p.category];
      changed = true;
    }
    if(Array.isArray(p.categories)){
      var nc = p.categories.map(function(c){ return canonicalMap[c] || c; });
      // dedup
      nc = [...new Set(nc)];
      if(JSON.stringify(nc) !== JSON.stringify(p.categories)){
        np.categories = nc;
        changed = true;
      }
    }
    if(changed) prodsAtualizados++;
    return np;
  });

  // Persiste produtos atualizados (best-effort)
  try {
    const { PUT } = await import('../services/api.js');
    for(const p of S.products){
      if(p._id){
        try { await PUT('/products/'+p._id, p); } catch(_){}
      }
    }
  } catch(_){}

  // 5) Salva nova lista de categorias (preserva tipo: string ou objeto)
  var novosCats = finais.map(function(n){
    var orig = cats.find(function(c){ return catName(c)===n; });
    return orig || n;
  });
  saveCategorias(novosCats);

  // 6) Limpa cfg de cats removidas
  var cfg = getCatCfgSync();
  Object.keys(cfg).forEach(function(k){
    if(finais.indexOf(k) < 0) delete cfg[k];
  });
  saveCatCfg(cfg);

  toast('🧹 Limpeza concluída: '+inuteis+' inútil(eis) + '+dupsRemovidas+' duplicada(s) removida(s). '+prodsAtualizados+' produto(s) atualizado(s).');
  render();
}

// ── MOVER ─────────────────────────────────────────────────────
export function moveCat(idx, dir){
  var cats = getCategoriasSync();
  var ni   = idx + dir;
  if(ni < 0 || ni >= cats.length) return;
  var tmp = cats[idx]; cats[idx] = cats[ni]; cats[ni] = tmp;
  saveCategorias(cats); render();
}

// ── TOGGLES ───────────────────────────────────────────────────
export function toggleCatSystem(cat, active){
  var cfg = getCatCfgSync();
  cfg[cat] = Object.assign({}, cfg[cat] || {}, {activeOnSystem: active});
  saveCatCfg(cfg);
  toast((active ? '\u2705 ' : '\u274c ') + cat + (active ? ' ativa no sistema' : ' oculta no sistema'));
  render();
}

export function toggleCatEcommerce(cat, active){
  var cfg = getCatCfgSync();
  cfg[cat] = Object.assign({}, cfg[cat] || {}, {activeOnEcommerce: active});
  saveCatCfg(cfg);
  toast((active ? '\u2705 ' : '\u274c ') + cat + (active ? ' ativa no e-commerce' : ' oculta no e-commerce'));
  render();
}

// ── DRILL-DOWN: produtos de uma categoria ─────────────────────
export function showCatProdutos(catName){
  S._catDetail = catName;
  render();
}

export function closeCatProdutos(){
  S._catDetail = null;
  S._catBulkOpen = false;
  S._catBulkSelected = null;
  S._catBulkSearch = '';
  render();
}

// ── REMOVER produto de uma categoria ──────────────────────────
export async function removeProdFromCat(productId, catName){
  const p = S.products.find(x => x._id === productId || x.id === productId);
  if(!p) return;
  // Se estava no campo `category` (string) — limpa
  if(p.category === catName) p.category = '';
  // Se estava em `categories` (array) — remove
  if(Array.isArray(p.categories)) p.categories = p.categories.filter(c => c !== catName);
  S.products = S.products.map(x => (x._id===p._id||x.id===p.id) ? p : x);
  try{ await PUT('/products/' + (p._id||p.id), { category: p.category, categories: p.categories||[] }); }
  catch(e){ /* silent */ }
  toast('🗑️ Produto removido da categoria');
  render();
}

// ── BULK: abre modal de seleção em massa ──────────────────────
export function openBulkAddModal(){
  S._catBulkOpen = true;
  S._catBulkSelected = new Set();
  S._catBulkSearch = '';
  render();
}

export function toggleBulkProd(productId){
  if(!S._catBulkSelected || !(S._catBulkSelected instanceof Set)) S._catBulkSelected = new Set();
  const id = String(productId||'');
  if(S._catBulkSelected.has(id)) S._catBulkSelected.delete(id);
  else S._catBulkSelected.add(id);
  render();
}

export function setBulkSearch(val){
  S._catBulkSearch = val;
  // Re-render suave (sem destruir input)
  const count = document.getElementById('bulk-count-label');
  if(count){
    const visibleIds = _getBulkVisibleIds();
    count.textContent = `${visibleIds.length} produto(s) encontrado(s)`;
  }
  const list = document.getElementById('bulk-prod-list');
  if(list) list.innerHTML = _renderBulkList();
  // Re-bind checkboxes
  document.querySelectorAll('[data-bulk-toggle]').forEach(cb => {
    cb.onchange = () => toggleBulkProd(cb.dataset.bulkToggle);
  });
}

// DEDUP de S.products por _id (proteção contra duplicatas no estado)
function _dedupProducts(){
  const seen = new Set();
  return (S.products || []).filter(p => {
    const id = String(p._id || p.id || '');
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function _filtraBulk(){
  const catName = S._catDetail;
  const q = (S._catBulkSearch || '').toLowerCase();
  const filtroCat = S._catBulkFilterCat || ''; // categoria a filtrar (vazio = todas)
  return _dedupProducts().filter(p => {
    // Exclui os que já estão na categoria atual
    const has = (p.category === catName) ||
      (Array.isArray(p.categories) && p.categories.includes(catName));
    if(has) return false;
    // Filtro por categoria (se selecionada)
    if (filtroCat) {
      const cats = Array.isArray(p.categories) ? p.categories : (p.category ? [p.category] : []);
      if (filtroCat === '__sem__') {
        // 'Sem categoria' — nenhuma categoria
        if (cats.length > 0) return false;
      } else {
        if (!cats.includes(filtroCat)) return false;
      }
    }
    if(q){
      const hay = ((p.name||'') + ' ' + (p.code||'') + ' ' + (p.category||'') + ' ' +
        (Array.isArray(p.categories) ? p.categories.join(' ') : '')).toLowerCase();
      if(!hay.includes(q)) return false;
    }
    return true;
  });
}

function _getBulkVisibleIds(){
  return _filtraBulk().map(p => String(p._id || p.id || ''));
}

function _renderBulkList(){
  const selected = S._catBulkSelected || new Set();
  const available = _filtraBulk();

  if(available.length === 0){
    return '<div style="padding:30px;text-align:center;color:var(--muted);font-size:13px;">🌸 Nenhum produto disponível (ou todos já estão nesta categoria).</div>';
  }

  return available.map(p => {
    const id = String(p._id || p.id || '');
    const isSelected = selected.has(id);
    // Aceita imagem em multiplos formatos (compat com produtos antigos)
    const img = p.imagem || p.images?.[0] || p.image || p.foto || '';
    // Preco: prioriza salePrice (campo canonico), fallback price/preco/valor
    const preco = Number(p.salePrice || p.price || p.preco || p.valor || 0);
    const currentCats = Array.isArray(p.categories) ? p.categories.join(', ') : (p.category || '—');
    return `
    <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--border);cursor:pointer;background:${isSelected?'#F0FDF4':'#fff'};transition:background .1s;">
      <input type="checkbox" data-bulk-toggle="${id}" onchange="window.toggleBulkProd('${id}')" ${isSelected?'checked':''} style="width:18px;height:18px;accent-color:#16A34A;cursor:pointer;flex-shrink:0;"/>
      ${img
        ? `<img src="${img}" loading="lazy" decoding="async" style="width:42px;height:42px;border-radius:6px;object-fit:cover;flex-shrink:0;border:1px solid #F1F5F9;" onerror="this.outerHTML='<div style=\\'width:42px;height:42px;border-radius:6px;background:#FAE8E6;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;\\'>🌸</div>'"/>`
        : `<div style="width:42px;height:42px;border-radius:6px;background:#FAE8E6;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">🌸</div>`}
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;font-size:13px;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${p.name||'—'}</div>
        <div style="font-size:11px;color:var(--muted);">${currentCats}</div>
      </div>
      <div style="font-weight:700;color:var(--rose);font-size:13px;flex-shrink:0;white-space:nowrap;">${preco>0?`R$ ${preco.toFixed(2).replace('.',',')}`:'<span style="color:#94A3B8;">—</span>'}</div>
    </label>`;
  }).join('');
}

export async function applyBulkAdd(){
  const catName = S._catDetail;
  // DEDUP de IDs (Set já garante mas reforça em caso de Array de fora)
  const selected = [...new Set(Array.from(S._catBulkSelected || []))];
  if(selected.length === 0){ toast('❌ Selecione ao menos 1 produto', true); return; }

  toast(`⏳ Vinculando ${selected.length} produto(s)...`);
  let ok = 0, fail = 0;
  // Trabalha em CÓPIAS para evitar mutar S.products durante o loop
  const updates = new Map(); // id -> {category, categories}
  for(const id of selected){
    const p = S.products.find(x => String(x._id) === String(id) || String(x.id) === String(id));
    if(!p) { fail++; continue; }
    // Cria nova lista de categorias SEM duplicatas
    const cats0 = Array.isArray(p.categories) ? [...p.categories]
                : (p.category ? [p.category] : []);
    const set = new Set(cats0);
    set.add(catName);
    const newCategories = [...set]; // unica
    const newCategory = p.category || catName;
    updates.set(String(p._id||p.id), { category: newCategory, categories: newCategories });
  }

  // Aplica updates de uma só vez (sem duplicar entradas em S.products)
  S.products = S.products.map(x => {
    const id = String(x._id||x.id);
    const u = updates.get(id);
    if (!u) return x;
    return { ...x, category: u.category, categories: u.categories };
  });

  // Persiste no backend (paralelo controlado)
  for (const [id, u] of updates) {
    try {
      await PUT('/products/' + id, u);
      ok++;
    } catch(e) { fail++; }
  }

  S._catBulkOpen = false;
  S._catBulkSelected = null;
  S._catBulkSearch = '';
  S._catBulkFilterCat = '';
  render();
  if(fail === 0) toast(`✅ ${ok} produto(s) vinculado(s) à categoria "${catName}"!`);
  else toast(`⚠️ ${ok} vinculado(s) · ${fail} falha(s)`, true);
}

export function closeBulkModal(){
  S._catBulkOpen = false;
  S._catBulkSelected = null;
  S._catBulkSearch = '';
  S._catBulkFilterCat = '';
  render();
}

// ── Expose to window for inline onclick handlers ──────────────
window.showCatModal = showCatModal;
window.saveCatFromModal = saveCatFromModal;
window.deleteCat = deleteCat;
window.moveCat = moveCat;
window.toggleCatSystem = toggleCatSystem;
window.toggleCatEcommerce = toggleCatEcommerce;
window.showCatProdutos = showCatProdutos;
window.closeCatProdutos = closeCatProdutos;
window.removeProdFromCat = removeProdFromCat;
window.openBulkAddModal = openBulkAddModal;
window.toggleBulkProd = toggleBulkProd;
window.setBulkSearch = setBulkSearch;
window.applyBulkAdd = applyBulkAdd;
window.closeBulkModal = closeBulkModal;
window.limparCategorias = limparCategorias;

// ── RENDER: DRILL-DOWN (produtos de uma categoria) ────────────
function renderCatDetail(catName){
  // DEDUP por _id (proteção contra duplicatas em S.products)
  const seen = new Set();
  const prods = S.products.filter(p => {
    const id = String(p._id || p.id || '');
    if (!id) return false;
    if (seen.has(id)) return false;
    seen.add(id);
    return (Array.isArray(p.categories) && p.categories.includes(catName)) ||
           p.category === catName;
  });

  let html = '';
  // Breadcrumb + header
  html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap;">';
  html += '<button type="button" class="btn btn-ghost btn-sm" onclick="closeCatProdutos()" style="padding:6px 12px;">← Voltar</button>';
  html += '<div style="font-size:12px;color:var(--muted);">Categorias</div>';
  html += '<span style="color:var(--muted);">›</span>';
  html += '<h2 style="font-family:\'Playfair Display\',serif;font-size:22px;color:var(--primary);margin:0;">🏷️ '+catName+'</h2>';
  html += '<span style="background:var(--rose);color:#fff;border-radius:20px;padding:2px 10px;font-size:12px;font-weight:700;">'+prods.length+' produto(s)</span>';
  html += '<button type="button" class="btn btn-primary" style="margin-left:auto;" onclick="openBulkAddModal()">➕ Adicionar em massa</button>';
  html += '</div>';

  if(prods.length === 0){
    html += '<div class="empty card"><div class="empty-icon">📦</div><p>Nenhum produto nesta categoria ainda.</p>';
    html += '<button type="button" class="btn btn-primary" style="margin-top:12px;" onclick="openBulkAddModal()">➕ Adicionar produtos</button></div>';
  } else {
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;">';
    for(const p of prods){
      const id = p._id || p.id;
      const img = p.imagem || p.images?.[0] || p.image || p.foto || '';
      const otherCats = Array.isArray(p.categories)
        ? p.categories.filter(c => c !== catName)
        : [];
      const stock = typeof p.stock === 'number' ? p.stock : (p.estoque||0);
      const stockColor = stock > 5 ? 'var(--leaf)' : stock > 0 ? '#D97706' : 'var(--red)';

      html += '<div style="background:#fff;border:1.5px solid var(--border);border-radius:12px;overflow:hidden;box-shadow:var(--shadow);">';
      html += '<div style="height:140px;background:#FAE8E6;display:flex;align-items:center;justify-content:center;position:relative;">';
      if(img) html += '<img src="'+img+'" style="width:100%;height:100%;object-fit:cover;"/>';
      else html += '<span style="font-size:48px;">🌸</span>';
      html += '<button type="button" title="Remover desta categoria" onclick="removeProdFromCat(\''+id+'\',\''+catName.replace(/'/g,"\\'")+'\')"';
      html += ' style="position:absolute;top:8px;right:8px;background:rgba(220,38,38,.9);color:#fff;border:none;width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;">×</button>';
      html += '</div>';
      html += '<div style="padding:10px 12px;">';
      html += '<div style="font-weight:700;font-size:13px;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+(p.name||'—')+'</div>';
      html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:4px;">';
      html += '<span style="font-size:14px;font-weight:800;color:var(--rose);">R$ '+(Number(p.price)||0).toFixed(2).replace('.',',')+'</span>';
      html += '<span style="font-size:10px;color:'+stockColor+';font-weight:700;">📦 '+stock+'</span>';
      html += '</div>';
      if(otherCats.length > 0){
        html += '<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:3px;">';
        for(const oc of otherCats){
          html += '<span style="font-size:9px;background:var(--cream);color:var(--muted);padding:1px 6px;border-radius:8px;">'+oc+'</span>';
        }
        html += '</div>';
      }
      html += '</div></div>';
    }
    html += '</div>';
  }

  // Modal de bulk add (se aberto)
  if(S._catBulkOpen){
    html += renderBulkAddModal(catName);
  }

  return html;
}

function renderBulkAddModal(catName){
  const selected = S._catBulkSelected || new Set();
  const visibleIds = _getBulkVisibleIds();

  let html = '<div class="mo" id="mo" onclick="if(event.target===this){closeBulkModal();}">';
  html += '<div class="mo-box" style="max-width:640px;width:95%;max-height:85vh;display:flex;flex-direction:column;padding:0;" onclick="event.stopPropagation()">';

  // Header
  html += '<div style="padding:16px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;">';
  html += '<div>';
  html += '<div style="font-family:\'Playfair Display\',serif;font-size:17px;font-weight:700;">➕ Adicionar produtos em massa</div>';
  html += '<div style="font-size:12px;color:var(--muted);margin-top:2px;">Selecione os produtos para vincular à categoria <strong>'+catName+'</strong></div>';
  html += '</div>';
  html += '<button type="button" onclick="closeBulkModal()" style="background:none;border:none;font-size:24px;cursor:pointer;color:var(--muted);">×</button>';
  html += '</div>';

  // Busca + Filtro por categoria
  html += '<div style="padding:12px 20px;border-bottom:1px solid var(--border);display:grid;gap:8px;">';
  // Linha 1: busca textual
  html += '<input type="text" id="bulk-search-input" class="fi" placeholder="🔍 Buscar produto por nome ou código..." value="'+(S._catBulkSearch||'').replace(/"/g,'&quot;')+'" style="width:100%;"/>';
  // Linha 2: filtro categoria + selecionar todos visíveis
  const todasCats = (function(){
    const set = new Set();
    _dedupProducts().forEach(p => {
      const cats = Array.isArray(p.categories) ? p.categories : (p.category ? [p.category] : []);
      cats.forEach(c => { if (c && c !== catName) set.add(c); });
    });
    return [...set].sort((a,b) => a.localeCompare(b, 'pt-BR'));
  })();
  const filtroCatAtual = S._catBulkFilterCat || '';
  html += '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">';
  html += '<label style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;">🏷️ Categoria:</label>';
  html += '<select id="bulk-cat-filter" class="fi" style="flex:1;min-width:160px;font-size:13px;">';
  html += '<option value="">Todas as categorias</option>';
  html += '<option value="__sem__"'+(filtroCatAtual==='__sem__'?' selected':'')+'>📭 Sem categoria</option>';
  todasCats.forEach(c => {
    html += '<option value="'+c.replace(/"/g,'&quot;')+'"'+(filtroCatAtual===c?' selected':'')+'>'+c+'</option>';
  });
  html += '</select>';
  html += '<button type="button" id="bulk-select-all" class="btn btn-ghost btn-sm" style="font-size:11px;white-space:nowrap;">☑️ Selecionar todos</button>';
  html += '<button type="button" id="bulk-clear-sel" class="btn btn-ghost btn-sm" style="font-size:11px;color:var(--red);white-space:nowrap;">☐ Limpar</button>';
  html += '</div>';
  html += '<div id="bulk-count-label" style="font-size:11px;color:var(--muted);">'+visibleIds.length+' produto(s) encontrado(s)</div>';
  html += '</div>';

  // Lista
  html += '<div id="bulk-prod-list" style="flex:1;overflow-y:auto;max-height:50vh;">';
  html += _renderBulkList();
  html += '</div>';

  // Footer
  html += '<div style="padding:14px 20px;border-top:1px solid var(--border);background:var(--cream);display:flex;align-items:center;gap:10px;flex-wrap:wrap;">';
  html += '<div style="flex:1;font-size:13px;font-weight:700;"><span id="bulk-sel-count">'+selected.size+'</span> produto(s) selecionado(s)</div>';
  html += '<button type="button" class="btn btn-ghost" onclick="closeBulkModal()">Cancelar</button>';
  html += '<button type="button" class="btn btn-primary" onclick="applyBulkAdd()" '+(selected.size===0?'disabled style="opacity:.5;"':'')+'>✅ Vincular <span>'+selected.size+'</span> produto(s)</button>';
  html += '</div>';

  html += '</div></div>';
  return html;
}

// ── RENDER ────────────────────────────────────────────────────
export function renderCategorias(){
  triggerCatFetch();
  // Se drill-down de categoria está ativo
  if(S._catDetail){
    return renderCatDetail(S._catDetail);
  }
  var allCats = getCategoriasSync();
  var catCfg  = getCatCfgSync();
  var search  = (S._catSearch || '').toLowerCase();
  // Aplica filtro por nome (case-insensitive), mantendo índice original
  var cats = allCats
    .map(function(c, i){ return { c: c, i: i }; })
    .filter(function(x){ return catName(x.c).toLowerCase().indexOf(search) >= 0; });
  var html = '';

  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px;">';
  html += '<div>';
  html += '<h2 style="font-family:\'Playfair Display\',serif;font-size:22px;color:var(--primary);">\ud83c\udff7\ufe0f Categorias</h2>';
  html += '<p style="font-size:13px;color:var(--muted);">Gerencie categorias \u2014 cada produto pode ter m\u00faltiplas categorias</p>';
  html += '</div>';
  html += '<div style="display:flex;gap:8px;flex-wrap:wrap;">';
  html += '<button type="button" class="btn btn-ghost" onclick="window.limparCategorias()" style="background:#FEF3C7;color:#92400E;border:1px solid #FCD34D;">🧹 Limpar duplicadas</button>';
  html += '<button type="button" class="btn btn-primary" onclick="showCatModal()">+ Nova Categoria</button>';
  html += '</div>';
  html += '</div>';

  html += '<div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:10px;padding:12px 16px;font-size:12px;color:#1D4ED8;margin-bottom:16px;">';
  html += '\ud83d\udca1 <strong>Dica:</strong> No m\u00f3dulo Produtos voc\u00ea pode atribuir m\u00faltiplas categorias a cada produto. Aqui voc\u00ea controla a visibilidade de cada categoria.';
  html += '</div>';

  // Campo de busca
  html += '<div style="position:relative;margin-bottom:14px;max-width:420px;">';
  html += '<span style="position:absolute;left:12px;top:50%;transform:translateY(-50%);font-size:14px;pointer-events:none;">\ud83d\udd0d</span>';
  html += '<input type="text" id="cat-search" class="fi" placeholder="Buscar categoria..." value="'+(S._catSearch||'').replace(/"/g,'&quot;')+'" style="padding-left:34px;width:100%;"/>';
  html += '</div>';

  if(allCats.length === 0){
    html += '<div class="empty card"><div class="empty-icon">\ud83c\udff7\ufe0f</div><p>Nenhuma categoria cadastrada. Clique em + Nova Categoria.</p></div>';
  } else if(cats.length === 0){
    html += '<div class="empty card"><div class="empty-icon">\ud83d\udd0d</div><p>Nenhuma categoria encontrada para "'+(S._catSearch||'')+'".</p></div>';
  } else {
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px;">';
    for(var idxF=0; idxF<cats.length; idxF++){
      var i       = cats[idxF].i;
      var cat     = catName(cats[idxF].c);
      var cfg     = catCfg[cat] || {};
      var ativoS  = cfg.activeOnSystem !== false;
      var ativoE  = cfg.activeOnEcommerce !== false;
      var total   = S.products.filter(function(p){
        return Array.isArray(p.categories) ? p.categories.indexOf(cat)>=0 : p.category===cat;
      }).length;

      html += '<div style="border:1.5px solid '+(ativoS?'#86EFAC':'var(--border)')+'';
      html += ';border-radius:12px;overflow:hidden;background:#fff;box-shadow:var(--shadow);">';

      // Header
      html += '<div style="padding:12px 14px;background:'+(ativoS?'#F0FDF4':'#FAFAFA')+'';
      html += ';border-bottom:1px solid var(--border);">';
      html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">';
      html += '<div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;">';
      html += '<span style="font-size:20px;">'+(ativoS?'\ud83c\udff7\ufe0f':'\ud83d\udd12')+'</span>';
      html += '<div>';
      html += '<div style="font-weight:700;font-size:15px;">'+cat+'</div>';
      html += '<div style="font-size:11px;color:var(--muted);">'+total+' produto(s)</div>';
      html += '</div></div>';
      html += '<div style="display:flex;gap:4px;flex-shrink:0;">';
      if(i>0) html += '<button type="button" class="btn btn-ghost btn-xs" onclick="moveCat('+i+',-1)" title="Subir">\u2191</button>';
      if(i<allCats.length-1) html += '<button type="button" class="btn btn-ghost btn-xs" onclick="moveCat('+i+',1)" title="Descer">\u2193</button>';
      html += '<button type="button" class="btn btn-ghost btn-xs" onclick="showCatModal('+i+')" title="Editar">\u270f\ufe0f</button>';
      html += '<button type="button" class="btn btn-ghost btn-xs" onclick="deleteCat('+i+')" style="color:var(--red);" title="Excluir">\ud83d\uddd1\ufe0f</button>';
      html += '</div></div>';
      // Botão "Ver produtos" em linha cheia no header
      html += '<button type="button" onclick="showCatProdutos(\''+cat.replace(/\'/g,"\\\'")+'\')"';
      html += ' style="width:100%;margin-top:10px;background:#fff;border:1.5px solid var(--rose);color:var(--rose);border-radius:8px;padding:8px;font-size:12px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;transition:all .15s;"';
      html += ' onmouseover="this.style.background=\'var(--rose)\';this.style.color=\'#fff\';"';
      html += ' onmouseout="this.style.background=\'#fff\';this.style.color=\'var(--rose)\';">';
      html += '👁️ Ver produtos desta categoria';
      html += '</button>';
      html += '</div>';

      // Toggles
      html += '<div style="padding:12px 14px;display:flex;flex-direction:column;gap:8px;">';

      // Sistema toggle
      html += '<label style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;';
      html += 'padding:9px 12px;border-radius:8px;';
      html += 'background:'+(ativoS?'#F0FDF4':'#F9FAFB')+';';
      html += 'border:1.5px solid '+(ativoS?'#86EFAC':'#E5E7EB')+'">';
      html += '<div>';
      html += '<div style="font-size:13px;font-weight:700;color:'+(ativoS?'#16A34A':'#9CA3AF')+'">\ud83d\udda5\ufe0f Vis\u00edvel no Sistema</div>';
      html += '<div style="font-size:11px;color:var(--muted);">'+(ativoS?'Aparece no PDV e filtros':'Oculta no sistema')+'</div>';
      html += '</div>';
      html += '<input type="checkbox" '+(ativoS?'checked':'')+' onchange="toggleCatSystem(\''+cat+'\',this.checked)" style="width:18px;height:18px;accent-color:#16A34A;cursor:pointer;"/>';
      html += '</label>';

      // Ecommerce toggle
      html += '<label style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;';
      html += 'padding:9px 12px;border-radius:8px;';
      html += 'background:'+(ativoE?'#EFF6FF':'#F9FAFB')+';';
      html += 'border:1.5px solid '+(ativoE?'#BFDBFE':'#E5E7EB')+'">';
      html += '<div>';
      html += '<div style="font-size:13px;font-weight:700;color:'+(ativoE?'#2563EB':'#9CA3AF')+'">\ud83d\uded2 Vis\u00edvel no E-commerce</div>';
      html += '<div style="font-size:11px;color:var(--muted);">'+(ativoE?'Aparece na loja virtual':'Oculta na loja')+'</div>';
      html += '</div>';
      html += '<input type="checkbox" '+(ativoE?'checked':'')+' onchange="toggleCatEcommerce(\''+cat+'\',this.checked)" style="width:18px;height:18px;accent-color:#2563EB;cursor:pointer;"/>';
      html += '</label>';

      html += '</div></div>'; // close toggles + card
    }
    html += '</div>'; // close grid
  }

  return html;
}
