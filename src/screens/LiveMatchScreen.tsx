import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveMatch } from '../live/useLiveMatch';
import {
  atmosphereScript, goalBurst, goalHistoryLine, cardLine, type Line,
} from '../live/commentary';
import { isPenaltyGoal } from '../live/liveModel';
import PitchTV from '../live/PitchTV';
import { matchProvider } from '../lib/matchProvider';
import type { CouponLeg, LiveState } from '../lib/types';
import { formatOdds, impliedProb } from '../lib/format';
import { teamColor } from '../lib/teams';

type OutKey = 'home' | 'draw' | 'away';

function computePickState(pick: OutKey, hs: number, as: number): 'win' | 'lose' | 'level' {
  const leader: OutKey = hs > as ? 'home' : as > hs ? 'away' : 'draw';
  if (pick === 'draw') return hs === as ? 'win' : 'lose';
  if (pick === leader) return 'win';
  return hs === as ? 'level' : 'lose';
}

// Full set of commentary lines that should be revealed by `minute`.
function revealedLines(matchId: string, st: LiveState, minute: number, atmo: Line[], baselineGoals: number): Line[] {
  const home = st.home_team, away = st.away_team;
  const out: Line[] = atmo.filter((l) => l.minute <= minute);
  let h = 0, a = 0;
  st.events.forEach((g, i) => {
    if (g.team === 'home') h++; else a++;
    const tName = g.team === 'home' ? home : away;
    if (i < baselineGoals) out.push(goalHistoryLine(g.minute, g.team, tName, h, a));
    else out.push(...goalBurst(matchId, g.minute, g.team, home, away, h, a, isPenaltyGoal(matchId, g.minute)));
  });
  for (const c of st.cards) out.push(cardLine(c.minute, c.team, c.team === 'home' ? home : away));
  return out.sort((x, y) => x.minute - y.minute || x.sub - y.sub);
}

