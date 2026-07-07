import type { Match, Market } from '../lib/types';
import { formatKickoff, formatOdds, impliedProb } from '../lib/format';
import { teamColor, teamInitial } from '../lib/teams';
import { BallIcon } from './icons';
import { useCart } from '../coupon/CartContext';

function TeamBadge({ name }: { name: string }) {
  return (
    <span className="team-badge" style={{ background: teamColor(name) }} aria-hidden="true">
      {teamInitial(name)}
    </span>
  );
}

function MarketSection({ match, market }: { match: Match; market: Market }) {
  const { isSelected, select } = useCart();
  const allOdds = market.options.map((o) => o.odds);
  const favOdds = Math.min(...allOdds); // lowest odds = favourite

  return (
    <div className="market-section">
      <div className="market-name tag">{market.name}</div>
      <div
        className="market"
        style={{ gridTemplateColumns: `repeat(${market.options.length}, 1fr)` }}
        role="group"
        aria-label={market.name}
      >
        {market.options.map((o) => {
          const picked = isSelected(o.id);
          const fav = !picked && o.odds === favOdds;
          return (
            <button
              key={o.id}
              type="button"
              className={`outcome ${picked ? 'sel' : ''} ${fav ? 'fav' : ''}`}
              aria-pressed={picked}
              onClick={() =>
                select({
                  option_id: o.id,
                  match_id: match.id,
                  home_team: match.home_team,
                  away_team: match.away_team,
                  market_name: market.name,
                  option_label: o.label,
                  odds: o.odds,
                })
              }
            >
              <span className="outcome-name">{o.label}</span>
              <span className="outcome-odds">{formatOdds(o.odds)}</span>
              <span className="outcome-prob">{impliedProb(o.odds, allOdds)}%</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function MatchCard({ match }: { match: Match }) {
  const sportLabel = match.sport.charAt(0).toUpperCase() + match.sport.slice(1);

  return (
    <div className="card contract">
      <div className="contract-head">
        <span className="sport-pill"><BallIcon /> {sportLabel}</span>
        <span className="contract-time tnum">{formatKickoff(match.starts_at)}</span>
      </div>

      <div className="matchup">
        <span className="team team-home">
          <TeamBadge name={match.home_team} />
          <span className="team-name">{match.home_team}</span>
        </span>
        <span className="vs">vs</span>
        <span className="team team-away">
          <span className="team-name">{match.away_team}</span>
          <TeamBadge name={match.away_team} />
        </span>
      </div>

      {match.markets.map((m) => (
        <MarketSection key={m.id} match={match} market={m} />
      ))}
    </div>
  );
}
