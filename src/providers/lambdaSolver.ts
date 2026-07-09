// Invert BSD's consensus 1X2 odds into a Poisson lambda pair. Run ONCE per
// fixture at sync time; the result is stored in real_fixtures.lambda_home/away
// and the live engine (_market_odds_ft_real) prices from it. This makes the
// kickoff price reproduce BSD's book, so a user never sees 4.12 in the bulletin
// and 3.44 the moment the match starts.

const FACT = [1, 1, 2, 6, 24, 120, 720, 5040, 40320, 362880, 3628800];
function factorial(k: number): number {
  return k < FACT.length ? FACT[k] : k * factorial(k - 1);
}

export function poisson(lambda: number, k: number): number {
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
}

/** P(home win), P(draw), P(away win) for a Poisson scoreline model. Normalised. */
export function outcomeProbs(lh: number, la: number, cap = 8): [number, number, number] {
  const fh = Array.from({ length: cap + 1 }, (_, k) => poisson(lh, k));
  const fa = Array.from({ length: cap + 1 }, (_, k) => poisson(la, k));
  let pw = 0, pd = 0, pl = 0, s = 0;
  for (let h = 0; h <= cap; h++) {
    for (let a = 0; a <= cap; a++) {
      const pk = fh[h] * fa[a];
      s += pk;
      if (h > a) pw += pk;
      else if (h === a) pd += pk;
      else pl += pk;
    }
  }
  return [pw / s, pd / s, pl / s];
}

export interface LambdaSolution {
  lambdaHome: number;
  lambdaAway: number;
  error: number;      // SSE of the fitted probabilities vs the de-vigged target
}

export function solveLambda(homeOdds: number, drawOdds: number, awayOdds: number): LambdaSolution {
  // 1. strip the overround (bookmaker margin) -> fair probabilities
  const ih = 1 / homeOdds, id = 1 / drawOdds, ia = 1 / awayOdds;
  const over = ih + id + ia;                 // e.g. 1.0515 -> 5.15% margin
  const target: [number, number, number] = [ih / over, id / over, ia / over];

  const sse = (lh: number, la: number): number => {
    const p = outcomeProbs(lh, la);
    return (p[0] - target[0]) ** 2 + (p[1] - target[1]) ** 2 + (p[2] - target[2]) ** 2;
  };

  // 2. coarse grid 0.30 - 4.00, step 0.02
  let best = { err: Infinity, lh: 1.35, la: 1.15 };
  for (let lh = 0.30; lh <= 4.00; lh += 0.02) {
    for (let la = 0.30; la <= 4.00; la += 0.02) {
      const err = sse(lh, la);
      if (err < best.err) best = { err, lh, la };
    }
  }

  // 3. fine grid +/- 0.03, step 0.002
  const { lh: lh0, la: la0 } = best;
  best = { err: Infinity, lh: lh0, la: la0 };
  for (let lh = lh0 - 0.03; lh <= lh0 + 0.03; lh += 0.002) {
    for (let la = la0 - 0.03; la <= la0 + 0.03; la += 0.002) {
      if (lh <= 0 || la <= 0) continue;
      const err = sse(lh, la);
      if (err < best.err) best = { err, lh, la };
    }
  }

  return { lambdaHome: round3(best.lh), lambdaAway: round3(best.la), error: best.err };
}

function round3(x: number): number { return Math.round(x * 1000) / 1000; }

/** Sanity guards for a solved fixture. Non-throwing -- caller logs and still stores. */
export function lambdaHealth(s: LambdaSolution): { ok: boolean; reason?: string } {
  const total = s.lambdaHome + s.lambdaAway;
  if (total < 1.5 || total > 4.0) return { ok: false, reason: `lambda total ${total.toFixed(2)} out of 1.5-4.0` };
  return { ok: true };
}
