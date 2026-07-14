// ---------------------------------------------------------------------------
// Deterministic, FAIR football match simulation — the single source of truth for
// the live-watch screen. Everything ambient (the ball path, attacks, shots,
// saves, corners, fouls, yellow cards, subs) is a PURE function of (matchId,
// clock). It never encodes a real goal, so it can be computed on the client
// without the hidden future — live betting stays fair. Real GOALS and RED cards
// come from the server (get_live_state) and are merged on top.
//
// The whole picture derives from ONE list of attack "waves": the ball, the
// commentary, the events and the stats all read the same waves, so they can
// never contradict (no "save" one second before a "goal", no shot with the ball
// in midfield). Home attacks to the RIGHT (x → 100), away to the LEFT (x → 0).
// ---------------------------------------------------------------------------

export type Side = 'home' | 'away';

function seeded(str: string) {
  let h = 2166136261;
  for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return () => { h = (Math.imul(h, 16807) % 2147483647) >>> 0; return (h % 100000) / 100000; };
}

const MATCH_SECS = 90 * 60; // simulated seconds across the 90'
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const smooth = (t: number) => t * t * (3 - 2 * t); // smoothstep

// ---- attack waves ---------------------------------------------------------

export type WaveOutcome = 'save' | 'miss' | 'blocked' | 'corner' | 'freekick' | 'offside' | 'fade';

export interface Wave {
  start: number;  // seconds
  peak: number;   // seconds — the shot / final ball moment
  end: number;    // seconds
  side: Side;
  outcome: WaveOutcome;
}

const OUTCOMES: [WaveOutcome, number][] = [
  ['save', 0.24], ['miss', 0.22], ['blocked', 0.14],
  ['corner', 0.16], ['freekick', 0.12], ['offside', 0.06], ['fade', 0.06],
];
function rollOutcome(r: number): WaveOutcome {
  let acc = 0;
  for (const [o, w] of OUTCOMES) { acc += w; if (r < acc) return o; }
  return 'fade';
}

// A stable, memoised wave list per match.
const waveCache = new Map<string, Wave[]>();
export function waves(matchId: string): Wave[] {
  const hit = waveCache.get(matchId);
  if (hit) return hit;
  const rng = seeded(`${matchId}:waves`);
  const out: Wave[] = [];
  let t = 20 + rng() * 25;
  // slight home advantage in who carries play
  while (t < MATCH_SECS - 30) {
    const dur = 11 + rng() * 12;          // 11–23s attack
    const side: Side = rng() < 0.52 ? 'home' : 'away';
    const peak = t + dur * (0.5 + rng() * 0.2);
    out.push({ start: t, peak, end: t + dur, side, outcome: rollOutcome(rng()) });
    t += dur + 14 + rng() * 28;            // gap 14–42s between attacks (livelier)
  }
  waveCache.set(matchId, out);
  return out;
}

// The box the given side attacks toward (home → right).
const boxX = (s: Side) => (s === 'home' ? 86 : 14);

// A smooth deterministic 1-D noise in [-1,1], continuous in t.
function noise(seed: string, t: number): number {
  const rng = (n: number) => { const r = seeded(`${seed}:${n}`); return r() * 2 - 1; };
  const i = Math.floor(t), f = t - i;
  return rng(i) * (1 - smooth(f)) + rng(i + 1) * smooth(f);
}

export interface Flow { x: number; y: number; side: Side | 'mid'; intensity: number }

// Continuous ball position + who is attacking, at clock `tSec`. This is what the
// pitch animates every frame.
export function flowAt(matchId: string, tSec: number): Flow {
  const t = clamp(tSec, 0, MATCH_SECS);
  const active = waves(matchId).find((w) => t >= w.start && t <= w.end);
  const ny = noise(`${matchId}:y`, t / 7) * 26;
  if (!active) {
    // between attacks the play still ROAMS the whole pitch (not stuck centre):
    // a slow wander across most of the width, so it always feels alive
    const x = 50 + noise(`${matchId}:x`, t / 8) * 36;              // ~[14,86]
    const xc = clamp(x, 9, 91);
    const side: Side | 'mid' = xc > 61 ? 'home' : xc < 39 ? 'away' : 'mid';
    return { x: xc, y: clamp(50 + ny, 13, 87), side, intensity: 0.35 };
  }
  const tx = boxX(active.side);
  // travel: mid → box by the peak, then recede toward mid by the end
  let x: number, intensity: number;
  if (t <= active.peak) {
    const p = smooth((t - active.start) / Math.max(1, active.peak - active.start));
    x = 50 + (tx - 50) * p;
    intensity = 0.4 + 0.6 * p;
  } else {
    const p = smooth((t - active.peak) / Math.max(1, active.end - active.peak));
    const backTo = active.outcome === 'corner' ? tx : 50;
    x = tx + (backTo - tx) * p * (active.outcome === 'corner' ? 0 : 1);
    intensity = 1 - 0.6 * p;
  }
  const wideY = 50 + ny * (0.6 + 0.4 * Math.abs(x - 50) / 40);
  return { x: clamp(x, 4, 96), y: clamp(wideY, 10, 90), side: active.side, intensity };
}

