// ── CATALOGO PARA CLIENTE ───────────────────────────────────
// Modulo pra montar um catalogo visual de produtos selecionados pra
// enviar via WhatsApp, Instagram, etc. Cada produto e renderizado
// como um cartao com:
//  - Foto (visivel + arrastavel direto pro WhatsApp/IG)
//  - Nome em destaque
//  - Preco
//  - Descricao curta
// + Botao "Copiar legenda" (nome + preco + descricao formatado)
// + Botao "Baixar imagem" (download direto)
// + Botao geral "Compartilhar" (Web Share API quando disponivel)

import { S } from '../state.js';
import { $c } from '../utils/formatters.js';
import { toast } from '../utils/helpers.js';

async function render(){ const m = await import('../main.js'); m.render(); }

// State helpers em S (persiste entre re-renders enquanto a aba esta aberta)
function _state(){
  if (!S._catCli) S._catCli = {
    selecionados: new Set(),  // Set de _id dos produtos
    catFiltro: 'todas',       // 'todas' | nome de cat
    busca: '',                // texto livre
    apenasComFoto: true,      // mostra so produtos com imagem
    visualizar: false,        // false = lista de selecao | true = catalogo final
  };
  if (!(S._catCli.selecionados instanceof Set)) S._catCli.selecionados = new Set(S._catCli.selecionados || []);
  return S._catCli;
}

function _produtoFoto(p){
  return p.imagem || p.images?.[0] || p.image || p.foto || '';
}

function _produtoPreco(p){
  return Number(p.salePrice || p.price || p.preco || 0);
}

