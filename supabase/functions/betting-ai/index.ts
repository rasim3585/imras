import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// BAHİS AI'INLA KONUŞ — çok turlu koç sohbeti. Her mesajda kullanıcının
// DETERMİNİSTİK ayna paketi (mirror_* RPC'leri, kullanıcı JWT'siyle) sisteme
// gömülür; model YALNIZCA bu sayılardan konuşur. Maç tahmini vermez, oran
// uydurmaz, "şuna oyna" demez — davranış desenini aynalar.
// Maliyet: kullanıcı başına günde 30 mesaj (ai_chat_usage, service-role).
// Anahtar yoksa {text:null, reason:'no_key'} — FE kartı gizler.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const LANGS: Record<string, string> = {
  en: "English", tr: "Turkish", ar: "Arabic", ru: "Russian", es: "Spanish",
  zh: "Simplified Chinese", hi: "Hindi", de: "German",
};

const DAILY_LIMIT = 30;

const SYSTEM = (langName: string, bundle: string) => `You are "Betting AI", PickPlay's personal behaviour coach in chat form. PickPlay is NOT a betting site; it is a play-money behaviour mirror (symbolic gold, NO real money).

You are given the user's complete DETERMINISTIC behaviour data below (produced by the database, not by you). This is your ONLY source of numbers.

STRICT RULES:
- Answer ONLY from the data bundle. If something isn't measured there, say it isn't measured yet — NEVER invent numbers, matches, odds or events.
- NEVER predict match outcomes, never recommend specific bets, never give "play X" tips. You coach BEHAVIOUR (stakes, timing, chasing, discipline, greed), not picks.
- Be direct and honest like a good coach: name the pattern, show its cost with the actual numbers, suggest ONE concrete behavioural experiment when useful.
- Keep answers SHORT: 2-5 sentences. Plain text, no markdown, no emoji.
- Say "gold"/"balance", never real-money words.
- If asked about anything outside the user's own play data or how PickPlay works, briefly decline and steer back.
- Write ENTIRELY in ${langName}.

USER DATA BUNDLE (deterministic, trusted):
${bundle}`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ text: null, reason: "no_key" });

  let body: any;
  try { body = await req.json(); } catch { return json({ text: null, reason: "bad_input" }); }
  const lang = (typeof body?.lang === "string" && LANGS[body.lang]) ? body.lang : "en";
  const raw = Array.isArray(body?.messages) ? body.messages : [];
  // son 12 tur, yalniz string icerik, tur basina 1000 karakter
  const messages = raw
    .filter((m: any) => (m?.role === "user" || m?.role === "assistant") && typeof m?.content === "string")
    .slice(-12)
    .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 1000) }));
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return json({ text: null, reason: "empty" });
  }

  // kullanici kimligi (JWT) — paket kullanicinin KENDI verisi olmali
  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: u } = await userClient.auth.getUser();
  const uid = u?.user?.id;
  if (!uid) return json({ text: null, reason: "auth" });

  // gunluk limit (service-role)
  const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const today = new Date().toISOString().slice(0, 10);
  const { data: usage } = await svc.from("ai_chat_usage")
    .select("msgs").eq("user_id", uid).eq("day", today).maybeSingle();
  const used = usage?.msgs ?? 0;
  if (used >= DAILY_LIMIT) return json({ text: null, reason: "limit", used, limit: DAILY_LIMIT });

  // deterministik paket: tum mirror_* RPC'leri KULLANICI olarak (RLS/auth.uid)
  const rpcs = ["mirror_overview", "mirror_coupon", "mirror_slot", "mirror_aviator",
    "mirror_benchmark", "mirror_card", "mirror_tilt", "mirror_selfgap", "mirror_reality_check"];
  const results = await Promise.allSettled(rpcs.map((r) => userClient.rpc(r)));
  const bundle: Record<string, unknown> = {};
  results.forEach((res, i) => {
    bundle[rpcs[i]] = res.status === "fulfilled" && !res.value.error ? res.value.data : null;
  });

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        system: SYSTEM(LANGS[lang], JSON.stringify(bundle)),
        messages,
      }),
    });
    if (!r.ok) { const t = await r.text(); return json({ text: null, reason: "api_error", detail: t.slice(0, 200) }); }
    const data = await r.json();
    const text = (data?.content?.[0]?.text ?? "").trim();
    if (text) {
      await svc.from("ai_chat_usage").upsert(
        { user_id: uid, day: today, msgs: used + 1, updated_at: new Date().toISOString() },
        { onConflict: "user_id,day" });
    }
    return json({ text: text || null, used: used + 1, limit: DAILY_LIMIT });
  } catch (e) {
    return json({ text: null, reason: "exception", detail: String(e).slice(0, 200) });
  }
});
