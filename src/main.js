// ── MAIN ENTRY POINT ────────────────────────────────────────────
import './styles/main.css';

// ── AUTO-UPDATE FORCADO ─────────────────────────────────────────
// Bump esse numero a cada release para forcar TODAS as maquinas
// a limpar cache e baixar a nova versao no proximo F5/login.
// Formato: AAAAMMDDX (ano-mes-dia-build do dia)
const APP_VERSION = '20260430-11';
try {
  const stored = localStorage.getItem('fv_app_version');
  if (stored && stored !== APP_VERSION) {
    console.log('[update] Versao detectada:', stored, '->', APP_VERSION, '— limpando caches');
    // Preserva so o token e config essenciais — limpa o resto
    const keepKeys = ['fv2_token', 'fv2_user', 'fv_backend_token', 'fv_recent_logins', 'fv_config'];
    const keep = {};
    for (const k of keepKeys) {
      const v = localStorage.getItem(k);
      if (v) keep[k] = v;
    }
    localStorage.clear();
    for (const k of Object.keys(keep)) localStorage.setItem(k, keep[k]);
    // Limpa Service Worker caches se existirem
    if ('caches' in window) {
      caches.keys().then(names => names.forEach(n => caches.delete(n))).catch(()=>{});
    }
    localStorage.setItem('fv_app_version', APP_VERSION);
    // Reload uma unica vez (sem entrar em loop)
    if (!sessionStorage.getItem('fv_force_reloaded')) {
      sessionStorage.setItem('fv_force_reloaded', '1');
      location.reload();
    }
  } else if (!stored) {
    localStorage.setItem('fv_app_version', APP_VERSION);
  }
  // Reset flag depois de carregar com sucesso
  setTimeout(() => sessionStorage.removeItem('fv_force_reloaded'), 5000);
} catch(_){}

import { S, API, PDV, DELIVERY_FEES, saveDeliveryFees, resetPDV } from './state.js';
import { toast, setPage, getPageFromURL } from './utils/helpers.js';
import { $c, $d, sc, ini, esc } from './utils/formatters.js';
import { GET, POST, PUT, PATCH, DELETE } from './services/api.js';
import { saveSession, loadSession, logout, doLogin, _isEntregador, can,
         getColabs, saveColabs, findColab, autoSyncColabsFromUsers,
         mergeUserExtra, getUserPerms, setUserPerms, getHiddenUsers,
         refreshUserFromBackend, startPermissionPolling, stopPermissionPolling } from './services/auth.js';
import { loadData, recarregarDados, saveCachedData, loadCachedData,
         invalidateCache, mergeDriverAssignments, saveDriverAssignment } from './services/cache.js';
import { startPolling, stopPolling } from './services/polling.js';
// Registra window._syncDeliveryFeesToBackend (usado por state.saveDeliveryFees)
import './services/deliveryFeesSync.js';

// Pages - import render functions
import { renderLogin, bindLogin } from './pages/login.js';
import { renderPedidoPublico, getPublicOrderIdFromURL } from './pages/pedido-publico.js';
import { renderNotasFiscais, bindNotasFiscaisEvents, emitirNotaFiscal } from './pages/notas-fiscais.js';
import { renderDashboard, selectedOrders } from './pages/dashboard.js';
import { renderPDV, finalizePDV } from './pages/pdv.js';
import { renderPedidos, showOrderViewModal, showEditOrderModal, advanceOrder } from './pages/pedidos.js';
import { renderClientes, showClientModal, saveClient, deleteClient, getDatasEspeciais, saveDatasEspeciais, showAddDataEspecialModal, bindClientesEvents, repeatOrder } from './pages/clientes.js';
import { renderProdutos, showNewProductModal, deleteProduct, showProductStockModal, saveProduct } from './pages/produtos.js';
import { renderEstoque, showStockModal, showTransferModal, previewPriceAdjust, applyPriceAdjust, updateProductFieldInline, updateStockByUnit, exportStockCSV, importStockCSV } from './pages/estoque.js';
import { renderProducao } from './pages/producao.js';
import { renderExpedicao, showConfirmDeliveryModal, getEntregadores, bindExpedicaoEvents, showReentregaModal } from './pages/expedicao.js';
import { renderPonto, bindPontoEvents } from './pages/ponto.js';
import { renderFinanceiro, showFinModal } from './pages/financeiro.js';
import { renderCaixa, bindCaixaEvents } from './pages/caixa.js';
import { renderRelatorios, exportAltaDemandaCSV } from './pages/relatorios.js';
import { renderAlertas, bindAlertasActions } from './pages/alertas.js';
import { renderUsuarios, showNewUserModal, showEditUserModal, saveUser, deleteUser, confirmDeleteUser, toggleUserActive } from './pages/usuarios.js';
import { renderColaboradores, showColabModal, deleteColab, syncColabToBackend, syncAllColabs } from './pages/colaboradores.js';
import { renderWhatsApp, bindWhatsAppEvents } from './pages/whatsapp.js';
import { renderImpressao, printCard, printComanda, printLabel, bindImpressaoEvents } from './pages/impressao.js';
import { renderBackup, startAutoBackup, doAutoBackup, downloadBackup, restoreBackup } from './pages/backup.js';
import { renderConfig, bindConfigActions } from './pages/config.js';
import { renderAuditLogs, bindAuditLogsEvents } from './pages/auditLogs.js';
import { renderAgenteTI, bindAgenteTIEvents } from './pages/agenteTI.js';
import { renderEcommerce } from './pages/ecommerce.js';
import { renderCategorias } from './pages/categorias.js';
import { renderOrcamento, getOrcamentos, saveOrcamentos, calcOrcamento, newOrcItem } from './pages/orcamento.js';
import { renderAppEntregador, confirmDeliveryByQR, showFullImg, abrirRota, bindRotaButtons } from './pages/entregador.js';

// Components
import { renderSidebar } from './components/sidebar.js';
import { renderTopbar } from './components/topbar.js';

