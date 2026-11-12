(() => {
  "use strict";
  const cfg = window.ELEVARE_ONE_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const state = { client: null, user: null, organization: null, membership: null };
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
    if(message) notify(message,true);
  }
  async function loadContext() {
    const { data:{user}, error:userError } = await state.client.auth.getUser();
    if(userError) throw userError;
    if(!user) return false;
    state.user=user;
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
    const {data:memberRows,error:memberError}=await state.client.from("organization_members").select("id,user_id,role,status,created_at").eq("organization_id",org).order("created_at",{ascending:false}).limit(100);
    if(memberError) throw memberError;
    $("member-list").innerHTML=table(memberRows,[["Identificador",r=>esc(r.user_id)],["Perfil",r=>esc(r.role)],["Estado",r=>'<span class="status-badge">'+esc(r.status)+'</span>'],["Desde",r=>fmtDate(r.created_at)]]);
    const {data:audit,error:auditError}=await state.client.from("audit_logs").select("id,action,entity_type,entity_id,created_at,actor_user_id").eq("organization_id",org).order("created_at",{ascending:false}).limit(200);
    if(auditError) throw auditError;
    $("audit-list").innerHTML=table(audit,[["Ação",r=>esc(r.action)],["Tipo",r=>esc(r.entity_type)],["ID do recurso",r=>esc(r.entity_id)],["Responsável",r=>esc(r.actor_user_id)],["Data",r=>fmtDate(r.created_at)]]);
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
      fields.map(f=>'<label for="field-'+esc(f.name)+'">'+esc(f.label)+'</label><input id="field-'+esc(f.name)+'" name="'+esc(f.name)+'" '+(f.required?'required':'')+' maxlength="'+(f.maxlength||160)+'" placeholder="'+esc(f.placeholder||"")+'">').join('')+
      '<div id="modal-error" class="form-message" role="alert"></div><div class="modal-actions"><button type="button" class="cancel-button" id="modal-cancel">Cancelar</button><button type="submit" class="primary-small">Salvar registro</button></div></form></div>';
    $("modal-cancel").onclick=()=>root.innerHTML="";
    $("record-form").onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('[type=submit]');button.disabled=true;try{const data=Object.fromEntries(new FormData(e.target));await onSave(data);root.innerHTML="";await refreshWorkspace();}catch(err){console.error(err);$("modal-error").textContent="Não foi possível salvar. Verifique os campos e suas permissões.";}finally{button.disabled=false;}};
  }
  function bindActions() {
    document.querySelectorAll(".nav-item").forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.view)));
    document.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.go)));
    $("refresh-button").addEventListener("click",()=>refreshWorkspace().catch(fail));
    $("menu-button").addEventListener("click",()=>$("sidebar").classList.toggle("open"));
    $("signout-button").addEventListener("click",async()=>{await state.client.auth.signOut();showLogin("Sessão encerrada.");});
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
    state.client=window.supabase.createClient(cfg.supabaseUrl,cfg.supabasePublishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    bindActions();
    $("login-form").addEventListener("submit",async e=>{
      e.preventDefault();const button=$("login-button");button.disabled=true;button.textContent="Validando credenciais...";
      try{const f=new FormData(e.currentTarget);const {error}=await state.client.auth.signInWithPassword({email:f.get("email"),password:f.get("password")});if(error)throw error;await loadContext();}
      catch(err){notify("Não foi possível autenticar. Confira as credenciais ou procure o administrador.",true);}
      finally{button.disabled=false;button.innerHTML='Entrar na plataforma <span>→</span>';}
    });
    state.client.auth.onAuthStateChange((event,session)=>{if(event==="SIGNED_OUT")showLogin();});
    try{await loadContext();}catch(err){fail(err);}
  }
  document.addEventListener("DOMContentLoaded",init);
})();