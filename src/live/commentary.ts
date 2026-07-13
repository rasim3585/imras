// Text commentary for the live-watch feed. The ambient lines are derived from
// the SAME attack waves the pitch animates (liveSim.ts) — so a "save" line only
// ever appears when the ball was actually at the box, and it can never land one
// beat before a goal. Goals + red cards come from the server (score/odds
// authoritative) and get their own burst on top.

import { waves, disciplineEventsFor, type Side } from './liveSim';

export type LineKind =
  | 'buildup' | 'shot' | 'goal' | 'miss' | 'save' | 'blocked' | 'corner'
  | 'foul' | 'freekick' | 'offside' | 'yellow' | 'sub' | 'calm' | 'card' | 'mark';

export interface Line {
  key: string;
  minute: number;
  sub: number;
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
const SAVE = ['…and the keeper flies across to save!', '…great stop by the goalkeeper!', '…tipped over brilliantly!'];
const MISS = ['…just wide of the post!', '…over the bar!', '…drags it wide!'];
const BLOCKED = ['…blocked at the last moment!', '…a defender throws himself in the way!'];
const CORNER = ['…deflected behind. Corner {T}.', '…scrambled away. Corner {T}.'];
const FREEKICK = ['Dangerous free-kick for {T} on the edge of the box…', '{T} win a free-kick in a great spot…'];
const OFFSIDE = ['…but the flag is up. Offside, {T}.', '…{T} caught offside.'];
const FOUL = ['Cynical foul stops {T}. Free-kick.', 'Late challenge — free-kick to {T}.'];
const YELLOW = ['Booked. Yellow card for {O}.', '{O} go into the referee’s book.'];
const SUB = ['{T} make a change — fresh legs on.', 'Substitution for {T}.'];
const CALM = [
  'Midfield battle, no way through.', '{T} keep possession patiently.',
  'A scrappy spell in the middle.', 'Both sides feeling each other out.',
];

const nm = (team: Side, home: string, away: string) => (team === 'home' ? home : away);
const other = (team: Side, home: string, away: string) => (team === 'home' ? away : home);
const T = (s: string, team: Side, home: string, away: string) =>
  s.replace('{T}', nm(team, home, away)).replace('{O}', nm(team, home, away)).replace('{O}', other(team, home, away));

// Ambient script derived from the sim's waves + discipline events. Purely
// presentational — carries no goals.
export function atmosphereScript(matchId: string, home: string, away: string): Line[] {
  const rng = seeded(`${matchId}:cm`);
  const lines: Line[] = [];
  const push = (min: number, sub: number, kind: LineKind, team: Side | undefined, text: string) =>
    lines.push({ key: `a${min}s${sub}${kind}`, minute: min, sub, kind, team, text });

  for (const w of waves(matchId)) {
    const min = Math.floor(w.peak / 60);
    push(min, 0, 'buildup', w.side, T(pick(rng, BUILDUP), w.side, home, away));
    push(min, 1, 'shot', w.side, T(pick(rng, SHOT), w.side, home, away));
    const map: Record<string, [LineKind, string[]]> = {
      save: ['save', SAVE], miss: ['miss', MISS], blocked: ['blocked', BLOCKED],
      corner: ['corner', CORNER], freekick: ['freekick', FREEKICK], offside: ['offside', OFFSIDE],
    };
    const m = map[w.outcome];
    if (m) push(min, 2, m[0], w.side, T(pick(rng, m[1]), w.side, home, away));
  }
  for (const e of disciplineEventsFor(matchId)) {
    if (e.type === 'foul') push(e.minute, 5, 'foul', e.side, T(pick(rng, FOUL), e.side, home, away));
    if (e.type === 'yellow') push(e.minute, 6, 'yellow', e.side, T(pick(rng, YELLOW), e.side, home, away));
    if (e.type === 'sub') push(e.minute, 7, 'sub', e.side, T(pick(rng, SUB), e.side, home, away));
  }
  // a few calm beats in the quiet gaps so the feed never goes empty
  const rng2 = seeded(`${matchId}:calm`);
  for (let min = 6; min < 88; min += 9 + Math.floor(rng2() * 6)) {
    if (lines.some((l) => Math.abs(l.minute - min) <= 1)) continue;
    const side: Side = rng2() < 0.5 ? 'home' : 'away';
    push(min, 4, 'calm', side, T(pick(rng2, CALM), side, home, away));
  }
  return lines.sort((a, b) => a.minute - b.minute || a.sub - b.sub);
}

/** A goal's build-up burst: attack → shot → GOAL. */
export function goalBurst(
  matchId: string, minute: number, team: Side,
  home: string, away: string, hs: number, as: number, penalty: boolean,
): Line[] {
  const rng = seeded(`${matchId}:g${minute}`);
  const tName = nm(team, home, away);
  const score = `${hs}-${as}`;
  const goal = { key: `g${minute}2`, minute, sub: 2, kind: 'goal' as const, team, isGoal: true, scoreH: hs, scoreA: as };
  if (penalty) {
    return [
      { key: `g${minute}0`, minute, sub: 0, kind: 'buildup', team, text: `Penalty to ${tName}! Up steps the taker…` },
      { key: `g${minute}1`, minute, sub: 1, kind: 'shot', team, text: 'he sends the keeper the wrong way…' },
      { ...goal, penalty: true, text: `PENALTY GOAL! ${tName} make it ${score}` },
    ];
  }
  return [
    { key: `g${minute}0`, minute, sub: 0, kind: 'buildup', team, text: T(pick(rng, BUILDUP), team, home, away) },
    { key: `g${minute}1`, minute, sub: 1, kind: 'shot', team, text: T(pick(rng, SHOT), team, home, away) },
    { ...goal, text: `GOOOAL! ${tName} make it ${score}` },
  ];
}

export function cardLine(minute: number, team: Side, teamName: string): Line {
  return { key: `c${minute}${team}`, minute, sub: 3, kind: 'card', team, text: `RED CARD! ${teamName} are down to ten men.` };
}

/** A plain history line for goals that already happened before the user joined. */
export function goalHistoryLine(minute: number, team: Side, teamName: string, hs: number, as: number): Line {
  return { key: `g${minute}2`, minute, sub: 2, kind: 'goal', team, isGoal: false, scoreH: hs, scoreA: as, text: `Goal — ${teamName} (${hs}-${as})` };
}
