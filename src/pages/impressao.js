import { S, API } from '../state.js';
import { $c } from '../utils/formatters.js';
import { GET, PUT } from '../services/api.js';
import { toast, parseLocalDate, formatOrderDate } from '../utils/helpers.js';
import { getClientWithStats, getClientTier } from './clientes.js';

// ── Helper: render() via dynamic import ───────────────────────
async function render(){
  const { render:r } = await import('../main.js');
  r();
}

// ── LOAD / SAVE print layout com API + fallback localStorage ──
async function loadPrintLayout(){
  try{
    const data = await GET('/settings/print-layout');
    if(data && typeof data === 'object' && Object.keys(data).length){
      localStorage.setItem('fv_print_layout', JSON.stringify(data));
      return data;
    }
  }catch(e){/* fallback */}
  return JSON.parse(localStorage.getItem('fv_print_layout')||'{}');
}

async function savePrintLayout(layout){
  localStorage.setItem('fv_print_layout', JSON.stringify(layout));
  try{ await PUT('/settings/print-layout', layout); }catch(e){/* silencioso */}
}

// ── Fontes disponiveis para selects ──────────────────────────
const FONTES = ['Georgia','Arial','Palatino','Times New Roman','Garamond','Verdana','Helvetica','Tahoma','Courier New','Trebuchet MS'];

