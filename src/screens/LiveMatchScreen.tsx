import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveMatch } from '../live/useLiveMatch';
import {
  simLines, goalBurst, goalHistoryLine, cardLine, type Line,
} from '../live/commentary';
import { isPenaltyGoal } from '../live/liveModel';
import { simStats } from '../live/matchSim';
import PitchTV, { type GoalPulse } from '../live/PitchTV';
import MatchChat from '../live/ChatPanel';
import FormStrip from '../live/FormStrip';
import { matchProvider } from '../lib/matchProvider';
import { useI18n } from '../i18n/LanguageContext';
import type { CouponLeg, LiveState } from '../lib/types';
import { formatOdds, impliedProb } from '../lib/format';
import { legLiveStatus } from '../lib/legStatus';
import { teamColor } from '../lib/teams';
import { playerName } from '../lib/playerNames';

type OutKey = 'home' | 'draw' | 'away';

const LINE_ICON: Record<string, string> = {
  goal: '⚽', shot: '🎯', save: '🧤', miss: '💨', blocked: '🛡', corner: '⛳',
  freekick: '🎯', offside: '🚩', foul: '⚠', yellow: '🟨', goalkick: '🥅', card: '🟥', sub: '🔁',
  buildup: '▶', calm: '·', mark: '·',
};

