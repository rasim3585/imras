import type { ReactNode } from 'react';

// Glossy, dimensional football symbols for Gates of Goal — original vector art
// (radial/linear gradients + specular highlights + a per-symbol glow), rendered
// DIRECTLY on the pitch grid with no tile border. Cell value: 1..8 = symbol,
// 9 = scatter (referee), negative = multiplier orb, 0 = empty.

interface SymDef { glow: string; body: ReactNode; }

// Reusable soft top-left highlight
const Shine = ({ cx = 38, cy = 30, rx = 22, ry = 14, o = 0.55 }: { cx?: number; cy?: number; rx?: number; ry?: number; o?: number }) => (
  <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="#ffffff" opacity={o} transform={`rotate(-28 ${cx} ${cy})`} />
);

const SYMBOLS: SymDef[] = [
  // 1 — referee whistle (emerald) ------------------------------------------ low
  { glow: 'rgba(52,211,153,0.8)', body: <>
    <defs>
      <linearGradient id="whBody" x1="0" y1="0" x2="0.4" y2="1">
        <stop offset="0" stopColor="#6ee7b7" /><stop offset="0.5" stopColor="#10b981" /><stop offset="1" stopColor="#047857" />
      </linearGradient>
    </defs>
    <path d="M22 42h34a13 13 0 1 1-11 20l-4-7H22a6 6 0 0 1-6-6v-1a6 6 0 0 1 6-6z" fill="url(#whBody)" stroke="#065f46" strokeWidth="2.5" strokeLinejoin="round" />
    <circle cx="58" cy="55" r="6" fill="#03362a" />
    <path d="M54 40V30h13" stroke="url(#whBody)" strokeWidth="6" fill="none" strokeLinecap="round" />
    <path d="M54 40V30h13" stroke="#065f46" strokeWidth="2" fill="none" strokeLinecap="round" />
    <Shine cx={34} cy={44} rx={16} ry={6} o={0.5} />
  </> },

  // 2 — red card ----------------------------------------------------------- low
  { glow: 'rgba(239,68,68,0.85)', body: <>
    <defs>
      <linearGradient id="rcard" x1="0" y1="0" x2="0.5" y2="1">
        <stop offset="0" stopColor="#f87171" /><stop offset="0.5" stopColor="#ef4444" /><stop offset="1" stopColor="#b91c1c" />
      </linearGradient>
    </defs>
    <g transform="rotate(-9 50 50)">
      <rect x="30" y="18" width="40" height="60" rx="6" fill="url(#rcard)" stroke="#7f1010" strokeWidth="2.5" />
      <rect x="35" y="23" width="14" height="30" rx="4" fill="#ffffff" opacity="0.28" />
    </g>
  </> },

  // 3 — yellow card -------------------------------------------------------- low
  { glow: 'rgba(250,204,21,0.9)', body: <>
    <defs>
      <linearGradient id="ycard" x1="0" y1="0" x2="0.5" y2="1">
        <stop offset="0" stopColor="#fde68a" /><stop offset="0.5" stopColor="#facc15" /><stop offset="1" stopColor="#ca8a04" />
      </linearGradient>
    </defs>
    <g transform="rotate(9 50 50)">
      <rect x="30" y="18" width="40" height="60" rx="6" fill="url(#ycard)" stroke="#7c5e08" strokeWidth="2.5" />
      <rect x="35" y="23" width="14" height="30" rx="4" fill="#ffffff" opacity="0.4" />
    </g>
  </> },

  // 4 — football (soccer ball) --------------------------------------------- mid
  { glow: 'rgba(255,255,255,0.7)', body: <>
    <defs>
      <radialGradient id="ball" cx="0.38" cy="0.32" r="0.85">
        <stop offset="0" stopColor="#ffffff" /><stop offset="0.65" stopColor="#eef1f4" /><stop offset="1" stopColor="#b9c2cb" />
      </radialGradient>
    </defs>
    <circle cx="50" cy="52" r="38" fill="url(#ball)" stroke="#8892a0" strokeWidth="1.5" />
    <polygon points="50,38 63,48 58,64 42,64 37,48" fill="#1c2430" />
    <path d="M50 14V38M88 52 63 48M74 82 58 64M26 82 42 64M12 52 37 48" stroke="#39424f" strokeWidth="2.4" fill="none" />
    <path d="M50 14l14 10M50 14 36 24M86 66 63 48M63 48 58 64M42 64 26 66" stroke="#39424f" strokeWidth="1.6" fill="none" opacity="0.7" />
    <Shine cx={36} cy={34} rx={14} ry={8} o={0.6} />
  </> },

  // 5 — team jersey (blue, glowing) ---------------------------------------- mid
  { glow: 'rgba(56,132,255,0.85)', body: <>
    <defs>
      <linearGradient id="jersey" x1="0" y1="0" x2="0.3" y2="1">
        <stop offset="0" stopColor="#7db3ff" /><stop offset="0.5" stopColor="#2f7cf0" /><stop offset="1" stopColor="#1b4fb8" />
      </linearGradient>
    </defs>
    <path d="M38 22 26 30l6 14 8-4v40h32V40l8 4 6-14-12-8-7 4a9 9 0 0 1-18 0z"
      fill="url(#jersey)" stroke="#12336f" strokeWidth="2.5" strokeLinejoin="round" />
    <path d="M50 34v46" stroke="#12336f" strokeWidth="2" opacity="0.5" />
    <path d="M56 26a8 8 0 0 1-12 0" fill="none" stroke="#12336f" strokeWidth="2.5" />
    <Shine cx={38} cy={40} rx={10} ry={16} o={0.35} />
  </> },

  // 6 — golden shin guard -------------------------------------------------- high
  { glow: 'rgba(255,206,74,0.9)', body: <>
    <defs>
      <linearGradient id="shin" x1="0" y1="0" x2="0.4" y2="1">
        <stop offset="0" stopColor="#fff2b0" /><stop offset="0.45" stopColor="#f3c73f" /><stop offset="1" stopColor="#a9741a" />
      </linearGradient>
    </defs>
    <path d="M50 16c16 0 24 14 24 34s-8 34-24 34-24-14-24-34 8-34 24-34z" fill="url(#shin)" stroke="#6b4610" strokeWidth="2.5" />
    <path d="M50 22v56" stroke="#c8891f" strokeWidth="3" opacity="0.6" />
    <rect x="30" y="40" width="40" height="6" rx="3" fill="#8a5a12" opacity="0.7" />
    <rect x="30" y="58" width="40" height="6" rx="3" fill="#8a5a12" opacity="0.7" />
    <Shine cx={40} cy={34} rx={9} ry={16} o={0.55} />
  </> },

  // 7 — golden boot -------------------------------------------------------- high
  { glow: 'rgba(255,206,74,0.95)', body: <>
    <defs>
      <linearGradient id="boot" x1="0" y1="0" x2="0.3" y2="1">
        <stop offset="0" stopColor="#fff2b0" /><stop offset="0.45" stopColor="#f3c73f" /><stop offset="1" stopColor="#a9741a" />
      </linearGradient>
    </defs>
    <path d="M20 34v20l34 8c10 2 20 4 20 14v6H20a6 6 0 0 1-6-6V34z" fill="url(#boot)" stroke="#6b4610" strokeWidth="2.5" strokeLinejoin="round" />
    <path d="M24 72h6M34 72h6M44 72h6M54 72h6M64 72h5" stroke="#6b4610" strokeWidth="3" strokeLinecap="round" />
    <path d="M26 40l14 4M26 48l16 4" stroke="#fff6d6" strokeWidth="2.5" strokeLinecap="round" opacity="0.8" />
    <Shine cx={34} cy={40} rx={12} ry={5} o={0.6} />
  </> },

  // 8 — golden trophy ------------------------------------------------------ top
  { glow: 'rgba(255,214,74,1)', body: <>
    <defs>
      <linearGradient id="trophy" x1="0" y1="0" x2="0.3" y2="1">
        <stop offset="0" stopColor="#fff6d6" /><stop offset="0.4" stopColor="#ffd24a" /><stop offset="1" stopColor="#b8801e" />
      </linearGradient>
    </defs>
    <path d="M32 18h36v14a18 18 0 0 1-36 0z" fill="url(#trophy)" stroke="#6b4610" strokeWidth="2.5" strokeLinejoin="round" />
    <path d="M32 22h-9a9 9 0 0 0 9 10M68 22h9a9 9 0 0 1-9 10" fill="none" stroke="url(#trophy)" strokeWidth="4" />
    <path d="M45 48h10v10h7v8H38v-8h7z" fill="url(#trophy)" stroke="#6b4610" strokeWidth="2.5" strokeLinejoin="round" />
    <rect x="34" y="72" width="32" height="8" rx="2" fill="url(#trophy)" stroke="#6b4610" strokeWidth="2.5" />
    <path d="M42 22c0 8 3 14 8 16" stroke="#fff6d6" strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.85" />
  </> },
];

