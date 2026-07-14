// Deterministic tennis/volleyball rally + scoreboard atmosphere. The backend
// only knows SETS won (home_score/away_score) — the settle is set-based. Games
// and points below are PRESENTATIONAL: a believable in-progress game/point
// ladder derived from time, reset whenever the server's set count changes. The
// ball rallies across the net (rAF) instead of teleporting. 320×200 viewBox.

export type Side = 'home' | 'away';

function seeded(str: string) {
  let h = 2166136261;
  for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return () => { h = (Math.imul(h, 16807) % 2147483647) >>> 0; return (h % 100000) / 100000; };
}
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const RALLY_SECS = 6.5;          // one point ≈ a short rally
const POINT_MAP = ['0', '15', '30', '40'];

export interface TennisFlow { x: number; y: number; server: Side; hitting: Side }

// Ball rallying across the net. Home baseline right (x≈300), away left (x≈20);
// net at x=160. The ball crosses the net every ~1s within a rally.
export function tennisFlowAt(matchId: string, tSec: number): TennisFlow {
  const gameIdx = Math.floor(tSec / (RALLY_SECS * 4));
  const server: Side = gameIdx % 2 === 0 ? 'home' : 'away';
  const rallyIdx = Math.floor(tSec / RALLY_SECS);
  const inRally = tSec % RALLY_SECS;
  const active = RALLY_SECS * 0.66;              // rally happens; the rest = point over (ball dead)
  if (inRally > active) {
    // point scored → ball settles dead at the winner's baseline (no perpetual motion)
    const winRight = seeded(`${matchId}:pw${rallyIdx}`)() < 0.5;
    return { x: winRight ? 292 : 28, y: 100, server, hitting: server };
  }
  const stroke = RALLY_SECS / 4;
  const strokes = Math.floor(tSec / stroke);     // ~4 strokes per rally
  const hitting: Side = strokes % 2 === 0 ? server : (server === 'home' ? 'away' : 'home');
  const from = hitting === 'home' ? 296 : 24;
  const to = hitting === 'home' ? 24 : 296;
  const p = (tSec % stroke) / stroke;
  const x = from + (to - from) * p;
  const swing = seeded(`${matchId}:t${strokes}`)() * 90 + 55;
  const y = 100 + (swing - 100) * (0.4 + 0.3 * Math.sin(p * Math.PI));
  return { x: clamp(x, 16, 304), y: clamp(y, 30, 170), server, hitting };
}

export interface TennisScore { games: [number, number]; point: string; server: Side }

// Games + current point within the ongoing set, folded from a deterministic
// point stream. Games freeze at 5 so a set never "completes" before the server.
export function tennisState(matchId: string, setIdx: number, tSecInSet: number): TennisScore {
  const rng = seeded(`${matchId}:set${setIdx}`);
  const startServer: Side = rng() < 0.5 ? 'home' : 'away';
  const nPoints = Math.floor(tSecInSet / RALLY_SECS);
  let gh = 0, ga = 0, ph = 0, pa = 0;
  const pr = seeded(`${matchId}:pts${setIdx}`);
  for (let i = 0; i < nPoints; i++) {
    if (gh >= 5 || ga >= 5) break;                       // freeze; wait for the server
    // server has a small edge
    const srv: Side = (gh + ga) % 2 === 0 ? startServer : (startServer === 'home' ? 'away' : 'home');
    const homeWins = pr() < (srv === 'home' ? 0.56 : 0.44);
    if (homeWins) ph++; else pa++;
    if ((ph >= 4 || pa >= 4) && Math.abs(ph - pa) >= 2) {
      if (ph > pa) gh++; else ga++;
      ph = 0; pa = 0;
    }
  }
  const gamesPlayed = gh + ga;
  const server: Side = gamesPlayed % 2 === 0 ? startServer : (startServer === 'home' ? 'away' : 'home');
  let point: string;
  if (ph >= 3 && pa >= 3) point = ph === pa ? 'Deuce' : (ph > pa ? 'Ad ·' : '· Ad');
  else point = `${POINT_MAP[Math.min(3, ph)]} - ${POINT_MAP[Math.min(3, pa)]}`;
  return { games: [gh, ga], point, server };
}

// Volleyball: points climb to ~25 within the current set; capped at 24 until the
// server flips the set. Deterministic from a seeded rally stream.
export function volleyState(matchId: string, setIdx: number, tSecInSet: number): { points: [number, number]; server: Side } {
  const rng = seeded(`${matchId}:vset${setIdx}`);
  const startServer: Side = rng() < 0.5 ? 'home' : 'away';
  const nRallies = Math.floor(tSecInSet / 5);
  let h = 0, a = 0;
  const pr = seeded(`${matchId}:vpts${setIdx}`);
  for (let i = 0; i < nRallies; i++) {
    if (h >= 24 || a >= 24) break;
    if (pr() < 0.5) h++; else a++;
  }
  const server: Side = (h + a) % 2 === 0 ? startServer : (startServer === 'home' ? 'away' : 'home');
  return { points: [h, a], server };
}

export type TPlay = 'ace' | 'winner' | 'error' | 'break' | 'rally';
export interface TEvent { key: string; sec: number; type: TPlay; side: Side }

export function tennisFeed(matchId: string, setIdx: number, uptoSec: number): TEvent[] {
  const out: TEvent[] = [];
  const n = Math.floor(uptoSec / RALLY_SECS);
  const rng = seeded(`${matchId}:tf${setIdx}`);
  for (let i = 0; i < n; i++) {
    const r = rng(); const side: Side = rng() < 0.5 ? 'home' : 'away';
    const type: TPlay = r < 0.12 ? 'ace' : r < 0.4 ? 'winner' : r < 0.8 ? 'error' : 'rally';
    out.push({ key: `te${setIdx}-${i}`, sec: Math.round((i + 1) * RALLY_SECS), type, side });
  }
  return out.filter((e) => e.sec <= uptoSec);
}
