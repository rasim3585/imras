import { supabase } from '../lib/supabase';

// Canlı sohbet veri katmanı: geçmiş yorumları çek, yeni yorum gönder (RPC),
// realtime ile canlı akış. Okuma herkese açık; yazma auth + rate-limit (backend).

export interface MatchComment {
  id: number; match_id: string; user_id: string; username: string; body: string; created_at: string;
}

export async function fetchComments(matchId: string, limit = 40): Promise<MatchComment[]> {
  const { data, error } = await supabase
    .from('match_comments')
    .select('id, match_id, user_id, username, body, created_at')
    .eq('match_id', matchId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as MatchComment[]).reverse();   // oldest → newest for display
}

export async function postComment(matchId: string, body: string): Promise<MatchComment> {
  const { data, error } = await supabase.rpc('post_match_comment', { p_match_id: matchId, p_body: body });
  if (error) throw new Error(error.message);
  return data as MatchComment;
}

/** Realtime new-comment stream for one match. Returns an unsubscribe fn. */
export function subscribeComments(matchId: string, onInsert: (c: MatchComment) => void): () => void {
  const ch = supabase
    .channel(`match-chat-${matchId}`)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'match_comments', filter: `match_id=eq.${matchId}` },
      (p) => onInsert(p.new as MatchComment))
    .subscribe();
  return () => { supabase.removeChannel(ch); };
}
