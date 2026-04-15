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
  _finUnit:'', _finMetaPer:'mes', _relMetaPer:'mes',
  _repView:'list', _repDraft:null, _repEditIdx:null, _repViewIdx:0,
  _iaLoading:false, loading:false, toast:null, sidebarOpen:false,
  sidebarCollapsed: localStorage.getItem('fv_sidebar_collapsed')==='1',
  alerts:[], chatHistory:[], _iaTab:'chat',
  _modal:'', _pendingDeliveryQR:null,
  _fStatus:'Todos', _fBairro:'', _fTurno:'', _fUnidade:'',
  _fCanal:'', _fPrioridade:'', _fDate1:'', _fDate2:'',
  _orderSearch:'',
  _clientSel:null, _clientSearch:'', _prodSearch:'', _prodCat:'', _prodStatus:'',
  _colabSearch:'',
  _catSearch:'',
  _userSearch:'',
  _orcView:'list', _orcDraft:null, _orcDetail:null, _orcEditId:null,
  _catExpanded:null, _ecTab:'geral',
  _pontoHistDate:'', _funcPeriod:'mes', _funcUser:'',
  _caixaUnit:'',
  _datasAlertadas:null,
  _newOrderId:null,
  _dashDate: 'today',
};

// PDV state
export let DELIVERY_FEES = JSON.parse(localStorage.getItem('fv_delivery_fees')||'{"Manaus":{"Zona Centro":15,"Zona Norte":20,"Zona Sul":18,"Zona Leste":20,"Zona Oeste":18,"Outros":25}}');
export function saveDeliveryFees(){ localStorage.setItem('fv_delivery_fees',JSON.stringify(DELIVERY_FEES)); }
export function setDeliveryFees(fees){ DELIVERY_FEES = fees; }

export let PDV = {
  cart:[], discount:0, payment:'Pix',
  clientId:'', clientName:'', clientPhone:'', clientEmail:'',
  recipient:'', cardMessage:'', notes:'',
  deliveryDate:'', deliveryPeriod:'Manhã', deliveryTime:'',
  street:'', neighborhood:'', number:'', city:'', cep:'',
  reference:'', isCondominium:false, condName:'', block:'', apt:'',
  type:'Delivery', deliveryFee:0, zone:'', clientSearch:'',
  pickupUnit:'', saleUnit:'', notifyClient:true, identifyClient:true,
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
    pickupUnit:'', saleUnit:'', notifyClient:true, identifyClient:true,
    _showQuickReg:false
  });
}

// ── PERMISSÕES ───────────────────────────────────────────────
export const ALL_PERMS = [
  {k:'dashboard',  l:'📊 Dashboard',          desc:'Visão geral e métricas'},
  {k:'pdv',        l:'🛒 PDV / Caixa',         desc:'Lançar vendas no caixa'},
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
];

export const PERMS_DEFAULT = {
  Administrador:['*'],
  Gerente:       ['dashboard','orders','clients','products','stock','financial','reports','delivery','users','commission','ponto','caixa'],
  Atendimento:   ['dashboard','orders','clients','products','pdv','ponto','caixa'],
  Producao:      ['orders','production','stock','products','ponto'],
  Expedicao:     ['orders','delivery','production','stock','ponto'],
  Financeiro:    ['financial','reports','orders','commission','ponto','caixa'],
  Entregador:    ['delivery','ponto'],
};
export const PERMS = PERMS_DEFAULT;
