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

function seeded(str: string) {
  let h = 2166136261;
  for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return () => { h = (Math.imul(h, 16807) % 2147483647) >>> 0; return (h % 100000) / 100000; };
}

interface Sim { passes: Pass[]; events: SimEvent[] }
const cache = new Map<string, Sim>();

// Realistic per-90-minutes event budget PER TEAM. Kept low on purpose: a real
// match is mostly midfield play with occasional events — not constant action.
// (corner ~4–6, shots on target/off/blocked ~8–13, fouls ~7–12, so both teams
//  combined land near real totals: ~10 corners, ~22 shots, ~22 fouls.)
function build(matchId: string): Sim {
  const rng = seeded(`${matchId}:sim`);
  const events: SimEvent[] = [];
  let ei = 0;
  const addEv = (type: SimEvType, team: Side, minute: number) => {
    const s = eventSpotRaw(team, type, rng);
    events.push({ key: `e${ei++}`, minute, sec: minute * 60 + Math.floor(rng() * 55), type, team, x: s.x, y: s.y });
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
  events.sort((a, b) => a.sec - b.sec);

  // Build a calm ball path (passes) that wanders midfield and arrives AT each
  // event's spot right on its clock. Passes are ~1.6–3s, so the ball moves at a
  // watchable pace — no frantic action.
  const passes: Pass[] = [];
  let t = 1.5, x = 50, y = 50;
  let team: Side = rng() < 0.5 ? 'home' : 'away';
  const addPass = (x1: number, y1: number, dur: number, tm: Side) => {
    passes.push({ t, dur, x0: x, y0: y, x1: clamp(x1, 4, 96), y1: clamp(y1, 8, 92), team: tm });
    t += dur; x = clamp(x1, 4, 96); y = clamp(y1, 8, 92);
  };
  for (const e of events) {
    // fill the gap up to the event with unhurried midfield passing
    while (e.sec - t > 6) {
      if (rng() < 0.3) team = other(team);                     // possession changes hands
      const wx = 38 + rng() * 24 + (e.x - 50) * 0.15;          // drift gently toward the event zone
      const wy = 18 + rng() * 64;
      addPass(wx, wy, 1.5 + rng() * 1.5, team);
      t += 0.3;                                                // settle at the receiver
    }
    // approach and arrive at the event spot exactly on its clock, event team leads
    team = e.team;
    if (e.sec - t > 2.4) addPass(x + (e.x - x) * 0.5, y + (e.y - y) * 0.5, (e.sec - t) * 0.5, team);
    addPass(e.x, e.y, Math.max(0.4, Math.min(1.4, e.sec - t)), team);
    t = e.sec + 1.1;                                           // brief pause on the event
    // restart from the spot
    const rx = e.type === 'corner' ? e.x : clamp(e.x + (e.team === 'home' ? -9 : 9), 6, 94);
    passes.push({ t, dur: 0.6, x0: e.x, y0: e.y, x1: rx, y1: 50, team: e.team });
    t += 0.6; x = rx; y = 50;
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

export interface SimStats {
  possession: [number, number]; shots: [number, number]; onTarget: [number, number];
  corners: [number, number]; fouls: [number, number]; yellows: [number, number]; reds: [number, number];
}
// Match stats derived from the SAME possession sim, so they agree with the ball
// and the feed (and are realistically asymmetric — not a mirror 10/10).
export function simStats(matchId: string, uptoMin: number, reds: [number, number]): SimStats {
  const s = sim(matchId);
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
