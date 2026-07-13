import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { matchProvider } from '../lib/matchProvider';
import { formatKickoff, bballClock } from '../lib/format';
import MarketSection from '../components/MarketSection';
import MatchStatsPanel from '../components/MatchStatsPanel';
import TeamCrest from '../components/TeamCrest';
import type { LiveState, Match } from '../lib/types';

// First-half markets are bettable pre-match ONLY (mirror of MarketSection's gate).
const HT_MARKETS = new Set(['ht_result', 'ht_over_under_0_5']);

// Market grouping. Each market_type lands in one tab; unmapped falls back to the
// first group so a new market never disappears silently. Football and basketball
// have their own tab sets.
type MarketGroup = { key: string; label: string; types: string[] };
const GROUPS: MarketGroup[] = [
  { key: 'result', label: 'Result', types: ['match_result', 'double_chance', 'ht_result'] },
  { key: 'ou', label: 'Over/Under', types: ['over_under_1_5', 'over_under_2_5', 'over_under_3_5', 'ht_over_under_0_5'] },
  { key: 'goals', label: 'Goals', types: ['both_teams_score', 'odd_even'] },
];
const BB_GROUPS: MarketGroup[] = [
  { key: 'result', label: 'Winner', types: ['bb_moneyline'] },
  { key: 'handicap', label: 'Handicap', types: ['bb_handicap'] },
  { key: 'totals', label: 'Totals', types: ['bb_total', 'bb_total_home', 'bb_total_away'] },
];
const groupOf = (groups: MarketGroup[], mt: string): string =>
  groups.find((g) => g.types.includes(mt))?.key ?? groups[0].key;

export default function MatchDetailScreen() {
  const { matchId } = useParams<{ matchId: string }>();
  const navigate = useNavigate();
  const [match, setMatch] = useState<Match | null>(null);
  const [live, setLive] = useState<LiveState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<string>('all');

  useEffect(() => {
    if (!matchId) return;
    let alive = true;
    matchProvider.getMatch(matchId)
      .then((m) => { if (alive) setMatch(m); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'Could not load the match'); });
    const poll = async () => {
      try { const [s] = await matchProvider.getLiveStates([matchId]); if (alive && s) setLive(s); }
      catch { /* transient */ }
    };
    void poll();
    const id = setInterval(poll, 2500);
    return () => { alive = false; clearInterval(id); };
  }, [matchId]);

  if (error) return <div className="app-shell" style={{ paddingTop: 'var(--s6)' }}><div className="banner banner-error">{error}</div><button className="btn btn-block" onClick={() => navigate(-1)}>Back</button></div>;
  if (!match) return <div className="settle"><div className="spinner" /></div>;

  const isLive = live?.phase === 'live';
  const isFinished = live?.phase === 'finished';

  // Markets currently offerable: hide first-half markets once the match is no
  // longer upcoming (they'd render as empty "Closed" boxes otherwise).
  const markets = [...match.markets]
    .sort((a, b) => a.sort_order - b.sort_order)
    .filter((m) => !HT_MARKETS.has(m.market_type) || live?.phase === 'upcoming');

  const groups = match.sport === 'basketball' ? BB_GROUPS : GROUPS;
  const groupsWith = groups.filter((g) => markets.some((m) => groupOf(groups, m.market_type) === g.key));
  const shownGroups = tab === 'all' ? groupsWith : groupsWith.filter((g) => g.key === tab);

  return (
    <div className="app-shell app-shell-flush">
      <button className="detail-back" onClick={() => navigate(-1)}>&lsaquo; Bulletin</button>

      <div className="scoreboard card">
        <div className="sb-top">
          {isLive
            ? <><span className="live-badge">LIVE</span><span className="minute-red tnum">{match.sport === 'basketball' ? bballClock(live!.minute, live!.period) : `${live!.minute}'`}</span></>
            : isFinished
              ? <span className="tag">Full time</span>
              : <span className="soon-timer tnum">{formatKickoff(match.starts_at)}</span>}
          <span className="tag" style={{ marginLeft: 'auto' }}>{match.sport === 'football' ? 'Football' : match.sport}</span>
        </div>
        <div className="sb-teams">
          <div className="sb-team">
            <TeamCrest name={match.home_team} size={34} className="sb-badge" />
            <span className="sb-name">{match.home_team}</span>
          </div>
          <span className="sb-score tnum">{live && live.phase !== 'upcoming' ? `${live.home_score} - ${live.away_score}` : 'vs'}</span>
          <div className="sb-team">
            <TeamCrest name={match.away_team} size={34} className="sb-badge" />
            <span className="sb-name">{match.away_team}</span>
          </div>
        </div>
        {match.sport !== 'basketball' && (isLive || isFinished) && (
          <Link className="btn btn-ghost btn-sm btn-block" style={{ marginTop: 'var(--s3)' }} to={`/live/${match.id}`}>Watch live</Link>
        )}
      </div>

      <MatchStatsPanel matchId={match.id} />

      {groupsWith.length > 1 && (
        <div className="bet-tabs">
          <button className={`bet-tab ${tab === 'all' ? 'active' : ''}`} onClick={() => setTab('all')}>All</button>
          {groupsWith.map((g) => (
            <button key={g.key} className={`bet-tab ${tab === g.key ? 'active' : ''}`} onClick={() => setTab(g.key)}>{g.label}</button>
          ))}
        </div>
      )}

      <div className="detail-markets">
        {shownGroups.flatMap((g) => {
          const list = markets.filter((m) => groupOf(groups, m.market_type) === g.key);
          const els = [];
          if (tab === 'all') els.push(<div key={`cat-${g.key}`} className="mkt-cat">{g.label}</div>);
          for (const m of list) {
            els.push(
              <div key={m.id} className="mkt-group">
                <div className="mkt-title">{m.name}{isLive && !HT_MARKETS.has(m.market_type) ? ' · live' : ''}</div>
                <MarketSection match={match} market={m} live={live ?? undefined} showTitle={false} />
              </div>,
            );
          }
          return els;
        })}
      </div>
    </div>
  );
}
