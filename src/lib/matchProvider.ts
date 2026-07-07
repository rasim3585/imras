import type {
  MatchWithPick,
  Match,
  Outcome,
  PredictionWithMatch,
  RevealResult,
} from './types';
import { SupabaseMatchProvider } from './supabaseMatchProvider';

// The seam between the UI and "where match data comes from". Screens depend
// ONLY on this interface — never on Supabase, and never on the simulator. To
// move off simulated matches later, implement this against a real sports API
// and swap the singleton at the bottom; no screen changes.
export interface MatchProvider {
  /** Ensure there are enough upcoming matches to play (Phase 1: seeds sims). */
  ensureMatches(): Promise<void>;

  /** Upcoming matches, each annotated with the current user's pick (if any). */
  getUpcoming(): Promise<MatchWithPick[]>;

  /** A single match by id (any status). */
  getMatch(matchId: string): Promise<Match | null>;

  /** Record the user's pick for a match. Throws if not allowed. */
  submitPrediction(matchId: string, pick: Outcome): Promise<void>;

  /** Open a match's result and score it; returns the caller's outcome. */
  revealMatch(matchId: string): Promise<RevealResult>;

  /** The user's predictions, newest first, each with its match — for Profile. */
  getMyPredictions(): Promise<PredictionWithMatch[]>;
}

// --- Active provider --------------------------------------------------------
// Swap this line to change the data source for the whole app.
export const matchProvider: MatchProvider = new SupabaseMatchProvider();
