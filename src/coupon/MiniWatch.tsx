import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { matchProvider } from '../lib/matchProvider';
import type { LiveState } from '../lib/types';

// Compact live view of the coupon's LAST-ADDED match: mini scoreboard + a tiny
// pitch (ball indicator) + key attacks. Fills the space under the short coupon.
export default function MiniWatch({ matchId }: { matchId: string }) {
  const [st, setSt] = useState<LiveState | null>(null);
  const [ball, setBall] = useState<[number, number]>([56, 46]);
  const zone = useRef<[number, number]>([56, 46]);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try { const [s] = await matchProvider.getLiveStates([matchId]); if (alive && s) setSt(s); }
      catch { /* transient */ }
    };
    void poll();
    const id = setInterval(poll, 2500);
    return () => { alive = false; clearInterval(id); };
  }, [matchId]);

  useEffect(() => {
    if (st?.phase !== 'live') return;
    const id = setInterval(() => {
      const z = zone.current;
      setBall([Math.max(10, Math.min(90, z[0] + (Math.random() - 0.5) * 40)), Math.max(20, Math.min(80, z[1] + (Math.random() - 0.5) * 30))]);
    }, 1700);
    return () => clearInterval(id);
  }, [st?.phase]);

  if (!st) return null;
  const live = st.phase === 'live';
  const label = st.phase === 'upcoming' ? 'Starting soon' : st.phase === 'finished' ? 'FT' : `${st.minute}'`;
  const evs = [
    ...(st.events ?? []).map((e) => ({ m: e.minute, t: `Goal · ${e.team === 'home' ? st.home_team : st.away_team}`, g: true })),
    ...(st.cards ?? []).map((c) => ({ m: c.minute, t: `Red · ${c.team === 'home' ? st.home_team : st.away_team}`, g: false })),
  ].sort((a, b) => b.m - a.m).slice(0, 3);

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
        <div className="mtv-ml" />
        {(live || st.phase === 'finished') && <div className="mtv-ball" style={{ left: `${ball[0]}%`, top: `${ball[1]}%` }} />}
      </div>
      <div className="mtv-feed">
        <div className="mtv-fh">Key attacks</div>
        {evs.length === 0 ? <div className="mtv-row"><span className="dim">No big moments yet.</span></div>
          : evs.map((e, i) => <div key={i} className={`mtv-row ${e.g ? 'g' : ''}`}><span className="mn">{e.m}&apos;</span><span>{e.t}</span></div>)}
      </div>
    </div>
  );
}
