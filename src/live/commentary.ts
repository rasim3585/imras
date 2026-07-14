// Text commentary for the live-watch feed. The ambient lines are derived from
// the SAME possession sim the pitch animates (matchSim.ts), on the same clock —
// so a "save" line appears exactly when the ball is at the keeper. Goals + red
// cards come from the server (score/odds authoritative) and burst on top.

import { simEvents, type Side, type SimEvType } from './matchSim';

export type LineKind =
  | 'buildup' | 'shot' | 'goal' | 'miss' | 'save' | 'blocked' | 'corner'
  | 'foul' | 'freekick' | 'offside' | 'yellow' | 'goalkick' | 'sub' | 'calm' | 'card' | 'mark';

export interface Line {
  key: string;
  minute: number;
  sub: number;
  sec?: number;     // match-second the moment happens — feed reveals on the SAME clock the pitch does
  kind: LineKind;
  team?: Side;
  text: string;
  isGoal?: boolean;
  penalty?: boolean;
  scoreH?: number;  // set on goal lines: the score once this goal lands
  scoreA?: number;
}

function seeded(str: string) {
  let h = 2166136261;
  for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return () => { h = (Math.imul(h, 16807) % 2147483647) >>> 0; return (h % 100000) / 100000; };
}
const pick = (rng: () => number, arr: string[]) => arr[Math.floor(rng() * arr.length)];

const BUILDUP = [
  '{T} push forward', '{T} work it out wide', '{T} break at pace',
  '{T} string the passes together', '{T} win it back and surge on',
  '{T} switch play and drive in', '{T} counter through the middle',
];
const SHOT = ['{T} go for goal…', 'the shot is away…', 'space opens and {T} strike…', 'first-time effort from {T}…'];

const nm = (team: Side, home: string, away: string) => (team === 'home' ? home : away);
const T = (s: string, team: Side, home: string, away: string) => s.replace('{T}', nm(team, home, away));

// --- feed lines from the POSSESSION sim (matchSim) — so the key-moments text
//     matches the ball on the pitch exactly (same events). ---------------------
// EVERY held pitch event maps to a feed line — same events, so the feed and the
// pitch can never diverge (goal kick included: the pitch now holds on it too).
const SIM_KIND: Partial<Record<SimEvType, LineKind>> = {
  save: 'save', miss: 'miss', blocked: 'blocked', corner: 'corner',
  freekick: 'freekick', offside: 'offside', foul: 'foul', yellow: 'yellow',
  goalkick: 'goalkick',
};
const SIM_TEXT: Record<string, string[]> = {
  save: ['{T} shoot… and the keeper saves it!', '{T} strike… great stop by the keeper!'],
  miss: ['{T} shoot… just wide!', '{T} go for goal… over the bar!'],
  blocked: ['{T} shoot… blocked at the last moment!', '{T} effort… a defender throws himself in the way!'],
  corner: ['…deflected behind. Corner {T}.', '…scrambled away. Corner {T}.'],
  offside: ['…but the flag is up. Offside, {T}.', '{T} caught offside.'],
  foul: ['Cynical foul stops {T}. Free-kick.', 'Late challenge — free-kick to {T}.'],
  yellow: ['Booked. Yellow card, {T}.', '{T} go into the book.'],
  goalkick: ['Goal kick, {T}.', '{T} restart from the keeper.'],
};
export function simLines(matchId: string, home: string, away: string, dur: number): Line[] {
  const rng = seeded(`${matchId}:fl`);
  const out: Line[] = [];
  for (const e of simEvents(matchId, 90, dur)) {
    const kind = SIM_KIND[e.type]; if (!kind) continue;   // shot is only a sub-beat, never emitted standalone
    out.push({ key: e.key, minute: e.minute, sub: 0, sec: e.sec, kind, team: e.team, text: T(pick(rng, SIM_TEXT[e.type] ?? ['{T}']), e.team, home, away) });
  }
  return out.sort((a, b) => (a.sec ?? 0) - (b.sec ?? 0));
}

/** A goal's build-up burst: attack → shot → GOAL. */
export function goalBurst(
  matchId: string, minute: number, team: Side,
  home: string, away: string, hs: number, as: number, penalty: boolean,
): Line[] {
  const rng = seeded(`${matchId}:g${minute}`);
  const tName = nm(team, home, away);
  const score = `${hs}-${as}`;
  const s0 = minute * 60;
  // team is part of the key: two goals in the same minute (one per side) must
  // not collide or the second burst is swallowed by the enqueued-set
  const k = `g${minute}${team}`;
  const goal = { key: `${k}2`, minute, sub: 2, sec: s0 + 2, kind: 'goal' as const, team, isGoal: true, scoreH: hs, scoreA: as };
  if (penalty) {
    return [
      { key: `${k}0`, minute, sub: 0, sec: s0, kind: 'buildup', team, text: `Penalty to ${tName}! Up steps the taker…` },
      { key: `${k}1`, minute, sub: 1, sec: s0 + 1, kind: 'shot', team, text: 'he sends the keeper the wrong way…' },
      { ...goal, penalty: true, text: `PENALTY GOAL! ${tName} make it ${score}` },
    ];
  }
  return [
    { key: `${k}0`, minute, sub: 0, sec: s0, kind: 'buildup', team, text: T(pick(rng, BUILDUP), team, home, away) },
    { key: `${k}1`, minute, sub: 1, sec: s0 + 1, kind: 'shot', team, text: T(pick(rng, SHOT), team, home, away) },
    { ...goal, text: `GOOOAL! ${tName} make it ${score}` },
  ];
}

export function cardLine(minute: number, team: Side, teamName: string): Line {
  return { key: `c${minute}${team}`, minute, sub: 3, sec: minute * 60 + 3, kind: 'card', team, text: `RED CARD! ${teamName} are down to ten men.` };
}

/** A plain history line for goals that already happened before the user joined. */
export function goalHistoryLine(minute: number, team: Side, teamName: string, hs: number, as: number): Line {
  return { key: `g${minute}${team}2`, minute, sub: 2, sec: minute * 60 + 2, kind: 'goal', team, isGoal: false, scoreH: hs, scoreA: as, text: `Goal — ${teamName} (${hs}-${as})` };
}
