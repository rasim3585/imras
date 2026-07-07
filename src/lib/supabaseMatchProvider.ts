import { supabase } from './supabase';
import type { MatchProvider, PlacedCoupon } from './matchProvider';
import type { Coupon, CouponSettlement, Match, Outcome } from './types';

// Explicit column list — omits `true_probabilities`, which the client isn't
// granted anyway. Selecting `*` would try to read it and fail.
const MATCH_COLS =
  'id,sport,home_team,away_team,starts_at,status,home_score,away_score,result,display_odds,created_at';

/** Supabase-backed provider. All simulation (result generation, odds, stake
 *  math, settlement) happens server-side in Postgres RPCs — this only maps. */
export class SupabaseMatchProvider implements MatchProvider {
  async ensureMatches(): Promise<void> {
    const { error } = await supabase.rpc('seed_matches', { p_target: 8 });
    if (error) throw new Error(error.message);
  }

  async getUpcoming(): Promise<Match[]> {
    // Only markets still open for a pick — kickoff must be in the future.
    const { data, error } = await supabase
      .from('matches')
      .select(MATCH_COLS)
      .eq('status', 'upcoming')
      .gt('starts_at', new Date().toISOString())
      .order('starts_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as Match[];
  }

  async placeCoupon(
    selections: { match_id: string; pick: Outcome }[],
    stake: number,
  ): Promise<PlacedCoupon> {
    const { data, error } = await supabase.rpc('place_coupon', {
      p_selections: selections,
      p_stake: stake,
    });
    if (error) throw new Error(error.message);
    const d = data as PlacedCoupon;
    return {
      coupon_id: d.coupon_id,
      total_odds: Number(d.total_odds),
      potential_win: Number(d.potential_win),
      new_balance: Number(d.new_balance),
    };
  }

  async getMyCoupons(): Promise<Coupon[]> {
    const { data, error } = await supabase
      .from('coupons')
      .select(`*, selections:coupon_selections(*, match:matches(${MATCH_COLS}))`)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map(normalizeCoupon);
  }

  async getCoupon(id: string): Promise<Coupon | null> {
    const { data, error } = await supabase
      .from('coupons')
      .select(`*, selections:coupon_selections(*, match:matches(${MATCH_COLS}))`)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? normalizeCoupon(data) : null;
  }

  async settleCoupon(id: string): Promise<CouponSettlement> {
    const { data, error } = await supabase.rpc('settle_coupon', { p_coupon_id: id });
    if (error) throw new Error(error.message);
    const d = data as CouponSettlement;
    return {
      ...d,
      stake: Number(d.stake),
      total_odds: Number(d.total_odds),
      potential_win: Number(d.potential_win),
      new_balance: Number(d.new_balance),
      selections: (d.selections ?? []).map((s) => ({ ...s, odds: Number(s.odds) })),
    };
  }

  async claimDailyBonus(): Promise<number> {
    const { data, error } = await supabase.rpc('claim_daily_bonus');
    if (error) throw new Error(error.message);
    return Number((data as { new_balance: number }).new_balance);
  }

  async topupGold(): Promise<number> {
    const { data, error } = await supabase.rpc('topup_gold');
    if (error) throw new Error(error.message);
    return Number((data as { new_balance: number }).new_balance);
  }
}

// numeric columns can arrive as strings; coerce to numbers for the UI.
function normalizeCoupon(row: unknown): Coupon {
  const c = row as Coupon;
  return {
    ...c,
    stake: Number(c.stake),
    total_odds: Number(c.total_odds),
    potential_win: Number(c.potential_win),
    selections: (c.selections ?? []).map((s) => ({ ...s, odds: Number(s.odds) })),
  };
}
