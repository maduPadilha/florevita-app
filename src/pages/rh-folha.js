// ── MODULO FOLHA DE PAGAMENTO (sub-modulo do RH) ─────────────
// Inclui:
//   1. Cadastro RH adicional por colab (PIS, RG, salario, banco, etc)
//   2. Geracao de Contracheque (holerite) com vencimentos + descontos
//   3. Geracao de Recibo de Adiantamento Salarial
//   4. Layout de impressao identico ao modelo enviado
//   5. Calculo automatico de INSS + FGTS
//
// Storage: localStorage
//   fv_rh_dados   — dados RH adicionais por colab (chave colabKey)
//   fv_rh_folhas  — historico de folhas geradas (contracheque + adiantamento)
//
// Empresa fixa: LACOS ETERNOS FLORICULTURA (do branding/config)
import { S } from '../state.js';
import { $c } from '../utils/formatters.js';
import { toast } from '../utils/helpers.js';
import { getColabs } from '../services/auth.js';

// ── STORAGE ──────────────────────────────────────────────────
const LS_DADOS  = 'fv_rh_dados';
const LS_FOLHAS = 'fv_rh_folhas';

export function getRHDados()    { try { return JSON.parse(localStorage.getItem(LS_DADOS) || '{}'); } catch { return {}; } }
export function setRHDados(obj) { localStorage.setItem(LS_DADOS, JSON.stringify(obj || {})); }
export function getDadosColab(colabKey) { return (getRHDados()[String(colabKey)] || {}); }
export function saveDadosColab(colabKey, dados) {
  const all = getRHDados();
  all[String(colabKey)] = { ...(all[String(colabKey)]||{}), ...dados, updatedAt: Date.now() };
  setRHDados(all);
}

export function getFolhas()    { try { return JSON.parse(localStorage.getItem(LS_FOLHAS) || '[]'); } catch { return []; } }
export function setFolhas(arr) { localStorage.setItem(LS_FOLHAS, JSON.stringify(arr || [])); }

// ── CALCULO INSS 2026 (faixa progressiva oficial) ────────────
// Fonte: tabela MPS — pode ser ajustada anualmente em uma constante.
const INSS_FAIXAS_2026 = [
  { ate: 1412.00, aliq: 0.075 },
  { ate: 2666.68, aliq: 0.090 },
  { ate: 4000.03, aliq: 0.120 },
  { ate: 7786.02, aliq: 0.140 },
];
export function calcINSS(salarioContrib) {
  let restante = Number(salarioContrib) || 0;
  if (restante <= 0) return { valor: 0, baseCalc: 0, aliquotaEfetiva: 0 };
  const teto = INSS_FAIXAS_2026[INSS_FAIXAS_2026.length-1].ate;
  const base = Math.min(restante, teto);
  let valor = 0, anterior = 0;
  for (const f of INSS_FAIXAS_2026) {
    if (base <= anterior) break;
    const tributavel = Math.min(base, f.ate) - anterior;
    if (tributavel > 0) valor += tributavel * f.aliq;
    anterior = f.ate;
    if (base <= f.ate) break;
  }
  return { valor: round2(valor), baseCalc: round2(base), aliquotaEfetiva: round2((valor/base)*100) };
}
export function calcFGTS(salarioBase) {
  const v = (Number(salarioBase) || 0) * 0.08;
  return { valor: round2(v), baseCalc: round2(Number(salarioBase)||0) };
}
function round2(n) { return Math.round((n||0)*100)/100; }

// ── HELPERS ──────────────────────────────────────────────────
function _colabKey(c) { return String(c?._id || c?.id || c?.backendId || c?.email || c?.name || ''); }
function escHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fmtNum(n, decs=2) {
  return (Number(n)||0).toLocaleString('pt-BR', { minimumFractionDigits: decs, maximumFractionDigits: decs });
}
const MES_NOMES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const MES_ABBR  = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const fmtMesAno = (yyyymm) => { const [y,m]=String(yyyymm).split('-'); return `${MES_NOMES[Number(m)-1]} de ${y}`; };
const fmtData = (iso) => { if (!iso) return ''; const [y,m,d] = String(iso).slice(0,10).split('-'); return `${d}/${m}/${y}`; };

// ── EMPRESA (vem do localStorage / branding) ─────────────────
function getEmpresa() {
  try {
    const cfg = JSON.parse(localStorage.getItem('fv_config')||'{}');
    return {
      razao:    (cfg.razao    || 'MARCIA FLORENTINO DE BARROS PINHEIRO').toUpperCase(),
      endereco: cfg.endereco || 'Rua BRASILÉIA 17/QD D3 LT 17 LT AGUA, NOVO ALEIXO, Manaus/AM - CEP 69098-026',
      cnpj:     cfg.cnpj     || '11.808.222/0001-51',
      empresaCodigo: cfg.empresaCodigo || '72',
    };
  } catch { return { razao:'', endereco:'', cnpj:'', empresaCodigo:'72' }; }
}

// ─────────────────────────────────────────────────────────────
//                          RENDER
// ─────────────────────────────────────────────────────────────
export function renderRHFolha() {
  const sub = S._rhFolhaSub || 'list'; // list | dados | gerar | historico
  const subBtn = (k, label) => `<button type="button" class="tab ${sub===k?'active':''}" data-rhfolha-sub="${k}" style="font-size:12px;">${label}</button>`;

  return `
<div class="tabs" style="margin-bottom:14px;gap:5px;">
  ${subBtn('list',      '👥 Colaboradores')}
  ${subBtn('dados',     '📄 Dados RH')}
  ${subBtn('gerar',     '🧾 Gerar Folha/Adiantamento')}
  ${subBtn('historico', '📋 Histórico')}
</div>

${sub === 'list'      ? renderColabsLista()  : ''}
${sub === 'dados'     ? renderDadosColab()   : ''}
${sub === 'gerar'     ? renderGerarFolha()   : ''}
${sub === 'historico' ? renderHistorico()    : ''}
`;
}

