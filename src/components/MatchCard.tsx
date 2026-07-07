import type { Match, Outcome } from '../lib/types';
import { formatKickoff, formatOdds, impliedProb } from '../lib/format';
import { useCart } from '../coupon/CartContext';

const OPTIONS: Outcome[] = ['home', 'draw', 'away'];

export default function MatchCard({ match }: { match: Match }) {
  const { pickFor, select } = useCart();
  const picked = pickFor(match.id);

  const labelFor = (o: Outcome) =>
    o === 'home' ? match.home_team : o === 'away' ? match.away_team : 'Draw';

  return (
    <div className="card contract">
      <div className="contract-head">
        <span className="tag">{match.sport} · Match Result</span>
        <span className="contract-time tnum">{formatKickoff(match.starts_at)}</span>
      </div>

      <div className="matchup">
        {match.home_team}<span className="at">vs</span>{match.away_team}
      </div>

      <div className="market" role="group" aria-label="Match result">
        {OPTIONS.map((o) => {
          const isPicked = picked === o;
          return (
            <button
              key={o}
              type="button"
              className={`outcome ${isPicked ? 'sel' : ''}`}
              aria-pressed={isPicked}
              onClick={() =>
                select({
                  match_id: match.id,
                  home_team: match.home_team,
                  away_team: match.away_team,
                  pick: o,
                  odds: match.display_odds[o],
                })
              }
            >
              <span className="outcome-name">
                {o === 'home' ? '1' : o === 'draw' ? 'X' : '2'} · {labelFor(o)}
              </span>
              <span className="outcome-odds">{formatOdds(match.display_odds[o])}</span>
              <span className="outcome-prob">{impliedProb(match.display_odds, o)}% chance</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
