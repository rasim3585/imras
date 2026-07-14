import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// AI MAÇ ÖNİZLEME — sanal lig maçı için 2-3 cümlelik, VERİYE DAYALI önizleme.
// Gerçekler deterministik: lig sırası, form, H2H, oranların ima ettiği favori
// (vmatch_stats + matches). LLM yalnız cümleye döker; kesinlik iddiası yok.
// MALİYET: maç+dil başına TEK üretim — match_preview_cache (service-role)
// sayesinde binlerce görüntüleme = 1 Haiku çağrısı. Anahtar yoksa {text:null}.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const LANGS: Record<string, string> = {
  en: "English", tr: "Turkish", ar: "Arabic", ru: "Russian", es: "Spanish",
  zh: "Simplified Chinese", hi: "Hindi", de: "German",
};

const SYSTEM = (langName: string) => `You are PickPlay's match preview writer. PickPlay runs simulated (virtual) sports leagues with play-money; matches are between persistent simulated teams whose league position, form and head-to-head history are real data within that league.

Rules:
- 2-3 sentences, sharp and readable, like a good sports data column.
- Ground EVERY claim in the given facts (ranks, form, H2H, odds-implied favourite). NEVER invent facts, players, injuries or history.
- No certainty about the outcome — the match is not played yet. Odds imply, never guarantee.
- Do not repeatedly say "simulated/virtual"; write it like a normal preview.
- Plain text, no markdown, no emoji.
- IMPORTANT: Write your ENTIRE message in ${langName}.`;

function hashStr(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; }
  return h.toString(36);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

  let body: any;
  try { body = await req.json(); } catch { return json({ text: null, reason: "bad_input" }); }
  const matchId = typeof body?.match_id === "string" ? body.match_id : null;
  const lang = (typeof body?.lang === "string" && LANGS[body.lang]) ? body.lang : "en";
  if (!matchId) return json({ text: null, reason: "bad_input" });

  // service client: cache + veri okuma (RLS policy'siz cache tablosu)
  const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // deterministik gerçekler
  const { data: m } = await svc.from("matches")
    .select("id, sport, home_team, away_team, starts_at, status, display_odds")
    .eq("id", matchId).maybeSingle();
  if (!m || m.status !== "upcoming") return json({ text: null, reason: "not_upcoming" });

  const { data: stats } = await svc.rpc("vmatch_stats", { p_match_id: matchId });
  if (!stats) return json({ text: null, reason: "no_stats" });

  const facts = {
    sport: m.sport,
    home: { name: m.home_team, rank: stats.home?.rank, points: stats.home?.points,
            played: stats.home?.played, won: stats.home?.won, lost: stats.home?.lost,
            form: stats.home?.form },
    away: { name: m.away_team, rank: stats.away?.rank, points: stats.away?.points,
            played: stats.away?.played, won: stats.away?.won, lost: stats.away?.lost,
            form: stats.away?.form },
    h2h: (stats.h2h ?? []).slice(0, 5).map((h: any) => ({
      home: h.home_team, away: h.away_team, score: `${h.home_score}-${h.away_score}`, detail: h.detail ?? undefined,
    })),
    odds: m.display_odds ?? undefined,
  };
  const fh = hashStr(JSON.stringify(facts) + "|" + lang);

  const { data: cached } = await svc.from("match_preview_cache")
    .select("text, facts_hash").eq("fixture_id", matchId).eq("lang", lang).maybeSingle();
  if (cached?.text && cached.facts_hash === fh) return json({ text: cached.text, cached: true });

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ text: null, reason: "no_key" });

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
          content: "Match fact sheet (JSON). Write the preview:\n\n" + JSON.stringify(facts),
        }],
      }),
    });
    if (!r.ok) { const t = await r.text(); return json({ text: null, reason: "api_error", detail: t.slice(0, 200) }); }
    const data = await r.json();
    const text = (data?.content?.[0]?.text ?? "").trim();
    if (text) {
      await svc.from("match_preview_cache").upsert({
        fixture_id: matchId, lang, text, facts_hash: fh, updated_at: new Date().toISOString(),
      });
    }
    return json({ text: text || null, cached: false });
  } catch (e) {
    return json({ text: null, reason: "exception", detail: String(e).slice(0, 200) });
  }
});
