import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/LanguageContext';
import { CoinIcon } from '../components/icons';
import { diceRoll, type DiceResult } from '../lib/luck';

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

  async function roll() {
    if (busy || bet < 1 || bet > bal) return;
    setBusy(true); setErr(null);
    try {
      const r = await diceRoll(bet, chance, dir);
      setRes(r);
      await refreshProfile();
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
      <h1 className="luck-h1">🎲 Dice</h1>

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
      {res && (
        <div className={`luck-result ${win ? 'w' : 'l'}`}>
          {win ? `+${res.payout}` : `−${res.id && bet}`} <CoinIcon size={14} />
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
