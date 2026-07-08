import { useEffect, useRef, useState } from 'react';
import { teamColor, teamInitial } from '../lib/teams';
import { toggleSfx, whistle, cheer } from '../lib/sfx';
import type { LineKind } from './commentary';

// ---------------------------------------------------------------------------
// Scoreboard-first LIGHT model (industry "good enough": 1X2Gaming / Golden Race
// retail style). NO per-player AI, NO physics -- a bettor mostly reads the
// result. Layers: (1) a clear scoreboard = the match truth (score/minute/cards
// from the deterministic timeline), (2) a light pitch with a few ambient dots
// and ONE ball that softly indicates where play is, (3) event overlays
// (goal / red card) + a momentum strip, (4) the CM commentary feed (elsewhere).
// Pure visual; score/goals/cards stay server-authoritative.
// ---------------------------------------------------------------------------

type XY = [number, number];
type Side = 'home' | 'away';
const clamp = (v: number, lo = 6, hi = 94) => Math.max(lo, Math.min(hi, v));

// 3 ambient dots per side (not a full team, just "players are here")
const HOME_DOTS: XY[] = [[22, 42], [38, 56], [46, 44]];
const AWAY_DOTS: XY[] = [[78, 42], [62, 56], [54, 44]];
const mir = (F: XY[]): XY[] => F.map(([x, y]) => [100 - x, y]);

type C3 = [number, number, number];
const hx = (h: string): C3 => { let s = h.replace('#', ''); if (s.length === 3) s = s.split('').map((c) => c + c).join(''); return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)]; };
const toHex = (c: C3) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const mixc = (a: C3, b: C3, t: number): C3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const cdist = (a: C3, b: C3) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
const clum = (c: C3) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
function distinctAway(homeHex: string, awayHex: string): string {
  const h = hx(homeHex), a = hx(awayHex);
  if (cdist(h, a) > 112) return awayHex;
  return clum(h) < 128 ? toHex(mixc(a, [255, 255, 255], 0.6)) : toHex(mixc(a, [12, 22, 44], 0.62));
}

const PS = [{ s: '▲', c: '#4fe89a' }, { s: '✕', c: '#e24b4a' }, { s: '●', c: '#4aa3e2' }, { s: '■', c: '#d4537e' }];
function Rail() { return <div className="ps-rail" aria-hidden="true">{PS.map((p, i) => <span key={i} className="ps-sym" style={{ color: p.c, animationDelay: `${i * 0.4}s` }}>{p.s}</span>)}</div>; }

