import type { Match, Coupon, CouponSettlement, LiveState } from './types';
import type { WatchTimeline } from '../live/liveModel';
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

  /** Matches still open for a pick (kickoff in the future), with their markets. */
  getUpcoming(): Promise<Match[]>;

  /** Wall-clock live state for a set of matches (phase/minute/score/goals). */
  getLiveStates(matchIds: string[]): Promise<LiveState[]>;

  /** Full script for a match the user has bet on, for a personal replay.
   *  Returns null if the user has no coupon on that match. */
  getWatchTimeline(matchId: string): Promise<WatchTimeline | null>;

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
