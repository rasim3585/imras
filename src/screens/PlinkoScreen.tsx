import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/LanguageContext';
import { CoinIcon } from '../components/icons';
import { Confetti } from '../live/PitchTV';
import { plinkoDrop, plinkoMult, PLINKO_TABLES, type PlinkoResult } from '../lib/luck';

// kova çarpanını kompakt yaz: 10+ tam sayı, altı 1 ondalık (okunurluk)
const fmtMult = (m: number) => (m >= 10 ? Math.round(m).toString() : m.toFixed(1));

// Plinko — 16 sıra, 3 risk. Top yolu sunucu seed'inden (path 'LRLR…'); istemci
// GERÇEK FİZİKLE oynatır (yerçekimi + peg'de sapma/sıçrama), kova/çarpan
// sunucudan. RTP %97.
const ROWS = 16;
const QUICK = [50, 100, 250, 500];
type Risk = 'low' | 'med' | 'high';

// yumuşatmalar
const easeOutBack = (p: number) => { const c = 1.9; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); };
const easeInQuad = (p: number) => p * p;

export default function PlinkoScreen() {
  const { session, profile, refreshProfile } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [bet, setBet] = useState(100);
  const [risk, setRisk] = useState<Risk>('med');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const [landed, setLanded] = useState<PlinkoResult | null>(null);
  const [flash, setFlash] = useState<number | null>(null);   // kova indeksi
  const [litRow, setLitRow] = useState(-1);                   // o an aydınlanan peg sırası
  const ballRef = useRef<HTMLDivElement | null>(null);
  const raf = useRef(0);

  const bal = profile?.gold_balance ?? 0;
  const tab = PLINKO_TABLES[risk];

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  function animate(path: string, bucket: number, res: PlinkoResult) {
    cancelAnimationFrame(raf.current);
    setLanded(null); setFlash(null); setLitRow(-1); setDropping(true);

    // --- yol noktaları: merkezden başla, her peg'de yarım-kova sapma ---
    const half = 50 / (ROWS + 1);                 // bir sağ/sol adımın yatay payı (%)
    const rowGap = 100 / (ROWS + 2);              // peg satırları arası dikey pay (%)
    const pts: { x: number; y: number }[] = [{ x: 50, y: 0 }];
    let x = 50;
    for (let r = 0; r < ROWS; r++) {
      x += (path[r] === 'R' ? 1 : -1) * half;
      pts.push({ x, y: (r + 1) * rowGap });
    }
    pts.push({ x, y: (ROWS + 1.3) * rowGap });     // kovaya son düşüş
    // segment süreleri: yerçekimi → aşağı indikçe hızlanır (süre kısalır)
    const durs = pts.slice(1).map((_, i) => Math.max(85, 165 - i * 5));
    const total = durs.reduce((a, b) => a + b, 0);

    let start = 0; let lastSeg = -1;
    const step = (ts: number) => {
      if (!start) start = ts;
      const el = ts - start;
      if (el >= total) {
        // yerine oturdu
        const last = pts[pts.length - 1];
        if (ballRef.current) { ballRef.current.style.left = `${last.x}%`; ballRef.current.style.top = `${last.y}%`; ballRef.current.style.transform = 'translate(-50%,-50%) scale(1)'; }
        setLitRow(-1); setDropping(false); setLanded(res); setFlash(bucket);
        void refreshProfile();
        return;
      }
      // hangi segmentteyiz
      let acc = 0, seg = 0;
      while (seg < durs.length && el > acc + durs[seg]) { acc += durs[seg]; seg++; }
      const p = Math.min(1, (el - acc) / durs[seg]);
      const a = pts[seg], b = pts[seg + 1];
      // x: peg'e çarpıp sapma (overshoot + otur) · y: hızlanan düşüş + küçük hop
      const ex = easeOutBack(p);
      const hop = 1.5;                                       // % board — peg'den sıçrama
      const px = a.x + (b.x - a.x) * ex;
      const py = a.y + (b.y - a.y) * easeInQuad(p) - hop * Math.sin(p * Math.PI);
      // squash: peg'e değince ez, sonra topla (segment başında güçlü)
      const sq = Math.max(0, 1 - p * 3.2);
      const sx = 1 + 0.4 * sq, sy = 1 - 0.34 * sq;
      if (ballRef.current) {
        ballRef.current.style.left = `${px}%`;
        ballRef.current.style.top = `${py}%`;
        ballRef.current.style.transform = `translate(-50%,-50%) scale(${sx.toFixed(3)},${sy.toFixed(3)})`;
      }
      if (seg !== lastSeg) { lastSeg = seg; if (seg >= 1) setLitRow(seg - 1); }
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  }

  async function drop() {
    if (busy || bet < 1 || bet > bal) return;
    setBusy(true); setErr(null);
    try {
      const r = await plinkoDrop(bet, risk);
      animate(r.path, r.bucket, r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('luck.err'));
    } finally { setBusy(false); }
  }

  return (
    <div className="app-shell luck-screen">
      <div className="luck-top">
        <button className="detail-back" onClick={() => navigate('/')}>&lsaquo; {t('luck.back')}</button>
        <span className="av-bal-chip tnum"><CoinIcon size={14} /> {bal.toLocaleString()}</span>
      </div>
      <h1 className="luck-h1">🔻 Plinko</h1>

      <div className="plinko-board">
        {landed && landed.payout > bet && <Confetti />}
        {/* pegler */}
        {Array.from({ length: ROWS }, (_, r) => (
          <div key={r} className="plinko-prow" style={{ top: `${(r + 1) * (100 / (ROWS + 2))}%` }}>
            {Array.from({ length: r + 3 }, (_, i) => <span key={i} className={`plinko-peg ${litRow === r ? 'lit' : ''}`} />)}
          </div>
        ))}
        <div ref={ballRef} className={`plinko-ball ${dropping ? 'on' : ''}`} style={{ left: '50%', top: '0%' }} aria-hidden />
      </div>

      {/* kova çarpanları */}
      <div className={`plinko-buckets r-${risk}`}>
        {tab.map((_, i) => (
          <span key={i} className={`plinko-bkt ${flash === i ? 'hit' : ''} ${flash != null && Math.abs(flash - i) === 1 ? 'wave' : ''}`}>{fmtMult(plinkoMult(risk, i))}<span className="bkt-x">×</span></span>
        ))}
      </div>

      <div className="dice-dir plinko-risk">
        {(['low', 'med', 'high'] as Risk[]).map((rk) => (
          <button key={rk} className={`seg ${risk === rk ? 'on' : ''}`} disabled={busy || dropping} onClick={() => setRisk(rk)}>{t('plinko.' + rk)}</button>
        ))}
      </div>

      {err && <div className="banner banner-error">{err}</div>}
      {landed && (
        <div className={`luck-result ${landed.payout > bet ? 'w' : landed.payout > 0 ? 'p' : 'l'}`}>
          {landed.payout > bet && <span className="luck-coins" aria-hidden>{Array.from({ length: 7 }, (_, i) => <i key={i} style={{ left: `${12 + i * 12}%`, animationDelay: `${i * 0.05}s` }} />)}</span>}
          {landed.mult}× · {landed.payout > 0 ? `+${landed.payout}` : `−${bet}`} <CoinIcon size={14} />
        </div>
      )}

      <div className="luck-bet">
        <input className="input tnum" type="number" min={1} max={bal} value={bet}
          onChange={(e) => setBet(Math.max(0, Math.floor(Number(e.target.value) || 0)))} disabled={busy || dropping} />
        <div className="luck-quick">
          {QUICK.map((q) => <button key={q} className="btn btn-sm" disabled={busy || dropping} onClick={() => setBet(q)}>{q}</button>)}
          <button className="btn btn-sm" disabled={busy || dropping || bal <= 0} onClick={() => setBet(bal)}>MAX</button>
        </div>
      </div>

      {session ? (
        <button className="btn btn-primary btn-block luck-go" disabled={busy || dropping || bet < 1 || bet > bal} onClick={drop}>
          {busy || dropping ? '…' : `${t('plinko.drop')} · ${bet}`}
        </button>
      ) : (
        <button className="btn btn-primary btn-block luck-go" onClick={() => navigate('/login')}>{t('luck.login')}</button>
      )}
      <p className="luck-fair">🔒 {t('luck.fair')}</p>
    </div>
  );
}
