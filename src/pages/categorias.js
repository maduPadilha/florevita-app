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
export function deleteCat(idx){
  var cats  = getCategoriasSync();
  var cat   = catName(cats[parseInt(idx)]);
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

// ── Expose to window for inline onclick handlers ──────────────
window.showCatModal = showCatModal;
window.saveCatFromModal = saveCatFromModal;
window.deleteCat = deleteCat;
window.moveCat = moveCat;
window.toggleCatSystem = toggleCatSystem;
window.toggleCatEcommerce = toggleCatEcommerce;

// ── RENDER ────────────────────────────────────────────────────
export function renderCategorias(){
  triggerCatFetch();
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
  html += '<button type="button" class="btn btn-primary" onclick="showCatModal()">+ Nova Categoria</button>';
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
      html += '<button type="button" class="btn btn-ghost btn-xs" onclick="showCatModal('+i+')" title="Editar">\u270f\ufe0f Editar</button>';
      html += '<button type="button" class="btn btn-ghost btn-xs" onclick="deleteCat('+i+')" style="color:var(--red);" title="Excluir">\ud83d\uddd1\ufe0f</button>';
      html += '</div></div></div>';

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