// ── MOTIVATIONAL MESSAGES ───────────────────────────────────────
const MOTIVATIONAL_MESSAGES = [
  { icon:'💐', cat:'vendas', msg:'Cada cliente que entra é uma chance de fazer o dia dele mais bonito. Bora arrasar hoje!' },
  { icon:'💐', cat:'vendas', msg:'Você não vende flores — você vende momentos que as pessoas nunca vão esquecer. Que poder!' },
  { icon:'💐', cat:'vendas', msg:'Um sorriso genuíno vale mais que qualquer script de vendas. E você tem o melhor sorriso da equipe.' },
  { icon:'💐', cat:'vendas', msg:"Meta é meta! Mas lembre: cada 'sim' do cliente começa com o seu entusiasmo. Vai com tudo!" },
  { icon:'💐', cat:'vendas', msg:'Hoje é dia de transformar orçamentos em pedidos e pedidos em sorrisos. Você consegue!' },
  { icon:'💐', cat:'vendas', msg:'As flores mais lindas precisam das mãos certas pra chegar bonitas. E essas mãos são suas!' },
  { icon:'💐', cat:'vendas', msg:'Atendimento com carinho fideliza mais do que qualquer promoção. Seja o diferencial hoje!' },
  { icon:'💐', cat:'vendas', msg:'O cliente não compra flores — ele compra a experiência que você cria. Capriche!' },
  { icon:'💐', cat:'vendas', msg:'Quando você atende bem, o cliente volta. Quando você atende com amor, ele traz a família toda!' },
  { icon:'💐', cat:'vendas', msg:'Não existe venda pequena. Cada buquê tem uma história por trás. Você faz parte dessa história.' },
  { icon:'💐', cat:'vendas', msg:'Seu entusiasmo é contagioso! Quando você acredita no produto, o cliente compra a ideia antes das flores.' },
  { icon:'💐', cat:'vendas', msg:'Uma boa pergunta ao cliente vale mais que dez argumentos de venda. Pergunte, ouça, encante!' },
  { icon:'💐', cat:'vendas', msg:"Hoje pode ser o dia da maior venda do mês. Mas pra isso, começa com o primeiro 'bom dia' de coração!" },
  { icon:'💐', cat:'vendas', msg:'Flores não se vendem — elas se presenteiam. Ajude o cliente a escolher o presente perfeito!' },
  { icon:'💐', cat:'vendas', msg:'Cada cliente satisfeito vira um vendedor gratuito da loja. Cuide bem de cada um!' },
  { icon:'💐', cat:'vendas', msg:'Vender com propósito é diferente de só bater meta. Você sabe disso. Por isso você se destaca!' },
  { icon:'💐', cat:'vendas', msg:'A venda começa antes do cliente chegar — na arrumação da vitrine, no seu humor, no seu jeito.' },
  { icon:'💐', cat:'vendas', msg:'Seja o motivo pelo qual o cliente escolhe vocês e não a concorrência. Você tem esse poder!' },
  { icon:'💐', cat:'vendas', msg:'Aquele cliente indeciso precisa de você hoje. Paciência e conhecimento fecham mais vendas que pressa.' },
  { icon:'💐', cat:'vendas', msg:"Não existe 'não posso vender hoje'. Existe 'ainda não encontrei a abordagem certa'. Você acha!" },
  { icon:'💐', cat:'vendas', msg:'Flores comunicam o que as palavras não conseguem. Você é o tradutor desse sentimento. Que trabalho bonito!' },
  { icon:'💐', cat:'vendas', msg:'Cada detalhe conta: o papel, o laço, o sorriso na entrega. Você transforma flor em emoção.' },
  { icon:'💐', cat:'vendas', msg:'O melhor produto do mundo não se vende sozinho — precisa de alguém apaixonado. Seja essa pessoa!' },
  { icon:'💐', cat:'vendas', msg:'Hoje você vai atender alguém que está passando por algo especial. Faça essa experiência inesquecível.' },
  { icon:'💐', cat:'vendas', msg:'Conhecer o produto é bom. Amar o produto é melhor. Você ama o que vende — e isso aparece!' },
  { icon:'💐', cat:'vendas', msg:'Superou a meta ontem? Hoje você supera de novo. É assim que campeões constroem sequências!' },
  { icon:'💐', cat:'vendas', msg:'O primeiro contato define tudo. Comece cada atendimento como se fosse o mais importante do dia.' },
  { icon:'💐', cat:'vendas', msg:"Saber o nome do cliente e usar é mágica pura em vendas. 'Dona Maria, esse buquê foi feito pra senhora!'" },
  { icon:'💐', cat:'vendas', msg:"Cada 'não' te aproxima do próximo 'sim'. Não desanima — persiste com leveza!" },
  { icon:'💐', cat:'vendas', msg:'Você representa a empresa inteira quando atende. Hoje, você vai representar muito bem!' },
  { icon:'💐', cat:'vendas', msg:'O pós-venda começa durante a venda. Já esteja pensando em como fazer esse cliente voltar!' },
  { icon:'💐', cat:'vendas', msg:'Feliz aniversário, casamento, formatura... você vende alegria embalada em flores. Que privilégio!' },
  { icon:'💐', cat:'vendas', msg:'Atender bem quando está animado é fácil. Atender bem quando está cansado é profissionalismo real.' },
  { icon:'💐', cat:'vendas', msg:'Hoje você vai encantar alguém. Não sei quem, não sei quando — mas vai acontecer. Fique pronto(a)!' },
  { icon:'💐', cat:'vendas', msg:'Uma venda com empolgação genuína fecha sozinha. O cliente sente quando você realmente quer ajudar.' },
  { icon:'💐', cat:'vendas', msg:'Seu jeito único de atender é o diferencial que nenhum concorrente consegue copiar.' },
  { icon:'💐', cat:'vendas', msg:'Cada pedido entregue no prazo e com qualidade é um voto de confiança do cliente renovado.' },
  { icon:'💐', cat:'vendas', msg:'Você sabe apresentar flores de um jeito que faz o coração disparar. Isso é dom e dedicação!' },
  { icon:'💐', cat:'vendas', msg:"Hoje, cada 'posso ajudar?' dito de coração pode virar uma história bonita pra contar." },
  { icon:'💐', cat:'vendas', msg:'Vendedor(a) bom(a) resolve problemas antes mesmo de o cliente saber que tinha um. Seja esse(a) hoje!' },
  { icon:'💐', cat:'vendas', msg:'A loja começa a vender quando você chega com energia boa. Você já trouxe essa energia hoje!' },
  { icon:'💐', cat:'vendas', msg:'Clientes não esquecem como se sentiram ao ser atendidos. Faça que eles se sintam especiais!' },
  { icon:'💐', cat:'vendas', msg:'Cada flor vendida hoje fará parte de uma memória afetiva de alguém. Que responsabilidade linda!' },
  { icon:'💐', cat:'vendas', msg:'Bater meta é bom. Bater meta e ainda fazer o cliente feliz é excelência. Mirar nisso hoje!' },
  { icon:'💐', cat:'vendas', msg:'Uma sugestão bem colocada dobra o ticket médio. Use seu conhecimento para ajudar o cliente a escolher mais!' },
  { icon:'💐', cat:'vendas', msg:'Ontem você foi bom(a). Hoje você vai ser ainda melhor. Essa é a mentalidade dos que crescem!' },
  { icon:'💐', cat:'vendas', msg:'O cliente mais exigente, quando conquistado, se torna o mais fiel. Aceite o desafio com alegria!' },
  { icon:'💐', cat:'vendas', msg:'Flowers speak louder than words — e você sabe fazer essa tradução melhor do que ninguém!' },
  { icon:'💐', cat:'vendas', msg:'Seja a memória boa do dia do seu cliente. É essa presença que traz ele de volta!' },
  { icon:'💐', cat:'vendas', msg:'Uma venda bem feita hoje planta a semente de dez vendas futuras. Cuide de cada uma!' },
  { icon:'💐', cat:'vendas', msg:'Você tem talento, tem conhecimento e tem vontade. Hoje a combinação vai ser explosiva!' },
  { icon:'💐', cat:'vendas', msg:'O sorriso no rosto do cliente após o atendimento é o melhor indicador de desempenho que existe.' },
  { icon:'💐', cat:'vendas', msg:"Cada detalhe que você adiciona ao pedido diz: 'me importo com você'. O cliente sente isso!" },
  { icon:'💐', cat:'vendas', msg:'Hoje é dia de superar expectativas. Entregue mais do que prometeu — é assim que se fideliza!' },
  { icon:'💐', cat:'vendas', msg:'Conhecer as datas especiais dos clientes é ouro. Você faz parte da história deles. Que beleza!' },
  { icon:'💐', cat:'vendas', msg:'Toda objeção é uma pergunta disfarçada. Responda com cuidado e a venda vai fluir!' },
  { icon:'💐', cat:'vendas', msg:'Vendas é relacionamento. Relacionamento é confiança. Confiança se constrói a cada atendimento.' },
  { icon:'💐', cat:'vendas', msg:'Hoje você vai descobrir o que o cliente realmente precisa — e entregar mais do que ele pediu!' },
  { icon:'💐', cat:'vendas', msg:'O cliente não sabe o que quer até você mostrar a possibilidade certa. Mostre hoje!' },
  { icon:'💐', cat:'vendas', msg:'Cada pedido especial é uma missão. Você é o especialista que vai cumpri-la com excelência!' },
  { icon:'💐', cat:'vendas', msg:'Vender flores é vender amor, perdão, celebração, saudade. Que produto mais cheio de sentido!' },
  { icon:'💐', cat:'vendas', msg:'Sua postura, seu tom, sua atenção — tudo isso compõe a experiência de compra. Componha bem hoje!' },
  { icon:'💐', cat:'vendas', msg:'Não existe dia fraco para quem tem motivação forte. E você tem! Vai que é seu dia!' },
  { icon:'💐', cat:'vendas', msg:'Fidelizar um cliente custa menos do que conquistar um novo. Invista no relacionamento hoje!' },
  { icon:'💐', cat:'vendas', msg:'Você não é só vendedor(a) — você é consultor(a) de ocasiões especiais. Que cargo nobre!' },
  { icon:'💐', cat:'vendas', msg:'Abriu a loja, o dia começou, a energia está alta. Agora é só começar a fazer história!' },
  { icon:'💐', cat:'vendas', msg:'Cada cliente que sai com um sorriso é uma propaganda viva da sua dedicação. Espalhe sorrisos!' },
  { icon:'💐', cat:'vendas', msg:'Produto certo + pessoa certa + momento certo = venda perfeita. Você cria isso todos os dias!' },
  { icon:'💐', cat:'vendas', msg:'Hoje você vai ajudar alguém a surpreender a pessoa mais importante da vida dele. Que peso bonito!' },
  { icon:'💐', cat:'vendas', msg:"Quando o cliente diz 'era exatamente isso que eu queria', é porque você ouviu de verdade." },
  { icon:'💐', cat:'vendas', msg:'A melhor vitrine da loja é o seu atendimento. Ela precisa estar linda hoje!' },
  { icon:'💐', cat:'vendas', msg:'Você tem experiência, tem conhecimento e tem coração. Que combinação invencível!' },
  { icon:'💐', cat:'vendas', msg:'Cada nova venda é uma prova de que você está no caminho certo. Continue!' },
  { icon:'💐', cat:'vendas', msg:'Hoje pode ser um dia histórico em vendas. Ele começa com você decidindo que vai ser.' },
  { icon:'💐', cat:'vendas', msg:'Não deixe o cliente sair sem ter certeza de que resolveu o problema dele. Isso é excelência!' },
  { icon:'💐', cat:'vendas', msg:'Quanto mais você conhece o cliente, mais fácil fica vender para ele. Ouça muito hoje!' },
  { icon:'💐', cat:'vendas', msg:'Vendas sem pressão, com genuíno interesse em ajudar — esse é o seu estilo. Funciona sempre!' },
  { icon:'💐', cat:'vendas', msg:'Uma venda com histórico, com afeto, com capricho — essa venda não tem concorrente.' },
  { icon:'💐', cat:'vendas', msg:'Você planta hoje o que vai colher amanhã. Plante bem, plante com cuidado!' },
  { icon:'💐', cat:'vendas', msg:'Cada pedido novo é um voto de confiança do cliente em você e na equipe. Honre sempre!' },
  { icon:'💐', cat:'vendas', msg:'O detalhe que você adiciona é o detalhe que o cliente lembra. Capricha nos detalhes!' },
  { icon:'💐', cat:'vendas', msg:'Ontem a meta foi X. Hoje a meta pode ser X+1. Crescimento é constante e começa agora!' },
  { icon:'💐', cat:'vendas', msg:'O cliente que foi bem atendido não volta sozinho — ele traz os amigos. Atenda para a família toda!' },
  { icon:'💐', cat:'vendas', msg:'Você é a ponte entre o produto e o sentimento do cliente. Seja uma ponte sólida e bonita!' },
  { icon:'💐', cat:'vendas', msg:'Vender flores é uma das poucas vendas onde tanto o cliente quanto o presenteado ficam felizes. Que trabalho!' },
  { icon:'💐', cat:'vendas', msg:'Hoje, em algum momento, você vai ser o melhor atendimento que alguém vai ter no dia. Prepare-se!' },
  { icon:'💐', cat:'vendas', msg:'O talento te leva até certo ponto. A dedicação te leva muito além. Você tem os dois!' },
  { icon:'💐', cat:'vendas', msg:"Não existe atendimento 'bom o suficiente'. Existe atendimento excelente — e é o que você entrega!" },
  { icon:'💐', cat:'vendas', msg:"Cada 'obrigado' do cliente é a confirmação de que você está no caminho certo. Ouça-os hoje!" },
  { icon:'💐', cat:'vendas', msg:'Você é capaz de transformar uma compra simples em uma experiência memorável. Use esse poder hoje!' },
  { icon:'💐', cat:'vendas', msg:'Vender bem é uma arte. E você pratica essa arte todos os dias com maestria crescente.' },
  { icon:'💐', cat:'vendas', msg:'A energia que você traz para o trabalho hoje define a qualidade do dia inteiro. Traga boa energia!' },
  { icon:'💐', cat:'vendas', msg:'Cada atendimento é um ensaio para o próximo. Hoje você vai para o palco bem preparado(a)!' },
  { icon:'💐', cat:'vendas', msg:'Seja a razão pela qual o cliente prefere comprar aqui. Você tem esse poder!' },
  { icon:'💐', cat:'vendas', msg:'Quando o trabalho tem propósito, a venda tem alma. E o seu trabalho tem muita alma!' },
  { icon:'💐', cat:'vendas', msg:'Aquele cliente difícil de ontem? Hoje pode ser diferente. Aborde com mais carinho e veja a mágica!' },
  { icon:'💐', cat:'vendas', msg:'Você representa qualidade, cuidado e amor em cada venda. Que marca pessoal incrível!' },
  { icon:'💐', cat:'vendas', msg:'Hoje é dia de ser a versão mais dedicada de si mesmo(a) no trabalho. Vai com tudo!' },
  { icon:'💐', cat:'vendas', msg:'Nas flores, como nas vendas, o cuidado faz toda a diferença. Cuide de cada detalhe hoje!' },
  { icon:'💐', cat:'vendas', msg:'Quando você melhora um pouquinho por dia, em um ano você é completamente diferente. Melhore hoje!' },
  { icon:'💐', cat:'vendas', msg:'O melhor fechamento de venda é quando o cliente sente que tomou a melhor decisão da vida.' },
  { icon:'💐', cat:'vendas', msg:'Você tem o jeito — agora é só usar com toda a força que tem. Vai lá!' },
  { icon:'💐', cat:'vendas', msg:'Cada cliente bem atendido é um troféu invisível. Você já tem muitos — adicione mais um hoje!' },
  { icon:'💐', cat:'vendas', msg:'Hoje a loja vai funcionar melhor porque você está aqui. Isso é fato. Acredite nisso!' },
  { icon:'💐', cat:'vendas', msg:'A excelência não é um ato isolado — é um hábito. E você vem praticando todo dia. Parabéns!' },
  { icon:'💐', cat:'vendas', msg:'Uma abordagem de coração abre portas que técnica nenhuma consegue. Abra as portas hoje!' },
  { icon:'💐', cat:'vendas', msg:'Você faz parte de uma equipe que cuida de momentos especiais. Que responsabilidade linda de carregar!' },
  { icon:'💐', cat:'vendas', msg:'Meta cumprida é energia renovada. Meta superada é confiança multiplicada. Supere hoje!' },
  { icon:'💐', cat:'vendas', msg:'Você não apenas vende flores — você cultiva conexões humanas. Que trabalho extraordinário!' },
  { icon:'💐', cat:'vendas', msg:'Hoje vai ser um dia incrível de vendas. Não porque vai ser fácil — mas porque você vai ser imparável!' },
  { icon:'💐', cat:'vendas', msg:'Cada flor que passa por suas mãos vai fazer alguém muito feliz. Lembre disso quando o dia pesar.' },
  { icon:'💐', cat:'vendas', msg:'Profissionalismo é fazer bem feito mesmo quando ninguém está olhando. Você é assim todos os dias!' },
  { icon:'💐', cat:'vendas', msg:'Uma venda feita com integridade vale mais do que dez feitas com pressão. Você vende com integridade!' },
  { icon:'💐', cat:'vendas', msg:'O cliente que compra pela primeira vez é especial. O que volta é fiel. Os dois precisam de você!' },
  { icon:'💐', cat:'vendas', msg:'Hoje você vai criar memórias afetivas de pessoas que nem vai conhecer. Que trabalho cheio de significado!' },
  { icon:'💐', cat:'vendas', msg:'Sorriso, atenção e conhecimento — você tem tudo isso. Mistura tudo e vai ser um dia épico!' },
  { icon:'💐', cat:'vendas', msg:'Você não trabalha por obrigação — você tem um propósito. Lembre dele em cada atendimento!' },
  { icon:'🤝', cat:'equipe', msg:'Nenhuma flor cresce sozinha, e nenhum time vence sozinho. Conte com a turma hoje!' },
  { icon:'🤝', cat:'equipe', msg:'Seu colega está contando com você. E você pode contar com ele. É isso que faz a gente forte.' },
  { icon:'🤝', cat:'equipe', msg:'Time unido bate qualquer meta. Hoje é dia de estar junto, tá?' },
  { icon:'🤝', cat:'equipe', msg:'Quem alegra o ambiente de trabalho é você. Só você já faz o dia da equipe melhor!' },
  { icon:'🤝', cat:'equipe', msg:'Ajudar o colega nunca é perda de tempo — é investimento no time que você faz parte.' },
  { icon:'🤝', cat:'equipe', msg:'Uma equipe forte não é feita de pessoas perfeitas — é feita de pessoas comprometidas. Você é assim!' },
  { icon:'🤝', cat:'equipe', msg:'Quando um cresce, todos crescem. Compartilhe seu conhecimento hoje — isso volta multiplicado!' },
  { icon:'🤝', cat:'equipe', msg:'Você é o tipo de colega que todo mundo quer ter: presente, disponível, positivo. Continue assim!' },
  { icon:'🤝', cat:'equipe', msg:'O trabalho em equipe divide o peso e multiplica o resultado. Carregue junto hoje!' },
  { icon:'🤝', cat:'equipe', msg:'Cada membro da equipe tem um papel único. O seu é insubstituível. Sabia disso?' },
  { icon:'🤝', cat:'equipe', msg:'Reconhecer o trabalho do colega é gesto de líder. Você tem esse gesto — use hoje!' },
  { icon:'🤝', cat:'equipe', msg:'Uma palavra de encorajamento para o colega pode mudar o dia dele. E o seu também.' },
  { icon:'🤝', cat:'equipe', msg:'Time que ri junto, trabalha junto. Traga seu bom humor hoje — a equipe agradece!' },
  { icon:'🤝', cat:'equipe', msg:'Confiança no time é confiança em si mesmo. Você confia na sua equipe — e eles confiam em você!' },
  { icon:'🤝', cat:'equipe', msg:'Hoje pode surgir uma situação difícil. Lembre: com o time ao seu lado, tudo fica mais leve.' },
  { icon:'🤝', cat:'equipe', msg:'Grandes conquistas nunca são individuais. Sua vitória de hoje é vitória de todos. Celebre junto!' },
  { icon:'🤝', cat:'equipe', msg:'Você inspira os colegas sem perceber. Sua dedicação é observada e admirada. Sabia?' },
  { icon:'🤝', cat:'equipe', msg:'Quando a equipe funciona bem, até o dia pesado fica mais fácil. Contribua para isso hoje!' },
  { icon:'🤝', cat:'equipe', msg:'O que você faz bem, ensine. O que você ainda não sabe, aprenda com quem sabe. Assim cresce o time!' },
  { icon:'🤝', cat:'equipe', msg:'Uma equipe com diversidade de talentos é imbatível. E a sua contribuição é essencial!' },
  { icon:'🤝', cat:'equipe', msg:'Celebre o sucesso do colega como se fosse seu — porque de certa forma, é! Vocês são um time.' },
  { icon:'🤝', cat:'equipe', msg:'Ser pontual, ser presente, ser comprometido — é o mínimo que o time precisa. Você dá mais que o mínimo!' },
  { icon:'🤝', cat:'equipe', msg:'Quando você chega animado(a), contagia todo mundo. Chegue bem hoje — o time sente!' },
  { icon:'🤝', cat:'equipe', msg:'Uma equipe que se apoia cria um ambiente onde todo mundo quer dar o melhor. Seja esse suporte hoje!' },
  { icon:'🤝', cat:'equipe', msg:'A comunicação clara evita 90% dos problemas. Fale bem, ouça bem — e o dia flui melhor!' },
  { icon:'🤝', cat:'equipe', msg:'Você sabe que pode chamar o colega quando precisar. E eles sabem que podem chamar você. Isso é time!' },
  { icon:'🤝', cat:'equipe', msg:'O melhor presente que você pode dar à equipe é a sua melhor versão. Traz ela hoje!' },
  { icon:'🤝', cat:'equipe', msg:'Equipe forte não depende só do líder — depende de cada pessoa decidir jogar junto. Você decidiu!' },
  { icon:'🤝', cat:'equipe', msg:'Cobrir o colega num momento difícil é solidariedade. Você já fez isso? E vão fazer por você!' },
  { icon:'🤝', cat:'equipe', msg:'Um ambiente de trabalho positivo começa com cada indivíduo. Você é uma peça fundamental nisso.' },
  { icon:'🤝', cat:'equipe', msg:'O time que festeja junto os resultados mantém a motivação alta. Encontre um motivo para celebrar hoje!' },
  { icon:'🤝', cat:'equipe', msg:'Você respeita o espaço do colega, ouve antes de falar e ajuda sem precisar ser pedido. Isso é raro!' },
  { icon:'🤝', cat:'equipe', msg:'Cada colega tem um dom diferente do seu. Juntos vocês cobrem muito mais terreno. Aproveite isso!' },
  { icon:'🤝', cat:'equipe', msg:'Quando a loja está cheia, o time que funciona bem é o que a diferencia. Seja parte dessa diferença!' },
  { icon:'🤝', cat:'equipe', msg:'Seu colega de trabalho hoje pode ser seu parceiro de vida por muito tempo. Cuide dessa relação!' },
  { icon:'🤝', cat:'equipe', msg:'A força do time está no elo mais comprometido — e hoje esse elo é você. Seja forte!' },
  { icon:'🤝', cat:'equipe', msg:'Elogiar o colega na frente de todos é um ato poderoso. Procure um motivo para fazer isso hoje!' },
  { icon:'🤝', cat:'equipe', msg:'Você é peça insubstituível nessa engrenagem. Sem você, algo faltaria. Lembre disso!' },
  { icon:'🤝', cat:'equipe', msg:'Times vencedores são construídos no dia a dia, não em dias especiais. Construa hoje!' },
  { icon:'🤝', cat:'equipe', msg:'Lealdade ao time não é cegura — é comprometimento consciente. E você tem isso de sobra!' },
  { icon:'🤝', cat:'equipe', msg:'Hoje vai ter desafio. Mas você tem um time ao lado. E isso muda tudo!' },
  { icon:'🤝', cat:'equipe', msg:'Sua presença hoje já fez diferença. Sua dedicação vai fazer ainda mais. Obrigado por existir nesse time!' },
  { icon:'🤝', cat:'equipe', msg:'Dividir um problema com o time é o primeiro passo para resolvê-lo. Não carregue sozinho(a)!' },
  { icon:'🤝', cat:'equipe', msg:'Um time que aprende junto cresce junto. O que você aprendeu essa semana? Compartilhe!' },
  { icon:'🤝', cat:'equipe', msg:'Quando o time é bom, até a segunda-feira começa bem. E esse time é muito bom!' },
  { icon:'🤝', cat:'equipe', msg:'Você levanta o ânimo da equipe. Isso tem valor incalculável. Saiba que é percebido e apreciado!' },
  { icon:'🤝', cat:'equipe', msg:'Trabalhar com quem você respeita e gosta é raro. Valorize esse presente chamado equipe!' },
  { icon:'🤝', cat:'equipe', msg:'Hoje, se um colega estiver com dificuldade, seja a mão que se estende. Você é capaz disso!' },
  { icon:'🤝', cat:'equipe', msg:'O seu comprometimento inspira os outros a se comprometerem também. Que liderança silenciosa!' },
  { icon:'🤝', cat:'equipe', msg:'Time que confia não precisa de controle. Você merece essa confiança — e a honra todos os dias!' },
  { icon:'🤝', cat:'equipe', msg:'Sua energia boa hoje vai contagiar o time inteiro. Espalhe!' },
  { icon:'🤝', cat:'equipe', msg:'Ajudar o colega a crescer não diminui você — te eleva junto. Invista nos outros!' },
  { icon:'🤝', cat:'equipe', msg:'O sucesso coletivo tem um sabor diferente. Vamos conquistar juntos hoje!' },
  { icon:'🤝', cat:'equipe', msg:'Você sabe que o time vai te apoiar — e o time sabe que pode contar com você. Que base sólida!' },
  { icon:'🤝', cat:'equipe', msg:'Cada pessoa no time tem uma história. Conhecer essa história torna o trabalho mais humano e bonito.' },
  { icon:'🤝', cat:'equipe', msg:'Uma crítica construtiva dita com cuidado fortalece o time. Tenha essa coragem hoje, se precisar.' },
  { icon:'🤝', cat:'equipe', msg:'Flexibilidade, paciência e parceria — você tem os três ingredientes de um excelente colega de equipe!' },
  { icon:'🤝', cat:'equipe', msg:'Quando algo dá certo, é da equipe. Quando dá errado, também. Assuma junto e cresce junto!' },
  { icon:'🤝', cat:'equipe', msg:'Ninguém chega ao topo sozinho. E os melhores não querem chegar sozinhos. Você é assim!' },
  { icon:'🤝', cat:'equipe', msg:'O respeito no ambiente de trabalho começa com pequenos gestos. Pratique um hoje.' },
  { icon:'🤝', cat:'equipe', msg:'Um time que ri junto das dificuldades não é fraco — é resiliente. Seja essa leveza hoje!' },
  { icon:'🤝', cat:'equipe', msg:'Você motiva os colegas só de aparecer comprometido(a). Isso é influência positiva real!' },
  { icon:'🤝', cat:'equipe', msg:'Quando o colega acerta, vibre genuinamente. Quando erra, apoie discretamente. Esse é o jeito certo!' },
  { icon:'🤝', cat:'equipe', msg:'Hoje, encontre pelo menos um momento para agradecer ao colega por algo que ele faz bem.' },
  { icon:'🤝', cat:'equipe', msg:'Equipe é família que você escolhe no trabalho. Cuide da sua família com dedicação!' },
  { icon:'🤝', cat:'equipe', msg:'Você faz o ambiente melhor só por estar aqui. Esse é um dom que nem todo mundo tem. Valorize!' },
  { icon:'🤝', cat:'equipe', msg:'Trabalho em equipe não significa concordar com tudo — é dialogar com respeito para chegar mais longe.' },
  { icon:'🤝', cat:'equipe', msg:'Seu compromisso com o time é o que faz a diferença nos dias difíceis. E você é comprometido(a)!' },
  { icon:'🤝', cat:'equipe', msg:'Uma equipe que se conhece bem trabalha em harmonia. Se conhece melhor hoje!' },
  { icon:'🤝', cat:'equipe', msg:'Paciência com o colega que está aprendendo é um investimento que rende muito. Tenha essa paciência!' },
  { icon:'🤝', cat:'equipe', msg:'O time que vence junto sorri junto. E vocês vão sorrir muito hoje!' },
  { icon:'🤝', cat:'equipe', msg:"Você é parte de algo maior do que qualquer trabalho individual. Esse 'algo maior' chama-se equipe!" },
  { icon:'🤝', cat:'equipe', msg:'Ser leal ao time mesmo nos momentos difíceis é a marca do profissional que todos querem ao lado.' },
  { icon:'🤝', cat:'equipe', msg:'Hoje, faça uma coisa que facilite o trabalho do colega. Isso se chama generosidade profissional.' },
  { icon:'🤝', cat:'equipe', msg:'Uma equipe que reconhece o mérito de cada um é uma equipe que cresce. Reconheça hoje!' },
  { icon:'🤝', cat:'equipe', msg:'Você está nessa equipe por um motivo. O motivo é que você faz diferença real. Nunca esqueça!' },
  { icon:'🤝', cat:'equipe', msg:'Quando a equipe trabalha bem, os clientes percebem. Trabalhe bem hoje — pelos clientes e por você!' },
  { icon:'🤝', cat:'equipe', msg:'Um time unido é difícil de vencer. E esse time já escolheu a união. Você faz parte disso. Orgulha!' },
  { icon:'💪', cat:'autoestima', msg:'Você é mais capaz do que imagina. O dia de hoje vai provar isso!' },
  { icon:'💪', cat:'autoestima', msg:'Você cresceu muito. Mesmo quando não percebe, está evoluindo todo dia.' },
  { icon:'💪', cat:'autoestima', msg:'Acredite: você foi feito(a) para dias grandes. Hoje começa um deles.' },
  { icon:'💪', cat:'autoestima', msg:'Dentro de você tem mais força do que qualquer obstáculo que possa aparecer hoje. Confia!' },
  { icon:'💪', cat:'autoestima', msg:'Você é valioso(a) demais para se subestimar. Bora mostrar o seu brilho hoje!' },
  { icon:'💪', cat:'autoestima', msg:'Não existe ninguém no mundo com o seu jeito único de fazer as coisas. Isso é seu superpoder.' },
  { icon:'💪', cat:'autoestima', msg:'Você já superou coisas que pareciam impossíveis. O que vier hoje, você aguenta.' },
  { icon:'💪', cat:'autoestima', msg:'Seu potencial não tem teto. O que limita você é só a sua crença. Acredite mais!' },
  { icon:'💪', cat:'autoestima', msg:'Você não precisa ser perfeito(a) — precisa ser autêntico(a). E você é, todos os dias.' },
  { icon:'💪', cat:'autoestima', msg:'A sua história tem muito mais capítulos bons por vir. Hoje é um deles. Viva-o bem!' },
  { icon:'💪', cat:'autoestima', msg:'Você tem qualidades que as pessoas ao redor percebem e admiram. Nem sempre falam, mas veem!' },
  { icon:'💪', cat:'autoestima', msg:'Dificuldade é parte do caminho, não o fim dele. Você sabe disso. Continua!' },
  { icon:'💪', cat:'autoestima', msg:'Sua presença aqui faz diferença. Sem você, algo estaria faltando. Acredite nisso!' },
  { icon:'💪', cat:'autoestima', msg:'Você merece tudo de bom que está vindo. E está vindo — só precisa abrir os olhos para ver!' },
  { icon:'💪', cat:'autoestima', msg:'Errar faz parte do crescimento. Quem nunca erra é quem nunca tenta. Você tenta sempre!' },
  { icon:'💪', cat:'autoestima', msg:'A confiança não vem antes da ação — ela vem durante e depois. Age primeiro!' },
  { icon:'💪', cat:'autoestima', msg:'Você é capaz de aprender qualquer coisa que decidir aprender. Isso é liberdade!' },
  { icon:'💪', cat:'autoestima', msg:'Comparação com o outro não te faz crescer — comparação com quem você era ontem, sim!' },
  { icon:'💪', cat:'autoestima', msg:'Você tem uma centelha que é só sua. Não apague ela para se encaixar em um molde.' },
  { icon:'💪', cat:'autoestima', msg:'Críticas são informações. Filtre o que é construtivo e descarte o resto. Você é inteligente!' },
  { icon:'💪', cat:'autoestima', msg:'Seu valor não depende de quantas vezes você acertou — depende de quantas vezes você tentou de novo.' },
  { icon:'💪', cat:'autoestima', msg:'Existe uma versão futura sua que agradece cada esforço que você faz hoje. Esforce-se por ela!' },
  { icon:'💪', cat:'autoestima', msg:'Você não é o que aconteceu com você — você é o que decidiu se tornar. E se tornou algo lindo!' },
  { icon:'💪', cat:'autoestima', msg:'Autoconhecimento é o maior presente que você pode se dar. Você já está nessa jornada — parabéns!' },
  { icon:'💪', cat:'autoestima', msg:'Sua intuição vale mais do que você pensa. Confie mais nela hoje!' },
  { icon:'💪', cat:'autoestima', msg:'Você tem coragem. Mesmo quando sente medo, vai lá. Isso é a definição real de coragem!' },
  { icon:'💪', cat:'autoestima', msg:'Palavras que você usa sobre si mesmo(a) moldam sua realidade. Use palavras que te elecem!' },
  { icon:'💪', cat:'autoestima', msg:'Você é digno(a) de ser amado(a) e respeitado(a) — especialmente por você mesmo(a)!' },
  { icon:'💪', cat:'autoestima', msg:'Não precisa de aprovação externa para saber que está no caminho certo. Você sabe!' },
  { icon:'💪', cat:'autoestima', msg:'Cada manhã que você se levanta é uma escolha por si mesmo(a). Que escolha corajosa!' },
  { icon:'💪', cat:'autoestima', msg:'Você tem mais conquistas do que percebe. Liste mentalmente hoje e se surpreenda!' },
  { icon:'💪', cat:'autoestima', msg:'Ser você mesmo(a) em um mundo que tenta te moldar é o maior ato de rebeldia positiva.' },
  { icon:'💪', cat:'autoestima', msg:'Você importa. Suas ações importam. Seu esforço importa. Não diminua isso nunca!' },
  { icon:'💪', cat:'autoestima', msg:'A sua resiliência é admirável. Quantas vezes você foi a fundo e voltou? Conta suas vitórias!' },
  { icon:'💪', cat:'autoestima', msg:'Você tem mais talentos do que consegue ver em si mesmo(a). Os outros já perceberam!' },
  { icon:'💪', cat:'autoestima', msg:'Cuidar de si mesmo(a) não é egoísmo — é condição para cuidar bem dos outros também.' },
  { icon:'💪', cat:'autoestima', msg:'Você merece paz, alegria e realização. E você está construindo isso, um dia de cada vez.' },
  { icon:'💪', cat:'autoestima', msg:'A sua persistência silenciosa é mais poderosa do que qualquer grito de quem desiste rápido.' },
  { icon:'💪', cat:'autoestima', msg:'Hoje você vai fazer algo que vai te orgulhar. Não sei o quê — mas vai. Esteja atento(a)!' },
  { icon:'💪', cat:'autoestima', msg:'Cada versão de você que aparece é mais sábia que a anterior. Você está em constante melhoria!' },
  { icon:'💪', cat:'autoestima', msg:'Você não precisa ser o melhor do mundo — precisa ser a sua melhor versão. Hoje, seja ela!' },
  { icon:'💪', cat:'autoestima', msg:'Sua energia positiva é um recurso renovável. Ela se multiplica quando você a compartilha!' },
  { icon:'💪', cat:'autoestima', msg:'Você enfrentou dias piores e saiu melhor. Esse dia de hoje é mole pra você!' },
  { icon:'💪', cat:'autoestima', msg:'O que você vê como defeito, muitas vezes, é o que te torna único(a). Abraça isso!' },
  { icon:'💪', cat:'autoestima', msg:'Você tem a capacidade de reinventar qualquer situação. Isso é inteligência emocional real!' },
  { icon:'💪', cat:'autoestima', msg:'Sua determinação te trouxe até aqui. E vai te levar muito mais longe. Acredita!' },
  { icon:'💪', cat:'autoestima', msg:'Você já foi mais inseguro(a) do que é hoje. Amanhã será mais confiante do que é agora.' },
  { icon:'💪', cat:'autoestima', msg:'Gentileza consigo mesmo(a) é o começo de qualquer transformação real. Seja gentil hoje!' },
  { icon:'💪', cat:'autoestima', msg:'Você tem uma história única, talento real e potencial ilimitado. Que combinação!' },
  { icon:'💪', cat:'autoestima', msg:'Hoje pode ser difícil. Mas difícil não é impossível. E você já provou isso muitas vezes.' },
  { icon:'💪', cat:'autoestima', msg:'A melhor versão de você não está no passado — está sendo construída agora, nesse exato momento.' },
  { icon:'💪', cat:'autoestima', msg:'Você tem um coração bom. Isso conta muito mais do que qualquer currículo.' },
  { icon:'💪', cat:'autoestima', msg:'Olha o quanto você já aprendeu em um ano! Em outro ano, estará ainda mais preparado(a).' },
  { icon:'💪', cat:'autoestima', msg:'Você não precisa provar nada para ninguém. Mas vai provar pra si mesmo(a) que é capaz. E vai!' },
  { icon:'💪', cat:'autoestima', msg:'Sua maneira de ver o mundo é valiosa. Não troque por nada. Ela é sua contribuição única.' },
  { icon:'💪', cat:'autoestima', msg:'Você lida bem com pressão quando precisa. Isso é maturidade. Que crescimento bonito!' },
  { icon:'💪', cat:'autoestima', msg:'Cada dia que você aparece e tenta é um dia em que você escolheu não desistir. Que escolha nobre!' },
  { icon:'💪', cat:'autoestima', msg:'Você tem sabedoria acima da sua experiência. Algo especial em você aprende muito rápido.' },
  { icon:'💪', cat:'autoestima', msg:'Sua sensibilidade não é fraqueza — é a antena que te conecta com as pessoas. Valorize isso!' },
  { icon:'💪', cat:'autoestima', msg:'Você inspira pessoas sem saber. Um dia vão te contar isso e você vai se surpreender.' },
  { icon:'💪', cat:'autoestima', msg:'Cada conquista que você tem, por menor que seja, é fruto de quem você é. Celebra!' },
  { icon:'💪', cat:'autoestima', msg:'Você cuida dos outros muito bem. Hoje, lembra de cuidar de você também.' },
  { icon:'💪', cat:'autoestima', msg:'O que você pensa sobre si mesmo(a) define como age. Pense grande — é o que você merece!' },
  { icon:'💪', cat:'autoestima', msg:'Você tem uma bússola interna que aponta para o que é certo. Confie nela mais hoje!' },
  { icon:'💪', cat:'autoestima', msg:'Lidar com incerteza sem travar é sabedoria. E você tem desenvolvido isso cada vez mais.' },
  { icon:'💪', cat:'autoestima', msg:'Você transforma ambientes — deixa as coisas melhores de onde passa. Que dom precioso!' },
  { icon:'💪', cat:'autoestima', msg:'Não precisa de permissão para brilhar. Você já tem tudo que precisa dentro de si!' },
  { icon:'💪', cat:'autoestima', msg:'Sua teimosia (a boa teimosia de não desistir) é o segredo do seu sucesso. Mantém ela!' },
  { icon:'💪', cat:'autoestima', msg:'Você ainda vai realizar muita coisa que te vai encher de orgulho. Esse capítulo ainda está sendo escrito!' },
  { icon:'💪', cat:'autoestima', msg:'As dificuldades que você superou te tornaram quem você é. E quem você é, é muito bom!' },
  { icon:'💪', cat:'autoestima', msg:'Você merece o seu próprio respeito antes do de qualquer outro. Respeite-se profundamente hoje!' },
  { icon:'💪', cat:'autoestima', msg:'Quando você entra num ambiente, a energia muda. Isso tem nome: presença. Você tem presença!' },
  { icon:'💪', cat:'autoestima', msg:'Seu esforço de hoje vai gerar fruto que você nem sabe ainda. Planta mesmo sem ver a colheita!' },
  { icon:'💪', cat:'autoestima', msg:'Você tem mais poder sobre sua vida do que qualquer circunstância externa. Use esse poder!' },
  { icon:'💪', cat:'autoestima', msg:'Uma coisa que você faz melhor do que qualquer um: ser você. E isso é mais do que suficiente!' },
  { icon:'💪', cat:'autoestima', msg:'Você está exatamente onde precisa estar para aprender o que precisa aprender. Confia no processo!' },
  { icon:'💪', cat:'autoestima', msg:'Sua voz importa. Sua opinião conta. Você tem o direito de se posicionar. Use esse direito hoje!' },
  { icon:'💪', cat:'autoestima', msg:'O ritmo do seu crescimento é o seu ritmo. Não se compare — se supere!' },
  { icon:'💪', cat:'autoestima', msg:'Você é a prova viva de que determinação muda destino. Continue sendo essa prova todos os dias!' },
  { icon:'💪', cat:'autoestima', msg:'Quando você acredita em si mesmo(a), abre portas que nem sabia que existiam. Acredita mais!' },
  { icon:'💪', cat:'autoestima', msg:'Você tem uma luz própria. Não depende de ninguém para acendê-la. Já está acesa!' },
  { icon:'💪', cat:'autoestima', msg:'Hoje você vai dar o seu melhor. E o seu melhor hoje é melhor do que era ontem. Progresso real!' },
  { icon:'💪', cat:'autoestima', msg:'Você é capaz de muito mais do que qualquer dificuldade pode te tirar. Lembre disso hoje!' },
  { icon:'💪', cat:'autoestima', msg:'Sua jornada tem um propósito que vai se revelar com o tempo. Enquanto isso, vive bem cada dia!' },
  { icon:'💪', cat:'autoestima', msg:'Você não é definido(a) pelos seus erros — é definido(a) pelo que faz depois deles.' },
  { icon:'💪', cat:'autoestima', msg:'Uma pessoa com o seu coração e a sua vontade chega muito longe. Você já provou isso!' },
  { icon:'💪', cat:'autoestima', msg:'Hoje é um dia para você ser grato(a) por quem você se tornou. Você cresceu muito. Celebra!' },
  { icon:'💪', cat:'autoestima', msg:'Você tem o poder de transformar não só a sua vida, mas a dos que estão ao seu redor. Que responsabilidade linda!' },
  { icon:'💪', cat:'autoestima', msg:"Acorda, se olha no espelho e pensa: 'vai ser um dia incrível'. Porque vai. Porque você faz ser!" },
  { icon:'💪', cat:'autoestima', msg:'Sua autenticidade é o que te faz memorável. Nunca abra mão de ser quem você realmente é!' },
  { icon:'💪', cat:'autoestima', msg:'Você já é suficiente. E ainda está crescendo. Que combinação poderosa!' },
  { icon:'💪', cat:'autoestima', msg:'Hoje não precisa ser perfeito. Precisa ser seu. E o que é seu, já é bom!' },
  { icon:'💪', cat:'autoestima', msg:'A vida tem surpresas boas te esperando. Fique aberto(a) — elas chegam quando você menos espera.' },
  { icon:'💪', cat:'autoestima', msg:'Você tem muito mais a dar ao mundo. E o mundo está esperando a sua contribuição única!' },
  { icon:'💪', cat:'autoestima', msg:'Que bom que você existe! A loja, a equipe e esse dia são melhores com você neles.' },
  { icon:'❤️', cat:'familia', msg:'Cada venda que você faz hoje é por quem você ama. Trabalho com amor tem outro sabor.' },
  { icon:'❤️', cat:'familia', msg:'Você trabalha para construir algo maior. Cada dia aqui é um tijolo nessa construção bonita.' },
  { icon:'❤️', cat:'familia', msg:'Quem te espera em casa vai adorar saber que você deu o seu melhor hoje. Vai valer!' },
  { icon:'❤️', cat:'familia', msg:'Família é o melhor motivo para dar o máximo no trabalho. Você tem motivos de sobra!' },
  { icon:'❤️', cat:'familia', msg:'Pense nos que você ama enquanto trabalha. Esse pensamento transforma qualquer tarefa em missão.' },
  { icon:'❤️', cat:'familia', msg:'Um pai ou mãe dedicado(a) que trabalha com amor ensina os filhos pelo exemplo. Que lição bonita!' },
  { icon:'❤️', cat:'familia', msg:'Você trabalha para proporcionar coisas boas para sua família. Isso é amor em ação!' },
  { icon:'❤️', cat:'familia', msg:'Os seus filhos (presentes ou futuros) vão se orgulhar de você. Faça por merecer esse orgulho!' },
  { icon:'❤️', cat:'familia', msg:'Família não é só sangue — é quem você escolhe amar todo dia. Cuide bem da sua hoje!' },
  { icon:'❤️', cat:'familia', msg:"Quando chegar em casa, você vai poder dizer: 'Dei o meu melhor hoje.' Que presente isso é!" },
  { icon:'❤️', cat:'familia', msg:'Seus pais se orgulham de você mais do que imaginam expressar. Lembre disso nos dias difíceis.' },
  { icon:'❤️', cat:'familia', msg:'O amor em casa é o combustível do trabalho com propósito. Você tem esse combustível!' },
  { icon:'❤️', cat:'familia', msg:'Cada sacrifício que você faz no trabalho vai ser traduzido em alegria na vida da sua família.' },
  { icon:'❤️', cat:'familia', msg:'Você é o exemplo que sua família vai lembrar — de que com dedicação, as coisas mudam!' },
  { icon:'❤️', cat:'familia', msg:'Criar uma vida melhor para quem você ama é a motivação mais poderosa que existe. Use ela!' },
  { icon:'❤️', cat:'familia', msg:'Os momentos que você cria com a família são o retorno real de todo o esforço aqui. Vale!' },
  { icon:'❤️', cat:'familia', msg:'Você carrega o amor da sua família no coração todos os dias. Isso te protege e te fortalece.' },
  { icon:'❤️', cat:'familia', msg:'Que saudade boa de chegar em casa cansado(a) mas realizado(a) e ver aqueles que você ama!' },
  { icon:'❤️', cat:'familia', msg:'Trabalhar com dignidade é o legado mais bonito que você pode deixar para os seus.' },
  { icon:'❤️', cat:'familia', msg:'Cada conquista profissional que você tem ressoa na vida da sua família. Conquiste mais!' },
  { icon:'❤️', cat:'familia', msg:'Você é o/a herói(ína) silencioso(a) da sua família. Mesmo sem capa, você voa.' },
  { icon:'❤️', cat:'familia', msg:'O amor que você tem pela família te dá uma força que nenhum desafio profissional consegue vencer.' },
  { icon:'❤️', cat:'familia', msg:'Seus filhos aprendem sobre trabalho vendo como você trabalha. Que belo professor(a) você é!' },
  { icon:'❤️', cat:'familia', msg:'A família que você está construindo merece toda a sua dedicação. E você dá isso todos os dias!' },
  { icon:'❤️', cat:'familia', msg:'Um abraço em casa vale mais depois de um dia bem trabalhado. Faça render esse abraço!' },
  { icon:'❤️', cat:'familia', msg:'Você pensa na família quando as coisas ficam difíceis. Essa é a âncora que te mantém firme.' },
  { icon:'❤️', cat:'familia', msg:'O presente mais valioso que você dá à família é o seu exemplo de persistência e honestidade.' },
  { icon:'❤️', cat:'familia', msg:'Família forte precisa de pessoas fortes. E você está se tornando mais forte a cada dia.' },
  { icon:'❤️', cat:'familia', msg:'Quem trabalha com amor pelo próximo, colhe amor no lar. Trabalha com amor hoje!' },
  { icon:'❤️', cat:'familia', msg:'Cada conquista no trabalho é dividida com quem está em casa torcendo por você.' },
  { icon:'❤️', cat:'familia', msg:'Você inspira as pessoas que ama a também darem o melhor de si. Que influência linda!' },
  { icon:'❤️', cat:'familia', msg:'Os filhos que crescem vendo os pais trabalharem com honra, crescem com honra. Seja esse exemplo!' },
  { icon:'❤️', cat:'familia', msg:'Família é o porto seguro que te espera ao fim de cada dia bem trabalhado. Trabalha bem!' },
  { icon:'❤️', cat:'familia', msg:'Você carrega histórias de quem te criou e de quem você está criando. Que peso bonito de carregar!' },
  { icon:'❤️', cat:'familia', msg:'Cada dia de trabalho honesto é uma homenagem silenciosa à família que te criou.' },
  { icon:'❤️', cat:'familia', msg:'Os seus, mesmo longe, estão torcendo por você agora. Não decepcione essa torcida!' },
  { icon:'❤️', cat:'familia', msg:'Você é o elo que liga gerações. O esforço de hoje vai impactar vidas que ainda nem existem.' },
  { icon:'❤️', cat:'familia', msg:'Família pede pouco: que você seja feliz e se cuide. Trabalha bem pra chegar bem em casa!' },
  { icon:'❤️', cat:'familia', msg:'Você tem pessoas que dependem de você — e isso não é peso, é propósito. Seja esse propósito!' },
  { icon:'❤️', cat:'familia', msg:'O melhor investimento que existe é no bem-estar da família. Você trabalha por isso todo dia.' },
  { icon:'❤️', cat:'familia', msg:'Quando você crescer profissionalmente, você eleva toda a família junto. Cresce hoje!' },
  { icon:'❤️', cat:'familia', msg:'Sua mãe/pai trabalharam por você. Agora você trabalha pelos seus. Que ciclo bonito de amor!' },
  { icon:'❤️', cat:'familia', msg:'Ter família que te apoia é um privilégio. Retribua com dedicação e presença quando estiver em casa.' },
  { icon:'❤️', cat:'familia', msg:'Você é mais do que funcionário(a) — você é filho(a), pai, mãe, irmão(ã). Que riqueza de papéis!' },
  { icon:'❤️', cat:'familia', msg:'A energia que você coloca no trabalho hoje vai refletir no sorriso de casa amanhã.' },
  { icon:'❤️', cat:'familia', msg:'Família não mede conquistas — mede o amor que você coloca em tudo o que faz. Coloque amor!' },
  { icon:'❤️', cat:'familia', msg:'Você trabalha com alegria quando pensa no porquê. Pensa na família — e a alegria vem!' },
  { icon:'❤️', cat:'familia', msg:'Cada dia de trabalho dedicado é uma carta de amor à família. Escreva bonito hoje!' },
  { icon:'❤️', cat:'familia', msg:'Você tem um lar que te espera. Que motivação poderosa carregar no coração durante o trabalho!' },
  { icon:'❤️', cat:'familia', msg:'Orgulhar a família não é pressão — é motivo de alegria. Você dá esse motivo todos os dias!' },
  { icon:'❤️', cat:'familia', msg:'Você trabalha com garra porque tem amor. E amor é combustível que nunca acaba.' },
  { icon:'❤️', cat:'familia', msg:'Família te vê como herói(na). Hoje, seja o herói(na) que eles enxergam em você.' },
  { icon:'❤️', cat:'familia', msg:'O cuidado que você tem com o trabalho é o mesmo que tem com a família. Que coerência linda!' },
  { icon:'❤️', cat:'familia', msg:'Ao final do dia, o que mais importa é ter amado bem e trabalhado com dedicação. Você faz os dois!' },
  { icon:'❤️', cat:'familia', msg:'Você constrói o futuro da sua família com cada hora bem trabalhada hoje. Que obra bonita!' },
  { icon:'❤️', cat:'familia', msg:'Sua família acredita em você. Acredite também, em dobro.' },
  { icon:'❤️', cat:'familia', msg:'Você carrega o nome da sua família com orgulho no trabalho. E eles carregam o seu com orgulho em casa.' },
  { icon:'❤️', cat:'familia', msg:'Todo esforço tem um rosto. O seu rosto de esforço tem o rosto de quem você ama.' },
  { icon:'❤️', cat:'familia', msg:'Quem trabalha com amor pensa na família. Quem pensa na família, nunca desiste. Vai!' },
  { icon:'❤️', cat:'familia', msg:'A bênção da família é o melhor combustível para o dia. Você tem essa bênção — use ela!' },
  { icon:'💕', cat:'amor', msg:'O amor move o mundo — e flores são a linguagem do amor. Você faz parte disso. Que lindo!' },
  { icon:'💕', cat:'amor', msg:'Você ajuda pessoas a expressarem o que sentem. Hoje alguém vai chorar de alegria por causa do seu trabalho.' },
  { icon:'💕', cat:'amor', msg:'Amizade é a família que você escolhe. Cuide das suas amizades como cuida das flores — com atenção!' },
  { icon:'💕', cat:'amor', msg:'Você tem amigos que torcem por você em silêncio. Sabe disso? São tesouros invisíveis!' },
  { icon:'💕', cat:'amor', msg:'Amor não é só romantismo — é respeito, cuidado e presença. Pratique isso hoje em tudo.' },
  { icon:'💕', cat:'amor', msg:'Aquele amigo ou amiga que está longe pensa em você mais do que você imagina. Manda uma mensagem!' },
  { icon:'💕', cat:'amor', msg:'Ser um bom amigo é uma das coisas mais nobres que um ser humano pode ser. Você é!' },
  { icon:'💕', cat:'amor', msg:'Amor verdadeiro não tem condições. Gratuidade, cuidado, presença — você entende isso muito bem.' },
  { icon:'💕', cat:'amor', msg:'Uma amizade verdadeira sobrevive à distância, ao tempo e às diferenças. Cultive as suas!' },
  { icon:'💕', cat:'amor', msg:'Você tem o dom de fazer as pessoas se sentirem especiais. Isso é amor em prática!' },
  { icon:'💕', cat:'amor', msg:'Amor se aprende amando. Você está nessa escola todos os dias. Que aprendizado bonito!' },
  { icon:'💕', cat:'amor', msg:'Um amigo que te conhece de verdade é ouro. Se você tem um, você é rico(a).' },
  { icon:'💕', cat:'amor', msg:'Quem ama o que faz, faz com qualidade. E você ama o que faz — isso se vê!' },
  { icon:'💕', cat:'amor', msg:'Flores são declarações de amor. Você trabalha com declarações de amor. Que trabalho abençoado!' },
  { icon:'💕', cat:'amor', msg:'Às vezes, o ato mais amoroso é simplesmente estar presente. Esteja presente hoje!' },
  { icon:'💕', cat:'amor', msg:'Uma amizade construída no trabalho pode durar a vida inteira. Cultive essas relações!' },
  { icon:'💕', cat:'amor', msg:'Amor não é só para os íntimos — um sorriso genuíno para o cliente também é amor. Dê hoje!' },
  { icon:'💕', cat:'amor', msg:'Você sabe ouvir — e isso é um dos maiores atos de amor que existem. Continue assim!' },
  { icon:'💕', cat:'amor', msg:'Ter alguém que te apoia nos sonhos é raro e precioso. Aprecie quem faz isso por você!' },
  { icon:'💕', cat:'amor', msg:'Uma boa conversa com um amigo recarrega a alma. Cuide dessas conexões — elas te sustentam!' },
  { icon:'💕', cat:'amor', msg:'O amor que você doa volta sempre, muitas vezes multiplicado. Doe muito hoje!' },
  { icon:'💕', cat:'amor', msg:'Amigos de verdade são aqueles com quem o silêncio é confortável. Valorize quem você pode ser você mesmo(a)!' },
  { icon:'💕', cat:'amor', msg:'Você foi amorosamente colocado(a) aqui, nesse trabalho, com essas pessoas. Aprecie cada uma!' },
  { icon:'💕', cat:'amor', msg:'Amor próprio não é arrogância — é necessidade. Cuide de si mesmo(a) com o mesmo carinho que cuida dos outros.' },
  { icon:'💕', cat:'amor', msg:'Uma amizade cultivada no dia a dia é mais forte do que qualquer relação de crise. Cultive a sua!' },
  { icon:'💕', cat:'amor', msg:'Você tem a capacidade de amar profundamente. Isso te torna alguém extraordinário(a).' },
  { icon:'💕', cat:'amor', msg:'Às vezes uma flor entregue com carinho diz mais do que horas de conversa. Você viabiliza isso!' },
  { icon:'💕', cat:'amor', msg:'Os melhores momentos da vida envolvem pessoas que amamos. Crie esses momentos hoje!' },
  { icon:'💕', cat:'amor', msg:"Amor se expressa em detalhes — um lembrete, um café, um 'como você está?'. Pratique hoje!" },
  { icon:'💕', cat:'amor', msg:'Você constrói pontes de afeto onde existia distância. Que dom especial!' },
  { icon:'💕', cat:'amor', msg:'Amizade genuína é rara como uma flor rara. Cuide das suas com dedicação e constância!' },
  { icon:'💕', cat:'amor', msg:'Cada vez que você escolhe a bondade, escolhe o amor. Faça essa escolha hoje!' },
  { icon:'💕', cat:'amor', msg:'Uma mensagem carinhosa pode mudar completamente o dia de alguém. Manda para quem você ama!' },
  { icon:'💕', cat:'amor', msg:'O amor romântico começa com amizade e respeito. Se tem os dois, tem tudo.' },
  { icon:'💕', cat:'amor', msg:'Você é amado(a) por quem você é, não pelo que faz. Isso é um presente imenso. Carrega isso!' },
  { icon:'💕', cat:'amor', msg:'Quando você faz o bem sem esperar retorno, o amor puro se manifesta. Você faz isso!' },
  { icon:'💕', cat:'amor', msg:'Amigos que crescem juntos são raros. Se tem um, aprecia muito.' },
  { icon:'💕', cat:'amor', msg:'O coração que ama não tem espaço para guardar rancor. Você tem um coração assim.' },
  { icon:'💕', cat:'amor', msg:'Você ilumina o ambiente com a sua presença. Isso é uma forma de amor que poucos têm.' },
  { icon:'💕', cat:'amor', msg:'Amor é uma escolha renovada a cada dia. Escolha amar — as pessoas ao redor, o trabalho, a vida!' },
  { icon:'💕', cat:'amor', msg:'Você merece amizades que te celebram, te desafiam e te aceitam. Você tem isso?' },
  { icon:'💕', cat:'amor', msg:'Uma boa gargalhada com alguém especial é medicina pura. Ria hoje — de coração!' },
  { icon:'💕', cat:'amor', msg:'Você carrega em si a capacidade de transformar qualquer lugar em um lugar mais amoroso.' },
  { icon:'💕', cat:'amor', msg:"Amizade não precisa de motivo especial para se manifestar. Um 'oi, lembrei de você' já basta!" },
  { icon:'💕', cat:'amor', msg:'Quando você ama o trabalho, o trabalho te ama de volta — em satisfação, crescimento e propósito.' },
  { icon:'💕', cat:'amor', msg:'Uma amizade antiga tem um valor que dinheiro nenhum compra. Honre as suas!' },
  { icon:'💕', cat:'amor', msg:'O amor que você tem pelo próximo é a sua maior força no trabalho com o público.' },
  { icon:'💕', cat:'amor', msg:'Você cria laços onde vai. Isso é uma habilidade rara e preciosa. Valoriza!' },
  { icon:'💕', cat:'amor', msg:'Às vezes, o melhor presente que você pode dar é a sua atenção genuína. Dê isso hoje!' },
  { icon:'💕', cat:'amor', msg:'Quem trabalha com flores trabalha com amor. Você é um(a) profissional do amor. Que título!' },
  { icon:'💕', cat:'amor', msg:'A generosidade do coração abre mais portas do que qualquer habilidade técnica. Seja generoso(a)!' },
  { icon:'💕', cat:'amor', msg:'Você tem amigos que seriam vizinhos de alma. Esses são os que moldam quem você é. Agradeça!' },
  { icon:'💕', cat:'amor', msg:'Uma conversa sincera entre amigos resolve mais do que qualquer terapia. Abre o coração hoje!' },
  { icon:'💕', cat:'amor', msg:'O amor que você coloca no trabalho vai até o cliente — ele sente, mesmo sem saber de onde vem.' },
  { icon:'💕', cat:'amor', msg:'Amor não envelhece. A amizade de anos tem uma textura que a nova não tem ainda. Valorize as antigas!' },
  { icon:'💕', cat:'amor', msg:'Você é capaz de um amor imenso — pelo trabalho, pelas pessoas, pela vida. Isso é raro. É seu!' },
  { icon:'💕', cat:'amor', msg:'Um gesto de amizade no trabalho transforma um ambiente de obrigação em um lugar de pertencimento.' },
  { icon:'💕', cat:'amor', msg:'Você transforma estranhos em amigos com muita facilidade. Que dom social incrível!' },
  { icon:'💕', cat:'amor', msg:'O amor que você semeia nos outros é o que colhe de volta quando mais precisa. Semeia muito!' },
  { icon:'💕', cat:'amor', msg:'Você tem alguém que você pode ligar a qualquer hora? Isso é riqueza real. Que bênção!' },
  { icon:'💕', cat:'amor', msg:'Amor é o denominador comum de tudo que vale a pena. Coloca ele em tudo que fizer hoje!' },
  { icon:'💕', cat:'amor', msg:'Amizade é a certeza de que alguém está do seu lado — não pela obrigação, mas pela escolha. Aprecia!' },
  { icon:'💕', cat:'amor', msg:'Você sabe amar e ser amado(a). Isso é o que mais importa em qualquer relação. Você tem isso!' },
  { icon:'💕', cat:'amor', msg:'Uma boa amizade te faz rir quando você menos espera. Que você tenha esse tipo hoje!' },
  { icon:'💕', cat:'amor', msg:'Amor-próprio é base de tudo. Quando você se ama, ama melhor os outros e trabalha melhor.' },
  { icon:'💕', cat:'amor', msg:'O mundo precisa de mais pessoas que amam com a intensidade que você ama. Continue sendo assim!' },
  { icon:'💕', cat:'amor', msg:'Você cria conexões afetivas onde os outros veem apenas transações. Isso é extraordinário!' },
  { icon:'💕', cat:'amor', msg:'Hoje, diga a alguém o que você pensa de positivo sobre ele ou ela. Amor dito tem mais poder!' },
  { icon:'💕', cat:'amor', msg:'O cuidado que você tem com as pessoas — amigos, clientes, família — é sua marca registrada.' },
  { icon:'💕', cat:'amor', msg:'Flores e amor têm algo em comum: os dois ficam mais bonitos quando compartilhados. Compartilhe!' },
  { icon:'💕', cat:'amor', msg:'Você tem um coração que cabe muita gente. E muita gente quer estar no seu coração. Abra!' },
  { icon:'💕', cat:'amor', msg:'A amizade que você nutre no trabalho é a raiz que te sustenta nos dias difíceis. Nutre ela!' },
  { icon:'💕', cat:'amor', msg:'Você é alguém que o amor escolheu para expressar. Seja o canal dele hoje com quem você encontrar.' },
  { icon:'💕', cat:'amor', msg:'Quando a amizade e o trabalho se misturam, a produtividade tem alma. Você tem isso com a equipe!' },
  { icon:'💕', cat:'amor', msg:'O amor em forma de atenção genuína é o mais raro e o mais valioso. Dê isso hoje!' },
  { icon:'🙏', cat:'fe', msg:'Que Deus abençoe sua jornada hoje! Cada momento é um presente. Aproveite com alegria.' },
  { icon:'🙏', cat:'fe', msg:'Com fé e dedicação, nenhum dia é desperdiçado. Confie no processo e no que você tem de melhor.' },
  { icon:'🙏', cat:'fe', msg:'O universo conspira a favor de quem trabalha com amor e honestidade. Hoje é o dia de quem faz bonito!' },
  { icon:'🙏', cat:'fe', msg:'Paz, trabalho e gratidão. Com esses três ingredientes, qualquer dia fica bom. Que dia abençoado!' },
  { icon:'🙏', cat:'fe', msg:'Você foi colocado(a) aqui por um motivo. E hoje esse motivo vai aparecer de formas bonitas.' },
  { icon:'🙏', cat:'fe', msg:'Cada manhã é a misericórdia de Deus renovada. Aproveite cada minuto desse presente!' },
  { icon:'🙏', cat:'fe', msg:'Quando você ora antes de começar, o trabalho tem outro peso — mais leve e mais cheio de propósito.' },
  { icon:'🙏', cat:'fe', msg:'Deus não coloca obstáculos que você não consegue superar. Se está no seu caminho, você passa!' },
  { icon:'🙏', cat:'fe', msg:'Fé não é ausência de dúvida — é a decisão de continuar mesmo com ela. Você tem essa fé!' },
  { icon:'🙏', cat:'fe', msg:'Que o Senhor guie cada palavra sua e cada atendimento hoje. Trabalho ungido produz frutos!' },
  { icon:'🙏', cat:'fe', msg:'A gratidão abre portas que a reclamação fecha. Comece o dia agradecendo — muda tudo!' },
  { icon:'🙏', cat:'fe', msg:'Você não está sozinho(a). Há uma força maior que te acompanha em cada passo. Confia!' },
  { icon:'🙏', cat:'fe', msg:'Sua vida tem um propósito divino. Nem sempre você vê, mas ele está sendo tecido a cada dia.' },
  { icon:'🙏', cat:'fe', msg:'Deus vê o seu esforço quando ninguém mais vê. Trabalhe como se Ele estivesse olhando — porque está!' },
  { icon:'🙏', cat:'fe', msg:'A paz que excede todo entendimento está disponível para você. Pede e recebe. Trabalha em paz!' },
  { icon:'🙏', cat:'fe', msg:'Bênção não é só dinheiro ou saúde — é acordar, ter propósito e poder trabalhar. Você é abençoado(a)!' },
  { icon:'🙏', cat:'fe', msg:'O Senhor é o seu pastor — nada vai te faltar hoje. Vai com essa certeza no coração!' },
  { icon:'🙏', cat:'fe', msg:'Quando a situação parecer pesada, lembra: tem Alguém mais forte carregando junto com você.' },
  { icon:'🙏', cat:'fe', msg:'Fé do tamanho de um grão de mostarda move montanhas. Você tem mais do que isso. Use!' },
  { icon:'🙏', cat:'fe', msg:'Cada boa ação que você pratica hoje é uma semente plantada em terreno abençoado.' },
  { icon:'🙏', cat:'fe', msg:'Que a sua luz brilhe hoje para que as pessoas vejam bondade e sejam inspiradas!' },
  { icon:'🙏', cat:'fe', msg:'Deus transforma situações impossíveis. Pode ser hoje mesmo. Esteja aberto(a) ao milagre!' },
  { icon:'🙏', cat:'fe', msg:'A oração antes do trabalho não demora muito, mas muda muito. Ore antes de começar!' },
  { icon:'🙏', cat:'fe', msg:'Quem serve com amor, serve a Deus. E Deus recompensa quem O serve com alegria!' },
  { icon:'🙏', cat:'fe', msg:'Tudo coopera para o bem de quem ama a Deus. Vai trabalhar sabendo disso!' },
  { icon:'🙏', cat:'fe', msg:'Não importa o que hoje trouxer — você tem proteção divina sobre sua vida. Anda seguro(a)!' },
  { icon:'🙏', cat:'fe', msg:'A força que você precisa para hoje já foi depositada em você antes de você nascer. Acessa essa força!' },
  { icon:'🙏', cat:'fe', msg:'Agradecer o que tem é o primeiro passo para receber mais. Começa o dia com gratidão!' },
  { icon:'🙏', cat:'fe', msg:'Deus não abandona quem tem o coração bom. E você tem um coração muito bom.' },
  { icon:'🙏', cat:'fe', msg:'Cada cliente que você atende com amor é uma oferta a Deus. Que oferta linda você faz hoje!' },
  { icon:'🙏', cat:'fe', msg:'A paz no coração não depende das circunstâncias — depende de quem você colocou no trono da sua vida.' },
  { icon:'🙏', cat:'fe', msg:'Fé ativa é a que se levanta, vai trabalhar e espera as bênçãos aparecerem. Você tem fé ativa!' },
  { icon:'🙏', cat:'fe', msg:'Que os seus passos sejam guiados hoje e que cada decisão sua seja inspirada pelo bem.' },
  { icon:'🙏', cat:'fe', msg:'Você tem um anjo da guarda que andou muito essa semana. Agradece o serviço dele! 😇' },
  { icon:'🙏', cat:'fe', msg:'O que você semear com amor, colherá com alegria. Semeia bem hoje — a colheita é certa!' },
  { icon:'🙏', cat:'fe', msg:'Deus tem planos de prosperidade para você. Planos de futuro e esperança. Creia nisso!' },
  { icon:'🙏', cat:'fe', msg:'Cada obstáculo que você superou foi com ajuda de algo além da sua força. Reconhece e agradece!' },
  { icon:'🙏', cat:'fe', msg:'A gratidão é o idioma que o céu entende melhor. Fale esse idioma com frequência hoje!' },
  { icon:'🙏', cat:'fe', msg:'Você não está vivendo por acidente. Há um propósito sagrado em cada detalhe da sua vida.' },
  { icon:'🙏', cat:'fe', msg:'Quando o coração está em paz com Deus, o trabalho tem uma leveza inexplicável. Busca essa paz!' },
  { icon:'🙏', cat:'fe', msg:'O Senhor conhece as suas necessidades antes de você pedir. Vai tranquilo(a) — está sendo cuidado(a)!' },
  { icon:'🙏', cat:'fe', msg:'Bênção vem de trabalho honesto e coração limpo. Você tem os dois — então vem vindo!' },
  { icon:'🙏', cat:'fe', msg:'Quando tudo parecer escuro, lembre: a luz de Deus não apaga. Confia nessa luz hoje!' },
  { icon:'🙏', cat:'fe', msg:'A fé que move montanhas começa no coração que decide confiar. Decida confiar hoje!' },
  { icon:'🙏', cat:'fe', msg:'Você é templo do Espírito Santo — cuida bem desse templo, com saúde e paz!' },
  { icon:'🙏', cat:'fe', msg:'Deus usa pessoas comuns para fazer coisas extraordinárias. Hoje pode ser o seu dia de ser usado(a) assim.' },
  { icon:'🙏', cat:'fe', msg:'Gratidão pela manhã, fé durante o dia, paz à noite. Que combinação poderosa de viver!' },
  { icon:'🙏', cat:'fe', msg:'Que a bênção de Deus repousa sobre cada pedido que você fizer e cada cliente que você atender hoje.' },
  { icon:'🙏', cat:'fe', msg:'Você foi criado(a) com propósito. Cada dia que você vive esse propósito, você honra quem te criou.' },
  { icon:'🙏', cat:'fe', msg:'Perseverança com fé é imbatível. Você tem as duas. O resultado é inevitável — vai vir!' },
  { icon:'🙏', cat:'fe', msg:'Deus enxerga o que está sendo construído no seu interior. E o que Ele vê é bonito.' },
  { icon:'🙏', cat:'fe', msg:'Que a paz do Senhor guarde o seu coração e a sua mente hoje e sempre.' },
  { icon:'🙏', cat:'fe', msg:'Você não precisa entender tudo — precisa confiar. E essa confiança te liberta para agir!' },
  { icon:'🙏', cat:'fe', msg:'O trabalho honesto tem cheiro de incenso para o alto. O que você faz hoje, sobe.' },
  { icon:'🙏', cat:'fe', msg:'Uma vida de fé não significa ausência de problemas — significa presença de Deus nos problemas.' },
  { icon:'🙏', cat:'fe', msg:'Você tem um Deus que vai na frente preparando o caminho. Vai confiante que o caminho já está pronto!' },
  { icon:'🙏', cat:'fe', msg:'A benção sobre o trabalho das suas mãos está declarada. Receba hoje com gratidão!' },
  { icon:'🙏', cat:'fe', msg:'Deus é maior que qualquer desafio que você vai encontrar hoje. Muito, muito maior!' },
  { icon:'🙏', cat:'fe', msg:'Quando você agradece o que tem, você atrai mais do que é bom. Gratidão é lei espiritual!' },
  { icon:'🙏', cat:'fe', msg:'A sua oração mais simples tem o poder de mudar o seu dia completamente. Ora agora!' },
  { icon:'🙏', cat:'fe', msg:'Que Deus multiplique os frutos do seu trabalho hoje como multiplicou os pães e os peixes.' },
  { icon:'🙏', cat:'fe', msg:'Você tem proteção sobre sua ida e sua vinda. Sobre o trabalho e sobre o lar. Que bênção!' },
  { icon:'🙏', cat:'fe', msg:'Fé sem obras é morta — e a sua fé está viva, porque você trabalha com dedicação todos os dias!' },
  { icon:'🙏', cat:'fe', msg:'Aquele que cuida dos pássaros do céu cuida muito mais de você. Você não vai passar necessidade!' },
  { icon:'🙏', cat:'fe', msg:'Seja luz onde você estiver hoje. Uma luz que não ilumina só a si mesmo, mas os que estão ao redor.' },
  { icon:'🙏', cat:'fe', msg:'Deus não te pede perfeição — te pede disponibilidade. Você está disponível? Então está pronto(a)!' },
  { icon:'🙏', cat:'fe', msg:'Quando você perdoa, liberta a si mesmo(a). Começa o dia perdoado(a) e perdoando. Que leveza!' },
  { icon:'🙏', cat:'fe', msg:'A sua missão de vida está sendo cumprida a cada dia de trabalho honesto. Continue!' },
  { icon:'🙏', cat:'fe', msg:'Que a unção de Deus esteja sobre o seu trabalho hoje e que os resultados superem as expectativas!' },
  { icon:'🙏', cat:'fe', msg:'Você tem uma cobertura espiritual que nenhum olho vê, mas que todo dia age a seu favor.' },
  { icon:'🙏', cat:'fe', msg:'Trabalhar com excelência é honrar a quem te criou com excelência. Honra hoje!' },
  { icon:'🙏', cat:'fe', msg:'O Senhor dirige os seus passos — não se preocupe com o destino. Caminhe fiel e deixe Deus guiar!' },
  { icon:'🙏', cat:'fe', msg:'Deus está escrevendo uma história bonita com a sua vida. Hoje é mais um capítulo lindo!' },
  { icon:'🙏', cat:'fe', msg:'A paz que Deus dá não é a que o mundo dá. É mais profunda, mais estável, mais real.' },
  { icon:'🙏', cat:'fe', msg:'Você tem a unção do trabalho sobre sua vida. Tudo que suas mãos tocam, prospera!' },
  { icon:'🙏', cat:'fe', msg:'Que hoje seja marcado pela presença de Deus no seu trabalho, nas suas palavras e no seu coração.' },
  { icon:'🙏', cat:'fe', msg:'Você não precisa carregar o peso sozinho(a). Lança sobre Ele e vai leve pro trabalho!' },
  { icon:'🙏', cat:'fe', msg:'Que a graça de Deus seja abundante sobre você hoje — mais do que você merece e mais do que você espera.' },
  { icon:'😄', cat:'humor', msg:'Segunda-feira ligou. Você não atendeu. Que bom — porque a vida começa mesmo é agora! 😄' },
  { icon:'😄', cat:'humor', msg:'Bom dia! Você acordou, respirou e veio trabalhar. Já está na frente de muita gente! 😂' },
  { icon:'😄', cat:'humor', msg:'O cafezinho tá pronto, o dia tá te esperando e a floricultura não funciona sem você. Sem pressão! ☕' },
  { icon:'😄', cat:'humor', msg:'Dica do dia: sorria mais! É de graça, não engorda e deixa o cliente com vontade de voltar sempre. 😁' },
  { icon:'😄', cat:'humor', msg:'Motivação do dia: trabalhe bem que o almoço fica mais gostoso! 😋 (Sério, funciona!)' },
  { icon:'😄', cat:'humor', msg:'Hoje vai ser ótimo! E se não for... pelo menos vai ter comida boa no intervalo. 🌮😄' },
  { icon:'😄', cat:'humor', msg:'Você não está cansado(a) — você está carregado(a) de energia que ainda não foi usada. 😂' },
  { icon:'😄', cat:'humor', msg:'Reunião cancelada = melhor dia da semana. Não cancelou? Tudo bem, você dá conta! 😅' },
  { icon:'😄', cat:'humor', msg:'Meta batida = pizza. Meta não batida = salada. A escolha é sua! 🍕🥗 (Brincadeira! Ou não...)' },
  { icon:'😄', cat:'humor', msg:'Hoje é dia de ser tão produtivo(a) que até você vai se surpreender. Bora provar que dá pra si mesmo(a)!' },
  { icon:'😄', cat:'humor', msg:'Uma flor por dia mantém o mau humor afastado. Você está no lugar certo! 🌸' },
  { icon:'😄', cat:'humor', msg:'Se o café não funcionar, vem água. Se a água não funcionar, vai lá falar com a flor — ela te ouve! 🌻' },
  { icon:'😄', cat:'humor', msg:'Deus deu um cérebro, dois olhos e um sorriso. Hoje use todos no trabalho! 😄' },
  { icon:'😄', cat:'humor', msg:'Você é a pessoa mais competente que existe... de manhã cedo com o cafezinho. Fora isso, também é! 😂' },
  { icon:'😄', cat:'humor', msg:'O segredo da produtividade é simples: começa. O resto vem. Vai lá que eu sei que você vai! 🚀' },
  { icon:'😄', cat:'humor', msg:'Hoje o sol nasceu pra todo mundo, mas pra você nasceu com brilho extra. Percebeu? Não? Já vai perceber! ☀️' },
  { icon:'😄', cat:'humor', msg:"Você trabalha tanto que o dicionário colocou sua foto no verbete 'dedicação'. Quase isso! 😄" },
  { icon:'😄', cat:'humor', msg:'Se o cliente vier difícil, lembra: você tem paciência de sobra... e café na cozinha. ☕😅' },
  { icon:'😄', cat:'humor', msg:'Ontem foi pesado. Hoje é novo. Amanhã a gente já sabe que vai ser incrível. Um dia de cada vez! 🌅' },
  { icon:'😄', cat:'humor', msg:"A sua energia hoje está no nível 'flor recém regada'. Vibrante, fresca e radiante! 🌷" },
  { icon:'😄', cat:'humor', msg:'Seu sorriso hoje é o produto mais valioso que você pode oferecer. E não sai do estoque! 😁' },
  { icon:'😄', cat:'humor', msg:'Você está lindo(a) hoje. Não, não vi pessoalmente — mas estatisticamente é provável. 😂' },
  { icon:'😄', cat:'humor', msg:'O pior que pode acontecer hoje? Nada que você não já tenha superado. Relaxa!' },
  { icon:'😄', cat:'humor', msg:'Dica de produtividade avançada: respira, sorri, começa. Isso já coloca você à frente de metade do mundo.' },
  { icon:'😄', cat:'humor', msg:'Flores precisam de água. Humanos precisam de café. Você já regou? ☕🌸' },
  { icon:'😄', cat:'humor', msg:'Você tem um dom especial: transforma estresse em resultado. Os outros só ficam estressados! 😂' },
  { icon:'😄', cat:'humor', msg:'Sabia que rir 10 vezes por dia é equivalente a 10 minutos de exercício? Você vai malhar hoje sem sair daqui! 😄' },
  { icon:'😄', cat:'humor', msg:'O dia começou. Você apareceu. 50% feito! Agora é só a outra metade. Fácil! 😁' },
  { icon:'😄', cat:'humor', msg:'Se o trabalho hoje fosse uma flor, seria uma que resiste a tudo e ainda fica bonita. Tipo você! 🌺' },
  { icon:'😄', cat:'humor', msg:'Você sabia que existem estudos que provam que pessoas que sorriam mais no trabalho vivem mais? 😊 (Não verificamos isso, mas parece verdade!)' },
  { icon:'😄', cat:'humor', msg:'Problema no trabalho = oportunidade disfarçada de capuz e óculos escuros. Você vai descobrir o disfarce! 🕵️' },
  { icon:'😄', cat:'humor', msg:'Hoje você vai ser tão produtivo(a) que o chefe vai pensar que colocou um robô no seu lugar. 🤖 (Mas um robô com carisma!)' },
  { icon:'😄', cat:'humor', msg:'Bom dia! Você é a flor mais rara desse jardim que é a equipe. 🌸 (Sim, isso foi cheio de autoajuda. Mas é verdade!)' },
  { icon:'😄', cat:'humor', msg:"Você não tem cinco estrelas no Google ainda — mas tem quatro e meio e uma avaliação de 'melhor atendimento da cidade'! ⭐" },
  { icon:'😄', cat:'humor', msg:'A equipe toda está aqui, o café está quente e o dia está em branco. Que tela linda pra pintar! 🎨' },
  { icon:'😄', cat:'humor', msg:'Você vai bater meta hoje. Não sei como, não sei quando — mas vai. Chamo isso de fé + estatística! 😂' },
  { icon:'😄', cat:'humor', msg:'Você tem a habilidade de fazer até cliente mal-humorado sorrir. Isso não tem preço — literalmente!' },
  { icon:'😄', cat:'humor', msg:'Hoje o universo está a seu favor. E se não estiver, você muda o universo. É assim que funciona aqui! 😎' },
  { icon:'😄', cat:'humor', msg:'Seu celular tinha bateria de manhã. Você também. Os dois vão durar o dia inteiro. 📱💪' },
  { icon:'😄', cat:'humor', msg:'Se hoje fosse um buquê, seria cheio de cores vibrantes, com aquele cheiro bom que fica no ambiente. É você!' },
  { icon:'😄', cat:'humor', msg:'Você trabalha tanto que às vezes as flores te agradecem por existir. 🌷 (Sim, elas falam. Só você não ouve ainda.)' },
  { icon:'😄', cat:'humor', msg:'Motivação científica: quando você está feliz no trabalho, o tempo passa mais rápido. Então sé feliz — é prático! 😄' },
  { icon:'😄', cat:'humor', msg:'Você não tem superpoderes. Mas tem determinação, criatividade e café. Que é quase a mesma coisa. ☕💥' },
  { icon:'😄', cat:'humor', msg:'Hoje é o dia em que você prova que era possível. Depois que provar, não esquece de celebrar!' },
  { icon:'😄', cat:'humor', msg:'A loja funciona melhor com você. Sem você, as flores ficam confusas. 🌸 (Elas têm um laço emocional, é sério!)' },
  { icon:'😄', cat:'humor', msg:"Você é do tipo: 'se não tem jeito, cria um'. Hoje pode ser um dia de criar vários! 😄" },
  { icon:'😄', cat:'humor', msg:'Desafio do dia: achar pelo menos 3 motivos para sorrir sem ser forçado. Fácil — você tem mais que isso!' },
  { icon:'😄', cat:'humor', msg:'Regra de ouro: cliente chega sorrindo = bom sinal. Cliente não chega sorrindo = você vai mudar isso. 😁' },
  { icon:'😄', cat:'humor', msg:'Você vem para o trabalho todo dia com uma determinação que deixaria qualquer general com inveja. 💪' },
  { icon:'😄', cat:'humor', msg:"Hoje pode ser aquele dia que se torna história de contar depois. 'No dia que...' Você vai ver!" },
  { icon:'😄', cat:'humor', msg:'A sua presença hoje vale mais do que muitos dias de ausência de outros. Sabe que é bom, né?' },
  { icon:'😄', cat:'humor', msg:'Você tem a habilidade de ver o lado bom das coisas. Em dias difíceis, isso vale ouro. Usa hoje!' },
  { icon:'😄', cat:'humor', msg:'Meta do dia: pelo menos um cliente que entre neutro e saia feliz. Você faz isso até dormindo! 😄' },
  { icon:'😄', cat:'humor', msg:'O trabalho hoje pode ser muito — mas você tem muito mais dentro de si. Equilíbrio garantido!' },
  { icon:'😄', cat:'humor', msg:'Que bom dia pra ser você! Talentoso(a), comprometido(a) e lindo(a). A combinação perfeita. 😁' },
  { icon:'😄', cat:'humor', msg:'Você chegou ao trabalho hoje e as flores ficaram mais bonitas. Coincidência? Não acho!' },
  { icon:'😄', cat:'humor', msg:'Hoje tem três tipos de dias: ótimo, excelente e incrível. Qual você vai escolher? 😄' },
  { icon:'😄', cat:'humor', msg:'Se hoje as coisas ficarem difíceis, lembra: você já superou 100% dos dias difíceis até agora. Taxa de sucesso: 100%! 🏆' },
  { icon:'😄', cat:'humor', msg:'Você não empurra pedras morro acima. Você usa a ladeira como impulso. Isso se chama inteligência!' },
  { icon:'😄', cat:'humor', msg:'A semana tem cinco dias úteis. Você só precisa arrasar em um por vez. Hoje é a vez! 💪' },
  { icon:'😄', cat:'humor', msg:"Você é o tipo de profissional que faz o empregador pensar: 'eu preciso contratar três desse!' 😄" },
  { icon:'😄', cat:'humor', msg:'Aviso: hoje haverá muita produtividade, algumas risadas e um ou dois clientes muito satisfeitos. Prepare-se! 😁' },
  { icon:'😄', cat:'humor', msg:'Você é aquela pessoa que faz o simples parecer extraordinário. Isso é talento puro!' },
  { icon:'😄', cat:'humor', msg:'Manhã de segunda: 😟 → Cafezinho: ☕ → Você chega: 🌟 É essa sequência que funciona!' },
  { icon:'😄', cat:'humor', msg:'O cliente que você vai atender hoje não sabe a sorte que tem. Mas vai descobrir logo! 😄' },
  { icon:'😄', cat:'humor', msg:'Você não precisa de motivação exterior — você É a motivação. De graça! 💪' },
  { icon:'😄', cat:'humor', msg:'Hoje você vai descobrir que tinha muito mais energia do que pensava. Spoiler! ⚡' },
  { icon:'😄', cat:'humor', msg:'Regra básica da floricultura: flores sorrindo + você sorrindo = cliente comprando. Matemática perfeita! 😄' },
  { icon:'😄', cat:'humor', msg:"Você tem talento para transformar 'bom dia' em 'melhor dia'. Aplica isso hoje!" },
  { icon:'😄', cat:'humor', msg:'Sua produtividade hoje vai ser tão alta que vai precisar de um medidor novo. 📊😄' },
  { icon:'😄', cat:'humor', msg:'Você tem o dom de aparecer no momento certo. E o momento certo é agora. Apareceu? Perfeito!' },
  { icon:'😄', cat:'humor', msg:'A sua energia hoje: café + determinação + sorriso. Mistura infalível! ☕💪😁' },
  { icon:'😄', cat:'humor', msg:"Hoje vai ter um momento exato em que você vai pensar: 'eu mandei bem!'. Espera por esse momento!" },
  { icon:'😄', cat:'humor', msg:'Você trabalha tão bem que as flores aprenderam com você a se apresentar melhor. 🌸 (Poético E verdade!)' },
  { icon:'😄', cat:'humor', msg:'Seu nível de competência hoje: profissional + motivado(a) + bem dormido(a)... ou pelo menos dois desses. 😂' },
  { icon:'😄', cat:'humor', msg:'Desafio: faça alguém da equipe rir hoje sem querer. Você provavelmente vai sem tentar! 😄' },
  { icon:'😄', cat:'humor', msg:'Você é a prova de que não precisa de capa para ser super-herói. Ou precisa? 🦸 (Pergunta honesta!)' },
  { icon:'😄', cat:'humor', msg:'Hoje pode rolar qualquer coisa. Mas seja lá o que vier, você vai lidar com estilo. 😎' },
  { icon:'😄', cat:'humor', msg:'Flor bonita + atendimento incrível + você = equação que não tem resposta errada!' },
  { icon:'😄', cat:'humor', msg:'Você tem tantos talentos que às vezes eles esperam fila para aparecer. Hoje deixa a fila avançar! 😄' },
  { icon:'😄', cat:'humor', msg:'Que dia lindo para arrasar! E se não estiver lindo onde você está: que dia lindo para fazer bonito mesmo assim!' },
  { icon:'😄', cat:'humor', msg:'Você não sabe o que vai acontecer hoje. Mas você sabe que consegue lidar com tudo. Isso é poder!' },
  { icon:'😄', cat:'humor', msg:'Alerta de alta performance detectado: você entrou no trabalho. O sistema já computou. 💻😄' },
  { icon:'😄', cat:'humor', msg:'Café, flor, sorriso. Triloga da produtividade floral. Você domina os três. 😄' },
  { icon:'😄', cat:'humor', msg:'Você vai se surpreender com o que consegue fazer quando está no seu melhor. Hoje, esteja no seu melhor!' },
  { icon:'😄', cat:'humor', msg:"Se flores pudessem falar, as da sua seção diriam: 'essa pessoa é especial!' 🌺 (Elas falam. Em linguagem floral.)" },
  { icon:'😄', cat:'humor', msg:'Você resolve problemas tão rápido que às vezes o problema nem tem tempo de virar problema! 💪😄' },
  { icon:'😄', cat:'humor', msg:'Dica de vendas do dia: fala com energia. Clientes compram o entusiasmo antes de comprar o produto!' },
  { icon:'😄', cat:'humor', msg:'Você tem superpoderes de empatia. Hoje, salva o dia de alguém com eles. Sem capa necessária! 🦸' },
  { icon:'😄', cat:'humor', msg:'O que te diferencia não é o que você sabe — é como você trata as pessoas. E você trata muito bem!' },
  { icon:'😄', cat:'humor', msg:'Hoje pode ser o dia que você vai contar para os netos. Faz bonito que o futuro tá olhando! 😄' },
  { icon:'😄', cat:'humor', msg:'Você tem nível de especialista em fazer o dia de alguém melhor. Especialidade comprovada no campo! 😁' },
  { icon:'😄', cat:'humor', msg:'A vida é curta demais para atendimento ruim. Você sabe disso — por isso atende tão bem. 🌸' },
  { icon:'😄', cat:'humor', msg:'Sorri. Não porque é obrigação — mas porque você tem muita coisa boa pela qual sorrir. Que lista grande!' },
  { icon:'😄', cat:'humor', msg:'Você chegou ao trabalho. As flores estão prontas. O time está aqui. Show pode começar! 🎭🌸' },
  { icon:'😄', cat:'humor', msg:'Você hoje: ☀️ + 💪 + ❤️ = Dia épico. Equação científica devidamente comprovada. 😂' },
  { icon:'😄', cat:'humor', msg:'Existe uma versão do seu dia que vai ser incrível. Ela começa com você decidindo que vai ser. Decide!' },
  { icon:'😄', cat:'humor', msg:'Você não vai desistir hoje. Nem amanhã. Nem depois. Porque não é do seu feitio. Isso é fato!' },
  { icon:'🌿', cat:'energia', msg:'Respira fundo. Hoje você vai lidar com gente, com flores e com beleza. Isso é privilégio!' },
  { icon:'🌿', cat:'energia', msg:'Beba água, respira, sorri. O resto vem naturalmente!' },
  { icon:'🌿', cat:'energia', msg:'Coloca aquela música que te anima e começa o dia no seu ritmo. Vai sair tudo certo!' },
  { icon:'🌿', cat:'energia', msg:'Um novo dia é uma nova chance de fazer diferente, melhor e mais bonito. Aproveita!' },
  { icon:'🌿', cat:'energia', msg:'Cada dia começa com possibilidades infinitas. Hoje você escolhe o que fazer com as suas.' },
  { icon:'🌿', cat:'energia', msg:'Cuidar do corpo é cuidar da mente. Hoje, faz uma coisa boa por você mesmo(a).' },
  { icon:'🌿', cat:'energia', msg:'A produtividade começa com o sono, a água e um pensamento positivo logo cedo. Check, check, check?' },
  { icon:'🌿', cat:'energia', msg:'O seu corpo é seu instrumento de trabalho. Cuida dele com carinho e ele te retribui com energia.' },
  { icon:'🌿', cat:'energia', msg:'Uma pausa bem feita rende mais do que uma hora de trabalho cansado. Faz pausas de verdade!' },
  { icon:'🌿', cat:'energia', msg:'Você dorme bem, você trabalha bem. Você come bem, você pensa bem. Cuida do básico!' },
  { icon:'🌿', cat:'energia', msg:'A saúde mental é tão importante quanto a física. Como você está de verdade hoje? Cuida-se!' },
  { icon:'🌿', cat:'energia', msg:'Dar uma volta curta no intervalo, tomar sol, respirar ar fresco — esses pequenos gestos renovam!' },
  { icon:'🌿', cat:'energia', msg:'Você não é máquina. E ainda assim produz como uma. O segredo é cuidar do ser humano por trás.' },
  { icon:'🌿', cat:'energia', msg:'Gratidão pela manhã prepara o cérebro para ver oportunidades ao longo do dia. Gratidão!' },
  { icon:'🌿', cat:'energia', msg:'Energia boa começa no pensamento. Você decide o tom do seu dia antes de sair de casa.' },
  { icon:'🌿', cat:'energia', msg:'Hidratação não é detalhe — é combustível. Bebe água antes de pegar no trabalho!' },
  { icon:'🌿', cat:'energia', msg:'Quando você cuida de você, todo mundo ao redor se beneficia. Cuide-se como investimento coletivo!' },
  { icon:'🌿', cat:'energia', msg:'Uma música boa no caminho pro trabalho tem poder de mudar completamente o humor. Escolha bem!' },
  { icon:'🌿', cat:'energia', msg:'O seu ritmo de trabalho é o seu. Não precisa imitar ninguém — precisa ser sustentável pra você.' },
  { icon:'🌿', cat:'energia', msg:'Mente descansada é mente criativa. Se está cansado(a), tira uma pausa breve e volta renovado(a)!' },
  { icon:'🌿', cat:'energia', msg:'Cinco minutos de silêncio antes de começar o trabalho prepara o cérebro melhor do que qualquer vitamina.' },
  { icon:'🌿', cat:'energia', msg:'Você tem energia suficiente para hoje. E se precisar de mais, você gera no caminho. É assim!' },
  { icon:'🌿', cat:'energia', msg:'Uma refeição boa no almoço é o presente que você se dá pela manhã do seu turno da tarde.' },
  { icon:'🌿', cat:'energia', msg:'Quando você está bem, o cliente sente. Quando o cliente sente, a venda acontece. Cuida de você!' },
  { icon:'🌿', cat:'energia', msg:'Você merece pausas. Merece almoço tranquilo. Merece momentos de leveza. Use seus direitos!' },
  { icon:'🌿', cat:'energia', msg:'A saúde é a base de tudo. Sem ela, não tem produtividade, meta ou sonho que funcione. Cuida!' },
  { icon:'🌿', cat:'energia', msg:'Sorrir libera endorfina. Então você hoje vai malhar sem sair do lugar. 😊💪' },
  { icon:'🌿', cat:'energia', msg:'Um pensamento positivo pela manhã é como regar a planta do dia. O resto do dia floresce!' },
  { icon:'🌿', cat:'energia', msg:'Você tem reservas de energia que ainda não usou. Quando precisar, elas vão aparecer. Confia!' },
  { icon:'🌿', cat:'energia', msg:'Descanso não é preguiça — é estratégia. Quem descansa bem, produz melhor. Descansa bem!' },
  { icon:'🌿', cat:'energia', msg:'Antes de começar, respira fundo três vezes. Não é frescura — é neurociência. Tenta!' },
  { icon:'🌿', cat:'energia', msg:'Você trata bem os outros. Hoje, trata bem a si mesmo(a) também. Com a mesma generosidade.' },
  { icon:'🌿', cat:'energia', msg:'A postura física afeta o estado mental. Fica ereto(a), ombros pra trás, queixo levantado. Sente a diferença!' },
  { icon:'🌿', cat:'energia', msg:'Uma boa risada ao dia mantém o médico afastado. Encontre a sua hoje!' },
  { icon:'🌿', cat:'energia', msg:'Organização traz paz. Uma hora de organização vale três de trabalho desorganizado. Organiza hoje!' },
  { icon:'🌿', cat:'energia', msg:'Você merece se sentir bem. No trabalho, em casa, no caminho. Merece tudo isso.' },
  { icon:'🌿', cat:'energia', msg:'Quando você tem energia, seu trabalho tem qualidade. Investe na sua energia como prioridade!' },
  { icon:'🌿', cat:'energia', msg:'Pequenas alegrias do dia: café quente, conversa boa, cliente satisfeito. Conta as suas hoje!' },
  { icon:'🌿', cat:'energia', msg:'A natureza é terapêutica. Você trabalha com flores — aproveita essa terapia disponível grátis todo dia!' },
  { icon:'🌿', cat:'energia', msg:'Movimento é vida. Se puder, vai andando, se puder, sobe escada. O corpo agradece!' },
  { icon:'🌿', cat:'energia', msg:'Uma mente positiva não ignora problemas — ela os enfrenta com mais recursos. Treina a mente hoje!' },
  { icon:'🌿', cat:'energia', msg:'Você tem um nível de energia que é seu dom natural. Alimenta ele com boas escolhas todos os dias.' },
  { icon:'🌿', cat:'energia', msg:'Desligar do trabalho quando sai é essencial. O trabalho esperará por você amanhã. Descansa hoje!' },
  { icon:'🌿', cat:'energia', msg:'Conexão com a natureza (flores no caso de vocês!) tem efeito comprovado na saúde mental. Aproveita!' },
  { icon:'🌿', cat:'energia', msg:'Foco se treina. Hoje, escolha uma tarefa por vez e entrega total nela. Veja o resultado!' },
  { icon:'🌿', cat:'energia', msg:'Você merece mais do que sobreviver os dias — merece viver cada um. Hoje, vive com presença!' },
  { icon:'🌿', cat:'energia', msg:'A sua mente, quando descansada, produz soluções criativas que a mente cansada não vê. Cuida dela!' },
  { icon:'🌿', cat:'energia', msg:'Ambiente organizado = mente organizada. Cinco minutos arrumando o espaço valem muito.' },
  { icon:'🌿', cat:'energia', msg:'Um projeto de autocuidado não é luxo — é necessidade. Qual o seu autocuidado hoje?' },
  { icon:'🌿', cat:'energia', msg:'Você tem um corpo que funciona, uma mente que pensa e um coração que sente. Que riqueza!' },
  { icon:'🌿', cat:'energia', msg:'O bem-estar físico e mental são os pilares de tudo mais. Que seus pilares estejam fortes hoje!' },
  { icon:'🌿', cat:'energia', msg:'Hoje você vai notar pelo menos uma coisa bonita que normalmente passa despercebida. Esteja atento(a)!' },
  { icon:'🌿', cat:'energia', msg:'Cada respiração consciente é um reset mental disponível a qualquer momento. Usa quando precisar!' },
  { icon:'🌿', cat:'energia', msg:'Você tem saúde, trabalho e propósito. Já tem o trio que muitos buscam. Que gratidão!' },
  { icon:'🌿', cat:'energia', msg:'Cuide do seu sono — ele é quem paga as contas da energia do dia seguinte. Dorme bem!' },
  { icon:'🌿', cat:'energia', msg:'A hidratação afeta o humor, a concentração e a energia. Bebe aquela água que você está devendo! 💧' },
  { icon:'🌿', cat:'energia', msg:'Uma boa playlist de trabalho é a diferença entre um dia neutro e um dia produtivo. Cuida da trilha!' },
  { icon:'🌿', cat:'energia', msg:'Você não precisa de uma vida perfeita para ter um dia bom. Só precisa de uma decisão boa.' },
  { icon:'🌿', cat:'energia', msg:'A energia que você coloca no início do dia define o tom do restante. Coloca boa energia agora!' },
  { icon:'🌿', cat:'energia', msg:'Trabalho não é vida — é parte dela. A parte mais bonita é quando o trabalho tem sentido. O seu tem!' },
  { icon:'🌿', cat:'energia', msg:'Você tem a capacidade de se renovar a cada dia. É um superpoder raramente reconhecido.' },
  { icon:'🌿', cat:'energia', msg:'Quando o dia pesa, uma pausa com uma respiração profunda resolve mais do que parece.' },
  { icon:'🌿', cat:'energia', msg:'A qualidade da sua presença vale mais do que a quantidade das suas horas. Esteja presente!' },
  { icon:'🌿', cat:'energia', msg:'Mindfulness não é moda — é sobrevivência mental no mundo atual. Tenta estar no momento hoje!' },
  { icon:'🌿', cat:'energia', msg:'Você funciona melhor quando bem alimentado(a), hidratado(a) e com propósito. Os três hoje!' },
  { icon:'🌿', cat:'energia', msg:"Cada manhã tem um recado: 'você tem um novo dia'. Ouça esse recado e aproveite!" },
  { icon:'🌿', cat:'energia', msg:'Sua saúde é o seu maior patrimônio. Cuida dela com o mesmo empenho que cuida do trabalho.' },
  { icon:'🌿', cat:'energia', msg:'Bem-estar não é destino — é prática diária. Pratica um gesto de bem-estar hoje!' },
  { icon:'🌿', cat:'energia', msg:'Você merece sentir-se pleno(a) e realizado(a). Hoje, dê um passo em direção a isso.' },
  { icon:'🌿', cat:'energia', msg:'Seu coração e sua mente trabalhando juntos são imbatíveis. Quando estão alinhados, nada para você!' },
  { icon:'🌿', cat:'energia', msg:'A gratidão é o termostato da felicidade. Regula o dela para o alto hoje!' },
  { icon:'🌿', cat:'energia', msg:'Você tem mais recursos internos do que qualquer ferramenta externa. Acessa esses recursos hoje!' },
  { icon:'🌿', cat:'energia', msg:'Cada escolha saudável é um voto pelo seu futuro mais pleno. Vote bem hoje!' },
  { icon:'🌿', cat:'energia', msg:'O seu dia vai ser tão bom quanto você decidir que vai ser. Decide logo — com convicção!' },
  { icon:'🌿', cat:'energia', msg:'Você tem uma vida rica de relações, propósito e trabalho. Que riqueza real! Aprecia cada camada.' },
  { icon:'🌿', cat:'energia', msg:'Levantou, respirou, vai trabalhar — já foi mais do que muitos conseguem fazer. Parabéns pela presença!' },
  { icon:'🌿', cat:'energia', msg:'A saúde mental começa na maneira que você fala consigo mesmo(a). Fala bem de você hoje!' },
  { icon:'🌿', cat:'energia', msg:'Cada momento de descanso é um investimento na qualidade do trabalho que vem depois. Descansa bem!' },
  { icon:'🍽️', cat:'comida', msg:'A vida sem comida boa seria como floricultura sem flores. Sem graça! Que seu almoço hoje seja especial! 🍽️' },
  { icon:'🍽️', cat:'comida', msg:'Produtividade dica nº1: nunca trabalhe com fome. Café da manhã é sagrado! ☕🍞' },
  { icon:'🍽️', cat:'comida', msg:'Um bom almoço recarrega mais do que qualquer motivação. Almoça direito hoje!' },
  { icon:'🍽️', cat:'comida', msg:'Flores e comida têm algo em comum: os dois ficam melhores quando feitos com amor. 🌸🍝' },
  { icon:'🍽️', cat:'comida', msg:'O cheiro de comida boa no ar é quase tão bom quanto o cheiro de flores frescas. Quase! 😄🌺' },
  { icon:'🍽️', cat:'comida', msg:'Comer junto é um ato de comunidade. Se puder almoçar com a equipe hoje, aproveita esse momento!' },
  { icon:'🍽️', cat:'comida', msg:'A comida caseira da mãe tem um poder que nenhum restaurante reproduz. Se tem hoje, é dia de sorte!' },
  { icon:'🍽️', cat:'comida', msg:'Um bom café da manhã é a fundação de uma tarde produtiva. Construa bem a fundação!' },
  { icon:'🍽️', cat:'comida', msg:'Flores fazem o ambiente bonito. Comida gostosa faz o intervalo feliz. Os dois hoje! 🌷🍕' },
  { icon:'🍽️', cat:'comida', msg:'Tem coisa melhor do que aquela comida que você ama no final de um dia bem trabalhado? 🍜' },
  { icon:'🍽️', cat:'comida', msg:'O lanche da tarde é subestimado. Ele sustenta você na reta final do dia. Não pula o lanche!' },
  { icon:'🍽️', cat:'comida', msg:'Uma refeição feita com cuidado é um ato de amor. Seja por você mesmo(a) hoje!' },
  { icon:'🍽️', cat:'comida', msg:'Comida é cultura, é afeto, é história. O prato favorito da sua família carrega toda uma herança.' },
  { icon:'🍽️', cat:'comida', msg:'O melhor tempero de qualquer refeição é a fome de quem a come. Que seu almoço seja delicioso!' },
  { icon:'🍽️', cat:'comida', msg:'Dica profissional: nunca negocie com o estômago vazio. Nem com cliente, nem com chefe! 😄' },
  { icon:'🍽️', cat:'comida', msg:'Aquela comidinha que dá conforto emocional? Você merece ela hoje. Nada de culpa!' },
  { icon:'🍽️', cat:'comida', msg:'Uma mesa farta compartilhada com amigos é o paraíso na Terra. Que você tenha isso em breve!' },
  { icon:'🍽️', cat:'comida', msg:'O cafezinho da pausa é o ritual que mantém a equipe conectada. Participa com alegria!' },
  { icon:'🍽️', cat:'comida', msg:'Comida boa = humor bom = atendimento bom = cliente feliz. Equação completa! 🍽️' },
  { icon:'🍽️', cat:'comida', msg:'Trabalhar de barriga cheia é diferente de trabalhar de barriga vazia. O estômago é sócio do cérebro!' },
  { icon:'🍽️', cat:'comida', msg:'Aquela comida que faz você fechar os olhos e suspirar? Você merece ela como recompensa hoje! 😋' },
  { icon:'🍽️', cat:'comida', msg:'A sobremesa é o prêmio de quem almoçou direito. Você vai merecer hoje!' },
  { icon:'🍽️', cat:'comida', msg:'Cheiro de comida boa é uma das memórias mais fortes que existem. Que você crie uma boa hoje!' },
  { icon:'🍽️', cat:'comida', msg:'A culinária brasileira é patrimônio. E você tem acesso a ela todo dia. Que privilégio gostoso! 🇧🇷' },
  { icon:'🍽️', cat:'comida', msg:'Comer com calma no intervalo é um ato de respeito a si mesmo(a). Faz isso hoje!' },
  { icon:'🍽️', cat:'comida', msg:'Flores no ambiente + comida boa no almoço = tarde de rainha/rei. Você merece essa combinação! 🌸🍴' },
  { icon:'🍽️', cat:'comida', msg:'Um bolo caseiro inesperado no trabalho é uma das melhores surpresas da vida. Que apareça uma hoje!' },
  { icon:'🍽️', cat:'comida', msg:'Hidratação é alimento também. Bebe água, chá, suco — o que preferir. Alimenta a máquina!' },
  { icon:'🍽️', cat:'comida', msg:'Comida do Nordeste, do Sul, do Sudeste — o Brasil inteiro tem uma delícia te esperando. Descobre! 🗺️🍽️' },
  { icon:'🍽️', cat:'comida', msg:'O almoço em paz, sem celular, é uma experiência de spa gratuita. Tenta hoje! 📵🍝' },
  { icon:'🍽️', cat:'comida', msg:'Você trabalha com beleza todos os dias. Que sua comida de hoje seja igualmente bonita e gostosa!' },
  { icon:'🍽️', cat:'comida', msg:'Manga, abacaxi, maracujá... a natureza abençoou o Brasil com sabores incríveis. Aprecia hoje! 🥭' },
  { icon:'🍽️', cat:'comida', msg:'Aquele prato que cheira bem antes mesmo de chegar à mesa já é metade da satisfação. Que tenha hoje!' },
  { icon:'🍽️', cat:'comida', msg:'Café + biscoito no meio da tarde é tradição brasileira que não tem equivalente no mundo. 🍪☕' },
  { icon:'🍽️', cat:'comida', msg:'Uma boa conversa durante o almoço digere junto com a comida e alimenta a alma.' },
  { icon:'🍽️', cat:'comida', msg:'O arroz com feijão brasileiro tem poderes que a nutrição ainda não conseguiu explicar completamente. 🍚' },
  { icon:'🍽️', cat:'comida', msg:'Trabalho bom pede recompensa boa. Pode ser a comida favorita no almoço. Você merece hoje!' },
  { icon:'🍽️', cat:'comida', msg:'A gratidão começa pelo prato à frente. Nem todo mundo tem o que você tem. Aprecia com coração!' },
  { icon:'🍽️', cat:'comida', msg:'Comer em companhia alegre faz qualquer refeição mais saborosa. Que tenha isso hoje!' },
  { icon:'🍽️', cat:'comida', msg:'O intervalo existe para isso: recarregar corpo e mente. Não pula — faz ele de verdade!' },
  { icon:'🍽️', cat:'comida', msg:'Uma colherada de comida boa é um minuto de felicidade garantida. Que tenha muitas hoje! 🥄' },
  { icon:'🍽️', cat:'comida', msg:'Fruta da estação é presente da natureza embrulhado em cor e sabor. Que você aprecie uma hoje! 🍓' },
  { icon:'🍽️', cat:'comida', msg:'O bom de trabalhar em floricultura: você sabe que até o visual do espaço onde come é bonito! 🌺' },
  { icon:'🍽️', cat:'comida', msg:'Comida que a avó faz tem um nível de amor que nenhuma receita consegue replicar. Que saudade boa!' },
  { icon:'🍽️', cat:'comida', msg:'Se hoje tiver aquela comidinha especial no almoço, tira uma foto — memória boa merece registro! 📸' },
  { icon:'🍽️', cat:'comida', msg:'O olfato é o sentido mais ligado à memória. Um cheiro bom de comida hoje vai durar anos. Aprecia!' },
  { icon:'🍽️', cat:'comida', msg:'Você que trabalha com flores sabe: apresentação importa. A da comida também! Come o belo quando puder.' },
  { icon:'🍽️', cat:'comida', msg:'Um dia pode começar difícil e acabar em uma mesa boa com quem você gosta. Que assim seja!' },
  { icon:'🍽️', cat:'comida', msg:'Comida gostosa + música boa + descanso = a receita do recarregamento total. Que tenha isso hoje!' },
  { icon:'🍽️', cat:'comida', msg:'A vida é boa quando tem flores no trabalho e comida boa em casa. Você tem os dois. Que vida boa!' },
  { icon:'🌟', cat:'especial', msg:'Sabia que colaboradores felizes vendem mais? Então sorria — é estratégia de negócio! 😄' },
  { icon:'🌟', cat:'especial', msg:'Você faz parte de algo bonito: levar flores e alegria para pessoas que estão comemorando a vida.' },
  { icon:'🌟', cat:'especial', msg:'Hoje pode ser o dia que um cliente lembra pra sempre. E você faz parte desse momento.' },
  { icon:'🌟', cat:'especial', msg:'Sem capa, sem máscara — mas com muito talento! Você é o(a) herói(a) do dia aqui.' },
  { icon:'🌟', cat:'especial', msg:'Se hoje for difícil, lembre: flores crescem mesmo com espinhos. E você também.' },
  { icon:'🌟', cat:'especial', msg:'Nada do que você constrói hoje com dedicação será em vão. O futuro vai te agradecer.' },
  { icon:'🌟', cat:'especial', msg:'Você tem um propósito maior do que percebe. Às vezes ele aparece de maneira singela — como uma flor entregue.' },
  { icon:'🌟', cat:'especial', msg:'O que você faz com amor deixa rastro. Hoje, deixe um rastro bonito por onde passar.' },
  { icon:'🌟', cat:'especial', msg:'Você não precisa de condições ideais para dar o seu melhor. Você dá o seu melhor em qualquer condição.' },
  { icon:'🌟', cat:'especial', msg:'A sua trajetória é única — não tem igual. Valorize cada detalhe dela, incluindo hoje.' },
  { icon:'🌟', cat:'especial', msg:"Cada 'obrigado' que você recebe é a confirmação de que o que você faz tem valor real." },
  { icon:'🌟', cat:'especial', msg:'Você já está vivendo uma das melhores fases da sua vida profissional. Percebe? Aprecia!' },
  { icon:'🌟', cat:'especial', msg:'Poucas pessoas têm o privilégio de trabalhar com algo que tem significado. Você tem. Não subestime!' },
  { icon:'🌟', cat:'especial', msg:'Hoje você vai descobrir que tem mais capacidade do que imaginava. Isso vai acontecer.' },
  { icon:'🌟', cat:'especial', msg:'A excelência não é destino — é hábito diário. Você está construindo o hábito. Continua!' },
  { icon:'🌟', cat:'especial', msg:'Você não é só mais um(a) funcionário(a) — você é a diferença entre uma loja comum e uma loja especial.' },
  { icon:'🌟', cat:'especial', msg:'Seu trabalho importa. As flores importam. O sorriso do cliente importa. Tudo tem valor real.' },
  { icon:'🌟', cat:'especial', msg:'Um dia de trabalho bem feito é uma obra de arte que não vai museu mas que fica na memória de quem tocou.' },
  { icon:'🌟', cat:'especial', msg:'Você tem talento que às vezes a própria rotina esconde. Hoje, deixa o talento aparecer!' },
  { icon:'🌟', cat:'especial', msg:'Cada desafio que você enfrenta te torna mais competente. Hoje o desafio te torna melhor!' },
  { icon:'🌟', cat:'especial', msg:'Você está contribuindo para algo muito maior do que você percebe no dia a dia. Acredita nisso!' },
  { icon:'🌟', cat:'especial', msg:'O mundo fica um pouco melhor quando você está nele sendo você. Hoje, seja muito você!' },
  { icon:'🌟', cat:'especial', msg:'Você tem uma história de superação que muitos não verão. Mas você a carrega com dignidade.' },
  { icon:'🌟', cat:'especial', msg:'Hoje não é só mais um dia — é o dia que você decide dar o próximo passo. Dá!' },
  { icon:'🌟', cat:'especial', msg:'O que você planta no trabalho em forma de qualidade, você colhe em forma de reconhecimento.' },
  { icon:'🌟', cat:'especial', msg:'Você trabalha com o que tem, não com o que falta. E com o que tem, você faz muito!' },
  { icon:'🌟', cat:'especial', msg:'Persistência é a diferença entre quem consegue e quem desiste a um passo do resultado. Persiste!' },
  { icon:'🌟', cat:'especial', msg:'Você tem um dom — nem sempre fácil de ver, mas sempre presente. Qual é o seu dom hoje?' },
  { icon:'🌟', cat:'especial', msg:'O progresso que você faz em silêncio é mais poderoso do que o barulho que outros fazem sem fazer.' },
  { icon:'🌟', cat:'especial', msg:'Você está no lugar certo, na hora certa, com as pessoas certas. Acredita no timing da sua vida!' },
  { icon:'🌟', cat:'especial', msg:'Uma atitude positiva não resolve todos os problemas — mas faz de você alguém mais resiliente para eles.' },
  { icon:'🌟', cat:'especial', msg:'Cada manhã que você decide não desistir é uma vitória que merece celebração. Celebra hoje!' },
  { icon:'🌟', cat:'especial', msg:'Você tem o poder de influenciar positivamente cada pessoa que encontrar hoje. Use esse poder!' },
  { icon:'🌟', cat:'especial', msg:'Trabalhar com propósito transforma qualquer tarefa em missão. Qual é a sua missão hoje?' },
  { icon:'🌟', cat:'especial', msg:'Você tem consistência — aparece todo dia, dá o seu melhor todo dia. Isso é ouro puro!' },
  { icon:'🌟', cat:'especial', msg:'O que você aprende hoje é o que vai te proteger amanhã. Aprende com tudo que acontecer!' },
  { icon:'🌟', cat:'especial', msg:'Você não precisa ser lembrado(a) por todos — precisa fazer diferença para os que importam. Faz!' },
  { icon:'🌟', cat:'especial', msg:'Cada pedido que você entrega com cuidado é uma promessa cumprida. Cumpra muitas hoje!' },
  { icon:'🌟', cat:'especial', msg:'Você tem visão — sabe o que quer e como chegar lá. Hoje, dá mais um passo nessa direção!' },
  { icon:'🌟', cat:'especial', msg:'A sua dedicação não passa despercebida. Mesmo que ninguém diga, é vista e reconhecida.' },
  { icon:'🌟', cat:'especial', msg:'Você inspira confiança — nas pessoas que te conhecem, nos clientes que te atendem. Que dom!' },
  { icon:'🌟', cat:'especial', msg:'Cada dificuldade hoje é matéria-prima de sabedoria amanhã. Coleta essa matéria com cuidado!' },
  { icon:'🌟', cat:'especial', msg:'Você tem uma força interior que nem você mesmo(a) conhece por completo ainda. Hoje ela vai aparecer!' },
  { icon:'🌟', cat:'especial', msg:'O caminho para o sucesso é pavimentado com dias como este — em que você aparece e dá o máximo.' },
  { icon:'🌟', cat:'especial', msg:'Você é a solução para muitas situações que ainda vão chegar hoje. Fica pronto(a)!' },
  { icon:'🌟', cat:'especial', msg:'A sua entrega ao trabalho tem um valor que vai além do salário. É um valor de caráter.' },
  { icon:'🌟', cat:'especial', msg:'Hoje você vai ser parte de algo que importa — para um cliente, para a equipe, para a empresa.' },
  { icon:'🌟', cat:'especial', msg:'Profissional comprometido(a) + produto de qualidade + atendimento com amor = sucesso inevitável.' },
  { icon:'🌟', cat:'especial', msg:'Você não está correndo atrás do mercado — você está criando o seu espaço nele. Que postura!' },
  { icon:'🌟', cat:'especial', msg:'Cada pessoa que passa por você hoje vai de alguma forma melhor. Você tem esse efeito.' },
  { icon:'🌟', cat:'especial', msg:'O crescimento real acontece quando você continua mesmo sem vontade. Que bom que você continua!' },
  { icon:'🌟', cat:'especial', msg:'Você tem credibilidade construída com trabalho honesto. Isso vale mais que qualquer título.' },
  { icon:'🌟', cat:'especial', msg:'Hoje pode ser o dia em que você percebe que chegou mais longe do que imaginava. Olha pra trás!' },
  { icon:'🌟', cat:'especial', msg:'Você carrega expertise que foi construída com tempo, erros e acertos. É um tesouro real.' },
  { icon:'🌟', cat:'especial', msg:'A sua capacidade de resolver problemas é maior do que a capacidade que os problemas têm de te parar.' },
  { icon:'🌟', cat:'especial', msg:'Confiança no trabalho se constrói entrega por entrega, dia por dia. Você está construindo a sua!' },
  { icon:'🌟', cat:'especial', msg:'Você não trabalha por obrigação — trabalha por propósito. E isso faz toda a diferença.' },
  { icon:'🌟', cat:'especial', msg:'Seu legado profissional é construído com os dias como este. Cada detalhe conta. Cuida dos detalhes!' },
  { icon:'🌟', cat:'especial', msg:'Você importa mais do que os números que mostram. O impacto humano não entra em planilha.' },
  { icon:'🌟', cat:'especial', msg:'Uma pessoa que dá o seu melhor todos os dias nunca sai de mãos vazias. Você vai colher muito!' },
  { icon:'🌟', cat:'especial', msg:'O que você faz com excelência hoje se torna o padrão de amanhã. Eleva o padrão!' },
  { icon:'🌟', cat:'especial', msg:'Você tem a capacidade de transformar obstáculos em trampolins. Hoje, usa o obstáculo para subir!' },
  { icon:'🌟', cat:'especial', msg:'Cada pedido de flor que você processa representa um momento importante na vida de alguém. Que peso bonito!' },
  { icon:'🌟', cat:'especial', msg:'Você tem instinto profissional afinado. Quando algo não está certo, você percebe. Confia nesse instinto!' },
  { icon:'🌟', cat:'especial', msg:'O sucesso não é linear. Tem dias altos, dias baixos. O que importa é a direção. A sua é boa!' },
  { icon:'🌟', cat:'especial', msg:'Você é um(a) profissional completo(a) — sabe o produto, conhece o cliente e ama o que faz.' },
  { icon:'🌟', cat:'especial', msg:'Nada que você construiu até aqui foi por acaso. Foi por escolhas, por esforço, por você.' },
  { icon:'🌟', cat:'especial', msg:'Hoje você vai fazer pelo menos uma coisa que vai te orgulhar ao final do dia. Prepara!' },
  { icon:'🌟', cat:'especial', msg:'A sua dedicação tem peso e tem valor. Mesmo que ninguém veja, você sente — e isso é o que importa.' },
  { icon:'🌟', cat:'especial', msg:'Você está em constante evolução — só às vezes a rotina esconde isso de você. Olha de longe e vê!' },
  { icon:'🌟', cat:'especial', msg:'Uma pessoa com o seu talento e o seu coração é rara. O mundo precisa de mais de você.' },
  { icon:'🌟', cat:'especial', msg:'Sua competência profissional cresceu muito. Reconhece isso e celebra. Você merece!' },
  { icon:'🌟', cat:'especial', msg:'Cada dia bem trabalhado vai virando base sólida para o amanhã. Você está construindo base hoje!' },
  { icon:'🌟', cat:'especial', msg:'O tempo que você investe em qualidade se paga em dobro, triplo, com juros compostos de reconhecimento.' },
  { icon:'🌟', cat:'especial', msg:'Você tem uma forma de fazer as coisas que é completamente sua. Não troque por nada.' },
  { icon:'🌟', cat:'especial', msg:'Hoje pode surgir uma oportunidade disfarçada de problema. Você tem o olhar de quem reconhece oportunidades.' },
  { icon:'🌟', cat:'especial', msg:'A fidelidade ao que você acredita no trabalho é a sua assinatura. Que assinatura bonita!' },
  { icon:'🌟', cat:'especial', msg:'Você trabalha em uma área que tem alma. E você coloca mais alma ainda. Que combinação!' },
  { icon:'🌟', cat:'especial', msg:'Seu trabalho hoje vai criar ondas que você não vai ver. Mas elas vão existir. Causa essas ondas!' },
  { icon:'🌟', cat:'especial', msg:'Cada cliente bem atendido hoje é uma semente de confiança que brota como fidelidade amanhã.' },
  { icon:'🌟', cat:'especial', msg:'Você tem uma consistência que inspira confiança — na empresa, na equipe, nos clientes.' },
  { icon:'🌟', cat:'especial', msg:'A excelência que você pratica vai se transformar em reconhecimento. Continua praticando!' },
  { icon:'🌟', cat:'especial', msg:'Você é alguém que aparece. Isso é mais raro do que parece. Que valor você tem só por isso!' },
  { icon:'🌟', cat:'especial', msg:"Hoje você vai deixar alguém com aquele sorriso de 'fui bem atendido(a)'. Planta esse sorriso!" },
  { icon:'🌟', cat:'especial', msg:'O que distingue os grandes profissionais não é talento — é consistência. Você tem consistência!' },
  { icon:'🌟', cat:'especial', msg:'Você não desiste. Essa é a qualidade mais rara e mais valiosa que um profissional pode ter.' },
  { icon:'🌟', cat:'especial', msg:'Seu esforço silencioso tem um testemunho barulhento nos resultados que aparecem com o tempo.' },
  { icon:'🌟', cat:'especial', msg:'Hoje é uma oportunidade para provar (a você mesmo(a)) que é capaz. E você vai provar. É certo!' },
  { icon:'🌟', cat:'especial', msg:'Você é o tipo de profissional que as empresas tentam encontrar e os clientes tentam manter. Que valor!' },
  { icon:'🌟', cat:'especial', msg:'Flores precisam de atenção constante para manter a beleza. Igual o seu desenvolvimento profissional. Atenção!' },
  { icon:'🌟', cat:'especial', msg:'Você tem o dom de transformar o comum em especial. Aplica esse dom em tudo que fizer hoje!' },
  { icon:'🌟', cat:'especial', msg:'O aprendizado não para. E você, que aprende todo dia, está sempre à frente. Continua aprendendo!' },
  { icon:'🌟', cat:'especial', msg:'Você tem prontidão — quando chamado(a), está lá. Quando precisa agir, age. Que profissional!' },
  { icon:'🌟', cat:'especial', msg:'Hoje, de manhã, você tinha a chance de dar o melhor. Agora você tem. Amanhã vai ter de novo. Dá sempre!' },
  { icon:'🌟', cat:'especial', msg:'O que você faz bem é o resultado de anos de dedicação. Reconhece esse trabalho como seu.' },
  { icon:'🌟', cat:'especial', msg:'Você tem a habilidade rara de ser técnico(a) e humano(a) ao mesmo tempo. É a combinação perfeita!' },
  { icon:'🌟', cat:'especial', msg:'Sua motivação hoje vem de dentro — ela é sua, ela é genuína, ela é a mais poderosa que existe!' },
  { icon:'🌟', cat:'especial', msg:'Você trabalha em algo que faz a diferença. Você faz diferença. Hoje, faça diferença de novo!' },
  { icon:'🌟', cat:'especial', msg:'O profissional que você é hoje é o sonho do iniciante que você foi. Celebra essa conquista!' },
  { icon:'🌟', cat:'especial', msg:'Você tem a sorte de trabalhar com o que tem significado. Não subestime esse privilégio hoje!' },
  { icon:'🌟', cat:'especial', msg:'Cada ação pequena com excelência hoje constrói o grande resultado de amanhã. Não subestime o pequeno!' },
  { icon:'🌟', cat:'especial', msg:'Você é parte do que faz essa empresa especial. Sem você, seria diferente — e certamente seria menos.' },
  { icon:'🌟', cat:'especial', msg:'Hoje a versão mais corajosa de você vai aparecer. Espera por ela — e quando chegar, abraça!' },
  { icon:'🌟', cat:'especial', msg:'Você transforma trabalho em arte quando coloca coração no que faz. Coloca coração hoje!' },
  { icon:'🌟', cat:'especial', msg:'Sua presença hoje já torna o dia melhor. Imagine quando você se empenhar de verdade. Vai ser incrível!' },
  { icon:'🌟', cat:'especial', msg:'Você tem raízes fortes — de valores, de caráter, de propósito. Essas raízes não balançam com vento.' },
  { icon:'🌟', cat:'especial', msg:'O profissional que aprende dos erros cresce onde o que ignora os erros estagna. Você aprende sempre!' },
  { icon:'🌟', cat:'especial', msg:'Cada dia que você mantém a qualidade do trabalho é um dia em que você confirma quem você é. Que identidade!' },
  { icon:'🌟', cat:'especial', msg:'Você tem clareza sobre o que quer. Isso é mais raro e mais poderoso do que qualquer habilidade técnica.' },
  { icon:'🌟', cat:'especial', msg:'Hoje você vai fazer o que precisa ser feito — mesmo sem vontade, mesmo com dificuldade. Porque é você!' },
  { icon:'🌟', cat:'especial', msg:'Seu melhor trabalho ainda está por vir. Você está se preparando para ele a cada dia. Continue!' },
  { icon:'🌟', cat:'especial', msg:'Você é a razão pela qual a equipe funciona bem. Sem você, faltaria um ingrediente essencial.' },
  { icon:'🌟', cat:'especial', msg:'O impacto que você tem na vida das pessoas passa pela porta da loja todos os dias. Que responsabilidade linda!' },
  { icon:'🌟', cat:'especial', msg:'Você carrega o compromisso de ser bom(a) no que faz. E esse compromisso te diferencia de quase todo mundo.' },
  { icon:'🌟', cat:'especial', msg:'Hoje é mais um passo numa jornada longa e bonita. Cada passo importa — especialmente este!' },
  { icon:'💎', cat:'autoestima', msg:'Você vale muito mais do que o cargo que ocupa ou o salário que recebe. Seu valor é humano e é imenso.' },
  { icon:'🌠', cat:'autoestima', msg:'Talentos escondidos são desperdícios. Mostra o que você tem hoje — o mundo precisa ver!' },
  { icon:'🦅', cat:'autoestima', msg:'Águia não se preocupa com galinha. E você não precisa se comparar com quem não tem sua visão!' },
  { icon:'🌱', cat:'autoestima', msg:'Você está em crescimento constante. Às vezes é lento, mas é real. Confia no processo!' },
  { icon:'⚡', cat:'autoestima', msg:'Você tem uma faísca que, quando se acende, ilumina tudo ao redor. Acende hoje!' },
  { icon:'🎯', cat:'autoestima', msg:'Foco no que você pode controlar. O resto solta. Assim você libera energia para o que importa!' },
  { icon:'🏅', cat:'autoestima', msg:'Você merece reconhecimento — e se não vem de fora, vem de dentro. Reconhece você mesmo(a)!' },
  { icon:'🌊', cat:'autoestima', msg:'Flexibilidade não é fraqueza. É você se adaptando sem perder a essência. Você tem isso!' },
  { icon:'🔑', cat:'autoestima', msg:'A chave para o seu próximo nível está em você. Você já tem tudo — só falta usar!' },
  { icon:'💫', cat:'autoestima', msg:'Hoje pode ser o dia em que tudo muda — por uma palavra, uma decisão, uma ação. Age!' },
  { icon:'✨', cat:'fe', msg:'Cada novo amanhecer é a graça de Deus se renovando sobre a sua vida. Recebe com alegria!' },
  { icon:'🕊️', cat:'fe', msg:'Que a paz de Deus que excede todo entendimento guarde o seu coração hoje!' },
  { icon:'🌟', cat:'fe', msg:'Você foi criado(a) à imagem e semelhança de algo grandioso. Viva na altura disso!' },
  { icon:'🙌', cat:'fe', msg:'Deus é fiel. Ontem, hoje e sempre. Nas vendas, na vida, em tudo. Confia!' },
  { icon:'📖', cat:'fe', msg:'O trabalho honesto é oração em ação. Hoje, ore com as suas mãos e os seus pés!' },
  { icon:'🌈', cat:'fe', msg:'Depois da chuva mais forte, vem o arco-íris mais belo. Você está no final do temporal!' },
  { icon:'🕯️', cat:'fe', msg:'Uma vela não perde nada ao acender outra. Compartilha sua luz hoje!' },
  { icon:'🌺', cat:'fe', msg:'Deus planta flores em desertos. Imagine o que Ele pode fazer com a sua vida fértil!' },
  { icon:'🤲', cat:'fe', msg:'Quando você não souber o caminho, para, respira, pede direção e confia. A resposta vem!' },
  { icon:'⭐', cat:'fe', msg:'Você foi escolhido(a) para estar aqui, agora, nesse trabalho. Não é coincidência!' },
  { icon:'🎸', cat:'equipe', msg:'O time é a banda. Cada um tem seu instrumento. Junto, tocam algo lindo. Toca bem hoje!' },
  { icon:'🏗️', cat:'equipe', msg:'Cada um constrói o seu pedaço. Juntos, constroem algo maior. O que você vai construir hoje?' },
  { icon:'🌻', cat:'equipe', msg:'Girassol se vira para a luz. Quando alguém da equipe está pra baixo, é você quem traz a luz!' },
  { icon:'🤜', cat:'equipe', msg:'Um time que se cobre é imbatível. Cobre seu colega hoje — ele vai cobrir você amanhã!' },
  { icon:'🎭', cat:'equipe', msg:'Cada pessoa da equipe tem um papel único que ninguém mais pode fazer igual. Que elenco incrível!' },
  { icon:'🔗', cat:'equipe', msg:'A corrente é tão forte quanto o elo mais comprometido. Seja o elo mais forte hoje!' },
  { icon:'🌐', cat:'equipe', msg:'Diversidade de perspectivas cria soluções melhores. Que a equipe use isso hoje!' },
  { icon:'🎊', cat:'equipe', msg:'Comemorar junto os acertos da equipe é combustível para o próximo ciclo. Celebra muito!' },
  { icon:'🛡️', cat:'equipe', msg:'Um time que protege os seus membros é um time que ninguém consegue parar!' },
  { icon:'🌴', cat:'equipe', msg:'Palma dobra no vento mas não quebra. A equipe faz o mesmo — juntos resistem a qualquer vento!' },
  { icon:'🎪', cat:'humor', msg:'Você é o tipo de pessoa que transforma qualquer dia em show. Abre o telão hoje! 🎪' },
  { icon:'🦄', cat:'humor', msg:'Você é raro(a) como unicórnio em floricultura — único(a), especial e claramente mágico(a)! 🦄' },
  { icon:'🎲', cat:'humor', msg:'A vida é um jogo, e você sempre joga com a mão mais inteligente. Hoje não vai ser diferente! 🎲' },
  { icon:'🌝', cat:'humor', msg:'Alerta de lua cheia? Não, é a sua energia positiva que deixa todo mundo assim. 🌝' },
  { icon:'🎩', cat:'humor', msg:'Você tem um talento que não tem em nenhum chapéu mágico: transforma problemas em soluções! 🎩' },
  { icon:'🚀', cat:'humor', msg:'Produtividade nível: astronauta. Destino: meta batida. Combustível: café e vontade. Decola! 🚀' },
  { icon:'🦁', cat:'humor', msg:'Você tem um lado leão que aparece quando precisa. Hoje pode ser o dia de rugir! 🦁😄' },
  { icon:'🎯', cat:'humor', msg:'Sua pontaria profissional hoje está no nível: acerta até de olho fechado. Mas abre os olhos! 🎯' },
  { icon:'🌊', cat:'humor', msg:'Você surfou ondas maiores que essa. Pega a prancha e vai! 🏄 (Metaforicamente, claro.)' },
  { icon:'🏆', cat:'humor', msg:'Você não ganhou a copa — você é a copa. A equipe inteira te carrega! 🏆😄' },
  { icon:'🎁', cat:'vendas', msg:'O cliente não sabe o que quer dar de presente — mas você sabe exatamente o que ele precisa. Orienta!' },
  { icon:'💼', cat:'vendas', msg:'Profissionalismo não significa ser sério — significa ser consistentemente bom(a). Você é!' },
  { icon:'🔍', cat:'vendas', msg:'O cliente que pesquisa muito antes de comprar, quando decide, decide com convicção. Seja a razão!' },
  { icon:'💡', cat:'vendas', msg:'Uma ideia boa de atendimento hoje pode virar padrão da loja amanhã. Tem alguma? Aplica!' },
  { icon:'📊', cat:'vendas', msg:'Números são consequência. Cause bem, e os números vêm como resultado. Causa bem hoje!' },
  { icon:'🎨', cat:'vendas', msg:'Cada arranjo é uma obra de arte. E você é o(a) curador(a) que ajuda o cliente a escolher!' },
  { icon:'🌍', cat:'vendas', msg:'Flores têm linguagem universal. Você é o intérprete desse idioma. Interpreta bem hoje!' },
  { icon:'🔮', cat:'vendas', msg:'Você tem quase uma intuição sobre o que o cliente precisa. Usa esse sexto sentido hoje!' },
  { icon:'⚡', cat:'vendas', msg:'Quando você está em estado de fluxo no atendimento, tudo flui. Entra em fluxo hoje!' },
  { icon:'🎶', cat:'vendas', msg:'Bom atendimento tem ritmo. Você sabe o tempo certo de falar, ouvir e fechar. É musical!' },
  { icon:'🌄', cat:'especial', msg:'Cada nascer do sol é um convite para começar de novo. Hoje você tem esse convite na mão. Aceita!' },
  { icon:'📚', cat:'especial', msg:'Cada experiência no trabalho é uma página de um livro de sabedoria que só você pode escrever.' },
  { icon:'🎓', cat:'especial', msg:'Você não tem diploma na parede — mas tem um currículo de experiências que nenhuma faculdade dá.' },
  { icon:'🌿', cat:'especial', msg:'Como planta que busca a luz, você naturalmente se dirige ao que é bom. Que instinto saudável!' },
  { icon:'🏛️', cat:'especial', msg:'Grandes obras foram construídas pedra por pedra. Você está construindo algo grande. Continue!' },
  { icon:'🦋', cat:'especial', msg:'Transformação é dolorosa. Mas você já passou por ela e veio mais belo(a) do outro lado.' },
  { icon:'🌠', cat:'especial', msg:'Você tem objetivos que outras pessoas nem ousam sonhar. Que ambição saudável e inspiradora!' },
  { icon:'🎯', cat:'especial', msg:'Quando você mira alto, mesmo que não alcance o alvo, você chega mais longe do que quem não mirou.' },
  { icon:'💎', cat:'especial', msg:'Diamantes se formam sob pressão. Você já passou por pressão suficiente para brilhar muito.' },
  { icon:'🚀', cat:'especial', msg:'Seu potencial não tem atmosfera que segure. Você vai ultrapassar todos os limites. Vai!' },
  { icon:'👶', cat:'familia', msg:'Você trabalha hoje pensando no amanhã que quer dar para os seus filhos. Que amor proativo!' },
  { icon:'👴', cat:'familia', msg:'Os mais velhos da sua família olham pra você com orgulho silencioso. Honra esse olhar!' },
  { icon:'🤱', cat:'familia', msg:'Mãe/pai que trabalha com amor ensina que dedicação é valor. Que aula você está dando!' },
  { icon:'🏡', cat:'familia', msg:'O lar que você construiu ou está construindo tem a sua marca. Que construção especial!' },
  { icon:'🤗', cat:'familia', msg:'O abraço de quem você ama ao chegar em casa vale mais do que qualquer bônus. Faz render esse abraço!' },
  { icon:'💌', cat:'familia', msg:'Manda uma mensagem carinhosa pra família hoje. É gratuito e tem efeito priceless!' },
  { icon:'🎂', cat:'familia', msg:'Cada aniversário da família celebrado é memória afetiva que dura vida inteira. Celebra bem!' },
  { icon:'👨\u200d👧', cat:'familia', msg:'Um pai ou mãe presente é o maior presente que uma criança pode ter. Você está presente!' },
  { icon:'🌻', cat:'familia', msg:'Família é jardim que precisa de atenção constante. Cuida do seu jardim com amor!' },
  { icon:'💕', cat:'familia', msg:'As melhores histórias que você vai contar envelhecido(a) serão sobre a família. Escreve boas histórias!' },
  { icon:'🌹', cat:'amor', msg:'Uma rosa vermelha conta histórias que palavras não conseguem. Você é especialista em facilitar esses contos!' },
  { icon:'💞', cat:'amor', msg:'O amor que você tem para oferecer — para as pessoas, para o trabalho — é abundante e real.' },
  { icon:'🫂', cat:'amor', msg:'Um abraço sincero cura mais do que sabemos. Que você receba e dê muitos hoje!' },
  { icon:'💝', cat:'amor', msg:'Você ama com intensidade. Esse amor aparece no cuidado com que trata tudo ao redor.' },
  { icon:'🌸', cat:'amor', msg:'Flores são cartas de amor que não precisam de palavras. Você entrega essas cartas todo dia!' },
  { icon:'💖', cat:'amor', msg:'Seu coração grande cabe tudo: amor, trabalho, amizade, família. Que coração generoso!' },
  { icon:'🌷', cat:'amor', msg:"O amor verdadeiro não precisa de grandes gestos — um 'te pensei hoje' já é suficiente." },
  { icon:'💗', cat:'amor', msg:'Você sabe amar de um jeito que faz as pessoas se sentirem vistas e valorizadas. Dom raro!' },
  { icon:'🌺', cat:'amor', msg:'Quando você ama o que faz, o amor aparece em cada detalhe do seu trabalho. E aparece!' },
  { icon:'💓', cat:'amor', msg:'O amor é a única coisa que não diminui quando distribuída — ao contrário, cresce. Distribui hoje!' },
  { icon:'🧘', cat:'energia', msg:'Cinco minutos de meditação antes de começar prepara mais do que uma hora de preocupação!' },
  { icon:'🌤️', cat:'energia', msg:'Cada nuvem tem prazo de validade. O sol volta sempre. Espera com paciência — ele já está chegando!' },
  { icon:'🏃', cat:'energia', msg:'Movimento = energia. Mesmo que seja uma caminhada curta, move o corpo — a mente agradece!' },
  { icon:'🌞', cat:'energia', msg:'O sol nasceu hoje especialmente para iluminar o seu caminho. Aproveita cada raio!' },
  { icon:'🍃', cat:'energia', msg:'Respirar ar fresco, mesmo por cinco minutos, renova a mente de forma que nenhum app consegue.' },
  { icon:'💆', cat:'energia', msg:'Tensão no ombro? Estresse no queixo? Para, respira, solta. O trabalho espera um minuto!' },
  { icon:'🌊', cat:'energia', msg:'Como a maré, você tem momentos de alta e momentos de recolhimento. Os dois são necessários!' },
  { icon:'🎵', cat:'energia', msg:'Uma boa música no fone durante uma tarefa repetitiva transforma o mundano em prazeroso!' },
  { icon:'🌈', cat:'energia', msg:'Após o esforço intenso, vem o descanso merecido. Hoje você vai merecer muito!' },
  { icon:'🍵', cat:'energia', msg:'Um chazinho no intervalo é um pequeno ritual de cuidado próprio que faz diferença real!' },
  { icon:'🥗', cat:'comida', msg:'Uma salada colorida tem mais alegria do que parece. Aprecia as cores no prato hoje!' },
  { icon:'🍫', cat:'comida', msg:'Um pedaço de chocolate no intervalo não é fraqueza — é estratégia de bem-estar comprovada. 😄' },
  { icon:'🍳', cat:'comida', msg:'Ovo é versátil, nutritivo e democrático. Como a sua capacidade de se adaptar a qualquer situação!' },
  { icon:'🥤', cat:'comida', msg:'Um suco natural tem vitaminas que o corpo precisa e sabor que a alma agradece. Bebe hoje!' },
  { icon:'🍰', cat:'comida', msg:'Domingo tem bolo? Hoje tem bolo no trabalho? Seja lá quando for, aprecia cada fatia com gratidão!' },
  { icon:'🌽', cat:'comida', msg:'Milho verde na espiga numa tarde fria é um dos prazeres simples que a vida oferece de graça.' },
  { icon:'🍊', cat:'comida', msg:'A laranja brasileira é um presente da natureza. Uma vitamina C ao dia mantém o bom humor em dia! 🍊' },
  { icon:'☕', cat:'comida', msg:'O café do Brasil é patrimônio cultural. Cada xícara é um ritual de pertencimento. Aprecia!' },
  { icon:'🍚', cat:'comida', msg:'Arroz com feijão não é básico — é genial. Proteína completa, sabor de lar, memória afetiva. 🇧🇷' },
  { icon:'🧃', cat:'comida', msg:'Uma pausa com suco gelado no calor de Manaus é quase espiritual. Aprecia cada gole! 🌴' },
  { icon:'💐', cat:'vendas', msg:'Cada pedido de hoje é uma oportunidade de superar as expectativas. Aproveite a 1ª!' },
  { icon:'🌟', cat:'especial', msg:'Você tem 2 motivos para dar o melhor hoje. O principal: você mesmo(a)!' },
  { icon:'💪', cat:'autoestima', msg:'Dia 3 de crescimento contínuo. E você está aqui — isso já é vitória!' },
  { icon:'🙏', cat:'fe', msg:'Que Deus abençoe especialmente esse dia com propósito e alegria. Ele está ouvindo!' },
  { icon:'😄', cat:'humor', msg:'Alerta de produtividade máxima detectado. Origem: você chegou ao trabalho! 💪' },
  { icon:'🤝', cat:'equipe', msg:'O time que você faz parte hoje é melhor porque você faz parte. Fato comprovado!' },
  { icon:'❤️', cat:'familia', msg:'Pensa em quem você ama — e vai trabalhar com esse amor no coração. É invencível!' },
  { icon:'🌿', cat:'energia', msg:'Respira. Foca. Age. Repete. Essa é a fórmula do dia bem aproveitado!' },
  { icon:'🍽️', cat:'comida', msg:'Que seu intervalo hoje seja uma pausa de verdade — com comida boa e momento presente!' },
  { icon:'💕', cat:'amor', msg:'O amor que você coloca no trabalho volta para você de formas que você nem imagina!' },
  { icon:'💐', cat:'vendas', msg:'Cada pedido de hoje é uma oportunidade de superar as expectativas. Aproveite a 11ª!' },
  { icon:'🌟', cat:'especial', msg:'Você tem 12 motivos para dar o melhor hoje. O principal: você mesmo(a)!' },
  { icon:'💪', cat:'autoestima', msg:'Dia 13 de crescimento contínuo. E você está aqui — isso já é vitória!' },
  { icon:'🙏', cat:'fe', msg:'Que Deus abençoe especialmente esse dia com propósito e alegria. Ele está ouvindo!' },
  { icon:'😄', cat:'humor', msg:'Alerta de produtividade máxima detectado. Origem: você chegou ao trabalho! 💪' },
  { icon:'🤝', cat:'equipe', msg:'O time que você faz parte hoje é melhor porque você faz parte. Fato comprovado!' },
  { icon:'❤️', cat:'familia', msg:'Pensa em quem você ama — e vai trabalhar com esse amor no coração. É invencível!' },
  { icon:'🌿', cat:'energia', msg:'Respira. Foca. Age. Repete. Essa é a fórmula do dia bem aproveitado!' },
  { icon:'🍽️', cat:'comida', msg:'Que seu intervalo hoje seja uma pausa de verdade — com comida boa e momento presente!' },
  { icon:'💕', cat:'amor', msg:'O amor que você coloca no trabalho volta para você de formas que você nem imagina!' },
  { icon:'💐', cat:'vendas', msg:'Cada pedido de hoje é uma oportunidade de superar as expectativas. Aproveite a 21ª!' },
  { icon:'🌟', cat:'especial', msg:'Você tem 22 motivos para dar o melhor hoje. O principal: você mesmo(a)!' },
  { icon:'💪', cat:'autoestima', msg:'Dia 23 de crescimento contínuo. E você está aqui — isso já é vitória!' },
  { icon:'🙏', cat:'fe', msg:'Que Deus abençoe especialmente esse dia com propósito e alegria. Ele está ouvindo!' },
  { icon:'😄', cat:'humor', msg:'Alerta de produtividade máxima detectado. Origem: você chegou ao trabalho! 💪' },
  { icon:'🤝', cat:'equipe', msg:'O time que você faz parte hoje é melhor porque você faz parte. Fato comprovado!' },
  { icon:'❤️', cat:'familia', msg:'Pensa em quem você ama — e vai trabalhar com esse amor no coração. É invencível!' },
  { icon:'🌿', cat:'energia', msg:'Respira. Foca. Age. Repete. Essa é a fórmula do dia bem aproveitado!' },
  { icon:'🍽️', cat:'comida', msg:'Que seu intervalo hoje seja uma pausa de verdade — com comida boa e momento presente!' },
  { icon:'💕', cat:'amor', msg:'O amor que você coloca no trabalho volta para você de formas que você nem imagina!' },
  { icon:'💐', cat:'vendas', msg:'Cada pedido de hoje é uma oportunidade de superar as expectativas. Aproveite a 31ª!' },
  { icon:'🌟', cat:'especial', msg:'Você tem 32 motivos para dar o melhor hoje. O principal: você mesmo(a)!' },
  { icon:'💪', cat:'autoestima', msg:'Dia 33 de crescimento contínuo. E você está aqui — isso já é vitória!' },
  { icon:'🙏', cat:'fe', msg:'Que Deus abençoe especialmente esse dia com propósito e alegria. Ele está ouvindo!' },
  { icon:'😄', cat:'humor', msg:'Alerta de produtividade máxima detectado. Origem: você chegou ao trabalho! 💪' },
  { icon:'🤝', cat:'equipe', msg:'O time que você faz parte hoje é melhor porque você faz parte. Fato comprovado!' },
  { icon:'❤️', cat:'familia', msg:'Pensa em quem você ama — e vai trabalhar com esse amor no coração. É invencível!' },
  { icon:'🌿', cat:'energia', msg:'Respira. Foca. Age. Repete. Essa é a fórmula do dia bem aproveitado!' },
  { icon:'🍽️', cat:'comida', msg:'Que seu intervalo hoje seja uma pausa de verdade — com comida boa e momento presente!' },
  { icon:'💕', cat:'amor', msg:'O amor que você coloca no trabalho volta para você de formas que você nem imagina!' },
  { icon:'💐', cat:'vendas', msg:'Cada pedido de hoje é uma oportunidade de superar as expectativas. Aproveite a 41ª!' },
  { icon:'🌟', cat:'especial', msg:'Você tem 42 motivos para dar o melhor hoje. O principal: você mesmo(a)!' },
  { icon:'💪', cat:'autoestima', msg:'Dia 43 de crescimento contínuo. E você está aqui — isso já é vitória!' },
  { icon:'🙏', cat:'fe', msg:'Que Deus abençoe especialmente esse dia com propósito e alegria. Ele está ouvindo!' },
  { icon:'😄', cat:'humor', msg:'Alerta de produtividade máxima detectado. Origem: você chegou ao trabalho! 💪' },
  { icon:'🤝', cat:'equipe', msg:'O time que você faz parte hoje é melhor porque você faz parte. Fato comprovado!' },
  { icon:'❤️', cat:'familia', msg:'Pensa em quem você ama — e vai trabalhar com esse amor no coração. É invencível!' },
  { icon:'🌿', cat:'energia', msg:'Respira. Foca. Age. Repete. Essa é a fórmula do dia bem aproveitado!' },
  { icon:'🍽️', cat:'comida', msg:'Que seu intervalo hoje seja uma pausa de verdade — com comida boa e momento presente!' },
  { icon:'💕', cat:'amor', msg:'O amor que você coloca no trabalho volta para você de formas que você nem imagina!' },
  { icon:'💐', cat:'vendas', msg:'Cada pedido de hoje é uma oportunidade de superar as expectativas. Aproveite a 51ª!' },
  { icon:'🌟', cat:'especial', msg:'Você tem 52 motivos para dar o melhor hoje. O principal: você mesmo(a)!' },
  { icon:'💪', cat:'autoestima', msg:'Dia 53 de crescimento contínuo. E você está aqui — isso já é vitória!' },
  { icon:'🙏', cat:'fe', msg:'Que Deus abençoe especialmente esse dia com propósito e alegria. Ele está ouvindo!' },
  { icon:'😄', cat:'humor', msg:'Alerta de produtividade máxima detectado. Origem: você chegou ao trabalho! 💪' },
  { icon:'🤝', cat:'equipe', msg:'O time que você faz parte hoje é melhor porque você faz parte. Fato comprovado!' },
];

