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
          <div style="font-weight:700;font-size:15px;">${p.titulo}</div>
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
  try{ await api('PUT','/settings/ecommerce', cfg); }catch(e){ /* saved locally */ }
}

// Synchronous local-only helpers (used inside render & inline handlers)
function getEcCfgSync(){ return JSON.parse(localStorage.getItem(EC_CFG_KEY)||'{}'); }
function saveEcCfgSync(cfg){
  localStorage.setItem(EC_CFG_KEY, JSON.stringify(cfg));
  // fire-and-forget API save
  api('PUT','/settings/ecommerce', cfg).catch(()=>{});
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
  for(let i=0;i<count;i++){ const t=document.getElementById(`bn-title-${i}`)?.value?.trim()||''; if(!t) continue; banners.push({icon:document.getElementById(`bn-icon-${i}`)?.value||'🌸',title:t,sub:document.getElementById(`bn-sub-${i}`)?.value||'',cta:document.getElementById(`bn-cta-${i}`)?.value||'Ver mais',cat:document.getElementById(`bn-cat-${i}`)?.value||''}); }
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

export function ecSaveRedes(){ const redes=['instagram','facebook','tiktok','youtube','pinterest','whatsapp','telegram','twitter']; const social={}; redes.forEach(r=>{ const url=document.getElementById(`ec-social-${r}`)?.value?.trim(); const ativo=document.getElementById(`ec-social-ativo-${r}`)?.checked; if(url&&ativo) social[r]=url; }); saveEcCfgSync({...getEcCfgSync(),social}); toast('✅ Redes salvas!'); render(); }

export function ecNewPagina(idx=null){ const cfg=getEcCfgSync(); const pags=cfg.paginas||[]; const pag=idx!==null?pags[idx]:{titulo:'',slug:'',conteudo:'',ativa:true}; S._modal=`<div class="mo" onclick="if(event.target===this){S._modal='';render();}"><div class="mo-box" style="max-width:580px;max-height:92vh;overflow-y:auto;" onclick="event.stopPropagation()"><div style="font-family:'Playfair Display',serif;font-size:17px;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--border);">📄 ${idx!==null?'Editar':'Nova'} Página</div><div class="fg" style="margin-bottom:10px;"><label class="fl">Título *</label><input class="fi" id="pag-titulo" value="${pag.titulo||''}" placeholder="Ex: Sobre Nós" oninput="const s=document.getElementById('pag-slug');if(s&&!s.value)s.value=this.value.toLowerCase().replace(/\\s+/g,'-').replace(/[^\\w-]/g,'')"/></div><div class="fg" style="margin-bottom:10px;"><label class="fl">Slug (URL)</label><input class="fi" id="pag-slug" value="${pag.slug||''}" placeholder="sobre-nos"/></div><div class="fg" style="margin-bottom:14px;"><label class="fl">Conteúdo</label><textarea class="fi" id="pag-conteudo" rows="8" style="resize:vertical;">${pag.conteudo||''}</textarea></div><label style="display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:14px;cursor:pointer;"><input type="checkbox" id="pag-ativa" ${pag.ativa!==false?'checked':''} style="accent-color:var(--primary);"/> Página publicada</label><div style="display:flex;gap:8px;"><button class="btn btn-primary" style="flex:1;" onclick="ecSavePagina(${idx!==null?idx:'null'})">💾 Salvar</button><button class="btn btn-ghost" onclick="S._modal='';render()">Cancelar</button></div></div></div>`; render(); }

export function ecSavePagina(idx){ const t=document.getElementById('pag-titulo')?.value?.trim(); if(!t) return toast('❌ Título obrigatório',true); const cfg=getEcCfgSync(); const pags=[...(cfg.paginas||[])]; const nova={titulo:t,slug:document.getElementById('pag-slug')?.value?.trim()||t.toLowerCase().replace(/\s+/g,'-'),conteudo:document.getElementById('pag-conteudo')?.value||'',ativa:document.getElementById('pag-ativa')?.checked??true}; if(idx!==null&&idx!==undefined&&idx!=='null') pags[parseInt(idx)]=nova; else pags.push(nova); saveEcCfgSync({...cfg,paginas:pags}); S._modal=''; render(); toast('✅ Página salva!'); }

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
    {k:'geral',l:'⚙️ Configurações'},
    {k:'horario',l:'🕐 Horários'},
    {k:'pagamentos',l:'💳 Pagamentos'},
    {k:'paginas',l:'📄 Páginas'},
    {k:'redes',l:'📱 Redes Sociais'},
    {k:'banners',l:'🖼️ Banners'},
    {k:'cores',l:'🎨 Aparência'},
    {k:'preview',l:'👁️ Preview'},
  ].map(t=>`<button class="tab ${tab===t.k?'active':''}" onclick="S._ecTab='${t.k}';render()">${t.l}</button>`).join('')}
  <div style="font-size:11px;color:var(--muted);background:#FAE8E6;padding:8px 14px;border-radius:8px;margin-left:6px;">
    🌸 <strong>Produtos do site:</strong> editados em <a href="javascript:setPage('produtos')" style="color:#9F1239;font-weight:700;">Produtos</a> · marque <em>"Aparecer no E-commerce"</em>
  </div>
