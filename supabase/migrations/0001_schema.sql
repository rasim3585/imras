-- ============================================================================
-- pickplay.ai — 0001: core schema
-- ----------------------------------------------------------------------------
-- Three tables: profiles, matches, predictions.
-- Additive + idempotent. Run 0001 -> 0002 -> 0003 in order.
--
-- Note: `matches.true_probabilities` holds the HIDDEN outcome weights the
-- simulator uses to open a result. It is never exposed to the client; column
-- privileges in 0002 keep it server-side only. Scoring (0003) reads it.
-- ============================================================================

-- profiles -------------------------------------------------------------------
create table if not exists public.profiles (
  id                  uuid primary key references auth.users (id) on delete cascade,
  username            text not null unique,
  created_at          timestamptz not null default now(),
  total_predictions   int not null default 0,
  correct_predictions int not null default 0,
  current_streak      int not null default 0,
  best_streak         int not null default 0,
  skill_rating        int not null default 1000
);

comment on table public.profiles is 'Per-user prediction record; stats are written only by SECURITY DEFINER scoring.';

-- matches --------------------------------------------------------------------
create table if not exists public.matches (
  id                 uuid primary key default gen_random_uuid(),
  sport              text not null default 'football',
  home_team          text not null,
  away_team          text not null,
  starts_at          timestamptz not null,
  status             text not null default 'upcoming'
                       check (status in ('upcoming', 'live', 'finished')),
  home_score         int,
  away_score         int,
  result             text check (result in ('home', 'draw', 'away')),
  true_probabilities jsonb not null,   -- {home, draw, away}; HIDDEN from clients
  created_at         timestamptz not null default now()
);

create index if not exists idx_matches_status_starts
  on public.matches (status, starts_at);

-- predictions ----------------------------------------------------------------
create table if not exists public.predictions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  match_id      uuid not null references public.matches (id) on delete cascade,
  pick          text not null check (pick in ('home', 'draw', 'away')),
  created_at    timestamptz not null default now(),
  is_correct    boolean,   -- filled when the match is revealed / scored
  points_earned int,       -- filled when the match is revealed / scored
  unique (user_id, match_id)   -- one call per match
);

create index if not exists idx_predictions_user  on public.predictions (user_id);
create index if not exists idx_predictions_match on public.predictions (match_id);
