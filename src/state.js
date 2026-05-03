// ── ESTADO GLOBAL ────────────────────────────────────────────
export const API = 'https://florevita-backend-2-0.onrender.com/api';

// ── BAIRROS DE MANAUS ────────────────────────────────────────
export const BAIRROS_MANAUS = [
  'Adrianópolis','Aleixo','Alvorada','Armando Mendes','Betânia','Cachoeirinha',
  'Centro','Chapada','Cidade de Deus','Cidade Nova','Colégio Militar','Colônia Antônio Aleixo',
  'Colônia Oliveira Machado','Colônia Santo Antônio','Colônia Terra Nova','Compensa',
  'Coroado','Crespo','Da Paz','Distrito Industrial I','Distrito Industrial II',
  'Dom Pedro','Educandos','Flores','Gilberto Mestrinho','Glória','Japiim',
  'Jorge Teixeira','Lago Azul','Lagoa Azul','Lírio do Vale','Mauazinho',
  'Monte das Oliveiras','Morada do Sol','Morro da Liberdade','Nossa Senhora Aparecida',
  'Nossa Senhora das Graças','Nova Cidade','Nova Esperança','Novo Aleixo','Novo Israel',
  'Parque 10 de Novembro','Petrópolis','Planalto','Ponta Negra','Praça 14 de Janeiro',
  'Presidente Vargas','Puraquequara','Raiz','Redenção','Rio Piorini','Santa Etelvina',
  'Santa Luzia','Santo Agostinho','Santo Antônio','São Francisco','São Geraldo',
  'São José Operário','São Lázaro','São Raimundo','Tancredo Neves','Tarumã',
  'Tarumã-Açu','União da Vitória','Zumbi dos Palmares'
].sort();

// ── STATE ────────────────────────────────────────────────────
export let S = {
  user: null, token: null, page: 'dashboard',
  clients:[], products:[], orders:[], users:[],
  stockMoves:[], financialEntries:[],
  _stockFilter:'todos', _stockUnit:'',
  _stockSearch:'', _stockCat:'', _stockSort:'nome-asc',
  _stockAdjust:{ scope:'filtered', op:'inc', type:'pct', value:0, applyVenda:true, applyCusto:false },
  _stockAdjustOpen:false,
  _stockSelected:[],
  _prodDate:'', _prodShift:'Todos',
  _expDate:'', _expFilter:'',
  _printedCard:JSON.parse(localStorage.getItem('fv_printed_card')||'{}'),
  _printedComanda:JSON.parse(localStorage.getItem('fv_printed_comanda')||'{}'),
  _relPeriod:'mes', _relUnit:'', _relTab:'geral', _relDriver:'', _relColab:'',
  _relDate1:'', _relDate2:'',   // filtro 'Por Datas' (YYYY-MM-DD)
  _relProdFilter:'', _relValMin:'', _relValMax:'',         // Vendas por Unidade
  _relPagFilter:'', _relTabDate1:'', _relTabDate2:'',      // Vendas por Unidade (data + pag)
  _relCaixaUnit:'', _relCaixaPag:'', _relCaixaProd:'',     // Caixa Completo
  _finUnit:'', _finMetaPer:'mes', _relMetaPer:'mes',
  _repView:'list', _repDraft:null, _repEditIdx:null, _repViewIdx:0,
  _iaLoading:false, loading:false, toast:null, sidebarOpen:false,
  sidebarCollapsed: localStorage.getItem('fv_sidebar_collapsed')==='1',
  alerts:[], chatHistory:[], _iaTab:'chat',
  _modal:'', _pendingDeliveryQR:null,
  _fStatus:'Todos', _fBairro:'', _fTurno:'', _fUnidade:'',
  _fCanal:'', _fPrioridade:'', _fDate1:'', _fDate2:'',
  _orderSearch:'', _pedAgrupar:'',
  _clientSel:null, _clientSearch:'', _prodSearch:'', _prodCat:'', _prodStatus:'', _prodLimit:50,
  _colabSearch:'', _colabDraft:null,
  _catSearch:'',
  _userSearch:'',
  _orcView:'list', _orcDraft:null, _orcDetail:null, _orcEditId:null,
  _catExpanded:null, _ecTab:'geral',
  _impTab:'cartao',  // aba ativa em Impressao (cartao|comanda|etiquetas|opcoes)
  _notifTab:'recentes',  // aba ativa em Notificacoes (recentes|alertas|relatorio)
  _notifRepFrom:'', _notifRepTo:'', _notifRepSummary:null, _notifRepEvents:null,
  _pontoHistDate:'', _funcPeriod:'mes', _funcUser:'',
  _pontoFilter:'hoje', _pontoDate:'', _pontoColab:'', _pontoMonth:'',
  _pontoRecords:[], _pontoLoaded:false, _pontoEditId:null,
  _caixaUnit:'',
  _datasAlertadas:null,
  _newOrderId:null,
  _dashDate: 'today',
};

// PDV state — taxas de entrega são definidas pelo admin nas Configurações
// IMPORTANTE: DELIVERY_FEES e um OBJETO que NUNCA e reatribuido (so mutado
// in-place). Isso permite declarar como const e evita bug de bundling onde
// o Vite otimizava para const mas o codigo tentava reatribuir → TDZ crash.
export const DELIVERY_FEES = JSON.parse(localStorage.getItem('fv_delivery_fees')||'{}');

