import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { matchProvider } from '../lib/matchProvider';
import type { Coupon } from '../lib/types';
import { accuracyPct, formatOdds } from '../lib/format';

function isBonusAvailable(last: string | null): boolean {
  if (!last) return true;
  const d = new Date(last);
  const now = new Date();
  return (
    d.getFullYear() !== now.getFullYear() ||
    d.getMonth() !== now.getMonth() ||
    d.getDate() !== now.getDate()
  );
}

export default function ProfileScreen() {
  const { profile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setCoupons(await matchProvider.getMyCoupons());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load your history');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const stats = useMemo(() => {
    const settled = coupons.filter((c) => c.status !== 'pending');
    const won = settled.filter((c) => c.status === 'won');
    const biggest = won.reduce((m, c) => Math.max(m, c.potential_win), 0);
    // pick-level accuracy across all graded legs
    let legTotal = 0, legHit = 0;
    for (const c of coupons)
      for (const s of c.legs)
        if (s.status !== 'pending') { legTotal++; if (s.status === 'won') legHit++; }
    return {
      played: coupons.length,
      settled: settled.length,
      won: won.length,
      biggest,
      accuracy: accuracyPct(legHit, legTotal),
    };
  }, [coupons]);

  const balance = profile?.gold_balance ?? 0;
  const bonusReady = isBonusAvailable(profile?.last_daily_bonus_at ?? null);
  const canTopup = balance < 100;

  async function claimBonus() {
    setBusy(true);
    try { await matchProvider.claimDailyBonus(); await refreshProfile(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not claim bonus'); }
    finally { setBusy(false); }
  }
  async function topup() {
    setBusy(true);
    try { await matchProvider.topupGold(); await refreshProfile(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not top up'); }
    finally { setBusy(false); }
  }

  return (
    <div className="app-shell">
      <div className="page-head">
        <h1>{profile?.username ?? '—'}</h1>
        <p className="page-sub">Your gold, your coupons. Symbolic only — never real money.</p>
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      <div className="card gold-panel">
        <div className="gold-main">
          <span className="stat-k">Gold balance</span>
          <span className="gold-value tnum">{balance.toLocaleString()}</span>
        </div>
        <div className="gold-actions">
          {bonusReady && (
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={claimBonus}>
              Claim daily +500
            </button>
          )}
          {canTopup && (
            <button className="btn btn-sm" disabled={busy} onClick={topup}>
              Top up to 500
            </button>
          )}
          {!bonusReady && !canTopup && (
            <span className="dim" style={{ fontSize: '0.82rem' }}>Daily bonus claimed. Come back tomorrow.</span>
          )}
        </div>
      </div>

      <div className="stat-grid" style={{ marginTop: 'var(--s2)' }}>
        <div className="stat">
          <span className="stat-k">Pick accuracy</span>
          <span className="stat-v tnum">{stats.accuracy}%</span>
        </div>
        <div className="stat">
          <span className="stat-k">Coupons won</span>
          <span className="stat-v tnum">{stats.won}</span>
        </div>
        <div className="stat">
          <span className="stat-k">Coupons played</span>
          <span className="stat-v tnum">{stats.played}</span>
        </div>
        <div className="stat" style={{ gridColumn: 'span 3' }}>
          <span className="stat-k">Biggest win</span>
          <span className="stat-v tnum pos">{stats.biggest.toLocaleString()} gold</span>
        </div>
      </div>

      <div className="section-head"><h3>Recent coupons</h3></div>
      {loading ? (
        <div className="center-pad"><div className="spinner" /></div>
      ) : coupons.length === 0 ? (
        <div className="empty">
          <p>No coupons yet. Head to the markets and build one.</p>
          <button className="btn" onClick={() => navigate('/')}>Go to markets</button>
        </div>
      ) : (
        <div className="table">
          {coupons.slice(0, 12).map((c) => (
            <button
              key={c.id}
              className="trow trow-btn"
              onClick={() => navigate(c.status === 'pending' ? `/settle/${c.id}` : '/coupons')}
            >
              <div className="trow-main">
                <div className="trow-match">
                  {c.legs.length === 1 ? 'Single' : `${c.legs.length}-fold`} · {c.stake} gold
                </div>
                <div className="trow-sub">@ {formatOdds(c.total_odds)} · to win {c.potential_win}</div>
              </div>
              <div className="trow-right">
                {c.status === 'won' ? (
                  <span className="chip chip-pos tnum">+{c.potential_win}</span>
                ) : c.status === 'lost' ? (
                  <span className="chip chip-neg">Lost</span>
                ) : (
                  <span className="chip chip-accent">Open</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
