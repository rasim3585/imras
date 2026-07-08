import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { matchProvider } from '../lib/matchProvider';
import type { Coupon } from '../lib/types';
import { formatOdds } from '../lib/format';

function StatusChip({ c }: { c: Coupon }) {
  if (c.status === 'won') return <span className="chip chip-pos tnum">Won +{c.potential_win}</span>;
  if (c.status === 'lost') return <span className="chip chip-neg">Lost</span>;
  return <span className="chip">Open</span>;
}

export default function MyCouponsScreen() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        setCoupons(await matchProvider.getMyCoupons());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load coupons');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="app-shell">
      <div className="page-head">
        <h1>My coupons</h1>
        <p className="page-sub">Open coupons wait to be settled; settled ones show the outcome.</p>
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      {loading ? (
        <div className="center-pad"><div className="spinner" /></div>
      ) : coupons.length === 0 ? (
        <div className="empty">
          <p>No coupons yet. Build one from the markets.</p>
          <button className="btn" onClick={() => navigate('/')}>Go to markets</button>
        </div>
      ) : (
        <div className="coupon-list">
          {coupons.map((c) => (
            <div key={c.id} className="card coupon-card">
              <div className="coupon-card-head">
                <span className="tag">{c.legs.length === 1 ? 'Single' : `${c.legs.length}-fold`}</span>
                <StatusChip c={c} />
              </div>

              <div className="coupon-legs">
                {c.legs.map((s) => {
                  const mark = s.status === 'pending' ? '' : s.status === 'won' ? 'leg-hit' : 'leg-miss';
                  const inner = (
                    <>
                      <span className="leg-match">{s.match.home_team} vs {s.match.away_team}</span>
                      <span className="leg-pick tnum">
                        <span className="muted">{s.market_name}:</span> {s.option_label} @ {formatOdds(s.odds)}
                      </span>
                    </>
                  );
                  // open coupons: tap a leg to watch that match live
                  return c.status === 'pending' ? (
                    <Link key={s.id} className={`coupon-leg leg-link ${mark}`} to={`/live/${s.match.id}`}>{inner}</Link>
                  ) : (
                    <div key={s.id} className={`coupon-leg ${mark}`}>{inner}</div>
                  );
                })}
              </div>

              {c.status === 'pending' && (
                <div className="dim leg-hint">Tap a match to watch it live</div>
              )}

              <div className="coupon-card-foot">
                <div className="coupon-foot-metrics">
                  <span><span className="muted">Stake</span> <b className="tnum">{c.stake}</b></span>
                  <span><span className="muted">Odds</span> <b className="tnum">{formatOdds(c.total_odds)}</b></span>
                  <span>
                    <span className="muted">{c.status === 'won' ? 'Won' : 'To win'}</span>{' '}
                    <b className="tnum">{c.potential_win}</b>
                  </span>
                </div>
                {c.status === 'pending' && (
                  <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/settle/${c.id}`)}>
                    Settle now
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
