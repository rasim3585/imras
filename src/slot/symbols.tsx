import type { ReactNode } from 'react';

// Gates of Goal — sembol seti v3 (0716 gece yeniden çizimi).
// Düzen Gates of Olympus ile BİREBİR: 5 düşük fasetli mücevher + 4 yüksek
// altın futbol öğesi + scatter. Ödeme kademesi (12+ kovası) sunucu 0127
// haritasıyla aynı; sanat o kademeye eşlendi:
//   v1 mavi gem 2x · v2 yeşil 4x · v3 sarı 5x · v4 mor 8x · v5 kırmızı 10x
//   v6 Altın Düdük 12x (kadeh rolü) · v7 Kaleci Eldiveni 15x (yüzük rolü)
//   v9 Altın Krampon 25x (kum saati rolü) · v8 KUPA 50x (taç rolü)
//   v10 scatter = Altın Top · negatif = çarpan orbu (GoO renk kademesi).
// Eski karışık spor topları (tenis/beyzbol/voleybol/basket) emekli — futbol
// oyununda beyzbol topu tema tutarlılığını bozuyordu ve küçük hücrede
// okunmuyordu. Mücevherler her boyutta anında okunur (GoO'nun da tercihi).

interface SymDef { glow: string; body: ReactNode; }

/* ---------- fasetli mücevher (statik gradyan id'leri — hücreler paylaşır) ---------- */
function gemBody(id: string, base: string, light: string, dark: string): ReactNode {
  return (
    <>
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={light} /><stop offset="1" stopColor={dark} />
        </linearGradient>
        <radialGradient id={`${id}c`} cx="0.5" cy="0.42" r="0.6">
          <stop offset="0" stopColor={light} /><stop offset="1" stopColor={base} />
        </radialGradient>
      </defs>
      <polygon points="50,4 82,17 96,50 82,83 50,96 18,83 4,50 18,17"
        fill={`url(#${id}g)`} stroke="#141a2e" strokeWidth="4" strokeLinejoin="round" />
      <polygon points="50,18 74,28 79,50 74,72 50,82 26,72 21,50 26,28"
        fill={`url(#${id}c)`} stroke={dark} strokeWidth="1.6" strokeLinejoin="round" opacity="0.96" />
      <g stroke={dark} strokeWidth="1.2" opacity="0.6">
        <line x1="50" y1="4" x2="50" y2="18" /><line x1="82" y1="17" x2="74" y2="28" />
        <line x1="96" y1="50" x2="79" y2="50" /><line x1="82" y1="83" x2="74" y2="72" />
        <line x1="50" y1="96" x2="50" y2="82" /><line x1="18" y1="83" x2="26" y2="72" />
        <line x1="4" y1="50" x2="21" y2="50" /><line x1="18" y1="17" x2="26" y2="28" />
      </g>
      <polygon points="34,26 52,22 44,38" fill="#ffffff" opacity="0.8" />
      <circle cx="63" cy="60" r="4" fill="#ffffff" opacity="0.35" />
    </>
  );
}

