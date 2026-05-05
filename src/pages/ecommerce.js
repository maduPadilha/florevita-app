// ── E-COMMERCE ──────────────────────────────────────────────
import { S } from '../state.js';
import { $c } from '../utils/formatters.js';
import { toast } from '../utils/helpers.js';
import { api, PUT, PATCH } from '../services/api.js';

// ── Helper: render() via dynamic import ───────────────────────
async function render(){
  const { render:r } = await import('../main.js');
  r();
}

// ── Helper: render seção CATEGORIAS DO SITE ─────────────────
// Modelo ADD-only: por padrão NENHUMA categoria está no site.
// Admin clica "+ Adicionar" pra incluir uma. Removida = some da lista.
// State buffer: edições ficam em window._csState até o "Salvar tudo".
function renderCategoriasSiteSection(cfg) {
  // Lista de TODAS as categorias do sistema (com objetos pra ler icone)
  let allCats = [];
  try { allCats = JSON.parse(localStorage.getItem('fv_categorias')||'[]'); } catch(_){}
  const catObjs = allCats.map(c => typeof c === 'string' ? { name: c } : c).filter(c => c && c.name);
  const catNames = catObjs.map(c => c.name);
  const iconeMap = {}; catObjs.forEach(c => { if (c.icone) iconeMap[c.name] = c.icone; });

  // Inicializa state buffer apenas com categorias EXPLICITAMENTE adicionadas pelo admin.
  // Snap usa keys do categoriasSite (não a lista completa) — assim adicionar
  // categoria nova no sistema NÃO quebra a seleção feita aqui.
  const map = (cfg.categoriasSite || {});
  const explicitNames = Object.keys(map);
  const snapKey = explicitNames.sort().join('|');
  if (!window._csState || window._csState._snap !== snapKey) {
    window._csState = {
      _snap: snapKey,
      _dirty: false,
      cats: explicitNames
        .filter(n => catNames.includes(n)) // ignora cats que sumiram do sistema
        .map(nome => {
          const c = map[nome] || {};
          let posicoes = Array.isArray(c.posicoes) ? c.posicoes
                       : (c.posicao ? [c.posicao] : ['inicial']);
          return {
            nome,
            posicoes,
            ordem: typeof c.ordem === 'number' ? c.ordem : 999,
            icone: iconeMap[nome] || c.icone || '',
          };
        }).sort((a,b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome,'pt-BR'))
    };
  }
  const items = window._csState.cats;
  const dirty = window._csState._dirty;
  // Categorias do sistema que ainda NÃO foram adicionadas (oferecer no botão "+")
  const naoAdicionadas = catNames.filter(n => !items.find(it => it.nome === n));

  const posLabel = {
    topo:    { l: '⬆️ Topo',    n: 'Topo (Menu)',     cor: '#1E40AF', bg: '#DBEAFE' },
    inicial: { l: '🏠 Início',   n: 'Página Inicial',  cor: '#15803D', bg: '#DCFCE7' },
    final:   { l: '⬇️ Rodapé',   n: 'Final (Rodapé)',  cor: '#92400E', bg: '#FEF3C7' },
  };

  // Agrupa para preview: cada cat aparece em TODAS as posições selecionadas
  const porPos = { topo: [], inicial: [], final: [] };
  items.forEach(it => {
    (it.posicoes||[]).forEach(p => { if (porPos[p]) porPos[p].push(it); });
  });

  return `
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:10px;">
  <div>
    <h3 style="font-weight:700;">🏷️ Categorias do Site</h3>
    <p style="font-size:13px;color:var(--muted);">Escolha quais categorias aparecem no site, onde e em qual ordem.</p>
  </div>
  <div style="display:flex;gap:8px;flex-wrap:wrap;">
    <a href="javascript:setPage('categorias')" class="btn btn-ghost btn-sm" style="color:#9F1239;text-decoration:none;">⚙️ Gerenciar categorias</a>
  </div>
</div>

${catNames.length === 0 ? `
<div class="card" style="text-align:center;padding:40px;color:var(--muted);">
  <div style="font-size:48px;margin-bottom:10px;">🏷️</div>
  <p style="font-weight:700;">Nenhuma categoria cadastrada ainda.</p>
  <p style="font-size:12px;margin-top:6px;">Crie categorias no módulo <strong>Categorias</strong> primeiro.</p>
</div>
` : `

<!-- Banner instruções -->
<div class="card" style="background:linear-gradient(135deg,#DBEAFE 0%,#DCFCE7 100%);border:none;margin-bottom:14px;">
  <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;">
    <div style="font-size:32px;">💡</div>
    <div style="flex:1;min-width:240px;font-size:13px;color:#1E3A8A;">
      <strong>Como funciona:</strong>
      <ol style="margin:6px 0 0 18px;line-height:1.6;">
        <li><strong>+ Adicionar categoria</strong>: escolha quais aparecem no site (por padrão, nenhuma aparece).</li>
        <li><strong>📍 Posição</strong>: clique nos chips — pode marcar <strong>mais de uma</strong> (Topo + Início + Rodapé).</li>
        <li><strong>↕️ Ordem</strong>: use as setinhas para reordenar.</li>
        <li><strong>🗑️ Remover</strong>: tira a categoria do site (não apaga do sistema).</li>
        <li>Clique em <strong>💾 Salvar tudo</strong> no final pra publicar.</li>
      </ol>
    </div>
  </div>
</div>

<!-- Botão Adicionar + dropdown -->
<div class="card" style="margin-bottom:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
  <span style="font-size:13px;font-weight:700;color:var(--ink);">${items.length} categoria(s) no site</span>
  ${naoAdicionadas.length > 0 ? `
    <select class="fi" id="cs-add-select" style="flex:1;min-width:200px;max-width:280px;font-size:13px;">
      <option value="">— escolher categoria pra adicionar —</option>
      ${naoAdicionadas.map(n => `<option value="${n.replace(/"/g,'&quot;')}">${iconeMap[n] ? iconeMap[n]+' ' : ''}${n}</option>`).join('')}
    </select>
    <button class="btn btn-primary btn-sm" id="btn-cs-add" style="font-weight:700;">+ Adicionar</button>
    ${naoAdicionadas.length > 1 ? `<button class="btn btn-ghost btn-sm" id="btn-cs-add-all" style="color:var(--muted);">+ Adicionar todas (${naoAdicionadas.length})</button>` : ''}
  ` : `
    <span style="font-size:12px;color:#15803D;font-weight:700;">✅ Todas as categorias do sistema já estão no site.</span>
  `}
</div>

${items.length === 0 ? `
<div class="card" style="text-align:center;padding:40px;color:var(--muted);background:#FAFAFA;">
  <div style="font-size:48px;margin-bottom:10px;">🌿</div>
  <p style="font-weight:700;color:var(--ink);">Nenhuma categoria selecionada para o site ainda.</p>
  <p style="font-size:12px;margin-top:6px;">Use o botão <strong>+ Adicionar</strong> acima pra escolher quais categorias aparecem.</p>
</div>
` : `
<!-- Lista de categorias (cards) -->
<div class="card" style="margin-bottom:14px;padding:8px;">
  ${items.map((it, i) => `
    <div data-cs-row="${it.nome.replace(/"/g,'&quot;')}" style="display:flex;align-items:center;gap:10px;padding:10px;border-bottom:1px solid #F1F5F9;flex-wrap:wrap;">

      <!-- Ordem -->
      <div style="font-size:11px;color:#94A3B8;font-weight:700;min-width:24px;text-align:center;">#${i+1}</div>

      <!-- Ícone -->
      <div style="font-size:22px;width:34px;text-align:center;">${iconeMap[it.nome] || '🌸'}</div>

      <!-- Nome -->
      <div style="flex:1;min-width:120px;font-weight:700;font-size:14px;">${it.nome}</div>

      <!-- Chips de posição (multi-select) -->
      <div style="display:flex;gap:4px;flex-wrap:wrap;" title="Pode marcar mais de uma posição">
        ${Object.entries(posLabel).map(([k,v]) => {
          const sel = (it.posicoes||[]).indexOf(k) >= 0;
          return `
          <button type="button" class="btn btn-xs" data-cs-pos="${it.nome.replace(/"/g,'&quot;')}" data-cs-pos-val="${k}"
            title="${sel?'Clique pra remover':'Clique pra adicionar'} ${v.n}"
            style="font-weight:700;${sel
              ? `background:${v.cor};color:#fff;border:1px solid ${v.cor};`
              : `background:#fff;color:${v.cor};border:1.5px dashed ${v.cor};`}">
            ${sel?'✓ ':''}${v.l}
          </button>`;
        }).join('')}
      </div>

      <!-- Setas mover -->
      <div style="display:flex;gap:2px;">
        <button type="button" class="btn btn-ghost btn-xs" data-cs-move-up="${it.nome.replace(/"/g,'&quot;')}"
          ${i===0?'disabled':''} style="font-size:14px;padding:4px 8px;" title="Mover acima">⬆️</button>
        <button type="button" class="btn btn-ghost btn-xs" data-cs-move-down="${it.nome.replace(/"/g,'&quot;')}"
          ${i===items.length-1?'disabled':''} style="font-size:14px;padding:4px 8px;" title="Mover abaixo">⬇️</button>
      </div>

      <!-- Remover do site (NÃO apaga do sistema) -->
      <button type="button" class="btn btn-ghost btn-xs" data-cs-rm="${it.nome.replace(/"/g,'&quot;')}"
        style="color:var(--red);font-size:14px;padding:4px 8px;" title="Remover do site (categoria continua no sistema)">🗑️</button>
    </div>
  `).join('')}
