import type {
  Match,
  Outcome,
  Coupon,
  CouponSettlement,
} from './types';
import { SupabaseMatchProvider } from './supabaseMatchProvider';

export interface PlacedCoupon {
  coupon_id: string;
  total_odds: number;
  potential_win: number;
  new_balance: number;
}

// The seam between the UI and "where match/coupon data comes from". Screens
// depend ONLY on this interface — never on Supabase directly. Swapping the
// simulator for a real sports API later means a new implementation here, no
// screen changes.
export interface MatchProvider {
  /** Ensure there are enough open markets to play (Phase 1: seeds sims). */
  ensureMatches(): Promise<void>;

  /** Matches still open for a pick (kickoff in the future). */
  getUpcoming(): Promise<Match[]>;

  /** Place a coupon: server prices it, deducts stake, returns the summary. */
  placeCoupon(
    selections: { match_id: string; pick: Outcome }[],
    stake: number,
  ): Promise<PlacedCoupon>;

  /** The user's coupons, newest first, each with its graded selections. */
  getMyCoupons(): Promise<Coupon[]>;

  /** A single coupon by id. */
  getCoupon(id: string): Promise<Coupon | null>;

  /** Settle a coupon: finalize its matches, grade it, pay out on a full hit. */
  settleCoupon(id: string): Promise<CouponSettlement>;

  /** Daily retention bonus (+500, once per day). Returns the new balance. */
  claimDailyBonus(): Promise<number>;

  /** Safety-net refill when nearly broke. Returns the new balance. */
  topupGold(): Promise<number>;
}

// --- Active provider --------------------------------------------------------
// Swap this line to change the data source for the whole app.
export const matchProvider: MatchProvider = new SupabaseMatchProvider();
