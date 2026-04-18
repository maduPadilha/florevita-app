// ── FORMATADORES ────────────────────────────────────────────
export const $c = v => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v||0);
export const $d = d => {
  if(!d) return '—';
  // Se for string YYYY-MM-DD, formata sem timezone (evita bug UTC em Manaus UTC-4)
  if(typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)){
    const [y,m,day] = d.split('-');
    return `${day}/${m}/${y}`;
  }
  return new Date(d).toLocaleDateString('pt-BR');
};
export const ini = n => n ? n.split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase() : '?';

// Formata código do pedido: sempre #XXXXX (sem prefixo PED-)
export const fmtOrderNum = (o) => {
  const raw = (o?.orderNumber || o?.numero || o || '').toString();
  const clean = raw.replace(/^#/,'').replace(/^PED-?/i,'').trim();
  return clean ? '#' + clean : '—';
};

export const sc = s => ({
  'Entregue':        'tag-status tag-entregue',
  'Em preparo':      'tag-status tag-preparo',
  'Saiu p/ entrega': 'tag-status tag-rota',
  'Aguardando':      'tag-status tag-aguardando',
  'Cancelado':       'tag-status tag-cancelado',
  'Reentrega':       'tag-status tag-preparo',
  'Pago':            'tag-status tag-entregue',
  'Pendente':        'tag-status tag-preparo',
  'Pronto':          'tag-status tag-pronto',
  'Em Produção':     'tag-status tag-preparo',
  'Pagar na Entrega':'tag-status tag-rota',
}[s]||'tag-status tag-aguardando');

// ── STATUS DE PAGAMENTO: mapa de cores (inline style) ────────
// Usado em Dashboard, Pedidos, Financeiro — qualquer tela que mostre paymentStatus
export const PAY_STATUS_COLORS = {
  'Comprov. Enviado':        'background:#FEF08A;color:#713F12;border-color:#EAB308;',  // amarelo
  'Ag. Comprovante':         'background:#FECACA;color:#7F1D1D;border-color:#DC2626;',  // vermelho
  'Ag. Pagamento':           'background:#FDE68A;color:#78350F;border-color:#B45309;',  // âmbar/marrom
  'Aprovado':                'background:#BBF7D0;color:#064E3B;border-color:#16A34A;',  // verde
  'Cancelado':               'background:#1F2937;color:#F9FAFB;border-color:#111827;',  // preto
  'Extornado':               'background:#5B21B6;color:#EDE9FE;border-color:#4C1D95;',  // roxo
  'Negado':                  'background:#991B1B;color:#FEE2E2;border-color:#7F1D1D;',  // vermelho escuro
  'Ag. Pagamento na Entrega':'background:#FEF08A;color:#713F12;border-color:#EAB308;',  // amarelo (pedido saiu para entrega, aguarda pagamento na entrega)
  'Pago na Entrega':         'background:#FED7AA;color:#7C2D12;border-color:#F97316;',  // laranja
  // Aliases/compat
  'Pago':                    'background:#BBF7D0;color:#064E3B;border-color:#16A34A;',
  'Pendente':                'background:#FDE68A;color:#78350F;border-color:#B45309;',
};
export const PAY_STATUS_OPTIONS = [
  'Comprov. Enviado','Ag. Comprovante','Ag. Pagamento','Aprovado',
  'Cancelado','Extornado','Negado','Ag. Pagamento na Entrega','Pago na Entrega'
];
export function paymentStatusBadge(status){
  const s = status || 'Ag. Pagamento';
  const style = PAY_STATUS_COLORS[s] || PAY_STATUS_COLORS['Ag. Pagamento'];
  return `<span style="${style}display:inline-block;border:1px solid;border-radius:20px;padding:2px 10px;font-size:10px;font-weight:700;white-space:nowrap;">${s}</span>`;
}

export const segc = s => ({'VIP':'t-rose','Recorrente':'t-green','Novo':'t-blue'}[s]||'t-gray');
export const rolec = r => ({'Administrador':'t-rose','Gerente':'t-purple','Atendimento':'t-blue','Producao':'t-green','Expedicao':'t-gold','Financeiro':'t-gray','Entregador':'t-blue'}[r]||'t-gray');
export const emoji = c => ({'Rosa':'🌹','Buquê':'💐','Orquídea':'🌸','Planta':'🌱','Kit':'🎁','Vaso':'🌿','Flor':'🌺','Coroa':'👑','Cesta':'🧺','Embalagem':'📦','Adicional':'✨'}[c]||'🌸');

// ── SANITIZAÇÃO ───────────────────────────────────────────────
export const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
