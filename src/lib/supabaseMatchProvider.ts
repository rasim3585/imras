import { supabase } from './supabase';
import type { MatchProvider, PlacedCoupon } from './matchProvider';
import type {
  Coupon, CouponLeg, CouponSettlement, LiveState, Market, Match,
  DailyBonus, Challenge, Leaderboard, League, LeagueDetail, Rival, SharedCoupon,
  BulletinMatch, CartSelection, MatchStats, StandingsRow, TeamPage, SlotResult,
} from './types';

// Explicit match columns — omits `true_probabilities` (hidden) and
// `display_odds` (server-only seed input; odds are exposed via market_options).
const MATCH_COLS =
  'id,sport,home_team,away_team,starts_at,status,home_score,away_score,result,timeline';

// Nested embed used for coupons. A leg is EITHER virtual (market_option_id ->
// market_options -> markets -> matches) OR real (market_option_id null;
// real_fixture_id + market_type + outcome_key on the selection -> real_fixtures).
// Both embeds are LEFT joins (nullable FKs), so real legs are NOT dropped.
const COUPON_SELECT =
  `*, coupon_selections(id, odds, status, leg_status, market_type, outcome_key, real_fixture_id, ` +
  `market_options(id, label, outcome_key, is_winner, ` +
  `markets(name, market_type, matches(id, home_team, away_team, result, home_score, away_score, timeline))), ` +
  `real_fixtures(id, home_team, away_team, home_score, away_score))`;

// Human labels for real legs (virtual legs carry their own label/name).
const MARKET_NAMES: Record<string, string> = {
  match_result: 'Match Result', double_chance: 'Double Chance', both_teams_score: 'Both Teams to Score',
  over_under_1_5: 'Total Goals 1.5', over_under_2_5: 'Total Goals 2.5', over_under_3_5: 'Total Goals 3.5', odd_even: 'Odd / Even',
};
const OUTCOME_LABELS: Record<string, string> = {
  home: '1', draw: 'X', away: '2', dc_1x: '1X', dc_12: '12', dc_x2: 'X2', btts_yes: 'Yes', btts_no: 'No',
  ou15_over: 'Over 1.5', ou15_under: 'Under 1.5', ou25_over: 'Over 2.5', ou25_under: 'Under 2.5',
  ou35_over: 'Over 3.5', ou35_under: 'Under 3.5', oe_odd: 'Odd', oe_even: 'Even',
};

/** Supabase-backed provider. All simulation (results, odds, stake math,
 *  settlement) runs server-side in Postgres RPCs — this only maps data. */
export class SupabaseMatchProvider implements MatchProvider {
  async ensureMatches(): Promise<void> {
    const { error } = await supabase.rpc('seed_matches', { p_target: 8 });
    if (error) throw new Error(error.message);
  }

  async finalizeDueMatches(): Promise<number> {
    const { data, error } = await supabase.rpc('finalize_due_matches');
    if (error) throw new Error(error.message);
    return Number(data ?? 0);
  }

  async getBulletin(): Promise<BulletinMatch[]> {
    // one RPC returns real BSD fixtures + virtual matches, already priced for the
    // current minute/score. Closed markets are omitted server-side.
    // 0715: limit 60 -> 120; sanal mac sayilari dusuruldugu icin dogal toplam
    // ~40 — hep "tam 60" gorunmesi inandiriciligi bozuyordu, artik tavana
    // carpma pratikte imkansiz.
    const { data, error } = await supabase.rpc('get_bulletin', { p_limit: 120 });
    if (error) throw new Error(error.message);
    return ((data ?? []) as BulletinMatch[]).map((m) => ({
      ...m,
      markets: (m.markets ?? []).map((mk) => ({
        ...mk,
        options: (mk.options ?? []).map((o) => ({ ...o, odds: Number(o.odds) })),
      })),
    }));
  }

