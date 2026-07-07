-- pickplay.ai — combined migrations (0001..0006)
-- Paste this whole file into the Supabase SQL Editor and Run. Idempotent.

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


-- ============================================================================
-- pickplay.ai — 0003: triggers, RPCs, server-side simulation & scoring
-- ----------------------------------------------------------------------------
-- All result generation and scoring runs here, in Postgres, so the hidden
-- `matches.true_probabilities` never has to leave the server. The client only
-- ever calls: seed_matches(), submit is a plain INSERT (0002), set_username(),
-- reveal_match().
--
-- Scoring rewards *calibration*, not just being right: a correct call on an
-- unlikely outcome moves skill_rating more than one on a heavy favourite. That
-- signal is exactly what must stay server-side, which is why this lives here.
-- ============================================================================

-- --- profile bootstrap on signup -------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    -- provisional handle; user picks a real one via set_username()
    'player_' || substr(replace(new.id::text, '-', ''), 1, 8)
  )
  on conflict (id) do nothing;
  return new;
end;
$fn$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- --- username selection -----------------------------------------------------
create or replace function public.set_username(p_username text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if p_username !~ '^[A-Za-z0-9_]{3,20}$' then
    raise exception 'Username must be 3-20 characters: letters, numbers, underscore';
  end if;

  update public.profiles set username = p_username where id = v_uid;

exception when unique_violation then
  raise exception 'That username is already taken';
end;
$fn$;


-- --- match generation (simulated) ------------------------------------------
-- Tops the pool up to p_target UPCOMING matches. Safe to call on every app
-- load. Replaceable later by a real sports-API ingestion job.
create or replace function public.seed_matches(p_target int default 8)
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_existing int;
  v_needed   int;
  v_teams    text[] := array[
    'Arsenal','Chelsea','Liverpool','Man City','Man United','Tottenham',
    'Newcastle','Aston Villa','Brighton','West Ham','Everton','Leeds',
    'Real Madrid','Barcelona','Atletico','Sevilla','Valencia','Villarreal',
    'Bayern','Dortmund','Leipzig','Leverkusen','Juventus','Inter','Milan',
    'Napoli','Roma','PSG','Marseille','Lyon','Ajax','Porto','Benfica','Celtic'
  ];
  v_n       int := array_length(v_teams, 1);
  v_hi      int;
  v_ai      int;
  v_h       double precision;
  v_d       double precision;
  v_a       double precision;
  v_sum     double precision;
  i         int;
begin
  -- client-callable: cap how large the pool can be topped up to
  p_target := least(greatest(coalesce(p_target, 8), 0), 20);
  -- only matches that are still OPEN for predictions count toward the target
  -- (an 'upcoming' match whose kickoff has passed can no longer be picked)
  select count(*) into v_existing
    from public.matches
   where status = 'upcoming' and starts_at > now();
  v_needed := greatest(0, p_target - v_existing);

  for i in 1 .. v_needed loop
    -- two distinct teams
    v_hi := 1 + floor(random() * v_n)::int;
    loop
      v_ai := 1 + floor(random() * v_n)::int;
      exit when v_ai <> v_hi;
    end loop;

    -- hidden true probabilities, home-leaning then normalised
    v_h := 0.20 + random() * 0.45;   -- 0.20 .. 0.65
    v_d := 0.15 + random() * 0.25;   -- 0.15 .. 0.40
    v_a := 0.15 + random() * 0.45;   -- 0.15 .. 0.60
    v_sum := v_h + v_d + v_a;
    v_h := round((v_h / v_sum)::numeric, 4);
    v_d := round((v_d / v_sum)::numeric, 4);
    v_a := round((1 - v_h - v_d)::numeric, 4);

    insert into public.matches
      (sport, home_team, away_team, starts_at, status, true_probabilities)
    values (
      'football',
      v_teams[v_hi],
      v_teams[v_ai],
      -- generous prediction window (15 min .. 4 h) so calls don't expire before
      -- the user makes them; the reveal is on-demand and not gated on this time
      now() + make_interval(mins => 15 + floor(random() * 225)::int),
      'upcoming',
      jsonb_build_object('home', v_h, 'draw', v_d, 'away', v_a)
    );
  end loop;

  return v_needed;
end;
$fn$;


-- --- scoring (internal) -----------------------------------------------------
-- Scores every not-yet-scored prediction on a finished match and rolls each
-- predictor's profile stats forward. Not granted to clients; only reveal_match
-- (which runs as owner) calls it.
create or replace function public._score_match(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_match      public.matches;
  r            record;
  v_correct    boolean;
  v_p          double precision;
  v_points     int;
  v_new_streak int;
  v_delta      int;
begin
  select * into v_match from public.matches where id = p_match_id;
  if v_match.result is null then
    return;
  end if;

  for r in
    select pr.id, pr.user_id, pr.pick, pf.current_streak
      from public.predictions pr
      join public.profiles pf on pf.id = pr.user_id
     where pr.match_id = p_match_id
       and pr.is_correct is null
     for update of pr
  loop
    v_correct := (r.pick = v_match.result);
    v_p := coalesce((v_match.true_probabilities ->> r.pick)::double precision, 0.34);

    if v_correct then
      v_new_streak := r.current_streak + 1;
      -- base 10, plus a growing streak bonus (capped)
      v_points := 10 + least(v_new_streak, 5) * 2;
      -- calibration reward: more for calling an unlikely outcome
      v_delta := round(32 * (1 - v_p));
    else
      v_new_streak := 0;
      v_points := 0;
      v_delta := -round(32 * v_p);
    end if;

    update public.predictions
       set is_correct = v_correct,
           points_earned = v_points
     where id = r.id;

    update public.profiles
       set total_predictions   = total_predictions + 1,
           correct_predictions = correct_predictions + (case when v_correct then 1 else 0 end),
           current_streak      = v_new_streak,
           best_streak         = greatest(best_streak, v_new_streak),
           skill_rating        = greatest(100, skill_rating + v_delta)
     where id = r.user_id;
  end loop;
end;
$fn$;


-- --- reveal (the heartbeat of the product) ---------------------------------
-- Finalises a match exactly once (globally), weighted by its hidden
-- probabilities, fabricates a plausible scoreline, scores all predictions,
-- then returns THIS caller's outcome for the reveal animation.
create or replace function public.reveal_match(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid   uuid := auth.uid();
  v_match public.matches;
  v_probs jsonb;
  v_r     double precision;
  v_ph    double precision;
  v_pd    double precision;
  v_result text;
  v_hs    int;
  v_as    int;
  v_pred  public.predictions;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  -- lock the row so concurrent reveals can't double-finalise
  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'Match not found';
  end if;

  if v_match.status <> 'finished' then
    v_probs := v_match.true_probabilities;
    v_ph := (v_probs ->> 'home')::double precision;
    v_pd := (v_probs ->> 'draw')::double precision;
    v_r  := random();

    if v_r < v_ph then
      v_result := 'home';
    elsif v_r < v_ph + v_pd then
      v_result := 'draw';
    else
      v_result := 'away';
    end if;

    -- fabricate a scoreline consistent with the result
    if v_result = 'home' then
      v_hs := 1 + floor(random() * 3)::int;
      v_as := floor(random() * v_hs)::int;
    elsif v_result = 'away' then
      v_as := 1 + floor(random() * 3)::int;
      v_hs := floor(random() * v_as)::int;
    else
      v_hs := floor(random() * 4)::int;
      v_as := v_hs;
    end if;

    update public.matches
       set status = 'finished',
           result = v_result,
           home_score = v_hs,
           away_score = v_as
     where id = p_match_id
     returning * into v_match;

    perform public._score_match(p_match_id);
  end if;

  select * into v_pred
    from public.predictions
   where match_id = p_match_id and user_id = v_uid;

  return jsonb_build_object(
    'match_id',      v_match.id,
    'home_team',     v_match.home_team,
    'away_team',     v_match.away_team,
    'result',        v_match.result,
    'home_score',    v_match.home_score,
    'away_score',    v_match.away_score,
    'your_pick',     v_pred.pick,
    'is_correct',    v_pred.is_correct,
    'points_earned', v_pred.points_earned
  );
end;
$fn$;


-- --- function privileges ----------------------------------------------------
-- Lock down execute, then hand only the client-facing RPCs to authenticated.
revoke all on function public.handle_new_user()          from public;
revoke all on function public._score_match(uuid)         from public;
revoke all on function public.set_username(text)         from public, anon;
revoke all on function public.seed_matches(int)          from public, anon;
revoke all on function public.reveal_match(uuid)         from public, anon;

grant execute on function public.set_username(text) to authenticated;
grant execute on function public.seed_matches(int)  to authenticated;
grant execute on function public.reveal_match(uuid) to authenticated;


-- ============================================================================
-- pickplay.ai — 0004: fix the prediction window
-- ----------------------------------------------------------------------------
-- Problem: seed_matches used a 1-15 min kickoff window and counted ALL
-- 'upcoming' rows toward the target. Matches expired within minutes, the Feed
-- still showed them, and picking one failed the insert policy's
-- `starts_at > now()` check ("new row violates row-level security policy").
--
-- Fix: widen the window (15 min .. 4 h), count only still-open matches toward
-- the target, and clean up stale open matches nobody predicted.
-- Idempotent + safe to re-run.
-- ============================================================================

-- 1) one-time cleanup: drop 'upcoming' matches whose kickoff already passed and
--    that nobody has predicted (predicted ones are kept so they stay revealable).
delete from public.matches m
 where m.status = 'upcoming'
   and m.starts_at <= now()
   and not exists (
     select 1 from public.predictions p where p.match_id = m.id
   );

-- 2) corrected generator (same body ships in 0003 for fresh installs).
create or replace function public.seed_matches(p_target int default 8)
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_existing int;
  v_needed   int;
  v_teams    text[] := array[
    'Arsenal','Chelsea','Liverpool','Man City','Man United','Tottenham',
    'Newcastle','Aston Villa','Brighton','West Ham','Everton','Leeds',
    'Real Madrid','Barcelona','Atletico','Sevilla','Valencia','Villarreal',
    'Bayern','Dortmund','Leipzig','Leverkusen','Juventus','Inter','Milan',
    'Napoli','Roma','PSG','Marseille','Lyon','Ajax','Porto','Benfica','Celtic'
  ];
  v_n       int := array_length(v_teams, 1);
  v_hi      int;
  v_ai      int;
  v_h       double precision;
  v_d       double precision;
  v_a       double precision;
  v_sum     double precision;
  i         int;
begin
  p_target := least(greatest(coalesce(p_target, 8), 0), 20);
  select count(*) into v_existing
    from public.matches
   where status = 'upcoming' and starts_at > now();
  v_needed := greatest(0, p_target - v_existing);

  for i in 1 .. v_needed loop
    v_hi := 1 + floor(random() * v_n)::int;
    loop
      v_ai := 1 + floor(random() * v_n)::int;
      exit when v_ai <> v_hi;
    end loop;

    v_h := 0.20 + random() * 0.45;
    v_d := 0.15 + random() * 0.25;
    v_a := 0.15 + random() * 0.45;
    v_sum := v_h + v_d + v_a;
    v_h := round((v_h / v_sum)::numeric, 4);
    v_d := round((v_d / v_sum)::numeric, 4);
    v_a := round((1 - v_h - v_d)::numeric, 4);

    insert into public.matches
      (sport, home_team, away_team, starts_at, status, true_probabilities)
    values (
      'football',
      v_teams[v_hi],
      v_teams[v_ai],
      now() + make_interval(mins => 15 + floor(random() * 225)::int),
      'upcoming',
      jsonb_build_object('home', v_h, 'draw', v_d, 'away', v_a)
    );
  end loop;

  return v_needed;
end;
$fn$;

revoke all on function public.seed_matches(int) from public, anon;
grant execute on function public.seed_matches(int) to authenticated;


-- ============================================================================
-- pickplay.ai — 0005: display odds (informational, derived, non-leaking)
-- ----------------------------------------------------------------------------
-- Adds a CLIENT-VISIBLE `matches.display_odds` {home,draw,away} shown as plain
-- decimal odds (e.g. 1.85). Derived server-side from the hidden
-- true_probabilities with a house margin (~5% overround) + small noise +
-- 2-decimal rounding, so the exact hidden probability can't be recovered — the
-- game stays honest. Odds are informational only: NO money, no stake, no payout.
--
-- Scoring is tied to the odds: a correct call on a longer-priced (less likely)
-- outcome earns more. Streak bonus is preserved. skill_rating still calibrates
-- on the hidden true_probabilities (unchanged).
--
-- Self-contained + idempotent. Supersedes the seed/score/reveal from 0003.
-- ============================================================================

-- 1) visible odds column + client read grant
alter table public.matches
  add column if not exists display_odds jsonb;