export default function LiveMatchScreen() {
  const { matchId } = useParams<{ matchId: string }>();
  const navigate = useNavigate();
  const { state, minute } = useLiveMatch(matchId);

  const [myLeg, setMyLeg] = useState<CouponLeg | null>(null);
  const [couponId, setCouponId] = useState<string | null>(null);
  const [feed, setFeed] = useState<Line[]>([]);
  const [score, setScore] = useState({ h: 0, a: 0 });
  const [flash, setFlash] = useState<{ team: 'home' | 'away'; penalty: boolean } | null>(null);

  const stateRef = useRef<LiveState | null>(null);
  const minuteRef = useRef(0);
  stateRef.current = state;
  minuteRef.current = minute;

  const enqueued = useRef<Set<string>>(new Set());
  const queue = useRef<Line[]>([]);
  const feedRef = useRef<Line[]>([]);
  const seeded = useRef(false);
  const baselineGoals = useRef(0);
  const atmo = useMemo(() => (state ? atmosphereScript(matchId!, state.home_team, state.away_team) : []), [matchId, state?.home_team]); // eslint-disable-line react-hooks/exhaustive-deps

  // find the user's pick on this match
  useEffect(() => {
    (async () => {
      try {
        const coupons = await matchProvider.getMyCoupons();
        for (const c of coupons) {
          const leg = c.legs.find((l) => l.match.id === matchId);
          if (leg) { setMyLeg(leg); setCouponId(c.id); if (c.status === 'pending') break; }
        }
      } catch { /* optional */ }
    })();
  }, [matchId]);

  // commentary ticker: reveal lines by minute, stream them one at a time
  useEffect(() => {
    if (!matchId) return;
    const id = setInterval(() => {
      const st = stateRef.current;
      if (!st) return;
      const lines = revealedLines(matchId, st, minuteRef.current, atmo, baselineGoals.current);

      if (!seeded.current) {
        // join: everything so far is history — show at once, no burst/flash
        lines.forEach((l) => enqueued.current.add(l.key));
        feedRef.current = [...lines].reverse().slice(0, 60);
        baselineGoals.current = st.events.length;
        setFeed(feedRef.current);
        setScore({ h: st.home_score, a: st.away_score });
        seeded.current = true;
        return;
      }

      const fresh = lines.filter((l) => !enqueued.current.has(l.key));
      if (fresh.length) {
        fresh.forEach((l) => enqueued.current.add(l.key));
        queue.current.push(...fresh);
        queue.current.sort((x, y) => x.minute - y.minute || x.sub - y.sub);
      }

      // on full time, flush the rest so the feed doesn't lag
      if (st.phase === 'finished' && queue.current.length) {
        const rest = queue.current.splice(0);
        feedRef.current = [...rest.reverse(), ...feedRef.current].slice(0, 60);
        setFeed(feedRef.current);
        setScore({ h: st.home_score, a: st.away_score });
        return;
      }

      const next = queue.current.shift();
      if (next) {
        feedRef.current = [next, ...feedRef.current].slice(0, 60);
        setFeed(feedRef.current);
        if (next.isGoal) {
          if (next.scoreH != null) setScore({ h: next.scoreH, a: next.scoreA! });
          setFlash({ team: next.team!, penalty: !!next.penalty });
          window.setTimeout(() => setFlash(null), 1200);
        }
      }
    }, 380);
    return () => clearInterval(id);
  }, [matchId, atmo]);

  if (!state) {
    return <div className="settle"><div className="spinner" /><p className="settle-note">Connecting to the match…</p></div>;
  }

  const { home_team: home, away_team: away, phase, live_odds: odds } = state;
  const finished = phase === 'finished';
  const hs = finished ? state.home_score : score.h;
  const as = finished ? state.away_score : score.a;
  const shownMinute = phase === 'upcoming' ? 0 : finished ? 90 : minute;

  const pick = myLeg?.outcome_key as OutKey | undefined;
  const pickState = pick ? computePickState(pick, hs, as) : null;
  const pickLabel = { win: 'Winning', lose: 'Losing', level: 'On the line' } as const;
  const oddsArr = odds ? [odds.home, odds.draw, odds.away] : [];

  return (
    <div className="app-shell live-screen">
      {flash && (
        <div className="goal-flash" style={{ ['--flash' as string]: teamColor(flash.team === 'home' ? home : away) }}>
          <span className="goal-flash-word">{flash.penalty ? 'PENALTY!' : 'GOAL!'}</span>
          <span className="goal-flash-team">{flash.team === 'home' ? home : away}</span>
        </div>
      )}

      <div className="live-statusbar">
        {phase === 'upcoming' && <span className="chip">Kicking off…</span>}
        {phase === 'live' && <span className="chip chip-live"><span className="dot" />LIVE · {shownMinute < 45 ? '1st half' : '2nd half'}</span>}
        {finished && <span className="chip">Full-time</span>}
      </div>

      <PitchTV
        home={home} away={away} hs={phase === 'upcoming' ? 0 : hs} as={phase === 'upcoming' ? 0 : as}
        minute={shownMinute} phase={phase} redHome={state.red_home} redAway={state.red_away}
        flashTeam={flash?.team ?? null}
      />

      {myLeg && (
        <div className={`card betstatus ${pickState ?? ''}`}>
          <div className="stack" style={{ gap: 2 }}>
            <span className="tag">Your pick</span>
            <span className="betstatus-pick">{myLeg.market_name}: {myLeg.option_label}<span className="mono dim"> @ {formatOdds(myLeg.odds)}</span></span>
          </div>
          {pickState && (
            <span className={`betstatus-flag ${pickState}`}>{finished ? (pickState === 'win' ? 'Won' : 'Missed') : pickLabel[pickState]}</span>
          )}
        </div>
      )}

      {odds && !finished && (
        <>
          <div className="section-head"><h3>Match result · live</h3></div>
          <div className="market live-odds-row">
            {(['home', 'draw', 'away'] as OutKey[]).map((k) => (
              <div key={k} className={`outcome ${myLeg?.outcome_key === k ? 'sel' : ''}`}>
                <span className="outcome-name">{k === 'home' ? '1' : k === 'draw' ? 'X' : '2'}</span>
                <span className="outcome-odds">{formatOdds(odds[k])}</span>
                <span className="outcome-prob">{impliedProb(odds[k], oddsArr)}%</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="section-head"><h3>Commentary</h3></div>
      <div className="card cm-feed">
        {feed.length === 0 && <div className="cm-line"><span className="cm-text muted">The players are out…</span></div>}
        {feed.map((l) => (
          <div key={l.key} className={`cm-line ${l.isGoal ? 'cm-goal' : ''} ${l.kind === 'card' ? 'cm-card' : ''}`}>
            <span className="cm-min tnum">{l.minute}&apos;</span>
            <span className="cm-text">{l.text}</span>
          </div>
        ))}
      </div>

      <button className="btn btn-ghost btn-block" style={{ marginTop: 'var(--s3)' }} onClick={() => (couponId ? navigate('/coupons') : navigate(-1))}>
        {couponId ? 'My coupons' : 'Back'}
      </button>
    </div>
  );
}
