import { makeClient, makeProvider } from './_client';
import { syncFixtures } from './syncFixtures';
import { solveLambdas } from './solveLambdas';

// Node entry (Railway). The ONLY file that knows about scheduling. A long-
// running process is deliberate: it can later hold the BSD live_websocket
// connection (see docs/websocket) and drop polling entirely.
// Env (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BSD_API_KEY) is validated in
// _client.ts -- a missing var fails loud there.

const client = makeClient();
const provider = makeProvider();

// run a job, never let a failure kill the loop
function safe(label: string, job: () => Promise<unknown>): void {
  job()
    .then((r) => console.log(`[cron:${label}] ok`, r ?? ''))
    .catch((e) => console.error(`[cron:${label}] failed:`, e instanceof Error ? e.message : e));
}

const syncFixturesJob = () => syncFixtures(client, provider, new Date(), new Date(Date.now() + 2 * 24 * 3600 * 1000));

// fixtures: once on boot, then daily at 03:00 UTC
function scheduleDailyUTC(hour: number, run: () => void): void {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, 0, 0));
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  setTimeout(() => { run(); setInterval(run, 24 * 3600 * 1000); }, next.getTime() - now.getTime());
}

safe('fixtures:boot', syncFixturesJob);
scheduleDailyUTC(3, () => safe('fixtures:daily', syncFixturesJob));

// lambda: every 15 min (kickoff -6h fixtures without a lambda)
// TEMPORARY: kept here as a backup until the solve-lambdas Edge Function is
// deployed AND verified pricing a real fixture. Once confirmed, remove this too.
setInterval(() => safe('lambda', () => solveLambdas(client, provider)), 15 * 60 * 1000);

// live score: NOT here. It runs in Postgres via pg_cron (pickplay_live, 30s:
// pulls in-progress fixtures and updates score/minute/status). Tested against 3
// live matches. Keeping a second Node live loop only split the source of truth
// -- removed 2026-07-11.

// settlement: NOT here. It runs in Postgres via pg_cron (pickplay_tick, 30s:
// seed -> finalize -> settle). Keeping a second Node settle loop only doubled
// the DB load and split the source of truth -- removed 2026-07-11.

// TODO(Faz2): stats/incidents every 60s for WATCHED matches only (needs a
//   watched-fixtures signal + a provider.fetchIncidents endpoint).
// TODO(Faz2): check docs/websocket -- if live_websocket works, replace the 30s
//   live poll with a socket and sub-second updates.

console.log('[cron] runner started (fixtures daily 03:00 UTC, lambda 15m [backup]; live + settle run in pg_cron)');
