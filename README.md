# pickplay.ai

A **prediction / skill game** — not betting, not fantasy, not gambling. You turn
what you know about a subject (sports, to start) into a call, watch the result
unfold minute by minute, and see how sharp your read really is.

There is **no money** anywhere in the product — no wagering, no payouts, nothing
convertible to cash. The thrill comes from three things:

1. **Knowing** — the confidence of understanding a subject well.
2. **Accuracy** — seeing your expertise measured honestly.
3. **The reveal** — the tension of waiting for the result to open up.

The vocabulary is deliberately skill-first: _pick, prediction, your call,
accuracy, streak, skill rating_ — never _bet / odds / stake / cash out_. The UI
avoids any betting aesthetic.

## Stack

- **React + Vite + TypeScript**
- **Supabase** (Postgres + Auth) — email + Google sign-in
- Hand-written CSS design system (dark analytic base, single accent)
- **Match data:** Phase 1 uses simulated matches. Result generation and scoring
  run **server-side** in Postgres (`reveal_match` RPC) so the true outcome
  probabilities stay hidden from the client. Screens read match data through a
  `MatchProvider` interface, so the simulator can later be swapped for a real
  sports API without touching the UI.

## Getting started

```bash
npm install
cp .env.example .env    # then fill in your Supabase URL + anon key
npm run dev
```

Apply the SQL in `supabase/migrations/` to your Supabase project (SQL editor or
CLI) before signing in.

## Phase 1 scope

Core loop only: **predict → watch → hit/miss → profile**. Feed, Reveal,
Profile, Auth. Everything else (real sports API, AI coaching, leagues,
leaderboards, seasons, non-sports categories, monetization) is explicitly out of
Phase 1.

## Scripts

- `npm run dev` — dev server
- `npm run build` — typecheck + production build
- `npm run lint` — oxlint
