// Championship-Manager-style text commentary. Deterministic per match (seeded
// by match id) so re-watching reads the same, and PURELY presentational for the
// atmosphere (attacks, misses, corners, fouls, calm). Goals come from the server
// (score-authoritative) and get a build-up burst; red cards come from the server
// too (they move the odds) and get a line here.

export type LineKind =
  | 'buildup' | 'shot' | 'goal' | 'miss' | 'corner' | 'foul' | 'freekick'
  | 'chance' | 'calm' | 'card' | 'mark';

export interface Line {
  key: string;
  minute: number;
  sub: number;
  kind: LineKind;
  team?: 'home' | 'away';
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
const pickFrom = (rng: () => number, arr: string[]) => arr[Math.floor(rng() * arr.length)];

const BUILDUP = [
  '{T} push forward', '{T} work it out wide', '{T} break at pace',
  '{T} string the passes together', '{T} win it back and surge on',
  '{T} switch play and drive in',
];
const SHOT = ['the shot…', 'he lines it up…', 'space opens for the shot…', 'first-time effort…'];
const MISS = [
  '…just wide of the post!', '…over the bar!', '…straight at the keeper!',
  '…and the goalkeeper saves it!', '…off the woodwork!', '…blocked at the last moment!',
];
const CORNER = ['…deflected behind. Corner.', '…scrambled clear. Corner.'];
const FOUL = ['Foul in midfield. Free-kick {T}.', 'A cynical foul stops {T}… free-kick.'];
const FREEKICK = ['Dangerous free-kick for {T} in a great spot…', '{T} win a free-kick on the edge of the box…'];
const CHANCE = ['Half-chance for {T}, but it fizzles out.', '{T} threaten, nothing comes of it.'];
const CALM = [
  'Midfield battle, no way through.', '{T} keep possession patiently.',
  'A scrappy spell of play.', 'Both sides feeling each other out.',
  'The tempo drops for a moment.', '{T} probe for an opening.',
];

const T = (s: string, team: 'home' | 'away', home: string, away: string) =>
  s.replace('{T}', team === 'home' ? home : away);

/** Deterministic non-goal, non-card atmosphere across the match. */
export function atmosphereScript(matchId: string, home: string, away: string): Line[] {
  const rng = seeded(`${matchId}:cm`);
  const lines: Line[] = [];
  let minute = 3 + Math.floor(rng() * 5);
  while (minute <= 87) {
    const team: 'home' | 'away' = rng() < 0.5 ? 'home' : 'away';
    const roll = rng();
    const push = (sub: number, kind: LineKind, text: string) =>
      lines.push({ key: `a${minute}s${sub}`, minute, sub, kind, team, text: T(text, team, home, away) });

    if (roll < 0.42) {                         // attack chain -> shot -> outcome
      push(0, 'buildup', pickFrom(rng, BUILDUP));
      push(1, 'shot', pickFrom(rng, SHOT));
      push(2, rng() < 0.35 ? 'corner' : 'miss', rng() < 0.35 ? pickFrom(rng, CORNER) : pickFrom(rng, MISS));
    } else if (roll < 0.56) {                  // free-kick chain
      push(0, 'freekick', pickFrom(rng, FREEKICK));
      push(1, 'shot', pickFrom(rng, SHOT));
      push(2, 'miss', pickFrom(rng, MISS));
    } else if (roll < 0.70) {                  // foul
      push(0, 'foul', pickFrom(rng, FOUL));
    } else if (roll < 0.80) {                  // half-chance
      push(0, 'chance', pickFrom(rng, CHANCE));
    } else {                                   // calm beat
      push(0, 'calm', pickFrom(rng, CALM));
    }
    minute += 4 + Math.floor(rng() * 7);
  }
  return lines.sort((a, b) => a.minute - b.minute || a.sub - b.sub);
}

/** A goal's build-up burst: attack → shot → GOAL. */
export function goalBurst(
  matchId: string, minute: number, team: 'home' | 'away',
  home: string, away: string, hs: number, as: number, penalty: boolean,
): Line[] {
  const rng = seeded(`${matchId}:g${minute}`);
  const tName = team === 'home' ? home : away;
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
    { key: `g${minute}0`, minute, sub: 0, kind: 'buildup', team, text: T(pickFrom(rng, BUILDUP), team, home, away) },
    { key: `g${minute}1`, minute, sub: 1, kind: 'shot', team, text: pickFrom(rng, SHOT) },
    { ...goal, text: `GOOOAL! ${tName} make it ${score}` },
  ];
}

export function cardLine(minute: number, team: 'home' | 'away', teamName: string): Line {
  return { key: `c${minute}${team}`, minute, sub: 3, kind: 'card', team, text: `RED CARD! ${teamName} are down to ten men.` };
}

/** A plain history line for goals that already happened before the user joined. */
export function goalHistoryLine(minute: number, team: 'home' | 'away', teamName: string, hs: number, as: number): Line {
  return { key: `g${minute}2`, minute, sub: 2, kind: 'goal', team, isGoal: false, scoreH: hs, scoreA: as, text: `Goal — ${teamName} (${hs}-${as})` };
}
