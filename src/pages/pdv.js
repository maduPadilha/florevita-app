// ── PDV (Ponto de Venda) ─────────────────────────────────────
import { S, PDV, DELIVERY_FEES, BAIRROS_MANAUS, resetPDV } from '../state.js';
import { $c, emoji, esc, ini } from '../utils/formatters.js';
import { POST, PATCH } from '../services/api.js';
import { toast, setPage, logActivity as _logActivity, getActivities as _getActivities } from '../utils/helpers.js';
import { can, findColab } from '../services/auth.js';
import { invalidateCache } from '../services/cache.js';
import { opcoesPermitidas, isAdmin, normalizeUnidade, labelUnidade, podeCriarPedido } from '../utils/unidadeRules.js';
import { tierBadgeHTML, getClientWithStats } from './clientes.js';
import { fmtOrderNum } from '../utils/formatters.js';

let _pdvLock = false;

// ── POPUP PÓS-PEDIDO — imune a renders do sistema ─────────────
// Injeta overlay direto em document.body. Não usa S._modal nem render().
function showPostOrderPopup(o){
  // Remove qualquer popup anterior
  const old = document.getElementById('po-overlay');
  if(old) old.remove();

  const dataEntrega = o.scheduledDate
    ? new Date(o.scheduledDate).toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'2-digit',year:'numeric'})
    : '—';
  const turno = o.scheduledPeriod || '';
  const hora  = o.scheduledTime  || '';
  const horaLabel = [turno, hora].filter(Boolean).join(' · ');
  const isPagarNaEntrega = (o.payment === 'Pagar na Entrega');
  const totalFmt = 'R$ ' + (o.total||0).toFixed(2).replace('.',',');
  const trocoInfo = (isPagarNaEntrega && o.paymentOnDelivery==='Dinheiro' && o.trocoPara && parseFloat(o.trocoPara) > (o.total||0))
    ? ` · Troco p/ R$ ${parseFloat(o.trocoPara).toFixed(2).replace('.',',')}` : '';

  // Numero do pedido na sequencia historica do cliente.
  // ESTE pedido ja foi salvo, entao ele esta incluido no totalOrders atual.
  let pedidoNumeroCliente = 0;
  let nomeCliente = '';
  try {
    const cliId = o.client?._id || o.client;
    if (cliId) {
      const cli = getClientWithStats(cliId) || S.clients.find(c => c._id === cliId);
      if (cli) {
        pedidoNumeroCliente = parseInt(cli.totalOrders) || 1;
        nomeCliente = cli.name || o.clientName || '';
      }
    }
  } catch(_){}

  const overlay = document.createElement('div');
  overlay.id = 'po-overlay';
  overlay.setAttribute('style',
    'position:fixed;top:0;left:0;right:0;bottom:0;' +
    'background:rgba(0,0,0,.55);z-index:2147483647;' +
    'display:flex;align-items:center;justify-content:center;' +
    'padding:20px;box-sizing:border-box;' +
    'animation:po-fadein .2s ease-out;'
  );

  overlay.innerHTML = `
    <style>
      @keyframes po-fadein { from { opacity: 0; } to { opacity: 1; } }
      @keyframes po-slideup { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
    </style>
    <div style="background:#fff;border-radius:20px;max-width:440px;width:100%;overflow:hidden;box-shadow:0 25px 70px rgba(0,0,0,.3);animation:po-slideup .25s ease-out;">
      <div style="background:#1F5C2E;padding:22px 24px 18px;text-align:center;">
        <div style="font-size:11px;color:rgba(255,255,255,.8);letter-spacing:1px;text-transform:uppercase;margin-bottom:4px;">Laços Eternos 🌸</div>
        <div style="font-family:'Playfair Display',serif;font-size:20px;color:#fff;font-weight:600;">✅ Pedido lançado!</div>
      </div>
      <div style="background:linear-gradient(135deg,#F0FDF4,#fff);padding:24px;">
        <div style="background:#fff;border:1.5px solid #E5E7EB;border-radius:12px;padding:14px 16px;margin-bottom:16px;">
          <div style="display:flex;justify-content:space-between;align-items:center;padding-bottom:10px;margin-bottom:10px;border-bottom:1px dashed #E5E7EB;">
            <span style="font-size:11px;color:#6B7280;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Código</span>
            <span style="font-size:22px;font-weight:900;color:#8B2252;font-family:'Playfair Display',serif;">${fmtOrderNum(o)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:10px;margin-bottom:10px;border-bottom:1px dashed #E5E7EB;">
            <span style="font-size:11px;color:#6B7280;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Entrega</span>
            <div style="text-align:right;">
              <div style="font-size:13px;font-weight:700;color:#333;">${dataEntrega}</div>
              ${horaLabel?`<div style="font-size:11px;color:#6B7280;">${horaLabel}</div>`:''}
            </div>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:11px;color:#6B7280;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Pagamento</span>
            <div style="text-align:right;">
              <div style="font-size:13px;font-weight:700;color:#333;">${o.payment||'—'}${trocoInfo}</div>
              <div style="font-size:13px;color:#1F5C2E;font-weight:700;">${totalFmt}</div>
            </div>
          </div>
        </div>
        ${pedidoNumeroCliente > 0 ? `
        <div style="background:#FEF3C7;border:1.5px solid #F59E0B;border-radius:10px;padding:10px 14px;margin-bottom:14px;text-align:center;font-size:13px;font-weight:700;color:#78350F;">
          🎯 Esse é o <strong style="font-size:16px;">${pedidoNumeroCliente}º pedido</strong> ${nomeCliente?'de <strong>'+nomeCliente+'</strong>':'desse cliente'}
        </div>` : ''}
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button id="po-btn-imprimir" style="flex:1;min-width:140px;background:#8B2252;color:#fff;border:none;padding:13px 14px;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;">🖨️ Imprimir Pedido</button>
          ${isPagarNaEntrega
            ? `<div style="flex:1;min-width:140px;background:#FFF8E1;border:1px dashed #B7860F;border-radius:10px;padding:10px;font-size:11px;color:#8B6914;text-align:center;line-height:1.3;display:flex;align-items:center;justify-content:center;">🚚 Pagamento na entrega pelo entregador</div>`
            : `<button id="po-btn-aprovar" style="flex:1;min-width:140px;background:linear-gradient(135deg,#059669,#047857);color:#fff;border:none;padding:13px 14px;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 4px 12px rgba(5,150,105,.3);">✅ Aprovar Pagamento</button>`}
        </div>
        ${!isPagarNaEntrega ? `
        <div style="background:#FEF3C7;border:1px dashed #F59E0B;border-radius:8px;padding:8px 12px;margin-top:10px;font-size:11px;color:#78350F;text-align:center;font-weight:600;">
          ⚠️ Pagamento ainda <strong>aguardando confirmação</strong> — clique em "Aprovar Pagamento" após confirmar o recebimento.
        </div>` : ''}
      </div>
      <div style="padding:14px 24px 18px;background:#fff;text-align:center;border-top:1px solid #F3F4F6;">
        <button id="po-btn-fechar" style="background:transparent;color:#6B7280;border:1px solid #E5E7EB;padding:8px 24px;border-radius:8px;font-size:12px;cursor:pointer;">Fechar</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  console.log('[PDV popup] Overlay injetado no body. Elemento:', overlay);

  const closeOverlay = () => { overlay.remove(); };

  // Click fora do card fecha
  overlay.addEventListener('click', e => {
    if(e.target === overlay) closeOverlay();
  });

  // Botões
  overlay.querySelector('#po-btn-fechar')?.addEventListener('click', closeOverlay);
  overlay.querySelector('#po-btn-imprimir')?.addEventListener('click', () => {
    import('../pages/impressao.js').then(m => {
      if(m.printComanda) m.printComanda(o._id);
    }).catch(err => console.warn('[PDV popup] printComanda erro:', err));
  });
  overlay.querySelector('#po-btn-aprovar')?.addEventListener('click', async () => {
    try{
      const { PUT } = await import('../services/api.js');
      await PUT('/orders/'+o._id, { paymentStatus:'Aprovado' });
      const updated = { ...o, paymentStatus:'Aprovado' };
      S.orders = S.orders.map(x => x._id===o._id ? updated : x);
      invalidateCache('orders');
      // Registra receita SO agora (apos aprovacao)
      import('./financeiro.js').then(m => m.registrarReceitaVenda(updated)).catch(()=>{});
      toast('✅ Pagamento aprovado e receita registrada!');
      closeOverlay();
    }catch(e){
      console.error('[PDV popup] aprovar erro:', e);
      toast('❌ Erro ao aprovar: '+(e.message||''), true);
    }
  });
}

export function renderPDV(){
  if(!can('pdv')) return `<div class="empty card"><div class="empty-icon">&#x1F6AB;</div><p>Sem permiss\u00e3o</p></div>`;
  // ── Regras de unidade (multi-unit) ───────────────────────────
  const opcoes = opcoesPermitidas(S.user);
  const admin = isAdmin(S.user);
  const tiposPermitidos = opcoes.tipos || [];
  // Mapeia slug → rótulo interno do PDV (PDV.type usa strings em PT-BR)
  const tipoSlugToKey = { balcao: 'Balc\u00E3o', retirada: 'Retirada', delivery: 'Delivery' };
  const tipoKeyLabel  = { 'Balc\u00E3o': '\uD83C\uDFEA Balc\u00E3o', 'Retirada': '\uD83D\uDCE6 Retirada na Loja', 'Delivery': '\uD83D\uDE9A Delivery' };
  // Garante que PDV.type seja um tipo permitido
  if(tiposPermitidos.length > 0){
    const allowedKeys = tiposPermitidos.map(t => tipoSlugToKey[t]);
    if(!allowedKeys.includes(PDV.type)) PDV.type = allowedKeys[0];
  }
  // Destinos permitidos por tipo (para Retirada/Balcão)
  const destinosRetirada = (opcoes.combinacoes || []).filter(c => c.tipo === 'retirada').map(c => c.destino);
  const destinosBalcao   = (opcoes.combinacoes || []).filter(c => c.tipo === 'balcao').map(c => c.destino);

  const sub=PDV.cart.reduce((s,i)=>s+i.price*i.qty,0);
  const deliveryFee=PDV.type==='Delivery'?(PDV.deliveryFee||0):0;
  const total=sub-(PDV.discount||0)+deliveryFee;

  // HTML do card de busca de produto — usado abaixo do cliente
  const addProductHTML = `
  <div class="fg" style="margin-top:10px;margin-bottom:6px;">
    <label class="fl">\uD83D\uDCE6 Adicionar Produto ao Carrinho</label>
    <div style="position:relative;">
      <input
        class="fi"
        id="pdv-prod-search"
        placeholder="\uD83D\uDD0D Buscar produto por nome..."
        autocomplete="off"
        style="padding:12px 14px;font-size:14px;border:2px solid var(--rose-l);border-radius:10px;"
      />
      <div id="pdv-prod-suggestions" style="position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid var(--border);border-radius:10px;margin-top:4px;max-height:400px;overflow-y:auto;box-shadow:0 8px 24px rgba(0,0,0,.15);z-index:100;display:none;"></div>
    </div>
  </div>`;

  // HTML do Cliente (incluindo busca + cadastro rápido)
  const clienteCardHTML = `
  <div class="card" style="margin-bottom:14px;">
    <div class="card-title">\uD83D\uDC64 Cliente</div>

    ${(()=>{
      const isAdmin = S.user?.role==='Administrador' || S.user?.cargo==='admin';
      const userUnit = S.user?.unit;
      const specificUnits = ['Loja Novo Aleixo','Loja Allegro Mall','CDLE'];
      if(isAdmin || userUnit==='Todas' || !specificUnits.includes(userUnit)){
        return `<div class="fg"><label class="fl">Unidade de Venda *</label>
          <select class="fi" id="pdv-sale-unit">
            <option value="">Selecione...</option>
            <option value="Loja Novo Aleixo" ${PDV.saleUnit==='Loja Novo Aleixo'?'selected':''}>\uD83C\uDF3A Loja Novo Aleixo</option>
            <option value="Loja Allegro Mall" ${PDV.saleUnit==='Loja Allegro Mall'?'selected':''}>\uD83C\uDF3A Loja Allegro Mall</option>
            <option value="CDLE" ${PDV.saleUnit==='CDLE'?'selected':''}>\uD83D\uDCE6 CDLE</option>
          </select>
        </div>`;
      }
      if(PDV.saleUnit!==userUnit) PDV.saleUnit = userUnit;
      const icon = userUnit==='CDLE' ? '\uD83D\uDCE6' : '\uD83C\uDF3A';
      return `<div class="fg"><label class="fl">Unidade de Venda</label>
        <div style="display:inline-flex;align-items:center;gap:8px;background:var(--petal,#fce7f0);border:1px solid var(--rose-l,#f5c2d4);color:var(--rose,#b83260);border-radius:999px;padding:6px 12px;font-size:12px;font-weight:600;">
          <span>${icon}</span><span>${userUnit}</span>
          <span style="font-size:10px;opacity:.7;font-weight:500;">(fixada)</span>
        </div>
      </div>`;
    })()}

    <!-- VENDEDOR (quem fez a venda \u2014 pode ser diferente do logado) -->
    ${(() => {
      // Todos os colaboradores ativos podem ser vendedores
      // (Atendente faz tudo: vende, monta e expede)
      let colabs = [];
      try { colabs = JSON.parse(localStorage.getItem('fv_colabs')||'[]'); } catch(_){}
      colabs = colabs.filter(c => c.active !== false && c.cargo !== 'Entregador' && c.cargo !== 'entregador');
      // Default: o proprio user logado se nao definido
      const myId = String(S.user?._id || S.user?.colabId || '');
      const myEmail = String(S.user?.email||'').toLowerCase();
      if (!PDV.vendedorId && S.user) {
        PDV.vendedorId    = myId;
        PDV.vendedorNome  = S.user.name || S.user.nome || '';
        PDV.vendedorEmail = S.user.email || '';
      }
      // Lista: o user logado primeiro com (voc\u00EA), depois todos os outros colabs
      const eu = S.user ? [{ _id: myId, apiId: myId, name: (S.user.name || S.user.nome || '?') + ' (voc\u00EA)', email: S.user.email }] : [];
      const outros = colabs.filter(c => {
        const cid = String(c.apiId || c._id || '');
        const cem = String(c.email||'').toLowerCase();
        return cid !== myId && cem !== myEmail;
      });
      const todos = eu.concat(outros);
      const optsHtml = todos.map(c => {
        const cid = String(c.apiId || c._id || '');
        const cn = (c.name||'?').replace(/"/g,'');
        const ce = (c.email||'').replace(/"/g,'');
        const sel = String(PDV.vendedorId) === cid ? 'selected' : '';
        return `<option value="${cid}|${cn}|${ce}" ${sel}>${c.name||'?'}</option>`;
      }).join('');
      return `<div class="fg"><label class="fl">\uD83D\uDC64 Vendedor (quem fez a venda) *</label>
        <select class="fi" id="pdv-vendedor">${optsHtml}</select>
        <div style="font-size:10px;color:var(--muted);margin-top:3px;">${todos.length} colaborador${todos.length===1?'':'es'} dispon\u00EDveis \u00B7 Comiss\u00E3o de venda vai para o selecionado</div>
      </div>`;
    })()}

    ${(() => {
      // ── CANAL DE VENDA ─────────────────────────────────────
      // Auto-preenche conforme a unidade do colaborador:
      //   - Loja fisica (Novo Aleixo / Allegro) → Balcao por padrao
      //   - CDLE / admin → WhatsApp/Online por padrao
      // E-commerce: SO admin ou usuarios com modulos.canalEcommerce=true
      const isAdmin = S.user?.role==='Administrador' || S.user?.cargo==='admin';
      const userUnit = S.user?.unit || '';
      const isLojaFisica = (userUnit === 'Loja Novo Aleixo' || userUnit === 'Loja Allegro Mall');
      const podeEcommerce = isAdmin || !!(S.user?.modulos && S.user.modulos.canalEcommerce);

      // Define padrao se ainda nao escolhido
      if (!PDV.salesChannel) {
        PDV.salesChannel = isLojaFisica ? 'Balcão' : 'WhatsApp/Online';
      }

      const opcoes = [
        { v:'WhatsApp/Online', l:'WhatsApp/Online', icon:'/icones/whatsapp.png' },
        { v:'Balcão',          l:'Balcão',          icon:'/icones/balcao.png' },
        { v:'iFood',           l:'iFood',           icon:'/icones/ifood.png' },
      ];
      if (podeEcommerce) opcoes.push({ v:'E-commerce', l:'E-commerce', icon:'/icones/ecommerce.png' });

      const sel = PDV.salesChannel;
      const selOpt = opcoes.find(o => o.v === sel) || opcoes[0];

      return `<div class="fg"><label class="fl">Canal de Venda <span style="color:var(--red)">*</span></label>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <select class="fi" id="pdv-sales-channel" style="flex:1;min-width:180px;display:flex;align-items:center;">
            ${opcoes.map(op => `<option value="${op.v}" ${op.v===sel?'selected':''}>${op.l}${op.v==='E-commerce'?' 🛒 (admin)':''}</option>`).join('')}
          </select>
          <img src="${selOpt.icon}" alt="${selOpt.l}" style="width:32px;height:32px;object-fit:contain;border:1px solid var(--border);border-radius:8px;padding:3px;background:#fff;"/>
        </div>
        ${!podeEcommerce ? '<div style="font-size:10px;color:var(--muted);margin-top:3px;">💡 E-commerce: disponível apenas para Administrador (ou usuário autorizado).</div>' : ''}
      </div>`;
    })()}

    <!-- BUSCA CLIENTE -->
    <div class="fg">
      <label class="fl">Cliente \u2014 6 \u00FAltimos d\u00EDgitos ou nome <span style="color:var(--red)">*</span></label>
      <div style="position:relative;">
        <input class="fi" id="pdv-phone-search"
          placeholder="Ex: 234567 ou 'Maria Silva'..."
          value="${PDV.clientSearch}"
          autocomplete="off"
          style="padding-right:36px;"/>
        ${PDV.clientSearch?`<button id="pdv-search-clear" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--muted);font-size:16px;line-height:1;">\u2715</button>`:''}
      </div>
      <div id="pdv-search-results"></div>

      ${PDV.clientId?(()=>{
        const _cs = getClientWithStats(PDV.clientId) || S.clients.find(c=>c._id===PDV.clientId) || {};
        const totalP = parseInt(_cs.totalOrders) || 0;
        const labelTier = totalP <= 1 ? 'Novo' : totalP >= 4 ? 'VIP' : 'Recorrente';
        const corTier  = totalP <= 1 ? '#059669' : totalP >= 4 ? '#D97706' : '#1D4ED8';
        return `
      <div style="background:var(--leaf-l);border-radius:8px;padding:10px 14px;margin-top:6px;display:flex;align-items:center;gap:10px;border:1px solid rgba(31,92,46,.2);">
        <div class="av" style="width:34px;height:34px;font-size:12px;background:var(--leaf)">${ini(_cs.name||PDV.clientName)}</div>
        <div style="flex:1;">
          <div style="font-weight:700;font-size:13px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            <span>${_cs.name||PDV.clientName} <span style="color:var(--muted);font-weight:600;">- ${totalP} pedido${totalP===1?'':'s'}</span></span>
            ${_cs.code?`<span style="font-size:10px;color:var(--rose);font-weight:700;background:#fff;padding:1px 7px;border-radius:10px;border:1px solid var(--rose-l);">#${_cs.code}</span>`:''}
            <span style="font-size:11px;color:#fff;font-weight:800;background:${corTier};padding:2px 9px;border-radius:10px;letter-spacing:.3px;">${labelTier}</span>
          </div>
          <div style="font-size:11px;color:var(--muted)">${_cs.phone||PDV.clientPhone}</div>
        </div>
        <button class="btn btn-ghost btn-xs" id="pdv-clear-cli">\u2715 Trocar</button>
      </div>`;})():(!PDV.clientId&&PDV.clientName?`
      <div style="background:var(--cream);border-radius:8px;padding:8px 12px;margin-top:6px;font-size:12px;display:flex;align-items:center;justify-content:space-between;">
        <span><strong>${PDV.clientName}</strong> ${PDV.clientPhone?'\u00B7 '+PDV.clientPhone:''} <span class="tag t-blue" style="margin-left:4px">Novo</span></span>
        <button class="btn btn-ghost btn-xs" id="pdv-clear-cli">\u2715</button>
      </div>`:'')}
    </div>

    <!-- CADASTRO R\u00C1PIDO -->
    ${PDV._showQuickReg?`
    <div style="background:var(--petal);border-radius:var(--r);padding:14px;border:1px solid var(--rose-l);margin-bottom:10px;">
      <div style="font-weight:600;font-size:13px;margin-bottom:10px;color:var(--rose)">\u2795 Cadastro R\u00E1pido</div>
      <div class="fr2">
        <div class="fg"><label class="fl">Nome *</label><input class="fi" id="qr-name" placeholder="Nome completo"/></div>
        <div class="fg"><label class="fl">WhatsApp *</label><input class="fi" id="qr-phone" placeholder="(92) 9xxxx-xxxx"/></div>
      </div>
      <div id="qr-phone-warn" style="display:none;background:var(--red-l);border-radius:8px;padding:8px 10px;font-size:11px;color:var(--red);margin-bottom:8px;"></div>
      <div class="fr2">
        <div class="fg"><label class="fl">CPF <span style="font-size:10px;color:var(--muted);font-weight:400;">(opcional)</span></label>
          <input class="fi" id="qr-cpf" placeholder="000.000.000-00" maxlength="14" inputmode="numeric"/>
        </div>
        <div class="fg"><label class="fl">Anivers\u00E1rio</label><input class="fi" id="qr-bday" type="date"/></div>
      </div>
      <div class="fr2">
        <div class="fg" style="grid-column:span 2"><label class="fl">Rua / Avenida</label><input class="fi" id="qr-street" placeholder="Rua das Flores"/></div>
        <div class="fg"><label class="fl">N\u00FAmero</label><input class="fi" id="qr-number" placeholder="123"/></div>
        <div class="fg"><label class="fl">Bairro</label>
          <input class="fi" id="qr-neigh" placeholder="Selecione ou digite..." list="bairros-manaus"/>
        </div>
        <div class="fg"><label class="fl">CEP</label><input class="fi" id="qr-cep" placeholder="69000-000"/></div>
      </div>
      <div style="display:flex;gap:6px;">
        <button class="btn btn-primary btn-sm" id="btn-qr-save">\u2705 Salvar e usar</button>
        <button class="btn btn-ghost btn-sm" id="btn-qr-cancel">Cancelar</button>
      </div>
    </div>`:''}
    <datalist id="bairros-manaus">
      ${BAIRROS_MANAUS.map(b=>`<option value="${b}">`).join('')}
    </datalist>
  </div>`;

  // HTML do Carrinho
  const carrinhoHTML = `
  <div class="card" style="margin-bottom:14px;">
    <div class="card-title">\uD83D\uDED2 Carrinho (${PDV.cart.length} ${PDV.cart.length===1?'item':'itens'})</div>

    <!-- BUSCA DE PRODUTO -->
    ${addProductHTML}

    ${PDV.cart.length===0 ? `
      <div style="text-align:center;padding:30px 16px;color:var(--muted);margin-top:10px;">
        <div style="font-size:36px;margin-bottom:8px;opacity:.5;">\uD83D\uDECD\uFE0F</div>
        <div style="font-size:13px;font-weight:600;margin-bottom:4px;">Carrinho vazio</div>
        <div style="font-size:11px;">Busque produtos acima para adicionar</div>
      </div>
    ` : `
      <div style="max-height:340px;overflow-y:auto;margin-top:8px;">
        ${PDV.cart.map(it=>`
          <div style="display:flex;align-items:center;gap:10px;padding:10px 4px;border-bottom:1px solid var(--border);">
            <div style="flex:1;min-width:0;">
              <div style="font-weight:600;font-size:13px;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${it.name}</div>
              <div style="font-size:10px;color:var(--muted);margin-top:2px;">R$ ${(it.price||0).toFixed(2).replace('.',',')} \u00B7 un</div>
            </div>
            <div style="display:flex;align-items:center;gap:2px;">
              <button class="btn btn-ghost btn-xs" data-dec="${it.id}" style="width:26px;height:26px;padding:0;font-size:13px;">\u2212</button>
              <span style="min-width:24px;text-align:center;font-weight:700;font-size:13px;">${it.qty}</span>
              <button class="btn btn-ghost btn-xs" data-inc="${it.id}" style="width:26px;height:26px;padding:0;font-size:13px;">+</button>
            </div>
            <div style="font-weight:700;color:var(--rose);font-size:13px;min-width:64px;text-align:right;">R$ ${((it.price||0)*(it.qty||0)).toFixed(2).replace('.',',')}</div>
          </div>
        `).join('')}
      </div>
      <div style="padding:12px 14px;background:var(--cream);border-radius:8px;margin-top:10px;">
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted);margin-bottom:3px;">
          <span>Subtotal:</span><span>R$ ${sub.toFixed(2).replace('.',',')}</span>
        </div>
        ${(PDV.discount||0)>0?`<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted);margin-bottom:3px;">
          <span>Desconto:</span><span>- R$ ${(PDV.discount||0).toFixed(2).replace('.',',')}</span>
        </div>`:''}
        ${deliveryFee>0?`<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted);margin-bottom:3px;">
          <span>Taxa:</span><span>R$ ${deliveryFee.toFixed(2).replace('.',',')}</span>
        </div>`:''}
        <div style="display:flex;justify-content:space-between;font-size:15px;font-weight:700;color:var(--ink);margin-top:6px;padding-top:6px;border-top:1px solid var(--border);">
          <span>Total:</span><span style="color:var(--rose);">R$ ${total.toFixed(2).replace('.',',')}</span>
        </div>
      </div>
    `}
  </div>`;

  return `<div class="pdv-grid">
<!-- COLUNA ESQUERDA: Cliente + Carrinho -->
<div>
  ${clienteCardHTML}
  ${carrinhoHTML}
</div>

<!-- COLUNA DIREITA: Pedido (destinatário, entrega, pagamento) -->
<div>
<div class="card">
  <div class="card-title">\uD83D\uDCDD Detalhes do Pedido</div>

  <!-- DESTINAT\u00C1RIO E CART\u00C3O -->
  <div class="fg"><label class="fl">Destinat\u00E1rio</label><input class="fi" id="pdv-recipient" placeholder="Nome de quem vai receber" value="${PDV.recipient}"/></div>
  <div class="fg"><label class="fl">WhatsApp / Telefone do destinat\u00E1rio</label><input class="fi" id="pdv-recip-phone" type="tel" placeholder="(92) 9xxxx-xxxx" value="${PDV.recipientPhone||''}"/></div>
  <div class="fg"><label class="fl">Mensagem do cart\u00E3o</label><textarea class="fi" id="pdv-cardmsg" rows="2" placeholder="Mensagem para o cart\u00E3o...">${PDV.cardMessage}</textarea></div>

  <hr/>
  <!-- DATA E TURNO -->
  <div style="font-size:12px;font-weight:600;margin-bottom:8px;color:var(--ink)">\uD83D\uDCC5 Data e Entrega</div>
  <div class="fr2">
    <div class="fg">
      <label class="fl">Data de entrega <span style="color:var(--red)">*</span></label>
      <div style="display:flex;gap:4px;align-items:stretch;">
        <input class="fi" type="date" id="pdv-date" style="flex:1;min-width:0;border-color:${!PDV.deliveryDate&&(PDV.type==='Delivery'||PDV.type==='Retirada')?'var(--red)':''}" value="${PDV.deliveryDate}"/>
        <button type="button" class="btn btn-ghost btn-sm" id="pdv-date-hoje" style="padding:6px 10px;font-size:11px;white-space:nowrap;">Hoje</button>
        <button type="button" class="btn btn-ghost btn-sm" id="pdv-date-amanha" style="padding:6px 10px;font-size:11px;white-space:nowrap;">Amanhã</button>
      </div>
    </div>
    <div class="fg"><label class="fl">Turno <span style="color:var(--red)">*</span></label>
      <select class="fi" id="pdv-period">
        <option ${PDV.deliveryPeriod==='Manh\u00E3'?'selected':''}>Manh\u00E3</option>
        <option ${PDV.deliveryPeriod==='Tarde'?'selected':''}>Tarde</option>
        <option ${PDV.deliveryPeriod==='Noite'?'selected':''}>Noite</option>
        <option ${PDV.deliveryPeriod==='Hor\u00E1rio espec\u00EDfico'?'selected':''}>Hor\u00E1rio espec\u00EDfico</option>
      </select>
    </div>
  </div>
  ${PDV.deliveryPeriod==='Hor\u00E1rio espec\u00EDfico'?(() => {
    // Gera opcoes de 30 em 30 min entre 07:00 e 20:00
    const opts = [];
    for (let h = 7; h <= 20; h++) {
      for (let m = 0; m < 60; m += 30) {
        if (h === 20 && m > 0) break;
        opts.push(String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0'));
      }
    }
    const optHTML = (selected) => '<option value="">--:--</option>' +
      opts.map(t => `<option value="${t}" ${selected===t?'selected':''}>${t}</option>`).join('');
    return `
  <div class="fg">
    <label class="fl">Hor\u00E1rio Espec\u00EDfico * <span style="font-size:10px;color:var(--muted)">(ex: Entre 10:00 e 11:00)</span></label>
    <div class="fr2">
      <div><label class="fl" style="font-size:10px">Das</label>
        <select class="fi" id="pdv-time-from">${optHTML(PDV.deliveryTimeFrom||'')}</select></div>
      <div><label class="fl" style="font-size:10px">At\u00E9</label>
        <select class="fi" id="pdv-time-to">${optHTML(PDV.deliveryTimeTo||'')}</select></div>
    </div>
    <div style="font-size:11px;color:var(--blue);margin-top:4px;">\uD83D\uDD34 Marcado como PRIORIDADE na expedi\u00E7\u00E3o</div>
  </div>`;
  })():''}

  <!-- TIPO DE ENTREGA -->
  <div class="fg"><label class="fl">Tipo de Entrega</label>
    <div style="display:flex;gap:6px;flex-wrap:wrap;">
      ${tiposPermitidos.map(t => {
        const key = tipoSlugToKey[t];
        return `<button class="btn btn-sm ${PDV.type===key?'btn-primary':'btn-ghost'}" data-type="${key}">${tipoKeyLabel[key]}</button>`;
      }).join('')}
    </div>
  </div>

  ${PDV.type==='Retirada' && destinosRetirada.length > 0 ? `
  <div class="fg"><label class="fl">Retirada em <span style="color:var(--red)">*</span></label>
    <select class="fi" id="pdv-pickup-unit">
      ${destinosRetirada.length > 1 ? `<option value="">Selecionar loja...</option>` : ''}
      ${destinosRetirada.map(d => `<option value="${d}" ${normalizeUnidade(PDV.pickupUnit)===d?'selected':''}>\uD83C\uDF3A ${labelUnidade(d)}</option>`).join('')}
    </select>
  </div>`:''}

  ${PDV.type==='Balc\u00E3o' && destinosBalcao.length > 1 ? `
  <div class="fg"><label class="fl">Balc\u00E3o em <span style="color:var(--red)">*</span></label>
    <select class="fi" id="pdv-pickup-unit">
      <option value="">Selecionar loja...</option>
      ${destinosBalcao.map(d => `<option value="${d}" ${normalizeUnidade(PDV.pickupUnit)===d?'selected':''}>\uD83C\uDF3A ${labelUnidade(d)}</option>`).join('')}
    </select>
  </div>`:''}

  ${PDV.type==='Delivery'?`
  <hr/>
  <div style="font-size:12px;font-weight:600;margin-bottom:8px;color:var(--ink)">\uD83D\uDCB0 Taxa de Entrega</div>
  <div class="fr2">
    <div class="fg"><label class="fl">Cidade <span style="color:var(--red)">*</span></label>
      <select class="fi" id="pdv-city-sel" style="border-color:${!PDV.city?'var(--red)':''};">
        <option value="">Selecionar cidade...</option>
        ${Object.keys(DELIVERY_FEES).map(c=>`<option value="${c}" ${PDV.city===c?'selected':''}>${c}</option>`).join('')}
      </select>
    </div>
    <div class="fg"><label class="fl">Zona / Bairro <span style="color:var(--red)">*</span></label>
      <select class="fi" id="pdv-zone-sel" ${!PDV.city?'disabled':''} style="border-color:${!PDV.zone&&PDV.city?'var(--red)':''};">
        <option value="">Selecionar zona...</option>
        ${PDV.city&&DELIVERY_FEES[PDV.city]?Object.entries(DELIVERY_FEES[PDV.city]).map(([z,v])=>`<option value="${z}" ${PDV.zone===z?'selected':''}>${z} \u2014 ${$c(v)}</option>`).join(''):''}
      </select>
    </div>
  </div>
  ${PDV.deliveryFee>0?`<div style="background:var(--gold-l);border-radius:8px;padding:8px 12px;font-size:12px;margin-bottom:8px;">\uD83D\uDE9A Taxa: <strong>${$c(PDV.deliveryFee)}</strong></div>`:''}
  <hr/>
  <div style="font-size:12px;font-weight:600;margin-bottom:8px;color:var(--ink)">\uD83D\uDCCD Endere\u00E7o de Entrega</div>
  <div class="fg"><label class="fl">Rua / Avenida <span style="color:var(--red)">*</span></label>
    <input class="fi" id="pdv-street" placeholder="Rua das Flores" value="${PDV.street}" required
      style="border-color:${!PDV.street?'var(--red)':''};"/></div>
  <div class="fr3">
    <div class="fg"><label class="fl">N\u00FAmero <span style="color:var(--red)">*</span></label>
      <input class="fi" id="pdv-number" placeholder="123" value="${PDV.number}"
        style="border-color:${!PDV.number?'var(--red)':''};"/></div>
    <div class="fg" style="grid-column:span 2"><label class="fl">Bairro <span style="color:var(--red)">*</span></label>
      <input class="fi" id="pdv-neighborhood" style="border-color:${!PDV.neighborhood?'var(--red)':''}"
        placeholder="Selecione ou digite o bairro..." value="${PDV.neighborhood}" list="bairros-manaus-pdv" autocomplete="off"/>
      <datalist id="bairros-manaus-pdv">${BAIRROS_MANAUS.map(b=>`<option value="${b}">`).join('')}</datalist>
    </div>
  </div>
  <div class="fr2">
    <div class="fg"><label class="fl">Cidade <span style="color:var(--red)">*</span></label>
      <input class="fi" id="pdv-city" value="Manaus" readonly style="background:var(--cream);color:var(--muted);"/>
    </div>
    <div class="fg">
      <label class="fl">CEP <span style="font-size:10px;color:var(--muted);font-weight:400;">(preenche rua e bairro automaticamente)</span></label>
      <div style="position:relative;">
        <input class="fi" id="pdv-cep" placeholder="69000-000" value="${PDV.cep}" maxlength="9" inputmode="numeric" autocomplete="postal-code"/>
        <div id="pdv-cep-status" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);font-size:11px;pointer-events:none;"></div>
      </div>
      <div id="pdv-cep-msg" style="font-size:11px;margin-top:3px;display:none;"></div>
    </div>
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
  <div class="fg"><label class="fl">Desconto (R$)</label><input class="fi" type="number" id="pdv-disc" placeholder="0" value="${PDV.discount||''}"/></div>
  <div class="fg">
    <label class="fl">Forma de Pgto</label>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;">
      ${[
        {v:'Pix',                 i:'\uD83D\uDCF1', l:'Pix'},
        {v:'Link',                i:'\uD83D\uDD17', l:'Link'},
        {v:'Cart\u00E3o',         i:'\uD83D\uDCB3', l:'Cart\u00E3o'},
        {v:'Dinheiro',            i:'\uD83D\uDCB5', l:'Dinheiro'},
        {v:'Pagar na Entrega',    i:'\uD83D\uDE9A', l:'Na Entrega'},
        {v:'Bemol',               i:'\uD83C\uDFE6', l:'Bemol'},
        {v:'Giuliana',            i:'\uD83D\uDCB0', l:'Giuliana'},
        {v:'iFood',               i:'\uD83C\uDF54', l:'iFood'}
      ].map(p=>{
        const sel = PDV.payment===p.v;
        return `<button type="button" data-pay="${p.v}" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-height:70px;border:1.5px solid ${sel?'var(--rose)':'var(--line,#e5e7eb)'};background:${sel?'var(--petal,#fce7f0)':'#fff'};border-radius:10px;cursor:pointer;transition:all .15s;padding:8px 6px;" onmouseover="this.style.background='${sel?'var(--petal,#fce7f0)':'var(--cream,#faf7f2)'}'" onmouseout="this.style.background='${sel?'var(--petal,#fce7f0)':'#fff'}'"><span style="font-size:20px;line-height:1;">${p.i}</span><span style="font-size:11px;font-weight:${sel?'600':'500'};color:${sel?'var(--rose)':'var(--ink,#333)'};">${p.l}</span></button>`;
      }).join('')}
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
    <div style="margin-top:8px;background:#fff;border-radius:8px;padding:10px 12px;">
      <div style="font-size:11px;color:var(--ink2);margin-bottom:8px;">
        \uD83D\uDCB5 Entregador cobrar\u00E1 <strong>${$c(total)}</strong> em dinheiro.
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <label style="font-size:11px;font-weight:600;color:var(--ink);">Troco para:</label>
        <div style="display:flex;align-items:center;gap:4px;flex:1;min-width:140px;">
          <span style="font-size:12px;color:var(--muted);">R$</span>
          <input type="number" step="0.01" min="0" id="pdv-troco-para" value="${PDV.trocoPara||''}" placeholder="Ex: 100.00"
            style="flex:1;padding:6px 10px;border:1.5px solid var(--border);border-radius:6px;font-size:13px;"/>
        </div>
        <button type="button" id="pdv-troco-sem" class="btn btn-ghost btn-xs" style="padding:6px 10px;font-size:11px;">Sem troco</button>
      </div>
      ${PDV.trocoPara && parseFloat(PDV.trocoPara) > total ? `
      <div style="margin-top:8px;background:var(--leaf-l);border-radius:6px;padding:6px 10px;font-size:11px;color:var(--leaf);font-weight:600;">
        💰 Levar <strong>${$c(parseFloat(PDV.trocoPara) - total)}</strong> de troco
      </div>` : (PDV.trocoPara && parseFloat(PDV.trocoPara) <= total ? `
      <div style="margin-top:8px;background:#FFF8E1;border-radius:6px;padding:6px 10px;font-size:11px;color:#92400E;">
        ⚠️ Valor do troco menor/igual ao total — verifique.
      </div>` : '')}
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
  // ── Valida regras multi-unit (frontend) ─────────────────────
  const tipoSlug = PDV.type === 'Balc\u00E3o' ? 'balcao'
                 : PDV.type === 'Retirada' ? 'retirada'
                 : 'delivery';
  // Delivery SEMPRE sai do CDLE (nao depende de pickupUnit nem da unidade
  // do usuario). Retirada usa pickupUnit escolhida pelo atendente. Balcao
  // usa a unidade do proprio usuario.
  let destinoSlug;
  if (tipoSlug === 'delivery') destinoSlug = 'cdle';
  else if (tipoSlug === 'retirada') destinoSlug = normalizeUnidade(PDV.pickupUnit || S.user?.unidade || S.user?.unit);
  else destinoSlug = normalizeUnidade(S.user?.unidade || S.user?.unit);
  const checkUnidade = podeCriarPedido(S.user, tipoSlug, destinoSlug);
  if(!checkUnidade.ok){
    toast('\u274C ' + checkUnidade.reason, true);
    return;
  }
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
    // Cidade (taxa de entrega)
    if(!PDV.city?.trim()){
      toast('\u274C Selecione a cidade de entrega');
      document.getElementById('pdv-city-sel')?.focus();
      return;
    }
    // Zona (taxa de entrega)
    if(!PDV.zone?.trim()){
      toast('\u274C Selecione a zona / bairro da taxa de entrega');
      document.getElementById('pdv-zone-sel')?.focus();
      return;
    }
    // Rua
    if(!PDV.street?.trim()){
      toast('\u274C Rua / Avenida do endere\u00E7o \u00E9 obrigat\u00F3ria');
      document.getElementById('pdv-street')?.focus();
      return;
    }
    // Numero
    if(!PDV.number?.trim()){
      toast('\u274C N\u00FAmero do endere\u00E7o \u00E9 obrigat\u00F3rio');
      document.getElementById('pdv-number')?.focus();
      return;
    }
    // Bairro
    if(!PDV.neighborhood?.trim()){
      toast('\u274C Bairro de entrega \u00E9 obrigat\u00F3rio');
      document.getElementById('pdv-neighborhood')?.focus();
      return;
    }
    // Condominio (se marcado)
    if(PDV.isCondominium&&!PDV.condName?.trim()){
      toast('\u274C Nome do condom\u00EDnio \u00E9 obrigat\u00F3rio');
      document.getElementById('pdv-cond-name')?.focus();
      return;
    }
    if(PDV.isCondominium&&(!PDV.block||!PDV.apt)){
      toast('\u274C Bloco e apartamento s\u00E3o obrigat\u00F3rios para condom\u00EDnio');
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
  // Determina unidade correta — regras de negocio:
  //  - Delivery sempre sai do CDLE
  //  - Retirada: unidade escolhida no select (PDV.pickupUnit)
  //  - Balcao: unidade de venda (atendente/usuario)
  const validUnits = ['Loja Novo Aleixo','Loja Allegro Mall','CDLE'];
  const userBaseUnit = validUnits.includes(S.user.unit) ? S.user.unit : (PDV.saleUnit||'Loja Novo Aleixo');
  let orderUnit;
  if (PDV.type === 'Delivery') {
    orderUnit = 'CDLE';
  } else if (PDV.type === 'Retirada' && PDV.pickupUnit) {
    // pickupUnit ja vem como slug (novo_aleixo/allegro) — converte p/ label
    const pu = String(PDV.pickupUnit).toLowerCase();
    orderUnit = pu.includes('allegro') ? 'Loja Allegro Mall'
              : pu.includes('aleixo')  ? 'Loja Novo Aleixo'
              : userBaseUnit;
  } else {
    orderUnit = userBaseUnit;
  }
  const data={
    ...(PDV.clientId ? {client:PDV.clientId} : {}),
    clientName: PDV.clientName||undefined,
    clientPhone: PDV.clientPhone||undefined,
    // CPF/CNPJ + tipo do cliente: copia do cadastro (importante para emissão fiscal)
    ...(() => {
      if(!PDV.clientId) return {};
      const cli = S.clients.find(c => c._id === PDV.clientId);
      if(!cli) return {};
      const tipo = cli.tipoPessoa || 'PF';
      const doc = tipo === 'PJ' ? (cli.cnpj||'').replace(/\D/g,'') : (cli.cpf||'').replace(/\D/g,'');
      const out = { clientTipoPessoa: tipo };
      if(doc) { out.cpfCnpj = doc; out.clientCpf = doc; }
      if(tipo === 'PJ' && cli.inscEstadual) out.clientInscEstadual = cli.inscEstadual;
      return out;
    })(),
    // Items: usa o ID BASE do produto (sem ':color' do carrinho) para o
    // backend conseguir achar e decrementar estoque. Salva colorName/Hex
    // como campos separados para identificar a variacao.
    items:PDV.cart.map(i=>{
      const baseId = String(i.id||'').split(':')[0];
      return {
        product: baseId,
        name: i.name,
        qty: i.qty,
        unitPrice: i.price,
        totalPrice: i.price*i.qty,
        colorName: i.colorName || undefined,
        colorHex:  i.colorHex  || undefined,
      };
    }),
    subtotal:sub,discount:PDV.discount||0,total,
    payment:PDV.payment,type:PDV.type,
    // Se pagar na entrega → 'Ag. Pagamento na Entrega' (amarelo)
    // Caso contrário → 'Aprovado' (verde), pois o pagamento já foi recebido
    // no ato da venda (Pix/cartão/dinheiro confirmado pela atendente)
    // Pagamento NUNCA mais e auto-aprovado: sempre nasce 'Aguardando'
    // (atendente precisa clicar no botao para aprovar manualmente apos
    // confirmar comprovante / Pix / cartao). 'Pagar na Entrega' continua
    // com seu status proprio.
    paymentStatus: PDV.payment==='Pagar na Entrega' ? 'Ag. Pagamento na Entrega' : 'Aguardando Pagamento',
    scheduledDate:PDV.deliveryDate||undefined,
    scheduledPeriod:PDV.deliveryPeriod,
    scheduledTime:(PDV.deliveryPeriod==='Hor\u00E1rio espec\u00EDfico' ? (PDV.deliveryTimeFrom||'') : (PDV.deliveryTime||''))||undefined,
    scheduledTimeEnd:(PDV.deliveryPeriod==='Hor\u00E1rio espec\u00EDfico' ? (PDV.deliveryTimeTo||'') : '')||undefined,
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
    // Canal escolhido no PDV (WhatsApp/Online, Balcao, iFood, E-commerce).
    // Mapeado para o formato esperado pelo filtro: 'WhatsApp/Online' vira
    // 'WhatsApp' canonico para os pedidos antigos. Mantemos o original.
    source: PDV.salesChannel || 'WhatsApp/Online',
    unit:orderUnit,           // onde o pedido sera MONTADO/RETIRADO
    saleUnit: userBaseUnit,   // onde a venda FOI REALIZADA (atendente)
    unidade: destinoSlug,
    tipo: tipoSlug,
    destino: destinoSlug,
    // Colaborador que LANÇOU o pedido (logado no sistema)
    createdByName: S.user?.name || S.user?.nome || '',
    createdByEmail: S.user?.email || '',
    createdByColabId: S.user?.colabId || S.user?._id || '',
    // Colaborador que VENDEU (escolhido no select PDV — pode ser diferente)
    // Se nao escolheu, usa o logado.
    vendedorId:    PDV.vendedorId    || S.user?._id || S.user?.colabId || '',
    vendedorNome:  PDV.vendedorNome  || S.user?.name || S.user?.nome || '',
    vendedorEmail: PDV.vendedorEmail || S.user?.email || '',
    paymentOnDelivery: PDV.payment==='Pagar na Entrega' ? PDV.paymentOnDelivery : undefined,
    trocoPara: (PDV.payment==='Pagar na Entrega' && PDV.paymentOnDelivery==='Dinheiro' && PDV.trocoPara)
      ? parseFloat(PDV.trocoPara) || 0 : undefined,
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
    // Receita so e registrada quando o pagamento e APROVADO manualmente.
    // (Acontece via clique no botao "Aprovar Pagamento" em Pedidos/Caixa.)
    // Aqui ja nao chamamos mais registrarReceitaVenda automaticamente.
    // Notifica loja sobre novo pedido via WhatsApp
    import('./whatsapp.js').then(m=>{
      if(m.notifyNewOrderWhatsApp) m.notifyNewOrderWhatsApp(o);
    }).catch(e=>console.warn('[PDV] notifyNewOrderWhatsApp:', e));
    notifyWhatsApp(o);
    // Pergunta se quer imprimir comanda
    S._newOrderId = o._id;
    PDV.cart=[];PDV.discount=0;PDV.payment='Pix';PDV.clientId='';PDV.clientName='';PDV.clientPhone='';PDV.clientEmail='';PDV.recipient='';PDV.recipientPhone='';PDV.cardMessage='';PDV.notes='';PDV.deliveryDate='';PDV.deliveryPeriod='Manh\u00E3';PDV.deliveryTime='';PDV.street='';PDV.neighborhood='';PDV.number='';PDV.city='';PDV.cep='';PDV.reference='';PDV.isCondominium=false;PDV.condName='';PDV.block='';PDV.apt='';PDV.type='Delivery';PDV.deliveryFee=0;PDV.zone='';PDV.clientSearch='';PDV.pickupUnit='';PDV.saleUnit='';PDV.notifyClient=true;PDV.identifyClient=true;PDV.paymentOnDelivery='';PDV.trocoPara='';PDV._showQuickReg=false;PDV.vendedorId='';PDV.vendedorNome='';PDV.vendedorEmail='';
    S.loading=false;
    // Resolve número do pedido (campos possíveis que o backend pode retornar)
    const orderNum = o?.orderNumber || o?.numero || (o?._id ? String(o._id).slice(-5).toUpperCase() : 'NOVO');
    // Garante que o objeto exibido no popup tem orderNumber
    o.orderNumber = orderNum;
    console.log('[PDV popup] Pedido criado:', orderNum, '| objeto:', o);
    toast('\u2705 Pedido '+fmtOrderNum(o)+' criado!');

    // Render do PDV (limpo, já resetado) — popup é criado fora do render
    if(typeof window.render === 'function') window.render();

    // Popup injetado DIRETO no document.body, sem depender do S._modal.
    // Sempre exibe (mesmo que orderNumber seja fallback do _id).
    if(o){
      setTimeout(()=>{
        console.log('[PDV popup] Injetando overlay no body');
        showPostOrderPopup(o);
      }, 100);
    }
  }catch(e){
    S.loading=false;
    import('../main.js').then(m=>m.render()).catch(()=>{});
    throw e; // relan\u00E7a para finalizePDV() mostrar toast
  }
}

// ── Helpers locais ───────────────────────────────────────────

// Delega para helpers.js (fonte única de verdade — sincroniza com backend
// e cacheia em localStorage). Mantido aqui como wrapper para uso interno.
function getActivities(){ return _getActivities(); }
function logActivity(type, order){ return _logActivity(type, order); }

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
    order.scheduledPeriod?`*Turno:* ${order.scheduledPeriod}${order.scheduledTime?' '+order.scheduledTime:''}${order.scheduledTimeEnd?' - '+order.scheduledTimeEnd:''}`:'',
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
