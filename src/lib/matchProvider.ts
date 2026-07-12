import type {
  Match, Coupon, CouponSettlement, LiveState, DailyBonus, Challenge, Leaderboard,
  League, LeagueDetail, Rival, SharedCoupon, BulletinMatch, CartSelection, MatchStats,
  SlotResult,
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

  /** Finish every match whose real time is over (advances the world). */
  finalizeDueMatches(): Promise<number>;

  /** The unified bulletin (real fixtures + virtual matches) via get_bulletin. */
  getBulletin(): Promise<BulletinMatch[]>;

  /** Wall-clock live state for a set of matches (phase/minute/score/goals/odds). */
  getLiveStates(matchIds: string[]): Promise<LiveState[]>;

  /** One match with all its markets (for the match-detail screen). */
  getMatch(id: string): Promise<Match | null>;

  /** Virtual-league stats for a match (standings + form + H2H); null if none. */
  getMatchStats(matchId: string): Promise<MatchStats | null>;

  /** Gates of Goal: play one slot spin; server computes, client animates steps. */
  slotSpin(bet: number, ante: boolean): Promise<SlotResult>;

  /** Place a coupon (real + virtual legs) via place_coupon_v2; server prices. */
  placeCoupon(selections: CartSelection[], stake: number): Promise<PlacedCoupon>;

  /** The user's coupons, newest first, each with its graded selections. */
  getMyCoupons(): Promise<Coupon[]>;

  /** A single coupon by id. */
  getCoupon(id: string): Promise<Coupon | null>;

  /** Settle a coupon: finalize its matches, grade it, pay out on a full hit. */
  settleCoupon(id: string): Promise<CouponSettlement>;

  /** Auto-settle every pending coupon whose matches have all finished. */
  settleDueCoupons(): Promise<number>;

  /** Current cash-out value of an open coupon (0 if unavailable). */
  getCashoutValue(couponId: string): Promise<{ value: number; available: boolean }>;

  /** Cash out an open coupon at the current value; returns the new balance. */
  doCashout(couponId: string): Promise<number>;

  /** Escalating daily login bonus (once per UTC day). */
  claimDailyBonus(): Promise<DailyBonus>;

  /** Safety-net refill when nearly broke. Returns the new balance. */
  topupGold(): Promise<number>;

  /** Today's daily challenges with progress. */
  getChallenges(): Promise<Challenge[]>;

  /** Claim a completed challenge's reward; returns the new balance. */
  claimChallenge(key: string): Promise<number>;

  /** Leaderboard for a scope: 'day'/'week' (net gold) or 'wins' (won coupons). */
  getLeaderboard(scope: 'day' | 'week' | 'wins'): Promise<Leaderboard>;

  // --- social ---
  createLeague(name: string): Promise<League>;
  joinLeague(code: string): Promise<{ id: string; name: string }>;
  leaveLeague(id: string): Promise<void>;
  getMyLeagues(): Promise<League[]>;
  getLeague(id: string): Promise<LeagueDetail>;
  addRival(username: string): Promise<void>;
  removeRival(username: string): Promise<void>;
  getRivals(): Promise<Rival[]>;
  shareCoupon(couponId: string): Promise<void>;
  getSharedFeed(): Promise<SharedCoupon[]>;

  /** One shared coupon by id, for the public share link (null if not shared). */
  getSharedCoupon(id: string): Promise<SharedCoupon | null>;
}

// --- Active provider --------------------------------------------------------
// Swap this line to change the data source for the whole app.
export const matchProvider: MatchProvider = new SupabaseMatchProvider();
