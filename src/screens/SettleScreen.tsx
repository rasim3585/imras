import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { matchProvider } from '../lib/matchProvider';
import { useAuth } from '../auth/AuthContext';
import type { CouponSettlement } from '../lib/types';
import { formatOdds } from '../lib/format';

type Phase = 'loading' | 'revealing' | 'final';
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export default function SettleScreen() {
  const { couponId } = useParams<{ couponId: string }>();
  const navigate = useNavigate();
  const { refreshProfile } = useAuth();

  const [phase, setPhase] = useState<Phase>('loading');
  const [data, setData] = useState<CouponSettlement | null>(null);
  const [revealed, setRevealed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!couponId) return;
    let alive = true;
    (async () => {
      try {
        // settle_coupon is idempotent — finalizes + grades on first call, then
        // just returns the graded result. We pace the reveal client-side.
        const s = await matchProvider.settleCoupon(couponId);
        if (!alive) return;
        setData(s);
        setPhase('revealing');
        for (let i = 0; i < s.selections.length; i++) {
          await sleep(1100);
          if (!alive) return;
          setRevealed(i + 1);
          await sleep(550);
          if (!alive) return;
        }
        await sleep(500);
        if (!alive) return;
        setPhase('final');
        void refreshProfile();
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'Could not settle this coupon');
      }
    })();
    return () => { alive = false; };
  }, [couponId, refreshProfile]);

  if (error) {
    return (
      <div className="app-shell" style={{ paddingTop: 'var(--s6)' }}>
        <div className="banner banner-error">{error}</div>
        <button className="btn btn-block" onClick={() => navigate('/coupons')}>Back to coupons</button>
      </div>
    );
  }

  if (!data || phase === 'loading') {
    return (
      <div className="settle">
        <div className="spinner" />
        <p className="settle-note">Settling your coupon…</p>
      </div>
    );
  }

  const won = data.status === 'won';
  const total = data.selections.length;

  return (
    <div className="app-shell settle-shell">
      <div className="settle-top">
        {phase === 'final'
          ? <span className={`chip ${won ? 'chip-pos' : 'chip-neg'}`}>{won ? 'Coupon won' : 'Coupon lost'}</span>
          : <span className="chip chip-live"><span className="dot" />Settling · {Math.min(revealed, total)}/{total}</span>}
      </div>

      <div className="settle-legs">
        {data.selections.map((s, i) => {
          const isRevealed = i < revealed;
          const hit = s.status === 'won';
          return (
            <div key={s.selection_id} className={`card settle-leg ${isRevealed ? (hit ? 'hit' : 'miss') : 'wait'}`}>
              <div className="settle-leg-main">
                <div className="settle-leg-match">{s.home_team} vs {s.away_team}</div>
                <div className="settle-leg-pick muted tnum">
                  <span className="tag" style={{ marginRight: 6 }}>{s.market_name}</span>
                  {s.option_label} @ {formatOdds(s.odds)}
                </div>
              </div>
              <div className="settle-leg-right">
                {!isRevealed ? (
                  <span className="settle-leg-score dim tnum">– : –</span>
                ) : (
                  <>
                    <span className="settle-leg-score tnum">{s.home_score} : {s.away_score}</span>
                    <span className={`chip ${hit ? 'chip-pos' : 'chip-neg'}`}>
                      {hit ? 'Hit' : 'Miss'}
                    </span>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {phase === 'final' && (
        <div className="receipt" style={{ maxWidth: '100%' }}>
          <div className="receipt-rows">
            <div className="receipt-row">
              <span className="k">Stake</span>
              <span className="v tnum">{data.stake} gold</span>
            </div>
            <div className="receipt-row">
              <span className="k">Total odds</span>
              <span className="v tnum">{formatOdds(data.total_odds)}</span>
            </div>
            <div className={`receipt-row ${won ? 'pts' : ''}`}>
              <span className="k">{won ? 'Payout' : 'Result'}</span>
              <span className="v tnum">{won ? `+${data.potential_win} gold` : 'No return'}</span>
            </div>
            <div className="receipt-row">
              <span className="k">Balance</span>
              <span className="v tnum">{data.new_balance} gold</span>
            </div>
          </div>

          <div className="settle-actions">
            <button className="btn btn-primary btn-block" onClick={() => navigate('/')}>
              Back to markets
            </button>
            <button className="btn btn-ghost btn-block" onClick={() => navigate('/coupons')}>
              My coupons
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
