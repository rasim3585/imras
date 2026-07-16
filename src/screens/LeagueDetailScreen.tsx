import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { matchProvider } from '../lib/matchProvider';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/LanguageContext';
import { humanizeError } from '../lib/errors';
import type { LeagueDetail } from '../lib/types';

const fmtNet = (n: number) => `${n > 0 ? '+' : ''}${n.toLocaleString()}`;

export default function LeagueDetailScreen() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { t } = useI18n();
  const [league, setLeague] = useState<LeagueDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!leagueId) return;
    let alive = true;
    const load = async () => {
      try { const l = await matchProvider.getLeague(leagueId); if (alive) setLeague(l); }
      catch (err) { if (alive) setError(err ? humanizeError(err, t) : t('lg.err')); }
    };
    void load();
    const id = setInterval(load, 12000);
    return () => { alive = false; clearInterval(id); };
  }, [leagueId]);

  async function leave() {
    if (!leagueId) return;
    await matchProvider.leaveLeague(leagueId).catch(() => {});
    navigate('/social');
  }

  if (error) return <div className="app-shell" style={{ paddingTop: 'var(--s6)' }}><div className="banner banner-error">{error}</div><button className="btn btn-block" onClick={() => navigate('/social')}>{t('lg.back')}</button></div>;
  if (!league) return <div className="settle"><div className="spinner" /></div>;

  return (
    <div className="app-shell">
      <div className="page-head">
        <h1>{league.name}</h1>
        <p className="page-sub">{t('lg.sub')} <span className="mono">{league.invite_code}</span></p>
      </div>
      <div className="table">
        {league.rows.map((r) => (
          <div key={`${r.rank}-${r.username}`} className={`trow lb-row ${r.username === profile?.username ? 'is-me' : ''}`}>
            <div className="row" style={{ gap: 'var(--s3)', minWidth: 0 }}>
              <span className="lb-rank tnum">#{r.rank}</span>
              <span className="trow-match">{r.username}</span>
            </div>
            <span className={`lb-net tnum ${r.value >= 0 ? 'pos' : 'neg'}`}>{fmtNet(r.value)}</span>
          </div>
        ))}
      </div>
      <button className="btn btn-ghost btn-block" style={{ marginTop: 'var(--s4)' }} onClick={leave}>{t('lg.leave')}</button>
      <button className="btn btn-ghost btn-block" style={{ marginTop: 'var(--s2)' }} onClick={() => navigate('/social')}>{t('lg.back')}</button>
    </div>
  );
}
