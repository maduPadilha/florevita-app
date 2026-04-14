import { S } from '../state.js';
import { $c, emoji, esc } from '../utils/formatters.js';
import { POST, PUT, DELETE, PATCH } from '../services/api.js';
import { toast } from '../utils/helpers.js';
import { can } from '../services/auth.js';
import { invalidateCache, saveCachedData, recarregarDados } from '../services/cache.js';

// ── Helper: render() via dynamic import ───────────────────────
async function render(){
  const { render:r } = await import('../main.js');
  r();
}

// ── Helper: getCategorias (local) ─────────────────────────────
const CAT_KEY = 'fv_categorias';
const CAT_DEFAULT = ['Rosa','Buque','Orquidea','Planta','Kit','Vaso','Flor','Coroa','Cesta','Embalagem','Adicional','Arranjo','Bouquet Premium','Decoracao','Outro'];
function getCategorias(){ const s=JSON.parse(localStorage.getItem(CAT_KEY)||'null'); return s||CAT_DEFAULT; }

// ── Helper: showFullImg ───────────────────────────────────────
function showFullImg(url){
  S._modal=`<div class="mo" id="mo" onclick="S._modal='';render()">
  <div style="background:#fff;border-radius:16px;padding:16px;max-width:500px;width:94%;text-align:center">
    <img src="${url}" style="max-width:100%;max-height:70vh;object-fit:contain;border-radius:8px;"/>
    <div style="margin-top:10px"><button class="btn btn-ghost" onclick="S._modal='';render()">Fechar</button></div>
  </div></div>`;
  render();
}

// ── Helper: collectInsumos ────────────────────────────────────
function collectInsumos(){
  const rows = document.querySelectorAll('[data-insumo-row]');
  const arr = [];
  rows.forEach(row=>{
    const id = row.querySelector('[data-insumo-id]')?.value;
    const qty = parseFloat(row.querySelector('[data-insumo-qty]')?.value)||0;
    if(id && qty>0) arr.push({productId:id, qty});
  });
  return arr;
}

// ── Expose to window for inline onclick handlers ──────────────
window.showNewProductModal = showNewProductModal;
window.deleteProduct = deleteProduct;
window.confirmDeleteProduct = confirmDeleteProduct;
window.showProductStockModal = showProductStockModal;
window.showFullImg = showFullImg;
window.saveStockFromModal = saveStockFromModal;
window.recarregarDados = recarregarDados;

