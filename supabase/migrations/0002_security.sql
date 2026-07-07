-- ============================================================================
-- pickplay.ai — 0002: row-level security + column privileges
-- ----------------------------------------------------------------------------
-- Users see only their own data. The hidden `matches.true_probabilities`
-- column is kept server-side by GRANTing SELECT on every OTHER column but not
-- that one. Stat columns on `profiles` are read-only to clients — only the
-- SECURITY DEFINER scoring functions (0003) may write them.
-- Idempotent: policies are dropped-if-exists then recreated.
-- ============================================================================

alter table public.profiles    enable row level security;
alter table public.matches     enable row level security;
alter table public.predictions enable row level security;

-- --- profiles ---------------------------------------------------------------
-- Phase 1: a user reads only their own profile (leaderboards are Phase 2).
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (auth.uid() = id);

-- Username may be changed by its owner; stat columns are blocked by the
-- column-level grants below, not by this policy.
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (username) on public.profiles to authenticated;
-- (No client INSERT: the on-signup trigger in 0003 creates the row.)

-- --- matches ----------------------------------------------------------------
-- Any signed-in user may read matches, but NOT true_probabilities.
drop policy if exists matches_select_authenticated on public.matches;
create policy matches_select_authenticated on public.matches
  for select to authenticated
  using (true);

revoke all on public.matches from anon, authenticated;
grant select
  (id, sport, home_team, away_team, starts_at, status,
   home_score, away_score, result, created_at)
  on public.matches to authenticated;
-- true_probabilities is deliberately excluded -> unreadable by clients.

-- --- predictions ------------------------------------------------------------
-- Own rows only. A pick can be inserted for an UPCOMING match that has not yet
-- started; is_correct / points_earned are not client-writable (column grants).
drop policy if exists predictions_select_own on public.predictions;
create policy predictions_select_own on public.predictions
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists predictions_insert_own on public.predictions;
create policy predictions_insert_own on public.predictions
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.matches m
      where m.id = predictions.match_id
        and m.status = 'upcoming'
        and m.starts_at > now()
    )
  );

revoke all on public.predictions from anon, authenticated;
grant select on public.predictions to authenticated;
grant insert (user_id, match_id, pick) on public.predictions to authenticated;
-- No UPDATE/DELETE for clients: a call is locked once made, scored server-side.
