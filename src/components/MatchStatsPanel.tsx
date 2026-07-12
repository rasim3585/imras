import { useEffect, useState } from 'react';
import { matchProvider } from '../lib/matchProvider';
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

function TeamRow({ t }: { t: VTeamStat }) {
  return (
    <div className="vstat-team">
      <span className="vstat-rank tnum">#{t.rank}</span>
      <span className="vstat-name">{t.name}</span>
      <FormDots form={t.form} />
      <span className="vstat-pts tnum">{t.points} pt</span>
    </div>
  );
}

export default function MatchStatsPanel({ matchId }: { matchId: string }) {
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

  return (
    <div className="vstats card">
      <div className="vstats-head">Simulated League</div>
      <div className="vstat-teams">
        <TeamRow t={stats.home} />
        <TeamRow t={stats.away} />
      </div>
      {played === 0 ? (
        <div className="vstat-note">New league — the table fills in as matches finish.</div>
      ) : stats.h2h.length > 0 ? (
        <>
          <div className="vstats-sub">Head to head</div>
          <div className="vstat-h2h">
            {stats.h2h.map((h, i) => (
              <div key={i} className="vh2h-row">
                <span className="vh2h-team">{h.home_team}</span>
                <span className="vh2h-score tnum">{h.home_score} - {h.away_score}</span>
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