// ── PRODUTOS ─────────────────────────────────────────────────
export function renderProdutos(){
  return`
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
  <span style="color:var(--muted);font-size:12px">${S.products.length} produtos</span>
  <div style="display:flex;gap:6px;">
    <button class="btn btn-ghost btn-sm" id="btn-rel-prods">🔄</button>
    <button class="btn btn-primary" id="btn-new-prod">+ Novo Produto</button>
  </div>
</div>
<div class="card">
  <div class="card-title">Catalogo</div>
  ${S.products.length===0?`<div class="empty"><div class="empty-icon">🌹</div><p>Sem produtos</p><button class="btn btn-primary" id="btn-new-prod2" style="margin-top:10px">+ Cadastrar Produto</button>
        <button class="btn btn-ghost" style="margin-top:6px;font-size:11px" onclick="recarregarDados()">🔄 Recarregar dados do servidor</button></div>`:`
  <div class="tw"><table><thead><tr><th>Produto</th><th>Categoria</th><th>Custo</th><th>Venda</th><th>Margem</th><th>Estoque</th><th>Site</th><th>Status</th><th>NCM</th><th></th></tr></thead>
  <tbody>${S.products.map(p=>{
    const mg=p.salePrice>0?((p.salePrice-(p.costPrice||0))/p.salePrice*100).toFixed(0):0;
    const low=(p.stock||0)<=(p.minStock||5);
    return`<tr>
      <td><div style="display:flex;align-items:center;gap:8px;">
        ${p.images?.[0]?`<img src="${p.images[0]}" style="width:40px;height:40px;border-radius:6px;object-fit:cover;cursor:pointer" title="${p.name}" onclick="showFullImg('${p.images[0]}')">`:`<span style="font-size:20px">${emoji(p.category)}</span>`}
        <span style="font-weight:500">${p.name}</span>
      </div></td>
      <td><span class="tag t-gray">${p.category||'\u2014'}</span></td>
      <td style="color:var(--muted)">${$c(p.costPrice)}</td>
      <td style="font-weight:600">${$c(p.salePrice)}</td>
      <td><span class="tag ${mg>=50?'t-green':mg>=30?'t-gold':'t-red'}">${mg}%</span></td>
      <td style="font-weight:500;color:${low?'var(--red)':'var(--ink)'}">${p.stock||0}</td>
      <td><span class="tag ${p.activeOnSite?'t-green':'t-gray'}">${p.activeOnSite?'✅ Ativo':'\u2014'}</span></td>
      <td><span class="tag ${low?'t-red':'t-green'}">${low?'⚠️':'✅'}</span></td>
      <td style="font-size:10px;color:var(--muted);">${p.taxation?.ncm||'\u2014'}</td>
      <td style="white-space:nowrap;">
        <button type="button" class="btn btn-ghost btn-xs" onclick="(()=>{const p=S.products.find(x=>x._id==='${p._id}');if(p)showNewProductModal(p);})()" title="Editar produto">✏️ Editar</button>
        <button class="btn btn-ghost btn-xs" data-stock-prod="${p._id}" title="Ajustar estoque" style="color:var(--leaf)">📦</button>
        <button type="button" onclick="deleteProduct('${p._id}')" style="background:var(--red-l);color:var(--red);border:1px solid rgba(220,38,38,.2);border-radius:6px;padding:3px 7px;cursor:pointer;font-size:12px;">🗑️ Excluir</button>
      </td>
    </tr>`;
  }).join('')}</tbody></table></div>`}
</div>`;
}

