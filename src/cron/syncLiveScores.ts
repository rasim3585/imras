import type { SupabaseClient } from '@supabase/supabase-js';
import type { FixtureProvider } from '../providers/types';
import { errMsg, errStatus, logSync } from './_shared';
import { recordObservations } from './liveObserver';

// Every ~30s: pull in-progress fixtures and update score/minute/status. We do
// NOT pull live odds -- the SQL engine (_market_odds_ft_real) reprices from the
// stored lambda the instant the score changes, so there is zero odds lag. If no
// match is live the provider returns [] and this is a cheap no-op.
//
// A pure OBSERVATION layer rides alongside (record_feed_pulse + live_incidents)
// to measure feed latency and incident ordering. It changes no score behaviour
// and enforces nothing -- see liveObserver.ts.
export async function syncLiveScores(client: SupabaseClient, provider: FixtureProvider): Promise<number> {
  const endpoint = '/api/v2/events/live/';
  try {
    const live = await provider.fetchLiveFixtures();
    for (const f of live) {
      // Observer read: grab our uuid + the score we hold BEFORE overwriting it,
      // so a goal can be logged with an honest score_before. Best-effort only.
      let fixtureId: string | null = null;
      let priorScore: string | null = null;
      try {
        const { data: prior } = await client
          .from('real_fixtures')
          .select('id, home_score, away_score')
          .eq('provider', provider.name).eq('external_id', f.externalId)
          .maybeSingle();
        if (prior) {
          fixtureId = prior.id as string;
          priorScore = (typeof prior.home_score === 'number' && typeof prior.away_score === 'number')
            ? `${prior.home_score}-${prior.away_score}` : null;
        }
      } catch (e) {
        console.warn('[observer] prior read failed:', e instanceof Error ? e.message : e);
      }

      await client.from('real_fixtures').update({
        status: f.status,
        period: f.period,
        current_minute: f.currentMinute,
        home_score: f.homeScore,
        away_score: f.awayScore,
        last_synced_at: new Date().toISOString(),
      }).eq('provider', provider.name).eq('external_id', f.externalId);

      // Observation layer -- never blocks or alters the score update above.
      if (fixtureId) await recordObservations(client, provider, fixtureId, f, priorScore);
    }
    await logSync(client, { provider: provider.name, endpoint, http_status: 200, success: true });
    return live.length;
  } catch (e) {
    await logSync(client, { provider: provider.name, endpoint, http_status: errStatus(e), success: false, error_message: errMsg(e) });
    throw e;
  }
}
