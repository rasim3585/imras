// Supabase Edge Function (Deno) -- lambda solver, moved off the Node runner.
//
// WHY THIS EXISTS: solveLambdas.ts hits BSD /odds/ per fixture and runs a ~130-
// line numeric solver (bisection + grid + Poisson) that does NOT translate to
// SQL. So the math stays in JS but leaves the always-on Node process: pg_cron +
// pg_net wake this function every 15 min, hand it the fixture list, and it prices
// them. Zero server/terminal dependency.
//
// CONTRACT (unchanged vs solveLambdas.ts):
//   BSD:   GET {base}/api/v2/events/{external_id}/odds/
//          header  Authorization: Token <BSD_API_KEY>
//   write: real_fixtures.{lambda_home, lambda_away, lambda_shared=0,
//          prematch_odds (camelCase JSON), lambda_solved_at}
//
// INVOCATION:
//   POST /functions/v1/solve-lambdas  { "fixture_ids": ["<uuid>", ...] }
//     -> pg_cron picks the rows (notstarted AND lambda NULL/stale) and passes ids
//   POST /functions/v1/solve-lambdas  {}   (or no body)
//     -> fallback: the function runs its OWN default query (same predicate)
//   Batch cap: 20 fixtures per call. Extra ids are left for the next call and
//   reported back as `remaining` so the pg_net side can re-invoke.
//
// The MATH below is copied VERBATIM from src/providers/lambdaSolver.ts. Do not
// "improve" it here -- the two must stay identical until the Node path is retired.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0';

// ---------------------------------------------------------------------------
// ==== MATH (verbatim from src/providers/lambdaSolver.ts) ====================
// ---------------------------------------------------------------------------

const FACT = [1, 1, 2, 6, 24, 120, 720, 5040, 40320, 362880, 3628800];
function factorial(k: number): number { return k < FACT.length ? FACT[k] : k * factorial(k - 1); }

function poisson(lambda: number, k: number): number {
  if (lambda === 0) return k === 0 ? 1 : 0;
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
}

interface OddsInput {
  homeWin: number; draw: number; awayWin: number;
  over15?: number; under15?: number;
  over25?: number; under25?: number;
  bttsYes?: number; bttsNo?: number;
}

interface LambdaSolution {
  lambdaHome: number;    // l1 (independent Poisson)
  lambdaAway: number;    // l2
  lambdaShared: number;  // always 0 (DB requires it)
  error: number;
  bttsGap: number | null;
}

interface ModelProbs { home: number; draw: number; away: number }

function modelProbs(l1: number, l2: number, cap = 8): ModelProbs {
  const fh = Array.from({ length: cap + 1 }, (_, k) => poisson(l1, k));
  const fa = Array.from({ length: cap + 1 }, (_, k) => poisson(l2, k));
  let pw = 0, pd = 0, pl = 0, s = 0;
  for (let x = 0; x <= cap; x++) {
    for (let y = 0; y <= cap; y++) {
      const pk = fh[x] * fa[y];
      s += pk;
      if (x > y) pw += pk; else if (x === y) pd += pk; else pl += pk;
    }
  }
  return { home: pw / s, draw: pd / s, away: pl / s };
}

function pairTarget(over?: number, under?: number): number | null {
  if (!(over && over > 1) || !(under && under > 1)) return null;
  const io = 1 / over, iu = 1 / under;
  return io / (io + iu);
}

const L_MIN = 0.05;                              // keep l1, l2 non-degenerate
const MAX_TEAM = 4.0, MAX_TOTAL = 5.5;           // mirror real_fixtures_lambda_sane_ck
const feasible = (l1: number, l2: number): boolean => l1 <= MAX_TEAM && l2 <= MAX_TEAM && l1 + l2 <= MAX_TOTAL;

function overFromTotal(T: number, kMax: number): number {
  let s = 0;
  for (let k = 0; k <= kMax; k++) s += poisson(T, k);
  return 1 - s;
}

