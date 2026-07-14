/** Human "when does this kick off" label, relative to now.
 *  "starting now" only within a ±10 min window — an older timestamp is a data
 *  gap, and showing the real date/time is honest; a same-day future kickoff
 *  shows the clock time, other days show day + time.
 *  Pass the i18n t() so relative words localize; without it English fallback.
 *  (0715 denetim: TR arayüzde 'in 3h 15m' İngilizce kalıyordu.) */
export function formatKickoff(iso: string, t?: (key: string, vars?: Record<string, string | number>) => string): string {
  const d = new Date(iso);
  const ms = d.getTime() - Date.now();
  const tr = (key: string, vars: Record<string, string | number>, fb: string) => (t ? t(key, vars) : fb);
  if (ms <= 0) {
    if (ms > -10 * 60000) return tr('kick.now', {}, 'starting now');
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
      + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  const mins = Math.round(ms / 60000);
  if (mins < 60) return tr('kick.inmin', { n: mins }, `in ${mins} min`);
  if (mins < 8 * 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? tr('kick.inhm', { h, m }, `in ${h}h ${m}m`) : tr('kick.inh', { h }, `in ${h}h`);
  }
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return time;
  return d.toLocaleDateString(undefined, { weekday: 'short' }) + ' ' + time;
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