grant select (display_odds) on public.matches to authenticated;

-- 2) odds generator: fair odds 1/p, shortened by a margin, jittered, rounded.
create or replace function public._make_display_odds(
  p_h double precision, p_d double precision, p_a double precision
) returns jsonb
language plpgsql
volatile
set search_path = public
as $fn$
declare
  m constant double precision := 1.05;              -- ~5% overround (house edge)
  oh double precision;
  od double precision;
  oa double precision;
begin
  -- (1 + random*0.16 - 0.08) => +/-8% jitter so odds don't reveal exact p
  oh := round((1.0 / (greatest(p_h, 0.02) * m * (1 + random() * 0.16 - 0.08)))::numeric, 2);
  od := round((1.0 / (greatest(p_d, 0.02) * m * (1 + random() * 0.16 - 0.08)))::numeric, 2);
  oa := round((1.0 / (greatest(p_a, 0.02) * m * (1 + random() * 0.16 - 0.08)))::numeric, 2);
  return jsonb_build_object(
    'home', greatest(oh, 1.05),
    'draw', greatest(od, 1.05),
    'away', greatest(oa, 1.05)
  );
end;
$fn$;

-- 3) backfill existing matches that have no odds yet
update public.matches
   set display_odds = public._make_display_odds(
     (true_probabilities ->> 'home')::double precision,
     (true_probabilities ->> 'draw')::double precision,
     (true_probabilities ->> 'away')::double precision
   )
 where display_odds is null;

