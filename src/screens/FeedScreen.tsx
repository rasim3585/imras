import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import MatchRow from '../components/MatchRow';
import { EFootballIcon } from '../components/icons';
import { useAuth } from '../auth/AuthContext';
import { matchProvider } from '../lib/matchProvider';
import type { LiveState, Match } from '../lib/types';

type SportKey = 'live' | 'football' | 'basketball' | 'efootball' | 'ebasket' | 'tennis' | 'volley';
const SPORTS: { key: SportKey; label: string; soon?: boolean }[] = [
  { key: 'live', label: 'Live' },
  { key: 'football', label: 'Football', soon: true },
  { key: 'basketball', label: 'Basketball', soon: true },
  { key: 'efootball', label: 'E-Football' },
  { key: 'ebasket', label: 'E-Basket', soon: true },
  { key: 'tennis', label: 'Tennis', soon: true },
  { key: 'volley', label: 'Volleyball', soon: true },
];

function Cols() {
  return (
    <div className="ll-cols">
      <span className="lead">Match</span>
      <span>1</span><span>X</span><span>2</span>
      <span className="ll-c-sec">Alt</span><span className="ll-c-sec">Üst</span><span className="ll-c-sec">BTTS</span>
      <span className="ll-c-plus">+</span>
    </div>
  );
}

export default function FeedScreen() {
  const { session } = useAuth();
  const [matches, setMatches] = useState<Match[]>([]);
  const [liveMap, setLiveMap] = useState<Record<string, LiveState>>({});
  const [sport, setSport] = useState<SportKey>('efootball');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const ids = useRef<string[]>([]);

  const loadBulletin = useCallback(async (seed: boolean) => {
    try {
      setError(null);
      await matchProvider.finalizeDueMatches().catch(() => 0);
      await matchProvider.settleDueCoupons().catch(() => 0);
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
    const refresh = setInterval(() => void loadBulletin(true).then(pollLive), 20000);
    const live = setInterval(() => void pollLive(), 2500);
    return () => { clearInterval(refresh); clearInterval(live); };
  }, [loadBulletin, pollLive]);

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
  const isSoon = SPORTS.find((s) => s.key === sport)?.soon;

  return (
    <div className="app-shell app-shell-wide">
      {!session && (
        <div className="landing-hero card">
          <h2>Real betting thrills, zero money.</h2>
          <p>Predict virtual matches, watch them play out live, and compete with friends — all with symbolic gold. No wagering, ever.</p>
          <div className="row" style={{ gap: 'var(--s2)' }}>
            <Link to="/login" className="btn btn-primary">Sign up free</Link>
            <Link to="/login" className="btn btn-ghost">Log in</Link>
          </div>
        </div>
      )}

      <div className="sport-bar">
        {SPORTS.map((s) => (
          <button key={s.key} className={`sport-tab ${sport === s.key ? 'active' : ''}`} onClick={() => setSport(s.key)}>
            {s.key === 'efootball' && <EFootballIcon size={16} />}
            {s.key === 'live' && <span className="dot" />}
            {s.label}{s.soon && <span className="soon-dot">soon</span>}
          </button>
        ))}
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      {isSoon ? (
        <div className="empty"><p>{SPORTS.find((s) => s.key === sport)?.label} is coming soon.</p></div>
      ) : loading ? (
        <div className="center-pad"><div className="spinner" /></div>
      ) : (sport === 'live' && liveOnes.length === 0) ? (
        <div className="empty"><p>No live matches right now. Check E-Football for what's starting soon.</p></div>
      ) : visible.length === 0 ? (
        <div className="empty">
          <p>No open markets right now.</p>
          <button className="btn" onClick={() => loadBulletin(true)}>Refresh</button>
        </div>
      ) : (
        <div className="ll">
          {liveOnes.length > 0 && (
            <>
              <div className="ll-bar">
                <span className="ll-bar-l"><EFootballIcon size={20} /> E-Football · live</span>
                <span className="ll-bar-r"><span className="dot" />{liveOnes.length} live</span>
              </div>
              <Cols />
              {liveOnes.map((m) => <MatchRow key={m.id} match={m} live={liveMap[m.id]} />)}
            </>
          )}
          {sport !== 'live' && upcoming.length > 0 && (
            <>
              <div className="ll-bar">
                <span className="ll-bar-l"><EFootballIcon size={20} /> E-Football · starting soon</span>
                <span className="ll-bar-r tnum">2 × ~50s</span>
              </div>
              <Cols />
              {upcoming.map((m) => <MatchRow key={m.id} match={m} live={liveMap[m.id]} />)}
            </>
          )}
        </div>
      )}
    </div>
  );
}
