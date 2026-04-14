// ── PDV (Ponto de Venda) ─────────────────────────────────────
import { S, PDV, DELIVERY_FEES, BAIRROS_MANAUS, resetPDV } from '../state.js';
import { $c, emoji, esc, ini } from '../utils/formatters.js';
import { POST, PATCH } from '../services/api.js';
import { toast, setPage } from '../utils/helpers.js';
import { can, findColab } from '../services/auth.js';
import { invalidateCache } from '../services/cache.js';

let _pdvLock = false;

export function renderPDV(){
  if(!can('pdv')) return `<div class="empty card"><div class="empty-icon">&#x1F6AB;</div><p>Sem permiss\u00e3o</p></div>`;
  const cats=[...new Set(S.products.map(p=>p.category).filter(Boolean))];
  const filtered=S.products.filter(p=>{
    const ms=!S._prodSearch||p.name.toLowerCase().includes(S._prodSearch.toLowerCase());
    const mc=!S._prodCat||p.category===S._prodCat;
    return ms&&mc&&p.active!==false;
  });
  const sub=PDV.cart.reduce((s,i)=>s+i.price*i.qty,0);
  const deliveryFee=PDV.type==='Delivery'?(PDV.deliveryFee||0):0;
  const total=sub-(PDV.discount||0)+deliveryFee;

  return `<div class="pdv-grid">
<div>
  <div class="card" style="margin-bottom:12px;">
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
      <div class="search-box" style="flex:1;min-width:160px;"><span class="si">\uD83D\uDD0D</span><input class="fi" id="pdv-search" placeholder="Buscar produto..." value="${S._prodSearch}"/></div>
      <button class="btn btn-sm ${!S._prodCat?'btn-primary':'btn-ghost'}" data-cat="">Todos</button>
      ${cats.map(c=>`<button class="btn btn-sm ${S._prodCat===c?'btn-primary':'btn-ghost'}" data-cat="${c}">${c}</button>`).join('')}
    </div>
  </div>
  ${filtered.length===0?`<div class="empty card"><div class="empty-icon">\uD83C\uDF38</div><p>Nenhum produto</p><button class="btn btn-primary btn-sm" onclick="setPage('produtos')" style="margin-top:8px">Cadastrar</button></div>`:`
  <div class="prod-grid">
    ${filtered.map(p=>`
    <div class="prod-card ${PDV.cart.find(i=>i.id===p._id)?'sel':''}" data-pid="${p._id}">
      ${p.images&&p.images[0]?`<img src="${p.images[0]}" style="width:64px;height:64px;border-radius:8px;object-fit:cover;margin:0 auto 5px;display:block">`:`<div style="font-size:28px;margin-bottom:5px">${emoji(p.category)}</div>`}
      <div style="font-size:11px;font-weight:500">${p.name}</div>
      <div style="font-size:12px;color:var(--rose);font-weight:600">${$c(p.salePrice)}</div>
      <div style="font-size:10px;color:${(p.stock||0)<=(p.minStock||5)?'var(--red)':'var(--muted)'}">Est: ${p.stock||0}</div>
    </div>`).join('')}
  </div>`}
</div>

<div>
<div class="card">
  <div class="card-title">\uD83D\uDED2 Pedido</div>

  ${!['Loja Novo Aleixo','Loja Allegro Mall','CDLE'].includes(S.user.unit)?`
  <div class="fg"><label class="fl">Unidade de Venda *</label>
    <select class="fi" id="pdv-sale-unit">
      <option value="Loja Novo Aleixo" ${PDV.saleUnit==='Loja Novo Aleixo'?'selected':''}>🌺 Loja Novo Aleixo</option>
      <option value="Loja Allegro Mall" ${PDV.saleUnit==='Loja Allegro Mall'?'selected':''}>🌺 Loja Allegro Mall</option>
      <option value="CDLE" ${PDV.saleUnit==='CDLE'?'selected':''}>📦 CDLE</option>
    </select>
  </div>`:''}

  <!-- BUSCA CLIENTE - \u00FAltimos 6 d\u00EDgitos do celular -->
  <div class="fg">
    <label class="fl">Cliente \u2014 \u00FAltimos 6 d\u00EDgitos do celular ou nome <span style="color:var(--red)">*</span></label>
    <div style="position:relative;">
      <input class="fi" id="pdv-phone-search"
        placeholder="Ex: 234567 ou 'Maria Silva'..."
        value="${PDV.clientSearch}"
        autocomplete="off"
        style="padding-right:36px;"/>
      ${PDV.clientSearch?`<button id="pdv-search-clear" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--muted);font-size:16px;line-height:1;">\u2715</button>`:''}
    </div>
    <div id="pdv-search-results"></div>

    ${PDV.clientId?`
    <div style="background:var(--leaf-l);border-radius:8px;padding:10px 14px;margin-top:6px;display:flex;align-items:center;gap:10px;border:1px solid rgba(31,92,46,.2);">
      <div class="av" style="width:34px;height:34px;font-size:12px;background:var(--leaf)">${ini(S.clients.find(c=>c._id===PDV.clientId)?.name||PDV.clientName)}</div>
      <div style="flex:1;">
        <div style="font-weight:700;font-size:13px">${S.clients.find(c=>c._id===PDV.clientId)?.name||PDV.clientName}</div>
        <div style="font-size:11px;color:var(--muted)">${S.clients.find(c=>c._id===PDV.clientId)?.phone||PDV.clientPhone}</div>
      </div>
      <button class="btn btn-ghost btn-xs" id="pdv-clear-cli">\u2715 Trocar</button>
    </div>`:(!PDV.clientId&&PDV.clientName?`
    <div style="background:var(--cream);border-radius:8px;padding:8px 12px;margin-top:6px;font-size:12px;display:flex;align-items:center;justify-content:space-between;">
      <span><strong>${PDV.clientName}</strong> ${PDV.clientPhone?'\u00B7 '+PDV.clientPhone:''} <span class="tag t-blue" style="margin-left:4px">Novo</span></span>
      <button class="btn btn-ghost btn-xs" id="pdv-clear-cli">\u2715</button>
    </div>`:'')
    }
  </div>

  <!-- CADASTRO R\u00C1PIDO -->
  ${PDV._showQuickReg?`
  <div style="background:var(--petal);border-radius:var(--r);padding:14px;border:1px solid var(--rose-l);margin-bottom:10px;">
    <div style="font-weight:600;font-size:13px;margin-bottom:10px;color:var(--rose)">\u2795 Cadastro R\u00E1pido de Cliente</div>
    <div class="fr2">
      <div class="fg"><label class="fl">Nome completo *</label><input class="fi" id="qr-name" placeholder="Nome completo"/></div>
      <div class="fg"><label class="fl">WhatsApp *</label><input class="fi" id="qr-phone" placeholder="(92) 9xxxx-xxxx"/></div>
      <div class="fg"><label class="fl">E-mail</label><input class="fi" id="qr-email" type="email" placeholder="email@..."/></div>
      <div class="fg"><label class="fl">Anivers\u00E1rio</label><input class="fi" id="qr-bday" type="date"/></div>
      <div class="fg"><label class="fl">CPF</label><input class="fi" id="qr-cpf" placeholder="000.000.000-00"/></div>
      <div class="fg"><label class="fl">Segmento</label>
        <select class="fi" id="qr-segment"><option value="Novo">Novo</option><option value="Recorrente">Recorrente</option><option value="VIP">VIP</option></select>
      </div>
    </div>
    <div id="qr-phone-warn" style="display:none;background:var(--red-l);border-radius:8px;padding:8px 10px;font-size:11px;color:var(--red);margin-bottom:8px;"></div>
    <div class="fr2">
      <div class="fg" style="grid-column:span 2"><label class="fl">Rua / Avenida</label><input class="fi" id="qr-street" placeholder="Rua das Flores"/></div>
      <div class="fg"><label class="fl">N\u00FAmero</label><input class="fi" id="qr-number" placeholder="123"/></div>
      <div class="fg"><label class="fl">Bairro</label>
        <input class="fi" id="qr-neigh" placeholder="Selecione ou digite..." list="bairros-manaus"/>
      </div>
      <div class="fg"><label class="fl">Cidade</label><input class="fi" id="qr-city" value="Manaus" readonly style="background:var(--cream);color:var(--muted)"/></div>
      <div class="fg"><label class="fl">CEP</label><input class="fi" id="qr-cep" placeholder="69000-000"/></div>
    </div>
    <div class="fg"><label class="fl">Observa\u00E7\u00F5es</label><textarea class="fi" id="qr-notes" rows="2"></textarea></div>
    <div style="display:flex;gap:6px;">
      <button class="btn btn-primary btn-sm" id="btn-qr-save">\u2705 Salvar e usar</button>
      <button class="btn btn-ghost btn-sm" id="btn-qr-cancel">Cancelar</button>
    </div>
  </div>`:''}
  <datalist id="bairros-manaus">
    ${BAIRROS_MANAUS.map(b=>`<option value="${b}">`).join('')}
  </datalist>
  <!-- CARRINHO -->
  ${PDV.cart.length>0?`
  <div style="max-height:180px;overflow-y:auto;margin-bottom:8px;">
    ${PDV.cart.map(i=>`
    <div class="cart-item">
      <div style="flex:1"><div style="font-size:12px;font-weight:500">${i.name}</div><div style="font-size:10px;color:var(--muted)">${$c(i.price)}</div></div>
      <div style="display:flex;align-items:center;gap:5px;">
        <button class="qb" data-dec="${i.id}">\u2212</button>
        <span style="font-size:12px;min-width:16px;text-align:center">${i.qty}</span>
        <button class="qb" data-inc="${i.id}">+</button>
      </div>
      <div style="font-size:12px;font-weight:600;color:var(--rose);min-width:52px;text-align:right">${$c(i.price*i.qty)}</div>
    </div>`).join('')}
  </div>`:`<div style="text-align:center;color:var(--muted);padding:10px;font-size:12px">Clique nos produtos para adicionar</div>`}

  <hr/>
  <!-- DESTINAT\u00C1RIO E CART\u00C3O -->
  <div class="fg"><label class="fl">Destinat\u00E1rio</label><input class="fi" id="pdv-recipient" placeholder="Nome de quem vai receber" value="${PDV.recipient}"/></div>
  <div class="fg"><label class="fl">WhatsApp / Telefone do destinat\u00E1rio</label><input class="fi" id="pdv-recip-phone" type="tel" placeholder="(92) 9xxxx-xxxx" value="${PDV.recipientPhone||''}"/></div>
  <div class="fg"><label class="fl">Mensagem do cart\u00E3o</label><textarea class="fi" id="pdv-cardmsg" rows="2" placeholder="Mensagem para o cart\u00E3o...">${PDV.cardMessage}</textarea></div>

  <hr/>
  <!-- DATA E TURNO -->
  <div style="font-size:12px;font-weight:600;margin-bottom:8px;color:var(--ink)">\uD83D\uDCC5 Data e Entrega</div>
  <div class="fr2">
    <div class="fg"><label class="fl">Data de entrega <span style="color:var(--red)">*</span></label><input class="fi" type="date" id="pdv-date" style="border-color:${!PDV.deliveryDate&&(PDV.type==='Delivery'||PDV.type==='Retirada')?'var(--red)':''}" value="${PDV.deliveryDate}"/></div>
    <div class="fg"><label class="fl">Turno <span style="color:var(--red)">*</span></label>
      <select class="fi" id="pdv-period">
        <option ${PDV.deliveryPeriod==='Manh\u00E3'?'selected':''}>Manh\u00E3</option>
        <option ${PDV.deliveryPeriod==='Tarde'?'selected':''}>Tarde</option>
        <option ${PDV.deliveryPeriod==='Noite'?'selected':''}>Noite</option>
        <option ${PDV.deliveryPeriod==='Hor\u00E1rio espec\u00EDfico'?'selected':''}>Hor\u00E1rio espec\u00EDfico</option>
      </select>
    </div>
  </div>
  ${PDV.deliveryPeriod==='Hor\u00E1rio espec\u00EDfico'?`
  <div class="fg">
    <label class="fl">Hor\u00E1rio Espec\u00EDfico * <span style="font-size:10px;color:var(--muted)">(ex: Entre 10:00 e 11:00)</span></label>
    <div class="fr2">
      <div><label class="fl" style="font-size:10px">Das</label><input class="fi" type="time" id="pdv-time-from" value="${PDV.deliveryTimeFrom||''}"/></div>
      <div><label class="fl" style="font-size:10px">At\u00E9</label><input class="fi" type="time" id="pdv-time-to" value="${PDV.deliveryTimeTo||''}"/></div>
    </div>
    <div style="font-size:11px;color:var(--blue);margin-top:4px;">\uD83D\uDD34 Marcado como PRIORIDADE na expedi\u00E7\u00E3o</div>
  </div>`:''}

  <!-- TIPO DE ENTREGA -->
  <div class="fg"><label class="fl">Tipo de Entrega</label>
    <div style="display:flex;gap:6px;flex-wrap:wrap;">
      <button class="btn btn-sm ${PDV.type==='Delivery'?'btn-primary':'btn-ghost'}" data-type="Delivery">\uD83D\uDE9A Delivery</button>
      <button class="btn btn-sm ${PDV.type==='Retirada'?'btn-primary':'btn-ghost'}" data-type="Retirada">\uD83C\uDFEA Retirada na Loja</button>
      <button class="btn btn-sm ${PDV.type==='Balc\u00E3o'?'btn-primary':'btn-ghost'}" data-type="Balc\u00E3o">\uD83D\uDECD\uFE0F Balc\u00E3o</button>
    </div>
  </div>

  ${PDV.type==='Retirada'?`
  <div class="fg"><label class="fl">Unidade de Retirada <span style="color:var(--red)">*</span></label>
    <select class="fi" id="pdv-pickup-unit">
      <option value="">Selecionar loja...</option>
      <option value="Loja Novo Aleixo" ${PDV.pickupUnit==='Loja Novo Aleixo'?'selected':''}>🌺 Loja Novo Aleixo</option>
      <option value="Loja Allegro Mall" ${PDV.pickupUnit==='Loja Allegro Mall'?'selected':''}>🌺 Loja Allegro Mall</option>
      <option value="CDLE" ${PDV.pickupUnit==='CDLE'?'selected':''}>📦 CDLE</option>
    </select>
  </div>`:''}

  ${PDV.type==='Delivery'?`
  <hr/>
  <div style="font-size:12px;font-weight:600;margin-bottom:8px;color:var(--ink)">\uD83D\uDCB0 Taxa de Entrega</div>
  <div class="fr2">
    <div class="fg"><label class="fl">Cidade</label>
      <select class="fi" id="pdv-city-sel">
        <option value="">Selecionar cidade...</option>
        ${Object.keys(DELIVERY_FEES).map(c=>`<option value="${c}" ${PDV.city===c?'selected':''}>${c}</option>`).join('')}
      </select>
    </div>
    <div class="fg"><label class="fl">Zona / Bairro</label>
      <select class="fi" id="pdv-zone-sel" ${!PDV.city?'disabled':''}>
        <option value="">Selecionar zona...</option>
        ${PDV.city&&DELIVERY_FEES[PDV.city]?Object.entries(DELIVERY_FEES[PDV.city]).map(([z,v])=>`<option value="${z}" ${PDV.zone===z?'selected':''}>${z} \u2014 ${$c(v)}</option>`).join(''):''}
      </select>
    </div>
  </div>
  ${PDV.deliveryFee>0?`<div style="background:var(--gold-l);border-radius:8px;padding:8px 12px;font-size:12px;margin-bottom:8px;">\uD83D\uDE9A Taxa: <strong>${$c(PDV.deliveryFee)}</strong></div>`:''}
  <hr/>
  <div style="font-size:12px;font-weight:600;margin-bottom:8px;color:var(--ink)">\uD83D\uDCCD Endere\u00E7o de Entrega</div>
  <div class="fg"><label class="fl">Rua / Avenida *</label><input class="fi" id="pdv-street" placeholder="Rua das Flores" value="${PDV.street}" required/></div>
  <div class="fr3">
    <div class="fg"><label class="fl">N\u00FAmero</label><input class="fi" id="pdv-number" placeholder="123" value="${PDV.number}"/></div>
    <div class="fg" style="grid-column:span 2"><label class="fl">Bairro <span style="color:var(--red)">*</span></label>
      <input class="fi" id="pdv-neighborhood" style="border-color:${PDV.type==='Delivery'&&!PDV.neighborhood?'var(--red)':''}"
        placeholder="Selecione ou digite o bairro..." value="${PDV.neighborhood}" list="bairros-manaus-pdv" autocomplete="off"/>
      <datalist id="bairros-manaus-pdv">${BAIRROS_MANAUS.map(b=>`<option value="${b}">`).join('')}</datalist>
    </div>
  </div>
  <div class="fr2">
    <div class="fg"><label class="fl">Cidade</label>
      <input class="fi" id="pdv-city" value="Manaus" readonly style="background:var(--cream);color:var(--muted);"/>
    </div>
    <div class="fg"><label class="fl">CEP</label><input class="fi" id="pdv-cep" placeholder="69000-000" value="${PDV.cep}"/></div>
  </div>
  <div class="fg"><label class="fl">Ponto de refer\u00EAncia</label><input class="fi" id="pdv-ref" placeholder="Pr\u00F3ximo ao mercado..." value="${PDV.reference}"/></div>
  <label class="cb" style="margin-bottom:10px;"><input type="checkbox" id="pdv-condo" ${PDV.isCondominium?'checked':''}/><span style="font-size:12px">\u00C9 condom\u00EDnio?</span></label>
  ${PDV.isCondominium?`
  <div class="fr2">
    <div class="fg" style="grid-column:span 2"><label class="fl">Nome do Condom\u00EDnio *</label>
      <input class="fi" id="pdv-cond-name" placeholder="Ex: Condom\u00EDnio Mirante do Rio" value="${PDV.condName}" required/>
    </div>
    <div class="fg"><label class="fl">Bloco *</label><input class="fi" id="pdv-block" placeholder="Bloco A" value="${PDV.block}" required/></div>
    <div class="fg"><label class="fl">Apartamento *</label><input class="fi" id="pdv-apt" placeholder="Ap 42" value="${PDV.apt}" required/></div>
  </div>`:''}
  `:''}

  <hr/>
  <!-- OP\u00C7\u00D5ES -->
  <div style="font-size:12px;font-weight:600;margin-bottom:8px;color:var(--ink)">\u2699\uFE0F Op\u00E7\u00F5es</div>
  <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px;">
    <label class="cb"><input type="checkbox" id="pdv-notify" ${PDV.notifyClient?'checked':''}/><div><div style="font-size:12px;font-weight:500">\uD83D\uDCF1 Notificar cliente sobre entrega</div><div style="font-size:10px;color:var(--muted)">Enviar WhatsApp quando entregue</div></div></label>
    <label class="cb"><input type="checkbox" id="pdv-identify" ${PDV.identifyClient?'checked':''}/><div><div style="font-size:12px;font-weight:500">\uD83D\uDC64 Identificar remetente na entrega</div><div style="font-size:10px;color:var(--muted)">Revelar quem enviou ao destinat\u00E1rio</div></div></label>
  </div>

  <div class="fg"><label class="fl">Observa\u00E7\u00F5es</label><textarea class="fi" id="pdv-notes" rows="2" placeholder="Observa\u00E7\u00F5es...">${PDV.notes}</textarea></div>

  <hr/>
  <!-- PAGAMENTO -->
  <div class="fr2">
    <div class="fg"><label class="fl">Desconto (R$)</label><input class="fi" type="number" id="pdv-disc" placeholder="0" value="${PDV.discount||''}"/></div>
    <div class="fg"><label class="fl">Forma de Pgto</label>
      <select class="fi" id="pdv-pay">
        ${['Pix','Dinheiro','Cr\u00E9dito','D\u00E9bito','Link','Cortesia','Boleto','Faturado','Pagar na Entrega'].map(m=>`<option ${PDV.payment===m?'selected':''}>${m}</option>`).join('')}
      </select>
    </div>
  </div>
  ${PDV.payment==='Pagar na Entrega'?`
  <div style="background:var(--gold-l);border-radius:var(--r);padding:14px;border:1px solid rgba(183,134,15,.2);margin-bottom:8px;">
    <div style="font-size:12px;font-weight:600;color:var(--gold);margin-bottom:10px;">\uD83D\uDCB0 Como o cliente vai pagar na entrega?</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button class="btn btn-sm ${PDV.paymentOnDelivery==='Dinheiro'?'btn-green':'btn-ghost'}" data-pod="Dinheiro" style="flex:1;justify-content:center;padding:10px;">
        \uD83D\uDCB5 Dinheiro
      </button>
      <button class="btn btn-sm ${PDV.paymentOnDelivery==='Levar Maquineta'?'btn-green':'btn-ghost'}" data-pod="Levar Maquineta" style="flex:1;justify-content:center;padding:10px;">
        \uD83D\uDCB3 Levar Maquineta
      </button>
    </div>
    ${PDV.paymentOnDelivery==='Dinheiro'?`
    <div style="margin-top:8px;background:#fff;border-radius:8px;padding:8px 10px;font-size:11px;color:var(--ink2);">
      \uD83D\uDCB5 Entregador cobrar\u00E1 <strong>${$c(total)}</strong> em dinheiro. Levar troco se necess\u00E1rio.
    </div>`:''}
    ${PDV.paymentOnDelivery==='Levar Maquineta'?`
    <div style="margin-top:8px;background:#fff;border-radius:8px;padding:8px 10px;font-size:11px;color:var(--ink2);">
      \uD83D\uDCB3 Entregador deve levar a maquineta \u2014 D\u00E9bito, Cr\u00E9dito ou Pix. Valor: <strong>${$c(total)}</strong>
    </div>`:''}
    ${!PDV.paymentOnDelivery?`<div style="margin-top:8px;font-size:11px;color:var(--gold);font-weight:500;">\u26A0\uFE0F Selecione como o entregador vai cobrar</div>`:''}
  </div>`:''}

  <hr/>
  <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted);margin-bottom:4px"><span>Subtotal</span><span>${$c(sub)}</span></div>
  ${PDV.discount>0?`<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--leaf);margin-bottom:4px"><span>Desconto</span><span>\u2212${$c(PDV.discount)}</span></div>`:''}
  ${deliveryFee>0?`<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--gold);margin-bottom:4px"><span>\uD83D\uDE9A Taxa entrega</span><span>+${$c(deliveryFee)}</span></div>`:''}
  <div style="display:flex;justify-content:space-between;font-size:16px;font-weight:700;color:var(--rose);margin-bottom:12px"><span>Total</span><span>${$c(total)}</span></div>
  <button type="button" class="btn btn-primary" id="btn-fin" onclick="finalizePDV()" style="width:100%;justify-content:center;padding:11px;font-size:13px">\u2705 Finalizar \u2014 ${$c(total)}</button>
