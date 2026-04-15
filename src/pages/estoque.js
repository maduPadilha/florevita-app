import { S } from '../state.js';
import { $c, $d, esc } from '../utils/formatters.js';
import { GET, POST, PUT, PATCH } from '../services/api.js';
import { toast } from '../utils/helpers.js';
import { can } from '../services/auth.js';
import { invalidateCache } from '../services/cache.js';
import { emoji } from '../utils/formatters.js';

// ── Helper: render() via dynamic import ───────────────────────
async function render(){
  const { render:r } = await import('../main.js');
  r();
}

// ── Unidades de estoque ──────────────────────────────────────
export const STOCK_UNITS = ['CDLE','Loja Novo Aleixo','Loja Allegro Mall'];
const UNIT_LABEL = { 'CDLE':'CDLE', 'Loja Novo Aleixo':'Novo Aleixo', 'Loja Allegro Mall':'Allegro' };

// Helper: normaliza stockByUnit
export function getStockByUnit(p){
  const sbu = p && p.stockByUnit && typeof p.stockByUnit==='object' ? {...p.stockByUnit} : {};
  STOCK_UNITS.forEach(u=>{ if(sbu[u]==null) sbu[u]=0; else sbu[u]=Number(sbu[u])||0; });
  // Se não houver nenhum registrado por unidade e houver estoque total, aloca em CDLE (legado)
  const sum = STOCK_UNITS.reduce((s,u)=>s+(Number(sbu[u])||0),0);
  if(sum===0 && (Number(p?.stock)||Number(p?.estoque)||0) > 0){
    sbu['CDLE'] = Number(p.stock)||Number(p.estoque)||0;
  }
  return sbu;
}

function _totalFromSbu(sbu){
  return STOCK_UNITS.reduce((s,u)=>s+(Number(sbu[u])||0),0);
}

// ── Helper: renderiza uma linha de produto ───────────────────
function _renderStockRow(p){
  const sbu = getStockByUnit(p);
  const total = _totalFromSbu(sbu);
  const color=total<=(p.minStock||5)?'var(--red)':total<=(p.minStock||5)*1.5?'var(--gold)':'var(--leaf)';
  const status=total<=(p.minStock||5)?'⚠️ Crítico':total<=(p.minStock||5)*1.5?'⚡ Baixo':'✅ OK';
  const checked = (S._stockSelected||[]).includes(p._id) ? 'checked' : '';
  const ativo = p.active!==false;
  const selectedUnit = S._stockUnit || '';

  // Render dos inputs por unidade
  let stockBlock = '';
  if(selectedUnit && STOCK_UNITS.includes(selectedUnit)){
    // Filtro por unidade específica: mostra só aquela unidade + total info
    stockBlock = `
      <div style="text-align:center;min-width:120px;">
        <div style="font-size:9px;color:var(--muted)">${esc(UNIT_LABEL[selectedUnit]||selectedUnit)}</div>
        <input type="number" class="fi stock-unit-inline" data-unit="${esc(selectedUnit)}" data-pid="${p._id}" value="${sbu[selectedUnit]||0}" style="width:90px;padding:2px 4px;font-size:12px;text-align:right;color:${color};font-weight:700;"/>
        <div style="font-size:9px;color:var(--muted)">Total: <strong>${total}</strong> · mín ${p.minStock||5}</div>
      </div>`;
  } else {
    // Todas as unidades: 3 inputs pequenos + total
    stockBlock = `
      <div style="display:flex;gap:4px;align-items:flex-start;">
        ${STOCK_UNITS.map(u=>`
          <div style="text-align:center;min-width:58px;">
            <div style="font-size:9px;color:var(--muted)">${esc(UNIT_LABEL[u]||u)}</div>
            <input type="number" class="fi stock-unit-inline" data-unit="${esc(u)}" data-pid="${p._id}" value="${sbu[u]||0}" style="width:52px;padding:2px 4px;font-size:11px;text-align:right;font-weight:600;"/>
          </div>`).join('')}
        <div style="text-align:center;min-width:50px;padding-top:12px;">
          <div style="font-size:9px;color:var(--muted)">Total</div>
          <div style="font-size:13px;color:${color};font-weight:700;" data-total-pid="${p._id}">${total}</div>
          <div style="font-size:9px;color:var(--muted)">mín ${p.minStock||5}</div>
        </div>
      </div>`;
  }

  return`<div style="margin-bottom:10px;padding:10px;border:1px solid var(--border);border-radius:var(--r);background:#fff;">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
      <input type="checkbox" class="stock-row-chk" data-stock-sel="${p._id}" ${checked}/>
      ${p.images?.[0]?`<img src="${p.images[0]}" style="width:40px;height:40px;border-radius:6px;object-fit:cover;">`:`<span style="font-size:24px;width:40px;text-align:center">${emoji(p.category)}</span>`}
      <div style="flex:1;min-width:140px;">
        <div style="font-size:12px;font-weight:600">${esc(p.name||'')}</div>
        <div style="font-size:10px;color:var(--muted)">SKU: ${esc(p.code||p.sku||'—')}</div>
      </div>
      <span class="tag t-rose" style="font-size:10px;">${esc(p.category||'—')}</span>
      <div style="text-align:center;min-width:80px;">
        <div style="font-size:9px;color:var(--muted)">Venda</div>
        <input type="number" step="0.01" class="fi stock-inline-price" data-field="price" data-pid="${p._id}" value="${p.price||0}" style="width:70px;padding:2px 4px;font-size:11px;text-align:right;"/>
      </div>
      <div style="text-align:center;min-width:80px;">
        <div style="font-size:9px;color:var(--muted)">Custo</div>
        <input type="number" step="0.01" class="fi stock-inline-price" data-field="costPrice" data-pid="${p._id}" value="${p.costPrice||0}" style="width:70px;padding:2px 4px;font-size:11px;text-align:right;"/>
      </div>
      ${stockBlock}
      <span class="tag ${ativo?'t-green':'t-red'}" style="font-size:10px;">${ativo?'Ativo':'Inativo'}</span>
      <div style="display:flex;gap:4px;">
        <button class="btn btn-ghost btn-xs" data-stock-edit="${p._id}" title="Editar detalhes">✏️</button>
        <button class="btn btn-ghost btn-xs" data-stock-add="${p._id}" data-stock-name="${esc(p.name||'')}" title="Entrada">+</button>
        <button class="btn btn-ghost btn-xs" data-stock-rem="${p._id}" data-stock-name="${esc(p.name||'')}" title="Saída">−</button>
      </div>
    </div>
    <div style="margin-top:6px;">
      <span style="font-size:10px;color:${color};font-weight:500">${status}</span>
    </div>
  </div>`;
}