  async getMatch(id: string): Promise<Match | null> {
    const { data, error } = await supabase
      .from('matches')
      .select(`${MATCH_COLS}, markets(id, match_id, market_type, name, status, sort_order, ` +
        `market_options(id, market_id, label, outcome_key, odds, is_winner, sort_order))`)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const raw = data as unknown as Match & { markets: (Market & { market_options: unknown })[] };
    const markets: Market[] = (raw.markets ?? [])
      .map((m) => {
        const opts = ((m as unknown as { market_options: Market['options'] }).market_options ?? [])
          .map((o) => ({ ...o, odds: Number(o.odds) }))
          .sort((a, b) => a.sort_order - b.sort_order);
        return { ...m, options: opts } as Market;
      })
      .sort((a, b) => a.sort_order - b.sort_order);
    return { ...(raw as Match), markets };
  }

  async getStandings(sport: 'football' | 'basketball' | 'tennis' | 'volleyball'): Promise<StandingsRow[]> {
    // 0715: _ex — spor-doğru puanlar (VNL/PCT/ATP) + form + seri
    const { data, error } = await supabase.rpc('vleague_standings_ex', { p_sport: sport });
    if (error) throw new Error(error.message);
    return (data ?? []) as StandingsRow[];
  }

  async getTeamPage(teamId: number): Promise<TeamPage | null> {
    const { data, error } = await supabase.rpc('vteam_page', { p_team_id: teamId });
    if (error) throw new Error(error.message);
    return (data ?? null) as TeamPage | null;
  }

  async getMatchStats(matchId: string): Promise<MatchStats | null> {
    const { data, error } = await supabase.rpc('vmatch_stats', { p_match_id: matchId });
    if (error) throw new Error(error.message);
    return (data ?? null) as MatchStats | null;
  }

  async slotSpin(bet: number, ante: boolean, buy: boolean): Promise<SlotResult> {
    const { data, error } = await supabase.rpc('slot_spin', { p_bet: bet, p_ante: ante, p_buy: buy });
    if (error) throw new Error(error.message);
    return data as SlotResult;
  }

  async getLiveStates(matchIds: string[]): Promise<LiveState[]> {
    if (matchIds.length === 0) return [];
    const { data, error } = await supabase.rpc('get_live_state', { p_match_ids: matchIds });
    if (error) throw new Error(error.message);
    return (data ?? []) as LiveState[];
  }

  async placeCoupon(selections: CartSelection[], stake: number): Promise<PlacedCoupon> {
    // virtual legs go by option_id; real legs by (fixture_id, market, outcome).
    const p_legs = selections.map((s) => (s.kind === 'virtual'
      ? { kind: 'virtual', option_id: s.option_id }
      : { kind: 'real', fixture_id: s.match_id, market: s.market_type, outcome: s.outcome_key }));
    const { data, error } = await supabase.rpc('place_coupon_v2', { p_legs, p_stake: stake });
    if (error) throw new Error(error.message);
    const d = data as PlacedCoupon;
    return {
      coupon_id: d.coupon_id,
      total_odds: Number(d.total_odds),
      potential_win: Number(d.potential_win),
      new_balance: Number(d.new_balance),
    };
  }

  async getMyCoupons(): Promise<Coupon[]> {
    // Açık limit: limitsiz sorgu PostgREST'in sessiz 1000 tavanına çarpıyordu —
    // hem şişkin yük hem "oynanan" sayısının 1000'de takılması. Liste = son 200;
    // kesin sayılar getCouponStats()'tan gelir.
    const { data, error } = await supabase
      .from('coupons')
      .select(COUPON_SELECT)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return (data ?? []).map(flattenCoupon);
  }

