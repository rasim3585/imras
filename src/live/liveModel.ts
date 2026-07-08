import type { MatchEvent, Outcome } from '../lib/types';

/** Full match script for a bet-on match (from get_watch_timeline). */
export interface WatchTimeline {
  match_id: string;
  home_team: string;
  away_team: string;
  duration_secs: number;
  probs: { home: number; draw: number; away: number };
  result: Outcome;
  home_score: number;
  away_score: number;
  events: MatchEvent[];
}

export interface LiveOdds {
  home: number;
  draw: number;
  away: number;
}

const FACT = [1, 1, 2, 6, 24, 120, 720, 5040, 40320];
const poisson = (k: number, lam: number) => (Math.exp(-lam) * Math.pow(lam, k)) / FACT[k];

// JS port of the server _live_odds model — identical math, so a client-side
// replay shows the same live prices without a round-trip per tick.
export function liveOdds(
  probs: { home: number; away: number },
  minute: number,
  hs: number,
  as: number,
): LiveOdds {
  const ph = probs.home ?? 0.4;
  const pa = probs.away ?? 0.3;
  const r = Math.max(0, (90 - Math.min(minute, 90)) / 90);
  const lh = (0.6 + 1.7 * ph) * r;
  const la = (0.6 + 1.7 * pa) * r;
  const d = hs - as;
  const cap = 8;
  const fh: number[] = [];
  const fa: number[] = [];
  for (let k = 0; k <= cap; k++) {
    fh[k] = poisson(k, lh);
    fa[k] = poisson(k, la);
  }
  let pw = 0, pd = 0, pl = 0;
  for (let h = 0; h <= cap; h++) {
    for (let a = 0; a <= cap; a++) {
      const pk = fh[h] * fa[a];
      const fd = d + h - a;
      if (fd > 0) pw += pk;
      else if (fd === 0) pd += pk;
      else pl += pk;
    }
  }
  const s = pw + pd + pl || 1;
  pw /= s; pd /= s; pl /= s;
  const m = 1.06;
  const price = (p: number) => Math.min(25, Math.max(1.01, Math.round((1 / (Math.max(p, 0.0005) * m)) * 100) / 100));
  return { home: price(pw), draw: price(pd), away: price(pl) };
}

export type ReplayPhase = 'live' | 'finished';

export interface ReplayFrame {
  minute: number;
  phase: ReplayPhase;
  home_score: number;
  away_score: number;
  revealed: MatchEvent[];
  live_odds: LiveOdds | null;
  result: Outcome | null;
  /** Minute of the goal revealed on THIS frame, if one just dropped. */
  justScored: MatchEvent | null;
}

/** Pure: what the match looks like `elapsed` seconds into a personal replay. */
export function replayFrame(tl: WatchTimeline, elapsed: number, prevMinute: number): ReplayFrame {
  const minuteF = Math.min(90, Math.max(0, (elapsed / tl.duration_secs) * 90));
  const minute = Math.floor(minuteF);
  const finished = minuteF >= 90;
  const revealed = tl.events.filter((e) => e.minute <= minute);
  const hs = revealed.filter((e) => e.team === 'home').length;
  const as = revealed.filter((e) => e.team === 'away').length;
  // a goal "just scored" if its minute is in (prevMinute, minute]
  const justScored = tl.events.find((e) => e.minute > prevMinute && e.minute <= minute) ?? null;
  return {
    minute,
    phase: finished ? 'finished' : 'live',
    home_score: hs,
    away_score: as,
    revealed,
    live_odds: finished ? null : liveOdds(tl.probs, minute, hs, as),
    result: finished ? tl.result : null,
    justScored,
  };
}
