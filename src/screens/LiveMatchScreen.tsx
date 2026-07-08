import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveMatch } from '../live/useLiveMatch';
import { matchProvider } from '../lib/matchProvider';
import type { CouponLeg } from '../lib/types';
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

// Build a chronological feed (newest first) with running score + half/full time.
function buildFeed(
  events: { minute: number; team: 'home' | 'away' }[],
  home: string, away: string, minute: number, finished: boolean,
) {
  const items: { key: string; minute: number; text: string; kind: 'goal' | 'mark' }[] = [];
  let h = 0, a = 0;
  for (const e of events) {
    if (e.team === 'home') h++; else a++;
    items.push({
      key: `g${e.minute}${e.team}`, minute: e.minute, kind: 'goal',
      text: `${e.team === 'home' ? home : away} — ${h}-${a}`,
    });
  }
  if (minute >= 45 || finished)
    items.push({ key: 'ht', minute: 45, kind: 'mark', text: 'Half-time' });
  items.push({ key: 'ko', minute: 0, kind: 'mark', text: 'Kick-off' });
  if (finished) items.push({ key: 'ft', minute: 91, kind: 'mark', text: 'Full-time' });
  return items.sort((x, y) => y.minute - x.minute);
}

export default function LiveMatchScreen() {
  const { matchId } = useParams<{ matchId: string }>();
  const navigate = useNavigate();
  const { state, minute, countdown, error } = useLiveMatch(matchId);
  const [myLeg, setMyLeg] = useState<CouponLeg | null>(null);
  const [couponId, setCouponId] = useState<string | null>(null);

  // find this user's open pick on this match (for the live "are you winning" card)
  useEffect(() => {
    (async () => {
      try {
        const coupons = await matchProvider.getMyCoupons();
        for (const c of coupons) {
          if (c.status !== 'pending') continue;
          const leg = c.legs.find((l) => l.match.id === matchId);
          if (leg) { setMyLeg(leg); setCouponId(c.id); break; }
        }
      } catch { /* prediction card is optional */ }
    })();
  }, [matchId]);

  if (error) {
    return (
      <div className="app-shell" style={{ paddingTop: 'var(--s6)' }}>
        <div className="banner banner-error">{error}</div>
        <button className="btn btn-block" onClick={() => navigate(-1)}>Back</button>
      </div>
    );
  }
  if (!state) {
    return <div className="settle"><div className="spinner" /><p className="settle-note">Connecting to the match…</p></div>;
  }

  const { home_team: home, away_team: away, phase, home_score: hs, away_score: as, live_odds } = state;
  const finished = phase === 'finished';
  const shownMinute = phase === 'upcoming' ? 0 : finished ? 90 : minute;
  const half = shownMinute < 45 ? '1st half' : shownMinute < 90 ? '2nd half' : 'Full-time';

  // pick status
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

  const odds = live_odds;
  const oddsArr = odds ? [odds.home, odds.draw, odds.away] : [];
  const feed = buildFeed(state.events, home, away, shownMinute, finished);

  return (
    <div className="app-shell live-screen">
      {/* status */}
      <div className="live-statusbar">
        {phase === 'upcoming' && <span className="chip">Kick-off in {countdown}s</span>}
        {phase === 'live' && <span className="chip chip-live"><span className="dot" />LIVE · {half}</span>}
        {finished && <span className="chip">Full-time</span>}
      </div>

      {/* scoreboard */}
      <div className="card live-board">
        <div className="lb-side">
          <Badge name={home} />
          <span className="lb-team">{home}</span>
        </div>
        <div className="lb-center">
          <div className="lb-score tnum">
            {phase === 'upcoming' ? <span className="lb-num">–</span> : <span className="lb-num">{hs}</span>}
            <span className="lb-sep">:</span>
            {phase === 'upcoming' ? <span className="lb-num">–</span> : <span className="lb-num">{as}</span>}
          </div>
          <div className="lb-minute tnum">
            {phase === 'upcoming' ? 'soon' : finished ? "90'" : `${shownMinute}'`}
          </div>
        </div>
        <div className="lb-side lb-away">
          <span className="lb-team">{away}</span>
          <Badge name={away} />
        </div>
      </div>

      {/* your bet, live */}
      {myLeg && (
        <div className={`card betstatus ${pickState ?? ''}`}>
          <div className="stack" style={{ gap: 2 }}>
            <span className="tag">Your pick</span>
            <span className="betstatus-pick">
              {myLeg.market_name}: {myLeg.option_label}
              <span className="mono dim"> @ {formatOdds(myLeg.odds)}</span>
            </span>
          </div>
          {pickState && (
            <span className={`betstatus-flag ${pickState}`}>
              {finished ? (pickState === 'win' ? 'Won' : 'Missed') : pickLabel[pickState]}
            </span>
          )}
        </div>
      )}

      {/* live odds */}
      {odds && !finished && (
        <>
          <div className="section-head"><h3>Match result · live</h3></div>
          <div className="market live-odds-row">
            {(['home', 'draw', 'away'] as OutKey[]).map((k) => (
              <div key={k} className={`outcome ${myLeg?.outcome_key === k ? 'sel' : ''}`} style={{ cursor: 'default' }}>
                <span className="outcome-name">{k === 'home' ? '1' : k === 'draw' ? 'X' : '2'}</span>
                <span className="outcome-odds">{formatOdds(odds[k])}</span>
                <span className="outcome-prob">{impliedProb(odds[k], oddsArr)}%</span>
              </div>
            ))}
          </div>
          <p className="dim live-odds-note">Live betting on these odds arrives next phase.</p>
        </>
      )}

      {/* event feed */}
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
      <button className="btn btn-ghost btn-block" style={{ marginTop: 'var(--s2)' }} onClick={() => navigate(-1)}>
        Back
      </button>
    </div>
  );
}
