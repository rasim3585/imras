import type { FixtureProvider, RawFixture, RawPrematchOdds, RawStatus } from './types';

// BSD (sports.bzzoiro.com) fixture provider. Free football tier, token auth.
// Config (key + base URL) is injected -- this file never touches process.env, so
// it compiles under the browser tsconfig; the Node cron entry reads .env and
// passes it in. We only ever GET fixtures / consensus odds / live scores -- never
// live odds (our own engine prices those).

export interface BSDConfig { apiKey: string; baseUrl?: string }

const STATUSES = new Set<RawStatus>(['notstarted', 'inprogress', 'penalties', 'finished']);
const asStatus = (s: unknown): RawStatus => (typeof s === 'string' && STATUSES.has(s as RawStatus) ? (s as RawStatus) : 'notstarted');
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapFixture(e: any): RawFixture {
  return {
    externalId: e.id,
    leagueId: numOrNull(e.league_id),
    leagueName: typeof e.league_name === 'string' ? e.league_name : null,
    homeTeam: e.home_team ?? '',
    awayTeam: e.away_team ?? '',
    homeTeamId: numOrNull(e.home_team_id),
    awayTeamId: numOrNull(e.away_team_id),
    kickoffAt: new Date(e.event_date),
    status: asStatus(e.status),
    period: e.period ? String(e.period) : null,
    currentMinute: numOrNull(e.current_minute),
    homeScore: numOrNull(e.home_score),
    awayScore: numOrNull(e.away_score),
    homeScoreHt: numOrNull(e.home_score_ht),
    awayScoreHt: numOrNull(e.away_score_ht),
    isLocalDerby: e.is_local_derby === true,
    weather: e.weather ?? null,
    headToHead: e.head_to_head ?? null,
    liveWebsocket: e.live_websocket === true,
  };
}

export class BSDProvider implements FixtureProvider {
  readonly name = 'bsd';
  private readonly key: string;
  private readonly base: string;

  constructor(cfg: BSDConfig) {
    this.key = cfg.apiKey;
    this.base = (cfg.baseUrl ?? 'https://sports.bzzoiro.com').replace(/\/$/, '');
  }

  private async getJson(url: string): Promise<unknown> {
    const res = await fetch(url, { headers: { Authorization: `Token ${this.key}` } });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err = new Error(`BSD ${res.status} on ${url}: ${body.slice(0, 200)}`) as Error & { httpStatus?: number };
      err.httpStatus = res.status;
      throw err;
    }
    return res.json();
  }

  private ymd(d: Date): string { return d.toISOString().slice(0, 10); }

  async fetchFixtures(from: Date, to: Date): Promise<RawFixture[]> {
    // date-filtered (the unfiltered list is 71k+); follow `next` pagination.
    let url: string | null = `${this.base}/api/v2/events/?date_from=${this.ymd(from)}&date_to=${this.ymd(to)}&limit=50`;
    const out: RawFixture[] = [];
    for (let page = 0; url && page < 200; page++) {
      const j = await this.getJson(url) as { results?: unknown[]; next?: string | null };
      for (const e of j.results ?? []) out.push(mapFixture(e));
      url = j.next ?? null;
    }
    return out;
  }

  async fetchLiveFixtures(): Promise<RawFixture[]> {
    // NOTE: live payload is { count, events } -- NOT `results`.
    const j = await this.getJson(`${this.base}/api/v2/events/live/`) as { count?: number; events?: unknown[] };
    return (j.events ?? []).map(mapFixture);
  }

  async fetchPrematchOdds(externalId: number): Promise<RawPrematchOdds | null> {
    const j = await this.getJson(`${this.base}/api/v2/events/${externalId}/odds/`) as { odds?: Record<string, number> };
    const o = j.odds;
    if (!o || o.home_win == null || o.draw == null || o.away_win == null) return null;
    return {
      homeWin: o.home_win, draw: o.draw, awayWin: o.away_win,
      over15: o.over_15_goals, under15: o.under_15_goals,
      over25: o.over_25_goals, under25: o.under_25_goals,
      over35: o.over_35_goals, under35: o.under_35_goals,
      bttsYes: o.btts_yes, bttsNo: o.btts_no,
    };
  }
}