// ── MOTIVATIONAL MESSAGE FUNCTIONS ──────────────────────────────
function getMensagemDoDia(userId){
  const hoje = new Date().toISOString().split('T')[0];
  const key = 'fv_msg_dia_' + (userId||'guest');
  const saved = JSON.parse(localStorage.getItem(key)||'{}');
  if(saved.data === hoje) return null;
  const dayOfYear = Math.floor((new Date() - new Date(new Date().getFullYear(),0,0)) / 86400000);
  let idx = dayOfYear % MOTIVATIONAL_MESSAGES.length;
  if(saved.lastIdx === idx) idx = (idx + 1) % MOTIVATIONAL_MESSAGES.length;
  return { msg: MOTIVATIONAL_MESSAGES[idx], idx, hoje };
}

function marcarMensagemExibida(userId, idx, hoje){
  const key = 'fv_msg_dia_' + (userId||'guest');
  localStorage.setItem(key, JSON.stringify({ data: hoje, lastIdx: idx }));
}

function showMensagemMotivacional(userName, userId){
  const result = getMensagemDoDia(userId);
  if(!result) return;
  const { msg, idx, hoje } = result;
  const hora = new Date().getHours();
  const saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
  const primeiroNome = (userName||'').split(' ')[0] || 'Colaborador';
  const gradientes = {
    vendas:    'linear-gradient(135deg, #FFF0F5 0%, #FCE4EC 100%)',
    equipe:    'linear-gradient(135deg, #F0F4FF 0%, #E8EAF6 100%)',
    autoestima:'linear-gradient(135deg, #FFF8E1 0%, #FFF3E0 100%)',
    familia:   'linear-gradient(135deg, #F3E5F5 0%, #EDE7F6 100%)',
    amor:      'linear-gradient(135deg, #FCE4EC 0%, #F8BBD0 100%)',
    humor:     'linear-gradient(135deg, #E8F5E9 0%, #F1F8E9 100%)',
    fe:        'linear-gradient(135deg, #E3F2FD 0%, #E8EAF6 100%)',
    energia:   'linear-gradient(135deg, #E0F7FA 0%, #E0F2F1 100%)',
    especial:  'linear-gradient(135deg, #FFF9C4 0%, #FFF8E1 100%)',
  };
  const bg = gradientes[msg.cat] || gradientes.especial;

  S._modal = `<div class="mo" id="mo" style="backdrop-filter:blur(4px);">
  <div class="mo-box" style="max-width:420px;text-align:center;padding:0;overflow:hidden;border-radius:20px;border:none;box-shadow:0 20px 60px rgba(0,0,0,.2);" onclick="event.stopPropagation()">
    <div style="background:var(--rose);padding:20px 24px 16px;position:relative;">
      <div style="font-size:11px;color:rgba(255,255,255,.8);letter-spacing:1px;text-transform:uppercase;margin-bottom:4px;">Laços Eternos 🌸</div>
      <div style="font-family:'Playfair Display',serif;font-size:20px;color:#fff;font-weight:600;">${saudacao}, ${primeiroNome}! 👋</div>
    </div>
    <div style="background:${bg};padding:28px 24px;">
      <div style="font-size:52px;margin-bottom:16px;line-height:1;">${msg.icon}</div>
      <div style="font-size:15px;line-height:1.7;color:#2D1A20;font-weight:500;font-style:italic;">"${msg.msg}"</div>
      <div style="margin-top:20px;display:flex;align-items:center;justify-content:center;gap:6px;">
        <div style="width:6px;height:6px;border-radius:50%;background:var(--rose);opacity:.4;"></div>
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;">Mensagem do dia</div>
        <div style="width:6px;height:6px;border-radius:50%;background:var(--rose);opacity:.4;"></div>
      </div>
    </div>
    <div style="padding:16px 24px 20px;background:#fff;">
      <button id="btn-msg-ok" style="width:100%;background:var(--rose);color:#fff;border:none;padding:13px 24px;border-radius:12px;font-size:15px;font-weight:700;cursor:pointer;letter-spacing:.5px;transition:opacity .2s;"
        onmouseover="this.style.opacity='.85'" onmouseout="this.style.opacity='1'">
        🌸 Começar o dia!
      </button>
    </div>
  </div></div>`;

  render();
  marcarMensagemExibida(userId, idx, hoje);
  document.getElementById('btn-msg-ok')?.addEventListener('click',()=>{ S._modal=''; render(); });
  document.getElementById('mo')?.addEventListener('click', e=>{ if(e.target.id==='mo'){ S._modal=''; render(); } });
}

