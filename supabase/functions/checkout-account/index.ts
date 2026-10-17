import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const allowedOrigins = new Set([
  "https://forteoutlet.com.br",
  "https://www.forteoutlet.com.br",
  "https://grupooutlet.github.io",
]);
const corsHeaders = origin => ({
  ...(allowedOrigins.has(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});
Deno.serve(async req => {
  const origin = req.headers.get("Origin");
  const cors = corsHeaders(origin);
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (origin && !allowedOrigins.has(origin)) return reply(403, { message: "Origem inválida." });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { message: "Método inválido." });
  const url = Deno.env.get("SUPABASE_URL");
  const apiKey = req.headers.get("apikey");
  if (!apiKey || apiKey.length > 1000) return reply(401, { message: "Acesso inválido." });
  // Public checkout is intentionally unauthenticated. The gateway validates the
  // supplied public API key; accounts that already exist are never signed in here.
  const access = await fetch(url + "/rest/v1/shop_public?select=id&id=eq.1", { headers: { apikey: apiKey } });
  if (!access.ok) return reply(401, { message: "Acesso inválido." });
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), options);
  const publicClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY"), options);
  let createdUser = null;
  let confirmed = false;
  try {
    const text = await req.text();
    if (text.length > 64000) return reply(400, { message: "Pedido muito grande." });
    const request = JSON.parse(text).request;
    const email = String(request?.email || "").trim().toLowerCase();
    const validName = value => typeof value === "string" && value.length <= 60 &&
      /^[\p{L}][\p{L}\s.'’\-]*$/u.test(value.trim()) && (value.match(/\p{L}/gu) || []).length >= 2;
    if (!request || !validName(request.firstName) || !validName(request.lastName) ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply(400, { message: "Confira nome, sobrenome e e-mail." });
    const name = (request.firstName.trim() + " " + request.lastName.trim()).replace(/\s+/g, " ");
    const lookup = await admin.from("profiles").select("user_id").eq("email", email).maybeSingle();
    if (lookup.error) throw lookup.error;
    let session = null;
    let buyer = publicClient;
    if (!lookup.data) {
      const password = crypto.randomUUID() + crypto.randomUUID();
      const result = await admin.auth.admin.createUser({ email, password, email_confirm: true,
        user_metadata: { name }, app_metadata: { checkout_account: true } });
      // A concurrent signup may win this email. Continue as guest, never reset it.
      if (result.error && !["email_exists", "user_already_exists"].includes(result.error.code)) throw result.error;
      if (result.data?.user) {
        createdUser = result.data.user.id;
        const login = await publicClient.auth.signInWithPassword({ email, password });
        if (login.error || !login.data.session) throw login.error || new Error("Não foi possível conectar a nova conta.");
        session = login.data.session;
        buyer = createClient(url, Deno.env.get("SUPABASE_ANON_KEY"), {
          ...options, global: { headers: { Authorization: "Bearer " + session.access_token } },
        });
      }
    }
    const result = await buyer.rpc("place_order", { p_request: { ...request, email } });
    if (result.error) throw result.error;
    confirmed = true;
    return reply(200, { ...result.data, session });
  } catch (error) {
    if (createdUser && !confirmed) await admin.auth.admin.deleteUser(createdUser);
    return reply(400, { message: error?.message || "Não foi possível concluir o pedido." });
  }
});
