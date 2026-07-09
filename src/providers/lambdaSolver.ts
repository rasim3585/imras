// Invert BSD's consensus odds into a BIVARIATE Poisson (l1, l2, l3). Run ONCE per
// fixture at sync time; stored as lambda_home=l1+l3, lambda_away=l2+l3,
// lambda_shared=l3, and the engine (_market_odds_ft_real, migration 0036) prices
// from it with the SAME model.
//
// Why bivariate: pure Poisson systematically under-predicts draws (0-0/1-1 happen
// more than independence allows), so a 2-parameter fit priced draws ~+1.14 too
// long across 12/12 matches. The shared shock term l3 adds positive correlation
// that pulls draws up. l3=0 is exactly pure Poisson (correlation-free matches are
// real -- Shandong-Yunnan solves to l3=0), so l3 must be scanned from 0.
//   X = Y1 + Y3,  Z = Y2 + Y3   (Y* independent Poisson)
//   P(x,y) = sum_{k=0..min(x,y)} pois(l1,x-k) * pois(l2,y-k) * pois(l3,k)

const FACT = [1, 1, 2, 6, 24, 120, 720, 5040, 40320, 362880, 3628800];
function factorial(k: number): number { return k < FACT.length ? FACT[k] : k * factorial(k - 1); }

export function poisson(lambda: number, k: number): number {
  if (lambda === 0) return k === 0 ? 1 : 0;                 // explicit -- don't trust Math.pow(0,0)
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
}

export interface OddsInput {
  homeWin: number; draw: number; awayWin: number;
  over15?: number; under15?: number;
  over25?: number; under25?: number;
}

export interface LambdaSolution {
  lambdaHome: number;    // l1 + l3 (home's TOTAL expected goals)
  lambdaAway: number;    // l2 + l3
  lambdaShared: number;  // l3
  error: number;
  /** |over-2.5 from a pure-Poisson 1X2-ONLY fit - the book's over-2.5|. A small
   *  gap is EXPECTED -- pure Poisson under-predicts draws, so 1X2 and o/u can't
   *  land on one lambda. Only a large gap (>0.30) hints at bad provider data.
   *  null if the book has no o/u. */
  ouGap: number | null;
}

interface ModelProbs { home: number; draw: number; away: number; o15: number; o25: number }

function modelProbs(l1: number, l2: number, l3: number, cap = 8): ModelProbs {
  let pw = 0, pd = 0, pl = 0, s = 0;
  const tot = new Array(2 * cap + 1).fill(0);
  for (let x = 0; x <= cap; x++) {
    for (let y = 0; y <= cap; y++) {
      let pk = 0;
      const mn = Math.min(x, y);
      for (let k = 0; k <= mn; k++) pk += poisson(l1, x - k) * poisson(l2, y - k) * poisson(l3, k);
      s += pk;
      if (x > y) pw += pk; else if (x === y) pd += pk; else pl += pk;
      tot[x + y] += pk;
    }
  }
  return {
    home: pw / s, draw: pd / s, away: pl / s,
    o15: 1 - (tot[0] + tot[1]) / s,
    o25: 1 - (tot[0] + tot[1] + tot[2]) / s,
  };
}

function pairTarget(over?: number, under?: number): number | null {
  if (!(over && over > 1) || !(under && under > 1)) return null;
  const io = 1 / over, iu = 1 / under;
  return io / (io + iu);
}

const OU_WEIGHT = 1.5;
const L_MIN = 0.05;   // keep l1, l2 non-degenerate

// Sanity bounds -- mirror the DB constraint real_fixtures_lambda_sane_ck. Since
// pre-match odds now come straight from BSD (prematch_odds), lambda only drives
// LIVE pricing, so it must be plausible, not chase an unreachable book price.
// An unconstrained solve found Qarabag 3.36/1.65 with l3=1.27 (Vestri's 1.65
// goals "1.27 shared" -- absurd). A violating point is skipped, not priced.
const MAX_TEAM = 4.0, MAX_TOTAL = 5.5, MAX_SHARED = 0.8;
function feasible(l1: number, l2: number, l3: number): boolean {
  const lh = l1 + l3, la = l2 + l3;
  return lh <= MAX_TEAM && la <= MAX_TEAM && lh + la <= MAX_TOTAL && l3 <= MAX_SHARED;
}

