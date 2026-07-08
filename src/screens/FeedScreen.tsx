import { useCallback, useEffect, useState } from 'react';
import MatchCard from '../components/MatchCard';
import CouponBar from '../components/CouponBar';
import { matchProvider } from '../lib/matchProvider';
import type { Match } from '../lib/types';

export default function FeedScreen() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (seed: boolean) => {
    try {
      setError(null);
      // advance the world: finish any matches whose real time is over, then top up
      await matchProvider.finalizeDueMatches().catch(() => 0);
      if (seed) await matchProvider.ensureMatches();
      setMatches(await matchProvider.getUpcoming());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load markets');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(true);
  }, [load]);

  return (
    <>
      <div className="app-shell">
        <div className="page-head">
          <h1>Markets</h1>
          <p className="page-sub">
            Tap odds to build your coupon. Combine picks to multiply the odds —
            play with gold, never money.
          </p>
        </div>

        {error && <div className="banner banner-error">{error}</div>}

        {loading ? (
          <div className="center-pad"><div className="spinner" /></div>
        ) : matches.length === 0 ? (
          <div className="empty">
            <p>No open markets right now.</p>
            <button className="btn" onClick={() => load(true)}>Refresh</button>
          </div>
        ) : (
          <div className="market-list">
            {matches.map((m) => (
              <MatchCard key={m.id} match={m} />
            ))}
          </div>
        )}
      </div>
      <CouponBar />
    </>
  );
}