-- 4) seed generator now also stamps display_odds on new matches
create or replace function public.seed_matches(p_target int default 8)
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_existing int;
  v_needed   int;
  v_teams    text[] := array[
    'Arsenal','Chelsea','Liverpool','Man City','Man United','Tottenham',
    'Newcastle','Aston Villa','Brighton','West Ham','Everton','Leeds',
    'Real Madrid','Barcelona','Atletico','Sevilla','Valencia','Villarreal',
    'Bayern','Dortmund','Leipzig','Leverkusen','Juventus','Inter','Milan',
    'Napoli','Roma','PSG','Marseille','Lyon','Ajax','Porto','Benfica','Celtic'
  ];
  v_n   int := array_length(v_teams, 1);
  v_hi  int;
  v_ai  int;
  v_h   double precision;
  v_d   double precision;
  v_a   double precision;
  v_sum double precision;
  i     int;
begin
  p_target := least(greatest(coalesce(p_target, 8), 0), 20);
  select count(*) into v_existing
    from public.matches
   where status = 'upcoming' and starts_at > now();
  v_needed := greatest(0, p_target - v_existing);

  for i in 1 .. v_needed loop
    v_hi := 1 + floor(random() * v_n)::int;
    loop
      v_ai := 1 + floor(random() * v_n)::int;
      exit when v_ai <> v_hi;
    end loop;

    v_h := 0.20 + random() * 0.45;
    v_d := 0.15 + random() * 0.25;
    v_a := 0.15 + random() * 0.45;
    v_sum := v_h + v_d + v_a;
    v_h := round((v_h / v_sum)::numeric, 4);
    v_d := round((v_d / v_sum)::numeric, 4);
    v_a := round((1 - v_h - v_d)::numeric, 4);

    insert into public.matches
      (sport, home_team, away_team, starts_at, status, true_probabilities, display_odds)
    values (
      'football',
      v_teams[v_hi],
      v_teams[v_ai],
      now() + make_interval(mins => 15 + floor(random() * 225)::int),
      'upcoming',
      jsonb_build_object('home', v_h, 'draw', v_d, 'away', v_a),
      public._make_display_odds(v_h, v_d, v_a)
    );
  end loop;

  return v_needed;
