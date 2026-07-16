import { supabase } from './supabase';

// Davranış aynası — ürün-başı + çapraz-ürün teşhis veri katmanı. Hepsi kullanıcının
// KENDİ verisinden (auth gerekli). Aviator'ın kendi fetch'i lib/aviator.ts'te.

export interface MirrorFlag {
  code: string;
  level: 'warn' | 'good' | 'info';
  value: Record<string, number | string>;
}

export type CouponProfile =
  | { ready: false; rounds?: number; need?: number }
  | {
      ready: true; product: 'coupon'; rounds: number; win_rate: number; net: number;
      avg_stake: number; avg_odds: number; median_odds: number; longshot_rate: number;
      flags: MirrorFlag[];
    };

export type SlotProfile =
  | { ready: false; rounds?: number; need?: number }
  | {
      ready: true; product: 'slot'; rounds: number; net: number; staked: number;
      rtp: number | null; ante_rate: number; buy_rate: number; avg_bet: number;
      biggest_win: number; flags: MirrorFlag[];
    };

export interface OverviewProduct {
  // 0146: dice/mines/plinko da ürün listesinde — tip bayattı, genişletildi
  key: 'aviator' | 'slot' | 'coupon' | 'dice' | 'mines' | 'plinko'; label: string;
  plays: number; staked: number; net: number; stake_share: number;
}
export type OverviewProfile =
  | { ready: false; plays?: number; need?: number }
  | {
      ready: true; plays: number; staked: number; net: number;
      products: OverviewProduct[]; most_played: string; worst: string;
      flags: MirrorFlag[];
    };

// LLM "ses": deterministik özeti mirror-coach edge function'a yollar, kişisel
// koçluk metni döner. Key yoksa/hata → null (frontend deterministik metne düşer).
export async function fetchCoach(summary: unknown, lang = 'en'): Promise<string | null> {
  try {
    const { data, error } = await supabase.functions.invoke('mirror-coach', { body: { summary, lang } });
    if (error) return null;
    return ((data as { text?: string | null })?.text ?? null);
  } catch {
    return null;
  }
}

// --- AI Kupon Hakemi + AI Maç Önizleme (0715) --------------------------------
// İlke aynı: SAYILAR deterministik (coupon_review RPC / vmatch_stats), LLM
// yalnız cümleye döker. Key yoksa text null — deterministik kart yine çalışır.

export interface CouponLegReview {
  match_id: string; match: string; kind: string; market: string; pick: string; odds: number;
  is_live?: boolean;
  /** Kullanıcının bu bacaktaki takım(lar)la KENDİ geçmişi — ürünün kalbi. */
  team_history?: { team: string; bets: number; won: number; net: number } | null;
}

export interface CouponReview {
  ready: boolean; reason?: string;
  legs?: number; stake?: number; total_odds?: number; combined_prob_pct?: number;
  ev_pct?: number; ev_gold?: number; potential?: number;
  riskiest?: { label: string; market: string; match: string; odds: number };
  history?: {
    rounds: number; won: number; net: number;
    similar_played: number; similar_won: number; similar_net: number;
  };
  mirror_flags?: MirrorFlag[];
  // v2 (0148): bacak-başına + anlık davranış + takım tuzağı + olgunluk — hepsi deterministik
  per_leg?: CouponLegReview[];
  behavior_now?: {
    balance: number; stake_pct_balance: number | null; chase: boolean;
    last_result: string | null; bets_last_hour: number; loss_streak: number;
  };
  loyalty_traps?: { team: string; bets: number; won: number; net: number }[];
  maturity?: { coupons: number; days_active: number; level: 'new' | 'forming' | 'ready' };
}

export async function fetchCouponReview(selections: unknown[], stake: number): Promise<CouponReview | null> {
  const { data, error } = await supabase.rpc('coupon_review', { p_selections: selections, p_stake: stake });
  if (error) return null;
  return (data ?? null) as CouponReview | null;
}

