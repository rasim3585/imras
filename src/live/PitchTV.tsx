import { useEffect, useRef } from 'react';
import { teamColor, teamInitial } from '../lib/teams';
import type { LineKind } from './commentary';

// ---------------------------------------------------------------------------
// Deterministic behaviour engine (Yol B'). The ball is a physical thing: it can
// be on a foot OR loose in space, and BOTH teams chase a loose ball -- the
// nearest reaches it first (football's core dynamic). On the ball a player picks
// a real action: dribble into space, pass to feet, through-ball into space,
// shoot in range, or get tackled (loose). The ball out of play -> corner / goal
// kick / throw-in. Sides switch at half-time (45'). Goals are NOT invented here:
// they arrive from the server timeline ('goal' line) -> celebration -> kick-off.
// Pure visual; score/goals/cards stay server-authoritative.
// ---------------------------------------------------------------------------

type XY = [number, number];
const HOME_F: XY[] = [[8, 50], [24, 22], [24, 40], [24, 60], [24, 78], [42, 32], [42, 50], [42, 68], [58, 36], [58, 64], [54, 50]];
const AWAY_F: XY[] = [[92, 50], [76, 22], [76, 40], [76, 60], [76, 78], [58, 32], [58, 50], [58, 68], [42, 36], [42, 64], [46, 50]];
const mir = (F: XY[]): XY[] => F.map(([x, y]) => [100 - x, y]);

const clamp = (v: number, lo = 4, hi = 96) => Math.max(lo, Math.min(hi, v));
const D = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const lerp = (a: XY, b: XY, t: number): XY => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

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
function Rail() { return <div className="ps-rail" aria-hidden="true">{PS.map((p, i) => <span key={i} className="ps-sym" style={{ color: p.c, animationDelay: `${i * 0.4}s` }}>{p.s}</span>)}</div>; }

type Side = 'home' | 'away';
interface Model {
  home: XY[]; away: XY[]; ref: XY; ball: XY; ballTarget: XY | null;
  owner: { side: Side; idx: number } | null; loose: boolean; lastTouch: Side;
  mode: 'play' | 'dead' | 'celebrate'; koTimer: number | null; secondHalf: boolean;
}

