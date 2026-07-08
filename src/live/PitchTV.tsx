import { useEffect, useRef } from 'react';
import { teamColor, teamInitial } from '../lib/teams';
import type { LineKind } from './commentary';

// ---------------------------------------------------------------------------
// A football-logic pitch. It enacts the commentary line being read, but always
// obeys real football: the ball is ALWAYS on a player's foot (or a dead-ball
// spot) and only moves by a pass / shot / turnover -- never teleports. Players
// hold a 4-3-3 and only cluster for a football reason (corner, free-kick wall,
// goal). Home attacks right (x -> 95), away attacks left (x -> 5). Percentages.
// After every goal: celebration, then a KICK-OFF (both halves reset, ball to the
// centre, the conceding side restarts). Purely visual.
// ---------------------------------------------------------------------------

type XY = [number, number];
// 4-3-3 base, forwards kept near the halfway line so a kick-off reset reads right
const HOME_F: XY[] = [[8, 50], [24, 22], [24, 40], [24, 60], [24, 78], [42, 30], [42, 50], [42, 70], [54, 34], [54, 66], [52, 50]];
const AWAY_F: XY[] = [[92, 50], [76, 22], [76, 40], [76, 60], [76, 78], [58, 30], [58, 50], [58, 70], [46, 34], [46, 66], [48, 50]];

const clamp = (v: number, lo = 4, hi = 96) => Math.max(lo, Math.min(hi, v));
const nearestOutfield = (team: XY[], pt: XY) => {
  let bi = 1, bd = Infinity;
  for (let i = 1; i < team.length; i++) {
    const d = (team[i][0] - pt[0]) ** 2 + (team[i][1] - pt[1]) ** 2;
    if (d < bd) { bd = d; bi = i; }
  }
  return bi;
};

// --- colours: the two teams must never read as the same colour ---
const hx = (h: string): XY3 => {
  let s = h.replace('#', '');
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
};
type XY3 = [number, number, number];
const toHex = (c: XY3) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const mix = (a: XY3, b: XY3, t: number): XY3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const cdist = (a: XY3, b: XY3) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
const lum = (c: XY3) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
function distinctAway(homeHex: string, awayHex: string): string {
  const h = hx(homeHex), a = hx(awayHex);
  if (cdist(h, a) > 112) return awayHex;                       // already distinct
  return lum(h) < 128 ? toHex(mix(a, [255, 255, 255], 0.6))    // home dark -> away light
    : toHex(mix(a, [12, 22, 44], 0.62));                       // home light -> away dark
}

const PS = [
  { s: '▲', c: '#4fe89a' }, { s: '✕', c: '#e24b4a' },
  { s: '●', c: '#4aa3e2' }, { s: '■', c: '#d4537e' },
];
function Rail() {
  return (
    <div className="ps-rail" aria-hidden="true">
      {PS.map((p, i) => <span key={i} className="ps-sym" style={{ color: p.c, animationDelay: `${i * 0.4}s` }}>{p.s}</span>)}
    </div>
  );
}

