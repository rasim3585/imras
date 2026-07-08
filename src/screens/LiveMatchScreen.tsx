import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveMatch } from '../live/useLiveMatch';
import { useMatchReplay } from '../live/useMatchReplay';
import type { WatchTimeline } from '../live/liveModel';
import { matchProvider } from '../lib/matchProvider';
import type { CouponLeg, MatchEvent } from '../lib/types';
import { formatOdds, impliedProb } from '../lib/format';
import { teamColor, teamInitial } from '../lib/teams';
import { BallIcon } from '../components/icons';

type OutKey = 'home' | 'draw' | 'away';

function Badge({ name }: { name: string }) {
  return (
    <span className="team-badge" style={{ background: teamColor(name) }} aria-hidden="true">
      {teamInitial(name)}
    </span>
  );
}

function buildFeed(events: MatchEvent[], home: string, away: string, minute: number, finished: boolean) {
  const items: { key: string; minute: number; text: string; kind: 'goal' | 'mark' }[] = [];
  let h = 0, a = 0;
  for (const e of events) {
    if (e.team === 'home') h++; else a++;
    items.push({ key: `g${e.minute}${e.team}`, minute: e.minute, kind: 'goal', text: `${e.team === 'home' ? home : away} — ${h}-${a}` });
  }
  if (minute >= 45 || finished) items.push({ key: 'ht', minute: 45, kind: 'mark', text: 'Half-time' });
  items.push({ key: 'ko', minute: 0, kind: 'mark', text: 'Kick-off' });
  if (finished) items.push({ key: 'ft', minute: 91, kind: 'mark', text: 'Full-time' });
  return items.sort((x, y) => y.minute - x.minute);
}

export default function LiveMatchScreen() {
  const { matchId } = useParams<{ matchId: string }>();
  const navigate = useNavigate();

  const [tl, setTl] = useState<WatchTimeline | null | undefined>(undefined); // undefined = loading
  const [myLeg, setMyLeg] = useState<CouponLeg | null>(null);
  const [couponId, setCouponId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Try the personal replay (only for matches you've bet on).
  useEffect(() => {
    if (!matchId) return;
    (async () => {
      try {
        setTl(await matchProvider.getWatchTimeline(matchId));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not open this match');
      }
    })();
  }, [matchId]);

  // Find the user's pick on this match (for the live "are you winning" card).
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

  const replay = useMatchReplay(tl ?? null);
  const server = useLiveMatch(tl === null && matchId ? matchId : undefined);

  if (error) {
    return (
      <div className="app-shell" style={{ paddingTop: 'var(--s6)' }}>
        <div className="banner banner-error">{error}</div>
        <button className="btn btn-block" onClick={() => navigate(-1)}>Back</button>
      </div>
    );
  }

  // Unify replay / server into one view.
  type View = {
    home: string; away: string; phase: 'upcoming' | 'live' | 'finished';
    minute: number; hs: number; as: number; events: MatchEvent[];
    odds: { home: number; draw: number; away: number } | null; countdown: number;
  };
  let view: View | null = null;
  if (tl && replay) {
    view = { home: tl.home_team, away: tl.away_team, phase: replay.phase, minute: replay.minute,
      hs: replay.home_score, as: replay.away_score, events: replay.revealed, odds: replay.live_odds, countdown: 0 };
  } else if (tl === null && server.state) {
    const s = server.state;
    view = { home: s.home_team, away: s.away_team, phase: s.phase, minute: server.minute,
      hs: s.home_score, as: s.away_score, events: s.events, odds: s.live_odds, countdown: server.countdown };
  }

  if (!view) {
    return <div className="settle"><div className="spinner" /><p className="settle-note">Walking out to the pitch…</p></div>;
  }

  const { home, away, phase, minute, hs, as, odds, countdown, events } = view;
  const finished = phase === 'finished';
  const shownMinute = phase === 'upcoming' ? 0 : finished ? 90 : minute;
  const half = shownMinute < 45 ? '1st half' : shownMinute < 90 ? '2nd half' : 'Full-time';

  const pick = myLeg?.outcome_key as OutKey | undefined;
  const leader: OutKey = hs > as ? 'home' : as > hs ? 'away' : 'draw';
  let pickState: 'win' | 'lose' | 'level' | null = null;
  if (pick) {
    if (pick === 'draw') pickState = hs === as ? 'win' : 'lose';
    else if (pick === leader) pickState = 'win';
    else if (hs === as) pickState = 'level';
    else pickState = 'lose';
  }
  const pickLabel = { win: 'Winning', lose: 'Losing', level: 'On the line' } as const;
  const oddsArr = odds ? [odds.home, odds.draw, odds.away] : [];
  const feed = buildFeed(events, home, away, shownMinute, finished);

  return (
    <div className="app-shell live-screen">
      <div className="live-statusbar">
        {phase === 'upcoming' && <span className="chip">Kick-off in {countdown}s</span>}
        {phase === 'live' && <span className="chip chip-live"><span className="dot" />LIVE · {half}</span>}
        {finished && <span className="chip">Full-time</span>}
      </div>

      <div className="card live-board">
        <div className="lb-side"><Badge name={home} /><span className="lb-team">{home}</span></div>
        <div className="lb-center">
          <div className="lb-score tnum" key={`${hs}-${as}`}>
            <span className="lb-num">{phase === 'upcoming' ? '–' : hs}</span>
            <span className="lb-sep">:</span>
            <span className="lb-num">{phase === 'upcoming' ? '–' : as}</span>
          </div>
          <div className="lb-minute tnum">{phase === 'upcoming' ? 'soon' : finished ? "90'" : `${shownMinute}'`}</div>
        </div>
        <div className="lb-side lb-away"><span className="lb-team">{away}</span><Badge name={away} /></div>
      </div>

      {myLeg && (
        <div className={`card betstatus ${pickState ?? ''}`}>
          <div className="stack" style={{ gap: 2 }}>
            <span className="tag">Your pick</span>
            <span className="betstatus-pick">{myLeg.market_name}: {myLeg.option_label}<span className="mono dim"> @ {formatOdds(myLeg.odds)}</span></span>
          </div>
          {pickState && (
            <span className={`betstatus-flag ${pickState}`}>
              {finished ? (pickState === 'win' ? 'Won' : 'Missed') : pickLabel[pickState]}
            </span>
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
          <p className="dim live-odds-note">Live betting on these odds arrives next phase.</p>
        </>
      )}

      <div className="section-head"><h3>Match feed</h3></div>
      <div className="card live-feed">
        {feed.map((f) => (
          <div key={f.key} className={`feed-item ${f.kind}`}>
            <span className="feed-min tnum">{f.minute === 0 ? "0'" : f.minute === 91 ? "90'" : `${f.minute}'`}</span>
            {f.kind === 'goal' && <span className="feed-ball"><BallIcon /></span>}
            <span className="feed-text">{f.text}</span>
          </div>
        ))}
      </div>

      {finished && couponId && (
        <button className="btn btn-primary btn-block" style={{ marginTop: 'var(--s4)' }} onClick={() => navigate(`/settle/${couponId}`)}>
          Settle my coupon
        </button>
      )}
      <button className="btn btn-ghost btn-block" style={{ marginTop: 'var(--s2)' }} onClick={() => navigate(-1)}>Back</button>
    </div>
  );
}
