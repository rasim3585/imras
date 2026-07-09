import { createClient } from '@supabase/supabase-js';
import { BSDProvider } from '../providers/bsd';
import { syncFixtures } from './syncFixtures';
import { solveLambdas } from './solveLambdas';
import { syncLiveScores } from './syncLiveScores';
import { settleFixtures } from './settleFixtures';

// Node entry (Railway). The ONLY file that knows about scheduling + env. A long-
// running process is deliberate: it can later hold the BSD live_websocket
// connection (see docs/websocket) and drop polling entirely.
//
// Required env (from Railway, never committed):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BSD_API_KEY, [BSD_BASE_URL]

function env(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env ${key}`);
  return v;
}

const client = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const provider = new BSDProvider({ apiKey: env('BSD_API_KEY'), baseUrl: process.env.BSD_BASE_URL });

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
setInterval(() => safe('lambda', () => solveLambdas(client, provider)), 15 * 60 * 1000);

// live score: every 30s (no-op when nothing is live)
setInterval(() => safe('live', () => syncLiveScores(client, provider)), 30 * 1000);

// settlement: every 60s (grade finished fixtures via settle_real_fixture)
setInterval(() => safe('settle', () => settleFixtures(client)), 60 * 1000);

// TODO(Faz2): stats/incidents every 60s for WATCHED matches only (needs a
//   watched-fixtures signal + a provider.fetchIncidents endpoint).
// TODO(Faz2): check docs/websocket -- if live_websocket works, replace the 30s
//   live poll with a socket and sub-second updates.

console.log('[cron] runner started (fixtures daily 03:00 UTC, lambda 15m, live 30s, settle 60s)');
