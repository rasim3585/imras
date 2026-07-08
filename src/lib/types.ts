// Shared domain types — provider-agnostic. Nothing here knows whether data came
// from the simulator or a future real sports API.

export type Sport = 'football' | 'basketball';
export type Outcome = 'home' | 'draw' | 'away';
export type MatchStatus = 'upcoming' | 'live' | 'finished';
export type MarketStatus = 'open' | 'closed' | 'settled';
export type LegStatus = 'pending' | 'won' | 'lost';
export type CouponStatus = 'pending' | 'won' | 'lost';

export interface Profile {
  id: string;
  username: string;
  created_at: string;
  gold_balance: number;
  last_daily_bonus_at: string | null;
}

/** A goal event on the match timeline (for virtual live playback). Half/full
 *  time markers are synthesized client-side. */
export interface MatchEvent {
  minute: number;
  type: 'goal';
  team: 'home' | 'away';
}

export type LivePhase = 'upcoming' | 'live' | 'finished';

/** Wall-clock-derived match state from get_live_state — only reveals what has
 *  happened so far; the future stays hidden server-side. */
export interface LiveState {
  match_id: string;
  home_team: string;
  away_team: string;
  phase: LivePhase;
  minute: number;
  starts_in: number;      // seconds until kickoff (0 once started)
  duration_secs: number;  // virtual match length in wall-clock seconds
  home_score: number;
  away_score: number;
  events: MatchEvent[];   // revealed goals only
  result: Outcome | null; // only once finished
}

// --- Markets (generic bet types) -------------------------------------------

export interface MarketOption {
  id: string;
  market_id: string;
  label: string;        // '1', 'X', '2', 'Over 2.5', 'Yes'
  outcome_key: string;  // resolver key: 'home','draw','away', ...
  odds: number;
  is_winner: boolean | null;
  sort_order: number;
}

export interface Market {
  id: string;
  match_id: string;
  market_type: string;  // 'match_result', 'over_under_2_5', ...
  name: string;         // display name
  status: MarketStatus;
  sort_order: number;
  options: MarketOption[];
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
  timeline?: MatchEvent[];   // goal events; present once finished
  markets: Market[];    // populated on the feed
}

// --- Coupons ---------------------------------------------------------------

/** A selection while it lives in the client-side cart (pre-placement). */
export interface CartSelection {
  option_id: string;
  match_id: string;
  home_team: string;
  away_team: string;
  market_name: string;
  option_label: string;
  odds: number;
}

/** A coupon leg, flattened from the option/market/match graph for the UI. */
export interface CouponLeg {
  id: string;
  odds: number;
  status: LegStatus;
  option_label: string;
  outcome_key: string;
  is_winner: boolean | null;
  market_name: string;
  market_type: string;
  match: {
    id: string;
    home_team: string;
    away_team: string;
    result: Outcome | null;
    home_score: number | null;
    away_score: number | null;
    timeline?: MatchEvent[];
  };
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
  legs: CouponLeg[];
}

/** One graded leg returned by settle_coupon (drives the sequential reveal). */
export interface SettlementLeg {
  selection_id: string;
  match_id: string;
  home_team: string;
  away_team: string;
  market_name: string;
  market_type: string;
  option_label: string;
  outcome_key: string;
  odds: number;
  status: LegStatus;
  result: Outcome | null;
  home_score: number | null;
  away_score: number | null;
  timeline?: MatchEvent[];
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
