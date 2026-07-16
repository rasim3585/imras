import { useEffect, useRef, useState } from 'react';
import { bballClock } from '../lib/format';
import { courtBallAt, activeCourtEvent, BB_R3, BB_FT, type Side, type PlayType } from './courtSim';
import { Confetti } from './PitchTV';

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
  // GÖSTERİLEN skor: sunucu skoru DEĞİL — tabela, top potaya varınca artar
  // (Aviator "kullanıcının gördüğü değer" felsefesi). Sunucu her zaman önde
  // olabilir; fark make kuyruğunda bekler.
  const [shown, setShown] = useState({ hs, as });
  const prev = useRef({ matchId, hs, as });
  const ready = useRef(false);          // arm only after the first real score loads (no spurious +124 pop)
  const popId = useRef(0);
  const shownBadge = useRef('');
  // SAYI KUYRUĞU + varışa-bağlı koreografi durum makinesi (v2):
  //   spot  → top sayının menziline gider (1=faul çizgisi, 2=içeride, 3=çember dışı)
  //   fly   → potaya uçar; POTAYA FİİLEN VARINCA (mesafe<10) pop+flaş+tabela AYNI karede
  //   hold  → potada ~650ms okunur bekleme, sonra sıradaki sayı
  // Duvar saati tetiği YOK — pop, top neredeyse orada patlar; kuyruk sayesinde
  // ardışık sayılar üst üste yazılmaz. Kuyruk taşarsa (arka plan sekmesi dönüşü)
  // eski sayılar dramasız tabelaya işlenir, son 2'si oynatılır.
  interface Make { side: Side; pts: number; spot: { x: number; y: number } }
  const queue = useRef<Make[]>([]);
  const active = useRef<(Make & { stage: 'spot' | 'fly' | 'hold'; stageT: number }) | null>(null);
  const sm = useRef<[number, number]>([160, 100]);   // eased ball pos (court coords)
  const simFor = useRef(matchId);

  // sunucu farkını kuyruğa çevir (drama loop'ta oynar)
  useEffect(() => {
    // MAÇ DEĞİŞTİ (mini izleme başka seçime geçebilir): eski maçın skoru/
    // draması yeni maça sızamaz — her şey yeni maçın gerçeğine sıfırlanır.
    if (prev.current.matchId !== matchId) {
      prev.current = { matchId, hs, as };
      ready.current = live || hs > 0 || as > 0;
      queue.current = []; active.current = null;
      setShown({ hs, as }); setPops([]); setFlash(null);
      return;
    }
    const dH = hs - prev.current.hs, dA = as - prev.current.as;
    prev.current = { matchId, hs, as };
    // ready = İLK CANLI snapshot (0-0 dahil): canlı 0-0'dan izleyen kullanıcı
    // ilk basketin dramasını da görür; ortadan katılan taban çizgisiyle senkron
    if (!ready.current) { if (live || hs > 0 || as > 0) { ready.current = true; setShown({ hs, as }); } return; }
    if (!live) { setShown({ hs, as }); return; }
    // sunucu skoru AZALDIYSA (düzeltme/void): drama iptal, gerçeğe kilitlen —
    // aksi halde gösterilen skor sonsuza dek sapardı
    if (dH < 0 || dA < 0) {
      queue.current = []; active.current = null;
      setShown({ hs, as });
      return;
    }
    const push = (sideK: Side, pts: number) => {
      const hoopX = sideK === 'home' ? 300 : 20;
      const dir = sideK === 'home' ? 1 : -1;
      const sy = 100 + (Math.random() * 44 - 22);
      const spot = pts === 1 ? { x: hoopX - dir * BB_FT, y: 100 }
        : pts >= 3 ? { x: hoopX - dir * (BB_R3 + 9), y: sy }
        : { x: hoopX - dir * (18 + Math.random() * 16), y: sy };
      queue.current.push({ side: sideK, pts, spot });
    };
    // artışları gerçekçi sayı paketlerine böl (ör. +5 → 3+2): her paket ayrı drama
    const split = (d: number): number[] => {
      const out: number[] = [];
      while (d > 0) { const p = d >= 3 ? 3 : d; out.push(p); d -= p; }
      return out;
    };
    if (dH > 0) split(dH).forEach((p) => push('home', p));
    if (dA > 0) split(dA).forEach((p) => push('away', p));
    // taşma: 3'ten fazla bekleyen varsa eskileri dramasız tabelaya işle
    while (queue.current.length > 3) {
      const m = queue.current.shift()!;
      setShown((s) => (m.side === 'home' ? { ...s, hs: s.hs + m.pts } : { ...s, as: s.as + m.pts }));
    }
  }, [matchId, hs, as, live]);

  // animation loop: ball + badge + possession side from the SAME sim clock;
  // make koreografisi varışa bağlı — pop yalnız top potadayken.
  useEffect(() => {
    if (!live) return;
    // kuyruk yalniz MAC degisiminde silinir — effect baska sebeple yeniden
    // kurulursa (or. getClock kimligi) oynayan drama ve bekleyen sayilar yasar
    if (simFor.current !== matchId) { queue.current = []; active.current = null; simFor.current = matchId; }
    let raf = 0;
    const HOOP = (sideK: Side) => (sideK === 'home' ? { x: 300, y: 100 } : { x: 20, y: 100 });
    const step = () => {
      const clock = getClock();
      // sıradaki sayıyı sahneye al
      if (!active.current && queue.current.length > 0) {
        const m = queue.current.shift()!;
        active.current = { ...m, stage: 'spot', stageT: Date.now() };
      }
      const act = active.current;
      let tx: number, ty: number;
      if (act) {
        const s = sm.current;
        if (act.stage === 'spot') {
          tx = act.spot.x; ty = act.spot.y;
          const near = Math.hypot(s[0] - tx, s[1] - ty) < 9;
          if (near || Date.now() - act.stageT > 1100) { act.stage = 'fly'; act.stageT = Date.now(); }
        } else if (act.stage === 'fly') {
          const h = HOOP(act.side); tx = h.x; ty = h.y;
          const near = Math.hypot(s[0] - tx, s[1] - ty) < 10;
          if (near || Date.now() - act.stageT > 1600) {
            // SAYI ANI — top potada: pop + flaş + tabela AYNI karede
            const id = ++popId.current;
            const m = act;
            setFlash(m.side);
            setPops((p) => [...p, { id, side: m.side, pts: m.pts }]);
            setShown((sc) => (m.side === 'home' ? { ...sc, hs: sc.hs + m.pts } : { ...sc, as: sc.as + m.pts }));
            window.setTimeout(() => setFlash(null), 1300);
            window.setTimeout(() => setPops((p) => p.filter((x) => x.id !== id)), 2400);
            act.stage = 'hold'; act.stageT = Date.now();
          }
        } else {
          const h = HOOP(act.side); tx = h.x; ty = h.y;
          if (Date.now() - act.stageT > 650) active.current = null;
        }
      } else {
        const b = courtBallAt(matchId, clock, dur);
        tx = b.x; ty = b.y;
      }
      const amb = active.current ? null : activeCourtEvent(matchId, clock, dur);
      const bMove = active.current ? active.current.stage !== 'hold' : courtBallAt(matchId, clock, dur).moving;
      const s = sm.current; s[0] += (tx - s[0]) * 0.22; s[1] += (ty - s[1]) * 0.22;
      if (ballRef.current) {
        ballRef.current.style.left = `${(s[0] / 320) * 100}%`;
        ballRef.current.style.top = `${(s[1] / 200) * 100}%`;
        ballRef.current.classList.toggle('shooting', bMove);
      }
      const sideNow: Side = active.current ? active.current.side : courtBallAt(matchId, clock, dur).side;
      setSide((v) => (v === sideNow ? v : sideNow));
      const bk = active.current ? '' : amb ? amb.key : '';
      if (bk !== shownBadge.current) { shownBadge.current = bk; setBadge(amb && !active.current ? { type: amb.type, side: amb.side } : null); }
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
        {/* wood floor with a subtle two-tone plank feel */}
        <rect x="0" y="0" width="320" height="200" fill="#b9743a" />
        <rect x="0" y="0" width="320" height="200" fill="url(#bbwood)" opacity="0.25" />
        <defs>
          <linearGradient id="bbwood" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#d08a4e" /><stop offset="1" stopColor="#8f5626" />
          </linearGradient>
        </defs>
        {/* painted keys (boya alanı) — FT line at hoop+36 to match BB_FT */}
        <rect x="8" y="70" width="48" height="60" fill="#a35f2e" opacity="0.55" />
        <rect x="264" y="70" width="48" height="60" fill="#a35f2e" opacity="0.55" />
        <rect x="8" y="8" width="304" height="184" fill="none" stroke="#f2e4d0" strokeWidth="2" opacity="0.85" />
        <line x1="160" y1="8" x2="160" y2="192" stroke="#f2e4d0" strokeWidth="2" opacity="0.85" />
        <circle cx="160" cy="100" r="18" fill="#a35f2e" fillOpacity="0.4" stroke="#f2e4d0" strokeWidth="2" opacity="0.85" />
        {/* three-point line: corner lanes + arc R=74 around each hoop (BB_R3) */}
        <path d="M8 27 L33 27 A74 74 0 0 1 33 173 L8 173" fill="none" stroke="#f2e4d0" strokeWidth="2" opacity="0.75" />
        <path d="M312 27 L287 27 A74 74 0 0 0 287 173 L312 173" fill="none" stroke="#f2e4d0" strokeWidth="2" opacity="0.75" />
        {/* keys + free-throw circles on the line */}
        <rect x="8" y="70" width="48" height="60" fill="none" stroke="#f2e4d0" strokeWidth="2" opacity="0.8" />
        <rect x="264" y="70" width="48" height="60" fill="none" stroke="#f2e4d0" strokeWidth="2" opacity="0.8" />
        <circle cx="56" cy="100" r="15" fill="none" stroke="#f2e4d0" strokeWidth="1.5" opacity="0.6" />
        <circle cx="264" cy="100" r="15" fill="none" stroke="#f2e4d0" strokeWidth="1.5" opacity="0.6" />
        {/* restricted arcs under the rims */}
        <path d="M14 110 A10 10 0 0 1 14 90" fill="none" stroke="#f2e4d0" strokeWidth="1.2" opacity="0.5" />
        <path d="M306 110 A10 10 0 0 0 306 90" fill="none" stroke="#f2e4d0" strokeWidth="1.2" opacity="0.5" />
        {/* backboards + rims */}
        <line x1="13" y1="86" x2="13" y2="114" stroke="#e9edf2" strokeWidth="3" opacity="0.9" />
        <line x1="307" y1="86" x2="307" y2="114" stroke="#e9edf2" strokeWidth="3" opacity="0.9" />
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
      {/* ardışık poplar üst üste binmesin: her aktif pop 8% yukarı kayar */}
      {pops.map((p, i) => <div key={p.id} className={`court-pop ${p.side}`} style={{ top: `${30 - i * 8}%` }}>+{p.pts}</div>)}
      {pops.some((p) => p.pts >= 3) && <Confetti />}

      <div className="court-top">
        {finished ? <span className="court-clk fin">FT</span>
          : <span className="court-clk court-q">{clock}</span>}
      </div>
      <div className="court-score">
        <span className={`court-name ${flash === 'home' ? 'lit' : ''}`}>{home}</span>
        {/* tabela GÖSTERİLEN skoru basar — top potaya varmadan zıplamaz;
            bitmiş/canlı-dışı durumda sunucu skoru birebir */}
        <span className={`court-nums tnum ${flash ? 'score-shake' : ''}`}>
          {live ? shown.hs : hs} <span className="court-colon">:</span> {live ? shown.as : as}
        </span>
        <span className={`court-name ${flash === 'away' ? 'lit' : ''}`}>{away}</span>
      </div>
    </div>
  );
}