</div>
`}

<!-- Preview lado a lado -->
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:80px;">
  ${Object.entries(posLabel).map(([k,v]) => {
    const list = porPos[k];
    return `<div class="card" style="border-left:4px solid ${v.cor};background:${v.bg};">
      <div style="font-size:13px;font-weight:800;color:${v.cor};margin-bottom:8px;">${v.n} <span style="background:#fff;padding:2px 8px;border-radius:10px;font-size:11px;">${list.length}</span></div>
      ${list.length === 0
        ? `<div style="font-size:11px;color:var(--muted);font-style:italic;">Nenhuma categoria aqui.</div>`
        : `<div style="display:flex;flex-direction:column;gap:4px;">${list.map((it,i) => `
            <div style="background:#fff;border-radius:6px;padding:6px 10px;font-size:12px;font-weight:600;">
              ${i+1}. ${it.nome}
            </div>`).join('')}</div>`
      }
    </div>`;
  }).join('')}
</div>

<!-- Barra fixa Salvar -->
<div id="cs-savebar" style="position:sticky;bottom:0;background:#fff;border-top:2px solid ${dirty?'#F59E0B':'#E5E7EB'};padding:12px 16px;margin:0 -16px -16px -16px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;box-shadow:0 -4px 12px rgba(0,0,0,.05);z-index:10;">
  <div id="cs-status" style="font-size:13px;font-weight:700;color:${dirty?'#92400E':'#15803D'};">
    ${dirty ? '⚠️ Você tem alterações não salvas.' : '✅ Tudo salvo e publicado.'}
  </div>
  <div style="display:flex;gap:8px;">
    <button class="btn btn-ghost btn-sm" id="btn-cs-descartar" ${dirty?'':'disabled style="opacity:.4;"'}>Descartar</button>
    <button class="btn btn-primary" id="btn-cs-salvar" ${dirty?'':'disabled style="opacity:.4;"'} style="font-weight:700;">💾 Salvar tudo no site</button>
  </div>
</div>
`}
`;
}

// ── Helper: render paginas section ──────────────────────────
function renderPaginasSection(cfg) {
  const paginas = cfg.paginas || [];
  if(!paginas.length) return `
  <div class="card" style="text-align:center;padding:48px 20px;">
    <div style="font-size:48px;margin-bottom:12px;">📄</div>
    <h3 style="margin-bottom:8px;">Nenhuma página criada ainda</h3>
    <p style="color:var(--muted);font-size:13px;margin-bottom:20px;">Crie páginas como: Sobre Nós, Política de Entrega, Termos de Uso...</p>
    <button class="btn btn-primary" onclick="ecNewPagina()">+ Criar primeira página</button>
  </div>`;
  return `
  <div style="display:flex;flex-direction:column;gap:10px;">
    ${paginas.map((p,i)=>`
    <div class="card" style="padding:14px;">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
        <div>
          <div style="font-weight:700;font-size:15px;">${p.titulo} ${(() => {
            const pos = p.position || 'footer';
            const lbl = pos==='header'?'<span style="background:#DBEAFE;color:#1E40AF;padding:1px 6px;border-radius:6px;font-size:9px;font-weight:700;margin-left:6px;">📍 TOPO</span>':pos==='both'?'<span style="background:#DCFCE7;color:#15803D;padding:1px 6px;border-radius:6px;font-size:9px;font-weight:700;margin-left:6px;">📍 TOPO + RODAPÉ</span>':pos==='hidden'?'<span style="background:#F3F4F6;color:#64748B;padding:1px 6px;border-radius:6px;font-size:9px;font-weight:700;margin-left:6px;">🔗 OCULTA</span>':'<span style="background:#FAE8E6;color:#9F1239;padding:1px 6px;border-radius:6px;font-size:9px;font-weight:700;margin-left:6px;">📍 RODAPÉ</span>';
            return lbl;
          })()}</div>
          <div style="font-size:11px;color:var(--muted);">/${p.slug||p.titulo.toLowerCase().replace(/\s/g,'-')} · ${p.ativa?'✅ Publicada':'❌ Rascunho'}</div>
        </div>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-ghost btn-sm" data-pag-edit="${i}" onclick="ecNewPagina(${i})">✏️ Editar</button>
          <button class="btn btn-ghost btn-sm" onclick="ecTogglePagina(${i})" style="color:${p.ativa?'var(--red)':'var(--leaf)'};">${p.ativa?'Ocultar':'Publicar'}</button>
          <button class="btn btn-ghost btn-sm" onclick="ecDelPagina(${i})" style="color:var(--red);">🗑️</button>
        </div>
      </div>
      ${p.conteudo?`<div style="margin-top:8px;font-size:12px;color:var(--muted);background:var(--cream);border-radius:6px;padding:8px;">${p.conteudo.substring(0,120)}${p.conteudo.length>120?'...':''}</div>`:''}
    </div>`).join('')}
  </div>`;
}

// ── EC CONFIG (migrated to API with localStorage fallback) ────
const EC_CFG_KEY = 'ec_config_v2';

export async function getEcCfg(){
  try{
    const data = await api('GET','/settings/ecommerce');
    if(data && typeof data === 'object' && Object.keys(data).length > 0){
      localStorage.setItem(EC_CFG_KEY, JSON.stringify(data));
      return data;
    }
  }catch(e){ /* fallback to localStorage */ }
  return JSON.parse(localStorage.getItem(EC_CFG_KEY)||'{}');
}

export async function saveEcCfg(cfg){
  localStorage.setItem(EC_CFG_KEY, JSON.stringify(cfg));
  try{
    // Merge com backend antes de PUT (evita apagar campos como categoriasSite)
    const remote = await api('GET','/settings/ecommerce').catch(() => null);
    const remoteValue = (remote && remote.value && typeof remote.value === 'object') ? remote.value : (remote || {});
    const merged = { ...remoteValue, ...cfg };
    await api('PUT','/settings/ecommerce', { value: merged });
    localStorage.setItem(EC_CFG_KEY, JSON.stringify(merged));
  } catch(e){ /* saved locally */ }
}

// Synchronous local-only helpers (used inside render & inline handlers)
function getEcCfgSync(){ return JSON.parse(localStorage.getItem(EC_CFG_KEY)||'{}'); }

// CRITICO: salva fazendo MERGE com a versao mais recente do backend.
// Antes: PUT enviava so o estado de localStorage → apagava campos como
// categoriasSite que sao salvos por outros fluxos (ex: btn-cs-salvar
// no main.js). Agora: 1) GET backend  2) merge com cfg local
// 3) PUT atomico. Garante que NUNCA perde dados.
function saveEcCfgSync(cfg){
  // Atualiza localStorage imediatamente (UX otimista)
  localStorage.setItem(EC_CFG_KEY, JSON.stringify(cfg));
  // Merge + persiste em background
  (async () => {
    try {
      const remote = await api('GET','/settings/ecommerce').catch(() => null);
      // Backend retorna { key, value, _id, ... } OU o value direto (varia)
      const remoteValue = (remote && remote.value && typeof remote.value === 'object')
        ? remote.value
        : (remote || {});
      // Mescla: backend remoto como base + cfg local sobrescreve campos editados
      const merged = { ...remoteValue, ...cfg };
      await api('PUT','/settings/ecommerce', { value: merged });
      // Atualiza localStorage com o resultado mesclado pra proximas leituras
      localStorage.setItem(EC_CFG_KEY, JSON.stringify(merged));
    } catch(_) { /* offline — fica so local */ }
  })();
}

// ── E-COMMERCE ADMIN  FUNCOES GLOBAIS ─────────────────────────

export function ecSaveGeral(){
  const g=id=>document.getElementById(id);
  const payments=[]; document.querySelectorAll('[data-ec-pay]').forEach(cb=>{ if(cb.checked) payments.push(cb.dataset.ecPay); });
  const features={}; document.querySelectorAll('[id^="ec-feat-"]').forEach(cb=>{ features[cb.id.replace('ec-feat-','')]=cb.checked; });
  saveEcCfgSync({...getEcCfgSync(), storeName:g('ec-store-name')?.value||'', storePhone:g('ec-phone')?.value||'', storeWpp:g('ec-wpp')?.value?.replace(/\D/g,'')||'', telAleixo:g('ec-tel-aleixo')?.value||'', telAllegro:g('ec-tel-allegro')?.value||'', storeEmail:g('ec-email')?.value||'', slogan:g('ec-slogan')?.value||'', pixKey:g('ec-pix')?.value||'', deliveryFee:parseFloat(g('ec-fee')?.value)||15, freeDeliveryAbove:parseFloat(g('ec-free')?.value)||150, deliveryTime:g('ec-prazo')?.value||'', horario:g('ec-horario')?.value||'', metaDesc:g('ec-meta')?.value||'', instagram:g('ec-ig')?.value||'', facebook:g('ec-fb')?.value||'', payments, features});
  toast('✅ Configurações salvas!'); render();
}

export function ecSaveHorario(){
  const dias=[...document.querySelectorAll('.ec-dia-check:checked')].map(c=>c.dataset.dia);
  const turnos=[...document.querySelectorAll('.ec-turno-check:checked')].map(c=>c.dataset.turno);
  if(!dias.length) return toast('⚠️ Selecione ao menos um dia',true);
  if(!turnos.length) return toast('⚠️ Selecione ao menos um turno',true);
  const g=id=>document.getElementById(id);
  saveEcCfgSync({...getEcCfgSync(), diasEntrega:dias, turnosEntrega:turnos, horaAbre:g('ec-hora-abre')?.value||'08:00', horaFecha:g('ec-hora-fecha')?.value||'20:00', prazoMsg:g('ec-prazo-msg')?.value||''});
  toast('✅ Horários salvos!'); render();
}

export function ecSavePagamentos(){
  const g=id=>document.getElementById(id);
  const payments=[];
  if(g('ec-pay-pix')?.checked) payments.push('Pix');
  if(g('ec-pay-credito')?.checked) payments.push('Cartão de Crédito');
  if(g('ec-pay-debito')?.checked) payments.push('Cartão de Débito');
  if(g('ec-pay-entrega')?.checked) payments.push('Pagar na Entrega');
  saveEcCfgSync({...getEcCfgSync(), payments, pixKey:g('ec-pix-key')?.value||'', pixTipo:g('ec-pix-tipo')?.value||'E-mail', pixNome:g('ec-pix-nome')?.value||'', mpAtivo:g('ec-pay-mp')?.checked||false, mpPublicKey:g('ec-mp-pubkey')?.value||'', mpAccessToken:g('ec-mp-token')?.value||'', linkPagAtivo:g('ec-pay-link')?.checked||false, linkPagUrl:g('ec-link-pag')?.value||''});
  toast('✅ Pagamentos salvos!'); render();
}

export function ecSaveBanners(){
  const count=document.querySelectorAll('[id^="bn-title-"]').length; const banners=[];
  for(let i=0;i<count;i++){
    const t=document.getElementById(`bn-title-${i}`)?.value?.trim()||'';
    if(!t) continue;
    banners.push({
      icon:document.getElementById(`bn-icon-${i}`)?.value||'🌸',
      title:t,
      sub:document.getElementById(`bn-sub-${i}`)?.value||'',
      cta:document.getElementById(`bn-cta-${i}`)?.value||'Ver mais',
      cat:document.getElementById(`bn-cat-${i}`)?.value||'',
      image:document.getElementById(`bn-img-${i}`)?.value?.trim()||'',
    });
  }
  saveEcCfgSync({...getEcCfgSync(),banners}); toast('✅ Banners salvos!'); render();
}

export function ecAddBanner(){ const cfg=getEcCfgSync(); const b=cfg.banners||[{icon:'🌹',title:'Flores que falam por você',sub:'Buquês para todos os momentos',cta:'Ver Catálogo',cat:''}]; b.push({icon:'🌸',title:'Novo Banner',sub:'Descrição',cta:'Saiba mais',cat:''}); saveEcCfgSync({...cfg,banners:b}); render(); }

export function moveBanner(i,d){ const cfg=getEcCfgSync(); const b=cfg.banners||[]; const ni=i+d; if(ni<0||ni>=b.length) return; [b[i],b[ni]]=[b[ni],b[i]]; saveEcCfgSync({...cfg,banners:b}); render(); }

export function removeBanner(i){ const cfg=getEcCfgSync(); saveEcCfgSync({...cfg,banners:(cfg.banners||[]).filter((_,j)=>j!==i)}); render(); }

export async function ecAtivarTodos(){ S.loading=true; render(); for(const p of S.products){ if(!p.activeOnSite){ await PUT('/products/'+p._id,{...p,activeOnSite:true}).catch(()=>PATCH('/products/'+p._id,{activeOnSite:true}).catch(()=>{})); S.products=S.products.map(x=>x._id===p._id?{...x,activeOnSite:true}:x); } } S.loading=false; render(); toast('✅ Todos ativados!'); }

export async function ecDesativarTodos(){ S.loading=true; render(); for(const p of S.products){ if(p.activeOnSite){ await PUT('/products/'+p._id,{...p,activeOnSite:false}).catch(()=>PATCH('/products/'+p._id,{activeOnSite:false}).catch(()=>{})); S.products=S.products.map(x=>x._id===p._id?{...x,activeOnSite:false}:x); } } S.loading=false; render(); toast('✅ Todos desativados!'); }

export async function ecSaveProds(){ const cfg=getEcCfgSync(); const featured=[]; let changed=0; for(const cb of document.querySelectorAll('.ec-prod-toggle')){ const pid=cb.dataset.pid; const p=S.products.find(x=>x._id===pid); if(!p||p.activeOnSite===cb.checked) continue; await PUT('/products/'+pid,{...p,activeOnSite:cb.checked}).catch(()=>PATCH('/products/'+pid,{activeOnSite:cb.checked}).catch(()=>{})); S.products=S.products.map(x=>x._id===pid?{...x,activeOnSite:cb.checked}:x); changed++; } document.querySelectorAll('.ec-prod-featured').forEach(cb=>{ if(cb.checked) featured.push(cb.dataset.pid); }); saveEcCfgSync({...cfg,featured}); render(); toast(`✅ ${changed} produto(s) atualizados!`); }

export function ecSaveCores(){ const g=id=>document.getElementById(id); saveEcCfgSync({...getEcCfgSync(), primaryColor:g('ec-color-primaryColor')?.value||'#8B2252', primaryLight:g('ec-color-primaryLight')?.value||'#C8436A', accentColor:g('ec-color-accentColor')?.value||'#F4A7B9', bgColor:g('ec-color-bgColor')?.value||'#F8F4F2', textColor:g('ec-color-textColor')?.value||'#1A0A10', gridStyle:g('ec-grid-style')?.value||'padrao', headerStyle:g('ec-header-style')?.value||'fixo', logoPos:g('ec-logo-pos')?.value||'esquerda'}); toast('✅ Cores salvas!'); render(); }

export function ecResetCores(){ const {primaryColor,primaryLight,accentColor,bgColor,textColor,...rest}=getEcCfgSync(); saveEcCfgSync(rest); render(); toast('↩ Cores restauradas!'); }

export function ecSaveLayout(){ const g=id=>document.getElementById(id); saveEcCfgSync({...getEcCfgSync(), gridStyle:g('ec-grid-style')?.value||'padrao', headerStyle:g('ec-header-style')?.value||'fixo', logoPos:g('ec-logo-pos')?.value||'esquerda'}); toast('✅ Layout salvo!'); render(); }

export function applyPalette(p,s,a){ saveEcCfgSync({...getEcCfgSync(),primaryColor:p,primaryLight:s,accentColor:a}); toast('✅ Paleta aplicada!'); render(); }

export function ecSaveRedes(){
  const redes=['instagram','facebook','tiktok','youtube','pinterest','whatsapp','telegram','twitter'];
  const social={};
  const socialPos={};
  redes.forEach(r=>{
    const url=document.getElementById(`ec-social-${r}`)?.value?.trim();
    const pos=document.getElementById(`ec-social-pos-${r}`)?.value || 'footer';
    if(url){
      social[r]=url;
      socialPos[r]=pos;
    }
  });
  saveEcCfgSync({...getEcCfgSync(),social,socialPos});
  toast('✅ Redes salvas!'); render();
}

export function ecNewPagina(idx=null){
  const cfg=getEcCfgSync();
  const pags=cfg.paginas||[];
  const pag=idx!==null?pags[idx]:{titulo:'',slug:'',conteudo:'',ativa:true,position:'footer'};
  const pos = pag.position || 'footer';
  S._modal=`<div class="mo" onclick="if(event.target===this){S._modal='';render();}">
    <div class="mo-box" style="max-width:580px;max-height:92vh;overflow-y:auto;" onclick="event.stopPropagation()">
      <div style="font-family:'Playfair Display',serif;font-size:17px;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--border);">📄 ${idx!==null?'Editar':'Nova'} Página</div>
      <div class="fg" style="margin-bottom:10px;"><label class="fl">Título *</label>
        <input class="fi" id="pag-titulo" value="${pag.titulo||''}" placeholder="Ex: Sobre Nós" oninput="const s=document.getElementById('pag-slug');if(s&&!s.value)s.value=this.value.toLowerCase().replace(/\\s+/g,'-').replace(/[^\\w-]/g,'')"/></div>
      <div class="fg" style="margin-bottom:10px;"><label class="fl">Slug (URL)</label>
        <input class="fi" id="pag-slug" value="${pag.slug||''}" placeholder="sobre-nos"/></div>
      <div class="fg" style="margin-bottom:10px;">
        <label class="fl">📍 Onde aparece no site</label>
        <select class="fi" id="pag-position">
          <option value="footer" ${pos==='footer'?'selected':''}>Apenas no Rodapé</option>
          <option value="header" ${pos==='header'?'selected':''}>Apenas no Topo (menu)</option>
          <option value="both"   ${pos==='both'?'selected':''}>Topo + Rodapé</option>
          <option value="hidden" ${pos==='hidden'?'selected':''}>Não exibir (apenas URL direta)</option>
        </select>
      </div>
      <div class="fg" style="margin-bottom:14px;"><label class="fl">Conteúdo</label>
        <textarea class="fi" id="pag-conteudo" rows="8" style="resize:vertical;">${pag.conteudo||''}</textarea></div>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:14px;cursor:pointer;">
        <input type="checkbox" id="pag-ativa" ${pag.ativa!==false?'checked':''} style="accent-color:var(--primary);"/> Página publicada</label>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-primary" style="flex:1;" onclick="ecSavePagina(${idx!==null?idx:'null'})">💾 Salvar</button>
        <button class="btn btn-ghost" onclick="S._modal='';render()">Cancelar</button>
      </div>
    </div></div>`;
  render();
}

export function ecSavePagina(idx){
  const t=document.getElementById('pag-titulo')?.value?.trim();
  if(!t) return toast('❌ Título obrigatório',true);
  const cfg=getEcCfgSync();
  const pags=[...(cfg.paginas||[])];
  const nova={
    titulo:t,
    slug:document.getElementById('pag-slug')?.value?.trim()||t.toLowerCase().replace(/\s+/g,'-'),
    conteudo:document.getElementById('pag-conteudo')?.value||'',
    ativa:document.getElementById('pag-ativa')?.checked??true,
    position: document.getElementById('pag-position')?.value || 'footer',
  };
  if(idx!==null&&idx!==undefined&&idx!=='null') pags[parseInt(idx)]=nova;
  else pags.push(nova);
  saveEcCfgSync({...cfg,paginas:pags});
  S._modal=''; render();
  toast('✅ Página salva!');
}

export function ecTogglePagina(i){ const cfg=getEcCfgSync(); const pags=[...(cfg.paginas||[])]; pags[i]={...pags[i],ativa:!pags[i].ativa}; saveEcCfgSync({...cfg,paginas:pags}); render(); toast(pags[i].ativa?'✅ Publicada!':'❌ Ocultada'); }

export function ecDelPagina(i){ if(!confirm('Excluir esta página?')) return; const cfg=getEcCfgSync(); saveEcCfgSync({...cfg,paginas:(cfg.paginas||[]).filter((_,j)=>j!==i)}); render(); toast('🗑️ Excluída'); }

// ── RENDER ─────────────────────────────────────────────────────
export function renderEcommerce(){
  const cfg = getEcCfgSync();
  const banners = cfg.banners || [
    {icon:'🌹', title:'Flores que falam por você', sub:'Buquês, arranjos e muito mais para cada momento especial', cta:'Ver Catálogo', cat:''},
    {icon:'💐', title:'Entrega rápida em Manaus', sub:'Pediu, chegou! Entregamos no mesmo dia em toda a cidade', cta:'Pedir Agora', cat:''},
    {icon:'🌸', title:'Presenteie com flores', sub:'Aniversário, casamento, formatura — temos o arranjo perfeito', cta:'Explorar', cat:''},
  ];
  const prods = S.products.filter(p=>p.activeOnSite);
  const allProds = S.products;
  const tab = S._ecTab||'geral';

  return`
