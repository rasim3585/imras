import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { BSDProvider } from '../providers/bsd';

// Single place env is read + the Supabase (service-role) client and BSD provider
// are built. runner.ts and once.ts both use this -- no duplicated env reading.
// A missing required var fails LOUD (clear message + exit 1), never a silent
// undefined.

function requireEnv(keys: string[]): void {
  const missing = keys.filter((k) => !process.env[k]);
  if (missing.length === 0) return;
  console.error(`\nMissing required env: ${missing.join(', ')}`);
  if (missing.includes('SUPABASE_URL')) console.error('  SUPABASE_URL              -> Supabase Dashboard > Settings > API (Project URL)');
  if (missing.includes('SUPABASE_SERVICE_ROLE_KEY')) console.error('  SUPABASE_SERVICE_ROLE_KEY -> Supabase Dashboard > Settings > API Keys > service_role');
  if (missing.includes('BSD_API_KEY')) console.error('  BSD_API_KEY               -> your BSD token');
  process.exit(1);
}

export function makeClient(): SupabaseClient {
  requireEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
  return createClient(process.env.SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string, {
    auth: { persistSession: false },
  });
}

export function makeProvider(): BSDProvider {
  requireEnv(['BSD_API_KEY']);
  return new BSDProvider({ apiKey: process.env.BSD_API_KEY as string, baseUrl: process.env.BSD_BASE_URL });
}
