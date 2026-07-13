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
  key: 'aviator' | 'slot' | 'coupon'; label: string;
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
      ready: true; archetype: string; emoji: string; subtitle: string;
      traits: CardTrait[]; total_net: number; total_plays: number;
    };
export async function fetchPlayerCard(): Promise<PlayerCard> {
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

export async function fetchBenchmark(): Promise<BenchmarkProfile> {
  const { data, error } = await supabase.rpc('mirror_benchmark');
  if (error) throw new Error(error.message);
  return (data ?? { ready: false }) as BenchmarkProfile;
}

export async function fetchOverview(): Promise<OverviewProfile> {
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
