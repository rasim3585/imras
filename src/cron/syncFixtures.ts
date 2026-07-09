import type { SupabaseClient } from '@supabase/supabase-js';
import type { FixtureProvider } from '../providers/types';
import { errMsg, errStatus, fixtureRow, logSync } from './_shared';

// Daily (03:00 UTC): pull fixtures for [from, to] and upsert into real_fixtures.
// onConflict (provider,external_id) means re-running is idempotent -- the same
// match seen tomorrow updates in place, and solved lambdas are preserved.
export async function syncFixtures(
  client: SupabaseClient, provider: FixtureProvider, from: Date, to: Date,
): Promise<number> {
  const endpoint = '/api/v2/events/';
  try {
    const fixtures = await provider.fetchFixtures(from, to);
    if (fixtures.length > 0) {
      const rows = fixtures.map((f) => fixtureRow(provider.name, f));
      const { error } = await client.from('real_fixtures').upsert(rows, { onConflict: 'provider,external_id' });
      if (error) throw new Error(error.message);
    }
    await logSync(client, { provider: provider.name, endpoint, http_status: 200, success: true });
    return fixtures.length;
  } catch (e) {
    await logSync(client, { provider: provider.name, endpoint, http_status: errStatus(e), success: false, error_message: errMsg(e) });
    throw e;
  }
}