end;
$fn$;

-- 5) scoring: points scale with the odds of the picked outcome
create or replace function public._score_match(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_match      public.matches;
  r            record;
  v_correct    boolean;
  v_p          double precision;
  v_odds       double precision;
  v_points     int;
  v_new_streak int;
  v_delta      int;
begin
  select * into v_match from public.matches where id = p_match_id;
  if v_match.result is null then
    return;
  end if;

  for r in
    select pr.id, pr.user_id, pr.pick, pf.current_streak
      from public.predictions pr
      join public.profiles pf on pf.id = pr.user_id
     where pr.match_id = p_match_id
       and pr.is_correct is null
     for update of pr
  loop
    v_correct := (r.pick = v_match.result);
    v_p    := coalesce((v_match.true_probabilities ->> r.pick)::double precision, 0.34);
    v_odds := coalesce((v_match.display_odds ->> r.pick)::double precision, 2.0);

    if v_correct then
      v_new_streak := r.current_streak + 1;
      -- base points scale with odds (bold + right = bigger), plus streak bonus
      v_points := round(10 * v_odds)::int + least(v_new_streak, 5) * 2;
      v_delta := round(32 * (1 - v_p));           -- calibration, hidden truth
    else
      v_new_streak := 0;
      v_points := 0;
      v_delta := -round(32 * v_p);
    end if;

    update public.predictions
       set is_correct = v_correct,
           points_earned = v_points
     where id = r.id;

    update public.profiles
       set total_predictions   = total_predictions + 1,
           correct_predictions = correct_predictions + (case when v_correct then 1 else 0 end),
           current_streak      = v_new_streak,
           best_streak         = greatest(best_streak, v_new_streak),
           skill_rating        = greatest(100, skill_rating + v_delta)
     where id = r.user_id;
  end loop;
end;
$fn$;

-- 6) reveal now also returns the odds so the verdict can show them
create or replace function public.reveal_match(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_match  public.matches;
  v_probs  jsonb;
  v_r      double precision;
  v_ph     double precision;
  v_pd     double precision;
  v_result text;
  v_hs     int;
  v_as     int;
  v_pred   public.predictions;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'Match not found';
  end if;

  if v_match.status <> 'finished' then
    v_probs := v_match.true_probabilities;
    v_ph := (v_probs ->> 'home')::double precision;
    v_pd := (v_probs ->> 'draw')::double precision;
    v_r  := random();

    if v_r < v_ph then
      v_result := 'home';
    elsif v_r < v_ph + v_pd then
      v_result := 'draw';
    else
      v_result := 'away';
    end if;

    if v_result = 'home' then
      v_hs := 1 + floor(random() * 3)::int;
      v_as := floor(random() * v_hs)::int;
    elsif v_result = 'away' then
      v_as := 1 + floor(random() * 3)::int;
      v_hs := floor(random() * v_as)::int;
    else
      v_hs := floor(random() * 4)::int;
      v_as := v_hs;
    end if;

    update public.matches
       set status = 'finished',
           result = v_result,
           home_score = v_hs,
           away_score = v_as
     where id = p_match_id
     returning * into v_match;

    perform public._score_match(p_match_id);
  end if;

  select * into v_pred
    from public.predictions
   where match_id = p_match_id and user_id = v_uid;

  return jsonb_build_object(
    'match_id',      v_match.id,
    'home_team',     v_match.home_team,
    'away_team',     v_match.away_team,
    'result',        v_match.result,
    'home_score',    v_match.home_score,
    'away_score',    v_match.away_score,
    'odds',          v_match.display_odds,
    'your_pick',     v_pred.pick,
    'is_correct',    v_pred.is_correct,
    'points_earned', v_pred.points_earned
  );
end;
$fn$;

-- keep privileges tight (create-or-replace can reset them)
revoke all on function public._make_display_odds(double precision, double precision, double precision) from public, anon, authenticated;
revoke all on function public._score_match(uuid)         from public;
revoke all on function public.seed_matches(int)          from public, anon;
revoke all on function public.reveal_match(uuid)         from public, anon;
grant execute on function public.seed_matches(int)  to authenticated;
grant execute on function public.reveal_match(uuid) to authenticated;


-- ============================================================================
-- pickplay.ai — 0006: gold + coupons (betting-style simulation, no real money)
-- ----------------------------------------------------------------------------
-- Adds a closed symbolic-GOLD economy on top of the simulated matches:
--   * profiles.gold_balance (starts at 1000) + a daily retention bonus
--   * coupons (a stake across one or more selections, combined odds multiply)
--   * coupon_selections (one pick per match inside a coupon)
--
-- Gold NEVER converts to money/prizes and CANNOT be purchased — fully closed.
--
-- Server-authoritative: odds, combined multiplier, potential win, stake
-- deduction and settlement all run here. The client never sets balances or
-- trusts its own odds. Match result generation is shared via _finalize_match.
-- Self-contained + idempotent.
-- ============================================================================

-- 1) balances -----------------------------------------------------------------
alter table public.profiles
  add column if not exists gold_balance       int not null default 1000,
  add column if not exists last_daily_bonus_at timestamptz;