// ── showNewProductModal ───────────────────────────────────────
export async function showNewProductModal(prod=null){
  const edit = !!prod;
  const cats = getCategorias();
  const tax = prod?.taxation||{};
  const d   = prod?.dimensoes||{};
  const draft = S._prodDraft||{};

  S._modal=`<div class="mo" id="mo" onclick="if(event.target===this){S._modal='';S._prodDraft=null;S._prodTab=null;render();}">
  <div class="mo-box" style="max-width:820px;width:96vw;max-height:92vh;overflow-y:auto;padding:0;" onclick="event.stopPropagation()">

  <!-- Header fixo -->
  <div style="position:sticky;top:0;background:var(--primary);color:#fff;padding:16px 22px;display:flex;align-items:center;justify-content:space-between;z-index:10;">
    <div style="font-family:'Playfair Display',serif;font-size:18px;">${edit?'✏️ Editar Produto':'🌹 Novo Produto'}</div>
    <button onclick="S._modal='';S._prodDraft=null;S._prodTab=null;render();" style="background:rgba(255,255,255,.2);border:none;color:#fff;width:32px;height:32px;border-radius:50%;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;">\u2715</button>
  </div>

  <div style="padding:22px;">

  <!-- SECAO 1: DADOS PRINCIPAIS -->
  <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px;">📝 Dados Principais</div>
  <div class="fr2" style="gap:12px;margin-bottom:16px;">
    <div class="fg" style="grid-column:span 2">
      <label class="fl">Nome do Produto *</label>
      <input class="fi" id="mp-name" value="${draft.name||prod?.name||''}" placeholder="Nome completo do produto"/>
    </div>
    <div class="fg">
      <label class="fl">Categoria</label>
      <select class="fi" id="mp-cat">
        ${cats.map(c=>`<option ${(prod?.category||'')=== c?'selected':''}>${c}</option>`).join('')}
      </select>
    </div>
    <div class="fg">
      <label class="fl">Codigo do Produto</label>
      <input class="fi" id="mp-code" value="${prod?.code||''}" placeholder="Auto-gerado"/>
    </div>
  </div>

  <!-- SECAO 2: PRECOS -->
  <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px;">💰 Precos</div>
  <div class="fr2" style="gap:12px;margin-bottom:16px;">
    <div class="fg">
      <label class="fl">Custo (R$)</label>
      <input class="fi" type="number" id="mp-cost" value="${draft.cost||prod?.costPrice||''}" min="0" step="0.01" placeholder="0,00"
        oninput="const c=parseFloat(this.value)||0;const m=parseFloat(document.getElementById('mp-margin')?.value)||40;document.getElementById('mp-price').value=(c*(1+m/100)).toFixed(2);"/>
    </div>
    <div class="fg">
      <label class="fl">Margem (%)</label>
      <input class="fi" type="number" id="mp-margin" value="${prod?.margin||40}" min="0" step="1" placeholder="40"
        oninput="const c=parseFloat(document.getElementById('mp-cost')?.value)||0;const m=parseFloat(this.value)||40;document.getElementById('mp-price').value=(c*(1+m/100)).toFixed(2);"/>
    </div>
    <div class="fg">
      <label class="fl">Preco de Venda (R$) *</label>
      <input class="fi" type="number" id="mp-price" value="${draft.price||prod?.salePrice||''}" min="0" step="0.01" placeholder="0,00" style="font-weight:700;color:var(--primary);border-color:var(--primary);"/>
    </div>
  </div>

  <!-- SECAO 3: ESTOQUE -->
  <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px;">📦 Estoque</div>
  <div class="fr2" style="gap:12px;margin-bottom:16px;">
    <div class="fg">
      <label class="fl">Estoque atual</label>
      <input class="fi" type="number" id="mp-stock" value="${draft.stock||prod?.stock||0}" min="0"/>
    </div>
    <div class="fg">
      <label class="fl">Estoque minimo (alerta)</label>
      <input class="fi" type="number" id="mp-minstk" value="${draft.minstk||prod?.minStock||5}" min="0"/>
    </div>
  </div>

  <!-- SECAO 4: DESCRICAO & PRODUCAO -->
  <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px;">📄 Descricao</div>
  <div style="margin-bottom:16px;">
    <div class="fg" style="margin-bottom:10px;">
      <label class="fl">Descricao para o cliente (aparece no site)</label>
      <textarea class="fi" id="mp-desc" rows="3" placeholder="Descreva o produto para o cliente, incluindo detalhes especiais...">${draft.desc||prod?.description||''}</textarea>
    </div>
    <div class="fg">
      <label class="fl">Notas de Producao <span style="font-size:10px;color:var(--muted)">(visivel apenas para o florista)</span></label>
      <textarea class="fi" id="mp-prodnotes" rows="2" placeholder="Como montar, flores utilizadas, cuidados especiais...">${draft.prodnotes||prod?.productionNotes||''}</textarea>
    </div>
  </div>

  <!-- SECAO 5: DIMENSOES -->
  <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px;">📐 Dimensoes & Peso</div>
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px;">
    <div class="fg">
      <label class="fl" style="font-size:11px;">Altura (cm)</label>
      <input class="fi" type="number" id="mp-altura" value="${d.altura||''}" min="0" step="0.5" placeholder="0"/>
    </div>
    <div class="fg">
      <label class="fl" style="font-size:11px;">Largura (cm)</label>
      <input class="fi" type="number" id="mp-largura" value="${d.largura||''}" min="0" step="0.5" placeholder="0"/>
    </div>
    <div class="fg">
      <label class="fl" style="font-size:11px;">Profundidade (cm)</label>
      <input class="fi" type="number" id="mp-profundidade" value="${d.profundidade||''}" min="0" step="0.5" placeholder="0"/>
    </div>
    <div class="fg">
      <label class="fl" style="font-size:11px;">Peso (g)</label>
      <input class="fi" type="number" id="mp-peso" value="${d.peso||''}" min="0" step="1" placeholder="0"/>
    </div>
  </div>

  <!-- SECAO 6: CONFIGURACOES DE SITE -->
  <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px;">🌐 Configuracoes</div>
  <div style="display:flex;gap:20px;flex-wrap:wrap;margin-bottom:16px;">
    <label class="cb">
      <input type="checkbox" id="mp-site" ${(draft.site!==undefined?draft.site:prod?.activeOnSite)?'checked':''}/>
      <span style="font-size:13px;">✅ Ativo no site / e-commerce</span>
    </label>
    <label class="cb">
      <input type="checkbox" id="mp-composto" ${(draft.composto||prod?.composto)?'checked':''}/>
      <span style="font-size:13px;">🧩 Produto composto (kit de insumos)</span>
    </label>
  </div>

  <!-- SECAO 7: FISCAL (colapsavel) -->
  <details style="margin-bottom:16px;">
    <summary style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;cursor:pointer;padding:8px 0;user-select:none;">
      🏛️ Dados Fiscais (NF-e) \u2014 clique para expandir
    </summary>
    <div style="margin-top:12px;padding:14px;background:var(--cream);border-radius:10px;">
      <div class="fr2" style="gap:10px;">
        <div class="fg"><label class="fl">NCM</label><input class="fi" id="mp-ncm" value="${tax.ncm||''}" placeholder="0000.00.00"/></div>
        <div class="fg"><label class="fl">CEST</label><input class="fi" id="mp-cest" value="${tax.cest||''}" placeholder=""/></div>
        <div class="fg"><label class="fl">CFOP</label>
          <select class="fi" id="mp-cfop">
            ${['5102','5405','6102','5910','outro'].map(v=>`<option ${tax.cfop===v?'selected':''} value="${v}">${v==='outro'?'Outro (manual)':v}</option>`).join('')}
          </select>
        </div>
        <div class="fg"><label class="fl">CFOP manual</label><input class="fi" id="mp-cfop-manual" value="${tax.cfop&&!['5102','5405','6102','5910'].includes(tax.cfop)?tax.cfop:''}" placeholder="Apenas se 'Outro'"/></div>
        <div class="fg"><label class="fl">Origem</label>
          <select class="fi" id="mp-origin">
            ${['0','1','2','3','4','5','6','7','8'].map(v=>`<option ${(tax.origin||'0')===v?'selected':''} value="${v}">${v} - ${['Nacional','Estrangeira-importacao direta','Estrangeira-mercado interno','Nacional c/ >40% de conteudo estrangeiro','Nacional producao conf. proc. basico','Nacional c/ importacao conf. resolucao CAMEX','Estrangeira-importacao direta, sem similar nacional','Estrangeira-mercado interno, sem similar nacional','Nacional com importacao de qualquer origem'][parseInt(v)]}</option>`).join('')}
          </select>
        </div>
        <div class="fg"><label class="fl">CSOSN / CST ICMS</label><input class="fi" id="mp-csosn" value="${tax.csosn||''}" placeholder="102"/></div>
        <div class="fg"><label class="fl">CST PIS/COFINS</label><input class="fi" id="mp-cst-pis" value="${tax.cstPis||''}" placeholder="07"/></div>
        <div class="fg"><label class="fl">Un. Comercial</label><input class="fi" id="mp-unit-com" value="${tax.unitCom||'UN'}" placeholder="UN"/></div>
        <div class="fg"><label class="fl">Un. Tributavel</label><input class="fi" id="mp-unit-trib" value="${tax.unitTrib||'UN'}" placeholder="UN"/></div>
        <div class="fg"><label class="fl">% ICMS</label><input class="fi" type="number" id="mp-icms" value="${tax.icms||0}" min="0" step="0.01"/></div>
        <div class="fg"><label class="fl">% PIS</label><input class="fi" type="number" id="mp-pis" value="${tax.pis||0}" min="0" step="0.01"/></div>
        <div class="fg"><label class="fl">% COFINS</label><input class="fi" type="number" id="mp-cofins" value="${tax.cofins||0}" min="0" step="0.01"/></div>
      </div>
    </div>
  </details>

  <!-- FOTO -->
  <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px;">📷 Foto do Produto</div>
  <div style="margin-bottom:20px;">
    ${prod?.images?.[0]||S._prodImg?`<img src="${S._prodImg||prod.images[0]}" style="width:100px;height:100px;object-fit:cover;border-radius:10px;margin-bottom:8px;border:2px solid var(--border);" id="prod-img-preview"/>`:
    `<div style="width:100px;height:100px;background:var(--cream);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:32px;margin-bottom:8px;">🌸</div>`}
    <input type="file" id="mp-img-file" accept="image/*" class="fi" style="padding:6px;max-width:300px;"/>
    <div style="font-size:11px;color:var(--muted);margin-top:4px;">JPG ou PNG. Recomendado: 400x400px</div>
  </div>

  <!-- BOTOES -->
  <div style="display:flex;gap:10px;justify-content:flex-end;padding-top:16px;border-top:1px solid var(--border);">
    <button class="btn btn-ghost" id="btn-mp-cancel">Cancelar</button>
    <button class="btn btn-primary" id="btn-mp-save" style="padding:11px 32px;font-size:15px;">
      💾 ${edit?'Atualizar Produto':'Cadastrar Produto'}
    </button>
  </div>

  </div></div></div>`;

  await render();

  // ── Cancelar ──────────────────────────────────────────────
  document.getElementById('btn-mp-cancel')?.addEventListener('click',()=>{
    S._modal=''; S._prodDraft=null; S._prodTab=null; render();
  });

  // ── Upload de imagem ──────────────────────────────────────
  document.getElementById('mp-img-file')?.addEventListener('change',e=>{
    const file=e.target.files?.[0];
    if(!file) return;
    const reader=new FileReader();
    reader.onload=ev=>{
      S._prodImg=ev.target.result;
      const prev=document.getElementById('prod-img-preview');
      if(prev){ prev.src=S._prodImg; }
      else {
        const img=document.createElement('img');
        img.id='prod-img-preview';
        img.src=S._prodImg;
        img.style.cssText='width:100px;height:100px;object-fit:cover;border-radius:10px;margin-bottom:8px;border:2px solid var(--border);';
        e.target.parentNode.insertBefore(img, e.target);
      }
    };
    reader.readAsDataURL(file);
  });

  // ── Salvar ────────────────────────────────────────────────
  document.getElementById('btn-mp-save')?.addEventListener('click',()=>{
    saveProduct(prod?._id||null, prod?.code||null);
  });
}

