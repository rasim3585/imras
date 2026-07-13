import { useEffect, useState } from 'react';
import { matchProvider } from '../lib/matchProvider';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/LanguageContext';
import type { Leaderboard, LeaderboardScope } from '../lib/types';

const TABS: { key: LeaderboardScope; tkey: string }[] = [
  { key: 'day', tkey: 'lb.tab.day' },
  { key: 'week', tkey: 'lb.tab.week' },
  { key: 'wins', tkey: 'lb.tab.wins' },
];

const fmtNet = (n: number) => `${n > 0 ? '+' : ''}${n.toLocaleString()}`;

export default function LeaderboardScreen() {
  const { profile } = useAuth();
  const { t } = useI18n();
  const [scope, setScope] = useState<LeaderboardScope>('day');
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setBoard(null);
    const load = async () => {
      try {
        const b = await matchProvider.getLeaderboard(scope);
        if (alive && b.scope === scope) setBoard(b);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : t('lb.err'));
      }
    };
    void load();
    const id = setInterval(load, 12000);
    return () => { alive = false; clearInterval(id); };
  }, [scope]);

  const isWins = scope === 'wins';
  const sub = scope === 'day' ? t('lb.sub.day') : scope === 'week' ? t('lb.sub.week') : t('lb.sub.wins');

  const value = (v: number) => (isWins ? t('lb.won', { v }) : fmtNet(v));

  return (
    <div className="app-shell">
      <div className="page-head"><h1>{t('lb.title')}</h1><p className="page-sub">{sub}</p></div>

      <div className="segmented">
        {TABS.map((tb) => (
          <button key={tb.key} className={`segmented-item ${scope === tb.key ? 'active' : ''}`} onClick={() => setScope(tb.key)}>
            {t(tb.tkey)}
          </button>
        ))}
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      {board?.me && (
        <div className="card lb-me">
          <span className="lb-rank tnum">{board.me.rank ? `#${board.me.rank}` : '—'}</span>
          <span className="lb-me-name">{t('lb.you')}{isWins && board.me.played != null ? <span className="dim tnum"> · {t('lb.played', { n: board.me.played })}</span> : null}</span>
          <span className={`lb-net tnum ${isWins ? 'pos' : board.me.value >= 0 ? 'pos' : 'neg'}`}>{value(board.me.value)}</span>
        </div>
      )}

      {!board ? (
        <div className="center-pad"><div className="spinner" /></div>
      ) : board.rows.length === 0 ? (
        <div className="empty"><p>{t('lb.empty')}</p></div>
      ) : (
        <div className="table" style={{ marginTop: 'var(--s3)' }}>
          {board.rows.map((r) => (
            <div key={`${r.rank}-${r.username}`} className={`trow lb-row ${r.username === profile?.username ? 'is-me' : ''}`}>
              <div className="row" style={{ gap: 'var(--s3)', minWidth: 0 }}>
                <span className="lb-rank tnum">#{r.rank}</span>
                <div className="trow-main">
                  <div className="trow-match">{r.username}</div>
                  {isWins && r.played != null && <div className="trow-sub tnum">{r.value} won / {r.played} played</div>}
                </div>
              </div>
              <span className={`lb-net tnum ${isWins ? 'pos' : r.value >= 0 ? 'pos' : 'neg'}`}>{value(r.value)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
