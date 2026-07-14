import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { matchProvider } from '../lib/matchProvider';
import TeamCrest from '../components/TeamCrest';
import { EFootballIcon, EBasketballIcon, ETennisIcon, EVolleyballIcon } from '../components/icons';
import { useI18n } from '../i18n/LanguageContext';
import type { StandingsRow } from '../lib/types';

// Spor-DOĞRU lig tabloları (gerçek formatlar):
//   futbol:   O G B M AV P (3G+1B) — klasik lig
//   basket:   O W L ± PCT — NBA tarzı, galibiyet yüzdesiyle
//   voleybol: O G M Set Pts — VNL puanı (3-0/3-1→3p, 3-2→2p, 2-3→1p)
//   tenis:    O W L Win% — ATP-race tarzı sıralama (oyuncular)
// Satır tıklanır → takım/oyuncu sayfası (/team/:id).
type Sport = 'football' | 'basketball' | 'tennis' | 'volleyball';

function FormDots({ form }: { form?: ('W' | 'D' | 'L')[] }) {
  if (!form?.length) return <span className="vform-empty">—</span>;
  return (
    <span className="vform">
      {form.slice(0, 5).map((r, i) => <span key={i} className={`vform-dot vform-${r}`}>{r}</span>)}
    </span>
  );
}

export default function StandingsScreen() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [sport, setSport] = useState<Sport>('football');
  const [rows, setRows] = useState<StandingsRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true; setLoading(true);
    matchProvider.getStandings(sport)
      .then((r) => { if (alive) setRows(r); })
      .catch(() => { if (alive) setRows([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [sport]);

  const bucket = (r: StandingsRow) => r.league || (sport === 'football' ? t('std.simleague') : t('std.league'));
  const leagues = [...new Set(rows.map(bucket))];
  const pct = (r: StandingsRow) => (r.pct != null ? `${Math.round(Number(r.pct) * 100)}%` : r.played ? `${Math.round((100 * r.won) / r.played)}%` : '—');

  const header = () => {
    switch (sport) {
      case 'football':
        return <tr><th>#</th><th className="std-team-h">{t('std.col.team')}</th><th>{t('std.c.p')}</th><th>{t('std.c.w')}</th><th>{t('std.c.d')}</th><th>{t('std.c.l')}</th><th>{t('std.col.gd')}</th><th>{t('std.col.form')}</th><th>{t('std.col.pts')}</th></tr>;
      case 'basketball':
        return <tr><th>#</th><th className="std-team-h">{t('std.col.team')}</th><th>{t('std.c.p')}</th><th>W</th><th>L</th><th>±</th><th>{t('std.col.form')}</th><th>PCT</th></tr>;
      case 'volleyball':
        return <tr><th>#</th><th className="std-team-h">{t('std.col.team')}</th><th>{t('std.c.p')}</th><th>{t('std.c.w')}</th><th>{t('std.c.l')}</th><th>{t('std.col.sets')}</th><th>{t('std.col.form')}</th><th>{t('std.col.pts')}</th></tr>;
      case 'tennis':
        return <tr><th>#</th><th className="std-team-h">{t('std.col.player')}</th><th>{t('std.c.p')}</th><th>W</th><th>L</th><th>{t('std.col.winpct')}</th><th>{t('std.col.form')}</th></tr>;
    }
  };

  const cells = (r: StandingsRow) => {
    switch (sport) {
      case 'football':
        return <><td className="tnum">{r.played}</td><td className="tnum">{r.won}</td><td className="tnum">{r.drawn}</td><td className="tnum">{r.lost}</td><td className="tnum">{r.gd > 0 ? `+${r.gd}` : r.gd}</td><td><FormDots form={r.form} /></td><td className="tnum std-pts">{r.points}</td></>;
      case 'basketball':
        return <><td className="tnum">{r.played}</td><td className="tnum">{r.won}</td><td className="tnum">{r.lost}</td><td className="tnum">{r.gd > 0 ? `+${r.gd}` : r.gd}</td><td><FormDots form={r.form} /></td><td className="tnum std-pts">{pct(r)}</td></>;
      case 'volleyball':
        return <><td className="tnum">{r.played}</td><td className="tnum">{r.won}</td><td className="tnum">{r.lost}</td><td className="tnum">{r.gf}:{r.ga}</td><td><FormDots form={r.form} /></td><td className="tnum std-pts">{r.points}</td></>;
      case 'tennis':
        return <><td className="tnum">{r.played}</td><td className="tnum">{r.won}</td><td className="tnum">{r.lost}</td><td className="tnum std-pts">{pct(r)}</td><td><FormDots form={r.form} /></td></>;
    }
  };

  return (
    <div className="app-shell">
      <h1 className="std-h1">{t('std.title')}</h1>
      <div className="std-tabs">
        <button className={`std-tab ${sport === 'football' ? 'active' : ''}`} onClick={() => setSport('football')}><EFootballIcon size={18} /> e-Football</button>
        <button className={`std-tab ${sport === 'basketball' ? 'active' : ''}`} onClick={() => setSport('basketball')}><EBasketballIcon size={18} /> e-Basketball</button>
        <button className={`std-tab ${sport === 'tennis' ? 'active' : ''}`} onClick={() => setSport('tennis')}><ETennisIcon size={18} /> e-Tennis</button>
        <button className={`std-tab ${sport === 'volleyball' ? 'active' : ''}`} onClick={() => setSport('volleyball')}><EVolleyballIcon size={18} /> e-Volleyball</button>
      </div>

      {loading ? (
        <div className="center-pad"><div className="spinner" /></div>
      ) : rows.length === 0 ? (
        <div className="empty"><p>{t('std.none')}</p></div>
      ) : leagues.map((lg) => (
        <div key={lg} className="std-league">
          <div className="std-league-h">{lg}</div>
          <table className="std-table">
            <thead>{header()}</thead>
            <tbody>
              {rows.filter((r) => bucket(r) === lg).map((r) => (
                <tr key={r.team_id} className="std-row-link" onClick={() => navigate(`/team/${r.team_id}`)}>
                  <td className="tnum">{r.rank}</td>
                  <td className="std-team"><TeamCrest name={r.name} size={18} className="std-crest" /><span>{r.name}</span></td>
                  {cells(r)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