// ── SEED COLABORADORES ──────────────────────────────────────────
function seedColaboradores(){
  const existing = getColabs();
  let needsSave = false;
  existing.forEach(c => {
    if(c.email && c.email !== c.email.toLowerCase()){
      c.email = c.email.toLowerCase();
      needsSave = true;
    }
  });
  if(needsSave) saveColabs(existing);
}

// ── RENDER ──────────────────────────────────────────────────────
let _loadingSafetyTimer = null;
export function render(){
  clearTimeout(_loadingSafetyTimer);
  if(S.loading) _loadingSafetyTimer = setTimeout(()=>{ S.loading=false; try{render();}catch(e){} }, 120000);

  try{
    const root = document.getElementById('root');
    if(!root){ console.error('Elemento #root não encontrado'); return; }

    // ── PÁGINA PÚBLICA /entrega/:id ──────────────────────────
    // Acessada pelo QR code da comanda. Funciona sem login.
    const publicOrderId = getPublicOrderIdFromURL();
    if(publicOrderId){
      root.innerHTML = renderPedidoPublico();
      // Modal-root também é limpo (não queremos modais do sistema aqui)
      const mrootP = document.getElementById('modal-root');
      if(mrootP) mrootP.innerHTML = '';
      return;
    }

    if(!S.user){
      // URL sempre /login quando deslogado
      if(window.location.pathname !== '/login'){
        history.replaceState({page:'login'}, '', '/login');
      }
      root.innerHTML = renderLogin();
      try{bindLogin();}catch(e){console.error('bindLogin',e);}
    } else {
      // Se logado e URL é /login, redireciona para dashboard (ou página anterior)
      if(window.location.pathname === '/login'){
        const targetSlug = (S.page && S.page !== 'login') ? S.page : 'dashboard';
        history.replaceState({page:targetSlug}, '', '/'+targetSlug);
      }
      root.innerHTML = renderApp();
      try{ bindApp(); }catch(e){ console.error('bindApp erro:',e); }
    }

    // Modal root fora do #root (no body) — não é destruído em re-render
    const mroot = document.getElementById('modal-root');
    if(mroot && mroot._currentModal !== S._modal){
      mroot.innerHTML = S._modal || '';
      mroot._currentModal = S._modal;
    }

    try{ _bindModalActions(); }catch(e){ console.error('_bindModalActions erro:',e); }

    // Garante que cliques dentro de qualquer modal não tragam efeito fora
    try{ _bindGlobalModalGuard(); }catch(e){}

  }catch(e){
    console.error('Erro de renderização:', e);
    const root = document.getElementById('root');
    if(root) root.innerHTML=`
    <div style="padding:40px;text-align:center;font-family:sans-serif;max-width:600px;margin:80px auto;">
      <div style="font-size:48px;margin-bottom:16px">⚠️</div>
      <h2 style="color:#c0392b;margin-bottom:12px">Erro ao carregar o sistema</h2>
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:16px;text-align:left;margin-bottom:16px;">
        <code style="font-size:13px;color:#991b1b;word-break:break-all">${e.message}</code>
      </div>
      <button onclick="location.reload()" style="background:#8B2252;color:#fff;border:none;padding:12px 28px;border-radius:8px;font-size:14px;cursor:pointer;">🔄 Recarregar</button>
      <p style="font-size:12px;color:#6b7280;margin-top:12px">Se o erro persistir, pressione F12 → Console e envie o erro ao suporte.</p>
    </div>`;
  }
}

