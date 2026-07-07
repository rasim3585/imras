import { createClient } from '@supabase/supabase-js';

// Vite exposes only VITE_-prefixed vars to the client. The anon key is safe in
// the browser by design — row-level security is what protects the data.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** True when both env vars are present. Screens can show a setup hint instead
 *  of exploding when the project hasn't been wired to Supabase yet. */
export const isSupabaseConfigured = Boolean(url && anonKey);

if (!isSupabaseConfigured) {
  // Loud in dev, harmless in prod — helps whoever runs this locally.
  console.warn(
    '[pickplay] Supabase is not configured. Copy .env.example to .env and fill ' +
      'in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
  );
}

// Fall back to harmless placeholders so importing this module never throws;
// any real call will fail clearly instead, and isSupabaseConfigured gates the UI.
export const supabase = createClient(
  url ?? 'http://localhost:54321',
  anonKey ?? 'public-anon-key-placeholder',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);
