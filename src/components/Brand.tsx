// Brand mark — a small "trend line" glyph, reading as analytics/markets rather
// than a game logo. Uses currentColor for the line so it can be recolored.

export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg className="brand-logo" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="22" height="22" rx="6" fill="#3d7bff" fillOpacity="0.14" stroke="#3d7bff" strokeOpacity="0.5" />
      <path d="M6 15.5 L10 11 L13 13.5 L18 7.5" stroke="#6296ff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="18" cy="7.5" r="1.7" fill="#6296ff" />
    </svg>
  );
}

export function Brand({ size = 22 }: { size?: number }) {
  return (
    <span className="brand">
      <LogoMark size={size} />
      <span className="brand-word">pickplay</span>
    </span>
  );
}
