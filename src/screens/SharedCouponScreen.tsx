import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { matchProvider } from '../lib/matchProvider';
import { LogoMarkLarge, Wordmark } from '../components/Brand';
import { formatOdds } from '../lib/format';
import type { SharedCoupon } from '../lib/types';

// Public, no-auth preview of a shared coupon (the target of an external link).
// Shows only safe fields; ends with a sign-up call to action.
export default function SharedCouponScreen() {
  const { token } = useParams<{ token: string }>();
  const [coupon, setCoupon] = useState<SharedCoupon | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'missing'>('loading');

  useEffect(() => {
    if (!token) return;
    matchProvider.getSharedCoupon(token)
      .then((c) => { setCoupon(c); setState(c ? 'ok' : 'missing'); })
      .catch(() => setState('missing'));
  }, [token]);

  const legs = coupon?.legs ?? [];
  const won = coupon?.status === 'won';

  return (
    <div className="share-page">
      <div className="share-card card">
        <Link to="/" className="share-brand"><LogoMarkLarge size={44} /><Wordmark size={18} /></Link>

        {state === 'loading' && <div className="center-pad"><div className="spinner" /></div>}
        {state === 'missing' && (
          <div className="empty" style={{ marginTop: 'var(--s4)' }}>
            <p>This coupon link isn't available.</p>
            <Link to="/" className="btn btn-primary">Explore imras</Link>
          </div>
        )}

        {state === 'ok' && coupon && (
          <>
            <div className="share-head">
              <span className="tag">{coupon.username}'s coupon</span>
              <span className={`chip ${won ? 'chip-pos' : coupon.status === 'lost' ? 'chip-neg' : ''}`}>
                {won ? `Won +${coupon.potential_win}` : coupon.status === 'lost' ? 'Lost' : coupon.status === 'cashed_out' ? 'Cashed out' : `${legs.length === 1 ? 'Single' : `${legs.length}-fold`}`}
              </span>
            </div>

            <div className="coupon-legs" style={{ marginTop: 'var(--s3)' }}>
              {legs.map((s) => (
                <div key={s.option_id} className={`coupon-leg ${s.status === 'won' ? 'leg-hit' : s.status === 'lost' ? 'leg-miss' : ''}`}>
                  <span className="leg-match">{s.home_team} vs {s.away_team}</span>
                  <span className="leg-pick tnum"><span className="muted">{s.market_name}:</span> {s.option_label} @ {formatOdds(s.odds)}</span>
                </div>
              ))}
            </div>

            <div className="share-metrics">
              <div><span className="muted">Total odds</span><b className="tnum">{formatOdds(coupon.total_odds)}</b></div>
              <div><span className="muted">{won ? 'Won' : 'Potential'}</span><b className="tnum">{coupon.potential_win}</b></div>
            </div>

            <div className="share-cta">
              <p>Play the same match with symbolic gold — free, no real money.</p>
              <Link to="/login" className="btn btn-primary btn-block">Sign up free</Link>
              <Link to="/" className="btn btn-ghost btn-block" style={{ marginTop: 'var(--s2)' }}>Browse the bulletin</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