// Where each event actually happens on the pitch, so the ball is AT the corner
// flag on a corner, at the goal mouth on a save, wide on a miss, etc. Home
// attacks the RIGHT goal. Returns 0..100 coords matching flowAt.
export function eventPos(matchId: string, ev: SimEvent): { x: number; y: number } {
  const r = seeded(`${matchId}:ep${ev.sec}`);
  const home = ev.side === 'home';
  switch (ev.type) {
    case 'corner':   return { x: home ? 93 : 7, y: r() < 0.5 ? 15 : 85 };        // corner flag
    case 'save':     return { x: home ? 95 : 5, y: 42 + r() * 16 };              // keeper at goal
    case 'miss':     return { x: home ? 91 : 9, y: r() < 0.5 ? 18 : 82 };        // dragged wide
    case 'blocked':  return { x: home ? 80 : 20, y: 38 + r() * 24 };
    case 'freekick': return { x: home ? 68 : 32, y: 26 + r() * 48 };
    case 'offside':  return { x: home ? 84 : 16, y: 28 + r() * 44 };
    case 'shot':     return { x: home ? 82 : 18, y: 40 + r() * 20 };
    default: { const f = flowAt(matchId, ev.sec); return { x: f.x, y: f.y }; }   // foul/yellow/sub: where play was
  }
}

// ---- discrete events (ambient) --------------------------------------------

export type EvType =
  | 'shot' | 'save' | 'miss' | 'blocked' | 'corner' | 'freekick' | 'offside'
  | 'foul' | 'yellow' | 'sub' | 'goal' | 'red';

export interface SimEvent {
  key: string; minute: number; sec: number; type: EvType; side: Side;
}

// Events that come straight out of the wave peaks (a shot + its outcome), plus a
// sparse independent schedule of fouls/yellows/subs. All deterministic.
const waveEvents = (matchId: string): SimEvent[] => {
  const out: SimEvent[] = [];
  for (const w of waves(matchId)) {
    const min = Math.floor(w.peak / 60);
    out.push({ key: `w${Math.round(w.peak)}s`, minute: min, sec: Math.round(w.peak), type: 'shot', side: w.side });
    const t: EvType | null =
      w.outcome === 'save' ? 'save' : w.outcome === 'miss' ? 'miss'
      : w.outcome === 'blocked' ? 'blocked' : w.outcome === 'corner' ? 'corner'
      : w.outcome === 'freekick' ? 'freekick' : w.outcome === 'offside' ? 'offside' : null;
    if (t) out.push({ key: `w${Math.round(w.peak)}o`, minute: min, sec: Math.round(w.peak) + 1, type: t, side: w.side });
  }
  return out;
};

export const disciplineEventsFor = (matchId: string): SimEvent[] => {
  const rng = seeded(`${matchId}:disc`);
  const out: SimEvent[] = [];
  let t = 180 + rng() * 300;
  while (t < MATCH_SECS - 60) {
    const side: Side = rng() < 0.5 ? 'home' : 'away';
    const min = Math.floor(t / 60);
    out.push({ key: `f${Math.round(t)}`, minute: min, sec: Math.round(t), type: 'foul', side });
    if (rng() < 0.35) out.push({ key: `y${Math.round(t)}`, minute: min, sec: Math.round(t) + 2, type: 'yellow', side });
    t += 240 + rng() * 360;
  }
  // a couple of substitutions in the last third
  const subs = 1 + (rng() < 0.6 ? 1 : 0);
  for (let i = 0; i < subs; i++) {
    const min = 60 + Math.floor(rng() * 28);
    out.push({ key: `s${min}${i}`, minute: min, sec: min * 60, type: 'sub', side: rng() < 0.5 ? 'home' : 'away' });
  }
  return out;
};

// All ambient events up to `uptoMin` (inclusive), chronological.
export function ambientEvents(matchId: string, uptoMin: number): SimEvent[] {
  return [...waveEvents(matchId), ...disciplineEventsFor(matchId)]
    .filter((e) => e.minute <= uptoMin)
    .sort((a, b) => a.sec - b.sec);
}

// ---- live stats -----------------------------------------------------------

export interface LiveStats {
  possession: [number, number];   // %, sums to 100
  shots: [number, number];
  onTarget: [number, number];
  corners: [number, number];
  fouls: [number, number];
  yellows: [number, number];
  reds: [number, number];
}

const add = (p: [number, number], side: Side, n = 1): void => { p[side === 'home' ? 0 : 1] += n; };

// Deterministic cumulative match stats up to `uptoMin`. Reds come from the
// server (they move the odds); everything else is ambient-but-consistent.
export function statsAt(matchId: string, uptoMin: number, reds: [number, number]): LiveStats {
  const s: LiveStats = {
    possession: [50, 50], shots: [0, 0], onTarget: [0, 0], corners: [0, 0],
    fouls: [0, 0], yellows: [0, 0], reds,
  };
  const upSec = uptoMin * 60;
  let homeSec = 0, awaySec = 0;
  for (const w of waves(matchId)) {
    if (w.peak > upSec) continue;
    const dur = w.end - w.start;
    if (w.side === 'home') homeSec += dur; else awaySec += dur;
    add(s.shots, w.side);
    if (w.outcome === 'save') add(s.onTarget, w.side);
    if (w.outcome === 'corner') { add(s.corners, w.side); add(s.onTarget, w.side); }
  }
  for (const e of disciplineEventsFor(matchId)) {
    if (e.minute > uptoMin) continue;
    if (e.type === 'foul') add(s.fouls, e.side);
    if (e.type === 'yellow') add(s.yellows, e.side);
  }
  const tot = homeSec + awaySec;
  if (tot > 0) {
    // blend wave-possession with a neutral midfield baseline
    const hp = Math.round(38 + 24 * (homeSec / tot));
    s.possession = [hp, 100 - hp];
  }
  return s;
}
