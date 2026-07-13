import { useEffect, useState } from 'react';
import { useLiveMultiplier, type FlightAnchor } from './useAviator';
import type { AviatorStatus } from '../lib/aviator';
import { multClass } from '../lib/aviator';
import { useI18n } from '../i18n/LanguageContext';

// Football-themed crash visual (v1, pure SVG -- no assets yet).
//   betting  -> ball rests; a footballer runs up and the kick lands exactly as
//               the betting window closes (kickoff = flight start).
//   flying   -> ball rides a rising curve with an air/contrail wake behind it;
//               the big multiplier climbs.
//   crashed  -> number freezes at crash_point, ball is booted off-screen.
// Detailed character art / Lottie polish comes later.

const W = 360, H = 240, PAD = 26;
const BASE_X = PAD, BASE_Y = H - PAD;         // ball resting point (kick spot)
const DISPLAY_CAP = 10;                        // ball position saturates at 10x

function progress(m: number): number {
  return Math.min(1, Math.max(0, Math.log(m) / Math.log(DISPLAY_CAP)));
}
function ballXY(p: number): { x: number; y: number } {
  const x = PAD + p * (W - 2 * PAD);
  const climb = (H - 2 * PAD) * Math.pow(p, 1.7);
  return { x, y: H - PAD - climb };
}
function trailPts(p: number): { x: number; y: number }[] {
  const out = [];
  const n = 24;
  for (let i = 0; i <= n; i++) out.push(ballXY((i / n) * p));
  return out;
}
function toPath(pts: { x: number; y: number }[]): string {
  return pts.map((q, i) => `${i === 0 ? 'M' : 'L'}${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join(' ');
}

// velocity direction of the takeoff curve at p -> the ball leans/stretches along it
function tangentDeg(p: number): number {
  const dxdp = W - 2 * PAD;
  const dydp = -(H - 2 * PAD) * 1.7 * Math.pow(Math.max(p, 1e-4), 0.7);
  return (Math.atan2(dydp, dxdp) * 180) / Math.PI;
}

// a tapered "flame" wake: a filled ribbon that is wide+bright at the ball (head)
// and narrows to nothing at the tail, offset perpendicular to the local tangent.
function flamePolygon(pts: { x: number; y: number }[], maxW: number): string {
  if (pts.length < 2) return '';
  const top: string[] = [], bot: string[] = [];
  for (let i = 0; i < pts.length; i++) {
    const u = i / (pts.length - 1);                 // 0 tail .. 1 head(ball)
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let tx = b.x - a.x, ty = b.y - a.y;
    const len = Math.hypot(tx, ty) || 1; tx /= len; ty /= len;
    const nx = -ty, ny = tx;                          // perpendicular
    const w = (maxW * (0.12 + 0.88 * u)) / 2;
    top.push(`${(pts[i].x + nx * w).toFixed(1)} ${(pts[i].y + ny * w).toFixed(1)}`);
    bot.push(`${(pts[i].x - nx * w).toFixed(1)} ${(pts[i].y - ny * w).toFixed(1)}`);
  }
  return `M${top.join(' L')} L${bot.reverse().join(' L')} Z`;
}

// brand-free football that squashes+stretches along its flight (Tsubasa power-shot
// feel) and spins while airborne. `stretch` 0..~0.5, `angle` = velocity direction.
function Ball({ gone, stretch, angle, spinning }: { gone: boolean; stretch: number; angle: number; spinning: boolean }) {
  const sx = (1 + stretch).toFixed(3), sy = (1 - stretch * 0.62).toFixed(3);
  return (
    <g className={gone ? 'av-ball av-ball-gone' : 'av-ball'}>
      <g transform={`rotate(${angle.toFixed(1)}) scale(${sx} ${sy})`}>
        <ellipse rx="13.5" ry="13.5" fill="url(#avBallFill)" stroke="#0d1b12" strokeWidth="1.4" />
        <g className={spinning ? 'av-ball-spin' : ''}>
          <polygon points="0,-6.5 6.2,-2 3.8,5.4 -3.8,5.4 -6.2,-2" fill="#14261b" />
          <g stroke="#14261b" strokeWidth="1.2" strokeLinecap="round">
            <line x1="0" y1="-6.5" x2="0" y2="-12" /><line x1="6.2" y1="-2" x2="11" y2="-4.4" />
            <line x1="3.8" y1="5.4" x2="6.5" y2="10.5" /><line x1="-3.8" y1="5.4" x2="-6.5" y2="10.5" />
            <line x1="-6.2" y1="-2" x2="-11" y2="-4.4" />
          </g>
        </g>
        <ellipse cx="-4" cy="-4.5" rx="4" ry="3" fill="#ffffff" opacity="0.55" />
      </g>
    </g>
  );
}

// brand-free footballer silhouette; feet at (0,0). Runs in + kicks (CSS anim).
function Footballer({ windowMs, restartKey }: { windowMs: number; restartKey: string }) {
  return (
    <g key={restartKey} className="av-fig" style={{ animationDuration: `${windowMs}ms` }}>
      <circle cx="0" cy="-23" r="3.6" fill="#0b1610" />
      <g stroke="#0b1610" strokeWidth="3" strokeLinecap="round" fill="none">
        <line x1="0" y1="-19" x2="1" y2="-8" />          {/* torso */}
        <line x1="0" y1="-16" x2="7" y2="-14" />         {/* kicking arm */}
        <line x1="0" y1="-16" x2="-5" y2="-12" />        {/* back arm */}
        <line x1="1" y1="-8" x2="-5" y2="0" />           {/* plant leg */}
        <line x1="1" y1="-8" x2="9" y2="-5" className="av-fig-kick" /> {/* kicking leg */}
      </g>
    </g>
  );
}

export default function PitchCurve({
  phase, anchor, crashMultiplier, cap, bettingEndsAtMs, bettingMs,
}: {
  phase: AviatorStatus | undefined;
  anchor: FlightAnchor | null;
  crashMultiplier: number | null;
  cap: number;
  bettingEndsAtMs: number | null;
  bettingMs: number;
}) {
  const m = useLiveMultiplier(phase, anchor, crashMultiplier, cap);
  const flying = phase === 'flying';
  const crashed = phase === 'crashed';
  const betting = phase === 'betting';
  const p = progress(crashed && crashMultiplier != null ? crashMultiplier : m);
  const pts = trailPts(p);
  const { x, y } = ballXY(p);
  // ball deformation: lean along the velocity direction, squash-stretch grows with speed
  const angleDeg = flying || crashed ? tangentDeg(p) : 0;
  const stretch = flying ? Math.min(0.5, 0.16 + 0.44 * p) : 0;
  const rad = (angleDeg * Math.PI) / 180;
  const ux = Math.cos(rad), uy = Math.sin(rad);   // unit tangent (for trailing sparks)

  const bigClass = crashed ? `av-mult ${crashMultiplier != null ? multClass(crashMultiplier) : ''}`
    : flying ? 'av-mult av-mult-fly' : 'av-mult av-mult-idle';

  return (
    <div className={`av-stage ${crashed ? 'is-crashed' : ''} ${flying ? 'is-flying' : ''}`}>
      <svg viewBox={`0 0 ${W} ${H}`} className="av-svg" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <defs>
          <linearGradient id="avPitch" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#12321f" /><stop offset="1" stopColor="#0a1a11" />
          </linearGradient>
          {/* flame wake: transparent at the tail (bottom-left) -> hot at the head (top-right) */}
          <linearGradient id="avFlame" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#ff7a18" stopOpacity="0" />
            <stop offset="0.55" stopColor="#ff9d2f" stopOpacity="0.35" />
            <stop offset="0.85" stopColor="#ffd36b" stopOpacity="0.7" />
            <stop offset="1" stopColor="#fff6d8" stopOpacity="0.95" />
          </linearGradient>
          <radialGradient id="avBallFill" cx="0.38" cy="0.34" r="0.75">
            <stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#c9d6cf" />
          </radialGradient>
          <filter id="avGlow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="3.6" />
          </filter>
        </defs>
        <rect x="0" y="0" width={W} height={H} fill="url(#avPitch)" />
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={PAD} y1={H - PAD - f * (H - 2 * PAD)} x2={W - PAD} y2={H - PAD - f * (H - 2 * PAD)}
            stroke="#ffffff" strokeOpacity="0.05" strokeWidth="1" />
        ))}
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="#ffffff" strokeOpacity="0.14" strokeWidth="1.5" />

        {(flying || crashed) && (
          <>
            {/* soft ground shadow under the arc */}
            <path d={`${toPath(pts)} L${x.toFixed(1)} ${H - PAD} L${PAD} ${H - PAD} Z`} fill="#000000" opacity="0.12" />
            {/* glowing flame wake -- tapered ribbon, hot near the ball */}
            <path d={flamePolygon(pts, 7 + 12 * p)} fill={crashed ? '#e2504a' : 'url(#avFlame)'}
              filter="url(#avGlow)" opacity={crashed ? 0.5 : 0.95} className={crashed ? '' : 'av-flame'} />
            {/* bright energy core along the exact path */}
            <path d={toPath(pts)} fill="none" strokeWidth="2.4" strokeLinecap="round"
              stroke={crashed ? '#e2504a' : '#fff3cf'} opacity={crashed ? 0.5 : 0.9} />
          </>
        )}

        {/* kick power-burst the instant the ball takes off */}
        {flying && p < 0.07 && (
          <g className="av-kick">
            <circle cx={PAD} cy={H - PAD} r="18" fill="#fff6d8" opacity="0.55" />
            <g stroke="#ffd36b" strokeWidth="2" strokeLinecap="round">
              <line x1={PAD} y1={H - PAD} x2={PAD + 16} y2={H - PAD - 10} />
              <line x1={PAD} y1={H - PAD} x2={PAD + 20} y2={H - PAD} />
              <line x1={PAD} y1={H - PAD} x2={PAD + 12} y2={H - PAD - 18} />
            </g>
          </g>
        )}

        {betting && <Footballer windowMs={bettingMs} restartKey={String(bettingEndsAtMs ?? 'b')} />}

        {/* sparks flung off behind the ball while flying */}
        {flying && p > 0.05 && (
          <g className="av-sparks" fill="#ffe39b">
            {[0, 1, 2].map((i) => {
              const d = 16 + i * 9;
              const jitter = ((i % 2) * 2 - 1) * 3;
              return <circle key={i} cx={x - ux * d + uy * jitter} cy={y - uy * d - ux * jitter}
                r={2.4 - i * 0.5} style={{ animationDelay: `${i * 0.12}s` }} />;
            })}
          </g>
        )}

        {/* ball: rests at kick spot during betting, rides the curve while flying */}
        <g transform={`translate(${(flying || crashed ? x : BASE_X).toFixed(1)} ${(flying || crashed ? y : BASE_Y).toFixed(1)})`}>
          <Ball gone={crashed} stretch={stretch} angle={angleDeg} spinning={flying} />
        </g>
      </svg>

      <div className="av-mult-wrap">
        {betting ? (
          <BigCountdown to={bettingEndsAtMs} />
        ) : (
          <>
            <div className={bigClass}>
              {(crashed && crashMultiplier != null ? crashMultiplier : m).toFixed(2)}<span className="av-x">x</span>
            </div>
            {crashed && <div className="av-flew">Auta gitti!</div>}
          </>
        )}
      </div>
    </div>
  );
}

// Big, unmissable betting countdown: "3 · 2 · 1 · Takeoff!".
function BigCountdown({ to }: { to: number | null }) {
  const { t } = useI18n();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (to == null) return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [to]);
  if (to == null) return <div className="av-idle-note">{t('avs.phase.betting')}</div>;
  const secs = (to - now) / 1000;
  if (secs <= 0.25) return <div className="av-count-go">{t('av2.takeoff')}</div>;
  const n = Math.ceil(secs);
  return (
    <>
      <div key={n} className="av-count-big tnum">{n}</div>
      <div className="av-idle-note">{t('av2.betsClosing')}</div>
    </>
  );
}
