import { S } from '../state.js';
import { $c } from '../utils/formatters.js';
import { GET, PUT } from '../services/api.js';
import { toast } from '../utils/helpers.js';
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

// ── RENDER IMPRESSAO ────────────────────────────────────────────
export function renderImpressao(){
  const cfg    = JSON.parse(localStorage.getItem('fv_config')||'{}');
  const layout = JSON.parse(localStorage.getItem('fv_print_layout')||'{}');
  const cor    = layout.cardCor     || '#C8436A';
  const fonte  = layout.cardFonte   || 'Georgia';
  const tam    = layout.cardTamanho || '16';
  const empresa= layout.nomeEmpresa || cfg.razao || 'La\u00e7os Eternos Floricultura';
  const whats  = layout.whatsapp    || cfg.whats  || '(92) 99300-2433';
  const previewOrder = S.orders[0] || {
    orderNumber:'#0001', recipient:'Maria Silva',
    cardMessage:'Feliz anivers\u00e1rio com muito amor! \u{1F338}',
    identifyClient:true, clientName:'Jo\u00e3o Silva',
    client:{name:'Jo\u00e3o Silva'}, clientPhone:'(92) 98888-0000',
    deliveryAddress:'Rua das Flores, 123 \u2014 Adrian\u00f3polis',
    scheduledDate:new Date().toISOString(), scheduledPeriod:'Tarde',
    payment:'Pix', total:150, items:[{name:'Buqu\u00ea Premium',qty:1,totalPrice:150}]
  };
  return`
<div class="g2">
  <div>
    <div class="card" style="margin-bottom:14px;">
      <div class="card-title">\u{1F3A8} Layout do Cart\u00e3o</div>
      <div class="fr2">
        <div class="fg"><label class="fl">Cor principal</label>
          <input type="color" class="fi" id="lay-cor" value="${cor}" style="height:40px;cursor:pointer;"/></div>
        <div class="fg"><label class="fl">Fonte</label>
          <select class="fi" id="lay-fonte">
            ${['Georgia','Arial','Palatino','Times New Roman','Garamond','Verdana'].map(f=>`<option ${fonte===f?'selected':''}>${f}</option>`).join('')}
          </select>
        </div>
        <div class="fg"><label class="fl">Tamanho da mensagem</label>
          <input class="fi" type="number" id="lay-tam" value="${tam}" min="10" max="28"/></div>
        <div class="fg"><label class="fl">Nome da empresa no cart\u00e3o</label>
          <input class="fi" id="lay-empresa" value="${empresa}"/></div>
        <div class="fg"><label class="fl">WhatsApp da loja</label>
          <input class="fi" id="lay-whats" value="${whats}"/></div>
      </div>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
        <button class="btn btn-primary btn-sm" id="btn-save-layout">\u{1F4BE} Salvar Layout</button>
        <button class="btn btn-ghost btn-sm" id="btn-print-card-preview">\u{1F5A8}\uFE0F Testar Cart\u00e3o</button>
        <button class="btn btn-ghost btn-sm" id="btn-print-comanda-preview">\u{1F5A8}\uFE0F Testar Comanda</button>
      </div>
    </div>
    <div class="card">
      <div class="card-title">\u2699\uFE0F Op\u00e7\u00f5es de Impress\u00e3o</div>
      <div style="display:flex;flex-direction:column;gap:10px;">
        ${[
          ['lay-show-logo',       'Mostrar nome da empresa no cart\u00e3o',     layout.cardMostrarLogo!==false],
          ['lay-show-remetente',  'Mostrar nome do remetente no cart\u00e3o',   layout.cardMostrarRemetente!==false],
          ['lay-show-foto',       'Mostrar foto do produto na comanda',    layout.comandaMostrarFoto!==false],
          ['lay-show-cartao',     'Mostrar mensagem do cart\u00e3o na comanda', layout.comandaMostrarCartao!==false],
          ['lay-show-obs',        'Mostrar observa\u00e7\u00f5es na comanda',        layout.comandaMostrarObs!==false],
        ].map(([id,label,checked])=>`
        <label class="cb" style="cursor:pointer;">
          <input type="checkbox" id="${id}" ${checked?'checked':''}/>
          <span style="font-size:12px">${label}</span>
        </label>`).join('')}
      </div>
    </div>
  </div>
  <div class="card">
    <div class="card-title">\u{1F441}\uFE0F Preview \u2014 Cart\u00e3o</div>
    <div style="border:2px solid ${cor};border-radius:16px;padding:28px;max-width:320px;margin:0 auto;
      text-align:center;font-family:${fonte},serif;background:#fff;">
      ${layout.cardMostrarLogo!==false?`<div style="font-size:12px;color:${cor};font-weight:bold;margin-bottom:8px;letter-spacing:1px;">${empresa.toUpperCase()}</div>`:''}
      <div style="font-size:26px;margin-bottom:8px;">\u{1F33A}</div>
      <div style="font-size:12px;color:#666;margin-bottom:3px;">PARA:</div>
      <div style="font-size:18px;font-weight:bold;margin-bottom:14px;color:#1A0A10;">
        ${(previewOrder.recipient||'\u2014').toUpperCase()}</div>
      <div style="font-size:${tam}px;font-style:italic;color:#2D1A20;line-height:1.8;
        padding:14px;background:#FDF4F7;border-radius:8px;margin-bottom:12px;">
        "${previewOrder.cardMessage||'Com muito carinho! \u{1F338}'}"</div>
      ${layout.cardMostrarRemetente!==false&&previewOrder.identifyClient!==false?`
      <div style="font-size:12px;color:#9E8090;">\u{1F48C} COM CARINHO DE:
        <strong>${(previewOrder.client?.name||previewOrder.clientName||'\u2014').toUpperCase()}</strong>
      </div>`:''}
      <div style="font-size:11px;color:#ccc;margin-top:12px;">\u{1F4F1} ${whats}</div>
    </div>
  </div>
</div>`;
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
      ${layout.mostrarData!==false&&o.scheduledDate?`<div style="font-size:11px;color:#9E8090;margin-bottom:8px;">\u{1F4C5} ${new Date(o.scheduledDate).toLocaleDateString('pt-BR')} ${o.scheduledPeriod?'\u00b7 '+o.scheduledPeriod:''}</div>`:''}
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
export function printComanda(orderId){
  const o = S.orders.find(x=>x._id===orderId);
  if(!o) return;
  const cfg    = JSON.parse(localStorage.getItem('fv_config')||'{}');
  const layout = JSON.parse(localStorage.getItem('fv_print_layout')||'{}');
  const cor    = layout.comandaCor||'#8B2252';
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
    ? new Date(o.scheduledDate).toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'2-digit',year:'2-digit'}).toUpperCase()
    : '\u2014';
  const turno   = UC(o.scheduledPeriod||'');
  const horario = o.scheduledTime ? UC(o.scheduledTime) : '';
  const dtLabel = [dataEntrega, turno, horario].filter(Boolean).join(' \u00b7 ');

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

  // ── ENDERECO COMPLETO ─────────────────────────────────────
  const rua   = [UC(o.deliveryStreet||''), o.deliveryNumber?'N\u00ba '+UC(o.deliveryNumber):''].filter(Boolean).join(', ');
  const bairro= UC(o.deliveryNeighborhood||o.deliveryZone||'');
  const cidade= UC(o.deliveryCity||'MANAUS');
  const cond  = o.isCondominium ? [o.condName?UC(o.condName):'', o.block?'BLOCO '+UC(o.block):'', o.apt?'AP '+UC(o.apt):''].filter(Boolean).join(' \u2014 ') : '';
  const ref   = UC(o.deliveryReference||o.notes||'');
  const phone = o.recipientPhone||'';

  // ── ITENS COM FOTO ─────────────────────────────────────────
  const itemsHtml = (o.items||[]).map(i=>{
    const prod = S.products.find(p=>p._id===i.product||p.name===i.name);
    const foto = prod?.images?.[0]
      ? `<img src="${prod.images[0]}" style="width:80px;height:80px;object-fit:cover;border-radius:5px;border:2px solid ${cor};flex-shrink:0;"/>`
      : `<div style="width:80px;height:80px;border-radius:5px;background:#F5D6E0;display:flex;align-items:center;justify-content:center;font-size:36px;flex-shrink:0;">\u{1F338}</div>`;
    const complements = [prod?.productionNotes, i.complement, i.notes].filter(Boolean);
    return `<div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid #e5e5e5;">
      ${foto}
      <div style="flex:1">
        <div style="font-size:19px;font-weight:900;color:#111;">${UC(i.qty)}\u00d7 ${UC(i.name)}</div>
        ${complements.map(c=>`<div style="font-size:12px;color:#555;margin-top:3px;">\u{1F4CB} ${UC(c)}</div>`).join('')}
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
  const trocoLinha = (o.paymentOnDelivery === 'Dinheiro' && o.trocoPara && parseFloat(o.trocoPara) > (o.total||0))
    ? `<div style="background:#D1FAE5;border:2px solid #059669;border-radius:6px;padding:6px 10px;text-align:center;font-size:14px;font-weight:900;color:#065F46;margin-top:4px;">
        \uD83D\uDCB0 TROCO P/ R$ ${parseFloat(o.trocoPara).toFixed(2).replace('.',',')} \u2014 LEVAR R$ ${(parseFloat(o.trocoPara) - (o.total||0)).toFixed(2).replace('.',',')}
       </div>` : '';
  const cobrancaBlock = o.payment==='Pagar na Entrega'
    ? `<div style="margin-bottom:6px;">
         <div style="background:#FFF8E1;border:2px solid #B7860F;border-radius:6px;padding:8px 10px;text-align:center;font-size:16px;font-weight:900;color:#8B6914;">
           \u{1F4B0} COBRAR NA ENTREGA: R$ ${(o.total||0).toFixed(2).replace('.',',')} \u2014 ${UC(o.paymentOnDelivery||'VERIFICAR')}
         </div>
         ${trocoLinha}
       </div>` : '';

  // ═══════════════════════════════════════════════════════════
  // VIA CD -- Arquivo interno
  // ═══════════════════════════════════════════════════════════
  const viaCD = `
  <div style="padding:16px 18px 12px;font-family:Arial,sans-serif;text-transform:uppercase;box-sizing:border-box;width:100%;height:148mm;overflow:hidden;display:flex;flex-direction:column;gap:6px;">

    <!-- Header CD -->
    <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:4px solid ${cor};padding-bottom:8px;">
      <div>
        <div style="font-size:14px;font-weight:900;color:${cor};">${empresa}</div>
        <div style="font-size:11px;color:#555;text-transform:none;">${whats}</div>
        <div style="background:${cor};color:#fff;display:inline-block;padding:1px 8px;border-radius:20px;font-size:10px;font-weight:700;margin-top:3px;">\u{1F4C2} VIA CD \u2014 ARQUIVO</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:32px;font-weight:900;color:#111;">${orderNumFmt}</div>
        <div style="font-size:10px;color:#666;">PEDIDO</div>
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
      </div>
      <div style="background:#f5f5f5;border-radius:6px;padding:8px;grid-column:span 2;">
        <div style="font-size:9px;color:#888;margin-bottom:2px;">\u{1F4C5} ENTREGA \u00b7 TURNO \u00b7 HOR\u00c1RIO</div>
        <div style="font-size:16px;font-weight:900;">${dtLabel||'\u2014'}</div>
      </div>
    </div>

    <!-- Endereco -->
    ${enderecoBlock(cor)}

    <!-- Cartao -->
    ${o.cardMessage?`<div style="background:#FDF4F7;border-left:4px solid ${cor};padding:5px 10px;border-radius:0 6px 6px 0;font-size:11px;text-transform:none;">
      \u{1F48C} <strong>CART\u00c3O:</strong> "${o.cardMessage}" ${o.identifyClient!==false?'\u2014 DE: '+UC(o.client?.name||o.clientName||''):'\u2014 AN\u00d4NIMO'}</div>`:''}

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
  <div style="padding:14px 18px 10px;font-family:Arial,sans-serif;text-transform:uppercase;box-sizing:border-box;width:100%;height:148mm;overflow:hidden;display:flex;flex-direction:column;gap:5px;">

    <!-- Header Entregador -->
    <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:4px solid #333;padding-bottom:7px;">
      <div>
        <div style="font-size:14px;font-weight:900;color:#111;">${empresa}</div>
        <div style="background:#333;color:#fff;display:inline-block;padding:1px 8px;border-radius:20px;font-size:10px;font-weight:700;margin-top:3px;">\u{1F69A} VIA ENTREGADOR</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:32px;font-weight:900;color:#111;">${orderNumFmt}</div>
        <div style="font-size:10px;color:#666;">PEDIDO</div>
      </div>
    </div>

    <!-- Produto -->
    <div>${itemsHtml}</div>

    <!-- DESTINATARIO em destaque -->
    <div style="background:#f5f5f5;border-left:6px solid #333;border-radius:0 8px 8px 0;padding:10px 14px;">
      <div style="font-size:10px;color:#555;font-weight:700;letter-spacing:1px;margin-bottom:3px;">\u{1F4E6} DESTINAT\u00c1RIO</div>
      <div style="font-size:26px;font-weight:900;color:#111;letter-spacing:0.8px;text-transform:uppercase;">${UC(o.recipient||'\u2014')}</div>
    </div>

    <!-- BAIRRO + TURNO/HORARIO em destaque -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;">
      <div style="background:#1E5AA8;border-radius:6px;padding:7px 10px;text-align:center;">
        <div style="font-size:9px;color:rgba(255,255,255,.7);margin-bottom:1px;">BAIRRO / ZONA</div>
        <div style="font-size:17px;font-weight:900;color:#fff;line-height:1.1;">${UC(bairro||'\u2014')}</div>
      </div>
      <div style="background:#C8436A;border-radius:6px;padding:7px 10px;text-align:center;">
        <div style="font-size:9px;color:rgba(255,255,255,.85);margin-bottom:1px;">\u{1F4C5} DATA \u00b7 TURNO \u00b7 HORA</div>
        <div style="font-size:12px;font-weight:700;color:#fff;">${UC(o.scheduledDate?new Date(o.scheduledDate).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'2-digit'}):'\u2014')}</div>
        <div style="font-size:15px;font-weight:900;color:#FFD700;">${UC(turno||'\u2014')}</div>
        ${horario?`<div style="font-size:16px;font-weight:900;color:#fff;background:rgba(0,0,0,0.25);border-radius:4px;padding:2px 6px;margin-top:2px;">\u23F0 ${UC(horario)}</div>`:''}
      </div>
    </div>

    <!-- Endereco completo (SEM telefone e nome do cliente) -->
    <div style="background:#f8f8f8;border-left:5px solid #333;border-radius:0 8px 8px 0;padding:10px 14px;">
      <div style="font-size:10px;color:#555;font-weight:700;letter-spacing:1px;margin-bottom:4px;">\u{1F4CD} ENDERE\u00c7O DE ENTREGA</div>
      ${rua?`<div style="font-size:17px;font-weight:800;color:#111;text-transform:uppercase;">${UC(rua)}</div>`:''}
      ${bairro?`<div style="font-size:19px;font-weight:900;color:#1E5AA8;margin-top:3px;text-transform:uppercase;">${UC(bairro)} \u2014 ${UC(cidade)}</div>`:''}
      ${cond?`<div style="font-size:14px;font-weight:700;color:#333;margin-top:3px;">\u{1F3E2} ${UC(cond)}</div>`:''}
      ${ref?`<div style="font-size:13px;color:#555;margin-top:3px;">\u{1F4CD} REF: ${UC(ref)}</div>`:''}
    </div>

    <!-- Cobranca -->
    ${cobrancaBlock}

    <!-- Entregador + QR -->
    <div style="background:#f0f0f0;border-radius:6px;padding:6px 10px;display:flex;align-items:center;justify-content:space-between;">
      <div>
        <div style="font-size:9px;color:#555;">ENTREGADOR RESPONS\u00c1VEL</div>
        <div style="font-size:15px;font-weight:900;color:#111;">${entregador}</div>
      </div>
      <div style="text-align:center;">
        <img src="${qrSrc}" style="width:65px;height:65px;"/>
        <div style="font-size:8px;color:#555;margin-top:1px;text-transform:none;">ESCANEAR = ENTREGUE \u2705</div>
      </div>
    </div>

    <!-- Recebimento -->
    <div style="border-top:1px dashed #aaa;padding-top:5px;display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:auto;">
      <div>
        <div style="font-size:9px;color:#666;font-weight:700;margin-bottom:3px;">NOME DE QUEM RECEBEU</div>
        <div style="border-bottom:2px solid #333;height:20px;"></div>
        <div style="font-size:9px;color:#666;font-weight:700;margin-top:7px;margin-bottom:3px;">ASSINATURA</div>
        <div style="border-bottom:2px solid #333;height:20px;"></div>
        <div style="font-size:9px;color:#666;font-weight:700;margin-top:7px;margin-bottom:3px;">DATA E HORA DA ENTREGA</div>
        <div style="border-bottom:2px solid #333;height:20px;"></div>
      </div>
      <div style="border:2px dashed #ccc;border-radius:6px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:3px;min-height:80px;">
        <div style="font-size:18px;">\u{1F4F7}</div>
        <div style="font-size:8px;color:#888;text-align:center;font-weight:700;text-transform:none;">FOTO / PROVA<br/>DE ENTREGA</div>
      </div>
    </div>

    <!-- Rodape: Info da Floricultura -->
    <div style="border-top:1px solid #ddd;padding-top:3px;margin-top:2px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px;">
      <div style="font-size:8px;color:#666;text-transform:none;">
        <strong style="color:#111;font-size:9px;">${empresa}</strong>${floriAddr?' \u00b7 '+floriAddr:''}
      </div>
      <div style="font-size:8px;color:#666;text-transform:none;text-align:right;">
        ${whats}${floriEmail?' \u00b7 '+floriEmail:''}${floriSite?' \u00b7 '+floriSite:''}
      </div>
    </div>

  </div>`;

  // ── HTML final ─────────────────────────────────────────────
  const htmlDoc = `<!DOCTYPE html>
