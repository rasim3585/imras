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

  // Prediction DNA — accuracy per sport (structure is multi-sport ready even
  // though Phase 1 only ships football).
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
        <div className="eyebrow">Your record</div>
        <h1>{profile?.username ?? '—'}</h1>
        <p className="sub">How sharp your read has been. No stakes — just signal.</p>
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      {/* Stats */}
      <div className="stat-grid">
        <div className="card stat-tile stat-hero">
          <span className="stat-value">{acc}%</span>
          <span className="stat-label">Accuracy</span>
        </div>
        <div className="card stat-tile">
          <span className="stat-value">{profile?.skill_rating ?? 1000}</span>
          <span className="stat-label">Skill rating</span>
        </div>
        <div className="card stat-tile">
          <span className="stat-value">
            {profile?.current_streak ?? 0}
            {profile && profile.current_streak > 0 && <span className="streak-flame"> 🔥</span>}
          </span>
          <span className="stat-label">Current streak</span>
        </div>
        <div className="card stat-tile">
          <span className="stat-value">{profile?.best_streak ?? 0}</span>
          <span className="stat-label">Best streak</span>
        </div>
        <div className="card stat-tile">
          <span className="stat-value">{profile?.total_predictions ?? 0}</span>
          <span className="stat-label">Calls made</span>
        </div>
        <div className="card stat-tile">
          <span className="stat-value">{profile?.correct_predictions ?? 0}</span>
          <span className="stat-label">Called right</span>
        </div>
      </div>

      {/* Prediction DNA */}
      <h3 className="section-title">Prediction DNA</h3>
      {dna.length === 0 ? (
        <p className="muted section-empty">Reveal a few results and your DNA takes shape.</p>
      ) : (
        <div className="card dna-card">
          {dna.map((d) => (
            <div key={d.sport} className="dna-row">
              <div className="dna-head">
                <span>{SPORT_LABEL[d.sport] ?? d.sport}</span>
                <span className="muted">
                  {d.pct}% · {d.correct}/{d.total}
                </span>
              </div>
              <div className="dna-bar">
                <div className="dna-fill" style={{ width: `${d.pct}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* History */}
      <h3 className="section-title">Recent calls</h3>
      {loading ? (
        <div className="center-pad"><div className="spinner" /></div>
      ) : history.length === 0 ? (
        <div className="empty-state">
          <div className="glyph">◈</div>
          <p>No calls yet. Head to the feed and back your read.</p>
        </div>
      ) : (
        <div className="history-list">
          {history.map((p) => {
            const m = p.match;
            const scored = p.is_correct !== null;
            return (
              <div key={p.id} className="card history-row">
                <div className="stack" style={{ gap: 4 }}>
                  <span className="hist-teams">
                    {m.home_team} <span className="dim">vs</span> {m.away_team}
                  </span>
                  <span className="hist-detail muted">
                    Called {outcomeLabel(p.pick, m.home_team, m.away_team)}
                    <span className="mono"> @ {formatOdds(m.display_odds[p.pick])}</span>
                    {scored && (
                      <>
                        {' · '}
                        {m.home_score}–{m.away_score}
                      </>
                    )}
                  </span>
                </div>
                <div className="hist-right">
                  {!scored ? (
                    <Link className="pill" to={`/reveal/${m.id}`}>Watch →</Link>
                  ) : p.is_correct ? (
                    <span className="pill pill-hit">✓ +{p.points_earned}</span>
                  ) : (
                    <span className="pill pill-miss">✕ miss</span>
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
