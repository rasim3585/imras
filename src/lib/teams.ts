// Team identity for the initial badges. Real colours for known clubs; a stable
// hash-derived HSL for anything else, so the same team is always the same
// colour. Purely cosmetic. (Real crests are a Phase 2 / API concern.)

const TEAM_COLORS: Record<string, string> = {
  Arsenal: '#ef0107', 'Aston Villa': '#670e36', Bayern: '#d40000',
  Barcelona: '#004d98', Benfica: '#e00000', Brighton: '#0057b8',
  Celtic: '#018749', Chelsea: '#034694', Dortmund: '#fde100',
  Everton: '#003399', Inter: '#0a67b1', Juventus: '#000000',
  Leeds: '#1d428a', Leipzig: '#dd0741', Leverkusen: '#e32219',
  Liverpool: '#c8102e', Lyon: '#1e3a8a', 'Man City': '#6cabdd',
  'Man United': '#da291c', Marseille: '#2faee0', Milan: '#fb090b',
  Napoli: '#12a0d7', Newcastle: '#241f20', PSG: '#004170',
  Porto: '#00428c', 'Real Madrid': '#00529f', Roma: '#8e1f2f',
  Sevilla: '#d81920', Tottenham: '#132257', Valencia: '#ee3524',
  Villarreal: '#ffd200', Ajax: '#d2122e', Atletico: '#cb3524',
  'West Ham': '#6a1f2e',
};

export function teamColor(name: string): string {
  const known = TEAM_COLORS[name];
  if (known) return known;
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 55% 42%)`;
}

/** First letter for the badge. */
export function teamInitial(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase();
}

/** 2–3 char monogram for the crest: word initials for multi-word names
 *  ("Man City" → "MC", "Real Madrid" → "RM"), else first 3 letters ("Arsenal" → "ARS"). */
export function teamMonogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return words.slice(0, 3).map((w) => w[0]).join('').toUpperCase();
  return (words[0] ?? '?').slice(0, 3).toUpperCase();
}

/** Stable small hash of a name, for deterministic crest pattern choice. */
export function teamHash(name: string): number {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}