<html><head><title>Comanda \u2014 ${orderNumFmt}</title>
<meta charset="utf-8"/>
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{background:#f0f0f0;font-family:Arial,sans-serif;}
  .page{width:210mm;margin:0 auto;background:#fff;}
  .half-cd{height:148mm;overflow:hidden;border-bottom:3px dashed #999;position:relative;}
  .half-ent{height:148mm;overflow:hidden;}
  .cut-label{position:absolute;bottom:-12px;left:50%;transform:translateX(-50%);background:#fff;padding:0 14px;font-size:10px;color:#999;white-space:nowrap;font-family:Arial;letter-spacing:2px;}
  .btn-print{display:block;margin:16px auto;background:#8B2252;color:#fff;border:none;padding:12px 36px;border-radius:8px;font-size:15px;cursor:pointer;font-family:Arial;font-weight:bold;}
  @media print{
    body{background:#fff;margin:0;}
    .btn-print{display:none!important;}
    .page{width:100%;margin:0;}
    .half-cd{height:50vh;page-break-after:avoid;}
    .half-ent{height:50vh;}
    @page{size:A4 portrait;margin:0;}
  }
</style></head>
<body>
<button class="btn-print" onclick="window.print()">\u{1F5A8}\uFE0F Imprimir Comanda (A4)</button>
<div class="page">
  <div class="half-cd">
    ${viaCD}
    <div class="cut-label">\u2702 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 DESTACAR AQUI \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 \u2702</div>
  </div>
  <div class="half-ent">
    ${viaEntregador}
  </div>
</div>
</body></html>`;

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

// ── SEND DELIVERY NOTIFICATION ──────────────────────────────────
export function sendDeliveryNotification(order){
  // Importa dinamicamente para evitar dependencia circular
  import('./whatsapp.js').then(mod => {
    if(typeof mod.sendWhatsAppDeliveryConfirm === 'function') mod.sendWhatsAppDeliveryConfirm(order);
  });
}

// ── BINDINGS (chamado pelo app principal ao renderizar a pagina impressao) ──
export function bindImpressaoEvents(){
  {const _el=document.getElementById('btn-save-layout');if(_el)_el.onclick=async()=>{
    // Le todos os campos
    const g = id => document.getElementById(id);
    const chk = id => g(id) ? g(id).checked !== false : true;

    // Logo: le arquivo se selecionado
    const existing = JSON.parse(localStorage.getItem('fv_print_layout')||'{}');
    let logoBase64 = existing.logoBase64 || null;
    const logoFile = g('lay-logo-file')?.files?.[0];
    if(logoFile){
      logoBase64 = await new Promise(res=>{
        const r=new FileReader();
        r.onload=e=>res(e.target.result);
        r.readAsDataURL(logoFile);
      });
    }

    const layout={
      // Cartao - Aparencia
      cardCor:        g('lay-cor')?.value||'#C8436A',
      cardBg:         g('lay-bg')?.value||'#FDF4F7',
      cardFonte:      g('lay-fonte')?.value||'Georgia',
      cardTamanho:    g('lay-tam')?.value||'16',
      cardBorda:      g('lay-borda')?.value||'solid',
      cardBordaPx:    g('lay-borda-px')?.value||'2',
      // Cartao - Campos visiveis
      mostrarDestinatario: chk('lay-mostrarDestinatario'),
      mostrarRemetente:    chk('lay-mostrarRemetente'),
      mostrarMensagem:     chk('lay-mostrarMensagem'),
      mostrarData:         chk('lay-mostrarData'),
      mostrarProduto:      chk('lay-mostrarProduto'),
      mostrarLogo:         chk('lay-mostrarLogo'),
      // Comanda - Aparencia
      comandaCor:     g('lay-cmd-cor')?.value||'#8B2252',
      nomeEmpresa:    g('lay-empresa')?.value||'La\u00e7os Eternos Floricultura',
      whatsapp:       g('lay-whats')?.value||'',
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

  // Remover logo
  {const _el=document.getElementById('btn-remove-logo');if(_el)_el.onclick=async()=>{
    const layout = JSON.parse(localStorage.getItem('fv_print_layout')||'{}');
    delete layout.logoBase64;
    await savePrintLayout(layout);
    toast('\u{1F5D1}\uFE0F Logo removido'); render();
  };}

  {const _el=document.getElementById('btn-print-card-preview');if(_el)_el.onclick=()=>{
    const o=S.orders[0]; if(o) printCard(o._id); else toast('\u274C Nenhum pedido cadastrado');
  };}
  {const _el=document.getElementById('btn-print-comanda-preview');if(_el)_el.onclick=()=>{
    const o=S.orders[0]; if(o) printComanda(o._id); else toast('\u274C Nenhum pedido cadastrado');
  };}
  {const _el=document.getElementById('btn-preview-card');if(_el)_el.onclick=()=>{
    const o=S.orders[0]; if(o) printCard(o._id); else toast('\u274C Crie um pedido primeiro para pr\u00e9-visualizar');
  };}
}
