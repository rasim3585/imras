import type { Match, Coupon, CouponSettlement, LiveState } from './types';
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

  /** Finish every match whose real time is over (advances the world). */
  finalizeDueMatches(): Promise<number>;

  /** All matches still in play (upcoming + live), with their markets. */
  getBulletin(): Promise<Match[]>;

  /** Wall-clock live state for a set of matches (phase/minute/score/goals/odds). */
  getLiveStates(matchIds: string[]): Promise<LiveState[]>;

  /** Place a coupon from selected market-option ids; server prices + settles. */
  placeCoupon(optionIds: string[], stake: number): Promise<PlacedCoupon>;

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