// ── saveProduct ──────────────────────────────────────────────
export async function saveProduct(editId=null, prodCode=null){
  const name=document.getElementById('mp-name')?.value?.trim();
  if(!name) return toast('❌ Nome obrigatorio');

  // Le CFOP (select ou manual)
  const cfopSel = document.getElementById('mp-cfop')?.value||'';
  const cfopManual = document.getElementById('mp-cfop-manual')?.value?.trim()||'';
  const cfop = cfopSel==='outro' ? cfopManual : cfopSel;

  const taxation = {
    ncm:     document.getElementById('mp-ncm')?.value?.replace(/\s/g,'')||'',
    cfop,
    cest:    document.getElementById('mp-cest')?.value||'',
    csosn:   document.getElementById('mp-csosn')?.value||'',
    cst:     document.getElementById('mp-cst')?.value||'',
    cstPis:  document.getElementById('mp-cst-pis')?.value||'',
    origin:  document.getElementById('mp-origin')?.value||'0',
    icms:    parseFloat(document.getElementById('mp-icms')?.value)||0,
    pis:     parseFloat(document.getElementById('mp-pis')?.value)||0,
    cofins:  parseFloat(document.getElementById('mp-cofins')?.value)||0,
    unitCom: document.getElementById('mp-unit-com')?.value||'UN',
    unitTrib:document.getElementById('mp-unit-trib')?.value||'UN',
  };

  // Insumos
  const composto = document.getElementById('mp-composto')?.checked ||
                   document.getElementById('mp-composto2')?.checked ||
                   false;
  const insumos = collectInsumos();

  const data={
    name, code: prodCode,
    category:      document.getElementById('mp-cat')?.value,
    costPrice:     parseFloat(document.getElementById('mp-cost')?.value)||0,
    salePrice:     parseFloat(document.getElementById('mp-price')?.value)||0,
    stock:         parseInt(document.getElementById('mp-stock')?.value)||0,
    minStock:      parseInt(document.getElementById('mp-minstk')?.value)||5,
    description:   document.getElementById('mp-desc')?.value||'',
    productionNotes:document.getElementById('mp-prodnotes')?.value||'',
    activeOnSite:  document.getElementById('mp-site')?.checked||false,
    dimensoes: {
      altura:       parseFloat(document.getElementById('mp-altura')?.value)||0,
      largura:      parseFloat(document.getElementById('mp-largura')?.value)||0,
      profundidade: parseFloat(document.getElementById('mp-profundidade')?.value)||0,
      peso:         parseFloat(document.getElementById('mp-peso')?.value)||0,
    },
    composto,
    insumos:       composto ? insumos : [],
    taxation,
    unit: 'Todas',
  };
  if(S._prodImg) data.images=[S._prodImg];

  S.loading=true; S._modal=''; S._prodImg=null; S._prodTab=null; S._prodDraft=null;
  try{ render(); }catch(e){}
  try{
    let p;
    if(editId){
      p = await PUT('/products/'+editId, data).catch(()=>PATCH('/products/'+editId, data));
      S.products = S.products.map(x=>x._id===editId?{...x,...data,...(p||{})}:x);
    } else {
      p = await POST('/products', data);
      if(p?._id) S.products.unshift(p);
    }
    toast(editId?'✅ Produto atualizado!':'✅ Produto cadastrado!');
    saveCachedData(); // salva cache com produto novo/atualizado
  }catch(e){
    toast('❌ Erro ao salvar: '+(e.message||''));
  }finally{
    S.loading=false; try{render();}catch(e){}
  }
}

