import { S } from '../state.js';
import { $c, $d, sc, fmtOrderNum } from '../utils/formatters.js';
import { toast } from '../utils/helpers.js';
import { checkDatasEspeciaisAlertas } from './clientes.js';

// ── Helper: render() via dynamic import ───────────────────────
async function render(){
  const { render:r } = await import('../main.js');
  r();
}

// ── ALERTAS (dados reais) ─────────────────────────────────────
export function renderAlertas(){
  const now = Date.now();
  const alertas = [];

  // Pedidos atrasados
  S.orders.filter(o=>['Aguardando','Em preparo','Saiu p/ entrega'].includes(o.status)).forEach(o=>{
    if(!o.scheduledDate) return;
    const diff = new Date(o.scheduledDate).getTime() - now;
    if(diff<0){
      alertas.push({icon:'\u{1F6A8}',tipo:'Pedido Atrasado',msg:`${fmtOrderNum(o)} \u2014 ${o.client?.name||o.clientName||'\u2014'}`,cor:'var(--red)',lido:false,ts:new Date(o.scheduledDate)});
    } else if(diff < 2*60*60*1000){
      alertas.push({icon:'\u23F0',tipo:'Entrega em 2h',msg:`${fmtOrderNum(o)} \u2014 ${o.client?.name||o.clientName||'\u2014'}`,cor:'var(--gold)',lido:false,ts:new Date(o.scheduledDate)});
    }
  });

  // Estoque critico
  S.products.filter(p=>(p.stock||0)<=(p.minStock||5)&&(p.stock||0)>0).forEach(p=>{
    alertas.push({icon:'\u{1F4E6}',tipo:'Estoque Cr\u00edtico',msg:`${p.name} \u2014 ${p.stock} unidade(s)`,cor:'var(--gold)',lido:true,ts:new Date()});
  });
  S.products.filter(p=>(p.stock||0)===0).forEach(p=>{
    alertas.push({icon:'\u{1F6AB}',tipo:'Sem Estoque',msg:`${p.name} \u2014 esgotado`,cor:'var(--red)',lido:false,ts:new Date()});
  });

  // Pedidos recentes (ultimos 30 min)
  S.orders.filter(o=>{const d=new Date(o.createdAt);return now-d.getTime()<30*60*1000;}).slice(0,3).forEach(o=>{
    alertas.push({icon:'\u{1F6CD}\uFE0F',tipo:'Novo Pedido',msg:`${fmtOrderNum(o)} \u2014 ${o.client?.name||o.clientName||'\u2014'} \u00B7 ${$c(o.total)}`,cor:'var(--blue)',lido:false,ts:new Date(o.createdAt)});
  });

  // Pedidos entregues hoje
  const hoje=new Date().toDateString();
  S.orders.filter(o=>o.status==='Entregue'&&new Date(o.updatedAt||o.createdAt).toDateString()===hoje).slice(0,3).forEach(o=>{
    alertas.push({icon:'\u2705',tipo:'Entrega Confirmada',msg:`${fmtOrderNum(o)} \u2014 ${o.driverName?'por '+o.driverName:''}`,cor:'var(--leaf)',lido:true,ts:new Date(o.updatedAt||o.createdAt)});
  });

  // Datas Especiais — alertas 1 dia antes (ou no dia)
  checkDatasEspeciaisAlertas().forEach(a=>{
    const c = a.client;
    const wppLink = c.phone ? `https://wa.me/55${c.phone.replace(/\D/g,'')}?text=${encodeURIComponent(`Ol\u00e1 ${c.name}! \u{1F338} Amanh\u00e3 \u00e9 ${a.tipo} de ${a.pessoa}. Que tal enviarmos um presente especial?`)}` : null;
    alertas.push({
      icon: a.tipo==='Anivers\u00e1rio'?'\u{1F382}':a.tipo==='Namoro'?'\u{1F495}':a.tipo==='Casamento'?'\u{1F48D}':'\u{1F338}',
      tipo: `Data Especial \u2014 ${a.urgencia}`,
      msg: `${a.urgencia} \u00e9 ${a.tipo} de ${a.pessoa} \u00B7 Cliente: ${c.name} \u00B7 C\u00f3d: ${c.code||'\u2014'} \u00B7 ${c.phone||''}`,
      cor: a.diffDias===0?'var(--red)':'var(--rose)',
      lido: false,
      ts: a.dataEsteAno,
      wpp: wppLink,
      clientId: a.clientId,
      extra: {cliente:c.name, codigo:c.code||'\u2014', whatsapp:c.phone||'\u2014', pessoa:a.pessoa, tipo:a.tipo, data:a.data},
    });
  });

  alertas.sort((a,b)=>b.ts-a.ts);

  return`
<div class="card">
  <div class="card-title">\u{1F514} Central de Alertas
    <span class="tag t-rose">${alertas.filter(a=>!a.lido).length} novos</span>
  </div>
  ${alertas.length===0?`<div class="empty"><div class="empty-icon">\u2705</div><p>Nenhum alerta no momento</p></div>`:''}
  ${alertas.map(a=>`
  <div style="display:flex;align-items:flex-start;gap:12px;padding:12px;border-radius:var(--r);margin-bottom:8px;border:1px solid ${a.lido?'var(--border)':'var(--rose-l)'};background:${a.lido?'#fff':'var(--petal)'};">
    <div style="font-size:22px;flex-shrink:0">${a.icon}</div>
    <div style="flex:1;min-width:0;">
      <div style="font-size:11px;color:${a.cor};font-weight:600;text-transform:uppercase;letter-spacing:1px">${a.tipo}</div>
      <div style="font-size:13px;font-weight:500;margin-top:2px">${a.msg}</div>
      ${a.extra?`<div style="margin-top:6px;background:#fff;border-radius:6px;padding:8px;font-size:11px;display:grid;grid-template-columns:1fr 1fr;gap:4px;">
        <div>\u{1F464} <strong>${a.extra.cliente}</strong></div>
        <div>\u{1F3F7}\uFE0F C\u00f3d: <strong>${a.extra.codigo}</strong></div>
        <div>\u{1F4F1} <strong>${a.extra.whatsapp}</strong></div>
        <div>\u{1F389} ${a.extra.tipo} de <strong>${a.extra.pessoa}</strong></div>
      </div>`:''}
      ${a.wpp?`<a href="${a.wpp}" target="_blank" style="display:inline-flex;align-items:center;gap:6px;margin-top:8px;background:#25D366;color:#fff;border:none;padding:6px 14px;border-radius:20px;font-size:11px;font-weight:700;text-decoration:none;">\u{1F4AC} Contatar via WhatsApp</a>`:''}
    </div>
    <div style="font-size:11px;color:var(--muted);flex-shrink:0;white-space:nowrap;">${a.ts?.toLocaleTimeString?a.ts.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):''}</div>
    ${!a.lido?`<div style="width:8px;height:8px;border-radius:50%;background:var(--rose);flex-shrink:0;margin-top:4px;"></div>`:''}
  </div>`).join('')}
</div>`;
}
