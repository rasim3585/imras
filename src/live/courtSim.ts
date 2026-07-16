// ---------------------------------------------------------------------------
// Deterministic basketball POSSESSION simulation on the MATCH clock — the
// CourtTV counterpart of football's matchSim. 48 minutes (2880 sim-seconds)
// play in duration_secs REAL seconds (480 → 6× compression). ONE move/event
// timeline on ONE clock: the ball path, the badge, the play feed and the stats
// all derive from it, so they can never contradict. Each ambient event HOLDS
// the ball ≈2.2 REAL seconds at its spot (miss at the rim, steal where it
// happened, foul on the drive) so the action is legible. Ambient events NEVER
// include a made basket — makes come from the SERVER score (fairness: the
// client must not know the future). Home attacks the RIGHT hoop. Coordinates
// are the 320×200 court viewBox.
// ---------------------------------------------------------------------------

export type Side = 'home' | 'away';
export type PlayType = 'miss' | 'steal' | 'foul' | 'block';

export interface CourtMove { t: number; dur: number; x0: number; y0: number; x1: number; y1: number; side: Side }
export interface CourtEvent { key: string; sec: number; type: PlayType; side: Side; x: number; y: number }

export const BB_TOTAL = 48 * 60;      // 4×12 min in sim-seconds
// Court geometry shared with the SVG in CourtTV — hoops at (20,100)/(300,100),
// three-point arc radius and free-throw-line distance FROM the hoop. Shots must
// visibly launch from the correct side of the line.
export const BB_R3 = 74;
export const BB_FT = 36;
const HOLD_REAL = 2.2;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const smooth = (t: number) => t * t * (3 - 2 * t);
const other = (s: Side): Side => (s === 'home' ? 'away' : 'home');

function seeded(str: string) {
  let h = 2166136261;
  for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return () => { h = (Math.imul(h, 16807) % 2147483647) >>> 0; return (h % 100000) / 100000; };
}

// ≈2.2 real seconds expressed in sim-seconds at this match's compression.
export function bbHoldSec(dur: number): number {
  return clamp(HOLD_REAL * (BB_TOTAL / (dur > 0 ? dur : 480)), 3, 90);
}

interface CSim { moves: CourtMove[]; events: CourtEvent[]; holdSec: number }
const cache = new Map<string, CSim>();

function build(matchId: string, dur: number): CSim {
  const rng = seeded(`${matchId}:court`);
  const holdSec = bbHoldSec(dur);
  const moves: CourtMove[] = [];
  const events: CourtEvent[] = [];
  let t = 2, x = 160, y = 100, ei = 0;
  let side: Side = rng() < 0.5 ? 'home' : 'away';
  const mv = (x1: number, y1: number, d: number, sd: Side) => {
    x1 = clamp(x1, 14, 306); y1 = clamp(y1, 24, 176);
    moves.push({ t, dur: d, x0: x, y0: y, x1, y1, side: sd });
    t += d; x = x1; y = y1;
  };
  while (t < BB_TOTAL - 40) {
    const hoopX = side === 'home' ? 300 : 20;
    const dir = side === 'home' ? 1 : -1;
    // bring-up, then swing it around the arc
    mv(160 + dir * 60, 60 + rng() * 80, 5 + rng() * 3, side);
    const swings = 1 + Math.floor(rng() * 2);
    for (let i = 0; i < swings; i++) mv(hoopX - dir * (40 + rng() * 60), 40 + rng() * 120, 4 + rng() * 3, side);
    const r = rng();
    if (r < 0.46) {
      // shot attempt: ~1/3 launch from THREE-point range (outside the arc), the
      // rest from inside it — the ball visibly leaves the correct zone
      const three = rng() < 0.34;
      const ang = (rng() * 2 - 1) * (three ? 0.95 : 1.15);
      const rad = three ? BB_R3 + 6 + rng() * 12 : 16 + rng() * 40;
      mv(hoopX - dir * Math.cos(ang) * rad, 100 + Math.sin(ang) * rad, 3 + rng() * 2, side);
      mv(hoopX, 100, three ? 2.8 : 2.2, side);
      if (rng() < 0.5) { events.push({ key: `b${ei++}`, sec: t, type: 'miss', side, x: hoopX, y: 100 }); t += holdSec; }
      side = other(side);
      mv(hoopX - dir * (26 + rng() * 12), 76 + rng() * 48, 2.6, side);      // board cleared, play out
    } else if (r < 0.62) {
      // picked off in the half-court — the STEALER is the event side
      mv(120 + rng() * 80, 50 + rng() * 100, 3 + rng() * 2, side);
      side = other(side);
      events.push({ key: `b${ei++}`, sec: t, type: 'steal', side, x, y });
      t += holdSec;
    } else if (r < 0.78) {
      // defence fouls the drive — event side = team fouled (keeps the ball)
      mv(hoopX - dir * (30 + rng() * 70), 45 + rng() * 110, 3 + rng() * 2, side);
      events.push({ key: `b${ei++}`, sec: t, type: 'foul', side, x, y });
      t += holdSec;
    } else if (r < 0.86) {
      // swatted at the rim — blocker is the event side, takes possession
      mv(hoopX - dir * (14 + rng() * 14), 72 + rng() * 56, 3 + rng() * 2, side);
      events.push({ key: `b${ei++}`, sec: t, type: 'block', side: other(side), x, y });
      t += holdSec;
      side = other(side);
    } else {
      // clean look at the rim (whether points landed is the SERVER's story)
      mv(hoopX - dir * 10, 90 + rng() * 20, 2.5 + rng() * 1.5, side);
      side = other(side);
    }
  }
  // run the clock out — the path must cover the FULL game (football lesson:
  // an exhausted path = ball frozen at the last event spot until the buzzer)
  while (t < BB_TOTAL - 3) {
    mv(120 + rng() * 80, 60 + rng() * 80, 4 + rng() * 3, side);
    t += 0.5;
    if (rng() < 0.25) side = other(side);
  }
  const s = { moves, events, holdSec };
  // bellek tavanı: uzun oturumda gezinen her maç kalıcı birikmesin
  if (cache.size > 40) { const first = cache.keys().next().value; if (first) cache.delete(first); }
  cache.set(`${matchId}:${dur}`, s);
  return s;
}

