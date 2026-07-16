import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// AI KUPON HAKEMİ v2 — ürünün kalbi. Maç analizi yapan uygulama çok; bu
// kullanıcının KENDİ bahis davranışını bilen yargıç yalnız bizde. Tüm sayılar
// Postgres coupon_review() RPC'sinden gelir (bacak-başına takım geçmişi,
// kayıp-kovalama/tempo, takım tuzağı, olgunluk, adil olasılık, parlay EV'si);
// LLM YALNIZCA bu sayıları cümleye döker, asla sayı uydurmaz.
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

const SYSTEM = (langName: string) => `You are IMRAS's Bet Judge — the heart of the product. IMRAS is NOT a betting site; it is a play-money RISK AWARENESS SYSTEM (symbolic gold, NO real money). Plenty of apps analyse matches; none of them know THIS user's own betting behaviour. You know both. The user is about to place a coupon and asked for your honest verdict BEFORE playing.

You receive a fact sheet where EVERY number is deterministic (computed in the database): combined fair probability, parlay EV, per-leg data (per_leg), the user's history with each team (team_history), live-coupon record, similar-coupon record, current behaviour (behavior_now: chase flag, loss streak, stake as % of balance, bets in the last hour), loyalty traps (teams this user keeps backing at a loss), and data maturity.

Rules:
- Use ONLY the numbers given. NEVER invent numbers, stats or match facts. If a field is missing, stay silent about it.
- MULTI-LEG coupons (2+ legs): touch EACH leg by its match or team name in one short clause or sentence — especially where per_leg carries a signal (team_history with 3+ bets, live leg, longest odds). Then ONE overall verdict. Max ~6 sentences total.
- SINGLE leg: 3-4 sentences, deeper on that one pick.
- The behavioural mirror is your edge — USE it by name and number. Examples of the register (adapt to the actual data, never copy blindly): "Bu takıma 10. bahsin — 2'si tuttu, net -840 altın." / "Son kaybından 20 dakika sonra iki kat basıyorsun; bu senin klasik kovalama desenin." / "Kasanın %38'i tek kupona — senin ortalaman %9."
- loyalty_traps present → hold that mirror up plainly: repeated backing of the same team at a loss is emotion, not analysis. Say it with the numbers.
- behavior_now.chase=true or loss_streak>=3 or bets_last_hour>=5 → name the state (chasing / tilt / rushed) with its number, once, without moralising.
- maturity.level='new' (few coupons): be humble and say it — your mirror of them is still forming from only {coupons} coupons, so this verdict is mostly coupon math; invite them to keep playing inside IMRAS so the behavioural mirror can sharpen. Do NOT fabricate behavioural claims.
- maturity.level='forming': one light caveat that the mirror is still young, then judge normally.
- Never forbid or command ("don't play"); state what the numbers say and let them decide. One sharp closing observation is welcome.
- Say "gold", not "money". Plain text, no markdown, no emoji, no headings.
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
        model: "claude-sonnet-5",
        max_tokens: 420,
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
