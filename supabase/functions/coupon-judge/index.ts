import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// AI KUPON HAKEMİ — oynamadan ÖNCE dürüst karar aynası. Tüm sayılar Postgres
// coupon_review() RPC'sinden gelir (birleşik adil olasılık, parlay EV'si,
// en riskli bacak, kullanıcının benzer-kupon geçmişi, ayna bayrakları);
// LLM YALNIZCA bu sayıları 2-3 cümleye döker, asla sayı uydurmaz.
// Anahtar yoksa {text:null} — FE deterministik kartı yine gösterir.
// Para yoluna dokunmaz: karar kullanıcının, hakem sadece aynayı tutar.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const LANGS: Record<string, string> = {
  en: "English", tr: "Turkish", ar: "Arabic", ru: "Russian", es: "Spanish",
  zh: "Simplified Chinese", hi: "Hindi", de: "German",
};

const SYSTEM = (langName: string) => `You are PickPlay's coupon judge. PickPlay is NOT a betting site; it is a play-money behaviour mirror (symbolic gold, NO real money). The user is about to place a coupon and asked for your honest verdict BEFORE playing.

Rules:
- 2-3 sentences. Honest, concrete, zero fluff. A judge, not a cheerleader.
- Use ONLY the numbers given (combined probability, EV, history, flags). NEVER invent numbers.
- If history shows a repeated pattern (e.g. many similar multi-leg coupons with heavy losses, longshot flag), hold that mirror up with its actual numbers.
- Never forbid or command ("don't play"); state what the numbers say and let them decide. One sharp closing observation is welcome.
- Say "gold", not "money". Plain text, no markdown, no emoji.
- IMPORTANT: Write your ENTIRE message in ${langName}.`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ text: null, reason: "no_key" });

  let body: any;
  try { body = await req.json(); } catch { return json({ text: null, reason: "bad_input" }); }
  const review = body?.review;
  const lang = (typeof body?.lang === "string" && LANGS[body.lang]) ? body.lang : "en";
  if (!review || review.ready !== true) return json({ text: null, reason: "empty" });

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 260,
        system: SYSTEM(LANGS[lang]),
        messages: [{
          role: "user",
          content: "Coupon fact sheet (JSON, all numbers deterministic). Write the verdict:\n\n" + JSON.stringify(review),
        }],
      }),
    });
    if (!r.ok) { const t = await r.text(); return json({ text: null, reason: "api_error", detail: t.slice(0, 200) }); }
    const data = await r.json();
    const text = (data?.content?.[0]?.text ?? "").trim();
    return json({ text: text || null });
  } catch (e) {
    return json({ text: null, reason: "exception", detail: String(e).slice(0, 200) });
  }
});
