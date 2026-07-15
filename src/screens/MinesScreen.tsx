import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/LanguageContext';
import { CoinIcon } from '../components/icons';
import { minesStart, minesReveal, minesCashout, minesMult, type MinesState } from '../lib/luck';

// Mines — "bir kutu daha mı, çek mi" gerilimi. 5×5, M mayın; her güvenli açış
// çarpanı yükseltir, mayın kaybeder, çekince öder. Sunucu-otoriter (mayınlar
// gizli tabloda), provably fair. Ayna için Aviator'ın kardeşi.
const QUICK = [50, 100, 250, 500];
type Cell = 'hidden' | 'safe' | 'mine' | 'boom' | 'reveal-mine';

export default function MinesScreen() {
  const { session, profile, refreshProfile } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [bet, setBet] = useState(100);
  const [mines, setMines] = useState(3);
  const [game, setGame] = useState<MinesState | null>(null);
  const [cells, setCells] = useState<Cell[]>(Array(25).fill('hidden'));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ won: boolean; payout: number } | null>(null);
  const [blast, setBlast] = useState(false);       // patlama sarsıntısı
  const [bump, setBump] = useState(false);         // çarpan yükselince zıplama

  const bal = profile?.gold_balance ?? 0;
  const active = game?.status === 'active';
  const k = active ? (cells.filter((c) => c === 'safe').length) : 0;
  const curMult = active ? (k > 0 ? minesMult(mines, k) : 1) : 1;
  const nextMult = active ? minesMult(mines, k + 1) : minesMult(mines, 1);

  async function start() {
    if (busy || bet < 1 || bet > bal) return;
    setBusy(true); setErr(null); setDone(null);
    setCells(Array(25).fill('hidden'));
    try {
      const g = await minesStart(bet, mines);
      setGame(g);
      await refreshProfile();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('luck.err'));
    } finally { setBusy(false); }
  }

  async function reveal(i: number) {
    if (!active || busy || cells[i] !== 'hidden') return;
    setBusy(true); setErr(null);
    try {
      const r = await minesReveal(game!.game_id, i);
      if (r.safe) {
        setCells((c) => c.map((x, idx) => (idx === i ? 'safe' : x)));
        setBump(true); setTimeout(() => setBump(false), 320);
        if (r.status === 'cashed') endGame(r, true);          // tüm güvenliler açıldı → oto cashout
        else setGame((g) => ({ ...g!, mult: r.mult ?? g!.mult }));
      } else {
        // patladı: mayınları göster + sarsıntı
        const mc = r.mine_cells ?? [];
        setCells((c) => c.map((x, idx) => (idx === i ? 'boom' : mc.includes(idx) ? 'reveal-mine' : x)));
        setBlast(true); setTimeout(() => setBlast(false), 460);
        endGame(r, false);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('luck.err'));
    } finally { setBusy(false); }
  }

  async function cashout() {
    if (!active || busy || k === 0) return;
    setBusy(true); setErr(null);
    try {
      const r = await minesCashout(game!.game_id);
      const mc = r.mine_cells ?? [];
      setCells((c) => c.map((x, idx) => (mc.includes(idx) && x === 'hidden' ? 'reveal-mine' : x)));
      endGame(r, true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('luck.err'));
    } finally { setBusy(false); }
  }

  function endGame(r: MinesState, won: boolean) {
    setGame((g) => ({ ...g!, status: won ? 'cashed' : 'lost' }));
    setDone({ won, payout: r.payout ?? 0 });
    void refreshProfile();
  }

  return (
    <div className="app-shell luck-screen">
      <div className="luck-top">
        <button className="detail-back" onClick={() => navigate('/')}>&lsaquo; {t('luck.back')}</button>
        <span className="av-bal-chip tnum"><CoinIcon size={14} /> {bal.toLocaleString()}</span>
      </div>
      <h1 className="luck-h1">💣 Mines</h1>

      {active && (
        <>
          <div className={`mines-mult-big ${bump ? 'bump' : ''}`}>{curMult}×</div>
          <div className="luck-stats3 mines-live">
            <div className="luck-stat"><span className="k">{t('mines.next')}</span><b className="tnum">{nextMult}×</b></div>
            <div className="luck-stat"><span className="k">{t('mines.safe')}</span><b className="tnum">{k}</b></div>
            <div className="luck-stat"><span className="k">{t('mines.count')}</span><b className="tnum">{mines}</b></div>
          </div>
        </>
      )}

      <div className={`mines-grid ${active ? 'on' : ''} ${blast ? 'blast' : ''}`}>
        {cells.map((c, i) => (
          <button key={i} className={`mine-cell ${c}`} disabled={!active || busy || c !== 'hidden'} onClick={() => reveal(i)}>
            {c === 'mine' || c === 'reveal-mine' ? '💣' : c === 'boom' ? '💥' : ''}
          </button>
        ))}
      </div>

      {err && <div className="banner banner-error">{err}</div>}
      {done && (
        <div className={`luck-result ${done.won ? 'w' : 'l'}`}>
          {done.won && <span className="luck-coins" aria-hidden>{Array.from({ length: 7 }, (_, i) => <i key={i} style={{ left: `${12 + i * 12}%`, animationDelay: `${i * 0.05}s` }} />)}</span>}
          {done.won ? `+${done.payout}` : `−${bet}`} <CoinIcon size={14} />
          <span className="luck-result-sub">{done.won ? t('luck.won') : t('mines.boom')}</span>
        </div>
      )}

      {!active ? (
        <>
          <label className="dice-slider-l">{t('mines.count')}: <b>{mines}</b>
            <input type="range" min={1} max={24} value={mines} className="dice-slider"
              onChange={(e) => setMines(Number(e.target.value))} disabled={busy} />
          </label>
          <div className="luck-bet">
            <input className="input tnum" type="number" min={1} max={bal} value={bet}
              onChange={(e) => setBet(Math.max(0, Math.floor(Number(e.target.value) || 0)))} disabled={busy} />
            <div className="luck-quick">
              {QUICK.map((q) => <button key={q} className="btn btn-sm" disabled={busy} onClick={() => setBet(q)}>{q}</button>)}
              <button className="btn btn-sm" disabled={busy || bal <= 0} onClick={() => setBet(bal)}>MAX</button>
            </div>
          </div>
          {session ? (
            <button className="btn btn-primary btn-block luck-go" disabled={busy || bet < 1 || bet > bal} onClick={start}>
              {busy ? '…' : `${t('mines.start')} · ${bet}`}
            </button>
          ) : (
            <button className="btn btn-primary btn-block luck-go" onClick={() => navigate('/login')}>{t('luck.login')}</button>
          )}
        </>
      ) : (
        <button className="btn btn-primary btn-block luck-go mines-cash" disabled={busy || k === 0} onClick={cashout}>
          {k === 0 ? t('mines.pickfirst') : `${t('mines.cashout')} ${Math.floor(bet * curMult)} `}<CoinIcon size={14} />
        </button>
      )}
      <p className="luck-fair">🔒 {t('luck.fair')}</p>
    </div>
  );
}
