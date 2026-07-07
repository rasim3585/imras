import { useCallback, useEffect, useState } from 'react';
import MatchCard from '../components/MatchCard';
import { matchProvider } from '../lib/matchProvider';
import type { MatchWithPick, Outcome } from '../lib/types';

export default function FeedScreen() {
  const [matches, setMatches] = useState<MatchWithPick[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(async (seed: boolean) => {
    try {
      setError(null);
      if (seed) await matchProvider.ensureMatches();
      setMatches(await matchProvider.getUpcoming());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load matches');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(true);
  }, [load]);

  async function handlePick(matchId: string, pick: Outcome) {
    setPendingId(matchId);
    setError(null);
    // optimistic: mark the pick immediately
    setMatches((prev) =>
      prev.map((m) => (m.id === matchId ? { ...m, myPick: pick } : m)),
    );
    try {
      await matchProvider.submitPrediction(matchId, pick);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your call');
      // revert on failure
      setMatches((prev) =>
        prev.map((m) => (m.id === matchId ? { ...m, myPick: null } : m)),
      );
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="app-shell">
      <div className="page-head">
        <h1>Markets</h1>
        <p className="page-sub">
          Price your read on each match. Settle when you like — points and streak
          follow accuracy, never money.
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
            <MatchCard
              key={m.id}
              match={m}
              pending={pendingId === m.id}
              onPick={handlePick}
            />
          ))}
        </div>
      )}
    </div>
  );
}
