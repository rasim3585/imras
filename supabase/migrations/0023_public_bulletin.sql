-- ============================================================================
-- pickplay.ai - 0023: public (logged-out) bulletin access
-- ----------------------------------------------------------------------------
-- GRANTS ONLY - no logic change. Lets logged-out visitors browse the bulletin
-- + live scores before signing up (the "gez -> gor -> oynamak isteyince giris"
-- flow). Exposes to anon exactly the same safe columns already readable by
-- authenticated users; the hidden columns (true_probabilities, display_odds,
-- secret_outcome, duration_secs) are NOT granted, so the future stays secret.
-- Betting, coupons, balances and all social data remain authenticated-only.
-- Pure ASCII. Idempotent.
-- ============================================================================

-- matches: same safe columns exposed to authenticated (0002/0008)
grant select
  (id, sport, home_team, away_team, starts_at, status,
   home_score, away_score, result, created_at)
  on public.matches to anon;
grant select (timeline) on public.matches to anon;

-- markets + options are public bulletin data
grant select on public.markets        to anon;
grant select on public.market_options to anon;

-- RLS: allow the anon role to read (row visibility; column grants still apply)
drop policy if exists matches_select_anon on public.matches;
create policy matches_select_anon on public.matches for select to anon using (true);
drop policy if exists markets_read_anon on public.markets;
create policy markets_read_anon on public.markets for select to anon using (true);
drop policy if exists options_read_anon on public.market_options;
create policy options_read_anon on public.market_options for select to anon using (true);

-- live scores/odds visible on the public bulletin (definer; reveals only what
-- has happened so far, future stays hidden)
grant execute on function public.get_live_state(uuid[]) to anon;
