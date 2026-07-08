import { useEffect, useState } from 'react';
import { matchProvider } from '../lib/matchProvider';
import { useAuth } from '../auth/AuthContext';
import type { Leaderboard } from '../lib/types';

const fmtNet = (n: number) => `${n > 0 ? '+' : ''}${n.toLocaleString()}`;

export default function LeaderboardScreen() {
  const { profile } = useAuth();
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const b = await matchProvider.getLeaderboard();
        if (alive) setBoard(b);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'Could not load the leaderboard');
      }
    };
    void load();
    const id = setInterval(load, 10000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  return (
    <div className="app-shell">
      <div className="page-head">
        <h1>Leaderboard</h1>
        <p className="page-sub">This week's net gold from settled coupons. Resets every Monday.</p>
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      {board?.me && (
        <div className="card lb-me">
          <span className="lb-rank tnum">{board.me.rank ? `#${board.me.rank}` : '—'}</span>
          <span className="lb-me-name">You</span>
          <span className={`lb-net tnum ${board.me.net >= 0 ? 'pos' : 'neg'}`}>{fmtNet(board.me.net)}</span>
        </div>
      )}

      {!board ? (
        <div className="center-pad"><div className="spinner" /></div>
      ) : board.rows.length === 0 ? (
        <div className="empty"><p>No coupons settled this week yet. Be the first on the board.</p></div>
      ) : (
        <div className="table" style={{ marginTop: 'var(--s3)' }}>
          {board.rows.map((r) => (
            <div key={`${r.rank}-${r.username}`} className={`trow lb-row ${r.username === profile?.username ? 'is-me' : ''}`}>
              <div className="row" style={{ gap: 'var(--s3)', minWidth: 0 }}>
                <span className="lb-rank tnum">#{r.rank}</span>
                <span className="trow-match">{r.username}</span>
              </div>
              <span className={`lb-net tnum ${r.net >= 0 ? 'pos' : 'neg'}`}>{fmtNet(r.net)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