// Filtra produtos com base nos criterios atuais
function _filtraProdutos(){
  const st = _state();
  const todos = (S.products||[]).filter(p => p && !p.archived && p.activeOnSite !== false);
  return todos.filter(p => {
    if (st.apenasComFoto && !_produtoFoto(p)) return false;
    if (st.catFiltro && st.catFiltro !== 'todas') {
      const cats = Array.isArray(p.categories) ? p.categories : (p.category ? [p.category] : []);
      if (!cats.some(c => String(c).toLowerCase() === st.catFiltro.toLowerCase())) return false;
    }
    if (st.busca) {
      const q = st.busca.toLowerCase();
      const hay = `${p.name||''} ${p.description||''} ${(p.categories||[]).join(' ')}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function _categoriasDisponiveis(){
  const set = new Set();
  (S.products||[]).forEach(p => {
    if (p.archived) return;
    (Array.isArray(p.categories) ? p.categories : [p.category]).forEach(c => {
      if (c) set.add(String(c).trim());
    });
  });
  return [...set].sort((a,b) => a.localeCompare(b,'pt-BR'));
}

// ── HEADER + FILTROS ─────────────────────────────────────────
function _renderHeader(){
  const st = _state();
  const cats = _categoriasDisponiveis();
  const totalSel = st.selecionados.size;
  return `
<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:18px;">
  <div>
    <h2 style="font-family:'Playfair Display',serif;font-size:22px;color:var(--primary);">📤 Catálogo para Cliente</h2>
    <p style="font-size:13px;color:var(--muted);margin-top:2px;">Monte uma vitrine pra mandar pelo WhatsApp ou Instagram. As fotos podem ser arrastadas direto pra conversa.</p>
  </div>
  <div style="display:flex;gap:8px;flex-wrap:wrap;">
    ${st.visualizar
      ? `<button class="btn btn-ghost" id="btn-cat-cli-voltar">← Voltar à seleção</button>
         <button class="btn btn-primary" id="btn-cat-cli-imprimir">🖨️ Imprimir / PDF</button>`
      : `<button class="btn btn-ghost" id="btn-cat-cli-clear" ${totalSel===0?'disabled style="opacity:.5;"':''}>✕ Limpar seleção</button>
         <button class="btn btn-primary" id="btn-cat-cli-gerar" ${totalSel===0?'disabled style="opacity:.5;"':''}>📤 Gerar catálogo (${totalSel})</button>`
    }
  </div>
</div>
${st.visualizar ? '' : `
<div class="card" style="margin-bottom:14px;">
  <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:end;">
    <div class="fg" style="flex:1;min-width:220px;">
      <label class="fl">Buscar produto</label>
      <input class="fi" id="cat-cli-busca" placeholder="Nome, categoria, descrição..." value="${(st.busca||'').replace(/"/g,'&quot;')}"/>
    </div>
    <div class="fg" style="min-width:200px;">
      <label class="fl">Categoria</label>
      <select class="fi" id="cat-cli-cat">
        <option value="todas">— Todas as categorias —</option>
        ${cats.map(c => `<option value="${c.replace(/"/g,'&quot;')}" ${st.catFiltro===c?'selected':''}>${c}</option>`).join('')}
      </select>
    </div>
    <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;padding:10px 12px;background:var(--cream);border-radius:8px;font-weight:600;">
      <input type="checkbox" id="cat-cli-foto" ${st.apenasComFoto?'checked':''}/> 📷 Só com foto
    </label>
  </div>
</div>
`}`;
}

// ── TELA 1: SELECAO ──────────────────────────────────────────
function _renderSelecao(){
  const st = _state();
  const lista = _filtraProdutos();
  if (lista.length === 0) {
    return `<div class="card" style="text-align:center;padding:40px;color:var(--muted);">
      <div style="font-size:48px;margin-bottom:10px;">🌸</div>
      <p style="font-weight:700;">Nenhum produto encontrado.</p>
      <p style="font-size:12px;margin-top:6px;">Ajuste os filtros ou cadastre produtos no módulo Produtos.</p>
    </div>`;
  }
  // Botoes de selecao em massa
  const allIds = lista.map(p => String(p._id||p.id));
  const todosSel = allIds.every(id => st.selecionados.has(id));
  return `
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:10px;">
  <div style="font-size:13px;color:var(--muted);">
    <strong>${lista.length}</strong> produto(s) · <strong style="color:var(--rose);">${st.selecionados.size}</strong> selecionado(s)
  </div>
  <div style="display:flex;gap:6px;">
    <button class="btn btn-ghost btn-sm" id="btn-cat-cli-sel-todos">${todosSel?'Desmarcar visíveis':'Selecionar todos visíveis'}</button>
  </div>
</div>
<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px;">
  ${lista.map(p => {
    const id = String(p._id||p.id);
    const sel = st.selecionados.has(id);
    const foto = _produtoFoto(p);
    const preco = _produtoPreco(p);
    return `
    <label data-cli-card="${id}" style="background:#fff;border:2px solid ${sel?'var(--rose)':'var(--border)'};border-radius:12px;overflow:hidden;cursor:pointer;display:flex;flex-direction:column;transition:all .15s;${sel?'box-shadow:0 4px 12px rgba(200,67,106,.2);':''}">
      <div style="position:relative;aspect-ratio:1;background:var(--cream);">
        ${foto
          ? `<img src="${foto}" style="width:100%;height:100%;object-fit:cover;"/>`
          : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:48px;">🌸</div>`}
        <div style="position:absolute;top:8px;left:8px;width:28px;height:28px;border-radius:50%;background:${sel?'var(--rose)':'rgba(255,255,255,.9)'};border:2px solid ${sel?'#fff':'var(--rose)'};display:flex;align-items:center;justify-content:center;color:${sel?'#fff':'var(--rose)'};font-size:14px;font-weight:900;">${sel?'✓':''}</div>
        <input type="checkbox" data-cli-toggle="${id}" ${sel?'checked':''} style="position:absolute;opacity:0;pointer-events:none;"/>
      </div>
      <div style="padding:10px 12px;flex:1;">
        <div style="font-weight:700;font-size:13px;color:var(--ink);line-height:1.25;min-height:32px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${p.name||'—'}</div>
        <div style="font-weight:900;color:var(--rose);font-size:15px;margin-top:6px;">${preco>0?'R$ '+preco.toFixed(2).replace('.',','):'—'}</div>
      </div>
    </label>`;
  }).join('')}
</div>`;
}

// ── TELA 2: CATALOGO FINAL (visual de envio) ────────────────
function _renderCatalogoFinal(){
  const st = _state();
  const ids = [...st.selecionados];
  const produtos = (S.products||[]).filter(p => ids.includes(String(p._id||p.id)));
  if (produtos.length === 0) {
    return `<div class="card" style="text-align:center;padding:40px;">
      <p>Nenhum produto selecionado. Volte e marque ao menos um.</p>
    </div>`;
  }

  // Box de instrucoes (so na tela)
  const instrucoes = `
<div class="no-print card" style="background:linear-gradient(135deg,#DBEAFE,#DCFCE7);border:none;margin-bottom:14px;">
  <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;">
    <div style="font-size:32px;">💡</div>
    <div style="flex:1;min-width:240px;font-size:13px;color:#1E3A8A;">
      <strong>Como enviar pro cliente:</strong>
      <ol style="margin:6px 0 0 18px;line-height:1.6;">
        <li><strong>Arraste a foto</strong> direto pra conversa do WhatsApp / Instagram (segura clica e arrasta).</li>
        <li>Ou clique <strong>📋 Copiar legenda</strong> e cole junto da foto.</li>
        <li>Ou <strong>💾 Baixar foto</strong> pra mandar do celular.</li>
        <li>Ou clique <strong>🖨️ Imprimir / PDF</strong> em cima pra mandar tudo num arquivo só.</li>
      </ol>
    </div>
  </div>
</div>`;

  return instrucoes + `
<div id="cat-cli-print-area" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:18px;">
  ${produtos.map((p,i) => {
    const id = String(p._id||p.id);
    const foto = _produtoFoto(p);
    const preco = _produtoPreco(p);
    const desc = (p.description || p.descricao || '').trim();
    const legenda = `🌹 *${p.name||''}*\n💰 R$ ${preco.toFixed(2).replace('.',',')}${desc?'\n\n'+desc:''}\n\n📲 Pedidos: (92) 99300-2433`;
    return `
    <div class="cat-cli-card" data-cli-final="${id}" style="background:#fff;border:1px solid var(--border);border-radius:14px;overflow:hidden;display:flex;flex-direction:column;page-break-inside:avoid;break-inside:avoid;">
      <div style="position:relative;aspect-ratio:1;background:var(--cream);">
        ${foto
          ? `<img src="${foto}" alt="${(p.name||'').replace(/"/g,'&quot;')}" draggable="true" style="width:100%;height:100%;object-fit:cover;cursor:grab;display:block;"/>`
          : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:64px;">🌸</div>`}
        <div style="position:absolute;top:8px;left:8px;background:rgba(0,0,0,.6);color:#fff;padding:4px 10px;border-radius:20px;font-size:11px;font-weight:700;">#${i+1}</div>
      </div>
      <div style="padding:12px 14px;flex:1;display:flex;flex-direction:column;">
        <div style="font-weight:800;font-size:15px;color:var(--ink);line-height:1.25;">${p.name||'—'}</div>
        <div style="font-weight:900;color:var(--rose);font-size:20px;margin-top:6px;">R$ ${preco.toFixed(2).replace('.',',')}</div>
        ${desc ? `<div style="font-size:12px;color:var(--muted);line-height:1.4;margin-top:6px;">${desc.length>180?desc.substring(0,180)+'…':desc}</div>` : ''}
        <div class="no-print" style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;">
          <button class="btn btn-ghost btn-sm" data-cli-copy="${encodeURIComponent(legenda)}" style="flex:1;font-size:11px;">📋 Copiar legenda</button>
          ${foto ? `<button class="btn btn-ghost btn-sm" data-cli-download="${encodeURIComponent(foto)}" data-cli-name="${(p.name||'produto').replace(/[^\w\-]+/g,'_').toLowerCase()}" style="flex:1;font-size:11px;">💾 Baixar foto</button>` : ''}
        </div>
      </div>
    </div>`;
  }).join('')}
</div>

<style>
@media print {
  .no-print { display:none !important; }
  .topbar, .sidebar, #sb-overlay { display:none !important; }
  .main { margin:0 !important; padding:0 !important; }
  .content { padding:0 !important; max-width:100% !important; }
  .cat-cli-card { box-shadow:none !important; border:1px solid #ddd !important; }
  body { background:#fff !important; }
  @page { size:A4 portrait; margin:10mm; }
}
</style>
`;
}

// ── RENDER PRINCIPAL ─────────────────────────────────────────
export function renderCatalogoCliente(){
  const st = _state();
  return _renderHeader() + (st.visualizar ? _renderCatalogoFinal() : _renderSelecao());
}

// ── BINDINGS ─────────────────────────────────────────────────
export function bindCatalogoCliente(){
  if (S.page !== 'catalogoCliente') return;
  const st = _state();

  // Filtros
  const inpBusca = document.getElementById('cat-cli-busca');
  if (inpBusca) {
    let _t = null;
    inpBusca.oninput = (e) => {
      clearTimeout(_t);
      _t = setTimeout(() => { st.busca = e.target.value; render(); }, 250);
    };
  }
  const selCat = document.getElementById('cat-cli-cat');
  if (selCat) selCat.onchange = (e) => { st.catFiltro = e.target.value; render(); };

  const cbFoto = document.getElementById('cat-cli-foto');
  if (cbFoto) cbFoto.onchange = (e) => { st.apenasComFoto = e.target.checked; render(); };

  // Selecao individual
  document.querySelectorAll('[data-cli-card]').forEach(el => {
    el.onclick = (ev) => {
      ev.preventDefault();
      const id = el.dataset.cliCard;
      if (st.selecionados.has(id)) st.selecionados.delete(id);
      else st.selecionados.add(id);
      render();
    };
  });

  // Selecionar todos visiveis
  const btnTodos = document.getElementById('btn-cat-cli-sel-todos');
  if (btnTodos) btnTodos.onclick = () => {
    const ids = _filtraProdutos().map(p => String(p._id||p.id));
    const todosSel = ids.every(id => st.selecionados.has(id));
    if (todosSel) ids.forEach(id => st.selecionados.delete(id));
    else          ids.forEach(id => st.selecionados.add(id));
    render();
  };

  // Limpar selecao
  const btnClear = document.getElementById('btn-cat-cli-clear');
  if (btnClear) btnClear.onclick = () => {
    if (st.selecionados.size === 0) return;
    if (confirm(`Limpar seleção de ${st.selecionados.size} produto(s)?`)) {
      st.selecionados = new Set();
      render();
    }
  };

  // Gerar catalogo (ir pra tela 2)
  const btnGerar = document.getElementById('btn-cat-cli-gerar');
  if (btnGerar) btnGerar.onclick = () => { st.visualizar = true; render(); };

  // Voltar
  const btnVoltar = document.getElementById('btn-cat-cli-voltar');
  if (btnVoltar) btnVoltar.onclick = () => { st.visualizar = false; render(); };

  // Imprimir / PDF
  const btnImp = document.getElementById('btn-cat-cli-imprimir');
  if (btnImp) btnImp.onclick = () => { window.print(); };

  // Copiar legenda
  document.querySelectorAll('[data-cli-copy]').forEach(b => {
    b.onclick = async () => {
      const txt = decodeURIComponent(b.dataset.cliCopy || '');
      try {
        await navigator.clipboard.writeText(txt);
        toast('📋 Legenda copiada! Cole no WhatsApp/Instagram.');
      } catch(_) {
        // Fallback: textarea + execCommand
        const ta = document.createElement('textarea');
        ta.value = txt; document.body.appendChild(ta);
        ta.select(); try { document.execCommand('copy'); } catch(_){}
        document.body.removeChild(ta);
        toast('📋 Legenda copiada!');
      }
    };
  });

  // Baixar foto
  document.querySelectorAll('[data-cli-download]').forEach(b => {
    b.onclick = async () => {
      const url = decodeURIComponent(b.dataset.cliDownload || '');
      const nome = (b.dataset.cliName || 'produto') + '.jpg';
      try {
        // Se for data: URL ou mesma origem, faz download direto
        const a = document.createElement('a');
        if (url.startsWith('data:') || url.startsWith('blob:')) {
          a.href = url;
        } else {
          // Cross-origin: tenta fetch + blob (alguns CDNs bloqueiam, ai abre em nova aba)
          try {
            const res = await fetch(url, { mode: 'cors' });
            if (!res.ok) throw new Error('fetch falhou');
            const blob = await res.blob();
            a.href = URL.createObjectURL(blob);
          } catch(_) {
            window.open(url, '_blank');
            return;
          }
        }
        a.download = nome;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        toast('💾 Foto baixada');
      } catch(e) {
        console.error('[catalogoCliente] download erro:', e);
        toast('❌ Não consegui baixar — abra a imagem em nova aba e salve manualmente', true);
      }
    };
  });
}
