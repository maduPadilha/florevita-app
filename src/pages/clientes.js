import { S, BAIRROS_MANAUS } from '../state.js';
import { $c, $d, sc, ini, segc, esc } from '../utils/formatters.js';
import { GET, POST, PUT, DELETE } from '../services/api.js';
import { toast } from '../utils/helpers.js';
import { can } from '../services/auth.js';
import { invalidateCache } from '../services/cache.js';

// ── Helper: render() via dynamic import ───────────────────────
async function render(){
  const { render:r } = await import('../main.js');
  r();
}

// ── Helper: setPage via dynamic import ────────────────────────
async function setPage(pg){
  const { setPage:sp } = await import('../main.js');
  sp(pg);
}

// ── DATAS ESPECIAIS — Funções de acesso (migrado para API) ───
export async function getDatasEspeciais(clientId){
  if(!clientId) return [];
  try {
    const data = await GET('/settings/datas-especiais-'+clientId);
    return data?.value || [];
  } catch {
    // fallback localStorage
    const all = JSON.parse(localStorage.getItem('fv_datas_especiais')||'{}');
    return all[clientId] || [];
  }
}

export async function saveDatasEspeciais(clientId, datas){
  if(!clientId) return;
  try {
    await PUT('/settings/datas-especiais-'+clientId, { value: datas });
  } catch {
    // fallback localStorage
    const all = JSON.parse(localStorage.getItem('fv_datas_especiais')||'{}');
    all[clientId] = datas;
    localStorage.setItem('fv_datas_especiais', JSON.stringify(all));
  }
}

// ── VERIFICA DATAS ESPECIAIS -> gera alertas (executar diariamente) ─
export function checkDatasEspeciaisAlertas(){
  // Leitura sincrona do localStorage como fallback para alertas em render
  const all = JSON.parse(localStorage.getItem('fv_datas_especiais')||'{}');
  const alertas = [];
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const amanha = new Date(hoje); amanha.setDate(hoje.getDate()+1);
  const emDoisDias = new Date(hoje); emDoisDias.setDate(hoje.getDate()+2);

  Object.entries(all).forEach(([clientId, datas])=>{
    const client = S.clients.find(c=>c._id===clientId);
    if(!client) return;
    (datas||[]).forEach(d=>{
      if(!d.data) return;
      // Reconstroi a data com o ANO ATUAL para ver se bate amanha
      const parts = d.data.split('-'); // YYYY-MM-DD ou MM-DD
      const mes = parts.length===3 ? parseInt(parts[1])-1 : parseInt(parts[0])-1;
      const dia = parts.length===3 ? parseInt(parts[2]) : parseInt(parts[1]);
      const dataEsteAno = new Date(hoje.getFullYear(), mes, dia);
      dataEsteAno.setHours(0,0,0,0);
      // Se ja passou este ano, verifica no proximo
      if(dataEsteAno < hoje) dataEsteAno.setFullYear(hoje.getFullYear()+1);

      const diffDias = Math.round((dataEsteAno - hoje) / (1000*60*60*24));

      if(diffDias === 1 || diffDias === 0){
        const urgencia = diffDias === 0 ? 'HOJE' : 'AMANHA';
        alertas.push({
          clientId, client,
          tipo: d.tipo, pessoa: d.pessoa, motivo: d.motivo,
          data: d.data, dataEsteAno, diffDias, urgencia,
        });
      }
    });
  });
  return alertas;
}

// ── Helper sincrono para datas especiais no render ───────────
function getDatasEspeciaisSync(clientId){
  if(!clientId) return [];
  const all = JSON.parse(localStorage.getItem('fv_datas_especiais')||'{}');
  return all[clientId] || [];
}

