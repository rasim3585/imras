// Client-side atmosphere for the live watch screen. These events are purely
// presentational (they never change the score/result) and are generated
// DETERMINISTICALLY from the match id — so they don't need the hidden future,
// which keeps live betting fair. Goals still come from the server (get_live_state).

export type LiveEventType = 'goal' | 'penalty_goal' | 'penalty_miss' | 'red_card' | 'chance';

export interface LiveEvent {
  minute: number;
  type: LiveEventType;
  team: 'home' | 'away';
}

export const isGoalType = (t: LiveEventType) => t === 'goal' || t === 'penalty_goal';

function seeded(str: string) {
  let h = 2166136261;
  for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return () => { h = (Math.imul(h, 16807) % 2147483647) >>> 0; return (h % 100000) / 100000; };
}

/** Whether a goal at this minute reads as a penalty — deterministic per match. */
export function isPenaltyGoal(matchId: string, minute: number): boolean {
  const rng = seeded(`${matchId}:pen:${minute}`);
  return rng() < 0.22;
}

/** Standalone atmosphere (red card, big chances, a missed penalty) at stable
 *  minutes — independent of the goal script. */
export function atmosphereFor(matchId: string): LiveEvent[] {
  const rng = seeded(`${matchId}:atmo`);
  const out: LiveEvent[] = [];
  const side = (): 'home' | 'away' => (rng() < 0.5 ? 'home' : 'away');
  const pick = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo));

  if (rng() < 0.35) out.push({ minute: pick(10, 80), type: 'penalty_miss', team: side() });
  if (rng() < 0.4) out.push({ minute: pick(35, 88), type: 'red_card', team: side() });
  const chances = 1 + (rng() < 0.5 ? 1 : 0);
  for (let i = 0; i < chances; i++) out.push({ minute: pick(8, 85), type: 'chance', team: side() });

  return out.sort((a, b) => a.minute - b.minute);
}
