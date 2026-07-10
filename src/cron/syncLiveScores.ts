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
      // so a goal can be logged with an honest score_before. Also grab the stored
      // red-card counts so we only rewrite them when they actually change.
      let fixtureId: string | null = null;
      let priorScore: string | null = null;
      let priorRed = { home: 0, away: 0 };
      try {
        const { data: prior } = await client
          .from('real_fixtures')
          .select('id, home_score, away_score, red_cards_home, red_cards_away')
          .eq('provider', provider.name).eq('external_id', f.externalId)
          .maybeSingle();
        if (prior) {
          fixtureId = prior.id as string;
          priorScore = (typeof prior.home_score === 'number' && typeof prior.away_score === 'number')
            ? `${prior.home_score}-${prior.away_score}` : null;
          priorRed = { home: (prior.red_cards_home as number) ?? 0, away: (prior.red_cards_away as number) ?? 0 };
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
      if (fixtureId) {
        await recordObservations(client, provider, fixtureId, f, priorScore);
        // Red-card count feeds the live engine (real_fixtures.red_cards_*, 0051).
        // Derive it from the incidents we just recorded, best-effort.
        await syncRedCards(client, fixtureId, priorRed);
      }
    }
    await logSync(client, { provider: provider.name, endpoint, http_status: 200, success: true });
    return live.length;
  } catch (e) {
    await logSync(client, { provider: provider.name, endpoint, http_status: errStatus(e), success: false, error_message: errMsg(e) });
    throw e;
  }
}

// Count red cards per team from live_incidents and mirror them onto the fixture
// so the live engine can widen its odds. Best-effort: any failure warns and
// returns, it never throws the sync. Writes only when a count actually changed.
async function syncRedCards(
  client: SupabaseClient, fixtureId: string, prior: { home: number; away: number },
): Promise<void> {
  try {
    const { data, error } = await client
      .from('live_incidents')
      .select('team_side')
      .eq('fixture_id', fixtureId).eq('incident_type', 'red_card');
    if (error) throw new Error(error.message);

    let home = 0, away = 0;
    for (const r of data ?? []) {
      if (r.team_side === 'home') home++;
      else if (r.team_side === 'away') away++;      // null team_side (rare) -> uncounted
    }
    if (home === prior.home && away === prior.away) return;   // no change, skip the write

    const { error: uerr } = await client
      .from('real_fixtures')
      .update({ red_cards_home: home, red_cards_away: away })
      .eq('id', fixtureId);
    if (uerr) throw new Error(uerr.message);
    console.log(`[redcards] ${fixtureId} -> home=${home} away=${away}`);
  } catch (e) {
    console.warn(`[redcards] ${fixtureId} failed:`, e instanceof Error ? e.message : e);
  }
}
