import type { EventFrame, LiveFeed, ScoreFrame, StatsFrame } from './liveFeed';

// REST implementation of LiveFeed. Free tier, no WebSocket.
//   /events/live/            every 30s  -> ScoreFrame for every live match (batched, one call)
//   /events/{id}/stats/      every 60s  -> StatsFrame, ONLY for subscribed matches
//   /events/{id}/incidents/  every 60s  -> EventFrame per NEW incident, ONLY subscribed
// We never fan out /events/{id}/ over the whole 30-match bulletin -- only the
// batched live call is global; per-match detail is limited to what users watch.

export interface PollingFeedConfig {
  apiKey: string;
  baseUrl?: string;
  liveMs?: number;      // score poll (default 30s)
  detailMs?: number;    // stats/incidents poll (default 60s)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export class PollingFeed implements LiveFeed {
  private readonly key: string;
  private readonly base: string;
  private readonly liveMs: number;
  private readonly detailMs: number;

  private readonly subs = new Set<string>();
  private readonly seenIncidents = new Map<string, Set<string>>();   // externalId -> incident keys
  private readonly scoreCbs: ((f: ScoreFrame) => void)[] = [];
  private readonly eventCbs: ((f: EventFrame) => void)[] = [];
  private readonly statsCbs: ((f: StatsFrame) => void)[] = [];

  private liveTimer: ReturnType<typeof setInterval> | null = null;
  private detailTimer: ReturnType<typeof setInterval> | null = null;

  constructor(cfg: PollingFeedConfig) {
    this.key = cfg.apiKey;
    this.base = (cfg.baseUrl ?? 'https://sports.bzzoiro.com').replace(/\/$/, '');
    this.liveMs = cfg.liveMs ?? 30_000;
    this.detailMs = cfg.detailMs ?? 60_000;
    this.liveTimer = setInterval(() => { void this.pollLive(); }, this.liveMs);
    this.detailTimer = setInterval(() => { void this.pollDetail(); }, this.detailMs);
  }

  subscribe(fixtureIds: string[]): void { for (const id of fixtureIds) this.subs.add(id); }
  unsubscribe(fixtureIds: string[]): void {
    for (const id of fixtureIds) { this.subs.delete(id); this.seenIncidents.delete(id); }
  }
  onScore(cb: (f: ScoreFrame) => void): void { this.scoreCbs.push(cb); }
  onEvent(cb: (f: EventFrame) => void): void { this.eventCbs.push(cb); }
  onStats(cb: (f: StatsFrame) => void): void { this.statsCbs.push(cb); }

  close(): void {
    if (this.liveTimer) clearInterval(this.liveTimer);
    if (this.detailTimer) clearInterval(this.detailTimer);
    this.liveTimer = this.detailTimer = null;
  }

  private async getJson(path: string): Promise<Json | null> {
    try {
      const res = await fetch(`${this.base}${path}`, { headers: { Authorization: `Token ${this.key}` } });
      if (!res.ok) { console.warn(`[pollingFeed] ${res.status} on ${path}`); return null; }
      return await res.json();
    } catch (e) {
      console.warn(`[pollingFeed] fetch failed ${path}:`, e instanceof Error ? e.message : e);
      return null;                                   // a feed must never throw its own loop
    }
  }

  // batched score for ALL live matches
  private async pollLive(): Promise<void> {
    const j = await this.getJson('/api/v2/events/live/') as { events?: Json[] } | null;
    for (const e of j?.events ?? []) {
      const f: ScoreFrame = {
        externalId: e.id,
        status: String(e.status ?? ''),
        period: e.period ? String(e.period) : null,
        minute: numOrNull(e.current_minute),
        homeScore: numOrNull(e.home_score),
        awayScore: numOrNull(e.away_score),
        at: new Date(),
      };
      for (const cb of this.scoreCbs) cb(f);
    }
  }

  // per-subscribed-match stats + incidents
  private async pollDetail(): Promise<void> {
    for (const id of this.subs) {
      const ext = Number(id);
      const stats = await this.getJson(`/api/v2/events/${id}/stats/`) as Json | null;
      if (stats) {
        const frame: StatsFrame = {
          externalId: ext,
          momentum: Array.isArray(stats.momentum) ? stats.momentum : [],
          xgHome: numOrNull(stats?.stats?.home?.xg?.actual),
          xgAway: numOrNull(stats?.stats?.away?.xg?.actual),
          raw: stats,
        };
        for (const cb of this.statsCbs) cb(frame);
      }

      const inc = await this.getJson(`/api/v2/events/${id}/incidents/`) as { incidents?: Json[] } | null;
      if (inc) {
        const seen = this.seenIncidents.get(id) ?? new Set<string>();
        for (const item of inc.incidents ?? []) {
          const k = JSON.stringify(item);            // shape TBD -> dedup on the whole item
          if (seen.has(k)) continue;
          seen.add(k);
          const teamRaw = item.team ?? (item.is_home === true ? 'home' : item.is_home === false ? 'away' : null);
          const frame: EventFrame = {
            externalId: ext,
            minute: numOrNull(item.minute ?? item.time),
            type: String(item.type ?? item.incident_type ?? 'unknown'),
            team: teamRaw === 'home' || teamRaw === 'away' ? teamRaw : null,
            raw: item,
          };
          for (const cb of this.eventCbs) cb(frame);
        }
        this.seenIncidents.set(id, seen);
      }
    }
  }
}
