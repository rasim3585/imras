import type { ReactNode } from 'react';

// Glossy, dimensional sports symbols for Gates of Goal — original vector art
// (gradients + specular highlight + per-symbol glow), rendered DIRECTLY on the
// pitch grid (no tile). Cell value: 1..8 = symbol, 9 = scatter (goal), negative
// = multiplier orb, 0 = empty.

interface SymDef { glow: string; body: ReactNode; }

const Shine = ({ cx = 38, cy = 30, rx = 16, ry = 9, o = 0.5 }: { cx?: number; cy?: number; rx?: number; ry?: number; o?: number }) => (
  <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="#ffffff" opacity={o} transform={`rotate(-28 ${cx} ${cy})`} />
);

const SYMBOLS: SymDef[] = [
  // 1 — referee whistle (no protruding tube) -------------------------------- low
  { glow: 'rgba(52,211,153,0.8)', body: <>
    <defs>
      <linearGradient id="whBody" x1="0" y1="0" x2="0.4" y2="1">
        <stop offset="0" stopColor="#6ee7b7" /><stop offset="0.5" stopColor="#10b981" /><stop offset="1" stopColor="#047857" />
      </linearGradient>
    </defs>
    <path d="M16 46h34a14 14 0 1 1-12 20l-3-6H16a7 7 0 0 1-7-7 7 7 0 0 1 7-7z" fill="url(#whBody)" stroke="#065f46" strokeWidth="2.5" strokeLinejoin="round" />
    <circle cx="54" cy="58" r="6.5" fill="#03362a" />
    <rect x="9" y="46" width="6" height="14" rx="3" fill="#0b6e4f" />
    <Shine cx={30} cy={49} rx={15} ry={5} o={0.5} />
  </> },

  // 2 — red card ------------------------------------------------------------ low
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

  // 3 — tennis ball (gold) -------------------------------------------------- low
  { glow: 'rgba(230,200,60,0.9)', body: <>
    <defs>
      <radialGradient id="tennis" cx="0.38" cy="0.32" r="0.85">
        <stop offset="0" stopColor="#fff6b8" /><stop offset="0.6" stopColor="#f2d13a" /><stop offset="1" stopColor="#b89416" />
      </radialGradient>
    </defs>
    <circle cx="50" cy="50" r="38" fill="url(#tennis)" stroke="#8a6e12" strokeWidth="1.5" />
    <path d="M16 30 Q46 50 16 70" fill="none" stroke="#fffdf0" strokeWidth="4" />
    <path d="M84 30 Q54 50 84 70" fill="none" stroke="#fffdf0" strokeWidth="4" />
    <Shine cx={38} cy={34} rx={13} ry={8} o={0.55} />
  </> },

  // 4 — football (soccer ball) ---------------------------------------------- mid
  { glow: 'rgba(255,255,255,0.75)', body: <>
    <defs>
      <radialGradient id="ball" cx="0.38" cy="0.32" r="0.85">
        <stop offset="0" stopColor="#ffffff" /><stop offset="0.65" stopColor="#eef1f4" /><stop offset="1" stopColor="#b3bcc6" />
      </radialGradient>
    </defs>
    <circle cx="50" cy="50" r="38" fill="url(#ball)" stroke="#7d8794" strokeWidth="1.5" />
    <polygon points="50,36 63,46 58,62 42,62 37,46" fill="#1c2430" />
    <path d="M50 12V36M88 50 63 46M74 80 58 62M26 80 42 62M12 50 37 46" stroke="#39424f" strokeWidth="2.4" fill="none" />
    <Shine cx={37} cy={33} rx={13} ry={8} o={0.6} />
  </> },

  // 5 — basketball ---------------------------------------------------------- mid
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

  // 6 — american football (gold-brown) -------------------------------------- high
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

  // 7 — golden boot (side-profile cleat) ------------------------------------ high
  { glow: 'rgba(255,206,74,0.95)', body: <>
    <defs>
      <linearGradient id="boot" x1="0" y1="0" x2="0.3" y2="1">
        <stop offset="0" stopColor="#fff2b0" /><stop offset="0.45" stopColor="#f3c73f" /><stop offset="1" stopColor="#a9741a" />
      </linearGradient>
      <linearGradient id="bootSole" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#c8891f" /><stop offset="1" stopColor="#7a4e10" />
      </linearGradient>
    </defs>
    <path d="M10 58c0-11 9-16 22-17l8-1c6-6 16-8 28-5 8 2 14 7 16 15 1 5-2 8-7 8H16c-4 0-6-1-6-3z"
      fill="url(#boot)" stroke="#6b4610" strokeWidth="2.5" strokeLinejoin="round" />
    <path d="M12 61h78c2 4-1 9-8 9H20c-6 0-9-4-8-9z" fill="url(#bootSole)" stroke="#6b4610" strokeWidth="2" strokeLinejoin="round" />
    <circle cx="26" cy="73" r="2.6" fill="#5a3a0e" /><circle cx="44" cy="74" r="2.6" fill="#5a3a0e" />
    <circle cx="62" cy="74" r="2.6" fill="#5a3a0e" /><circle cx="78" cy="73" r="2.6" fill="#5a3a0e" />
    <path d="M46 44l12 3M44 50l14 3M43 56l14 2" stroke="#fff6d6" strokeWidth="2.4" strokeLinecap="round" opacity="0.85" />
    <Shine cx={34} cy={48} rx={12} ry={5} o={0.5} />
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
        {/* net */}
        <g stroke="#ffffff" strokeWidth="1.4" opacity="0.7">
          <path d="M24 30h52M24 42h52M24 54h52M32 22v46M44 22v46M56 22v46M68 22v46" />
        </g>
        {/* 3-post goal frame (left, right, top) */}
        <path d="M20 66V22h60v44" fill="none" stroke="#ffffff" strokeWidth="5.5" strokeLinejoin="round" strokeLinecap="round" />
        {/* ball inside */}
        <circle cx="50" cy="52" r="9" fill="#fff" stroke="#6b4610" strokeWidth="1.5" />
        <polygon points="50,46 55,50 53,56 47,56 45,50" fill="#1c2430" />
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
