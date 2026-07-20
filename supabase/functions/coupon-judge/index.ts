import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

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
- judge_context is YOUR OWN record with this user. If warned_played_30d > 0, you may hold it up plainly once: e.g. "Son 30 günde uyardığım kuponlardan {warned_played_30d} tanesini yine oynadın — bedeli {gold_lost_after_warning_30d} altın." Only with the given numbers.
- cross_games shows the user's LAST HOUR in other IMRAS games (Aviator, luck games). If it shows meaningful losses right before this coupon (negative net with plays > 0), name the platform-wide tilt: they are carrying losses from another game into this coupon. One sentence, with the number.
- Never forbid or command ("don't play"); state what the numbers say and let them decide. One sharp closing observation is welcome.
- Say "gold", not "money". Plain text, no markdown, no emoji, no headings.
- Address the user informally where the language allows it (Turkish: "sen", never "siz"; German: "du"; Spanish: "tú"; Russian: "ты"). Warm but blunt — a sharp friend, not a bank letter.
- Keep it tight enough to ALWAYS finish your final sentence — never run long and get cut off.
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

  // Kullanıcı kimliği JWT'den DOĞRULANARAK alınır (imza doğrulaması getUser ile;
  // betting-ai kalıbı). verify_jwt=true gateway'de imzayı zaten doğrular ama
  // burada da doğrulamak fail-OPEN'i kapatır: anon anahtar (sub'suz geçerli JWT)
  // ile KOTASIZ Sonnet çağrısı ARTIK MÜMKÜN DEĞİL. Kimlik yoksa yargıç konuşmaz
  // (para/maliyet yoluna açık kapı bırakmaz — güvenlik platform bayrağına dayanmaz).
  const supaUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  let uid: string | null = null;
  if (supaUrl && anonKey) {
    try {
      const userClient = createClient(supaUrl, anonKey, {
        global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      });
      const { data: u } = await userClient.auth.getUser();
      uid = u?.user?.id ?? null;
    } catch { uid = null; }
  }
  if (!uid) return json({ text: null, reason: "auth" });

  // Sonnet kota: 20 kararname/gün (judge_quota_take, service_role ile).
  // Kota altyapısı yoksa (fn/env eksik) yargıç yine çalışır — açık-arıza değil.
  try {
    const sr = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (sr && supaUrl) {
      const q = await fetch(`${supaUrl}/rest/v1/rpc/judge_quota_take`, {
        method: "POST",
        headers: { apikey: sr, Authorization: `Bearer ${sr}`, "content-type": "application/json" },
        body: JSON.stringify({ p_user: uid }),
      });
      if (q.ok) {
        const left = await q.json();
        if (typeof left === "number" && left < 0) return json({ text: null, reason: "limit" });
      }
    }
  } catch { /* kota hatası yargıcı düşürmez */ }

  try {
    // Sonnet 5'te adaptive thinking VARSAYILAN AÇIK ve düşünme tokenları
    // max_tokens'a DAHİL — 640'lık tavanın tamamını düşünme yiyip metin hiç
    // başlamıyordu (canlıda ölçüldü: content'te text bloğu yok → no_text).
    // Kararname deterministik sayıları cümleye döker; düşünmeye gerek yok →
    // kapat. Emniyet: parametre reddedilirse (400 + 'thinking') bir kez
    // thinking'siz gövdeyle yeniden dene.
    const mkBody = (thinkingOff: boolean) => JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 640,
      ...(thinkingOff ? { thinking: { type: "disabled" } } : {}),
      system: SYSTEM(LANGS[lang]),
      messages: [{
        role: "user",
        content: "Coupon fact sheet (JSON, all numbers deterministic). Write the verdict:\n\n" + JSON.stringify(review),
      }],
    });
    const call = (body: string) => fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body,
    });
    let r = await call(mkBody(true));
    if (r.status === 400) {
      const t = await r.text();
      if (/thinking/i.test(t)) r = await call(mkBody(false));
      else return json({ text: null, reason: "api_error", detail: t.slice(0, 200) });
    }
    if (!r.ok) { const t = await r.text(); return json({ text: null, reason: "api_error", detail: t.slice(0, 200) }); }
    const data = await r.json();
    // TEXT tipindeki blokları oku (content[0].text varsayımı düşünme bloğunda kırılır)
    const blocks: { type?: string; text?: string }[] = Array.isArray(data?.content) ? data.content : [];
    const text = blocks.filter((b) => b?.type === "text" && b.text).map((b) => b.text).join("\n").trim();
    if (!text) {
      // bir daha kör kalmayalım: durma nedeni + blok tipleri teşhise düşsün
      const diag = JSON.stringify({ stop: data?.stop_reason, types: blocks.map((b) => b?.type) });
      return json({ text: null, reason: "no_text", detail: diag.slice(0, 200) });
    }
    return json({ text });
  } catch (e) {
    return json({ text: null, reason: "exception", detail: String(e).slice(0, 200) });
  }
});
