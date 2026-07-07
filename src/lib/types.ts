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

export interface Prediction {
  id: string;
  user_id: string;
  match_id: string;
  pick: Outcome;
  created_at: string;
  is_correct: boolean | null;
  points_earned: number | null;
}

/** A match paired with the current user's prediction on it, if any. */
export interface MatchWithPick extends Match {
  myPick: Outcome | null;
}

/** A prediction paired with its match — used on the Profile history list. */
export interface PredictionWithMatch extends Prediction {
  match: Match;
}

/** Result payload returned by the reveal RPC, used by the Reveal screen. */
export interface RevealResult {
  match_id: string;
  home_team: string;
  away_team: string;
  result: Outcome;
  home_score: number;
  away_score: number;
  odds: Odds;
  your_pick: Outcome | null;
  is_correct: boolean | null;
  points_earned: number | null;
}
