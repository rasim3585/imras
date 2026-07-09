import { makeClient, makeProvider } from './_client';
import { syncFixtures } from './syncFixtures';
import { solveLambdas } from './solveLambdas';
import { syncLiveScores } from './syncLiveScores';
import { settleFixtures } from './settleFixtures';

// Run ONE job once and exit -- for manual triggering (the runner schedules the
// same jobs on timers). Usage: tsx --env-file=.env src/cron/once.ts <job>
const USAGE = 'usage: once.ts <sync|lambda|live|settle>';

async function main(): Promise<void> {
  const job = process.argv[2];
  const client = makeClient();

  switch (job) {
    case 'sync': {
      const n = await syncFixtures(client, makeProvider(), new Date(), new Date(Date.now() + 2 * 24 * 3600 * 1000));
      console.log(`[once:sync] upserted ${n} fixtures`);
      break;
    }
    case 'lambda': {
      const n = await solveLambdas(client, makeProvider());
      console.log(`[once:lambda] solved ${n} lambda(s)`);
      break;
    }
    case 'live': {
      const n = await syncLiveScores(client, makeProvider());
      console.log(`[once:live] updated ${n} live fixture(s)`);
      break;
    }
    case 'settle': {
      const s = await settleFixtures(client);
      console.log('[once:settle]', s);
      break;
    }
    default:
      console.error(job ? `Unknown job "${job}"` : 'No job given');
      console.error(USAGE);
      process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error('[once] failed:', e instanceof Error ? e.message : e); process.exit(1); });
