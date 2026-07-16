import { useEffect, useRef, useState } from 'react';
import { rallyFlowAt, rallyState, setClockSec, seedSetClock, periodPoints, resetSetsFrom, type Side } from './tennisSim';
import { Confetti } from './PitchTV';

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
  // GÖSTERİLEN set skoru: sunucu seti bitirdiğinde flaş+tabela, top ÖLÜNCE
  // birlikte yanar (ralli ortasında set kutlaması olmaz — basketle aynı ilke).
  const [shown, setShown] = useState({ hs, as });
  const prev = useRef({ matchId, hs, as });
  const pendingFlash = useRef<{ side: Side; at: number } | null>(null);
  const wasLive = useRef(false);                 // finished geçişinde son set kutlaması için
  const flashTimer = useRef<number | null>(null); // art arda setlerde ilk timer yenisini söndürmesin
  const ready = useRef(false);          // arm after first real score (no spurious flash on load)
  const subKey = useRef('');
  const sm = useRef<[number, number]>([160, 100]);   // eased ball pos (oyuncu YOK — sadece top)

  // server won a set → beklet: top ölünce flaş + tabela (rAF loop ateşler)
  useEffect(() => {
    // maç değişimi: eski maçın seti/flaşı yeni maça sızamaz
    if (prev.current.matchId !== matchId) {
      prev.current = { matchId, hs, as };
      ready.current = live || hs > 0 || as > 0;
      pendingFlash.current = null;
      wasLive.current = live;
      setShown({ hs, as }); setFlash(null);
      return;
    }
    const dH = hs - prev.current.hs, dA = as - prev.current.as;
    prev.current = { matchId, hs, as };
    // ready = İLK CANLI snapshot (0-0 dahil): 0-0'dan izleyen kullanıcı İLK set
    // kutlamasını da görür (eski skor-kapısı ilk seti sessizce yutuyordu)
    if (!ready.current) { if (live || hs > 0 || as > 0) { ready.current = true; setShown({ hs, as }); } return; }
    if (!live) {
      // maçı bitiren SON set: finished snapshot'ıyla gelir — şampiyonluk sayısı
      // kutlamasız geçmesin (rAF durduğu için pendingFlash yolu çalışmaz)
      if (wasLive.current && ready.current && (dH > 0 || dA > 0)) {
        setFlash(dH >= dA ? 'home' : 'away');
        if (flashTimer.current) clearTimeout(flashTimer.current);
        flashTimer.current = window.setTimeout(() => setFlash(null), 1100);
      }
      wasLive.current = false;
      pendingFlash.current = null;
      setShown({ hs, as });
      return;
    }
    wasLive.current = true;
    // azalış (düzeltme): kutlamasız gerçeğe kilitlen + eski setlerin saat/cache
    // artıkları temizlensin (sunucu aynı set numarasına dönerse saat sıfırdan)
    if (dH < 0 || dA < 0) {
      pendingFlash.current = null;
      resetSetsFrom(matchId, hs + as);
      setShown({ hs, as });
      return;
    }
    if (dH <= 0 && dA <= 0) return;
    pendingFlash.current = { side: dH >= dA ? 'home' : 'away', at: Date.now() };
  }, [matchId, hs, as, live]);

  // rally loop: ball + serve + sub-score — one clock, one rally list
  useEffect(() => {
    if (!live) return;
    let raf = 0;
    const setIdx = hs + as;
    // sete ORTADAN katılım: sunucunun set-içi sayısına göre saat tohumla —
    // merdiven 0-0'dan değil gerçekten bulunulan yerden akar (idempotent)
    seedSetClock(matchId, setIdx, sport, periodPoints(period));
    const step = () => {
      const t = setClockSec(matchId, setIdx);
      const flow = rallyFlowAt(matchId, setIdx, sport, t);
      const s = sm.current; s[0] += (flow.x - s[0]) * 0.28; s[1] += (flow.y - s[1]) * 0.28;
      if (ballRef.current) { ballRef.current.style.left = `${(s[0] / 320) * 100}%`; ballRef.current.style.top = `${(s[1] / 200) * 100}%`; }
      setServer((v) => (v === flow.server ? v : flow.server));
      const st = rallyState(matchId, setIdx, sport, t);
      const k = `${st.games[0]}-${st.games[1]}:${st.point}`;
      // set bittiyse "(0 - 0)" yanılgısı basma — set arası puan boş
      if (k !== subKey.current) { subKey.current = k; setSub({ games: st.games, point: st.setOver ? '' : st.point }); }
      // bekleyen set kutlaması: top ölü (sayı bitti) ya da 3sn tavan → şimdi yanar
      const pf = pendingFlash.current;
      if (pf && (flow.dead || Date.now() - pf.at > 3000)) {
        pendingFlash.current = null;
        setShown({ hs, as });
        setFlash(pf.side);
        if (flashTimer.current) clearTimeout(flashTimer.current);
        flashTimer.current = window.setTimeout(() => setFlash(null), 1100);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      if (flashTimer.current) { clearTimeout(flashTimer.current); flashTimer.current = null; }
    };
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

      <div ref={ballRef} className={`court-ball tennis-ball ${live ? 'live' : ''}`} style={{ left: '50%', top: '50%' }} aria-hidden />

      {flash && <Confetti />}

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
        <span className={`court-nums tnum ${flash ? 'score-shake' : ''}`}>
          {live ? shown.hs : hs} <span className="court-colon">:</span> {live ? shown.as : as}
        </span>
        <span className={`court-name ${flash === 'away' ? 'lit' : ''}`}>{away}{server === 'away' && live ? ' ●' : ''}</span>
      </div>
      {live && <div className="tn-setslabel">Sets</div>}
    </div>
  );
}
