import { S } from '../state.js';
import { $c, $d, esc } from '../utils/formatters.js';
import { GET, POST, PATCH } from '../services/api.js';
import { toast } from '../utils/helpers.js';
import { can } from '../services/auth.js';
import { invalidateCache } from '../services/cache.js';
import { emoji } from '../utils/formatters.js';

// ── Helper: render() via dynamic import ───────────────────────
async function render(){
  const { render:r } = await import('../main.js');
  r();
}

// ── ESTOQUE ──────────────────────────────────────────────────
export function renderEstoque(){
  const low = S.products.filter(p=>(p.stock||0)<=(p.minStock||5));
  const unit = S._stockUnit || (S.user.unit==='Todas'?'':S.user.unit);
  const filtered = unit ? S.products.filter(p=>!p.unit||p.unit===unit||p.unit==='Todas') : S.products;
  const totalVal = filtered.reduce((s,p)=>s+(p.costPrice||0)*(p.stock||0),0);

  return`
${low.length>0?`<div class="alert al-warn">⚠️ <strong>${low.length} itens com estoque crítico:</strong> ${low.map(p=>p.name).join(', ')}</div>`:''}

<div class="g4" style="margin-bottom:16px;">
  <div class="mc rose"><div class="mc-label">Total Produtos</div><div class="mc-val">${filtered.length}</div></div>
  <div class="mc leaf"><div class="mc-label">Estoque Normal</div><div class="mc-val">${filtered.filter(p=>(p.stock||0)>(p.minStock||5)).length}</div></div>
  <div class="mc gold"><div class="mc-label">Estoque Crítico</div><div class="mc-val">${low.length}</div></div>
  <div class="mc purple"><div class="mc-label">Valor em Estoque</div><div class="mc-val">${$c(totalVal)}</div></div>
</div>

<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;align-items:center;">
  ${S.user.role==='Administrador'||S.user.role==='Gerente'?`
  <select class="fi" id="stock-unit-filter" style="width:auto;">
    <option value="">Todas as unidades</option>
    <option value="Loja Novo Aleixo" ${unit==='Loja Novo Aleixo'?'selected':''}>Loja Novo Aleixo</option>
    <option value="Loja Allegro Mall" ${unit==='Loja Allegro Mall'?'selected':''}>Loja Allegro Mall</option>
    <option value="CDLE" ${unit==='CDLE'?'selected':''}>CDLE</option>
  </select>`:''}
  <button class="btn btn-green btn-sm" id="btn-stock-entry">📦 Entrada de Estoque</button>
  <button class="btn btn-outline btn-sm" id="btn-stock-exit">📤 Saída Manual</button>
  <button class="btn btn-blue btn-sm" id="btn-new-transfer">🔄 Transferência</button>
  <button class="btn btn-ghost btn-sm" id="btn-rel-prods">🔄 Atualizar</button>
</div>

<div class="g2">
  <div class="card">
    <div class="card-title">Posição do Estoque</div>
    ${filtered.length===0?`<div class="empty"><div class="empty-icon">📦</div><p>Nenhum produto</p></div>`:''}
    ${filtered.map(p=>{
      const pct=Math.min(100,((p.stock||0)/Math.max((p.minStock||5)*3,1))*100);
      const color=(p.stock||0)<=(p.minStock||5)?'var(--red)':(p.stock||0)<=(p.minStock||5)*1.5?'var(--gold)':'var(--leaf)';
      const status=(p.stock||0)<=(p.minStock||5)?'⚠️ Crítico':(p.stock||0)<=(p.minStock||5)*1.5?'⚡ Baixo':'✅ OK';
      return`<div style="margin-bottom:12px;padding:10px;border:1px solid var(--border);border-radius:var(--r);background:#fff;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <div style="display:flex;align-items:center;gap:8px;">
            ${p.images?.[0]?`<img src="${p.images[0]}" style="width:32px;height:32px;border-radius:6px;object-fit:cover;">`:`<span style="font-size:18px">${emoji(p.category)}</span>`}
            <div>
              <div style="font-size:12px;font-weight:600">${p.name}</div>
              <div style="font-size:10px;color:var(--muted)">${p.category||'—'} · ${p.code||'—'}</div>
            </div>
          </div>
          <div style="text-align:right">
            <div style="font-size:16px;font-weight:700;color:${color}">${p.stock||0}</div>
            <div style="font-size:10px;color:var(--muted)">mín: ${p.minStock||5}</div>
          </div>
        </div>
        <div class="pb"><div class="pf" style="width:${pct}%;background:${color}"></div></div>
        <div style="display:flex;justify-content:space-between;margin-top:6px;">
          <span style="font-size:10px;color:${color};font-weight:500">${status}</span>
          <div style="display:flex;gap:4px;">
            <button class="btn btn-ghost btn-xs" data-stock-add="${p._id}" data-stock-name="${p.name}">+ Entrada</button>
            <button class="btn btn-ghost btn-xs" data-stock-rem="${p._id}" data-stock-name="${p.name}">− Saída</button>
          </div>
        </div>
      </div>`;
    }).join('')}
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
