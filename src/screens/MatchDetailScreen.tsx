import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { matchProvider } from '../lib/matchProvider';
import { teamColor, teamInitial } from '../lib/teams';
import { formatKickoff } from '../lib/format';
import MarketSection from '../components/MarketSection';
import type { LiveState, Match } from '../lib/types';

export default function MatchDetailScreen() {
  const { matchId } = useParams<{ matchId: string }>();
  const navigate = useNavigate();
  const [match, setMatch] = useState<Match | null>(null);
  const [live, setLive] = useState<LiveState | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  const markets = [...match.markets].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className="app-shell app-shell-flush">
      <button className="detail-back" onClick={() => navigate(-1)}>&lsaquo; Bulletin</button>

      <div className="scoreboard card">
        <div className="sb-top">
          {isLive
            ? <><span className="live-badge">LIVE</span><span className="minute-red tnum">{live!.minute}&apos;</span></>
            : isFinished
              ? <span className="tag">Full time</span>
              : <span className="soon-timer tnum">{formatKickoff(match.starts_at)}</span>}
          <span className="tag" style={{ marginLeft: 'auto' }}>{match.sport === 'football' ? 'Football' : match.sport}</span>
        </div>
        <div className="sb-teams">
          <div className="sb-team">
            <span className="sb-badge" style={{ background: teamColor(match.home_team) }}>{teamInitial(match.home_team)}</span>
            <span className="sb-name">{match.home_team}</span>
          </div>
          <span className="sb-score tnum">{live && live.phase !== 'upcoming' ? `${live.home_score} - ${live.away_score}` : 'vs'}</span>
          <div className="sb-team">
            <span className="sb-badge" style={{ background: teamColor(match.away_team) }}>{teamInitial(match.away_team)}</span>
            <span className="sb-name">{match.away_team}</span>
          </div>
        </div>
        {(isLive || isFinished) && (
          <Link className="btn btn-ghost btn-sm btn-block" style={{ marginTop: 'var(--s3)' }} to={`/live/${match.id}`}>Watch live</Link>
        )}
      </div>

      <div className="detail-markets">
        {markets.map((m) => (
          <div key={m.id} className="mkt-group">
            <div className="mkt-title">{m.name}{isLive && !m.market_type.startsWith('ht_') ? ' · live' : ''}</div>
            <MarketSection match={match} market={m} live={live ?? undefined} showTitle={false} />
          </div>
        ))}
      </div>
    </div>
  );
}
