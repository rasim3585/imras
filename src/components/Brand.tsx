// Brand: a white football (black outline) with a single GREEN centre pentagon,
// next to the "pickplay" wordmark (Montserrat). The ball height is tied to the
// wordmark (em) and vertical-aligned so it spans the p descender up to the k/l
// ascender.

const INK = '#111311';
const GREEN = '#12a150';
// regular pentagon, point-up, centred (32,33) r≈15.5
const PENTA = '32,17.5 46.7,28.2 41.1,45.5 22.9,45.5 17.3,28.2';

function Ball(props: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 64 64" aria-label="pickplay" role="img" {...props}>
      <circle cx="32" cy="32" r="28" fill="#fff" stroke={INK} strokeWidth="4.5" />
      <polygon points={PENTA} fill={GREEN} stroke={INK} strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

// Standalone marks (fixed px) — used outside the lockup (e.g. auth hero).
export function LogoMark({ size = 30 }: { size?: number }) { return <Ball style={{ width: size, height: size, display: 'block' }} />; }
export function LogoMarkLarge({ size = 76 }: { size?: number }) { return <Ball style={{ width: size, height: size, display: 'block' }} />; }

export function Wordmark({ size = 26 }: { size?: number }) {
  return (
    <span className="wordmark" style={{ fontSize: size }}>
      <span className="wm-pick">pick</span><span className="wm-play">play</span>
    </span>
  );
}

/** Default brand lockup for the top bar: ball + wordmark, height-aligned. */
export function Brand({ size = 26 }: { size?: number }) {
  return (
    <span className="brand" style={{ fontSize: size }}>
      <Ball className="brand-ball" />
      <span className="wordmark"><span className="wm-pick">pick</span><span className="wm-play">play</span></span>
    </span>
  );
}