// ── Atualiza estoque por unidade (chamado pelo main.js) ──────
export async function updateStockByUnit(productId, unit, newValue){
  const product = S.products.find(p => p._id === productId);
  if(!product) return;
  if(!STOCK_UNITS.includes(unit)) return toast('❌ Unidade inválida', true);

  const stockByUnit = { ...getStockByUnit(product) };
  stockByUnit[unit] = Math.max(0, parseInt(newValue)||0);
  const newTotal = _totalFromSbu(stockByUnit);

  try{
    await PUT('/products/'+productId, {
      stockByUnit,
      estoque: newTotal,
      stock: newTotal
    });
    product.stockByUnit = stockByUnit;
    product.estoque = newTotal;
    product.stock = newTotal;
    // Atualizar display de total inline, sem re-render completo
    const totalEl = document.querySelector(`[data-total-pid="${productId}"]`);
    if(totalEl) totalEl.textContent = newTotal;
    try{ invalidateCache && invalidateCache('products'); }catch(e){}
    toast('✅ Estoque atualizado');
  }catch(e){
    toast('Erro: '+(e.message||'falha'), true);
  }
}

// ── ESTOQUE ──────────────────────────────────────────────────
export function renderEstoque(){
  // Helper local para total real a partir de stockByUnit (com fallback para stock)
  const _prodTotal = (p)=> _totalFromSbu(getStockByUnit(p));
  const low = S.products.filter(p=>_prodTotal(p)<=(p.minStock||5));
  const unit = S._stockUnit || (S.user.unit==='Todas'?'':S.user.unit);
  // Mostrar todos os produtos, destacando unidade selecionada (opção UX escolhida)
  let filtered = S.products.slice();

  // Filtros de busca
  const q = (S._stockSearch||'').trim().toLowerCase();
  if(q){
    filtered = filtered.filter(p =>
      (p.name||'').toLowerCase().includes(q) ||
      (p.code||'').toLowerCase().includes(q) ||
      (p.sku||'').toLowerCase().includes(q)
    );
  }
  const cat = S._stockCat||'';
  if(cat) filtered = filtered.filter(p=>(p.category||'')===cat);

  // Ordenação
  const sort = S._stockSort||'nome-asc';
  const byName = (a,b)=>(a.name||'').localeCompare(b.name||'','pt-BR');
  if(sort==='nome-asc') filtered.sort(byName);
  else if(sort==='nome-desc') filtered.sort((a,b)=>byName(b,a));
  else if(sort==='estoque-asc') filtered.sort((a,b)=>_prodTotal(a)-_prodTotal(b));
  else if(sort==='estoque-desc') filtered.sort((a,b)=>_prodTotal(b)-_prodTotal(a));
  else if(sort==='cat-asc') filtered.sort((a,b)=>((a.category||'').localeCompare(b.category||'','pt-BR'))||byName(a,b));

  const totalVal = filtered.reduce((s,p)=>s+(p.costPrice||0)*_prodTotal(p),0);

  // Categorias únicas (para o select)
  const cats = Array.from(new Set(S.products.map(p=>p.category).filter(Boolean))).sort((a,b)=>a.localeCompare(b,'pt-BR'));

  const hasFilter = !!(q || cat || (sort && sort!=='nome-asc'));
  const isAdmin = S.user?.role==='Administrador' || S.user?.cargo==='admin';
  const adj = S._stockAdjust || {};
  const selCount = (S._stockSelected||[]).length;

  // Agrupar por categoria (apenas quando sort === cat-asc)
  let listHtml = '';
  if(filtered.length===0){
    listHtml = `<div class="empty"><div class="empty-icon">📦</div><p>Nenhum produto</p></div>`;
  } else if(sort==='cat-asc'){
    const groups = {};
    filtered.forEach(p=>{
      const k = p.category||'Sem categoria';
      (groups[k] = groups[k]||[]).push(p);
    });
    Object.keys(groups).sort((a,b)=>a.localeCompare(b,'pt-BR')).forEach(k=>{
      const prods = groups[k].sort(byName);
      listHtml += `<div style="margin:14px 0 8px;padding:8px 10px;background:var(--cream);border-radius:var(--r);font-weight:700;font-size:13px;">
        ${emoji(k)} ${esc(k)} <span style="color:var(--muted);font-weight:400;">(${prods.length} produto${prods.length===1?'':'s'})</span>
      </div>`;
      listHtml += prods.map(_renderStockRow).join('');
    });
  } else {
    listHtml = filtered.map(_renderStockRow).join('');
  }

  return`
${low.length>0?`<div class="alert al-warn">⚠️ <strong>${low.length} itens com estoque crítico:</strong> ${low.map(p=>esc(p.name||'')).join(', ')}</div>`:''}

<div class="g4" style="margin-bottom:16px;">
  <div class="mc rose"><div class="mc-label">Total Produtos</div><div class="mc-val">${filtered.length}</div></div>
  <div class="mc leaf"><div class="mc-label">Estoque Normal</div><div class="mc-val">${filtered.filter(p=>_prodTotal(p)>(p.minStock||5)).length}</div></div>
  <div class="mc gold"><div class="mc-label">Estoque Crítico</div><div class="mc-val">${low.length}</div></div>
  <div class="mc purple"><div class="mc-label">Valor em Estoque</div><div class="mc-val">${$c(totalVal)}</div></div>
</div>

<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;align-items:center;">
  <select class="fi" id="stock-unit" style="width:auto;">
    <option value="">Todas as Unidades</option>
    <option value="CDLE" ${unit==='CDLE'?'selected':''}>CDLE</option>
    <option value="Loja Novo Aleixo" ${unit==='Loja Novo Aleixo'?'selected':''}>Loja Novo Aleixo</option>
    <option value="Loja Allegro Mall" ${unit==='Loja Allegro Mall'?'selected':''}>Loja Allegro Mall</option>
  </select>
  <button class="btn btn-green btn-sm" id="btn-stock-entry">📦 Entrada de Estoque</button>
  <button class="btn btn-outline btn-sm" id="btn-stock-exit">📤 Saída Manual</button>
  <button class="btn btn-blue btn-sm" id="btn-new-transfer">🔄 Transferência</button>
  <button class="btn btn-ghost btn-sm" id="btn-stock-export">⬇️ Exportar CSV</button>
  <button class="btn btn-ghost btn-sm" id="btn-stock-import">⬆️ Importar CSV</button>
  <input type="file" id="stock-import-file" accept=".csv" style="display:none;"/>
  <button class="btn btn-ghost btn-sm" id="btn-rel-prods">🔄 Atualizar</button>
</div>

${isAdmin?`
<div class="card" style="margin-bottom:14px;">
  <div class="card-title" style="cursor:pointer;" id="btn-toggle-adjust">
    💰 Ajuste de Preços em Lote
    <span style="font-size:12px;color:var(--muted);font-weight:400;">${S._stockAdjustOpen?'▼ recolher':'▶ expandir'}</span>
  </div>
  ${S._stockAdjustOpen?`
  <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">
    <div class="fg" style="flex:0 0 auto;">
      <label class="fl">Aplicar em</label>
      <select class="fi" id="adj-scope" style="width:auto;">
        <option value="filtered" ${adj.scope==='filtered'?'selected':''}>Todos filtrados (${filtered.length})</option>
        <option value="selected" ${adj.scope==='selected'?'selected':''}>Selecionados (${selCount})</option>
      </select>
    </div>
    <div class="fg" style="flex:0 0 auto;">
      <label class="fl">Operação</label>
      <div style="display:flex;gap:8px;align-items:center;">
        <label style="font-size:12px;"><input type="radio" name="adj-op" value="inc" ${adj.op==='inc'?'checked':''}/> Aumentar</label>
        <label style="font-size:12px;"><input type="radio" name="adj-op" value="dec" ${adj.op==='dec'?'checked':''}/> Diminuir</label>
        <label style="font-size:12px;"><input type="radio" name="adj-op" value="set" ${adj.op==='set'?'checked':''}/> Definir</label>
      </div>
    </div>
    <div class="fg" style="flex:0 0 auto;">
      <label class="fl">Tipo</label>
      <select class="fi" id="adj-type" style="width:auto;">
        <option value="pct" ${adj.type==='pct'?'selected':''}>Porcentagem (%)</option>
        <option value="fix" ${adj.type==='fix'?'selected':''}>Valor fixo (R$)</option>
      </select>
    </div>
    <div class="fg" style="flex:0 0 auto;">
      <label class="fl">Valor</label>
      <input class="fi" type="number" step="0.01" id="adj-value" value="${adj.value||0}" style="width:100px;"/>
    </div>
    <div class="fg" style="flex:0 0 auto;">
      <label style="font-size:12px;display:block;"><input type="checkbox" id="adj-venda" ${adj.applyVenda?'checked':''}/> Preço venda</label>
      <label style="font-size:12px;display:block;"><input type="checkbox" id="adj-custo" ${adj.applyCusto?'checked':''}/> Preço custo</label>
    </div>
    <div style="display:flex;gap:6px;">
      <button class="btn btn-outline btn-sm" id="btn-preview-adjust">👁️ Visualizar</button>
      <button class="btn btn-primary btn-sm" id="btn-apply-adjust">✅ Aplicar Ajuste</button>
    </div>
  </div>`:''}
</div>`:''}

<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;align-items:center;">
  <input type="text" id="stock-search" class="fi" placeholder="🔎 Buscar por nome ou SKU..." value="${esc(S._stockSearch||'')}" style="flex:1;min-width:200px;"/>
  <select id="stock-filter-cat" class="fi" style="min-width:150px;flex:0 0 auto;">
    <option value="">Todas categorias</option>
    ${cats.map(c=>`<option value="${esc(c)}" ${c===cat?'selected':''}>${esc(c)}</option>`).join('')}
  </select>
  <select id="stock-sort" class="fi" style="min-width:180px;flex:0 0 auto;">
    <option value="nome-asc" ${sort==='nome-asc'?'selected':''}>Nome A-Z</option>
    <option value="nome-desc" ${sort==='nome-desc'?'selected':''}>Nome Z-A</option>
    <option value="estoque-asc" ${sort==='estoque-asc'?'selected':''}>Estoque: menor → maior</option>
    <option value="estoque-desc" ${sort==='estoque-desc'?'selected':''}>Estoque: maior → menor</option>
    <option value="cat-asc" ${sort==='cat-asc'?'selected':''}>Categoria A-Z</option>
  </select>
  ${hasFilter?`<button class="btn btn-ghost btn-sm" id="btn-stock-clear">✖ Limpar filtros</button>`:''}
</div>

<div class="g2">
  <div class="card">
    <div class="card-title">Posição do Estoque
      ${selCount>0?`<span style="font-size:11px;color:var(--muted);font-weight:400;">${selCount} selecionado(s)</span>`:''}
    </div>
    ${listHtml}
  </div>

  <div>
    <div class="card" style="margin-bottom:14px;">
      <div class="card-title">📋 Histórico de Movimentações
        <div style="display:flex;gap:4px;">
          <button class="btn btn-ghost btn-xs ${S._stockFilter==='todos'?'btn-primary':''}" data-sf="todos">Todos</button>
          <button class="btn btn-ghost btn-xs ${S._stockFilter==='Entrada'?'btn-primary':''}" data-sf="Entrada">Entradas</button>
          <button class="btn btn-ghost btn-xs ${S._stockFilter==='Saída'?'btn-primary':''}" data-sf="Saída">Saídas</button>
          <button class="btn btn-ghost btn-xs ${S._stockFilter==='Transferência'?'btn-primary':''}" data-sf="Transferência">Transf.</button>
        </div>
      </div>
      ${S.stockMoves.length===0?`<div class="empty"><div class="empty-icon">📋</div><p>Nenhuma movimentação ainda</p></div>`:`
      <table><thead><tr><th>Produto</th><th>Tipo</th><th>Qtd</th><th>Unidade</th><th>Motivo</th><th>Data</th></tr></thead>
      <tbody>${S.stockMoves
        .filter(m=>S._stockFilter==='todos'||m.type===S._stockFilter)
        .slice(0,20).map(m=>`<tr>
        <td style="font-weight:500;font-size:12px">${m.product?.name||'—'}</td>
        <td><span class="tag ${m.type==='Entrada'?'t-green':m.type==='Saída'?'t-red':'t-blue'}">${m.type}</span></td>
        <td style="font-weight:600;color:${m.type==='Entrada'?'var(--leaf)':'var(--red)'}">${m.type==='Entrada'?'+':'−'}${m.qty}</td>
        <td style="font-size:11px">${m.unit||'—'}</td>
        <td style="font-size:11px;color:var(--muted)">${m.reason||'—'}</td>
        <td style="font-size:11px;color:var(--muted)">${m.createdAt?new Date(m.createdAt).toLocaleDateString('pt-BR'):'—'}</td>
      </tr>`).join('')}
      </tbody></table>`}
    </div>

    <div class="card">
      <div class="card-title">🔄 Transferências entre Unidades</div>
      <div class="alert al-info">Produtos transferidos do CDLE para as lojas são registrados aqui.</div>
      <button class="btn btn-primary btn-sm" id="btn-new-transfer2">+ Nova Transferência</button>
    </div>
  </div>
</div>`;
}

