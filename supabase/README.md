# Supabase setup

Apply the migrations in `migrations/` **in filename order** to your Supabase
project.

## Option A — SQL editor (quickest)

1. Open your project → **SQL Editor**.
2. Paste and run, in this order:
   - `migrations/0001_schema.sql`
   - `migrations/0002_security.sql`
   - `migrations/0003_functions.sql`

Each file is idempotent, so re-running is safe.

## Option B — Supabase CLI

```bash
supabase link --project-ref <your-ref>
supabase db push
```

## Auth providers

- **Email**: enabled by default. For local testing you may want to turn off
  "Confirm email" (Authentication → Providers → Email) so signups log in
  immediately.
- **Google**: Authentication → Providers → Google. Add your OAuth client ID +
  secret and set the redirect URL Supabase shows you.

## What the schema enforces

- A `profiles` row is created automatically on signup (trigger), with a
  provisional `player_xxxxxxxx` username the user then changes via `set_username`.
- Clients can read only their **own** profile and predictions.
- `matches.true_probabilities` is **never** selectable by clients (column-level
  privilege) — it is the simulator's hidden truth.
- Results and scoring run entirely server-side in `reveal_match()`; skill_rating
  rewards correctly calling unlikely outcomes.

## Client RPCs

| RPC | Purpose |
| --- | --- |
| `seed_matches(p_target int)` | Top the upcoming pool up to N (capped at 20). |
| `set_username(p_username text)` | Validate + set the caller's username. |
| `reveal_match(p_match_id uuid)` | Finalise a match, score it, return the caller's outcome. |

Submitting a pick is a plain `INSERT` into `predictions` (RLS-guarded).
