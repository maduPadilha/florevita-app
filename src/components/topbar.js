import { S } from '../state.js';
import { ini } from '../utils/formatters.js';

const titles={dashboard:'Dashboard',impressao:'Módulo de Impressão',pdv:'PDV (Vendas)',pedidos:'Pedidos',clientes:'Clientes',produtos:'Produtos',estoque:'Estoque',producao:'Produção & Montagem',expedicao:'Expedição',entregador:'App Entregador',financeiro:'Financeiro',relatorios:'Relatórios',alertas:'Notificações Recentes',usuarios:'Usuários do Sistema',colaboradores:'Colaboradores & Acesso',config:'Configurações',ponto:'Ponto Eletrônico',caixa:'Caixa — Abertura e Fechamento',backup:'Backup do Sistema',whatsapp:'WhatsApp — Notificações',notasFiscais:'🧾 Notas Fiscais',auditLogs:'🔒 Auditoria & Segurança',agenteTI:'🤖 Agente de TI'};

export function renderTopbar(pendingAlerts = 0){
  const newOrders = S.orders.filter(o=>o.status==='Aguardando').length;

  return`
  <div class="topbar">
    <div style="display:flex;align-items:center;gap:10px;">
      <button class="mob-btn" id="mob-toggle">☰</button>
      <span class="page-title">${titles[S.page]||''}</span>
    </div>
    <div style="display:flex;align-items:center;gap:10px;">
      <span style="font-size:11px;color:var(--muted)">${new Date().toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'short'})}</span>
      <span title="Sincronização automática ativa" style="display:inline-flex;align-items:center;gap:4px;font-size:10px;color:rgba(255,255,255,.5);background:rgba(255,255,255,.1);padding:3px 8px;border-radius:20px;">
        <span id="sync-dot" style="width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.3);display:inline-block;transition:background .3s;"></span>
        Sync
      </span>
      ${newOrders>0?`<span class="notif" onclick="setPage('pedidos')" style="cursor:pointer">${newOrders} novos</span>`:''}
      <button class="btn btn-ghost btn-sm" onclick="setPage('alertas')" style="position:relative;">🔔 <span style="position:absolute;top:-4px;right:-4px;background:var(--red);color:#fff;border-radius:50%;width:14px;height:14px;font-size:9px;display:flex;align-items:center;justify-content:center;">${pendingAlerts}</span></button>
      <a href="painel-tv.html" target="_blank" title="Abrir Painel TV em nova aba"
        style="display:inline-flex;align-items:center;gap:5px;background:rgba(34,197,94,.15);border:1px solid rgba(34,197,94,.3);color:#4ade80;padding:4px 10px;border-radius:20px;font-size:11px;font-weight:600;text-decoration:none;white-space:nowrap;">
        📺 Modo TV
      </a>
    </div>
  </div>`;
}
