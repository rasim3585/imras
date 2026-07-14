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

// The match is compressed: 90' (5400 sim-seconds) plays in `dur` REAL seconds, so
// getClock advances 5400/dur sim-seconds per real second. A pause the viewer reads
// as "≈2 seconds" is HOLD_REAL real-seconds = HOLD_REAL*(5400/dur) SIM-seconds.
// The ball's hold at an event, the badge window AND the spacing between events are
// ALL derived from this one number — so they share getClock and stay locked (no
// second real-ms clock that drifts out of sync with the ball).
const HOLD_REAL = 2.2;
export function holdSecFor(dur: number): number {
  return clamp(HOLD_REAL * (5400 / (dur > 0 ? dur : 480)), 6, 40);
}

function seeded(str: string) {
  let h = 2166136261;
  for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return () => { h = (Math.imul(h, 16807) % 2147483647) >>> 0; return (h % 100000) / 100000; };
}

interface Sim { passes: Pass[]; events: SimEvent[]; holdSec: number }
const cache = new Map<string, Sim>();

// Realistic per-90-minutes event budget PER TEAM. Kept low on purpose: a real
// match is mostly midfield play with occasional events — not constant action.
// (corner ~4–6, shots on target/off/blocked ~8–13, fouls ~7–12, so both teams
//  combined land near real totals: ~10 corners, ~22 shots, ~22 fouls.)
function build(matchId: string, dur: number): Sim {
  const rng = seeded(`${matchId}:sim`);
  const holdSec = holdSecFor(dur);
  const raw: SimEvent[] = [];
  let ei = 0;
  const addEv = (type: SimEvType, team: Side, minute: number) => {
    const s = eventSpotRaw(team, type, rng);
    raw.push({ key: `e${ei++}`, minute, sec: minute * 60 + Math.floor(rng() * 55), type, team, x: s.x, y: s.y });
  };
  const spread = (n: number, type: SimEvType, team: Side) => { for (let i = 0; i < n; i++) addEv(type, team, 2 + Math.floor(rng() * 86)); };
  for (const team of ['home', 'away'] as Side[]) {
    spread(3 + Math.floor(rng() * 3), 'corner', team);
    spread(3 + Math.floor(rng() * 4), 'save', team);
    spread(3 + Math.floor(rng() * 4), 'miss', team);
    spread(2 + Math.floor(rng() * 3), 'blocked', team);
    spread(1 + Math.floor(rng() * 2), 'offside', team);
    spread(6 + Math.floor(rng() * 5), 'foul', team);
    if (rng() < 0.75) spread(1 + Math.floor(rng() * 2), 'yellow', team);
    spread(3 + Math.floor(rng() * 4), 'goalkick', team);
  }
  raw.sort((a, b) => a.sec - b.sec);

  // Space the events out: once an action fires, the next one can't start until the
  // ball has finished its hold AND had a short breather — so no event ever cuts a
  // hold short, and the pitch is never frantic. (Rasim: after a corner/foul/etc.,
  // ~2s pass with nothing else happening.) Events too close are dropped.
  const gap = holdSec + 8;
  const events: SimEvent[] = [];
  let lastSec = -1e9;
  for (const e of raw) { if (e.sec - lastSec < gap) continue; events.push(e); lastSec = e.sec; }

  // Ball path: wander midfield, arrive AT each event's spot on its clock, then
  // REST there for `holdSec` sim-seconds (= ≈2 real seconds at this match's
  // compression). The badge window in PitchTV uses the same holdSec on the same
  // getClock, so ball and label are physically locked together.
  const passes: Pass[] = [];
  let t = 1.5, x = 50, y = 50;
  let team: Side = rng() < 0.5 ? 'home' : 'away';
  const addPass = (x1: number, y1: number, d: number, tm: Side) => {
    passes.push({ t, dur: d, x0: x, y0: y, x1: clamp(x1, 4, 96), y1: clamp(y1, 8, 92), team: tm });
    t += d; x = clamp(x1, 4, 96); y = clamp(y1, 8, 92);
  };
  for (const e of events) {
    // fill the gap up to the event with unhurried midfield passing (slow, ~1/3
    // pace: long passes so the ball drifts calmly rather than darting)
    while (e.sec - t > 12) {
      if (rng() < 0.3) team = other(team);                     // possession changes hands
      const wx = 40 + rng() * 20 + (e.x - 50) * 0.12;          // drift gently toward the event zone
      const wy = 22 + rng() * 56;
      addPass(wx, wy, 4.5 + rng() * 4, team);
      t += 0.7;                                                // settle at the receiver
    }
    // approach and arrive at the event spot exactly on its clock, event team leads
    team = e.team;
    if (e.sec - t > 5) addPass(x + (e.x - x) * 0.5, y + (e.y - y) * 0.5, (e.sec - t) * 0.5, team);
    addPass(e.x, e.y, Math.max(1, Math.min(4.5, e.sec - t)), team);
    t = e.sec + holdSec;                                       // HOLD on the spot ≈2 real seconds
    // restart from the spot
    const rx = e.type === 'corner' ? e.x : clamp(e.x + (e.team === 'home' ? -9 : 9), 6, 94);
    passes.push({ t, dur: 1.8, x0: e.x, y0: e.y, x1: rx, y1: 50, team: e.team });
    t += 1.8; x = rx; y = 50;
  }
  const s = { passes, events, holdSec };
  cache.set(`${matchId}:${dur}`, s);
  return s;
}

