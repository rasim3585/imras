// Invert BSD's consensus odds into an INDEPENDENT-Poisson (l1, l2) pair. Run ONCE
// per fixture at sync time; stored as lambda_home=l1, lambda_away=l2,
// lambda_shared=0. The engine (0038) prices LIVE from it; pre-match odds come
// straight from BSD (prematch_odds, 0037), so lambda only has to be sensible for
// live pricing, not reproduce the book.
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
}

export interface LambdaSolution {
  lambdaHome: number;    // l1 (independent Poisson)
  lambdaAway: number;    // l2
  lambdaShared: number;  // always 0 (DB requires it)
  error: number;
  /** |over-2.5 from a 1X2-ONLY fit - the book's over-2.5|. A small gap is
   *  EXPECTED -- pure Poisson under-predicts draws, so 1X2 and o/u can't land on
   *  one lambda. Only a large gap (>0.30) hints at bad provider data. null if the
   *  book has no o/u. */
  ouGap: number | null;
}

interface ModelProbs { home: number; draw: number; away: number; o15: number; o25: number }

function modelProbs(l1: number, l2: number, cap = 8): ModelProbs {
  const fh = Array.from({ length: cap + 1 }, (_, k) => poisson(l1, k));
  const fa = Array.from({ length: cap + 1 }, (_, k) => poisson(l2, k));
  let pw = 0, pd = 0, pl = 0, s = 0;
  const tot = new Array(2 * cap + 1).fill(0);
  for (let x = 0; x <= cap; x++) {
    for (let y = 0; y <= cap; y++) {
      const pk = fh[x] * fa[y];
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
const L_MIN = 0.05;                              // keep l1, l2 non-degenerate
const MAX_TEAM = 4.0, MAX_TOTAL = 5.5;           // mirror real_fixtures_lambda_sane_ck
const feasible = (l1: number, l2: number): boolean => l1 <= MAX_TEAM && l2 <= MAX_TEAM && l1 + l2 <= MAX_TOTAL;

function grid2(err: (l1: number, l2: number) => number): { l1: number; l2: number } {
  let best = { e: Infinity, l1: 1.2, l2: 1.0 };
  for (let l1 = L_MIN; l1 <= 3.8; l1 += 0.05) {
    for (let l2 = L_MIN; l2 <= 3.8; l2 += 0.05) {
      if (!feasible(l1, l2)) continue;
      const e = err(l1, l2); if (e < best.e) best = { e, l1, l2 };
    }
  }
  const { l1: a, l2: b } = best;
  best = { e: Infinity, l1: a, l2: b };
  for (let l1 = Math.max(L_MIN, a - 0.05); l1 <= a + 0.05; l1 += 0.005) {
    for (let l2 = Math.max(L_MIN, b - 0.05); l2 <= b + 0.05; l2 += 0.005) {
      if (!feasible(l1, l2)) continue;
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
  const errFull = (l1: number, l2: number): number => {
    const p = modelProbs(l1, l2);
    let e = err1x2(p);
    if (t25 != null) e += OU_WEIGHT * Math.abs(p.o25 - t25);
    if (t15 != null) e += OU_WEIGHT * Math.abs(p.o15 - t15);
    return e;
  };

  const b = grid2(errFull);

  // consistency: does 1X2 ALONE agree with the book's over-2.5?
  let ouGap: number | null = null;
  if (t25 != null) {
    const only = grid2((l1, l2) => err1x2(modelProbs(l1, l2)));
    ouGap = Math.abs(modelProbs(only.l1, only.l2).o25 - t25);
  }

  return {
    lambdaHome: round3(b.l1),
    lambdaAway: round3(b.l2),
    lambdaShared: 0,
    error: errFull(b.l1, b.l2),
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
