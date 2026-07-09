import type { SupabaseClient } from '@supabase/supabase-js';
import type { FixtureProvider } from '../providers/types';
import { solveLambda, lambdaHealth } from '../providers/lambdaSolver';
import { errMsg, errStatus, logSync } from './_shared';

export interface SolveSummary { solved: number; skipped: number }

// Every ~15 min: (re)solve lambda for notstarted fixtures. No kickoff window --
// the bulletin shows 2 days of matches and every one must have a price (else the
// user taps and gets 'odds_unavailable'). BUT lambda is REFRESHED every 6h,
// because BSD's consensus updates ~twice a day: a 2-day-old lambda is four books
// stale by kickoff (injuries, line-ups, weather all move the odds, not the old
// lambda). As kickoff nears the odds sharpen and the lambda sharpens with them.
//
// Requires column real_fixtures.lambda_solved_at (timestamptz) -- migration
// handled separately. One fixture failing never stops the batch; every fixture
// prints one line and its skip/warn also lands in provider_sync_log.
export async function solveLambdas(client: SupabaseClient, provider: FixtureProvider): Promise<SolveSummary> {
  const staleBefore = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
  const { data: pending, error } = await client
    .from('real_fixtures')
    .select('id, external_id, home_team, away_team')
    .eq('status', 'notstarted')
    // never priced, or its price is older than 6h -> re-solve.
    .or(`lambda_home.is.null,lambda_solved_at.lt.${staleBefore}`);
  if (error) throw new Error(error.message);

  let solved = 0, skipped = 0;
  for (const f of (pending ?? []) as { id: string; external_id: number; home_team: string; away_team: string }[]) {
    const label = `${f.external_id} ${f.home_team}-${f.away_team}`;
    const endpoint = `/api/v2/events/${f.external_id}/odds/`;
    try {
      const odds = await provider.fetchPrematchOdds(f.external_id);
      if (!odds) {                                   // book has no consensus yet -> retry next tick
        skipped++;
        console.log(`[lambda] ${label} -> ATLANDI: oran yok`);
        await logSync(client, { provider: provider.name, endpoint, http_status: 200, success: false, fixture_id: f.id, error_message: 'no odds' });
        continue;
      }
      const sol = solveLambda(odds);   // fits 1X2 + over/under together

      // both checks WARN, neither ELIMINATES -- a real 6-1 can total >4.0, and a
      // consistency gap means bad provider data, not a bad solve. Collect and
      // print on ONE line; the warning also goes to provider_sync_log.
      const warns: string[] = [];
      const health = lambdaHealth(sol);
      if (!health.ok) warns.push(health.reason ?? 'sağlıksız lambda');
      if (sol.ouGap != null && sol.ouGap > 0.10) warns.push(`sağlayıcı tutarsız (2.5 üst farkı ${sol.ouGap.toFixed(2)})`);
      const warnStr = warns.length ? ` UYARI: ${warns.join('; ')}` : '';

      const { error: uerr } = await client.from('real_fixtures')
        .update({ lambda_home: sol.lambdaHome, lambda_away: sol.lambdaAway, prematch_odds: odds, lambda_solved_at: new Date().toISOString() })
        .eq('id', f.id);
      if (uerr) throw new Error(uerr.message);

      solved++;
      console.log(`[lambda] ${label} -> cozuldu (${sol.lambdaHome} / ${sol.lambdaAway})${warnStr}`);
      await logSync(client, { provider: provider.name, endpoint, http_status: 200, success: true, fixture_id: f.id, error_message: warns.length ? warns.join('; ') : undefined });
    } catch (e) {
      skipped++;
      console.error(`[lambda] ${label} -> ATLANDI: ${errMsg(e)}`);
      await logSync(client, { provider: provider.name, endpoint, http_status: errStatus(e), success: false, error_message: errMsg(e), fixture_id: f.id });
    }
  }

  console.log(`Ozet: ${solved} cozuldu, ${skipped} atlandi`);
  return { solved, skipped };
}
