import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveMatch } from '../live/useLiveMatch';
import {
  atmosphereScript, goalBurst, goalHistoryLine, cardLine, type Line,
} from '../live/commentary';
import { isPenaltyGoal } from '../live/liveModel';
import { statsAt } from '../live/liveSim';
import PitchTV, { type GoalPulse } from '../live/PitchTV';
import MatchChat from '../live/ChatPanel';
import { matchProvider } from '../lib/matchProvider';
import { useI18n } from '../i18n/LanguageContext';
import type { CouponLeg, LiveState } from '../lib/types';
import { formatOdds, impliedProb } from '../lib/format';
import { teamColor } from '../lib/teams';
import { playerName } from '../lib/playerNames';

type OutKey = 'home' | 'draw' | 'away';

const LINE_ICON: Record<string, string> = {
  goal: '⚽', shot: '🎯', save: '🧤', miss: '💨', blocked: '🛡', corner: '⛳',
  freekick: '🎯', offside: '🚩', foul: '⚠', yellow: '🟨', card: '🟥', sub: '🔁',
  buildup: '▶', calm: '·', mark: '·',
};

// Nesine-style live stats strip: possession bar + a compact row per metric.
function StatsPanel({ matchId, minute, reds, home, away }: {
  matchId: string; minute: number; reds: [number, number]; home: string; away: string;
}) {
  const { t } = useI18n();
  const s = statsAt(matchId, minute, reds);
  const [ph, pa] = s.possession;
  const rows: [string, [number, number]][] = [
    [t('live.shots'), s.shots], [t('live.ontarget'), s.onTarget], [t('live.corners'), s.corners],
    [t('live.fouls'), s.fouls], [t('live.yellow'), s.yellows], [t('live.red'), s.reds],
  ];
  const Bar = ({ label, l, r }: { label: string; l: number; r: number }) => {
    const tot = l + r;
    const lp = tot === 0 ? 50 : Math.round((100 * l) / tot);
    return (
      <div className="lst-row">
        <span className="lst-l tnum">{l}</span>
        <div className="lst-mid">
          <span className="lst-k">{label}</span>
          <div className="lst-bar"><div className="lst-h" style={{ width: `${lp}%` }} /><div className="lst-a" style={{ width: `${100 - lp}%` }} /></div>
        </div>
        <span className="lst-r tnum">{r}</span>
      </div>
    );
  };
  return (
    <div className="card lst">
      <div className="lst-head"><span className="lst-tm">{home}</span><span className="lst-ti">{t('live.stats')}</span><span className="lst-tm">{away}</span></div>
      <div className="lst-row lst-poss">
        <span className="lst-l tnum">{ph}%</span>
        <div className="lst-mid">
          <span className="lst-k">{t('live.poss')}</span>
          <div className="lst-bar big"><div className="lst-h" style={{ width: `${ph}%` }} /><div className="lst-a" style={{ width: `${pa}%` }} /></div>
        </div>
        <span className="lst-r tnum">{pa}%</span>
      </div>
      {rows.map(([label, [l, r]]) => <Bar key={label} label={label} l={l} r={r} />)}
    </div>
  );
}

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
  const { t } = useI18n();
  const { state, minute, error, getClock } = useLiveMatch(matchId);
  const [gaveUp, setGaveUp] = useState(false);

  // Don't spin forever: the live-watch screen only serves virtual matches. If no
  // state loads in a few seconds (e.g. a real fixture id), show a way out.
  useEffect(() => {
    if (state) { setGaveUp(false); return; }
    const t = window.setTimeout(() => setGaveUp(true), 6000);
    return () => window.clearTimeout(t);
  }, [state, matchId]);

  const [myLeg, setMyLeg] = useState<CouponLeg | null>(null);
  const [couponId, setCouponId] = useState<string | null>(null);
  const [feed, setFeed] = useState<Line[]>([]);
  const [score, setScore] = useState({ h: 0, a: 0 });
  const [flash, setFlash] = useState<{ team: 'home' | 'away'; penalty: boolean } | null>(null);
  const [goalPulse, setGoalPulse] = useState<GoalPulse | null>(null);
  const pulseId = useRef(0);

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
          setGoalPulse({ id: ++pulseId.current, team: next.team!, penalty: !!next.penalty });
          window.setTimeout(() => setFlash(null), 1200);
        }
      }
    }, 380);
    return () => clearInterval(id);
  }, [matchId, atmo]);

  if (!state) {
    if (gaveUp || error) {
      return (
        <div className="app-shell" style={{ paddingTop: 'var(--s6)' }}>
          <div className="banner banner-error">{error ?? t('live.notsim')}</div>
          <button className="btn btn-block" onClick={() => navigate(-1)}>{t('md.back')}</button>
        </div>
      );
    }
    return <div className="settle"><div className="spinner" /><p className="settle-note">{t('live.connecting')}</p></div>;
  }

  const { home_team: home, away_team: away, phase, live_odds: odds } = state;
  const finished = phase === 'finished';
  const hs = finished ? state.home_score : score.h;
  const as = finished ? state.away_score : score.a;
  const shownMinute = phase === 'upcoming' ? 0 : finished ? 90 : minute;

  // İlk yarı skoru (Nesine başlık paritesi) — 45' ve öncesi goller
  const htPast = finished || shownMinute >= 45;
  const htH = htPast ? state.events.filter((e) => e.team === 'home' && e.minute <= 45).length : null;
  const htA = htPast ? state.events.filter((e) => e.team === 'away' && e.minute <= 45).length : null;
  const ht = htH != null && htA != null ? ([htH, htA] as [number, number]) : null;
  const liveStats = phase !== 'upcoming' ? statsAt(matchId!, shownMinute, [state.red_home, state.red_away]) : null;

  const pick = myLeg?.outcome_key as OutKey | undefined;
  const pickState = pick ? computePickState(pick, hs, as) : null;
  const pickLabel = { win: t('live.win'), lose: t('live.lose'), level: t('live.level') } as const;
  const oddsArr = odds ? [odds.home, odds.draw, odds.away].filter((x): x is number => x != null) : [];
  // Kazanma olasılığı (Nesine esinli): canlı oranların ima ettiği ev/deplasman payı.
  const ph = odds?.home ? 1 / odds.home : 0;
  const pa = odds?.away ? 1 / odds.away : 0;
  const homePct = ph + pa > 0 ? Math.round((100 * ph) / (ph + pa)) : 50;

  return (
    <div className="app-shell live-screen">
      {flash && (
        <div className="goal-flash" style={{ ['--flash' as string]: teamColor(flash.team === 'home' ? home : away) }}>
          <span className="goal-flash-word">{flash.penalty ? t('live.penalty') : t('live.goal')}</span>
          <span className="goal-flash-team">{flash.team === 'home' ? home : away}</span>
        </div>
      )}

      <div className="live-statusbar">
        {phase === 'upcoming' && <span className="chip">{t('live.kickoff')}</span>}
        {phase === 'live' && <span className="chip chip-live"><span className="dot" />LIVE · {shownMinute < 45 ? t('live.half1') : t('live.half2')}</span>}
        {finished && <span className="chip">{t('live.fulltime')}</span>}
      </div>

      <PitchTV
        home={home} away={away} hs={phase === 'upcoming' ? 0 : hs} as={phase === 'upcoming' ? 0 : as}
        minute={shownMinute} phase={phase} redHome={state.red_home} redAway={state.red_away}
        matchId={matchId!} getClock={getClock} goalPulse={goalPulse}
        homePlayer={playerName(matchId + 'h')} awayPlayer={playerName(matchId + 'a')}
        ht={ht} yellows={liveStats?.yellows}
      />

      {phase !== 'upcoming' && matchId && (
        <StatsPanel matchId={matchId} minute={shownMinute} reds={[state.red_home, state.red_away]} home={home} away={away} />
      )}

      {odds && !finished && (ph > 0 || pa > 0) && (
        <div className="winprob">
          <div className="winprob-head"><span className="k">{t('live.winprob')}</span></div>
          <div className="winprob-bar">
            <div className="winprob-h" style={{ width: `${homePct}%` }} />
            <div className="winprob-a" style={{ width: `${100 - homePct}%` }} />
          </div>
          <div className="winprob-labels">
            <span className="winprob-lh"><b>{homePct}%</b> {home}</span>
            <span className="winprob-la">{away} <b>{100 - homePct}%</b></span>
          </div>
        </div>
      )}

      {myLeg && (
        <div className={`card betstatus ${pickState ?? ''}`}>
          <div className="stack" style={{ gap: 2 }}>
            <span className="tag">{t('live.yourpick')}</span>
            <span className="betstatus-pick">{myLeg.market_name}: {myLeg.option_label}<span className="mono dim"> @ {formatOdds(myLeg.odds)}</span></span>
          </div>
          {pickState && (
            <span className={`betstatus-flag ${pickState}`}>{finished ? (pickState === 'win' ? t('live.won') : t('live.missed')) : pickLabel[pickState]}</span>
          )}
        </div>
      )}

      {odds && !finished && (
        <>
          <div className="section-head"><h3>{t('live.matchresult')}</h3></div>
          <div className="market live-odds-row">
            {(['home', 'draw', 'away'] as OutKey[]).map((k) => (
              <div key={k} className={`outcome ${myLeg?.outcome_key === k ? 'sel' : ''}`}>
                <span className="outcome-name">{k === 'home' ? '1' : k === 'draw' ? 'X' : '2'}</span>
                <span className="outcome-odds">{formatOdds(odds[k] ?? 0)}</span>
                <span className="outcome-prob">{impliedProb(odds[k] ?? 0, oddsArr)}%</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="section-head"><h3>{t('live.keymoments')}</h3></div>
      <div className="card cm-feed">
        {feed.length === 0 && <div className="cm-line"><span className="cm-text muted">{t('live.playersout')}</span></div>}
        {feed.map((l) => (
          <div key={l.key} className={`cm-line ${l.isGoal ? 'cm-goal' : ''} ${l.kind === 'card' ? 'cm-card' : ''}`}>
            <span className="cm-min tnum">{l.minute}&apos;</span>
            <span className="cm-ico">{LINE_ICON[l.kind] ?? '·'}</span>
            <span className="cm-text">{l.text}</span>
          </div>
        ))}
      </div>

      {matchId && <MatchChat matchId={matchId} />}

      <button className="btn btn-ghost btn-block" style={{ marginTop: 'var(--s3)' }} onClick={() => (couponId ? navigate('/coupons') : navigate(-1))}>
        {couponId ? t('mc.title') : t('md.back')}
      </button>
    </div>
  );
}
