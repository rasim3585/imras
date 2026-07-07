-- pickplay.ai — combined migrations (0001 + 0002 + 0003 + 0004)
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
