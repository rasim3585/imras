import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveMatch } from '../live/useLiveMatch';
import { atmosphereFor, isPenaltyGoal, isGoalType, type LiveEvent } from '../live/liveModel';
import { matchProvider } from '../lib/matchProvider';
import type { CouponLeg } from '../lib/types';
import { formatOdds, impliedProb } from '../lib/format';
import { teamColor, teamInitial } from '../lib/teams';
import { BallIcon, RedCardIcon, WhistleIcon, SparkIcon } from '../components/icons';

type OutKey = 'home' | 'draw' | 'away';

function Badge({ name, glow }: { name: string; glow?: boolean }) {
  return (
    <span className={`team-badge ${glow ? 'badge-glow' : ''}`} style={{ background: teamColor(name) }} aria-hidden="true">
      {teamInitial(name)}
    </span>
  );
}

function EventIcon({ type }: { type: LiveEvent['type'] }) {
  if (type === 'red_card') return <span className="feed-ic red"><RedCardIcon /></span>;
  if (type === 'penalty_miss') return <span className="feed-ic warn"><WhistleIcon /></span>;
  if (type === 'chance') return <span className="feed-ic warn"><SparkIcon /></span>;
  return <span className="feed-ic goal"><BallIcon /></span>;
}

type FeedRow = { key: string; minute: number; type: LiveEvent['type'] | 'mark'; text: string };

function buildFeed(
  matchId: string, goals: { minute: number; team: 'home' | 'away' }[],
  atmo: LiveEvent[], home: string, away: string, minute: number, finished: boolean,
): FeedRow[] {
  const rows: FeedRow[] = [];
  let h = 0, a = 0;
  const merged: LiveEvent[] = [
    ...goals.map((g) => ({ minute: g.minute, team: g.team, type: (isPenaltyGoal(matchId, g.minute) ? 'penalty_goal' : 'goal') as LiveEvent['type'] })),
    ...atmo.filter((e) => e.minute <= minute),
  ].sort((x, y) => x.minute - y.minute);

  for (const e of merged) {
    const team = e.team === 'home' ? home : away;
    if (isGoalType(e.type)) {
      if (e.team === 'home') h++; else a++;
      rows.push({ key: `${e.minute}${e.type}${e.team}`, minute: e.minute, type: e.type, text: `${team}${e.type === 'penalty_goal' ? ' (pen)' : ''} — ${h}-${a}` });
    } else {
      const label = e.type === 'red_card' ? 'Red card' : e.type === 'penalty_miss' ? 'Penalty missed' : 'Big chance';
      rows.push({ key: `${e.minute}${e.type}${e.team}`, minute: e.minute, type: e.type, text: `${label} — ${team}` });
    }
  }
  if (minute >= 45 || finished) rows.push({ key: 'ht', minute: 45, type: 'mark', text: 'Half-time' });
  rows.push({ key: 'ko', minute: 0, type: 'mark', text: 'Kick-off' });
  if (finished) rows.push({ key: 'ft', minute: 91, type: 'mark', text: 'Full-time' });
  return rows.sort((x, y) => y.minute - x.minute);
}

function computePickState(pick: OutKey, hs: number, as: number): 'win' | 'lose' | 'level' {
  const leader: OutKey = hs > as ? 'home' : as > hs ? 'away' : 'draw';
  if (pick === 'draw') return hs === as ? 'win' : 'lose';
  if (pick === leader) return 'win';
  return hs === as ? 'level' : 'lose';
}