// ── RENDER IMPRESSAO (com abas) ──────────────────────────────────
export function renderImpressao(){
  const cfg    = JSON.parse(localStorage.getItem('fv_config')||'{}');
  const layout = JSON.parse(localStorage.getItem('fv_print_layout')||'{}');
  const tab    = S._impTab || 'cartao';

  // ── Cartao config ─────────────────────────────────────────
  const cCor    = layout.cardCor     || '#C8436A';
  const cBg     = layout.cardBg      || '#FDF4F7';
  const cFonte  = layout.cardFonte   || 'Georgia';
  const cTam    = layout.cardTamanho || '16';
  const empresa = layout.nomeEmpresa || cfg.razao || 'Laços Eternos Floricultura';
  const whats   = layout.whatsapp    || cfg.whats  || '(92) 99300-2433';

  // ── Comanda config ────────────────────────────────────────
  const mCor    = layout.comandaCor     || '#8B2252';
  const mBg     = layout.comandaBg      || '#FFFFFF';
  const mFonte  = layout.comandaFonte   || 'Arial';
  const mTam    = layout.comandaTamanho || '14';

  // ── Etiqueta config ───────────────────────────────────────
  const eCor    = layout.labelCor     || '#1E5AA8';
  const eBg     = layout.labelBg      || '#FFFFFF';
  const eFonte  = layout.labelFonte   || 'Arial';
  const eTam    = layout.labelTamanho || '18';
  const eLargura= layout.labelLargura || '100';  // mm
  const eAltura = layout.labelAltura  || '50';   // mm
  const eTexto  = layout.labelTexto   || 'Laços Eternos Floricultura\n{recipient}\n{bairro}';

  const previewOrder = S.orders[0] || {
    orderNumber:'#0001', recipient:'Maria Silva',
    cardMessage:'Feliz aniversário com muito amor! 🌸',
    identifyClient:true, clientName:'João Silva',
    client:{name:'João Silva'}, clientPhone:'(92) 98888-0000',
    deliveryAddress:'Rua das Flores, 123 — Adrianópolis',
    deliveryNeighborhood:'Adrianópolis',
    scheduledDate:new Date().toISOString(), scheduledPeriod:'Tarde',
    payment:'Pix', total:150, items:[{name:'Buquê Premium',qty:1,totalPrice:150}]
  };

  const tabBtn = (k, l) => `<button class="tab ${tab===k?'active':''}" data-imp-tab="${k}">${l}</button>`;

  // ─── TAB: CARTÃO ─────────────────────────────────────────
  const tabCartao = `
  <div class="g2">
    <div>
      <div class="card" style="margin-bottom:14px;">
        <div class="card-title">🎨 Aparência do Cartão</div>
        <div class="fr2">
          <div class="fg"><label class="fl">Cor principal</label>
            <input type="color" class="fi" id="lay-cor" value="${cCor}" style="height:40px;cursor:pointer;"/></div>
          <div class="fg"><label class="fl">Cor de fundo</label>
            <input type="color" class="fi" id="lay-bg" value="${cBg}" style="height:40px;cursor:pointer;"/></div>
          <div class="fg"><label class="fl">Fonte</label>
            <select class="fi" id="lay-fonte">
              ${FONTES.map(f=>`<option ${cFonte===f?'selected':''}>${f}</option>`).join('')}
            </select></div>
          <div class="fg"><label class="fl">Tamanho da mensagem (px)</label>
            <input class="fi" type="number" id="lay-tam" value="${cTam}" min="10" max="28"/></div>
          <div class="fg"><label class="fl">Nome da empresa no cartão</label>
            <input class="fi" id="lay-empresa" value="${empresa}"/></div>
          <div class="fg"><label class="fl">WhatsApp da loja</label>
            <input class="fi" id="lay-whats" value="${whats}"/></div>
        </div>
      </div>
      <div class="card" style="margin-bottom:14px;">
        <div class="card-title">🖼️ Logo / Imagem do Cartão</div>
        <div class="fg">
          <label class="fl">Envie logo (PNG/JPG, máx 500KB)</label>
          <input type="file" id="lay-logo-file" accept="image/png,image/jpeg,image/webp" style="width:100%;padding:6px;border:1px dashed var(--border);border-radius:8px;"/>
        </div>
        ${layout.logoBase64 ? `<div style="text-align:center;margin:10px 0;padding:10px;background:#f5f5f5;border-radius:8px;">
          <img src="${layout.logoBase64}" style="max-height:80px;max-width:200px;"/>
          <button class="btn btn-ghost btn-sm" id="btn-remove-logo" style="display:block;margin:8px auto 0;color:var(--red);">🗑️ Remover logo</button>
        </div>`:''}
        <div class="fg"><label class="fl">Tamanho da logo (px)</label>
          <input class="fi" type="number" id="lay-logo-size" value="${layout.logoSize||60}" min="30" max="150"/></div>
      </div>
      <div class="card">
        <div class="card-title">👀 O que exibir no cartão</div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${[
            ['lay-mostrarLogo',         'Mostrar logo/nome da empresa',     layout.mostrarLogo!==false],
            ['lay-mostrarDestinatario', 'Mostrar nome do destinatário',     layout.mostrarDestinatario!==false],
            ['lay-mostrarMensagem',     'Mostrar mensagem do cartão',       layout.mostrarMensagem!==false],
            ['lay-mostrarData',         'Mostrar data de entrega',          layout.mostrarData!==false],
            ['lay-mostrarProduto',      'Mostrar nome do produto',          layout.mostrarProduto!==false],
            ['lay-mostrarRemetente',    'Mostrar nome do remetente',        layout.mostrarRemetente!==false],
          ].map(([id,lbl,checked])=>`<label class="cb" style="cursor:pointer;"><input type="checkbox" id="${id}" ${checked?'checked':''}/><span style="font-size:12px">${lbl}</span></label>`).join('')}
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">👁️ Preview — Cartão</div>
      <div style="border:2px solid ${cCor};border-radius:16px;padding:28px;max-width:320px;margin:0 auto;text-align:center;font-family:${cFonte},serif;background:${cBg};">
        ${layout.mostrarLogo!==false?(layout.logoBase64?`<img src="${layout.logoBase64}" style="max-height:${layout.logoSize||60}px;margin-bottom:10px;"/>`:`<div style="font-size:12px;color:${cCor};font-weight:bold;margin-bottom:8px;letter-spacing:1px;">${empresa.toUpperCase()}</div>`):''}
        <div style="font-size:26px;margin-bottom:8px;">🌺</div>
        <div style="font-size:12px;color:#666;margin-bottom:3px;">PARA:</div>
        <div style="font-size:18px;font-weight:bold;margin-bottom:14px;color:#1A0A10;">${(previewOrder.recipient||'—').toUpperCase()}</div>
        <div style="font-size:${cTam}px;font-style:italic;color:#2D1A20;line-height:1.8;padding:14px;background:rgba(255,255,255,.6);border-radius:8px;margin-bottom:12px;">"${previewOrder.cardMessage}"</div>
        <div style="font-size:12px;color:#9E8090;">💌 COM CARINHO DE: <strong>${(previewOrder.clientName||'—').toUpperCase()}</strong></div>
        <div style="font-size:11px;color:#ccc;margin-top:12px;">📱 ${whats}</div>
      </div>
      <div style="display:flex;gap:8px;margin-top:12px;justify-content:center;">
        <button class="btn btn-primary btn-sm" id="btn-save-layout">💾 Salvar</button>
        <button class="btn btn-ghost btn-sm" id="btn-print-card-preview">🖨️ Testar</button>
      </div>
    </div>
  </div>`;

  // ─── TAB: COMANDA ────────────────────────────────────────
  const tabComanda = `
  <div class="g2">
    <div>
      <div class="card" style="margin-bottom:14px;">
        <div class="card-title">🧾 Aparência da Comanda <span style="font-size:10px;color:var(--muted);font-weight:400;">(sempre em MAIÚSCULO)</span></div>
        <div class="fr2">
          <div class="fg"><label class="fl">Cor de destaque</label>
            <input type="color" class="fi" id="lay-cmd-cor" value="${mCor}" style="height:40px;"/></div>
          <div class="fg"><label class="fl">Cor de fundo</label>
            <input type="color" class="fi" id="lay-cmd-bg" value="${mBg}" style="height:40px;"/></div>
          <div class="fg"><label class="fl">Fonte</label>
            <select class="fi" id="lay-cmd-fonte">
              ${FONTES.map(f=>`<option ${mFonte===f?'selected':''}>${f}</option>`).join('')}
            </select></div>
          <div class="fg"><label class="fl">Tamanho base (px)</label>
            <input class="fi" type="number" id="lay-cmd-tam" value="${mTam}" min="10" max="20"/></div>
        </div>
      </div>
      <div class="card" style="margin-bottom:14px;">
        <div class="card-title">🖼️ Logo da Comanda</div>
        <div class="fg">
          <label class="fl">Logo (usa a mesma da aba Cartão por padrão)</label>
          <input type="file" id="lay-cmd-logo-file" accept="image/png,image/jpeg" style="width:100%;padding:6px;border:1px dashed var(--border);border-radius:8px;"/>
          <div style="font-size:10px;color:var(--muted);margin-top:4px;">Deixe em branco para usar a logo do cartão</div>
        </div>
        ${layout.comandaLogoBase64 ? `<div style="text-align:center;margin-top:10px;padding:10px;background:#f5f5f5;border-radius:8px;">
          <img src="${layout.comandaLogoBase64}" style="max-height:60px;"/>
          <button class="btn btn-ghost btn-sm" id="btn-remove-cmd-logo" style="display:block;margin:8px auto 0;color:var(--red);">🗑️ Remover</button>
        </div>`:''}
      </div>
      <div class="card">
        <div class="card-title">👀 Blocos visíveis na comanda</div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${[
            ['lay-cmdDestinatario','Destinatário', layout.cmdDestinatario!==false],
            ['lay-cmdRemetente',   'Remetente',    layout.cmdRemetente!==false],
            ['lay-cmdData',        'Data/Turno/Horário', layout.cmdData!==false],
            ['lay-cmdEndereco',    'Endereço',     layout.cmdEndereco!==false],
            ['lay-cmdProdutoFoto', 'Foto do produto', layout.cmdProdutoFoto!==false],
            ['lay-cmdCartao',      'Mensagem do cartão', layout.cmdCartao!==false],
            ['lay-cmdCobranca',    'Cobrança na entrega', layout.cmdCobranca!==false],
            ['lay-cmdEntregador',  'Entregador',   layout.cmdEntregador!==false],
            ['lay-cmdQR',          'QR Code',      layout.cmdQR!==false],
            ['lay-cmdAssinatura',  'Assinatura',   layout.cmdAssinatura!==false],
            ['lay-cmdRodape',      'Rodapé',       layout.cmdRodape!==false],
          ].map(([id,lbl,chk])=>`<label class="cb"><input type="checkbox" id="${id}" ${chk?'checked':''}/><span style="font-size:12px">${lbl}</span></label>`).join('')}
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">👁️ Preview — Comanda</div>
      <div style="border:2px solid ${mCor};border-radius:12px;padding:16px;font-family:${mFonte},sans-serif;font-size:${mTam}px;background:${mBg};text-transform:uppercase;">
        <div style="border-bottom:3px solid ${mCor};padding-bottom:8px;margin-bottom:10px;display:flex;justify-content:space-between;">
          <strong style="color:${mCor};">${empresa.toUpperCase()}</strong>
          <strong>#0001</strong>
        </div>
        <div style="margin-bottom:6px;"><strong>DESTINATÁRIO:</strong> ${(previewOrder.recipient||'—').toUpperCase()}</div>
        <div style="margin-bottom:6px;"><strong>BAIRRO:</strong> ${(previewOrder.deliveryNeighborhood||'—').toUpperCase()}</div>
        <div style="margin-bottom:6px;"><strong>PRODUTO:</strong> ${(previewOrder.items[0]?.name||'—').toUpperCase()}</div>
        <div style="margin-top:10px;padding:6px;background:rgba(0,0,0,.05);border-radius:4px;font-size:${Math.max(parseInt(mTam)-2,10)}px;">PREVIEW EM ESCALA REDUZIDA</div>
      </div>
      <div style="display:flex;gap:8px;margin-top:12px;justify-content:center;">
        <button class="btn btn-primary btn-sm" id="btn-save-layout">💾 Salvar</button>
        <button class="btn btn-ghost btn-sm" id="btn-print-comanda-preview">🖨️ Testar</button>
      </div>
    </div>
  </div>`;

  // ─── TAB: ETIQUETAS ─────────────────────────────────────
  const tabEtiquetas = `
  <div class="g2">
    <div>
      <div class="card" style="margin-bottom:14px;">
        <div class="card-title">🏷️ Aparência da Etiqueta <span style="font-size:10px;color:var(--muted);font-weight:400;">(capitalização editável)</span></div>
        <div class="fr2">
          <div class="fg"><label class="fl">Cor de destaque</label>
            <input type="color" class="fi" id="lay-etq-cor" value="${eCor}" style="height:40px;"/></div>
          <div class="fg"><label class="fl">Cor de fundo</label>
            <input type="color" class="fi" id="lay-etq-bg" value="${eBg}" style="height:40px;"/></div>
          <div class="fg"><label class="fl">Fonte</label>
            <select class="fi" id="lay-etq-fonte">
              ${FONTES.map(f=>`<option ${eFonte===f?'selected':''}>${f}</option>`).join('')}
            </select></div>
          <div class="fg"><label class="fl">Tamanho base (px)</label>
            <input class="fi" type="number" id="lay-etq-tam" value="${eTam}" min="10" max="40"/></div>
          <div class="fg"><label class="fl">Largura (mm)</label>
            <input class="fi" type="number" id="lay-etq-largura" value="${eLargura}" min="40" max="200"/></div>
          <div class="fg"><label class="fl">Altura (mm)</label>
            <input class="fi" type="number" id="lay-etq-altura" value="${eAltura}" min="30" max="150"/></div>
        </div>
      </div>
      <div class="card" style="margin-bottom:14px;">
        <div class="card-title">🖼️ Logo da Etiqueta</div>
        <div class="fg">
          <input type="file" id="lay-etq-logo-file" accept="image/png,image/jpeg" style="width:100%;padding:6px;border:1px dashed var(--border);border-radius:8px;"/>
        </div>
        ${layout.labelLogoBase64 ? `<div style="text-align:center;margin-top:10px;padding:10px;background:#f5f5f5;border-radius:8px;">
          <img src="${layout.labelLogoBase64}" style="max-height:50px;"/>
          <button class="btn btn-ghost btn-sm" id="btn-remove-etq-logo" style="display:block;margin:8px auto 0;color:var(--red);">🗑️ Remover</button>
        </div>`:''}
      </div>
      <div class="card">
        <div class="card-title">📝 Texto da Etiqueta</div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:6px;line-height:1.5;">
          Use variáveis: <code>{empresa}</code>, <code>{recipient}</code>, <code>{clientName}</code>,
          <code>{bairro}</code>, <code>{cidade}</code>, <code>{orderNumber}</code>, <code>{scheduledDate}</code>,
          <code>{scheduledTime}</code>, <code>{produto}</code>, <code>{whats}</code>
        </div>
        <textarea class="fi" id="lay-etq-texto" style="width:100%;min-height:100px;font-family:monospace;font-size:12px;">${eTexto}</textarea>
      </div>
    </div>
    <div class="card">
      <div class="card-title">👁️ Preview — Etiqueta</div>
      <div style="margin:0 auto;width:${eLargura}mm;height:${eAltura}mm;border:2px solid ${eCor};background:${eBg};font-family:${eFonte},sans-serif;font-size:${eTam}px;padding:10px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center;gap:6px;overflow:hidden;">
        ${layout.labelLogoBase64?`<img src="${layout.labelLogoBase64}" style="max-height:30px;align-self:center;"/>`:''}
        <div style="white-space:pre-wrap;text-align:center;line-height:1.3;">${applyLabelVars(eTexto, previewOrder, empresa, whats)}</div>
      </div>
      <div style="display:flex;gap:8px;margin-top:12px;justify-content:center;">
        <button class="btn btn-primary btn-sm" id="btn-save-layout">💾 Salvar</button>
        <button class="btn btn-ghost btn-sm" id="btn-print-label-preview">🖨️ Testar</button>
      </div>
    </div>
  </div>`;

  // ─── TAB: OPÇÕES GERAIS ─────────────────────────────────
  const tabOpcoes = `
  <div class="card">
    <div class="card-title">⚙️ Opções de Impressão</div>
    <div style="display:flex;flex-direction:column;gap:10px;">
      ${[
        ['lay-show-logo',      'Mostrar nome/logo da empresa no cartão',  layout.cardMostrarLogo!==false],
        ['lay-show-remetente', 'Mostrar nome do remetente no cartão',      layout.cardMostrarRemetente!==false],
        ['lay-show-foto',      'Mostrar foto do produto na comanda',       layout.comandaMostrarFoto!==false],
        ['lay-show-cartao',    'Mostrar mensagem do cartão na comanda',    layout.comandaMostrarCartao!==false],
        ['lay-show-obs',       'Mostrar observações na comanda',           layout.comandaMostrarObs!==false],
      ].map(([id,lbl,chk])=>`<label class="cb" style="cursor:pointer;"><input type="checkbox" id="${id}" ${chk?'checked':''}/><span style="font-size:12px">${lbl}</span></label>`).join('')}
    </div>
    <div style="margin-top:14px;">
      <button class="btn btn-primary btn-sm" id="btn-save-layout">💾 Salvar Opções</button>
    </div>
  </div>`;

  return `
  <div class="tabs" style="margin-bottom:14px;">
    ${tabBtn('cartao',    '💌 Layout do Cartão')}
    ${tabBtn('comanda',   '🧾 Layout da Comanda')}
    ${tabBtn('etiquetas', '🏷️ Layout das Etiquetas')}
    ${tabBtn('opcoes',    '⚙️ Opções de Impressão')}
  </div>
  ${tab==='cartao'    ? tabCartao
  : tab==='comanda'   ? tabComanda
  : tab==='etiquetas' ? tabEtiquetas
  : tabOpcoes}`;
}