// ─── A) LISTA DE COLABS COM STATUS DE CADASTRO ──────────────
function renderColabsLista() {
  const colabs = getColabs().filter(c => c.active !== false).sort((a,b) => (a.name||'').localeCompare(b.name||''));
  const dadosAll = getRHDados();
  return `
<div class="card" style="margin-bottom:12px;">
  <div class="card-title">👥 Colaboradores — Cadastro RH</div>
  <p style="font-size:12px;color:var(--muted);">Cadastre dados pessoais, salariais e bancários para gerar contracheques e recibos.</p>
</div>

<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px;">
${colabs.map(c => {
  const k = _colabKey(c);
  const d = dadosAll[k] || {};
  const completo = !!(d.cpf && d.salarioBase && d.codigo);
  return `<div class="card" style="border-left:4px solid ${completo?'#15803D':'#F59E0B'};">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
      <div style="width:36px;height:36px;border-radius:50%;background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;">${(c.name||'?').charAt(0).toUpperCase()}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(c.name||'')}</div>
        <div style="font-size:10px;color:var(--muted);">${escHtml(c.cargo||'')} · ${d.codigo?'#'+d.codigo:'sem código'}</div>
      </div>
      <span style="background:${completo?'#DCFCE7':'#FEF3C7'};color:${completo?'#15803D':'#92400E'};border-radius:10px;padding:2px 8px;font-size:10px;font-weight:700;">${completo?'✅ Completo':'⚠️ Pendente'}</span>
    </div>
    <div style="font-size:11px;color:var(--muted);margin-bottom:8px;">
      ${d.salarioBase ? `Salário: <strong style="color:#1E293B;">R$ ${fmtNum(d.salarioBase)}</strong>` : 'Sem salário cadastrado'}<br/>
      ${d.cpf ? `CPF: ${d.cpf}` : 'Sem CPF'}
    </div>
    <div style="display:flex;gap:6px;">
      <button class="btn btn-primary btn-sm" data-rhfolha-edit="${k}" style="flex:1;">✏️ Editar dados</button>
      <button class="btn btn-ghost btn-sm" data-rhfolha-gerar="${k}" ${!completo?'disabled':''} title="${completo?'Gerar contracheque/adiantamento':'Complete os dados primeiro'}">🧾</button>
    </div>
  </div>`;
}).join('')}
</div>`;
}

// ─── B) FORM DADOS RH POR COLAB ─────────────────────────────
function renderDadosColab() {
  const colabKey = S._rhFolhaColab || '';
  const colabs = getColabs().filter(c => c.active !== false);
  const colab = colabs.find(c => _colabKey(c) === colabKey);
  if (!colab) {
    return `<div class="card" style="text-align:center;padding:30px;color:var(--muted);">
      <p>Selecione uma colaboradora na aba "Colaboradores" para editar os dados.</p>
      <button class="btn btn-primary" data-rhfolha-sub="list" style="margin-top:10px;">← Voltar</button>
    </div>`;
  }
  const d = getDadosColab(colabKey);
  const v = (k) => escHtml(d[k]||'');

  return `<div class="card">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
      <button class="btn btn-ghost btn-sm" data-rhfolha-sub="list">←</button>
      <div style="font-weight:800;font-size:16px;">📄 Dados RH — ${escHtml(colab.name||'')}</div>
    </div>

    <!-- DADOS PESSOAIS -->
    <div style="font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase;margin-bottom:8px;letter-spacing:1px;">📄 Dados Pessoais</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px;">
      <div class="fg" style="grid-column:span 2;"><label class="fl">Nome completo</label><input type="text" class="fi" id="rh-nome" value="${v('nome')||escHtml(colab.name||'')}"/></div>
      <div class="fg"><label class="fl">CPF</label><input type="text" class="fi" id="rh-cpf" value="${v('cpf')}" placeholder="000.000.000-00"/></div>
      <div class="fg"><label class="fl">RG</label><input type="text" class="fi" id="rh-rg" value="${v('rg')}"/></div>
      <div class="fg"><label class="fl">PIS</label><input type="text" class="fi" id="rh-pis" value="${v('pis')}" placeholder="000.00000.00-0"/></div>
      <div class="fg"><label class="fl">Data nascimento</label><input type="date" class="fi" id="rh-nasc" value="${v('dataNascimento')}"/></div>
      <div class="fg"><label class="fl">Telefone</label><input type="text" class="fi" id="rh-tel" value="${v('telefone')}"/></div>
      <div class="fg"><label class="fl">E-mail</label><input type="text" class="fi" id="rh-email" value="${v('email')||escHtml(colab.email||'')}"/></div>
    </div>

    <!-- ENDERECO -->
    <div style="font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase;margin-bottom:8px;letter-spacing:1px;">📍 Endereço</div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px;">
      <div class="fg"><label class="fl">CEP</label><input type="text" class="fi" id="rh-cep" value="${v('cep')}"/></div>
      <div class="fg" style="grid-column:span 2;"><label class="fl">Rua</label><input type="text" class="fi" id="rh-rua" value="${v('rua')}"/></div>
      <div class="fg"><label class="fl">Número</label><input type="text" class="fi" id="rh-numero" value="${v('numero')}"/></div>
      <div class="fg" style="grid-column:span 2;"><label class="fl">Bairro</label><input type="text" class="fi" id="rh-bairro" value="${v('bairro')}"/></div>
      <div class="fg"><label class="fl">Cidade</label><input type="text" class="fi" id="rh-cidade" value="${v('cidade')||'Manaus'}"/></div>
      <div class="fg"><label class="fl">Estado</label><input type="text" class="fi" id="rh-estado" value="${v('estado')||'AM'}" maxlength="2"/></div>
    </div>

    <!-- DADOS PROFISSIONAIS -->
    <div style="font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase;margin-bottom:8px;letter-spacing:1px;">🏢 Dados Profissionais</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px;">
      <div class="fg"><label class="fl">Código funcionário</label><input type="text" class="fi" id="rh-codigo" value="${v('codigo')}" placeholder="Ex: 13"/></div>
      <div class="fg"><label class="fl">CBO</label><input type="text" class="fi" id="rh-cbo" value="${v('cbo')||'622425 - Trabalhador na floricultura'}"/></div>
      <div class="fg"><label class="fl">Setor</label><input type="text" class="fi" id="rh-setor" value="${v('setor')}"/></div>
      <div class="fg"><label class="fl">Cargo</label><input type="text" class="fi" id="rh-cargo" value="${v('cargo')||escHtml(colab.cargo||'')}"/></div>
      <div class="fg"><label class="fl">Data admissão</label><input type="date" class="fi" id="rh-admissao" value="${v('dataAdmissao')}"/></div>
      <div class="fg"><label class="fl">Tipo de contrato</label>
        <select class="fi" id="rh-contrato">
          ${['CLT','MEI','Prestador','Estágio','Temporário'].map(t => `<option value="${t}" ${d.tipoContrato===t?'selected':''}>${t}</option>`).join('')}
        </select>
      </div>
    </div>

    <!-- DADOS SALARIAIS -->
    <div style="font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase;margin-bottom:8px;letter-spacing:1px;">💰 Dados Salariais</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px;">
      <div class="fg"><label class="fl">Salário base (R$) <span style="color:var(--red)">*</span></label><input type="number" class="fi" id="rh-salario" min="0" step="0.01" value="${d.salarioBase||''}" placeholder="2244.60"/></div>
      <div class="fg"><label class="fl">Vale Transporte (R$)</label><input type="number" class="fi" id="rh-vt" min="0" step="0.01" value="${d.valeTransporte||''}" placeholder="210.00"/></div>
      <div class="fg"><label class="fl">Outros adicionais (R$)</label><input type="number" class="fi" id="rh-adicional" min="0" step="0.01" value="${d.outrosAdicionais||''}" placeholder="0.00"/></div>
    </div>
    ${d.salarioBase ? (() => {
      const inss = calcINSS(d.salarioBase);
      const fgts = calcFGTS(d.salarioBase);
      return `<div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;padding:10px 14px;margin-bottom:14px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;font-size:12px;">
        <span>📊 INSS calculado: <strong style="color:#DC2626;">R$ ${fmtNum(inss.valor)}</strong> (${fmtNum(inss.aliquotaEfetiva,1)}%)</span>
        <span>🏦 FGTS calculado: <strong style="color:#15803D;">R$ ${fmtNum(fgts.valor)}</strong> (8%)</span>
      </div>`;
    })() : ''}

    <!-- BANCO -->
    <div style="font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase;margin-bottom:8px;letter-spacing:1px;">🏦 Dados Bancários</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px;">
      <div class="fg"><label class="fl">Banco</label><input type="text" class="fi" id="rh-banco" value="${v('banco')}"/></div>
      <div class="fg"><label class="fl">Agência</label><input type="text" class="fi" id="rh-ag" value="${v('agencia')}"/></div>
      <div class="fg"><label class="fl">Conta</label><input type="text" class="fi" id="rh-conta" value="${v('conta')}"/></div>
    </div>

    <div style="display:flex;gap:8px;">
      <button class="btn btn-primary" id="btn-rh-salvar">💾 Salvar dados</button>
      <button class="btn btn-ghost" data-rhfolha-sub="list">Cancelar</button>
    </div>
  </div>`;
}

