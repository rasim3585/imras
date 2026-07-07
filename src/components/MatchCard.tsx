import type { Match, Market } from '../lib/types';
import { formatKickoff, formatOdds, impliedProb } from '../lib/format';
import { useCart } from '../coupon/CartContext';

function MarketSection({ match, market }: { match: Match; market: Market }) {
  const { isSelected, select } = useCart();
  const allOdds = market.options.map((o) => o.odds);

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
          return (
            <button
              key={o.id}
              type="button"
              className={`outcome ${picked ? 'sel' : ''}`}
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
  return (
    <div className="card contract">
      <div className="contract-head">
        <span className="tag">{match.sport}</span>
        <span className="contract-time tnum">{formatKickoff(match.starts_at)}</span>
      </div>

      <div className="matchup">
        {match.home_team}<span className="at">vs</span>{match.away_team}
      </div>

      {match.markets.map((m) => (
        <MarketSection key={m.id} match={match} market={m} />
      ))}
    </div>
  );
}
