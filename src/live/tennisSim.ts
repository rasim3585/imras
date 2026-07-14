// ---------------------------------------------------------------------------
// Deterministic tennis/volleyball RALLY simulation — ONE rally list per set on
// ONE shared clock. The ball animation, the point ladder, the serve indicator
// and the play feed all derive from the same rallies (previously each ran on
// its own clock with unrelated randomness, so the feed could say "ace" while
// the ball rallied on). After every rally the ball lies DEAD ≈2.2s exactly
// where the point ended (ace → service box, winner → open court, error → net),
// and the point ladder ticks at that same moment. The backend only knows SETS
// (settle is set-based) — everything inside a set is presentational and the
// ladder freezes near set end so the SERVER decides when the set flips.
// 320×200 viewBox, home baseline right, net at x=160.
// ---------------------------------------------------------------------------

export type Side = 'home' | 'away';
export type TPlay = 'ace' | 'winner' | 'error' | 'rally';
export type CourtSport = 'tennis' | 'volleyball';

export interface Rally {
  idx: number; start: number; end: number; holdEnd: number;
  winner: Side; type: TPlay; server: Side; strokes: number;
  targets: { x: number; y: number }[];   // landing spot of each stroke; last = where the ball dies
  gamesH: number; gamesA: number;        // ladder AFTER this rally (volley: set points)
  ph: number; pa: number;                // tennis: points inside the running game
}

const HOLD = 2.2;                        // real seconds — a set plays out in real time
const POINT_MAP = ['0', '15', '30', '40'];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const other = (s: Side): Side => (s === 'home' ? 'away' : 'home');

function seeded(str: string) {
  let h = 2166136261;
  for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return () => { h = (Math.imul(h, 16807) % 2147483647) >>> 0; return (h % 100000) / 100000; };
}

const cache = new Map<string, Rally[]>();

function build(matchId: string, setIdx: number, sport: CourtSport): Rally[] {
  const rng = seeded(`${matchId}:set${setIdx}:${sport}`);
  const rallies: Rally[] = [];
  const startServer: Side = rng() < 0.5 ? 'home' : 'away';
  let server = startServer;
  let t = 2;
  let ph = 0, pa = 0, gh = 0, ga = 0;    // tennis fold (volley reuses gh/ga as points)
  for (let i = 0; i < 220; i++) {
    const r = rng();
    const type: TPlay = r < 0.1 ? 'ace' : r < 0.42 ? 'winner' : r < 0.78 ? 'error' : 'rally';
    const strokes = type === 'ace' ? 1 : type === 'rally' ? 6 + Math.floor(rng() * 5) : 2 + Math.floor(rng() * 4);
    const winner: Side = type === 'ace' ? server : rng() < (server === 'home' ? 0.55 : 0.45) ? 'home' : 'away';
    const loserRight = other(winner) === 'home';
    // stroke landing spots: alternate court halves; the LAST lands where the point dies
    const targets: { x: number; y: number }[] = [];
    for (let k = 0; k < strokes; k++) {
      const receiverRight = (k % 2 === 0 ? other(server) : server) === 'home';
      targets.push({ x: receiverRight ? 200 + rng() * 84 : 36 + rng() * 84, y: 40 + rng() * 120 });
    }
    if (type === 'error') targets[strokes - 1] = { x: 160 + (rng() < 0.5 ? -5 : 5), y: 60 + rng() * 80 };
    else if (type === 'ace') targets[0] = { x: loserRight ? 208 : 112, y: rng() < 0.5 ? 62 : 138 };
    else targets[strokes - 1] = { x: loserRight ? 236 + rng() * 54 : 30 + rng() * 54, y: 34 + rng() * 132 };
    // fold the point into the ladder (frozen near set end — server decides sets)
    if (sport === 'volleyball') {
      if (gh < 24 && ga < 24) { if (winner === 'home') gh++; else ga++; }
    } else if (gh < 5 && ga < 5) {
      if (winner === 'home') ph++; else pa++;
      if ((ph >= 4 || pa >= 4) && Math.abs(ph - pa) >= 2) { if (ph > pa) gh++; else ga++; ph = 0; pa = 0; }
    }
    const dur = strokes * (sport === 'volleyball' ? 0.9 : 1.1) + 0.6;
    rallies.push({ idx: i, start: t, end: t + dur, holdEnd: t + dur + HOLD, winner, type, server, strokes, targets, gamesH: gh, gamesA: ga, ph, pa });
    t += dur + HOLD + (sport === 'volleyball' ? 1.2 : 1.6);
    server = sport === 'volleyball' ? winner : (gh + ga) % 2 === 0 ? startServer : other(startServer);
  }
  cache.set(`${matchId}:${setIdx}:${sport}`, rallies);
  return rallies;
}

