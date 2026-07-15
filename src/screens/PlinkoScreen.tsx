import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/LanguageContext';
import { CoinIcon } from '../components/icons';
import { plinkoDrop, plinkoMult, PLINKO_TABLES, type PlinkoResult } from '../lib/luck';

// Plinko — 16 sıra, 3 risk. Top yolu sunucu seed'inden (path 'LRLR…'); istemci
// yalnız animasyonu oynatır, kova/çarpan sunucudan. RTP %97.
const ROWS = 16;
const QUICK = [50, 100, 250, 500];
type Risk = 'low' | 'med' | 'high';

export default function PlinkoScreen() {
  const { session, profile, refreshProfile } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [bet, setBet] = useState(100);
  const [risk, setRisk] = useState<Risk>('med');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ballX, setBallX] = useState(50);
  const [ballRow, setBallRow] = useState(-1);
  const [landed, setLanded] = useState<PlinkoResult | null>(null);
  const [flash, setFlash] = useState<number | null>(null);   // kova indeksi
  const timers = useRef<number[]>([]);

  const bal = profile?.gold_balance ?? 0;
  const tab = PLINKO_TABLES[risk];

  function animate(path: string, bucket: number, res: PlinkoResult) {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    let x = 50, rights = 0;
    setBallRow(0); setBallX(50); setLanded(null); setFlash(null);
    for (let r = 0; r < ROWS; r++) {
      const goRight = path[r] === 'R';
      const t = window.setTimeout(() => {
        if (goRight) rights++;
        // her sırada yatayda ±(yarı-genişlik/sıra) kayma
        x += (goRight ? 1 : -1) * (46 / ROWS);
        setBallX(x); setBallRow(r + 1);
      }, 90 * (r + 1));
      timers.current.push(t);
    }
    const done = window.setTimeout(() => {
      setLanded(res); setFlash(bucket); setBallRow(-1);
      void refreshProfile();
    }, 90 * (ROWS + 1) + 120);
    timers.current.push(done);
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
        {/* pegler */}
        {Array.from({ length: ROWS }, (_, r) => (
          <div key={r} className="plinko-prow" style={{ top: `${(r + 1) * (100 / (ROWS + 2))}%` }}>
            {Array.from({ length: r + 3 }, (_, i) => <span key={i} className="plinko-peg" />)}
          </div>
        ))}
        {ballRow >= 0 && <div className="plinko-ball" style={{ left: `${ballX}%`, top: `${ballRow * (100 / (ROWS + 2))}%` }} />}
      </div>

      {/* kova çarpanları */}
      <div className={`plinko-buckets r-${risk}`}>
        {tab.map((_, i) => (
          <span key={i} className={`plinko-bkt ${flash === i ? 'hit' : ''}`}>{plinkoMult(risk, i)}×</span>
        ))}
      </div>

      <div className="dice-dir plinko-risk">
        {(['low', 'med', 'high'] as Risk[]).map((rk) => (
          <button key={rk} className={`seg ${risk === rk ? 'on' : ''}`} disabled={busy} onClick={() => setRisk(rk)}>{t('plinko.' + rk)}</button>
        ))}
      </div>

      {err && <div className="banner banner-error">{err}</div>}
      {landed && (
        <div className={`luck-result ${landed.payout > bet ? 'w' : landed.payout > 0 ? 'p' : 'l'}`}>
          {landed.mult}× · {landed.payout > 0 ? `+${landed.payout}` : `−${bet}`} <CoinIcon size={14} />
        </div>
      )}

      <div className="luck-bet">
        <input className="input tnum" type="number" min={1} max={bal} value={bet}
          onChange={(e) => setBet(Math.max(0, Math.floor(Number(e.target.value) || 0)))} disabled={busy} />
        <div className="luck-quick">
          {QUICK.map((q) => <button key={q} className="btn btn-sm" disabled={busy} onClick={() => setBet(q)}>{q}</button>)}
          <button className="btn btn-sm" disabled={busy || bal <= 0} onClick={() => setBet(bal)}>MAX</button>
        </div>
      </div>

      {session ? (
        <button className="btn btn-primary btn-block luck-go" disabled={busy || bet < 1 || bet > bal} onClick={drop}>
          {busy ? '…' : `${t('plinko.drop')} · ${bet}`}
        </button>
      ) : (
        <button className="btn btn-primary btn-block luck-go" onClick={() => navigate('/login')}>{t('luck.login')}</button>
      )}
      <p className="luck-fair">🔒 {t('luck.fair')}</p>
    </div>
  );
}