// Scatter (value 9): a glowing golden referee whistle burst stamped "SCATTER".
function ScatterBall() {
  return (
    <div className="slot-scatter">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <defs>
          <radialGradient id="scGlow" cx="0.5" cy="0.45" r="0.6">
            <stop offset="0" stopColor="#fff6d6" /><stop offset="0.5" stopColor="#ffd24a" /><stop offset="1" stopColor="#b8801e" />
          </radialGradient>
        </defs>
        <g stroke="#ffe27a" strokeWidth="3" strokeLinecap="round">
          <path d="M50 8v10M50 82v10M8 50h10M82 50h10M20 20l7 7M80 20l-7 7M20 80l7-7M80 80l-7-7" />
        </g>
        <circle cx="50" cy="46" r="30" fill="url(#scGlow)" stroke="#6b4610" strokeWidth="2.5" />
        <path d="M34 40h20a9 9 0 1 1-8 14l-3-5H34a4 4 0 0 1-4-4 4 4 0 0 1 4-5z" fill="#0c130f" opacity="0.85" />
        <circle cx="55" cy="49" r="4" fill="#ffe27a" />
      </svg>
      <span className="slot-scatter-x">SCATTER</span>
    </div>
  );
}

// Multiplier orb — glossy sphere with ×N.
function OrbBall({ value }: { value: number }) {
  return (
    <div className="slot-orb">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <defs>
          <radialGradient id="orb" cx="0.36" cy="0.3" r="0.8">
            <stop offset="0" stopColor="#fff2b0" /><stop offset="0.5" stopColor="#ffcf3a" /><stop offset="1" stopColor="#a9741a" />
          </radialGradient>
        </defs>
        <circle cx="50" cy="50" r="40" fill="url(#orb)" stroke="#6b4610" strokeWidth="3" />
        <ellipse cx="38" cy="34" rx="14" ry="9" fill="#ffffff" opacity="0.6" transform="rotate(-28 38 34)" />
      </svg>
      <span className="slot-orb-x tnum">×{value}</span>
    </div>
  );
}

export default function SlotSymbol({ v }: { v: number }) {
  if (v === 0) return <span className="slot-empty" />;
  if (v === 9) return <ScatterBall />;
  if (v < 0) return <OrbBall value={-v} />;
  const s = SYMBOLS[v - 1] ?? SYMBOLS[0];
  return (
    <span className="slot-sym" style={{ filter: `drop-shadow(0 2px 3px rgba(0,0,0,0.55)) drop-shadow(0 0 7px ${s.glow})` }}>
      <svg viewBox="0 0 100 100" aria-hidden="true">{s.body}</svg>
    </span>
  );
}

export const SYMBOL_COUNT = SYMBOLS.length;
