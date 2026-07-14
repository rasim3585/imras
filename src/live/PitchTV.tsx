import { useEffect, useRef, useState } from 'react';
import TeamCrest from '../components/TeamCrest';
import { toggleSfx, whistle, cheer } from '../lib/sfx';
import { ballAt, simEvents, type Side, type SimEvType } from './matchSim';

// ---------------------------------------------------------------------------
// Broadcast-style pitch driven by a real POSSESSION simulation (matchSim): the
// ball moves through passing sequences, one team clearly in possession, attacks
// building toward goal and ending in a shot/save/corner. The ball, the attack
// arrow, the badge and the label all come from the SAME sim at the SAME clock,
// so they can never contradict. Goals + red cards come from the server (fair)
// and interrupt with their own overlay. Home attacks RIGHT.
// ---------------------------------------------------------------------------

const HOME_ARROW = '#4aa3e2';
const AWAY_ARROW = '#e2a04a';

const EV_ICON: Record<SimEvType, string> = {
  shot: '🎯', save: '🧤', miss: '💨', blocked: '🛡', corner: '⛳', freekick: '🎯',
  offside: '🚩', foul: '⚠', yellow: '🟨', throwin: '↩', goalkick: '🥅',
};
const EV_LABEL: Record<SimEvType, string> = {
  shot: 'Shot', save: 'Save!', miss: 'Off target', blocked: 'Blocked', corner: 'Corner',
  freekick: 'Free-kick', offside: 'Offside', foul: 'Foul', yellow: 'Yellow card',
  throwin: 'Throw-in', goalkick: 'Goal kick',
};

export interface GoalPulse { id: number; team: Side; penalty: boolean }

