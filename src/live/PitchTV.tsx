import { useEffect, useRef, useState } from 'react';
import TeamCrest from '../components/TeamCrest';
import { toggleSfx, whistle, cheer } from '../lib/sfx';
import { flowAt, ambientEvents, type Side, type EvType } from './liveSim';

// ---------------------------------------------------------------------------
// Broadcast-style pitch. The ball is animated every frame from flowAt(matchId,
// clock) — the SAME deterministic simulation that drives the commentary — so the
// ball, the attack arrow, the event badges and the text can never contradict.
// Home attacks RIGHT. Goals + red cards come from the server (via `goalPulse` /
// red counts) and get their own overlay on top. No random drift anywhere.
// ---------------------------------------------------------------------------

const HOME_ARROW = '#4aa3e2';
const AWAY_ARROW = '#e2a04a';

const EV_ICON: Record<EvType, string> = {
  shot: '🎯', save: '🧤', miss: '💨', blocked: '🛡', corner: '⛳', freekick: '🎯',
  offside: '🚩', foul: '⚠', yellow: '🟨', sub: '🔁', goal: '⚽', red: '🟥',
};
const EV_LABEL: Record<EvType, string> = {
  shot: 'Shot', save: 'Save!', miss: 'Off target', blocked: 'Blocked', corner: 'Corner',
  freekick: 'Free-kick', offside: 'Offside', foul: 'Foul', yellow: 'Yellow card',
  sub: 'Sub', goal: 'GOAL', red: 'Red card',
};

export interface GoalPulse { id: number; team: Side; penalty: boolean }

export default function PitchTV({
  home, away, hs, as, minute, phase, redHome, redAway,
  matchId, getClock, goalPulse, homePlayer, awayPlayer,
}: {
  home: string; away: string; hs: number; as: number; minute: number;
  phase: 'upcoming' | 'live' | 'finished'; redHome: number; redAway: number;
  matchId: string; getClock: () => number; goalPulse: GoalPulse | null;
  homePlayer?: string; awayPlayer?: string;
}) {
  const finished = phase === 'finished';

  const ballRef = useRef<HTMLDivElement | null>(null);
  const trailRef = useRef<HTMLDivElement | null>(null);
  const [side, setSide] = useState<Side | 'mid'>('mid');
  const [badge, setBadge] = useState<{ type: EvType; side: Side; at: number } | null>(null);
  const [overlay, setOverlay] = useState<{ kind: 'goal' | 'card'; text: string; sub: string } | null>(null);
  const [flash, setFlash] = useState<'goal' | null>(null);
  const [sound, setSound] = useState(false);

  const prevPhase = useRef(phase);
  const holdUntil = useRef(0);         // real-ms: freeze ball at centre after a goal
  const shownBadge = useRef<string>('');
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
    holdUntil.current = Date.now() + 2200;
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

  // animation loop: drive the ball + arrows + event badges off the simulation
  useEffect(() => {
    if (phase === 'upcoming') { if (ballRef.current) { ballRef.current.style.left = '50%'; ballRef.current.style.top = '50%'; } return; }
    let raf = 0;
    const events = ambientEvents(matchId, 90);
    const step = () => {
      const clock = finished ? 5400 : getClock();
      const held = Date.now() < holdUntil.current;
      const flow = held ? { x: 50, y: 50, side: 'mid' as const, intensity: 0.2 } : flowAt(matchId, clock);
      if (ballRef.current) { ballRef.current.style.left = `${flow.x}%`; ballRef.current.style.top = `${flow.y}%`; }
      if (trailRef.current) { trailRef.current.style.left = `${flow.x}%`; trailRef.current.style.top = `${flow.y}%`; trailRef.current.style.opacity = String(0.15 + flow.intensity * 0.35); }
      setSide((s) => (s === flow.side ? s : flow.side));

      // nearest ambient event within a short window → floating badge
      if (!held) {
        const near = events.find((e) => Math.abs(e.sec - clock) < 1.4);
        const key = near ? near.key : '';
        if (key && key !== shownBadge.current) {
          shownBadge.current = key;
          setBadge({ type: near!.type, side: near!.side, at: Date.now() });
        }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [matchId, phase, finished, getClock]);

  // auto-clear the small badge
  useEffect(() => {
    if (!badge) return;
    const id = window.setTimeout(() => setBadge((b) => (b && b.at === badge.at ? null : b)), 2600);
    return () => clearTimeout(id);
  }, [badge]);

  useEffect(() => () => { if (ovTimer.current) clearTimeout(ovTimer.current); }, []);

  const momentum = (() => {
    if (phase === 'upcoming') return 'Kick-off soon';
    if (finished) return 'Full time';
    if (badge && Date.now() - badge.at < 2000) return `${EV_LABEL[badge.type]} · ${badge.side === 'home' ? home : away}`;
    if (side === 'mid') return 'Midfield battle';
    return `▶ ${side === 'home' ? home : away} attacking`;
  })();

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
        </div>
        <div className="sb2-team away">
          <span className="sb2-info"><span className="sb2-name">{away}</span>{awayPlayer && <span className="sb2-pl">({awayPlayer})</span>}</span>
          <TeamCrest name={away} size={32} className="sb2-badge" />
        </div>
      </div>
      {(redHome > 0 || redAway > 0) && (
        <div className="sb-sub">
          {redHome > 0 && <span className="sb-red">🟥 {home} · {redHome}</span>}
          {redAway > 0 && <span className="sb-red">🟥 {away} · {redAway}</span>}
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
            <div className={`pev pev-${badge.type} ${badge.side}`} key={badge.at}>
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