// ─── C) GERAR FOLHA / ADIANTAMENTO ──────────────────────────
function renderGerarFolha() {
  const colabKey = S._rhFolhaColab || '';
  const tipoDoc  = S._rhFolhaTipo  || 'contracheque'; // contracheque | adiantamento
  const mesAno   = S._rhFolhaMes   || (() => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; })();
  const colabs = getColabs().filter(c => c.active !== false);
  const colab = colabs.find(c => _colabKey(c) === colabKey);
  const dados = colab ? getDadosColab(colabKey) : {};

  return `<div class="card">
    <div class="card-title">🧾 Gerar Folha de Pagamento / Adiantamento</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px;">
      <div class="fg"><label class="fl">Colaboradora</label>
        <select class="fi" id="rh-folha-colab">
          <option value="">— Selecione —</option>
          ${colabs.sort((a,b)=>(a.name||'').localeCompare(b.name||'')).map(c => { const k=_colabKey(c); return `<option value="${k}" ${k===colabKey?'selected':''}>${escHtml(c.name||'')}</option>`; }).join('')}
        </select>
      </div>
      <div class="fg"><label class="fl">Mês de referência</label>
        <input type="month" class="fi" id="rh-folha-mes" value="${mesAno}"/>
      </div>
      <div class="fg"><label class="fl">Tipo de documento</label>
        <select class="fi" id="rh-folha-tipo">
          <option value="contracheque" ${tipoDoc==='contracheque'?'selected':''}>🧾 Contracheque (mensal)</option>
          <option value="adiantamento" ${tipoDoc==='adiantamento'?'selected':''}>💵 Recibo de Adiantamento</option>
        </select>
      </div>
    </div>

    ${!colab ? `<div style="text-align:center;padding:20px;color:var(--muted);font-size:12px;">Selecione uma colaboradora acima.</div>` : !dados.salarioBase ? `
      <div style="background:#FEF3C7;border:1px solid #FCD34D;border-radius:8px;padding:12px 14px;color:#92400E;text-align:center;">
        ⚠️ Esta colaboradora não tem <strong>Salário Base</strong> cadastrado. Vá em <strong>Dados RH</strong> e preencha primeiro.
      </div>
    ` : tipoDoc === 'contracheque' ? renderFormContracheque(colab, dados, mesAno)
                                   : renderFormAdiantamento(colab, dados, mesAno)}
  </div>`;
}

