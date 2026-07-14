import type { ReactNode } from 'react';

// Glossy, dimensional sports symbols for Gates of Goal — original vector art
// (gradients + specular highlight + per-symbol glow + colored aura), rendered
// DIRECTLY on the pitch grid (no tile). Cell value: 1..9 = symbol (9 = golden
// boot), 10 = scatter (goal), negative = multiplier orb, 0 = empty.

interface SymDef { glow: string; body: ReactNode; }

const Shine = ({ cx = 38, cy = 30, rx = 14, ry = 8, o = 0.5 }: { cx?: number; cy?: number; rx?: number; ry?: number; o?: number }) => (
  <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="#ffffff" opacity={o} transform={`rotate(-28 ${cx} ${cy})`} />
);

const SYMBOLS: SymDef[] = [
  // 1 — red card ------------------------------------------------------------ low
  { glow: 'rgba(239,68,68,0.85)', body: <>
    <defs>
      <linearGradient id="rcard" x1="0" y1="0" x2="0.5" y2="1">
        <stop offset="0" stopColor="#f87171" /><stop offset="0.5" stopColor="#ef4444" /><stop offset="1" stopColor="#b91c1c" />
      </linearGradient>
    </defs>
    <g transform="rotate(-9 50 50)">
      <rect x="30" y="16" width="40" height="62" rx="6" fill="url(#rcard)" stroke="#7f1010" strokeWidth="2.5" />
      <rect x="35" y="21" width="13" height="30" rx="4" fill="#ffffff" opacity="0.28" />
    </g>
  </> },

  // 2 — tennis ball (gold) -------------------------------------------------- low
  { glow: 'rgba(230,200,60,0.9)', body: <>
    <defs>
      <radialGradient id="tennis" cx="0.38" cy="0.32" r="0.85">
        <stop offset="0" stopColor="#f7e94e" /><stop offset="0.55" stopColor="#e0bc10" /><stop offset="1" stopColor="#8a6d08" />
      </radialGradient>
    </defs>
    <circle cx="50" cy="50" r="38" fill="url(#tennis)" stroke="#6e5709" strokeWidth="2" />
    <path d="M16 30 Q46 50 16 70" fill="none" stroke="#fffdf0" strokeWidth="4" />
    <path d="M84 30 Q54 50 84 70" fill="none" stroke="#fffdf0" strokeWidth="4" />
    <Shine cx={38} cy={34} rx={13} ry={8} o={0.55} />
  </> },

  // 3 — baseball ------------------------------------------------------------ low
  { glow: 'rgba(255,255,255,0.7)', body: <>
    <defs>
      <radialGradient id="bsb" cx="0.38" cy="0.32" r="0.85">
        <stop offset="0" stopColor="#ffffff" /><stop offset="0.66" stopColor="#ece5d6" /><stop offset="1" stopColor="#b0a488" />
      </radialGradient>
    </defs>
    <circle cx="50" cy="50" r="38" fill="url(#bsb)" stroke="#8f8570" strokeWidth="2" />
    <path d="M26 18 Q40 50 26 82" fill="none" stroke="#e0102e" strokeWidth="2.8" />
    <path d="M74 18 Q60 50 74 82" fill="none" stroke="#e0102e" strokeWidth="2.8" />
    <g stroke="#e0102e" strokeWidth="1.8" strokeLinecap="round">
      <path d="M22 30l7 3M22 42l8 2M22 54l8 2M22 66l7 3" />
      <path d="M78 30l-7 3M78 42l-8 2M78 54l-8 2M78 66l-7 3" />
    </g>
    <Shine cx={38} cy={34} rx={12} ry={7} o={0.55} />
  </> },

  // 4 — volleyball ---------------------------------------------------------- mid
  { glow: 'rgba(120,170,255,0.8)', body: <>
    <defs>
      <radialGradient id="vb" cx="0.38" cy="0.32" r="0.85">
        <stop offset="0" stopColor="#ffffff" /><stop offset="0.66" stopColor="#dbe6f6" /><stop offset="1" stopColor="#93a6c4" />
      </radialGradient>
    </defs>
    <circle cx="50" cy="50" r="38" fill="url(#vb)" stroke="#6f7f97" strokeWidth="2" />
    <g fill="none" stroke="#1666e0" strokeWidth="3.1" strokeLinecap="round">
      <path d="M50 12 Q42 40 22 62" /><path d="M50 12 Q48 42 40 84" />
      <path d="M50 12 Q60 38 82 52" /><path d="M50 12 Q56 44 70 82" />
      <path d="M22 62 Q54 58 82 52" /><path d="M40 84 Q56 66 70 82" />
    </g>
    <Shine cx={38} cy={32} rx={12} ry={7} o={0.5} />
  </> },

  // 5 — football (classic black & white pentagons) -------------------------- mid
  { glow: 'rgba(255,255,255,0.8)', body: <>
    <defs>
      <radialGradient id="ball" cx="0.38" cy="0.3" r="0.9">
        <stop offset="0" stopColor="#ffffff" /><stop offset="0.66" stopColor="#e4e9ef" /><stop offset="1" stopColor="#9fabb8" />
      </radialGradient>
    </defs>
    <circle cx="50" cy="50" r="38" fill="url(#ball)" stroke="#5e6773" strokeWidth="2" />
    <g stroke="#5c6570" strokeWidth="1.6" fill="none">
      <path d="M50 35V27.7M62.4 44 68 37.8M57.6 58.5 58.6 66.8M42.4 58.5 41.4 66.8M37.6 44 32 37.8" />
    </g>
    <g fill="#0c1016">
      <polygon points="50,35 62.4,44 57.6,58.5 42.4,58.5 37.6,44" />
      <polygon points="50,15 56.7,19.8 54.1,27.7 45.9,27.7 43.3,19.8" />
      <polygon points="81.4,37.8 78.8,45.7 70.6,45.7 68,37.8 74.7,33" />
      <polygon points="69.4,74.7 61.2,74.7 58.6,66.8 65.3,62 72,66.8" />
      <polygon points="30.6,74.7 38.8,74.7 41.4,66.8 34.7,62 28,66.8" />
      <polygon points="18.6,37.8 21.2,45.7 29.4,45.7 32,37.8 25.3,33" />
    </g>
    <Shine cx={36} cy={31} rx={11} ry={7} o={0.55} />
  </> },

  // 6 — basketball ---------------------------------------------------------- mid
  { glow: 'rgba(245,140,50,0.85)', body: <>
    <defs>
      <radialGradient id="bball" cx="0.38" cy="0.32" r="0.85">
        <stop offset="0" stopColor="#ffbf7a" /><stop offset="0.55" stopColor="#f0872f" /><stop offset="1" stopColor="#b8551a" />
      </radialGradient>
    </defs>
    <circle cx="50" cy="50" r="38" fill="url(#bball)" stroke="#7a3d12" strokeWidth="1.5" />
    <path d="M50 12v76M12 50h76" stroke="#3a1c08" strokeWidth="2.6" />
    <path d="M22 20 Q42 50 22 80M78 20 Q58 50 78 80" fill="none" stroke="#3a1c08" strokeWidth="2.6" />
    <Shine cx={37} cy={33} rx={12} ry={7} o={0.5} />
  </> },

  // 7 — american football (gold-brown) -------------------------------------- high
  { glow: 'rgba(210,150,60,0.9)', body: <>
    <defs>
      <linearGradient id="afball" x1="0" y1="0" x2="0.3" y2="1">
        <stop offset="0" stopColor="#f0c774" /><stop offset="0.5" stopColor="#c1852f" /><stop offset="1" stopColor="#7a4a15" />
      </linearGradient>
    </defs>
    <g transform="rotate(-22 50 50)">
      <ellipse cx="50" cy="50" rx="40" ry="24" fill="url(#afball)" stroke="#4a2a0e" strokeWidth="2.5" />
      <path d="M18 50h6M76 50h6" stroke="#fff3d6" strokeWidth="4" strokeLinecap="round" />
      <path d="M38 50h24" stroke="#fff3d6" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M42 45v10M48 44v12M54 45v10" stroke="#fff3d6" strokeWidth="2.6" strokeLinecap="round" />
      <Shine cx={40} cy={40} rx={14} ry={6} o={0.4} />
    </g>
  </> },

  // 8 — golden trophy ------------------------------------------------------- top
  { glow: 'rgba(255,214,74,1)', body: <>
    <defs>
      <linearGradient id="trophy" x1="0" y1="0" x2="0.3" y2="1">
        <stop offset="0" stopColor="#fff6d6" /><stop offset="0.4" stopColor="#ffd24a" /><stop offset="1" stopColor="#b8801e" />
      </linearGradient>
    </defs>
    <path d="M32 16h36v14a18 18 0 0 1-36 0z" fill="url(#trophy)" stroke="#6b4610" strokeWidth="2.5" strokeLinejoin="round" />
    <path d="M32 20h-9a9 9 0 0 0 9 10M68 20h9a9 9 0 0 1-9 10" fill="none" stroke="url(#trophy)" strokeWidth="4" />
    <path d="M45 46h10v10h7v8H38v-8h7z" fill="url(#trophy)" stroke="#6b4610" strokeWidth="2.5" strokeLinejoin="round" />
    <rect x="34" y="70" width="32" height="9" rx="2" fill="url(#trophy)" stroke="#6b4610" strokeWidth="2.5" />
    <path d="M42 20c0 8 3 14 8 16" stroke="#fff6d6" strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.85" />
  </> },

  // 9 — golden boot (altın krampon) ------------------------------------------ high
  { glow: 'rgba(255,196,66,0.95)', body: <>
    <defs>
      <linearGradient id="boot" x1="0" y1="0" x2="0.4" y2="1">
        <stop offset="0" stopColor="#ffe9a8" /><stop offset="0.45" stopColor="#f4b73a" /><stop offset="1" stopColor="#9a6414" />
      </linearGradient>
    </defs>
    <path d="M24 62 L28 32 Q29 26 35 27 L46 30 Q50 31 52 35 L58 47 Q66 57 78 59 L84 61 Q88 62 88 66 L88 69 L24 69 Z"
      fill="url(#boot)" stroke="#6b4610" strokeWidth="2.5" strokeLinejoin="round" />
    <path d="M36 34 L46 38 M34 40 L44 44 M32 46 L42 50" stroke="#fff6d6" strokeWidth="2.4" strokeLinecap="round" />
    <path d="M22 69 h68 v5 a3 3 0 0 1 -3 3 H25 a3 3 0 0 1 -3 -3 Z" fill="#3a2a12" stroke="#241a0c" strokeWidth="1.8" />
    <path d="M30 78v4M42 78v4M54 78v4M66 78v4M78 78v4" stroke="#3a2a12" strokeWidth="4.6" strokeLinecap="round" />
    <Shine cx={40} cy={38} rx={10} ry={5} o={0.5} />
  </> },
];

