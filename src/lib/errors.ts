// Merkezi hata insanlaştırma — ham PostgREST/Supabase/ağ mesajları kullanıcıya
// ASLA basılmaz (8 dil iddiasının ve güvenin gereği). Ham metin console'a düşer,
// kullanıcı kendi dilinde kısa bir cümle görür.

type TFn = (key: string, vars?: Record<string, string | number>) => string;

const raw = (err: unknown): string =>
  err instanceof Error ? err.message : typeof err === 'string' ? err : String(err ?? '');

export function humanizeError(err: unknown, t: TFn): string {
  const m = raw(err).toLowerCase();
  if (/failed to fetch|networkerror|network request failed|load failed|fetch failed|err_internet/.test(m))
    return t('err.offline');
  if (/statement timeout|57014|canceling statement|timeout|upstream|schema cache|pgrst002|503/.test(m))
    return t('err.busy');   // DB restart/doygunluk (compute resize dahil) = "meşgul, birazdan dene"
  if (/insufficient|yetersiz/.test(m)) return t('err.funds');
  if (m) console.error('[imras]', raw(err));
  return t('err.generic');
}

// Auth yüzeyi: Supabase'in bilinen İngilizce mesajlarını anahtara eşler,
// eşleşmeyen humanizeError'a düşer.
export function mapAuthError(err: unknown, t: TFn): string {
  const m = raw(err).toLowerCase();
  if (/invalid login credentials|invalid.*credentials/.test(m)) return t('auth.badcreds');
  if (/already registered|user.*exists/.test(m)) return t('auth.exists');
  if (/rate limit|too many request/.test(m)) return t('auth.ratelimit');
  if (/already taken/.test(m)) return t('user.taken');
  if (/username must be|3-20/.test(m)) return t('user.invalid');
  return humanizeError(err, t);
}
