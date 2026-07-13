// Minimal line icons (currentColor, 20px grid). No emoji anywhere in the app.

export function MarketsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 19V10M9 19V5M14 19v-6M19 19v-9" />
    </svg>
  );
}

export function BallIcon({ size }: { size?: number } = {}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
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

// E-Football: ONE clear gamepad with a football above it (virtual football).
export function EFootballIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {/* football on top (brand red pentagon) */}
      <circle cx="12" cy="5.4" r="3.8" fill="#fff" stroke="#0f3d2b" strokeWidth="1" />
      <polygon points="12,2.9 14.1,4.4 13.3,6.9 10.7,6.9 9.9,4.4" fill="#e01e26" />
      {/* gamepad */}
      <path d="M7 11.4 Q3.3 11.4 2.7 15.4 L2 19 Q1.7 21.7 4.5 21.7 Q6.5 21.7 7.4 19.7 L8.3 17.9 L15.7 17.9 L16.6 19.7 Q17.5 21.7 19.5 21.7 Q22.3 21.7 22 19 L21.3 15.4 Q20.7 11.4 17 11.4 Z" fill="#1d9e75" />
      {/* d-pad + action buttons */}
      <rect x="6" y="14" width="1.7" height="4.6" rx="0.7" fill="#0b2c1f" />
      <rect x="4.55" y="15.45" width="4.6" height="1.7" rx="0.7" fill="#0b2c1f" />
      <circle cx="16.1" cy="15.3" r="1.05" fill="#0b2c1f" /><circle cx="18.2" cy="16.6" r="1.05" fill="#0b2c1f" />
    </svg>
  );
}

// e-Basketball: same gamepad as E-Football but a basketball on top (virtual
// basketball). Original art — not a team/league logo.
export function EBasketballIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {/* basketball on top */}
      <circle cx="12" cy="5.4" r="3.8" fill="#f0872f" stroke="#0b2c1f" strokeWidth="1" />
      <path d="M12 1.7v7.4M8.2 5.4h7.6M9.5 2.5Q12 5.4 9.5 8.3M14.5 2.5Q12 5.4 14.5 8.3"
        fill="none" stroke="#0b2c1f" strokeWidth="0.75" strokeLinecap="round" />
      {/* gamepad */}
      <path d="M7 11.4 Q3.3 11.4 2.7 15.4 L2 19 Q1.7 21.7 4.5 21.7 Q6.5 21.7 7.4 19.7 L8.3 17.9 L15.7 17.9 L16.6 19.7 Q17.5 21.7 19.5 21.7 Q22.3 21.7 22 19 L21.3 15.4 Q20.7 11.4 17 11.4 Z" fill="#e07b2a" />
      {/* d-pad + action buttons */}
      <rect x="6" y="14" width="1.7" height="4.6" rx="0.7" fill="#3a1c08" />
      <rect x="4.55" y="15.45" width="4.6" height="1.7" rx="0.7" fill="#3a1c08" />
      <circle cx="16.1" cy="15.3" r="1.05" fill="#3a1c08" /><circle cx="18.2" cy="16.6" r="1.05" fill="#3a1c08" />
    </svg>
  );
}

// e-Tennis: same gamepad but a tennis ball on top (virtual tennis). Original art.
export function ETennisIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {/* tennis ball on top */}
      <circle cx="12" cy="5.4" r="3.8" fill="#d7e600" stroke="#0b2c1f" strokeWidth="1" />
      <path d="M8.4 3.2Q11 5.4 8.4 7.6M15.6 3.2Q13 5.4 15.6 7.6" fill="none" stroke="#fff" strokeWidth="0.9" strokeLinecap="round" />
      {/* gamepad */}
      <path d="M7 11.4 Q3.3 11.4 2.7 15.4 L2 19 Q1.7 21.7 4.5 21.7 Q6.5 21.7 7.4 19.7 L8.3 17.9 L15.7 17.9 L16.6 19.7 Q17.5 21.7 19.5 21.7 Q22.3 21.7 22 19 L21.3 15.4 Q20.7 11.4 17 11.4 Z" fill="#3f7d2a" />
      <rect x="6" y="14" width="1.7" height="4.6" rx="0.7" fill="#0b2c1f" />
      <rect x="4.55" y="15.45" width="4.6" height="1.7" rx="0.7" fill="#0b2c1f" />
      <circle cx="16.1" cy="15.3" r="1.05" fill="#0b2c1f" /><circle cx="18.2" cy="16.6" r="1.05" fill="#0b2c1f" />
    </svg>
  );
}

// Virtual-money coin (green) — replaces the gold dot / coin emoji. Original art.
export function CoinIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="#12a150" />
      <circle cx="12" cy="12" r="10" fill="none" stroke="#0b6e39" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="6.2" fill="none" stroke="#dff5e7" strokeWidth="1.4" opacity="0.9" />
      <path d="M12 8.3v7.4M13.6 9.9h-2.3a1.5 1.5 0 0 0 0 3h1.4a1.5 1.5 0 0 1 0 3h-2.5"
        fill="none" stroke="#eefaf2" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20h14V9.5" />
      <path d="M9.5 20v-6h5v6" />
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

// Gates of Goal: a reel grid (slot). Brand-free.
export function GatesIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M3 9.5h18M3 14.5h18M9 4v16M15 4v16" />
    </svg>
  );
}

// Aviator: a ball riding a rising trail (crash game). Brand-free.
export function AviatorIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 20 C8 19 13 14 18 6" strokeDasharray="2.5 2.5" />
      <circle cx="18.5" cy="5.5" r="2.6" />
    </svg>
  );
}
