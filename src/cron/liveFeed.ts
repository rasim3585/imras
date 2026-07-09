// One interface, two implementations. PollingFeed (now, free REST) and later
// WebSocketFeed (paid, same interface). Consumers (the runner) subscribe to the
// matches users are watching and get score / event / stats frames pushed to them
// -- they never care which transport delivered them. When the socket lands we
// keep polling as the fallback; if the socket drops we degrade to REST, not to
// nothing.

export interface ScoreFrame {
  externalId: number;
  status: string;
  period: string | null;
  minute: number | null;
  homeScore: number | null;
  awayScore: number | null;
  at: Date;
}

export interface EventFrame {
  externalId: number;
  minute: number | null;
  type: string;                       // BSD incident type: 'goal' | 'card' | ...
  team: 'home' | 'away' | null;
  raw: unknown;                        // full incident; shape firms up after the live test
}

export interface StatsFrame {
  externalId: number;
  momentum: number[];                 // the array we test tomorrow (empty pre-match)
  xgHome: number | null;
  xgAway: number | null;
  raw: unknown;
}

export interface LiveFeed {
  /** Watch these fixtures (provider external ids as strings) for stats/incidents. */
  subscribe(fixtureIds: string[]): void;
  unsubscribe(fixtureIds: string[]): void;
  onScore(cb: (f: ScoreFrame) => void): void;
  onEvent(cb: (f: EventFrame) => void): void;
  onStats(cb: (f: StatsFrame) => void): void;
  close(): void;
}
