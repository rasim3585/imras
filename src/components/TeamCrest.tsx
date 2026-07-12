import { useId } from 'react';
import { teamMonogram, teamStyle, type CrestPattern } from '../lib/teams';

// Original, generated shield crest for any team (real or virtual). Uses each
// club's real COLOUR PAIR + a signature PATTERN (stripes / hoops / sash / band)
// so it evokes the club — WITHOUT copying the trademarked crest. Unknown teams
// (real BDM fixtures) fall back to a stable solid colour. No assets, no logos.

const SHIELD = 'M16 12 L84 12 L84 54 C84 76 66 90 50 96 C34 90 16 76 16 54 Z';

function Pattern({ p, alt }: { p: CrestPattern; alt: string }) {
  switch (p) {
    case 'vstripes':
      return <>{[22, 38, 54, 70].map((x) => <rect key={x} x={x} y="0" width="8" height="100" fill={alt} />)}</>;
    case 'hoops':
      return <>{[20, 40, 60].map((y) => <rect key={y} x="0" y={y} width="100" height="11" fill={alt} />)}</>;
    case 'sash':
      return <polygon points="0,46 56,6 98,6 98,26 34,80 0,80" fill={alt} />;
    case 'halves':
      return <rect x="50" y="0" width="50" height="100" fill={alt} />;
    case 'band':
      return <rect x="0" y="40" width="100" height="22" fill={alt} />;
    default:
      return null;
  }
}

export default function TeamCrest({ name, size = 28, className }: { name: string; size?: number; className?: string }) {
  const uid = useId();
  const clip = `cr${uid.replace(/:/g, '')}`;
  const { base, alt, pattern, ink } = teamStyle(name);
  const mono = teamMonogram(name);
  const inkFill = ink === 'dark' ? '#17181c' : '#ffffff';
  const inkStroke = ink === 'dark' ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.4)';

  return (
    <svg width={size} height={size} viewBox="0 0 100 100"
      className={`crest ${className ?? ''}`} aria-hidden="true">
      <defs><clipPath id={clip}><path d={SHIELD} /></clipPath></defs>
      <path d={SHIELD} fill={base} stroke="rgba(0,0,0,0.4)" strokeWidth="2.5" />
      <g clipPath={`url(#${clip})`}><Pattern p={pattern} alt={alt} /></g>
      <path d={SHIELD} fill="none" stroke="rgba(0,0,0,0.4)" strokeWidth="2.5" />
      <text x="50" y="52" textAnchor="middle" dominantBaseline="middle"
        fontSize="36" fontWeight="800" fill={inkFill}
        stroke={inkStroke} strokeWidth="1.1" paintOrder="stroke"
        textLength={mono.length > 2 ? 52 : undefined} lengthAdjust="spacingAndGlyphs">{mono}</text>
    </svg>
  );
}