// Substitui variaveis {xxx} no texto da etiqueta pelos dados do pedido
function applyLabelVars(texto, o, empresa, whats){
  const dt = o.scheduledDate ? formatOrderDate(o.scheduledDate, 'curta') : '—';
  return String(texto||'')
    .replace(/\{empresa\}/g,      empresa||'')
    .replace(/\{recipient\}/g,    o.recipient||'—')
    .replace(/\{clientName\}/g,   o.client?.name||o.clientName||'—')
    .replace(/\{bairro\}/g,       o.deliveryNeighborhood||'—')
    .replace(/\{cidade\}/g,       o.deliveryCity||'Manaus')
    .replace(/\{orderNumber\}/g,  o.orderNumber||'—')
    .replace(/\{scheduledDate\}/g, dt)
    .replace(/\{scheduledTime\}/g, o.scheduledTime||'—')
    .replace(/\{produto\}/g,       (o.items||[]).map(i=>i.name).join(', ')||'—')
    .replace(/\{whats\}/g,         whats||'');
}

// ── PRINT CARD ──────────────────────────────────────────────────
export function printCard(orderId){
  const o = S.orders.find(x=>x._id===orderId);
  if(!o) return toast('\u274C Pedido n\u00e3o encontrado');
  const cfg = JSON.parse(localStorage.getItem('fv_config')||'{}');
  const layout = JSON.parse(localStorage.getItem('fv_print_layout')||'{}');
  const cor = layout.cardCor||'#C8436A';
  const fonte = layout.cardFonte||'Georgia';
  const tam = layout.cardTamanho||'16';
  const empresa = layout.nomeEmpresa||cfg.razao||'La\u00e7os Eternos Floricultura';

  const cardHtml = `
    <div style="border:${layout.cardBordaPx||2}px ${layout.cardBorda||'solid'} ${cor};border-radius:16px;padding:28px 32px;max-width:360px;margin:0 auto;text-align:center;font-family:${fonte},serif;background:${layout.cardBg||'#FDF4F7'};">
      ${layout.mostrarLogo!==false?(layout.logoBase64?
        `<img src="${layout.logoBase64}" style="max-height:${layout.logoSize||60}px;max-width:200px;object-fit:contain;margin-bottom:10px;"/>`
        :`<div style="font-size:13px;color:${cor};font-weight:bold;margin-bottom:10px;letter-spacing:1px;">${empresa.toUpperCase()}</div>`
      ):''}
      <div style="font-size:26px;margin-bottom:10px;">\u{1F33A}</div>
      ${layout.mostrarDestinatario!==false?`<div style="font-size:11px;color:#888;margin-bottom:3px;letter-spacing:1px;">PARA:</div><div style="font-size:20px;font-weight:bold;margin-bottom:16px;color:#1A0A10;">${(o.recipient||'\u2014').toUpperCase()}</div>`:''}
      ${layout.mostrarMensagem!==false?`<div style="font-size:${tam}px;font-style:italic;color:#2D1A20;line-height:1.8;padding:14px 16px;background:rgba(255,255,255,.6);border-radius:8px;margin-bottom:14px;">"${o.cardMessage||'Com muito carinho! \u{1F338}'}"</div>`:''}
      ${layout.mostrarData!==false&&o.scheduledDate?`<div style="font-size:11px;color:#9E8090;margin-bottom:8px;">\u{1F4C5} ${formatOrderDate(o.scheduledDate, 'curta')} ${o.scheduledPeriod?'\u00b7 '+o.scheduledPeriod:''}</div>`:''}
      ${layout.mostrarProduto!==false&&(o.items||[]).length?`<div style="font-size:11px;color:#9E8090;margin-bottom:8px;">\u{1F338} ${(o.items||[]).map(i=>i.name).join(', ')}</div>`:''}
      ${layout.mostrarRemetente!==false&&o.identifyClient!==false?`<div style="font-size:12px;color:#9E8090;">\u{1F48C} COM CARINHO DE: <strong>${(o.client?.name||o.clientName||'\u2014').toUpperCase()}</strong></div>`:'<div style="font-size:20px;">\u{1F49D}</div>'}
    </div>`;

  // Show in print modal
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:9999;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;padding:20px;';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:16px;width:100%;max-width:480px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.4);">
      <div style="padding:16px 20px;background:${cor};display:flex;justify-content:space-between;align-items:center;">
        <span style="color:#fff;font-weight:bold;font-size:15px;">\u{1F48C} Cart\u00e3o \u2014 ${o.orderNumber}</span>
        <div style="display:flex;gap:8px;">
          <button onclick="window.print()" style="background:#fff;color:${cor};border:none;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:bold;cursor:pointer;">\u{1F5A8}\uFE0F IMPRIMIR</button>
          <button onclick="this.closest('[data-overlay]').remove()" style="background:rgba(255,255,255,0.2);color:#fff;border:none;padding:8px 12px;border-radius:8px;cursor:pointer;font-size:16px;">\u2715</button>
        </div>
      </div>
      <div style="padding:24px;" id="card-preview-content">
        ${cardHtml}
      </div>
    </div>`;
  overlay.setAttribute('data-overlay','true');
  overlay.addEventListener('click', e=>{ if(e.target===overlay) overlay.remove(); });
  document.body.appendChild(overlay);

  // Add print styles
  const style = document.createElement('style');
  style.id = 'print-style-card';
  style.textContent = `@media print {
    body > *:not([data-overlay]) { display:none!important; }
    [data-overlay] { position:fixed!important;inset:0!important;background:#fff!important;display:flex!important;align-items:center!important;justify-content:center!important; }
    [data-overlay] > div > div:first-child { display:none!important; }
    #card-preview-content { padding:20px!important; }
  }`;
  document.head.appendChild(style);

  overlay.querySelector('[onclick="window.print()"]').addEventListener('click', ()=>{
    window.print();
    setTimeout(()=>{ document.getElementById('print-style-card')?.remove(); }, 1000);
  });
  overlay.querySelector('[onclick*="remove"]').addEventListener('click', ()=>{
    overlay.remove();
    document.getElementById('print-style-card')?.remove();
  });

  S._printedCard = {...(S._printedCard||{}), [orderId]:true};
  localStorage.setItem('fv_printed_card', JSON.stringify(S._printedCard));
  render();
}

// ── PRINT COMANDA ───────────────────────────────────────────────
// Antes de imprimir, garante que os produtos do pedido tem imagem
// carregada em S.products (caso a listagem inicial tenha vindo lite).
async function ensureProductImagesForOrder(orderId){
  try {
    const o = S.orders.find(x => x._id === orderId);
    if (!o || !Array.isArray(o.items)) return;
    const need = [];
    for (const it of o.items) {
      const pid = it.product;
      if (!pid || !/^[a-f0-9]{24}$/i.test(String(pid))) continue;
      const p = S.products.find(x => String(x._id) === String(pid));
      if (p && !(p.imagem || p.images?.[0] || p.image)) {
        need.push(pid);
      }
    }
    if (!need.length) return;
    const tk = S.token || localStorage.getItem('fv2_token') || '';
    const res = await fetch(API + '/products/images?ids=' + encodeURIComponent(need.join(',')), {
      headers: { 'Authorization':'Bearer '+tk }
    });
    if (!res.ok) return;
    const map = await res.json();
    for (const id of Object.keys(map||{})) {
      const p = S.products.find(x => String(x._id) === String(id));
      if (p && map[id]) p.imagem = map[id];
    }
  } catch(_){}
}

export async function printComanda(orderId){
  console.log('[printComanda] chamado com orderId=', orderId);
  try {
    await ensureProductImagesForOrder(orderId);
    return _printComandaInternal(orderId);
  } catch (err) {
    console.error('[printComanda] ERRO:', err);
    try {
      const msg = (err?.message || err || 'erro desconhecido');
      if (typeof toast === 'function') toast('❌ Erro ao imprimir: ' + msg, true);
      else alert('Erro ao imprimir: ' + msg);
    } catch(_){}
  }
}

// ── PRINT BATCH (CHAO DE DATAS) ────────────────────────────────
// Imprime VARIAS comandas em UM UNICO job de impressao.
// Antes: chamada antiga abria N overlays empilhadas (uma por pedido) e
// travava o navegador. Agora: combina tudo em 1 documento HTML, abre 1
// iframe so, 1 click de imprimir manda tudo pra impressora de uma vez.
export async function printComandasBatch(orderIds) {
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    try { toast('Nenhuma comanda para imprimir', true); } catch(_){}
    return;
  }

  try {
    // Carrega imagens dos produtos de TODOS os pedidos antes de gerar HTML
    for (const id of orderIds) {
      try { await ensureProductImagesForOrder(id); } catch(_){}
    }

    // Coleta o HTML de cada comanda (em modo batch — so o pageHtml)
    const partes = [];
    let cmdFonte = 'Arial', cmdTam = '14', cmdBg = '#FFFFFF';
    for (const id of orderIds) {
      const r = _printComandaInternal(id, { returnHtml: true });
      if (r && r.pageHtml) {
        partes.push(r.pageHtml);
        cmdFonte = r.cmdFonte; cmdTam = r.cmdTam; cmdBg = r.cmdBg;
      }
    }
    if (partes.length === 0) {
      try { toast('Nenhuma comanda valida pra imprimir', true); } catch(_){}
      return;
    }

    // Doc HTML consolidado: 1 estilo + N paginas separadas por page-break
    const htmlDoc = `<!DOCTYPE html>
<html><head><title>Comandas em massa (${partes.length})</title>
<meta charset="utf-8"/>
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{background:#f0f0f0;font-family:${cmdFonte},Arial,sans-serif;font-size:${cmdTam}px;text-transform:uppercase;}
  .page{
    width:210mm;
    height:297mm;
    margin:0 auto 8mm auto;
    background:${cmdBg};
    page-break-after:always;
    break-after:page;
  }
  .page:last-child { page-break-after: auto; break-after: auto; margin-bottom:0; }
  .comanda{
    width:210mm;
    height:148mm;
    background:${cmdBg};
    overflow:hidden;
    box-sizing:border-box;
    position:relative;
    page-break-inside:avoid;
    break-inside:avoid;
  }
  .comanda.tipo-arquivo{ border-bottom:2px dashed #888; }
  .cut-label{
    position:absolute; bottom:-9px; left:50%;
    transform:translateX(-50%);
    background:#fff; padding:0 14px; font-size:9px; color:#888;
    white-space:nowrap; font-family:Arial; letter-spacing:2px; z-index:5;
  }
  @media print{
    body{background:#fff;margin:0;}
    .page{width:100%;height:auto;margin:0;page-break-after:always;}
    .page:last-child{page-break-after:auto;}
    .comanda{width:100%;height:50vh;box-shadow:none;overflow:hidden;page-break-inside:avoid;break-inside:avoid;}
    @page{size:A4 portrait;margin:0;}
  }
</style></head>
<body>
${partes.join('\n')}
</body></html>`;

    // Overlay UNICO com iframe + botao Imprimir
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:20px;overflow-y:auto;';
    overlay.setAttribute('data-overlay','true');
    const box = document.createElement('div');
    box.style.cssText = 'background:#fff;border-radius:16px;width:100%;max-width:960px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.4);margin:auto;';
    box.innerHTML = `
      <div style="padding:14px 20px;background:#8B2252;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;z-index:10;">
        <span style="color:#fff;font-weight:bold;font-size:15px;">🧾 Comandas em massa — ${partes.length} pedido(s)</span>
        <div style="display:flex;gap:8px;">
          <button id="btn-do-print-batch" style="background:#fff;color:#8B2252;border:none;padding:8px 18px;border-radius:8px;font-size:13px;font-weight:bold;cursor:pointer;">🖨️ IMPRIMIR TODAS (A4)</button>
          <button id="btn-close-overlay-batch" style="background:rgba(255,255,255,0.2);color:#fff;border:none;padding:8px 12px;border-radius:8px;cursor:pointer;font-size:16px;">✕</button>
        </div>
      </div>
      <div style="padding:8px 14px;background:#FEF3C7;border-bottom:1px solid #FCD34D;font-size:12px;color:#92400E;">
        💡 Dica: clique em <b>IMPRIMIR TODAS</b> uma única vez — o navegador vai imprimir as ${partes.length} comandas em sequência.
      </div>
      <div style="padding:16px;background:#f5f5f5;">
        <iframe id="comanda-iframe-batch" style="width:100%;height:700px;border:none;border-radius:8px;background:#fff;"></iframe>
      </div>`;
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    setTimeout(() => {
      const iframe = document.getElementById('comanda-iframe-batch');
      if (iframe) {
        iframe.contentDocument.open();
        iframe.contentDocument.write(htmlDoc);
        iframe.contentDocument.close();
      }
    }, 50);

    document.getElementById('btn-do-print-batch')?.addEventListener('click', () => {
      const iframe = document.getElementById('comanda-iframe-batch');
      if (iframe) iframe.contentWindow.print();
      // Marca todos como impressos
      const printed = JSON.parse(localStorage.getItem('fv_printed_comanda')||'{}');
      orderIds.forEach(id => { printed[id] = true; });
      localStorage.setItem('fv_printed_comanda', JSON.stringify(printed));
      S._printedComanda = printed;
    });
    const close = () => overlay.remove();
    document.getElementById('btn-close-overlay-batch')?.addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  } catch (err) {
    console.error('[printComandasBatch] ERRO:', err);
    try {
      if (typeof toast === 'function') toast('❌ Erro ao imprimir lote: ' + (err?.message || err), true);
      else alert('Erro ao imprimir lote: ' + (err?.message || err));
    } catch(_){}
  }
}

function _printComandaInternal(orderId, opts){
  // Modo BATCH: opts.returnHtml=true -> retorna { htmlDoc, pageHtml, styleHtml }
  // ao inves de criar overlay. Usado por printComandasBatch para combinar
  // varias comandas em um unico job de impressao (sem abrir N overlays).
  opts = opts || {};
  const o = S.orders.find(x=>x._id===orderId);
  if(!o) {
    console.warn('[printComanda] pedido nao encontrado:', orderId, 'total em S.orders=', S.orders?.length);
    if (opts.returnHtml) return null;
    try { if (typeof toast === 'function') toast('❌ Pedido não encontrado', true); } catch(_){}
    return;
  }
  const cfg    = JSON.parse(localStorage.getItem('fv_config')||'{}');
  const layout = JSON.parse(localStorage.getItem('fv_print_layout')||'{}');
  const cor    = layout.comandaCor||'#8B2252';
  const cmdBg  = layout.comandaBg||'#FFFFFF';
  const cmdFonte = layout.comandaFonte||'Arial';
  const cmdTam   = layout.comandaTamanho||'14';
  const empresa= (layout.nomeEmpresa||cfg.razao||'LA\u00c7OS ETERNOS FLORICULTURA').toUpperCase();
  const whats  = layout.whatsapp||cfg.whats||'(92) 99300-2433';
  const UC     = s => s ? String(s).toUpperCase().trim() : '';

  // ── NUMERO DO PEDIDO formatado como #00001 ─────────────────
  const rawNum = o.orderNumber || o.numero || '';
  const numStr = String(rawNum).replace(/^PED-?/i,'').replace(/^#/,'');
  const numMatch = numStr.match(/\d+/);
  const orderNumFmt = numMatch
    ? '#' + numMatch[0].padStart(5,'0')
    : (numStr ? '#'+numStr : '#00000');

  // ── DATA / TURNO / HORARIO ──────────────────────────────────
  const dataEntrega = o.scheduledDate
    ? formatOrderDate(o.scheduledDate, 'comanda').toUpperCase()
    : '\u2014';
  const turno   = UC(o.scheduledPeriod||'');
  // Monta exibicao do horario considerando janela (Horario Especifico)
  // Retorna so os horarios (sem emoji) — o template ja coloca o ⏰
  let horario = '';
  if (o.scheduledTime && o.scheduledTime !== '00:00') {
    horario = UC(o.scheduledTime);
    if (o.scheduledTimeEnd && o.scheduledTimeEnd !== '00:00' && o.scheduledTimeEnd !== o.scheduledTime) {
      horario = `${UC(o.scheduledTime)} \u00E0S ${UC(o.scheduledTimeEnd)}`;
    }
  }
  // Label combinado (compatibilidade com templates antigos)
  const dtLabel = [dataEntrega, turno, horario].filter(Boolean).join(' \u00B7 ');

  // Detecta se e "Horario Especifico" (janela de horario) — sem regex
  // para evitar possiveis problemas de transpile com caracteres unicode
  const periodoLow = String(o.scheduledPeriod || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''); // remove acentos
  const isHorarioEspecifico = periodoLow.includes('horario especifico')
    || (o.scheduledTimeEnd && o.scheduledTimeEnd !== '00:00' && o.scheduledTimeEnd !== o.scheduledTime);
  // Badge GRANDE para destacar na comanda (fundo amarelo alerta)
  const horarioEspecificoBadge = isHorarioEspecifico && horario
    ? `<div style="background:#FEF3C7;border:3px solid #F59E0B;border-radius:10px;padding:10px 16px;text-align:center;font-size:18px;font-weight:900;color:#92400E;margin:6px 0;letter-spacing:.5px;box-shadow:0 2px 6px rgba(245,158,11,.3);">
        \u23F0 HOR\u00C1RIO ESPEC\u00CDFICO: ${horario}
       </div>` : '';

  // ── ENTREGADOR ─────────────────────────────────────────────
  const entregador = UC(o.driverName||'A DEFINIR');

  // ── TIER / N\u00CDVEL DO CLIENTE (CRM) ──────────────────────
  const clientStats = getClientWithStats({
    _id: o.client?._id || o.client,
    phone: o.clientPhone,
    clientPhone: o.clientPhone,
  });
  const tier = clientStats ? getClientTier(clientStats) : null;
  const tierBadgePrint = tier ? `<span style="display:inline-flex;align-items:center;gap:4px;background:${tier.bg};color:${tier.color};border:1.5px solid ${tier.border};border-radius:20px;padding:2px 9px;font-size:11px;font-weight:800;margin-left:6px;text-transform:uppercase;letter-spacing:.5px;vertical-align:middle;"><span style="font-size:14px;line-height:1;">${tier.icon}</span><span>${tier.label}</span></span>` : '';

  // Numero do pedido na sequencia historica do cliente (ex: 4o pedido)
  const numPedidoCliente = clientStats ? (parseInt(clientStats.totalOrders)||0) : 0;
  const numPedidoBadge = numPedidoCliente > 0
    ? `<div style="background:#FEF3C7;border:1.5px solid #F59E0B;border-radius:6px;padding:4px 10px;font-size:12px;font-weight:800;color:#78350F;margin:4px 0;text-align:center;">${numPedidoCliente}\u00BA PEDIDO DESTE CLIENTE</div>`
    : '';

  // ── ENDERECO COMPLETO ─────────────────────────────────────
  const rua   = [UC(o.deliveryStreet||''), o.deliveryNumber?'N\u00ba '+UC(o.deliveryNumber):''].filter(Boolean).join(', ');
  const bairro= UC(o.deliveryNeighborhood||o.deliveryZone||'');
  const cidade= UC(o.deliveryCity||'MANAUS');
  const cond  = o.isCondominium ? [o.condName?UC(o.condName):'', o.block?'BLOCO '+UC(o.block):'', o.apt?'AP '+UC(o.apt):''].filter(Boolean).join(' \u2014 ') : '';
  // REF = referencia do endereco (ex: "casa azul, ao lado da padaria")
  const ref   = UC(o.deliveryReference||'');
  // OBS = observacoes do PDV (anotadas pelo atendimento — ex: "tocar interfone 2x")
  // Mantido SEPARADO do ref pra ficar claro o que e uma coisa e outra.
  const obsTxt = String(o.notes || o.observacoes || '').trim();
  const phone = o.recipientPhone||'';

  // ── BLOCO OBSERVACOES (PDV) ────────────────────────────────
  // Aparece destacado em amarelo nas duas vias (CD e Entregador).
  // Respeita a config layout.comandaMostrarObs (default true).
  const mostrarObs = (layout.comandaMostrarObs !== false) && obsTxt.length > 0;
  const obsBlock = mostrarObs
    ? `<div style="background:#FEF9C3;border:2px solid #CA8A04;border-radius:8px;padding:8px 12px;margin-bottom:6px;">
        <div style="font-size:10px;font-weight:800;color:#713F12;letter-spacing:1px;margin-bottom:3px;">📝 OBSERVAÇÕES DO PEDIDO</div>
        <div style="font-size:14px;font-weight:700;color:#422006;line-height:1.3;text-transform:none;">${obsTxt}</div>
       </div>`
    : '';

  // ── ITENS COM FOTO ─────────────────────────────────────────
  // Truncate helper: corta nomes/descricoes longas para evitar
  // estourar a A4 com texto enorme.
  const truncate = (s, max) => {
    const t = String(s||'').trim();
    return t.length > max ? t.slice(0, max-1) + '\u2026' : t;
  };
  const itemsHtml = (o.items||[]).map(i=>{
    const prod = S.products.find(p=>p._id===i.product||p.name===i.name);
    const img  = prod?.imagem || prod?.images?.[0] || prod?.image || '';
    const foto = img
      ? `<img src="${img}" style="width:72px;height:72px;object-fit:cover;border-radius:6px;border:2px solid ${cor};flex-shrink:0;"/>`
      : `<div style="width:72px;height:72px;border-radius:6px;background:#F5D6E0;display:flex;align-items:center;justify-content:center;font-size:32px;flex-shrink:0;">\u{1F338}</div>`;
    const complements = [prod?.productionNotes, i.complement, i.notes].filter(Boolean).map(c => truncate(c, 90));
    return `<div style="display:flex;align-items:center;gap:12px;padding:5px 0;border-bottom:1px solid #e5e5e5;">
      ${foto}
      <div style="flex:1;min-width:0;">
        <div style="font-size:17px;font-weight:900;color:#111;line-height:1.2;">${UC(i.qty)}\u00d7 ${UC(truncate(i.name, 60))}</div>
        ${complements.map(c=>`<div style="font-size:11px;color:#555;margin-top:3px;line-height:1.25;">\u{1F4CB} ${UC(c)}</div>`).join('')}
      </div>
    </div>`;
  }).join('');

  // ── QR CODE: leva para a página pública do pedido (sem login) ──
  const appOrigin = window.location.origin; // ex: https://sistema.floriculturalacoseternos.com.br
  const qrUrl   = `${appOrigin}/entrega/${orderId}`;
  const qrSrc   = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(qrUrl)}&margin=4&bgcolor=ffffff&color=1a1a1a`;

  // ── BLOCO ENDERECO (reutilizado nas 2 vias) ────────────────
  const enderecoBlock = (accentColor) => `
    <div style="background:#f8f8f8;border-left:5px solid ${accentColor};border-radius:0 8px 8px 0;padding:12px 14px;margin-bottom:6px;">
      <div style="font-size:10px;color:#555;font-weight:700;letter-spacing:1px;margin-bottom:4px;">\u{1F4CD} ENDERE\u00c7O</div>
      ${rua?`<div style="font-size:17px;font-weight:800;color:#111;text-transform:uppercase;">${rua}</div>`:''}
      ${bairro?`<div style="font-size:19px;font-weight:900;color:#111;margin-top:3px;text-transform:uppercase;">${bairro} \u2014 ${cidade}</div>`:''}
      ${cond?`<div style="font-size:14px;font-weight:700;color:#333;margin-top:3px;">\u{1F3E2} ${cond}</div>`:''}
      ${ref?`<div style="font-size:13px;color:#555;margin-top:3px;">\u{1F4CD} REF: ${ref}</div>`:''}
      ${phone?`<div style="font-size:13px;color:#333;margin-top:3px;text-transform:none;font-weight:700;">\u{1F4F1} ${phone}</div>`:''}
    </div>`;

  // ── COBRANCA ────────────────────────────────────────────────
  // Caso 1: DINHEIRO  → destaca valor + troco / sem troco
  // Caso 2: LEVAR MAQUINETA → destaca aceitar Debito/Credito/Pix
  // Caso 3: PIX → destaca receber via Pix
  // Caso 4: outro → alerta para verificar
  const _totalFmt = (o.total||0).toFixed(2).replace('.',',');
  let _detalheEntrega = '';
  if (o.payment === 'Pagar na Entrega') {
    const _pod = String(o.paymentOnDelivery||'').toLowerCase().trim();
    if (_pod === 'dinheiro') {
      const _trocoP = parseFloat(o.trocoPara||0);
      const _temTroco = _trocoP > (o.total||0);
      const _semTroco = !o.trocoPara || _trocoP === 0;
      _detalheEntrega = '<div style="background:#FEF3C7;border-left:5px solid #B45309;padding:6px 10px;margin-top:5px;border-radius:0 6px 6px 0;">'
        + '<div style="font-size:13px;font-weight:900;color:#7C2D12;">💵 RECEBER EM DINHEIRO</div>'
        + (_temTroco
            ? '<div style="font-size:14px;font-weight:900;color:#065F46;margin-top:3px;">💰 TROCO P/ R$ ' + _trocoP.toFixed(2).replace('.',',') + ' — LEVAR R$ ' + (_trocoP - (o.total||0)).toFixed(2).replace('.',',') + '</div>'
            : (_semTroco
                ? '<div style="font-size:13px;font-weight:800;color:#7C2D12;margin-top:3px;">⚠️ NAO PRECISA DE TROCO (cliente paga valor exato)</div>'
                : '<div style="font-size:13px;font-weight:800;color:#7C2D12;margin-top:3px;">ℹ️ Cliente paga R$ ' + _trocoP.toFixed(2).replace('.',',') + ' (sem troco)</div>'
              )
          )
        + '</div>';
    } else if (_pod === 'levar maquineta' || _pod === 'maquineta' || _pod === 'maquina' || _pod === 'cartao' || _pod === 'cartão') {
      _detalheEntrega = '<div style="background:#DBEAFE;border-left:5px solid #1D4ED8;padding:6px 10px;margin-top:5px;border-radius:0 6px 6px 0;">'
        + '<div style="font-size:13px;font-weight:900;color:#1E3A8A;">💳 LEVAR MAQUINETA</div>'
        + '<div style="font-size:11px;font-weight:700;color:#1E3A8A;margin-top:2px;text-transform:none;">Aceitar Débito / Crédito / Pix</div>'
        + '</div>';
    } else if (_pod === 'pix') {
      _detalheEntrega = '<div style="background:#DCFCE7;border-left:5px solid #15803D;padding:6px 10px;margin-top:5px;border-radius:0 6px 6px 0;">'
        + '<div style="font-size:13px;font-weight:900;color:#14532D;">📲 RECEBER VIA PIX</div>'
        + '</div>';
    } else {
      _detalheEntrega = '<div style="background:#FEE2E2;border-left:5px solid #DC2626;padding:6px 10px;margin-top:5px;border-radius:0 6px 6px 0;">'
        + '<div style="font-size:13px;font-weight:900;color:#7F1D1D;">⚠️ FORMA DE PAGAMENTO NÃO DEFINIDA — VERIFICAR COM CLIENTE</div>'
        + '</div>';
    }
  }
  // (variavel mantida pra compat — agora retorna vazio porque info ja esta em _detalheEntrega)
  const trocoLinha = (o.paymentOnDelivery === 'Dinheiro' && o.trocoPara && parseFloat(o.trocoPara) > (o.total||0))
    ? `<div style="background:#D1FAE5;border:2px solid #059669;border-radius:6px;padding:6px 10px;text-align:center;font-size:14px;font-weight:900;color:#065F46;margin-top:4px;">
        \uD83D\uDCB0 TROCO P/ R$ ${parseFloat(o.trocoPara).toFixed(2).replace('.',',')} \u2014 LEVAR R$ ${(parseFloat(o.trocoPara) - (o.total||0)).toFixed(2).replace('.',',')}
       </div>` : '';
  const cobrancaBlock = o.payment==='Pagar na Entrega'
    ? `<div style="margin-bottom:6px;">
         <div style="background:#FFF8E1;border:2px solid #B7860F;border-radius:6px;padding:8px 10px;text-align:center;font-size:16px;font-weight:900;color:#8B6914;">
           \u{1F4B0} COBRAR NA ENTREGA: R$ ${_totalFmt}
         </div>
         ${_detalheEntrega}
       </div>` : '';

  // ═══════════════════════════════════════════════════════════
  // VIA CD -- Arquivo interno
  // ═══════════════════════════════════════════════════════════
  const viaCD = `
  <div style="padding:8px 14px;font-family:Arial,sans-serif;text-transform:uppercase;box-sizing:border-box;width:100%;height:100%;display:flex;flex-direction:column;gap:4px;">

    <!-- Header CD -->
    <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid ${cor};padding-bottom:4px;">
      <div>
        <div style="font-size:12px;font-weight:900;color:${cor};">${empresa}</div>
        <div style="font-size:9px;color:#555;text-transform:none;">${whats}</div>
        <div style="background:${cor};color:#fff;display:inline-block;padding:1px 7px;border-radius:20px;font-size:9px;font-weight:700;margin-top:2px;">\u{1F4C2} VIA CD \u2014 ARQUIVO</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:24px;font-weight:900;color:#111;line-height:1;">${orderNumFmt}</div>
        <div style="font-size:8px;color:#666;">PEDIDO</div>
      </div>
    </div>

    <!-- Produto -->
    <div>${itemsHtml}</div>

    <!-- Grid dados -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
      <div style="background:#FDF4F7;border-radius:6px;padding:8px;border-left:4px solid ${cor};">
        <div style="font-size:9px;color:#888;margin-bottom:2px;">DESTINAT\u00c1RIO</div>
        <div style="font-size:20px;font-weight:900;color:${cor};text-transform:uppercase;">${UC(o.recipient||o.client?.name||'\u2014')}</div>
      </div>
      <div style="background:#f5f5f5;border-radius:6px;padding:8px;">
        <div style="font-size:9px;color:#888;margin-bottom:2px;">REMETENTE${clientStats?.code?` · <span style="color:#8B2252;font-weight:700;">#${clientStats.code}</span>`:''}</div>
        <div style="font-size:13px;font-weight:700;">${UC(o.client?.name||o.clientName||'\u2014')}${tierBadgePrint}</div>
        ${numPedidoBadge}
      </div>
      <div style="background:#f5f5f5;border-radius:6px;padding:8px;grid-column:span 2;">
        <div style="font-size:9px;color:#888;margin-bottom:2px;">\u{1F4C5} ENTREGA \u00b7 TURNO \u00b7 HOR\u00c1RIO</div>
        <div style="font-size:16px;font-weight:900;">${dtLabel||'\u2014'}</div>
      </div>
    </div>

    <!-- Endereco -->
    ${enderecoBlock(cor)}

    <!-- Cartao -->
    ${o.cardMessage?`<div style="background:#FDF4F7;border-left:4px solid ${cor};padding:5px 10px;border-radius:0 6px 6px 0;font-size:10px;text-transform:none;line-height:1.3;">
      \u{1F48C} <strong>CART\u00c3O:</strong> "${truncate(o.cardMessage, 240)}" ${o.identifyClient!==false?'\u2014 DE: '+UC(o.client?.name||o.clientName||''):'\u2014 AN\u00d4NIMO'}</div>`:''}

    <!-- Horario Especifico (destaque se aplicavel) -->
    ${horarioEspecificoBadge}

    <!-- Observacoes do PDV (se houver) -->
    ${obsBlock}

    <!-- Cobranca -->
    ${cobrancaBlock}

    <!-- Entregador + QR -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-top:auto;padding-top:6px;border-top:1px dashed #bbb;">
      <div>
        <div style="font-size:9px;color:#888;">ENTREGADOR</div>
        <div style="font-size:14px;font-weight:900;color:#333;">${entregador}</div>
      </div>
      <div style="text-align:center;">
        <img src="${qrSrc}" style="width:60px;height:60px;"/>
        <div style="font-size:8px;color:#888;margin-top:1px;">QR BAIXA ENTREGA</div>
      </div>
    </div>
  </div>`;

  // ═══════════════════════════════════════════════════════════
  // VIA ENTREGADOR -- Campo de assinatura e foto
  // ═══════════════════════════════════════════════════════════
  const floriAddr  = UC(cfg.addr||'');
  const floriEmail = (cfg.email||'').toLowerCase();
  const floriSite  = (layout.site||cfg.site||'').toLowerCase();

  const viaEntregador = `
  <div style="padding:8px 14px;font-family:Arial,sans-serif;text-transform:uppercase;box-sizing:border-box;width:100%;height:100%;display:flex;flex-direction:column;gap:4px;">

    <!-- Header Entregador -->
    <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #333;padding-bottom:4px;">
      <div>
        <div style="font-size:12px;font-weight:900;color:#111;">${empresa}</div>
        <div style="background:#333;color:#fff;display:inline-block;padding:1px 7px;border-radius:20px;font-size:9px;font-weight:700;margin-top:2px;">\u{1F69A} VIA ENTREGADOR</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:24px;font-weight:900;color:#111;line-height:1;">${orderNumFmt}</div>
        <div style="font-size:8px;color:#666;">PEDIDO</div>
      </div>
    </div>

    <!-- Produto (com foto para conferencia) -->
    <div>${itemsHtml}</div>

    <!-- DESTINATARIO + TURNO/HORARIO ampliados -->
    <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:5px;">
      <div style="background:#f5f5f5;border-left:5px solid #333;border-radius:0 8px 8px 0;padding:8px 12px;">
        <div style="font-size:10px;color:#555;font-weight:700;letter-spacing:.5px;">\u{1F4E6} DESTINAT\u00c1RIO</div>
        <div style="font-size:20px;font-weight:900;color:#111;line-height:1.15;text-transform:uppercase;margin-top:2px;">${UC(truncate(o.recipient||'\u2014',30))}</div>
      </div>
      <div style="background:#C8436A;border-radius:8px;padding:7px 10px;text-align:center;display:flex;flex-direction:column;justify-content:center;">
        <div style="font-size:10px;color:rgba(255,255,255,.85);font-weight:700;">\u{1F4C5} ${UC(o.scheduledDate?formatOrderDate(o.scheduledDate,'curta'):'\u2014')}</div>
        <div style="font-size:16px;font-weight:900;color:#FFD700;line-height:1.1;">${UC(turno||'\u2014')}</div>
        ${horario?`<div style="font-size:13px;font-weight:900;color:#fff;background:rgba(0,0,0,0.3);border-radius:4px;padding:2px 6px;margin-top:3px;">\u23f0 ${UC(horario)}</div>`:''}
      </div>
    </div>

    <!-- Endereco AMPLIADO -->
    <div style="background:#f8f8f8;border-left:5px solid #1E5AA8;border-radius:0 8px 8px 0;padding:8px 12px;">
      <div style="font-size:10px;color:#555;font-weight:700;letter-spacing:.5px;">\u{1F4CD} ENDERE\u00c7O</div>
      ${rua?`<div style="font-size:16px;font-weight:800;color:#111;line-height:1.2;margin-top:2px;">${UC(truncate(rua,60))}</div>`:''}
      ${bairro?`<div style="font-size:18px;font-weight:900;color:#1E5AA8;line-height:1.15;margin-top:2px;">${UC(bairro)} \u2014 ${UC(cidade)}</div>`:''}
      ${cond?`<div style="font-size:13px;font-weight:700;color:#333;line-height:1.2;margin-top:2px;">\u{1F3E2} ${UC(truncate(cond,55))}</div>`:''}
      ${ref?`<div style="font-size:11px;color:#555;line-height:1.2;margin-top:2px;">\u{1F4CD} REF: ${UC(truncate(ref,70))}</div>`:''}
    </div>

    <!-- Horario Especifico -->
    ${horarioEspecificoBadge}

    <!-- Observacoes do PDV (se houver) -->
    ${obsBlock}

    <!-- Cobranca -->
    ${cobrancaBlock}

    <!-- Entregador + QR -->
    <div style="display:flex;align-items:center;justify-content:space-between;background:#f0f0f0;border-radius:6px;padding:6px 10px;border-top:1px dashed #aaa;">
      <div>
        <div style="font-size:9px;color:#555;font-weight:700;">ENTREGADOR RESPONSÁVEL</div>
        <div style="font-size:14px;font-weight:900;color:#111;line-height:1.1;">${UC(truncate(entregador,28))}</div>
      </div>
      <div style="text-align:center;">
        <img src="${qrSrc}" style="width:54px;height:54px;"/>
        <div style="font-size:7px;color:#555;text-transform:none;">QR = ENTREGUE ✅</div>
      </div>
    </div>

    <!-- Recebimento: nome / assinatura / data e hora -->
    <div style="margin-top:auto;padding-top:6px;border-top:1px dashed #aaa;">
      <div style="font-size:9px;color:#666;font-weight:700;letter-spacing:.5px;">NOME DE QUEM RECEBE</div>
      <div style="border-bottom:1.5px solid #333;height:18px;"></div>
      <div style="font-size:9px;color:#666;font-weight:700;letter-spacing:.5px;margin-top:6px;">ASSINATURA</div>
      <div style="border-bottom:1.5px solid #333;height:18px;"></div>
      <div style="font-size:9px;color:#666;font-weight:700;letter-spacing:.5px;margin-top:6px;">DATA E HORA DA ENTREGA</div>
      <div style="border-bottom:1.5px solid #333;height:18px;"></div>
    </div>
  </div>`;

  // ── HTML final ─────────────────────────────────────────────
  const htmlDoc = `<!DOCTYPE html>
<html><head><title>Comanda \u2014 ${orderNumFmt}</title>
<meta charset="utf-8"/>
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{background:#f0f0f0;font-family:${cmdFonte},Arial,sans-serif;font-size:${cmdTam}px;text-transform:uppercase;}
  .page{width:210mm;margin:0 auto;background:${cmdBg};}
  /* AS DUAS VIAS EM 1 SO A4 — corta no meio:
     - Cima: arquivo CD (148mm)
     - Baixo: entregador (148mm)
     overflow:hidden garante que conteudo grande nao empurra. */
  .page{
    width:210mm;
    height:297mm;
    margin:0 auto;
    background:${cmdBg};
    page-break-after:auto;
  }
  .comanda{
    width:210mm;
    height:148mm;          /* metade exata de A4 */
    background:${cmdBg};
    overflow:hidden;
    box-sizing:border-box;
    position:relative;
    page-break-inside:avoid;
    break-inside:avoid;
  }
  .comanda.tipo-arquivo{
    border-bottom:2px dashed #888;
  }
  .cut-label{
    position:absolute;
    bottom:-9px;
    left:50%;
    transform:translateX(-50%);
    background:#fff;
    padding:0 14px;
    font-size:9px;
    color:#888;
    white-space:nowrap;
    font-family:Arial;
    letter-spacing:2px;
    z-index:5;
  }
  .btn-print{display:block;margin:16px auto;background:#8B2252;color:#fff;border:none;padding:12px 36px;border-radius:8px;font-size:15px;cursor:pointer;font-family:Arial;font-weight:bold;}
  @media print{
    body{background:#fff;margin:0;}
    .btn-print{display:none!important;}
    .page{width:100%;height:auto;margin:0;}
    .comanda{
      width:100%;
      height:50vh;
      box-shadow:none;
      overflow:hidden;
      page-break-inside:avoid;
      break-inside:avoid;
      page-break-after:avoid;
      break-after:avoid;
    }
    @page{size:A4 portrait;margin:0;}
  }
</style></head>
<body>
<button class="btn-print" onclick="window.print()">\u{1F5A8}\uFE0F Imprimir Comanda (A4)</button>
${(() => {
  // Marker pra extrair o style + body em modo batch (sem regex pesada)
  return '';
})()}<div class="page">
  <div class="comanda tipo-arquivo">
    ${viaCD}
    <div class="cut-label">✂ ─────── DESTACAR AQUI ─────── ✂</div>
  </div>
  <div class="comanda tipo-entregador">
    ${viaEntregador}
  </div>
</div>
</body></html>`;

  // Modo BATCH: retorna apenas o HTML de uma pagina (sem o wrapper completo)
  // pra que printComandasBatch combine multiplas paginas com page-break.
  if (opts.returnHtml) {
    const pageHtml = `<div class="page">
      <div class="comanda tipo-arquivo">
        ${viaCD}
        <div class="cut-label">✂ ─────── DESTACAR AQUI ─────── ✂</div>
      </div>
      <div class="comanda tipo-entregador">
        ${viaEntregador}
      </div>
    </div>`;
    return {
      htmlDoc,
      pageHtml,
      orderNumFmt,
      cmdFonte, cmdTam, cmdBg,
    };
  }

  // ── Overlay preview ─────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:20px;overflow-y:auto;';
  overlay.setAttribute('data-overlay','true');
  const box = document.createElement('div');
  box.style.cssText = 'background:#fff;border-radius:16px;width:100%;max-width:960px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.4);margin:auto;';
  box.innerHTML = `
    <div style="padding:14px 20px;background:#8B2252;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;z-index:10;">
      <span style="color:#fff;font-weight:bold;font-size:15px;">\u{1F9FE} Comanda \u2014 ${orderNumFmt} \u00b7 ${UC(o.recipient||'')}</span>
      <div style="display:flex;gap:8px;">
        <button id="btn-do-print" style="background:#fff;color:#8B2252;border:none;padding:8px 18px;border-radius:8px;font-size:13px;font-weight:bold;cursor:pointer;">\u{1F5A8}\uFE0F IMPRIMIR A4</button>
        <button id="btn-close-overlay" style="background:rgba(255,255,255,0.2);color:#fff;border:none;padding:8px 12px;border-radius:8px;cursor:pointer;font-size:16px;">\u2715</button>
      </div>
    </div>
    <div style="padding:16px;background:#f5f5f5;">
      <iframe id="comanda-iframe" style="width:100%;height:700px;border:none;border-radius:8px;background:#fff;"></iframe>
    </div>`;
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  setTimeout(()=>{
    const iframe = document.getElementById('comanda-iframe');
    if(iframe){ iframe.contentDocument.open(); iframe.contentDocument.write(htmlDoc); iframe.contentDocument.close(); }
  },50);

  document.getElementById('btn-do-print')?.addEventListener('click',()=>{
    const iframe = document.getElementById('comanda-iframe');
    if(iframe) iframe.contentWindow.print();
    S._printedComanda={...(S._printedComanda||{}),[orderId]:true};
    localStorage.setItem('fv_printed_comanda',JSON.stringify(S._printedComanda));
    render();
  });
  document.getElementById('btn-close-overlay')?.addEventListener('click',()=>overlay.remove());
  overlay.addEventListener('click',e=>{ if(e.target===overlay) overlay.remove(); });

  S._printedComanda={...(S._printedComanda||{}),[orderId]:true};
  localStorage.setItem('fv_printed_comanda',JSON.stringify(S._printedComanda));
  render();
}

// ── PRINT LABEL (Etiqueta) ─────────────────────────────────────
export function printLabel(orderId){
  const o = S.orders.find(x=>x._id===orderId);
  if(!o) { toast('❌ Pedido não encontrado', true); return; }
  const cfg    = JSON.parse(localStorage.getItem('fv_config')||'{}');
  const layout = JSON.parse(localStorage.getItem('fv_print_layout')||'{}');

  const eCor    = layout.labelCor     || '#1E5AA8';
  const eBg     = layout.labelBg      || '#FFFFFF';
  const eFonte  = layout.labelFonte   || 'Arial';
  const eTam    = layout.labelTamanho || '18';
  const eLargura= layout.labelLargura || '100';
  const eAltura = layout.labelAltura  || '50';
  const eTexto  = layout.labelTexto   || 'Laços Eternos Floricultura\n{recipient}\n{bairro}';
  const empresa = layout.nomeEmpresa || cfg.razao || 'Laços Eternos Floricultura';
  const whats   = layout.whatsapp    || cfg.whats || '';

  const textoRender = applyLabelVars(eTexto, o, empresa, whats);

  const htmlDoc = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>Etiqueta — ${o.orderNumber||''}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{background:#f0f0f0;padding:20px;font-family:${eFonte},sans-serif;}
  .label{
    width:${eLargura}mm;height:${eAltura}mm;
    border:2px solid ${eCor};background:${eBg};
    font-size:${eTam}px;padding:8mm;
    display:flex;flex-direction:column;justify-content:center;align-items:center;gap:6px;
    margin:0 auto;box-sizing:border-box;overflow:hidden;
  }
  .label img{max-height:${Math.min(parseInt(eAltura)/3, 20)}mm;object-fit:contain;}
  .label .txt{white-space:pre-wrap;text-align:center;line-height:1.3;width:100%;}
  .btn-print{display:block;margin:16px auto;background:${eCor};color:#fff;border:none;padding:10px 30px;border-radius:8px;font-size:14px;cursor:pointer;font-weight:bold;}
  @media print {
    body{background:#fff;padding:0;margin:0;}
    .btn-print{display:none!important;}
    .label{border:none;page-break-inside:avoid;}
    @page{size:${eLargura}mm ${eAltura}mm;margin:0;}
  }
</style></head>
<body>
  <button class="btn-print" onclick="window.print()">🖨️ Imprimir Etiqueta</button>
  <div class="label">
    ${layout.labelLogoBase64?`<img src="${layout.labelLogoBase64}"/>`:''}
    <div class="txt">${textoRender.replace(/</g,'&lt;').replace(/\n/g,'<br>')}</div>
  </div>
</body></html>`;

  // Overlay preview com iframe
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
  overlay.setAttribute('data-overlay','true');
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:16px;width:100%;max-width:720px;overflow:hidden;">
      <div style="padding:12px 18px;background:${eCor};display:flex;justify-content:space-between;align-items:center;">
        <span style="color:#fff;font-weight:bold;">🏷️ Etiqueta — ${o.orderNumber||''}</span>
        <div style="display:flex;gap:8px;">
          <button id="btn-do-print-label" style="background:#fff;color:${eCor};border:none;padding:8px 18px;border-radius:8px;font-weight:bold;cursor:pointer;">🖨️ IMPRIMIR</button>
          <button id="btn-close-label" style="background:rgba(255,255,255,.2);color:#fff;border:none;padding:8px 12px;border-radius:8px;cursor:pointer;">✕</button>
        </div>
      </div>
      <div style="padding:20px;background:#f5f5f5;">
        <iframe id="label-iframe" style="width:100%;height:400px;border:none;border-radius:8px;background:#fff;"></iframe>
      </div>
    </div>`;
  overlay.addEventListener('click', e => { if(e.target===overlay) overlay.remove(); });
  document.body.appendChild(overlay);

  setTimeout(() => {
    const iframe = document.getElementById('label-iframe');
    if (iframe) { iframe.contentDocument.open(); iframe.contentDocument.write(htmlDoc); iframe.contentDocument.close(); }
  }, 50);

  document.getElementById('btn-do-print-label')?.addEventListener('click', () => {
    document.getElementById('label-iframe')?.contentWindow?.print();
  });
  document.getElementById('btn-close-label')?.addEventListener('click', () => overlay.remove());
}

// ── SEND DELIVERY NOTIFICATION ──────────────────────────────────
export function sendDeliveryNotification(order){
  // Importa dinamicamente para evitar dependencia circular
  import('./whatsapp.js').then(mod => {
    if(typeof mod.sendWhatsAppDeliveryConfirm === 'function') mod.sendWhatsAppDeliveryConfirm(order);
  });
}

// ── BINDINGS (chamado pelo app principal ao renderizar a pagina impressao) ──
export function bindImpressaoEvents(){
  // Tabs
  document.querySelectorAll('[data-imp-tab]').forEach(b => {
    b.onclick = () => { S._impTab = b.dataset.impTab; render(); };
  });

  // Helper para ler arquivo em base64
  const readFileAsBase64 = (file) => new Promise((res, rej) => {
    if (!file) return res(null);
    const r = new FileReader();
    r.onload = e => res(e.target.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });

  {const _el=document.getElementById('btn-save-layout');if(_el)_el.onclick=async()=>{
    // Le todos os campos
    const g = id => document.getElementById(id);
    const chk = id => g(id) ? g(id).checked !== false : true;

    // Logos: le arquivos se selecionados; mantem existente se nao
    const existing = JSON.parse(localStorage.getItem('fv_print_layout')||'{}');
    const logoBase64        = (await readFileAsBase64(g('lay-logo-file')?.files?.[0])) || existing.logoBase64 || null;
    const comandaLogoBase64 = (await readFileAsBase64(g('lay-cmd-logo-file')?.files?.[0])) || existing.comandaLogoBase64 || null;
    const labelLogoBase64   = (await readFileAsBase64(g('lay-etq-logo-file')?.files?.[0])) || existing.labelLogoBase64 || null;

    const layout={
      ...existing,  // preserva tudo o que nao foi re-lido (outras abas)
      // Cartao - Aparencia
      cardCor:        g('lay-cor')?.value        || existing.cardCor      || '#C8436A',
      cardBg:         g('lay-bg')?.value         || existing.cardBg       || '#FDF4F7',
      cardFonte:      g('lay-fonte')?.value      || existing.cardFonte    || 'Georgia',
      cardTamanho:    g('lay-tam')?.value        || existing.cardTamanho  || '16',
      cardBorda:      g('lay-borda')?.value      || existing.cardBorda    || 'solid',
      cardBordaPx:    g('lay-borda-px')?.value   || existing.cardBordaPx  || '2',
      // Cartao - Campos visiveis
      mostrarDestinatario: g('lay-mostrarDestinatario')? chk('lay-mostrarDestinatario') : (existing.mostrarDestinatario !== false),
      mostrarRemetente:    g('lay-mostrarRemetente')   ? chk('lay-mostrarRemetente')   : (existing.mostrarRemetente    !== false),
      mostrarMensagem:     g('lay-mostrarMensagem')    ? chk('lay-mostrarMensagem')    : (existing.mostrarMensagem     !== false),
      mostrarData:         g('lay-mostrarData')        ? chk('lay-mostrarData')        : (existing.mostrarData         !== false),
      mostrarProduto:      g('lay-mostrarProduto')     ? chk('lay-mostrarProduto')     : (existing.mostrarProduto      !== false),
      mostrarLogo:         g('lay-mostrarLogo')        ? chk('lay-mostrarLogo')        : (existing.mostrarLogo         !== false),
      // Comanda - Aparencia
      comandaCor:     g('lay-cmd-cor')?.value   || existing.comandaCor     || '#8B2252',
      comandaBg:      g('lay-cmd-bg')?.value    || existing.comandaBg      || '#FFFFFF',
      comandaFonte:   g('lay-cmd-fonte')?.value || existing.comandaFonte   || 'Arial',
      comandaTamanho: g('lay-cmd-tam')?.value   || existing.comandaTamanho || '14',
      comandaLogoBase64,
      // Etiqueta
      labelCor:       g('lay-etq-cor')?.value     || existing.labelCor     || '#1E5AA8',
      labelBg:        g('lay-etq-bg')?.value      || existing.labelBg      || '#FFFFFF',
      labelFonte:     g('lay-etq-fonte')?.value   || existing.labelFonte   || 'Arial',
      labelTamanho:   g('lay-etq-tam')?.value     || existing.labelTamanho || '18',
      labelLargura:   g('lay-etq-largura')?.value || existing.labelLargura || '100',
      labelAltura:    g('lay-etq-altura')?.value  || existing.labelAltura  || '50',
      labelTexto:     g('lay-etq-texto')?.value   || existing.labelTexto   || 'Laços Eternos Floricultura\n{recipient}\n{bairro}',
      labelLogoBase64,
      // Comuns
      nomeEmpresa:    g('lay-empresa')?.value || existing.nomeEmpresa || 'Laços Eternos Floricultura',
      whatsapp:       g('lay-whats')?.value   || existing.whatsapp    || '',
      site:           g('lay-site')?.value||'',
      // Comanda - Campos visiveis
      cmdDestinatario: chk('lay-cmdDestinatario'),
      cmdRemetente:    chk('lay-cmdRemetente'),
      cmdData:         chk('lay-cmdData'),
      cmdEndereco:     chk('lay-cmdEndereco'),
      cmdProdutoFoto:  chk('lay-cmdProdutoFoto'),
      cmdComplementos: chk('lay-cmdComplementos'),
      cmdCartao:       chk('lay-cmdCartao'),
      cmdCobranca:     chk('lay-cmdCobranca'),
      cmdEntregador:   chk('lay-cmdEntregador'),
      cmdQR:           chk('lay-cmdQR'),
      cmdAssinatura:   chk('lay-cmdAssinatura'),
      cmdRodape:       chk('lay-cmdRodape'),
      // Logo
      logoBase64,
      logoSize: g('lay-logo-size')?.value||'60',
    };
    await savePrintLayout(layout);
    toast('\u2705 Layout salvo com sucesso!');
    render();
  };}

  // Remover logos
  const removeLogo = (field, msg) => async () => {
    const layout = JSON.parse(localStorage.getItem('fv_print_layout')||'{}');
    delete layout[field];
    await savePrintLayout(layout);
    toast('🗑️ ' + msg); render();
  };
  document.getElementById('btn-remove-logo')    ?.addEventListener('click', removeLogo('logoBase64',        'Logo do cartão removida'));
  document.getElementById('btn-remove-cmd-logo')?.addEventListener('click', removeLogo('comandaLogoBase64', 'Logo da comanda removida'));
  document.getElementById('btn-remove-etq-logo')?.addEventListener('click', removeLogo('labelLogoBase64',   'Logo da etiqueta removida'));

  // Previews
  {const _el=document.getElementById('btn-print-card-preview');if(_el)_el.onclick=()=>{
    const o=S.orders[0]; if(o) printCard(o._id); else toast('❌ Nenhum pedido cadastrado');
  };}
  {const _el=document.getElementById('btn-print-comanda-preview');if(_el)_el.onclick=()=>{
    const o=S.orders[0]; if(o) printComanda(o._id); else toast('❌ Nenhum pedido cadastrado');
  };}
  {const _el=document.getElementById('btn-print-label-preview');if(_el)_el.onclick=()=>{
    const o=S.orders[0]; if(o) printLabel(o._id); else toast('❌ Nenhum pedido cadastrado');
  };}
  {const _el=document.getElementById('btn-preview-card');if(_el)_el.onclick=()=>{
    const o=S.orders[0]; if(o) printCard(o._id); else toast('❌ Crie um pedido primeiro para pré-visualizar');
  };}
}