/* ---------- altın gradyan tanımları (öğe başına statik id) ---------- */
const INK = '#3a2a08';
function goldDefs(id: string): ReactNode {
  return (
    <defs>
      <linearGradient id={`${id}au`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#ffe9a3" /><stop offset="0.45" stopColor="#f4c542" />
        <stop offset="0.75" stopColor="#d99a1b" /><stop offset="1" stopColor="#b0740c" />
      </linearGradient>
      <linearGradient id={`${id}au2`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#fff6d8" /><stop offset="1" stopColor="#e0a825" />
      </linearGradient>
    </defs>
  );
}

const trophyBody: ReactNode = (
  <>
    {goldDefs('sTr')}
    <path d="M22 26 H12 q-4 0 -3.4 4.4 Q11 52 32 57" fill="none" stroke="url(#sTrau)" strokeWidth="7" strokeLinecap="round" />
    <path d="M78 26 H88 q4 0 3.4 4.4 Q89 52 68 57" fill="none" stroke="url(#sTrau)" strokeWidth="7" strokeLinecap="round" />
    <path d="M24 18 h52 v16 a26 26 0 0 1 -52 0 z" fill="url(#sTrau)" stroke={INK} strokeWidth="3.4" />
    <rect x="24" y="14" width="52" height="9" rx="4" fill="url(#sTrau2)" stroke={INK} strokeWidth="3" />
    <path d="M45 60 h10 l3 12 h-16 z" fill="url(#sTrau)" stroke={INK} strokeWidth="3" />
    <rect x="32" y="72" width="36" height="8" rx="3" fill="url(#sTrau2)" stroke={INK} strokeWidth="3" />
    <rect x="27" y="80" width="46" height="10" rx="4" fill="url(#sTrau)" stroke={INK} strokeWidth="3.2" />
    <path d="M50 30 l3.2 6.6 7.2 1 -5.2 5.1 1.2 7.2 -6.4 -3.4 -6.4 3.4 1.2 -7.2 -5.2 -5.1 7.2 -1 z"
      fill="#fff6d8" stroke="#c07d08" strokeWidth="1.4" />
    <ellipse cx="35" cy="24" rx="6" ry="2.6" fill="#ffffff" opacity="0.75" transform="rotate(-18 35 24)" />
  </>
);

const bootBody: ReactNode = (
  <>
    {goldDefs('sBt')}
    <path d="M30 18 q13 22 34 32 q16 7 22 16 q4 6 -2 8 l-58 0 q-6 0 -6 -7 l0 -44 q0 -8 10 -5 z"
      fill="url(#sBtau)" stroke={INK} strokeWidth="3.4" strokeLinejoin="round" />
    <path d="M22 22 q6 -4 9 -1 q3 5 8 11 l-17 8 z" fill="url(#sBtau2)" stroke={INK} strokeWidth="2.4" />
    <g stroke={INK} strokeWidth="2.6" strokeLinecap="round">
      <line x1="41" y1="34" x2="52" y2="28" /><line x1="46" y1="41" x2="58" y2="34" />
      <line x1="51" y1="48" x2="63" y2="41" />
    </g>
    <path d="M20 74 l64 0 q7 0 4 -6 -2 -3 -6 -4 l-62 0 z" fill="#8a5c0d" stroke={INK} strokeWidth="3" />
    <g fill="url(#sBtau2)" stroke={INK} strokeWidth="2.2">
      <rect x="24" y="76" width="7" height="10" rx="2.6" /><rect x="40" y="76" width="7" height="10" rx="2.6" />
      <rect x="56" y="76" width="7" height="10" rx="2.6" /><rect x="72" y="76" width="7" height="10" rx="2.6" />
    </g>
    <ellipse cx="63" cy="52" rx="7" ry="3" fill="#ffffff" opacity="0.55" transform="rotate(24 63 52)" />
  </>
);

const gloveBody: ReactNode = (
  <>
    {goldDefs('sGl')}
    <g fill="url(#sGlau)" stroke={INK} strokeWidth="3">
      <rect x="26" y="12" width="12" height="34" rx="6" />
      <rect x="40" y="7" width="12" height="39" rx="6" />
      <rect x="54" y="10" width="12" height="36" rx="6" />
      <rect x="68" y="17" width="11" height="29" rx="5.5" />
    </g>
    <path d="M24 42 h56 q4 0 4 5 v14 q0 16 -18 20 h-24 q-18 -3 -18 -20 v-14 q0 -5 4 -5 z"
      fill="url(#sGlau)" stroke={INK} strokeWidth="3.4" />
    <path d="M22 46 q-12 4 -12 16 q0 10 9 12 q5 1 6 -5 l1 -18 z" fill="url(#sGlau2)" stroke={INK} strokeWidth="3" />
    <rect x="30" y="80" width="44" height="12" rx="5" fill="url(#sGlau2)" stroke={INK} strokeWidth="3" />
    <line x1="36" y1="86" x2="68" y2="86" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
    <path d="M32 52 q18 10 40 0" fill="none" stroke={INK} strokeWidth="2" opacity="0.5" />
    <ellipse cx="44" cy="16" rx="3.4" ry="6" fill="#ffffff" opacity="0.6" />
  </>
);

const whistleBody: ReactNode = (
  <>
    {goldDefs('sWh')}
    <circle cx="76" cy="18" r="7" fill="none" stroke="url(#sWhau2)" strokeWidth="4.4" />
    <rect x="52" y="20" width="34" height="13" rx="6" fill="url(#sWhau)" stroke={INK} strokeWidth="3.2" transform="rotate(14 52 20)" />
    <path d="M14 46 a26 26 0 1 0 52 6 l16 -18 q3 -4 -2 -7 l-30 -8 q-22 -4 -36 27 z"
      fill="url(#sWhau)" stroke={INK} strokeWidth="3.4" strokeLinejoin="round" />
    <circle cx="42" cy="58" r="9" fill="#3a2a08" opacity="0.85" />
    <circle cx="42" cy="58" r="9" fill="none" stroke={INK} strokeWidth="2.6" />
    <ellipse cx="30" cy="42" rx="7" ry="3" fill="#ffffff" opacity="0.65" transform="rotate(-24 30 42)" />
    <circle cx="58" cy="70" r="2.6" fill="#ffffff" opacity="0.4" />
  </>
);

// v sırası ÖDEME sırası değil — sunucu değer haritası korunur:
// 1..5 gem'ler (artan), 6 düdük, 7 eldiven, 8 KUPA (50x tepe), 9 krampon (25x).
const SYMBOLS: SymDef[] = [
  { glow: 'rgba(80,150,255,0.85)',  body: gemBody('sB', '#2f7fe8', '#9cd0ff', '#1a4fa8') },   // 1 mavi
  { glow: 'rgba(60,220,130,0.85)',  body: gemBody('sG', '#1fb85c', '#8df0b4', '#0e7a3c') },   // 2 yeşil
  { glow: 'rgba(250,200,60,0.9)',   body: gemBody('sY', '#f0b429', '#ffe58a', '#c07d08') },   // 3 sarı
  { glow: 'rgba(170,110,255,0.9)',  body: gemBody('sP', '#8c56e8', '#d0b0ff', '#5c2eb0') },   // 4 mor
  { glow: 'rgba(240,90,85,0.9)',    body: gemBody('sR', '#e2504a', '#ffa39c', '#a82823') },   // 5 kırmızı
  { glow: 'rgba(255,205,80,0.95)',  body: whistleBody },                                       // 6 düdük 12x
  { glow: 'rgba(255,205,80,0.95)',  body: gloveBody },                                         // 7 eldiven 15x
  { glow: 'rgba(255,214,74,1)',     body: trophyBody },                                        // 8 KUPA 50x
  { glow: 'rgba(255,196,66,0.95)',  body: bootBody },                                          // 9 krampon 25x
];

// Scatter — Altın Top (Ballon d'Or havası): ışın tacı + pentagon deseni.
function ScatterBall() {
  return (
    <div className="slot-scatter">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <defs>
          <radialGradient id="scAu" cx="0.38" cy="0.32" r="0.75">
            <stop offset="0" stopColor="#fff3c4" /><stop offset="0.55" stopColor="#f4c542" />
            <stop offset="1" stopColor="#b0740c" />
          </radialGradient>
        </defs>
        <g fill="#ffd95e" opacity="0.9">
          {Array.from({ length: 8 }).map((_, i) => (
            <polygon key={i} points="50,2 54,14 46,14" transform={`rotate(${i * 45} 50 50)`} />
          ))}
        </g>
        <circle cx="50" cy="50" r="34" fill="url(#scAu)" stroke={INK} strokeWidth="3.6" />
        <g fill="#8a5c0d" stroke={INK} strokeWidth="1.6" strokeLinejoin="round" opacity="0.9">
          <polygon points="50,32 61,40 57,53 43,53 39,40" />
          <path d="M50 32 L50 20 M61 40 L73 36 M57 53 L64 65 M43 53 L36 65 M39 40 L27 36" fill="none" strokeWidth="2.2" />
        </g>
        <ellipse cx="38" cy="34" rx="9" ry="4.4" fill="#ffffff" opacity="0.7" transform="rotate(-26 38 34)" />
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
