// Shared domain types — provider-agnostic. Nothing here knows whether data came
// from the simulator or a future real sports API.

export type Sport = 'football' | 'basketball';
export type Outcome = 'home' | 'draw' | 'away';
export type MatchStatus = 'upcoming' | 'live' | 'finished';
export type MarketStatus = 'open' | 'closed' | 'settled';
export type LegStatus = 'pending' | 'won' | 'lost';
export type CouponStatus = 'pending' | 'won' | 'lost' | 'cashed_out';

export interface Profile {
  id: string;
  username: string;
  created_at: string;
  gold_balance: number;
  last_daily_bonus_at: string | null;
  login_streak: number;
  current_streak: number;
  best_streak: number;
}

export interface DailyBonus { awarded: number; streak_day: number; login_streak: number; new_balance: number; }
export interface Challenge { key: string; label: string; target: number; reward: number; progress: number; claimed: boolean; }
export interface League { id: string; name: string; invite_code: string; members: number; is_owner: boolean; }
export interface LeagueDetail { id: string; name: string; invite_code: string; rows: { username: string; value: number; rank: number }[]; }
export interface Rival {
  username: string; my_won: number; their_won: number; my_net: number; their_net: number;
  h2h_me: number; h2h_them: number; leader: 'me' | 'them' | 'tie';
}
export interface SharedLeg {
  option_id: string; match_id: string; odds: number; status: string;
  market_name: string; option_label: string; home_team: string; away_team: string;
}
export interface SharedCoupon {
  coupon_id: string; username: string; stake: number; total_odds: number; potential_win: number;
  status: string; shared_at: string; legs: SharedLeg[];
}

export type LeaderboardScope = 'day' | 'week' | 'wins';
export interface LeaderboardRow { username: string; rank: number; value: number; played: number | null; }
export interface Leaderboard {
  scope: LeaderboardScope;
  rows: LeaderboardRow[];
  me: { rank: number | null; value: number; played: number | null };
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
  cards: { minute: number; team: 'home' | 'away' }[]; // revealed red cards
  red_home: number;
  red_away: number;
  /** Live odds map (outcome_key -> odds) for full-time markets while live. A key
   *  maps to `null` when the score has already CLOSED that market (e.g. o/u 1.5
   *  once total >= 2); the whole map is null once finished / upcoming. */
  live_odds: Record<string, number | null> | null;
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
  cashout_amount: number | null;
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
  /** True when some legs' matches are still playing — not settleable yet. */
  in_progress?: boolean;
  stake: number;
  total_odds: number;
  potential_win: number;
  new_balance: number;
  selections: SettlementLeg[];
}
