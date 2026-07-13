import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import MatchRow from '../components/MatchRow';
import { EFootballIcon, EBasketballIcon, ETennisIcon, BallIcon } from '../components/icons';
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
  { key: 'basketball', label: 'e-Basketball', icon: '🏀' },
  { key: 'tennis', label: 'e-Tennis', icon: '🎾' },
  { key: 'volley', label: 'Volleyball', icon: '🏐', soon: true },
];

function Cols({ bb, tn }: { bb?: boolean; tn?: boolean } = {}) {
  if (tn) return (
    <div className="ll-cols">
      <span className="lead">Match</span>
      <span>1</span><span>2</span>
      <span className="ll-c-sec">Üst</span><span className="ll-c-sec">Alt</span>
      <span className="ll-c-sec">İS1</span><span className="ll-c-sec">İS2</span>
      <span className="ll-c-plus">+</span>
    </div>
  );
  if (bb) return (
    <div className="ll-cols">
      <span className="lead">Match</span>
      <span>1</span><span>2</span>
      <span className="ll-c-sec">Hnd</span><span className="ll-c-sec">Hnd</span>
      <span className="ll-c-sec">Üst</span><span className="ll-c-sec">Alt</span>
      <span className="ll-c-plus">+</span>
    </div>
  );
  return (
    <div className="ll-cols">
      <span className="lead">Match</span>
      <span>1</span><span>X</span><span>2</span>
      <span className="ll-c-sec">Under</span><span className="ll-c-sec">Over</span><span className="ll-c-sec">BTTS</span>
      <span className="ll-c-plus">+</span>
    </div>
  );
}