function sim(matchId: string, setIdx: number, sport: CourtSport): Rally[] {
  return cache.get(`${matchId}:${setIdx}:${sport}`) ?? build(matchId, setIdx, sport);
}

// --- shared per-set clock: every component reads the SAME seconds -----------
const anchors = new Map<string, number>();
export function setClockSec(matchId: string, setIdx: number): number {
  const k = `${matchId}:${setIdx}`;
  let a = anchors.get(k);
  if (a === undefined) { a = Date.now(); anchors.set(k, a); }
  return (Date.now() - a) / 1000;
}

export interface TennisFlow { x: number; y: number; server: Side; dead: boolean }

const baseX = (s: Side) => (s === 'home' ? 292 : 28);

// Ball position at set-second tSec: strokes across the net during the rally,
// then DEAD ≈2.2s where the point ended, then over to the next server.
export function rallyFlowAt(matchId: string, setIdx: number, sport: CourtSport, tSec: number): TennisFlow {
  const rl = sim(matchId, setIdx, sport);
  let lo = 0, hi = rl.length - 1, idx = 0;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (rl[mid].start <= tSec) { idx = mid; lo = mid + 1; } else hi = mid - 1; }
  const p = rl[idx];
  if (tSec < p.start) return { x: baseX(p.server), y: 100, server: p.server, dead: true };
  if (tSec >= p.holdEnd) {
    const nx = rl[idx + 1];
    return { x: baseX(nx ? nx.server : p.server), y: 100, server: nx ? nx.server : p.server, dead: true };
  }
  const last = p.targets[p.strokes - 1];
  if (tSec >= p.end) return { x: last.x, y: last.y, server: p.server, dead: true };   // point over — ball lies where it died
  const strokeDur = (p.end - p.start) / p.strokes;
  const k = Math.min(p.strokes - 1, Math.floor((tSec - p.start) / strokeDur));
  const from = k === 0 ? { x: baseX(p.server), y: 100 } : p.targets[k - 1];
  const to = p.targets[k];
  const f = clamp(((tSec - p.start) - k * strokeDur) / strokeDur, 0, 1);
  const arc = Math.sin(f * Math.PI) * 14;
  return {
    x: clamp(from.x + (to.x - from.x) * f, 16, 304),
    y: clamp(from.y + (to.y - from.y) * f - arc, 26, 174),
    server: p.server, dead: false,
  };
}

// Point ladder at set-second tSec — reads the fold stored on the last finished
// rally, so the score ticks the exact moment the ball lies dead.
export function rallyState(matchId: string, setIdx: number, sport: CourtSport, tSec: number): { games: [number, number]; point: string; server: Side } {
  const rl = sim(matchId, setIdx, sport);
  let last: Rally | null = null;
  for (const p of rl) { if (p.end <= tSec) last = p; else break; }
  const srv = last ? (rl[last.idx + 1]?.server ?? last.server) : rl[0].server;
  if (!last) return { games: [0, 0], point: sport === 'tennis' ? '0 - 0' : '', server: srv };
  if (sport === 'volleyball') return { games: [last.gamesH, last.gamesA], point: '', server: srv };
  const { ph, pa } = last;
  let point: string;
  if (ph >= 3 && pa >= 3) point = ph === pa ? 'Deuce' : ph > pa ? 'Ad ·' : '· Ad';
  else point = `${POINT_MAP[Math.min(3, ph)]} - ${POINT_MAP[Math.min(3, pa)]}`;
  return { games: [last.gamesH, last.gamesA], point, server: srv };
}

export interface TEvent { key: string; sec: number; type: TPlay; side: Side }

// Play feed: the SAME rallies, revealed the moment each point ends.
export function tennisFeed(matchId: string, setIdx: number, sport: CourtSport, uptoSec: number): TEvent[] {
  return sim(matchId, setIdx, sport)
    .filter((p) => p.end <= uptoSec)
    .map((p) => ({ key: `r${setIdx}-${p.idx}`, sec: p.end, type: p.type, side: p.winner }));
}
