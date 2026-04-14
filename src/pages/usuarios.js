import { S, ALL_PERMS, PERMS_DEFAULT } from '../state.js';
import { ini, rolec, esc } from '../utils/formatters.js';
import { GET, POST, PUT, DELETE, PATCH } from '../services/api.js';
import { toast } from '../utils/helpers.js';
import { can, getUserPerms, setUserPerms, mergeUserExtra, setUserExtra } from '../services/auth.js';

// ── Helper: render() via dynamic import ───────────────────────
async function render(){
  const { render:r } = await import('../main.js');
  r();
}

// ── MODULO USUARIOS (Admin) ───────────────────────────────────
export function renderUsuarios(){
  if(S.user?.role!=='Administrador') return`
  <div class="empty card"><div class="empty-icon">\u{1F512}</div>
  <p style="font-weight:600">Acesso restrito</p>
  <p style="font-size:12px;margin-top:4px">Somente o Administrador pode gerenciar usu\u00e1rios.</p></div>`;

  const q=(S._userSearch||'').toLowerCase();
  const list=S.users.filter(u=>!q||u.name?.toLowerCase().includes(q)||u.email?.toLowerCase().includes(q));

  return`
<div style="display:flex;gap:8px;margin-bottom:14px;align-items:center;flex-wrap:wrap;">
  <div class="search-box" style="flex:1;">
    <span class="si">\u{1F50D}</span>
    <input class="fi" id="user-search" placeholder="Buscar usu\u00e1rio..." value="${S._userSearch||''}"/>
  </div>
  <button class="btn btn-primary" type="button" onclick="showNewUserModal()">\u2795 Novo Usu\u00e1rio</button>
  <button class="btn btn-ghost btn-sm" id="btn-rel-users" title="Recarregar">\u{1F504}</button>
</div>

<div class="alert al-info" style="margin-bottom:14px;">
  \u2139\uFE0F Os <strong>usu\u00e1rios</strong> t\u00eam acesso ao backend do sistema. Para gerenciar permiss\u00f5es de m\u00f3dulos por colaborador, use o m\u00f3dulo <strong>\u{1F465} Colaboradores</strong>.
</div>

<div class="card">
<div class="card-title">Usu\u00e1rios do Sistema <span style="font-size:11px;color:var(--muted)">${S.users.length}</span></div>
${list.length===0?`<div class="empty"><div class="empty-icon">\u{1F465}</div><p>Nenhum usu\u00e1rio</p></div>`:`
<div class="tw"><table>
  <thead><tr><th>Nome</th><th>E-mail</th><th>Cargo</th><th>Unidade</th><th>Status</th><th>A\u00e7\u00f5es</th></tr></thead>
  <tbody>
  ${list.map(u=>{
    const ativo=u.active!==false;
    const isMe=u._id===S.user?._id;
    return`<tr>
      <td><div style="display:flex;align-items:center;gap:7px;">
        <div class="av" style="width:28px;height:28px;font-size:10px;background:${ativo?'var(--rose)':'var(--muted)'};">${ini(u.name)}</div>
        <span style="font-weight:500">${u.name}${isMe?' \u{1F464}':''}</span>
      </div></td>
      <td style="color:var(--muted);font-size:11px">${u.email}</td>
      <td><span class="tag ${rolec(u.role)}">${u.role||'\u2014'}</span></td>
      <td style="font-size:11px">${u.unit||'\u2014'}</td>
      <td><span class="tag ${ativo?'t-green':'t-red'}">${ativo?'Ativo':'Inativo'}</span></td>
      <td style="white-space:nowrap">
        <button class="btn btn-ghost btn-xs" type="button" onclick="showEditUserModal('${u._id}')" style="margin-right:4px">\u270F\uFE0F Editar</button>
        ${!isMe?`<button class="btn btn-ghost btn-xs" type="button" onclick="toggleUser('${u._id}',${ativo})">${ativo?'\u{1F512} Desativar':'\u{1F513} Ativar'}</button>
        <button type="button" onclick="deleteUser('${u._id}')" style="background:var(--red-l);color:var(--red);border:1px solid rgba(220,38,38,.2);border-radius:6px;padding:3px 7px;cursor:pointer;font-size:12px;margin-left:4px;">\u{1F5D1}\uFE0F Excluir</button>`:''}
      </td>
    </tr>`;
  }).join('')}
  </tbody>
</table></div>`}
</div>`;
}

