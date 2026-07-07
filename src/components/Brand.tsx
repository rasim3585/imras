// Brand: concentric black/off-white rings (dart target + referee jersey) with a
// red bullseye ("hitting dead centre" = calling it exactly right). Colours are
// FIXED regardless of theme — black #0a0a0a, off-white #f4f4f0, red #e0231c.

const BLACK = '#0a0a0a';
const CREAM = '#f4f4f0';
const RED = '#e0231c';

/** Clean small mark (nav, app icon) — fewer rings so it stays crisp. */
export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg className="brand-logo" width={size} height={size} viewBox="0 0 100 100" aria-label="pickplay">
      <circle cx="50" cy="50" r="46" fill={CREAM} stroke={BLACK} strokeWidth="4" />
      <circle cx="50" cy="50" r="36" fill={BLACK} />
      <circle cx="50" cy="50" r="26" fill={CREAM} />
      <circle cx="50" cy="50" r="14" fill={RED} />
    </svg>
  );
}

/** Full mark (hero / splash) — more rings, more detail. */
export function LogoMarkLarge({ size = 88 }: { size?: number }) {
  return (
    <svg className="brand-logo" width={size} height={size} viewBox="0 0 100 100" aria-label="pickplay">
      <circle cx="50" cy="50" r="46" fill={CREAM} stroke={BLACK} strokeWidth="3" />
      <circle cx="50" cy="50" r="37" fill={BLACK} />
      <circle cx="50" cy="50" r="29" fill={CREAM} />
      <circle cx="50" cy="50" r="21" fill={BLACK} />
      <circle cx="50" cy="50" r="13" fill={CREAM} />
      <circle cx="50" cy="50" r="7" fill={RED} />
    </svg>
  );
}

/** Wordmark: "pickplay" where the first "i" dot is a tiny target. */
export function Wordmark({ size = 18 }: { size?: number }) {
  return (
    <span className="wordmark" style={{ fontSize: size }}>
      <span>p</span>
      <span className="wm-i" aria-hidden="true">
        <svg width="0.32em" height="0.32em" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="46" fill={CREAM} stroke={BLACK} strokeWidth="5" />
          <circle cx="50" cy="50" r="34" fill={BLACK} />
          <circle cx="50" cy="50" r="22" fill={CREAM} />
          <circle cx="50" cy="50" r="11" fill={RED} />
        </svg>
        <span className="stem">ı</span>
      </span>
      <span>ckplay</span>
    </span>
  );
}

/** Default brand lockup for the top bar. */
export function Brand({ size = 18 }: { size?: number }) {
  return <Wordmark size={size} />;
}