// ── MODAL ESTOQUE ────────────────────────────────────────────
export async function showStockModal(prodId, prodName, type='Entrada'){
  const validUnits = ['Loja Novo Aleixo','Loja Allegro Mall','CDLE'];
  const defaultUnit = validUnits.includes(S.user.unit) ? S.user.unit : 'CDLE';
  S._modal=`<div class="mo" id="mo"><div class="mo-box" onclick="event.stopPropagation()">
  <div class="mo-title">${type==='Entrada'?'📦 Entrada':'📤 Saída'} de Estoque</div>
  <div class="fg"><label class="fl">Produto</label><input class="fi" value="${prodName}" readonly style="background:var(--cream)"/></div>
  <div class="fr2">
    <div class="fg"><label class="fl">Quantidade *</label><input class="fi" type="number" id="sm-qty" placeholder="0" min="1"/></div>
    <div class="fg"><label class="fl">Unidade *</label>
      <select class="fi" id="sm-unit">
        ${validUnits.map(u=>`<option value="${u}" ${u===defaultUnit?'selected':''}>${u}</option>`).join('')}
      </select>
    </div>
  </div>
  <div class="fg"><label class="fl">Motivo</label>
    <select class="fi" id="sm-reason">
      ${type==='Entrada'?
        '<option>Compra de fornecedor</option><option>Transferência recebida</option><option>Devolução</option><option>Ajuste de inventário</option><option>Outros</option>':
        '<option>Venda balcão</option><option>Perda/Avaria</option><option>Transferência enviada</option><option>Ajuste de inventário</option><option>Outros</option>'
      }
    </select>
  </div>
  <div class="fg"><label class="fl">Observação</label><textarea class="fi" id="sm-obs" rows="2" placeholder="Detalhes adicionais..."></textarea></div>
  <div class="mo-foot">
    <button class="btn ${type==='Entrada'?'btn-green':'btn-red'}" id="btn-sv-stock">Confirmar ${type}</button>
    <button class="btn btn-ghost" id="btn-mo-close">Cancelar</button>
  </div>
  </div></div>`;
  await render();
  document.getElementById('btn-mo-close')?.addEventListener('click',()=>{S._modal='';render();});
  document.getElementById('btn-sv-stock')?.addEventListener('click',()=>saveStockMove(prodId,type));
}

