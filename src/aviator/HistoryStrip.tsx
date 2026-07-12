import type { AviatorRound } from '../lib/aviator';
import { multClass } from '../lib/aviator';

// Last ~12 crashed rounds, newest first. Colour-coded by crash multiplier:
// <2x red, <10x green, >=10x purple. crash_point is safe here -- these rounds
// are already over.
export default function HistoryStrip({ rounds }: { rounds: AviatorRound[] }) {
  if (rounds.length === 0) return null;
  return (
    <div className="av-history" aria-label="Son turlar">
      {rounds.map((r) => (
        <span key={String(r.id)} className={`av-hchip ${r.crash_point != null ? multClass(r.crash_point) : ''}`}>
          {r.crash_point != null ? `${r.crash_point.toFixed(2)}x` : '—'}
        </span>
      ))}
    </div>
  );
}