</div>

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

<!-- ══ ABA HORARIOS ══════════════════════════════════════════ -->
${tab==='horario'?`
<div class="g2" style="gap:16px;">
  <div class="card">
    <div class="card-title">🕐 Dias e Turnos de Entrega</div>
    <p style="font-size:12px;color:var(--muted);margin-bottom:16px;">Marque os dias e turnos disponíveis para entrega. O cliente verá apenas essas opções no checkout.</p>

    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:10px;">📅 Dias da Semana</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;margin-bottom:20px;">
      ${['Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado','Domingo'].map(d=>`
      <label style="display:flex;align-items:center;gap:8px;padding:10px;background:${(cfg.diasEntrega||['Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado']).includes(d)?'var(--primary-pale)':'var(--cream)'};border:1.5px solid ${(cfg.diasEntrega||['Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado']).includes(d)?'var(--primary)':'var(--border)'};border-radius:8px;cursor:pointer;font-size:13px;font-weight:500;">
        <input type="checkbox" class="ec-dia-check" data-dia="${d}" ${(cfg.diasEntrega||['Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado']).includes(d)?'checked':''} style="accent-color:var(--primary);width:15px;height:15px;"/>
        ${d.split('-')[0]}
      </label>`).join('')}
    </div>

    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:10px;">⏰ Turnos Disponíveis</div>
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:20px;">
      ${[
        {k:'Manhã',h:'08:00 – 12:00'},
        {k:'Tarde',h:'12:00 – 18:00'},
        {k:'Noite',h:'18:00 – 21:00'},
        {k:'Horário específico',h:'Cliente informa o horário'},
      ].map(t=>`
      <label style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:${(cfg.turnosEntrega||['Manhã','Tarde']).includes(t.k)?'var(--primary-pale)':'var(--cream)'};border:1.5px solid ${(cfg.turnosEntrega||['Manhã','Tarde']).includes(t.k)?'var(--primary)':'var(--border)'};border-radius:8px;cursor:pointer;">
        <div style="display:flex;align-items:center;gap:10px;">
          <input type="checkbox" class="ec-turno-check" data-turno="${t.k}" ${(cfg.turnosEntrega||['Manhã','Tarde']).includes(t.k)?'checked':''} style="accent-color:var(--primary);width:15px;height:15px;"/>
          <div>
            <div style="font-weight:600;font-size:13px;">${t.k}</div>
            <div style="font-size:11px;color:var(--muted);">${t.h}</div>
          </div>
        </div>
      </label>`).join('')}
    </div>

    <div class="fr2" style="gap:10px;">
      <div class="fg"><label class="fl">Horário de abertura</label>
        <input class="fi" type="time" id="ec-hora-abre" value="${cfg.horaAbre||'08:00'}"/></div>
      <div class="fg"><label class="fl">Horário de fechamento</label>
        <input class="fi" type="time" id="ec-hora-fecha" value="${cfg.horaFecha||'20:00'}"/></div>
    </div>

    <div style="margin-top:14px;">
      <div class="fg"><label class="fl">Mensagem de prazo de entrega</label>
        <input class="fi" id="ec-prazo-msg" value="${cfg.prazoMsg||'Entregamos no mesmo dia para pedidos até 14h'}" placeholder="Ex: Entregamos no mesmo dia para pedidos até 14h"/></div>
    </div>

    <button class="btn btn-primary" onclick="ecSaveHorario()" style="width:100%;margin-top:16px;padding:12px;">💾 Salvar Horários</button>
  </div>

  <div class="card">
    <div class="card-title">📋 Preview — Como o cliente verá</div>
    <div style="background:var(--cream);border-radius:10px;padding:16px;font-size:13px;">
      <div style="font-weight:700;margin-bottom:10px;">Dias disponíveis:</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px;">
        ${(cfg.diasEntrega||['Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado']).map(d=>`<span style="background:var(--primary);color:#fff;border-radius:20px;padding:3px 10px;font-size:11px;">${d.split('-')[0]}</span>`).join('')}
      </div>
      <div style="font-weight:700;margin-bottom:8px;">Turnos:</div>
      ${(cfg.turnosEntrega||['Manhã','Tarde']).map(t=>`<div style="padding:8px;background:#fff;border-radius:6px;margin-bottom:6px;font-size:12px;">✅ ${t}</div>`).join('')}
      <div style="margin-top:12px;font-size:12px;color:var(--primary);">🕐 ${cfg.horaAbre||'08:00'} – ${cfg.horaFecha||'20:00'}</div>
      ${cfg.prazoMsg?`<div style="font-size:11px;color:var(--muted);margin-top:6px;">ℹ️ ${cfg.prazoMsg}</div>`:''}
    </div>
  </div>
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
        <input type="checkbox" id="ec-social-ativo-${r.k}" ${cfg.social?.[r.k]?'checked':''} style="accent-color:var(--primary);width:16px;height:16px;" title="Exibir na loja"/>
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
        <div class="fg"><label class="fl">Emoji / ícone</label>
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
