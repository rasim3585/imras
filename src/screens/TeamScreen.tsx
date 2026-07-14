import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { matchProvider } from '../lib/matchProvider';
import TeamCrest from '../components/TeamCrest';
import { useI18n } from '../i18n/LanguageContext';
import type { TeamPage, TeamPageMatch } from '../lib/types';

// Takım / oyuncu sayfası (Nesine-tarzı): lig sırası + spor-doğru özet,
// son 10 form, son 15 maç (set/çeyrek detayıyla), gelecek fikstür.
// Veri tek RPC'den (vteam_page) — gizli güç puanları asla gelmez.

function FormDots({ form }: { form: ('W' | 'D' | 'L')[] }) {
  if (!form?.length) return null;
  return (
    <span className="vform">
      {form.map((r, i) => <span key={i} className={`vform-dot vform-${r}`}>{r}</span>)}
    </span>
  );
}

function MatchRow({ m, teamName }: { m: TeamPageMatch; teamName: string }) {
  const d = new Date(m.starts_at);
  const when = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const done = m.res !== undefined;
  return (
    <Link className="tp-match" to={`/match/${m.id}`}>
      <span className="tp-when tnum">{when}</span>
      <span className={`tp-side ${m.home_team === teamName ? 'tp-us' : ''}`}>{m.home_team}</span>
      <span className="tp-score tnum">
        {done ? `${m.home_score} - ${m.away_score}` : 'vs'}
      </span>
      <span className={`tp-side tp-away ${m.away_team === teamName ? 'tp-us' : ''}`}>{m.away_team}</span>
      {done && <span className={`tp-res vform-dot vform-${m.res}`}>{m.res}</span>}
      {m.detail && <span className="tp-detail tnum">{m.detail}</span>}
    </Link>
  );
}

export default function TeamScreen() {
  const { teamId } = useParams();
  const { t } = useI18n();
  const [page, setPage] = useState<TeamPage | null | 'none'>(null);

  useEffect(() => {
    let alive = true;
    setPage(null);   // takım değişince eski sayfa görünmesin (geri/ileri gezinme)
    matchProvider.getTeamPage(Number(teamId))
      .then((p) => { if (alive) setPage(p ?? 'none'); })
      .catch(() => { if (alive) setPage('none'); });
    return () => { alive = false; };
  }, [teamId]);

  if (page === null) return <div className="center-pad"><div className="spinner" /></div>;
  if (page === 'none') return <div className="empty"><p>{t('team.notfound')}</p></div>;

  const s = page.standing;
  const sport = page.team.sport;
  const isPlayer = sport === 'tennis';
  const pctTxt = s?.pct != null ? `${Math.round(Number(s.pct) * 100)}%` : '—';

  // spor-doğru özet hücreleri
  const cells: [string, string][] = s ? (
    sport === 'football' ? [
      [t('team.rank'), `#${s.rank}`], [t('std.c.p'), String(s.played)], [t('std.c.w'), String(s.won)],
      [t('std.c.d'), String(s.drawn)], [t('std.c.l'), String(s.lost)], [t('std.col.gd'), s.gd > 0 ? `+${s.gd}` : String(s.gd)],
      [t('std.col.pts'), String(s.points)],
    ] : sport === 'volleyball' ? [
      [t('team.rank'), `#${s.rank}`], [t('std.c.p'), String(s.played)], [t('std.c.w'), String(s.won)],
      [t('std.c.l'), String(s.lost)], [t('team.sets'), `${s.gf}:${s.ga}`], [t('std.col.pts'), String(s.points)],
    ] : [
      [t('team.rank'), `#${s.rank}`], [t('std.c.p'), String(s.played)],
      ['W-L', `${s.won}-${s.lost}`], [t('std.col.winpct'), pctTxt],
    ]
  ) : [];

  const streak = s?.streak ?? 0;

  return (
    <div className="app-shell tp-screen">
      <div className="tp-head card">
        <TeamCrest name={page.team.name} size={44} className="tp-crest" />
        <div className="tp-title">
          <h1>{page.team.name}</h1>
          <div className="tp-sub">
            {page.team.league && <span className="tag">{page.team.league}</span>}
            <span className="tag">{isPlayer ? t('team.player') : t('team.team')}</span>
            {streak !== 0 && (
              <span className={`tag tp-streak ${streak > 0 ? 'up' : 'down'}`}>
                {streak > 0 ? `${streak} ${t('team.winstreak')}` : `${-streak} ${t('team.losestreak')}`}
              </span>
            )}
          </div>
        </div>
      </div>

      {s && (
        <div className="tp-stand card">
          {cells.map(([k, v]) => (
            <div key={k} className="tp-cell"><span className="tp-k">{k}</span><span className="tp-v tnum">{v}</span></div>
          ))}
        </div>
      )}

      <div className="card tp-block">
        <div className="tp-block-h">{t('team.form10')}</div>
        <FormDots form={page.form} />
      </div>

      {page.upcoming.length > 0 && (
        <div className="card tp-block">
          <div className="tp-block-h">{t('team.fixtures')}</div>
          {page.upcoming.map((m) => <MatchRow key={m.id} m={m} teamName={page.team.name} />)}
        </div>
      )}

      <div className="card tp-block">
        <div className="tp-block-h">{t('team.lastmatches')}</div>
        {page.last_matches.length === 0
          ? <div className="vstat-note">{t('team.nomatches')}</div>
          : page.last_matches.map((m) => <MatchRow key={m.id} m={m} teamName={page.team.name} />)}
      </div>

      <Link className="btn btn-ghost btn-sm btn-block" to="/standings">{t('team.tostandings')}</Link>
    </div>
  );
}
