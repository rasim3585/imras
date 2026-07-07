import { useNavigate } from 'react-router-dom';
import type { MatchWithPick, Outcome } from '../lib/types';
import { formatKickoff, formatOdds } from '../lib/format';

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

  function labelFor(o: Outcome) {
    if (o === 'home') return match.home_team;
    if (o === 'away') return match.away_team;
    return 'Draw';
  }

  return (
    <div className="card match-card">
      <div className="match-meta">
        <span className="pill">{match.sport}</span>
        <span className="dim">{formatKickoff(match.starts_at)}</span>
      </div>

      <div className="match-teams">
        <span className="team">{match.home_team}</span>
        <span className="vs">vs</span>
        <span className="team team-away">{match.away_team}</span>
      </div>

      <div className="pick-label muted">
        {picked ? 'Your call' : 'What’s your call?'}
      </div>

      <div className="pick-row" role="group" aria-label="Make your call">
        {OPTIONS.map((o) => {
          const isPicked = picked === o;
          return (
            <button
              key={o}
              type="button"
              className={`pick-opt ${isPicked ? 'is-picked' : ''}`}
              disabled={pending || picked !== null}
              aria-pressed={isPicked}
              onClick={() => onPick(match.id, o)}
            >
              <span className="pick-opt-name">{labelFor(o)}</span>
              <span className="pick-opt-kind">
                {o === 'draw' ? 'draw' : o === 'home' ? 'home win' : 'away win'}
              </span>
              <span className="pick-opt-odds mono">{formatOdds(match.display_odds[o])}</span>
            </button>
          );
        })}
      </div>

      {picked && (
        <button
          type="button"
          className="btn btn-primary btn-block watch-cta"
          onClick={() => navigate(`/reveal/${match.id}`)}
        >
          Watch it unfold →
        </button>
      )}
    </div>
  );
}