// ── Form Contracheque ──
function renderFormContracheque(colab, dados, mesAno) {
  const draft = S._rhFolhaDraft || {};
  // Defaults baseados no salario
  const sal = Number(dados.salarioBase) || 0;
  const inss = calcINSS(sal + Number(draft.horaExtra||0) + Number(draft.dsr||0));
  const vt = Number(dados.valeTransporte) || 0;
  const adicVt = Number(draft.adicVT||0);
  const descVt = Number(draft.descVT||vt) || 0;
  const adiantamento = Number(draft.adiantamento||0);
  const horaExtra = Number(draft.horaExtra||0);
  const horaExtraQtd = Number(draft.horaExtraQtd||0);
  const dsr = Number(draft.dsr||0);
  const outroDesc = Number(draft.outroDesc||0);
  const diasTrab = Number(draft.diasTrab||31);

  const totalVenc = sal + horaExtra + dsr + adicVt + Number(draft.outroVenc||0);
  const totalDesc = inss.valor + adiantamento + descVt + outroDesc;
  const liquido = totalVenc - totalDesc;

  return `
  <div style="background:#FAFAFA;border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:14px;">
    <div style="font-weight:800;font-size:13px;margin-bottom:10px;">💰 Vencimentos</div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px;font-size:12px;">
      <div><label style="font-size:10px;color:var(--muted);">Dias trabalhados</label><input type="number" class="fi" id="rh-dias-trab" value="${diasTrab}" min="0" max="31"/></div>
      <div><label style="font-size:10px;color:var(--muted);">Salário base (auto)</label><input type="number" class="fi" value="${sal}" disabled style="background:#F1F5F9;"/></div>
      <div><label style="font-size:10px;color:var(--muted);">H.Extra qtd</label><input type="number" class="fi" id="rh-he-qtd" value="${horaExtraQtd}" min="0" step="0.5"/></div>
      <div><label style="font-size:10px;color:var(--muted);">H.Extra 50% (R$)</label><input type="number" class="fi" id="rh-he-valor" value="${horaExtra}" min="0" step="0.01"/></div>
      <div><label style="font-size:10px;color:var(--muted);">DSR (R$)</label><input type="number" class="fi" id="rh-dsr" value="${dsr}" min="0" step="0.01"/></div>
      <div><label style="font-size:10px;color:var(--muted);">Adic. Vale Transp. (R$)</label><input type="number" class="fi" id="rh-adic-vt" value="${adicVt}" min="0" step="0.01"/></div>
      <div><label style="font-size:10px;color:var(--muted);">Outro vencimento (R$)</label><input type="number" class="fi" id="rh-outro-venc" value="${draft.outroVenc||0}" min="0" step="0.01"/></div>
    </div>
    <div style="text-align:right;font-size:13px;font-weight:700;color:#15803D;">Total Vencimentos: R$ ${fmtNum(totalVenc)}</div>
  </div>

  <div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:10px;padding:14px;margin-bottom:14px;">
    <div style="font-weight:800;font-size:13px;margin-bottom:10px;">💸 Descontos</div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px;font-size:12px;">
      <div><label style="font-size:10px;color:var(--muted);">INSS (auto ${fmtNum(inss.aliquotaEfetiva,1)}%)</label><input type="number" class="fi" value="${inss.valor}" disabled style="background:#F1F5F9;"/></div>
      <div><label style="font-size:10px;color:var(--muted);">Adiantamento anterior (R$)</label><input type="number" class="fi" id="rh-adiantamento" value="${adiantamento}" min="0" step="0.01"/></div>
      <div><label style="font-size:10px;color:var(--muted);">Desc. Vale Transp. (R$)</label><input type="number" class="fi" id="rh-desc-vt" value="${descVt}" min="0" step="0.01"/></div>
      <div><label style="font-size:10px;color:var(--muted);">Outro desconto (R$)</label><input type="number" class="fi" id="rh-outro-desc" value="${outroDesc}" min="0" step="0.01"/></div>
    </div>
    <div style="text-align:right;font-size:13px;font-weight:700;color:#DC2626;">Total Descontos: R$ ${fmtNum(totalDesc)}</div>
  </div>

  <div style="background:linear-gradient(135deg,#DCFCE7,#F0FDF4);border:2px solid #15803D;border-radius:10px;padding:14px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;">
    <div style="font-weight:800;font-size:14px;color:#15803D;">💚 LÍQUIDO A RECEBER</div>
    <div style="font-size:24px;font-weight:900;color:#15803D;">R$ ${fmtNum(liquido)}</div>
  </div>

  <div style="display:flex;gap:8px;flex-wrap:wrap;">
    <button class="btn btn-primary" id="btn-rh-gerar-cc" data-colab="${_colabKey(colab)}" data-mes="${mesAno}">🖨️ Gerar Contracheque (2 vias)</button>
    <button class="btn btn-ghost" id="btn-rh-salvar-cc" data-colab="${_colabKey(colab)}" data-mes="${mesAno}">💾 Salvar no Histórico (sem imprimir)</button>
  </div>`;
}

// ── Form Adiantamento ──
function renderFormAdiantamento(colab, dados, mesAno) {
  const draft = S._rhFolhaDraft || {};
  const padrao = (Number(dados.salarioBase)||0) * 0.5;
  const valor = draft.valorAdiantamento != null ? draft.valorAdiantamento : padrao;
  return `
  <div style="background:#FFFBEB;border:1px solid #FCD34D;border-radius:10px;padding:14px;margin-bottom:14px;">
    <div style="font-weight:800;font-size:13px;margin-bottom:10px;">💵 Recibo de Adiantamento Salarial</div>
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;font-size:12px;">
      <div><label style="font-size:10px;color:var(--muted);">Valor do adiantamento (R$)</label>
        <input type="number" class="fi" id="rh-adiant-valor" value="${valor}" min="0" step="0.01" placeholder="50% do salário"/>
        <div style="font-size:10px;color:var(--muted);margin-top:3px;">Padrão: 50% do salário base = R$ ${fmtNum(padrao)}</div>
      </div>
      <div><label style="font-size:10px;color:var(--muted);">Data de pagamento</label>
        <input type="date" class="fi" id="rh-adiant-data" value="${draft.dataPagamento || (() => { const d=new Date(mesAno+'-20'); return d.toISOString().slice(0,10); })()}"/>
        <div style="font-size:10px;color:var(--muted);margin-top:3px;">Padrão: dia 20 do mês de referência</div>
      </div>
    </div>
  </div>

  <div style="display:flex;gap:8px;flex-wrap:wrap;">
    <button class="btn btn-primary" id="btn-rh-gerar-ad" data-colab="${_colabKey(colab)}" data-mes="${mesAno}">🖨️ Gerar Recibo (2 vias)</button>
    <button class="btn btn-ghost" id="btn-rh-salvar-ad" data-colab="${_colabKey(colab)}" data-mes="${mesAno}">💾 Salvar no Histórico</button>
  </div>`;
}

