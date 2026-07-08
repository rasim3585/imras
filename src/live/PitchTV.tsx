import { useEffect, useRef } from 'react';
import { teamColor, teamInitial } from '../lib/teams';
import type { LineKind } from './commentary';

// ---------------------------------------------------------------------------
// Deterministic behaviour engine (Yol B'): the decision rules are modelled on
// footballSimulationEngine's intent->action approach, but driven by OUR fixed
// timeline. Every beat the player on the ball evaluates the situation and picks
// a real football action -- shoot when there's a lane in range, pass to an open
// team-mate when pressured, the keeper distributes when he wins it, defenders
// press and turn the ball over. Goals are NOT invented here: they arrive from
// the server timeline (the 'goal' line); a goal triggers celebration then an
// automatic KICK-OFF. Home attacks right (x->95), away left (x->5). Percentages.
// ---------------------------------------------------------------------------

type XY = [number, number];
const HOME_F: XY[] = [[8, 50], [24, 22], [24, 40], [24, 60], [24, 78], [42, 32], [42, 50], [42, 68], [58, 36], [58, 64], [54, 50]];
const AWAY_F: XY[] = [[92, 50], [76, 22], [76, 40], [76, 60], [76, 78], [58, 32], [58, 50], [58, 68], [42, 36], [42, 64], [46, 50]];

const clamp = (v: number, lo = 4, hi = 96) => Math.max(lo, Math.min(hi, v));
const D = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const nearestOut = (team: XY[], pt: XY) => {
  let bi = 1, bd = Infinity;
  for (let i = 1; i < team.length; i++) { const d = D(team[i], pt); if (d < bd) { bd = d; bi = i; } }
  return { i: bi, d: bd };
};
const nearestAny = (team: XY[], pt: XY, skip: number) => {
  let bd = Infinity;
  for (let i = 0; i < team.length; i++) { if (i === skip) continue; const d = D(team[i], pt); if (d < bd) bd = d; }
  return bd;
};

// --- colours: the two teams must never read as the same ---
type C3 = [number, number, number];
const hx = (h: string): C3 => { let s = h.replace('#', ''); if (s.length === 3) s = s.split('').map((c) => c + c).join(''); return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)]; };
const toHex = (c: C3) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const mixc = (a: C3, b: C3, t: number): C3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const cdist = (a: C3, b: C3) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
const clum = (c: C3) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
function distinctAway(homeHex: string, awayHex: string): string {
  const h = hx(homeHex), a = hx(awayHex);
  if (cdist(h, a) > 112) return awayHex;
  return clum(h) < 128 ? toHex(mixc(a, [255, 255, 255], 0.6)) : toHex(mixc(a, [12, 22, 44], 0.62));
}

const PS = [{ s: '▲', c: '#4fe89a' }, { s: '✕', c: '#e24b4a' }, { s: '●', c: '#4aa3e2' }, { s: '■', c: '#d4537e' }];
function Rail() {
  return <div className="ps-rail" aria-hidden="true">{PS.map((p, i) => <span key={i} className="ps-sym" style={{ color: p.c, animationDelay: `${i * 0.4}s` }}>{p.s}</span>)}</div>;
}

interface Model {
  poss: 'home' | 'away'; owner: number; mode: 'play' | 'dead' | 'celebrate';
  home: XY[]; away: XY[]; ref: XY; ball: XY; koTimer: number | null;
}

