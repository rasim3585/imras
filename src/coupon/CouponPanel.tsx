import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCart } from './CartContext';
import { useAuth } from '../auth/AuthContext';
import { matchProvider } from '../lib/matchProvider';
import { formatOdds } from '../lib/format';
import { logEvent } from '../lib/behaviorLog';

const QUICK = [100, 250, 500];

// The slip itself: selections + stake + "Place now". Shared by the desktop dock
// panel and the mobile bottom sheet — bet without leaving the bulletin.
export default function CouponPanel({ onClose }: { onClose?: () => void }) {
  const { selections, count, totalOdds, remove, clear, saveDraft } = useCart();
  const { profile, session, refreshProfile } = useAuth();
  const navigate = useNavigate();

  const balance = profile?.gold_balance ?? 0;
  const [stake, setStake] = useState(100);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);

  function save() {
    saveDraft();
    setSavedMsg(true);
    window.setTimeout(() => setSavedMsg(false), 2200);
  }

  const potential = Math.round(stake * totalOdds);
  const stakeValid = stake > 0 && stake <= balance;

  // When this slip was opened — lets us measure hesitation (open → play), a core
  // pre-decision risk signal: impulsive vs. deliberated stakes read very differently.
  const openedAt = useRef(Date.now());

  async function place() {
    setError(null); setBusy(true);
    // Snapshot the decision the moment the user commits (moat: stake sizing vs.
    // balance, odds appetite, leg count, hesitation). Post-settle we only know the
    // outcome; the CHOICE lives here.
    const decision = {
      stake, total_odds: totalOdds, legs: count, potential,
      stake_pct_balance: balance > 0 ? Math.round((stake / balance) * 100) : null,
      kinds: selections.map((s) => s.kind),
    };
    const meta = { hesitation_ms: Date.now() - openedAt.current };
    try {
      await matchProvider.placeCoupon(selections, stake);
      logEvent('coupon', 'coupon_placed', decision, meta);
      clear(); await refreshProfile(); setPlaced(true);
    } catch (err) {
      const raw = err instanceof Error ? err.message : '';
      logEvent('coupon', 'coupon_place_failed', { ...decision, reason: raw.slice(0, 80) }, meta);
      setError(raw.includes('market_closed') ? 'A match on your coupon has closed. Remove it and retry.'
        : raw.includes('Not enough gold') ? 'Not enough gold for that stake.' : raw || 'Could not place coupon');
    } finally { setBusy(false); }
  }

  return (
    <div className="cpn">
      <div className="cpn-head">
        <span className="cpn-title">My coupon{count > 0 ? ` · ${count}` : ''}</span>
        <div className="row" style={{ gap: 'var(--s2)' }}>
          {count > 0 && <button className="cpn-x" onClick={clear} title="Clear all">Clear</button>}
          {onClose && <button className="cpn-x" onClick={onClose} aria-label="Close">✕</button>}
        </div>
      </div>

      {placed && count === 0 ? (
        <div className="cpn-empty">
          <p className="cpn-ok">Coupon placed ✓</p>
          <Link to="/coupons" className="btn btn-ghost btn-sm" onClick={onClose}>View in My coupons</Link>
        </div>
      ) : count === 0 ? (
        <div className="cpn-empty"><p className="dim">Tap any odds to build a coupon.</p></div>
      ) : (
        <>
          <div className="cpn-legs">
            {selections.map((s) => (
              <div key={s.match_id} className="cpn-leg">
                <div className="cpn-leg-main">
                  <div className="cpn-leg-match">{s.home_team} - {s.away_team}</div>
                  <div className="cpn-leg-pick"><span className="muted">{s.market_name}:</span> {s.option_label} <b className="tnum">{formatOdds(s.odds)}</b></div>
                </div>
                <button className="cpn-rm" onClick={() => remove(s.match_id)} aria-label="Remove">✕</button>
              </div>
            ))}
          </div>

          <div className="cpn-foot">
            <div className="cpn-row"><span className="muted">Total odds</span><b className="tnum">{formatOdds(totalOdds)}</b></div>
            <div className="cpn-stake">
              <input className="input tnum" type="number" min={1} max={session ? balance : undefined} value={stake}
                onChange={(e) => setStake(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
              <div className="cpn-quick">
                {QUICK.map((q) => <button key={q} className="btn btn-sm" onClick={() => setStake(q)}>{q}</button>)}
                {session && <button className="btn btn-sm" disabled={balance <= 0} onClick={() => setStake(balance)}>Max</button>}
              </div>
            </div>
            <div className="cpn-row cpn-win"><span>Potential win</span><b className="tnum">{potential} <span className="coin" aria-hidden="true" /></b></div>
            {session && <div className="cpn-bal dim tnum">Balance: {balance} <span className="coin" aria-hidden="true" /></div>}
            {error && <div className="banner banner-error" style={{ marginTop: 'var(--s2)' }}>{error}</div>}

            {session ? (
              <button className="btn btn-primary btn-block" style={{ marginTop: 'var(--s2)' }} disabled={busy || !stakeValid} onClick={place}>
                {busy ? '…' : <>Play now · {stake} <span className="coin coin-light" aria-hidden="true" /></>}
              </button>
            ) : (
              <button className="btn btn-primary btn-block" style={{ marginTop: 'var(--s2)' }} onClick={() => { onClose?.(); navigate('/login'); }}>
                Log in to play
              </button>
            )}
            <button className="btn btn-ghost btn-block btn-sm" style={{ marginTop: 'var(--s2)' }} onClick={save}>
              {savedMsg ? 'Saved ✓' : 'Save for later'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
