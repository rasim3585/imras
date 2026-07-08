import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { matchProvider } from '../lib/matchProvider';
import { useAuth } from '../auth/AuthContext';
import type { Coupon } from '../lib/types';
import { formatOdds } from '../lib/format';

function StatusChip({ c }: { c: Coupon }) {
  if (c.status === 'won') return <span className="chip chip-pos tnum">Won +{c.potential_win}</span>;
  if (c.status === 'lost') return <span className="chip chip-neg">Lost</span>;
  if (c.status === 'cashed_out') return <span className="chip chip-accent tnum">Cashed out +{c.cashout_amount}</span>;
  return <span className="chip">Open</span>;
}

export default function MyCouponsScreen() {
  const { refreshProfile } = useAuth();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [cashouts, setCashouts] = useState<Record<string, { value: number; available: boolean }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [shared, setShared] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function share(couponId: string) {
    try { await matchProvider.shareCoupon(couponId); setShared((s) => new Set(s).add(couponId)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not share'); }
  }

  const load = useCallback(async () => {
    await matchProvider.settleDueCoupons().catch(() => 0); // auto-settle finished ones
    setCoupons(await matchProvider.getMyCoupons());
  }, []);

  useEffect(() => {
    load()
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load coupons'))
      .finally(() => setLoading(false));
  }, [load]);

  // live cash-out values for open coupons
  useEffect(() => {
    const open = coupons.filter((c) => c.status === 'pending');
    if (open.length === 0) return;
    let alive = true;
    const poll = async () => {
      const entries = await Promise.all(open.map(async (c) => {
        try { return [c.id, await matchProvider.getCashoutValue(c.id)] as const; }
        catch { return [c.id, { value: 0, available: false }] as const; }
      }));
      if (alive) setCashouts(Object.fromEntries(entries));
    };
    void poll();
    const id = setInterval(poll, 4000);
    return () => { alive = false; clearInterval(id); };
  }, [coupons]);

  async function cashout(couponId: string) {
    setBusy(couponId);
    try {
      await matchProvider.doCashout(couponId);
      await refreshProfile();
      await load();
    } catch (err) {
      setError(err instanceof Error && err.message.includes('cashout_unavailable')
        ? 'Cash out is no longer available for this coupon.'
        : err instanceof Error ? err.message : 'Could not cash out');
    } finally {
      setBusy(null);
    }
  }

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
            <div key={c.id} className={`card coupon-card cc-${c.status}`}>
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
                <div className="dim leg-hint">Tap a match to watch it live · settles automatically when they finish</div>
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
                <div className="row" style={{ gap: 'var(--s2)' }}>
                  <button className="btn btn-ghost btn-sm" disabled={shared.has(c.id)} onClick={() => share(c.id)}>
                    {shared.has(c.id) ? 'Shared' : 'Share'}
                  </button>
                  {c.status === 'pending' && cashouts[c.id]?.available && (
                    <button className="btn btn-primary btn-sm" disabled={busy === c.id} onClick={() => cashout(c.id)}>
                      {busy === c.id ? '…' : `Cash out ${cashouts[c.id].value}`}
                    </button>
                  )}
                  {c.status !== 'pending' && (
                    <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/settle/${c.id}`)}>
                      View result
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