-- 2) coupons ------------------------------------------------------------------
create table if not exists public.coupons (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  stake         int not null check (stake > 0),
  total_odds    numeric(12, 2) not null,
  potential_win int not null,
  status        text not null default 'pending'
                  check (status in ('pending', 'won', 'lost')),
  created_at    timestamptz not null default now(),
  settled_at    timestamptz
);
create index if not exists idx_coupons_user_status on public.coupons (user_id, status, created_at desc);

create table if not exists public.coupon_selections (
  id         uuid primary key default gen_random_uuid(),
  coupon_id  uuid not null references public.coupons (id) on delete cascade,
  match_id   uuid not null references public.matches (id),
  pick       text not null check (pick in ('home', 'draw', 'away')),
  odds       numeric(8, 2) not null,
  is_correct boolean,
  unique (coupon_id, match_id)   -- one selection per match within a coupon
);
create index if not exists idx_sel_coupon on public.coupon_selections (coupon_id);
create index if not exists idx_sel_match  on public.coupon_selections (match_id);

-- 3) RLS ----------------------------------------------------------------------
alter table public.coupons           enable row level security;
alter table public.coupon_selections enable row level security;

drop policy if exists coupons_select_own on public.coupons;
create policy coupons_select_own on public.coupons
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists sel_select_own on public.coupon_selections;
create policy sel_select_own on public.coupon_selections
  for select to authenticated
  using (exists (
    select 1 from public.coupons c
    where c.id = coupon_selections.coupon_id and c.user_id = auth.uid()
  ));

