import { useEffect, useRef } from 'react';
import { teamColor, teamInitial } from '../lib/teams';
import type { LineKind } from './commentary';

// ---------------------------------------------------------------------------
// A football-logic pitch. It does NOT invent anything: it enacts the SAME
// commentary line the user is reading (kind + team) as a coherent little scene,
// with sensible positioning (free-kick wall, corner crowding, shot on goal,
// celebration) and possession-based ball movement (short passes to a nearby
// team-mate, never teleporting or drifting on its own).
// Home attacks right (x -> 100), away attacks left (x -> 0). x,y are percents.
// ---------------------------------------------------------------------------

type XY = [number, number];
// 4-3-3 base shapes: [GK, 4x DEF, 3x MID, 3x FWD]
const HOME_F: XY[] = [[7, 50], [22, 26], [22, 42], [22, 58], [22, 74], [40, 32], [40, 50], [40, 68], [56, 38], [56, 62], [53, 50]];
const AWAY_F: XY[] = [[93, 50], [78, 26], [78, 42], [78, 58], [78, 74], [60, 32], [60, 50], [60, 68], [44, 38], [44, 62], [47, 50]];

interface Model { home: XY[]; away: XY[]; ref: XY; ball: XY; poss: 'home' | 'away'; }
const clone = (f: XY[]): XY[] => f.map((p) => [p[0], p[1]] as XY);
const clampX = (v: number) => Math.max(3, Math.min(97, v));
const clampY = (v: number) => Math.max(7, Math.min(93, v));

