// Minimal line icons (currentColor, 20px grid). No emoji anywhere in the app.

export function MarketsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 19V10M9 19V5M14 19v-6M19 19v-9" />
    </svg>
  );
}

// Gerçek futbol ikonu = MARKA topu (beyaz top + yeşil beşgen). Eski nötr çizgi
// top gerçek maç kimliğini taşımıyordu — gerçek maç her yerde bu topla anılır.
export function BallIcon({ size }: { size?: number } = {}) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="27" fill="#ffffff" stroke="#111311" strokeWidth="5" />
      <polygon points="32,17.5 46.7,28.2 41.1,45.5 22.9,45.5 17.3,28.2"
        fill="#12a150" stroke="#111311" strokeWidth="1.5" strokeLinejoin="round" />
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

// e-Volleyball: same gamepad but a volleyball on top. Original art.
export function EVolleyballIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {/* volleyball on top */}
      <circle cx="12" cy="5.4" r="3.8" fill="#fdfdfd" stroke="#0b2c1f" strokeWidth="1" />
      <path d="M12 1.7q-3 2-3.4 7.4M12 1.7q3 2 3.4 7.4M8.3 6.6q3.7-1.4 7.4 0"
        fill="none" stroke="#2f7cf0" strokeWidth="0.8" strokeLinecap="round" />
      {/* gamepad */}
      <path d="M7 11.4 Q3.3 11.4 2.7 15.4 L2 19 Q1.7 21.7 4.5 21.7 Q6.5 21.7 7.4 19.7 L8.3 17.9 L15.7 17.9 L16.6 19.7 Q17.5 21.7 19.5 21.7 Q22.3 21.7 22 19 L21.3 15.4 Q20.7 11.4 17 11.4 Z" fill="#2f6fd0" />
      <rect x="6" y="14" width="1.7" height="4.6" rx="0.7" fill="#0b1f3a" />
      <rect x="4.55" y="15.45" width="4.6" height="1.7" rx="0.7" fill="#0b1f3a" />
      <circle cx="16.1" cy="15.3" r="1.05" fill="#0b1f3a" /><circle cx="18.2" cy="16.6" r="1.05" fill="#0b1f3a" />
    </svg>
  );
}

// Sanal para: TEK kağıt banknot — sikke yığını "bozuk para" okunuyordu.
export function CoinIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="1.6" y="6.4" width="20.8" height="11.2" rx="1.8" fill="#12a150" stroke="#0b6e39" strokeWidth="1.2" />
      <rect x="3.8" y="8.5" width="16.4" height="7" rx="1" fill="none" stroke="#eefaf2" strokeWidth="0.9" opacity="0.75" />
      <circle cx="12" cy="12" r="2.9" fill="#0e8f47" stroke="#eefaf2" strokeWidth="0.9" />
      <path d="M12 10.5v3M12.9 11h-1.3a0.75 0.75 0 0 0 0 1.5h0.8a0.75 0.75 0 0 1 0 1.5h-1.4"
        fill="none" stroke="#eefaf2" strokeWidth="0.85" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="6" cy="12" r="0.85" fill="#eefaf2" opacity="0.85" />
      <circle cx="18" cy="12" r="0.85" fill="#eefaf2" opacity="0.85" />
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

export function SettingsIcon() {
  // standart dişli çark (eski hâli güneş gibi okunuyordu)
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3.1" />
      <path d="M19.4 13.4a7.8 7.8 0 0 0 0-2.8l2.1-1.6-2-3.4-2.5.9a7.8 7.8 0 0 0-2.4-1.4L14.1 2.4h-4l-.5 2.7a7.8 7.8 0 0 0-2.4 1.4l-2.5-.9-2 3.4 2.1 1.6a7.8 7.8 0 0 0 0 2.8l-2.1 1.6 2 3.4 2.5-.9a7.8 7.8 0 0 0 2.4 1.4l.5 2.7h4l.5-2.7a7.8 7.8 0 0 0 2.4-1.4l2.5.9 2-3.4z" />
    </svg>
  );
}

export function SoundOnIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 9v6h3.5L13 20V4L7.5 9H4z" />
      <path d="M16.5 8.5a5 5 0 0 1 0 7M18.8 6a8 8 0 0 1 0 12" />
    </svg>
  );
}

export function SoundOffIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 9v6h3.5L13 20V4L7.5 9H4z" />
      <path d="M17 9.5l4 5M21 9.5l-4 5" />
    </svg>
  );
}

// Ayna/analiz: el aynası — desenini yansıtan yüzey.
export function MirrorIcon() {
  // AI kıvılcımları — "yapay zekâ bahis karakterini analiz eder"
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3.2 13.7 8l4.8 1.7-4.8 1.7L12 16.2l-1.7-4.8L5.5 9.7 10.3 8z" />
      <path d="M18.6 14.6l.75 2.05 2.05.75-2.05.75-.75 2.05-.75-2.05-2.05-.75 2.05-.75z" />
      <path d="M5.2 15.8l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z" />
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

// Gates of: Olimpos tapınağı — alınlık + sütunlar. Brand-free.
export function GatesIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 7.5 12 3l8.5 4.5" />
      <path d="M4.5 7.5h15" />
      <path d="M6 10v7.5M10 10v7.5M14 10v7.5M18 10v7.5" />
      <path d="M4 20.5h16M5 18h14" />
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

export function DiceIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="3.5" />
      <circle cx="9" cy="9" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="9" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="9" cy="15" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="15" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function MinesIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="13" r="6" />
      <path d="M12 7V4M18 13h2M4 13h2M16.5 8.5l1.5-1.5" />
      <path d="M18 6l1.5-1.5" />
    </svg>
  );
}

export function PlinkoIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="7" r="1" fill="currentColor" stroke="none" />
      <circle cx="16" cy="7" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="11" r="1" fill="currentColor" stroke="none" />
      <circle cx="7" cy="11" r="1" fill="currentColor" stroke="none" />
      <circle cx="17" cy="11" r="1" fill="currentColor" stroke="none" />
      <path d="M12 3 C11 6 9 8 8 11 C7 14 12 15 12 19" />
      <path d="M5 20h14" />
    </svg>
  );
}