// ── MODAL TRANSFERÊNCIA ──────────────────────────────────────
export async function showTransferModal(){
  S._modal=`<div class="mo" id="mo"><div class="mo-box" onclick="event.stopPropagation()">
  <div class="mo-title">🔄 Transferência entre Unidades</div>
  <div class="fg"><label class="fl">Produto *</label>
    <select class="fi" id="tr-prod">
      <option value="">Selecionar produto...</option>
      ${S.products.map(p=>`<option value="${p._id}">${p.name} (Est: ${p.stock||0})</option>`).join('')}
    </select>
  </div>
  <div class="fr2">
    <div class="fg"><label class="fl">Origem *</label>
      <select class="fi" id="tr-from">
        <option value="CDLE">CDLE</option>
        <option value="Loja Novo Aleixo">Loja Novo Aleixo</option>
        <option value="Loja Allegro Mall">Loja Allegro Mall</option>
      </select>
    </div>
    <div class="fg"><label class="fl">Destino *</label>
      <select class="fi" id="tr-to">
        <option value="Loja Novo Aleixo">Loja Novo Aleixo</option>
        <option value="Loja Allegro Mall">Loja Allegro Mall</option>
        <option value="CDLE">CDLE</option>
      </select>
    </div>
  </div>
  <div class="fg"><label class="fl">Quantidade *</label><input class="fi" type="number" id="tr-qty" placeholder="0" min="1"/></div>
  <div class="fg"><label class="fl">Observação</label><textarea class="fi" id="tr-obs" rows="2"></textarea></div>
  <div class="mo-foot">
    <button class="btn btn-blue" id="btn-sv-transfer">Confirmar Transferência</button>
    <button class="btn btn-ghost" id="btn-mo-close">Cancelar</button>
  </div>
  </div></div>`;
  await render();
  document.getElementById('btn-mo-close')?.addEventListener('click',()=>{S._modal='';render();});
  document.getElementById('btn-sv-transfer')?.addEventListener('click',saveTransfer);
}

