import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/LanguageContext';
import { CoinIcon } from '../components/icons';
import { Confetti } from '../live/PitchTV';
import { diceRoll, type DiceResult } from '../lib/luck';

// Zar yüzü: 0..99.99 sonucu iki fiziksel zara böl (onlar/birler basamağı, 1-6
// aralığına eşle) — kullanıcı gerçek zar görsün. Büyük değer ayrıca üstte yazılı.
function pips(n: number) {
  // 1..6 nokta düzeni (dot grid 3×3 pozisyonları)
  const P: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  const on = new Set(P[n] ?? [4]);
  return (
    <span className="die-face" aria-label={`${n}`}>
      {Array.from({ length: 9 }, (_, i) => <span key={i} className={`die-pip ${on.has(i) ? 'on' : ''}`} />)}
    </span>
  );
}

// Dice — kazanma şansını (dolayısıyla çarpanı) kullanıcı SEÇER; her atış risk
// iştahının doğrudan beyanı (ayna için altın sinyal). Sunucu-otoriter, RTP %97.
const QUICK = [50, 100, 250, 500];

export default function DiceScreen() {
  const { session, profile, refreshProfile } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [bet, setBet] = useState(100);
  const [chance, setChance] = useState(50);          // %2..95
  const [dir, setDir] = useState<'under' | 'over'>('under');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<DiceResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const bal = profile?.gold_balance ?? 0;
  const mult = Math.round((0.97 * 100 / chance) * 100) / 100;
  const win = res?.win;
  // slider: sonucun düştüğü nokta (0..100) — çubukta işaret
  const marker = res ? res.roll : null;
  const [rolling, setRolling] = useState(false);
  const [faces, setFaces] = useState<[number, number]>([2, 5]);

  // atarken zar yüzleri hızlı dönsün; sonuçta iki basamağı zar yüzüne eşle
  useEffect(() => {
    if (!rolling) return;
    const id = setInterval(() => setFaces([1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)] as [number, number]), 80);
    return () => clearInterval(id);
  }, [rolling]);
  useEffect(() => {
    if (!res) return;
    // 0..99.99 → onlar/birler basamağı, 1-6'ya sıkıştır (görsel zar)
    const tens = Math.min(6, Math.max(1, Math.floor(res.roll / 100 * 6) + 1));
    const units = Math.min(6, Math.max(1, Math.floor((res.roll % 10) / 10 * 6) + 1));
    setFaces([tens, units]);
  }, [res]);

  async function roll() {
    if (busy || bet < 1 || bet > bal) return;
    setBusy(true); setErr(null); setRolling(true); setRes(null);
    try {
      const r = await diceRoll(bet, chance, dir);
      // kısa "zar dönüyor" gerilimi, sonra sonuç
      await new Promise((res) => setTimeout(res, 480));
      setRes(r);
      await refreshProfile();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('luck.err'));
    } finally { setBusy(false); setRolling(false); }
  }

  return (
    <div className="app-shell luck-screen">
      <div className="luck-top">
        <button className="detail-back" onClick={() => navigate('/')}>&lsaquo; {t('luck.back')}</button>
        <span className="av-bal-chip tnum"><CoinIcon size={14} /> {bal.toLocaleString()}</span>
      </div>
      <h1 className="luck-h1"><span className={`dice-h-icon ${rolling ? 'rolling' : ''}`}>🎲</span> Dice</h1>

      {/* iki fiziksel zar — atarken döner, sonuçta yerine oturur */}
      <div className={`dice-stage ${res ? (win ? 'w' : 'l') : ''}`}>
        {win && !rolling && <Confetti />}
        <div className={`die ${rolling ? 'tumbling' : res ? 'landed' : ''}`}>{pips(faces[0])}</div>
        <div className={`die ${rolling ? 'tumbling' : res ? 'landed' : ''}`} style={{ animationDelay: '0.06s' }}>{pips(faces[1])}</div>
        {res && !rolling && (
          <div className={`dice-roll-num tnum ${win ? 'w' : 'l'}`}>{res.roll.toFixed(2)}</div>
        )}
      </div>

      {/* çubuk: soldan sağa 0..100; under yeşil sol, over yeşil sağ */}
      <div className="dice-track">
        <div className={`dice-win ${dir}`} style={dir === 'under' ? { width: `${chance}%` } : { width: `${chance}%`, left: `${100 - chance}%` }} />
        {marker != null && (
          <div className={`dice-marker ${win ? 'w' : 'l'}`} style={{ left: `${marker}%` }}>
            <span className="dice-marker-v tnum">{marker.toFixed(2)}</span>
          </div>
        )}
        <span className="dice-tick l">0</span><span className="dice-tick m">50</span><span className="dice-tick r">100</span>
      </div>

      <div className="luck-stats3">
        <div className="luck-stat"><span className="k">{t('dice.chance')}</span><b className="tnum">%{chance}</b></div>
        <div className="luck-stat"><span className="k">{t('dice.mult')}</span><b className="tnum">{mult}×</b></div>
        <div className="luck-stat"><span className="k">{t('dice.payout')}</span><b className="tnum">{Math.floor(bet * mult)}</b></div>
      </div>

      <div className="dice-dir">
        <button className={`seg ${dir === 'under' ? 'on' : ''}`} onClick={() => setDir('under')}>{t('dice.under')} &lt; {chance}</button>
        <button className={`seg ${dir === 'over' ? 'on' : ''}`} onClick={() => setDir('over')}>{t('dice.over')} &gt; {100 - chance}</button>
      </div>

      <label className="dice-slider-l">{t('dice.slider')}
        <input type="range" min={2} max={95} value={chance} className="dice-slider"
          onChange={(e) => setChance(Number(e.target.value))} disabled={busy} />
      </label>

      <div className="luck-bet">
        <input className="input tnum" type="number" min={1} max={bal} value={bet}
          onChange={(e) => setBet(Math.max(0, Math.floor(Number(e.target.value) || 0)))} disabled={busy} />
        <div className="luck-quick">
          {QUICK.map((q) => <button key={q} className="btn btn-sm" disabled={busy} onClick={() => setBet(q)}>{q}</button>)}
          <button className="btn btn-sm" disabled={busy || bal <= 0} onClick={() => setBet(bal)}>MAX</button>
        </div>
      </div>

      {err && <div className="banner banner-error">{err}</div>}
      {res && !rolling && (
        <div className={`luck-result ${win ? 'w' : 'l'}`}>
          {win && <span className="luck-coins" aria-hidden>{Array.from({ length: 7 }, (_, i) => <i key={i} style={{ left: `${12 + i * 12}%`, animationDelay: `${i * 0.05}s` }} />)}</span>}
          {win ? `+${res.payout}` : `−${bet}`} <CoinIcon size={14} />
          <span className="luck-result-sub">{res.roll.toFixed(2)} · {win ? t('luck.won') : t('luck.lost')}</span>
        </div>
      )}

      {session ? (
        <button className="btn btn-primary btn-block luck-go" disabled={busy || bet < 1 || bet > bal} onClick={roll}>
          {busy ? '…' : `${t('dice.roll')} · ${bet}`}
        </button>
      ) : (
        <button className="btn btn-primary btn-block luck-go" onClick={() => navigate('/login')}>{t('luck.login')}</button>
      )}
      <p className="luck-fair">🔒 {t('luck.fair')}</p>
    </div>
  );
}
