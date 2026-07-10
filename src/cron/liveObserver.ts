import type { SupabaseClient } from '@supabase/supabase-js';
import type { FixtureProvider, RawFixture } from '../providers/types';

// OBSERVATION-ONLY layer for the feed-latency study. It writes to:
//   live_feed_pulse   -- one row per live match per sync round (score_changed
//                        is computed in SQL from the previous pulse)
//   live_incidents    -- one row per BSD incident, idempotent on bsd_incident_id
// It ENFORCES NOTHING. No market ever closes from here; market_suspensions is
// untouched. Every call is best-effort: a failure warns and returns, it NEVER
// throws the sync loop (see syncLiveScores -- the score update must be unaffected).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const scoreStr = (h: number | null, a: number | null): string | null =>
  (typeof h === 'number' && typeof a === 'number') ? `${h}-${a}` : null;

// BSD raw incident type -> our canonical type. CONFIRMED against live payloads
// (2026-07-09): BSD emits `goal`, `card` (with a `card_type` sub-field), `sub-
// stitution`, `period` -> 'period', `injuryTime` -> 'injury_time'. Cards are a
// SINGLE `card` type split by `card_type` ("yellow"/"red"/...) -- handled in
// classify(), not this table. `penalty`/`var` are NOT yet observed live (kept as
// guesses). A genuinely unknown type -> 'other' (never dropped); the full raw
// object always lands in live_incidents.detail.
const INCIDENT_TYPE: Record<string, string> = {
  goal: 'goal', score: 'goal', goal_scored: 'goal',
  penalty: 'penalty_awarded', penalty_won: 'penalty_awarded', penalty_awarded: 'penalty_awarded',
  red_card: 'red_card', redcard: 'red_card', red: 'red_card',
  var: 'var_review', var_check: 'var_review', var_review: 'var_review',
  yellow_card: 'yellow_card', yellowcard: 'yellow_card', yellow: 'yellow_card',
  substitution: 'substitution', sub: 'substitution', subst: 'substitution',
  period: 'period',                                 // half/period markers (not betting-relevant)
  injurytime: 'injury_time', injury_time: 'injury_time',
};
export function classify(item: Raw): string {
  const t = String(item?.type ?? item?.incident_type ?? item?.kind ?? '').toLowerCase().trim();
  if (t === 'card') {
    // BSD carries the colour in card_type, not the type. A second yellow is an
    // ejection -> red_card (that is the betting-relevant signal).
    const c = String(item?.card_type ?? item?.card ?? '').toLowerCase();
    if (c.includes('red') || c.includes('secondyellow') || c.includes('second_yellow') || c.includes('yellowred')) return 'red_card';
    if (c.includes('yellow')) return 'yellow_card';
    return 'other';                                // unknown card colour -> raw kept in detail
  }
  return INCIDENT_TYPE[t] ?? 'other';
}

// A stable id so an incident carrying no vendor id still dedups across rounds
// (record_live_incident is idempotent on bsd_incident_id).
function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
function incidentId(item: Raw): string {
  const vendor = item?.id ?? item?.incident_id ?? item?.uuid ?? item?.event_id;
  return vendor != null ? String(vendor) : `h_${djb2(JSON.stringify(item ?? {}))}`;
}
function teamSide(item: Raw): 'home' | 'away' | null {
  const t = item?.team ?? (item?.is_home === true ? 'home' : item?.is_home === false ? 'away' : null);
  return t === 'home' || t === 'away' ? t : null;
}

// Record one live match's observations for this round. `priorScore` is the score
// we held BEFORE this round's update (so a goal can log an honest score_before).
export async function recordObservations(
  client: SupabaseClient,
  provider: FixtureProvider,
  fixtureId: string,
  frame: RawFixture,
  priorScore: string | null,
): Promise<void> {
  // 1. Pulse -- every live match, every round. Returns true if the score changed.
  try {
    await client.rpc('record_feed_pulse', {
      p_fixture_id: fixtureId,
      p_minute: frame.currentMinute,
      p_home: frame.homeScore,
      p_away: frame.awayScore,
      p_status: frame.status,
    });
  } catch (e) {
    console.warn(`[observer] pulse failed for ${fixtureId}:`, e instanceof Error ? e.message : e);
  }

  // 2. Incidents -- one extra HTTP call per live match. Mapped defensively; the
  //    idempotent RPC dedups on bsd_incident_id so we can re-send every round.
  let incidents: unknown[];
  try {
    incidents = await provider.fetchIncidents(frame.externalId);
  } catch (e) {
    const status = (e as { httpStatus?: number } | null)?.httpStatus;
    console.warn(`[observer] incidents fetch failed for ${frame.externalId}${status ? ` (HTTP ${status})` : ''}:`,
      e instanceof Error ? e.message : e);
    return;
  }

  const liveScore = scoreStr(frame.homeScore, frame.awayScore);
  for (const raw of incidents as Raw[]) {
    const type = classify(raw);
    const isGoal = type === 'goal';
    // A goal incident carries the post-goal score inline (home_score/away_score);
    // prefer that for score_after, fall back to the live frame.
    const scoreAfter = scoreStr(num(raw?.home_score), num(raw?.away_score)) ?? liveScore;
    try {
      await client.rpc('record_live_incident', {
        p_fixture_id: fixtureId,
        p_bsd_id: incidentId(raw),
        p_type: type,
        p_team_side: teamSide(raw),
        p_minute: num(raw?.minute ?? raw?.time ?? raw?.match_minute),
        p_detail: raw ?? {},                       // full raw event, exactly as BSD sent it
        p_score_before: isGoal ? priorScore : null,
        p_score_after: isGoal ? scoreAfter : null,
      });
    } catch (e) {
      console.warn(`[observer] incident write failed for ${fixtureId}:`, e instanceof Error ? e.message : e);
    }
  }
}
