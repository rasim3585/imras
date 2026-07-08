import { supabase } from './supabase';
import type { MatchProvider, PlacedCoupon } from './matchProvider';
import type { Coupon, CouponLeg, CouponSettlement, LiveState, Market, Match } from './types';

// Explicit match columns — omits `true_probabilities` (hidden) and
// `display_odds` (server-only seed input; odds are exposed via market_options).
const MATCH_COLS =
  'id,sport,home_team,away_team,starts_at,status,home_score,away_score,result,timeline';

// Nested embed used for coupons: selection -> option -> market -> match.
const COUPON_SELECT =
  `*, coupon_selections(id, odds, status, ` +
  `market_options(id, label, outcome_key, is_winner, ` +
  `markets(name, market_type, matches(id, home_team, away_team, result, home_score, away_score, timeline))))`;

/** Supabase-backed provider. All simulation (results, odds, stake math,
 *  settlement) runs server-side in Postgres RPCs — this only maps data. */
export class SupabaseMatchProvider implements MatchProvider {
  async ensureMatches(): Promise<void> {
    const { error } = await supabase.rpc('seed_matches', { p_target: 8 });
    if (error) throw new Error(error.message);
  }

  async finalizeDueMatches(): Promise<number> {
    const { data, error } = await supabase.rpc('finalize_due_matches');
    if (error) throw new Error(error.message);
    return Number(data ?? 0);
  }

  async getBulletin(): Promise<Match[]> {
    // everything still in play — upcoming AND live (Model A). Finished matches
    // are excluded; the client drops any that read as over/closed via live state.
    const { data, error } = await supabase
      .from('matches')
      .select(`${MATCH_COLS}, markets(id, match_id, market_type, name, status, sort_order, ` +
        `market_options(id, market_id, label, outcome_key, odds, is_winner, sort_order))`)
      .neq('status', 'finished')
      .order('starts_at', { ascending: true });
    if (error) throw new Error(error.message);

    return ((data ?? []) as unknown[]).map((row): Match => {
      const raw = row as Match & { markets: (Market & { market_options: unknown })[] };
      const markets: Market[] = (raw.markets ?? [])
        .map((m) => {
          const opts = ((m as unknown as { market_options: Market['options'] }).market_options ?? [])
            .map((o) => ({ ...o, odds: Number(o.odds) }))
            .sort((a, b) => a.sort_order - b.sort_order);
          return { ...m, options: opts } as Market;
        })
        .sort((a, b) => a.sort_order - b.sort_order);
      return { ...(raw as Match), markets };
    });
  }

  async getLiveStates(matchIds: string[]): Promise<LiveState[]> {
    if (matchIds.length === 0) return [];
    const { data, error } = await supabase.rpc('get_live_state', { p_match_ids: matchIds });
    if (error) throw new Error(error.message);
    return (data ?? []) as LiveState[];
  }

  async placeCoupon(optionIds: string[], stake: number): Promise<PlacedCoupon> {
    const { data, error } = await supabase.rpc('place_coupon', {
      p_option_ids: optionIds,
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
      .select(COUPON_SELECT)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map(flattenCoupon);
  }

  async getCoupon(id: string): Promise<Coupon | null> {
    const { data, error } = await supabase
      .from('coupons')
      .select(COUPON_SELECT)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? flattenCoupon(data) : null;
  }

  async settleCoupon(id: string): Promise<CouponSettlement> {
    const { data, error } = await supabase.rpc('settle_coupon', { p_coupon_id: id });
    if (error) throw new Error(error.message);
    const d = data as CouponSettlement;
    return {
      ...d,
      in_progress: Boolean(d.in_progress),
      stake: Number(d.stake),
      total_odds: Number(d.total_odds),
      potential_win: Number(d.potential_win),
      new_balance: Number(d.new_balance),
      selections: (d.selections ?? []).map((s) => ({ ...s, odds: Number(s.odds) })),
    };
  }

  async settleDueCoupons(): Promise<number> {
    const { data, error } = await supabase.rpc('settle_due_coupons');
    if (error) throw new Error(error.message);
    return Number(data ?? 0);
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

// Flatten the nested PostgREST coupon graph into UI-friendly legs.
function flattenCoupon(row: unknown): Coupon {
  const c = row as Record<string, unknown>;
  const rawLegs = (c.coupon_selections ?? []) as Record<string, unknown>[];
  const legs: CouponLeg[] = rawLegs.map((cs) => {
    const opt = cs.market_options as Record<string, unknown>;
    const mk = opt.markets as Record<string, unknown>;
    const match = mk.matches as CouponLeg['match'];
    return {
      id: cs.id as string,
      odds: Number(cs.odds),
      status: cs.status as CouponLeg['status'],
      option_label: opt.label as string,
      outcome_key: opt.outcome_key as string,
      is_winner: (opt.is_winner as boolean | null) ?? null,
      market_name: mk.name as string,
      market_type: mk.market_type as string,
      match,
    };
  });
  return {
    id: c.id as string,
    user_id: c.user_id as string,
    stake: Number(c.stake),
    total_odds: Number(c.total_odds),
    potential_win: Number(c.potential_win),
    status: c.status as Coupon['status'],
    created_at: c.created_at as string,
    settled_at: (c.settled_at as string | null) ?? null,
    legs,
  };
}
