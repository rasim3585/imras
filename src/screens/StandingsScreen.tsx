import { useEffect, useState } from 'react';
import { matchProvider } from '../lib/matchProvider';
import TeamCrest from '../components/TeamCrest';
import { EFootballIcon, EBasketballIcon } from '../components/icons';
import type { StandingsRow } from '../lib/types';

// Full simulated-league tables. Football = one table (points). Basketball splits
// by league (NBA / EuroLeague) and ranks by win% (no draws).
type Sport = 'football' | 'basketball';

export default function StandingsScreen() {
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

  const bb = sport === 'basketball';
  const bucket = (r: StandingsRow) => r.league || (bb ? 'League' : 'Simulated League');
  const leagues = [...new Set(rows.map(bucket))];

  return (
    <div className="app-shell">
      <h1 className="std-h1">Standings</h1>
      <div className="std-tabs">
        <button className={`std-tab ${!bb ? 'active' : ''}`} onClick={() => setSport('football')}><EFootballIcon size={18} /> e-Football</button>
        <button className={`std-tab ${bb ? 'active' : ''}`} onClick={() => setSport('basketball')}><EBasketballIcon size={18} /> e-Basketball</button>
      </div>

      {loading ? (
        <div className="center-pad"><div className="spinner" /></div>
      ) : rows.length === 0 ? (
        <div className="empty"><p>No standings yet — the table fills in as matches finish.</p></div>
      ) : leagues.map((lg) => (
        <div key={lg} className="std-league">
          <div className="std-league-h">{lg}</div>
          <table className="std-table">
            <thead>
              <tr>
                <th>#</th><th className="std-team-h">Team</th><th>P</th><th>W</th>
                {!bb && <th>D</th>}<th>L</th><th>{bb ? '±' : 'GD'}</th><th>{bb ? 'Win%' : 'Pts'}</th>
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