<div class="card" style="background:var(--petal);border:1.5px solid var(--border);margin-bottom:16px;">
  <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
    <div>
      <div style="font-family:'Playfair Display',serif;font-size:20px;margin-bottom:4px;color:var(--primary);">🛒 Painel do E-commerce</div>
      <div style="font-size:13px;color:var(--muted);">Gerencie sua loja virtual — alterações refletem em tempo real</div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <a href="https://floriculturalacoseternos.com.br/ecommerce.html" target="_blank"
         style="background:rgba(255,255,255,.2);color:#fff;border:1px solid rgba(255,255,255,.4);padding:8px 16px;border-radius:8px;font-size:12px;font-weight:600;display:inline-flex;align-items:center;gap:6px;">
        🌐 Ver Loja
      </a>
      <div style="background:rgba(255,255,255,.15);border-radius:8px;padding:8px 14px;font-size:12px;">
        ✅ <strong>${prods.length}</strong> produtos ativos na loja
      </div>
    </div>
  </div>
</div>

<!-- ABAS -->
<div class="tabs" style="margin-bottom:16px;flex-wrap:wrap;">
  ${[
    {k:'site',l:'🌐 Site (Avançado)'},
    {k:'geral',l:'⚙️ Configurações'},
    {k:'pagamentos',l:'💳 Pagamentos'},
    {k:'paginas',l:'📄 Páginas'},
    {k:'categorias',l:'🏷️ Categorias do Site'},
    {k:'redes',l:'📱 Redes Sociais'},
    {k:'banners',l:'🖼️ Banners'},
    {k:'cores',l:'🎨 Aparência'},
    {k:'integracoes',l:'🔌 Integrações'},
    {k:'preview',l:'👁️ Preview'},
  ].map(t=>`<button class="tab ${tab===t.k?'active':''}" onclick="S._ecTab='${t.k}';render()">${t.l}</button>`).join('')}
  <div style="font-size:11px;color:var(--muted);background:#FAE8E6;padding:8px 14px;border-radius:8px;margin-left:6px;">
    🌸 <strong>Produtos do site:</strong> editados em <a href="javascript:setPage('produtos')" style="color:#9F1239;font-weight:700;">Produtos</a> · marque <em>"Aparecer no E-commerce"</em>
  </div>