// ── deleteProduct ────────────────────────────────────────────
export async function deleteProduct(id){
  const p=S.products.find(x=>x._id===id); if(!p) return;
  window._delProductId=id;
  S._modal=`<div class="mo" id="mo" onclick="if(event.target===this){S._modal='';render();}">
  <div class="mo-box" style="max-width:360px;text-align:center;" onclick="event.stopPropagation()">
  <div style="font-size:40px;margin-bottom:10px">⚠️</div>
  <div style="font-family:'Playfair Display',serif;font-size:17px;margin-bottom:6px">Excluir Produto?</div>
  <div style="font-size:12px;color:var(--muted);margin-bottom:18px;"><strong>${p.name}</strong></div>
  <div style="display:flex;gap:8px;justify-content:center;">
    <button class="btn btn-red" onclick="confirmDeleteProduct()" style="padding:10px 20px;">🗑️ Excluir</button>
    <button class="btn btn-ghost" onclick="S._modal='';render();">Cancelar</button>
  </div></div></div>`;
  render();
}

// ── confirmDeleteProduct ─────────────────────────────────────
export function confirmDeleteProduct(){
  const id=window._delProductId; if(!id) return;
  const p=S.products.find(x=>x._id===id);
  DELETE('/products/'+id).then(()=>{
    S.products=S.products.filter(x=>x._id!==id);
    invalidateCache('products'); // produto excluido -- invalida cache
    S._modal=''; window._delProductId=null; render();
    toast('🗑️ '+(p?.name||'Produto')+' excluido');
  }).catch(e=>toast('❌ Erro: '+e.message,true));
}

