import { useEffect, useRef } from 'react';
import { teamColor, teamInitial } from '../lib/teams';

// Rough 11-a-side layout (keeper + 10), percentages of the pitch. Not real
// tactics -- just a "full pitch" feel. Mirrors the approved mockup.
const HOME: [number, number][] = [[6, 48], [20, 20], [20, 40], [20, 58], [20, 78], [38, 30], [38, 50], [38, 70], [50, 38], [50, 62], [46, 48]];
const AWAY: [number, number][] = [[94, 48], [80, 20], [80, 40], [80, 58], [80, 78], [62, 30], [62, 50], [62, 70], [54, 40], [54, 60], [58, 50]];
const REF: [number, number] = [46, 52];

// PlayStation-flavoured symbols on each rail (virtual-game identity)
const PS = [
  { s: '▲', c: '#4fe89a' }, // triangle
  { s: '✕', c: '#e24b4a' }, // cross
  { s: '●', c: '#4aa3e2' }, // circle
  { s: '■', c: '#d4537e' }, // square
];

function Rail() {
  return (
    <div className="ps-rail" aria-hidden="true">
      {PS.map((p, i) => <span key={i} className="ps-sym" style={{ color: p.c, animationDelay: `${i * 0.4}s` }}>{p.s}</span>)}
    </div>
  );
}

export default function PitchTV({
  home, away, hs, as, minute, phase, redHome, redAway, flashTeam,
}: {
  home: string; away: string; hs: number; as: number; minute: number;
  phase: 'upcoming' | 'live' | 'finished'; redHome: number; redAway: number;
  flashTeam: 'home' | 'away' | null;
}) {
  const pitchRef = useRef<HTMLDivElement>(null);
  const homeColor = teamColor(home);
  const awayColor = teamColor(away);
  const finished = phase === 'finished';

  // sent-off = fade the last N outfield players of that side (visual only)
  const sentH = new Set(Array.from({ length: Math.min(redHome, 10) }, (_, i) => HOME.length - 1 - i));
  const sentA = new Set(Array.from({ length: Math.min(redAway, 10) }, (_, i) => AWAY.length - 1 - i));

  // decorative drift: move nodes directly via DOM (no React re-render / reset)
  useEffect(() => {
    const root = pitchRef.current;
    if (!root) return;
    const nodes = Array.from(root.querySelectorAll<HTMLElement>('.pitch-mover'));
    const timers = nodes.map((el) => {
      const bx = Number(el.dataset.x);
      const by = Number(el.dataset.y);
      const isBall = el.classList.contains('pitch-ball');
      el.style.left = `${bx}%`;
      el.style.top = `${by}%`;
      const step = () => {
        if (isBall) {
          el.style.left = `${20 + Math.random() * 60}%`;
          el.style.top = `${20 + Math.random() * 60}%`;
        } else {
          el.style.left = `${Math.max(2, Math.min(96, bx + (Math.random() - 0.5) * 8))}%`;
          el.style.top = `${Math.max(6, Math.min(90, by + (Math.random() - 0.5) * 8))}%`;
        }
      };
      return window.setInterval(step, isBall ? 1400 : 900 + Math.random() * 600);
    });
    return () => timers.forEach((t) => clearInterval(t));
  }, []);

  const player = (side: 'h' | 'a', i: number, pos: [number, number], color: string, sent: boolean) => (
    <div key={side + i} className={`pitch-mover pitch-player ${sent ? 'sent-off' : ''}`} data-x={pos[0]} data-y={pos[1]}>
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
            {HOME.map((p, i) => player('h', i, p, homeColor, sentH.has(i)))}
            {AWAY.map((p, i) => player('a', i, p, awayColor, sentA.has(i)))}
            <div className="pitch-mover pitch-player pitch-ref" data-x={REF[0]} data-y={REF[1]}>
              <span className="pp-body" /><span className="pp-feet"><i /><i /></span>
            </div>
            <div className="pitch-mover pitch-ball" data-x={48} data-y={48} />
          </div>
          <Rail />
        </div>
      </div>
    </div>
  );
}
