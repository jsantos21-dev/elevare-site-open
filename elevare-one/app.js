(() => {
  "use strict";
  const cfg = window.ELEVARE_ONE_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const state = { client: null, user: null, organization: null, membership: null, members: [], recoveryMode: false, isPlatformAdmin: false, organizations: [] };
  const fmtDate = (v) => v ? new Date(v).toLocaleString("pt-BR", { dateStyle:"short", timeStyle:"short" }) : "—";
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const notify = (message, isError=false) => { const el=$("auth-message"); if(el){el.textContent=message;el.style.color=isError?"#e58c8c":"#9ccdb1";} };
  const setMetric = (id, value) => { const el=$(id); if(el) el.textContent=String(value); };
  const table = (rows, columns) => {
    if (!rows.length) return '<div class="empty-state">Nenhum registro encontrado.</div>';
    return '<div class="table-wrap"><table class="data-table"><thead><tr>'+columns.map(c=>'<th>'+c[0]+'</th>').join('')+'</tr></thead><tbody>'+
      rows.map(row=>'<tr>'+columns.map(c=>'<td>'+c[1](row)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
  };
  const fail = (err) => { console.error("[ELEVARE ONE]", err); notify("Não foi possível concluir a operação. Verifique sua conexão ou contate o administrador.", true); };
  function showApplication() {
    $("auth-screen").classList.add("hidden");
    $("application").classList.remove("hidden");
  }
  function showLogin(message="") {
    $("application").classList.add("hidden");
    $("auth-screen").classList.remove("hidden");
    $("login-form").classList.remove("hidden");
    $("set-password-form").classList.add("hidden");
    if(message) notify(message,true);
  }
  async function loadContext() {
    if (state.recoveryMode) return false;
    const { data:{user}, error:userError } = await state.client.auth.getUser();
    if(userError) throw userError;
    if(!user) return false;
    state.user=user;

    const {data:isOwner,error:ownerError}=await state.client.rpc("is_platform_admin");
    if(ownerError) throw ownerError;
    state.isPlatformAdmin=!!isOwner;

    if(state.isPlatformAdmin) {
      const {data:organizations,error:orgError}=await state.client.from("organizations")
        .select("id,name,slug,status,created_at").order("name",{ascending:true}).limit(500);
      if(orgError) throw orgError;
      state.organizations=organizations||[];
      state.membership={role:"platform_owner"};
      $("user-name").textContent=user.user_metadata?.full_name||user.email||"Proprietário";
      $("user-role").textContent="Proprietário da plataforma";
      $("user-avatar").textContent=(user.user_metadata?.full_name||user.email||"E").trim().charAt(0).toUpperCase();
      document.querySelectorAll(".owner-only").forEach(el=>el.classList.remove("hidden"));
      $("owner-org-selector").classList.remove("hidden");
      $("owner-org-selector").innerHTML='<option value="">Selecionar empresa...</option>'+state.organizations.map(o=>'<option value="'+esc(o.id)+'">'+esc(o.name)+'</option>').join("");
      $("org-label").textContent="ACESSO GLOBAL";
      $("org-name").textContent="Todas as empresas";
      showApplication();
      await refreshOwnerConsole();
      navigate("owner");
      return true;
    }

    const {data:memberships,error} = await state.client.from("organization_members")
      .select("organization_id, role, status, organizations(id,name,slug)")
      .eq("user_id",user.id).eq("status","active").limit(2);
    if(error) throw error;
    if(!memberships || memberships.length===0) {
      await state.client.auth.signOut();
      showLogin("Seu usuário ainda não está associado a uma organização. Solicite o provisionamento ao administrador.");
      return false;
    }
    if(memberships.length>1) {
      await state.client.auth.signOut();
      showLogin("Sua conta possui mais de uma organização. O seletor de organizações será habilitado após a configuração de acesso.");
      return false;
    }
    state.membership=memberships[0];
    state.organization=memberships[0].organizations;
    if(!state.organization) throw new Error("Organização não encontrada para esta associação.");
    $("org-name").textContent=state.organization.name;
    $("user-name").textContent=user.user_metadata?.full_name || user.email || "Usuário";
    $("user-role").textContent=state.membership.role;
    $("user-avatar").textContent=(user.user_metadata?.full_name || user.email || "U").trim().charAt(0).toUpperCase();
    showApplication();
    await refreshWorkspace();
    return true;
  }
  async function refreshOwnerConsole() {
    const {data:organizations,error}=await state.client.from("organizations")
      .select("id,name,slug,status,created_at").order("name",{ascending:true}).limit(500);
    if(error) throw error;
    state.organizations=organizations||[];
    setMetric("owner-metric-orgs",state.organizations.length);
    setMetric("owner-metric-active",state.organizations.filter(o=>o.status==="active").length);
    $("owner-org-list").innerHTML=table(state.organizations,[
      ["Empresa",o=>'<strong>'+esc(o.name)+'</strong><br><small>'+esc(o.slug||"")+'</small>'],
      ["Situação",o=>'<span class="status-badge">'+esc(o.status||"—")+'</span>'],
      ["Criada em",o=>fmtDate(o.created_at)],
      ["Acesso",o=>'<button type="button" class="text-button" data-owner-open="'+esc(o.id)+'">Abrir empresa →</button>']
    ]);
    $("owner-org-selector").innerHTML='<option value="">Selecionar empresa...</option>'+state.organizations.map(o=>'<option value="'+esc(o.id)+'">'+esc(o.name)+'</option>').join("");
  }
  async function openOrganization(organizationId) {
    if(!state.isPlatformAdmin) throw new Error("Acesso não autorizado.");
    const organization=state.organizations.find(o=>o.id===organizationId);
    if(!organization) throw new Error("Organização não encontrada.");
    state.organization=organization;
    $("org-label").textContent="EMPRESA SELECIONADA";
    $("org-name").textContent=organization.name;
    $("owner-org-selector").value=organization.id;
    await refreshWorkspace();
    navigate("overview");
  }
  async function countRows(tableName) {
    const {count,error}=await state.client.from(tableName).select("id",{count:"exact",head:true}).eq("organization_id",state.organization.id);
    if(error) throw error;
    return count ?? 0;
  }
  async function refreshWorkspace() {
    const org=state.organization.id;
    const [workflows,runs,integrations,members,activities,kpis] = await Promise.all([
      countRows("workflows"),countRows("workflow_runs"),countRows("integrations"),
      state.client.from("organization_members").select("id",{count:"exact",head:true}).eq("organization_id",org).eq("status","active"),
      state.client.from("audit_logs").select("id,action,entity_type,created_at,actor_user_id").eq("organization_id",org).order("created_at",{ascending:false}).limit(6),
      state.client.from("kpis").select("id,name,code,unit,current_value,target_value,status,period_end").eq("organization_id",org).order("created_at",{ascending:false}).limit(100)
    ]);
    if(members.error) throw members.error;
    if(activities.error) throw activities.error;
    if(kpis.error) throw kpis.error;
    setMetric("metric-workflows",workflows);setMetric("metric-runs",runs);setMetric("metric-integrations",integrations);setMetric("metric-members",members.count??0);
    $("recent-activity").innerHTML=activities.data.length?table(activities.data,[["Evento",r=>esc(r.action)],["Recurso",r=>esc(r.entity_type)],["Data",r=>fmtDate(r.created_at)]]):'<div class="empty-state">Ainda não há atividades registradas.</div>';
    $("kpi-list").innerHTML=table(kpis.data,[["Indicador",r=>'<strong>'+esc(r.name)+'</strong><br><small>'+esc(r.code)+'</small>'],["Atual",r=>esc(r.current_value??"—")+" "+esc(r.unit??"")],["Meta",r=>esc(r.target_value??"—")+" "+esc(r.unit??"")],["Situação",r=>'<span class="status-badge">'+esc(r.status)+'</span>']]);
    $("workflow-list").innerHTML=table((await state.client.from("workflows").select("id,name,description,status,trigger_type,created_at").eq("organization_id",org).order("created_at",{ascending:false}).limit(100)).data||[],[["Processo",r=>'<strong>'+esc(r.name)+'</strong><br><small>'+esc(r.description||"")+'</small>'],["Gatilho",r=>esc(r.trigger_type)],["Estado",r=>'<span class="status-badge">'+esc(r.status)+'</span>'],["Criado em",r=>fmtDate(r.created_at)]]);
    const {data:ints,error:intError}=await state.client.from("integrations").select("id,name,provider,status,last_synced_at,created_at").eq("organization_id",org).order("created_at",{ascending:false}).limit(100);
    if(intError) throw intError;
    $("integration-list").innerHTML=table(ints,[["Integração",r=>'<strong>'+esc(r.name)+'</strong>'],["Provedor",r=>esc(r.provider)],["Estado",r=>'<span class="status-badge">'+esc(r.status)+'</span>'],["Última sincronização",r=>fmtDate(r.last_synced_at)]]);
    await refreshMembers();
    const {data:audit,error:auditError}=await state.client.from("audit_logs").select("id,action,entity_type,entity_id,metadata,created_at,actor_user_id").eq("organization_id",org).order("created_at",{ascending:false}).limit(200);
    if(auditError) throw auditError;
    $("audit-list").innerHTML=table(audit,[["Ação",r=>esc(r.action)],["Tipo",r=>esc(r.entity_type)],["ID do recurso",r=>esc(r.entity_id)],["Detalhes",r=>esc(JSON.stringify(r.metadata||{}))],["Responsável",r=>esc(r.actor_user_id)],["Data",r=>fmtDate(r.created_at)]]);
  }
  function navigate(view) {
    document.querySelectorAll(".view-section").forEach(el=>el.classList.toggle("hidden",el.id!=="view-"+view));
    document.querySelectorAll(".nav-item").forEach(el=>el.classList.toggle("active",el.dataset.view===view));
    const active=document.querySelector('.nav-item[data-view="'+view+'"]');
    $("breadcrumb-current").textContent=active?active.textContent.trim():view;
    $("sidebar").classList.remove("open");
  }
  function openModal(title,description,fields,onSave) {
    const root=$("modal-root");
    root.innerHTML='<div class="modal-backdrop"><form class="modal-card" id="record-form"><h3>'+esc(title)+'</h3><p>'+esc(description)+'</p>'+
      fields.map(f=>f.type==="select" ? '<label for="field-'+esc(f.name)+'">'+esc(f.label)+'</label><select id="field-'+esc(f.name)+'" name="'+esc(f.name)+'" '+(f.required?'required':'')+'>'+(f.options||[]).map(o=>'<option value="'+esc(o.value)+'">'+esc(o.label)+'</option>').join('')+'</select>' : '<label for="field-'+esc(f.name)+'">'+esc(f.label)+'</label><input id="field-'+esc(f.name)+'" name="'+esc(f.name)+'" '+(f.required?'required':'')+' maxlength="'+(f.maxlength||160)+'" placeholder="'+esc(f.placeholder||"")+'">').join('')+
      '<div id="modal-error" class="form-message" role="alert"></div><div class="modal-actions"><button type="button" class="cancel-button" id="modal-cancel">Cancelar</button><button type="submit" class="primary-small">Salvar registro</button></div></form></div>';
    $("modal-cancel").onclick=()=>root.innerHTML="";
    $("record-form").onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('[type=submit]');button.disabled=true;try{const data=Object.fromEntries(new FormData(e.target));await onSave(data);root.innerHTML="";await refreshWorkspace();}catch(err){console.error(err);$("modal-error").textContent=err?.message||"Não foi possível salvar. Verifique os campos e suas permissões.";}finally{button.disabled=false;}};
  }

  const roleLabel = role => ({owner:"Proprietário",admin:"Administrador",manager:"Gerente",member:"Membro",viewer:"Visualizador"}[role]||role);
  const memberStatusLabel = status => ({active:"Ativo",suspended:"Suspenso",invited:"Convite pendente"}[status]||status);
  function workspaceNotice(message,isError=false) {
    const content=document.querySelector(".content");
    let el=$("workspace-notice");
    if(!el){el=document.createElement("div");el.id="workspace-notice";el.setAttribute("role","status");el.style.cssText="margin:0 0 18px;padding:11px 14px;border:1px solid #49665a;border-radius:6px;background:#1a2a31;color:#cfe2d5;font-size:11px";content.prepend(el);}
    el.textContent=message;el.style.borderColor=isError?"#9a5555":"#49665a";el.style.color=isError?"#efb0b0":"#cfe2d5";
  }
  async function adminRequest(payload) {
    const {data,error}=await state.client.functions.invoke("elevare-user-admin",{body:payload});
    if(error){let detail=error.message||"Falha na operação administrativa.";try{const body=await error.context.json();detail=body.error||detail;}catch{}throw new Error(detail);}
    if(data?.error) throw new Error(data.error);
    return data;
  }
  async function refreshMembers() {
    const result=await adminRequest({action:"list"});
    state.members=result.members||[];
    const canManage=["owner","admin"].includes(state.membership.role);
    $("new-member-button").classList.toggle("hidden",!canManage);
    $("member-list").innerHTML=table(state.members,[
      ["Usuário",r=>'<strong>'+esc(r.full_name||"Sem nome")+'</strong><br><small>'+esc(r.email)+'</small>'],
      ["Perfil",r=>esc(roleLabel(r.role))],
      ["Estado",r=>'<span class="status-badge">'+esc(r.status==="active"&&!r.email_confirmed_at?"E-mail pendente":memberStatusLabel(r.status))+'</span>'],
      ["Último acesso",r=>fmtDate(r.last_sign_in_at)],
      ["Adicionado em",r=>fmtDate(r.created_at)],
      ...(canManage?[["Ações",r=>r.user_id===state.user.id?'—':'<div class="member-actions"><button type="button" class="text-button member-action" data-member-action="name" data-member-id="'+esc(r.id)+'">Editar dados</button><button type="button" class="text-button member-action" data-member-action="role" data-member-id="'+esc(r.id)+'">Editar perfil</button><button type="button" class="text-button member-action '+(r.status==="active"?'member-danger':'')+'" data-member-action="status" data-member-id="'+esc(r.id)+'" data-next-status="'+(r.status==="active"?'suspended':'active')+'">'+(r.status==="active"?'Suspender':'Reativar')+'</button></div>']]:[])
    ]);
  }

  function bindActions() {
    document.querySelectorAll(".nav-item").forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.view)));
    document.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.go)));
    $("refresh-button").addEventListener("click",()=>refreshWorkspace().catch(fail));
    $("menu-button").addEventListener("click",()=>$("sidebar").classList.toggle("open"));
    $("signout-button").addEventListener("click",async()=>{await state.client.auth.signOut();showLogin("Sessão encerrada.");});
    $("owner-refresh-button")?.addEventListener("click",()=>refreshOwnerConsole().catch(fail));
    $("owner-org-selector")?.addEventListener("change",e=>{if(e.target.value)openOrganization(e.target.value).catch(fail);else{$("org-name").textContent="Todas as empresas";$("org-label").textContent="ACESSO GLOBAL";navigate("owner");}});
    $("owner-org-list")?.addEventListener("click",e=>{const button=e.target.closest("[data-owner-open]");if(button)openOrganization(button.dataset.ownerOpen).catch(fail);});

    $("new-member-button").addEventListener("click",()=>openModal("Adicionar usuário","O usuário receberá um convite por e-mail para configurar o acesso ao ELEVARE ONE.",[
      {name:"full_name",label:"Nome completo",required:true,maxlength:120},
      {name:"email",label:"E-mail corporativo",required:true,maxlength:254},
      {name:"role",label:"Perfil de acesso",type:"select",required:true,options:(state.membership.role==="owner"?[{value:"admin",label:"Administrador"},{value:"manager",label:"Gerente"},{value:"member",label:"Membro"},{value:"viewer",label:"Visualizador"}]:[{value:"manager",label:"Gerente"},{value:"member",label:"Membro"},{value:"viewer",label:"Visualizador"}])}
    ],async d=>{
      const result=await adminRequest({action:"create",full_name:d.full_name.trim(),email:d.email.trim(),role:d.role});
      workspaceNotice(result.message||"Usuário adicionado.");
    }));
    $("member-list").addEventListener("click",async e=>{
      const button=e.target.closest("[data-member-action]");
      if(!button)return;
      const member=state.members.find(m=>m.id===button.dataset.memberId);
      if(!member)return;
      if(button.dataset.memberAction==="name"){
        openModal("Editar dados do usuário","Atualize o nome de exibição de "+member.email+".",[
          {name:"full_name",label:"Nome completo",required:true,maxlength:120}
        ],async d=>{const result=await adminRequest({action:"update_name",member_id:member.id,full_name:d.full_name.trim()});workspaceNotice(result.message||"Dados atualizados.");});
        const nameInput=$("field-full_name");if(nameInput)nameInput.value=member.full_name||"";
      } else if(button.dataset.memberAction==="role"){
        const options=state.membership.role==="owner"
          ?[{value:"owner",label:"Proprietário"},{value:"admin",label:"Administrador"},{value:"manager",label:"Gerente"},{value:"member",label:"Membro"},{value:"viewer",label:"Visualizador"}]
          :[{value:"manager",label:"Gerente"},{value:"member",label:"Membro"},{value:"viewer",label:"Visualizador"}];
        openModal("Alterar perfil de acesso","Usuário: "+(member.full_name||member.email),[
          {name:"role",label:"Novo perfil",type:"select",required:true,options}
        ],async d=>{const result=await adminRequest({action:"update_role",member_id:member.id,role:d.role});workspaceNotice(result.message||"Perfil atualizado.");});
        const select=$("field-role");if(select)select.value=member.role;
      } else if(button.dataset.memberAction==="status"){
        const next=button.dataset.nextStatus;
        const verb=next==="suspended"?"suspender":"reativar";
        if(!window.confirm("Confirma "+verb+" o acesso de "+(member.full_name||member.email)+"?"))return;
        button.disabled=true;
        try{const result=await adminRequest({action:"set_status",member_id:member.id,status:next});await refreshWorkspace();workspaceNotice(result.message||"Acesso atualizado.");}
        catch(err){workspaceNotice(err.message||"Não foi possível alterar o acesso.",true);}
        finally{button.disabled=false;}
      }
    });
    $("new-kpi-button").addEventListener("click",()=>openModal("Novo indicador","Cadastre um KPI para acompanhar a operação.",[
      {name:"name",label:"Nome do indicador",required:true},{name:"code",label:"Código único",required:true},{name:"unit",label:"Unidade de medida",placeholder:"%, R$, unidades..."},{name:"target_value",label:"Meta numérica"},{name:"current_value",label:"Valor atual"}],async d=>{
      const payload={organization_id:state.organization.id,name:d.name.trim(),code:d.code.trim().toUpperCase(),unit:d.unit.trim()||null,target_value:d.target_value===""?null:Number(d.target_value),current_value:d.current_value===""?null:Number(d.current_value),created_by:state.user.id};
      const {error}=await state.client.from("kpis").insert(payload);if(error)throw error;
    }));
    $("new-workflow-button").addEventListener("click",()=>openModal("Criar processo","Registre um processo para posterior configuração das etapas e regras.",[
      {name:"name",label:"Nome do processo",required:true},{name:"description",label:"Descrição"},{name:"trigger_type",label:"Tipo de gatilho",placeholder:"manual, webhook ou schedule",required:true}],async d=>{
      const trigger=d.trigger_type.trim().toLowerCase();if(!["manual","webhook","schedule"].includes(trigger))throw new Error("Gatilho inválido");
      const {error}=await state.client.from("workflows").insert({organization_id:state.organization.id,name:d.name.trim(),description:d.description.trim()||null,trigger_type:trigger,status:"draft",created_by:state.user.id});if(error)throw error;
    }));
    $("new-integration-button").addEventListener("click",()=>openModal("Cadastrar integração","Cadastre os metadados da conexão. Segredos e tokens não devem ser inseridos neste formulário.",[
      {name:"name",label:"Nome da integração",required:true},{name:"provider",label:"Sistema / provedor",required:true},{name:"endpoint_url",label:"Endpoint HTTPS",required:true}],async d=>{
      let url;try{url=new URL(d.endpoint_url);}catch{throw new Error("URL inválida");}
      if(url.protocol!=="https:")throw new Error("Somente endpoints HTTPS são aceitos.");
      const {error}=await state.client.from("integrations").insert({organization_id:state.organization.id,name:d.name.trim(),provider:d.provider.trim(),endpoint_url:url.toString(),status:"pending",created_by:state.user.id});if(error)throw error;
    }));
  }
  async function init() {
    $("year").textContent=new Date().getFullYear();$("footer-year").textContent=new Date().getFullYear();
    $("today-label").textContent=new Date().toLocaleDateString("pt-BR",{weekday:"long",day:"2-digit",month:"long",year:"numeric"});
    if(!cfg.supabaseUrl||!cfg.supabasePublishableKey||cfg.supabaseUrl.includes("SEU-PROJETO")) {
      notify("Ambiente ainda não configurado. O banco corporativo independente precisa ser provisionado.",true);
      $("login-button").disabled=true;return;
    }
    if(!window.supabase?.createClient){notify("Não foi possível carregar o serviço de autenticação.",true);return;}
    const recoveryHash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const recoveryQuery = new URLSearchParams(window.location.search);
    const inviteMode = recoveryHash.get("type") === "invite" || recoveryQuery.get("type") === "invite";
    state.recoveryMode = recoveryHash.get("type") === "recovery" || recoveryQuery.get("type") === "recovery" || inviteMode || recoveryQuery.has("code");
    state.client=window.supabase.createClient(cfg.supabaseUrl,cfg.supabasePublishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    bindActions();
    if (state.recoveryMode) {
      $("login-form").classList.add("hidden");
      $("set-password-form").classList.remove("hidden");
      $("password-message").textContent=inviteMode?"Defina sua senha para ativar seu acesso ao ELEVARE ONE.":"Valide sua nova senha para concluir a recuperação da conta.";
    }
    $("forgot-password-button").addEventListener("click",async()=>{
      const email=$("email").value.trim();
      if(!email){notify("Informe seu e-mail corporativo para receber o link de ativação ou recuperação.",true);$("email").focus();return;}
      const button=$("forgot-password-button");button.disabled=true;
      try{
        const {error}=await state.client.auth.resetPasswordForEmail(email,{redirectTo:window.location.origin+"/"});
        if(error) throw error;
        notify("Se o endereço estiver cadastrado, enviaremos um link para definir ou redefinir sua senha. Verifique sua caixa de entrada e spam.");
      }catch(err){console.error("[ELEVARE ONE] password recovery",err);const code=err?.code||err?.error_code||"";const status=err?.status||err?.statusCode||0;if(code==="over_email_send_rate_limit"||status===429){notify("Limite temporário de envio de e-mails atingido. Não solicite novos links agora; aguarde a liberação do Supabase ou use o suporte administrativo.",true);}else{notify("Não foi possível enviar o link: "+(err?.message||"erro de autenticação")+". Verifique a configuração de e-mail ou contate o administrador.",true);}}
      finally{button.disabled=false;}
    });
    $("back-to-login-button").addEventListener("click",()=>showLogin());
    $("set-password-form").addEventListener("submit",async e=>{
      e.preventDefault();const password=$("new-password").value;const confirmation=$("confirm-password").value;
      if(password.length<12){$("password-message").textContent="Use pelo menos 12 caracteres.";return;}
      if(password!==confirmation){$("password-message").textContent="As senhas não coincidem.";return;}
      const button=$("save-password-button");button.disabled=true;
      try{
        const {error}=await state.client.auth.updateUser({password});if(error)throw error;
        state.recoveryMode=false;
        window.history.replaceState({}, document.title, window.location.pathname);
        $("password-message").textContent="Senha definida com sucesso. Preparando seu acesso...";
        $("new-password").value="";$("confirm-password").value="";
        await loadContext();
      }catch(err){console.error("[ELEVARE ONE] set password",err);$("password-message").textContent="Não foi possível salvar a senha. Solicite um novo link e tente novamente.";}
      finally{button.disabled=false;}
    });
    $("login-form").addEventListener("submit",async e=>{
      e.preventDefault();const button=$("login-button");button.disabled=true;button.textContent="Validando credenciais...";
      try{const f=new FormData(e.currentTarget);const {error}=await state.client.auth.signInWithPassword({email:f.get("email"),password:f.get("password")});if(error)throw error;await loadContext();}
      catch(err){notify("Não foi possível autenticar. Confira as credenciais ou procure o administrador.",true);}
      finally{button.disabled=false;button.innerHTML='Entrar na plataforma <span>→</span>';}
    });
    state.client.auth.onAuthStateChange((event,session)=>{
      if(event==="PASSWORD_RECOVERY" && session){
        state.recoveryMode=true;
        $("login-form").classList.add("hidden");$("set-password-form").classList.remove("hidden");
        $("password-message").textContent="Defina e confirme sua nova senha para continuar.";
      }
      if(event==="SIGNED_OUT"){state.recoveryMode=false;showLogin();}
    });
    if (!state.recoveryMode) {
      try{await loadContext();}catch(err){fail(err);}
    }
  }
  document.addEventListener("DOMContentLoaded",init);
})();