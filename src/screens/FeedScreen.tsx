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
        <div className="eyebrow">Today’s slate</div>
        <h1>Make your calls</h1>
        <p className="sub">
          Back your read, then watch it play out. Points and streaks follow —
          money never does.
        </p>
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      {loading ? (
        <div className="center-pad"><div className="spinner" /></div>
      ) : matches.length === 0 ? (
        <div className="empty-state">
          <div className="glyph">◎</div>
          <p>No matches on the board right now.</p>
          <button className="btn" style={{ marginTop: 14 }} onClick={() => load(true)}>
            Refresh
          </button>
        </div>
      ) : (
        <div className="match-list">
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
