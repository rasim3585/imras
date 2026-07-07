import { useNavigate } from 'react-router-dom';
import type { MatchWithPick, Outcome } from '../lib/types';
import { formatKickoff, formatOdds, impliedProb } from '../lib/format';

const OPTIONS: Outcome[] = ['home', 'draw', 'away'];

export default function MatchCard({
  match,
  onPick,
  pending,
}: {
  match: MatchWithPick;
  onPick: (matchId: string, pick: Outcome) => void;
  pending: boolean;
}) {
  const navigate = useNavigate();
  const picked = match.myPick;

  const labelFor = (o: Outcome) =>
    o === 'home' ? match.home_team : o === 'away' ? match.away_team : 'Draw';

  return (
    <div className="card contract">
      <div className="contract-head">
        <span className="tag">{match.sport}</span>
        <span className="contract-time tnum">{formatKickoff(match.starts_at)}</span>
      </div>

      <div className="matchup">
        {match.home_team}<span className="at">vs</span>{match.away_team}
      </div>

      <div className="market" role="group" aria-label="Outcomes">
        {OPTIONS.map((o) => {
          const isPicked = picked === o;
          return (
            <button
              key={o}
              type="button"
              className={`outcome ${isPicked ? 'sel' : ''}`}
              disabled={pending || picked !== null}
              aria-pressed={isPicked}
              onClick={() => onPick(match.id, o)}
            >
              <span className="outcome-name">{labelFor(o)}</span>
              <span className="outcome-odds">{formatOdds(match.display_odds[o])}</span>
              <span className="outcome-prob">{impliedProb(match.display_odds, o)}% chance</span>
            </button>
          );
        })}
      </div>

      {picked && (
        <div className="position">
          <span className="position-label">
            Your call · <b>{labelFor(picked)} @ {formatOdds(match.display_odds[picked])}</b>
          </span>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => navigate(`/reveal/${match.id}`)}
          >
            Watch result
          </button>
        </div>
      )}
    </div>
  );
}