// bivariate search over (l1, l2, l3>=0). l3=0 is scanned. lambda_shared <=
// min(lambda_home, lambda_away) holds automatically (l3 <= l1+l3, l3 <= l2+l3).
function grid3(err: (l1: number, l2: number, l3: number) => number): { l1: number; l2: number; l3: number } {
  let best = { e: Infinity, l1: 1.2, l2: 1.0, l3: 0 };
  for (let l1 = L_MIN; l1 <= 3.2; l1 += 0.08) {
    for (let l2 = L_MIN; l2 <= 3.2; l2 += 0.08) {
      for (let l3 = 0; l3 <= 1.6; l3 += 0.08) {
        if (!feasible(l1, l2, l3)) continue;
        const e = err(l1, l2, l3); if (e < best.e) best = { e, l1, l2, l3 };
      }
    }
  }
  const { l1: a, l2: b, l3: c } = best;
  best = { e: Infinity, l1: a, l2: b, l3: c };
  for (let l1 = Math.max(L_MIN, a - 0.04); l1 <= a + 0.04; l1 += 0.01) {
    for (let l2 = Math.max(L_MIN, b - 0.04); l2 <= b + 0.04; l2 += 0.01) {
      for (let l3 = Math.max(0, c - 0.04); l3 <= c + 0.04; l3 += 0.01) {
        if (!feasible(l1, l2, l3)) continue;
        const e = err(l1, l2, l3); if (e < best.e) best = { e, l1, l2, l3 };
      }
    }
  }
  return { l1: best.l1, l2: best.l2, l3: best.l3 };
}

// pure-Poisson (l3=0) 1X2-only fit, for the consistency signal.
function grid2(err: (l1: number, l2: number) => number): { l1: number; l2: number } {
  let best = { e: Infinity, l1: 1.2, l2: 1.0 };
  for (let l1 = 0.30; l1 <= 4.0; l1 += 0.04) {
    for (let l2 = 0.30; l2 <= 4.0; l2 += 0.04) {
      const e = err(l1, l2); if (e < best.e) best = { e, l1, l2 };
    }
  }
  const { l1: a, l2: b } = best;
  best = { e: Infinity, l1: a, l2: b };
  for (let l1 = a - 0.04; l1 <= a + 0.04; l1 += 0.01) {
    for (let l2 = b - 0.04; l2 <= b + 0.04; l2 += 0.01) {
      if (l1 <= 0 || l2 <= 0) continue;
      const e = err(l1, l2); if (e < best.e) best = { e, l1, l2 };
    }
  }
  return { l1: best.l1, l2: best.l2 };
}

export function solveLambda(o: OddsInput): LambdaSolution {
  const ih = 1 / o.homeWin, id = 1 / o.draw, ia = 1 / o.awayWin;
  const over = ih + id + ia;
  const tHome = ih / over, tDraw = id / over, tAway = ia / over;
  const t25 = pairTarget(o.over25, o.under25);
  const t15 = pairTarget(o.over15, o.under15);

  const err1x2 = (p: ModelProbs): number => Math.abs(p.home - tHome) + Math.abs(p.draw - tDraw) + Math.abs(p.away - tAway);
  const errFull = (l1: number, l2: number, l3: number): number => {
    const p = modelProbs(l1, l2, l3);
    let e = err1x2(p);
    if (t25 != null) e += OU_WEIGHT * Math.abs(p.o25 - t25);
    if (t15 != null) e += OU_WEIGHT * Math.abs(p.o15 - t15);
    return e;
  };

  const b = grid3(errFull);

  // consistency: does 1X2 ALONE (pure Poisson) agree with the book's over-2.5?
  let ouGap: number | null = null;
  if (t25 != null) {
    const only = grid2((l1, l2) => err1x2(modelProbs(l1, l2, 0)));
    ouGap = Math.abs(modelProbs(only.l1, only.l2, 0).o25 - t25);
  }

  return {
    lambdaHome: round3(b.l1 + b.l3),
    lambdaAway: round3(b.l2 + b.l3),
    lambdaShared: round3(b.l3),
    error: errFull(b.l1, b.l2, b.l3),
    ouGap,
  };
}

function round3(x: number): number { return Math.round(x * 1000) / 1000; }

/** Sanity guard on the total. Non-throwing -- caller warns and still stores. */
export function lambdaHealth(s: LambdaSolution): { ok: boolean; reason?: string } {
  const total = s.lambdaHome + s.lambdaAway;
  if (total < 1.5 || total > 4.0) return { ok: false, reason: `lambda toplamı ${total.toFixed(2)} (1.5-4.0 dışı)` };
  return { ok: true };
}
