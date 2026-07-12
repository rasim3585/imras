import { supabase } from './supabase';

// Aviator (crash game) data layer. Completely separate from the football
// MatchProvider seam -- shares NOTHING but the Supabase client and the common
// profiles.gold_balance. The engine runs server-side (pg_cron every second); the
// client only reads rounds/bets (anon SELECT open) and calls two RPCs to bet/cash
// out. The instant multiplier is derived CLIENT-SIDE from flying_at, never polled.

export type AviatorStatus = 'betting' | 'flying' | 'crashed';

export interface AviatorRound {
  id: string | number;
  status: AviatorStatus;
  /** HIDDEN until status==='crashed'. Never read/display during betting|flying. */
  crash_point: number | null;
  /** provably-fair commit; safe to show from round start. */
  server_seed_hash: string | null;
  betting_at: string | null;
  flying_at: string | null;
  crashed_at: string | null;
}

export interface AviatorConfig {
  rtp: number;
  min_stake: number;
  max_stake: number;
  bet_window_secs: number;
  max_multiplier: number;
}

export interface AviatorBet {
  id: string;
  round_id: string | number;
  user_id: string;
  slot: number;                 // 1 | 2
  stake: number;
  auto_cashout_at: number | null;
  status: 'placed' | 'won' | 'lost';
  cashout_multiplier: number | null;
  payout: number | null;
}

export interface AviatorPlayer extends AviatorBet { username: string }

export interface PlaceBetResult { bet_id: string; round: AviatorRound; prev_result: unknown; balance: number }
export interface CashoutResult { multiplier: number; payout: number; bet_id: string }

// Fallback config until aviator_config loads -- keeps the UI sane, never blocks.
export const DEFAULT_CONFIG: AviatorConfig = {
  rtp: 0.97, min_stake: 1, max_stake: 1000, bet_window_secs: 5, max_multiplier: 100,
};

// Multiplier growth rate. The live value is computed in useLiveMultiplier off a
// performance.now() anchor (NOT absolute flying_at) so client<->server clock skew
// can't shift the curve. Formula: exp(GROWTH * seconds_since_flight_observed).
// This is RATE-PURE: at +5.00s it reads exactly exp(1.75)=5.75, matching the
// backend. (An earlier display-lag compensation was removed -- it made the curve
// read LOW; the crash-overshoot it fought is instead handled by cashout honouring
// the moment the user SAW + a prompt backend crash emit.)
export const GROWTH = 0.35;

// severity colour for a crash multiplier (history strip + reveals)
export function multClass(m: number): string {
  if (m < 2) return 'av-c-low';
  if (m < 10) return 'av-c-mid';
  return 'av-c-high';
}

// --- reads -------------------------------------------------------------------
export async function fetchCurrentRound(): Promise<AviatorRound | null> {
  // NOTE: crashed_at is intentionally NOT selected for the CURRENT round. The
  // live curve never needs it, and the crash TIME is equivalent info to the crash
  // POINT (crash_point = exp(0.35 * (crashed_at - flying_at))) -- fetching it for a
  // possibly-in-flight round would be a needless surface. It's null in flight
  // anyway; we only read it for already-finished rounds in fetchHistory.
  const { data, error } = await supabase
    .from('aviator_rounds')
    .select('id, status, crash_point, server_seed_hash, betting_at, flying_at')
    .order('betting_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as AviatorRound) ?? null;
}

export async function fetchConfig(): Promise<AviatorConfig | null> {
  const { data, error } = await supabase
    .from('aviator_config')
    .select('rtp, min_stake, max_stake, bet_window_secs, max_multiplier')
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as AviatorConfig) ?? null;
}

export async function fetchHistory(limit = 12): Promise<AviatorRound[]> {
  const { data, error } = await supabase
    .from('aviator_rounds')
    .select('id, status, crash_point, server_seed_hash, betting_at, flying_at, crashed_at')
    .eq('status', 'crashed')
    .order('crashed_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as AviatorRound[];
}

/** All bets on a round, joined to usernames. Best-effort: if profiles are not
 *  anon-readable the name falls back to "Player" -- the list still renders. */
export async function fetchRoundBets(roundId: string | number): Promise<AviatorPlayer[]> {
  const { data, error } = await supabase
    .from('aviator_bets')
    .select('id, round_id, user_id, slot, stake, auto_cashout_at, status, cashout_multiplier, payout')
    .eq('round_id', roundId);
  if (error) throw new Error(error.message);
  const bets = (data ?? []) as AviatorBet[];
  if (bets.length === 0) return [];
  const ids = [...new Set(bets.map((b) => b.user_id))];
  let nameById: Record<string, string> = {};
  try {
    const { data: profs } = await supabase.from('profiles').select('id, username').in('id', ids);
    nameById = Object.fromEntries((profs ?? []).map((p) => [p.id as string, p.username as string]));
  } catch { /* usernames are cosmetic -- fall back to "Player" */ }
  return bets.map((b) => ({ ...b, username: nameById[b.user_id] ?? 'Player' }));
}

// --- writes (auth required) --------------------------------------------------
export async function placeBet(stake: number, slot: 1 | 2, autoCashoutAt: number | null): Promise<PlaceBetResult> {
  const { data, error } = await supabase.rpc('aviator_place_bet', {
    p_stake: stake, p_slot: slot, p_auto_cashout_at: autoCashoutAt,
  });
  if (error) throw new Error(error.message);
  return data as PlaceBetResult;
}

// clientMultiplier = the multiplier the user was LOOKING AT when they tapped. The
// server honours it (pays what they saw) as long as it was reachable before the
// crash, so network latency never turns a real cash-out into a loss. Sends the new
// param; falls back to the old signature until aviator_cashout is updated.
export async function cashout(slot: 1 | 2, clientMultiplier: number): Promise<CashoutResult> {
  let res = await supabase.rpc('aviator_cashout', { p_slot: slot, p_client_multiplier: clientMultiplier });
  if (res.error && /client_multiplier|could not find|function|does not exist|schema cache/i.test(res.error.message)) {
    res = await supabase.rpc('aviator_cashout', { p_slot: slot });   // pre-update fallback
  }
  if (res.error) throw new Error(res.error.message);
  return res.data as CashoutResult;
}
