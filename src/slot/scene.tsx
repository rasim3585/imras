// Original pitch scene furniture for Gates of Goal — our own art: a corner flag
// planted in the turf. The goal frame, net, grass and touchlines are pure CSS
// on the stage itself (see index.css .go-pitch / .go-goal / .go-net).

/** A corner flag — pole + triangular pennant that waves. Decorative. */
export function CornerFlag({ side = 'left' }: { side?: 'left' | 'right' }) {
  return (
    <div className={`go-flag go-flag-${side}`} aria-hidden="true">
      <svg viewBox="0 0 60 90" className="go-flag-svg">
        <defs>
          <linearGradient id="flagRed" x1="0" y1="0" x2="1" y2="0.3">
            <stop offset="0" stopColor="#ff6a5a" /><stop offset="1" stopColor="#d61f2b" />
          </linearGradient>
        </defs>
        {/* pole */}
        <rect x="27" y="6" width="5" height="80" rx="2.5" fill="#e9edf1" stroke="#9aa4ad" strokeWidth="1" />
        <circle cx="29.5" cy="6" r="4" fill="#f3c73f" stroke="#8a5a12" strokeWidth="1" />
        {/* pennant */}
        <path className="go-flag-cloth" d="M32 10 L58 17 Q46 22 58 29 L32 34 Z"
          fill="url(#flagRed)" stroke="#8a1119" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