interface Model {
  poss: 'home' | 'away';
  zone: XY;              // centre of play; the ball lives here, on a foot
  mode: 'open' | 'dead' | 'celebrate';
  home: XY[]; away: XY[]; ref: XY; ball: XY;
  koTimer: number | null;
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
    poss: 'home', zone: [50, 50], mode: 'open',
    home: HOME_F.map((p) => [...p] as XY), away: AWAY_F.map((p) => [...p] as XY), ref: [43, 54], ball: [50, 52], koTimer: null,
  });

  // formation shaped around the ball zone (possessing side supports it more)
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
    const put = (sel: string, xy: XY) => {
      const el = root.querySelector<HTMLElement>(sel);
      if (el) { el.style.left = `${xy[0]}%`; el.style.top = `${xy[1]}%`; }
    };
    m.home.forEach((p, i) => put(`[data-k="h${i}"]`, p));
    m.away.forEach((p, i) => put(`[data-k="a${i}"]`, p));
    put('[data-k="ref"]', m.ref);
    put('[data-k="ball"]', m.ball);
  };

  // recompute open-play positions: snap the possessing side's nearest player onto
  // the ball so the ball is always on a foot; ref + ball follow the zone
  const apply = () => {
    const m = M.current;
    if (m.mode !== 'open') { paint(); return; }
    const { home: h, away: a } = formationFor(m.poss, m.zone);
    const cur = m.poss === 'home' ? h : a;
    cur[nearestOutfield(cur, m.zone)] = [m.zone[0], m.zone[1]];
    m.home = h; m.away = a;
    const sign = m.poss === 'home' ? 1 : -1;
    m.ref = [clamp(m.zone[0] - sign * 7), clamp(m.zone[1] + (m.zone[1] < 50 ? 9 : -9), 6, 94)];
    m.ball = [clamp(m.zone[0] + sign * 1.6, 3, 97), clamp(m.zone[1] + 2, 4, 96)];
    paint();
  };

  // one football decision per beat: a pass (zone steps toward goal / sideways)
  // or a turnover (possession flips where the ball is). Never a teleport.
  useEffect(() => {
    apply();
    if (phase !== 'live') return;
    const id = window.setInterval(() => {
      const m = M.current;
      if (m.mode !== 'open') return;
      if (Math.random() < 0.15) {
        m.poss = m.poss === 'home' ? 'away' : 'home';   // intercepted where it is
      } else {
        const goalX = m.poss === 'home' ? 95 : 5;
        const fwd = Math.random() < 0.62;
        const nx = fwd
          ? m.zone[0] + Math.sign(goalX - m.zone[0]) * (8 + Math.random() * 10)
          : m.zone[0] + (Math.random() - 0.5) * 16;
        m.zone = [clamp(nx, 10, 90), clamp(m.zone[1] + (Math.random() - 0.5) * 22, 14, 86)];
      }
      apply();
    }, 1600);
    return () => clearInterval(id);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // enact the commentary line as a scene
  useEffect(() => {
    if (!line || phase !== 'live' || line.team == null) return;
    const m = M.current;
    if (m.mode === 'celebrate') return;               // don't cut a celebration short
    const team = line.team;
    const dir = team === 'home' ? 1 : -1;
    const goalX = team === 'home' ? 95 : 5;
    const top = line.minute % 2 === 0;

    const setDead = (spot: XY, withRef: boolean) => {
      const { home: h, away: a } = formationFor(team, spot);
      m.home = h; m.away = a; m.poss = team; m.ball = [spot[0], spot[1]]; m.zone = spot;
      if (withRef) m.ref = [clamp(spot[0] - dir * 4), clamp(spot[1] + 7, 6, 94)];
      m.mode = 'dead';
    };

    switch (line.kind) {
      case 'calm': case 'mark':
        m.poss = team; m.zone = [clamp(50 + dir * 4, 32, 68), top ? 42 : 58]; m.mode = 'open'; apply(); break;
      case 'buildup':
        m.poss = team; m.zone = [team === 'home' ? 62 : 38, top ? 40 : 60]; m.mode = 'open'; apply(); break;
      case 'chance':
        m.poss = team; m.zone = [clamp(goalX - dir * 14, 8, 92), top ? 42 : 58]; m.mode = 'open'; apply(); break;
      case 'shot':
        m.poss = team; m.zone = [clamp(goalX - dir * 7, 8, 92), 50]; m.mode = 'open'; apply(); break;
      case 'miss':
        m.poss = team === 'home' ? 'away' : 'home';    // keeper gathers, plays out
        m.zone = [clamp(goalX, 6, 94), 50]; m.mode = 'open'; apply(); break;
      case 'foul':
        setDead([clamp(50 + dir * 6, 20, 80), top ? 40 : 60], true); paint(); break;
      case 'corner': {
        const cy = top ? 8 : 92;
        const { home: h, away: a } = formationFor(team, [clamp(goalX - dir * 10, 6, 94), 50]);
        const att = team === 'home' ? h : a; const def = team === 'home' ? a : h;
        att[7] = [clamp(goalX - dir * 3), cy];         // taker at the flag
        att[8] = [clamp(goalX - dir * 10), 42]; att[9] = [clamp(goalX - dir * 10), 58];
        att[10] = [clamp(goalX - dir * 14), 50]; att[5] = [clamp(goalX - dir * 18), 50];
        def[1] = [clamp(goalX - dir * 8), 42]; def[2] = [clamp(goalX - dir * 8), 58]; def[3] = [clamp(goalX - dir * 6), 50];
        def[0] = [clamp(goalX - dir * 3), 50];
        m.home = h; m.away = a; m.poss = team; m.ball = [clamp(goalX - dir * 2), cy]; m.mode = 'dead'; paint(); break;
      }
      case 'freekick': {
        const spot: XY = [clamp(goalX - dir * 22, 8, 92), top ? 42 : 58];
        const { home: h, away: a } = formationFor(team, spot);
        const att = team === 'home' ? h : a; const def = team === 'home' ? a : h;
        const wd = Math.sign(goalX - spot[0]);
        for (let k = 0; k < 4; k++) def[1 + k] = [clamp(spot[0] + wd * 9), clamp(spot[1] - 6 + k * 4, 6, 94)];
        def[0] = [clamp(goalX - dir * 3), 50];         // keeper on the line
        att[10] = [clamp(spot[0] - wd * 3), spot[1]];  // taker over the ball
        att[8] = [clamp(goalX - dir * 12), 42]; att[9] = [clamp(goalX - dir * 12), 58];
        m.home = h; m.away = a; m.poss = team; m.ball = [spot[0], spot[1]]; m.zone = spot;
        m.ref = [clamp(spot[0] - wd * 4), clamp(spot[1] + 8, 6, 94)]; m.mode = 'dead'; paint(); break;
      }
      case 'card':
        m.mode = 'dead'; m.ref = [m.ball[0], clamp(m.ball[1] - 5, 6, 94)]; paint(); break;
      case 'goal': {
        const { home: h, away: a } = formationFor(team, [clamp(goalX - dir * 8, 6, 94), 50]);
        const att = team === 'home' ? h : a; const def = team === 'home' ? a : h;
        att[8] = [clamp(goalX - dir * 8), 44]; att[9] = [clamp(goalX - dir * 10), 50];
        att[10] = [clamp(goalX - dir * 6), 56]; att[5] = [clamp(goalX - dir * 13), 50];
        def[0] = [clamp(goalX - dir * 2), 50];         // beaten keeper
        m.home = h; m.away = a; m.ball = [clamp(goalX + dir * 1, 3, 97), 50]; m.mode = 'celebrate'; paint();
        if (m.koTimer) clearTimeout(m.koTimer);
        const conceding: 'home' | 'away' = team === 'home' ? 'away' : 'home';
        m.koTimer = window.setTimeout(() => {                 // KICK-OFF
          m.poss = conceding; m.zone = [50, 50]; m.mode = 'open'; apply();
        }, 2600);
        break;
      }
    }
  }, [line?.minute, line?.sub, line?.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { if (M.current.koTimer) clearTimeout(M.current.koTimer); }, []);

  const player = (side: 'h' | 'a', i: number, color: string, sent: boolean) => (
    <div key={side + i} data-k={`${side}${i}`} className={`pitch-player ${sent ? 'sent-off' : ''}`}>
      <span className="pp-body" style={{ background: color }} />
      <span className="pp-feet"><i /><i /></span>
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
            <div className="pl midline" />
            <div className="pl circle" />
            <div className="pl spot" />
            <div className="pl box box-l" />
            <div className="pl box box-r" />
            <div className="pl goalbox goal-l" />
            <div className="pl goalbox goal-r" />
            {HOME_F.map((_, i) => player('h', i, homeColor, sentH.has(i)))}
            {AWAY_F.map((_, i) => player('a', i, awayColor, sentA.has(i)))}
            <div data-k="ref" className="pitch-player pitch-ref">
              <span className="pp-body" /><span className="pp-feet"><i /><i /></span>
            </div>
            <div data-k="ball" className="pitch-ball" />
          </div>
          <Rail />
        </div>
      </div>
    </div>
  );
}
