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
  events: MatchEvent[]; // goals only (authoritative)
}

export interface LiveOdds {
  home: number;
  draw: number;
  away: number;
}

export type LiveEventType = 'goal' | 'penalty_goal' | 'penalty_miss' | 'red_card' | 'chance';

/** A feed/atmosphere event. Only 'goal' and 'penalty_goal' change the score;
 *  the rest are presentation only and never affect the result. */
export interface LiveEvent {
  minute: number;
  type: LiveEventType;
  team: 'home' | 'away';
}

const isGoal = (t: LiveEventType) => t === 'goal' || t === 'penalty_goal';

// --- odds model (JS port of server _live_odds, with the same softening) -----

const FACT = [1, 1, 2, 6, 24, 120, 720, 5040, 40320];
const poisson = (k: number, lam: number) => (Math.exp(-lam) * Math.pow(lam, k)) / FACT[k];
const BLEND = 0.2; // pull 20% toward uniform so late/extreme prices aren't brutal

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
  for (let k = 0; k <= cap; k++) { fh[k] = poisson(k, lh); fa[k] = poisson(k, la); }
  let pw = 0, pd = 0, pl = 0;
  for (let h = 0; h <= cap; h++)
    for (let a = 0; a <= cap; a++) {
      const pk = fh[h] * fa[a];
      const fd = d + h - a;
      if (fd > 0) pw += pk; else if (fd === 0) pd += pk; else pl += pk;
    }
  const s = pw + pd + pl || 1;
  pw = (pw / s) * (1 - BLEND) + BLEND / 3;
  pd = (pd / s) * (1 - BLEND) + BLEND / 3;
  pl = (pl / s) * (1 - BLEND) + BLEND / 3;
  const m = 1.06;
  const price = (p: number) => Math.min(20, Math.max(1.05, Math.round((1 / (Math.max(p, 0.001) * m)) * 100) / 100));
  return { home: price(pw), draw: price(pd), away: price(pl) };
}

// --- deterministic atmosphere (client-side; never touches the result) -------

function seeded(str: string) {
  let h = 2166136261;
  for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return () => { h = (Math.imul(h, 16807) % 2147483647) >>> 0; return (h % 100000) / 100000; };
}

/** Goals stay authoritative; sprinkle penalties / a red card / near-misses,
 *  all deterministic per match so re-watching is identical. */
export function buildAtmosphere(matchId: string, goals: MatchEvent[]): LiveEvent[] {
  const rng = seeded(matchId);
  const used = new Set(goals.map((g) => g.minute));
  const out: LiveEvent[] = goals.map((g) => ({
    minute: g.minute,
    type: rng() < 0.22 ? 'penalty_goal' : 'goal',
    team: g.team,
  }));

  const freeMinute = (lo: number, hi: number): number | null => {
    for (let i = 0; i < 8; i++) {
      const m = lo + Math.floor(rng() * (hi - lo));
      if (!used.has(m)) { used.add(m); return m; }
    }
    return null;
  };

  // a missed penalty (tension, no goal)
  if (rng() < 0.35) {
    const m = freeMinute(10, 80);
    if (m) out.push({ minute: m, type: 'penalty_miss', team: rng() < 0.5 ? 'home' : 'away' });
  }
  // a red card
  if (rng() < 0.4) {
    const m = freeMinute(35, 88);
    if (m) out.push({ minute: m, type: 'red_card', team: rng() < 0.5 ? 'home' : 'away' });
  }
  // 1–2 big chances (near-misses)
  const chances = 1 + (rng() < 0.5 ? 1 : 0);
  for (let i = 0; i < chances; i++) {
    const m = freeMinute(8, 85);
    if (m) out.push({ minute: m, type: 'chance', team: rng() < 0.5 ? 'home' : 'away' });
  }

  return out.sort((a, b) => a.minute - b.minute);
}

// --- tempo schedule (variable pace + half-time pause) -----------------------

export interface Schedule {
  minuteStart: number[]; // seconds into the replay when each minute (0..90) begins
  htStart: number;
  htEnd: number;
  total: number;
}

const HT_PAUSE = 2.6;

/** Slow the clock near events and in the last 10 minutes; pause at half-time.
 *  Playing time is scaled to `durationSecs`; the HT pause is added on top. */
export function buildSchedule(events: LiveEvent[], durationSecs: number): Schedule {
  const tense = new Set<number>();
  for (const e of events) {
    if (e.type === 'chance' || e.type === 'penalty_miss') tense.add(e.minute);
    if (isGoal(e.type)) {
      tense.add(e.minute); tense.add(e.minute - 1); tense.add(e.minute - 2);
    }
  }
  const w: number[] = [];
  for (let m = 1; m <= 90; m++) {
    let x = 1;
    if (m >= 80) x *= 2.3; else if (m >= 70) x *= 1.4;
    if (tense.has(m)) x *= 1.8;
    w[m] = x;
  }
  const sum = w.slice(1).reduce((a, b) => a + b, 0);
  const k = durationSecs / sum; // scale so playing time == durationSecs
  const minuteStart = new Array(91).fill(0);
  let t = 0;
  for (let m = 1; m <= 90; m++) { minuteStart[m] = t; t += w[m] * k; }
  minuteStart[90] = t - w[90] * k; // minute 90 begins here
  // insert the half-time pause between minute 45 and 46
  const htStart = minuteStart[46];
  for (let m = 46; m <= 90; m++) minuteStart[m] += HT_PAUSE;
  return { minuteStart, htStart, htEnd: htStart + HT_PAUSE, total: t + HT_PAUSE };
}

export type ReplayPhase = 'live' | 'finished';

export interface ReplayFrame {
  minute: number;
  phase: ReplayPhase;
  halfTime: boolean;
  home_score: number;
  away_score: number;
  revealed: LiveEvent[];
  live_odds: LiveOdds | null;
  result: Outcome | null;
  justEvent: LiveEvent | null; // the newest event revealed this frame
}

export function replayState(
  tl: WatchTimeline,
  events: LiveEvent[],
  sched: Schedule,
  elapsed: number,
  prevMinute: number,
): ReplayFrame {
  const finished = elapsed >= sched.total;
  const halfTime = !finished && elapsed >= sched.htStart && elapsed < sched.htEnd;

  let minute = 90;
  if (!finished) {
    minute = 0;
    for (let m = 1; m <= 90; m++) { if (sched.minuteStart[m] <= elapsed) minute = m; else break; }
    if (halfTime) minute = 45;
  }

  const revealed = events.filter((e) => e.minute <= minute);
  const hs = revealed.filter((e) => e.team === 'home' && isGoal(e.type)).length;
  const as = revealed.filter((e) => e.team === 'away' && isGoal(e.type)).length;
  const justEvent = events.find((e) => e.minute > prevMinute && e.minute <= minute) ?? null;

  return {
    minute,
    phase: finished ? 'finished' : 'live',
    halfTime,
    home_score: hs,
    away_score: as,
    revealed,
    live_odds: finished ? null : liveOdds(tl.probs, minute, hs, as),
    result: finished ? tl.result : null,
    justEvent,
  };
}
