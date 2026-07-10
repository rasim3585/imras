// Invert BSD's consensus odds into an INDEPENDENT-Poisson (l1, l2) pair. Run ONCE
// per fixture at sync time; stored as lambda_home=l1, lambda_away=l2,
// lambda_shared=0. The engine (0038) prices LIVE from it; pre-match odds come
// straight from BSD (prematch_odds, 0037), so lambda only has to be sensible for
// live pricing, not reproduce the book.
//
// TWO-STAGE solve (decoupled, no joint grid):
//   Stage 1 -- total goals T from the OVER line. The sum of two independent
//     Poissons is itself Poisson(T=l1+l2), so the over-2.5 line depends ONLY on
//     T. One unknown, one equation: invert 1 - P(0) - P(1) - P(2) = over-2.5 for
//     T (bisection). btts is NOT fit -- it is kept as a validation check only.
//   Stage 2 -- with T fixed, split it by the ratio r = l1/l2: l2 = T/(1+r),
//     l1 = T - l2. Search r to minimise the 1X2 error.
//
// Why independent (no shared term): a bivariate shared shock helped pre-match
// draws but INFLATED the away branch after a goal in live pricing (Ludogorets/
// Inter away goal 14.96 vs BetAngel 8.00; Hajduk 30' 1-0 away 50.00 with l3=0.76
// vs ~13-17 on Nesine). Independent Poisson (l3=0) tracks the market. The DB now
// requires lambda_shared=0, so the solver never produces a shared term.

const FACT = [1, 1, 2, 6, 24, 120, 720, 5040, 40320, 362880, 3628800];
function factorial(k: number): number { return k < FACT.length ? FACT[k] : k * factorial(k - 1); }

export function poisson(lambda: number, k: number): number {
  if (lambda === 0) return k === 0 ? 1 : 0;
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
}

export interface OddsInput {
  homeWin: number; draw: number; awayWin: number;
  over15?: number; under15?: number;
  over25?: number; under25?: number;
  bttsYes?: number; bttsNo?: number;
}

export interface LambdaSolution {
  lambdaHome: number;    // l1 (independent Poisson)
  lambdaAway: number;    // l2
  lambdaShared: number;  // always 0 (DB requires it)
  /** Stage-2 residual: the 1X2 fit error at the chosen split. */
  error: number;
  /** VALIDATION ONLY (not fit): |model btts - the book's btts|. Independent
   *  Poisson ignores score correlation, so a small gap is EXPECTED; a large gap
   *  (>0.15) hints at bad provider data or a strongly correlated market. null if
   *  the book has no btts line. */
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

// P(total goals > kMax + 0.5) for Poisson(T) = 1 - sum_{k<=kMax} P(k). Monotone
// increasing in T -- more goals, more overs.
function overFromTotal(T: number, kMax: number): number {
  let s = 0;
  for (let k = 0; k <= kMax; k++) s += poisson(T, k);
  return 1 - s;
}

// STAGE 1: invert the over line for total goals T. kMax=2 -> over-2.5, kMax=1 ->
// over-1.5. Clamped to [L_MIN, MAX_TOTAL] when the book wants more/fewer goals
// than we can price.
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

// STAGE 2: with T fixed, split by r = l1/l2 to minimise the 1X2 error. Even split
// is always feasible (T <= MAX_TOTAL < 2*MAX_TEAM), so it seeds the search.
function splitTotal(T: number, err1x2: (l1: number, l2: number) => number): Split {
  let best: Split = { l1: T / 2, l2: T / 2, err: err1x2(T / 2, T / 2) };
  const consider = (r: number): void => {
    const l2 = T / (1 + r), l1 = T - l2;
    if (l1 < L_MIN || l2 < L_MIN || !feasible(l1, l2)) return;
    const e = err1x2(l1, l2);
    if (e < best.err) best = { l1, l2, err: e };
  };
  // coarse log-grid over r in ~[0.08, 12], then refine around the best ratio.
  for (let e = -2.5; e <= 2.5; e += 0.02) consider(Math.exp(e));
  const r0 = best.l1 / best.l2;
  for (let r = r0 * 0.9; r <= r0 * 1.1; r += r0 * 0.002) consider(r);
  return best;
}

// Fallback split when the book has NO over line: we cannot pin T from o/u, so
// solve (l1, l2) straight from 1X2 on a 2D grid (coarse then refine).
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

export function solveLambda(o: OddsInput): LambdaSolution {
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

  // Stage 1 (T from the over line) + Stage 2 (split from 1X2). If the book has no
  // over line at all, fall back to a joint 1X2-only grid.
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

/** Sanity guard on the total. Non-throwing -- caller warns and still stores. */
export function lambdaHealth(s: LambdaSolution): { ok: boolean; reason?: string } {
  const total = s.lambdaHome + s.lambdaAway;
  if (total < 1.5 || total > 4.0) return { ok: false, reason: `lambda toplamı ${total.toFixed(2)} (1.5-4.0 dışı)` };
  return { ok: true };
}
