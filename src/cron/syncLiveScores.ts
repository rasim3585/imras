import type { SupabaseClient } from '@supabase/supabase-js';
import type { FixtureProvider } from '../providers/types';
import { errMsg, errStatus, logSync } from './_shared';

// Every ~30s: pull in-progress fixtures and update score/minute/status. We do
// NOT pull live odds -- the SQL engine (_market_odds_ft_real) reprices from the
// stored lambda the instant the score changes, so there is zero odds lag. If no
// match is live the provider returns [] and this is a cheap no-op.
export async function syncLiveScores(client: SupabaseClient, provider: FixtureProvider): Promise<number> {
  const endpoint = '/api/v2/events/live/';
  try {
    const live = await provider.fetchLiveFixtures();
    for (const f of live) {
      await client.from('real_fixtures').update({
        status: f.status,
        period: f.period,
        current_minute: f.currentMinute,
        home_score: f.homeScore,
        away_score: f.awayScore,
        last_synced_at: new Date().toISOString(),
      }).eq('provider', provider.name).eq('external_id', f.externalId);
    }
    await logSync(client, { provider: provider.name, endpoint, http_status: 200, success: true });
    return live.length;
  } catch (e) {
    await logSync(client, { provider: provider.name, endpoint, http_status: errStatus(e), success: false, error_message: errMsg(e) });
    throw e;
  }
}