export default function PitchTV({
  home, away, hs, as, minute, phase, redHome, redAway, flashTeam, line,
}: {
  home: string; away: string; hs: number; as: number; minute: number;
  phase: 'upcoming' | 'live' | 'finished'; redHome: number; redAway: number;
  flashTeam: 'home' | 'away' | null;
  line: { kind: LineKind; team?: Side; minute: number; sub: number } | null;
}) {
  const pitchRef = useRef<HTMLDivElement>(null);
  const homeColor = teamColor(home);
  const awayColor = distinctAway(homeColor, teamColor(away));
  const finished = phase === 'finished';
  const sentH = new Set(Array.from({ length: Math.min(redHome, 10) }, (_, i) => HOME_F.length - 1 - i));
  const sentA = new Set(Array.from({ length: Math.min(redAway, 10) }, (_, i) => AWAY_F.length - 1 - i));

  const minuteRef = useRef(minute); minuteRef.current = minute;
  const M = useRef<Model>({
    home: HOME_F.map((p) => [...p] as XY), away: AWAY_F.map((p) => [...p] as XY), ref: [43, 54],
    ball: [42, 52], ballTarget: null, owner: { side: 'home', idx: 6 }, loose: false, lastTouch: 'home',
    mode: 'play', koTimer: null, secondHalf: false,
  });

  const sh = () => minuteRef.current >= 45;
  const attackDir = (t: Side) => { const rightFirst = t === 'home'; return (rightFirst !== sh()) ? 1 : -1; };
  const attackGoalX = (t: Side) => (attackDir(t) > 0 ? 96 : 4);
  const gkX = (t: Side) => (attackDir(t) > 0 ? 8 : 92);
  const baseOf = (t: Side): XY[] => (t === 'home' ? (sh() ? mir(HOME_F) : HOME_F) : (sh() ? mir(AWAY_F) : AWAY_F));

  const nearestOut = (team: XY[], pt: XY) => { let bi = 1, bd = Infinity; for (let i = 1; i < team.length; i++) { const d = D(team[i], pt); if (d < bd) { bd = d; bi = i; } } return { i: bi, d: bd }; };
  const nearestAny = (team: XY[], pt: XY, skip: number) => { let bd = Infinity; for (let i = 0; i < team.length; i++) { if (i === skip) continue; const d = D(team[i], pt); if (d < bd) bd = d; } return bd; };

  const formationFor = (poss: Side, zone: XY) => {
    const mk = (base: XY[], gx: number, attacking: boolean): XY[] => base.map((b, i) => {
      if (i === 0) return [gx, clamp(50 + (zone[1] - 50) * 0.25, 30, 70)];
      const kx = attacking ? 0.30 : 0.18;
      return [clamp(b[0] + (zone[0] - b[0]) * kx), clamp(b[1] + (zone[1] - b[1]) * 0.16, 6, 94)];
    });
    return { home: mk(baseOf('home'), gkX('home'), poss === 'home'), away: mk(baseOf('away'), gkX('away'), poss === 'away') };
  };

  const paint = () => {
    const root = pitchRef.current; if (!root) return; const m = M.current;
    const put = (sel: string, xy: XY) => { const el = root.querySelector<HTMLElement>(sel); if (el) { el.style.left = `${xy[0]}%`; el.style.top = `${xy[1]}%`; } };
    m.home.forEach((p, i) => put(`[data-k="h${i}"]`, p));
    m.away.forEach((p, i) => put(`[data-k="a${i}"]`, p));
    put('[data-k="ref"]', m.ref); put('[data-k="ball"]', m.ball);
  };

  // formation around the ball; while loose, the nearest of EACH side chase it
  const shape = () => {
    const m = M.current;
    const zone: XY = m.owner ? [...(m.owner.side === 'home' ? m.home : m.away)[m.owner.idx]] as XY : [...m.ball] as XY;
    const poss: Side = m.owner ? m.owner.side : m.lastTouch;
    const { home: h, away: a } = formationFor(poss, zone);
    if (m.owner) { (m.owner.side === 'home' ? h : a)[m.owner.idx] = [zone[0], zone[1]]; }
    if (m.loose) {
      const hi = nearestOut(h, m.ball).i, ai = nearestOut(a, m.ball).i;
      h[hi] = lerp(h[hi], m.ball, 0.6); a[ai] = lerp(a[ai], m.ball, 0.6);
    } else {
      const opp = poss === 'home' ? a : h;
      const pi = nearestOut(opp, zone).i;
      opp[pi] = [clamp(zone[0] + Math.sign(attackGoalX(poss) - zone[0]) * 4), clamp(zone[1] + (zone[1] < 50 ? 3 : -3), 6, 94)];
    }
    m.home = h; m.away = a;
    m.ref = [clamp(zone[0] - Math.sign(attackGoalX(poss)) * 7), clamp(zone[1] + (zone[1] < 50 ? 9 : -9), 6, 94)];
    if (!m.loose) { const d = attackDir(poss); m.ball = [clamp(zone[0] + d * 1.6, 3, 97), clamp(zone[1] + 2, 4, 96)]; }
    paint();
  };

  const laneOpen = (from: XY, opp: XY[], goalX: number) => {
    const lo = Math.min(from[0], goalX), hi = Math.max(from[0], goalX);
    for (const p of opp) if (p[0] > lo && p[0] < hi && Math.abs(p[1] - 50) < 9 && Math.abs(p[1] - from[1]) < 22) return false;
    return true;
  };
  const spaceAhead = (pos: XY, opp: XY[], dir: number) => {
    for (const p of opp) if (Math.sign(p[0] - pos[0]) === dir && Math.abs(p[0] - pos[0]) < 18 && Math.abs(p[1] - pos[1]) < 12) return false;
    return true;
  };
  const openMate = (mine: XY[], opp: XY[], owner: number, fwdSign: number, dir: number, allowGK = false) => {
    let best = -1, bs = -Infinity;
    for (let i = 0; i < mine.length; i++) {
      if (i === owner || (i === 0 && !allowGK)) continue;
      const p = mine[i];
      const score = nearestAny(opp, p, -1) + fwdSign * (dir > 0 ? p[0] - mine[owner][0] : mine[owner][0] - p[0]) * 0.6 - D(p, mine[owner]) * 0.22 + Math.random() * 6;
      if (score > bs) { bs = score; best = i; }
    }
    return best;
  };

  // release the ball into space/feet -> it becomes loose and gets chased
  const release = (to: XY, team: Side) => { const m = M.current; m.loose = true; m.owner = null; m.lastTouch = team; m.ballTarget = [clamp(to[0], 2, 98), clamp(to[1], 3, 97)]; };

  const decide = () => {
    const m = M.current; if (!m.owner) return;
    const side = m.owner.side, idx = m.owner.idx;
    const mine = side === 'home' ? m.home : m.away;
    const opp = side === 'home' ? m.away : m.home;
    const dir = attackDir(side); const goalX = attackGoalX(side); const pos = mine[idx];
    const press = nearestOut(opp, pos);

    if (idx !== 0 && press.d < 4 && Math.random() < 0.5) {           // tackled -> ball knocked loose (both chase)
      release([pos[0] - dir * 3 + (Math.random() - 0.5) * 6, pos[1] + (Math.random() - 0.5) * 8], side); return;
    }
    if (idx === 0) {                                                 // keeper distributes upfield
      const t = openMate(mine, opp, 0, 1, dir); if (t >= 0) release(mine[t], side); else release([clamp(pos[0] + dir * 25), pos[1]], side); return;
    }
    const inRange = Math.abs(goalX - pos[0]) < 30;
    if (inRange && laneOpen(pos, opp, goalX) && Math.random() < 0.6) { release([goalX, 50 + (Math.random() - 0.5) * 12], side); return; } // shot
    if (press.d > 11 && spaceAhead(pos, opp, dir) && Math.random() < 0.6) {        // dribble into space
      mine[idx] = [clamp(pos[0] + dir * (9 + Math.random() * 5)), clamp(pos[1] + (Math.random() - 0.5) * 8, 8, 92)]; return;
    }
    if (press.d < 9) {                                              // pressured -> pass to feet / lay off
      const t = openMate(mine, opp, idx, 1, dir);
      if (t >= 0) release(mine[t], side);
      else { const b = openMate(mine, opp, idx, -1, dir, true); release(b >= 0 ? mine[b] : [clamp(pos[0] - dir * 8), pos[1]], side); }
      return;
    }
    // free: through-ball into space ahead of a forward, or a feet pass
    const t = openMate(mine, opp, idx, 1, dir);
    if (t >= 0 && Math.random() < 0.55) release([mine[t][0] + dir * 12, mine[t][1]], side); // through ball
    else if (t >= 0) release(mine[t], side);
    else mine[idx] = [clamp(pos[0] + dir * 8), clamp(pos[1] + (Math.random() - 0.5) * 6, 8, 92)]; // carry, never stall
  };

  const outEnd = (b: XY) => (b[0] <= 2.5 ? 'L' : b[0] >= 97.5 ? 'R' : null);
  const outSide = (b: XY) => (b[1] <= 4.5 || b[1] >= 95.5);

  const restart = (owner: { side: Side; idx: number }, at: XY) => {
    const m = M.current; m.owner = owner; m.loose = false; m.ballTarget = null; m.lastTouch = owner.side;
    (owner.side === 'home' ? m.home : m.away)[owner.idx] = [...at] as XY; shape();
  };

  const handleOOB = () => {
    const m = M.current; const b = m.ball;
    if (outSide(b)) {                                                // throw-in to the other side
      const inT: Side = m.lastTouch === 'home' ? 'away' : 'home';
      const spot: XY = [clamp(b[0], 6, 94), b[1] <= 4.5 ? 6 : 94];
      const team = inT === 'home' ? m.home : m.away;
      restart({ side: inT, idx: nearestOut(team, spot).i }, spot); return;
    }
    const end = outEnd(b)!;                                          // goal / end line
    const defendsLeft: Side = attackDir('home') < 0 ? 'home' : 'away'; // team whose goal is at x~4
    const endDefender: Side = end === 'L' ? defendsLeft : (defendsLeft === 'home' ? 'away' : 'home');
    if (m.lastTouch === endDefender) {                               // defender put it out -> corner to attackers
      doCorner(endDefender === 'home' ? 'away' : 'home', b[1] < 50 ? 'top' : 'bot');
    } else {                                                         // attacker overhit -> goal kick
      restart({ side: endDefender, idx: 0 }, [gkX(endDefender), 50]);
    }
  };

  // a played corner: crowd the box, ball crossed in (loose) -> everyone attacks it
  const doCorner = (team: Side, band: 'top' | 'bot') => {
    const m = M.current; const dir = attackDir(team); const goalX = attackGoalX(team); const cy = band === 'top' ? 8 : 92;
    const { home: h, away: a } = formationFor(team, [clamp(goalX - dir * 10, 6, 94), 50]);
    const att = team === 'home' ? h : a; const def = team === 'home' ? a : h;
    att[8] = [clamp(goalX - dir * 10), 42]; att[9] = [clamp(goalX - dir * 10), 58]; att[10] = [clamp(goalX - dir * 13), 50];
    def[1] = [clamp(goalX - dir * 8), 42]; def[2] = [clamp(goalX - dir * 8), 58]; def[0] = [clamp(goalX - dir * 3), 50];
    m.home = h; m.away = a; m.ball = [clamp(goalX - dir * 2), cy]; m.owner = null; m.loose = true; m.lastTouch = team;
    m.ballTarget = [clamp(goalX - dir * 9), 50]; m.mode = 'play'; paint();
  };

  const captureRadius = 4.5;
  const step = () => {
    const m = M.current; if (m.mode !== 'play') return;
    if (!m.owner && !m.loose) {                                      // safety: never frozen
      const hN = nearestOut(m.home, m.ball), aN = nearestOut(m.away, m.ball);
      const w = hN.d <= aN.d ? { side: 'home' as Side, i: hN.i } : { side: 'away' as Side, i: aN.i };
      m.owner = { side: w.side, idx: w.i }; m.lastTouch = w.side;
    }
    if (m.loose && m.ballTarget) {
      m.ball = lerp(m.ball, m.ballTarget, 0.5);
      if (outEnd(m.ball) || outSide(m.ball)) { handleOOB(); return; }
      shape();                                                       // moves chasers toward the ball
      const hN = nearestOut(m.home, m.ball), aN = nearestOut(m.away, m.ball);
      const hk = D(m.home[0], m.ball), ak = D(m.away[0], m.ball);
      const cands = [{ s: 'home' as Side, i: hN.i, d: hN.d }, { s: 'away' as Side, i: aN.i, d: aN.d }, { s: 'home' as Side, i: 0, d: hk }, { s: 'away' as Side, i: 0, d: ak }].sort((x, y) => x.d - y.d);
      const win = cands[0];
      if (win.d < captureRadius || D(m.ball, m.ballTarget) < 2) {
        m.owner = { side: win.s, idx: win.i }; m.loose = false; m.ballTarget = null; m.lastTouch = win.s;
        m.ball = [...(win.s === 'home' ? m.home : m.away)[win.i]] as XY; shape();
      }
      return;
    }
    decide(); shape();
  };

  useEffect(() => {
    shape();
    if (phase !== 'live') return;
    const id = window.setInterval(step, 260);
    return () => clearInterval(id);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!line || phase !== 'live' || line.team == null) return;
    const m = M.current; if (m.mode === 'celebrate') return;
    const team = line.team; const dir = attackDir(team); const goalX = attackGoalX(team); const top = line.minute % 2 === 0;
    const own = (idx: number) => { m.owner = { side: team, idx }; m.loose = false; m.ballTarget = null; m.lastTouch = team; };
    const dead = (spot: XY, withRef: boolean) => {
      const { home: h, away: a } = formationFor(team, spot); m.home = h; m.away = a;
      own(6); m.ball = [...spot] as XY; if (withRef) m.ref = [clamp(spot[0] - dir * 4), clamp(spot[1] + 7, 6, 94)]; m.mode = 'dead';
    };
    switch (line.kind) {
      case 'calm': case 'mark': own(6); m.mode = 'play'; shape(); break;
      case 'buildup': own(Math.random() < 0.5 ? 5 : 7); m.mode = 'play'; shape(); break;
      case 'chance': case 'shot': {
        own(10); const fwd = team === 'home' ? m.home : m.away; fwd[10] = [clamp(goalX - dir * (line.kind === 'shot' ? 8 : 14)), 50]; m.mode = 'play'; shape(); break;
      }
      case 'miss': m.owner = { side: team === 'home' ? 'away' : 'home', idx: 0 }; m.loose = false; m.lastTouch = m.owner.side; m.mode = 'play'; shape(); break;
      case 'foul': dead([clamp(50 + dir * 6, 20, 80), top ? 40 : 60], true); paint(); break;
      case 'corner': doCorner(team, top ? 'top' : 'bot'); break;
      case 'freekick': {
        const spot: XY = [clamp(goalX - dir * 22, 8, 92), top ? 42 : 58]; const { home: h, away: a } = formationFor(team, spot);
        const att = team === 'home' ? h : a; const def = team === 'home' ? a : h; const wd = Math.sign(goalX - spot[0]);
        for (let k = 0; k < 4; k++) def[1 + k] = [clamp(spot[0] + wd * 9), clamp(spot[1] - 6 + k * 4, 6, 94)];
        def[0] = [clamp(goalX - dir * 3), 50]; att[10] = [clamp(spot[0] - wd * 3), spot[1]];
        m.home = h; m.away = a; own(10); m.ball = [...spot] as XY; m.ref = [clamp(spot[0] - wd * 4), clamp(spot[1] + 8, 6, 94)]; m.mode = 'dead'; paint(); break;
      }
      case 'card': m.mode = 'dead'; m.ref = [m.ball[0], clamp(m.ball[1] - 5, 6, 94)]; paint(); break;
      case 'goal': {
        const { home: h, away: a } = formationFor(team, [clamp(goalX - dir * 8, 6, 94), 50]);
        const att = team === 'home' ? h : a; const def = team === 'home' ? a : h;
        att[8] = [clamp(goalX - dir * 8), 44]; att[9] = [clamp(goalX - dir * 10), 50]; att[10] = [clamp(goalX - dir * 6), 56]; att[5] = [clamp(goalX - dir * 13), 50];
        def[0] = [clamp(goalX - dir * 2), 50];
        m.home = h; m.away = a; m.owner = null; m.loose = false; m.ballTarget = null; m.ball = [clamp(goalX + dir * 1, 3, 97), 50]; m.mode = 'celebrate'; paint();
        if (m.koTimer) clearTimeout(m.koTimer);
        const conceding: Side = team === 'home' ? 'away' : 'home';
        m.koTimer = window.setTimeout(() => { m.owner = { side: conceding, idx: 6 }; m.loose = false; m.lastTouch = conceding; m.mode = 'play'; shape(); }, 2600);
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
