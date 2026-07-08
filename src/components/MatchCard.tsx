import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Match, LiveState } from '../lib/types';
import { formatKickoff } from '../lib/format';
import { teamColor, teamInitial } from '../lib/teams';
import MarketSection from './MarketSection';

function TeamBadge({ name }: { name: string }) {
  return (
    <span className="team-badge" style={{ background: teamColor(name) }} aria-hidden="true">{teamInitial(name)}</span>
  );
}

export default function MatchCard({ match, live, primaryType = 'match_result' }: { match: Match; live?: LiveState; primaryType?: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLive = live?.phase === 'live';

  const markets = [...match.markets].sort((a, b) => {
    if (a.market_type === primaryType) return -1;
    if (b.market_type === primaryType) return 1;
    return a.sort_order - b.sort_order;
  });
  const visibleMarkets = expanded ? markets : markets.slice(0, 1);
  const moreCount = markets.length - visibleMarkets.length;

  return (
    <div className="card contract">
      <div className="contract-head">
        {isLive
          ? <span className="row" style={{ gap: 8 }}><span className="live-badge">LIVE</span><span className="minute-red tnum">{live!.minute}&apos;</span></span>
          : <span className="tag">{match.sport === 'football' ? 'Football' : match.sport}</span>}
        {isLive
          ? <Link className="watch-link" to={`/live/${match.id}`}>Watch &rsaquo;</Link>
          : <span className="contract-time tnum">{formatKickoff(match.starts_at)}</span>}
      </div>

      <Link className="matchup matchup-rows" to={`/match/${match.id}`}>
        <span className="team team-home"><TeamBadge name={match.home_team} /><span className="team-name">{match.home_team}</span></span>
        {isLive && <span className="mc-score tnum">{live!.home_score}</span>}
      </Link>
      <Link className="matchup matchup-rows" to={`/match/${match.id}`} style={{ marginTop: 4 }}>
        <span className="team team-home"><TeamBadge name={match.away_team} /><span className="team-name">{match.away_team}</span></span>
        {isLive && <span className="mc-score tnum">{live!.away_score}</span>}
      </Link>

      {visibleMarkets.map((m) => (
        <MarketSection key={m.id} match={match} market={m} live={live} showTitle={markets.length > 1 && expanded} />
      ))}

      {moreCount > 0 && (
        <Link to={`/match/${match.id}`} className="more-markets" style={{ display: 'block', textAlign: 'center' }}>
          + {moreCount} more markets
        </Link>
      )}
      {expanded && markets.length > 1 && (
        <button type="button" className="more-markets" onClick={() => setExpanded(false)}>Show less</button>
      )}
    </div>
  );
}
