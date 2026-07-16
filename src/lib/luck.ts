import { supabase } from './supabase';

// Luck Games — Dice / Plinko / Mines. Hepsi sunucu-otoriter (para düşüş/iade
// RPC içinde), provably fair (seed sonucu belirler), RTP %97.

export interface DiceResult {
  id: number; roll: number; win: boolean; chance: number; dir: 'under' | 'over';
  mult: number; payout: number; seed: string; balance: number;
}
export async function diceRoll(bet: number, chance: number, dir: 'under' | 'over'): Promise<DiceResult> {
  const { data, error } = await supabase.rpc('dice_roll', { p_bet: bet, p_chance: chance, p_dir: dir });
  if (error) throw new Error(error.message);
  return data as DiceResult;
}

export interface PlinkoResult {
  id: number; bucket: number; mult: number; payout: number; path: string;
  risk: 'low' | 'med' | 'high'; seed: string; balance: number;
}
export async function plinkoDrop(bet: number, risk: 'low' | 'med' | 'high'): Promise<PlinkoResult> {
  const { data, error } = await supabase.rpc('plinko_drop', { p_bet: bet, p_risk: risk });
  if (error) throw new Error(error.message);
  return data as PlinkoResult;
}
// Frontend'de kova çarpanlarını göstermek için (sunucudakiyle birebir).
export const PLINKO_TABLES: Record<'low' | 'med' | 'high', number[]> = {
  low: [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1, 0.5, 1, 1.1, 1.2, 1.4, 1.4, 2, 9, 16],
  med: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110],
  high: [1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2, 0.2, 0.2, 2, 4, 9, 26, 130, 1000],
};
const PLINKO_SCALE: Record<'low' | 'med' | 'high', number> = {
  low: 0.97 / 0.9900, med: 0.97 / 0.9899, high: 0.97 / 0.9898,
};
export const plinkoMult = (risk: 'low' | 'med' | 'high', bucket: number) =>
  Math.round(PLINKO_TABLES[risk][bucket] * PLINKO_SCALE[risk] * 100) / 100;

export interface MinesState {
  game_id: number; status: 'active' | 'cashed' | 'lost';
  bet?: number; mines?: number; mult?: number; next_mult?: number; balance?: number;
  cell?: number; safe?: boolean; revealed_count?: number;
  mine_cells?: number[]; seed?: string; payout?: number;
}
export async function minesStart(bet: number, mines: number): Promise<MinesState> {
  const { data, error } = await supabase.rpc('mines_start', { p_bet: bet, p_mines: mines });
  if (error) throw new Error(error.message);
  return data as MinesState;
}
export async function minesReveal(gameId: number, cell: number): Promise<MinesState> {
  const { data, error } = await supabase.rpc('mines_reveal', { p_game: gameId, p_cell: cell });
  if (error) throw new Error(error.message);
  return data as MinesState;
}
export async function minesCashout(gameId: number): Promise<MinesState> {
  const { data, error } = await supabase.rpc('mines_cashout', { p_game: gameId });
  if (error) throw new Error(error.message);
  return data as MinesState;
}
// Aktif Mines oyununu geri getir (sayfa yenileme / geri tuşu kurtarması).
// undefined = RPC yok ya da erişilemedi (sessizce geç), null = aktif oyun yok.
// Sunucu tarafı mines_active() SQL-KUYRUK'ta — RPC canlıya alınana dek bu
// çağrı zararsız şekilde undefined döner.
export interface MinesActiveGame {
  game_id: number; bet: number; mines: number; mult: number; revealed: number[];
}
export async function minesActive(): Promise<MinesActiveGame | null | undefined> {
  const { data, error } = await supabase.rpc('mines_active');
  if (error) return undefined;
  return (data ?? null) as MinesActiveGame | null;
}

// fair çarpan (sunucu _mines_mult ile birebir) — sıradaki kutunun değerini önden göster
export function minesMult(mines: number, k: number): number {
  let m = 1;
  for (let j = 0; j < k; j++) m *= (25 - j) / (25 - mines - j);
  return Math.min(10000, Math.round(0.97 * m * 100) / 100);
}