// ── MODAL ACTIONS — event delegation no #root ───────────────────
// Guard do modal — NO-OP agora.
// O bug de modal fechando foi resolvido movendo #modal-root para fora de #root.
// Handlers adicionais em fase de captura estavam bloqueando cliques nos botões.
function _bindGlobalModalGuard(){ /* desativado intencionalmente */ }

let _modalDelegateAttached = false;
function _bindModalActions(){
  if(!_modalDelegateAttached){
    const root = document.getElementById('root');
    if(!root) return;
    root.addEventListener('click', e=>{
      const t = e.target.closest('[data-action]');
      if(!t) return;
      e.stopPropagation();
      const action = t.dataset.action;
      const id     = t.dataset.id||null;
      try{
        switch(action){
          case 'close-modal': S._modal=''; render(); break;
          case 'save-client':   saveClient(id); break;
          case 'del-client':    deleteClient(id); break;
          case 'edit-client':   { const c=S.clients.find(x=>x._id===id); if(c) showClientModal(c); break; }
          case 'save-product':  saveProduct(id); break;
          case 'del-product':   deleteProduct(id); break;
          case 'view-order':    showOrderViewModal(id); break;
          case 'edit-order':    showEditOrderModal(id); break;
          case 'advance-order': advanceOrder(id); break;
          case 'print-comanda': printComanda(id); break;
          case 'print-card':    printCard(id); break;
          case 'confirm-delivery': showConfirmDeliveryModal(id); break;
          case 'edit-colab':    showColabModal(id); break;
          case 'del-colab':     deleteColab(id); break;
          case 'sync-colab':    syncColabToBackend(id); break;
          case 'edit-user':     showEditUserModal(id); break;
          case 'del-data-especial': {
            const [cid, didx] = (id||'').split('::');
            const datas = getDatasEspeciais(cid);
            datas.splice(parseInt(didx),1);
            saveDatasEspeciais(cid, datas);
            const cli = S.clients.find(x=>x._id===cid);
            showClientModal(cli);
            break;
          }
          case 'add-data-especial': {
            const cli = S.clients.find(x=>x._id===id);
            showAddDataEspecialModal(id, ()=>showClientModal(cli));
            break;
          }
        }
      }catch(err){ console.error('_bindModalActions:', action, err); }
    });
    _modalDelegateAttached = true;
  }
}