export default function PitchTV({
  home, away, hs, as, minute, phase, redHome, redAway, flashTeam, line,
}: {
  home: string; away: string; hs: number; as: number; minute: number;
  phase: 'upcoming' | 'live' | 'finished'; redHome: number; redAway: number;
  flashTeam: 'home' | 'away' | null;
  line: { kind: LineKind; team?: 'home' | 'away'; minute: number; sub: number } | null;
}) {
  const pitchRef = useRef<HTMLDivElement>(null);
  const homeColor = teamColor(home);
  const awayColor = distinctAway(homeColor, teamColor(away));
  const finished = phase === 'finished';
  const sentH = new Set(Array.from({ length: Math.min(redHome, 10) }, (_, i) => HOME_F.length - 1 - i));
  const sentA = new Set(Array.from({ length: Math.min(redAway, 10) }, (_, i) => AWAY_F.length - 1 - i));

  const M = useRef<Model>({
    poss: 'home', owner: 6, mode: 'play',
    home: HOME_F.map((p) => [...p] as XY), away: AWAY_F.map((p) => [...p] as XY), ref: [43, 54], ball: [42, 52], koTimer: null,
  });

  const dirOf = (t: 'home' | 'away') => (t === 'home' ? 1 : -1);
  const goalOf = (t: 'home' | 'away') => (t === 'home' ? 95 : 5);

  const formationFor = (poss: 'home' | 'away', zone: XY) => {
    const mk = (F: XY[], gkX: number, attacking: boolean): XY[] => F.map((b, i) => {
      if (i === 0) return [gkX, clamp(50 + (zone[1] - 50) * 0.25, 30, 70)];
      const kx = attacking ? 0.30 : 0.18;
      return [clamp(b[0] + (zone[0] - b[0]) * kx), clamp(b[1] + (zone[1] - b[1]) * 0.16, 6, 94)];
    });
    return { home: mk(HOME_F, 8, poss === 'home'), away: mk(AWAY_F, 92, poss === 'away') };
  };

  const paint = () => {
    const root = pitchRef.current; if (!root) return;
    const m = M.current;
    const put = (sel: string, xy: XY) => { const el = root.querySelector<HTMLElement>(sel); if (el) { el.style.left = `${xy[0]}%`; el.style.top = `${xy[1]}%`; } };
    m.home.forEach((p, i) => put(`[data-k="h${i}"]`, p));
    m.away.forEach((p, i) => put(`[data-k="a${i}"]`, p));
    put('[data-k="ref"]', m.ref); put('[data-k="ball"]', m.ball);
  };

  // shape the pitch around the ball: possessing owner on the ball, one defender
  // presses (goal-side), everyone holds formation shifted toward the ball
  const shape = () => {
    const m = M.current;
    const zone: XY = [...(m.poss === 'home' ? m.home : m.away)[m.owner]] as XY;
    const { home: h, away: a } = formationFor(m.poss, zone);
    const mine = m.poss === 'home' ? h : a;
    const opp = m.poss === 'home' ? a : h;
    mine[m.owner] = [zone[0], zone[1]];
    const pi = nearestOut(opp, zone).i;                       // presser, goal-side of the ball
    opp[pi] = [clamp(zone[0] + Math.sign(goalOf(m.poss) - zone[0]) * 4), clamp(zone[1] + (zone[1] < 50 ? 3 : -3), 6, 94)];
    m.home = h; m.away = a;
    const sign = dirOf(m.poss);
    m.ref = [clamp(zone[0] - sign * 7), clamp(zone[1] + (zone[1] < 50 ? 9 : -9), 6, 94)];
    m.ball = [clamp(zone[0] + sign * 1.6, 3, 97), clamp(zone[1] + 2, 4, 96)];
    paint();
  };

  // is there a clear lane from the ball to the goal mouth?
  const laneOpen = (from: XY, opp: XY[], goalX: number) => {
    const lo = Math.min(from[0], goalX), hi = Math.max(from[0], goalX);
    for (const p of opp) if (p[0] > lo && p[0] < hi && Math.abs(p[1] - 50) < 9 && Math.abs(p[1] - from[1]) < 22) return false;
    return true;
  };
  // pick an open team-mate (fwd bias +1 / lay-off -1); never the keeper unless forced
  const openMate = (mine: XY[], opp: XY[], owner: number, fwdSign: number, dir: number, allowGK = false) => {
    let best = -1, bs = -Infinity;
    for (let i = 0; i < mine.length; i++) {
      if (i === owner || (i === 0 && !allowGK)) continue;
      const p = mine[i];
      const openness = nearestAny(opp, p, -1);
      const forward = fwdSign * (dir > 0 ? p[0] - mine[owner][0] : mine[owner][0] - p[0]);
      const far = D(p, mine[owner]);
      const score = openness + forward * 0.6 - far * 0.22 + Math.random() * 6;
      if (score > bs) { bs = score; best = i; }
    }
    return best;
  };

  // one football decision for the player on the ball
  const step = () => {
    const m = M.current;
    if (m.mode !== 'play') return;
    const mine = m.poss === 'home' ? m.home : m.away;
    const opp = m.poss === 'home' ? m.away : m.home;
    const dir = dirOf(m.poss);
    const goalX = goalOf(m.poss);
    const pos = mine[m.owner];
    const press = nearestOut(opp, pos);

    if (press.d < 5 && Math.random() < 0.55) {              // tackled -> turnover
      m.poss = m.poss === 'home' ? 'away' : 'home'; m.owner = press.i; shape(); return;
    }
    if (m.owner === 0) {                                    // keeper always distributes
      m.owner = openMate(mine, opp, 0, 1, dir); shape(); return;
    }
    const inRange = Math.abs(goalX - pos[0]) < 30;
    if (inRange && laneOpen(pos, opp, goalX) && Math.random() < 0.7) { shootOut(); return; }
    if (press.d < 10) {                                     // pressured -> release
      const t = openMate(mine, opp, m.owner, 1, dir);
      if (t >= 0) m.owner = t;
      else if (inRange) { shootOut(); return; }
      else { const b = openMate(mine, opp, m.owner, -1, dir, true); if (b >= 0) m.owner = b; }
      shape(); return;
    }
    if (Math.random() < 0.45) {                             // progress by a pass
      const t = openMate(mine, opp, m.owner, 1, dir); if (t >= 0) m.owner = t;
    } else {                                                // or carry it forward
      mine[m.owner] = [clamp(pos[0] + dir * (7 + Math.random() * 5)), clamp(pos[1] + (Math.random() - 0.5) * 8, 8, 92)];
    }
    shape();
  };

  // a non-timeline shot: the defending keeper claims it (save / goal kick)
  const shootOut = () => {
    const m = M.current;
    m.poss = m.poss === 'home' ? 'away' : 'home';
    m.owner = 0; shape();
  };

  useEffect(() => {
    shape();
    if (phase !== 'live') return;
    const id = window.setInterval(step, 380);
    return () => clearInterval(id);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // scenes from the commentary line: set pieces + the authoritative goal
  useEffect(() => {
    if (!line || phase !== 'live' || line.team == null) return;
    const m = M.current;
    if (m.mode === 'celebrate') return;
    const team = line.team;
    const dir = dirOf(team); const goalX = goalOf(team); const top = line.minute % 2 === 0;

    const deadShape = (spot: XY): { att: XY[]; def: XY[]; h: XY[]; a: XY[] } => {
      const { home: h, away: a } = formationFor(team, spot);
      return { att: team === 'home' ? h : a, def: team === 'home' ? a : h, h, a };
    };

    switch (line.kind) {
      case 'calm': case 'mark':
        m.poss = team; m.owner = 6; m.mode = 'play'; shape(); break;
      case 'buildup':
        m.poss = team; m.owner = Math.random() < 0.5 ? 5 : 7; m.mode = 'play'; shape(); break;
      case 'chance': case 'shot': {
        m.poss = team; m.owner = 10; m.mode = 'play';
        const fwd = team === 'home' ? m.home : m.away;
        fwd[10] = [clamp(goalX - dir * (line.kind === 'shot' ? 8 : 14)), 50];   // push the striker up
        shape(); break;
      }
      case 'miss':
        m.poss = team === 'home' ? 'away' : 'home'; m.owner = 0; m.mode = 'play'; shape(); break;
      case 'foul': {
        const spot: XY = [clamp(50 + dir * 6, 20, 80), top ? 40 : 60];
        const { h, a } = deadShape(spot); m.home = h; m.away = a; m.poss = team;
        m.ball = [...spot] as XY; m.ref = [clamp(spot[0] - dir * 4), clamp(spot[1] + 7, 6, 94)]; m.mode = 'dead'; paint(); break;
      }
      case 'corner': {
        const cy = top ? 8 : 92; const { att, def, h, a } = deadShape([clamp(goalX - dir * 10, 6, 94), 50]);
        att[7] = [clamp(goalX - dir * 3), cy]; att[8] = [clamp(goalX - dir * 10), 42]; att[9] = [clamp(goalX - dir * 10), 58];
        att[10] = [clamp(goalX - dir * 14), 50]; att[5] = [clamp(goalX - dir * 18), 50];
        def[1] = [clamp(goalX - dir * 8), 42]; def[2] = [clamp(goalX - dir * 8), 58]; def[3] = [clamp(goalX - dir * 6), 50]; def[0] = [clamp(goalX - dir * 3), 50];
        m.home = h; m.away = a; m.poss = team; m.ball = [clamp(goalX - dir * 2), cy]; m.mode = 'dead'; paint(); break;
      }
      case 'freekick': {
        const spot: XY = [clamp(goalX - dir * 22, 8, 92), top ? 42 : 58]; const { att, def, h, a } = deadShape(spot);
        const wd = Math.sign(goalX - spot[0]);
        for (let k = 0; k < 4; k++) def[1 + k] = [clamp(spot[0] + wd * 9), clamp(spot[1] - 6 + k * 4, 6, 94)];
        def[0] = [clamp(goalX - dir * 3), 50]; att[10] = [clamp(spot[0] - wd * 3), spot[1]];
        att[8] = [clamp(goalX - dir * 12), 42]; att[9] = [clamp(goalX - dir * 12), 58];
        m.home = h; m.away = a; m.poss = team; m.ball = [...spot] as XY; m.ref = [clamp(spot[0] - wd * 4), clamp(spot[1] + 8, 6, 94)]; m.mode = 'dead'; paint(); break;
      }
      case 'card':
        m.mode = 'dead'; m.ref = [m.ball[0], clamp(m.ball[1] - 5, 6, 94)]; paint(); break;
      case 'goal': {
        const { att, def, h, a } = deadShape([clamp(goalX - dir * 8, 6, 94), 50]);
        att[8] = [clamp(goalX - dir * 8), 44]; att[9] = [clamp(goalX - dir * 10), 50]; att[10] = [clamp(goalX - dir * 6), 56]; att[5] = [clamp(goalX - dir * 13), 50];
        def[0] = [clamp(goalX - dir * 2), 50];
        m.home = h; m.away = a; m.ball = [clamp(goalX + dir * 1, 3, 97), 50]; m.mode = 'celebrate'; paint();
        if (m.koTimer) clearTimeout(m.koTimer);
        const conceding: 'home' | 'away' = team === 'home' ? 'away' : 'home';
        m.koTimer = window.setTimeout(() => { m.poss = conceding; m.owner = 6; m.mode = 'play'; shape(); }, 2600);
        break;
      }
    }
  }, [line?.minute, line?.sub, line?.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { if (M.current.koTimer) clearTimeout(M.current.koTimer); }, []);

  const player = (side: 'h' | 'a', i: number, color: string, sent: boolean) => (
    <div key={side + i} data-k={`${side}${i}`} className={`pitch-player ${sent ? 'sent-off' : ''}`}>
      <span className="pp-body" style={{ background: color }} /><span className="pp-feet"><i /><i /></span>
    </div>
  );

  return (
    <div className="pitch-tv">
      <div className="tv-scoreboard">
        <span className="tvsb-badge" style={{ background: homeColor }}>{teamInitial(home)}</span>
        <span className="tvsb-name">{home}{redHome > 0 ? <span className="tvsb-red"> ▮</span> : null}</span>
        <span className="tvsb-score tnum">{phase === 'upcoming' ? '– : –' : `${hs} - ${as}`}</span>
        <span className="tvsb-name">{away}{redAway > 0 ? <span className="tvsb-red"> ▮</span> : null}</span>
        <span className="tvsb-badge" style={{ background: awayColor }}>{teamInitial(away)}</span>
        <span className="tvsb-min tnum">{phase === 'upcoming' ? 'soon' : finished ? "90'" : `${minute}'`}</span>
      </div>
      <div className="tv-bezel">
        <div className="pitch-area">
          <Rail />
          <div className={`pitch ${flashTeam ? 'pitch-flash' : ''}`} ref={pitchRef}>
            <div className="pl midline" /><div className="pl circle" /><div className="pl spot" />
            <div className="pl box box-l" /><div className="pl box box-r" />
            <div className="pl goalbox goal-l" /><div className="pl goalbox goal-r" />
            {HOME_F.map((_, i) => player('h', i, homeColor, sentH.has(i)))}
            {AWAY_F.map((_, i) => player('a', i, awayColor, sentA.has(i)))}
            <div data-k="ref" className="pitch-player pitch-ref"><span className="pp-body" /><span className="pp-feet"><i /><i /></span></div>
            <div data-k="ball" className="pitch-ball" />
          </div>
          <Rail />
        </div>
      </div>
    </div>
  );
}
