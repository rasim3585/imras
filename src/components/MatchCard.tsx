import { Link } from 'react-router-dom';
import type { Match, Market, LiveState, Outcome } from '../lib/types';
import { formatKickoff, formatOdds, impliedProb } from '../lib/format';
import { teamColor, teamInitial } from '../lib/teams';
import { BallIcon } from './icons';
import { useCart } from '../coupon/CartContext';

function TeamBadge({ name }: { name: string }) {
  return (
    <span className="team-badge" style={{ background: teamColor(name) }} aria-hidden="true">{teamInitial(name)}</span>
  );
}

function MarketSection({ match, market, live }: { match: Match; market: Market; live?: LiveState }) {
  const { isSelected, select } = useCart();
  const liveOdds = live && live.phase === 'live' && market.market_type === 'match_result' ? live.live_odds : null;
  const oddsFor = (key: string) => (liveOdds ? liveOdds[key as Outcome] : market.options.find((o) => o.outcome_key === key)?.odds ?? 0);
  const allOdds = market.options.map((o) => oddsFor(o.outcome_key));

  return (
    <div className="market-section">
      <div className="market-name tag">{market.name}{liveOdds ? ' · live' : ''}</div>
      <div className="market" style={{ gridTemplateColumns: `repeat(${market.options.length}, 1fr)` }} role="group" aria-label={market.name}>
        {market.options.map((o) => {
          const odds = oddsFor(o.outcome_key);
          const picked = isSelected(o.id);
          return (
            <button
              key={o.id}
              type="button"
              className={`outcome ${picked ? 'sel' : ''}`}
              aria-pressed={picked}
              onClick={() => select({
                option_id: o.id, match_id: match.id, home_team: match.home_team, away_team: match.away_team,
                market_name: market.name, option_label: o.label, odds,
              })}
            >
              <span className="outcome-name">{o.label}</span>
              <span className="outcome-odds">{formatOdds(odds)}</span>
              <span className="outcome-prob">{impliedProb(odds, allOdds)}%</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function MatchCard({ match, live }: { match: Match; live?: LiveState }) {
  const sportLabel = match.sport.charAt(0).toUpperCase() + match.sport.slice(1);
  const isLive = live?.phase === 'live';

  return (
    <div className="card contract">
      <div className="contract-head">
        <span className="sport-pill"><BallIcon /> {sportLabel}</span>
        {isLive
          ? <span className="chip chip-live"><span className="dot" />{live!.minute}&apos; · {live!.home_score}-{live!.away_score}</span>
          : <span className="contract-time tnum">{formatKickoff(match.starts_at)}</span>}
      </div>

      <Link className="matchup" to={`/live/${match.id}`}>
        <span className="team team-home"><TeamBadge name={match.home_team} /><span className="team-name">{match.home_team}</span></span>
        <span className="vs">vs</span>
        <span className="team team-away"><span className="team-name">{match.away_team}</span><TeamBadge name={match.away_team} /></span>
      </Link>

      {match.markets.map((m) => (
        <MarketSection key={m.id} match={match} market={m} live={live} />
      ))}
    </div>
  );
}
