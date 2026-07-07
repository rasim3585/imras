import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { matchProvider } from '../lib/matchProvider';
import type { PredictionWithMatch } from '../lib/types';
import { accuracyPct, outcomeLabel, formatOdds } from '../lib/format';

const SPORT_LABEL: Record<string, string> = {
  football: 'Football',
  basketball: 'Basketball',
};

export default function ProfileScreen() {
  const { profile } = useAuth();
  const [history, setHistory] = useState<PredictionWithMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setHistory(await matchProvider.getMyPredictions());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load your history');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Prediction DNA — accuracy per sport (multi-sport ready).
  const dna = useMemo(() => {
    const bySport = new Map<string, { correct: number; total: number }>();
    for (const p of history) {
      if (p.is_correct === null) continue;
      const cur = bySport.get(p.match.sport) ?? { correct: 0, total: 0 };
      cur.total += 1;
      if (p.is_correct) cur.correct += 1;
      bySport.set(p.match.sport, cur);
    }
    return [...bySport.entries()]
      .map(([sport, v]) => ({ sport, ...v, pct: accuracyPct(v.correct, v.total) }))
      .sort((a, b) => b.total - a.total);
  }, [history]);

  const acc = profile ? accuracyPct(profile.correct_predictions, profile.total_predictions) : 0;

  return (
    <div className="app-shell">
      <div className="page-head">
        <h1>{profile?.username ?? '—'}</h1>
        <p className="page-sub">Your track record. No stakes — accuracy is the score.</p>
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      <div className="stat-grid">
        <div className="stat stat-major">
          <span className="stat-k">Accuracy</span>
          <span className="stat-v tnum">{acc}%</span>
        </div>
        <div className="stat">
          <span className="stat-k">Skill rating</span>
          <span className="stat-v tnum">{profile?.skill_rating ?? 1000}</span>
        </div>
        <div className="stat">
          <span className="stat-k">Streak</span>
          <span className={`stat-v tnum ${profile && profile.current_streak > 0 ? 'pos' : ''}`}>
            {profile?.current_streak ?? 0}
          </span>
        </div>
        <div className="stat">
          <span className="stat-k">Best streak</span>
          <span className="stat-v tnum">{profile?.best_streak ?? 0}</span>
        </div>
        <div className="stat">
          <span className="stat-k">Calls made</span>
          <span className="stat-v tnum">{profile?.total_predictions ?? 0}</span>
        </div>
        <div className="stat">
          <span className="stat-k">Called right</span>
          <span className="stat-v tnum">{profile?.correct_predictions ?? 0}</span>
        </div>
      </div>

      <div className="section-head"><h3>Prediction DNA</h3></div>
      {dna.length === 0 ? (
        <div className="empty"><p>Settle a few results and your DNA takes shape.</p></div>
      ) : (
        <div className="card dna">
          {dna.map((d) => (
            <div key={d.sport} className="dna-row">
              <div className="dna-top">
                <span className="name">{SPORT_LABEL[d.sport] ?? d.sport}</span>
                <span className="val tnum">{d.pct}% · {d.correct}/{d.total}</span>
              </div>
              <div className="dna-track">
                <div className="dna-fill" style={{ width: `${d.pct}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="section-head"><h3>Recent calls</h3></div>
      {loading ? (
        <div className="center-pad"><div className="spinner" /></div>
      ) : history.length === 0 ? (
        <div className="empty"><p>No calls yet. Head to the markets and price your read.</p></div>
      ) : (
        <div className="table">
          {history.map((p) => {
            const m = p.match;
            const scored = p.is_correct !== null;
            return (
              <div key={p.id} className="trow">
                <div className="trow-main">
                  <div className="trow-match">{m.home_team} vs {m.away_team}</div>
                  <div className="trow-sub">
                    {outcomeLabel(p.pick, m.home_team, m.away_team)} @ {formatOdds(m.display_odds[p.pick])}
                    {scored && ` · ${m.home_score}–${m.away_score}`}
                  </div>
                </div>
                <div className="trow-right">
                  {!scored ? (
                    <Link to={`/reveal/${m.id}`}>Settle →</Link>
                  ) : p.is_correct ? (
                    <span className="chip chip-pos tnum">+{p.points_earned}</span>
                  ) : (
                    <span className="chip chip-neg">Missed</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
