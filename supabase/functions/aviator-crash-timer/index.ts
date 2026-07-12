import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0';

// Ephemeral crash-TIMING helper for Aviator. Postgres cannot fire an action at a
// precise sub-second future instant (pg_cron floor is 1s, no one-off; pg_net has
// no scheduling; pgmq needs a poller; pg_sleep blocks) -- so the crash broadcast
// currently rides the 1s tick and lands 0-1s late (visible overshoot).
//
// This function provides ONLY precise timing:
//   1. pg_net POSTs it the instant a round goes FLYING, with the round's absolute
//      deterministic crash time (crash_at = flying_at + ln(crash_point)/0.35).
//   2. It sleeps until that exact moment (recomputing the remaining delay from its
//      own clock, which is ~server-synced, so invocation latency is absorbed).
//   3. It calls aviator_fire_crash(round_id) -- the ONE idempotent RPC that writes
//      status='crashed' + broadcasts. Then it dies.
//
// ALL crash LOGIC (db write, broadcast, settlement) lives in that RPC, and the 1s
// pg_cron tick calls the SAME RPC as a fallback. So if this function cold-starts
// too slowly (very fast crashes), errors, or never runs, the tick still crashes
// the round -- money, settlement and history are unaffected; only that round's
// visual freeze degrades to the tick timing. Nothing critical depends on this.

const MAX_WAIT_MS = 20_000;   // safety cap (max flight ~13.2s at 100x)

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let roundId: number | string | undefined;
  let crashAt: string | undefined;
  try {
    const body = await req.json();
    roundId = body.round_id;
    crashAt = body.crash_at;            // ISO server timestamp of the deterministic crash
  } catch { return json({ error: 'bad body' }, 400); }
  if (roundId == null || !crashAt) return json({ error: 'round_id and crash_at required' }, 400);

  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return json({ error: 'missing env' }, 500);

  // remaining time until the crash, computed HERE so pg_net + cold-start latency is
  // absorbed (edge clock is ~synced with the DB clock).
  const target = Date.parse(crashAt);
  const delay = Math.max(0, Math.min(MAX_WAIT_MS, target - Date.now()));
  await new Promise((r) => setTimeout(r, delay));

  // fire the crash via the single idempotent RPC (no-op if the tick already did it)
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const { error } = await admin.rpc('aviator_fire_crash', { p_round_id: roundId });
  if (error) return json({ error: `fire failed: ${error.message}`, round_id: roundId }, 500);

  return json({ round_id: roundId, fired_after_ms: delay }, 200);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function json(body: any, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
