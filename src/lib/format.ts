import type { Outcome } from './types';

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

/** How each outcome reads in the UI, given the two team names. */
export function outcomeLabel(o: Outcome, home: string, away: string): string {
  if (o === 'home') return home;
  if (o === 'away') return away;
  return 'Draw';
}
