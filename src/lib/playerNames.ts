// Nesine-style hybrid label: a real club name + the (virtual) player who is
// "playing" it, e.g. "Liverpool (Vangogh)". Deterministic per match+side so it
// stays stable across renders/reloads. Purely cosmetic -- never touches the
// score, odds or settlement.
const POOL = [
  'Alexander', 'Lucas', 'Vangogh', 'Misterx', 'Leonardo', 'Andrew', 'Cleo', 'Bruno',
  'Noah', 'Adriano', 'Kaan', 'Deniz', 'Emir', 'Marco', 'Diego', 'Rafael', 'Yusuf',
  'Onur', 'Viktor', 'Sergio', 'Pablo', 'Mert', 'Can', 'Baran', 'Ferro', 'Nando',
];

export function playerName(seed: string): string {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return POOL[h % POOL.length];
}