// ── SALVAR MOVIMENTAÇÃO ──────────────────────────────────────
export async function saveStockMove(prodId, type){
  const qty = parseInt(document.getElementById('sm-qty')?.value||0);
  const unit = document.getElementById('sm-unit')?.value;
  const reason = document.getElementById('sm-reason')?.value;
  const obs = document.getElementById('sm-obs')?.value;
  if(!qty||qty<=0) return toast('❌ Informe a quantidade');
  try{
    S.loading=true;S._modal='';render();
    const move = await POST('/stock',{product:prodId,type,qty,unit,reason:obs?reason+' — '+obs:reason});
    S.stockMoves.unshift(move);
    // Update product stock locally
    S.products = S.products.map(p=>{
      if(p._id===prodId){
        const newStock = type==='Entrada' ? (p.stock||0)+qty : Math.max(0,(p.stock||0)-qty);
        return {...p, stock:newStock};
      }
      return p;
    });
    S.loading=false;render();
    toast(`✅ ${type} de ${qty} unidades registrada!`);
  }catch(e){S.loading=false;render();}
}

// ── SALVAR TRANSFERÊNCIA ─────────────────────────────────────
export async function saveTransfer(){
  const prodId = document.getElementById('tr-prod')?.value;
  const from = document.getElementById('tr-from')?.value;
  const to = document.getElementById('tr-to')?.value;
  const qty = parseInt(document.getElementById('tr-qty')?.value||0);
  const obs = document.getElementById('tr-obs')?.value;
  if(!prodId) return toast('❌ Selecione o produto');
  if(!qty||qty<=0) return toast('❌ Informe a quantidade');
  if(from===to) return toast('❌ Origem e destino devem ser diferentes');
  try{
    S.loading=true;S._modal='';render();
    const move = await POST('/stock',{product:prodId,type:'Transferência',qty,unit:from,unitDest:to,reason:obs||'Transferência entre unidades'});
    S.stockMoves.unshift(move);
    S.loading=false;render();
    toast(`✅ Transferência de ${qty} unidades registrada!`);
  }catch(e){S.loading=false;render();}
}