export async function showNewUserModal(user=null){
  const edit=!!user;
  const CARGOS=['Administrador','Gerente','Atendimento','Producao','Expedicao','Financeiro','Entregador'];
  const UNIDADES=['Loja Novo Aleixo','Loja Allegro Mall','CDLE','Todas'];
  S._modal=`<div class="mo" id="mo" onclick="if(event.target===this){S._modal='';render();}">
  <div class="mo-box" style="max-width:500px;" onclick="event.stopPropagation()">
  <div class="mo-title">${edit?'\u270F\uFE0F Editar':'\u2795 Novo'} Usu\u00e1rio</div>
  <div class="fr2">
    <div class="fg"><label class="fl">Nome completo *</label><input class="fi" id="mu-name" value="${user?.name||''}" placeholder="Nome"/></div>
    <div class="fg"><label class="fl">E-mail *</label><input class="fi" id="mu-email" type="email" value="${user?.email||''}" placeholder="email@exemplo.com"/></div>
    <div class="fg"><label class="fl">Senha ${edit?'(vazio = manter)':'*'}</label><input class="fi" id="mu-pass" type="password" placeholder="M\u00edn. 6 caracteres"/></div>
    <div class="fg"><label class="fl">WhatsApp</label><input class="fi" id="mu-phone" value="${user?.phone||''}" placeholder="(92) 9xxxx-xxxx"/></div>
    <div class="fg"><label class="fl">Cargo *</label>
      <select class="fi" id="mu-role">
        ${CARGOS.map(c=>`<option value="${c}" ${user?.role===c?'selected':''}>${c}</option>`).join('')}
      </select>
    </div>
    <div class="fg"><label class="fl">Unidade *</label>
      <select class="fi" id="mu-unit">
        ${UNIDADES.map(u=>`<option value="${u}" ${user?.unit===u?'selected':''}>${u}</option>`).join('')}
      </select>
    </div>
  </div>
  <label class="cb" style="margin-bottom:14px;cursor:pointer;">
    <input type="checkbox" id="mu-active" ${user?.active!==false?'checked':''}/>
    <span style="font-size:12px">Usu\u00e1rio ativo</span>
  </label>
  <div class="mo-foot">
    <button type="button" class="btn btn-primary" id="btn-sv-user">\u{1F4BE} ${edit?'Atualizar':'Cadastrar'}</button>
    <button type="button" class="btn btn-ghost" id="btn-mo-close-u">Cancelar</button>
  </div>
  </div></div>`;
  await render();
  document.getElementById('btn-mo-close-u')?.addEventListener('click',()=>{S._modal='';render();});
  document.getElementById('btn-sv-user')?.addEventListener('click',()=>saveUser(user?._id));
}

