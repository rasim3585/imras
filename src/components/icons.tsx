// Minimal line icons (currentColor, 20px grid). No emoji anywhere in the app.

export function MarketsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 19V10M9 19V5M14 19v-6M19 19v-9" />
    </svg>
  );
}

export function BallIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.3l3.4 2.5-1.3 4h-4.2l-1.3-4z" />
      <path d="M12 7.3V4M15.4 9.8l2.9-1M14.1 13.8l1.8 2.7M9.9 13.8l-1.8 2.7M8.6 9.8l-2.9-1" />
    </svg>
  );
}

export function RedCardIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="7" y="4" width="10" height="16" rx="2" fill="currentColor" />
    </svg>
  );
}

export function WhistleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 10h11a4 4 0 1 1-4 4v-2H4z" />
      <path d="M15 8V5h4" />
    </svg>
  );
}

export function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13 3 5 13h6l-1 8 8-10h-6z" />
    </svg>
  );
}

export function CouponIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v3a2 2 0 0 0 0 4v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-3a2 2 0 0 0 0-4z" />
      <path d="M12 6.5v11" strokeDasharray="2 2" />
    </svg>
  );
}

export function EFootballIcon({ size = 22 }: { size?: number }) {
  const pad = 'M6 4 Q2 4 1.5 9 L0.5 17 Q0 21 4 21 Q6.5 21 7.5 18 L9 14 L15 14 L16.5 18 Q17.5 21 20 21 Q24 21 23.5 17 L22.5 9 Q22 4 18 4 Z';
  return (
    <svg width={size} height={size * 40 / 52} viewBox="0 0 52 40" aria-hidden="true">
      <g transform="translate(2,8) rotate(-12 12 12)">
        <path d={pad} fill="#2fbf6f" />
        <rect x="9" y="8" width="2.2" height="6" rx="1" fill="#0f3d2b" />
        <rect x="7" y="10" width="6" height="2.2" rx="1" fill="#0f3d2b" />
        <circle cx="17" cy="9.5" r="1.3" fill="#0f3d2b" /><circle cx="19.5" cy="12" r="1.3" fill="#0f3d2b" />
      </g>
      <g transform="translate(28,8) rotate(12 12 12)">
        <path d={pad} fill="#1d9e75" />
        <rect x="9" y="8" width="2.2" height="6" rx="1" fill="#0f3d2b" />
        <rect x="7" y="10" width="6" height="2.2" rx="1" fill="#0f3d2b" />
        <circle cx="17" cy="9.5" r="1.3" fill="#0f3d2b" /><circle cx="19.5" cy="12" r="1.3" fill="#0f3d2b" />
      </g>
      <circle cx="26" cy="20" r="7" fill="#fff" stroke="#0f3d2b" strokeWidth="1" />
      <polygon points="26,16 28.5,17.8 27.5,20.8 24.5,20.8 23.5,17.8" fill="#0f3d2b" />
    </svg>
  );
}

export function SocialIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
      <path d="M16 6.2a3 3 0 0 1 0 5.6M17.5 19a5.5 5.5 0 0 0-3-4.9" />
    </svg>
  );
}

export function RanksIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="12" width="4" height="8" rx="1" />
      <rect x="10" y="6" width="4" height="14" rx="1" />
      <rect x="16" y="9" width="4" height="11" rx="1" />
    </svg>
  );
}

export function ProfileIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5.5 19a6.5 6.5 0 0 1 13 0" />
    </svg>
  );
}
