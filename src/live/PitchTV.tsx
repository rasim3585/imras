import { useEffect, useRef, useState } from 'react';
import TeamCrest from '../components/TeamCrest';
import { toggleSfx, whistle, cheer } from '../lib/sfx';
import { ballAt, activeEvent, type Side, type SimEvType } from './matchSim';

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

// deterministic little confetti pieces (position %, drift px, delay s, colour)
// — shared with the court trackers (basketball threes, tennis/volley set wins)
const CONF_COLORS = ['#ffd36b', '#4fe89a', '#4aa3e2', '#ff7a7a', '#ffffff'];
export const CONF_PIECES = Array.from({ length: 18 }, (_, i) => ({
  x: (i * 53 + 11) % 100,
  dx: ((i * 37) % 48) - 24,
  d: (i % 6) * 0.08,
  c: CONF_COLORS[i % CONF_COLORS.length],
}));

export function Confetti() {
  return (
    <div className="confetti">
      {CONF_PIECES.map((p, i) => (
        <i key={i} style={{ ['--x' as string]: `${p.x}%`, ['--dx' as string]: `${p.dx}px`, ['--d' as string]: `${p.d}s`, ['--c' as string]: p.c }} />
      ))}
    </div>
  );
}

export default function PitchTV({
  home, away, hs, as, minute, phase, redHome, redAway,
  matchId, dur, getClock, goalPulse, homePlayer, awayPlayer, ht, yellows,
}: {
  home: string; away: string; hs: number; as: number; minute: number;
  phase: 'upcoming' | 'live' | 'finished'; redHome: number; redAway: number;
  matchId: string; dur: number; getClock: () => number; goalPulse: GoalPulse | null;
  homePlayer?: string; awayPlayer?: string;
  ht?: [number, number] | null; yellows?: [number, number];
}) {
  const finished = phase === 'finished';

  const ballRef = useRef<HTMLDivElement | null>(null);
  const trailRef = useRef<HTMLDivElement | null>(null);
  // 0716: saha artık boş değil — 11+11 oyuncu noktası. Diziliş çapası + topa
  // hat-bazlı çekim + kişisel salınım; top gibi rAF'ta ref üzerinden sürülür
  // (render başına state yok, maliyet ~22 style yazımı/frame).
  const playersRef = useRef<(HTMLDivElement | null)[]>([]);
  const playerPos = useRef<[number, number][] | null>(null);
  const [side, setSide] = useState<Side | 'mid'>('mid');
  const [badge, setBadge] = useState<{ type: SimEvType; side: Side } | null>(null);
  const [momentum, setMomentum] = useState('Kick-off');
  const [overlay, setOverlay] = useState<{ kind: 'goal' | 'card'; text: string; sub: string } | null>(null);
  const [flash, setFlash] = useState<'goal' | null>(null);
  const [sound, setSound] = useState(false);

  const prevPhase = useRef(phase);
  const holdUntil = useRef(0);         // real-ms: freeze ball at centre after a goal
  // goal drama: a timed sequence of ball spots (penalty spot → net → centre),
  // each held long enough to read — no rapid ping-pong
  const goalSeq = useRef<{ until: number; x: number; y: number }[]>([]);
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
    // home attacks RIGHT → scores at the right goal. Penalty: ball WAITS on the
    // spot (~2s), then beats the keeper into the net; open play: straight into
    // the net (~2s). Then centre for the kick-off. Each beat is long enough to
    // read — no rapid side-to-side jumps.
    const isHome = goalPulse.team === 'home';
    const net = { x: isHome ? 96 : 4, y: 50 };
    // penalty is taken from the DRAWN penalty spot (11% from the goal line)
    goalSeq.current = goalPulse.penalty
      ? [{ until: now + 2000, x: isHome ? 89 : 11, y: 50 }, { until: now + 3200, ...net }]
      : [{ until: now + 2000, ...net }];
    holdUntil.current = now + (goalPulse.penalty ? 4800 : 3600);
    cheer();
    setFlash('goal');
    setOverlay({ kind: 'goal', text: goalPulse.penalty ? 'PENALTY!' : 'GOAL!', sub: `${goalPulse.team === 'home' ? home : away} ${hs}-${as}` });
    if (ovTimer.current) clearTimeout(ovTimer.current);
    ovTimer.current = window.setTimeout(() => { setOverlay(null); setFlash(null); }, goalPulse.penalty ? 3200 : 2100);
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

  // animation loop: ball + arrow + badge + label ALL come from matchSim on the
  // SAME getClock. When the ball rests on an event spot (activeEvent → clock is
  // inside [sec, sec+holdSec]), ballAt returns that spot AND the badge lights —
  // they are one and the same moment, held for ≈2 real seconds. Goals hold the
  // ball at the net/penalty spot then centre (server-driven, separate).
  // 4-3-3 çapaları (x% y%): GK + 4 + 3 + 3. Deplasman aynalanır (x → 100-x).
  // Hat çekim katsayısı: kaleci neredeyse sabit, forvet topa en çok kayar.
  const FORM: [number, number, number][] = [
    [7, 50, 0.04],
    [20, 18, 0.14], [17, 38, 0.14], [17, 62, 0.14], [20, 82, 0.14],
    [36, 28, 0.24], [34, 50, 0.24], [36, 72, 0.24],
    [56, 22, 0.34], [58, 50, 0.34], [56, 78, 0.34],
  ];

  useEffect(() => {
    // stale goal drama must not leak into another match
    goalSeq.current = []; holdUntil.current = 0;
    if (phase === 'upcoming') { if (ballRef.current) { ballRef.current.style.left = '50%'; ballRef.current.style.top = '50%'; } smooth.current = [50, 50]; return; }
    let raf = 0;
    const teamName = (s: Side) => (s === 'home' ? home : away);

    const step = () => {
      // full-time: the ball rests at the centre spot (the sim path is over; never
      // leave it frozen wherever the last pass happened to end)
      if (finished) {
        const s = smooth.current;
        s[0] += (50 - s[0]) * 0.35; s[1] += (50 - s[1]) * 0.35;
        if (ballRef.current) { ballRef.current.style.left = `${s[0]}%`; ballRef.current.style.top = `${s[1]}%`; }
        if (trailRef.current) { trailRef.current.style.left = `${s[0]}%`; trailRef.current.style.top = `${s[1]}%`; trailRef.current.style.opacity = '0.2'; }
        setSide((v) => (v === 'mid' ? v : 'mid'));
        if (labelRef.current !== 'Full-time') { labelRef.current = 'Full-time'; setMomentum('Full-time'); }
        if (badgeKeyRef.current !== '') { badgeKeyRef.current = ''; setBadge(null); }
        raf = requestAnimationFrame(step);
        return;
      }

      const clock = getClock();
      const seq = goalSeq.current;
      while (seq.length && Date.now() >= seq[0].until) seq.shift();
      const gs = seq.length ? seq[0] : null;
      const goalHeld = Date.now() < holdUntil.current;
      const ev = goalHeld ? null : activeEvent(matchId, clock, dur);

      const b = gs ? { x: gs.x, y: gs.y, team: 'home' as Side, moving: false }
        : goalHeld ? { x: 50, y: 50, team: 'home' as Side, moving: false } : ballAt(matchId, clock, dur);
      const sideNow: Side | 'mid' = goalHeld ? 'mid' : b.team;
      let label: string, bnow: { type: SimEvType; side: Side } | null;
      if (goalHeld) { label = 'Kick-off'; bnow = null; }
      else if (ev) { label = `${EV_LABEL[ev.type]} · ${teamName(ev.team)}`; bnow = { type: ev.type, side: ev.team }; }
      else { label = `▶ ${teamName(b.team)}`; bnow = null; }

      // ease lightly (the sim is already continuous; this just softens pass-to-pass)
      const s = smooth.current;
      s[0] += (b.x - s[0]) * 0.35; s[1] += (b.y - s[1]) * 0.35;
      if (ballRef.current) { ballRef.current.style.left = `${s[0]}%`; ballRef.current.style.top = `${s[1]}%`; }
      if (trailRef.current) { trailRef.current.style.left = `${s[0]}%`; trailRef.current.style.top = `${s[1]}%`; trailRef.current.style.opacity = String(b.moving ? 0.5 : 0.2); }

      // oyuncular: çapa + topa hat-bazlı çekim + kişisel salınım; toptan yavaş
      // ease (0.06) → doğal gecikme hissi
      const now = Date.now();
      if (!playerPos.current) playerPos.current = Array.from({ length: 22 }, (_, i) => {
        const f = FORM[i % 11]; const hx = i < 11 ? f[0] : 100 - f[0];
        return [hx, f[1]] as [number, number];
      });
      for (let i = 0; i < 22; i++) {
        const el = playersRef.current[i]; if (!el) continue;
        const f = FORM[i % 11];
        const ax = i < 11 ? f[0] : 100 - f[0];
        const pull = f[2];
        const tx = ax + (s[0] - ax) * pull + Math.sin(now / 900 + i * 1.7) * 1.6;
        const ty = f[1] + (s[1] - f[1]) * (pull * 0.8) + Math.cos(now / 800 + i * 2.3) * 1.8;
        const pp = playerPos.current[i];
        pp[0] += (tx - pp[0]) * 0.06; pp[1] += (ty - pp[1]) * 0.06;
        el.style.left = `${pp[0]}%`; el.style.top = `${pp[1]}%`;
      }

      setSide((v) => (v === sideNow ? v : sideNow));
      if (label !== labelRef.current) { labelRef.current = label; setMomentum(label); }
      const bk = bnow ? `${bnow.type}:${bnow.side}:${ev?.key}` : '';
      if (bk !== badgeKeyRef.current) { badgeKeyRef.current = bk; setBadge(bnow); }

      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [matchId, dur, phase, finished, getClock, home, away]);

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
          <span className={`sb2-score tnum ${flash === 'goal' ? 'score-shake' : ''}`}>{phase === 'upcoming' ? '– : –' : `${hs}-${as}`}</span>
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
          <div className="pl goalbox goal-l" /><div className="pl goalbox goal-r" />
          <div className="pl pspot l" /><div className="pl pspot r" />
          <div className="pl arc arc-l" /><div className="pl arc arc-r" />
          <div className="pl corner tl" /><div className="pl corner tr" />
          <div className="pl corner bl" /><div className="pl corner br" />
          <div className={`pgoal l ${flash === 'goal' && side === 'away' ? 'net-bulge' : ''}`} />
          <div className={`pgoal r ${flash === 'goal' && side === 'home' ? 'net-bulge' : ''}`} />

          {phase === 'live' && (side === 'home' || side === 'mid') && <div className="arrow home" style={{ ['--ac' as string]: HOME_ARROW }} />}
          {phase === 'live' && (side === 'away' || side === 'mid') && <div className="arrow away" style={{ ['--ac' as string]: AWAY_ARROW }} />}

          {Array.from({ length: 22 }, (_, i) => (
            <div key={i} ref={(el) => { playersRef.current[i] = el; }}
              className={`pitch-player ${i < 11 ? 'ph' : 'pa'} ${i % 11 === 0 ? 'gk' : ''}`}
              style={{ left: i < 11 ? `${FORM[i % 11][0]}%` : `${100 - FORM[i % 11][0]}%`, top: `${FORM[i % 11][1]}%` }} />
          ))}
          <div ref={trailRef} className="pitch-trail" />
          <div ref={ballRef} className="pitch-ball" style={{ left: '50%', top: '50%' }}><span className="pent" /></div>

          {badge && (
            <div className={`pev pev-${badge.type} ${badge.side}`} key={`${badge.type}${badge.side}`}>
              <span className="pev-i">{EV_ICON[badge.type]}</span>
              <span className="pev-t">{EV_LABEL[badge.type]}</span>
            </div>
          )}

          {flash === 'goal' && <Confetti />}

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