export async function fetchCouponJudge(review: CouponReview, lang = 'en'): Promise<{ text: string | null; reason?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('coupon-judge', { body: { review, lang } });
    if (error) return { text: null };
    const d = data as { text?: string | null; reason?: string };
    return { text: d?.text ?? null, reason: d?.reason };
  } catch {
    return { text: null };
  }
}

// Hakem hafızası (0149): kararname defteri + karne + yüzleşme.
export async function logJudgeVerdict(review: CouponReview, text: string | null): Promise<void> {
  try { await supabase.rpc('log_judge_verdict', { p_review: review, p_text: text }); } catch { /* defter yazımı UX'i bozmaz */ }
}

export interface JudgeScorecard {
  ready: boolean;
  verdicts?: number; played?: number; warned?: number; warned_played?: number;
  warned_won?: number; warned_lost?: number;
  gold_lost_after_warning?: number; gold_saved_if_heeded?: number;
  week?: { verdicts: number; warned_played: number; cost: number };
}
export async function fetchJudgeScorecard(): Promise<JudgeScorecard | null> {
  const { data, error } = await supabase.rpc('judge_scorecard');
  if (error) return null;
  return (data ?? null) as JudgeScorecard | null;
}

export type JudgeConfrontation = { prob_pct: number | null; ev_gold: number | null; warned: boolean };
export async function fetchJudgeConfrontations(couponIds: string[]): Promise<Record<string, JudgeConfrontation>> {
  if (couponIds.length === 0) return {};
  const { data, error } = await supabase.rpc('judge_confrontations', { p_coupon_ids: couponIds });
  if (error) return {};
  return (data ?? {}) as Record<string, JudgeConfrontation>;
}

export async function fetchMatchPreview(matchId: string, lang = 'en'): Promise<string | null> {
  try {
    const { data, error } = await supabase.functions.invoke('match-preview', { body: { match_id: matchId, lang } });
    if (error) return null;
    return ((data as { text?: string | null })?.text ?? null);
  } catch {
    return null;
  }
}

// Gerçeklik kontrolü (anti-kumar ayıraçları).
export interface RealityAlert { code: string; level: 'danger' | 'warn'; value: Record<string, number> }
export type RealityCheck =
  | { ready: false }
  | { ready: true; balance: number; net7: number; alerts: RealityAlert[] };
export async function fetchRealityCheck(): Promise<RealityCheck> {
  const { data, error } = await supabase.rpc('mirror_reality_check');
  if (error) throw new Error(error.message);
  return (data ?? { ready: false }) as RealityCheck;
}

export interface CardTrait { label: string; value: string; tone: 'good' | 'warn' | 'info' }
export type PlayerCard =
  | { ready: false }
  | {
      ready: true; archetype: string; emoji: string;
      traits: CardTrait[]; total_net: number; total_plays: number;
    };
async function _fetchPlayerCard(): Promise<PlayerCard> {
  const { data, error } = await supabase.rpc('mirror_card');
  if (error) throw new Error(error.message);
  return (data ?? { ready: false }) as PlayerCard;
}

export interface BenchmarkAxis {
  key: string; label: string; metric: string;
  dir: 'low_good' | 'high_good' | 'neutral';
  you: number; avg: number; percentile: number; unit: 'pct' | 'x';
}
export type BenchmarkProfile =
  | { ready: false }
  | { ready: true; population: number; axes: BenchmarkAxis[] };

async function _fetchBenchmark(): Promise<BenchmarkProfile> {
  const { data, error } = await supabase.rpc('mirror_benchmark');
  if (error) throw new Error(error.message);
  return (data ?? { ready: false }) as BenchmarkProfile;
}

// Sohbet mizacı (maç yorumlarından tilt oranı).
export type ChatProfile =
  | { ready: false; rounds?: number; need?: number }
  | { ready: true; comments: number; tilt_rate: number; avg_len: number; flags: MirrorFlag[] };
