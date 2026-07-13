/** Human "when does this kick off" label, relative to now. */
export function formatKickoff(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'starting now';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `in ${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `in ${h}h ${m}m` : `in ${h}h`;
}

/** Accuracy as a whole percentage; 0 when there are no predictions yet. */
export function accuracyPct(correct: number, total: number): number {
  return total === 0 ? 0 : Math.round((correct / total) * 100);
}

/** Decimal odds, always two places (e.g. 1.85). Informational only. */
export function formatOdds(n: number): string {
  return n.toFixed(2);
}

/** Live basketball clock: quarter + minutes into that quarter, e.g. "Q3 6'".
 *  Game minute is 0..48 (four 12-minute quarters); period ("Q1".."Q4") comes
 *  from the server, with a fallback derived from the minute. */
export function bballClock(minute: number | null, period?: string | null): string {
  const min = minute ?? 0;
  const q = period || `Q${Math.min(4, Math.floor(min / 12) + 1)}`;
  const base = (parseInt(q.replace(/\D/g, ''), 10) || 1) - 1;
  const inQ = Math.max(0, Math.min(12, min - base * 12));
  return `${q} ${inQ}'`;
}

/** Market-style implied probability (%) for one option, normalised across the
 *  market's options so they read like a book summing to ~100%. Display only. */
export function impliedProb(odds: number, allOdds: number[]): number {
  const sum = allOdds.reduce((acc, o) => acc + 1 / o, 0);
  return Math.round((1 / odds / sum) * 100);
}