// Scatter (value 9): a football GOAL stamped "SCATTER".
function ScatterBall() {
  return (
    <div className="slot-scatter">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <defs>
          <radialGradient id="scGlow" cx="0.5" cy="0.4" r="0.65">
            <stop offset="0" stopColor="#fff6d6" /><stop offset="0.55" stopColor="#ffd24a" /><stop offset="1" stopColor="#b8801e" />
          </radialGradient>
        </defs>
        <circle cx="50" cy="46" r="34" fill="url(#scGlow)" opacity="0.28" />
        <g stroke="#ffffff" strokeWidth="1.4" opacity="0.7">
          <path d="M24 30h52M24 42h52M24 54h52M32 22v46M44 22v46M56 22v46M68 22v46" />
        </g>
        <path d="M20 66V22h60v44" fill="none" stroke="#ffffff" strokeWidth="5.5" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx="50" cy="52" r="9" fill="#fff" stroke="#6b4610" strokeWidth="1.5" />
        <polygon points="50,46 55,50 53,56 47,56 45,50" fill="#1c2430" />
      </svg>
      <span className="slot-scatter-x">SCATTER</span>
    </div>
  );
}

// Multiplier orb — glossy GEM sphere, coloured by value tier like GoO's orbs
// (blue = small, green = mid, purple = big, crimson = huge). Detonates via the
// .orbfire cell class when its value is added to the multiplier.
const ORB_TIERS = [
  { min: 100, id: 'orbR', stops: ['#ffd9d0', '#f04438', '#7a1408'], ring: '#4a0d05' },
  { min: 20, id: 'orbP', stops: ['#f0dcff', '#a855f7', '#4c1580'], ring: '#2e0a52' },
  { min: 6, id: 'orbG', stops: ['#d8ffe9', '#2fbf71', '#0e5c34'], ring: '#083a20' },
  { min: 0, id: 'orbB', stops: ['#d6ecff', '#3b82f6', '#123a80'], ring: '#0a2450' },
];
function OrbBall({ value }: { value: number }) {
  const t = ORB_TIERS.find((x) => value >= x.min) ?? ORB_TIERS[3];
  return (
    <div className="slot-orb">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <defs>
          <radialGradient id={t.id} cx="0.36" cy="0.3" r="0.8">
            <stop offset="0" stopColor={t.stops[0]} /><stop offset="0.5" stopColor={t.stops[1]} /><stop offset="1" stopColor={t.stops[2]} />
          </radialGradient>
        </defs>
        <circle cx="50" cy="50" r="40" fill={`url(#${t.id})`} stroke={t.ring} strokeWidth="3" />
        <ellipse cx="38" cy="34" rx="14" ry="9" fill="#ffffff" opacity="0.6" transform="rotate(-28 38 34)" />
      </svg>
      <span className="slot-orb-x tnum">×{value}</span>
    </div>
  );
}

export default function SlotSymbol({ v }: { v: number }) {
  if (v === 0) return <span className="slot-empty" />;
  if (v === 10) return <ScatterBall />;
  if (v < 0) return <OrbBall value={-v} />;
  const s = SYMBOLS[v - 1] ?? SYMBOLS[0];
  return (
    <span
      className="slot-sym"
      style={{ filter: `drop-shadow(0 2px 3px rgba(0,0,0,0.55)) drop-shadow(0 0 7px ${s.glow})`, ['--sg' as string]: s.glow }}
    >
      <svg viewBox="0 0 100 100" aria-hidden="true">{s.body}</svg>
    </span>
  );
}

export const SYMBOL_COUNT = SYMBOLS.length;
