import type { SupabaseClient } from '@supabase/supabase-js';
import { errMsg } from './_shared';

// Every ~60s: settle real fixtures that have finished but aren't graded yet.
// All the grading lives in the DB (settle_real_fixture); this just finds the due
// fixtures and calls it, then logs the outcome. One fixture failing never stops
// the batch.
//
// settle_real_fixture returns one of:
//   { status: 'settled', legs, coupons } | { status: 'voided' }
//   { status: 'already_settled' } | { status: 'not_finished' }
//   { status: 'needs_review', reason } -> WARN, look by hand

interface SettleResult { status: string; legs?: number; coupons?: number; reason?: string }
export interface SettleSummary { settled: number; voided: number; review: number; failed: number }

export async function settleFixtures(client: SupabaseClient): Promise<SettleSummary> {
  const { data, error } = await client
    .from('real_fixtures')
    .select('id')
    .in('status', ['finished', 'penalties'])
    .is('settled_at', null);
  if (error) throw new Error(error.message);

  const summary: SettleSummary = { settled: 0, voided: 0, review: 0, failed: 0 };
  for (const f of (data ?? []) as { id: string }[]) {
    try {
      const { data: res, error: rerr } = await client.rpc('settle_real_fixture', { p_fixture_id: f.id });
      if (rerr) throw new Error(rerr.message);
      const r = (res ?? {}) as SettleResult;
      switch (r.status) {
        case 'settled':
          summary.settled++;
          console.log(`[settle] ${f.id} settled (legs=${r.legs ?? '?'}, coupons=${r.coupons ?? '?'})`);
          break;
        case 'voided':
          summary.voided++;
          console.log(`[settle] ${f.id} voided -> stakes refunded`);
          break;
        case 'already_settled':
          console.log(`[settle] ${f.id} already settled`);
          break;
        case 'not_finished':
          console.log(`[settle] ${f.id} not finished yet`);
          break;
        case 'needs_review':
          summary.review++;
          console.warn(`[settle] ${f.id} NEEDS REVIEW: ${r.reason ?? '(no reason)'}`);
          break;
        default:
          summary.review++;
          console.warn(`[settle] ${f.id} unexpected response:`, r);
      }
    } catch (e) {
      summary.failed++;
      console.error(`[settle] ${f.id} failed:`, errMsg(e));
    }
  }
  return summary;
}