// Nesine-style live stats strip: possession bar + a compact row per metric.
function StatsPanel({ matchId, clockSec, reds, home, away, dur }: {
  matchId: string; clockSec: number; reds: [number, number]; home: string; away: string; dur: number;
}) {
  const { t } = useI18n();
  const s = simStats(matchId, clockSec, reds, dur);
  const [ph, pa] = s.possession;
  const rows: [string, [number, number]][] = [
    [t('live.shots'), s.shots], [t('live.ontarget'), s.onTarget], [t('live.corners'), s.corners],
    [t('live.fouls'), s.fouls], [t('live.yellow'), s.yellows], [t('live.red'), s.reds],
  ];
  const Bar = ({ label, l, r }: { label: string; l: number; r: number }) => {
    const tot = l + r;
    // 0-0 satırda bar BOŞ kalır — yarı dolu çizmek veri varmış yanılsaması veriyordu
    const lp = tot === 0 ? 0 : Math.round((100 * l) / tot);
    const rp = tot === 0 ? 0 : 100 - lp;
    return (
      <div className="lst-row">
        <span className="lst-l tnum">{l}</span>
        <div className="lst-mid">
          <span className="lst-k">{label}</span>
          <div className="lst-bar"><div className="lst-h" style={{ width: `${lp}%` }} /><div className="lst-a" style={{ width: `${rp}%` }} /></div>
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

// 0715: bahis durumu artık TÜM market tipleri için doğru — legLiveStatus tüm
// futbol anahtarlarını çözer (BTTS/alt-üst/çifte şans dahil); eski 1X2-varsayan
// computePickState BTTS-Yes'i 1-1'de "kaçtı" gösteriyordu.

const secOf = (l: Line) => l.sec ?? l.minute * 60;

// Full set of commentary lines revealed by the match CLOCK (seconds). The ambient
// sim lines are gated on the exact same second the pitch animates them, so the
// feed's newest line always matches what the ball is doing on the pitch. Goals +
// cards come from the server and reveal on their minute.
function revealedLines(matchId: string, st: LiveState, clockSec: number, atmo: Line[], baselineGoals: number): Line[] {
  const home = st.home_team, away = st.away_team;
  // ambient sim lines gate on the exact match-second (same clock as the pitch);
  // goals + cards are already minute-gated server-side (st.events only holds
  // goals revealed so far), so they pass straight through.
  const out: Line[] = atmo.filter((l) => secOf(l) <= clockSec);
  let h = 0, a = 0;
  st.events.forEach((g, i) => {
    if (g.team === 'home') h++; else a++;
    const tName = g.team === 'home' ? home : away;
    if (i < baselineGoals) out.push(goalHistoryLine(g.minute, g.team, tName, h, a));
    else out.push(...goalBurst(matchId, g.minute, g.team, home, away, h, a, isPenaltyGoal(matchId, g.minute)));
  });
  for (const c of st.cards) out.push(cardLine(c.minute, c.team, c.team === 'home' ? home : away));
  return out.sort((x, y) => secOf(x) - secOf(y) || x.sub - y.sub);
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
  const getClockRef = useRef(getClock);
  stateRef.current = state;
  minuteRef.current = minute;
  getClockRef.current = getClock;

  const enqueued = useRef<Set<string>>(new Set());
  const queue = useRef<Line[]>([]);
  const feedRef = useRef<Line[]>([]);
  const seeded = useRef(false);
  const baselineGoals = useRef(0);

  // switching to another match without an unmount: the ambient keys (e0, e1, …)
  // repeat per match, so everything must reset or the new match's lines would be
  // swallowed and old ones would linger
  useEffect(() => {
    seeded.current = false;
    enqueued.current.clear();
    queue.current = [];
    feedRef.current = [];
    baselineGoals.current = 0;
    setFeed([]);
    setScore({ h: 0, a: 0 });
    setGoalPulse(null);
    setFlash(null);
  }, [matchId]);
  const atmo = useMemo(() => (state ? simLines(matchId!, state.home_team, state.away_team, state.duration_secs) : []), [matchId, state?.home_team, state?.duration_secs]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // commentary ticker: ambient sim lines drop the instant the pitch reaches them
  // (same match-second clock), so the feed and the ball never diverge. Only the
  // goal build-up (buildup→shot→GOAL) still drips beat-by-beat for drama.
  useEffect(() => {
    if (!matchId) return;
    const isBurst = (l: Line) => l.kind === 'buildup' || l.kind === 'shot' || !!l.isGoal;
    const id = setInterval(() => {
      const st = stateRef.current;
      if (!st) return;
      // finished: the anim clock may never have been anchored (joined after FT) —
      // reveal everything; otherwise use the same clock the pitch animates on
      const clockSec = st.phase === 'finished' ? 5400 : getClockRef.current();

      if (!seeded.current) {
        // join: everything so far is history — show at once, no burst/flash.
        // baseline FIRST, so pre-join goals render as single history lines, not
        // as three-beat dramas
        baselineGoals.current = st.events.length;
        const lines = revealedLines(matchId, st, clockSec, atmo, baselineGoals.current);
        lines.forEach((l) => enqueued.current.add(l.key));
        feedRef.current = [...lines].reverse().slice(0, 60);
        setFeed(feedRef.current);
        setScore({ h: st.home_score, a: st.away_score });
        seeded.current = true;
        return;
      }

      const lines = revealedLines(matchId, st, clockSec, atmo, baselineGoals.current);

      const fresh = lines.filter((l) => !enqueued.current.has(l.key));
      if (fresh.length) {
        fresh.forEach((l) => enqueued.current.add(l.key));
        // ambient events + cards appear immediately, in chronological order, so
        // the top feed line matches the badge the pitch is holding right now
        const now = fresh.filter((l) => !isBurst(l)).sort((x, y) => secOf(x) - secOf(y) || x.sub - y.sub);
        if (now.length) {
          feedRef.current = [...now.reverse(), ...feedRef.current].slice(0, 60);
          setFeed(feedRef.current);
        }
        const burst = fresh.filter(isBurst);
        if (burst.length) {
          queue.current.push(...burst);
          queue.current.sort((x, y) => x.minute - y.minute || x.sub - y.sub);
        }
      }

      // on full time, flush the goal drama so the feed doesn't lag behind
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
  // stats run on the SAME clock as the pitch (match-seconds), so a corner counts
  // the moment the ball reaches the flag — not up to a minute early/late
  const clockSec = finished ? 5400 : Math.floor(getClock());
  const liveStats = phase !== 'upcoming' ? simStats(matchId!, clockSec, [state.red_home, state.red_away], state.duration_secs) : null;

  // İY golleri her zaman (ht_* bacakları için); legLiveStatus bilinmeyen
  // anahtarda 'pending' döner → bayrak gizlenir. Maç bittiyse sunucunun
  // KESİNLEŞMİŞ bacak durumu esastır (won/lost), canlı tahmin değil.
  const htHAll = state.events.filter((e) => e.team === 'home' && e.minute <= 45).length;
  const htAAll = state.events.filter((e) => e.team === 'away' && e.minute <= 45).length;
  const liveLeg = myLeg ? legLiveStatus(myLeg.outcome_key, hs, as, htHAll, htAAll) : 'pending';
  const settled = myLeg && myLeg.status !== 'pending';
  const pickState: 'win' | 'lose' | 'level' | null =
    settled ? (myLeg!.status === 'won' ? 'win' : 'lose')
      : liveLeg === 'pending' ? null : liveLeg;
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
        matchId={matchId!} dur={state.duration_secs} getClock={getClock} goalPulse={goalPulse}
        homePlayer={playerName(matchId + 'h')} awayPlayer={playerName(matchId + 'a')}
        ht={ht} yellows={liveStats?.yellows}
      />

      {phase !== 'upcoming' && matchId && (
        <StatsPanel matchId={matchId} clockSec={clockSec} reds={[state.red_home, state.red_away]} home={home} away={away} dur={state.duration_secs} />
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

      {matchId && <FormStrip matchId={matchId} home={home} away={away} />}

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
