import { useEffect, useRef, useState } from 'react';
import { rallyFlowAt, rallyState, setClockSec, type Side } from './tennisSim';

// Tennis / volleyball 2D live view. Ball, serve dot and the games/points ladder
// all read the SAME rally list on the SAME shared set clock (tennisSim): the
// rally plays out, the ball lies DEAD ≈2.2s where the point ended, and the
// ladder ticks at that exact moment. Sets come from the SERVER (authoritative);
// everything inside a set is presentational and resets when the set count
// changes. Home baseline on the right.

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
  const ready = useRef(false);          // arm after first real score (no spurious flash on load)
  const subKey = useRef('');
  const sm = useRef<[number, number]>([160, 100]);   // eased ball pos
  const pl = useRef<(HTMLDivElement | null)[]>([]);  // [0..N-1] home, [N..] away
  const nPl = sport === 'volleyball' ? 3 : 1;        // 3 per side (volley) / 1 (tennis)

  // server won a set → flash (the set clock resets itself via setIdx)
  useEffect(() => {
    const dH = hs - prev.current.hs, dA = as - prev.current.as;
    prev.current = { hs, as };
    if (!ready.current) { if (hs > 0 || as > 0) ready.current = true; return; }
    if (dH <= 0 && dA <= 0) return;
    setFlash(dH >= dA ? 'home' : 'away');
    const t = setTimeout(() => setFlash(null), 1100);
    return () => clearTimeout(t);
  }, [hs, as]);

  // rally loop: ball + serve + sub-score — one clock, one rally list
  useEffect(() => {
    if (!live) return;
    let raf = 0;
    const setIdx = hs + as;
    const step = () => {
      const t = setClockSec(matchId, setIdx);
      const flow = rallyFlowAt(matchId, setIdx, sport, t);
      const s = sm.current; s[0] += (flow.x - s[0]) * 0.28; s[1] += (flow.y - s[1]) * 0.28;
      if (ballRef.current) { ballRef.current.style.left = `${(s[0] / 320) * 100}%`; ballRef.current.style.top = `${(s[1] / 200) * 100}%`; }
      // players: tennis = 1 at baseline tracking the ball; volleyball = 3 per side
      // in a front row near the net, the block sliding with the ball.
      for (let i = 0; i < nPl; i++) {
        let hx: number, hy: number, ax: number, ay: number;
        if (sport === 'volleyball') {
          const baseY = 55 + i * 45, yShift = (s[1] - 100) * 0.25;
          hy = baseY + yShift; ay = baseY + yShift;
          hx = 202 + Math.sin(t * 0.8 + i) * 6; ax = 118 + Math.cos(t * 0.8 + i) * 6;
        } else {
          hy = 100 + (s[1] - 100) * 0.55; ay = hy;
          hx = 288 - Math.max(0, 200 - s[0]) * 0.08; ax = 32 + Math.max(0, s[0] - 120) * 0.08;
        }
        const ph = pl.current[i], pa = pl.current[nPl + i];
        if (ph) { ph.style.left = `${(hx / 320) * 100}%`; ph.style.top = `${(hy / 200) * 100}%`; }
        if (pa) { pa.style.left = `${(ax / 320) * 100}%`; pa.style.top = `${(ay / 200) * 100}%`; }
      }
      setServer((v) => (v === flow.server ? v : flow.server));
      const st = rallyState(matchId, setIdx, sport, t);
      const k = `${st.games[0]}-${st.games[1]}:${st.point}`;
      if (k !== subKey.current) { subKey.current = k; setSub({ games: st.games, point: st.point }); }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [matchId, live, sport, hs, as]); // eslint-disable-line react-hooks/exhaustive-deps

  // full-time: ball rests on the net line centre
  useEffect(() => {
    if (finished && ballRef.current) { ballRef.current.style.left = '50%'; ballRef.current.style.top = '50%'; sm.current = [160, 100]; }
  }, [finished]);

  // server period also carries its own in-set points ("Set 4 · 2-1") on a
  // different schedule than the rally animation — show only "Set N" and let the
  // rally-locked ladder below be the single in-set story (sets stay server-truth)
  const setsLabel = (period ?? 'Set 1').split('·')[0].trim();

  return (
    <div className={`court-tv tennis-tv ${finished ? 'is-fin' : ''}`}>
      {sport === 'volleyball' ? (
        <svg viewBox="0 0 320 200" className="court-svg" preserveAspectRatio="xMidYMid slice" aria-hidden>
          {/* indoor volleyball: blue surround, orange court, 3m attack lines */}
          <rect x="0" y="0" width="320" height="200" fill="#234f66" />
          <rect x="48" y="30" width="224" height="140" fill="#c8793f" stroke="#f4efe7" strokeWidth="2" />
          <line x1="123" y1="30" x2="123" y2="170" stroke="#f4efe7" strokeWidth="1.5" opacity="0.75" strokeDasharray="5 4" />
          <line x1="197" y1="30" x2="197" y2="170" stroke="#f4efe7" strokeWidth="1.5" opacity="0.75" strokeDasharray="5 4" />
          <line x1="160" y1="30" x2="160" y2="170" stroke="#f4efe7" strokeWidth="1.5" opacity="0.9" />
          <line x1="160" y1="16" x2="160" y2="184" stroke="#0d2a36" strokeWidth="4" opacity="0.8" />
          <line x1="160" y1="16" x2="160" y2="184" stroke="#ffffff" strokeWidth="1" strokeDasharray="3 3" opacity="0.65" />
        </svg>
      ) : (
        <svg viewBox="0 0 320 200" className="court-svg" preserveAspectRatio="xMidYMid slice" aria-hidden>
          {/* tennis: doubles rect, singles sidelines, service boxes with the
              CENTRE service line, baseline centre marks */}
          <rect x="0" y="0" width="320" height="200" fill="#2f7d6b" />
          <rect x="26" y="24" width="268" height="152" fill="#3f9c86" stroke="#eef7f2" strokeWidth="2" />
          <line x1="26" y1="44" x2="294" y2="44" stroke="#eef7f2" strokeWidth="1.5" opacity="0.8" />
          <line x1="26" y1="156" x2="294" y2="156" stroke="#eef7f2" strokeWidth="1.5" opacity="0.8" />
          <line x1="100" y1="44" x2="100" y2="156" stroke="#eef7f2" strokeWidth="1.5" opacity="0.75" />
          <line x1="220" y1="44" x2="220" y2="156" stroke="#eef7f2" strokeWidth="1.5" opacity="0.75" />
          <line x1="100" y1="100" x2="220" y2="100" stroke="#eef7f2" strokeWidth="1.5" opacity="0.75" />
          <line x1="26" y1="100" x2="32" y2="100" stroke="#eef7f2" strokeWidth="1.5" opacity="0.8" />
          <line x1="288" y1="100" x2="294" y2="100" stroke="#eef7f2" strokeWidth="1.5" opacity="0.8" />
          <line x1="160" y1="20" x2="160" y2="180" stroke="#0d3a30" strokeWidth="3" opacity="0.75" />
          <line x1="160" y1="20" x2="160" y2="180" stroke="#ffffff" strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
        </svg>
      )}

      {live && Array.from({ length: nPl }).map((_, i) => <div key={`h${i}`} ref={(el) => { pl.current[i] = el; }} className="court-player home" style={{ left: '85%', top: '50%' }} />)}
      {live && Array.from({ length: nPl }).map((_, i) => <div key={`a${i}`} ref={(el) => { pl.current[nPl + i] = el; }} className="court-player away" style={{ left: '15%', top: '50%' }} />)}
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
