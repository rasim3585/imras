import { useEffect, useRef, useState } from 'react';
import { tennisFlowAt, tennisState, volleyState, type Side } from './tennisSim';

// Tennis / volleyball 2D live view. The ball now rallies across the net every
// frame (rAF) with a serve indicator, instead of a 1.6s toggle. Sets come from
// the SERVER (authoritative); the games/points (tennis) or set points
// (volleyball) below are presentational atmosphere, reset when the server's set
// count changes. Home baseline on the right.

export default function TennisTV({
  home, away, hs, as, period, phase, matchId, sport,
}: {
  home: string; away: string; hs: number; as: number;
  period: string | null; phase: 'upcoming' | 'live' | 'finished';
  matchId: string; sport: 'tennis' | 'volleyball';
}) {
  const finished = phase === 'finished';
  const live = phase === 'live';
  const ballRef = useRef<HTMLDivElement | null>(null);
  const [server, setServer] = useState<Side>('home');
  const [flash, setFlash] = useState<Side | null>(null);
  const [sub, setSub] = useState<{ games: [number, number]; point: string } | null>(null);
  const prev = useRef({ hs, as });
  const setStart = useRef(Date.now());
  const mount = useRef(Date.now());
  const sm = useRef<[number, number]>([160, 100]);   // eased ball pos

  // server won a set → flash + reset the presentational sub-score clock
  useEffect(() => {
    const dH = hs - prev.current.hs, dA = as - prev.current.as;
    prev.current = { hs, as };
    if (dH <= 0 && dA <= 0) return;
    setFlash(dH >= dA ? 'home' : 'away');
    setStart.current = Date.now();
    const t = setTimeout(() => setFlash(null), 1100);
    return () => clearTimeout(t);
  }, [hs, as]);

  // rally loop: ball + serve + sub-score
  useEffect(() => {
    if (!live) return;
    let raf = 0;
    const setIdx = hs + as;
    const step = () => {
      const t = (Date.now() - mount.current) / 1000;
      const inSet = (Date.now() - setStart.current) / 1000;
      const flow = tennisFlowAt(matchId, t);
      const s = sm.current; s[0] += (flow.x - s[0]) * 0.28; s[1] += (flow.y - s[1]) * 0.28;
      if (ballRef.current) { ballRef.current.style.left = `${(s[0] / 320) * 100}%`; ballRef.current.style.top = `${(s[1] / 200) * 100}%`; }
      setServer((v) => (v === flow.server ? v : flow.server));
      if (sport === 'volleyball') {
        const v = volleyState(matchId, setIdx, inSet);
        setSub({ games: v.points, point: '' });
      } else {
        const st = tennisState(matchId, setIdx, inSet);
        setSub({ games: st.games, point: st.point });
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [matchId, live, sport, hs, as]);

  const setsLabel = period ?? (sport === 'volleyball' ? 'Set 1' : 'Set 1');

  return (
    <div className={`court-tv tennis-tv ${finished ? 'is-fin' : ''}`}>
      <svg viewBox="0 0 320 200" className="court-svg" preserveAspectRatio="xMidYMid slice" aria-hidden>
        <rect x="0" y="0" width="320" height="200" fill="#2f7d6b" />
        <rect x="26" y="24" width="268" height="152" fill="#3f9c86" stroke="#eef7f2" strokeWidth="2" />
        <line x1="46" y1="24" x2="46" y2="176" stroke="#eef7f2" strokeWidth="1.5" opacity="0.8" />
        <line x1="274" y1="24" x2="274" y2="176" stroke="#eef7f2" strokeWidth="1.5" opacity="0.8" />
        <line x1="100" y1="46" x2="220" y2="46" stroke="#eef7f2" strokeWidth="1.5" opacity="0.7" />
        <line x1="100" y1="154" x2="220" y2="154" stroke="#eef7f2" strokeWidth="1.5" opacity="0.7" />
        <line x1="100" y1="46" x2="100" y2="154" stroke="#eef7f2" strokeWidth="1.5" opacity="0.7" />
        <line x1="220" y1="46" x2="220" y2="154" stroke="#eef7f2" strokeWidth="1.5" opacity="0.7" />
        <line x1="160" y1="46" x2="160" y2="154" stroke="#eef7f2" strokeWidth="1.5" opacity="0.7" />
        <line x1="160" y1="20" x2="160" y2="180" stroke="#0d3a30" strokeWidth="3" opacity="0.75" />
        <line x1="160" y1="20" x2="160" y2="180" stroke="#ffffff" strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
      </svg>

      <div ref={ballRef} className={`court-ball tennis-ball ${live ? 'live' : ''}`} style={{ left: '50%', top: '50%' }} aria-hidden />

      <div className="court-top">
        {finished ? <span className="court-clk fin">FT</span>
          : (
            <span className="court-clk">
              <span className="court-q">{setsLabel}</span>
              {live && sub && (
                <span className="tn-sub">
                  {' '}· {sub.games[0]}-{sub.games[1]}{sub.point ? ` (${sub.point})` : ''}
                </span>
              )}
            </span>
          )}
      </div>
      <div className="court-score">
        <span className={`court-name ${flash === 'home' ? 'lit' : ''}`}>{server === 'home' && live ? '● ' : ''}{home}</span>
        <span className="court-nums tnum">{hs} <span className="court-colon">:</span> {as}</span>
        <span className={`court-name ${flash === 'away' ? 'lit' : ''}`}>{away}{server === 'away' && live ? ' ●' : ''}</span>
      </div>
      {live && <div className="tn-setslabel">Sets</div>}
    </div>
  );
}