// Build the scene for one commentary line. Deterministic (flank picked by minute).
function scene(kind: LineKind, team: 'home' | 'away', minute: number, prev: Model): Model {
  const home = clone(HOME_F);
  const away = clone(AWAY_F);
  const att = team === 'home' ? home : away;
  const def = team === 'home' ? away : home;
  const dir = team === 'home' ? 1 : -1;          // attacking direction
  const goalX = team === 'home' ? 96 : 4;         // goal being attacked
  const ownX = team === 'home' ? 4 : 96;          // defending team's own goal
  const wallDir = Math.sign(ownX - 0);            // sign toward defending goal from mid
  const top = minute % 2 === 0;                   // pick a flank deterministically
  const fy = top ? 34 : 66;

  // generic shape: attackers push up, defenders drop toward their goal
  att.forEach((p, i) => { if (i > 0) p[0] = clampX(p[0] + dir * (i >= 8 ? 12 : i >= 5 ? 7 : 3)); });
  def.forEach((p, i) => { if (i > 0) p[0] = clampX(p[0] - dir * (i <= 4 ? 5 : 2)); });

  let ball: XY = [50, 50];
  let ref: XY = [50, 52];
  let poss = team;

  const wall = (players: XY[], idxs: number[], at: XY) => {
    const wd = Math.sign(ownX - at[0]);
    idxs.forEach((idx, k) => { players[idx] = [clampX(at[0] + wd * 9), clampY(at[1] + (k - (idxs.length - 1) / 2) * 5)]; });
  };
  void wallDir;

  switch (kind) {
    case 'calm':
    case 'mark':
      att.forEach((p, i) => { if (i > 0) p[0] = clampX(p[0] - dir * 3); });
      ball = [50, top ? 44 : 56];
      break;
    case 'buildup':
      ball = [clampX(50 + dir * 14), fy];
      att[10] = [clampX(ball[0] - dir * 3), ball[1]];      // carrier on the ball
      att[8] = [clampX(goalX - dir * 16), 40]; att[9] = [clampX(goalX - dir * 16), 60];
      break;
    case 'shot':
      ball = [clampX(goalX - dir * 15), top ? 44 : 56];
      att[10] = [clampX(ball[0] - dir * 4), ball[1]];      // shooter behind ball
      def[0] = [clampX(goalX - dir * 3), 50];              // keeper set
      break;
    case 'miss':
      ball = [def[0][0], def[0][1]];                       // keeper gathers -> restart
      poss = team === 'home' ? 'away' : 'home';
      break;
    case 'corner': {
      const cy = top ? 8 : 92;
      ball = [clampX(goalX - dir * 2), cy];
      att[7] = [clampX(goalX - dir * 4), cy];              // taker at the flag
      att[8] = [clampX(goalX - dir * 10), 42]; att[9] = [clampX(goalX - dir * 10), 58];
      att[10] = [clampX(goalX - dir * 14), 50]; att[5] = [clampX(goalX - dir * 18), 50];
      def[1] = [clampX(goalX - dir * 8), 42]; def[2] = [clampX(goalX - dir * 8), 58]; def[3] = [clampX(goalX - dir * 6), 50];
      def[0] = [clampX(goalX - dir * 3), 50];
      break;
    }
    case 'foul':
      ball = [clampX(50 + dir * 6), fy];
      wall(def, [5, 6, 7], ball);
      att[6] = [clampX(ball[0] - dir * 3), ball[1]];       // taker over the ball
      ref = [clampX(ball[0] - dir * 4), clampY(ball[1] + 7)];
      break;
    case 'freekick':
      ball = [clampX(goalX - dir * 22), top ? 42 : 58];
      wall(def, [1, 2, 3, 4], ball);
      def[0] = [clampX(goalX - dir * 3), 50];              // keeper on the line
      att[10] = [clampX(ball[0] - dir * 3), ball[1]];      // taker
      att[8] = [clampX(goalX - dir * 12), 42]; att[9] = [clampX(goalX - dir * 12), 58];
      ref = [clampX(ball[0] - dir * 4), clampY(ball[1] + 8)];
      break;
    case 'chance':
      ball = [clampX(goalX - dir * 12), top ? 44 : 56];
      att[10] = [ball[0], ball[1]];
      att[8] = [clampX(goalX - dir * 10), 42]; att[9] = [clampX(goalX - dir * 10), 58];
      def[1] = [clampX(goalX - dir * 7), 45]; def[2] = [clampX(goalX - dir * 7), 55];
      def[0] = [clampX(goalX - dir * 3), 50];
      break;
    case 'goal':
      ball = [clampX(goalX + dir * 1), 50];                // in the net
      att[8] = [clampX(goalX - dir * 8), 44]; att[9] = [clampX(goalX - dir * 10), 50];
      att[10] = [clampX(goalX - dir * 6), 56]; att[5] = [clampX(goalX - dir * 14), 50];
      def[0] = [clampX(goalX - dir * 2), 50];              // beaten keeper
      break;
    case 'card':
      ball = prev.ball;                                    // play stopped, ball where it was
      ref = [clampX(prev.ball[0]), clampY(prev.ball[1] - 4)];
      poss = prev.poss;
      break;
  }
  return { home, away, ref, ball, poss };
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

export default function PitchTV({
  home, away, hs, as, minute, phase, redHome, redAway, flashTeam, line,
}: {
  home: string; away: string; hs: number; as: number; minute: number;
  phase: 'upcoming' | 'live' | 'finished'; redHome: number; redAway: number;
  flashTeam: 'home' | 'away' | null;
  line: { kind: LineKind; team?: 'home' | 'away'; minute: number; sub: number } | null;
}) {
  const pitchRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<Model>({ home: clone(HOME_F), away: clone(AWAY_F), ref: [50, 52], ball: [50, 50], poss: 'home' });
  const kindRef = useRef<LineKind | null>(null);
  // set pieces / dead-ball moments: the ball stays on the spot until it's taken
  const DEAD_BALL = new Set<LineKind>(['foul', 'freekick', 'corner', 'goal', 'card']);
  const homeColor = teamColor(home);
  const awayColor = teamColor(away);
  const finished = phase === 'finished';

  const sentH = new Set(Array.from({ length: Math.min(redHome, 10) }, (_, i) => HOME_F.length - 1 - i));
  const sentA = new Set(Array.from({ length: Math.min(redAway, 10) }, (_, i) => AWAY_F.length - 1 - i));

  // write the model to the DOM (direct, so React never resets positions)
  const paint = () => {
    const root = pitchRef.current; if (!root) return;
    const m = modelRef.current;
    const put = (sel: string, xy: XY) => {
      const el = root.querySelector<HTMLElement>(sel);
      if (el) { el.style.left = `${xy[0]}%`; el.style.top = `${xy[1]}%`; }
    };
    m.home.forEach((p, i) => put(`[data-k="h${i}"]`, p));
    m.away.forEach((p, i) => put(`[data-k="a${i}"]`, p));
    put('[data-k="ref"]', m.ref);
    put('[data-k="ball"]', m.ball);
  };

  // initial paint + gentle possession loop (short passes to a nearby team-mate)
  useEffect(() => {
    paint();
    if (phase !== 'live') return;
    const id = window.setInterval(() => {
      const m = modelRef.current;
      // only pass the ball around in open play; set pieces hold until taken
      if (!DEAD_BALL.has(kindRef.current!)) {
        const squad = m.poss === 'home' ? m.home : m.away;
        const near = squad
          .map((p, i) => ({ i, d: Math.hypot(p[0] - m.ball[0], p[1] - m.ball[1]) }))
          .filter((o) => o.i > 0).sort((a, b) => a.d - b.d).slice(1, 4);
        if (near.length) {
          const tp = squad[near[Math.floor(Math.random() * near.length)].i];
          // most of the way to that team-mate (a pass), not on top of them
          m.ball = [clampX(m.ball[0] + (tp[0] - m.ball[0]) * 0.7), clampY(m.ball[1] + (tp[1] - m.ball[1]) * 0.7)];
        }
      }
      // tiny off-ball breathing (not chaos)
      for (const arr of [m.home, m.away]) for (let i = 1; i < arr.length; i++) {
        arr[i] = [clampX(arr[i][0] + (Math.random() - 0.5) * 2.4), clampY(arr[i][1] + (Math.random() - 0.5) * 2.4)];
      }
      paint();
    }, 2400);
    return () => clearInterval(id);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // enact each new commentary line as a scene
  useEffect(() => {
    if (!line || phase !== 'live' || line.team == null) return;
    modelRef.current = scene(line.kind, line.team, line.minute, modelRef.current);
    kindRef.current = line.kind;
    paint();
  }, [line?.minute, line?.sub, line?.kind]); // eslint-disable-line react-hooks/exhaustive-deps

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
