import { useEffect, useRef, useState } from 'react';
import { bballClock } from '../lib/format';

// Basketbol 2D canlı izleme (Nesine basket sahası esinli; futbol PitchTV'nin
// basket karşılığı). Saf görsel: canlı skor + çeyrek/saat + hafif top hareketi +
// sayı değişince o tarafın flaşı. Gerçek pozisyon verisi yok — top ritmik gezer,
// sayı geldiğinde atan taraf parlar (izleme hissi, veri uydurmadan).

export default function CourtTV({
  home, away, hs, as, period, minute, phase,
}: {
  home: string; away: string; hs: number; as: number;
  period: string | null; minute: number; phase: 'upcoming' | 'live' | 'finished';
}) {
  const finished = phase === 'finished';
  const live = phase === 'live';
  const [side, setSide] = useState<'home' | 'away'>('home');   // topun bulunduğu yarı
  const [flash, setFlash] = useState<'home' | 'away' | null>(null);
  const prev = useRef({ hs, as });

  // top ritmik olarak yarı değiştirir (izleme hissi)
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setSide((s) => (s === 'home' ? 'away' : 'home')), 2600);
    return () => clearInterval(id);
  }, [live]);

  // sayı geldi → atan taraf parlar + top o tarafa
  useEffect(() => {
    const dH = hs - prev.current.hs, dA = as - prev.current.as;
    if (dH > 0 || dA > 0) {
      const scorer = dH >= dA ? 'home' : 'away';
      setFlash(scorer); setSide(scorer === 'home' ? 'away' : 'home');   // sayıdan sonra rakip topu alır
      const t = setTimeout(() => setFlash(null), 900);
      prev.current = { hs, as };
      return () => clearTimeout(t);
    }
    prev.current = { hs, as };
  }, [hs, as]);

  const clock = finished ? '' : bballClock(minute, period);

  return (
    <div className={`court-tv ${finished ? 'is-fin' : ''}`}>
      <svg viewBox="0 0 320 200" className="court-svg" preserveAspectRatio="xMidYMid slice" aria-hidden>
        <rect x="0" y="0" width="320" height="200" fill="#b9743a" />
        <rect x="8" y="8" width="304" height="184" fill="none" stroke="#f2e4d0" strokeWidth="2" opacity="0.85" />
        <line x1="160" y1="8" x2="160" y2="192" stroke="#f2e4d0" strokeWidth="2" opacity="0.85" />
        <circle cx="160" cy="100" r="26" fill="none" stroke="#f2e4d0" strokeWidth="2" opacity="0.85" />
        {/* keys + hoops */}
        <rect x="8" y="66" width="46" height="68" fill="none" stroke="#f2e4d0" strokeWidth="2" opacity="0.7" />
        <rect x="266" y="66" width="46" height="68" fill="none" stroke="#f2e4d0" strokeWidth="2" opacity="0.7" />
        <circle cx="20" cy="100" r="6" fill="none" stroke="#ff7043" strokeWidth="2.5" />
        <circle cx="300" cy="100" r="6" fill="none" stroke="#ff7043" strokeWidth="2.5" />
      </svg>

      {/* possession glow */}
      {live && <div className={`court-poss ${side}`} />}

      {/* ball */}
      <div className={`court-ball ${live ? 'live' : ''} ${side}`} aria-hidden />

      {/* score + clock overlay */}
      <div className="court-top">
        {finished ? <span className="court-clk fin">FT</span>
          : <span className="court-clk"><span className="court-q">{period ?? 'Q1'}</span> {clock}</span>}
      </div>
      <div className="court-score">
        <span className={`court-name ${flash === 'home' ? 'lit' : ''}`}>{home}</span>
        <span className="court-nums tnum">{hs} <span className="court-colon">:</span> {as}</span>
        <span className={`court-name ${flash === 'away' ? 'lit' : ''}`}>{away}</span>
      </div>
    </div>
  );
}