// ── CARREGAR MOVIMENTAÇÕES ───────────────────────────────────
export async function loadStockMoves(){
  try{
    const moves = await GET('/stock/moves');
    S.stockMoves = moves||[];
  }catch(e){ S.stockMoves=[]; }
}

// ── AJUSTE DE PREÇOS EM LOTE ─────────────────────────────────
function _getAdjustTargets(){
  const adj = S._stockAdjust || {};
  // Recomputa produtos filtrados conforme estado atual
  const unit = S._stockUnit || (S.user.unit==='Todas'?'':S.user.unit);
  let filtered = unit ? S.products.filter(p=>!p.unit||p.unit===unit||p.unit==='Todas') : S.products.slice();
  const q = (S._stockSearch||'').trim().toLowerCase();
  if(q){
    filtered = filtered.filter(p =>
      (p.name||'').toLowerCase().includes(q) ||
      (p.code||'').toLowerCase().includes(q) ||
      (p.sku||'').toLowerCase().includes(q)
    );
  }
  const cat = S._stockCat||'';
  if(cat) filtered = filtered.filter(p=>(p.category||'')===cat);
  if(adj.scope==='selected'){
    const sel = new Set(S._stockSelected||[]);
    return filtered.filter(p=>sel.has(p._id));
  }
  return filtered;
}