  async getCouponStats(): Promise<{ played: number; settled: number; won: number; biggest: number }> {
    // Sunucu tarafı KESİN sayımlar (RLS: kendi kuponları) — liste kapasitesinden bağımsız.
    const [p, s, w, b] = await Promise.all([
      supabase.from('coupons').select('id', { count: 'exact', head: true }),
      supabase.from('coupons').select('id', { count: 'exact', head: true }).in('status', ['won', 'lost', 'cashed_out']),
      supabase.from('coupons').select('id', { count: 'exact', head: true }).eq('status', 'won'),
      supabase.from('coupons').select('potential_win').eq('status', 'won').order('potential_win', { ascending: false }).limit(1),
    ]);
    return {
      played: p.count ?? 0,
      settled: s.count ?? 0,
      won: w.count ?? 0,
      biggest: Number((b.data?.[0] as { potential_win?: number } | undefined)?.potential_win ?? 0),
    };
  }

  async getCoupon(id: string): Promise<Coupon | null> {
    const { data, error } = await supabase
      .from('coupons')
      .select(COUPON_SELECT)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? flattenCoupon(data) : null;
  }

  async settleCoupon(id: string): Promise<CouponSettlement> {
    const { data, error } = await supabase.rpc('settle_coupon', { p_coupon_id: id });
    if (error) throw new Error(error.message);
    const d = data as CouponSettlement;
    return {
      ...d,
      in_progress: Boolean(d.in_progress),
      stake: Number(d.stake),
      total_odds: Number(d.total_odds),
      potential_win: Number(d.potential_win),
      new_balance: Number(d.new_balance),
      selections: (d.selections ?? []).map((s) => ({ ...s, odds: Number(s.odds) })),
    };
  }

  async getCashoutValue(couponId: string): Promise<{ value: number; available: boolean }> {
    const { data, error } = await supabase.rpc('get_cashout_value', { p_coupon_id: couponId });
    if (error) throw new Error(error.message);
    const d = data as { value: number; available: boolean };
    return { value: Number(d.value), available: Boolean(d.available) };
  }

  async doCashout(couponId: string): Promise<number> {
    const { data, error } = await supabase.rpc('do_cashout', { p_coupon_id: couponId });
    if (error) throw new Error(error.message);
    return Number((data as { new_balance: number }).new_balance);
  }

  async settleDueCoupons(): Promise<number> {
    const { data, error } = await supabase.rpc('settle_due_coupons');
    if (error) throw new Error(error.message);
    return Number(data ?? 0);
  }

  async claimDailyBonus(): Promise<DailyBonus> {
    const { data, error } = await supabase.rpc('claim_daily_bonus');
    if (error) throw new Error(error.message);
    return data as DailyBonus;
  }

  async getChallenges(): Promise<Challenge[]> {
    const { data, error } = await supabase.rpc('get_challenges');
    if (error) throw new Error(error.message);
    return (data ?? []) as Challenge[];
  }

  async claimChallenge(key: string): Promise<number> {
    const { data, error } = await supabase.rpc('claim_challenge', { p_key: key });
    if (error) throw new Error(error.message);
    return Number((data as { new_balance: number }).new_balance);
  }

  async getLeaderboard(scope: 'day' | 'week' | 'wins'): Promise<Leaderboard> {
    const { data, error } = await supabase.rpc('get_leaderboard', { p_scope: scope });
    if (error) throw new Error(error.message);
    return data as Leaderboard;
  }