revoke all on public.coupons           from anon, authenticated;
revoke all on public.coupon_selections from anon, authenticated;
grant select on public.coupons           to authenticated;
grant select on public.coupon_selections to authenticated;
-- no client writes: coupons are created/settled only through the RPCs below.

-- 4) shared match finalizer (extracted so reveal + settle agree) --------------
create or replace function public._finalize_match(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_match  public.matches;
  v_probs  jsonb;
  v_r      double precision;
  v_ph     double precision;
  v_pd     double precision;
  v_result text;
  v_hs     int;
  v_as     int;
begin
  select * into v_match from public.matches where id = p_match_id for update;
  if not found or v_match.status = 'finished' then
    return;
  end if;

  v_probs := v_match.true_probabilities;
  v_ph := (v_probs ->> 'home')::double precision;
  v_pd := (v_probs ->> 'draw')::double precision;
  v_r  := random();
  if v_r < v_ph then
    v_result := 'home';
  elsif v_r < v_ph + v_pd then
    v_result := 'draw';
  else
    v_result := 'away';
  end if;

  if v_result = 'home' then
    v_hs := 1 + floor(random() * 3)::int;
    v_as := floor(random() * v_hs)::int;
  elsif v_result = 'away' then
    v_as := 1 + floor(random() * 3)::int;
    v_hs := floor(random() * v_as)::int;
  else
    v_hs := floor(random() * 4)::int;
    v_as := v_hs;
  end if;

  update public.matches
     set status = 'finished', result = v_result,
         home_score = v_hs, away_score = v_as
   where id = p_match_id;

  perform public._score_match(p_match_id);   -- harmless if no legacy predictions
end;
$fn$;

-- reveal_match now delegates finalization to the shared helper
create or replace function public.reveal_match(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid   uuid := auth.uid();
  v_match public.matches;
  v_pred  public.predictions;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._finalize_match(p_match_id);
  select * into v_match from public.matches where id = p_match_id;
  if not found then raise exception 'Match not found'; end if;
  select * into v_pred from public.predictions where match_id = p_match_id and user_id = v_uid;
  return jsonb_build_object(
    'match_id', v_match.id, 'home_team', v_match.home_team, 'away_team', v_match.away_team,
    'result', v_match.result, 'home_score', v_match.home_score, 'away_score', v_match.away_score,
    'odds', v_match.display_odds, 'your_pick', v_pred.pick,
    'is_correct', v_pred.is_correct, 'points_earned', v_pred.points_earned);
end;
$fn$;

-- 5) place a coupon (server computes odds/total/potential, deducts stake) ------
create or replace function public.place_coupon(p_selections jsonb, p_stake int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid      uuid := auth.uid();
  v_balance  int;
  v_count    int;
  v_total    numeric := 1;
  v_pot      int;
  v_coupon   uuid;
  sel        jsonb;
  v_mid      uuid;
  v_pick     text;
  v_match    public.matches;
  v_seen     uuid[] := '{}';
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if p_stake is null or p_stake <= 0 then raise exception 'Stake must be positive'; end if;

  v_count := jsonb_array_length(coalesce(p_selections, '[]'::jsonb));
  if v_count < 1 then raise exception 'Add at least one selection'; end if;
  if v_count > 10 then raise exception 'A coupon can hold at most 10 selections'; end if;

  select gold_balance into v_balance from public.profiles where id = v_uid for update;
  if v_balance < p_stake then raise exception 'Not enough gold'; end if;

  -- validate + compute combined odds (matches locked so odds are stable)
  for sel in select value from jsonb_array_elements(p_selections) loop
    v_mid  := (sel ->> 'match_id')::uuid;
    v_pick := sel ->> 'pick';
    if v_pick not in ('home', 'draw', 'away') then raise exception 'Invalid pick'; end if;
    if v_mid = any(v_seen) then raise exception 'The same match appears twice'; end if;
    v_seen := array_append(v_seen, v_mid);

    select * into v_match from public.matches where id = v_mid for update;
    if not found then raise exception 'Match not found'; end if;
    if v_match.status <> 'upcoming' or v_match.starts_at <= now() then
      raise exception 'Market closed: % vs %', v_match.home_team, v_match.away_team;
    end if;

    v_total := v_total * (v_match.display_odds ->> v_pick)::numeric;
  end loop;

  v_total := round(v_total, 2);
  v_pot   := round(p_stake * v_total)::int;

  insert into public.coupons (user_id, stake, total_odds, potential_win, status)
    values (v_uid, p_stake, v_total, v_pot, 'pending')
    returning id into v_coupon;

  for sel in select value from jsonb_array_elements(p_selections) loop
    v_mid  := (sel ->> 'match_id')::uuid;
    v_pick := sel ->> 'pick';
    insert into public.coupon_selections (coupon_id, match_id, pick, odds)
      values (v_coupon, v_mid, v_pick,
              (select (display_odds ->> v_pick)::numeric from public.matches where id = v_mid));
  end loop;

  update public.profiles set gold_balance = gold_balance - p_stake where id = v_uid;

  return jsonb_build_object(
    'coupon_id', v_coupon, 'total_odds', v_total,
    'potential_win', v_pot, 'new_balance', v_balance - p_stake);
end;
$fn$;

-- 6) settle a coupon (finalize its matches, evaluate, pay out on a full hit) ---
create or replace function public.settle_coupon(p_coupon_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_coupon public.coupons;
  r        record;
  v_all_ok boolean := true;
  v_sels   jsonb;
  v_bal    int;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select * into v_coupon from public.coupons where id = p_coupon_id and user_id = v_uid for update;
  if not found then raise exception 'Coupon not found'; end if;

  if v_coupon.status = 'pending' then
    -- finalize every match on the coupon
    for r in select match_id from public.coupon_selections where coupon_id = p_coupon_id loop
      perform public._finalize_match(r.match_id);
    end loop;

    -- grade each selection; a single miss loses the coupon
    for r in
      select cs.id, cs.pick, m.result
        from public.coupon_selections cs
        join public.matches m on m.id = cs.match_id
       where cs.coupon_id = p_coupon_id
    loop
      update public.coupon_selections set is_correct = (r.pick = r.result) where id = r.id;
      if r.pick is distinct from r.result then v_all_ok := false; end if;
    end loop;

    if v_all_ok then
      update public.coupons set status = 'won', settled_at = now() where id = p_coupon_id;
      update public.profiles set gold_balance = gold_balance + v_coupon.potential_win where id = v_uid;
    else
      update public.coupons set status = 'lost', settled_at = now() where id = p_coupon_id;
    end if;

    select * into v_coupon from public.coupons where id = p_coupon_id;
  end if;

  select gold_balance into v_bal from public.profiles where id = v_uid;

  select jsonb_agg(jsonb_build_object(
           'match_id', cs.match_id, 'home_team', m.home_team, 'away_team', m.away_team,
           'pick', cs.pick, 'odds', cs.odds, 'result', m.result,
           'home_score', m.home_score, 'away_score', m.away_score, 'is_correct', cs.is_correct)
           order by cs.id)
    into v_sels
    from public.coupon_selections cs
    join public.matches m on m.id = cs.match_id
   where cs.coupon_id = p_coupon_id;

  return jsonb_build_object(
    'coupon_id', v_coupon.id, 'status', v_coupon.status, 'stake', v_coupon.stake,
    'total_odds', v_coupon.total_odds, 'potential_win', v_coupon.potential_win,
    'new_balance', v_bal, 'selections', v_sels);
end;
$fn$;

-- 7) gold top-ups -------------------------------------------------------------
-- daily retention bonus: +500, once per calendar day
create or replace function public.claim_daily_bonus()
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid  uuid := auth.uid();
  v_last timestamptz;
  v_bal  int;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select last_daily_bonus_at, gold_balance into v_last, v_bal
    from public.profiles where id = v_uid for update;
  if v_last is not null and v_last::date >= now()::date then
    raise exception 'Daily bonus already claimed today';
  end if;
  update public.profiles
     set gold_balance = gold_balance + 500, last_daily_bonus_at = now()
   where id = v_uid;
  return jsonb_build_object('new_balance', v_bal + 500, 'awarded', 500);
end;
$fn$;

-- safety net: if you bust out (< 100), refill to 500 so you can keep playing
create or replace function public.topup_gold()
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_bal int;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select gold_balance into v_bal from public.profiles where id = v_uid for update;
  if v_bal >= 100 then raise exception 'Top-up is only available under 100 gold'; end if;
  update public.profiles set gold_balance = 500 where id = v_uid;
  return jsonb_build_object('new_balance', 500);
end;
$fn$;

-- 8) privileges ---------------------------------------------------------------
revoke all on function public._finalize_match(uuid)     from public, anon, authenticated;
revoke all on function public.place_coupon(jsonb, int)  from public, anon;
revoke all on function public.settle_coupon(uuid)       from public, anon;
revoke all on function public.claim_daily_bonus()       from public, anon;
revoke all on function public.topup_gold()              from public, anon;
grant execute on function public.place_coupon(jsonb, int) to authenticated;
grant execute on function public.settle_coupon(uuid)      to authenticated;
grant execute on function public.claim_daily_bonus()      to authenticated;
grant execute on function public.topup_gold()             to authenticated;


