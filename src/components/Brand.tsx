// Brand: a white football (black outline) with a single RED centre pentagon.
// Wordmark: "pick" red + "play" white (black-outlined), tightly interlocked.

const INK = '#111311';
const GREEN = '#12a150';
// regular pentagon, point-up, centred (32,33) r≈15.5
const PENTA = '32,17.5 46.7,28.2 41.1,45.5 22.9,45.5 17.3,28.2';

function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg className="brand-logo" width={size} height={size} viewBox="0 0 64 64" aria-label="pickplay" role="img">
      <circle cx="32" cy="32" r="28" fill="#fff" stroke={INK} strokeWidth="4.5" />
      <polygon points={PENTA} fill={GREEN} stroke={INK} strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

export function LogoMark({ size = 30 }: { size?: number }) { return <Logo size={size} />; }
export function LogoMarkLarge({ size = 76 }: { size?: number }) { return <Logo size={size} />; }

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
      <LogoMark size={30} />
      <Wordmark size={size} />
    </span>
  );
}