function _computeNewPrice(oldPrice, op, type, value){
  const v = Number(value)||0;
  if(type==='pct'){
    if(op==='inc') return oldPrice * (1 + v/100);
    if(op==='dec') return oldPrice * (1 - v/100);
    if(op==='set') return v; // definir percentual não faz sentido, mas definimos como valor
  } else {
    if(op==='inc') return oldPrice + v;
    if(op==='dec') return oldPrice - v;
    if(op==='set') return v;
  }
  return oldPrice;
}

export async function previewPriceAdjust(){
  const adj = S._stockAdjust || {};
  const targets = _getAdjustTargets();
  if(targets.length===0) return toast('❌ Nenhum produto para ajustar');
  const lines = targets.slice(0,20).map(p=>{
    const newV = adj.applyVenda ? Math.max(0, _computeNewPrice(p.price||0, adj.op, adj.type, adj.value)) : (p.price||0);
    const newC = adj.applyCusto ? Math.max(0, _computeNewPrice(p.costPrice||0, adj.op, adj.type, adj.value)) : (p.costPrice||0);
    return `<tr>
      <td style="font-size:11px">${esc(p.name||'')}</td>
      <td style="text-align:right;font-size:11px">${adj.applyVenda?`${$c(p.price||0)} → <strong>${$c(newV)}</strong>`:`${$c(p.price||0)}`}</td>
      <td style="text-align:right;font-size:11px">${adj.applyCusto?`${$c(p.costPrice||0)} → <strong>${$c(newC)}</strong>`:`${$c(p.costPrice||0)}`}</td>
    </tr>`;
  }).join('');
  S._modal=`<div class="mo" id="mo"><div class="mo-box" onclick="event.stopPropagation()" style="max-width:680px;">
    <div class="mo-title">👁️ Preview do Ajuste (${targets.length} produto${targets.length===1?'':'s'})</div>
    <div style="max-height:50vh;overflow:auto;">
      <table><thead><tr><th>Produto</th><th style="text-align:right">Venda</th><th style="text-align:right">Custo</th></tr></thead>
      <tbody>${lines}</tbody></table>
      ${targets.length>20?`<div style="padding:8px;font-size:11px;color:var(--muted)">... e mais ${targets.length-20} produtos</div>`:''}
    </div>
    <div class="mo-foot">
      <button class="btn btn-primary" id="btn-apply-adjust-confirm">✅ Confirmar e Aplicar</button>
      <button class="btn btn-ghost" id="btn-mo-close">Cancelar</button>
    </div>
  </div></div>`;
  await render();
  document.getElementById('btn-mo-close')?.addEventListener('click',()=>{S._modal='';render();});
  document.getElementById('btn-apply-adjust-confirm')?.addEventListener('click',()=>{S._modal='';applyPriceAdjust();});
}

export async function applyPriceAdjust(){
  const adj = S._stockAdjust || {};
  if(!adj.applyVenda && !adj.applyCusto) return toast('❌ Marque ao menos um preço (venda ou custo)');
  const targets = _getAdjustTargets();
  if(targets.length===0) return toast('❌ Nenhum produto para ajustar');
  let ok=0, err=0;
  toast(`⏳ Aplicando em ${targets.length} produtos...`);
  for(let i=0;i<targets.length;i++){
    const p = targets[i];
    const body = {};
    if(adj.applyVenda) body.price = Math.max(0, _computeNewPrice(p.price||0, adj.op, adj.type, adj.value));
    if(adj.applyCusto) body.costPrice = Math.max(0, _computeNewPrice(p.costPrice||0, adj.op, adj.type, adj.value));
    try{
      await PUT('/products/'+p._id, body);
      S.products = S.products.map(x=>x._id===p._id?{...x, ...body}:x);
      ok++;
      if((i+1)%5===0 || i===targets.length-1) toast(`⏳ ${i+1}/${targets.length}...`);
    }catch(e){ err++; }
  }
  try{ invalidateCache && invalidateCache('products'); }catch(e){}
  render();
  toast(`✅ Ajuste aplicado: ${ok} ok${err?`, ${err} erros`:''}`);
}

