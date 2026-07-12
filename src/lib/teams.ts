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

// --- Crest style: real colour pairs + signature pattern per club -------------
// Evokes the real club (legal: colours + generic patterns, NOT the trademarked
// crest). `base` = shield colour, `alt` = accent, `ink` = monogram tone.
export type CrestPattern = 'solid' | 'vstripes' | 'hoops' | 'sash' | 'halves' | 'band';
export interface CrestStyle { base: string; alt: string; pattern: CrestPattern; ink: 'light' | 'dark'; }

const TEAM_STYLE: Record<string, CrestStyle> = {
  'Man City':   { base: '#6cabdd', alt: '#1c2c5b', pattern: 'solid',    ink: 'dark' },
  'Real Madrid':{ base: '#f4f4f6', alt: '#00529f', pattern: 'band',     ink: 'dark' },
  Bayern:       { base: '#dc052d', alt: '#0066b2', pattern: 'solid',    ink: 'light' },
  Liverpool:    { base: '#c8102e', alt: '#00b2a9', pattern: 'solid',    ink: 'light' },
  Barcelona:    { base: '#a50044', alt: '#004d98', pattern: 'vstripes', ink: 'light' },
  PSG:          { base: '#0a2452', alt: '#da291c', pattern: 'band',     ink: 'light' },
  Inter:        { base: '#0a67b1', alt: '#08090b', pattern: 'vstripes', ink: 'light' },
  Arsenal:      { base: '#ef0107', alt: '#f5f5f5', pattern: 'sash',     ink: 'light' },
  'Man United': { base: '#da291c', alt: '#ffe500', pattern: 'solid',    ink: 'light' },
  Chelsea:      { base: '#034694', alt: '#f5f5f5', pattern: 'solid',    ink: 'light' },
  Atletico:     { base: '#cb3524', alt: '#f5f5f5', pattern: 'vstripes', ink: 'light' },
  Napoli:       { base: '#12a0d7', alt: '#f5f5f5', pattern: 'solid',    ink: 'light' },
  Leverkusen:   { base: '#e32219', alt: '#08090b', pattern: 'band',     ink: 'light' },
  Dortmund:     { base: '#fde100', alt: '#08090b', pattern: 'band',     ink: 'dark' },
  Tottenham:    { base: '#eef0f4', alt: '#132257', pattern: 'solid',    ink: 'dark' },
  Juventus:     { base: '#08090b', alt: '#f5f5f5', pattern: 'vstripes', ink: 'light' },
  Milan:        { base: '#fb090b', alt: '#08090b', pattern: 'vstripes', ink: 'light' },
  Newcastle:    { base: '#08090b', alt: '#f5f5f5', pattern: 'vstripes', ink: 'light' },
  'Aston Villa':{ base: '#670e36', alt: '#95bfe5', pattern: 'band',     ink: 'light' },
  Benfica:      { base: '#e00000', alt: '#f5f5f5', pattern: 'solid',    ink: 'light' },
  Porto:        { base: '#00428c', alt: '#f5f5f5', pattern: 'vstripes', ink: 'light' },
  Brighton:     { base: '#0057b8', alt: '#f5f5f5', pattern: 'vstripes', ink: 'light' },
  'West Ham':   { base: '#7a263a', alt: '#1bb1e7', pattern: 'band',     ink: 'light' },
  Villarreal:   { base: '#ffd200', alt: '#005187', pattern: 'solid',    ink: 'dark' },
  Roma:         { base: '#8e1f2f', alt: '#f0bc42', pattern: 'band',     ink: 'light' },
  Leipzig:      { base: '#dd0741', alt: '#001f47', pattern: 'solid',    ink: 'light' },
  Ajax:         { base: '#f4f4f6', alt: '#d2122e', pattern: 'band',     ink: 'dark' },
  Marseille:    { base: '#2faee0', alt: '#f5f5f5', pattern: 'solid',    ink: 'dark' },
  Sevilla:      { base: '#d81920', alt: '#f5f5f5', pattern: 'solid',    ink: 'light' },
  Lyon:         { base: '#f4f4f6', alt: '#da291c', pattern: 'band',     ink: 'dark' },
  Celtic:       { base: '#018749', alt: '#f5f5f5', pattern: 'hoops',    ink: 'light' },
  Everton:      { base: '#003399', alt: '#f5f5f5', pattern: 'solid',    ink: 'light' },
  Valencia:     { base: '#eef0f4', alt: '#ee3524', pattern: 'band',     ink: 'dark' },
  Leeds:        { base: '#eef0f4', alt: '#1d428a', pattern: 'band',     ink: 'dark' },
};

/** Crest style for a team: real club colours+pattern if known, else a stable
 *  hash-derived solid (real BDM fixtures fall here). */
export function teamStyle(name: string): CrestStyle {
  const s = TEAM_STYLE[name];
  if (s) return s;
  return { base: teamColor(name), alt: 'rgba(0,0,0,0.26)', pattern: 'solid', ink: 'light' };
}
