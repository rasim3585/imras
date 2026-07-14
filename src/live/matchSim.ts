// ---------------------------------------------------------------------------
// Deterministic FOOTBALL POSSESSION simulation — a real match model, not random
// atmosphere. One team keeps the ball through a chain of PASSES that progress
// toward goal, then either loses it (turnover → the other team plays out) or
// gets a shot in the final third (→ save / miss / blocked / corner / offside).
// The ball hops from pass to pass like a real broadcast tracker. Goals + red
// cards come from the SERVER (fair, revealed by minute) and interrupt this flow.
//
// Everything is a pure function of (matchId): the same match always plays out
// the same way, and it never encodes a real goal, so it's safe on the client.
// Home attacks RIGHT (x → 100). Coordinates are 0..100.
// ---------------------------------------------------------------------------

export type Side = 'home' | 'away';
export type SimEvType =
  | 'shot' | 'save' | 'miss' | 'blocked' | 'corner' | 'freekick' | 'offside'
  | 'foul' | 'yellow' | 'throwin' | 'goalkick';

export interface Pass { t: number; dur: number; x0: number; y0: number; x1: number; y1: number; team: Side }
export interface SimEvent { key: string; sec: number; minute: number; type: SimEvType; team: Side; x: number; y: number }

const MATCH_SECS = 90 * 60;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const smooth = (t: number) => t * t * (3 - 2 * t);
const other = (s: Side): Side => (s === 'home' ? 'away' : 'home');
const attackDir = (s: Side) => (s === 'home' ? 1 : -1);
const goalX = (s: Side) => (s === 'home' ? 96 : 4);
const inFinalThird = (s: Side, x: number) => (s === 'home' ? x > 70 : x < 30);

function seeded(str: string) {
  let h = 2166136261;
  for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return () => { h = (Math.imul(h, 16807) % 2147483647) >>> 0; return (h % 100000) / 100000; };
}

const SHOT_OUT: [SimEvType, number][] = [
  ['save', 0.26], ['miss', 0.24], ['blocked', 0.18], ['corner', 0.2], ['offside', 0.12],
];
const rollShot = (r: number): SimEvType => { let a = 0; for (const [o, w] of SHOT_OUT) { a += w; if (r < a) return o; } return 'miss'; };

interface Sim { passes: Pass[]; events: SimEvent[] }
const cache = new Map<string, Sim>();

function build(matchId: string): Sim {
  const rng = seeded(`${matchId}:poss`);
  const passes: Pass[] = [];
  const events: SimEvent[] = [];
  let t = 1.5;
  let team: Side = rng() < 0.5 ? 'home' : 'away';
  let x = 50, y = 50;                                   // ball at centre for kick-off
  let ei = 0;

  const addPass = (x1: number, y1: number, dur: number) => {
    passes.push({ t, dur, x0: x, y0: y, x1, y1, team });
    t += dur + 0.12 + rng() * 0.22;                     // brief settle at the receiver
    x = x1; y = y1;
  };
  const ev = (type: SimEvType, ex: number, ey: number) => {
    events.push({ key: `e${ei++}`, sec: Math.round(t), minute: Math.floor(t / 60), type, team, x: clamp(ex, 3, 97), y: clamp(ey, 8, 92) });
  };

  while (t < MATCH_SECS - 4) {
    const dir = attackDir(team);
    const chain = 2 + Math.floor(rng() * 5);            // 2–6 passes this possession
    let shot = false;
    for (let p = 0; p < chain; p++) {
      // advance toward goal with lateral movement (build-up)
      const adv = 5 + rng() * 16;
      const nx = clamp(x + dir * adv, 6, 94);
      const ny = clamp(y + (rng() - 0.5) * 42, 12, 88);
      addPass(nx, ny, 0.55 + rng() * 0.85);
      if (inFinalThird(team, x) && rng() < 0.55) { shot = true; break; }
    }

    // sprinkle a foul / throw-in occasionally between phases
    const spice = rng();
    if (!shot && spice < 0.12) { ev('foul', x, y); if (rng() < 0.3) ev('yellow', x, y); team = other(team); t += 0.6; x = clamp(x, 8, 92); continue; }
    if (!shot && spice < 0.2) { ev('throwin', x, y < 50 ? 12 : 88); }

    if (shot || inFinalThird(team, x)) {
      // a shot on goal → outcome
      const gx = goalX(team);
      addPass(gx, clamp(y + (rng() - 0.5) * 20, 36, 64), 0.34 + rng() * 0.14);   // strike toward goal
      const out = rollShot(rng());
      const spot = eventSpotRaw(team, out, rng);
      ev('shot', spot.x, spot.y);
      ev(out, spot.x, spot.y);
      if (out === 'corner') {                            // corner: ball to the flag, same team keeps
        x = team === 'home' ? 95 : 5; y = rng() < 0.5 ? 12 : 88;
        t += 1.4;
      } else {                                           // cleared → other team restarts from the back
        ev('goalkick', gx, 50);
        team = other(team);
        x = goalX(team) + (team === 'home' ? 10 : -10); y = 50;
        t += 1.6;
      }
    } else {
      // turnover: the other team wins it here and plays out
      team = other(team);
      x = clamp(x + (rng() - 0.5) * 10, 8, 92);
      t += 0.4 + rng() * 0.5;
    }
  }
  const sim = { passes, events };
  cache.set(matchId, sim);
  return sim;
}

