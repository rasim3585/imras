import { useEffect, useRef, useState } from 'react';
import { teamColor, teamInitial } from '../lib/teams';
import { toggleSfx, whistle, cheer } from '../lib/sfx';
import type { LineKind } from './commentary';

// ---------------------------------------------------------------------------
// Arrow-based pitch (NO players). Just the field + one ball + an attack-DIRECTION
// arrow. Everything is derived from the SAME commentary line (team + kind), so
// the arrow, the ball and the goal can never contradict: "home attacking" ->
// blue arrow left->right, ball to the right; "away" -> orange arrow right->left,
// ball left; midfield -> both arrows meet in the centre. Home attacks right.
// Pure visual; score/goals/cards come from the deterministic timeline.
// ---------------------------------------------------------------------------

type Side = 'home' | 'away';
const HOME_ARROW = '#4aa3e2';
const AWAY_ARROW = '#e2a04a';
const MID_KINDS = new Set<LineKind>(['calm', 'mark', 'miss', 'card']);

export default function PitchTV({
  home, away, hs, as, minute, phase, redHome, redAway, line, homePlayer, awayPlayer,
}: {
  home: string; away: string; hs: number; as: number; minute: number;
  phase: 'upcoming' | 'live' | 'finished'; redHome: number; redAway: number;
  flashTeam: 'home' | 'away' | null; homePlayer?: string; awayPlayer?: string;
  line: { kind: LineKind; team?: Side; minute: number; sub: number } | null;
}) {
  const homeColor = teamColor(home);
  const awayColor = teamColor(away);
  const finished = phase === 'finished';

  const [ball, setBall] = useState<[number, number]>([50, 50]);
  const [overlay, setOverlay] = useState<{ kind: 'goal' | 'card'; text: string; sub: string } | null>(null);
  const [sound, setSound] = useState(false);
  const ovTimer = useRef<number | null>(null);
  const prevPhase = useRef(phase);
  const base = useRef<[number, number]>([50, 50]);
  const clampB = (v: number) => Math.max(6, Math.min(94, v));

  // which way is play going? derived from the current line (never independent)
  const side: Side | 'mid' = (!line || line.team == null || phase !== 'live' || MID_KINDS.has(line.kind))
    ? 'mid' : line.team;

  const momentum = (() => {
    if (!line || line.team == null || phase !== 'live') return finished ? 'Full time' : 'Kick-off';
    const t = line.team === 'home' ? home : away;
    switch (line.kind) {
      case 'buildup': return `▶ ${t} building`;
      case 'chance': return `▶ ${t} pressing`;
      case 'shot': return `▶ ${t} shooting`;
      case 'miss': return 'Goal kick';
      case 'foul': case 'freekick': return `Free-kick · ${t}`;
      case 'corner': return `Corner · ${t}`;
      case 'goal': return `GOAL — ${t}!`;
      case 'card': return `${t} down to 10`;
      default: return 'Midfield battle';
    }
  })();

  // match sounds: kick-off / full-time whistle
  useEffect(() => {
    if (prevPhase.current !== phase) {
      if (prevPhase.current === 'upcoming' && phase === 'live') whistle(false);
      else if (phase === 'finished') whistle(true);
      prevPhase.current = phase;
    }
  }, [phase]);

  // enact the line: move the ball to the attacking side, overlays for goal/card
  useEffect(() => {
    if (!line || phase !== 'live' || line.team == null) return;
    const k = line.kind;
    if (k === 'goal') {
      base.current = [50, 50]; setBall([50, 50]);            // straight to the centre (kick-off)
      setOverlay({ kind: 'goal', text: 'GOAL!', sub: `${line.team === 'home' ? home : away} ${hs}-${as}` });
      cheer();
      if (ovTimer.current) clearTimeout(ovTimer.current);
      ovTimer.current = window.setTimeout(() => setOverlay(null), 1900);
      return;
    }
    if (k === 'card') {
      setOverlay({ kind: 'card', text: 'RED CARD', sub: line.team === 'home' ? home : away });
      if (ovTimer.current) clearTimeout(ovTimer.current);
      ovTimer.current = window.setTimeout(() => setOverlay(null), 1700);
    }
    const s: Side | 'mid' = MID_KINDS.has(k) ? 'mid' : line.team;
    base.current = s === 'home' ? [70, 48] : s === 'away' ? [30, 52] : [50, 50];
    setBall(base.current);
  }, [line?.minute, line?.sub, line?.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  // gentle idle drift around the current side so the ball is never frozen
  useEffect(() => {
    if (phase !== 'live') return;
    const id = window.setInterval(() => {
      const [bx, by] = base.current;
      setBall([clampB(bx + (Math.random() - 0.5) * 12), clampB(by + (Math.random() - 0.5) * 14)]);
    }, 2400);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => () => { if (ovTimer.current) clearTimeout(ovTimer.current); }, []);

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
          <span className="sb2-clock tnum">{phase === 'upcoming' ? 'soon' : finished ? 'FT' : <><span className="dot" />{minute}&apos;</>}</span>
        </div>
        <div className="sb2-team away">
          <span className="sb2-info"><span className="sb2-name">{away}</span>{awayPlayer && <span className="sb2-pl">({awayPlayer})</span>}</span>
          <span className="sb2-badge" style={{ background: awayColor }}>{teamInitial(away)}</span>
        </div>
      </div>
      {(redHome > 0 || redAway > 0) && (
        <div className="sb-sub">
          {redHome > 0 && <span className="sb-red">● {home} down to 10</span>}
          {redAway > 0 && <span className="sb-red">● {away} down to 10</span>}
        </div>
      )}

      <div className="tv-bezel">
        <div className={`pitch ${overlay?.kind === 'goal' ? 'pitch-flash' : ''}`}>
          <div className="pl midline" /><div className="pl circle" /><div className="pl spot" />
          <div className="pl box box-l" /><div className="pl box box-r" />
          <div className="pgoal l" /><div className="pgoal r" />

          {phase === 'live' && (side === 'home' || side === 'mid') && <div className="arrow home" style={{ ['--ac' as string]: HOME_ARROW }} />}
          {phase === 'live' && (side === 'away' || side === 'mid') && <div className="arrow away" style={{ ['--ac' as string]: AWAY_ARROW }} />}

          <div className="pitch-ball" style={{ left: `${ball[0]}%`, top: `${ball[1]}%` }}><span className="pent" /></div>

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