// ── APP SHELL ───────────────────────────────────────────────────
function renderApp(){
  if(_isEntregador()){
    return renderAppEntregador();
  }

  const nav = [
    {k:'dashboard',l:'Dashboard',i:'📊',m:'dashboard',s:'Principal'},
    {k:'pdv',l:'PDV (Vendas)',i:'🛒',m:'pdv',s:'Principal'},
    {k:'caixa',l:'Caixa',i:'💵',m:'caixa',s:'Principal'},
    {k:'pedidos',l:'Pedidos',i:'📋',m:'orders',s:'Principal'},
    {k:'clientes',l:'Clientes',i:'👥',m:'clients',s:'Gestão'},
    {k:'produtos',l:'Produtos',i:'🌹',m:'products',s:'Gestão'},
    {k:'categorias',l:'Categorias',i:'🏷️',m:'products',s:'Gestão'},
    {k:'estoque',l:'Estoque',i:'📦',m:'stock',s:'Gestão'},
    {k:'producao',l:'Produção',i:'🌿',m:'production',s:'Operação'},
    {k:'expedicao',l:'Expedição',i:'📤',m:'delivery',s:'Operação',hide:['Entregador']},
    {k:'ponto',l:'Ponto Eletrônico',i:'🕐',m:'ponto',s:'Operação'},
    {k:'financeiro',l:'Financeiro',i:'💰',m:'financial',s:'Financeiro'},
    {k:'notasFiscais',l:'Notas Fiscais',i:'🧾',m:'notasFiscais',s:'Financeiro'},
    {k:'relatorios',l:'Relatórios',i:'📈',m:'reports',s:'Financeiro'},
    {k:'alertas',l:'Alertas',i:'🔔',m:'alertas',s:'Sistema'},
    {k:'whatsapp',l:'WhatsApp',i:'💬',m:'whatsapp',s:'Sistema'},
    {k:'usuarios',l:'Usuários',i:'👤',m:'users',s:'Config'},
    {k:'colaboradores',l:'Colaboradores',i:'👥',m:'users',s:'Config'},
    {k:'impressao',l:'Impressão',i:'🖨️',m:'impressao',s:'Config'},
    {k:'backup',l:'Backup',i:'💾',m:'backup',s:'Config'},
    {k:'config',l:'Configurações',i:'⚙️',m:'config',s:'Config'},
    {k:'auditLogs',l:'Auditoria & Segurança',i:'🔒',m:'auditLogs',s:'Config'},
    {k:'agenteTI',l:'Agente de TI',i:'🤖',m:'agenteTI',s:'Sistema'},
    {k:'ecommerce',l:'E-commerce',i:'🛒',m:'ecommerce',s:'E-commerce'},
    {k:'orcamento',l:'Orçamentos',i:'📋',m:'orcamentos',s:'E-commerce'},
  ].filter(n=>can(n.m) && !(n.hide||[]).includes(_isEntregador()?'Entregador':S.user?.role));

  // ── GUARDA DE ACESSO POR PÁGINA ─────────────────────────────
  // Valida se o usuário tem permissão para acessar a página atual.
  // Se não tem, redireciona para o primeiro módulo permitido no menu.
  const pageToMod = {
    dashboard:'dashboard', pdv:'pdv', caixa:'caixa', pedidos:'orders',
    clientes:'clients', produtos:'products', categorias:'products',
    estoque:'stock', producao:'production', expedicao:'delivery',
    ponto:'ponto', financeiro:'financial', relatorios:'reports',
    alertas:'alertas', whatsapp:'whatsapp', usuarios:'users',
    colaboradores:'users', impressao:'impressao', backup:'backup',
    config:'config', ecommerce:'ecommerce', orcamento:'orcamentos',
    notasFiscais:'notasFiscais', auditLogs:'auditLogs',
    agenteTI:'agenteTI',
    entregador:'delivery',
  };
  const currentMod = pageToMod[S.page];
  if(currentMod && !can(currentMod)){
    // Página atual não permitida — vai para a primeira do menu ou mostra vazio
    if(nav.length > 0){
      S.page = nav[0].k;
      try{ localStorage.setItem('fv_page', S.page); }catch(_){}
    } else {
      // Nenhum módulo permitido — mostra tela de sem acesso
      return `
${renderSidebar(nav, 0, 0)}
<div class="main">
  ${renderTopbar()}
  <div class="content">
    <div class="card" style="text-align:center;padding:60px 30px;max-width:500px;margin:40px auto;">
      <div style="font-size:60px;margin-bottom:20px;">🔒</div>
      <h2 style="font-size:20px;color:var(--ink);margin-bottom:12px;">Acesso restrito</h2>
      <p style="color:var(--muted);font-size:14px;line-height:1.6;margin-bottom:20px;">
        Seu usuário ainda não tem permissão para acessar nenhum módulo.<br>
        Peça ao <strong>Administrador</strong> para liberar os módulos necessários em <strong>Colaboradores</strong>.
      </p>
      <button class="btn btn-ghost btn-sm" id="btn-logout">Sair</button>
    </div>
  </div>
</div>`;
    }
  }

  const pages={dashboard:renderDashboard,pdv:renderPDV,pedidos:renderPedidos,clientes:renderClientes,produtos:renderProdutos,estoque:renderEstoque,producao:renderProducao,expedicao:renderExpedicao,entregador:renderAppEntregador,financeiro:renderFinanceiro,relatorios:renderRelatorios,alertas:renderAlertas,usuarios:renderUsuarios,colaboradores:renderColaboradores,impressao:renderImpressao,config:renderConfig,ponto:renderPonto,caixa:renderCaixa,backup:renderBackup,whatsapp:renderWhatsApp,ecommerce:renderEcommerce,orcamento:renderOrcamento,categorias:renderCategorias,notasFiscais:renderNotasFiscais,auditLogs:renderAuditLogs,agenteTI:renderAgenteTI};
  const content = (()=>{ try{ return pages[S.page] ? pages[S.page]() : `<div class="empty card"><div class="empty-icon">🌸</div><p>Em desenvolvimento</p></div>`; }catch(e){ console.error('[render '+S.page+']',e); return `<div class="card" style="color:var(--red);padding:20px;">⚠️ Erro ao carregar o módulo. <button onclick="setPage('dashboard')" class="btn btn-ghost btn-sm" style="margin-top:8px;">← Dashboard</button><br/><small style="color:var(--muted)">${e.message}</small></div>`; } })();
  // Sino: contagem de notificacoes nao-lidas (le direto do localStorage
  // para nao precisar de await dentro de render() sync)
  const pendingAlerts = (() => {
    try {
      const raw = localStorage.getItem('fv_notifications_v1');
      if (!raw) return 0;
      const arr = JSON.parse(raw) || [];
      return arr.filter(n => !n.dismissed && !n.read).length;
    } catch(e) { return 0; }
  })();
  const newOrders = S.orders.filter(o=>o.status==='Aguardando').length;

  return `
${S.sidebarOpen?`<div style="position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:99" id="sb-overlay"></div>`:''}
${renderSidebar(nav, pendingAlerts, newOrders)}
<div class="main">
  ${renderTopbar()}
  <div class="content" id="page-content">
    ${content}
  </div>
</div>
${S.loading?'<div class="loading"><div class="spin"></div></div>':''}
${S.toast?'<div class="toast" style="'+(S.toast.err?'background:var(--red)':'')+'">'+(S.toast.msg||'')+'</div>':''}
`;
}

// ── BINDINGS ────────────────────────────────────────────────────
function bindApp(){
  // ENTREGADOR: bindings exclusivos — sem menu, sem navegação
  if(_isEntregador()){
    document.getElementById('btn-logout')?.addEventListener('click', logout);
    const doRefresh = () => {
      S.loading=true; render();
      GET('/orders').then(o=>{ if(o&&o.length) S.orders=o; }).catch(()=>{}).finally(()=>{ S.loading=false; render(); });
    };
    document.getElementById('btn-refresh-rota')?.addEventListener('click', doRefresh);
    document.getElementById('btn-refresh-rota2')?.addEventListener('click', doRefresh);
    document.querySelectorAll('[data-open-confirm]').forEach(b =>
      b.addEventListener('click', () => showConfirmDeliveryModal(b.dataset.openConfirm))
    );
    try{ bindRotaButtons(); }catch(e){ console.error('bindRotaButtons', e); }
    return;
  }

  document.querySelectorAll('.sb-item[data-page]').forEach(el=>el.addEventListener('click',()=>setPage(el.dataset.page)));
  document.getElementById('btn-logout')?.addEventListener('click',logout);
  document.getElementById('mob-toggle')?.addEventListener('click',()=>{S.sidebarOpen=!S.sidebarOpen;render();});
  document.getElementById('sb-overlay')?.addEventListener('click',()=>{S.sidebarOpen=false;render();});
  document.getElementById('btn-sidebar-toggle')?.addEventListener('click',()=>{
    S.sidebarCollapsed=!S.sidebarCollapsed;
    localStorage.setItem('fv_sidebar_collapsed', S.sidebarCollapsed?'1':'0');
    render();
  });
  bindPageActions();
}

