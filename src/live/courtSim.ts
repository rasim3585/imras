// Deterministic basketball possession model — the CourtTV counterpart of the
// football liveSim. Pure atmosphere: the ball flows between the two hoops one
// possession at a time (bring-up → attack → shot → transition); made baskets
// come from the SERVER score. Home attacks the RIGHT hoop. Coordinates are in
// the 320×200 court viewBox so the ball and events line up with the SVG.

export type Side = 'home' | 'away';
export type PossOutcome = 'make2' | 'make3' | 'miss' | 'foul' | 'turnover';

function seeded(str: string) {
  let h = 2166136261;
  for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return () => { h = (Math.imul(h, 16807) % 2147483647) >>> 0; return (h % 100000) / 100000; };
}
const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export interface Poss { start: number; end: number; side: Side; outcome: PossOutcome; shotX: number; shotY: number }

const OUT: [PossOutcome, number][] = [['make2', 0.34], ['make3', 0.13], ['miss', 0.34], ['foul', 0.1], ['turnover', 0.09]];
const rollOut = (r: number): PossOutcome => { let a = 0; for (const [o, w] of OUT) { a += w; if (r < a) return o; } return 'miss'; };

const cache = new Map<string, Poss[]>();
export function possessions(matchId: string): Poss[] {
  const hit = cache.get(matchId);
  if (hit) return hit;
  const rng = seeded(`${matchId}:poss`);
  const out: Poss[] = [];
  let t = 2, side: Side = rng() < 0.5 ? 'home' : 'away';
  for (let i = 0; i < 260; i++) {
    const dur = 9 + rng() * 9;                    // 9–18s possession
    const outcome = rollOut(rng());
    const three = outcome === 'make3';
    const hoopX = side === 'home' ? 300 : 20;
    const shotX = hoopX + (side === 'home' ? -1 : 1) * (three ? 60 + rng() * 24 : 20 + rng() * 26);
    out.push({ start: t, end: t + dur, side, outcome, shotX, shotY: 60 + rng() * 80 });
    t += dur;
    // possession flips unless an offensive-ish carry (rare)
    if (rng() > 0.08) side = side === 'home' ? 'away' : 'home';
  }
  cache.set(matchId, out);
  return out;
}

export interface CourtFlow { x: number; y: number; side: Side; phase: 'bring' | 'attack' | 'shot' | 'reset' }

// Continuous ball position at clock `tSec` (loops if we run past the list).
export function courtFlowAt(matchId: string, tSec: number): CourtFlow {
  const list = possessions(matchId);
  const total = list[list.length - 1].end;
  const t = tSec % total;
  const p = list.find((q) => t >= q.start && t <= q.end) ?? list[0];
  const ownX = p.side === 'home' ? 30 : 290;
  const f = (t - p.start) / Math.max(1, p.end - p.start);
  let x: number, y: number, phase: CourtFlow['phase'];
  if (f < 0.28) { const k = smooth(f / 0.28); x = ownX + (160 - ownX) * k; y = 100; phase = 'bring'; }
  else if (f < 0.72) { const k = smooth((f - 0.28) / 0.44); x = 160 + (p.shotX - 160) * k; y = 100 + (p.shotY - 100) * k; phase = 'attack'; }
  else if (f < 0.86) { const hoopX = p.side === 'home' ? 300 : 20; const k = smooth((f - 0.72) / 0.14); x = p.shotX + (hoopX - p.shotX) * k; y = p.shotY + (100 - p.shotY) * k; phase = 'shot'; }
  else { const k = smooth((f - 0.86) / 0.14); const hoopX = p.side === 'home' ? 300 : 20; x = hoopX + (160 - hoopX) * k; y = 100; phase = 'reset'; }
  return { x: clamp(x, 14, 306), y: clamp(y, 20, 180), side: p.side, phase };
}

export type PlayType = 'make2' | 'make3' | 'miss' | 'rebound' | 'steal' | 'foul' | 'block' | 'assist';
export interface PlayEvent { key: string; sec: number; type: PlayType; side: Side }

// Ambient play-by-play up to `uptoSec` (loops with the ball). Server makes are
// merged on top by the screen so the score is always authoritative.
export function ambientPlay(matchId: string, uptoSec: number): PlayEvent[] {
  const list = possessions(matchId);
  const total = list[list.length - 1].end;
  const cycle = Math.floor(uptoSec / total);
  const t = uptoSec % total;
  const out: PlayEvent[] = [];
  for (const p of list) {
    if (p.end > t) break;
    const at = Math.round(p.end) + cycle * total;
    const map: Record<PossOutcome, PlayType> = { make2: 'miss', make3: 'miss', miss: 'miss', foul: 'foul', turnover: 'steal' };
    // ambient never claims a make (those come from the server); a "miss" gets a rebound
    const type = map[p.outcome];
    out.push({ key: `p${Math.round(p.start)}c${cycle}`, sec: at, type, side: p.side });
    if (type === 'miss') out.push({ key: `r${Math.round(p.start)}c${cycle}`, sec: at, type: 'rebound', side: p.side === 'home' ? 'away' : 'home' });
  }
  return out.filter((e) => e.sec <= uptoSec).sort((a, b) => a.sec - b.sec);
}

// Deterministic box-score-ish stats derived from possessions up to `uptoSec`,
// reconciled with the real made-points total from the server.
export interface CourtStats {
  fgPct: [number, number]; rebounds: [number, number]; turnovers: [number, number]; fouls: [number, number];
}
export function courtStatsAt(matchId: string, uptoSec: number): CourtStats {
  const list = possessions(matchId);
  const total = list[list.length - 1].end;
  const t = uptoSec % total;
  const cycles = Math.floor(uptoSec / total) + 1;
  const att: [number, number] = [0, 0], made: [number, number] = [0, 0];
  const reb: [number, number] = [0, 0], to: [number, number] = [0, 0], fl: [number, number] = [0, 0];
  const bump = (arr: [number, number], s: Side, n = 1) => { arr[s === 'home' ? 0 : 1] += n; };
  for (const p of list) {
    if (p.start > t) continue;
    const i = p.side;
    if (p.outcome === 'make2' || p.outcome === 'make3' || p.outcome === 'miss') { bump(att, i); if (p.outcome !== 'miss') bump(made, i); }
    if (p.outcome === 'miss') bump(reb, i === 'home' ? 'away' : 'home');
    if (p.outcome === 'turnover') bump(to, i);
    if (p.outcome === 'foul') bump(fl, i === 'home' ? 'away' : 'home');
  }
  const pct = (m: number, a: number) => (a === 0 ? 0 : Math.round((100 * m) / a));
  return {
    fgPct: [pct(made[0], att[0]), pct(made[1], att[1])],
    rebounds: [reb[0] * cycles, reb[1] * cycles], turnovers: [to[0] * cycles, to[1] * cycles], fouls: [fl[0] * cycles, fl[1] * cycles],
  };
}
