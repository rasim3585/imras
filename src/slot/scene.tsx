// Original premium slot scene furniture for Gates of Goal — our own art, not a
// reskin of any existing game: an ornate gold corner bracket, a stadium torch
// flame, and a heroic golden footballer mascot ("The Legend").

/** Ornate gold corner bracket. Placed at the four frame corners (rotated). */
export function CornerOrnament() {
  return (
    <svg className="go-corner-svg" viewBox="0 0 120 120" aria-hidden="true">
      <defs>
        <linearGradient id="goGold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff2b0" />
          <stop offset="0.45" stopColor="#f5c33b" />
          <stop offset="0.75" stopColor="#b8801e" />
          <stop offset="1" stopColor="#8a5a12" />
        </linearGradient>
      </defs>
      <path d="M8 60 Q8 8 60 8 L96 8 Q70 14 70 40 Q70 8 40 22 Q60 20 46 46 Q30 30 30 62 Q20 40 8 60Z"
        fill="url(#goGold)" stroke="#6b4610" strokeWidth="1.5" />
      <circle cx="20" cy="20" r="7" fill="url(#goGold)" stroke="#6b4610" strokeWidth="1.5" />
      <circle cx="20" cy="20" r="2.6" fill="#5a3a0e" />
    </svg>
  );
}

/** A stadium torch — bowl + animated flame. Purely decorative. */
export function Torch() {
  return (
    <div className="go-torch" aria-hidden="true">
      <div className="go-flame">
        <span className="go-flame-a" /><span className="go-flame-b" /><span className="go-flame-c" />
      </div>
      <svg viewBox="0 0 40 30" className="go-bowl">
        <defs>
          <linearGradient id="goBowl" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f5c33b" /><stop offset="1" stopColor="#8a5a12" />
          </linearGradient>
        </defs>
        <path d="M4 6 H36 L30 24 Q20 30 10 24 Z" fill="url(#goBowl)" stroke="#5a3a0e" strokeWidth="1.5" />
        <ellipse cx="20" cy="6" rx="16" ry="4" fill="#3a2408" />
      </svg>
    </div>
  );
}

/** "The Legend" — a heroic golden footballer, our stand-in for the side
 *  character. Stylised silhouette + rim light + ball; no likeness of anyone. */
export function Mascot({ excited = false }: { excited?: boolean }) {
  return (
    <div className={`go-legend ${excited ? 'is-excited' : ''}`} aria-hidden="true">
      <div className="go-legend-aura" />
      <svg viewBox="0 0 240 360" className="go-legend-svg">
        <defs>
          <linearGradient id="legGold" x1="0" y1="0" x2="0.6" y2="1">
            <stop offset="0" stopColor="#fff4c2" />
            <stop offset="0.4" stopColor="#f3c73f" />
            <stop offset="0.8" stopColor="#c8891f" />
            <stop offset="1" stopColor="#8a5a12" />
          </linearGradient>
          <radialGradient id="legRim" cx="0.3" cy="0.25" r="0.9">
            <stop offset="0" stopColor="#fff8dd" stopOpacity="0.9" />
            <stop offset="0.5" stopColor="#f3c73f" stopOpacity="0" />
          </radialGradient>
        </defs>
        {/* cape / dynamic cloth behind */}
        <path d="M150 70 C205 90 210 210 175 320 C165 250 150 180 140 150 Z"
          fill="url(#legGold)" opacity="0.35" />
        {/* body — mid-stride hero pose */}
        <path d="M120 44 C136 44 146 56 146 72 C146 88 136 98 121 98
                 C150 104 158 132 156 168 L150 210
                 C168 230 176 262 176 300 L156 300 C150 268 140 244 128 232
                 L120 268 L134 336 L112 336 L100 268 L92 226
                 C78 212 70 236 58 258 L40 250 C52 214 70 186 96 178
                 L96 138 C78 150 66 172 54 196 L36 186 C52 150 78 118 118 112
                 C104 108 96 96 96 80 C96 60 106 44 120 44 Z"
          fill="url(#legGold)" stroke="#6b4610" strokeWidth="2" strokeLinejoin="round" />
        {/* rim light */}
        <path d="M120 44 C136 44 146 56 146 72 C146 88 136 98 121 98 C118 90 116 74 118 60 Z"
          fill="url(#legRim)" />
        {/* ball at trailing foot */}
        <circle cx="118" cy="330" r="20" fill="#fff" stroke="#6b4610" strokeWidth="2" />
        <path d="M118 316 l9 7 -3 11 h-12 l-3 -11z" fill="#1a1a1a" />
        <path d="M118 316v-6M127 323l7-3M124 334l6 8M112 334l-6 8M109 323l-7-3"
          stroke="#1a1a1a" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    </div>
  );
}
