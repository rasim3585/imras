import { useEffect, useRef, useState } from 'react';
import { bballClock } from '../lib/format';
import { courtFlowAt, ambientPlay, type Side, type PlayType } from './courtSim';

// Basketball 2D live view. The ball now flows between the two hoops one
// possession at a time (courtSim) instead of teleporting — bring-up, attack,
// shot, transition — animated every frame. Made baskets come from the SERVER
// score and trigger a +2/+3 pop + rim flash. Home attacks the RIGHT hoop.

const PLAY_ICON: Record<PlayType, string> = {
  make2: '🏀', make3: '🎯', miss: '🧱', rebound: '🔁', steal: '🖐', foul: '⚠', block: '🛡', assist: '➡',
};
// 5-man home formation in court coords (0..320 × 0..200). Away mirrors on x.
const FORM_BB: [number, number][] = [[95, 100], [150, 60], [150, 140], [210, 85], [210, 135]];

export default function CourtTV({
  home, away, hs, as, period, minute, phase, matchId,
}: {
  home: string; away: string; hs: number; as: number;
  period: string | null; minute: number; phase: 'upcoming' | 'live' | 'finished'; matchId: string;
}) {
  const finished = phase === 'finished';
  const live = phase === 'live';
  const ballRef = useRef<HTMLDivElement | null>(null);
  const [side, setSide] = useState<Side>('home');
  const [flash, setFlash] = useState<Side | null>(null);
  const [pop, setPop] = useState<{ side: Side; pts: number; at: number } | null>(null);
  const [badge, setBadge] = useState<{ type: PlayType; side: Side; at: number } | null>(null);
  const prev = useRef({ hs, as });
  const ready = useRef(false);          // arm only after the first real score loads (no spurious +124 pop)
  const mount = useRef(Date.now());
  const shownBadge = useRef('');
  // on-score hold: freeze the ball AT the scoring hoop while the +pts pop shows,
  // so the animation and the ball describe the same moment (not opposite ends).
  const hold = useRef<{ until: number; x: number; y: number } | null>(null);
  const sm = useRef<[number, number]>([160, 100]);   // eased ball pos (court coords)
  const players = useRef<(HTMLDivElement | null)[]>([]);   // [0..4] home, [5..9] away

  // server basket → scorer flash + +pts pop
  useEffect(() => {
    const dH = hs - prev.current.hs, dA = as - prev.current.as;
    prev.current = { hs, as };
    if (!ready.current) { if (hs > 0 || as > 0) ready.current = true; return; }   // skip the initial data load
    if (dH <= 0 && dA <= 0) return;
    const scorer: Side = dH >= dA ? 'home' : 'away';
    const pts = Math.min(3, Math.max(dH, dA));   // a single possession is 1–3 pts
    setFlash(scorer);
    setPop({ side: scorer, pts, at: Date.now() });
    hold.current = { until: Date.now() + 1150, x: scorer === 'home' ? 300 : 20, y: 100 };  // ball → scoring hoop
    const t = setTimeout(() => setFlash(null), 900);
    return () => clearTimeout(t);
  }, [hs, as]);

  // animation loop: smooth ball + possession side + ambient badges
  useEffect(() => {
    if (!live) return;
    let raf = 0;
    const events = ambientPlay(matchId, 4000);
    const step = () => {
      const t = (Date.now() - mount.current) / 1000;
      const held = hold.current && Date.now() < hold.current.until ? hold.current : null;
      const flow = courtFlowAt(matchId, t);
      const tx = held ? held.x : flow.x, ty = held ? held.y : flow.y;
      const s = sm.current; s[0] += (tx - s[0]) * 0.2; s[1] += (ty - s[1]) * 0.2;
      if (ballRef.current) {
        ballRef.current.style.left = `${(s[0] / 320) * 100}%`;
        ballRef.current.style.top = `${(s[1] / 200) * 100}%`;
        ballRef.current.classList.toggle('shooting', !held && flow.phase === 'shot');
      }
      if (!held) {
        setSide((v) => (v === flow.side ? v : flow.side));
        const near = events.find((e) => Math.abs(e.sec - t) < 0.8);
        if (near && near.key !== shownBadge.current) { shownBadge.current = near.key; setBadge({ type: near.type, side: near.side, at: Date.now() }); }
      }
      // players follow the ball across the court
      const shift = (s[0] - 160) * 0.55;
      for (let i = 0; i < 5; i++) {
        const nx = Math.sin(t * 0.9 + i) * 8, ny = Math.cos(t * 0.7 + i * 1.3) * 9;
        const ph = players.current[i], pa = players.current[5 + i];
        if (ph) { ph.style.left = `${(Math.max(30, Math.min(300, FORM_BB[i][0] + shift + nx)) / 320) * 100}%`; ph.style.top = `${(Math.max(30, Math.min(170, FORM_BB[i][1] + ny)) / 200) * 100}%`; }
        if (pa) { pa.style.left = `${(Math.max(20, Math.min(290, 320 - FORM_BB[i][0] + shift + nx)) / 320) * 100}%`; pa.style.top = `${(Math.max(30, Math.min(170, FORM_BB[i][1] - ny)) / 200) * 100}%`; }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [matchId, live]);

  useEffect(() => { if (!pop) return; const id = setTimeout(() => setPop((p) => (p && p.at === pop.at ? null : p)), 1400); return () => clearTimeout(id); }, [pop]);
  useEffect(() => { if (!badge) return; const id = setTimeout(() => setBadge((b) => (b && b.at === badge.at ? null : b)), 2200); return () => clearTimeout(id); }, [badge]);

  const clock = finished ? '' : bballClock(minute, period);

  return (
    <div className={`court-tv ${finished ? 'is-fin' : ''}`}>
      <svg viewBox="0 0 320 200" className="court-svg" preserveAspectRatio="xMidYMid slice" aria-hidden>
        <rect x="0" y="0" width="320" height="200" fill="#b9743a" />
        <rect x="8" y="8" width="304" height="184" fill="none" stroke="#f2e4d0" strokeWidth="2" opacity="0.85" />
        <line x1="160" y1="8" x2="160" y2="192" stroke="#f2e4d0" strokeWidth="2" opacity="0.85" />
        <circle cx="160" cy="100" r="26" fill="none" stroke="#f2e4d0" strokeWidth="2" opacity="0.85" />
        <path d="M8 52 A 78 78 0 0 1 8 148" fill="none" stroke="#f2e4d0" strokeWidth="2" opacity="0.55" />
        <path d="M312 52 A 78 78 0 0 0 312 148" fill="none" stroke="#f2e4d0" strokeWidth="2" opacity="0.55" />
        <rect x="8" y="66" width="46" height="68" fill="none" stroke="#f2e4d0" strokeWidth="2" opacity="0.7" />
        <rect x="266" y="66" width="46" height="68" fill="none" stroke="#f2e4d0" strokeWidth="2" opacity="0.7" />
        <circle cx="54" cy="100" r="14" fill="none" stroke="#f2e4d0" strokeWidth="1.5" opacity="0.5" />
        <circle cx="266" cy="100" r="14" fill="none" stroke="#f2e4d0" strokeWidth="1.5" opacity="0.5" />
        <circle cx="20" cy="100" r="6" fill="none" stroke="#ff7043" strokeWidth="2.5" className={flash === 'away' ? 'rim-lit' : ''} />
        <circle cx="300" cy="100" r="6" fill="none" stroke="#ff7043" strokeWidth="2.5" className={flash === 'home' ? 'rim-lit' : ''} />
      </svg>

      {live && <div className={`court-poss ${side}`} />}
      {live && (
        <div className="court-players">
          {FORM_BB.map((_, i) => <div key={`h${i}`} ref={(el) => { players.current[i] = el; }} className="court-player home" />)}
          {FORM_BB.map((_, i) => <div key={`a${i}`} ref={(el) => { players.current[5 + i] = el; }} className="court-player away" />)}
        </div>
      )}
      <div ref={ballRef} className={`court-ball ${live ? 'live' : ''}`} style={{ left: '50%', top: '50%' }} aria-hidden />

      {badge && (
        <div className={`pev pev-${badge.type} ${badge.side}`} key={badge.at}>
          <span className="pev-i">{PLAY_ICON[badge.type]}</span>
        </div>
      )}
      {pop && <div className={`court-pop ${pop.side}`} key={pop.at}>+{pop.pts}</div>}

      <div className="court-top">
        {finished ? <span className="court-clk fin">FT</span>
          : <span className="court-clk court-q">{clock}</span>}
      </div>
      <div className="court-score">
        <span className={`court-name ${flash === 'home' ? 'lit' : ''}`}>{home}</span>
        <span className="court-nums tnum">{hs} <span className="court-colon">:</span> {as}</span>
        <span className={`court-name ${flash === 'away' ? 'lit' : ''}`}>{away}</span>
      </div>
    </div>
  );
}