function bindPageActions(){
  // ── DASHBOARD ─────────────────────────────────────────────────
  if(S.page==='dashboard'){
    // Search
    document.getElementById('dash-search')?.addEventListener('input', e=>{
      S._dashSearch = e.target.value;
      // Busca tambem no servidor (pega pedidos antigos nao-cacheados)
      import('./utils/helpers.js').then(m => m.triggerServerOrderSearch?.(e.target.value));
      render();
    });
    // Filters
    document.getElementById('dash-filter-status')?.addEventListener('change', e=>{
      S._dashStatus = e.target.value;
      render();
    });
    document.getElementById('dash-filter-payment')?.addEventListener('change', e=>{
      S._dashPayment = e.target.value;
      render();
    });
    document.getElementById('dash-filter-unit')?.addEventListener('change', e=>{
      S._dashUnit = e.target.value;
      render();
    });
    // Filtro Bairro especifico (limpa filtro de zona ao usar)
    document.getElementById('dash-filter-bairro')?.addEventListener('change', e=>{
      S._dashBairro = e.target.value;
      S._dashZona = '';
      render();
    });
    // Filtro Zona (Bairros Proximos) — limpa filtro de bairro especifico
    document.getElementById('dash-filter-zona')?.addEventListener('change', e=>{
      S._dashZona = e.target.value;
      S._dashBairro = '';
      // Quando seleciona uma zona, ativa modo rota automaticamente
      if (e.target.value) S._dashView = 'rota';
      render();
    });
    // Toggle Lista/Rota
    document.querySelectorAll('[data-dash-view]').forEach(b=>{
      b.addEventListener('click', () => {
        S._dashView = b.dataset.dashView;
        render();
      });
    });
    // Date filter
    document.querySelectorAll('[data-dash-date]').forEach(b => {
      b.addEventListener('click', () => {
        S._dashDate = b.dataset.dashDate;
        render();
      });
    });
    document.getElementById('dash-filter-date-custom')?.addEventListener('change', e => {
      S._dashDate = e.target.value;
      render();
    });
    // Refresh
    document.getElementById('btn-dash-refresh')?.addEventListener('click', ()=>recarregarDados());
    // Status dropdowns - inline change
    document.querySelectorAll('[data-status-select]').forEach(sel=>{
      sel.addEventListener('change', async e=>{
        const id = sel.dataset.statusSelect;
        const newStatus = e.target.value;
        try {
          await PATCH('/orders/'+id+'/status', {status: newStatus});
          const order = S.orders.find(o=>o._id===id);
          if(order) order.status = newStatus;
          invalidateCache('orders');
          render();
          toast('Status atualizado: '+newStatus);
        } catch(err) {
          toast('Erro ao atualizar status: '+err.message, true);
        }
      });
    });
    // Actions
    document.querySelectorAll('[data-edit-order]').forEach(b=>b.addEventListener('click',()=>{
      if (typeof window._tryEditOrder === 'function') window._tryEditOrder(b.dataset.editOrder);
      else showEditOrderModal(b.dataset.editOrder);
    }));
    document.querySelectorAll('[data-print-comanda]').forEach(b=>b.addEventListener('click',()=>printComanda(b.dataset.printComanda)));
    document.querySelectorAll('[data-confirm]').forEach(b=>b.addEventListener('click',()=>showConfirmDeliveryModal(b.dataset.confirm)));
    document.querySelectorAll('[data-print-card]').forEach(b=>b.addEventListener('click',()=>printCard(b.dataset.printCard)));

    // Checkbox selection
    const updateSelCount = ()=>{
      const el = document.getElementById('dash-selected-count');
      if(el) el.textContent = selectedOrders.length+' selecionados';
    };
    document.getElementById('dash-select-all')?.addEventListener('change', e=>{
      const checked = e.target.checked;
      selectedOrders.length = 0;
      document.querySelectorAll('[data-check-order]').forEach(cb=>{
        cb.checked = checked;
        if(checked) selectedOrders.push(cb.dataset.checkOrder);
      });
      updateSelCount();
    });
    document.querySelectorAll('[data-check-order]').forEach(cb=>{
      cb.addEventListener('change', e=>{
        const id = cb.dataset.checkOrder;
        if(e.target.checked){
          if(!selectedOrders.includes(id)) selectedOrders.push(id);
        } else {
          const idx = selectedOrders.indexOf(id);
          if(idx>-1) selectedOrders.splice(idx,1);
        }
        updateSelCount();
      });
    });

    // Bulk print
    document.getElementById('btn-dash-print')?.addEventListener('click', async ()=>{
      if(!selectedOrders.length){ toast('Selecione pedidos para imprimir'); return; }
      for(const id of selectedOrders){ await printComanda(id); }
      toast(selectedOrders.length+' comanda(s) enviada(s) para impress\u00e3o');
    });

    // Bulk confirm delivery
    document.getElementById('btn-dash-confirm')?.addEventListener('click', async ()=>{
      if(!selectedOrders.length){ toast('Selecione pedidos para confirmar'); return; }
      for(const id of selectedOrders){ showConfirmDeliveryModal(id); }
    });

    // Payment selects — atualiza o STATUS de aprovação do pagamento (paymentStatus)
    document.querySelectorAll('[data-payment-select]').forEach(sel=>{
      sel.addEventListener('change', async e=>{
        const id = sel.dataset.paymentSelect;
        const val = e.target.value;
        const colorMap = {
          'Aprovado':'background:#D1FAE5;color:#065F46;border-color:#A7F3D0;',
          'Ag. Pagamento':'background:#FEF3C7;color:#92400E;border-color:#FDE68A;',
          'Pagar na Entrega':'background:#FFEDD5;color:#9A3412;border-color:#FED7AA;'
        };
        sel.style.cssText = (colorMap[val]||'')+' border:1px solid;border-radius:20px;padding:3px 8px;font-size:10px;font-weight:600;cursor:pointer;outline:none;';
        try {
          await PUT('/orders/'+id, {paymentStatus: val});
          const order = S.orders.find(o=>o._id===id);
          if(order) order.paymentStatus = val;
          invalidateCache('orders');
          toast('Pagamento atualizado: '+val);
          render();
        } catch(err){
          toast('Erro ao atualizar pagamento: '+err.message, true);
        }
      });
    });

    // Time inputs — salva horário ao mudar (sem re-render para não perder foco)
    document.querySelectorAll('[data-time-start]').forEach(inp=>{
      inp.addEventListener('change', async e=>{
        const id = inp.dataset.timeStart;
        try {
          await PUT('/orders/'+id, {scheduledTime: e.target.value});
          const order = S.orders.find(o=>o._id===id);
          if(order) order.scheduledTime = e.target.value;
          invalidateCache('orders');
        } catch(err){ toast('Erro: '+err.message, true); }
      });
    });
    document.querySelectorAll('[data-time-end]').forEach(inp=>{
      inp.addEventListener('change', async e=>{
        const id = inp.dataset.timeEnd;
        try {
          await PUT('/orders/'+id, {scheduledTimeEnd: e.target.value});
          const order = S.orders.find(o=>o._id===id);
          if(order) order.scheduledTimeEnd = e.target.value;
          invalidateCache('orders');
        } catch(err){ toast('Erro: '+err.message, true); }
      });
    });
  }

  // ── PDV ────────────────────────────────────────────────────────
  if(S.page==='pdv'){
    let _searchTimeout = null;
    const pdvSearchUpdate = (val) => {
      PDV.clientSearch = val;
      const box = document.getElementById('pdv-search-results');
      if(!box) return;
      if(!val || val.length < 2){ box.innerHTML=''; return; }
      const isNum = /^\d+$/.test(val);
      const clean = val.replace(/\D/g,'');
      const matches = S.clients.filter(c=>{
        if(isNum) return c.phone?.replace(/\D/g,'').includes(clean);
        return c.name?.toLowerCase().includes(val.toLowerCase());
      }).slice(0,6);
      const pickItem = (id) => {
        const c = S.clients.find(x=>x._id===id);
        if(!c) return;
        PDV.clientId=c._id; PDV.clientName=c.name; PDV.clientPhone=c.phone||'';
        PDV.clientSearch=''; box.innerHTML=''; render();
      };
      const newCli = () => {
        PDV._showQuickReg=true;
        const isN=/^\d+$/.test(PDV.clientSearch);
        if(isN) PDV._quickPhone=PDV.clientSearch; else PDV._quickName=PDV.clientSearch;
        render();
        setTimeout(()=>{
          if(isN) { const el=document.getElementById('qr-phone'); if(el){el.value=PDV.clientSearch;document.getElementById('qr-name')?.focus();} }
          else    { const el=document.getElementById('qr-name');  if(el){el.value=PDV.clientSearch;document.getElementById('qr-phone')?.focus();} }
        },60);
      };
      if(matches.length===0){
        box.innerHTML=`<div style="background:var(--petal);border-radius:8px;padding:12px;margin-top:6px;border:1px solid var(--rose-l);">
          <div style="font-size:12px;color:var(--rose);font-weight:700;margin-bottom:2px;">📵 Cliente não encontrado</div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:8px;">Nenhum resultado para "${val}"</div>
          <button id="pdv-new-cli-btn-inline" class="btn btn-primary btn-sm" style="width:100%;justify-content:center;">➕ Cadastrar "${val}" como novo cliente</button>
        </div>`;
        {const _el=document.getElementById('pdv-new-cli-btn-inline');if(_el)_el.onclick=newCli;}
      } else {
        box.innerHTML=`<div style="background:#fff;border:1px solid var(--border);border-radius:8px;box-shadow:var(--shadow);margin-top:4px;overflow:hidden;max-height:220px;overflow-y:auto;">
          ${matches.map(c=>`<div class="pdv-cli-pick" data-id="${c._id}" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;">
            <div class="av" style="width:30px;height:30px;font-size:10px;flex-shrink:0">${ini(c.name)}</div>
            <div style="flex:1;"><div style="font-size:13px;font-weight:600">${c.name}</div><div style="font-size:11px;color:var(--muted)">${c.phone||''} ${c.address?.neighborhood?'· '+c.address.neighborhood:''}</div></div>
            ${c.segment==='VIP'?'<span class="tag t-rose">VIP</span>':''}
          </div>`).join('')}
          <div id="pdv-new-cli-btn-inline2" style="padding:10px 14px;cursor:pointer;color:var(--rose);font-size:12px;font-weight:600;display:flex;align-items:center;gap:6px;border-top:1px solid var(--border);">➕ Cadastrar novo cliente</div>
        </div>`;
        box.querySelectorAll('.pdv-cli-pick').forEach(el=>el.addEventListener('click',()=>pickItem(el.dataset.id)));
        {const _el=document.getElementById('pdv-new-cli-btn-inline2');if(_el)_el.onclick=newCli;}
      }
    };
    const searchEl = document.getElementById('pdv-phone-search');
    if(searchEl){
      searchEl.addEventListener('input', e=>{ clearTimeout(_searchTimeout); _searchTimeout = setTimeout(()=>pdvSearchUpdate(e.target.value), 120); });
      if(PDV.clientSearch) setTimeout(()=>pdvSearchUpdate(PDV.clientSearch), 50);
    }
    {const _el=document.getElementById('pdv-clear-cli');if(_el)_el.onclick=()=>{PDV.clientId='';PDV.clientName='';PDV.clientPhone='';PDV.clientSearch='';const b=document.getElementById('pdv-search-results');if(b)b.innerHTML='';render();};}
    {const _el=document.getElementById('pdv-search-clear');if(_el)_el.onclick=()=>{PDV.clientSearch='';const b=document.getElementById('pdv-search-results');if(b)b.innerHTML='';render();};}
    {const _el=document.getElementById('pdv-new-cli-btn');if(_el)_el.onclick=()=>{PDV._showQuickReg=true;const isNum=/^\d+$/.test(PDV.clientSearch);if(isNum) PDV._quickPhone=PDV.clientSearch; else PDV._quickName=PDV.clientSearch;render();};}
    {const _el=document.getElementById('btn-qr-cancel');if(_el)_el.onclick=()=>{PDV._showQuickReg=false;render();};}
    // Mascara de CPF: 000.000.000-00
    {const cpfEl=document.getElementById('qr-cpf');if(cpfEl)cpfEl.addEventListener('input',e=>{
      const d=(e.target.value||'').replace(/\D/g,'').slice(0,11);
      let v=d;
      if(d.length>9)      v=d.replace(/^(\d{3})(\d{3})(\d{3})(\d{0,2}).*/,'$1.$2.$3-$4');
      else if(d.length>6) v=d.replace(/^(\d{3})(\d{3})(\d{0,3}).*/,'$1.$2.$3');
      else if(d.length>3) v=d.replace(/^(\d{3})(\d{0,3}).*/,'$1.$2');
      e.target.value=v;
    });}
    {const _el=document.getElementById('btn-qr-save');if(_el)_el.onclick=async()=>{
      const name=document.getElementById('qr-name')?.value.trim()||'';
      const phone=document.getElementById('qr-phone')?.value.trim()||'';
      if(!name) return toast('\u274C Nome completo \u00E9 obrigat\u00F3rio', true);
      if(!phone) return toast('\u274C WhatsApp \u00E9 obrigat\u00F3rio', true);
      const phoneClean = phone.replace(/\D/g,'');
      const dup = S.clients.find(c=>(c.phone||c.telefone||'').replace(/\D/g,'')===phoneClean);
      if(dup){
        const warn = document.getElementById('qr-phone-warn');
        if(warn){ warn.style.display='block'; warn.textContent='\u26A0\uFE0F Telefone j\u00E1 cadastrado para: '+dup.name+'. Selecione o cliente existente.'; }
        return toast('\u26A0\uFE0F Telefone j\u00E1 cadastrado para '+dup.name, true);
      }
      try{
        const validUnits=['Loja Novo Aleixo','Loja Allegro Mall','CDLE'];
        const cUnit=validUnits.includes(S.user?.unit)?S.user.unit:'Loja Novo Aleixo';
        const qrCode='CLI-'+String(S.clients.length+1).padStart(3,'0');
        const payload={
          code: qrCode,
          name,
          phone,
          cpf: document.getElementById('qr-cpf')?.value?.trim()||'',
          birthday: document.getElementById('qr-bday')?.value||undefined,
          address: {
            street: document.getElementById('qr-street')?.value||'',
            number: document.getElementById('qr-number')?.value||'',
            neighborhood: document.getElementById('qr-neigh')?.value||'',
            city: 'Manaus',
            cep: document.getElementById('qr-cep')?.value||'',
          },
          unit: cUnit,
        };
        const c = await POST('/clients', payload);
        S.clients.unshift(c);
        PDV.clientId = c._id;
        PDV.clientName = c.name || name;
        PDV.clientPhone = c.phone || phone;
        if(payload.address.street){
          PDV.street = payload.address.street;
          PDV.number = payload.address.number;
          PDV.neighborhood = payload.address.neighborhood;
          PDV.city = 'Manaus';
          PDV.cep = payload.address.cep;
        }
        PDV.clientSearch = '';
        PDV._showQuickReg = false;
        render();
        toast('\u2705 Cliente '+name+' cadastrado!');
      }catch(e){ toast('\u274C Erro ao cadastrar: '+(e.message||''), true); }
    };}
    document.getElementById('pdv-city-sel')?.addEventListener('change',e=>{PDV.city=e.target.value;PDV.zone='';PDV.deliveryFee=0;render();});
    document.getElementById('pdv-zone-sel')?.addEventListener('change',e=>{PDV.zone=e.target.value;if(PDV.city&&e.target.value&&DELIVERY_FEES[PDV.city]){PDV.deliveryFee=DELIVERY_FEES[PDV.city][e.target.value]||0;}render();});
    // ── Autocomplete de produtos no PDV ────────────────────────
    (() => {
      const pdvSearchInput = document.getElementById('pdv-prod-search');
      const suggBox = document.getElementById('pdv-prod-suggestions');
      if(!pdvSearchInput || !suggBox) return;
      let _pdvSearchTimer = null;
      let _pdvHighlight = -1;
      let _pdvCurrentResults = [];

      const addProdToCart = (prod, colorChoice) => {
        if(!prod) return;
        const colors = Array.isArray(prod.colors) ? prod.colors : [];
        // Se tem variacoes de cor e ainda nao escolheu, mostra modal
        if (colors.length > 0 && !colorChoice) {
          showColorPicker(prod);
          return;
        }
        const id = prod._id + (colorChoice ? ':' + colorChoice.name : '');
        const baseName = prod.name || prod.nome || '';
        const name = colorChoice ? `${baseName} (${colorChoice.name})` : baseName;
        const basePrice = prod.salePrice || prod.preco || 0;
        const price = basePrice + (colorChoice?.priceAdjust || 0);
        const ex = PDV.cart.find(i => i.id === id);
        if(ex) PDV.cart = PDV.cart.map(i => i.id === id ? {...i, qty: i.qty + 1} : i);
        else PDV.cart.push({id, name, price, qty: 1, colorName: colorChoice?.name, colorHex: colorChoice?.hex});
        render();
      };

      // Modal simples de seleção de cor
      const showColorPicker = (prod) => {
        const colors = prod.colors || [];
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
        const baseName = prod.name || prod.nome || '';
        const basePrice = prod.salePrice || prod.preco || 0;
        overlay.innerHTML = `
          <div style="background:#fff;border-radius:16px;max-width:480px;width:100%;overflow:hidden;box-shadow:0 25px 70px rgba(0,0,0,.3);">
            <div style="background:#C8736A;color:#fff;padding:14px 20px;display:flex;justify-content:space-between;align-items:center;">
              <strong>🎨 Escolha a cor — ${baseName}</strong>
              <button data-cp-close style="background:rgba(255,255,255,.25);color:#fff;border:none;width:30px;height:30px;border-radius:50%;font-size:16px;cursor:pointer;">×</button>
            </div>
            <div style="padding:20px;display:grid;grid-template-columns:1fr 1fr;gap:10px;">
              ${colors.map((c, i) => {
                const totalP = (basePrice + (c.priceAdjust||0)).toFixed(2).replace('.', ',');
                const sem = (c.stock||0) === 0;
                const cImg = c.image || c.imagem || '';
                const visual = cImg
                  ? `<img src="${cImg}" style="width:80px;height:80px;border-radius:10px;object-fit:cover;border:2px solid ${c.hex||'#ccc'};"/>`
                  : `<div style="width:60px;height:60px;border-radius:50%;background:${c.hex||'#ccc'};border:2px solid #fff;box-shadow:0 0 0 2px rgba(0,0,0,.08);"></div>`;
                return `<button data-cp-color="${i}" ${sem?'disabled':''} style="background:#fff;border:2px solid ${c.hex||'#ccc'};border-radius:12px;padding:14px 12px;cursor:${sem?'not-allowed':'pointer'};display:flex;flex-direction:column;align-items:center;gap:8px;opacity:${sem?0.45:1};">
                  ${visual}
                  <div style="font-weight:700;font-size:13px;color:#1F2937;">${c.name}</div>
                  <div style="font-size:11px;color:#6B7280;">R$ ${totalP}${(c.priceAdjust||0)!==0 ? ` <span style="color:${c.priceAdjust>0?'#D97706':'#059669'};">(${c.priceAdjust>0?'+':''}${c.priceAdjust.toFixed(2).replace('.',',')})</span>` : ''}</div>
                  <div style="font-size:10px;color:${sem?'var(--red)':'var(--leaf)'};">${sem?'Sem estoque':`${c.stock} em estoque`}</div>
                </button>`;
              }).join('')}
            </div>
          </div>`;
        document.body.appendChild(overlay);
        const close = () => overlay.remove();
        overlay.addEventListener('click', e => { if(e.target===overlay) close(); });
        overlay.querySelector('[data-cp-close]')?.addEventListener('click', close);
        overlay.querySelectorAll('[data-cp-color]').forEach(b => {
          b.onclick = () => {
            const c = colors[parseInt(b.dataset.cpColor)];
            close();
            addProdToCart(prod, c);
          };
        });
      };

      const renderSuggestions = (filtered) => {
        _pdvCurrentResults = filtered;
        _pdvHighlight = -1;
        if(filtered.length === 0){
          suggBox.innerHTML = '<div style="padding:16px;text-align:center;color:#94A3B8;font-size:13px;">Nenhum produto encontrado</div>';
          suggBox.style.display = 'block';
          return;
        }
        suggBox.innerHTML = filtered.map(p => {
          const img = (Array.isArray(p.images) && p.images[0]) || p.image || p.imagem || '';
          const cat = p.categoria || p.category || (Array.isArray(p.categories) ? p.categories[0] : '') || 'Sem categoria';
          const price = (p.salePrice || p.preco || 0).toFixed(2).replace('.', ',');
          const name = p.name || p.nome || '';
          return `<div class="pdv-sugg" data-add-prod="${p._id}" style="display:flex;align-items:center;gap:12px;padding:10px 12px;cursor:pointer;border-bottom:1px solid #F1F5F9;transition:background .15s;" onmouseover="this.style.background='#FAE8E6'" onmouseout="this.style.background='#fff'">
            ${img ? `<img src="${img}" style="width:48px;height:48px;border-radius:8px;object-fit:cover;flex-shrink:0;"/>` : `<div style="width:48px;height:48px;border-radius:8px;background:#FAE8E6;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">\uD83C\uDF38</div>`}
            <div style="flex:1;min-width:0;">
              <div style="font-weight:600;font-size:13px;color:#1E293B;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name}</div>
              <div style="font-size:10px;color:#94A3B8;margin-top:2px;">${cat}</div>
            </div>
            <div style="font-weight:700;font-size:15px;color:#C8736A;flex-shrink:0;">R$ ${price}</div>
          </div>`;
        }).join('');
        suggBox.style.display = 'block';
      };

      const updateHighlight = () => {
        const rows = suggBox.querySelectorAll('[data-add-prod]');
        rows.forEach((r, idx) => {
          r.style.background = idx === _pdvHighlight ? '#FAE8E6' : '#fff';
          if(idx === _pdvHighlight) r.scrollIntoView({block:'nearest'});
        });
      };

      pdvSearchInput.addEventListener('input', (e) => {
        clearTimeout(_pdvSearchTimer);
        const q = e.target.value.trim().toLowerCase();
        if(!q){
          suggBox.style.display = 'none';
          suggBox.innerHTML = '';
          _pdvCurrentResults = [];
          return;
        }
        _pdvSearchTimer = setTimeout(() => {
          // Normalizacao agressiva: lowercase, remove acentos/diacriticos,
          // pontuacao, colapsa espacos. 'Rósa-Único!!' → 'rosa unico'
          const norm = (s) => String(s||'')
            .toLowerCase()
            .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove acentos
            .replace(/[^\w\s]/g, ' ')   // pontuacao -> espaco
            .replace(/\s+/g, ' ').trim();

          // Lemmatizacao basica PT-BR: tira terminacao 's' (plural).
          // 'rosas' e 'rosa' batem; 'unidades' e 'unidade' batem.
          const stem = (w) => {
            if (w.length > 3 && w.endsWith('s')) return w.slice(0, -1);
            return w;
          };
          const tokenize = (s) => norm(s).split(' ').filter(Boolean).map(stem);

          const qTokens = tokenize(q);

          // Pre-indexa cada produto (lazy, so se nao tem cache)
          const filtered = S.products
            .filter(p => {
              // PDV: so esconde se EXPLICITAMENTE marcado como arquivado.
              // Nao filtra mais por active/ativo (legacy desativava produtos
              // novos por engano).
              if (p.archived === true) return false;
              const name = (p.name || p.nome || '');
              const sku  = (p.sku || p.code || '');
              const cat  = (p.categoria || p.category || (Array.isArray(p.categories) ? p.categories[0] : '') || '');
              const desc = (p.descricao || p.description || '');
              // Tokens do produto (todos os campos relevantes)
              const haystack = tokenize(name + ' ' + sku + ' ' + cat + ' ' + desc);
              // TODAS as palavras-tronco da busca precisam aparecer
              // como prefixo de algum token do produto. Permite:
              // 'ros' → encontra 'rosas', 'rosa', 'rosado'
              // 'unid' → encontra 'unidade', 'unidades'
              return qTokens.every(qt =>
                haystack.some(ht => ht.startsWith(qt) || ht.includes(qt))
              );
            })
            .sort((a, b) => {
              const an = norm(a.name || a.nome);
              const bn = norm(b.name || b.nome);
              const qNorm = norm(q);
              // Score: 0 = match exato, 1 = comeca com, 2 = contem inicio
              const score = (s) => {
                if (s === qNorm) return 0;
                if (s.startsWith(qNorm)) return 1;
                // Conta quantas palavras do nome batem em prefixo
                const bonus = qTokens.filter(qt => s.split(' ').some(w => w.startsWith(qt))).length;
                return bonus > 0 ? 2 - bonus*0.1 : 3;
              };
              const sa = score(an), sb = score(bn);
              if (sa !== sb) return sa - sb;
              return an.localeCompare(bn);
            })
            .slice(0, 20);

          if (filtered.length === 0) {
            console.log(`[pdv-search] "${q}" → 0 resultados local. Buscando no backend...`);
            // Fallback: busca no backend (regex case-insensitive)
            // Cobre o caso de produtos novos ainda nao sincronizados em S.products
            renderSuggestions([]); // loading
            suggBox.innerHTML = '<div style="padding:16px;text-align:center;color:#94A3B8;font-size:13px;">Buscando no servidor...</div>';
            suggBox.style.display = 'block';
            const tk = S.token||localStorage.getItem('fv2_token')||'';
            fetch(API+'/products?search='+encodeURIComponent(q)+'&limit=20',{
              headers:{'Authorization':'Bearer '+tk}
            }).then(r => r.ok ? r.json() : []).then(remote => {
              if (!Array.isArray(remote)) remote = [];
              // Adiciona ao S.products os que ainda nao existem
              for (const p of remote) {
                const exists = S.products.find(x => String(x._id||x.id) === String(p._id));
                if (!exists) S.products.push(p);
              }
              const ativos = remote.filter(p => p.archived !== true);
              console.log(`[pdv-search] backend retornou ${remote.length} (${ativos.length} ativos)`);
              renderSuggestions(ativos.slice(0, 20));
            }).catch(()=>{
              renderSuggestions([]);
            });
            return;
          }
          renderSuggestions(filtered);
        }, 300);
      });

      pdvSearchInput.addEventListener('keydown', (e) => {
        if(suggBox.style.display === 'none' || _pdvCurrentResults.length === 0) return;
        if(e.key === 'ArrowDown'){
          e.preventDefault();
          _pdvHighlight = Math.min(_pdvHighlight + 1, _pdvCurrentResults.length - 1);
          updateHighlight();
        } else if(e.key === 'ArrowUp'){
          e.preventDefault();
          _pdvHighlight = Math.max(_pdvHighlight - 1, -1);
          updateHighlight();
        } else if(e.key === 'Enter'){
          e.preventDefault();
          const idx = _pdvHighlight >= 0 ? _pdvHighlight : 0;
          const prod = _pdvCurrentResults[idx];
          if(prod){
            addProdToCart(prod);
            pdvSearchInput.value = '';
            suggBox.style.display = 'none';
            suggBox.innerHTML = '';
            _pdvCurrentResults = [];
            pdvSearchInput.focus();
          }
        } else if(e.key === 'Escape'){
          suggBox.style.display = 'none';
        }
      });

      suggBox.addEventListener('click', (e) => {
        const row = e.target.closest('[data-add-prod]');
        if(!row) return;
        const pid = row.dataset.addProd;
        const prod = S.products.find(p => p._id === pid);
        if(!prod) return;
        addProdToCart(prod);
        pdvSearchInput.value = '';
        suggBox.style.display = 'none';
        suggBox.innerHTML = '';
        _pdvCurrentResults = [];
        pdvSearchInput.focus();
      });

      // Click outside closes dropdown (instala uma única vez)
      if(!window._pdvOutsideHandlerInstalled){
        window._pdvOutsideHandlerInstalled = true;
        document.addEventListener('click', (e) => {
          const box = document.getElementById('pdv-prod-suggestions');
          const input = document.getElementById('pdv-prod-search');
          if(box && input && !box.contains(e.target) && e.target !== input){
            box.style.display = 'none';
          }
        });
      }
    })();
    document.querySelectorAll('[data-dec]').forEach(b=>{const id=b.dataset.dec;b.onclick=()=>{PDV.cart=PDV.cart.map(i=>i.id===id?{...i,qty:i.qty-1}:i).filter(i=>i.qty>0);render();};});
    document.querySelectorAll('[data-inc]').forEach(b=>{const id=b.dataset.inc;b.onclick=()=>{PDV.cart=PDV.cart.map(i=>i.id===id?{...i,qty:i.qty+1}:i);render();};});
    document.querySelectorAll('[data-type]').forEach(b=>{b.onclick=()=>{PDV.type=b.dataset.type;render();};});
    document.getElementById('pdv-condo')?.addEventListener('change',e=>{PDV.isCondominium=e.target.checked;render();});
    document.getElementById('pdv-cond-name')?.addEventListener('input',e=>{PDV.condName=e.target.value});
    document.getElementById('pdv-time-from')?.addEventListener('change',e=>{PDV.deliveryTimeFrom=e.target.value});
    document.getElementById('pdv-time-to')?.addEventListener('change',e=>{PDV.deliveryTimeTo=e.target.value});
    document.querySelectorAll('[data-pod]').forEach(b=>{b.onclick=()=>{PDV.paymentOnDelivery=b.dataset.pod;if(b.dataset.pod!=='Dinheiro')PDV.trocoPara='';render();};});
    // Troco
    {const _el=document.getElementById('pdv-troco-para');if(_el){
      _el.addEventListener('input',e=>{PDV.trocoPara=e.target.value;});
      _el.addEventListener('change',e=>{PDV.trocoPara=e.target.value;render();});
    }}
    {const _el=document.getElementById('pdv-troco-sem');if(_el)_el.onclick=()=>{PDV.trocoPara='0';render();};}
    document.querySelectorAll('[data-pay]').forEach(b=>{b.onclick=()=>{PDV.payment=b.dataset.pay;PDV.paymentOnDelivery='';render();};});
    document.getElementById('pdv-sale-unit')?.addEventListener('change',e=>{PDV.saleUnit=e.target.value});
    document.getElementById('pdv-sales-channel')?.addEventListener('change',e=>{PDV.salesChannel=e.target.value;render();});
    document.getElementById('pdv-notify')?.addEventListener('change',e=>{PDV.notifyClient=e.target.checked});
    document.getElementById('pdv-identify')?.addEventListener('change',e=>{PDV.identifyClient=e.target.checked});
    document.getElementById('pdv-pickup-unit')?.addEventListener('change',e=>{PDV.pickupUnit=e.target.value});
    ['pdv-client','pdv-cname','pdv-cphone','pdv-recipient','pdv-recip-phone','pdv-cardmsg','pdv-notes','pdv-date','pdv-period','pdv-time','pdv-street','pdv-number','pdv-neighborhood','pdv-city','pdv-cep','pdv-ref','pdv-block','pdv-apt','pdv-disc'].forEach(id=>{
      const el=document.getElementById(id);if(!el)return;
      const map={'pdv-client':'clientId','pdv-cname':'clientName','pdv-cphone':'clientPhone','pdv-recipient':'recipient','pdv-recip-phone':'recipientPhone','pdv-cardmsg':'cardMessage','pdv-notes':'notes','pdv-date':'deliveryDate','pdv-period':'deliveryPeriod','pdv-time':'deliveryTime','pdv-street':'street','pdv-number':'number','pdv-neighborhood':'neighborhood','pdv-city':'city','pdv-cep':'cep','pdv-ref':'reference','pdv-block':'block','pdv-apt':'apt','pdv-disc':'discount','pdv-pay':'payment','pdv-pickup-unit':'pickupUnit'};
      const key=map[id];
      el.addEventListener('change',e=>{PDV[key]=key==='discount'?parseFloat(e.target.value)||0:e.target.value;if(['deliveryPeriod','payment'].includes(key)){if(key==='payment')PDV.paymentOnDelivery='';render();}});
      el.addEventListener('input',e=>{PDV[key]=key==='discount'?parseFloat(e.target.value)||0:e.target.value});
    });
    {const _el=document.getElementById('btn-fin');if(_el)_el.onclick=finalizePDV;}

    // Atalhos "Hoje" e "Amanhã" para data de entrega
    const _setPdvDate = (offsetDays)=>{
      const d = new Date();
      d.setDate(d.getDate() + offsetDays);
      const y = d.getFullYear();
      const m = String(d.getMonth()+1).padStart(2,'0');
      const dd = String(d.getDate()).padStart(2,'0');
      PDV.deliveryDate = `${y}-${m}-${dd}`;
      const inp = document.getElementById('pdv-date');
      if(inp) inp.value = PDV.deliveryDate;
    };
    {const _el=document.getElementById('pdv-date-hoje');if(_el)_el.onclick=()=>_setPdvDate(0);}
    {const _el=document.getElementById('pdv-date-amanha');if(_el)_el.onclick=()=>_setPdvDate(1);}

    // ── ViaCEP: preenchimento automático de rua/bairro ────────────
    (function setupCepLookup(){
      const cepInput = document.getElementById('pdv-cep');
      if(!cepInput) return;

      const statusEl = document.getElementById('pdv-cep-status');
      const msgEl = document.getElementById('pdv-cep-msg');
      let lastCep = '';

      // Formatar visualmente: 69000-000
      const formatCep = (v) => {
        const d = (v||'').replace(/\D/g,'').slice(0,8);
        if(d.length>5) return d.slice(0,5)+'-'+d.slice(5);
        return d;
      };

      const showMsg = (text, type='info') => {
        if(!msgEl) return;
        const colors = {
          info:  {bg:'#DBEAFE', color:'#1E40AF', border:'#93C5FD'},
          ok:    {bg:'#D1FAE5', color:'#065F46', border:'#6EE7B7'},
          warn:  {bg:'#FEF3C7', color:'#92400E', border:'#FCD34D'},
          error: {bg:'#FEE2E2', color:'#991B1B', border:'#FCA5A5'},
        }[type] || {};
        msgEl.style.display = 'block';
        msgEl.style.background = colors.bg;
        msgEl.style.color = colors.color;
        msgEl.style.border = '1px solid '+colors.border;
        msgEl.style.borderRadius = '6px';
        msgEl.style.padding = '5px 8px';
        msgEl.innerHTML = text;
      };

      const hideMsg = () => { if(msgEl) msgEl.style.display='none'; };

      cepInput.addEventListener('input', async (e) => {
        // Formatar em tempo real
        const formatted = formatCep(e.target.value);
        if(formatted !== e.target.value){
          const pos = e.target.selectionStart;
          e.target.value = formatted;
          PDV.cep = formatted;
          try { e.target.setSelectionRange(pos+1, pos+1); } catch(_){}
        } else {
          PDV.cep = formatted;
        }

        const digits = formatted.replace(/\D/g,'');

        // Esconde msg se ainda não completou 8 dígitos
        if(digits.length < 8){
          hideMsg();
          if(statusEl) statusEl.textContent = '';
          lastCep = '';
          return;
        }

        // Evita re-consultar mesmo CEP
        if(digits === lastCep) return;
        lastCep = digits;

        // Valida faixa de Manaus-AM: 69000-000 a 69099-999
        const num = parseInt(digits, 10);
        const inManausRange = num >= 69000000 && num <= 69099999;

        // Loading
        if(statusEl) statusEl.innerHTML = '<span style="color:#94A3B8;">⏳</span>';
        showMsg('🔍 Buscando endereço...', 'info');

        try {
          const res = await fetch('https://viacep.com.br/ws/'+digits+'/json/', {
            signal: AbortSignal.timeout(8000)
          });
          const data = await res.json();

          if(data.erro){
            if(statusEl) statusEl.innerHTML = '<span style="color:#DC2626;">⚠️</span>';
            showMsg('❌ CEP não encontrado. Preencha manualmente.', 'error');
            return;
          }

          // Alerta se fora de Manaus
          if(!inManausRange){
            if(statusEl) statusEl.innerHTML = '<span style="color:#D97706;">⚠️</span>';
            const cidadeDetectada = data.localidade || '—';
            if(!confirm(`⚠️ CEP fora da área cadastrada (Manaus-AM).\n\nCEP pertence a: ${cidadeDetectada}/${data.uf||''}\n\nDeseja preencher o endereço mesmo assim?`)){
              showMsg('🚫 CEP fora de Manaus — preencha manualmente', 'warn');
              return;
            }
          }

          // Preenche rua e bairro (não preenche número nem complemento)
          const rua = data.logradouro || '';
          const bairro = data.bairro || '';

          const streetEl = document.getElementById('pdv-street');
          const neighEl = document.getElementById('pdv-neighborhood');

          if(rua){
            if(streetEl) streetEl.value = rua;
            PDV.street = rua;
          }
          if(bairro){
            if(neighEl) neighEl.value = bairro;
            PDV.neighborhood = bairro;
          }

          if(statusEl) statusEl.innerHTML = '<span style="color:#059669;">✓</span>';
          if(rua || bairro){
            showMsg(`✅ Endereço preenchido: <strong>${rua||'(sem rua)'}</strong>${bairro?' — '+bairro:''}`, 'ok');
            // Foca no campo número pra agilizar preenchimento
            setTimeout(()=>document.getElementById('pdv-number')?.focus(), 100);
          } else {
            showMsg('⚠️ CEP válido mas sem rua/bairro cadastrados. Preencha manualmente.', 'warn');
          }
        } catch(err){
          if(statusEl) statusEl.innerHTML = '<span style="color:#DC2626;">⚠️</span>';
          showMsg('❌ Erro ao consultar CEP. Preencha manualmente.', 'error');
        }
      });
    })();
  }

  // ── Relatórios ────────────────────────────────────────────────
  if(S.page==='relatorios'){
    document.querySelectorAll('[data-rel-period]').forEach(b=>{b.onclick=()=>{S._relPeriod=b.dataset.relPeriod;render();};});
    document.querySelectorAll('[data-rel-tab]').forEach(b=>{b.onclick=()=>{S._relTab=b.dataset.relTab;render();};});
    document.getElementById('rel-unit-filter')?.addEventListener('change',e=>{S._relUnit=e.target.value;render();});
    // Filtro por datas especificas (aparece quando period==='custom')
    document.getElementById('rel-date-1')?.addEventListener('change',e=>{ S._relDate1 = e.target.value; render(); });
    document.getElementById('rel-date-2')?.addEventListener('change',e=>{ S._relDate2 = e.target.value; render(); });
    document.getElementById('rel-date-clear')?.addEventListener('click',()=>{ S._relDate1=''; S._relDate2=''; render(); });
    document.getElementById('rel-driver-filter')?.addEventListener('change',e=>{S._relDriver=e.target.value;render();});
    document.getElementById('rel-colab-filter')?.addEventListener('change',e=>{S._relColab=e.target.value;render();});
    // Vendas por Unidade
    document.getElementById('rep-prod-filter')?.addEventListener('input', e => {
      clearTimeout(window._repProdTimer);
      window._repProdTimer = setTimeout(() => { S._relProdFilter = e.target.value; render(); }, 350);
    });
    document.getElementById('rep-val-min')?.addEventListener('change', e => { S._relValMin = e.target.value; render(); });
    document.getElementById('rep-val-max')?.addEventListener('change', e => { S._relValMax = e.target.value; render(); });
    document.getElementById('rep-pag-filter')?.addEventListener('change', e => { S._relPagFilter = e.target.value; render(); });
    document.getElementById('rep-date1')?.addEventListener('change', e => { S._relTabDate1 = e.target.value; render(); });
    document.getElementById('rep-date2')?.addEventListener('change', e => { S._relTabDate2 = e.target.value; render(); });
    document.getElementById('btn-rep-vu-clear')?.addEventListener('click', () => {
      S._relProdFilter = ''; S._relValMin = ''; S._relValMax = '';
      S._relPagFilter = ''; S._relTabDate1 = ''; S._relTabDate2 = '';
      render();
    });
    // Caixa Completo
    document.getElementById('rep-caixa-unit')?.addEventListener('change', e => { S._relCaixaUnit = e.target.value; render(); });
    document.getElementById('rep-caixa-pag') ?.addEventListener('change', e => { S._relCaixaPag  = e.target.value; render(); });
    document.getElementById('rep-caixa-prod')?.addEventListener('input', e => {
      clearTimeout(window._repCaixaTimer);
      window._repCaixaTimer = setTimeout(() => { S._relCaixaProd = e.target.value; render(); }, 350);
    });
    {const _el=document.getElementById('btn-export-pdf');if(_el)_el.onclick=()=>window.print();}
    document.querySelectorAll('[data-meta-per]').forEach(b=>{b.onclick=()=>{S._relMetaPer=b.dataset.metaPer;render();};});

    // ── Aba Alta Demanda: presets + filtros + exportar ──
    document.querySelectorAll('[data-rel-alta-preset]').forEach(b=>{
      b.onclick=()=>{ S._relAltaPreset=b.dataset.relAltaPreset; S._relAltaDate=''; render(); };
    });
    document.getElementById('rel-alta-date')?.addEventListener('change',e=>{ S._relAltaDate=e.target.value; render(); });
    document.getElementById('rel-alta-range')?.addEventListener('change',e=>{ S._relAltaRange=e.target.value; render(); });
    // Filtros com debounce (texto)
    const _altaDebounce = (id, key) => {
      const el = document.getElementById(id);
      if (!el) return;
      let t = null;
      el.addEventListener('input', e => {
        clearTimeout(t);
        t = setTimeout(()=>{ S[key]=e.target.value; render(); setTimeout(()=>{ const x=document.getElementById(id); if(x){x.focus();x.setSelectionRange(x.value.length,x.value.length);} },10); }, 300);
      });
    };
    _altaDebounce('rel-alta-prod','_relAltaProd');
    _altaDebounce('rel-alta-bairro','_relAltaBairro');
    document.getElementById('rel-alta-hora1')?.addEventListener('change',e=>{ S._relAltaHora1=e.target.value; render(); });
    document.getElementById('rel-alta-hora2')?.addEventListener('change',e=>{ S._relAltaHora2=e.target.value; render(); });
    document.getElementById('rel-alta-turno') ?.addEventListener('change',e=>{ S._relAltaTurno=e.target.value;  render(); });
    document.getElementById('rel-alta-prio')  ?.addEventListener('change',e=>{ S._relAltaPrio=e.target.value;   render(); });
    document.getElementById('rel-alta-status')?.addEventListener('change',e=>{ S._relAltaStatus=e.target.value; render(); });
    document.querySelectorAll('[data-rel-alta-secao]').forEach(b=>{
      b.onclick = () => { S._relAltaSecao = b.dataset.relAltaSecao; render(); };
    });
    document.getElementById('btn-rel-alta-clear')?.addEventListener('click',()=>{
      S._relAltaProd=''; S._relAltaBairro=''; S._relAltaHora1=''; S._relAltaHora2='';
      S._relAltaDate=''; S._relAltaTurno=''; S._relAltaPrio=''; S._relAltaStatus=''; render();
    });
    document.getElementById('btn-rel-alta-export')?.addEventListener('click',()=>{ try{ exportAltaDemandaCSV(); }catch(e){ console.error(e); } });
    const _si = document.getElementById('order-search-input');
    if(_si){
      let _searchTimer=null;
      _si.addEventListener('input', e=>{S._orderSearch=e.target.value;import('./utils/helpers.js').then(m=>m.triggerServerOrderSearch?.(e.target.value));clearTimeout(_searchTimer);_searchTimer=setTimeout(()=>{ render(); setTimeout(()=>{ const el=document.getElementById('order-search-input'); if(el){el.focus();el.setSelectionRange(el.value.length,el.value.length);} },10); }, 300);});
      _si.addEventListener('keydown', e=>{ if(e.key==='Escape'){S._orderSearch='';render();} if(e.key==='Enter'){clearTimeout(_searchTimer);render();} });
    }
    {const _el=document.getElementById('order-search-clear');if(_el)_el.onclick=()=>{S._orderSearch='';render();};}
  }

  // ── Caixa ─────────────────────────────────────────────────────
  if(S.page==='caixa'){
    try{ bindCaixaEvents(); }catch(e){ console.error('bindCaixaEvents', e); }
  }

  // ── Pedidos ───────────────────────────────────────────────────
  if(S.page==='pedidos'){
    // Dropdown inline para alterar Status de Pagamento direto na lista
    document.querySelectorAll('select[data-pay-status]').forEach(sel => {
      sel.addEventListener('change', async (e) => {
        e.stopPropagation();
        const orderId = sel.dataset.payStatus;
        const novo = sel.value;
        const antigo = sel.dataset.current;
        if (novo === antigo) return;
        const order = S.orders.find(o => o._id === orderId);
        const num = order?.orderNumber || order?.numero || orderId.slice(-5);
        if (!confirm(`Alterar pagamento do pedido ${num} de "${antigo}" para "${novo}"?`)) {
          sel.value = antigo;
          return;
        }
        try {
          const updated = await PUT('/orders/' + orderId, { paymentStatus: novo });
          // Atualiza estado local com o objeto retornado pelo backend
          if (updated && updated._id) {
            S.orders = S.orders.map(o => o._id === orderId ? { ...o, ...updated } : o);
          } else {
            S.orders = S.orders.map(o => o._id === orderId ? { ...o, paymentStatus: novo } : o);
          }
          sel.dataset.current = novo;
          toast(`✅ Pagamento atualizado: ${novo}`);
          // Re-render para refletir cor + sumir notificacao se aprovado
          render();
        } catch (err) {
          toast('❌ ' + (err.message || 'Erro ao atualizar'), true);
          sel.value = antigo;
        }
      });
      // Evita que clicar abrir o modal de visualizacao
      sel.addEventListener('click', e => e.stopPropagation());
    });
    document.querySelectorAll('[data-ped-status]').forEach(b=>{b.onclick=()=>{S._fStatus=b.dataset.pedStatus; render();};});
    document.querySelectorAll('[data-ped-turno]').forEach(b=>{b.onclick=()=>{S._fTurno=b.dataset.pedTurno; render();};});
    document.querySelectorAll('[data-ped-agrupar]').forEach(b=>{b.onclick=()=>{S._pedAgrupar=b.dataset.pedAgrupar; render();};});
    const todayStr=new Date().toISOString().split('T')[0];
    const tmrw=new Date(); tmrw.setDate(tmrw.getDate()+1);
    const tmrwStr=tmrw.toISOString().split('T')[0];
    {const _el=document.getElementById('btn-ped-hoje');if(_el)_el.onclick=()=>{S._fDate1=todayStr; S._fDate2=todayStr; render();};}
    {const _el=document.getElementById('btn-ped-amanha');if(_el)_el.onclick=()=>{S._fDate1=tmrwStr; S._fDate2=tmrwStr; render();};}
    document.getElementById('ped-date1')?.addEventListener('change',e=>{S._fDate1=e.target.value;render();});
    document.getElementById('ped-date2')?.addEventListener('change',e=>{S._fDate2=e.target.value;render();});
    const bairroInput = document.getElementById('ped-filter-bairro');
    if(bairroInput){
      bairroInput.addEventListener('change',e=>{S._fBairro=e.target.value;render();});
      bairroInput.addEventListener('keydown',e=>{ if(e.key==='Enter'){S._fBairro=e.target.value;render();} });
    }
    document.getElementById('ped-filter-unidade')?.addEventListener('change',e=>{S._fUnidade=e.target.value;render();});
    document.getElementById('ped-filter-canal')?.addEventListener('change',e=>{S._fCanal=e.target.value;render();});
    document.getElementById('ped-filter-prioridade')?.addEventListener('change',e=>{S._fPrioridade=e.target.value;render();});
    const clearFilters=()=>{S._fStatus='Todos';S._fBairro='';S._fTurno='';S._fUnidade='';S._fCanal='';S._fPrioridade='';S._fDate1='';S._fDate2='';S._orderSearch=''; render();};
    {const _el=document.getElementById('btn-clear-ped-filters');if(_el)_el.onclick=clearFilters;}
    {const _el=document.getElementById('btn-clear-ped-filters2');if(_el)_el.onclick=clearFilters;}
    {const _el=document.getElementById('btn-rel-orders');if(_el)_el.onclick=async()=>{S.loading=true;render();S.orders=await GET('/orders').catch(()=>S.orders);S.loading=false;render();};}
    // ── Import/Export pedidos (admin only) ──
    {const _bi=document.getElementById('btn-import-ped');if(_bi)_bi.onclick=()=>document.getElementById('file-import-ped')?.click();}
    {const _fi=document.getElementById('file-import-ped');if(_fi)_fi.onchange=async e=>{
      const file=e.target.files?.[0]; if(!file) return;
      try{
        const text=await file.text();
        const rows=file.name.toLowerCase().endsWith('.json')?JSON.parse(text):(function(t){const l=t.replace(/^\uFEFF/,'').split(/\r?\n/).filter(x=>x.trim());if(!l.length)return[];const h=l[0].split(';');return l.slice(1).map(ln=>{const v=ln.split(';');const o={};h.forEach((hh,i)=>o[hh.trim()]=(v[i]||'').trim());return o;});})(text);
        if(!Array.isArray(rows)||!rows.length) return toast('❌ Arquivo vazio ou invalido');
        let ok=0, fail=0;
        for(let i=0;i<rows.length;i++){
          toast(`📥 Importando ${i+1} de ${rows.length}...`);
          const r=rows[i];
          const payload={
            orderNumber: r.orderNumber||'',
            clientName: r.clientName||'',
            clientPhone: r.clientPhone||'',
            total: parseFloat(r.total||0)||0,
            status: r.status||'Aguardando',
            scheduledDate: r.scheduledDate||'',
            scheduledTime: r.scheduledTime||'',
            recipient: r.recipient||'',
            deliveryNeighborhood: r.deliveryNeighborhood||'',
            payment: r.payment||'',
          };
          try{ const o=await POST('/orders', payload); if(o?._id) S.orders.unshift(o); ok++; }catch(er){ fail++; }
        }
        render();
        toast(`✅ Importados: ${ok} · Falhas: ${fail}`);
      }catch(er){ toast('❌ Erro ao importar: '+(er.message||'')); }
      e.target.value='';
    };}
    {const _be=document.getElementById('btn-export-ped');if(_be)_be.onclick=()=>{
      const cols=['orderNumber','clientName','clientPhone','total','status','scheduledDate','scheduledTime','recipient','deliveryNeighborhood','payment'];
      const src=Array.isArray(S._filteredOrders)&&S._filteredOrders.length?S._filteredOrders:S.orders;
      const rows=src.map(o=>({
        orderNumber:o.orderNumber||'',
        clientName:o.clientName||o.client?.name||'',
        clientPhone:o.clientPhone||o.client?.phone||'',
        total:o.total||0,
        status:o.status||'',
        scheduledDate:o.scheduledDate||'',
        scheduledTime:o.scheduledTime||'',
        recipient:o.recipient||'',
        deliveryNeighborhood:o.deliveryNeighborhood||o.deliveryZone||'',
        payment:o.payment||'',
      }));
      const header=cols.join(';');
      const body=rows.map(r=>cols.map(c=>{const s=String(r[c]??'').replace(/"/g,'""');return /[;"\n]/.test(s)?`"${s}"`:s;}).join(';')).join('\n');
      const csv='\uFEFF'+header+'\n'+body;
      const blob=new Blob([csv],{type:'text/csv'});
      const url=URL.createObjectURL(blob);
      const a=document.createElement('a');
      a.href=url; a.download='pedidos-'+new Date().toISOString().split('T')[0]+'.csv'; a.click();
      URL.revokeObjectURL(url);
      toast('✅ Exportados '+rows.length+' pedidos');
    };}
    document.querySelectorAll('[data-view-order]').forEach(b=>{b.onclick=()=>showOrderViewModal(b.dataset.viewOrder);});
    document.querySelectorAll('[data-edit-order]').forEach(b=>{b.onclick=()=>{
      if (typeof window._tryEditOrder === 'function') window._tryEditOrder(b.dataset.editOrder);
      else showEditOrderModal(b.dataset.editOrder);
    };});
    document.querySelectorAll('[data-print-comanda]').forEach(b=>{b.onclick=()=>printComanda(b.dataset.printComanda);});
    document.querySelectorAll('[data-nfe]').forEach(b=>{b.onclick=()=>showFiscalModal(b.dataset.nfe,'NF-e');});
    document.querySelectorAll('[data-nfce]').forEach(b=>{b.onclick=()=>showFiscalModal(b.dataset.nfce,'NFC-e');});
    document.querySelectorAll('[data-adv]').forEach(b=>{b.onclick=()=>advanceOrder(b.dataset.adv);});
    const _si = document.getElementById('order-search-input');
    if(_si){
      let _searchTimer=null;
      _si.addEventListener('input', e=>{S._orderSearch=e.target.value;import('./utils/helpers.js').then(m=>m.triggerServerOrderSearch?.(e.target.value));clearTimeout(_searchTimer);_searchTimer=setTimeout(()=>{ render(); setTimeout(()=>{ const el=document.getElementById('order-search-input'); if(el){el.focus();el.setSelectionRange(el.value.length,el.value.length);} },10); }, 300);});
      _si.addEventListener('keydown', e=>{ if(e.key==='Escape'){S._orderSearch='';render();} if(e.key==='Enter'){clearTimeout(_searchTimer);render();} });
    }
    {const _el=document.getElementById('order-search-clear');if(_el)_el.onclick=()=>{S._orderSearch='';render();};}
  }

  // ── Clientes ──────────────────────────────────────────────────
  if(S.page==='clientes'){
    try{ bindClientesEvents(); }catch(e){ console.error('bindClientesEvents', e); }
  }

  // ── Produtos ──────────────────────────────────────────────────
  if(S.page==='produtos'){
    // Lazy-load das imagens dos produtos visiveis (placeholder -> img real)
    // Backend nao manda mais base64 na listagem (pesado demais), entao
    // buscamos thumbnails dos produtos na tela em lotes de 60.
    setTimeout(() => {
      try{
        const phs = Array.from(document.querySelectorAll('.prod-img-placeholder[data-pid]')).slice(0, 60);
        const ids = phs.map(el => el.dataset.pid).filter(Boolean);
        if (!ids.length) return;
        // Filtra IDs ja com imagem em S.products
        const need = ids.filter(id => {
          const p = S.products.find(x => String(x._id||x.id) === String(id));
          return p && !(p.imagem || p.images?.[0] || p.image);
        });
        if (!need.length) return;
        fetch(API+'/products/images?ids='+encodeURIComponent(need.join(',')), {
          headers:{ 'Authorization':'Bearer '+(S.token||localStorage.getItem('fv2_token')||'') }
        }).then(r => r.ok ? r.json() : {}).then(map => {
          let touched = 0;
          for (const id of Object.keys(map||{})){
            const p = S.products.find(x => String(x._id||x.id) === String(id));
            if (p && map[id]) { p.imagem = map[id]; touched++; }
          }
          if (touched) render();
        }).catch(()=>{});
      }catch(_){}
    }, 50);
    {const _el=document.getElementById('btn-new-prod');if(_el)_el.onclick=()=>showNewProductModal();}
    {const _el=document.getElementById('btn-new-prod2');if(_el)_el.onclick=()=>showNewProductModal();}
    {const _el=document.getElementById('btn-rel-prods');if(_el)_el.onclick=async()=>{S.loading=true;render();const pr=await GET('/products').catch(()=>null);if(pr?.length){S.products=pr;saveCachedData();}S.loading=false;render();toast('✅ '+S.products.length+' produtos carregados');};}
    // ── Advanced search / filters ──
    {const _el=document.getElementById('prod-search');if(_el){
      // Debounce input (300ms) to avoid re-rendering 560 products on every keystroke
      let _prodSearchTimer = null;
      _el.addEventListener('input', e=>{
        S._prodSearch = e.target.value;
        S._prodLimit = 50; // reset pagination when search changes
        clearTimeout(_prodSearchTimer);
        _prodSearchTimer = setTimeout(()=>render(), 300);
      });
      _el.addEventListener('keydown', e=>{
        if(e.key==='Escape'){ clearTimeout(_prodSearchTimer); S._prodSearch=''; S._prodLimit=50; render(); }
        if(e.key==='Enter'){ clearTimeout(_prodSearchTimer); render(); }
      });
      // Keep focus & caret at end after re-render while user is typing
      if(S._prodSearch){ _el.focus(); const v=_el.value; try{ _el.setSelectionRange(v.length,v.length); }catch(_e){} }
    }}
    {const _el=document.getElementById('prod-filter-cat');if(_el)_el.addEventListener('change', e=>{ S._prodCat = e.target.value; S._prodLimit = 50; render(); });}
    {const _el=document.getElementById('prod-filter-status');if(_el)_el.addEventListener('change', e=>{ S._prodStatus = e.target.value; S._prodLimit = 50; render(); });}
    {const _el=document.getElementById('btn-clear-filters');if(_el)_el.onclick=()=>{ S._prodSearch=''; S._prodCat=''; S._prodStatus=''; S._prodLimit=50; render(); };}
    // ── "Mostrar mais" button: incrementally render more products ──
    {const _el=document.getElementById('btn-prod-more');if(_el)_el.onclick=()=>{
      S._prodLimit = (S._prodLimit || 50) + 50;
      render();
    };}
    // ── Import/Export (admin only) ──
    {const _bi=document.getElementById('btn-import-prod');if(_bi)_bi.onclick=()=>document.getElementById('file-import-prod')?.click();}
    {const _fi=document.getElementById('file-import-prod');if(_fi)_fi.onchange=async e=>{
      const file=e.target.files?.[0]; if(!file) return;
      try{
        const text=await file.text();
        const rows=file.name.toLowerCase().endsWith('.json')?JSON.parse(text):(function(t){const l=t.replace(/^\uFEFF/,'').split(/\r?\n/).filter(x=>x.trim());if(!l.length)return[];const h=l[0].split(';');return l.slice(1).map(ln=>{const v=ln.split(';');const o={};h.forEach((hh,i)=>o[hh.trim()]=(v[i]||'').trim());return o;});})(text);
        if(!Array.isArray(rows)||!rows.length) return toast('❌ Arquivo vazio ou invalido');
        let ok=0, fail=0;
        for(let i=0;i<rows.length;i++){
          toast(`📥 Importando ${i+1} de ${rows.length}...`);
          const r=rows[i];
          const payload={
            name: r.nome||r.name||'',
            category: r.categorias||r.category||'',
            salePrice: parseFloat(r.preco||r.salePrice||0)||0,
            costPrice: parseFloat(r.custo||r.costPrice||0)||0,
            stock: parseInt(r.estoque||r.stock||0)||0,
            minStock: parseInt(r.estoqueMinimo||r.minStock||5)||5,
            code: r.sku||r.code||'',
            description: r.descricao||r.description||'',
            activeOnSite: String(r.ativo||r.activeOnSite||'').toLowerCase()==='true'||r.ativo===true,
          };
          if(!payload.name){ fail++; continue; }
          try{ const p=await POST('/products', payload); if(p?._id) S.products.unshift(p); ok++; }catch(er){ fail++; }
        }
        saveCachedData();
        render();
        toast(`✅ Importados: ${ok} · Falhas: ${fail}`);
      }catch(er){ toast('❌ Erro ao importar: '+(er.message||'')); }
      e.target.value='';
    };}
    {const _be=document.getElementById('btn-export-prod');if(_be)_be.onclick=()=>{
      const cols=['nome','categorias','preco','custo','estoque','estoqueMinimo','sku','descricao','ativo'];
      const source = Array.isArray(S._prodFiltered) ? S._prodFiltered : S.products;
      const rows=source.map(p=>({
        nome:p.name||'', categorias:(Array.isArray(p.categories)&&p.categories.length?p.categories.join(','):(p.category||'')),
        preco:p.salePrice||0, custo:p.costPrice||0,
        estoque:p.stock||0, estoqueMinimo:p.minStock||0,
        sku:p.code||'', descricao:p.description||'',
        ativo:p.activeOnSite?'true':'false',
      }));
      const header=cols.join(';');
      const body=rows.map(r=>cols.map(c=>{const s=String(r[c]??'').replace(/"/g,'""');return /[;"\n]/.test(s)?`"${s}"`:s;}).join(';')).join('\n');
      const csv='\uFEFF'+header+'\n'+body;
      const blob=new Blob([csv],{type:'text/csv'});
      const url=URL.createObjectURL(blob);
      const a=document.createElement('a');
      a.href=url; a.download='produtos-'+new Date().toISOString().split('T')[0]+'.csv'; a.click();
      URL.revokeObjectURL(url);
      toast('✅ Exportados '+rows.length+' produtos');
    };}
    document.querySelectorAll('[data-edit-prod]').forEach(b=>{b.onclick=()=>{const p=S.products.find(x=>x._id===b.dataset.editProd);if(p)showNewProductModal(p);};});
    document.querySelectorAll('[data-stock-prod]').forEach(b=>{b.onclick=()=>showProductStockModal(b.dataset.stockProd);});
    document.querySelectorAll('[data-del-prod]').forEach(b=>{b.onclick=()=>deleteProduct(b.dataset.delProd);});
  }

  // ── Produção ──────────────────────────────────────────────────
  if(S.page==='producao'){
    // Lazy-load das imagens dos produtos visiveis na producao (ate 80)
    setTimeout(() => {
      try{
        const phs = Array.from(document.querySelectorAll('.prod-img-placeholder-prod[data-pid]')).slice(0, 80);
        const ids = Array.from(new Set(phs.map(el => el.dataset.pid).filter(Boolean)));
        const need = ids.filter(id => {
          const p = S.products.find(x => String(x._id||x.id) === String(id));
          return p && !(p.imagem || p.images?.[0] || p.image);
        });
        if (!need.length) return;
        fetch(API+'/products/images?ids='+encodeURIComponent(need.join(',')), {
          headers:{ 'Authorization':'Bearer '+(S.token||localStorage.getItem('fv2_token')||'') }
        }).then(r => r.ok ? r.json() : {}).then(map => {
          let touched = 0;
          for (const id of Object.keys(map||{})){
            const p = S.products.find(x => String(x._id||x.id) === String(id));
            if (p && map[id]) { p.imagem = map[id]; touched++; }
          }
          if (touched) render();
        }).catch(()=>{});
      }catch(_){}
    }, 50);
    {const _el=document.getElementById('btn-rel-orders');if(_el)_el.onclick=async()=>{S.loading=true;render();S.orders=await GET('/orders');S.loading=false;render();};}
    {const _el=document.getElementById('btn-prod-today');if(_el)_el.onclick=()=>{S._prodDate=new Date().toISOString().split('T')[0];render();};}
    document.getElementById('prod-date-picker')?.addEventListener('change',e=>{S._prodDate=e.target.value;render();});
    document.querySelectorAll('[data-shift]').forEach(b=>{b.onclick=()=>{S._prodShift=b.dataset.shift;render();};});
    document.querySelectorAll('[data-prod-start]').forEach(b=>{b.onclick=()=>advanceOrder(b.dataset.prodStart);});
    document.querySelectorAll('[data-prod-done]').forEach(b=>{b.onclick=()=>advanceOrder(b.dataset.prodDone);});
    const _si = document.getElementById('order-search-input');
    if(_si){
      let _searchTimer=null;
      _si.addEventListener('input', e=>{S._orderSearch=e.target.value;import('./utils/helpers.js').then(m=>m.triggerServerOrderSearch?.(e.target.value));clearTimeout(_searchTimer);_searchTimer=setTimeout(()=>{ render(); setTimeout(()=>{ const el=document.getElementById('order-search-input'); if(el){el.focus();el.setSelectionRange(el.value.length,el.value.length);} },10); }, 300);});
      _si.addEventListener('keydown', e=>{ if(e.key==='Escape'){S._orderSearch='';render();} if(e.key==='Enter'){clearTimeout(_searchTimer);render();} });
    }
    {const _el=document.getElementById('order-search-clear');if(_el)_el.onclick=()=>{S._orderSearch='';render();};}
  }

  // ── Expedição ─────────────────────────────────────────────────
  if(S.page==='expedicao'){
    try{ bindExpedicaoEvents(); }catch(e){ console.error('bindExpedicaoEvents', e); }
  }

  // ── Entregador ────────────────────────────────────────────────
  if(S.page==='entregador'){
    document.querySelectorAll('[data-open-confirm]').forEach(b=>{b.onclick=()=>showConfirmDeliveryModal(b.dataset.openConfirm);});
    document.querySelectorAll('[data-confirm]').forEach(b=>{b.onclick=()=>showConfirmDeliveryModal(b.dataset.confirm);});
    document.querySelectorAll('[data-print-card]').forEach(b=>{b.onclick=()=>printCard(b.dataset.printCard);});
    document.querySelectorAll('[data-print-comanda]').forEach(b=>{b.onclick=()=>printComanda(b.dataset.printComanda);});
    try{ bindRotaButtons(); }catch(e){ console.error('bindRotaButtons', e); }
  }

  // ── Ponto Eletrônico ──────────────────────────────────────────
  if(S.page==='ponto'){
    try{ bindPontoEvents(); }catch(e){ console.error('bindPontoEvents', e); }
  }

  // ── Backup ────────────────────────────────────────────────────
  if(S.page==='backup'){
    {const _el=document.getElementById('btn-backup-now');if(_el)_el.onclick=()=>{doAutoBackup();toast('✅ Backup realizado!');render();};}
    {const _el=document.getElementById('btn-backup-download');if(_el)_el.onclick=downloadBackup;}
    {const _el=document.getElementById('btn-backup-restore');if(_el)_el.onclick=()=>document.getElementById('backup-file')?.click();}
    {const _el=document.getElementById('backup-drop');if(_el)_el.onclick=()=>document.getElementById('backup-file')?.click();}
    document.getElementById('backup-file')?.addEventListener('change',e=>{
      const f=e.target.files?.[0]; if(!f)return;
      const r=new FileReader();
      r.onload=ev=>{ if(restoreBackup(ev.target.result)) setTimeout(()=>window.location.reload(),2000); };
      r.readAsText(f);
    });
  }

  // ── WhatsApp ──────────────────────────────────────────────────
  if(S.page==='whatsapp'){
    try{ bindWhatsAppEvents(); }catch(e){ console.error('bindWhatsAppEvents', e); }
  }

  // ── Notas Fiscais ─────────────────────────────────────────────
  if(S.page==='notasFiscais'){
    try{ bindNotasFiscaisEvents(); }catch(e){ console.error('bindNotasFiscaisEvents', e); }
  }

  // ── Categorias ────────────────────────────────────────────────
  if(S.page==='categorias'){
    // Window assignments handled by categorias module
    {
      const _el = document.getElementById('cat-search');
      if(_el){
        _el.addEventListener('input', e => { S._catSearch = e.target.value; render(); });
        if(S._catSearch){
          _el.focus();
          try { const v = _el.value; _el.setSelectionRange(v.length, v.length); } catch(_){}
        }
      }
    }
    // Busca dentro do modal de bulk add — sem re-render pesado
    {
      const _bs = document.getElementById('bulk-search-input');
      if(_bs){
        _bs.addEventListener('input', e => {
          import('./pages/categorias.js').then(m => m.setBulkSearch(e.target.value));
        });
        // Preserva foco
        if(S._catBulkSearch){
          _bs.focus();
          try { const v = _bs.value; _bs.setSelectionRange(v.length, v.length); } catch(_){}
        }
      }
      // Atualiza contador na footer quando checkboxes mudam
      const updateSel = () => {
        const n = (S._catBulkSelected || new Set()).size;
        document.querySelectorAll('#bulk-sel-count').forEach(el => el.textContent = n);
      };
      document.querySelectorAll('[data-bulk-toggle]').forEach(cb => {
        cb.addEventListener('change', updateSel);
      });
    }
  }

  // ── Orçamentos ────────────────────────────────────────────────
  if(S.page==='orcamento'){
    const goList  = ()=>{ S._orcView='list'; S._orcDraft=null; S._orcDetail=null; render(); };
    const goDraft = (draft=null)=>{ S._orcView='new'; S._orcDraft=draft||{titulo:'',cliente:'',obs:'',status:'Pendente',itens:[newOrcItem()]}; render(); };
    const goEdit  = (id)=>{
      const list=JSON.parse(localStorage.getItem('fv_orcamentos')||'[]');
      const o=list.find(x=>x.id===id);
      if(!o) return;
      S._orcView='edit'; S._orcDraft={...o}; S._orcEditId=id; render();
    };
    const goDetail=(id)=>{ S._orcView='detail'; S._orcDetail=id; render(); };
    {const _el=document.getElementById('btn-orc-new');if(_el)_el.onclick=()=>goDraft();}
    {const _el=document.getElementById('btn-orc-new2');if(_el)_el.onclick=()=>goDraft();}
    document.querySelectorAll('[data-orc-view]').forEach(b=>{b.onclick=()=>goDetail(b.dataset.orcView);});
    document.querySelectorAll('[data-orc-edit]').forEach(b=>{b.onclick=()=>goEdit(b.dataset.orcEdit);});
    document.querySelectorAll('[data-orc-del]').forEach(b=>{b.onclick=()=>{if(!confirm('Excluir este orçamento?')) return;const list=JSON.parse(localStorage.getItem('fv_orcamentos')||'[]').filter(x=>x.id!==b.dataset.orcDel);localStorage.setItem('fv_orcamentos',JSON.stringify(list));render();toast('🗑️ Orçamento excluído');}});
    document.querySelectorAll('[data-orc-wpp]').forEach(b=>{b.onclick=()=>{const list=JSON.parse(localStorage.getItem('fv_orcamentos')||'[]');const o=list.find(x=>x.id===b.dataset.orcWpp);if(!o) return;const {precoFinal}=calcOrcamento(o.itens||[]);const cfg=JSON.parse(localStorage.getItem('fv_whats_config')||'{}');const num=cfg.numero?.replace(/\D/g,'')||'5592993002433';const msg=encodeURIComponent(`*Orçamento — ${o.titulo||'Laços Eternos'}*\n`+(o.cliente?`👤 Cliente: ${o.cliente}\n`:'')+`\n📦 *Itens:*\n`+(o.itens||[]).filter(i=>i.nome).map(i=>`• ${i.nome} × ${i.qty}`).join('\n')+`\n\n💎 *Preço de Venda: ${$c(precoFinal)}*`+(o.obs?`\n\n📝 ${o.obs}`:'')+`\n\n_Orçamento gerado por Laços Eternos Floricultura_`);window.open(`https://wa.me/${num}?text=${msg}`,'_blank');}});
    {const _el=document.getElementById('btn-orc-back');if(_el)_el.onclick=goList;}
    {const _el=document.getElementById('btn-orc-back2');if(_el)_el.onclick=goList;}
    const readDraft = ()=>{const d = S._orcDraft||{};d.titulo=document.getElementById('orc-titulo')?.value||'';d.cliente=document.getElementById('orc-cliente')?.value||'';d.obs=document.getElementById('orc-obs')?.value||'';d.status=document.getElementById('orc-status')?.value||'Pendente';return d;};
    const updatePreview = ()=>{const draft=S._orcDraft||{};const {precoFinal}=calcOrcamento(draft.itens||[]);const el=document.getElementById('orc-preco-final');if(el) el.textContent=$c(precoFinal);};
    document.querySelectorAll('.orc-prod-sel').forEach(sel=>{sel.addEventListener('change',e=>{const idx=parseInt(e.target.dataset.idx);const opt=e.target.selectedOptions[0];const custo=parseFloat(opt?.dataset?.custo)||0;const nome=opt?.dataset?.nome||'';const draft=S._orcDraft||{itens:[]};if(draft.itens[idx]){draft.itens[idx].prodId=e.target.value;draft.itens[idx].custo=custo;draft.itens[idx].nome=nome;}S._orcDraft=draft;const custoInput=document.querySelector(`.orc-custo[data-idx="${idx}"]`);if(custoInput) custoInput.value=custo.toFixed(2);updatePreview();});});
    document.querySelectorAll('.orc-qty,.orc-custo').forEach(inp=>{inp.addEventListener('input',e=>{const idx=parseInt(e.target.dataset.idx);const draft=S._orcDraft||{itens:[]};if(draft.itens[idx]){if(e.target.classList.contains('orc-qty'))draft.itens[idx].qty=parseInt(e.target.value)||1;if(e.target.classList.contains('orc-custo'))draft.itens[idx].custo=parseFloat(e.target.value)||0;}S._orcDraft=draft; updatePreview();});});
    document.querySelectorAll('[data-orc-remove]').forEach(b=>{b.onclick=()=>{const draft=readDraft();draft.itens=(draft.itens||[]).filter((_,i)=>i!==parseInt(b.dataset.orcRemove));S._orcDraft=draft; render();};});
    {const _el=document.getElementById('btn-orc-add-item');if(_el)_el.onclick=()=>{const draft=readDraft();draft.itens=(draft.itens||[]).concat([newOrcItem()]);S._orcDraft=draft; render();};}
    {const _el=document.getElementById('btn-orc-save');if(_el)_el.onclick=()=>{const draft=readDraft();if(!(draft.itens||[]).some(i=>i.prodId||i.nome)){toast('🚨 Adicione pelo menos um produto ao orçamento!', true); return;}const list=JSON.parse(localStorage.getItem('fv_orcamentos')||'[]');if(S._orcView==='edit' && S._orcEditId){const idx=list.findIndex(x=>x.id===S._orcEditId);if(idx>=0){list[idx]={...list[idx],...draft,atualizadoEm:new Date().toISOString()};}}else{list.unshift({...draft, id:Date.now()+'_'+Math.random().toString(36).slice(2,6), criadoEm:new Date().toISOString()});}localStorage.setItem('fv_orcamentos',JSON.stringify(list));toast('✅ Orçamento salvo!');S._orcView='list'; S._orcDraft=null; S._orcEditId=null; render();};}
    {const _el=document.getElementById('btn-orc-wpp-draft');if(_el)_el.onclick=()=>{const draft=readDraft();if(!(draft.itens||[]).some(i=>i.prodId||i.nome)){toast('🚨 Adicione produtos antes de enviar!', true); return;}const {precoFinal}=calcOrcamento(draft.itens||[]);const cfg=JSON.parse(localStorage.getItem('fv_whats_config')||'{}');const num=cfg.numero?.replace(/\D/g,'')||'5592993002433';const msg=encodeURIComponent(`*Orçamento${draft.titulo?' — '+draft.titulo:''}*\n`+(draft.cliente?`👤 Cliente: ${draft.cliente}\n`:'')+`\n📦 *Itens:*\n`+(draft.itens||[]).filter(i=>i.nome||i.prodId).map(i=>`• ${i.nome||'Produto'} × ${i.qty||1}`).join('\n')+`\n\n💎 *Preço de Venda: ${$c(precoFinal)}*`+(draft.obs?`\n\n📝 ${draft.obs}`:'')+`\n\n_Laços Eternos Floricultura_`);window.open(`https://wa.me/${num}?text=${msg}`,'_blank');};}
    {const _el=document.getElementById('btn-orc-convert');if(_el)_el.onclick=e=>{const id=e.currentTarget.dataset.orcId;const list=JSON.parse(localStorage.getItem('fv_orcamentos')||'[]');const o=list.find(x=>x.id===id);if(!o) return;const {precoFinal}=calcOrcamento(o.itens||[]);toast('🛒 Redirecionando para o PDV com os itens do orçamento...');PDV.notes=`Orçamento: ${o.titulo||''} — ${$c(precoFinal)}. Cliente: ${o.cliente||''}`;if(o.cliente) PDV.clientName=o.cliente;setPage('pdv');};}
  }

  // ── Impressão ─────────────────────────────────────────────────
  if(S.page==='impressao'){
    try{ bindImpressaoEvents(); }catch(e){ console.error('bindImpressaoEvents', e); }
  }

  // ── Alertas / Notificações ─────────────────────────────────────
  if(S.page==='alertas'){
    try{ bindAlertasActions(); }catch(e){ console.error('bindAlertasActions', e); }
  }

  // ── Config ────────────────────────────────────────────────────
  if(S.page==='config'){
    try{ bindConfigActions(); }catch(e){ console.error('bindConfigActions', e); }
  }

  // ── Audit Logs (admin only) ──────────────────────────────────
  if(S.page==='auditLogs'){
    try{ bindAuditLogsEvents(); }catch(e){ console.error('bindAuditLogsEvents', e); }
  }

  // ── Agente de TI ─────────────────────────────────────────────
  if(S.page==='agenteTI'){
    try{ bindAgenteTIEvents(); }catch(e){ console.error('bindAgenteTIEvents', e); }
  }

  // ── Estoque ───────────────────────────────────────────────────
  if(S.page==='estoque'){
    document.getElementById('stock-unit-filter')?.addEventListener('change',e=>{S._stockUnit=e.target.value;render();});
    document.getElementById('stock-unit')?.addEventListener('change', e => { S._stockUnit = e.target.value; render(); });
    // Export / Import CSV estoque por unidade
    document.getElementById('btn-stock-export')?.addEventListener('click', exportStockCSV);
    document.getElementById('btn-stock-import')?.addEventListener('click', ()=>document.getElementById('stock-import-file')?.click());
    document.getElementById('stock-import-file')?.addEventListener('change', e=>{ const f=e.target.files?.[0]; if(f) importStockCSV(f); e.target.value=''; });
    // Edição inline de estoque por unidade
    document.querySelectorAll('.stock-unit-inline').forEach(inp=>{
      inp.addEventListener('change', e=>{
        const pid = e.target.dataset.pid;
        const unit = e.target.dataset.unit;
        updateStockByUnit(pid, unit, e.target.value);
      });
    });
    {const _el=document.getElementById('btn-stock-entry');if(_el)_el.onclick=()=>showStockModal('','','Entrada');}
    {const _el=document.getElementById('btn-stock-exit');if(_el)_el.onclick=()=>showStockModal('','','Saída');}
    {const _el=document.getElementById('btn-new-transfer');if(_el)_el.onclick=showTransferModal;}
    {const _el=document.getElementById('btn-new-transfer2');if(_el)_el.onclick=showTransferModal;}
    {const _el=document.getElementById('btn-rel-prods');if(_el)_el.onclick=async()=>{S.loading=true;render();const [prods,moves]=await Promise.all([GET('/products'),GET('/stock/moves').catch(()=>[])]);if(prods?.length) S.products=prods; if(prods?.length||moves?.length) saveCachedData(); S.stockMoves=moves||[];S.loading=false;render();};}
    document.querySelectorAll('[data-sf]').forEach(b=>{b.onclick=()=>{S._stockFilter=b.dataset.sf;render();};});
    document.querySelectorAll('[data-stock-add]').forEach(b=>{b.onclick=()=>showStockModal(b.dataset.stockAdd,b.dataset.stockName,'Entrada');});
    document.querySelectorAll('[data-stock-rem]').forEach(b=>{b.onclick=()=>showStockModal(b.dataset.stockRem,b.dataset.stockName,'Saída');});

    // Filtros de busca
    {const _el=document.getElementById('stock-search');if(_el){
      _el.addEventListener('input', e=>{ S._stockSearch = e.target.value; clearTimeout(window._stockSearchT); window._stockSearchT=setTimeout(render,250); });
    }}
    {const _el=document.getElementById('stock-filter-cat');if(_el)_el.addEventListener('change', e=>{ S._stockCat = e.target.value; render(); });}
    {const _el=document.getElementById('stock-sort');if(_el)_el.addEventListener('change', e=>{ S._stockSort = e.target.value; render(); });}
    {const _el=document.getElementById('btn-stock-clear');if(_el)_el.onclick=()=>{ S._stockSearch=''; S._stockCat=''; S._stockSort='nome-asc'; render(); };}

    // Ajuste em lote — toggle
    {const _el=document.getElementById('btn-toggle-adjust');if(_el)_el.onclick=()=>{ S._stockAdjustOpen=!S._stockAdjustOpen; render(); };}
    // Ajuste — campos
    {const _el=document.getElementById('adj-scope');if(_el)_el.addEventListener('change', e=>{ S._stockAdjust.scope = e.target.value; });}
    document.querySelectorAll('input[name="adj-op"]').forEach(r=>{ r.addEventListener('change', e=>{ if(e.target.checked) S._stockAdjust.op = e.target.value; }); });
    {const _el=document.getElementById('adj-type');if(_el)_el.addEventListener('change', e=>{ S._stockAdjust.type = e.target.value; });}
    {const _el=document.getElementById('adj-value');if(_el)_el.addEventListener('input', e=>{ S._stockAdjust.value = parseFloat(e.target.value)||0; });}
    {const _el=document.getElementById('adj-venda');if(_el)_el.addEventListener('change', e=>{ S._stockAdjust.applyVenda = e.target.checked; });}
    {const _el=document.getElementById('adj-custo');if(_el)_el.addEventListener('change', e=>{ S._stockAdjust.applyCusto = e.target.checked; });}
    {const _el=document.getElementById('btn-preview-adjust');if(_el)_el.onclick=previewPriceAdjust;}
    {const _el=document.getElementById('btn-apply-adjust');if(_el)_el.onclick=applyPriceAdjust;}

    // Checkboxes de seleção
    document.querySelectorAll('[data-stock-sel]').forEach(c=>{
      c.addEventListener('change', e=>{
        const id = e.target.dataset.stockSel;
        S._stockSelected = S._stockSelected || [];
        if(e.target.checked){
          if(!S._stockSelected.includes(id)) S._stockSelected.push(id);
        } else {
          S._stockSelected = S._stockSelected.filter(x=>x!==id);
        }
        // re-render só o contador — para simplicidade, render completo
        render();
      });
    });

    // Edição inline de price/costPrice/stock
    document.querySelectorAll('.stock-inline-price').forEach(inp=>{
      inp.addEventListener('change', e=>{
        const pid = e.target.dataset.pid;
        const field = e.target.dataset.field;
        updateProductFieldInline(pid, field, e.target.value);
      });
    });

    // Editar detalhes — abre modal de produto
    document.querySelectorAll('[data-stock-edit]').forEach(b=>{
      b.onclick=()=>{
        const pid = b.dataset.stockEdit;
        const p = S.products.find(x=>x._id===pid);
        if(p && window.showProductModal) window.showProductModal(p);
        else S.page='produtos', render();
      };
    });
  }

  // ── Financeiro ────────────────────────────────────────────────
  if(S.page==='financeiro'){
    document.getElementById('fin-unit-filter')?.addEventListener('change',e=>{S._finUnit=e.target.value;render();});
    {const _el=document.getElementById('btn-new-receita');if(_el)_el.onclick=()=>showFinModal('Receita');}
    {const _el=document.getElementById('btn-new-despesa');if(_el)_el.onclick=()=>showFinModal('Despesa');}
    {const _el=document.getElementById('btn-new-despesa2');if(_el)_el.onclick=()=>showFinModal('Despesa');}
    {const _el=document.getElementById('btn-fin-meta-dia');if(_el)_el.onclick=()=>{S._finMetaPer='dia';render();};}
    {const _el=document.getElementById('btn-fin-meta-semana');if(_el)_el.onclick=()=>{S._finMetaPer='semana';render();};}
    {const _el=document.getElementById('btn-fin-meta-mes');if(_el)_el.onclick=()=>{S._finMetaPer='mes';render();};}
    {const _el=document.getElementById('btn-rel-fin');if(_el)_el.onclick=async()=>{S.loading=true;render();S.orders=await GET('/orders');S.loading=false;render();};}
    document.querySelectorAll('[data-mark-paid]').forEach(b=>{b.onclick=async()=>{try{await PUT('/orders/'+b.dataset.markPaid,{paymentStatus:'Pago'});S.orders=S.orders.map(o=>o._id===b.dataset.markPaid?{...o,paymentStatus:'Pago'}:o);render();toast('✅ Pagamento confirmado!');}catch(e){toast('Erro: '+(e.message||''),true);}}});
    document.querySelectorAll('[data-pay-bill]').forEach(b=>{b.onclick=()=>{const entries = JSON.parse(localStorage.getItem('fv_financial')||'[]');const updated = entries.map(e=>e.id===b.dataset.payBill?{...e,status:'Pago',paidAt:new Date().toISOString()}:e);localStorage.setItem('fv_financial',JSON.stringify(updated));S.financialEntries=updated;render();toast('✅ Conta marcada como paga!');}});
  }

  // ── Delivery / Entregador ─────────────────────────────────────
  if(S.page==='delivery'||S.page==='entregador'){
    {const _el=document.getElementById('btn-rel-orders');if(_el)_el.onclick=async()=>{S.loading=true;render();S.orders=await GET('/orders');S.loading=false;render();};}
  }

  // ── Usuários ──────────────────────────────────────────────────
  if(S.page==='usuarios'){
    document.getElementById('user-search')?.addEventListener('input', e=>{ S._userSearch=e.target.value; render(); });
    {const _el=document.getElementById('btn-rel-users');if(_el)_el.onclick=async()=>{S.loading=true; render();const raw = await GET('/users').catch(()=>[]);const hidden = getHiddenUsers();S.users = (raw||[]).filter(x=>!hidden.includes(x._id)).map(mergeUserExtra);S.loading=false; render();};}
  }

  // ── Colaboradores ─────────────────────────────────────────────
  if(S.page==='colaboradores'){
    // Busca com debounce 300ms + foco preservado (evita perder cursor ao digitar)
    {
      const _si = document.getElementById('colab-search');
      if (_si) {
        let _searchTimer = null;
        _si.addEventListener('input', e => {
          S._colabSearch = e.target.value;
          clearTimeout(_searchTimer);
          _searchTimer = setTimeout(() => {
            render();
            setTimeout(() => {
              const el = document.getElementById('colab-search');
              if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
            }, 10);
          }, 300);
        });
        _si.addEventListener('keydown', e => {
          if (e.key === 'Escape') { S._colabSearch = ''; render(); }
          if (e.key === 'Enter')  { clearTimeout(_searchTimer); render(); }
        });
      }
    }
    document.querySelectorAll('[data-sync-colab]').forEach(b=>{b.onclick=()=>syncColabToBackend(b.dataset.syncColab);});
    {const _el=document.getElementById('btn-sync-all-colabs');if(_el)_el.onclick=syncAllColabs;}
  }
}