// Two-level bulletin grouping (Nesine/bet365 style): country > league. We do NOT
// trust the backend's flow order -- get_bulletin returns by kickoff (sort_at), so
// the same league appears scattered. We CONSOLIDATE every match of a league into
// one group (find/merge) regardless of position, then sort deterministically:
//   countries A-Z, leagues A-Z, matches within a league by kickoff.
// Virtual matches (country null) collect under one "Simulated" bucket, pinned
// last, sorted by kickoff.
type LeagueGroup = { league: string; matches: BulletinMatch[] };
type CountryGroup = { country: string; count: number; leagues: LeagueGroup[] };
function groupMatches(list: BulletinMatch[]): { countries: CountryGroup[]; virtual: BulletinMatch[] } {
  const countries: CountryGroup[] = [];
  const virtual: BulletinMatch[] = [];
  for (const m of list) {
    // ONLY true virtual matches go to "Simulated". A real match with a missing
    // country (backend data gap) still groups as real -- under "Other" -- never
    // mislabelled as simulated.
    if (m.kind === 'virtual') { virtual.push(m); continue; }
    const cName = m.country ?? 'Other';
    const lName = m.league ?? 'Other';
    let cg = countries.find((c) => c.country === cName);
    if (!cg) { cg = { country: cName, count: 0, leagues: [] }; countries.push(cg); }
    cg.count++;
    let lg = cg.leagues.find((l) => l.league === lName);
    if (!lg) { lg = { league: lName, matches: [] }; cg.leagues.push(lg); }
    lg.matches.push(m);
  }
  const byKickoff = (a: BulletinMatch, b: BulletinMatch) => a.starts_at.localeCompare(b.starts_at);
  for (const cg of countries) {
    for (const lg of cg.leagues) lg.matches.sort(byKickoff);
    // busiest league first; alphabetical tiebreak keeps it deterministic
    cg.leagues.sort((a, b) => b.matches.length - a.matches.length || a.league.localeCompare(b.league));
  }
  countries.sort((a, b) => b.count - a.count || a.country.localeCompare(b.country));
  virtual.sort(byKickoff);
  return { countries, virtual };
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
  const virtualOnes = notFinished.filter((m) => m.kind === 'virtual' && m.sport === 'football');
  const basketballOnes = notFinished.filter((m) => m.sport === 'basketball');
  const tennisOnes = notFinished.filter((m) => m.sport === 'tennis');

  const spec = SPORTS.find((s) => s.key === sport);
  const set = sport === 'live' ? liveAll : sport === 'all' ? notFinished
    : sport === 'football' ? realOnes : sport === 'efootball' ? virtualOnes
    : sport === 'basketball' ? basketballOnes : sport === 'tennis' ? tennisOnes : [];
  // Live stays a single flat section (few matches, cross-league). Upcoming keeps
  // the backend's country>league>sort_at order untouched so the grouping headers
  // fall in the right places -- no client re-sort.
  // Live: REAL live matches first, then virtual live matches; minute desc within each.
  const live = set.filter((m) => LIVE.has(m.status)).sort((a, b) => {
    const ak = a.kind === 'virtual' ? 1 : 0, bk = b.kind === 'virtual' ? 1 : 0;
    return ak - bk || (b.minute ?? 0) - (a.minute ?? 0);
  });
  const upcoming = set.filter((m) => !LIVE.has(m.status));
  const grouped = groupMatches(upcoming);

  const section = (title: string, right: ReactNode, list: BulletinMatch[], icon: ReactNode = <EFootballIcon size={19} />, cols: { bb?: boolean; tn?: boolean } = {}) => list.length > 0 && (
    <>
      <div className="ll-bar"><span className="ll-bar-l">{icon} {title}</span>{right}</div>
      <Cols {...cols} />
      {list.map((m) => <MatchRow key={m.id} m={m} hideLeague />)}
    </>
  );

  const liveCount = (n: number) => <span className="ll-bar-r"><span className="dot" />{n} live</span>;

  return (
    <div className="app-shell app-shell-wide">
      {!session && (
        <div className="landing-hero card">
          <h2>Real betting thrills, zero money.</h2>
          <p>Predict real & virtual matches, watch them play out live, and compete with friends — all with free virtual coins. No real money, ever.</p>
          <div className="row" style={{ gap: 'var(--s2)' }}>
            <Link to="/login" className="btn btn-primary">Sign up free</Link>
            <Link to="/login" className="btn btn-ghost">Log in</Link>
          </div>
        </div>
      )}

      <div className="sport-bar">
        {SPORTS.map((s) => {
          const cnt = s.key === 'live' ? liveAll.length : s.key === 'all' ? notFinished.length
            : s.key === 'football' ? realOnes.length : s.key === 'efootball' ? virtualOnes.length
            : s.key === 'basketball' ? basketballOnes.length : s.key === 'tennis' ? tennisOnes.length : null;
          return (
            <button key={s.key} className={`sport-tab ${sport === s.key ? 'active' : ''} ${s.soon ? 'soon' : ''}`} onClick={() => setSport(s.key)}>
              {s.key === 'efootball' ? <EFootballIcon size={19} /> : s.key === 'basketball' ? <EBasketballIcon size={19} /> : s.key === 'tennis' ? <ETennisIcon size={19} /> : <span className="sport-ic">{s.icon}</span>}
              {s.label}
              {s.soon ? <span className="soon-badge">soon</span> : cnt != null ? <span className="sport-cnt">{cnt}</span> : null}
            </button>
          );
        })}
      </div>

      <div className="std-link-row"><Link to="/standings" className="std-link">League tables ›</Link></div>

      {error && <div className="banner banner-error">{error}</div>}

      {spec?.soon ? (
        <div className="empty"><p>{spec.label} is coming soon.</p></div>
      ) : loading ? (
        <div className="center-pad"><div className="spinner" /></div>
      ) : set.length === 0 ? (
        <div className="empty"><p>{sport === 'live' ? 'No live matches right now.' : 'No open matches right now.'}</p></div>
      ) : (
        <div className="ll">
          {section('Live · Football', liveCount(live.filter((m) => m.kind === 'real').length), live.filter((m) => m.kind === 'real'), <BallIcon size={18} />)}
          {section('Live · E-Football', liveCount(live.filter((m) => m.kind === 'virtual' && m.sport === 'football').length), live.filter((m) => m.kind === 'virtual' && m.sport === 'football'))}
          {section('Live · Basketball', liveCount(live.filter((m) => m.sport === 'basketball').length), live.filter((m) => m.sport === 'basketball'), <EBasketballIcon size={19} />, { bb: true })}
          {section('Live · Tennis', liveCount(live.filter((m) => m.sport === 'tennis').length), live.filter((m) => m.sport === 'tennis'), <ETennisIcon size={19} />, { tn: true })}
          {sport !== 'live' && (
            <>
              {grouped.countries.map((cg) => (
                <div key={cg.country} className="ll-cgrp">
                  <div className="ll-country"><span>{cg.country}</span><span className="ll-country-n">{cg.count}</span></div>
                  {cg.leagues.map((lg) => (
                    <div key={lg.league}>
                      <div className="ll-bar"><span className="ll-bar-l">{lg.league}</span><span className="ll-bar-r">{lg.matches.length}</span></div>
                      <Cols />
                      {lg.matches.map((m) => <MatchRow key={m.id} m={m} hideLeague />)}
                    </div>
                  ))}
                </div>
              ))}
              {grouped.virtual.filter((m) => m.sport === 'football').length > 0 && (
                <div className="ll-cgrp">
                  <div className="ll-country"><span>Simulated</span><span className="ll-country-n">{grouped.virtual.filter((m) => m.sport === 'football').length}</span></div>
                  <div className="ll-bar"><span className="ll-bar-l"><EFootballIcon size={19} /> E-Football · 2×4 min</span><span className="ll-bar-r">sim</span></div>
                  <Cols />
                  {grouped.virtual.filter((m) => m.sport === 'football').map((m) => <MatchRow key={m.id} m={m} hideLeague />)}
                </div>
              )}
              {(() => {
                const bb = grouped.virtual.filter((m) => m.sport === 'basketball');
                if (bb.length === 0) return null;
                const leagues = [...new Set(bb.map((m) => m.league || 'e-Basketball'))].sort();
                return (
                  <div className="ll-cgrp">
                    <div className="ll-country"><span className="ll-cty-l"><EBasketballIcon size={16} /> e-Basketball</span><span className="ll-country-n">{bb.length}</span></div>
                    {leagues.map((lg) => (
                      <div key={lg}>
                        <div className="ll-bar"><span className="ll-bar-l">{lg} · 4×2 min</span><span className="ll-bar-r">sim</span></div>
                        <Cols bb />
                        {bb.filter((m) => (m.league || 'e-Basketball') === lg).map((m) => <MatchRow key={m.id} m={m} hideLeague />)}
                      </div>
                    ))}
                  </div>
                );
              })()}
              {(() => {
                const tn = grouped.virtual.filter((m) => m.sport === 'tennis');
                if (tn.length === 0) return null;
                const leagues = [...new Set(tn.map((m) => m.league || 'e-Tennis'))].sort();
                return (
                  <div className="ll-cgrp">
                    <div className="ll-country"><span className="ll-cty-l"><ETennisIcon size={16} /> e-Tennis</span><span className="ll-country-n">{tn.length}</span></div>
                    {leagues.map((lg) => (
                      <div key={lg}>
                        <div className="ll-bar"><span className="ll-bar-l">{lg} · Best of 3</span><span className="ll-bar-r">sim</span></div>
                        <Cols tn />
                        {tn.filter((m) => (m.league || 'e-Tennis') === lg).map((m) => <MatchRow key={m.id} m={m} hideLeague />)}
                      </div>
                    ))}
                  </div>
                );
              })()}
            </>
          )}
        </div>
      )}
    </div>
  );
}
