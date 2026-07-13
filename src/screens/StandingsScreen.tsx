import { useEffect, useState } from 'react';
import { matchProvider } from '../lib/matchProvider';
import TeamCrest from '../components/TeamCrest';
import { EFootballIcon, EBasketballIcon, ETennisIcon, EVolleyballIcon } from '../components/icons';
import { useI18n } from '../i18n/LanguageContext';
import type { StandingsRow } from '../lib/types';

// Full simulated-league tables. Football = one table (points). Basketball / tennis
// / volleyball split by league and rank by win% (no draws).
type Sport = 'football' | 'basketball' | 'tennis' | 'volleyball';

export default function StandingsScreen() {
  const { t } = useI18n();
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

  const bb = sport !== 'football';   // no draws → show W-L / win%
  const bucket = (r: StandingsRow) => r.league || (bb ? t('std.league') : t('std.simleague'));
  const leagues = [...new Set(rows.map(bucket))];

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
            <thead>
              <tr>
                <th>#</th><th className="std-team-h">{t('std.col.team')}</th><th>P</th><th>W</th>
                {!bb && <th>D</th>}<th>L</th><th>{bb ? '±' : t('std.col.gd')}</th><th>{bb ? t('std.col.winpct') : t('std.col.pts')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.filter((r) => bucket(r) === lg).map((r) => (
                <tr key={r.team_id}>
                  <td className="tnum">{r.rank}</td>
                  <td className="std-team"><TeamCrest name={r.name} size={18} className="std-crest" /><span>{r.name}</span></td>
                  <td className="tnum">{r.played}</td>
                  <td className="tnum">{r.won}</td>
                  {!bb && <td className="tnum">{r.drawn}</td>}
                  <td className="tnum">{r.lost}</td>
                  <td className="tnum">{r.gd > 0 ? `+${r.gd}` : r.gd}</td>
                  <td className="tnum std-pts">{bb ? (r.played ? `${Math.round((100 * r.won) / r.played)}%` : '—') : r.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