// Stub for showFiscalModal (requires backend fiscal)
function showFiscalModal(id, type){
  toast('📄 '+type+' — Funcionalidade requer backend fiscal configurado');
}

// ── WINDOW ASSIGNMENTS ──────────────────────────────────────────
// Make functions available for inline onclick handlers in templates
window.render = render;
window.setPage = setPage;
window.toast = toast;
window.logout = logout;
window.showClientModal = showClientModal;
window.saveClient = saveClient;
window.deleteClient = deleteClient;
window.repeatOrder = repeatOrder;
window.showOrderViewModal = showOrderViewModal;
window.showEditOrderModal = showEditOrderModal;
window.advanceOrder = advanceOrder;
window.printCard = printCard;
window.printLabel = printLabel;
window.printComanda = printComanda;
window.showConfirmDeliveryModal = showConfirmDeliveryModal;
window.showReentregaModal = showReentregaModal;
window.showColabModal = showColabModal;
window.deleteColab = deleteColab;
window.syncColabToBackend = syncColabToBackend;
window.syncAllColabs = syncAllColabs;
window.showNewUserModal = showNewUserModal;
window.showEditUserModal = showEditUserModal;
window.saveUser = saveUser;
window.deleteUser = deleteUser;
window.confirmDeleteUser = confirmDeleteUser;
window.toggleUserActive = toggleUserActive;
window.toggleUser = toggleUserActive;
window.showNewProductModal = showNewProductModal;
window.deleteProduct = deleteProduct;
window.showProductStockModal = showProductStockModal;
window.showStockModal = showStockModal;
window.showTransferModal = showTransferModal;
window.showFinModal = showFinModal;
window.showFiscalModal = showFiscalModal;
window.showFullImg = showFullImg;
window.finalizePDV = finalizePDV;
window.doAutoBackup = doAutoBackup;
window.downloadBackup = downloadBackup;
window.restoreBackup = restoreBackup;
window.showAddDataEspecialModal = showAddDataEspecialModal;
window.getDatasEspeciais = getDatasEspeciais;
window.saveDatasEspeciais = saveDatasEspeciais;
window.saveProduct = saveProduct;
window.S = S;
window.PDV = PDV;
window.DELIVERY_FEES = DELIVERY_FEES;
window.saveDeliveryFees = saveDeliveryFees;
window.$c = $c;
window.can = can;

// ── INIT ────────────────────────────────────────────────────────
async function init(){
  try{
  // ── LIMPA DADOS LOCAIS NA PRIMEIRA VEZ (instalação limpa) ──
  const VERSAO = 'florevita-v2-clean-2026';
  if(localStorage.getItem('fv_versao') !== VERSAO){
    const keepKeys = ['fv_versao'];
    Object.keys(localStorage).forEach(k=>{ if(!keepKeys.includes(k)) localStorage.removeItem(k); });
    localStorage.setItem('fv_versao', VERSAO);
    console.log('[init] ✅ Sistema iniciado limpo (versão '+VERSAO+')');
  }

  S.financialEntries = JSON.parse(localStorage.getItem('fv_financial')||'[]');

  // ── Remove qualquer Service Worker antigo que possa interferir ──────
  if('serviceWorker' in navigator){
    navigator.serviceWorker.getRegistrations().then(regs=>{
      regs.forEach(reg=>{
        if(reg.scope && !reg.scope.includes('app-entregador')){
          reg.unregister().then(()=>console.log('[SW] Removido SW antigo:', reg.scope));
        }
      });
    }).catch(()=>{});
  }

  seedColaboradores();

  // Carrega branding do backend. Render (free tier) pode levar até 60s para
  // acordar — aplicamos o cache local imediatamente e atualizamos quando
  // o servidor responder (sem bloquear a tela inicial).
  try{
    const { applyFaviconFromConfig, loadPublicBranding } = await import('./pages/config.js');
    applyFaviconFromConfig(); // cache local → instantâneo
    // Dispara o load em background; quando terminar, re-renderiza
    loadPublicBranding().then(() => {
      console.log('[init] Branding sincronizado com servidor. fv_config:',
        (()=>{ const c = JSON.parse(localStorage.getItem('fv_config')||'{}'); return {hasLogo:!!c.loginLogo,hasFavicon:!!c.favicon}; })());
      try{ render(); applyFaviconFromConfig(); }catch(_){}
    });
  }catch(e){ console.warn('[init] branding erro:', e); }

  // ── Limpa cache velho automaticamente na inicialização ────────
  try{
    const raw = localStorage.getItem('fv_data_cache');
    if(raw){
      const cache = JSON.parse(raw);
      const ageMin = (Date.now()-(cache.savedAt||0))/60000;
      if(ageMin > 120){
        localStorage.removeItem('fv_data_cache');
        console.log('[init] Cache expirado removido ('+Math.round(ageMin)+'min)');
      }
    }
  }catch(e){}

  // ── QR Code de entrega: escanear dá baixa automática ──────────
  const urlParams = new URLSearchParams(window.location.search);
  const deliverOrderId = urlParams.get('deliver');
  if(deliverOrderId){
    window.history.replaceState({}, '', window.location.pathname);
    S._pendingDeliveryQR = deliverOrderId;
  }

  // ── URL routing: botão voltar do navegador ──────────────────
  window.addEventListener('popstate', e=>{
    const page = e.state?.page || getPageFromURL() || 'dashboard';
    if(S.user && page !== S.page){
      setPage(page, false); // false = não fazer pushState de novo
    }
  });

  // ── Defesa global: dentro de modais (.mo) o Enter NAO submete form
  // automaticamente (em <textarea> permite quebra de linha normal).
  // Antes: pressionar Enter num input dentro de modal podia clicar no
  // primeiro botao da pagina (incluindo botoes que fechavam o modal).
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const t = e.target;
    if (!t || !t.closest) return;
    // Se esta dentro de modal e nao e textarea/button → previne submit acidental
    if (t.closest('.mo') && t.tagName !== 'TEXTAREA' && t.tagName !== 'BUTTON') {
      // Permite Enter funcional em selects (abre opcoes)
      if (t.tagName === 'SELECT') return;
      e.preventDefault();
    }
  }, true);

  // ── Wake-up ping: acorda o Render antes do login ──────────────
  fetch(API+'/health', {method:'GET', signal:AbortSignal.timeout(5000)}).catch(()=>{});

  if(loadSession()){
    // 1. Mostra cache imediatamente (< 100ms)
    loadCachedData();
    // Ler página da URL (ex: /pedidos → page='pedidos')
    const urlPage = getPageFromURL();
    if(urlPage) S.page = urlPage;
    if(_isEntregador()) S.page='entregador';
    // Atualizar URL para refletir a página atual
    const slug = S.page === 'config' ? 'configuracoes' : S.page;
    history.replaceState({page:S.page}, '', '/'+slug);
    S.loading = false;
    render();              // user sees UI immediately (com cache)
    // 2. Revalida permissões AGORA no backend (sem esperar — UI já renderizou)
    refreshUserFromBackend(true).catch(()=>{});
    // 3. Busca dados frescos em background — NÃO espera
    loadData();            // não-bloqueante: fase crítica + background interno
    // Taxas de entrega: sincroniza do backend (evita sumir em outro dispositivo)
    import('./services/deliveryFeesSync.js').then(m => {
      if(m.loadDeliveryFeesFromBackend) m.loadDeliveryFeesFromBackend().catch(()=>{});
    }).catch(()=>{});
    startPolling(3000);
    startAutoBackup();
    startPermissionPolling();  // revalida permissões a cada 60s
    // Sincroniza relogio com o servidor (corrige devices com hora/fuso errado)
    // Critico para o modulo Ponto Eletronico.
    import('./services/serverClock.js').then(m => m.syncServerClock()).catch(()=>{});
    // Alertas de pagamento pendente (push no canto inferior direito)
    import('./services/paymentAlerts.js').then(m => m.startPaymentAlerts?.()).catch(()=>{});
    // Real-time: SSE para sincronizacao automatica entre maquinas
    // (elimina F5 manual quando outra unidade lanca/atualiza pedido).
    import('./services/realtime.js').then(m => m.startRealtime?.()).catch(()=>{});

    // ── Ponto: lembretes de horário ──────────────────────────
    import('./pages/ponto.js').then(m => {
      if(m.startPontoReminder) m.startPontoReminder();
    }).catch(()=>{});

    // ── Processa QR de entrega após dados carregarem ──────────────
    if(S._pendingDeliveryQR){
      const qrOrderId = S._pendingDeliveryQR;
      S._pendingDeliveryQR = null;
      setTimeout(()=>confirmDeliveryByQR(qrOrderId), 600);
    }

    // ── Mensagem motivacional ──────────────────────────────────
    setTimeout(()=>{
      try{ showMensagemMotivacional(S.user?.name, S.user?._id); }catch(e){}
    }, 1500);
  }
  render();
  }catch(e){
    console.error('Erro na inicialização:', e);
    const root=document.getElementById('root');
    if(root) root.innerHTML=`
    <div style="padding:40px;text-align:center;font-family:sans-serif;max-width:600px;margin:80px auto;">
      <div style="font-size:48px;margin-bottom:16px">🌸</div>
      <h2 style="color:#8B2252;margin-bottom:8px">Laços Eternos</h2>
      <p style="color:#c0392b;margin-bottom:16px;font-weight:500">Erro ao inicializar o sistema</p>
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:16px;text-align:left;margin-bottom:16px;">
        <code style="font-size:12px;color:#991b1b;word-break:break-all">${e.message}</code>
      </div>
      <button onclick="localStorage.clear();location.reload()"
        style="background:#8B2252;color:#fff;border:none;padding:12px 28px;border-radius:8px;font-size:14px;cursor:pointer;margin-right:8px">
        🔄 Limpar cache e recarregar
      </button>
      <button onclick="location.reload()"
        style="background:#f3f4f6;color:#374151;border:1px solid #d1d5db;padding:12px 20px;border-radius:8px;font-size:14px;cursor:pointer">
        ↩ Só recarregar
      </button>
    </div>`;
  }
}
init();
