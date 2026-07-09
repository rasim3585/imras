// Provider-agnostic shapes for REAL fixtures. Nothing downstream (cron, solver,
// bulletin) knows which vendor the data came from -- BSD today, API-Sports
// tomorrow. If BSD (a single dev, likely scraping) goes down, we write another
// FixtureProvider and the callers don't change.

export type RawStatus = 'notstarted' | 'inprogress' | 'penalties' | 'finished';

export interface RawFixture {
  externalId: number;
  leagueId: number | null;
  leagueName: string | null;
  homeTeam: string;
  awayTeam: string;
  homeTeamId: number | null;
  awayTeamId: number | null;
  kickoffAt: Date;
  status: RawStatus;
  period: string | null;
  currentMinute: number | null;
  homeScore: number | null;
  awayScore: number | null;
  homeScoreHt: number | null;
  awayScoreHt: number | null;
  isLocalDerby: boolean;
  weather: unknown | null;
  headToHead: unknown | null;
  liveWebsocket: boolean;
}

/** BSD consensus pre-match odds. Some fixtures have no odds -> null. */
export interface RawPrematchOdds {
  homeWin: number;
  draw: number;
  awayWin: number;
  over15: number;  under15: number;
  over25: number;  under25: number;
  over35: number;  under35: number;
  bttsYes: number; bttsNo: number;
}

export interface FixtureProvider {
  readonly name: string;
  /** Fixtures kicking off in [from, to] (date-filtered -- the full list is 71k+). */
  fetchFixtures(from: Date, to: Date): Promise<RawFixture[]>;
  /** Consensus pre-match odds for one fixture, or null if the book has none. */
  fetchPrematchOdds(externalId: number): Promise<RawPrematchOdds | null>;
  /** Currently in-progress fixtures (score + minute only; we never pull live odds). */
  fetchLiveFixtures(): Promise<RawFixture[]>;
}