// ─── D) HISTORICO ───────────────────────────────────────────
function renderHistorico() {
  const folhas = getFolhas().sort((a,b) => (b.createdAt||0) - (a.createdAt||0));
  if (!folhas.length) {
    return `<div class="card" style="text-align:center;padding:40px;color:var(--muted);">
      <div style="font-size:36px;">📋</div><p>Nenhuma folha gerada ainda.</p>
    </div>`;
  }
  const colabs = getColabs();
  return `<div class="card">
    <div class="card-title">📋 Histórico de Folhas e Adiantamentos</div>
    <div style="overflow-x:auto;">
      <table style="width:100%;font-size:12px;border-collapse:collapse;">
        <thead><tr style="background:#FAFAFA;">
          <th style="padding:10px;text-align:left;font-size:10px;color:#94A3B8;text-transform:uppercase;">Data Geração</th>
          <th style="padding:10px;text-align:left;font-size:10px;color:#94A3B8;text-transform:uppercase;">Colab</th>
          <th style="padding:10px;text-align:left;font-size:10px;color:#94A3B8;text-transform:uppercase;">Tipo</th>
          <th style="padding:10px;text-align:left;font-size:10px;color:#94A3B8;text-transform:uppercase;">Mês Ref.</th>
          <th style="padding:10px;text-align:right;font-size:10px;color:#94A3B8;text-transform:uppercase;">Valor Líquido</th>
          <th style="padding:10px;text-align:center;font-size:10px;color:#94A3B8;text-transform:uppercase;">Ações</th>
        </tr></thead>
        <tbody>
        ${folhas.map(f => {
          const c = colabs.find(x => _colabKey(x) === f.colabKey);
          return `<tr style="border-bottom:1px solid #F1F5F9;">
            <td style="padding:8px;font-size:11px;">${fmtData(new Date(f.createdAt).toISOString())}</td>
            <td style="padding:8px;font-weight:600;">${escHtml(c?.name||f.colabNome||'—')}</td>
            <td style="padding:8px;"><span style="background:${f.tipo==='contracheque'?'#DBEAFE':'#FEF3C7'};color:${f.tipo==='contracheque'?'#1E40AF':'#92400E'};border-radius:6px;padding:2px 8px;font-size:10px;font-weight:700;">${f.tipo==='contracheque'?'🧾 Contracheque':'💵 Adiantamento'}</span></td>
            <td style="padding:8px;font-size:11px;">${fmtMesAno(f.mesAno)}</td>
            <td style="padding:8px;text-align:right;font-weight:700;color:#15803D;">R$ ${fmtNum(f.valorLiquido)}</td>
            <td style="padding:8px;text-align:center;">
              <button class="btn btn-ghost btn-xs" data-rhfolha-print="${f.id}" title="Imprimir novamente">🖨️</button>
              <button class="btn btn-ghost btn-xs" data-rhfolha-del="${f.id}" style="color:var(--red);" title="Excluir do histórico">🗑️</button>
            </td>
          </tr>`;
        }).join('')}
        </tbody>
      </table>
    </div>
  </div>`;
}

// ─────────────────────────────────────────────────────────────
//                  IMPRESSAO (layout do modelo)
// ─────────────────────────────────────────────────────────────

