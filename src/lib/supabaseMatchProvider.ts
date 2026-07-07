import { supabase } from './supabase';
import type { MatchProvider } from './matchProvider';
import type {
  Match,
  MatchWithPick,
  Outcome,
  PredictionWithMatch,
  RevealResult,
} from './types';

// Explicit column list — deliberately omits `true_probabilities`, which the
// client isn't granted anyway. Selecting `*` would try to read it and fail.
const MATCH_COLS = 'id,sport,home_team,away_team,starts_at,status,home_score,away_score,result,created_at';

/**
 * Supabase-backed provider. All the "simulation" (result generation, scoring)
 * happens server-side in Postgres RPCs — this class only moves data.
 */
export class SupabaseMatchProvider implements MatchProvider {
  async ensureMatches(): Promise<void> {
    const { error } = await supabase.rpc('seed_matches', { p_target: 8 });
    if (error) throw new Error(error.message);
  }

  async getUpcoming(): Promise<MatchWithPick[]> {
    // Embedded `predictions` is RLS-filtered to the current user, so the array
    // holds at most this user's single pick for each match.
    // Only matches still open for predictions — kickoff must be in the future,
    // matching the insert policy so the Feed never offers an un-pickable match.
    const { data, error } = await supabase
      .from('matches')
      .select(`${MATCH_COLS}, predictions(pick)`)
      .eq('status', 'upcoming')
      .gt('starts_at', new Date().toISOString())
      .order('starts_at', { ascending: true });
    if (error) throw new Error(error.message);

    return (data ?? []).map((row): MatchWithPick => {
      const { predictions, ...match } = row as Match & {
        predictions: { pick: Outcome }[] | null;
      };
      return { ...match, myPick: predictions?.[0]?.pick ?? null };
    });
  }

  async getMatch(matchId: string): Promise<Match | null> {
    const { data, error } = await supabase
      .from('matches')
      .select(MATCH_COLS)
      .eq('id', matchId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as Match) ?? null;
  }

  async submitPrediction(matchId: string, pick: Outcome): Promise<void> {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) throw new Error('Not signed in');

    const { error } = await supabase
      .from('predictions')
      .insert({ user_id: userId, match_id: matchId, pick });
    if (error) {
      // A friendlier message for the "already picked / match locked" cases.
      if (error.code === '23505') throw new Error('You already made a call on this match');
      throw new Error(error.message);
    }
  }

  async revealMatch(matchId: string): Promise<RevealResult> {
    const { data, error } = await supabase.rpc('reveal_match', { p_match_id: matchId });
    if (error) throw new Error(error.message);
    return data as RevealResult;
  }

  async getMyPredictions(): Promise<PredictionWithMatch[]> {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) throw new Error('Not signed in');

    const { data, error } = await supabase
      .from('predictions')
      .select(`*, match:matches(${MATCH_COLS})`)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);

    return (data ?? []) as unknown as PredictionWithMatch[];
  }
}
