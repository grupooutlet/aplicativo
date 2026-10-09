import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const cors = {
  "Access-Control-Allow-Origin": "https://grupooutlet.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
const response = (status: number, value: unknown) =>
  new Response(JSON.stringify(value), { status, headers: { ...cors, "Content-Type": "application/json" } });
const uuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return response(405, { message: "Método inválido." });
  try {
    const token = req.headers.get("Authorization");
    if (!token?.startsWith("Bearer ")) return response(401, { message: "Entre novamente na sua conta." });
    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
    const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: token } }, auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: auth, error: authError } = await caller.auth.getUser(token.slice(7));
    if (authError || !auth.user) return response(401, { message: "Sessão expirada. Entre novamente." });
    const { data: authority, error: authorityError } = await caller.rpc("customer_admin_authority");
    if (authorityError || !authority) return response(403, { message: "Seu perfil não pode gerenciar clientes." });
    const body = await req.json();
    if (!["delete", "promote"].includes(body.action) || (!uuid(body.userId) && !uuid(body.contactId)))
      return response(400, { message: "Cliente inválido." });
    if (!authority[body.action]) return response(403, { message: "Seu perfil não pode realizar esta alteração." });
    let profile: { user_id: string; email: string; name: string; role: string } | null = null;
    let contact: { id: string; email: string; name: string } | null = null;
    if (uuid(body.userId)) {
      const result = await admin.from("profiles").select("user_id,email,name,role").eq("user_id", body.userId).maybeSingle();
      if (result.error) throw result.error;
      profile = result.data;
    }
    if (uuid(body.contactId)) {
      const result = await admin.from("customer_contacts").select("id,email,name").eq("id", body.contactId).maybeSingle();
      if (result.error) throw result.error;
      contact = result.data;
    }
    if (!profile && !contact) return response(404, { message: "Cliente não encontrado. Atualize a página." });
    if (profile && contact && profile.email.toLowerCase() !== contact.email.toLowerCase())
      return response(400, { message: "Os cadastros do cliente não correspondem." });
    const email = (profile?.email || contact!.email).trim().toLowerCase();
    if (!profile) {
      const result = await admin.from("profiles").select("user_id,email,name,role").eq("email", email).maybeSingle();
      if (result.error) throw result.error;
      profile = result.data;
    }
    if (profile && profile.role !== "customer") return response(403, { message: "Este perfil pertence à equipe." });
    if (email === "grupooutlet.rj@gmail.com") return response(403, { message: "A conta principal está protegida." });
    if (body.action === "delete") {
      if (profile) {
        const { error } = await admin.auth.admin.deleteUser(profile.user_id);
        if (error) throw error;
      }
      const { error } = await admin.rpc("finalize_customer_removal", {
        p_user_id: profile?.user_id || body.userId || null, p_email: email, p_contact_id: contact?.id || null,
      });
      if (error) throw error;
      return response(200, { success: true });
    }
    if (!["Gerente", "Vendedor", "Entregador", "Outro"].includes(body.position))
      return response(400, { message: "Selecione um cargo válido." });
    let createdId: string | null = null;
    if (!profile) {
      if (typeof body.password !== "string" || body.password.length < 8 || body.password.length > 128)
        return response(400, { message: "Defina uma senha entre 8 e 128 caracteres." });
      const { data, error } = await admin.auth.admin.createUser({
        email, password: body.password, email_confirm: true, user_metadata: { name: contact!.name },
      });
      if (error || !data.user) throw error || new Error("Não foi possível criar o acesso.");
      createdId = data.user.id;
      profile = { user_id: createdId, email, name: contact!.name, role: "customer" };
    }
    const { error } = await caller.rpc("promote_customer", { p_user_id: profile.user_id, p_position: body.position });
    if (error) {
      if (createdId) await admin.auth.admin.deleteUser(createdId);
      throw error;
    }
    return response(200, { success: true });
  } catch (error) {
    // No credentials or request bodies are logged.
    return response(400, { message: error instanceof Error ? error.message : (error as { message?: string })?.message || "Não foi possível concluir a alteração." });
  }
});