</div>
</div>
</div>`;
}

// ── Finalizar PDV ────────────────────────────────────────────
export async function finalizePDV(){
  if(_pdvLock) return toast('\u23F3 Processando pedido, aguarde...');
  _pdvLock = true;
  const btn = document.getElementById('btn-fin');
  if(btn){ btn.disabled=true; btn.textContent='\u23F3 Finalizando...'; }
  try{
    await _finalizePDV();
  }catch(e){
    toast('\u274C Erro ao finalizar: '+(e.message||'Tente novamente'), true);
    console.error('[PDV] Erro ao finalizar:', e);
  }finally{
    _pdvLock = false;
    if(btn){ btn.disabled=false; btn.textContent='\u2705 Finalizar Pedido'; }
  }
}

export async function _finalizePDV(){
  if(!PDV.cart.length) return toast('\u274C Adicione produtos');
  const validUnitsCheck = ['Loja Novo Aleixo','Loja Allegro Mall','CDLE'];
  if(!validUnitsCheck.includes(S.user.unit)&&!PDV.saleUnit) return toast('\u274C Selecione a unidade de venda');
  // Valida unidade para Admin
  if((S.user.unit==='Todas'||( S.user?.role==='Administrador'||S.user?.cargo==='admin'))&&!PDV.saleUnit) return toast('\u274C Selecione a unidade de venda');
  if(!PDV.clientId&&!PDV.clientName) return toast('\u274C Informe o nome do cliente');
  if(!PDV.clientId&&!PDV.clientPhone) return toast('\u274C WhatsApp do cliente \u00E9 obrigat\u00F3rio');
  // ── VALIDA\u00C7\u00D5ES OBRIGAT\u00D3RIAS ──────────────────────────────
  if(!PDV.clientId&&!PDV.clientName?.trim()){
    toast('\u274C Nome do cliente \u00E9 obrigat\u00F3rio');
    document.getElementById('pdv-phone-search')?.focus();
    return;
  }
  if(!PDV.clientId&&!PDV.clientPhone?.trim()){
    toast('\u274C WhatsApp do cliente \u00E9 obrigat\u00F3rio');
    return;
  }
  if(PDV.type==='Delivery'||PDV.type==='Retirada'){
    if(!PDV.deliveryDate){
      toast('\u274C Data de entrega \u00E9 obrigat\u00F3ria');
      document.getElementById('pdv-date')?.focus();
      return;
    }
    if(!PDV.deliveryPeriod){
      toast('\u274C Turno de entrega \u00E9 obrigat\u00F3rio');
      return;
    }
  }
  if(PDV.type==='Retirada'&&!PDV.pickupUnit){
    toast('\u274C Selecione a loja de retirada');
    return;
  }
  if(PDV.type==='Delivery'){
    if(!PDV.neighborhood?.trim()){
      toast('\u274C Bairro de entrega \u00E9 obrigat\u00F3rio');
      document.getElementById('pdv-neighborhood')?.focus();
      return;
    }
    if(PDV.isCondominium&&(!PDV.block||!PDV.apt)){
      toast('\u274C Bloco e apartamento s\u00E3o obrigat\u00F3rios para condom\u00EDnio');
      return;
    }
    if(PDV.isCondominium&&!PDV.condName?.trim()){
      toast('\u274C Nome do condom\u00EDnio \u00E9 obrigat\u00F3rio');
      document.getElementById('pdv-cond-name')?.focus();
      return;
    }
  }
  // ─────────────────────────────────────────────────────────
  const sub=PDV.cart.reduce((s,i)=>s+i.price*i.qty,0);
  const deliveryFee=PDV.type==='Delivery'?(PDV.deliveryFee||0):0;
  const total=sub-(PDV.discount||0)+deliveryFee;
  const addr=[PDV.street,PDV.number,PDV.neighborhood,PDV.city,
    PDV.isCondominium?`${PDV.condName?PDV.condName+', ':''}Bloco ${PDV.block} Ap ${PDV.apt}`:'',
    PDV.reference].filter(Boolean).join(', ');
  // Determina unidade correta — nunca envia 'Todas'
  const validUnits = ['Loja Novo Aleixo','Loja Allegro Mall','CDLE'];
  const orderUnit = validUnits.includes(S.user.unit) ? S.user.unit : (PDV.saleUnit||'Loja Novo Aleixo');
  const data={
    ...(PDV.clientId ? {client:PDV.clientId} : {}),
    clientName: PDV.clientName||undefined,
    clientPhone: PDV.clientPhone||undefined,
    items:PDV.cart.map(i=>({product:i.id,name:i.name,qty:i.qty,unitPrice:i.price,totalPrice:i.price*i.qty})),
    subtotal:sub,discount:PDV.discount||0,total,
    payment:PDV.payment,type:PDV.type,
    scheduledDate:PDV.deliveryDate||undefined,
    scheduledPeriod:PDV.deliveryPeriod,
    scheduledTime:PDV.deliveryTime,
    recipient:PDV.recipient,
    recipientPhone:PDV.recipientPhone||'',
    cardMessage:PDV.cardMessage,
    notes:PDV.notes,
    deliveryAddress:addr,
    deliveryStreet:PDV.street,
    deliveryNumber:PDV.number,
    deliveryNeighborhood:PDV.neighborhood,
    deliveryReference:PDV.reference,
    isCondominium:PDV.isCondominium,
    condName:PDV.condName||undefined,
    block:PDV.block,apt:PDV.apt,
    source:'PDV',
    unit:orderUnit,
    paymentOnDelivery: PDV.payment==='Pagar na Entrega' ? PDV.paymentOnDelivery : undefined,
    deliveryFee:PDV.deliveryFee||0,
    deliveryZone:PDV.zone,
    deliveryCity:PDV.city,
    pickupUnit:PDV.pickupUnit||undefined,
    notifyClient:PDV.notifyClient,
    identifyClient:PDV.identifyClient,
  };
  try{
    S.loading=true;
    import('../main.js').then(m=>m.render()).catch(()=>{});
    const o=await POST('/orders',data);
    S.orders.unshift(o);
    invalidateCache('orders'); // novo pedido — invalida cache de pedidos
    // Log atividade de venda
    logActivity('venda', o);
    // Para Balcao e Retirada: registra receita imediatamente (pagamento na hora)
    if(o.type==='Balc\u00E3o' || o.type==='Retirada' || PDV.payment!=='Pagar na Entrega'){
      import('./financeiro.js').then(m=>m.registrarReceitaVenda(o)).catch(e=>console.warn('[PDV] registrarReceitaVenda:', e));
    }
    // Notifica loja sobre novo pedido via WhatsApp
    import('./whatsapp.js').then(m=>{
      if(m.notifyNewOrderWhatsApp) m.notifyNewOrderWhatsApp(o);
    }).catch(e=>console.warn('[PDV] notifyNewOrderWhatsApp:', e));
    notifyWhatsApp(o);
    // Pergunta se quer imprimir comanda
    S._newOrderId = o._id;
    PDV.cart=[];PDV.discount=0;PDV.payment='Pix';PDV.clientId='';PDV.clientName='';PDV.clientPhone='';PDV.clientEmail='';PDV.recipient='';PDV.recipientPhone='';PDV.cardMessage='';PDV.notes='';PDV.deliveryDate='';PDV.deliveryPeriod='Manh\u00E3';PDV.deliveryTime='';PDV.street='';PDV.neighborhood='';PDV.number='';PDV.city='';PDV.cep='';PDV.reference='';PDV.isCondominium=false;PDV.condName='';PDV.block='';PDV.apt='';PDV.type='Delivery';PDV.deliveryFee=0;PDV.zone='';PDV.clientSearch='';PDV.pickupUnit='';PDV.saleUnit='';PDV.notifyClient=true;PDV.identifyClient=true;PDV._showQuickReg=false;
    S.loading=false;S.page='pedidos';
    import('../main.js').then(m=>m.render()).catch(()=>{});
    toast('\u2705 Pedido '+o.orderNumber+' criado!');
    // Auto print comanda after 500ms
    setTimeout(()=>{
      if(o?.orderNumber){
        // Pergunta se quer imprimir — sem usar confirm() bloqueado
        S._modal=`<div class="mo" id="mo"><div class="mo-box" style="max-width:400px;text-align:center;" onclick="event.stopPropagation()">
        <div style="font-size:36px;margin-bottom:10px">\uD83D\uDDA8\uFE0F</div>
        <div style="font-size:16px;font-weight:700;margin-bottom:6px">Pedido ${o.orderNumber} criado!</div>
        <div style="font-size:13px;color:var(--muted);margin-bottom:18px">Deseja imprimir a comanda agora?</div>
        <div style="display:flex;gap:8px;justify-content:center;">
          <button class="btn btn-primary" id="btn-sim-imprimir">\uD83D\uDDA8\uFE0F Sim, Imprimir</button>
          <button class="btn btn-ghost" id="btn-nao-imprimir">N\u00E3o agora</button>
        </div></div></div>`;
        import('../main.js').then(m=>m.render()).catch(()=>{});
        document.getElementById('btn-sim-imprimir')?.addEventListener('click',()=>{
          S._modal='';
          import('../main.js').then(m=>m.render()).catch(()=>{});
          import('../pages/pedidos.js').then(m=>{ if(m.printComanda) m.printComanda(o._id); }).catch(e=>console.warn('[PDV] printComanda:', e));
        });
        document.getElementById('btn-nao-imprimir')?.addEventListener('click',()=>{
          S._modal='';
          import('../main.js').then(m=>m.render()).catch(()=>{});
        });
      }
    }, 600);
  }catch(e){
    S.loading=false;
    import('../main.js').then(m=>m.render()).catch(()=>{});
    throw e; // relan\u00E7a para finalizePDV() mostrar toast
  }
}

// ── Helpers locais ───────────────────────────────────────────

function getActivities(){ return JSON.parse(localStorage.getItem('fv_activities')||'[]'); }

function logActivity(type, order){
  if(!S.user) return;
  const acts = getActivities();
  acts.push({
    id: Date.now()+'_'+Math.random().toString(36).slice(2,7),
    userId: S.user._id, userName: S.user.name, userRole: S.user.role,
    userEmail: (S.user.email||'').toLowerCase(),
    colabId: S.user.colabId||S.user.id||S.user._id,
    type, orderId: order._id, orderNumber: order.orderNumber||'—',
    items: order.items||[], total: order.total||0,
    date: new Date().toISOString(),
  });
  localStorage.setItem('fv_activities', JSON.stringify(acts));
}

function notifyWhatsApp(order){
  const num = '5592993002433';
  const items = (order.items||[]).map(i=>`\u2022 ${i.qty}x ${i.name}`).join('\n');
  const msg = [
    '\uD83C\uDF3A *NOVO PEDIDO \u2014 La\u00E7os Eternos*',
    `*N\u00BA:* ${order.orderNumber||'\u2014'}`,
    `*Cliente:* ${order.client?.name||order.clientName||'\u2014'} ${order.clientPhone?'('+order.clientPhone+')':''}`,
    `*Produto:*\n${items}`,
    order.recipient?`*Destinat\u00E1rio:* ${order.recipient}`:'',
    order.deliveryAddress?`*Endere\u00E7o:* ${order.deliveryAddress}`:'',
    order.scheduledPeriod?`*Turno:* ${order.scheduledPeriod} ${order.scheduledTime||''}`:'',
    order.cardMessage?`*Cart\u00E3o:* "${order.cardMessage}"`:'',
    `*Pgto:* ${order.payment||'\u2014'} \u00B7 *Total:* ${new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(order.total||0)}`,
    order.notes?`*Obs:* ${order.notes}`:'',
  ].filter(Boolean).join('\n');

  // Tenta enviar sem abrir nova janela usando fetch
  // Como nao temos API WhatsApp Business, abre discretamente em background
  const link = `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
  // Salva para log de notificacoes
  const logs = JSON.parse(localStorage.getItem('fv_notif_logs')||'[]');
  logs.unshift({orderNum:order.orderNumber, msg, time:new Date().toISOString(), link});
  localStorage.setItem('fv_notif_logs', JSON.stringify(logs.slice(0,20)));
  // Abre em nova aba minimizada
  const w = window.open(link, '_blank', 'width=1,height=1,left=-100,top=-100');
  setTimeout(()=>{ try{ if(w&&!w.closed) w.close(); }catch(e){ console.warn('[PDV] notifyWhatsApp close error:', e); } }, 3000);
}