// Renderiza UMA via do contracheque ou adiantamento como bloco HTML
function renderViaImpressao(folha, colab, dados) {
  const e = getEmpresa();
  const isAdiant = folha.tipo === 'adiantamento';
  const titulo = isAdiant ? 'Recibo de Pgto de Adiantamento' : 'Recibo de contracheque';
  const enderecoLinha = `${e.endereco}`;
  const cnpjLinha = `CNPJ:&nbsp;&nbsp;${e.cnpj}`;
  const empresaCol = `Empresa:&nbsp;${e.empresaCodigo||''}`;

  // Linhas da tabela
  let linhas = '';
  if (isAdiant) {
    linhas = `<tr>
      <td style="padding:3px 4px;">17</td>
      <td style="padding:3px 4px;">Adiantamento salarial</td>
      <td style="padding:3px 4px;text-align:right;"></td>
      <td style="padding:3px 4px;text-align:right;">${fmtNum(folha.valorAdiantamento)}</td>
      <td style="padding:3px 4px;text-align:right;"></td>
    </tr>`;
  } else {
    const c = folha.contracheque || {};
    const items = [];
    if (c.salarioBase > 0)   items.push({ cod:'1',   desc:'Salário base',                ref:c.diasTrab||'31,00',  venc:c.salarioBase, desc_:'' });
    if (c.horaExtra > 0)     items.push({ cod:'5',   desc:'Hora extra 50%',              ref:c.horaExtraQtd?fmtNum(c.horaExtraQtd):'', venc:c.horaExtra, desc_:'' });
    if (c.dsr > 0)           items.push({ cod:'10',  desc:'(DSR) Repouso remunerado',    ref:'', venc:c.dsr, desc_:'' });
    if (c.adicVT > 0)        items.push({ cod:'503', desc:'Adic. Vale Transporte',       ref:'', venc:c.adicVT, desc_:'' });
    if (c.outroVenc > 0)     items.push({ cod:'',    desc:'Outros vencimentos',          ref:'', venc:c.outroVenc, desc_:'' });
    if (c.inss > 0)          items.push({ cod:'71',  desc:'INSS',                        ref:'*'+fmtNum(c.inssAliq,2), venc:'', desc_:c.inss });
    if (c.adiantamento > 0)  items.push({ cod:'74',  desc:'Adiantamento salarial anterior', ref:'', venc:'', desc_:c.adiantamento });
    if (c.descVT > 0)        items.push({ cod:'504', desc:'Desc. Vale Transporte',       ref:'', venc:'', desc_:c.descVT });
    if (c.outroDesc > 0)     items.push({ cod:'',    desc:'Outros descontos',            ref:'', venc:'', desc_:c.outroDesc });
    linhas = items.map(i => `<tr>
      <td style="padding:3px 4px;">${i.cod}</td>
      <td style="padding:3px 4px;">${escHtml(i.desc)}</td>
      <td style="padding:3px 4px;text-align:right;">${i.ref}</td>
      <td style="padding:3px 4px;text-align:right;">${i.venc?fmtNum(i.venc):''}</td>
      <td style="padding:3px 4px;text-align:right;">${i.desc_?fmtNum(i.desc_):''}</td>
    </tr>`).join('');
    // Preenche linhas vazias para layout
    const vazias = Math.max(0, 11 - items.length);
    for (let i=0;i<vazias;i++) linhas += `<tr><td colspan="5" style="padding:8px;">&nbsp;</td></tr>`;
  }

  const totalVenc = isAdiant ? folha.valorAdiantamento : folha.totalVencimentos;
  const totalDesc = isAdiant ? 0 : folha.totalDescontos;
  const liquido   = folha.valorLiquido;
  const sal = Number(dados.salarioBase) || 0;
  const dataPagto = isAdiant
    ? (folha.dataPagamento || `20/${folha.mesAno?.split('-')[1] || ''}/${folha.mesAno?.split('-')[0] || ''}`)
    : folha.dataPagamento || '';

  return `
<div style="font-family:Arial,sans-serif;font-size:11px;color:#000;border:1px solid #000;width:100%;box-sizing:border-box;page-break-inside:avoid;">
  <!-- Header -->
  <div style="display:flex;border-bottom:1px solid #000;">
    <div style="flex:1;padding:6px 8px;border-right:1px solid #000;">
      <div style="font-weight:bold;font-size:11px;">${escHtml(e.razao)}</div>
      <div style="font-size:9px;">${escHtml(e.endereco)}</div>
      <div style="font-size:9px;">${cnpjLinha}</div>
    </div>
    <div style="padding:6px 8px;text-align:right;min-width:200px;">
      <div style="font-weight:bold;font-size:13px;">${titulo}</div>
      <div style="font-size:9px;">${empresaCol}</div>
    </div>
  </div>

  <!-- Identificacao do colab -->
  <table style="width:100%;border-collapse:collapse;font-size:10px;border-bottom:1px solid #000;">
    <tr>
      <td style="padding:4px 6px;border-right:1px solid #000;width:8%;">
        <div style="font-weight:bold;font-size:9px;">Código</div>${escHtml(dados.codigo||'—')}
      </td>
      <td style="padding:4px 6px;border-right:1px solid #000;width:24%;">
        <div style="font-weight:bold;font-size:9px;">Nome do Funcionário</div>${escHtml(colab.name||'')}
      </td>
      <td style="padding:4px 6px;border-right:1px solid #000;width:22%;">
        <div style="font-weight:bold;font-size:9px;">CBO</div>${escHtml(dados.cbo||'')}
      </td>
      <td style="padding:4px 6px;border-right:1px solid #000;width:14%;">
        <div style="font-weight:bold;font-size:9px;">Setor</div>${escHtml(dados.setor||'')}
      </td>
      <td style="padding:4px 6px;border-right:1px solid #000;width:12%;">
        <div style="font-weight:bold;font-size:9px;">Seção</div>
        <div style="font-size:9px;">Admissão ${fmtData(dados.dataAdmissao)}</div>
      </td>
      <td style="padding:4px 6px;width:20%;">
        <div style="font-weight:bold;font-size:9px;">F.I.</div>1
        <div style="font-size:9px;">PIS</div>${escHtml(dados.pis||'')}
      </td>
    </tr>
  </table>

  <!-- Tabela de Vencimentos / Descontos -->
  <table style="width:100%;border-collapse:collapse;font-size:10px;">
    <thead>
      <tr style="border-bottom:1px solid #000;">
        <th style="padding:4px;border-right:1px solid #000;text-align:left;width:6%;">Cód.</th>
        <th style="padding:4px;border-right:1px solid #000;text-align:left;">Descrição</th>
        <th style="padding:4px;border-right:1px solid #000;text-align:right;width:14%;">Referência</th>
        <th style="padding:4px;border-right:1px solid #000;text-align:right;width:18%;">Vencimentos</th>
        <th style="padding:4px;text-align:right;width:18%;">Descontos</th>
      </tr>
    </thead>
    <tbody>
      ${linhas}
    </tbody>
  </table>

  <!-- Rodape: dados bancarios + totais -->
  <table style="width:100%;border-collapse:collapse;font-size:9px;border-top:1px solid #000;">
    <tr>
      <td style="padding:4px 6px;border-right:1px solid #000;border-bottom:1px solid #000;">
        <div style="font-weight:bold;">${fmtMesAno(folha.mesAno)}</div>
        <div>(*)Última alíquota da tabela progressiva Portaria SPREV/ME nº3.659</div>
      </td>
      <td style="padding:4px 6px;border-right:1px solid #000;border-bottom:1px solid #000;width:30%;">
        CPF: ${escHtml(dados.cpf||'')}<br/>
        Banco.: ${escHtml(dados.banco||'')}&nbsp;&nbsp;Ag.: ${escHtml(dados.agencia||'')}<br/>
        Conta.: ${escHtml(dados.conta||'')}
      </td>
      <td style="padding:4px 6px;border-right:1px solid #000;border-bottom:1px solid #000;width:18%;text-align:right;">
        Total de Vencimentos<br/><strong style="font-size:11px;">${fmtNum(totalVenc)}</strong>
      </td>
      <td style="padding:4px 6px;border-bottom:1px solid #000;width:18%;text-align:right;">
        Total de Descontos<br/><strong style="font-size:11px;">${fmtNum(totalDesc)}</strong>
      </td>
    </tr>
    <tr>
      <td colspan="3" style="padding:4px 6px;border-right:1px solid #000;text-align:right;">Valor Líquido</td>
      <td style="padding:4px 6px;text-align:right;font-weight:bold;font-size:13px;">${fmtNum(liquido)}</td>
    </tr>
  </table>

  <!-- Bases de calculo -->
  <table style="width:100%;border-collapse:collapse;font-size:9px;border-top:1px solid #000;">
    <tr>
      <td style="padding:4px 6px;text-align:center;width:14%;"><div style="font-weight:bold;font-size:9px;">Salário Base</div>${fmtNum(sal)}</td>
      <td style="padding:4px 6px;text-align:center;width:14%;"><div style="font-weight:bold;font-size:9px;">Sal. Contr. INSS</div>${isAdiant?'0,00':fmtNum(folha.contracheque?.baseINSS||0)}</td>
      <td style="padding:4px 6px;text-align:center;width:14%;"><div style="font-weight:bold;font-size:9px;">Base Cálc. FGTS</div>${isAdiant?'0,00':fmtNum(folha.contracheque?.baseFGTS||sal)}</td>
      <td style="padding:4px 6px;text-align:center;width:14%;"><div style="font-weight:bold;font-size:9px;">FGTS do Mês</div>${isAdiant?'0,00':fmtNum(folha.contracheque?.fgts||0)}</td>
      <td style="padding:4px 6px;text-align:center;width:18%;"><div style="font-weight:bold;font-size:9px;">Base Cálc. IRRF</div>${isAdiant?'0,00':fmtNum(folha.contracheque?.baseIRRF||0)}</td>
      <td style="padding:4px 6px;text-align:center;width:14%;"><div style="font-weight:bold;font-size:9px;">Faixa IRRF</div>0</td>
    </tr>
  </table>

  <!-- Assinatura -->
  <div style="display:flex;border-top:1px solid #000;font-size:9px;">
    <div style="flex:1;padding:6px 8px;border-right:1px solid #000;">
      Declaro ter recebido a importância líquida discriminada neste recibo
    </div>
    <div style="width:40%;padding:6px 8px;text-align:center;">
      <div style="border-bottom:1px solid #000;height:30px;"></div>
      <div>Assinatura do Funcionário</div>
    </div>
    <div style="width:20%;padding:6px 8px;text-align:center;border-left:1px solid #000;">
      <div style="border-bottom:1px solid #000;height:30px;"></div>
      <div>Data</div>
    </div>
  </div>

  <div style="font-size:9px;padding:4px 8px;">Data para pagamento ${dataPagto}</div>
</div>`;
}

