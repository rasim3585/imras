import type { SupabaseClient } from '@supabase/supabase-js';
import type { RawFixture } from '../providers/types';

// Shared helpers for the sync jobs. The jobs are runtime-agnostic (they take a
// client + provider and know nothing about scheduling); src/cron/runner.ts is
// the only Node entry that wires env + timers. Swap Railway for an Edge Function
// later and the job logic doesn't change.

export function errStatus(e: unknown): number | null {
  return (e as { httpStatus?: number } | null)?.httpStatus ?? null;
}
export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export interface SyncLogRow {
  provider: string;
  endpoint: string;
  http_status?: number | null;
  success: boolean;
  error_message?: string | null;
  fixture_id?: string | null;
}

/** Append to provider_sync_log. Logging must NEVER throw the job. */
export async function logSync(client: SupabaseClient, row: SyncLogRow): Promise<void> {
  try { await client.from('provider_sync_log').insert(row); } catch { /* swallow */ }
}

/** RawFixture -> real_fixtures columns. Deliberately omits lambda_home/away and
 *  prematch_odds so an upsert never clobbers a solved lambda. */
export function fixtureRow(providerName: string, f: RawFixture) {
  return {
    provider: providerName,
    external_id: f.externalId,
    league_id: f.leagueId,
    league_name: f.leagueName,
    home_team: f.homeTeam,
    away_team: f.awayTeam,
    home_team_id: f.homeTeamId,
    away_team_id: f.awayTeamId,
    kickoff_at: f.kickoffAt.toISOString(),
    status: f.status,
    period: f.period,
    current_minute: f.currentMinute,
    home_score: f.homeScore,
    away_score: f.awayScore,
    home_score_ht: f.homeScoreHt,
    away_score_ht: f.awayScoreHt,
    is_local_derby: f.isLocalDerby,
    weather: f.weather,
    head_to_head: f.headToHead,
    live_websocket: f.liveWebsocket,
    last_synced_at: new Date().toISOString(),
  };
}
