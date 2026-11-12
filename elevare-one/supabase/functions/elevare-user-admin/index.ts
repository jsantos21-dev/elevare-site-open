import { createClient } from "npm:@supabase/supabase-js@2";

const ORIGIN = "https://elevare-one.onrender.com";
const corsHeaders = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

function envKey(single: string, grouped: string, keyName: string) {
  const direct = Deno.env.get(single);
  if (direct) return direct;
  const raw = Deno.env.get(grouped);
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    return parsed[keyName] || Object.values(parsed)[0] as string || "";
  } catch {
    return "";
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    const origin = req.headers.get("origin");
    if (origin && origin !== ORIGIN) return new Response("Forbidden", { status: 403 });
    return new Response("ok", { headers: corsHeaders });
  }
  const origin = req.headers.get("origin");
  if (origin && origin !== ORIGIN) return json({ error: "Origem não autorizada." }, 403);
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL") || "";
    const publicKey = envKey("SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEYS", "default");
    const secretKey = envKey("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEYS", "default");
    if (!url || !publicKey || !secretKey) throw new Error("Configuração administrativa indisponível.");

    const authHeader = req.headers.get("authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Sessão não autenticada." }, 401);
    const token = authHeader.slice(7);

    const userClient = createClient(url, publicKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authHeader } },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Sessão inválida ou expirada." }, 401);
    const actor = authData.user;

    const admin = createClient(url, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body = await req.json();
    const action = String(body.action || "");
    const organizationId = "6bf7564b-cfbd-4910-bbcd-61cac85b6380";

    const { data: actorMembership, error: actorError } = await admin
      .from("organization_members")
      .select("id, role, status")
      .eq("organization_id", organizationId)
      .eq("user_id", actor.id)
      .maybeSingle();
    if (actorError) throw actorError;
    if (!actorMembership || actorMembership.status !== "active" ||
        !["owner", "admin"].includes(actorMembership.role)) {
      return json({ error: "Você não tem permissão para gerenciar usuários." }, 403);
    }
    const actorRole = actorMembership.role;

    const writeAudit = async (verb: string, memberId: string | null, metadata: Record<string, unknown>) => {
      const { error } = await admin.from("audit_logs").insert({
        organization_id: organizationId,
        actor_user_id: actor.id,
        action: verb,
        entity_type: "organization_member",
        entity_id: memberId,
        metadata,
      });
      if (error) throw error;
    };

    if (action === "list") {
      const { data: members, error } = await admin.from("organization_members")
        .select("id, user_id, role, status, created_at")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;

      const users: any[] = [];
      for (let page = 1; page <= 20; page++) {
        const { data, error: listError } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
        if (listError) throw listError;
        users.push(...data.users);
        if (data.users.length < 1000) break;
      }
      const byId = new Map(users.map((u: any) => [u.id, u]));
      return json({
        members: (members || []).map((m: any) => {
          const u: any = byId.get(m.user_id);
          return {
            id: m.id, user_id: m.user_id, role: m.role, status: m.status,
            created_at: m.created_at, email: u?.email || "E-mail indisponível",
            full_name: u?.user_metadata?.full_name || u?.user_metadata?.name || "",
            last_sign_in_at: u?.last_sign_in_at || null,
          };
        }),
      });
    }

    if (action === "create") {
      const email = String(body.email || "").trim().toLowerCase();
      const fullName = String(body.full_name || "").trim();
      const role = String(body.role || "member");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Informe um e-mail válido." }, 400);
      if (fullName.length < 2 || fullName.length > 120) return json({ error: "Informe o nome completo." }, 400);
      if (!["admin", "manager", "member", "viewer"].includes(role)) return json({ error: "Perfil inválido." }, 400);
      if (role === "admin" && actorRole !== "owner") return json({ error: "Somente o proprietário pode criar administradores." }, 403);

      const { data: currentMembers, error: memberLookupError } = await admin.from("organization_members")
        .select("id,user_id").eq("organization_id", organizationId);
      if (memberLookupError) throw memberLookupError;

      let existingUser: any = null;
      for (let page = 1; page <= 20 && !existingUser; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) throw error;
        existingUser = data.users.find((u: any) => (u.email || "").toLowerCase() === email) || null;
        if (data.users.length < 1000) break;
      }
      if (existingUser && (currentMembers || []).some((m: any) => m.user_id === existingUser.id)) {
        return json({ error: "Este usuário já pertence à organização." }, 409);
      }

      let invited = false;
      let userId = existingUser?.id;
      if (!existingUser) {
        const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
          data: { full_name: fullName },
          redirectTo: ORIGIN + "/",
        });
        if (error) throw error;
        userId = data.user?.id;
        invited = true;
      } else {
        const { error } = await admin.auth.admin.updateUserById(existingUser.id, {
          user_metadata: { ...(existingUser.user_metadata || {}), full_name: fullName },
        });
        if (error) throw error;
      }
      if (!userId) throw new Error("Não foi possível identificar o usuário criado.");

      const { data: inserted, error: insertError } = await admin.from("organization_members")
        .insert({ organization_id: organizationId, user_id: userId, role, status: "active" })
        .select("id").single();
      if (insertError) {
        if (invited) await admin.auth.admin.deleteUser(userId);
        throw insertError;
      }
      await writeAudit("member.invited", inserted.id, { email, role, invited });
      return json({ ok: true, invited, message: invited ? "Convite enviado por e-mail." : "Usuário existente adicionado à organização." });
    }

    const memberId = String(body.member_id || "");
    if (!/^[0-9a-f-]{36}$/i.test(memberId)) return json({ error: "Membro inválido." }, 400);
    const { data: target, error: targetError } = await admin.from("organization_members")
      .select("id,user_id,role,status").eq("id", memberId)
      .eq("organization_id", organizationId).maybeSingle();
    if (targetError) throw targetError;
    if (!target) return json({ error: "Usuário não encontrado." }, 404);

    if (target.role === "owner" && actorRole !== "owner") {
      return json({ error: "Administradores não podem alterar proprietários." }, 403);
    }
    if (actorRole === "admin" && ["owner", "admin"].includes(target.role)) {
      return json({ error: "Administradores só podem gerenciar gerentes, membros e visualizadores." }, 403);
    }
    if (target.user_id === actor.id) return json({ error: "Por segurança, não é permitido alterar o próprio acesso por esta tela." }, 400);

    if (action === "update_name") {
      const fullName = String(body.full_name || "").trim();
      if (fullName.length < 2 || fullName.length > 120) return json({ error: "Informe um nome entre 2 e 120 caracteres." }, 400);
      const { data: targetUser, error: userLookupError } = await admin.auth.admin.getUserById(target.user_id);
      if (userLookupError) throw userLookupError;
      const { error } = await admin.auth.admin.updateUserById(target.user_id, {
        user_metadata: { ...(targetUser.user.user_metadata || {}), full_name: fullName },
      });
      if (error) throw error;
      await writeAudit("member.profile_updated", memberId, { full_name: fullName });
      return json({ ok: true, message: "Dados do usuário atualizados." });
    }

    if (action === "update_role") {
      const role = String(body.role || "");
      if (!["owner", "admin", "manager", "member", "viewer"].includes(role)) return json({ error: "Perfil inválido." }, 400);
      if (role === "owner" && actorRole !== "owner") return json({ error: "Somente o proprietário pode atribuir o perfil de proprietário." }, 403);
      if (role === "admin" && actorRole !== "owner") return json({ error: "Somente o proprietário pode atribuir o perfil de administrador." }, 403);
      if (target.role === "owner" && role !== "owner") {
        const { count, error: ownerCountError } = await admin.from("organization_members")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId).eq("role", "owner").eq("status", "active");
        if (ownerCountError) throw ownerCountError;
        if ((count || 0) <= 1) return json({ error: "A organização precisa manter pelo menos um proprietário ativo." }, 409);
      }
      const { error } = await admin.from("organization_members").update({ role }).eq("id", memberId);
      if (error) throw error;
      await writeAudit("member.role_changed", memberId, { from: target.role, to: role });
      return json({ ok: true, message: "Perfil atualizado." });
    }

    if (action === "set_status") {
      const status = String(body.status || "");
      if (!["active", "suspended"].includes(status)) return json({ error: "Estado inválido." }, 400);
      if (target.role === "owner" && status === "suspended") {
        const { count, error } = await admin.from("organization_members")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId).eq("role", "owner").eq("status", "active");
        if (error) throw error;
        if ((count || 0) <= 1) return json({ error: "A organização precisa manter pelo menos um proprietário ativo." }, 409);
      }
      const { error } = await admin.from("organization_members").update({ status }).eq("id", memberId);
      if (error) throw error;
      await writeAudit(status === "suspended" ? "member.suspended" : "member.reactivated", memberId, { previous_status: target.status, status });
      return json({ ok: true, message: status === "suspended" ? "Acesso suspenso." : "Acesso reativado." });
    }

    return json({ error: "Ação não reconhecida." }, 400);
  } catch (error) {
    console.error("[elevare-user-admin]", error);
    const message = error instanceof Error ? error.message : "Erro interno.";
    return json({ error: message }, 400);
  }
});