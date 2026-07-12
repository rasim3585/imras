import { useId } from 'react';
import { teamColor, teamMonogram, teamHash } from '../lib/teams';

// Original, generated shield crest for any team (real or virtual). Team colour +
// a deterministic tonal pattern + monogram. No official logos → no trademark risk,
// no asset management, works for every team name. The monogram carries a dark
// paint-order stroke so it stays legible on light colours (e.g. Dortmund yellow).

const SHIELD = 'M16 12 L84 12 L84 54 C84 76 66 90 50 96 C34 90 16 76 16 54 Z';

export default function TeamCrest({ name, size = 28, className }: { name: string; size?: number; className?: string }) {
  const uid = useId();
  const clip = `cr${uid.replace(/:/g, '')}`;
  const primary = teamColor(name);
  const mono = teamMonogram(name);
  const v = teamHash(name) % 4;

  return (
    <svg width={size} height={size} viewBox="0 0 100 100"
      className={`crest ${className ?? ''}`} aria-hidden="true">
      <defs><clipPath id={clip}><path d={SHIELD} /></clipPath></defs>
      <path d={SHIELD} fill={primary} stroke="rgba(0,0,0,0.38)" strokeWidth="2.5" />
      <g clipPath={`url(#${clip})`}>
        {v === 0 && <rect x="0" y="12" width="100" height="26" fill="rgba(255,255,255,0.17)" />}
        {v === 1 && <rect x="0" y="0" width="50" height="100" fill="rgba(0,0,0,0.16)" />}
        {v === 2 && <polygon points="0,44 56,4 96,4 96,24 34,78 0,78" fill="rgba(255,255,255,0.18)" />}
        {v === 3 && <rect x="0" y="66" width="100" height="34" fill="rgba(0,0,0,0.18)" />}
      </g>
      <text x="50" y="52" textAnchor="middle" dominantBaseline="middle"
        fontSize="36" fontWeight="800" fill="#fff"
        stroke="rgba(0,0,0,0.4)" strokeWidth="1.1" paintOrder="stroke"
        textLength={mono.length > 2 ? 52 : undefined} lengthAdjust="spacingAndGlyphs">{mono}</text>
    </svg>
  );
}