function sim(matchId: string, dur: number): Sim {
  return cache.get(`${matchId}:${dur}`) ?? build(matchId, dur);
}

// Where an event sits on the pitch — home attacks RIGHT (its goal is on the LEFT).
function eventSpotRaw(team: Side, type: SimEvType, r: () => number): { x: number; y: number } {
  const home = team === 'home';
  switch (type) {
    case 'corner':   return { x: home ? 97 : 3, y: r() < 0.5 ? 9 : 91 };     // corner flag
    case 'save':     return { x: home ? 95 : 5, y: 42 + r() * 16 };          // shot at the goal mouth
    case 'miss':     return { x: home ? 92 : 8, y: r() < 0.5 ? 13 : 87 };    // dragged wide
    case 'blocked':  return { x: home ? 80 : 20, y: 36 + r() * 28 };
    case 'offside':  return { x: home ? 85 : 15, y: 26 + r() * 48 };
    case 'goalkick': return { x: home ? 8 : 92, y: 50 };                     // OWN keeper's area
    case 'foul':     return { x: 24 + r() * 52, y: 14 + r() * 72 };          // wherever it happened
    default:         return { x: home ? 82 : 18, y: 40 + r() * 20 };
  }
}

export interface Ball { x: number; y: number; team: Side; moving: boolean }

// Continuous ball position at match-second tSec. Interpolates along the active
// pass (eased, so it accelerates then arrives), and rests at the receiver
// between passes — reads like real ball movement.
export function ballAt(matchId: string, tSec: number, dur: number): Ball {
  const ps = sim(matchId, dur).passes;
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

// Discrete events up to `uptoMin` (for the key-moments feed). Already spaced, so
// the feed shows exactly the events the pitch holds — never more, never fewer.
export function simEvents(matchId: string, uptoMin: number, dur: number): SimEvent[] {
  return sim(matchId, dur).events.filter((e) => e.minute <= uptoMin);
}

// The event the ball is currently RESTING on (clock within [sec, sec+holdSec]),
// or null. PitchTV drives the badge off this — same getClock, same holdSec as the
// ball's rest, so the label shows exactly while the ball sits on the spot.
export function activeEvent(matchId: string, tSec: number, dur: number): SimEvent | null {
  const s = sim(matchId, dur);
  for (const e of s.events) if (tSec >= e.sec && tSec < e.sec + s.holdSec) return e;
  return null;
}

export interface SimStats {
  possession: [number, number]; shots: [number, number]; onTarget: [number, number];
  corners: [number, number]; fouls: [number, number]; yellows: [number, number]; reds: [number, number];
}
// Match stats derived from the SAME possession sim, so they agree with the ball
// and the feed (and are realistically asymmetric — not a mirror 10/10).
export function simStats(matchId: string, uptoMin: number, reds: [number, number], dur: number): SimStats {
  const s = sim(matchId, dur);
  const sh: [number, number] = [0, 0], ot: [number, number] = [0, 0], co: [number, number] = [0, 0];
  const fo: [number, number] = [0, 0], ye: [number, number] = [0, 0];
  const i = (t: Side) => (t === 'home' ? 0 : 1);
  for (const e of s.events) {
    if (e.minute > uptoMin) continue;
    if (e.type === 'shot') sh[i(e.team)]++;
    else if (e.type === 'save') ot[i(e.team)]++;
    else if (e.type === 'corner') { co[i(e.team)]++; ot[i(e.team)]++; }
    else if (e.type === 'foul') fo[i(e.team)]++;
    else if (e.type === 'yellow') ye[i(e.team)]++;
  }
  let hp = 0, ap = 0;
  for (const p of s.passes) { if (p.t / 60 > uptoMin) break; if (p.team === 'home') hp += p.dur; else ap += p.dur; }
  const tot = hp + ap;
  const hpc = tot > 0 ? Math.round((100 * hp) / tot) : 50;
  return { possession: [hpc, 100 - hpc], shots: sh, onTarget: ot, corners: co, fouls: fo, yellows: ye, reds };
}
