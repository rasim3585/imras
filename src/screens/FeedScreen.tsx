import { useCallback, useEffect, useRef, useState } from 'react';
import MatchCard from '../components/MatchCard';
import CouponBar from '../components/CouponBar';
import { matchProvider } from '../lib/matchProvider';
import type { LiveState, Match } from '../lib/types';

export default function FeedScreen() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [liveMap, setLiveMap] = useState<Record<string, LiveState>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const ids = useRef<string[]>([]);

  const loadBulletin = useCallback(async (seed: boolean) => {
    try {
      setError(null);
      await matchProvider.finalizeDueMatches().catch(() => 0); // advance the world
      if (seed) await matchProvider.ensureMatches();
      const ms = await matchProvider.getBulletin();
      setMatches(ms);
      ids.current = ms.map((m) => m.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the bulletin');
    } finally {
      setLoading(false);
    }
  }, []);

  const pollLive = useCallback(async () => {
    if (ids.current.length === 0) return;
    try {
      const states = await matchProvider.getLiveStates(ids.current);
      const map: Record<string, LiveState> = {};
      for (const s of states) map[s.match_id] = s;
      setLiveMap(map);
    } catch { /* transient */ }
  }, []);

  useEffect(() => {
    void loadBulletin(true).then(pollLive);
    const refresh = setInterval(() => void loadBulletin(true).then(pollLive), 20000); // new matches / drop finished
    const live = setInterval(() => void pollLive(), 2500); // live minutes + odds
    return () => { clearInterval(refresh); clearInterval(live); };
  }, [loadBulletin, pollLive]);

  // hide matches that read as finished or in the closing minutes (unbettable)
  const visible = matches.filter((m) => {
    const s = liveMap[m.id];
    if (!s) return true;
    if (s.phase === 'finished') return false;
    if (s.phase === 'live' && s.minute >= 85) return false;
    return true;
  });
  const liveOnes = visible.filter((m) => liveMap[m.id]?.phase === 'live')
    .sort((a, b) => (liveMap[b.id]!.minute) - (liveMap[a.id]!.minute));
  const upcoming = visible.filter((m) => liveMap[m.id]?.phase !== 'live');

  return (
    <>
      <div className="app-shell">
        <div className="page-head">
          <h1>Markets</h1>
          <p className="page-sub">Tap odds to build your coupon — pre-match or live. Play with gold, never money.</p>
        </div>

        {error && <div className="banner banner-error">{error}</div>}

        {loading ? (
          <div className="center-pad"><div className="spinner" /></div>
        ) : visible.length === 0 ? (
          <div className="empty">
            <p>No open markets right now.</p>
            <button className="btn" onClick={() => loadBulletin(true)}>Refresh</button>
          </div>
        ) : (
          <>
            {liveOnes.length > 0 && (
              <>
                <div className="section-head"><h3>Live now</h3><span className="chip chip-live"><span className="dot" />{liveOnes.length}</span></div>
                <div className="market-list">{liveOnes.map((m) => <MatchCard key={m.id} match={m} live={liveMap[m.id]} />)}</div>
              </>
            )}
            {upcoming.length > 0 && (
              <>
                <div className="section-head"><h3>Starting soon</h3></div>
                <div className="market-list">{upcoming.map((m) => <MatchCard key={m.id} match={m} live={liveMap[m.id]} />)}</div>
              </>
            )}
          </>
        )}
      </div>
      <CouponBar />
    </>
  );
}
