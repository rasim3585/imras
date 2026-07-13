import { useEffect, useRef, useState } from 'react';

// Tenis 2D canlı izleme (Nesine tenis kortu esinli; CourtTV'nin tenis karşılığı).
// Saf görsel: canlı skor + set + top file üstünden gidip gelir + servis göstergesi.
// Gerçek vuruş verisi yok — top ritmik gezer, skor değişince o taraf parlar.

export default function TennisTV({
  home, away, hs, as, period, phase,
}: {
  home: string; away: string; hs: number; as: number;
  period: string | null; phase: 'upcoming' | 'live' | 'finished';
}) {
  const finished = phase === 'finished';
  const live = phase === 'live';
  const [side, setSide] = useState<'home' | 'away'>('home');
  const [flash, setFlash] = useState<'home' | 'away' | null>(null);
  const prev = useRef({ hs, as });

  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setSide((s) => (s === 'home' ? 'away' : 'home')), 1600);
    return () => clearInterval(id);
  }, [live]);

  useEffect(() => {
    const dH = hs - prev.current.hs, dA = as - prev.current.as;
    if (dH > 0 || dA > 0) {
      const w = dH >= dA ? 'home' : 'away';
      setFlash(w);
      const t = setTimeout(() => setFlash(null), 900);
      prev.current = { hs, as };
      return () => clearTimeout(t);
    }
    prev.current = { hs, as };
  }, [hs, as]);

  return (
    <div className={`court-tv tennis-tv ${finished ? 'is-fin' : ''}`}>
      <svg viewBox="0 0 320 200" className="court-svg" preserveAspectRatio="xMidYMid slice" aria-hidden>
        <rect x="0" y="0" width="320" height="200" fill="#2f7d6b" />
        <rect x="26" y="24" width="268" height="152" fill="#3f9c86" stroke="#eef7f2" strokeWidth="2" />
        {/* singles sidelines + service lines + centre */}
        <line x1="46" y1="24" x2="46" y2="176" stroke="#eef7f2" strokeWidth="1.5" opacity="0.8" />
        <line x1="274" y1="24" x2="274" y2="176" stroke="#eef7f2" strokeWidth="1.5" opacity="0.8" />
        <line x1="100" y1="46" x2="220" y2="46" stroke="#eef7f2" strokeWidth="1.5" opacity="0.7" />
        <line x1="100" y1="154" x2="220" y2="154" stroke="#eef7f2" strokeWidth="1.5" opacity="0.7" />
        <line x1="100" y1="46" x2="100" y2="154" stroke="#eef7f2" strokeWidth="1.5" opacity="0.7" />
        <line x1="220" y1="46" x2="220" y2="154" stroke="#eef7f2" strokeWidth="1.5" opacity="0.7" />
        <line x1="160" y1="46" x2="160" y2="154" stroke="#eef7f2" strokeWidth="1.5" opacity="0.7" />
        {/* net */}
        <line x1="160" y1="20" x2="160" y2="180" stroke="#0d3a30" strokeWidth="3" opacity="0.75" />
        <line x1="160" y1="20" x2="160" y2="180" stroke="#ffffff" strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
      </svg>

      <div className={`court-ball tennis-ball ${live ? 'live' : ''} ${side}`} aria-hidden />

      <div className="court-top">
        {finished ? <span className="court-clk fin">FT</span>
          : <span className="court-clk"><span className="court-q">{period ?? 'Set 1'}</span></span>}
      </div>
      <div className="court-score">
        <span className={`court-name ${flash === 'home' ? 'lit' : ''}`}>{home}</span>
        <span className="court-nums tnum">{hs} <span className="court-colon">:</span> {as}</span>
        <span className={`court-name ${flash === 'away' ? 'lit' : ''}`}>{away}</span>
      </div>
    </div>
  );
}