async function _fetchChatMirror(): Promise<ChatProfile> {
  const { data, error } = await supabase.rpc('mirror_chat');
  if (error) throw new Error(error.message);
  return (data ?? { ready: false }) as ChatProfile;
}

async function _fetchOverview(): Promise<OverviewProfile> {
  const { data, error } = await supabase.rpc('mirror_overview');
  if (error) throw new Error(error.message);
  return (data ?? { ready: false }) as OverviewProfile;
}
export async function fetchCouponMirror(): Promise<CouponProfile> {
  const { data, error } = await supabase.rpc('mirror_coupon');
  if (error) throw new Error(error.message);
  return (data ?? { ready: false }) as CouponProfile;
}
export async function fetchSlotMirror(): Promise<SlotProfile> {
  const { data, error } = await supabase.rpc('mirror_slot');
  if (error) throw new Error(error.message);
  return (data ?? { ready: false }) as SlotProfile;
}

// --- Ayna+ (0133): anket + öz-algı + Paralel Sen + tilt şeridi ---------------

export interface Survey { team: string | null; fav_game: string | null; self_style: 'temkinli' | 'dengeli' | 'agresif' | null; city: string | null }

export async function fetchSurvey(): Promise<Survey | null> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return null;
  const { data } = await supabase.from('user_survey').select('team, fav_game, self_style, city').eq('user_id', u.user.id).maybeSingle();
  return (data as Survey | null) ?? null;
}

export async function saveSurvey(s: Survey): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error('giris gerekli');
  const { error } = await supabase.from('user_survey').upsert({ user_id: u.user.id, ...s, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

export type ParallelProfile =
  | { ready: false; n?: number; need?: number }
  | {
      ready: true; n: number; actual: number;
      strat: { t: number; net: number }[];
      series: { i: number; a: number; b: number; c: number }[];   // a=gerçek, b=1.5x, c=3x (kümülatif)
    };
export async function fetchParallel(): Promise<ParallelProfile> {
  const { data, error } = await supabase.rpc('mirror_parallel');
  if (error) throw new Error(error.message);
  return data as ParallelProfile;
}

export type TiltProfile =
  | { ready: false; n?: number; need?: number }
  | {
      ready: true; n: number;
      points: { g: 'av' | 'go'; st: number; net: number; tl: boolean }[];
      tilt_count: number; tilt_net: number;
      raise_loss: number | null; raise_win: number | null;
    };
export async function fetchTilt(): Promise<TiltProfile> {
  const { data, error } = await supabase.rpc('mirror_tilt');
  if (error) throw new Error(error.message);
  return data as TiltProfile;
}

export type SelfGapProfile =
  | { ready: false; n?: number; need?: number; survey?: Survey | null }
  | {
      ready: true; score: number; style: 'temkinli' | 'dengeli' | 'agresif';
      survey: (Survey & { user_id?: string }) | null;
      comps: { target: number; chase: number; vol: number };
    };
export async function fetchSelfGap(): Promise<SelfGapProfile> {
  const { data, error } = await supabase.rpc('mirror_selfgap');
  if (error) throw new Error(error.message);
  return data as SelfGapProfile;
}

// 30sn promise-memo: Genel sekmesi kartları + CoachBlock aynı mirror RPC'lerini
// mükerrer çekiyordu (açılışta 4 gereksiz istek) — aynı promise paylaşılır.
const _memo = new Map<string, { at: number; p: Promise<unknown> }>();
function memo30<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = _memo.get(key);
  if (hit && Date.now() - hit.at < 30_000) return hit.p as Promise<T>;
  const pr = fn().catch((e) => { _memo.delete(key); throw e; });
  _memo.set(key, { at: Date.now(), p: pr });
  return pr;
}

export const fetchPlayerCard = () => memo30('pcard', _fetchPlayerCard);
export const fetchBenchmark  = () => memo30('bench', _fetchBenchmark);
export const fetchChatMirror = () => memo30('chatm', _fetchChatMirror);
export const fetchOverview   = () => memo30('ovw',   _fetchOverview);