function sim(matchId: string, dur: number): CSim {
  return cache.get(`${matchId}:${dur}`) ?? build(matchId, dur);
}

export interface CourtBall { x: number; y: number; side: Side; moving: boolean }

// Continuous ball position at match-second tSec (binary search over moves,
// eased, small arc). Rests wherever the last move ended — which during an event
// window is exactly the event spot, because build() paused the timeline there.
export function courtBallAt(matchId: string, tSec: number, dur: number): CourtBall {
  const ms = sim(matchId, dur).moves;
  if (ms.length === 0) return { x: 160, y: 100, side: 'home', moving: false };
  const t = clamp(tSec, 0, BB_TOTAL);
  let lo = 0, hi = ms.length - 1, idx = 0;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (ms[mid].t <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1; }
  const p = ms[idx];
  if (t <= p.t) return { x: p.x0, y: p.y0, side: p.side, moving: false };
  const e = p.t + p.dur;
  if (t >= e) return { x: p.x1, y: p.y1, side: p.side, moving: false };
  const k = smooth((t - p.t) / p.dur);
  const arc = Math.sin(k * Math.PI) * Math.min(9, Math.abs(p.x1 - p.x0) * 0.10);
  return { x: p.x0 + (p.x1 - p.x0) * k, y: p.y0 + (p.y1 - p.y0) * k - arc, side: p.side, moving: true };
}

// The event the ball is currently resting on (badge window = ball hold window).
export function activeCourtEvent(matchId: string, tSec: number, dur: number): CourtEvent | null {
  const s = sim(matchId, dur);
  for (const e of s.events) if (tSec >= e.sec && tSec < e.sec + s.holdSec) return e;
  return null;
}

// Play-by-play feed: exactly the events the court holds, revealed by the clock.
export function courtFeed(matchId: string, uptoSec: number, dur: number): CourtEvent[] {
  return sim(matchId, dur).events.filter((e) => e.sec <= uptoSec);
}

export interface CourtStats {
  fgPct: [number, number]; rebounds: [number, number]; turnovers: [number, number]; fouls: [number, number];
}

// Stats from the SAME event list on the SAME clock; makes estimated from the
// REAL server score (≈2.2 pts per make) so FG% moves with the actual game.
export function courtStats(matchId: string, uptoSec: number, dur: number, hs: number, as: number): CourtStats {
  const s = sim(matchId, dur);
  const i = (sd: Side) => (sd === 'home' ? 0 : 1);
  const miss: [number, number] = [0, 0], to: [number, number] = [0, 0], fl: [number, number] = [0, 0];
  for (const e of s.events) {
    if (e.sec > uptoSec) continue;
    if (e.type === 'miss') miss[i(e.side)]++;
    else if (e.type === 'steal') to[i(other(e.side))]++;      // turnover charged to the robbed side
    else if (e.type === 'foul') fl[i(other(e.side))]++;       // committed by the defence
    else if (e.type === 'block') miss[i(other(e.side))]++;    // a blocked shot is a missed attempt
  }
  const mk: [number, number] = [Math.max(0, Math.round(hs / 2.2)), Math.max(0, Math.round(as / 2.2))];
  const att: [number, number] = [mk[0] + miss[0], mk[1] + miss[1]];
  const pct = (m: number, a: number) => (a === 0 ? 0 : Math.round((100 * m) / a));
  return {
    fgPct: [pct(mk[0], att[0]), pct(mk[1], att[1])],
    rebounds: [miss[1], miss[0]],                             // defensive boards off opponent misses
    turnovers: to,
    fouls: fl,
  };
}