// ── saveStockFromModal ───────────────────────────────────────
function saveStockFromModal(){
  const type = document.getElementById('st-type')?.value||'entrada';
  const qty  = parseInt(document.getElementById('st-qty')?.value)||0;
  const note = document.getElementById('st-note')?.value||'';
  if(!qty||qty<1) return toast('❌ Quantidade invalida',true);
  const pid = window._stockModalProdId; if(!pid) return;
  const p = S.products.find(x=>x._id===pid); if(!p) return;
  const delta = type==='entrada'?qty:-qty;
  const newStock = Math.max(0,(p.stock||0)+delta);
  PATCH('/products/'+pid, {stock:newStock}).then(()=>{
    S.products=S.products.map(x=>x._id===pid?{...x,stock:newStock}:x);
    POST('/stock/moves',{productId:pid,productName:p.name,type,qty,note,date:new Date().toISOString(),userId:S.user?._id}).catch(()=>{});
    S._modal=''; render(); toast('✅ Estoque atualizado!');
  }).catch(e=>toast('❌ '+e.message,true));
}

// ── showProductStockModal ────────────────────────────────────
export async function showProductStockModal(prodId){
  const p = S.products.find(x=>x._id===prodId);
  if(!p) return;
  window._stockModalProdId = prodId;
  S._modal=`<div class="mo" id="mo" onclick="if(event.target===this){S._modal='';render();}">
  <div class="mo-box" style="max-width:420px;" onclick="event.stopPropagation()">
  <div style="font-family:'Playfair Display',serif;font-size:18px;margin-bottom:4px;">📦 Ajustar Estoque</div>
  <div style="font-size:12px;color:var(--muted);margin-bottom:16px;">${p.name}</div>

  <div style="background:var(--cream);border-radius:10px;padding:14px;margin-bottom:16px;text-align:center;">
    <div style="font-size:11px;color:var(--muted);margin-bottom:4px;">Estoque atual</div>
    <div style="font-size:36px;font-weight:800;color:${(p.stock||0)<=(p.minStock||5)?'var(--red)':'var(--leaf)'}">${p.stock||0}</div>
    <div style="font-size:11px;color:var(--muted)">unidades \u00b7 minimo: ${p.minStock||5}</div>
  </div>

  <div class="fr2">
    <div class="fg"><label class="fl">Tipo de lancamento</label>
      <select class="fi" id="st-type">
        <option value="add">➕ Entrada</option>
        <option value="sub">➖ Saida</option>
        <option value="set">🔄 Definir saldo</option>
      </select>
    </div>
    <div class="fg"><label class="fl">Quantidade</label>
      <input class="fi" type="number" id="st-qty" min="1" value="1" placeholder="0"/>
    </div>
    <div class="fg" style="grid-column:span 2"><label class="fl">Motivo (opcional)</label>
      <input class="fi" id="st-reason" placeholder="Ex: Compra fornecedor, Inventario..."/>
    </div>
  </div>

  <div class="mo-foot">
    <button class="btn btn-primary" onclick="saveStockFromModal()" style="flex:1;justify-content:center;">💾 Salvar</button>
    <button class="btn btn-ghost" onclick="S._modal='';render();">Cancelar</button>
  </div>
  </div></div>`;
  await render();

  document.getElementById('btn-st-save')?.addEventListener('click',async()=>{
    const type   = document.getElementById('st-type')?.value;
    const qty    = parseInt(document.getElementById('st-qty')?.value)||0;
    const reason = document.getElementById('st-reason')?.value?.trim()||'';
    if(!qty||qty<=0) return toast('❌ Informe uma quantidade valida');

    let newStock = p.stock||0;
    if(type==='add') newStock += qty;
    else if(type==='sub') newStock = Math.max(0, newStock - qty);
    else if(type==='set') newStock = qty;

    S._modal=''; S.loading=true; try{render();}catch(e){}
    try{
      await PATCH('/products/'+prodId+'/stock',{stock:newStock,reason,type,qty}).catch(async()=>{
        await PUT('/products/'+prodId,{...p,stock:newStock});
      });
      S.products=S.products.map(x=>x._id===prodId?{...x,stock:newStock}:x);
      S.loading=false; render();
      toast(`✅ Estoque de ${p.name}: ${p.stock||0} \u2192 ${newStock} un`);
    }catch(e){
      S.loading=false; render(); toast('❌ Erro: '+(e.message||''));
    }
  });
}
