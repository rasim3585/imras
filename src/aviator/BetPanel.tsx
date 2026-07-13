import { useState, useEffect } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/LanguageContext';
import { useLiveMultiplier, type FlightAnchor } from './useAviator';
import type { AviatorStatus, AviatorConfig, AviatorBet } from '../lib/aviator';

type TFn = (k: string, v?: Record<string, string | number>) => string;

// One bet slot. The app runs TWO of these (slot 1 + slot 2), independent bets on
// the same round -- the classic Aviator dual bet. Betting is enabled ONLY in the
// betting phase, cashout ONLY in flying (the backend also enforces both).
export default function BetPanel({
  slot, phase, anchor, cap, config, bet, loggedIn, onPlace, onCashout, onRequireLogin,
}: {
  slot: 1 | 2;
  phase: AviatorStatus | undefined;
  anchor: FlightAnchor | null;
  cap: number;
  config: AviatorConfig;
  bet: AviatorBet | undefined;
  loggedIn: boolean;
  onPlace: (slot: 1 | 2, stake: number, auto: number | null) => Promise<void>;
  onCashout: (slot: 1 | 2, clientMultiplier: number) => Promise<void>;
  onRequireLogin: () => void;
}) {
  const { profile } = useAuth();
  const { t } = useI18n();
  const [stake, setStake] = useState(String(config.min_stake));
  const [autoOn, setAutoOn] = useState(false);
  const [auto, setAuto] = useState('2.00');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // optimistic cashout: freeze + show the result the INSTANT the user taps, RPC
  // settles in the background. Rounds are fast (1-2s crashes) -- waiting for the
  // round-trip felt like "it paused and then crashed". If the RPC says too-late,
  // we clear this and the real (lost) state shows through.
  const [optimistic, setOptimistic] = useState<{ multiplier: number; payout: number } | null>(null);

  // new round wipes the slot -> drop any lingering optimistic overlay + error
  useEffect(() => { if (!bet) { setOptimistic(null); setErr(null); } }, [bet]);

  const live = useLiveMultiplier(phase, anchor, null, cap);
  const balance = profile?.gold_balance ?? 0;
  const stakeN = Math.floor(Number(stake)) || 0;
  const autoN = autoOn ? Number(auto) : null;

  const stakeValid = stakeN >= config.min_stake && stakeN <= config.max_stake && stakeN <= balance;
  const autoValid = !autoOn || (Number.isFinite(autoN) && (autoN as number) >= 1.01);

  async function place() {
    setErr(null); setBusy(true);
    try { await onPlace(slot, stakeN, autoN); }
    catch (e) { setErr(e instanceof Error ? cleanErr(e.message, t) : t('av2.betFail')); }
    finally { setBusy(false); }
  }
  async function cash() {
    if (busy || !bet) return;                     // guard double-tap
    const snap = live;                            // freeze the multiplier at tap
    setOptimistic({ multiplier: snap, payout: Math.floor(snap * bet.stake) });
    setErr(null); setBusy(true);
    try {
      await onCashout(slot, snap);                // server honours the SEEN value (snap)
    } catch (e) {
      setOptimistic(null);                        // too late -> real state (lost) shows
      setErr(e instanceof Error ? cleanErr(e.message, t) : t('av2.cashFail'));
    } finally {
      setBusy(false);
    }
  }

  // ---- states -> what the big button is right now ----
  let body: React.ReactNode;
  if (optimistic) {
    body = <div className="av-result av-won">{t('av2.cashed', { x: optimistic.multiplier.toFixed(2), p: optimistic.payout })}</div>;
  } else if (!loggedIn) {
    body = <button className="av-btn av-btn-login" onClick={onRequireLogin}>{t('av2.loginPlay')}</button>;
  } else if (bet?.status === 'won') {
    body = <div className="av-result av-won">{t('av2.cashed', { x: bet.cashout_multiplier?.toFixed(2) ?? '', p: bet.payout ?? 0 })}</div>;
  } else if (bet?.status === 'lost' || (phase === 'crashed' && bet)) {
    body = <div className="av-result av-lost">{t('av2.lost', { s: bet?.stake ?? 0 })}</div>;
  } else if (phase === 'flying' && bet?.status === 'placed') {
    const potential = Math.floor(live * bet.stake);
    body = <button className="av-btn av-btn-cash" disabled={busy} onClick={cash}>
      {t('av2.cashout', { x: live.toFixed(2) })} <b>+{potential}</b>
    </button>;
  } else if (phase === 'betting' && bet?.status === 'placed') {
    body = <div className="av-result av-placed">{t('av2.placed', { stake: bet.stake })} {bet.auto_cashout_at ? `· ${t('av2.autoSuffix', { x: bet.auto_cashout_at })}` : ''}</div>;
  } else if (phase === 'betting') {
    body = <button className="av-btn av-btn-place" disabled={busy || !stakeValid || !autoValid} onClick={place}>
      {busy ? '…' : <>{t('av2.place')} <b>{stakeN}</b></>}
    </button>;
  } else {
    body = <button className="av-btn" disabled>{t('av2.waiting')}</button>;
  }

  const editable = loggedIn && phase === 'betting' && !bet;

  const statusPill = (() => {
    if (optimistic || bet?.status === 'won') return { t: t('av2.st.cashed'), c: 'won' };
    if (bet?.status === 'lost' || (phase === 'crashed' && bet)) return { t: t('av2.st.lost'), c: 'lost' };
    if (bet?.status === 'placed' && phase === 'flying') return { t: t('av2.st.flying'), c: 'live' };
    if (bet?.status === 'placed') return { t: t('av2.st.ready'), c: 'ready' };
    return { t: phase === 'betting' ? t('av2.st.idle') : t('av2.st.none'), c: 'idle' };
  })();

  return (
    <div className={`av-panel av-panel-s${slot} ${bet ? `av-panel-${bet.status}` : ''} ${optimistic ? 'av-panel-won' : ''}`}>
      <div className="av-panel-head">
        <span className="av-slot"><span className="av-slot-dot" />{t('av2.slot', { n: slot })}</span>
        <span className={`av-status av-status-${statusPill.c}`}>{statusPill.t}</span>
      </div>

      <div className={`av-stake-row ${editable ? '' : 'is-locked'}`}>
        <button className="av-step" disabled={!editable} onClick={() => setStake(String(Math.max(config.min_stake, stakeN - 5)))}>−</button>
        <input className="av-stake tnum" inputMode="numeric" value={stake} disabled={!editable}
          onChange={(e) => setStake(e.target.value.replace(/[^0-9]/g, ''))} />
        <button className="av-step" disabled={!editable} onClick={() => setStake(String(Math.min(config.max_stake, stakeN + 5)))}>+</button>
      </div>
      {editable && (
        <div className="av-quick">
          {[10, 50, 100, 500].map((v) => (
            <button key={v} className="av-chip" onClick={() => setStake(String(Math.min(config.max_stake, v)))}>{v}</button>
          ))}
          <button className="av-chip" onClick={() => setStake(String(Math.min(config.max_stake, balance)))}>{t('av2.max')}</button>
        </div>
      )}

      <label className={`av-auto ${editable ? '' : 'is-locked'}`}>
        <input type="checkbox" checked={autoOn} disabled={!editable} onChange={(e) => setAutoOn(e.target.checked)} />
        {t('av2.autoLabel')}
        <input className="av-auto-val tnum" inputMode="decimal" value={auto} disabled={!editable || !autoOn}
          onChange={(e) => setAuto(e.target.value.replace(/[^0-9.]/g, ''))} />
        <span className="muted">x</span>
      </label>

      {body}
      {err && <div className="av-err">{err}</div>}
    </div>
  );
}

// backend errors come through raw; surface the useful ones, localized.
function cleanErr(msg: string, t: TFn): string {
  if (msg.includes('insufficient')) return t('av2.err.insufficient');
  if (msg.includes('bet_closed') || msg.includes('not betting')) return t('av2.err.closed');
  if (msg.includes('already')) return t('av2.err.already');
  if (msg.includes('not flying') || msg.includes('cashout')) return t('av2.err.cantCash');
  return msg.length > 60 ? t('av2.err.failed') : msg;
}