export default function PitchTV({
  home, away, hs, as, minute, phase, redHome, redAway,
  matchId, getClock, goalPulse, homePlayer, awayPlayer, ht, yellows,
}: {
  home: string; away: string; hs: number; as: number; minute: number;
  phase: 'upcoming' | 'live' | 'finished'; redHome: number; redAway: number;
  matchId: string; getClock: () => number; goalPulse: GoalPulse | null;
  homePlayer?: string; awayPlayer?: string;
  ht?: [number, number] | null; yellows?: [number, number];
}) {
  const finished = phase === 'finished';

  const ballRef = useRef<HTMLDivElement | null>(null);
  const trailRef = useRef<HTMLDivElement | null>(null);
  const [side, setSide] = useState<Side | 'mid'>('mid');
  const [badge, setBadge] = useState<{ type: SimEvType; side: Side } | null>(null);
  const [momentum, setMomentum] = useState('Kick-off');
  const [overlay, setOverlay] = useState<{ kind: 'goal' | 'card'; text: string; sub: string } | null>(null);
  const [flash, setFlash] = useState<'goal' | null>(null);
  const [sound, setSound] = useState(false);

  const prevPhase = useRef(phase);
  const holdUntil = useRef(0);         // real-ms: freeze ball at centre after a goal
  // a goal first shows the ball IN the net (or on the penalty spot), THEN centre
  const goalSpot = useRef<{ until: number; x: number; y: number } | null>(null);
  // on-pitch event hold: freeze the ball AT the event spot while its label shows,
  // so ball + label + badge always describe the same moment (no lingering).
  const hold = useRef<{ until: number; x: number; y: number; type: SimEvType; side: Side } | null>(null);
  const labelRef = useRef('');
  const badgeKeyRef = useRef('');
  const smooth = useRef<[number, number]>([50, 50]);   // eased ball pos (kills teleport)
  const ovTimer = useRef<number | null>(null);
  const prevReds = useRef({ h: redHome, a: redAway });

  // kick-off / full-time whistle
  useEffect(() => {
    if (prevPhase.current !== phase) {
      if (prevPhase.current === 'upcoming' && phase === 'live') whistle(false);
      else if (phase === 'finished') whistle(true);
      prevPhase.current = phase;
    }
  }, [phase]);

  // server GOAL → centre-circle hold + cheer + flash + overlay
  useEffect(() => {
    if (!goalPulse) return;
    const now = Date.now();
    // home attacks RIGHT → scores at the right goal; penalties sit on the spot
    const home = goalPulse.team === 'home';
    const gx = goalPulse.penalty ? (home ? 84 : 16) : (home ? 97 : 3);
    goalSpot.current = { until: now + 1600, x: gx, y: 50 };   // ball at goal / penalty spot first…
    holdUntil.current = now + 3400;                            // …then centre for the restart
    cheer();
    setFlash('goal');
    setOverlay({ kind: 'goal', text: goalPulse.penalty ? 'PENALTY!' : 'GOAL!', sub: `${goalPulse.team === 'home' ? home : away} ${hs}-${as}` });
    if (ovTimer.current) clearTimeout(ovTimer.current);
    ovTimer.current = window.setTimeout(() => { setOverlay(null); setFlash(null); }, 2100);
  }, [goalPulse?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // server RED card → overlay
  useEffect(() => {
    const grew = redHome > prevReds.current.h ? 'home' : redAway > prevReds.current.a ? 'away' : null;
    prevReds.current = { h: redHome, a: redAway };
    if (!grew || phase !== 'live') return;
    setOverlay({ kind: 'card', text: 'RED CARD', sub: grew === 'home' ? home : away });
    if (ovTimer.current) clearTimeout(ovTimer.current);
    ovTimer.current = window.setTimeout(() => setOverlay(null), 1900);
  }, [redHome, redAway]); // eslint-disable-line react-hooks/exhaustive-deps

  // how long an event's label/badge lingers (real ms) — matches the ball's ~2.6s
  // pause on the spot so you actually SEE the action taken
  const holdMs = (t: SimEvType) => (t === 'throwin' ? 1400 : 2400);

  // animation loop: the ball comes from the POSSESSION sim (passing sequences);
  // the arrow, badge and label are all derived from the SAME clock, so they
  // always agree. Events light a short label/badge while the ball is naturally
  // at that spot (the shot pass put it there). Goals hold the ball at centre.
  useEffect(() => {
    if (phase === 'upcoming') { if (ballRef.current) { ballRef.current.style.left = '50%'; ballRef.current.style.top = '50%'; } smooth.current = [50, 50]; return; }
    let raf = 0;
    const events = simEvents(matchId, 90);
    const c0 = finished ? 5400 : getClock();
    let idx = events.findIndex((e) => e.sec > c0);           // skip events already in the past (join)
    if (idx < 0) idx = events.length;

    const teamName = (s: Side) => (s === 'home' ? home : away);

    const step = () => {
      const clock = finished ? 5400 : getClock();
      const goalHeld = Date.now() < holdUntil.current;

      // cross into any events we've just passed → light their label/badge briefly
      if (!goalHeld) {
        while (idx < events.length && clock >= events[idx].sec) {
          const e = events[idx];
          hold.current = { until: Date.now() + holdMs(e.type), x: e.x, y: e.y, type: e.type, side: e.team };
          idx++;
        }
      }
      const h = !goalHeld && hold.current && Date.now() < hold.current.until ? hold.current : null;

      const gs = goalSpot.current && Date.now() < goalSpot.current.until ? goalSpot.current : null;
      const b = gs ? { x: gs.x, y: gs.y, team: 'home' as Side, moving: false }
        : goalHeld ? { x: 50, y: 50, team: 'home' as Side, moving: false } : ballAt(matchId, clock);
      const sideNow: Side | 'mid' = goalHeld ? 'mid' : b.team;
      let label: string, bnow: { type: SimEvType; side: Side } | null;
      if (goalHeld) { label = 'Kick-off'; bnow = null; }
      else if (h) { label = `${EV_LABEL[h.type]} · ${teamName(h.side)}`; bnow = { type: h.type, side: h.side }; }
      else { label = `▶ ${teamName(b.team)}`; bnow = null; }

      // ease lightly (the sim is already continuous; this just softens pass-to-pass)
      const s = smooth.current;
      s[0] += (b.x - s[0]) * 0.35; s[1] += (b.y - s[1]) * 0.35;
      if (ballRef.current) { ballRef.current.style.left = `${s[0]}%`; ballRef.current.style.top = `${s[1]}%`; }
      if (trailRef.current) { trailRef.current.style.left = `${s[0]}%`; trailRef.current.style.top = `${s[1]}%`; trailRef.current.style.opacity = String(b.moving ? 0.5 : 0.2); }

      setSide((v) => (v === sideNow ? v : sideNow));
      if (label !== labelRef.current) { labelRef.current = label; setMomentum(label); }
      const bk = bnow ? `${bnow.type}:${bnow.side}:${hold.current?.until}` : '';
      if (bk !== badgeKeyRef.current) { badgeKeyRef.current = bk; setBadge(bnow); }

      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [matchId, phase, finished, getClock, home, away]);

  useEffect(() => () => { if (ovTimer.current) clearTimeout(ovTimer.current); }, []);

  return (
    <div className="pitch-tv">
      <div className="sb2">
        <button className={`sb2-sound ${sound ? 'on' : ''}`} title="Sound on/off" onClick={() => setSound(toggleSfx())}>♪</button>
        <div className="sb2-team">
          <TeamCrest name={home} size={32} className="sb2-badge" />
          <span className="sb2-info"><span className="sb2-name">{home}</span>{homePlayer && <span className="sb2-pl">({homePlayer})</span>}</span>
        </div>
        <div className="sb2-center">
          <span className="sb2-score tnum">{phase === 'upcoming' ? '– : –' : `${hs}-${as}`}</span>
          <span className="sb2-clock tnum">{phase === 'upcoming' ? 'soon' : finished ? 'FT' : <><span className="dot" />{minute}&apos;</>}</span>
          {ht && phase !== 'upcoming' && <span className="sb2-ht tnum">HT {ht[0]}-{ht[1]}</span>}
        </div>
        <div className="sb2-team away">
          <span className="sb2-info"><span className="sb2-name">{away}</span>{awayPlayer && <span className="sb2-pl">({awayPlayer})</span>}</span>
          <TeamCrest name={away} size={32} className="sb2-badge" />
        </div>
      </div>
      {(redHome > 0 || redAway > 0 || (yellows && (yellows[0] > 0 || yellows[1] > 0))) && (
        <div className="sb-sub">
          <span className="sb-cards">
            {yellows && yellows[0] > 0 && <span className="sb-y">🟨{yellows[0]}</span>}
            {redHome > 0 && <span className="sb-r">🟥{redHome}</span>}
          </span>
          <span className="sb-cards-lbl">{home.length > 12 ? `${home.slice(0, 11)}…` : home} · {away.length > 12 ? `${away.slice(0, 11)}…` : away}</span>
          <span className="sb-cards">
            {redAway > 0 && <span className="sb-r">🟥{redAway}</span>}
            {yellows && yellows[1] > 0 && <span className="sb-y">🟨{yellows[1]}</span>}
          </span>
        </div>
      )}

      <div className="tv-bezel">
        <div className={`pitch ${flash === 'goal' ? 'pitch-flash' : ''}`}>
          <div className="pl midline" /><div className="pl circle" /><div className="pl spot" />
          <div className="pl box box-l" /><div className="pl box box-r" />
          <div className="pl arc arc-l" /><div className="pl arc arc-r" />
          <div className={`pgoal l ${flash === 'goal' && side === 'away' ? 'net-bulge' : ''}`} />
          <div className={`pgoal r ${flash === 'goal' && side === 'home' ? 'net-bulge' : ''}`} />

          {phase === 'live' && (side === 'home' || side === 'mid') && <div className="arrow home" style={{ ['--ac' as string]: HOME_ARROW }} />}
          {phase === 'live' && (side === 'away' || side === 'mid') && <div className="arrow away" style={{ ['--ac' as string]: AWAY_ARROW }} />}

          <div ref={trailRef} className="pitch-trail" />
          <div ref={ballRef} className="pitch-ball" style={{ left: '50%', top: '50%' }}><span className="pent" /></div>

          {badge && (
            <div className={`pev pev-${badge.type} ${badge.side}`} key={`${badge.type}${badge.side}`}>
              <span className="pev-i">{EV_ICON[badge.type]}</span>
              <span className="pev-t">{EV_LABEL[badge.type]}</span>
            </div>
          )}

          {phase === 'live' && <div className="momentum">{momentum}</div>}
          {overlay && (
            <div className={`pitch-ov pitch-ov-${overlay.kind}`}>
              <span className="pitch-ov-t">{overlay.text}</span>
              <span className="pitch-ov-s">{overlay.sub}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
