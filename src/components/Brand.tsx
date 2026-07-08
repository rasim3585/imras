// Brand: a white football (single black pentagon + thin outline) sitting on two
// thin green bars -- the ball is the bowl of the "p", the bars are the stems
// (pp = pickplay). Wordmark: "pick" neutral (theme text), "play" grass green.

const BAR = '#0f6e56';   // deep grass green (reads well on the light theme)
const INK = '#12130f';

function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg className="brand-logo" width={size} height={size * 92 / 80} viewBox="0 0 80 92" aria-label="pickplay" role="img">
      <line x1="26" y1="30" x2="26" y2="84" stroke={BAR} strokeWidth="6.5" strokeLinecap="round" />
      <line x1="37" y1="30" x2="37" y2="84" stroke={BAR} strokeWidth="6.5" strokeLinecap="round" />
      <circle cx="47" cy="27" r="23" fill="#fff" stroke={INK} strokeWidth="1.5" />
      <polygon points="47,15 57,22.3 53.2,34 40.8,34 37,22.3" fill={INK} />
    </svg>
  );
}

export function LogoMark({ size = 26 }: { size?: number }) { return <Logo size={size} />; }
export function LogoMarkLarge({ size = 72 }: { size?: number }) { return <Logo size={size} />; }

export function Wordmark({ size = 20 }: { size?: number }) {
  return (
    <span className="wordmark" style={{ fontSize: size }}>
      <span className="wm-pick">pick</span><span className="wm-play">play</span>
    </span>
  );
}

/** Default brand lockup for the top bar: icon + wordmark. */
export function Brand({ size = 20 }: { size?: number }) {
  return (
    <span className="brand">
      <LogoMark size={26} />
      <Wordmark size={size} />
    </span>
  );
}