  // --- social ---
  async createLeague(name: string): Promise<League> {
    const { data, error } = await supabase.rpc('create_league', { p_name: name });
    if (error) throw new Error(error.message);
    return data as League;
  }
  async joinLeague(code: string): Promise<{ id: string; name: string }> {
    const { data, error } = await supabase.rpc('join_league', { p_code: code });
    if (error) throw new Error(error.message.includes('No league') ? 'No league with that code' : error.message);
    return data as { id: string; name: string };
  }
  async leaveLeague(id: string): Promise<void> {
    const { error } = await supabase.rpc('leave_league', { p_league_id: id });
    if (error) throw new Error(error.message);
  }
  async getMyLeagues(): Promise<League[]> {
    const { data, error } = await supabase.rpc('get_my_leagues');
    if (error) throw new Error(error.message);
    return (data ?? []) as League[];
  }
  async getLeague(id: string): Promise<LeagueDetail> {
    const { data, error } = await supabase.rpc('get_league', { p_league_id: id });
    if (error) throw new Error(error.message);
    return data as LeagueDetail;
  }
  async addRival(username: string): Promise<void> {
    const { error } = await supabase.rpc('add_rival', { p_username: username });
    if (error) throw new Error(error.message.includes('No player') ? 'No player with that username' : error.message);
  }
  async removeRival(username: string): Promise<void> {
    const { error } = await supabase.rpc('remove_rival', { p_username: username });
    if (error) throw new Error(error.message);
  }
  async getRivals(): Promise<Rival[]> {
    const { data, error } = await supabase.rpc('get_rivals');
    if (error) throw new Error(error.message);
    return (data ?? []) as Rival[];
  }
  async shareCoupon(couponId: string): Promise<void> {
    const { error } = await supabase.rpc('share_coupon', { p_coupon_id: couponId });
    if (error) throw new Error(error.message);
  }
  async getSharedFeed(): Promise<SharedCoupon[]> {
    const { data, error } = await supabase.rpc('get_shared_feed');
    if (error) throw new Error(error.message);
    return (data ?? []) as SharedCoupon[];
  }

  async getSharedCoupon(id: string): Promise<SharedCoupon | null> {
    const { data, error } = await supabase.rpc('get_shared_coupon', { p_id: id });
    if (error) throw new Error(error.message);
    return (data ?? null) as SharedCoupon | null;
  }

  async topupGold(): Promise<number> {
    const { data, error } = await supabase.rpc('topup_gold');
    if (error) throw new Error(error.message);
    return Number((data as { new_balance: number }).new_balance);
  }
}

// Flatten the nested PostgREST coupon graph into UI-friendly legs.
function flattenCoupon(row: unknown): Coupon {
  const c = row as Record<string, unknown>;
  const rawLegs = (c.coupon_selections ?? []) as Record<string, unknown>[];
  const legs: CouponLeg[] = rawLegs.map((cs) => {
    const opt = cs.market_options as Record<string, unknown> | null;
    if (opt) {                                        // virtual leg
      const mk = opt.markets as Record<string, unknown>;
      return {
        id: cs.id as string,
        kind: 'virtual',
        odds: Number(cs.odds),
        status: (cs.leg_status ?? cs.status) as CouponLeg['status'],
        option_label: opt.label as string,
        outcome_key: opt.outcome_key as string,
        is_winner: (opt.is_winner as boolean | null) ?? null,
        market_name: mk.name as string,
        market_type: mk.market_type as string,
        match: mk.matches as CouponLeg['match'],
      };
    }
    // real leg: no market_option; use real_fixture + market_type/outcome_key
    const rf = cs.real_fixtures as Record<string, unknown> | null;
    const mt = cs.market_type as string;
    const ok = cs.outcome_key as string;
    return {
      id: cs.id as string,
      kind: 'real',
      odds: Number(cs.odds),
      status: (cs.leg_status ?? cs.status) as CouponLeg['status'],
      option_label: OUTCOME_LABELS[ok] ?? ok,
      outcome_key: ok,
      is_winner: null,
      market_name: MARKET_NAMES[mt] ?? mt,
      market_type: mt,
      match: {
        id: (rf?.id as string) ?? (cs.real_fixture_id as string),
        home_team: (rf?.home_team as string) ?? '—',
        away_team: (rf?.away_team as string) ?? '—',
        result: null,
        home_score: (rf?.home_score as number | null) ?? null,
        away_score: (rf?.away_score as number | null) ?? null,
      },
    };
  });
  return {
    id: c.id as string,
    user_id: c.user_id as string,
    stake: Number(c.stake),
    total_odds: Number(c.total_odds),
    potential_win: Number(c.potential_win),
    status: c.status as Coupon['status'],
    cashout_amount: (c.cashout_amount as number | null) ?? null,
    created_at: c.created_at as string,
    settled_at: (c.settled_at as string | null) ?? null,
    legs,
  };
}
