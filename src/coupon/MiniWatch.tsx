import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { matchProvider } from '../lib/matchProvider';
import { simLines } from '../live/commentary';
import { ballAt } from '../live/matchSim';
import type { LiveState } from '../lib/types';

// Compact live view of the coupon's LAST-ADDED match: mini scoreboard + a tiny
// pitch + key moments. Ball and feed come from the SAME possession sim on the
// SAME clock as the full /live screen, so the two views always tell one story.
export default function MiniWatch({ matchId }: { matchId: string }) {
  const [st, setSt] = useState<LiveState | null>(null);
  const [ball, setBall] = useState<{ x: number; y: number; team: 'home' | 'away' }>({ x: 50, y: 50, team: 'home' });
  const anchor = useRef<{ sim: number; at: number; rate: number } | null>(null);

  const clock = () => {
    const a = anchor.current;
    return a ? Math.max(0, Math.min(5400, a.sim + ((Date.now() - a.at) / 1000) * a.rate)) : 0;
  };

  useEffect(() => {
    let alive = true;
    anchor.current = null;
    const poll = async () => {
      try {
        const [s] = await matchProvider.getLiveStates([matchId]);
        if (!alive || !s) return;
        setSt(s);
        // monotonic sim clock (same scheme as useLiveMatch): anchor once, only
        // hard-correct on a big desync — no per-poll sawtooth
        if (s.phase === 'live') {
          const now = Date.now();
          const rate = 5400 / s.duration_secs;
          const serverSim = s.minute * 60;
          const a = anchor.current;
          const cur = a ? a.sim + ((now - a.at) / 1000) * a.rate : -1;
          if (!a || Math.abs(serverSim - cur) > 90) anchor.current = { sim: serverSim, at: now, rate };
        }
      } catch { /* transient */ }
    };
    void poll();
    const id = setInterval(poll, 2500);
    return () => { alive = false; clearInterval(id); };
  }, [matchId]);

  // the mini ball follows the SAME possession sim as the big tracker
  useEffect(() => {
    if (st?.phase !== 'live') return;
    const dur = st.duration_secs;
    const id = setInterval(() => {
      const b = ballAt(matchId, clock(), dur);
      setBall({ x: b.x, y: b.y, team: b.team });
    }, 400);
    return () => clearInterval(id);
  }, [matchId, st?.phase, st?.duration_secs]); // eslint-disable-line react-hooks/exhaustive-deps

  // key moments: server goals/cards + the same sim feed the /live screen shows
  const evs = useMemo(() => {
    if (!st) return [] as { m: number; t: string; g: boolean }[];
    let h = 0, a = 0;
    const goals = (st.events ?? []).map((e) => { if (e.team === 'home') h++; else a++; return { m: e.minute, t: `GOAL — ${e.team === 'home' ? st.home_team : st.away_team} ${h}-${a}`, g: true }; });
    const cards = (st.cards ?? []).map((c) => ({ m: c.minute, t: `Red card — ${c.team === 'home' ? st.home_team : st.away_team}`, g: false }));
    const upto = st.phase === 'finished' ? 5400 : clock();
    const atmo = simLines(matchId, st.home_team, st.away_team, st.duration_secs)
      .filter((l) => (l.sec ?? l.minute * 60) <= upto)
      .map((l) => ({ m: l.minute, t: l.text, g: false }));
    return [...goals, ...cards, ...atmo].sort((a1, b1) => b1.m - a1.m).slice(0, 4);
  }, [matchId, st?.home_team, st?.minute, st?.events?.length, st?.cards?.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!st) return null;
  const live = st.phase === 'live';
  const label = st.phase === 'upcoming' ? 'Starting soon' : st.phase === 'finished' ? 'FT' : `${st.minute}'`;
  const side: 'home' | 'away' | 'mid' = !live ? 'mid' : ball.team;
  const status = !live ? (st.phase === 'upcoming' ? 'Kick-off soon' : 'Full time')
    : side === 'home' ? `▶ ${st.home_team}` : `▶ ${st.away_team}`;

  return (
    <div className="minitv">
      <div className="mtv-sb">
        <Link className="mtv-lg" to={`/live/${matchId}`}>Watch · {st.home_team} - {st.away_team} ›</Link>
        <div className="mtv-main">
          <span className="mtv-t">{st.home_team}</span>
          <span className="mtv-sc">{st.phase === 'upcoming' ? '–' : `${st.home_score}-${st.away_score}`}<span className={`mtv-min ${live ? 'on' : ''}`}>{label}</span></span>
          <span className="mtv-t a">{st.away_team}</span>
        </div>
      </div>
      <div className="mtv-pitch">
        <div className="mtv-ml" /><div className="mtv-circ" />
        <div className="mtv-box l" /><div className="mtv-box r" />
        <div className="mtv-goal l" /><div className="mtv-goal r" />
        {live && (side === 'home' || side === 'mid') && <div className="arrow home" style={{ ['--ac' as string]: '#4aa3e2' }} />}
        {live && (side === 'away' || side === 'mid') && <div className="arrow away" style={{ ['--ac' as string]: '#e2a04a' }} />}
        {(live || st.phase === 'finished') && <div className="mtv-ball" style={{ left: `${live ? ball.x : 50}%`, top: `${live ? ball.y : 50}%` }} />}
        <div className="mtv-status">{status}</div>
      </div>
      <div className="mtv-feed">
        <div className="mtv-fh">Key attacks</div>
        {evs.length === 0 ? <div className="mtv-row"><span className="dim">No big moments yet.</span></div>
          : evs.map((e, i) => <div key={i} className={`mtv-row ${e.g ? 'g' : ''}`}><span className="mn">{e.m}&apos;</span><span>{e.t}</span></div>)}
      </div>
    </div>
  );
}