function solveTotalFromOver(target: number, kMax: number): number {
  let lo = L_MIN, hi = MAX_TOTAL;
  if (overFromTotal(hi, kMax) <= target) return hi;
  if (overFromTotal(lo, kMax) >= target) return lo;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (overFromTotal(mid, kMax) < target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

interface Split { l1: number; l2: number; err: number }

function splitTotal(T: number, err1x2: (l1: number, l2: number) => number): Split {
  let best: Split = { l1: T / 2, l2: T / 2, err: err1x2(T / 2, T / 2) };
  const consider = (r: number): void => {
    const l2 = T / (1 + r), l1 = T - l2;
    if (l1 < L_MIN || l2 < L_MIN || !feasible(l1, l2)) return;
    const e = err1x2(l1, l2);
    if (e < best.err) best = { l1, l2, err: e };
  };
  for (let e = -2.5; e <= 2.5; e += 0.02) consider(Math.exp(e));
  const r0 = best.l1 / best.l2;
  for (let r = r0 * 0.9; r <= r0 * 1.1; r += r0 * 0.002) consider(r);
  return best;
}

function grid2(err: (l1: number, l2: number) => number): Split {
  let best: Split = { l1: 1.2, l2: 1.0, err: Infinity };
  for (let l1 = L_MIN; l1 <= 3.8; l1 += 0.05) {
    for (let l2 = L_MIN; l2 <= 3.8; l2 += 0.05) {
      if (!feasible(l1, l2)) continue;
      const e = err(l1, l2); if (e < best.err) best = { l1, l2, err: e };
    }
  }
  const { l1: a, l2: b } = best;
  best = { l1: a, l2: b, err: Infinity };
  for (let l1 = Math.max(L_MIN, a - 0.05); l1 <= a + 0.05; l1 += 0.005) {
    for (let l2 = Math.max(L_MIN, b - 0.05); l2 <= b + 0.05; l2 += 0.005) {
      if (!feasible(l1, l2)) continue;
      const e = err(l1, l2); if (e < best.err) best = { l1, l2, err: e };
    }
  }
  return best;
}

function bttsProb(l1: number, l2: number): number {
  return (1 - Math.exp(-l1)) * (1 - Math.exp(-l2));   // P(home>=1) * P(away>=1)
}

function solveLambda(o: OddsInput): LambdaSolution {
  const ih = 1 / o.homeWin, id = 1 / o.draw, ia = 1 / o.awayWin;
  const over = ih + id + ia;
  const tHome = ih / over, tDraw = id / over, tAway = ia / over;
  const t25 = pairTarget(o.over25, o.under25);
  const t15 = pairTarget(o.over15, o.under15);
  const tBtts = pairTarget(o.bttsYes, o.bttsNo);

  const err1x2 = (l1: number, l2: number): number => {
    const p = modelProbs(l1, l2);
    return Math.abs(p.home - tHome) + Math.abs(p.draw - tDraw) + Math.abs(p.away - tAway);
  };

  let sol: Split;
  if (t25 != null)      sol = splitTotal(solveTotalFromOver(t25, 2), err1x2);
  else if (t15 != null) sol = splitTotal(solveTotalFromOver(t15, 1), err1x2);
  else                  sol = grid2(err1x2);

  const bttsGap = tBtts != null ? Math.abs(bttsProb(sol.l1, sol.l2) - tBtts) : null;

  return {
    lambdaHome: round3(sol.l1),
    lambdaAway: round3(sol.l2),
    lambdaShared: 0,
    error: sol.err,
    bttsGap,
  };
}

function round3(x: number): number { return Math.round(x * 1000) / 1000; }

function lambdaHealth(s: LambdaSolution): { ok: boolean; reason?: string } {
  const total = s.lambdaHome + s.lambdaAway;
  if (total < 1.5 || total > 4.0) return { ok: false, reason: `lambda toplamı ${total.toFixed(2)} (1.5-4.0 dışı)` };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// ==== BSD odds fetch (verbatim contract from src/providers/bsd.ts) ==========
// ---------------------------------------------------------------------------

interface RawPrematchOdds {
  homeWin: number; draw: number; awayWin: number;
  over15: number; under15: number;
  over25: number; under25: number;
  over35: number; under35: number;
  bttsYes: number; bttsNo: number;
}

const BSD_BASE = (Deno.env.get('BSD_BASE_URL') ?? 'https://sports.bzzoiro.com').replace(/\/$/, '');
const BSD_KEY = Deno.env.get('BSD_API_KEY') ?? '';

async function fetchPrematchOdds(externalId: number): Promise<RawPrematchOdds | null> {
  const url = `${BSD_BASE}/api/v2/events/${externalId}/odds/`;
  const res = await fetch(url, { headers: { Authorization: `Token ${BSD_KEY}` } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`BSD ${res.status} on ${url}: ${body.slice(0, 200)}`) as Error & { httpStatus?: number };
    err.httpStatus = res.status;
    throw err;
  }
  const j = await res.json() as { odds?: Record<string, number> };
  const o = j.odds;
  if (!o || o.home_win == null || o.draw == null || o.away_win == null) return null;
  return {
    homeWin: o.home_win, draw: o.draw, awayWin: o.away_win,
    over15: o.over_15_goals, under15: o.under_15_goals,
    over25: o.over_25_goals, under25: o.under_25_goals,
    over35: o.over_35_goals, under35: o.under_35_goals,
    bttsYes: o.btts_yes, bttsNo: o.btts_no,
  };
}

// ---------------------------------------------------------------------------
// ==== ORCHESTRATION (ported from src/cron/solveLambdas.ts) ==================
// ---------------------------------------------------------------------------

const BATCH_MAX = 20;          // BSD /odds/ calls per invocation
const BSD_DELAY_MS = 150;      // small pause between BSD calls (rate limit unknown)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Pending { id: string; external_id: number; home_team: string; away_team: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeAdmin(): any {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function pickFixtures(admin: any, fixtureIds: string[] | null): Promise<{ rows: Pending[]; totalCandidates: number }> {
  if (fixtureIds && fixtureIds.length > 0) {
    // pg_cron already decided WHO to price -- just resolve external_id for them.
    const { data, error } = await admin
      .from('real_fixtures')
      .select('id, external_id, home_team, away_team')
      .in('id', fixtureIds);
    if (error) throw new Error(error.message);
    const all = (data ?? []) as Pending[];
    return { rows: all.slice(0, BATCH_MAX), totalCandidates: all.length };
  }
  // Fallback: run our OWN default predicate (identical to solveLambdas.ts:19-25).
  const staleBefore = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
  const { data, error } = await admin
    .from('real_fixtures')
    .select('id, external_id, home_team, away_team')
    .eq('status', 'notstarted')
    .or(`lambda_home.is.null,lambda_solved_at.lt.${staleBefore}`);
  if (error) throw new Error(error.message);
  const all = (data ?? []) as Pending[];
  return { rows: all.slice(0, BATCH_MAX), totalCandidates: all.length };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'POST only' }, 405);
  }

  let fixtureIds: string[] | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    if (Array.isArray(body?.fixture_ids)) fixtureIds = body.fixture_ids.map(String);
  } catch { /* empty body -> fallback query */ }

  if (!BSD_KEY) return json({ error: 'missing BSD_API_KEY' }, 500);

  let admin;
  try {
    admin = makeAdmin();
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }

  let rows: Pending[], totalCandidates: number;
  try {
    ({ rows, totalCandidates } = await pickFixtures(admin, fixtureIds));
  } catch (e) {
    return json({ error: `query failed: ${e instanceof Error ? e.message : e}` }, 500);
  }

  let solved = 0, failed = 0, skipped_no_odds = 0;
  const warnings: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const f = rows[i];
    const label = `${f.external_id} ${f.home_team}-${f.away_team}`;
    try {
      const odds = await fetchPrematchOdds(f.external_id);
      if (!odds) {                                   // book has no consensus yet
        skipped_no_odds++;
        console.log(`[lambda] ${label} -> ATLANDI: oran yok`);
      } else {
        const sol = solveLambda(odds);   // stage 1: T from over line, stage 2: split from 1X2
        const health = lambdaHealth(sol);
        if (!health.ok) warnings.push(`${label}: ${health.reason}`);
        if (sol.bttsGap != null && sol.bttsGap > 0.15) warnings.push(`${label}: btts farkı ${sol.bttsGap.toFixed(2)}`);

        const { error: uerr } = await admin.from('real_fixtures')
          .update({
            lambda_home: sol.lambdaHome,
            lambda_away: sol.lambdaAway,
            lambda_shared: sol.lambdaShared,
            prematch_odds: odds,                       // camelCase JSON, same as Node path
            lambda_solved_at: new Date().toISOString(),
          })
          .eq('id', f.id);
        if (uerr) throw new Error(uerr.message);
        solved++;
        console.log(`[lambda] ${label} -> cozuldu (${sol.lambdaHome} / ${sol.lambdaAway})`);
      }
    } catch (e) {
      failed++;
      console.error(`[lambda] ${label} -> HATA: ${e instanceof Error ? e.message : e}`);
    }
    if (i < rows.length - 1) await sleep(BSD_DELAY_MS);   // gentle on BSD
  }

  // `remaining` > 0 tells the pg_net side to invoke again (batch cap hit).
  const remaining = Math.max(0, totalCandidates - rows.length);
  const result = { solved, failed, skipped_no_odds, processed: rows.length, remaining, warnings };
  console.log('[lambda] ozet', JSON.stringify(result));
  return json(result, 200);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function json(body: any, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
