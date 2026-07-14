import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { matchProvider } from '../lib/matchProvider';
import { useI18n } from '../i18n/LanguageContext';
import type { MatchStats, VTeamStat } from '../lib/types';

// Virtual-league context for a match: both teams' league standing + recent form,
// plus their head-to-head. Renders NOTHING for real/legacy matches (stats null).
// Shown above the odds so the bettor sees "who's stronger / in form" first.

function FormDots({ form }: { form: ('W' | 'D' | 'L')[] }) {
  if (!form.length) return <span className="vform-empty">—</span>;
  return (
    <span className="vform">
      {form.map((r, i) => <span key={i} className={`vform-dot vform-${r}`}>{r}</span>)}
    </span>
  );
}

function TeamRow({ t, sport }: { t: VTeamStat; sport?: string }) {
  // spor-doğru sağ hücre: basket/tenis W-L, voleybol VNL puanı, futbol puan
  const right = sport === 'basketball' || sport === 'tennis'
    ? `${t.won}-${t.lost}` : `${t.points} pt`;
  return (
    <Link className="vstat-team vstat-link" to={`/team/${t.team_id}`}>
      <span className="vstat-rank tnum">#{t.rank}</span>
      <span className="vstat-name">{t.name}</span>
      <FormDots form={t.form} />
      <span className="vstat-pts tnum">{right}</span>
    </Link>
  );
}

export default function MatchStatsPanel({ matchId }: { matchId: string }) {
  const { t } = useI18n();
  const [stats, setStats] = useState<MatchStats | null | 'none'>(null);

  useEffect(() => {
    let alive = true;
    matchProvider.getMatchStats(matchId)
      .then((s) => { if (alive) setStats(s ?? 'none'); })
      .catch(() => { if (alive) setStats('none'); });
    return () => { alive = false; };
  }, [matchId]);

  if (stats === null || stats === 'none') return null;   // loading, or real match → hide

  const played = stats.home.played + stats.away.played;
  const head = stats.sport === 'basketball' ? `${t('feed.tab.basketball')} · ${t('ms.simleague')}`
    : stats.sport === 'tennis' ? `${t('feed.tab.tennis')} · ${t('ms.simleague')}`
    : stats.sport === 'volleyball' ? `${t('feed.tab.volley')} · ${t('ms.simleague')}` : t('ms.simleague');

  return (
    <div className="vstats card">
      <div className="vstats-head">{head}</div>
      <div className="vstat-teams">
        <TeamRow t={stats.home} sport={stats.sport} />
        <TeamRow t={stats.away} sport={stats.sport} />
      </div>
      {played === 0 ? (
        <div className="vstat-note">{t('ms.newleague')}</div>
      ) : stats.h2h.length > 0 ? (
        <>
          <div className="vstats-sub">{t('ms.hth')}</div>
          <div className="vstat-h2h">
            {stats.h2h.map((h, i) => (
              <div key={i} className="vh2h-row">
                <span className="vh2h-team">{h.home_team}</span>
                <span className="vh2h-score tnum">
                  {h.home_score} - {h.away_score}
                  {h.detail && <span className="vh2h-detail tnum">{h.detail}</span>}
                </span>
                <span className="vh2h-team vh2h-away">{h.away_team}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="vstat-note">No previous meetings yet.</div>
      )}
    </div>
  );
}