function sim(matchId: string): Sim {
  return cache.get(matchId) ?? build(matchId);
}

// Where an event sits on the pitch (corner flag, goal mouth, wide, …).
function eventSpotRaw(team: Side, type: SimEvType, r: () => number): { x: number; y: number } {
  const home = team === 'home';
  switch (type) {
    case 'corner':   return { x: home ? 95 : 5, y: r() < 0.5 ? 12 : 88 };
    case 'save':     return { x: home ? 96 : 4, y: 42 + r() * 16 };
    case 'miss':     return { x: home ? 93 : 7, y: r() < 0.5 ? 16 : 84 };
    case 'blocked':  return { x: home ? 82 : 18, y: 36 + r() * 28 };
    case 'offside':  return { x: home ? 86 : 14, y: 26 + r() * 48 };
    default:         return { x: home ? 84 : 16, y: 40 + r() * 20 };
  }
}

export interface Ball { x: number; y: number; team: Side; moving: boolean }

// Continuous ball position at match-second tSec. Interpolates along the active
// pass (eased, so it accelerates then arrives), and rests at the receiver
// between passes — reads like real ball movement.
export function ballAt(matchId: string, tSec: number): Ball {
  const ps = sim(matchId).passes;
  if (ps.length === 0) return { x: 50, y: 50, team: 'home', moving: false };
  const t = clamp(tSec, 0, MATCH_SECS);
  // binary search: last pass whose start <= t
  let lo = 0, hi = ps.length - 1, idx = 0;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (ps[mid].t <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1; }
  const p = ps[idx];
  if (t <= p.t) return { x: p.x0, y: p.y0, team: p.team, moving: false };
  const e = p.t + p.dur;
  if (t >= e) return { x: p.x1, y: p.y1, team: p.team, moving: false };   // settled at receiver
  const k = smooth((t - p.t) / p.dur);
  // a little arc on the ball's flight
  const arc = Math.sin(k * Math.PI) * Math.min(6, Math.abs(p.x1 - p.x0) * 0.15);
  return { x: p.x0 + (p.x1 - p.x0) * k, y: p.y0 + (p.y1 - p.y0) * k - arc, team: p.team, moving: true };
}

// Discrete events up to `uptoMin` (for badges + the key-moments feed).
export function simEvents(matchId: string, uptoMin: number): SimEvent[] {
  return sim(matchId).events.filter((e) => e.minute <= uptoMin);
}
