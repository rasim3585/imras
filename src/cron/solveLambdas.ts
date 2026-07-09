import type { SupabaseClient } from '@supabase/supabase-js';
import type { FixtureProvider } from '../providers/types';
import { solveLambda, lambdaHealth } from '../providers/lambdaSolver';
import { errMsg, errStatus, logSync } from './_shared';

// Every ~15 min: for fixtures kicking off within 6h that still have no lambda,
// fetch BSD consensus odds, solve the Poisson lambda, and store it (+ the raw
// odds for display/audit). One fixture failing never stops the batch.
export async function solveLambdas(client: SupabaseClient, provider: FixtureProvider): Promise<number> {
  const cutoff = new Date(Date.now() + 6 * 3600 * 1000).toISOString();
  const { data: pending, error } = await client
    .from('real_fixtures')
    .select('id, external_id')
    .is('lambda_home', null)
    .eq('status', 'notstarted')
    .lt('kickoff_at', cutoff);
  if (error) throw new Error(error.message);

  let solved = 0;
  for (const f of (pending ?? []) as { id: string; external_id: number }[]) {
    const endpoint = `/api/v2/events/${f.external_id}/odds/`;
    try {
      const odds = await provider.fetchPrematchOdds(f.external_id);
      if (!odds) {                                   // book has no consensus yet -> retry next tick
        await logSync(client, { provider: provider.name, endpoint, http_status: 200, success: true, fixture_id: f.id, error_message: 'no odds' });
        continue;
      }
      const sol = solveLambda(odds.homeWin, odds.draw, odds.awayWin);
      const health = lambdaHealth(sol);
      if (!health.ok) console.warn(`[solveLambdas] suspect ${f.external_id}: ${health.reason}`);

      const { error: uerr } = await client.from('real_fixtures')
        .update({ lambda_home: sol.lambdaHome, lambda_away: sol.lambdaAway, prematch_odds: odds })
        .eq('id', f.id);
      if (uerr) throw new Error(uerr.message);

      await logSync(client, { provider: provider.name, endpoint, http_status: 200, success: true, fixture_id: f.id });
      solved++;
    } catch (e) {
      await logSync(client, { provider: provider.name, endpoint, http_status: errStatus(e), success: false, error_message: errMsg(e), fixture_id: f.id });
      // keep going with the next fixture
    }
  }
  return solved;
}
