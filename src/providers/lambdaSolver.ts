// Invert BSD's consensus odds into a Poisson lambda pair. Run ONCE per fixture
// at sync time; stored in real_fixtures.lambda_home/away and the live engine
// (_market_odds_ft_real) prices from it.
//
// We fit 1X2 AND over/under together. 1X2 alone under-constrains the total:
// pure Poisson under-predicts draws (0-0/1-1 happen more than it thinks -- Dixon-
// Coles 1997), so fitting 1X2 only pulls lambda too low and mis-prices o/u (a
// France-Morocco lambda of total 1.47 priced over-2.5 at 5.49 vs the book's
// 2.08). 1X2 constrains the lambda DIFFERENCE, over/under constrains the SUM;
// together they pin both. Engine stays pure Poisson -- solver and engine must
// share one model (Dixon-Coles is a separate, later job: its correction is
// undefined once the live score passes 1-1).

const FACT = [1, 1, 2, 6, 24, 120, 720, 5040, 40320, 362880, 3628800];
function factorial(k: number): number { return k < FACT.length ? FACT[k] : k * factorial(k - 1); }

export function poisson(lambda: number, k: number): number {
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
}

/** Consensus odds for one fixture. Over/under are optional -- if the book has no
 *  o/u we fall back to a 1X2-only fit. */
export interface OddsInput {
  homeWin: number; draw: number; awayWin: number;
  over15?: number; under15?: number;
  over25?: number; under25?: number;
}

export interface LambdaSolution {
  lambdaHome: number;
  lambdaAway: number;
  error: number;
  /** |over-2.5 implied by a 1X2-ONLY fit  -  over-2.5 the book quotes|. Large =>
   *  the provider's 1X2 and o/u disagree (bad data). null if the book has no o/u. */
  ouGap: number | null;
}

interface ModelProbs { home: number; draw: number; away: number; o15: number; o25: number }

function modelProbs(lh: number, la: number, cap = 8): ModelProbs {
  const fh = Array.from({ length: cap + 1 }, (_, k) => poisson(lh, k));
  const fa = Array.from({ length: cap + 1 }, (_, k) => poisson(la, k));
  let pw = 0, pd = 0, pl = 0, s = 0;
  const tot = new Array(2 * cap + 1).fill(0);
  for (let h = 0; h <= cap; h++) {
    for (let a = 0; a <= cap; a++) {
      const pk = fh[h] * fa[a];
      s += pk;
      if (h > a) pw += pk; else if (h === a) pd += pk; else pl += pk;
      tot[h + a] += pk;
    }
  }
  return {
    home: pw / s, draw: pd / s, away: pl / s,
    o15: 1 - (tot[0] + tot[1]) / s,
    o25: 1 - (tot[0] + tot[1] + tot[2]) / s,
  };
}

/** De-vig an over/under pair into P(over). null unless both odds are usable. */
function pairTarget(over?: number, under?: number): number | null {
  if (!(over && over > 1) || !(under && under > 1)) return null;
  const io = 1 / over, iu = 1 / under;
  return io / (io + iu);
}

function gridSearch(err: (lh: number, la: number) => number): { lh: number; la: number } {
  let best = { e: Infinity, lh: 1.35, la: 1.15 };
  for (let lh = 0.30; lh <= 4.00; lh += 0.02) {
    for (let la = 0.30; la <= 4.00; la += 0.02) {
      const e = err(lh, la); if (e < best.e) best = { e, lh, la };
    }
  }
  const { lh: lh0, la: la0 } = best;
  best = { e: Infinity, lh: lh0, la: la0 };
  for (let lh = lh0 - 0.03; lh <= lh0 + 0.03; lh += 0.002) {
    for (let la = la0 - 0.03; la <= la0 + 0.03; la += 0.002) {
      if (lh <= 0 || la <= 0) continue;
      const e = err(lh, la); if (e < best.e) best = { e, lh, la };
    }
  }
  return { lh: best.lh, la: best.la };
}

const OU_WEIGHT = 1.5;   // over/under gets a bit more pull than each 1X2 leg

export function solveLambda(o: OddsInput): LambdaSolution {
  const ih = 1 / o.homeWin, id = 1 / o.draw, ia = 1 / o.awayWin;
  const over = ih + id + ia;
  const tHome = ih / over, tDraw = id / over, tAway = ia / over;
  const t25 = pairTarget(o.over25, o.under25);
  const t15 = pairTarget(o.over15, o.under15);

  const err1x2 = (lh: number, la: number): number => {
    const p = modelProbs(lh, la);
    return Math.abs(p.home - tHome) + Math.abs(p.draw - tDraw) + Math.abs(p.away - tAway);
  };
  const errFull = (lh: number, la: number): number => {
    let e = err1x2(lh, la);
    const p = modelProbs(lh, la);
    if (t25 != null) e += OU_WEIGHT * Math.abs(p.o25 - t25);
    if (t15 != null) e += OU_WEIGHT * Math.abs(p.o15 - t15);
    return e;
  };

  const useOU = t25 != null || t15 != null;
  const best = gridSearch(useOU ? errFull : err1x2);

  // consistency: does 1X2 ALONE agree with the book's over-2.5?
  let ouGap: number | null = null;
  if (t25 != null) {
    const only = gridSearch(err1x2);
    ouGap = Math.abs(modelProbs(only.lh, only.la).o25 - t25);
  }

  return { lambdaHome: round3(best.lh), lambdaAway: round3(best.la), error: errFull(best.lh, best.la), ouGap };
}

function round3(x: number): number { return Math.round(x * 1000) / 1000; }

/** Sanity guard. Non-throwing -- caller warns and still stores (a real 6-1 can
 *  total > 4.0; dropping it would be discarding correct data). */
export function lambdaHealth(s: LambdaSolution): { ok: boolean; reason?: string } {
  const total = s.lambdaHome + s.lambdaAway;
  if (total < 1.5 || total > 4.0) return { ok: false, reason: `lambda toplamı ${total.toFixed(2)} (1.5-4.0 dışı)` };
  return { ok: true };
}