export default function LiveMatchScreen() {
  const { matchId } = useParams<{ matchId: string }>();
  const navigate = useNavigate();
  const { state, minute, countdown } = useLiveMatch(matchId);

  const [myLeg, setMyLeg] = useState<CouponLeg | null>(null);
  const [couponId, setCouponId] = useState<string | null>(null);
  const [goalFlash, setGoalFlash] = useState<{ team: 'home' | 'away'; penalty: boolean } | null>(null);
  const [flashQueue, setFlashQueue] = useState<{ team: 'home' | 'away'; penalty: boolean }[]>([]);
  const [pickFlash, setPickFlash] = useState<string | null>(null);
  const goalBaseline = useRef<number | null>(null);
  const prevPickRef = useRef<string | null>(null);

  const atmo = useMemo(() => (matchId ? atmosphereFor(matchId) : []), [matchId]);

  useEffect(() => {
    (async () => {
      try {
        const coupons = await matchProvider.getMyCoupons();
        let found: { leg: CouponLeg; cid: string } | null = null;
        for (const c of coupons) {
          const leg = c.legs.find((l) => l.match.id === matchId);
          if (leg) { found = { leg, cid: c.id }; if (c.status === 'pending') break; }
        }
        if (found) { setMyLeg(found.leg); setCouponId(found.cid); }
      } catch { /* optional */ }
    })();
  }, [matchId]);

  // enqueue a flash for every NEW goal since the last poll (queue = consistent,
  // even for back-to-back goals). Goals present at join are baseline (no flash).
  const goalCount = state?.events.length ?? 0;
  useEffect(() => {
    if (!state) return;
    if (goalBaseline.current === null) { goalBaseline.current = goalCount; return; }
    if (goalCount > goalBaseline.current) {
      const fresh = state.events.slice(goalBaseline.current);
      goalBaseline.current = goalCount;
      setFlashQueue((q) => [...q, ...fresh.map((g) => ({ team: g.team, penalty: isPenaltyGoal(matchId!, g.minute) }))]);
    }
  }, [goalCount, state, matchId]);

  // drain the queue one flash at a time
  useEffect(() => {
    if (goalFlash || flashQueue.length === 0) return;
    const [next, ...rest] = flashQueue;
    setGoalFlash(next);
    setFlashQueue(rest);
    if (myLeg && state) {
      const ps = computePickState(myLeg.outcome_key as OutKey, state.home_score, state.away_score);
      if (prevPickRef.current && prevPickRef.current !== ps && ps !== 'level') {
        setPickFlash(ps === 'win' ? 'That goal put you ahead!' : 'That goal put your coupon at risk!');
      }
      prevPickRef.current = ps;
    }
    const t = setTimeout(() => setGoalFlash(null), 1300);
    const t2 = setTimeout(() => setPickFlash(null), 2600);
    return () => { clearTimeout(t); clearTimeout(t2); };
  }, [goalFlash, flashQueue, myLeg, state]);

  if (!state) {
    return <div className="settle"><div className="spinner" /><p className="settle-note">Connecting to the match…</p></div>;
  }

  const { home_team: home, away_team: away, phase, home_score: hs, away_score: as, live_odds: odds } = state;
  const finished = phase === 'finished';
  const shownMinute = phase === 'upcoming' ? 0 : finished ? 90 : minute;

  const pick = myLeg?.outcome_key as OutKey | undefined;
  const pickState = pick ? computePickState(pick, hs, as) : null;
  const pickLabel = { win: 'Winning', lose: 'Losing', level: 'On the line' } as const;
  const oddsArr = odds ? [odds.home, odds.draw, odds.away] : [];
  const feed = buildFeed(matchId!, state.events, atmo, home, away, shownMinute, finished);

  return (
    <div className="app-shell live-screen">
      {goalFlash && (
        <div className="goal-flash" style={{ ['--flash' as string]: teamColor(goalFlash.team === 'home' ? home : away) }}>
          <span className="goal-flash-word">{goalFlash.penalty ? 'PENALTY!' : 'GOAL!'}</span>
          <span className="goal-flash-team">{goalFlash.team === 'home' ? home : away}</span>
        </div>
      )}

      <div className="live-statusbar">
        {phase === 'upcoming' && <span className="chip">Kick-off in {countdown}s</span>}
        {phase === 'live' && <span className="chip chip-live"><span className="dot" />LIVE · {shownMinute < 45 ? '1st half' : '2nd half'}</span>}
        {finished && <span className="chip">Full-time</span>}
      </div>

      <div className="card live-board">
        <div className="lb-side"><Badge name={home} glow={goalFlash?.team === 'home'} /><span className="lb-team">{home}</span></div>
        <div className="lb-center">
          <div className={`lb-score tnum ${goalFlash ? 'pop' : ''}`} key={`${hs}-${as}`}>
            <span className="lb-num">{phase === 'upcoming' ? '–' : hs}</span>
            <span className="lb-sep">:</span>
            <span className="lb-num">{phase === 'upcoming' ? '–' : as}</span>
          </div>
          <div className="lb-minute tnum">{phase === 'upcoming' ? 'soon' : finished ? "90'" : `${shownMinute}'`}</div>
        </div>
        <div className="lb-side lb-away"><span className="lb-team">{away}</span><Badge name={away} glow={goalFlash?.team === 'away'} /></div>
      </div>

      {myLeg && (
        <div className={`card betstatus ${pickState ?? ''}`}>
          <div className="stack" style={{ gap: 2 }}>
            <span className="tag">Your pick</span>
            <span className="betstatus-pick">{myLeg.market_name}: {myLeg.option_label}<span className="mono dim"> @ {formatOdds(myLeg.odds)}</span></span>
            {pickFlash && !finished && <span className="pick-flash">{pickFlash}</span>}
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

      <div className="section-head"><h3>Match feed</h3></div>
      <div className="card live-feed">
        {feed.map((f) => (
          <div key={f.key} className={`feed-item ${f.type === 'mark' ? 'mark' : 'ev'} ${f.type !== 'mark' && isGoalType(f.type) ? 'goal' : ''}`}>
            <span className="feed-min tnum">{f.minute === 0 ? "0'" : f.minute === 91 ? "90'" : `${f.minute}'`}</span>
            {f.type !== 'mark' && <EventIcon type={f.type} />}
            <span className="feed-text">{f.text}</span>
          </div>
        ))}
      </div>

      {finished && couponId && (
        <button className="btn btn-primary btn-block" style={{ marginTop: 'var(--s4)' }} onClick={() => navigate(`/settle/${couponId}`)}>Settle my coupon</button>
      )}
      <button className="btn btn-ghost btn-block" style={{ marginTop: 'var(--s2)' }} onClick={() => navigate(-1)}>Back</button>
    </div>
  );
}