// Abre janela com 2 vias do documento e dispara impressao
export function imprimirFolha(folhaId) {
  const folha = getFolhas().find(f => f.id === folhaId);
  if (!folha) { toast('Folha não encontrada', true); return; }
  const colab = getColabs().find(c => _colabKey(c) === folha.colabKey);
  const dados = getDadosColab(folha.colabKey);
  if (!colab || !dados) { toast('Dados do colab não encontrados', true); return; }
  const via1 = renderViaImpressao(folha, colab, dados);
  const via2 = renderViaImpressao(folha, colab, dados);
  const w = window.open('', '_blank');
  if (!w) { toast('Habilite popups para imprimir', true); return; }
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${folha.tipo==='contracheque'?'Contracheque':'Adiantamento'} — ${colab.name}</title>
    <style>
      @page { size: A4; margin: 8mm; }
      body { margin: 0; padding: 0; font-family: Arial, sans-serif; }
      .via { margin-bottom: 6mm; }
      @media print { .via { page-break-inside: avoid; } }
    </style>
  </head><body>
    <div class="via">${via1}</div>
    <div style="font-size:9px;color:#666;text-align:center;margin:2mm 0;">— 2ª via (folha do funcionário) —</div>
    <div class="via">${via2}</div>
    <script>window.onload = () => setTimeout(() => window.print(), 300);</script>
  </body></html>`);
  w.document.close();
}

// ─────────────────────────────────────────────────────────────
//                          BINDINGS
// ─────────────────────────────────────────────────────────────
export function bindRHFolhaEvents() {
  const render = () => import('../main.js').then(m => m.render()).catch(()=>{});

  // Sub-tabs
  document.querySelectorAll('[data-rhfolha-sub]').forEach(b => {
    b.addEventListener('click', () => {
      S._rhFolhaSub = b.dataset.rhfolhaSub;
      if (S._rhFolhaSub !== 'dados') S._rhFolhaColab = null;
      render();
    });
  });

  // Editar dados de uma colab
  document.querySelectorAll('[data-rhfolha-edit]').forEach(b => {
    b.addEventListener('click', () => {
      S._rhFolhaColab = b.dataset.rhfolhaEdit;
      S._rhFolhaSub = 'dados';
      render();
    });
  });

  // Ir direto para gerar folha de uma colab
  document.querySelectorAll('[data-rhfolha-gerar]').forEach(b => {
    b.addEventListener('click', () => {
      S._rhFolhaColab = b.dataset.rhfolhaGerar;
      S._rhFolhaSub = 'gerar';
      S._rhFolhaTipo = 'contracheque';
      render();
    });
  });

  // SALVAR DADOS DO COLAB
  document.getElementById('btn-rh-salvar')?.addEventListener('click', () => {
    const k = S._rhFolhaColab; if (!k) return;
    const get = id => document.getElementById(id)?.value || '';
    const dados = {
      nome: get('rh-nome'), cpf: get('rh-cpf'), rg: get('rh-rg'), pis: get('rh-pis'),
      dataNascimento: get('rh-nasc'), telefone: get('rh-tel'), email: get('rh-email'),
      cep: get('rh-cep'), rua: get('rh-rua'), numero: get('rh-numero'),
      bairro: get('rh-bairro'), cidade: get('rh-cidade'), estado: get('rh-estado'),
      codigo: get('rh-codigo'), cbo: get('rh-cbo'), setor: get('rh-setor'),
      cargo: get('rh-cargo'), dataAdmissao: get('rh-admissao'), tipoContrato: get('rh-contrato'),
      salarioBase: Number(get('rh-salario'))||0,
      valeTransporte: Number(get('rh-vt'))||0,
      outrosAdicionais: Number(get('rh-adicional'))||0,
      banco: get('rh-banco'), agencia: get('rh-ag'), conta: get('rh-conta'),
    };
    if (!dados.cpf) { toast('CPF é obrigatório', true); return; }
    if (!dados.salarioBase) { toast('Salário base obrigatório', true); return; }
    saveDadosColab(k, dados);
    toast('✅ Dados salvos');
    S._rhFolhaSub = 'list';
    render();
  });

  // Form gerar — mudar colab/mes/tipo
  document.getElementById('rh-folha-colab')?.addEventListener('change', e => {
    S._rhFolhaColab = e.target.value; S._rhFolhaDraft = null; render();
  });
  document.getElementById('rh-folha-mes')?.addEventListener('change', e => {
    S._rhFolhaMes = e.target.value; render();
  });
  document.getElementById('rh-folha-tipo')?.addEventListener('change', e => {
    S._rhFolhaTipo = e.target.value; S._rhFolhaDraft = null; render();
  });

  // Captura draft do contracheque a cada mudanca
  const _capturaCC = () => {
    const get = id => Number(document.getElementById(id)?.value)||0;
    S._rhFolhaDraft = {
      diasTrab: get('rh-dias-trab'),
      horaExtraQtd: get('rh-he-qtd'),
      horaExtra: get('rh-he-valor'),
      dsr: get('rh-dsr'),
      adicVT: get('rh-adic-vt'),
      outroVenc: get('rh-outro-venc'),
      adiantamento: get('rh-adiantamento'),
      descVT: get('rh-desc-vt'),
      outroDesc: get('rh-outro-desc'),
    };
  };
  ['rh-dias-trab','rh-he-qtd','rh-he-valor','rh-dsr','rh-adic-vt','rh-outro-venc',
   'rh-adiantamento','rh-desc-vt','rh-outro-desc'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => { _capturaCC(); render(); });
  });

  // Captura adiantamento
  const _capturaAd = () => {
    S._rhFolhaDraft = { ...(S._rhFolhaDraft||{}),
      valorAdiantamento: Number(document.getElementById('rh-adiant-valor')?.value)||0,
      dataPagamento: document.getElementById('rh-adiant-data')?.value || '',
    };
  };
  ['rh-adiant-valor','rh-adiant-data'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => { _capturaAd(); render(); });
  });

  // GERAR / SALVAR CONTRACHEQUE
  const salvarCC = (imprimir) => {
    const colabKey = S._rhFolhaColab;
    const mesAno = S._rhFolhaMes || (() => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; })();
    if (!colabKey) { toast('Selecione uma colab', true); return; }
    const dados = getDadosColab(colabKey);
    if (!dados.salarioBase) { toast('Cadastre o salário base primeiro', true); return; }
    _capturaCC();
    const draft = S._rhFolhaDraft || {};
    const sal = Number(dados.salarioBase)||0;
    const baseInss = sal + Number(draft.horaExtra||0) + Number(draft.dsr||0);
    const inss = calcINSS(baseInss);
    const fgts = calcFGTS(sal);
    const totalVenc = sal + Number(draft.horaExtra||0) + Number(draft.dsr||0) + Number(draft.adicVT||0) + Number(draft.outroVenc||0);
    const totalDesc = inss.valor + Number(draft.adiantamento||0) + Number(draft.descVT||0) + Number(draft.outroDesc||0);
    const liquido = totalVenc - totalDesc;
    const colab = getColabs().find(c => _colabKey(c) === colabKey);
    const dataPagto = (() => {
      // 5o dia util do mes subsequente — simplifica: dia 5
      const [y,m] = mesAno.split('-').map(Number);
      const dt = new Date(y, m, 5); // m+1 -1 = m no zero-index
      return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}`;
    })();
    const folha = {
      id: 'fl_'+Date.now()+'_'+Math.random().toString(36).slice(2,7),
      colabKey, colabNome: colab?.name||'',
      tipo: 'contracheque', mesAno, createdAt: Date.now(),
      dataPagamento: dataPagto,
      contracheque: {
        salarioBase: sal,
        diasTrab: draft.diasTrab || 31,
        horaExtra: Number(draft.horaExtra||0),
        horaExtraQtd: Number(draft.horaExtraQtd||0),
        dsr: Number(draft.dsr||0),
        adicVT: Number(draft.adicVT||0),
        outroVenc: Number(draft.outroVenc||0),
        inss: inss.valor, inssAliq: inss.aliquotaEfetiva,
        baseINSS: baseInss,
        fgts: fgts.valor, baseFGTS: sal, baseIRRF: baseInss - inss.valor,
        adiantamento: Number(draft.adiantamento||0),
        descVT: Number(draft.descVT||0),
        outroDesc: Number(draft.outroDesc||0),
      },
      totalVencimentos: totalVenc, totalDescontos: totalDesc, valorLiquido: liquido,
    };
    setFolhas([folha, ...getFolhas()]);
    toast('✅ Contracheque salvo no histórico');
    if (imprimir) imprimirFolha(folha.id);
    S._rhFolhaDraft = null;
    render();
  };
  document.getElementById('btn-rh-gerar-cc')?.addEventListener('click', () => salvarCC(true));
  document.getElementById('btn-rh-salvar-cc')?.addEventListener('click', () => salvarCC(false));

  // GERAR / SALVAR ADIANTAMENTO
  const salvarAD = (imprimir) => {
    const colabKey = S._rhFolhaColab;
    const mesAno = S._rhFolhaMes || (() => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; })();
    if (!colabKey) { toast('Selecione uma colab', true); return; }
    _capturaAd();
    const valor = Number(S._rhFolhaDraft?.valorAdiantamento)||0;
    if (valor <= 0) { toast('Informe o valor do adiantamento', true); return; }
    const colab = getColabs().find(c => _colabKey(c) === colabKey);
    const dataPagto = (() => {
      const raw = S._rhFolhaDraft?.dataPagamento;
      if (raw) { const [y,m,d] = raw.split('-'); return `${d}/${m}/${y}`; }
      const [y,m] = mesAno.split('-');
      return `20/${m}/${y}`;
    })();
    const folha = {
      id: 'fl_'+Date.now()+'_'+Math.random().toString(36).slice(2,7),
      colabKey, colabNome: colab?.name||'',
      tipo: 'adiantamento', mesAno, createdAt: Date.now(),
      dataPagamento: dataPagto,
      valorAdiantamento: valor,
      totalVencimentos: valor, totalDescontos: 0, valorLiquido: valor,
    };
    setFolhas([folha, ...getFolhas()]);
    toast('✅ Adiantamento salvo no histórico');
    if (imprimir) imprimirFolha(folha.id);
    S._rhFolhaDraft = null;
    render();
  };
  document.getElementById('btn-rh-gerar-ad')?.addEventListener('click', () => salvarAD(true));
  document.getElementById('btn-rh-salvar-ad')?.addEventListener('click', () => salvarAD(false));

  // Imprimir do historico
  document.querySelectorAll('[data-rhfolha-print]').forEach(b => {
    b.addEventListener('click', () => imprimirFolha(b.dataset.rhfolhaPrint));
  });
  document.querySelectorAll('[data-rhfolha-del]').forEach(b => {
    b.addEventListener('click', () => {
      if (!confirm('Excluir esta folha do histórico?')) return;
      setFolhas(getFolhas().filter(f => f.id !== b.dataset.rhfolhaDel));
      toast('🗑️ Excluído');
      render();
    });
  });
}