// ── CLIENTES ─────────────────────────────────────────────────
export function renderClientes(){
  const q = (S._clientSearch||'').toLowerCase();
  const list = S.clients.filter(c=>!q||c.name?.toLowerCase().includes(q)||c.phone?.includes(q)||c.email?.toLowerCase().includes(q));
  const sel = S._clientSel;

  return`
<div style="display:flex;gap:8px;margin-bottom:14px;align-items:center;flex-wrap:wrap;">
  <div class="search-box" style="flex:1;min-width:160px;">
    <span class="si">&#128269;</span>
    <input class="fi" id="cli-search" placeholder="Buscar por nome, telefone ou e-mail..." value="${S._clientSearch||''}"/>
  </div>
  <button class="btn btn-primary" id="btn-new-cli">&#10133; Novo Cliente</button>
</div>

<div class="g2">
  <!-- Lista -->
  <div class="card" style="padding:0;overflow:hidden;">
    <div style="padding:12px 14px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">
      <span style="font-weight:600">Clientes <span class="notif">${S.clients.length}</span></span>
      <span style="font-size:11px;color:var(--muted)">${list.length} exibidos</span>
    </div>
    ${list.length===0?`<div class="empty" style="padding:30px"><div class="empty-icon">&#128101;</div><p>Nenhum cliente encontrado</p></div>`:`
    <div style="overflow-x:auto;">
    <table>
      <thead><tr><th>Cliente</th><th>WhatsApp</th><th>Segmento</th><th>Pedidos</th><th></th></tr></thead>
      <tbody>${list.map(c=>`<tr style="cursor:pointer" data-cli="${c._id}">
        <td>
          <div style="display:flex;align-items:center;gap:8px;">
            <div class="av" style="width:30px;height:30px;font-size:11px;">${ini(c.name)}</div>
            <div>
              <div style="font-weight:600;font-size:13px">${c.name}${(()=>{const al=checkDatasEspeciaisAlertas().filter(a=>a.clientId===c._id);const ds=getDatasEspeciaisSync(c._id);return al.length?`<span style="background:var(--red);color:#fff;border-radius:10px;padding:0 5px;font-size:9px;margin-left:4px">&#127874; ${al[0].urgencia}</span>`:ds.length?`<span style="font-size:11px;margin-left:4px;color:var(--muted)">&#127874;&times;${ds.length}</span>`:'';})()}</div>
              ${c.email?`<div style="font-size:10px;color:var(--muted)">${c.email}</div>`:''}
            </div>
          </div>
        </td>
        <td style="color:var(--muted);font-size:12px">${c.phone||'\u2014'}</td>
        <td><span class="tag ${segc(c.segment||'Novo')}">${c.segment||'Novo'}</span></td>
        <td style="font-weight:600;color:var(--rose)">${c.totalOrders||0}</td>
        <td style="white-space:nowrap;">
          <button type="button" class="btn btn-ghost btn-xs btn-edit-cli" data-cid="${c._id}" title="Editar">&#9998;&#65039; Editar</button>
          <button type="button" class="btn-del-cli" data-cid="${c._id}" style="background:var(--red-l);color:var(--red);border:1px solid rgba(220,38,38,.2);border-radius:6px;padding:3px 7px;cursor:pointer;font-size:12px;">&#128465;&#65039; Excluir</button>
        </td>
      </tr>`).join('')}</tbody>
    </table>
    </div>`}
  </div>

  <!-- Painel direito: detalhe ou vazio -->
  ${sel ? `
  <div class="card">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <div style="display:flex;align-items:center;gap:10px;">
        <div class="av" style="width:44px;height:44px;font-size:16px;">${ini(sel.name)}</div>
        <div>
          <div style="font-weight:700;font-size:15px">${sel.name}</div>
          <span class="tag ${segc(sel.segment||'Novo')}">${sel.segment||'Novo'}</span>
        </div>
      </div>
      <button class="btn btn-ghost btn-sm" id="btn-cli-close">&times;</button>
    </div>

    <div class="g2" style="margin-bottom:12px;">
      <div><div style="font-size:10px;color:var(--muted)">WhatsApp</div><div style="font-weight:500">${sel.phone||'\u2014'}</div></div>
      <div><div style="font-size:10px;color:var(--muted)">E-mail</div><div style="font-size:12px">${sel.email||'\u2014'}</div></div>
      <div><div style="font-size:10px;color:var(--muted)">Total Pedidos</div><div style="font-size:20px;font-weight:700;color:var(--rose)">${sel.totalOrders||0}</div></div>
      <div><div style="font-size:10px;color:var(--muted)">Total Gasto</div><div style="font-size:16px;font-weight:700;color:var(--leaf)">${$c(sel.totalSpent||0)}</div></div>
      ${sel.birthday?`<div><div style="font-size:10px;color:var(--muted)">Aniversario</div><div style="font-size:12px">&#127874; ${sel.birthday}</div></div>`:''}
      ${sel.cpf?`<div><div style="font-size:10px;color:var(--muted)">CPF</div><div style="font-size:12px">${sel.cpf}</div></div>`:''}
    </div>

    ${sel.address?.street?`<div style="padding:10px;background:var(--cream);border-radius:8px;margin-bottom:12px;font-size:12px;">
      <div style="font-size:10px;color:var(--muted);margin-bottom:3px;">&#128205; Endereco</div>
      ${sel.address.street}, ${sel.address.number} \u2014 ${sel.address.neighborhood}
      ${sel.address.cep?`<span style="color:var(--muted)"> \u00B7 CEP ${sel.address.cep}</span>`:''}
    </div>`:''}

    ${sel.notes?`<div style="padding:10px;background:var(--petal);border-radius:8px;margin-bottom:12px;font-size:12px;">
      <div style="font-size:10px;color:var(--muted);margin-bottom:3px;">&#128221; Observacoes</div>
      ${sel.notes}
    </div>`:''}

    <!-- Historico de pedidos do cliente -->
    ${(()=>{
      const ords = S.orders.filter(o=>o.client===sel._id||o.clientName===sel.name).slice(0,5);
      if(!ords.length) return '';
      return `<div style="margin-bottom:12px;">
        <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Ultimos Pedidos</div>
        ${ords.map(o=>`<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;">
          <span style="font-weight:600;color:var(--rose)">${o.orderNumber}</span>
          <span class="tag ${sc(o.status)}">${o.status}</span>
          <span style="font-weight:600">${$c(o.total)}</span>
        </div>`).join('')}
      </div>`;
    })()}

    <div style="display:flex;gap:6px;flex-wrap:wrap;">
      <a href="https://wa.me/55${(sel.phone||'').replace(/\\D/g,'')}" target="_blank" class="btn btn-green btn-sm">&#128241; WhatsApp</a>
      <button type="button" class="btn btn-primary btn-sm btn-edit-cli-detail" data-cid="${sel._id}">&#9998;&#65039; Editar</button>
      <button class="btn btn-ghost btn-sm" id="btn-cli-new-order">&#128722; Novo Pedido</button>
      <button type="button" class="btn-del-cli-detail" data-cid="${sel._id}" style="background:var(--red-l);color:var(--red);border:1px solid rgba(220,38,38,.2);border-radius:8px;padding:8px 16px;cursor:pointer;font-size:13px;font-weight:600;">&#128465;&#65039; Excluir</button>
    </div>
  </div>` : `
  <div class="card" style="display:flex;align-items:center;justify-content:center;flex-direction:column;gap:8px;min-height:220px;color:var(--muted);">
    <div style="font-size:42px">&#128100;</div>
    <div style="font-size:13px">Selecione um cliente para ver detalhes</div>
  </div>`}
</div>`;
}

// ── MODAL: ADICIONAR DATA ESPECIAL ────────────────────────────
export async function showAddDataEspecialModal(clientId, onSave){
  const TIPOS = ['Aniversario','Namoro','Casamento','Dia das Maes','Dia dos Pais','Formatura','Outro'];
  const prevModal = S._modal;
  S._modal=`<div class="mo" id="mo-data" onclick="if(event.target===this){document.getElementById('mo-data').remove();}">
  <div class="mo-box" style="max-width:420px;" onclick="event.stopPropagation()">
    <div style="font-family:'Playfair Display',serif;font-size:17px;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--border);">
      &#127874; Nova Data Especial
    </div>
    <div class="fr2" style="gap:10px;">
      <div class="fg">
        <label class="fl">Tipo da data *</label>
        <select class="fi" id="de-tipo">
          ${TIPOS.map(t=>`<option>${t}</option>`).join('')}
        </select>
      </div>
      <div class="fg">
        <label class="fl">Nome da pessoa *</label>
        <input class="fi" id="de-pessoa" placeholder="Ex: Maria, Esposa, Mae"/>
      </div>
      <div class="fg">
        <label class="fl">Data (dia/mes) *</label>
        <input class="fi" id="de-data" type="date" max="2099-12-31"/>
      </div>
      <div class="fg">
        <label class="fl">Motivo / Observacao</label>
        <input class="fi" id="de-motivo" placeholder="Ex: Bouquet surpresa"/>
      </div>
    </div>
    <div style="background:var(--petal);border-radius:8px;padding:10px;font-size:11px;color:var(--rose);margin-top:8px;margin-bottom:16px;">
      &#128161; O sistema alertara automaticamente 1 dia antes desta data todo ano.
    </div>
    <div style="display:flex;gap:8px;">
      <button class="btn btn-primary" id="btn-de-save" style="flex:1;justify-content:center;">&#128190; Salvar Data</button>
      <button class="btn btn-ghost" id="btn-de-cancel">Cancelar</button>
    </div>
  </div></div>`;
  await render();

  document.getElementById('btn-de-cancel')?.addEventListener('click',()=>{
    S._modal=''; render();
    if(onSave) onSave();
  });
  document.getElementById('btn-de-save')?.addEventListener('click', async ()=>{
    const tipo   = document.getElementById('de-tipo')?.value||'';
    const pessoa = document.getElementById('de-pessoa')?.value?.trim()||'';
    const data   = document.getElementById('de-data')?.value||'';
    const motivo = document.getElementById('de-motivo')?.value?.trim()||'';

    if(!pessoa) return toast('Nome da pessoa e obrigatorio');
    if(!data)   return toast('Data e obrigatoria');

    // Valida data
    const d = new Date(data);
    if(isNaN(d.getTime())) return toast('Data invalida');

    const datas = await getDatasEspeciais(clientId||'');
    // Evita duplicata
    const existe = datas.find(x=>x.tipo===tipo&&x.pessoa===pessoa&&x.data===data);
    if(existe) return toast('Esta data ja esta cadastrada');

    datas.push({tipo, pessoa, data, motivo, criadoEm: new Date().toISOString()});
    await saveDatasEspeciais(clientId||'', datas);
    toast(`Data "${tipo} de ${pessoa}" cadastrada!`);
    S._modal=''; render();
    if(onSave) onSave();
  });
}

// ── MODAL CLIENTE ─────────────────────────────────────────────
export async function showClientModal(client=null){
  const edit = !!client;
  const SEGMENTS = ['Novo','Frequente','VIP','Corporativo','Inativo'];
  const datasSync = getDatasEspeciaisSync(client?._id||'');

  S._modal=`<div class="mo" id="mo" onclick="if(event.target===this){S._modal='';render();}">
  <div class="mo-box" style="max-width:560px;" onclick="event.stopPropagation()">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--border);">
    <div style="font-family:'Playfair Display',serif;font-size:18px;">${edit?'&#9998;&#65039; Editar':'&#10133; Novo'} Cliente</div>
    <button onclick="S._modal='';render();" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--muted)">&times;</button>
  </div>

  <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px;">&#128100; Dados Pessoais</div>
  <div class="fr2">
    <div class="fg" style="grid-column:span 2"><label class="fl">Nome completo *</label>
      <input class="fi" id="cm-name" value="${client?.name||''}" placeholder="Nome do cliente"/></div>
    <div class="fg"><label class="fl">WhatsApp *</label>
      <input class="fi" id="cm-phone" value="${client?.phone||''}" placeholder="(92) 9xxxx-xxxx"/></div>
    <div class="fg"><label class="fl">E-mail</label>
      <input class="fi" id="cm-email" type="email" value="${client?.email||''}" placeholder="email@exemplo.com"/></div>
    <div class="fg"><label class="fl">CPF</label>
      <input class="fi" id="cm-cpf" value="${client?.cpf||''}" placeholder="000.000.000-00"/></div>
    <div class="fg"><label class="fl">Aniversario</label>
      <input class="fi" id="cm-bday" type="date" value="${client?.birthday||''}"/></div>
    <div class="fg"><label class="fl">Segmento</label>
      <select class="fi" id="cm-seg">
        ${SEGMENTS.map(s=>`<option ${client?.segment===s?'selected':''}>${s}</option>`).join('')}
      </select>
    </div>
  </div>

  <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;margin:12px 0 8px;">&#128205; Endereco</div>
  <div class="fr2">
    <div class="fg" style="grid-column:span 2"><label class="fl">Rua</label>
      <input class="fi" id="cm-street" value="${client?.address?.street||''}" placeholder="Rua, Avenida..."/></div>
    <div class="fg"><label class="fl">Numero</label>
      <input class="fi" id="cm-number" value="${client?.address?.number||''}" placeholder="123"/></div>
    <div class="fg"><label class="fl">Bairro</label>
      <input class="fi" id="cm-neigh" value="${client?.address?.neighborhood||''}" placeholder="Bairro"/></div>
    <div class="fg"><label class="fl">CEP</label>
      <input class="fi" id="cm-cep" value="${client?.address?.cep||''}" placeholder="69000-000"/></div>
  </div>

  <div class="fg" style="margin-top:8px;"><label class="fl">Observacoes</label>
    <textarea class="fi" id="cm-notes" rows="2" placeholder="Preferencias, alergias, etc.">${client?.notes||''}</textarea>
  </div>

  <!-- ── DATAS ESPECIAIS ──────────────────────────────────── -->
  <hr style="margin:14px 0;border-color:var(--border)"/>
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
    <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;">&#127874; Datas Especiais</div>
    <button type="button" id="btn-add-data-especial" class="btn btn-ghost btn-sm">+ Adicionar data</button>
  </div>
  <div id="datas-especiais-list">
    ${(()=>{
      const datas = datasSync;
      if(!datas.length) return '<div style="font-size:11px;color:var(--muted);padding:8px 0;">Nenhuma data cadastrada.</div>';
      return datas.map((d,i)=>`
      <div class="data-especial-item" style="background:var(--cream);border-radius:8px;padding:8px 10px;margin-bottom:6px;display:flex;align-items:center;gap:8px;">
        <span style="font-size:18px;">${d.tipo==='Aniversario'?'&#127874;':d.tipo==='Namoro'?'&#128149;':d.tipo==='Casamento'?'&#128141;':d.tipo==='Dia das Maes'?'&#128105;':d.tipo==='Dia dos Pais'?'&#128104;':'&#127800;'}</span>
        <div style="flex:1;">
          <div style="font-weight:700;font-size:12px;">${d.tipo} \u2014 ${d.pessoa}</div>
          <div style="font-size:11px;color:var(--muted);">${d.data} ${d.motivo?'\u00B7 '+d.motivo:''}</div>
        </div>
        <button type="button" class="btn-del-data" data-di="${i}" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:14px;">&#128465;&#65039;</button>
      </div>`).join('');
    })()}
  </div>

  <div class="mo-foot">
    <button class="btn btn-primary" id="btn-cm-save" style="flex:1;justify-content:center;">&#128190; ${edit?'Atualizar':'Cadastrar'}</button>
    <button class="btn btn-ghost" id="btn-cm-cancel">Cancelar</button>
  </div>
  </div></div>`;

  await render();
  document.getElementById('btn-cm-cancel')?.addEventListener('click',()=>{S._modal='';render();});
  document.getElementById('btn-cm-save')?.addEventListener('click',()=>saveClient(client?._id));

  // Datas especiais — adicionar
  document.getElementById('btn-add-data-especial')?.addEventListener('click',()=>{
    showAddDataEspecialModal(client?._id, ()=>showClientModal(client));
  });
  // Datas especiais — remover
  document.querySelectorAll('.btn-del-data').forEach(btn=>btn.addEventListener('click', async ()=>{
    const i = parseInt(btn.dataset.di);
    const datas = await getDatasEspeciais(client?._id||'');
    datas.splice(i,1);
    await saveDatasEspeciais(client?._id||'', datas);
    showClientModal(client);
  }));
}

// ── SALVAR CLIENTE ────────────────────────────────────────────
export async function saveClient(editId=null){
  const name  = document.getElementById('cm-name')?.value?.trim()||'';
  const phone = document.getElementById('cm-phone')?.value?.trim()||'';
  const email = document.getElementById('cm-email')?.value?.trim()||'';
  const cpf   = document.getElementById('cm-cpf')?.value?.trim()||'';
  const bday  = document.getElementById('cm-bday')?.value||'';
  const seg   = document.getElementById('cm-seg')?.value||'Novo';
  const notes = document.getElementById('cm-notes')?.value?.trim()||'';
  const addr  = {
    street:       document.getElementById('cm-street')?.value?.trim()||'',
    number:       document.getElementById('cm-number')?.value?.trim()||'',
    neighborhood: document.getElementById('cm-neigh')?.value?.trim()||'',
    cep:          document.getElementById('cm-cep')?.value?.trim()||'',
    city:         'Manaus',
  };

  if(!name)  return toast('Nome obrigatorio');
  if(!phone) return toast('WhatsApp obrigatorio');

  S._modal=''; S.loading=true; try{render();}catch(e){}
  try{
    const payload={name,phone,email,cpf,birthday:bday||undefined,segment:seg,notes,address:addr,
      unit:S.user.unit==='Todas'?'Loja Novo Aleixo':S.user.unit};
    let c;
    if(editId){
      c = await PUT('/clients/'+editId, payload);
      S.clients = S.clients.map(x=>x._id===editId?{...x,...payload,...(c||{})}:x);
      if(S._clientSel?._id===editId) S._clientSel={...S._clientSel,...payload,...(c||{})};
    } else {
      const code='CLI-'+String(S.clients.length+1).padStart(4,'0');
      c = await POST('/clients',{...payload,code});
      if(c?._id) S.clients.unshift(c);
    }
    invalidateCache('clients');
    S.loading=false; render();
    toast(editId?`${name} atualizado!`:`${name} cadastrado!`);
  }catch(e){
    S.loading=false; render(); toast('Erro: '+(e.message||''));
  }
}

// ── EXCLUIR CLIENTE ───────────────────────────────────────────
export async function deleteClient(id){
  const c = S.clients.find(x=>x._id===id);
  if(!c) return;
  window._delClientId = id;
  S._modal=`<div class="mo" id="mo" onclick="if(event.target===this){S._modal='';render();}">
  <div class="mo-box" style="max-width:360px;text-align:center;" onclick="event.stopPropagation()">
  <div style="font-size:40px;margin-bottom:10px">&#9888;&#65039;</div>
  <div style="font-family:'Playfair Display',serif;font-size:17px;margin-bottom:6px">Excluir Cliente?</div>
  <div style="font-size:12px;color:var(--muted);margin-bottom:18px;"><strong>${c.name}</strong><br>${c.phone||''}</div>
  <div style="display:flex;gap:8px;justify-content:center;">
    <button class="btn btn-red" id="btn-confirm-del-cli" style="padding:10px 20px;">&#128465;&#65039; Excluir</button>
    <button class="btn btn-ghost" id="btn-cancel-del-cli">Cancelar</button>
  </div></div></div>`;
  await render();

  document.getElementById('btn-confirm-del-cli')?.addEventListener('click',()=>confirmDeleteClient());
  document.getElementById('btn-cancel-del-cli')?.addEventListener('click',()=>{S._modal='';render();});
}

export function confirmDeleteClient(){
  const id = window._delClientId; if(!id) return;
  const c = S.clients.find(x=>x._id===id);
  DELETE('/clients/'+id).then(()=>{
    S.clients=S.clients.filter(x=>x._id!==id);
    if(S._clientSel?._id===id) S._clientSel=null;
    S._modal=''; window._delClientId=null;
    invalidateCache('clients');
    render();
    toast((c?.name||'Cliente')+' excluido');
  }).catch(e=>toast('Erro: '+e.message));
}

// ── BIND EVENTS (chamado apos render) ─────────────────────────
export function bindClientesEvents(){
  // Search
  document.getElementById('cli-search')?.addEventListener('input', e=>{
    S._clientSearch = e.target.value;
    render();
  });

  // Novo cliente
  document.getElementById('btn-new-cli')?.addEventListener('click',()=>showClientModal());

  // Selecionar cliente na tabela
  document.querySelectorAll('[data-cli]').forEach(row=>{
    row.addEventListener('click', e=>{
      if(e.target.closest('button')) return;
      const id = row.dataset.cli;
      S._clientSel = S.clients.find(c=>c._id===id)||null;
      render();
    });
  });

  // Fechar painel detalhe
  document.getElementById('btn-cli-close')?.addEventListener('click',()=>{
    S._clientSel=null; render();
  });

  // Novo pedido a partir do detalhe
  document.getElementById('btn-cli-new-order')?.addEventListener('click',()=>setPage('pdv'));

  // Editar da tabela
  document.querySelectorAll('.btn-edit-cli').forEach(btn=>btn.addEventListener('click',()=>{
    const c = S.clients.find(x=>x._id===btn.dataset.cid);
    if(c) showClientModal(c);
  }));

  // Editar do detalhe
  document.querySelectorAll('.btn-edit-cli-detail').forEach(btn=>btn.addEventListener('click',()=>{
    const c = S.clients.find(x=>x._id===btn.dataset.cid);
    if(c) showClientModal(c);
  }));

  // Excluir da tabela
  document.querySelectorAll('.btn-del-cli').forEach(btn=>btn.addEventListener('click',()=>{
    deleteClient(btn.dataset.cid);
  }));

  // Excluir do detalhe
  document.querySelectorAll('.btn-del-cli-detail').forEach(btn=>btn.addEventListener('click',()=>{
    deleteClient(btn.dataset.cid);
  }));
}
