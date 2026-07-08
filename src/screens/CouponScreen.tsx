import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCart } from '../coupon/CartContext';
import { useAuth } from '../auth/AuthContext';
import { matchProvider } from '../lib/matchProvider';
import { formatOdds } from '../lib/format';

const QUICK = [100, 250, 500];

export default function CouponScreen() {
  const { selections, count, totalOdds, remove, clear } = useCart();
  const { profile, session, refreshProfile } = useAuth();
  const navigate = useNavigate();

  const balance = profile?.gold_balance ?? 0;
  const [stake, setStake] = useState(100);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const potential = Math.round(stake * totalOdds);
  const stakeValid = stake > 0 && stake <= balance;

  async function place() {
    setError(null);
    setBusy(true);
    try {
      await matchProvider.placeCoupon(
        selections.map((s) => s.option_id),
        stake,
      );
      clear();
      await refreshProfile();
      navigate('/coupons');
    } catch (err) {
      const raw = err instanceof Error ? err.message : '';
      setError(
        raw.includes('market_closed')
          ? 'A match on your coupon has closed for betting. Remove it and try again.'
          : raw.includes('Not enough gold')
            ? 'Not enough gold for that stake.'
            : raw || 'Could not place coupon',
      );
      setBusy(false);
    }
  }

  if (count === 0) {
    return (
      <div className="app-shell">
        <div className="page-head"><h1>Coupon</h1></div>
        <div className="empty">
          <p>Your coupon is empty. Add picks from the markets.</p>
          <button className="btn" onClick={() => navigate('/')}>Go to markets</button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="page-head">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h1>Coupon</h1>
          <button className="btn btn-ghost btn-sm" onClick={clear}>Clear all</button>
        </div>
      </div>

      <div className="slip-list">
        {selections.map((s) => (
          <div key={s.match_id} className="card slip-leg">
            <div className="slip-leg-main">
              <div className="slip-leg-match">{s.home_team} vs {s.away_team}</div>
              <div className="slip-leg-pick muted">
                <span className="tag" style={{ marginRight: 6 }}>{s.market_name}</span>
                {s.option_label}
                <span className="tnum"> @ {formatOdds(s.odds)}</span>
              </div>
            </div>
            <button
              className="slip-remove"
              aria-label="Remove selection"
              onClick={() => remove(s.match_id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="card slip-summary">
        <div className="slip-row">
          <span className="muted">Selections</span>
          <b className="tnum">{count}</b>
        </div>
        <div className="slip-row">
          <span className="muted">Total odds</span>
          <b className="tnum">{formatOdds(totalOdds)}</b>
        </div>

        <div className="slip-stake">
          <label htmlFor="stake">Stake (gold)</label>
          <input
            id="stake"
            className="input tnum"
            type="number"
            min={1}
            max={balance}
            value={stake}
            onChange={(e) => setStake(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
          />
          <div className="stake-quick">
            {QUICK.map((q) => (
              <button key={q} className="btn btn-sm" disabled={q > balance} onClick={() => setStake(q)}>
                {q}
              </button>
            ))}
            <button className="btn btn-sm" disabled={balance <= 0} onClick={() => setStake(balance)}>
              Max
            </button>
          </div>
          {session && <div className="stake-balance dim tnum">Balance: {balance} gold</div>}
        </div>

        <div className="slip-row slip-payout">
          <span>Potential win</span>
          <b className="tnum">{potential} gold</b>
        </div>

        {error && <div className="banner banner-error" style={{ marginTop: 'var(--s3)' }}>{error}</div>}
        {session && !stakeValid && stake > balance && (
          <div className="banner" style={{ marginTop: 'var(--s3)' }}>Stake exceeds your balance.</div>
        )}

        {session ? (
          <button
            className="btn btn-primary btn-block"
            style={{ marginTop: 'var(--s3)' }}
            disabled={busy || !stakeValid}
            onClick={place}
          >
            {busy ? '…' : `Place coupon · ${stake} gold`}
          </button>
        ) : (
          <button className="btn btn-primary btn-block" style={{ marginTop: 'var(--s3)' }} onClick={() => navigate('/login')}>
            Log in to play
          </button>
        )}
      </div>
    </div>
  );
}