</div>

<!-- ══ ABA SITE (configuracoes avancadas do e-commerce) ══════ -->
${tab==='site'?`
<div class="card">
  <div class="card-title">🌐 Configurações do Site</div>
  <div style="font-size:11px;color:var(--muted);margin-bottom:14px;">Tudo que controla o comportamento do site público (floriculturalacoseternos.com.br).</div>

  <!-- MODO -->
  <div style="background:#FAF7F5;border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:12px;">
    <div style="font-weight:700;font-size:12px;margin-bottom:8px;">⚙️ Modo de Operação</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
      <label style="display:flex;flex-direction:column;background:#fff;border:2px solid transparent;border-radius:8px;padding:10px;cursor:pointer;" id="ec2-mode-cat-label">
        <div style="display:flex;align-items:center;gap:6px;"><input type="radio" name="ec2-mode" value="catalogo" id="ec2-mode-cat" style="accent-color:#C8736A;"/><strong style="font-size:12px;">📚 Catálogo Online</strong></div>
        <div style="font-size:10px;color:var(--muted);margin-top:4px;">Vitrine + WhatsApp. Sem checkout/pagamento.</div>
      </label>
      <label style="display:flex;flex-direction:column;background:#fff;border:2px solid transparent;border-radius:8px;padding:10px;cursor:pointer;" id="ec2-mode-loja-label">
        <div style="display:flex;align-items:center;gap:6px;"><input type="radio" name="ec2-mode" value="loja" id="ec2-mode-loja" style="accent-color:#C8736A;"/><strong style="font-size:12px;">🛒 Loja Completa</strong></div>
        <div style="font-size:10px;color:var(--muted);margin-top:4px;">Cliente compra direto no site (Pix/Cartão via MP).</div>
      </label>
    </div>
  </div>

  <label style="display:flex;align-items:center;gap:10px;background:#fff;border:1px solid var(--border);border-radius:10px;padding:10px;margin-bottom:10px;cursor:pointer;">
    <input type="checkbox" id="ec2-accepting" style="width:18px;height:18px;accent-color:#15803D;"/>
    <div style="flex:1;">
      <div style="font-weight:700;font-size:13px;">🟢 Aceitando pedidos online</div>
      <div style="font-size:10px;color:var(--muted);">Desligue para pausar (loja mostra mensagem de fechado)</div>
    </div>
  </label>

  <div class="fr2" style="gap:8px;">
    <div class="fg"><label class="fl">Frete fixo (R$)</label>
      <input class="fi" type="number" step="0.01" id="ec2-delivery-fee" placeholder="15.00"/></div>
    <div class="fg"><label class="fl">Frete grátis acima de (R$)</label>
      <input class="fi" type="number" step="0.01" id="ec2-free-above" placeholder="0 = desativado"/></div>
  </div>
  <div class="fg"><label class="fl">Pedido mínimo (R$)</label>
    <input class="fi" type="number" step="0.01" id="ec2-min-order" placeholder="0 = sem mínimo"/></div>
  <div class="fg"><label class="fl">Mensagem do frete (visível no checkout)</label>
    <input class="fi" id="ec2-shipping-note" placeholder="Entrega em toda Manaus. Taxa fixa."/></div>
  <div class="fg"><label class="fl">Mensagem quando fechado</label>
    <input class="fi" id="ec2-closed-msg" placeholder="No momento estamos fora do horário online."/></div>
  <div class="fg"><label class="fl">Mensagem padrão WhatsApp ao pedir</label>
    <input class="fi" id="ec2-wpp-order-msg" placeholder="Olá! Fiquei interessado(a) no(s) produto(s) abaixo..."/></div>

  <!-- Turnos por dia da semana -->
  <div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:10px;margin-top:8px;margin-bottom:10px;">
    <div style="font-weight:700;font-size:12px;margin-bottom:8px;">🕐 Turnos de entrega por dia da semana</div>
    <div style="font-size:10px;color:var(--muted);margin-bottom:10px;">Marque quais turnos estão disponíveis em cada dia. Site mostra apenas os marcados.</div>
    <div style="overflow-x:auto;">
      <table style="width:100%;font-size:11px;border-collapse:collapse;">
        <thead><tr style="background:#FAF7F5;">
          <th style="padding:6px;text-align:left;">Dia</th>
          <th style="padding:6px;text-align:center;">🌅 Manhã<br><span style="font-size:9px;color:var(--muted);font-weight:400;">08:00–12:30</span></th>
          <th style="padding:6px;text-align:center;">☀️ Tarde<br><span style="font-size:9px;color:var(--muted);font-weight:400;">12:30–18:00</span></th>
          <th style="padding:6px;text-align:center;">🌙 Noite<br><span style="font-size:9px;color:var(--muted);font-weight:400;">18:00–19:00</span></th>
        </tr></thead>
        <tbody>
          ${[
            {d:0, l:'Domingo'},{d:1, l:'Segunda'},{d:2, l:'Terça'},{d:3, l:'Quarta'},
            {d:4, l:'Quinta'},{d:5, l:'Sexta'},{d:6, l:'Sábado'},
          ].map(w => `<tr style="border-bottom:1px solid #F1F5F9;">
            <td style="padding:6px;font-weight:600;">${w.l}</td>
            <td style="text-align:center;"><input type="checkbox" data-turno-day="${w.d}" data-turno="manha" style="width:18px;height:18px;accent-color:#15803D;cursor:pointer;"/></td>
            <td style="text-align:center;"><input type="checkbox" data-turno-day="${w.d}" data-turno="tarde" style="width:18px;height:18px;accent-color:#15803D;cursor:pointer;"/></td>
            <td style="text-align:center;"><input type="checkbox" data-turno-day="${w.d}" data-turno="noite" style="width:18px;height:18px;accent-color:#15803D;cursor:pointer;"/></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  </div>

  <!-- Datas bloqueadas -->
  <div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:10px;margin-top:8px;margin-bottom:10px;">
    <div style="font-weight:700;font-size:12px;margin-bottom:6px;">📅 Datas bloqueadas para entrega</div>
    <div style="display:flex;gap:6px;margin-bottom:8px;">
      <input type="date" id="ec2-block-date-input" class="fi" style="flex:1;font-size:12px;"/>
      <button type="button" id="btn-add-blocked-date2" class="btn btn-primary btn-sm">+ Bloquear</button>
    </div>
    <div id="ec2-blocked-dates-list" style="display:flex;flex-wrap:wrap;gap:5px;min-height:24px;"></div>
  </div>

  <button class="btn btn-primary" id="btn-save-ecommerce2" style="width:100%;margin-top:6px;">💾 Salvar Configurações</button>
  <div id="ecommerce2-status" style="margin-top:6px;font-size:11px;text-align:center;color:var(--muted);"></div>
</div>
` : ''}

<!-- ══ ABA INTEGRAÇÕES (Google, Meta, MP, Facebook Feed) ══════ -->
${tab==='integracoes'?`
<div class="card">
  <div class="card-title">🔌 Integrações e APIs</div>
  <div style="font-size:11px;color:var(--muted);margin-bottom:14px;">Tokens secretos ficam no servidor. IDs públicos são lidos pelo site automaticamente.</div>

  <div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:10px;">
    <div style="font-weight:700;font-size:13px;color:#4285F4;margin-bottom:8px;">📊 Google</div>
    <div class="fr2" style="gap:8px;">
      <div class="fg"><label class="fl">Google Analytics 4 ID</label>
        <input class="fi" id="int2-ga-id" placeholder="G-XXXXXXXXXX"/></div>
      <div class="fg"><label class="fl">Tag Manager ID</label>
        <input class="fi" id="int2-gtm-id" placeholder="GTM-XXXXXXX"/></div>
    </div>
    <div class="fg"><label class="fl">Google Ads — ID de Conversão</label>
      <input class="fi" id="int2-gads-id" placeholder="AW-XXXXXXXXX/yyyyyyy"/></div>
  </div>

  <div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:10px;">
    <div style="font-weight:700;font-size:13px;color:#1877F2;margin-bottom:8px;">📘 Meta (Facebook / Instagram)</div>
    <div class="fr2" style="gap:8px;">
      <div class="fg"><label class="fl">Meta Pixel ID</label>
        <input class="fi" id="int2-meta-pixel" placeholder="123456789012345"/></div>
      <div class="fg"><label class="fl">Conversions API Token <span style="font-size:9px;color:var(--red);">(secreto)</span></label>
        <input class="fi" id="int2-meta-token" type="password" placeholder="EAAB..."/></div>
    </div>
    <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;padding:8px 10px;margin-top:8px;">
      <div style="font-size:11px;color:#1E40AF;font-weight:700;margin-bottom:4px;">🛍️ Facebook / Instagram Shopping</div>
      <div style="font-size:10px;color:#3730A3;">URL do feed (cole no Catalog Manager):</div>
      <input readonly value="https://florevita-backend-2-0.onrender.com/api/public/feed/facebook.xml" style="width:100%;margin-top:4px;padding:5px 8px;border:1px solid #BFDBFE;border-radius:5px;background:#fff;font-size:10px;font-family:monospace;color:#1E40AF;cursor:pointer;" onclick="this.select();document.execCommand('copy');alert('URL copiada')"/>
    </div>
  </div>

  <div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:10px;">
    <div style="font-weight:700;font-size:13px;color:#009EE3;margin-bottom:8px;">💳 Mercado Pago</div>
    <div class="fg"><label class="fl">Access Token <span style="font-size:9px;color:var(--red);">(secreto)</span></label>
      <input class="fi" id="int2-mp-token" type="password" placeholder="APP_USR-..."/></div>
    <div class="fg"><label class="fl">Public Key</label>
      <input class="fi" id="int2-mp-public" placeholder="APP_USR-..."/></div>
    <div style="font-size:10px;color:var(--muted);background:#F0F9FF;padding:6px 8px;border-radius:6px;">
      ℹ️ Webhook automático: <code>https://florevita-backend-2-0.onrender.com/api/public/mp/webhook</code>
    </div>
  </div>

  <div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:10px;">
    <div style="font-weight:700;font-size:13px;color:#25D366;margin-bottom:8px;">💬 WhatsApp</div>
    <div class="fg"><label class="fl">Número (com DDI+DDD, sem espaços)</label>
      <input class="fi" id="int2-wpp-num" placeholder="5592993002433"/></div>
    <div class="fg"><label class="fl">Mensagem padrão</label>
      <input class="fi" id="int2-wpp-msg" placeholder="Olá! Quero comprar 🌹"/></div>
  </div>

  <button class="btn btn-primary" id="btn-save-integracoes2" style="width:100%;">💾 Salvar Integrações</button>
  <div id="integracoes2-status" style="margin-top:6px;font-size:11px;text-align:center;color:var(--muted);"></div>
</div>
` : ''}

<!-- ══ ABA GERAL ══════════════════════════════════════════════ -->
${tab==='geral'?`
<div class="g2" style="gap:16px;">
  <div class="card">
    <div class="card-title">🏪 Dados da Loja</div>
    <div class="fg" style="margin-bottom:10px;"><label class="fl">Nome da loja</label>
      <input class="fi" id="ec-store-name" value="${cfg.storeName||'Laços Eternos Floricultura'}"/></div>
    <div class="fr2">
      <div class="fg"><label class="fl">Telefone principal</label>
        <input class="fi" id="ec-phone" value="${cfg.storePhone||'(92) 99300-2433'}"/></div>
      <div class="fg"><label class="fl">WhatsApp (só números)</label>
        <input class="fi" id="ec-wpp" value="${cfg.storeWpp||'5592993002433'}" placeholder="5592999999999"/></div>
    </div>
    <div class="fr2">
      <div class="fg"><label class="fl">📍 Tel. Novo Aleixo</label>
        <input class="fi" id="ec-tel-aleixo" value="${cfg.telAleixo||'(92) 99530-4145'}"/></div>
      <div class="fg"><label class="fl">📍 Tel. Allegro Mall</label>
        <input class="fi" id="ec-tel-allegro" value="${cfg.telAllegro||'(92) 99406-4132'}"/></div>
    </div>
    <div class="fg" style="margin-bottom:10px;"><label class="fl">E-mail de contato</label>
      <input class="fi" id="ec-email" value="${cfg.storeEmail||'contato@floriculturalacoseternos.com.br'}"/></div>
    <div class="fg"><label class="fl">Slogan / frase da home</label>
      <input class="fi" id="ec-slogan" value="${cfg.slogan||'Flores para todos os momentos especiais'}"/></div>
  </div>

  <div class="card">
    <div class="card-title">💳 Pagamento & Entrega</div>
    <div class="fg" style="margin-bottom:10px;"><label class="fl">🔵 Chave Pix</label>
      <input class="fi" id="ec-pix" value="${cfg.pixKey||'floriculturalacoseternos@gmail.com'}"/></div>
    <div class="fr2">
      <div class="fg"><label class="fl">🚚 Taxa de entrega (R$)</label>
        <input class="fi" type="number" id="ec-fee" value="${cfg.deliveryFee||15}" min="0" step="0.50"/></div>
      <div class="fg"><label class="fl">🎁 Frete grátis acima de (R$)</label>
        <input class="fi" type="number" id="ec-free" value="${cfg.freeDeliveryAbove||150}" min="0"/></div>
    </div>
    <div class="fr2">
      <div class="fg"><label class="fl">Prazo entrega (ex: mesmo dia)</label>
        <input class="fi" id="ec-prazo" value="${cfg.deliveryTime||'Mesmo dia'}"/></div>
      <div class="fg"><label class="fl">Horário atendimento</label>
        <input class="fi" id="ec-horario" value="${cfg.horario||'Seg–Sáb: 8h–20h'}"/></div>
    </div>
    <div style="margin-top:12px;">
      <div class="fl" style="font-size:11px;margin-bottom:8px;">Formas de pagamento aceitas:</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${['Pix','Cartão de Crédito','Cartão de Débito','Pagar na Entrega'].map(p=>`
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;">
          <input type="checkbox" ${(cfg.payments||['Pix','Cartão de Crédito','Cartão de Débito','Pagar na Entrega']).includes(p)?'checked':''} data-ec-pay="${p}"/>
          ${p}</label>`).join('')}
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-title">📢 SEO & Redes Sociais</div>
    <div class="fg" style="margin-bottom:10px;"><label class="fl">Meta description (Google)</label>
      <textarea class="fi" id="ec-meta" rows="2">${cfg.metaDesc||'Floricultura Laços Eternos — Buquês, arranjos e flores para todas as ocasiões em Manaus. Entrega rápida e qualidade garantida.'}</textarea></div>
    <div class="fr2">
      <div class="fg"><label class="fl">Instagram</label>
        <input class="fi" id="ec-ig" value="${cfg.instagram||'@floriculturalacoseternos'}" placeholder="@seuinstagram"/></div>
      <div class="fg"><label class="fl">Facebook</label>
        <input class="fi" id="ec-fb" value="${cfg.facebook||''}" placeholder="facebook.com/suapagina"/></div>
    </div>
  </div>

  <div class="card">
    <div class="card-title">⚙️ Funcionalidades</div>
    <div style="display:flex;flex-direction:column;gap:10px;">
      ${[
        {k:'showSearch',l:'🔍 Mostrar barra de busca',d:true},
        {k:'showFilters',l:'🔽 Mostrar filtros no catálogo',d:true},
        {k:'showUpsell',l:'🔥 Mostrar seção Mais Vendidos',d:true},
        {k:'showReviews',l:'⭐ Mostrar avaliações (em breve)',d:false},
        {k:'showStock',l:'📦 Mostrar quantidade em estoque',d:false},
        {k:'allowCardMsg',l:'💌 Permitir mensagem no cartão',d:true},
        {k:'requireLogin',l:'🔐 Exigir cadastro para comprar',d:false},
      ].map(f=>`<label style="display:flex;align-items:center;justify-content:space-between;padding:8px;background:var(--cream);border-radius:8px;cursor:pointer;">
        <span style="font-size:13px;">${f.l}</span>
        <input type="checkbox" id="ec-feat-${f.k}" ${(cfg.features?.[f.k]??f.d)?'checked':''}/>
      </label>`).join('')}
    </div>
  </div>
</div>

<div style="text-align:center;margin-top:16px;">
  <button class="btn btn-primary" onclick="ecSaveGeral()" style="padding:12px 40px;font-size:15px;">💾 Salvar Configurações</button>
</div>
`:''}

<!-- ══ ABA PAGAMENTOS ════════════════════════════════════════ -->
${tab==='pagamentos'?`
<div class="g2" style="gap:16px;">
  <div class="card">
    <div class="card-title">💳 Formas de Pagamento</div>
    <p style="font-size:12px;color:var(--muted);margin-bottom:16px;">Configure quais métodos de pagamento estarão disponíveis na loja.</p>

    <!-- PIX -->
    <div style="border:1.5px solid ${(cfg.payments||[]).includes('Pix')||cfg.pixAtivo!==false?'var(--primary)':'var(--border)'};border-radius:10px;padding:14px;margin-bottom:12px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:${(cfg.payments||[]).includes('Pix')||cfg.pixAtivo!==false?'12':'0'}px;">
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-weight:700;">
          <input type="checkbox" id="ec-pay-pix" ${(cfg.payments||['Pix']).includes('Pix')?'checked':''} style="accent-color:var(--primary);width:16px;height:16px;"/>
          🔵 Pix
        </label>
        <span style="font-size:11px;color:var(--leaf);font-weight:600;">Aprovação imediata</span>
      </div>
      <div class="fr2" style="gap:8px;">
        <div class="fg"><label class="fl">Chave Pix *</label>
          <input class="fi" id="ec-pix-key" value="${cfg.pixKey||'floriculturalacoseternos@gmail.com'}" placeholder="CPF, CNPJ, e-mail ou celular"/></div>
        <div class="fg"><label class="fl">Tipo da chave</label>
          <select class="fi" id="ec-pix-tipo">
            ${['E-mail','Celular','CPF','CNPJ','Chave Aleatória'].map(t=>`<option ${(cfg.pixTipo||'E-mail')===t?'selected':''}>${t}</option>`).join('')}
          </select></div>
      </div>
      <div class="fg" style="margin-top:8px;"><label class="fl">Nome para exibir no Pix</label>
        <input class="fi" id="ec-pix-nome" value="${cfg.pixNome||'Laços Eternos Floricultura'}" placeholder="Nome do beneficiário"/></div>
    </div>

    <!-- MERCADO PAGO -->
    <div style="border:1.5px solid ${cfg.mpAtivo?'var(--primary)':'var(--border)'};border-radius:10px;padding:14px;margin-bottom:12px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:${cfg.mpAtivo?'12':'0'}px;">
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-weight:700;">
          <input type="checkbox" id="ec-pay-mp" ${cfg.mpAtivo?'checked':''} style="accent-color:var(--primary);width:16px;height:16px;"/>
          🟡 Mercado Pago
        </label>
        <span style="font-size:11px;color:var(--muted);">Cartão, Pix, boleto</span>
      </div>
      ${cfg.mpAtivo?`
      <div class="fg" style="margin-bottom:8px;"><label class="fl">Public Key (chave pública)</label>
        <input class="fi" id="ec-mp-pubkey" value="${cfg.mpPublicKey||''}" placeholder="APP_USR-..."/></div>
      <div class="fg"><label class="fl">Access Token (chave privada)</label>
        <input class="fi" id="ec-mp-token" type="password" value="${cfg.mpAccessToken||''}" placeholder="APP_USR-..."/>
        <div style="font-size:10px;color:var(--muted);margin-top:3px;">🔒 Salvo com segurança no localStorage</div></div>
      <div style="margin-top:10px;background:#FFF8E1;border-radius:8px;padding:10px;font-size:11px;color:#8B6914;">
        📌 Para obter as chaves: mercadopago.com.br → Seu Negócio → Credenciais
      </div>`:''}
    </div>

    <!-- CARTAO CREDITO/DEBITO -->
    <div style="border:1.5px solid ${(cfg.payments||['Pix','Cartão de Crédito','Cartão de Débito','Pagar na Entrega']).includes('Cartão de Crédito')?'var(--primary)':'var(--border)'};border-radius:10px;padding:14px;margin-bottom:12px;">
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-weight:700;">
        <input type="checkbox" id="ec-pay-credito" ${(cfg.payments||['Pix','Cartão de Crédito']).includes('Cartão de Crédito')?'checked':''} style="accent-color:var(--primary);width:16px;height:16px;"/>
        💳 Cartão de Crédito
      </label>
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-weight:700;margin-top:10px;">
        <input type="checkbox" id="ec-pay-debito" ${(cfg.payments||['Pix','Cartão de Débito']).includes('Cartão de Débito')?'checked':''} style="accent-color:var(--primary);width:16px;height:16px;"/>
        💳 Cartão de Débito
      </label>
    </div>

    <!-- PAGAR NA ENTREGA -->
    <div style="border:1.5px solid ${(cfg.payments||['Pagar na Entrega']).includes('Pagar na Entrega')?'var(--primary)':'var(--border)'};border-radius:10px;padding:14px;margin-bottom:12px;">
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-weight:700;">
        <input type="checkbox" id="ec-pay-entrega" ${(cfg.payments||['Pagar na Entrega']).includes('Pagar na Entrega')?'checked':''} style="accent-color:var(--primary);width:16px;height:16px;"/>
        🏠 Pagar na Entrega
      </label>
    </div>

    <!-- LINK DE PAGAMENTO -->
    <div style="border:1.5px solid ${cfg.linkPagAtivo?'var(--primary)':'var(--border)'};border-radius:10px;padding:14px;margin-bottom:16px;">
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-weight:700;">
        <input type="checkbox" id="ec-pay-link" ${cfg.linkPagAtivo?'checked':''} style="accent-color:var(--primary);width:16px;height:16px;"/>
        🔗 Link de Pagamento
      </label>
      ${cfg.linkPagAtivo?`<div class="fg" style="margin-top:10px;"><label class="fl">URL do link de pagamento</label>
        <input class="fi" id="ec-link-pag" value="${cfg.linkPagUrl||''}" placeholder="https://mpago.la/..."/></div>`:''}
    </div>

    <button class="btn btn-primary" onclick="ecSavePagamentos()" style="width:100%;padding:12px;">💾 Salvar Pagamentos</button>
  </div>

  <div class="card">
    <div class="card-title">ℹ️ Guia de configuração</div>
    <div style="font-size:13px;color:var(--muted);line-height:1.8;">
      <div style="margin-bottom:12px;"><strong>🔵 Pix</strong><br/>O mais simples. O cliente copia a chave e paga pelo app do banco. Você confirma o comprovante via WhatsApp.</div>
      <div style="margin-bottom:12px;"><strong>🟡 Mercado Pago</strong><br/>Aceita cartão, Pix e boleto. Crie sua conta em mercadopago.com.br, acesse Credenciais e copie as chaves.</div>
      <div style="margin-bottom:12px;"><strong>💳 Cartão</strong><br/>Requer integração com Mercado Pago ou outra plataforma. Ative o Mercado Pago para habilitar.</div>
      <div><strong>🏠 Pagar na Entrega</strong><br/>O cliente paga ao receber. Aceita dinheiro, cartão ou Pix no ato da entrega.</div>
    </div>
  </div>
</div>
`:''}

<!-- ══ ABA PAGINAS ════════════════════════════════════════════ -->
${tab==='paginas'?`
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px;">
  <div>
    <h3 style="font-weight:700;">📄 Páginas do Site</h3>
    <p style="font-size:13px;color:var(--muted);">Crie e edite páginas personalizadas para sua loja</p>
  </div>
  <button class="btn btn-primary" onclick="ecNewPagina()">+ Nova Página</button>
</div>

${renderPaginasSection(cfg)}
`:''}

<!-- ══ ABA CATEGORIAS DO SITE ════════════════════════════════ -->
${tab==='categorias'?renderCategoriasSiteSection(cfg):''}

<!-- ══ ABA REDES SOCIAIS ══════════════════════════════════════ -->
${tab==='redes'?`
<div class="g2" style="gap:16px;">
  <div class="card">
    <div class="card-title">📱 Redes Sociais</div>
    <p style="font-size:12px;color:var(--muted);margin-bottom:16px;">Ícones e links aparecerão no rodapé e no perfil da loja.</p>
    <div style="display:flex;flex-direction:column;gap:12px;">
      ${[
        {k:'instagram',i:'📷',l:'Instagram',p:'https://instagram.com/seuinstagram'},
        {k:'facebook',i:'📘',l:'Facebook',p:'https://facebook.com/suapagina'},
        {k:'tiktok',i:'🎵',l:'TikTok',p:'https://tiktok.com/@seuprofile'},
        {k:'youtube',i:'▶️',l:'YouTube',p:'https://youtube.com/@seucanal'},
        {k:'pinterest',i:'📌',l:'Pinterest',p:'https://pinterest.com/seuperfil'},
        {k:'whatsapp',i:'💬',l:'WhatsApp Business',p:'https://wa.me/5592...'},
        {k:'telegram',i:'✈️',l:'Telegram',p:'https://t.me/seucanal'},
        {k:'twitter',i:'🐦',l:'X (Twitter)',p:'https://x.com/seuprofile'},
      ].map(r=>`
      <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--cream);border-radius:8px;">
        <span style="font-size:20px;flex-shrink:0;">${r.i}</span>
        <div style="flex:1;">
          <label style="font-size:11px;font-weight:600;color:var(--muted);display:block;margin-bottom:3px;">${r.l}</label>
          <input class="fi" id="ec-social-${r.k}" value="${cfg.social?.[r.k]||''}" placeholder="${r.p}" style="font-size:12px;"/>
        </div>
        <select id="ec-social-pos-${r.k}" style="padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:11px;flex-shrink:0;" title="Onde aparece">
          ${(() => {
            const cur = cfg.socialPos?.[r.k] || 'footer';
            return ['footer','header','both','hidden'].map(p=>`<option value="${p}" ${cur===p?'selected':''}>${p==='footer'?'📍 Rodapé':p==='header'?'📍 Topo':p==='both'?'Topo+Rodapé':'Oculto'}</option>`).join('');
          })()}
        </select>
      </div>`).join('')}
    </div>
    <button class="btn btn-primary" onclick="ecSaveRedes()" style="width:100%;margin-top:16px;padding:12px;">💾 Salvar Redes Sociais</button>
  </div>

  <div class="card">
    <div class="card-title">👁️ Preview — Rodapé da loja</div>
    <div style="background:#1A0A10;border-radius:10px;padding:16px;">
      <div style="font-family:'Playfair Display',serif;color:#fff;font-size:16px;margin-bottom:12px;">🌸 Laços Eternos</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;">
        ${[
          {k:'instagram',i:'📷'},{k:'facebook',i:'📘'},{k:'tiktok',i:'🎵'},
          {k:'youtube',i:'▶️'},{k:'whatsapp',i:'💬'},{k:'twitter',i:'🐦'}
        ].filter(r=>cfg.social?.[r.k]).map(r=>`
        <a href="${cfg.social[r.k]}" target="_blank" style="background:rgba(255,255,255,.15);border-radius:8px;padding:8px 12px;color:#fff;font-size:14px;text-decoration:none;">${r.i}</a>`).join('')}
        ${!Object.keys(cfg.social||{}).length?`<span style="color:rgba(255,255,255,.4);font-size:12px;">Nenhuma rede configurada ainda</span>`:''}
      </div>
    </div>
  </div>
</div>
`:''}

<!-- ══ ABA BANNERS ════════════════════════════════════════════ -->
${tab==='banners'?`
<div class="card">
  <div class="card-title">🖼️ Banners da Home
    <button class="btn btn-ghost btn-sm" onclick="ecAddBanner()">+ Novo Banner</button>
  </div>
  <p style="font-size:12px;color:var(--muted);margin-bottom:16px;">Os banners aparecem em carrossel automático na página inicial da loja.</p>
  <div id="banners-list">
    ${banners.map((b,i)=>`
    <div style="background:var(--cream);border-radius:10px;padding:16px;margin-bottom:12px;border:1px solid var(--border);">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <div style="font-weight:700;font-size:14px;">Banner ${i+1}</div>
        <div style="display:flex;gap:6px;">
          ${i>0?`<button class="btn btn-ghost btn-xs" onclick="moveBanner(${i},-1)">↑</button>`:''}
          ${i<banners.length-1?`<button class="btn btn-ghost btn-xs" onclick="moveBanner(${i},1)">↓</button>`:''}
          ${banners.length>1?`<button class="btn btn-ghost btn-xs" style="color:var(--red)" onclick="removeBanner(${i})">🗑️</button>`:''}
        </div>
      </div>
      <div class="fr2" style="gap:10px;">
        <div class="fg"><label class="fl">Emoji / ícone (fallback)</label>
          <input class="fi" id="bn-icon-${i}" value="${b.icon||'🌸'}" style="font-size:20px;text-align:center;width:70px;"/></div>
        <div class="fg"><label class="fl">Título *</label>
          <input class="fi" id="bn-title-${i}" value="${b.title||''}"/></div>
        <div class="fg" style="grid-column:span 2"><label class="fl">Subtítulo</label>
          <input class="fi" id="bn-sub-${i}" value="${b.sub||''}"/></div>
        <div class="fg"><label class="fl">Texto do botão</label>
          <input class="fi" id="bn-cta-${i}" value="${b.cta||'Ver mais'}"/></div>
        <div class="fg"><label class="fl">Categoria do link (opcional)</label>
          <select class="fi" id="bn-cat-${i}">
            <option value="">Página inicial</option>
            ${[...new Set(S.products.map(p=>p.category).filter(Boolean))].map(c=>`<option ${b.cat===c?'selected':''}>${c}</option>`).join('')}
          </select></div>
        <div class="fg" style="grid-column:span 2;"><label class="fl">🖼️ Imagem do banner (URL ou upload)</label>
          <div style="display:flex;gap:6px;align-items:center;">
            <input class="fi" id="bn-img-${i}" value="${b.image||''}" placeholder="https://... ou clique para upload" style="flex:1;font-size:11px;"/>
            <input type="file" id="bn-img-file-${i}" accept="image/*" style="display:none;" onchange="(()=>{const f=this.files[0];if(!f)return;if(f.size>2*1024*1024){alert('Max 2 MB');return;}const r=new FileReader();r.onload=(e)=>{document.getElementById('bn-img-${i}').value=e.target.result;document.getElementById('bn-preview-${i}').src=e.target.result;document.getElementById('bn-preview-${i}').style.display='block';};r.readAsDataURL(f);})()"/>
            <label for="bn-img-file-${i}" class="btn btn-ghost btn-sm" style="cursor:pointer;flex-shrink:0;">📤 Upload</label>
          </div>
          ${b.image?`<img id="bn-preview-${i}" src="${b.image}" style="max-width:200px;max-height:80px;margin-top:6px;border-radius:6px;border:1px solid var(--border);"/>`:`<img id="bn-preview-${i}" style="display:none;max-width:200px;max-height:80px;margin-top:6px;border-radius:6px;border:1px solid var(--border);"/>`}
        </div>
      </div>
      <!-- Preview mini -->
      <div style="margin-top:10px;background:linear-gradient(135deg,#3D0A20,#8B2252);border-radius:8px;padding:16px;color:#fff;display:flex;align-items:center;gap:16px;">
        <span style="font-size:40px;">${b.icon||'🌸'}</span>
        <div>
          <div style="font-weight:700;font-size:15px;">${b.title||'Título do banner'}</div>
          <div style="font-size:12px;opacity:.8;">${b.sub||'Subtítulo'}</div>
          <div style="margin-top:8px;background:#fff;color:#8B2252;padding:5px 14px;border-radius:20px;font-size:12px;font-weight:700;display:inline-block;">${b.cta||'Botão'}</div>
        </div>
      </div>
    </div>`).join('')}
  </div>
  <button class="btn btn-primary" onclick="ecSaveBanners()" style="width:100%;padding:12px;font-size:14px;">💾 Salvar Banners</button>
</div>
`:''}

<!-- ══ ABA PRODUTOS ══════════════════════════════════════════ -->
${tab==='produtos'?`
<div class="card">
  <div class="card-title">🌸 Produtos na Loja
    <span style="font-size:12px;font-weight:400;color:var(--muted)">${prods.length} de ${allProds.length} ativos</span>
  </div>
  <p style="font-size:12px;color:var(--muted);margin-bottom:16px;">Ative ou desative produtos para exibição na loja. Para editar fotos e preços, acesse o módulo <strong>Produtos</strong>.</p>
  <div class="fr2" style="gap:8px;margin-bottom:16px;">
    <button class="btn btn-ghost btn-sm" onclick="ecAtivarTodos()">✅ Ativar todos</button>
    <button class="btn btn-ghost btn-sm" onclick="ecDesativarTodos()">❌ Desativar todos</button>
  </div>
  <div style="overflow-x:auto;">
  <table>
    <thead><tr><th>Ativo</th><th>Produto</th><th>Categoria</th><th>Preço</th><th>Estoque</th><th>Destaque</th></tr></thead>
    <tbody>
      ${allProds.map(p=>`<tr>
        <td><input type="checkbox" class="ec-prod-toggle" data-pid="${p._id}" ${p.activeOnSite?'checked':''}/></td>
        <td style="font-weight:500">${p.name}</td>
        <td><span class="tag t-gray" style="font-size:10px">${p.category||'—'}</span></td>
        <td style="font-weight:600;color:var(--rose)">${$c(p.salePrice)}</td>
        <td><span class="tag ${(p.stock||0)>0?'t-green':'t-red'}" style="font-size:10px">${p.stock||0}</span></td>
        <td><input type="checkbox" class="ec-prod-featured" data-pid="${p._id}" ${(cfg.featured||[]).includes(p._id)?'checked':''}/></td>
      </tr>`).join('')}
    </tbody>
  </table>
  </div>
  <div style="margin-top:16px;display:flex;gap:10px;justify-content:flex-end;">
    <button class="btn btn-primary" onclick="ecSaveProds()" style="padding:10px 28px;">💾 Salvar</button>
  </div>
</div>
`:''}

<!-- ══ ABA CORES ══════════════════════════════════════════════ -->
${tab==='cores'?`
<div class="g2" style="gap:16px;">
  <div class="card">
    <div class="card-title">🎨 Cores do Site</div>
    <div style="display:flex;flex-direction:column;gap:12px;">
      ${[
        {k:'primaryColor',l:'🌹 Cor principal',d:'#8B2252'},
        {k:'primaryLight',l:'🌷 Cor secundária',d:'#C8436A'},
        {k:'accentColor',l:'✨ Cor de destaque',d:'#F4A7B9'},
        {k:'bgColor',l:'🎀 Cor de fundo',d:'#F8F4F2'},
        {k:'textColor',l:'📝 Cor do texto',d:'#1A0A10'},
      ].map(c=>`
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px;background:var(--cream);border-radius:8px;">
        <span style="font-size:13px;font-weight:500;">${c.l}</span>
        <div style="display:flex;align-items:center;gap:10px;">
          <input type="color" id="ec-color-${c.k}" value="${cfg[c.k]||c.d}" style="width:44px;height:32px;border:none;border-radius:6px;cursor:pointer;"/>
          <span style="font-size:11px;color:var(--muted);min-width:60px;" id="ec-color-val-${c.k}">${cfg[c.k]||c.d}</span>
        </div>
      </div>`).join('')}
    </div>
    <div style="margin-top:16px;">
      <button class="btn btn-ghost btn-sm" onclick="ecResetCores()" style="margin-right:8px;">↩ Restaurar padrão</button>
      <button class="btn btn-primary" onclick="ecSaveCores()">💾 Salvar Cores</button>
    </div>
  </div>

  <div class="card">
    <div class="card-title">🖼️ Configurações de Layout</div>
    <div style="display:flex;flex-direction:column;gap:10px;">
      <div class="fg"><label class="fl">Estilo de grid de produtos</label>
        <select class="fi" id="ec-grid-style">
          <option ${(cfg.gridStyle||'padrao')==='padrao'?'selected':''} value="padrao">Padrão (3-4 colunas)</option>
          <option ${cfg.gridStyle==='compacto'?'selected':''} value="compacto">Compacto (mais itens)</option>
          <option ${cfg.gridStyle==='grande'?'selected':''} value="grande">Grande (destaque)</option>
        </select></div>
      <div class="fg"><label class="fl">Estilo do header</label>
        <select class="fi" id="ec-header-style">
          <option ${(cfg.headerStyle||'fixo')==='fixo'?'selected':''} value="fixo">Fixo no topo</option>
          <option ${cfg.headerStyle==='normal'?'selected':''} value="normal">Normal (some ao rolar)</option>
        </select></div>
      <div class="fg"><label class="fl">Posição do logo</label>
        <select class="fi" id="ec-logo-pos">
          <option ${(cfg.logoPos||'esquerda')==='esquerda'?'selected':''} value="esquerda">Esquerda</option>
          <option ${cfg.logoPos==='centro'?'selected':''} value="centro">Centro</option>
        </select></div>
    </div>
    <button class="btn btn-primary" style="margin-top:16px;width:100%;" onclick="ecSaveLayout()">💾 Salvar Layout</button>
  </div>

  <!-- Paletas prontas -->
  <div class="card" style="grid-column:span 2">
    <div class="card-title">🎨 Paletas Prontas</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;">
      ${[
        {l:'🌹 Rosa Clássico',p:'#8B2252',s:'#C8436A',a:'#F4A7B9'},
        {l:'💜 Roxo Elegante',p:'#6B2580',s:'#9B59B6',a:'#E8D5F5'},
        {l:'🌿 Verde Natureza',p:'#2E7D32',s:'#4CAF50',a:'#C8E6C9'},
        {l:'❤️ Vermelho Paixão',p:'#C0392B',s:'#E74C3C',a:'#FADBD8'},
        {l:'🤎 Marrom Terra',p:'#6D4C41',s:'#A1887F',a:'#F5E6E0'},
        {l:'💙 Azul Serenidade',p:'#1565C0',s:'#2196F3',a:'#BBDEFB'},
      ].map(p=>`
      <button class="btn btn-ghost btn-sm" onclick="applyPalette('${p.p}','${p.s}','${p.a}')"
        style="display:flex;align-items:center;gap:8px;">
        <span style="display:flex;gap:2px;">
          <span style="width:14px;height:14px;border-radius:50%;background:${p.p}"></span>
          <span style="width:14px;height:14px;border-radius:50%;background:${p.s}"></span>
          <span style="width:14px;height:14px;border-radius:50%;background:${p.a}"></span>
        </span>
        ${p.l}
      </button>`).join('')}
    </div>
  </div>
</div>
`:''}

<!-- ══ ABA PREVIEW ════════════════════════════════════════════ -->
${tab==='preview'?`
<div class="card">
  <div class="card-title">👁️ Preview da Loja
    <a href="https://floriculturalacoseternos.com.br/ecommerce.html" target="_blank" class="btn btn-primary btn-sm">🔗 Abrir loja em nova aba</a>
  </div>
  <div style="background:var(--cream);border-radius:10px;padding:20px;text-align:center;margin-bottom:16px;">
    <div style="font-size:13px;color:var(--muted);margin-bottom:12px;">📱 Simulação mobile | 💻 Desktop</div>
    <div style="display:flex;gap:16px;justify-content:center;flex-wrap:wrap;">
      <div style="width:320px;height:600px;border:2px solid var(--border);border-radius:20px;overflow:hidden;box-shadow:var(--shadow-lg);">
        <iframe src="https://floriculturalacoseternos.com.br/ecommerce.html"
          style="width:375px;height:700px;border:none;transform:scale(0.85);transform-origin:top left;"
          title="Preview mobile"></iframe>
      </div>
    </div>
  </div>
  <div style="background:var(--petal);border-radius:10px;padding:14px;">
    <div style="font-weight:600;margin-bottom:8px;">📊 Status da Loja</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;text-align:center;">
      <div style="background:#fff;border-radius:8px;padding:12px;">
        <div style="font-size:24px;font-weight:700;color:var(--rose)">${prods.length}</div>
        <div style="font-size:11px;color:var(--muted)">Produtos ativos</div>
      </div>
      <div style="background:#fff;border-radius:8px;padding:12px;">
        <div style="font-size:24px;font-weight:700;color:var(--leaf)">${S.orders.filter(o=>o.source==='E-commerce').length}</div>
        <div style="font-size:11px;color:var(--muted)">Pedidos do site</div>
      </div>
      <div style="background:#fff;border-radius:8px;padding:12px;">
        <div style="font-size:24px;font-weight:700;color:var(--gold)">${banners.length}</div>
        <div style="font-size:11px;color:var(--muted)">Banners ativos</div>
      </div>
    </div>
  </div>
</div>
`:''}
`;
}

// ── Register all ec* functions on window for inline onclick handlers ──
window.ecSaveGeral = ecSaveGeral;
window.ecSaveHorario = ecSaveHorario;
window.ecSavePagamentos = ecSavePagamentos;
window.ecSaveBanners = ecSaveBanners;
window.ecAddBanner = ecAddBanner;
window.moveBanner = moveBanner;
window.removeBanner = removeBanner;
window.ecAtivarTodos = ecAtivarTodos;
window.ecDesativarTodos = ecDesativarTodos;
window.ecSaveProds = ecSaveProds;
window.ecSaveCores = ecSaveCores;
window.ecResetCores = ecResetCores;
window.ecSaveLayout = ecSaveLayout;
window.applyPalette = applyPalette;
window.ecSaveRedes = ecSaveRedes;
window.ecNewPagina = ecNewPagina;
window.ecSavePagina = ecSavePagina;
window.ecTogglePagina = ecTogglePagina;
window.ecDelPagina = ecDelPagina;
