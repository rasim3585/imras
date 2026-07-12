// Original football-themed slot symbols for Gates of Goal. Each is a coloured
// rounded tile + a simple football motif — our own identity, not a reskin.
// Cell value: 1..8 = symbol, negative = multiplier orb of that value, 0 = empty.

interface SymDef { bg: string; ink: string; body: JSX.Element; }

const T = '#0c130f';   // dark ink outline

const SYMBOLS: SymDef[] = [
  // 1 — whistle (low)
  { bg: '#2f9e8f', ink: '#eafcf7', body: <>
    <path d="M30 44h30a11 11 0 1 1-9 17l-3-6H30a6 6 0 0 1-6-6v-5a6 6 0 0 1 6-6z" fill="#eafcf7" stroke={T} strokeWidth="2.5"/>
    <circle cx="62" cy="52" r="4.5" fill={T}/><path d="M60 40v-6h9" stroke="#eafcf7" strokeWidth="4" fill="none" strokeLinecap="round"/></> },
  // 2 — boot (low)
  { bg: '#3b7fd4', ink: '#eef4ff', body: <>
    <path d="M28 34v22l30 6c8 1 14 4 14 11H24a6 6 0 0 1-6-6V34z" fill="#eef4ff" stroke={T} strokeWidth="2.5" strokeLinejoin="round"/>
    <path d="M30 68h8M42 68h8M54 68h8" stroke={T} strokeWidth="3" strokeLinecap="round"/></> },
  // 3 — gloves (low)
  { bg: '#d0913a', ink: '#fff4e0', body: <>
    <path d="M34 40c0-5 5-8 10-8s10 3 10 8v4c4-2 10 0 10 6v12a10 10 0 0 1-10 10H44a10 10 0 0 1-10-10z" fill="#fff4e0" stroke={T} strokeWidth="2.5"/>
    <path d="M44 34v10M54 36v9" stroke={T} strokeWidth="2.5" strokeLinecap="round"/></> },
  // 4 — corner flag (low)
  { bg: '#c94f4f', ink: '#ffe9e4', body: <>
    <path d="M42 26v50" stroke="#ffe9e4" strokeWidth="4.5" strokeLinecap="round"/>
    <path d="M45 28l26 8-26 9z" fill="#ffe9e4" stroke={T} strokeWidth="2.5" strokeLinejoin="round"/>
    <circle cx="42" cy="24" r="4" fill="#ffe9e4"/></> },
  // 5 — card (low)
  { bg: '#e0b400', ink: '#fff7cc', body: <>
    <rect x="34" y="28" width="28" height="44" rx="5" fill="#fff7cc" stroke={T} strokeWidth="2.5" transform="rotate(-10 48 50)"/></> },
  // 6 — jersey (high)
  { bg: '#7a4fd0', ink: '#f0e9ff', body: <>
    <path d="M38 30l-12 8 6 12 6-3v26h28V47l6 3 6-12-12-8-6 4a8 8 0 0 1-16 0z" fill="#f0e9ff" stroke={T} strokeWidth="2.5" strokeLinejoin="round"/>
    <path d="M48 40v20" stroke={T} strokeWidth="2" strokeDasharray="2 3"/></> },
  // 7 — golden boot (high)
  { bg: '#1b2440', ink: '#ffd24a', body: <>
    <path d="M28 34v22l30 6c8 1 14 4 14 11H24a6 6 0 0 1-6-6V34z" fill="#ffd24a" stroke={T} strokeWidth="2.5" strokeLinejoin="round"/>
    <path d="M30 68h9M43 68h9M56 68h6" stroke="#8a5a00" strokeWidth="3" strokeLinecap="round"/>
    <circle cx="66" cy="30" r="4" fill="#fff3bf"/></> },
  // 8 — trophy (top)
  { bg: '#12203f', ink: '#ffdd5c', body: <>
    <path d="M34 26h28v10a14 14 0 0 1-28 0z" fill="#ffdd5c" stroke={T} strokeWidth="2.5"/>
    <path d="M34 30h-8a8 8 0 0 0 8 8M62 30h8a8 8 0 0 1-8 8" fill="none" stroke="#ffdd5c" strokeWidth="3.5"/>
    <path d="M44 50h8v8h6v6H38v-6h6z" fill="#ffdd5c" stroke={T} strokeWidth="2.5" strokeLinejoin="round"/></> },
];

function OrbBall({ value }: { value: number }) {
  return (
    <div className="slot-orb">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="40" fill="#ffcf3a" stroke="#8a5a00" strokeWidth="3" />
        <circle cx="50" cy="50" r="40" fill="none" stroke="#fff6d6" strokeWidth="2" opacity="0.6" />
        <polygon points="50,32 62,41 57,55 43,55 38,41" fill="#7a2f10" opacity="0.25" />
      </svg>
      <span className="slot-orb-x tnum">×{value}</span>
    </div>
  );
}

export default function SlotSymbol({ v }: { v: number }) {
  if (v === 0) return <span className="slot-empty" />;
  if (v < 0) return <OrbBall value={-v} />;
  const s = SYMBOLS[v - 1] ?? SYMBOLS[0];
  return (
    <span className="slot-sym" style={{ background: s.bg }}>
      <svg viewBox="0 0 100 100" aria-hidden="true">{s.body}</svg>
    </span>
  );
}

export const SYMBOL_COUNT = SYMBOLS.length;
