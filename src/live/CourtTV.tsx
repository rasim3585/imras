import { useEffect, useRef, useState } from 'react';
import { bballClock } from '../lib/format';
import { courtBallAt, activeCourtEvent, type Side, type PlayType } from './courtSim';

// Basketball 2D live view driven by the possession sim (courtSim) on the MATCH
// clock: the ball, the badge and the possession side come from the same
// timeline, and each ambient event HOLDS the ball ≈2.2s at its spot (miss at
// the rim, steal where it happened, foul on the drive). Made baskets come from
// the SERVER score: +pts pop, rim flash and the ball held at the scoring hoop
// ≥2s. Home attacks the RIGHT hoop.

const PLAY_ICON: Record<PlayType, string> = { miss: '🧱', steal: '🖐', foul: '⚠', block: '🛡' };
const PLAY_LABEL: Record<PlayType, string> = { miss: 'Miss', steal: 'Steal', foul: 'Foul', block: 'Block' };

export default function CourtTV({
  home, away, hs, as, period, minute, phase, matchId, dur, getClock,
}: {
  home: string; away: string; hs: number; as: number;
  period: string | null; minute: number; phase: 'upcoming' | 'live' | 'finished';
  matchId: string; dur: number; getClock: () => number;
}) {
  const finished = phase === 'finished';
  const live = phase === 'live';
  const ballRef = useRef<HTMLDivElement | null>(null);
  const [side, setSide] = useState<Side>('home');
  const [flash, setFlash] = useState<Side | null>(null);
  const [pops, setPops] = useState<{ id: number; side: Side; pts: number }[]>([]);
  const [badge, setBadge] = useState<{ type: PlayType; side: Side } | null>(null);
  const prev = useRef({ hs, as });
  const ready = useRef(false);          // arm only after the first real score loads (no spurious +124 pop)
  const popId = useRef(0);
  const shownBadge = useRef('');
  // server make → freeze the ball AT the scoring hoop (real ms, ≥2s legible)
  const hold = useRef<{ until: number; x: number; y: number; side: Side } | null>(null);
  const sm = useRef<[number, number]>([160, 100]);   // eased ball pos (court coords)

  // server basket → scorer flash + +pts pop + ball held at the hoop
  useEffect(() => {
    const dH = hs - prev.current.hs, dA = as - prev.current.as;
    prev.current = { hs, as };
    if (!ready.current) { if (hs > 0 || as > 0) ready.current = true; return; }   // skip the initial data load
    if (dH <= 0 && dA <= 0) return;
    // her artan takim icin ayri pop (ikisi de attiysa ikisi de gorunur, biri kacmaz)
    const fresh: { id: number; side: Side; pts: number }[] = [];
    if (dH > 0) fresh.push({ id: ++popId.current, side: 'home', pts: Math.min(6, dH) });
    if (dA > 0) fresh.push({ id: ++popId.current, side: 'away', pts: Math.min(6, dA) });
    const scorer: Side = dH >= dA ? 'home' : 'away';
    setFlash(scorer);
    setPops((p) => [...p, ...fresh]);
    hold.current = { until: Date.now() + 2200, x: scorer === 'home' ? 300 : 20, y: 100, side: scorer };
    const ids = fresh.map((f) => f.id);
    const tf = setTimeout(() => setFlash(null), 1200);
    const tp = setTimeout(() => setPops((p) => p.filter((x) => !ids.includes(x.id))), 2200);
    return () => { clearTimeout(tf); clearTimeout(tp); };
  }, [hs, as]);

  // animation loop: ball + badge + possession side from the SAME sim clock
  useEffect(() => {
    if (!live) return;
    hold.current = null;               // stale make-hold must not leak between matches
    let raf = 0;
    const step = () => {
      const clock = getClock();
      const mh = hold.current && Date.now() < hold.current.until ? hold.current : null;
      const ev = mh ? null : activeCourtEvent(matchId, clock, dur);
      const b = courtBallAt(matchId, clock, dur);
      const tx = mh ? mh.x : b.x, ty = mh ? mh.y : b.y;
      const s = sm.current; s[0] += (tx - s[0]) * 0.2; s[1] += (ty - s[1]) * 0.2;
      if (ballRef.current) {
        ballRef.current.style.left = `${(s[0] / 320) * 100}%`;
        ballRef.current.style.top = `${(s[1] / 200) * 100}%`;
        ballRef.current.classList.toggle('shooting', !mh && b.moving);
      }
      const sideNow: Side = mh ? mh.side : b.side;
      setSide((v) => (v === sideNow ? v : sideNow));
      const bk = ev ? ev.key : '';
      if (bk !== shownBadge.current) { shownBadge.current = bk; setBadge(ev ? { type: ev.type, side: ev.side } : null); }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [matchId, live, dur, getClock]);

  // full-time: ball rests at centre court, no lingering badge
  useEffect(() => {
    if (!finished) return;
    if (ballRef.current) { ballRef.current.style.left = '50%'; ballRef.current.style.top = '50%'; sm.current = [160, 100]; }
    shownBadge.current = ''; setBadge(null);
  }, [finished]);

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
      <div ref={ballRef} className={`court-ball ${live ? 'live' : ''}`} style={{ left: '50%', top: '50%' }} aria-hidden />

      {badge && (
        <div className={`pev pev-${badge.type} ${badge.side}`} key={`${badge.type}${badge.side}`}>
          <span className="pev-i">{PLAY_ICON[badge.type]}</span>
          <span className="pev-t">{PLAY_LABEL[badge.type]}</span>
        </div>
      )}
      {pops.map((p) => <div key={p.id} className={`court-pop ${p.side}`}>+{p.pts}</div>)}

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
