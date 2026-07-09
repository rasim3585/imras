import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import MatchRow from '../components/MatchRow';
import { EFootballIcon } from '../components/icons';
import { useAuth } from '../auth/AuthContext';
import { matchProvider } from '../lib/matchProvider';
import type { BulletinMatch } from '../lib/types';

const LIVE = new Set(['inprogress', 'live', 'penalties']);

type SportKey = 'live' | 'all' | 'football' | 'efootball' | 'basketball' | 'tennis' | 'volley';
const SPORTS: { key: SportKey; label: string; icon: string; soon?: boolean }[] = [
  { key: 'live', label: 'Live', icon: '⚡' },
  { key: 'all', label: 'All', icon: '📋' },
  { key: 'football', label: 'Football', icon: '⚽' },
  { key: 'efootball', label: 'E-Football', icon: '' },
  { key: 'basketball', label: 'Basketball', icon: '🏀', soon: true },
  { key: 'tennis', label: 'Tennis', icon: '🎾', soon: true },
  { key: 'volley', label: 'Volleyball', icon: '🏐', soon: true },
];

function Cols() {
  return (
    <div className="ll-cols">
      <span className="lead">Match</span>
      <span>1</span><span>X</span><span>2</span>
      <span className="ll-c-sec">Under</span><span className="ll-c-sec">Over</span><span className="ll-c-sec">BTTS</span>
      <span className="ll-c-plus">+</span>
    </div>
  );
}

export default function FeedScreen() {
  const { session } = useAuth();
  const [matches, setMatches] = useState<BulletinMatch[]>([]);
  const [sport, setSport] = useState<SportKey>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const poll = useCallback(async () => {
    try {
      const ms = await matchProvider.getBulletin();
      setMatches(ms);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the bulletin');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // slower loop advances the virtual world (finish/settle/seed); fast loop just
    // refreshes prices + scores.
    const advance = async () => {
      await matchProvider.finalizeDueMatches().catch(() => 0);
      await matchProvider.settleDueCoupons().catch(() => 0);
      await matchProvider.ensureMatches().catch(() => undefined);
    };
    void advance().then(poll);
    const world = setInterval(() => void advance().then(poll), 20000);
    const fast = setInterval(() => void poll(), 5000);
    return () => { clearInterval(world); clearInterval(fast); };
  }, [poll]);

  const notFinished = matches.filter((m) => m.status !== 'finished');
  const liveAll = notFinished.filter((m) => LIVE.has(m.status));
  const realOnes = notFinished.filter((m) => m.kind === 'real');
  const virtualOnes = notFinished.filter((m) => m.kind === 'virtual');

  const spec = SPORTS.find((s) => s.key === sport);
  const set = sport === 'live' ? liveAll : sport === 'all' ? notFinished
    : sport === 'football' ? realOnes : sport === 'efootball' ? virtualOnes : [];
  const live = set.filter((m) => LIVE.has(m.status)).sort((a, b) => (b.minute ?? 0) - (a.minute ?? 0));
  const upcoming = set.filter((m) => !LIVE.has(m.status)).sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  const section = (title: string, right: ReactNode, list: BulletinMatch[]) => list.length > 0 && (
    <>
      <div className="ll-bar"><span className="ll-bar-l"><EFootballIcon size={19} /> {title}</span>{right}</div>
      <Cols />
      {list.map((m) => <MatchRow key={m.id} m={m} />)}
    </>
  );

  const upTitle = sport === 'efootball' ? 'E-Football · 2×4 min' : sport === 'football' ? 'Football' : 'Upcoming';
  const upRight = sport === 'football' ? 'BSD' : sport === 'efootball' ? 'sim' : `${upcoming.length}`;

  return (
    <div className="app-shell app-shell-wide">
      {!session && (
        <div className="landing-hero card">
          <h2>Real betting thrills, zero money.</h2>
          <p>Predict real & virtual matches, watch them play out live, and compete with friends — all with symbolic gold. No wagering, ever.</p>
          <div className="row" style={{ gap: 'var(--s2)' }}>
            <Link to="/login" className="btn btn-primary">Sign up free</Link>
            <Link to="/login" className="btn btn-ghost">Log in</Link>
          </div>
        </div>
      )}

      <div className="sport-bar">
        {SPORTS.map((s) => {
          const cnt = s.key === 'live' ? liveAll.length : s.key === 'all' ? notFinished.length
            : s.key === 'football' ? realOnes.length : s.key === 'efootball' ? virtualOnes.length : null;
          return (
            <button key={s.key} className={`sport-tab ${sport === s.key ? 'active' : ''} ${s.soon ? 'soon' : ''}`} onClick={() => setSport(s.key)}>
              {s.key === 'efootball' ? <EFootballIcon size={19} /> : <span className="sport-ic">{s.icon}</span>}
              {s.label}
              {s.soon ? <span className="soon-badge">soon</span> : cnt != null ? <span className="sport-cnt">{cnt}</span> : null}
            </button>
          );
        })}
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      {spec?.soon ? (
        <div className="empty"><p>{spec.label} is coming soon.</p></div>
      ) : loading ? (
        <div className="center-pad"><div className="spinner" /></div>
      ) : set.length === 0 ? (
        <div className="empty"><p>{sport === 'live' ? 'No live matches right now.' : 'No open matches right now.'}</p></div>
      ) : (
        <div className="ll">
          {section('Live', <span className="ll-bar-r"><span className="dot" />{live.length} live</span>, live)}
          {sport !== 'live' && section(upTitle, <span className="ll-bar-r">{upRight}</span>, upcoming)}
        </div>
      )}
    </div>
  );
}