export function saveDeliveryFees(){
  localStorage.setItem('fv_delivery_fees', JSON.stringify(DELIVERY_FEES));
  if (typeof window !== 'undefined' && window._syncDeliveryFeesToBackend) {
    try { window._syncDeliveryFeesToBackend(DELIVERY_FEES); } catch(_){}
  }
}

// Substitui o conteudo de DELIVERY_FEES por um novo objeto (in-place)
export function setDeliveryFees(fees){
  Object.keys(DELIVERY_FEES).forEach(k => delete DELIVERY_FEES[k]);
  if (fees && typeof fees === 'object') Object.assign(DELIVERY_FEES, fees);
  saveDeliveryFees();
}

// Escuta eventos do sync do backend e atualiza in-place
if (typeof window !== 'undefined') {
  window.addEventListener('fv:delivery-fees-updated', (e) => {
    const remote = e.detail;
    if (remote && typeof remote === 'object') {
      Object.keys(DELIVERY_FEES).forEach(k => delete DELIVERY_FEES[k]);
      Object.assign(DELIVERY_FEES, remote);
    }
  });
}

export let PDV = {
  cart:[], discount:0, payment:'Pix',
  clientId:'', clientName:'', clientPhone:'', clientEmail:'',
  recipient:'', cardMessage:'', notes:'',
  deliveryDate:'', deliveryPeriod:'Manhã', deliveryTime:'',
  street:'', neighborhood:'', number:'', city:'', cep:'',
  reference:'', isCondominium:false, condName:'', block:'', apt:'',
  type:'Delivery', deliveryFee:0, zone:'', clientSearch:'',
  pickupUnit:'', saleUnit:'', salesChannel:'', notifyClient:true, identifyClient:true,
  _showQuickReg:false
};

export function resetPDV(){
  Object.assign(PDV, {
    cart:[], discount:0, payment:'Pix',
    clientId:'', clientName:'', clientPhone:'', clientEmail:'',
    recipient:'', cardMessage:'', notes:'',
    deliveryDate:'', deliveryPeriod:'Manhã', deliveryTime:'',
    street:'', neighborhood:'', number:'', city:'', cep:'',
    reference:'', isCondominium:false, condName:'', block:'', apt:'',
    type:'Delivery', deliveryFee:0, zone:'', clientSearch:'',
    pickupUnit:'', saleUnit:'', salesChannel:'', notifyClient:true, identifyClient:true, recipientPhone:'',
    paymentOnDelivery:'', trocoPara:'',
    _showQuickReg:false
  });
}

// ── PERMISSÕES ───────────────────────────────────────────────
export const ALL_PERMS = [
  {k:'dashboard',  l:'📊 Dashboard',          desc:'Visão geral e métricas'},
  {k:'pdv',        l:'🛒 PDV (Vendas)',        desc:'Lançar vendas no caixa'},
  {k:'orders',     l:'📋 Pedidos',             desc:'Ver e gerenciar pedidos'},
  {k:'clients',    l:'👥 Clientes',            desc:'Cadastro de clientes'},
  {k:'products',   l:'🌹 Produtos',            desc:'Cadastrar e editar produtos'},
  {k:'stock',      l:'📦 Estoque',             desc:'Controle de estoque'},
  {k:'production', l:'🌿 Produção/Montagem',   desc:'Fila de montagem de pedidos'},
  {k:'delivery',   l:'📤 Expedição/Entrega',   desc:'Expedir e entregar pedidos'},
  {k:'financial',  l:'💰 Financeiro',          desc:'Receitas e despesas'},
  {k:'reports',    l:'📈 Relatórios',          desc:'Relatórios gerenciais'},
  {k:'commission', l:'💸 Comissões',           desc:'Comissões e metas'},
  {k:'users',      l:'👩‍💼 Usuários',          desc:'Gerenciar usuários do sistema'},
  {k:'ponto',      l:'🕐 Ponto Eletrônico',    desc:'Registrar ponto de trabalho'},
  {k:'canalEcommerce', l:'🛒 Canal E-commerce no PDV', desc:'Permite escolher E-commerce como canal de venda no PDV (normalmente só Admin)'},
];

export const PERMS_DEFAULT = {
  Administrador:['*'],
  // Gerente: acesso operacional completo, MAS sem modulos administrativos:
  //   - NAO: config, ecommerce, backup, whatsapp, notasFiscais (menu), alertas
  //   - users (Colaboradores): READ-ONLY — pode ver lista e sincronizar,
  //     mas nao pode editar/criar/deletar (filtrado no colaboradores.js)
  //   - NFC-e/NF-e sao emitidas a partir dos botoes no modulo Pedidos
  Gerente:       ['dashboard','pdv','orders','caixa','clients','products','stock','production','delivery','financial','reports','ponto','commission','orcamentos','users'],
  Atendimento:   ['dashboard','orders','clients','products','pdv','ponto','caixa'],
  Producao:      ['orders','production','stock','products','ponto'],
  Expedicao:     ['orders','delivery','production','stock','ponto'],
  Financeiro:    ['financial','reports','orders','commission','ponto','caixa'],
  Entregador:    ['delivery','ponto'],
  // Contador: acesso somente a RH e Notas Fiscais (auditoria fiscal)
  Contador:      ['rh','notasFiscais','ponto'],
};
export const PERMS = PERMS_DEFAULT;
