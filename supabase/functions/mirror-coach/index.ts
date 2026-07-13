import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// BEHAVIOUR MIRROR — LLM "voice" (coach). Turns the deterministic mirror summary
// into a SHORT personal coaching message. PRINCIPLE: numbers are produced
// deterministically in Postgres; the LLM ONLY phrases them, never invents.
//
// COST CONTROL: result is cached per (user, lang) keyed by a bucketed signature
// of the data. The LLM is called ONLY when the signature changes (stats moved) or
// the language changes. Same data on reload → cache hit, no LLM call.
//
// Requires Supabase secret ANTHROPIC_API_KEY. verify_jwt=true.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const LANGS: Record<string, string> = {
  en: "English", tr: "Turkish", ar: "Arabic", ru: "Russian", es: "Spanish",
  zh: "Simplified Chinese", hi: "Hindi", de: "German",
};

const SYSTEM = (langName: string) => `You are PickPlay's behaviour coach. PickPlay is NOT a betting site; it is a play-money behaviour mirror (symbolic gold, NO real money). Turn the user's own game-behaviour diagnosis into a SHORT coaching message.

Rules:
- 2-4 sentences, warm but honest. Don't moralize; hold up a mirror.
- Use ONLY the numbers/diagnoses given. NEVER invent numbers, odds, or claims.
- Do NOT repeat the archetype name (already shown on screen). Go straight to the insight.
- NUMBER ACCURACY: a game with net>0 is in PROFIT; net<0 is a LOSS. Never confuse them or say "break-even" for a profitable game.
- Interpret benchmark percentile correctly: a high discipline percentile means better than most players.
- No clichés ("play responsibly"). Be concrete and personal.
- Focus on the 1-2 strongest patterns; give ONE concrete, actionable suggestion.
- Say "gold"/"balance", not "money"; there is no real money.
- Plain text, no markdown. Address the user directly as "you".
- IMPORTANT: Write your ENTIRE message in ${langName}.`;

function bucket(n: unknown): number {
  const v = typeof n === "number" ? n : 0;
  return Math.round(v / 10000);
}
function signatureOf(summary: any, lang: string): string {
  try {
    const o = summary?.overall ?? {};
    const prods = Array.isArray(o.products) ? o.products : [];
    const bench = Array.isArray(summary?.benchmark) ? summary.benchmark : [];
    const parts = [
      lang,
      "net:" + bucket(o.net),
      prods.map((p: any) => `${p.oyun ?? p.key ?? ""}:${Math.round((p.oynanma ?? p.plays ?? 0) / 5)}:${bucket(p.net)}`).join(","),
      "flags:" + (Array.isArray(o.teshisler) ? [...o.teshisler].sort().join(",") : ""),
      "arch:" + (summary?.card?.archetype ?? ""),
      "bench:" + bench.map((b: any) => `${b.eksen ?? b.key ?? ""}:${Math.round((b.sen ?? 0) * 20)}`).join(","),
    ];
    return parts.join("|");
  } catch {
    return lang + "|" + Math.random();
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ text: null, reason: "no_key" });

  let body: any;
  try { body = await req.json(); } catch { return json({ text: null, reason: "bad_input" }); }
  const summary = body?.summary;
  const lang = (typeof body?.lang === "string" && LANGS[body.lang]) ? body.lang : "en";
  if (!summary) return json({ text: null, reason: "empty" });

  const sig = signatureOf(summary, lang);

  // Cache check (as the calling user, RLS-scoped).
  const authHeader = req.headers.get("Authorization") ?? "";
  let supa: ReturnType<typeof createClient> | null = null;
  let uid: string | null = null;
  try {
    supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: u } = await supa.auth.getUser();
    uid = u?.user?.id ?? null;
    if (uid) {
      const { data: row } = await supa.from("mirror_coach_cache").select("signature, text").eq("lang", lang).maybeSingle();
      if (row && row.signature === sig && row.text) {
        return json({ text: row.text, cached: true });
      }
    }
  } catch { /* cache is best-effort; fall through to LLM */ }

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 320,
        system: SYSTEM(LANGS[lang]),
        messages: [{ role: "user", content: "Here is the player's mirror summary (JSON). Write the coaching message:\n\n" + JSON.stringify(summary) }],
      }),
    });
    if (!r.ok) { const t = await r.text(); return json({ text: null, reason: "api_error", detail: t.slice(0, 200) }); }
    const data = await r.json();
    const text = (data?.content?.[0]?.text ?? "").trim();
    if (text && supa && uid) {
      try {
        await supa.from("mirror_coach_cache").upsert({ user_id: uid, lang, signature: sig, text, updated_at: new Date().toISOString() });
      } catch { /* best-effort */ }
    }
    return json({ text: text || null, cached: false });
  } catch (e) {
    return json({ text: null, reason: "exception", detail: String(e).slice(0, 200) });
  }
});