export async function updateProductFieldInline(pid, field, value){
  const p = S.products.find(x=>x._id===pid);
  if(!p) return;
  const num = Number(value);
  if(isNaN(num)) return toast('❌ Valor inválido');
  const body = { [field]: Math.max(0, num) };
  try{
    await PUT('/products/'+pid, body);
    S.products = S.products.map(x=>x._id===pid?{...x, ...body}:x);
    toast('✅ Atualizado');
  }catch(e){
    toast('❌ Erro ao atualizar');
    render();
  }
}

// ── EXPORT CSV (estoque por unidade) ─────────────────────────
function _csvCell(v){
  const s = String(v==null?'':v);
  if(/[",\n;]/.test(s)) return '"'+s.replace(/"/g,'""')+'"';
  return s;
}
export function exportStockCSV(){
  const header = ['nome','sku','CDLE','Loja Novo Aleixo','Loja Allegro Mall','total'];
  const rows = S.products.map(p=>{
    const sbu = getStockByUnit(p);
    const total = _totalFromSbu(sbu);
    return [
      p.name||'',
      p.code||p.sku||'',
      sbu['CDLE']||0,
      sbu['Loja Novo Aleixo']||0,
      sbu['Loja Allegro Mall']||0,
      total
    ];
  });
  const csv = [header.join(','), ...rows.map(r=>r.map(_csvCell).join(','))].join('\n');
  const blob = new Blob(['\ufeff'+csv], { type:'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `estoque-por-unidade-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
  toast('✅ CSV exportado');
}

export async function importStockCSV(file){
  if(!file) return;
  const text = await file.text();
  const lines = text.replace(/^\ufeff/,'').split(/\r?\n/).filter(l=>l.trim());
  if(lines.length<2) return toast('❌ CSV vazio', true);
  const parseLine = (line)=>{
    const out = []; let cur=''; let inQ=false;
    for(let i=0;i<line.length;i++){
      const c=line[i];
      if(inQ){
        if(c==='"' && line[i+1]==='"'){ cur+='"'; i++; }
        else if(c==='"') inQ=false;
        else cur+=c;
      } else {
        if(c==='"') inQ=true;
        else if(c===','){ out.push(cur); cur=''; }
        else cur+=c;
      }
    }
    out.push(cur);
    return out;
  };
  const header = parseLine(lines[0]).map(h=>h.trim());
  const idx = {
    sku: header.findIndex(h=>/^sku$/i.test(h) || /codigo/i.test(h)),
    cdle: header.findIndex(h=>/^cdle$/i.test(h)),
    na: header.findIndex(h=>/novo\s*aleixo/i.test(h)),
    am: header.findIndex(h=>/allegro/i.test(h))
  };
  if(idx.sku<0) return toast('❌ Coluna sku não encontrada', true);
  let ok=0, err=0;
  for(let i=1;i<lines.length;i++){
    const cols = parseLine(lines[i]);
    const sku = (cols[idx.sku]||'').trim();
    if(!sku) continue;
    const p = S.products.find(x=>(x.code||x.sku||'')===sku);
    if(!p){ err++; continue; }
    const sbu = {
      'CDLE': idx.cdle>=0 ? Number(cols[idx.cdle])||0 : (p.stockByUnit?.CDLE||0),
      'Loja Novo Aleixo': idx.na>=0 ? Number(cols[idx.na])||0 : (p.stockByUnit?.['Loja Novo Aleixo']||0),
      'Loja Allegro Mall': idx.am>=0 ? Number(cols[idx.am])||0 : (p.stockByUnit?.['Loja Allegro Mall']||0)
    };
    const total = _totalFromSbu(sbu);
    try{
      await PUT('/products/'+p._id, { stockByUnit: sbu, estoque: total, stock: total });
      p.stockByUnit = sbu; p.estoque = total; p.stock = total;
      ok++;
    }catch(e){ err++; }
  }
  try{ invalidateCache && invalidateCache('products'); }catch(e){}
  render();
  toast(`✅ Importação: ${ok} ok${err?`, ${err} erros`:''}`);
}

// ── SALVAR ESTOQUE DO MODAL DE PRODUTO ───────────────────────
export function saveStockFromModal(){
  const type = document.getElementById('st-type')?.value||'entrada';
  const qty  = parseInt(document.getElementById('st-qty')?.value)||0;
  const note = document.getElementById('st-note')?.value||'';
  if(!qty||qty<1) return toast('❌ Quantidade inválida',true);
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