export async function saveUser(editId=null){
  const name=document.getElementById('mu-name')?.value?.trim()||'';
  const email=document.getElementById('mu-email')?.value?.trim()||'';
  const pass=document.getElementById('mu-pass')?.value||'';
  const phone=document.getElementById('mu-phone')?.value?.trim()||'';
  const role=document.getElementById('mu-role')?.value||'Atendimento';
  const unit=document.getElementById('mu-unit')?.value||'Loja Novo Aleixo';
  const active=document.getElementById('mu-active')?.checked!==false;

  if(!name) return toast('\u274C Nome obrigat\u00f3rio');
  if(!email) return toast('\u274C E-mail obrigat\u00f3rio');
  if(!editId&&!pass) return toast('\u274C Senha obrigat\u00f3ria');
  if(!editId&&pass.length<6) return toast('\u274C Senha m\u00ednimo 6 caracteres');
  if(editId&&pass&&pass.length<6) return toast('\u274C Nova senha m\u00ednimo 6 caracteres');

  S._modal=''; S.loading=true; try{render();}catch(e){}
  const base={name,email,phone,active};
  if(pass) base.password=pass;

  let u=null, saved=false, lastErr='';
  for(const data of [{...base,role,unit},base,{...base,role:'Administrador',unit:'Todas'}]){
    try{ u=editId?await PUT('/users/'+editId,data):await POST('/users',data); saved=true; break; }
    catch(e){ lastErr=e.message||''; if(!/enum|valid|required|cast/i.test(lastErr)) break; }
  }
  if(!saved){ S.loading=false; try{render();}catch(e){} return toast('\u274C '+((/email|duplicate|E11000/i.test(lastErr))?'E-mail j\u00e1 cadastrado':lastErr||'Erro ao salvar'),true); }

  const uid=u?._id||u?.id||editId;
  if(!uid){ S.loading=false; try{render();}catch(e){} return toast('\u274C ID n\u00e3o retornado',true); }

  setUserExtra(uid,{role,unit,name,email});
  const merged=mergeUserExtra({...(u||{}),_id:uid});
  if(editId) S.users=S.users.map(x=>x._id===editId?{...x,...merged}:x);
  else if(merged._id) S.users.unshift(merged);
  if(S.user?._id===uid){ S.user={...S.user,...merged}; localStorage.setItem('fv2_user',JSON.stringify(S.user)); }
  S.loading=false; try{render();}catch(e){}
  toast(editId?`\u2705 ${name} atualizado!`:`\u2705 ${name} cadastrado! Login: ${email}`);
}

export async function deleteUser(id){
  const u=S.users.find(x=>x._id===id); if(!u) return;
  window._delUserId=id;
  S._modal=`<div class="mo" id="mo" onclick="if(event.target===this){S._modal='';render();}">
  <div class="mo-box" style="max-width:360px;text-align:center;" onclick="event.stopPropagation()">
  <div style="font-size:40px;margin-bottom:10px">\u26A0\uFE0F</div>
  <div style="font-family:'Playfair Display',serif;font-size:17px;margin-bottom:6px">Excluir Usu\u00e1rio?</div>
  <div style="font-size:12px;color:var(--muted);margin-bottom:18px;"><strong>${u.name}</strong><br>${u.email||''}</div>
  <div style="display:flex;gap:8px;justify-content:center;">
    <button class="btn btn-red" onclick="confirmDeleteUser()" style="padding:10px 20px;">\u{1F5D1}\uFE0F Excluir</button>
    <button class="btn btn-ghost" onclick="S._modal='';render();">Cancelar</button>
  </div></div></div>`;
  render();
}

export function showEditUserModal(id){
  const u = S.users.find(x=>x._id===id);
  if(!u){ toast('\u274C Usu\u00e1rio n\u00e3o encontrado',true); return; }
  showNewUserModal(u);
}

export function confirmDeleteUser(){
  const id=window._delUserId; if(!id) return;
  const u=S.users.find(x=>x._id===id);
  DELETE('/users/'+id).then(()=>{
    S.users=S.users.filter(x=>x._id!==id);
    S._modal=''; window._delUserId=null; render();
    toast('\u{1F5D1}\uFE0F '+(u?.name||'Usu\u00e1rio')+' removido');
  }).catch(e=>toast('\u274C Erro: '+e.message,true));
}

export async function toggleUserActive(id, currentActive){
  S.users=S.users.map(x=>x._id===id?{...x,active:!currentActive}:x);
  render();
  try{ await PATCH('/users/'+id+'/toggle',{active:!currentActive}); toast(!currentActive?'\u2705 Ativado!':'\u{1F512} Desativado!'); }
  catch(e){ S.users=S.users.map(x=>x._id===id?{...x,active:currentActive}:x); render(); toast('\u274C Erro: '+(e.message||''),true); }
}
