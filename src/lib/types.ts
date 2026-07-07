// Shared domain types. Kept UI-facing and provider-agnostic: nothing here
// knows whether a match came from the simulator or a future real sports API.

export type Sport = 'football' | 'basketball';

export type Outcome = 'home' | 'draw' | 'away';

export type MatchStatus = 'upcoming' | 'live' | 'finished';

/** Informational decimal odds per outcome (e.g. 1.85). Display only — no money,
 *  no stake, no payout. Derived server-side from the hidden probabilities. */
export type Odds = Record<Outcome, number>;

export interface Profile {
  id: string;
  username: string;
  created_at: string;
  total_predictions: number;
  correct_predictions: number;
  current_streak: number;
  best_streak: number;
  skill_rating: number;
  gold_balance: number;
  last_daily_bonus_at: string | null;
}

export type CouponStatus = 'pending' | 'won' | 'lost';

/** A selection while it lives in the client-side coupon cart (pre-placement). */
export interface CartSelection {
  match_id: string;
  home_team: string;
  away_team: string;
  pick: Outcome;
  odds: number;
}

export interface CouponSelectionRow {
  id: string;
  coupon_id: string;
  match_id: string;
  pick: Outcome;
  odds: number;
  is_correct: boolean | null;
  match: Match;
}

export interface Coupon {
  id: string;
  user_id: string;
  stake: number;
  total_odds: number;
  potential_win: number;
  status: CouponStatus;
  created_at: string;
  settled_at: string | null;
  selections: CouponSelectionRow[];
}

/** One graded leg returned by settle_coupon (drives the sequential reveal). */
export interface SettlementLeg {
  match_id: string;
  home_team: string;
  away_team: string;
  pick: Outcome;
  odds: number;
  result: Outcome | null;
  home_score: number | null;
  away_score: number | null;
  is_correct: boolean | null;
}

export interface CouponSettlement {
  coupon_id: string;
  status: CouponStatus;
  stake: number;
  total_odds: number;
  potential_win: number;
  new_balance: number;
  selections: SettlementLeg[];
}

export interface Match {
  id: string;
  sport: Sport;
  home_team: string;
  away_team: string;
  starts_at: string;
  status: MatchStatus;
  home_score: number | null;
  away_score: number | null;
  result: Outcome | null;
  display_odds: Odds;
  // true_probabilities intentionally absent: hidden server-side.
}