export default function PitchTV({
  home, away, hs, as, minute, phase, redHome, redAway, line, homePlayer, awayPlayer,
}: {
  home: string; away: string; hs: number; as: number; minute: number;
  phase: 'upcoming' | 'live' | 'finished'; redHome: number; redAway: number;
  flashTeam: 'home' | 'away' | null; homePlayer?: string; awayPlayer?: string;
  line: { kind: LineKind; team?: Side; minute: number; sub: number } | null;
}) {
  const homeColor = teamColor(home);
  const awayColor = distinctAway(homeColor, teamColor(away));
  const finished = phase === 'finished';
  const secondHalf = minute >= 45;

  const [ball, setBall] = useState<XY>([50, 50]);
  const [momentum, setMomentum] = useState<string>('Kick-off');
  const [overlay, setOverlay] = useState<{ kind: 'goal' | 'card'; text: string; sub: string } | null>(null);
  const [sound, setSound] = useState(false);
  const zoneRef = useRef<XY>([50, 50]);
  const ovTimer = useRef<number | null>(null);
  const prevPhase = useRef(phase);

  // match sounds: kick-off / full-time whistle (goal cheer fires on the goal line)
  useEffect(() => {
    if (prevPhase.current !== phase) {
      if (prevPhase.current === 'upcoming' && phase === 'live') whistle(false);
      else if (phase === 'finished') whistle(true);
      prevPhase.current = phase;
    }
  }, [phase]);

  // home attacks right in the 1st half, left in the 2nd
  const dir = (t: Side) => ((t === 'home') !== secondHalf ? 1 : -1);

  // move the ball to a sensible zone for the current line (a soft indicator)
  useEffect(() => {
    if (!line || line.team == null) return;
    const t = line.team; const d = dir(t); const teamName = t === 'home' ? home : away;
    const boxX = d > 0 ? 82 : 18; const top = line.minute % 2 === 0;
    let zone: XY = [50, 50]; let mo = momentum;

    switch (line.kind) {
      case 'calm': case 'mark': zone = [clamp(50 + d * 4, 38, 62), top ? 44 : 56]; mo = 'Midfield battle'; break;
      case 'buildup': zone = [d > 0 ? 62 : 38, top ? 42 : 58]; mo = `▶ ${teamName} building`; break;
      case 'chance': zone = [clamp(boxX - d * 6), top ? 44 : 56]; mo = `▶ ${teamName} pressing`; break;
      case 'shot': zone = [boxX, 50]; mo = `▶ ${teamName} shooting`; break;
      case 'miss': zone = [d > 0 ? 20 : 80, 50]; mo = 'Goal kick'; break;
      case 'foul': zone = [clamp(50 + d * 8, 24, 76), top ? 40 : 60]; mo = `Free-kick ${teamName}`; break;
      case 'freekick': zone = [clamp(boxX - d * 8), top ? 42 : 58]; mo = `Free-kick ${teamName}`; break;
      case 'corner': zone = [d > 0 ? 94 : 6, top ? 12 : 88]; mo = `Corner ${teamName}`; break;
      case 'card':
        mo = `${teamName} down to 10`;
        setOverlay({ kind: 'card', text: 'RED CARD', sub: teamName });
        if (ovTimer.current) clearTimeout(ovTimer.current);
        ovTimer.current = window.setTimeout(() => setOverlay(null), 1700);
        break;
      case 'goal':
        zone = [50, 50]; mo = `GOAL — ${teamName}!`;         // back to the centre for the restart
        setOverlay({ kind: 'goal', text: 'GOAL!', sub: `${teamName} ${hs}-${as}` });
        cheer();
        if (ovTimer.current) clearTimeout(ovTimer.current);
        ovTimer.current = window.setTimeout(() => setOverlay(null), 1900);
        break;
    }
    zoneRef.current = zone;
    setBall(zone);
    setMomentum(mo);
  }, [line?.minute, line?.sub, line?.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  // gentle idle drift within the current zone (no teleport, soft transition)
  useEffect(() => {
    if (phase !== 'live') return;
    const id = window.setInterval(() => {
      const z = zoneRef.current;
      setBall([clamp(z[0] + (Math.random() - 0.5) * 10, 8, 92), clamp(z[1] + (Math.random() - 0.5) * 10, 8, 92)]);
    }, 1900);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => () => { if (ovTimer.current) clearTimeout(ovTimer.current); }, []);

  const HD = secondHalf ? mir(HOME_DOTS) : HOME_DOTS;
  const AD = secondHalf ? mir(AWAY_DOTS) : AWAY_DOTS;
  const redLine = redHome > 0 || redAway > 0;

  return (
    <div className="pitch-tv">
      <div className="sb2">
        <button className={`sb2-sound ${sound ? 'on' : ''}`} title="Sound on/off" onClick={() => setSound(toggleSfx())}>♪</button>
        <div className="sb2-team">
          <span className="sb2-badge" style={{ background: homeColor }}>{teamInitial(home)}</span>
          <span className="sb2-info"><span className="sb2-name">{home}</span>{homePlayer && <span className="sb2-pl">({homePlayer})</span>}</span>
        </div>
        <div className="sb2-center">
          <span className="sb2-score tnum">{phase === 'upcoming' ? '– : –' : `${hs}-${as}`}</span>
          <span className="sb2-clock tnum">{phase === 'upcoming' ? 'soon' : finished ? "FT" : <><span className="dot" />{minute}&apos;</>}</span>
        </div>
        <div className="sb2-team away">
          <span className="sb2-info"><span className="sb2-name">{away}</span>{awayPlayer && <span className="sb2-pl">({awayPlayer})</span>}</span>
          <span className="sb2-badge" style={{ background: awayColor }}>{teamInitial(away)}</span>
        </div>
      </div>
      {redLine && (
        <div className="sb-sub">
          {redHome > 0 && <span className="sb-red">● {home} down to 10</span>}
          {redAway > 0 && <span className="sb-red">● {away} down to 10</span>}
        </div>
      )}

      <div className="tv-bezel">
        <div className="pitch-area">
          <Rail />
          <div className={`pitch ${overlay?.kind === 'goal' ? 'pitch-flash' : ''}`}>
            <div className="pl midline" /><div className="pl circle" /><div className="pl spot" />
            <div className="pl box box-l" /><div className="pl box box-r" />
            <div className="pl goalbox goal-l" /><div className="pl goalbox goal-r" />
            {HD.map((p, i) => <span key={`h${i}`} className="dot" style={{ left: `${p[0]}%`, top: `${p[1]}%`, background: homeColor, animationDelay: `${i * 0.5}s` }} />)}
            {AD.map((p, i) => <span key={`a${i}`} className="dot" style={{ left: `${p[0]}%`, top: `${p[1]}%`, background: awayColor, animationDelay: `${i * 0.5 + 0.3}s` }} />)}
            <div className="pitch-ball" style={{ left: `${ball[0]}%`, top: `${ball[1]}%` }} />
            {overlay && (
              <div className={`pitch-ov pitch-ov-${overlay.kind}`}>
                <span className="pitch-ov-t">{overlay.text}</span>
                <span className="pitch-ov-s">{overlay.sub}</span>
              </div>
            )}
          </div>
          <Rail />
        </div>
      </div>

      {phase === 'live' && <div className="momentum">{momentum}</div>}
    </div>
  );
}
