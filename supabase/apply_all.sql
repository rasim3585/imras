-- pickplay.ai — combined migrations (0001..0013)
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


-- ============================================================================
-- pickplay.ai — 0007: generic markets + option-based coupons
-- ----------------------------------------------------------------------------
-- Supersedes 0006's coupon design. Makes every match hold MANY markets (bet
-- types), each with MANY options — so adding a new bet type later is DATA, not
-- schema. Phase 1 populates only 'match_result' (1/X/2); the structure is ready
-- for first_half, both_teams_score, over_under_2_5, corners, cards, ...
--
--   matches ──1:N── markets ──1:N── market_options
--   coupons ──1:N── coupon_selections ──> market_options
--
-- A coupon_selection wins iff its option.is_winner. A coupon wins iff ALL its
-- selections win. Settlement is generic: _finalize_match resolves each market
-- (only match_result has a resolver in Phase 1; new types add one small branch).
--
-- Self-contained from 0001-0005 (does not require 0006). Idempotent-ish:
-- coupon tables are dropped+recreated (test data only). Pure ASCII.
-- ============================================================================

-- 0) gold columns (same as 0006; safe if already present) --------------------
alter table public.profiles
  add column if not exists gold_balance        int not null default 1000,
  add column if not exists last_daily_bonus_at timestamptz;

-- 1) markets + options --------------------------------------------------------
create table if not exists public.markets (
  id          uuid primary key default gen_random_uuid(),
  match_id    uuid not null references public.matches (id) on delete cascade,
  market_type text not null,             -- machine key: 'match_result', ...
  name        text not null,             -- display: 'Match Result'
  status      text not null default 'open' check (status in ('open', 'closed', 'settled')),
  sort_order  int not null default 0,
  unique (match_id, market_type)
);
create index if not exists idx_markets_match on public.markets (match_id);

create table if not exists public.market_options (
  id          uuid primary key default gen_random_uuid(),
  market_id   uuid not null references public.markets (id) on delete cascade,
  label       text not null,             -- '1', 'X', '2', 'Over 2.5', 'Yes'
  outcome_key text not null,             -- resolver key: 'home','draw','away', ...
  odds        numeric(8, 2) not null,
  is_winner   boolean,                   -- null until the market settles
  sort_order  int not null default 0
);
create index if not exists idx_options_market on public.market_options (market_id);

-- 2) coupons + option-based selections (fresh, deterministic shape) -----------
drop table if exists public.coupon_selections cascade;
drop table if exists public.coupons cascade;

create table public.coupons (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  stake         int not null check (stake > 0),
  total_odds    numeric(12, 2) not null,
  potential_win int not null,
  status        text not null default 'pending' check (status in ('pending', 'won', 'lost')),
  created_at    timestamptz not null default now(),
  settled_at    timestamptz
);
create index idx_coupons_user on public.coupons (user_id, created_at desc);

create table public.coupon_selections (
  id               uuid primary key default gen_random_uuid(),
  coupon_id        uuid not null references public.coupons (id) on delete cascade,
  market_option_id uuid not null references public.market_options (id),
  odds             numeric(8, 2) not null,
  status           text not null default 'pending' check (status in ('pending', 'won', 'lost')),
  unique (coupon_id, market_option_id)
);
create index idx_sel_coupon on public.coupon_selections (coupon_id);
create index idx_sel_option on public.coupon_selections (market_option_id);

-- 3) RLS + grants -------------------------------------------------------------
alter table public.markets           enable row level security;
alter table public.market_options    enable row level security;
alter table public.coupons           enable row level security;
alter table public.coupon_selections enable row level security;

drop policy if exists markets_read on public.markets;
create policy markets_read on public.markets for select to authenticated using (true);
drop policy if exists options_read on public.market_options;
create policy options_read on public.market_options for select to authenticated using (true);

drop policy if exists coupons_select_own on public.coupons;
create policy coupons_select_own on public.coupons
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists sel_select_own on public.coupon_selections;
create policy sel_select_own on public.coupon_selections
  for select to authenticated
  using (exists (select 1 from public.coupons c
                 where c.id = coupon_selections.coupon_id and c.user_id = auth.uid()));

revoke all on public.markets, public.market_options,
              public.coupons, public.coupon_selections from anon, authenticated;
grant select on public.markets           to authenticated;
grant select on public.market_options    to authenticated;
grant select on public.coupons           to authenticated;
grant select on public.coupon_selections to authenticated;

-- 4) market generation (Phase 1: match_result) -------------------------------
-- Creates the markets/options for a match if missing. Reuses the hidden-prob
-- derived odds. Adding a new bet type = add another block here + a resolver.
create or replace function public._ensure_markets(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_match  public.matches;
  v_odds   jsonb;
  v_market uuid;
begin
  select * into v_match from public.matches where id = p_match_id;
  if not found then return; end if;

  if not exists (select 1 from public.markets
                  where match_id = p_match_id and market_type = 'match_result') then
    v_odds := coalesce(
      v_match.display_odds,
      public._make_display_odds(
        (v_match.true_probabilities ->> 'home')::double precision,
        (v_match.true_probabilities ->> 'draw')::double precision,
        (v_match.true_probabilities ->> 'away')::double precision));

    insert into public.markets (match_id, market_type, name, status, sort_order)
      values (p_match_id, 'match_result', 'Match Result', 'open', 0)
      returning id into v_market;

    insert into public.market_options (market_id, label, outcome_key, odds, sort_order) values
      (v_market, '1', 'home', (v_odds ->> 'home')::numeric, 0),
      (v_market, 'X', 'draw', (v_odds ->> 'draw')::numeric, 1),
      (v_market, '2', 'away', (v_odds ->> 'away')::numeric, 2);
  end if;
end;
$fn$;

-- backfill markets for every existing match
select public._ensure_markets(id) from public.matches;

-- 5) seed_matches now also stamps markets on each new match ------------------
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
  v_id  uuid;
  i     int;
begin
  p_target := least(greatest(coalesce(p_target, 8), 0), 20);
  select count(*) into v_existing
    from public.matches where status = 'upcoming' and starts_at > now();
  v_needed := greatest(0, p_target - v_existing);

  for i in 1 .. v_needed loop
    v_hi := 1 + floor(random() * v_n)::int;
    loop v_ai := 1 + floor(random() * v_n)::int; exit when v_ai <> v_hi; end loop;

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
      'football', v_teams[v_hi], v_teams[v_ai],
      now() + make_interval(mins => 15 + floor(random() * 225)::int),
      'upcoming',
      jsonb_build_object('home', v_h, 'draw', v_d, 'away', v_a),
      public._make_display_odds(v_h, v_d, v_a))
    returning id into v_id;

    perform public._ensure_markets(v_id);
  end loop;

  return v_needed;
end;
$fn$;

-- 6) generic market resolver (called when a match finalizes) ------------------
create or replace function public._settle_markets(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_match public.matches;
  mk      record;
begin
  select * into v_match from public.matches where id = p_match_id;
  if v_match.result is null then return; end if;

  for mk in select * from public.markets where match_id = p_match_id and status <> 'settled' loop
    if mk.market_type = 'match_result' then
      update public.market_options
         set is_winner = (outcome_key = v_match.result)
       where market_id = mk.id;
      update public.markets set status = 'settled' where id = mk.id;
    -- FUTURE bet types add a branch here, e.g.:
    --   elsif mk.market_type = 'over_under_2_5' then
    --     update market_options set is_winner =
    --       (outcome_key = case when v_match.home_score + v_match.away_score > 2 then 'over' else 'under' end)
    --     where market_id = mk.id;
    --     update markets set status='settled' where id = mk.id;
    end if;
  end loop;
end;
$fn$;

-- 7) shared match finalizer (result + scores + market settlement) -------------
create or replace function public._finalize_match(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_match  public.matches;
  v_r      double precision;
  v_ph     double precision;
  v_pd     double precision;
  v_result text;
  v_hs     int;
  v_as     int;
begin
  select * into v_match from public.matches where id = p_match_id for update;
  if not found or v_match.status = 'finished' then return; end if;

  v_ph := (v_match.true_probabilities ->> 'home')::double precision;
  v_pd := (v_match.true_probabilities ->> 'draw')::double precision;
  v_r  := random();
  if v_r < v_ph then v_result := 'home';
  elsif v_r < v_ph + v_pd then v_result := 'draw';
  else v_result := 'away'; end if;

  if v_result = 'home' then
    v_hs := 1 + floor(random() * 3)::int; v_as := floor(random() * v_hs)::int;
  elsif v_result = 'away' then
    v_as := 1 + floor(random() * 3)::int; v_hs := floor(random() * v_as)::int;
  else
    v_hs := floor(random() * 4)::int; v_as := v_hs;
  end if;

  update public.matches
     set status = 'finished', result = v_result, home_score = v_hs, away_score = v_as
   where id = p_match_id;

  perform public._score_match(p_match_id);    -- legacy predictions, harmless
  perform public._settle_markets(p_match_id); -- generic option grading
end;
$fn$;

-- 8) place a coupon (option-based, server-priced) ----------------------------
drop function if exists public.place_coupon(jsonb, int);
create or replace function public.place_coupon(p_option_ids uuid[], p_stake int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid     uuid := auth.uid();
  v_balance int;
  v_count   int;
  v_total   numeric := 1;
  v_pot     int;
  v_coupon  uuid;
  v_oid     uuid;
  rec       record;
  v_seen    uuid[] := '{}';
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if p_stake is null or p_stake <= 0 then raise exception 'Stake must be positive'; end if;

  v_count := coalesce(array_length(p_option_ids, 1), 0);
  if v_count < 1 then raise exception 'Add at least one selection'; end if;
  if v_count > 10 then raise exception 'A coupon can hold at most 10 selections'; end if;

  select gold_balance into v_balance from public.profiles where id = v_uid for update;
  if v_balance < p_stake then raise exception 'Not enough gold'; end if;

  foreach v_oid in array p_option_ids loop
    select mo.odds as odds, mk.match_id as match_id, mk.status as mkt_status,
           m.status as match_status, m.starts_at as starts_at,
           m.home_team as home_team, m.away_team as away_team
      into rec
      from public.market_options mo
      join public.markets mk on mk.id = mo.market_id
      join public.matches m  on m.id  = mk.match_id
     where mo.id = v_oid
     for update of mo;
    if not found then raise exception 'Selection not found'; end if;
    if rec.mkt_status <> 'open' or rec.match_status <> 'upcoming' or rec.starts_at <= now() then
      raise exception 'Market closed: % vs %', rec.home_team, rec.away_team;
    end if;
    if rec.match_id = any(v_seen) then
      raise exception 'Only one pick per match is allowed on a coupon';
    end if;
    v_seen  := array_append(v_seen, rec.match_id);
    v_total := v_total * rec.odds;
  end loop;

  v_total := round(v_total, 2);
  v_pot   := round(p_stake * v_total)::int;

  insert into public.coupons (user_id, stake, total_odds, potential_win, status)
    values (v_uid, p_stake, v_total, v_pot, 'pending') returning id into v_coupon;

  foreach v_oid in array p_option_ids loop
    insert into public.coupon_selections (coupon_id, market_option_id, odds)
      values (v_coupon, v_oid, (select odds from public.market_options where id = v_oid));
  end loop;

  update public.profiles set gold_balance = gold_balance - p_stake where id = v_uid;

  return jsonb_build_object('coupon_id', v_coupon, 'total_odds', v_total,
    'potential_win', v_pot, 'new_balance', v_balance - p_stake);
end;
$fn$;

-- 9) settle a coupon (finalize its matches, grade legs, pay full hits) --------
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
    for r in
      select distinct mk.match_id
        from public.coupon_selections cs
        join public.market_options mo on mo.id = cs.market_option_id
        join public.markets mk on mk.id = mo.market_id
       where cs.coupon_id = p_coupon_id
    loop
      perform public._finalize_match(r.match_id);
    end loop;

    for r in
      select cs.id, mo.is_winner
        from public.coupon_selections cs
        join public.market_options mo on mo.id = cs.market_option_id
       where cs.coupon_id = p_coupon_id
    loop
      update public.coupon_selections
         set status = case when r.is_winner is true then 'won' else 'lost' end
       where id = r.id;
      if r.is_winner is not true then v_all_ok := false; end if;
    end loop;

    update public.coupons
       set status = case when v_all_ok then 'won' else 'lost' end, settled_at = now()
     where id = p_coupon_id;
    if v_all_ok then
      update public.profiles set gold_balance = gold_balance + v_coupon.potential_win where id = v_uid;
    end if;

    select * into v_coupon from public.coupons where id = p_coupon_id;
  end if;

  select gold_balance into v_bal from public.profiles where id = v_uid;

  select jsonb_agg(jsonb_build_object(
           'selection_id', cs.id, 'match_id', mk.match_id,
           'home_team', m.home_team, 'away_team', m.away_team,
           'market_name', mk.name, 'market_type', mk.market_type,
           'option_label', mo.label, 'outcome_key', mo.outcome_key,
           'odds', cs.odds, 'status', cs.status, 'result', m.result,
           'home_score', m.home_score, 'away_score', m.away_score)
           order by cs.id)
    into v_sels
    from public.coupon_selections cs
    join public.market_options mo on mo.id = cs.market_option_id
    join public.markets mk on mk.id = mo.market_id
    join public.matches m  on m.id  = mk.match_id
   where cs.coupon_id = p_coupon_id;

  return jsonb_build_object(
    'coupon_id', v_coupon.id, 'status', v_coupon.status, 'stake', v_coupon.stake,
    'total_odds', v_coupon.total_odds, 'potential_win', v_coupon.potential_win,
    'new_balance', v_bal, 'selections', v_sels);
end;
$fn$;

-- 10) gold top-ups (unchanged from 0006; redefined so 0007 stands alone) ------
create or replace function public.claim_daily_bonus()
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_uid uuid := auth.uid(); v_last timestamptz; v_bal int;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select last_daily_bonus_at, gold_balance into v_last, v_bal
    from public.profiles where id = v_uid for update;
  if v_last is not null and v_last::date >= now()::date then
    raise exception 'Daily bonus already claimed today';
  end if;
  update public.profiles set gold_balance = gold_balance + 500, last_daily_bonus_at = now()
   where id = v_uid;
  return jsonb_build_object('new_balance', v_bal + 500, 'awarded', 500);
end; $fn$;

create or replace function public.topup_gold()
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_uid uuid := auth.uid(); v_bal int;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select gold_balance into v_bal from public.profiles where id = v_uid for update;
  if v_bal >= 100 then raise exception 'Top-up is only available under 100 gold'; end if;
  update public.profiles set gold_balance = 500 where id = v_uid;
  return jsonb_build_object('new_balance', 500);
end; $fn$;

-- 11) privileges --------------------------------------------------------------
revoke all on function public._ensure_markets(uuid)         from public, anon, authenticated;
revoke all on function public._settle_markets(uuid)         from public, anon, authenticated;
revoke all on function public._finalize_match(uuid)         from public, anon, authenticated;
revoke all on function public.place_coupon(uuid[], int)     from public, anon;
revoke all on function public.settle_coupon(uuid)           from public, anon;
revoke all on function public.claim_daily_bonus()           from public, anon;
revoke all on function public.topup_gold()                  from public, anon;
grant execute on function public.place_coupon(uuid[], int)  to authenticated;
grant execute on function public.settle_coupon(uuid)        to authenticated;
grant execute on function public.claim_daily_bonus()        to authenticated;
grant execute on function public.topup_gold()               to authenticated;
grant execute on function public.seed_matches(int)          to authenticated;


-- ============================================================================
-- pickplay.ai — 0008: match timeline (for virtual live playback)
-- ----------------------------------------------------------------------------
-- The result stays server-authoritative and deterministic (unchanged). This
-- adds, alongside the final score, a TIMELINE of goal events consistent with
-- that score, so the client can replay a match "live" over time instead of
-- revealing it instantly. Presentation only — no money/settlement change.
--
-- timeline shape: [{ "minute": 23, "type": "goal", "team": "home" }, ...]
-- (sorted by minute; exactly home_score home goals + away_score away goals).
-- Half-time / full-time markers are synthesized client-side.
--
-- Self-contained + idempotent.
-- ============================================================================

alter table public.matches add column if not exists timeline jsonb;
grant select (timeline) on public.matches to authenticated;

-- Build a score-consistent, minute-sorted goal timeline.
create or replace function public._make_timeline(p_h int, p_a int)
returns jsonb
language plpgsql
volatile
set search_path = public
as $fn$
declare
  v_tot   int := coalesce(p_h, 0) + coalesce(p_a, 0);
  v_mins  int[] := '{}';
  v_teams text[] := '{}';
  v_ev    jsonb[] := '{}';
  m       int;
  i       int;
begin
  if v_tot = 0 then
    return '[]'::jsonb;
  end if;

  -- team-per-goal list (home_score homes + away_score aways), shuffled so the
  -- scoring order is unpredictable
  for i in 1 .. coalesce(p_h, 0) loop v_teams := array_append(v_teams, 'home'); end loop;
  for i in 1 .. coalesce(p_a, 0) loop v_teams := array_append(v_teams, 'away'); end loop;
  select array_agg(t order by random()) into v_teams from unnest(v_teams) t;

  -- pick v_tot distinct minutes in 1..90, then sort ascending
  while coalesce(array_length(v_mins, 1), 0) < v_tot loop
    m := 1 + floor(random() * 90)::int;
    if not (m = any(v_mins)) then v_mins := array_append(v_mins, m); end if;
  end loop;
  select array_agg(x order by x) into v_mins from unnest(v_mins) x;

  for i in 1 .. v_tot loop
    v_ev := array_append(v_ev, jsonb_build_object(
      'minute', v_mins[i], 'type', 'goal', 'team', v_teams[i]));
  end loop;

  return to_jsonb(v_ev);
end;
$fn$;

-- _finalize_match: same result/score logic, now also stamps the timeline.
create or replace function public._finalize_match(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_match  public.matches;
  v_r      double precision;
  v_ph     double precision;
  v_pd     double precision;
  v_result text;
  v_hs     int;
  v_as     int;
begin
  select * into v_match from public.matches where id = p_match_id for update;
  if not found or v_match.status = 'finished' then return; end if;

  v_ph := (v_match.true_probabilities ->> 'home')::double precision;
  v_pd := (v_match.true_probabilities ->> 'draw')::double precision;
  v_r  := random();
  if v_r < v_ph then v_result := 'home';
  elsif v_r < v_ph + v_pd then v_result := 'draw';
  else v_result := 'away'; end if;

  if v_result = 'home' then
    v_hs := 1 + floor(random() * 3)::int; v_as := floor(random() * v_hs)::int;
  elsif v_result = 'away' then
    v_as := 1 + floor(random() * 3)::int; v_hs := floor(random() * v_as)::int;
  else
    v_hs := floor(random() * 4)::int; v_as := v_hs;
  end if;

  update public.matches
     set status = 'finished', result = v_result, home_score = v_hs, away_score = v_as,
         timeline = public._make_timeline(v_hs, v_as)
   where id = p_match_id;

  perform public._score_match(p_match_id);
  perform public._settle_markets(p_match_id);
end;
$fn$;

-- settle_coupon: include each leg's match timeline in the returned breakdown.
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
    for r in
      select distinct mk.match_id
        from public.coupon_selections cs
        join public.market_options mo on mo.id = cs.market_option_id
        join public.markets mk on mk.id = mo.market_id
       where cs.coupon_id = p_coupon_id
    loop
      perform public._finalize_match(r.match_id);
    end loop;

    for r in
      select cs.id, mo.is_winner
        from public.coupon_selections cs
        join public.market_options mo on mo.id = cs.market_option_id
       where cs.coupon_id = p_coupon_id
    loop
      update public.coupon_selections
         set status = case when r.is_winner is true then 'won' else 'lost' end
       where id = r.id;
      if r.is_winner is not true then v_all_ok := false; end if;
    end loop;

    update public.coupons
       set status = case when v_all_ok then 'won' else 'lost' end, settled_at = now()
     where id = p_coupon_id;
    if v_all_ok then
      update public.profiles set gold_balance = gold_balance + v_coupon.potential_win where id = v_uid;
    end if;

    select * into v_coupon from public.coupons where id = p_coupon_id;
  end if;

  select gold_balance into v_bal from public.profiles where id = v_uid;

  select jsonb_agg(jsonb_build_object(
           'selection_id', cs.id, 'match_id', mk.match_id,
           'home_team', m.home_team, 'away_team', m.away_team,
           'market_name', mk.name, 'market_type', mk.market_type,
           'option_label', mo.label, 'outcome_key', mo.outcome_key,
           'odds', cs.odds, 'status', cs.status, 'result', m.result,
           'home_score', m.home_score, 'away_score', m.away_score,
           'timeline', coalesce(m.timeline, '[]'::jsonb))
           order by cs.id)
    into v_sels
    from public.coupon_selections cs
    join public.market_options mo on mo.id = cs.market_option_id
    join public.markets mk on mk.id = mo.market_id
    join public.matches m  on m.id  = mk.match_id
   where cs.coupon_id = p_coupon_id;

  return jsonb_build_object(
    'coupon_id', v_coupon.id, 'status', v_coupon.status, 'stake', v_coupon.stake,
    'total_odds', v_coupon.total_odds, 'potential_win', v_coupon.potential_win,
    'new_balance', v_bal, 'selections', v_sels);
end;
$fn$;

-- backfill timelines for already-finished matches
update public.matches
   set timeline = public._make_timeline(home_score, away_score)
 where status = 'finished' and timeline is null;

revoke all on function public._make_timeline(int, int) from public, anon, authenticated;


-- ============================================================================
-- pickplay.ai — 0009: match lifecycle (upcoming -> live -> finished)
-- ----------------------------------------------------------------------------
-- Foundation for virtual LIVE matches. The full result + goal timeline is
-- decided deterministically WHEN THE MATCH IS CREATED and stored HIDDEN
-- (secret_outcome, not client-readable — same protection as true_probabilities).
--
-- The server reveals it over wall-clock time: get_live_state() returns, for
-- each match, its phase / current minute / the goals SO FAR — never the future.
-- This keeps live betting fair (a user can't peek at the outcome) while the
-- result stays server-authoritative and deterministic.
--
-- Money/settlement logic is unchanged; _finalize_match now APPLIES the stored
-- outcome (so what you watch live matches what settles). Self-contained + idem.
-- ============================================================================

-- hidden pre-decided outcome + virtual match length (seconds of wall-clock)
alter table public.matches
  add column if not exists secret_outcome jsonb,
  add column if not exists duration_secs  int not null default 100;

-- duration is not secret (client uses it to tick smoothly); secret_outcome is.
grant select (duration_secs) on public.matches to authenticated;

-- Decide a full outcome (result + scores + goal timeline) from hidden probs.
create or replace function public._make_outcome(p_probs jsonb)
returns jsonb
language plpgsql
volatile
set search_path = public
as $fn$
declare
  v_r      double precision := random();
  v_ph     double precision := (p_probs ->> 'home')::double precision;
  v_pd     double precision := (p_probs ->> 'draw')::double precision;
  v_result text;
  v_hs     int;
  v_as     int;
begin
  if v_r < v_ph then v_result := 'home';
  elsif v_r < v_ph + v_pd then v_result := 'draw';
  else v_result := 'away'; end if;

  if v_result = 'home' then
    v_hs := 1 + floor(random() * 3)::int; v_as := floor(random() * v_hs)::int;
  elsif v_result = 'away' then
    v_as := 1 + floor(random() * 3)::int; v_hs := floor(random() * v_as)::int;
  else
    v_hs := floor(random() * 4)::int; v_as := v_hs;
  end if;

  return jsonb_build_object(
    'result', v_result, 'home_score', v_hs, 'away_score', v_as,
    'events', public._make_timeline(v_hs, v_as));
end;
$fn$;

-- Seed: near-future kickoffs (so matches go live soon), each with a hidden
-- outcome baked in at creation. Keeps generating markets as before.
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
  v_n     int := array_length(v_teams, 1);
  v_hi    int;
  v_ai    int;
  v_h     double precision;
  v_d     double precision;
  v_a     double precision;
  v_sum   double precision;
  v_probs jsonb;
  v_id    uuid;
  i       int;
begin
  p_target := least(greatest(coalesce(p_target, 8), 0), 20);
  select count(*) into v_existing
    from public.matches where status = 'upcoming' and starts_at > now();
  v_needed := greatest(0, p_target - v_existing);

  for i in 1 .. v_needed loop
    v_hi := 1 + floor(random() * v_n)::int;
    loop v_ai := 1 + floor(random() * v_n)::int; exit when v_ai <> v_hi; end loop;

    v_h := 0.20 + random() * 0.45;
    v_d := 0.15 + random() * 0.25;
    v_a := 0.15 + random() * 0.45;
    v_sum := v_h + v_d + v_a;
    v_h := round((v_h / v_sum)::numeric, 4);
    v_d := round((v_d / v_sum)::numeric, 4);
    v_a := round((1 - v_h - v_d)::numeric, 4);
    v_probs := jsonb_build_object('home', v_h, 'draw', v_d, 'away', v_a);

    insert into public.matches
      (sport, home_team, away_team, starts_at, status, true_probabilities,
       display_odds, secret_outcome, duration_secs)
    values (
      'football', v_teams[v_hi], v_teams[v_ai],
      -- kicks off in ~45s .. 6min so the bulletin always has "about to start"
      now() + make_interval(secs => 45 + floor(random() * 315)::int),
      'upcoming', v_probs,
      public._make_display_odds(v_h, v_d, v_a),
      public._make_outcome(v_probs),
      100)
    returning id into v_id;

    perform public._ensure_markets(v_id);
  end loop;

  return v_needed;
end;
$fn$;

-- _finalize_match: apply the PRE-DECIDED outcome (falls back to a fresh roll
-- only for legacy rows without one). Keeps scoring + market settlement.
create or replace function public._finalize_match(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_match public.matches;
  v_out   jsonb;
begin
  select * into v_match from public.matches where id = p_match_id for update;
  if not found or v_match.status = 'finished' then return; end if;

  v_out := coalesce(v_match.secret_outcome, public._make_outcome(v_match.true_probabilities));

  update public.matches
     set status = 'finished',
         result = v_out ->> 'result',
         home_score = (v_out ->> 'home_score')::int,
         away_score = (v_out ->> 'away_score')::int,
         timeline = v_out -> 'events'
   where id = p_match_id;

  perform public._score_match(p_match_id);
  perform public._settle_markets(p_match_id);
end;
$fn$;

-- Reveal the match state as of NOW, hiding anything in the future.
create or replace function public.get_live_state(p_match_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_now     timestamptz := now();
  v_out     jsonb := '[]'::jsonb;
  m         record;
  v_elapsed double precision;
  v_dur     int;
  v_minute  int;
  v_phase   text;
  v_events  jsonb;
  v_hs      int;
  v_as      int;
begin
  for m in select * from public.matches where id = any(p_match_ids) loop
    v_dur := coalesce(m.duration_secs, 100);
    v_elapsed := extract(epoch from (v_now - m.starts_at));

    if v_elapsed < 0 then
      v_phase := 'upcoming'; v_minute := 0;
    elsif v_elapsed >= v_dur then
      v_phase := 'finished'; v_minute := 90;
    else
      v_phase := 'live';
      v_minute := least(90, greatest(0, floor(v_elapsed / v_dur * 90)::int));
    end if;

    -- only goals up to the current minute are revealed (future stays hidden)
    if m.secret_outcome is not null and v_phase <> 'upcoming' then
      select coalesce(jsonb_agg(e order by (e ->> 'minute')::int), '[]'::jsonb)
        into v_events
        from jsonb_array_elements(m.secret_outcome -> 'events') e
       where (e ->> 'minute')::int <= v_minute;
    else
      v_events := '[]'::jsonb;
    end if;

    select count(*) filter (where e ->> 'team' = 'home'),
           count(*) filter (where e ->> 'team' = 'away')
      into v_hs, v_as
      from jsonb_array_elements(v_events) e;

    v_out := v_out || jsonb_build_object(
      'match_id', m.id,
      'home_team', m.home_team,
      'away_team', m.away_team,
      'phase', v_phase,
      'minute', v_minute,
      'starts_in', greatest(0, ceil(-v_elapsed))::int,
      'duration_secs', v_dur,
      'home_score', coalesce(v_hs, 0),
      'away_score', coalesce(v_as, 0),
      'events', v_events,
      -- final result only once the match is over (never mid-match)
      'result', case when v_phase = 'finished'
                     then coalesce(m.secret_outcome ->> 'result', m.result) end);
  end loop;
  return v_out;
end;
$fn$;

-- Backfill: finished matches keep their real outcome; others get a hidden one.
update public.matches
   set secret_outcome = jsonb_build_object(
         'result', result, 'home_score', home_score, 'away_score', away_score,
         'events', coalesce(timeline, '[]'::jsonb))
 where status = 'finished' and secret_outcome is null;

update public.matches
   set secret_outcome = public._make_outcome(true_probabilities)
 where status <> 'finished' and secret_outcome is null;

revoke all on function public._make_outcome(jsonb)      from public, anon, authenticated;
revoke all on function public.get_live_state(uuid[])    from public, anon;
grant execute on function public.get_live_state(uuid[]) to authenticated;


-- ============================================================================
-- pickplay.ai — 0010: re-stagger upcoming kickoffs into the near-future window
-- ----------------------------------------------------------------------------
-- Earlier migrations seeded far-future kickoffs (15 min .. 4 h). Under the live
-- model that means nothing ever goes live. Re-time every still-open match into a
-- staggered near-future window (~20s apart) so the bulletin always has matches
-- "about to start" and cycling through live. One-time data fix; ongoing
-- freshness is handled by continuous generation (a later phase).
-- Idempotent (safe to re-run).
-- ============================================================================

with u as (
  select id, row_number() over (order by random()) as rn
    from public.matches
   where status = 'upcoming'
)
update public.matches m
   set starts_at = now() + make_interval(secs => 20 + (u.rn - 1) * 20)
  from u
 where u.id = m.id;

-- ensure every re-timed match has a hidden outcome ready to play out
update public.matches
   set secret_outcome = public._make_outcome(true_probabilities)
 where status = 'upcoming' and secret_outcome is null;


-- ============================================================================
-- pickplay.ai — 0011: live odds engine
-- ----------------------------------------------------------------------------
-- While a match is live, the 1/X/2 odds are recomputed from the CURRENT score
-- and the REMAINING time (not the fixed pre-match line). Model: remaining goals
-- for each team ~ Poisson(rate * remaining_fraction); combine with the current
-- score to get P(home win / draw / away win), then price with a small margin.
--
-- Behaviour this produces (the point of live betting):
--   * 0-0 at 85'  -> draw very likely  -> draw odds drop, win odds rise
--   * 1-0 at 85'  -> home nearly certain -> home ~1.10, away balloons
--   * underdog equalises -> its odds snap in (e.g. 7.80 -> ~3.5x) instantly,
--     the leader's odds jump out
--
-- Server-authoritative: uses the HIDDEN true_probabilities only to derive team
-- strength; exposes only the resulting odds. Self-contained + idempotent.
-- ============================================================================

-- Core model. Deterministic given (probs, minute, score) -> immutable.
create or replace function public._live_odds(
  p_probs jsonb, p_minute int, p_hs int, p_as int)
returns jsonb
language plpgsql
immutable
set search_path = public
as $fn$
declare
  ph  double precision := coalesce((p_probs ->> 'home')::double precision, 0.40);
  pa  double precision := coalesce((p_probs ->> 'away')::double precision, 0.30);
  r   double precision := greatest(0.0, (90 - least(p_minute, 90))::double precision / 90.0);
  lh  double precision := (0.6 + 1.7 * ph) * r;   -- expected remaining home goals
  la  double precision := (0.6 + 1.7 * pa) * r;   -- expected remaining away goals
  d   int := p_hs - p_as;
  cap int := 8;
  hh  int; aa int; fd int;
  pw  double precision := 0; pd double precision := 0; pl double precision := 0;
  fh  double precision[]; fa double precision[];
  pk  double precision; s double precision;
  m   double precision := 1.06;   -- ~6% overround
begin
  -- Poisson pmfs for remaining goals of each team
  for hh in 0 .. cap loop
    fh[hh] := exp(-lh) * power(lh, hh) / factorial(hh)::double precision;
    fa[hh] := exp(-la) * power(la, hh) / factorial(hh)::double precision;
  end loop;

  for hh in 0 .. cap loop
    for aa in 0 .. cap loop
      pk := fh[hh] * fa[aa];
      fd := d + hh - aa;                 -- final goal difference
      if    fd > 0 then pw := pw + pk;
      elsif fd = 0 then pd := pd + pk;
      else               pl := pl + pk;
      end if;
    end loop;
  end loop;

  s := pw + pd + pl;
  if s <= 0 then s := 1; end if;
  pw := pw / s; pd := pd / s; pl := pl / s;

  return jsonb_build_object(
    'home', least(25.0, greatest(1.01, round((1.0 / (greatest(pw, 0.0005) * m))::numeric, 2))),
    'draw', least(25.0, greatest(1.01, round((1.0 / (greatest(pd, 0.0005) * m))::numeric, 2))),
    'away', least(25.0, greatest(1.01, round((1.0 / (greatest(pl, 0.0005) * m))::numeric, 2))));
end;
$fn$;

-- Public "what-if" wrapper (safe: computes only from caller-supplied inputs,
-- reveals nothing about any real match). Handy for testing + client previews.
create or replace function public.preview_live_odds(
  p_probs jsonb, p_minute int, p_home int, p_away int)
returns jsonb
language sql
immutable
security definer   -- runs as owner so it may call the internal _live_odds
set search_path = public
as $$ select public._live_odds(p_probs, p_minute, p_home, p_away); $$;

-- get_live_state now also returns live_odds: computed for live matches, the
-- pre-match line for upcoming, null once finished.
create or replace function public.get_live_state(p_match_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_now     timestamptz := now();
  v_out     jsonb := '[]'::jsonb;
  m         record;
  v_elapsed double precision;
  v_dur     int;
  v_minute  int;
  v_phase   text;
  v_events  jsonb;
  v_hs      int;
  v_as      int;
  v_odds    jsonb;
begin
  for m in select * from public.matches where id = any(p_match_ids) loop
    v_dur := coalesce(m.duration_secs, 100);
    v_elapsed := extract(epoch from (v_now - m.starts_at));

    if v_elapsed < 0 then
      v_phase := 'upcoming'; v_minute := 0;
    elsif v_elapsed >= v_dur then
      v_phase := 'finished'; v_minute := 90;
    else
      v_phase := 'live';
      v_minute := least(90, greatest(0, floor(v_elapsed / v_dur * 90)::int));
    end if;

    if m.secret_outcome is not null and v_phase <> 'upcoming' then
      select coalesce(jsonb_agg(e order by (e ->> 'minute')::int), '[]'::jsonb)
        into v_events
        from jsonb_array_elements(m.secret_outcome -> 'events') e
       where (e ->> 'minute')::int <= v_minute;
    else
      v_events := '[]'::jsonb;
    end if;

    select count(*) filter (where e ->> 'team' = 'home'),
           count(*) filter (where e ->> 'team' = 'away')
      into v_hs, v_as
      from jsonb_array_elements(v_events) e;

    if v_phase = 'live' then
      v_odds := public._live_odds(m.true_probabilities, v_minute, coalesce(v_hs, 0), coalesce(v_as, 0));
    elsif v_phase = 'upcoming' then
      v_odds := m.display_odds;
    else
      v_odds := null;
    end if;

    v_out := v_out || jsonb_build_object(
      'match_id', m.id,
      'home_team', m.home_team,
      'away_team', m.away_team,
      'phase', v_phase,
      'minute', v_minute,
      'starts_in', greatest(0, ceil(-v_elapsed))::int,
      'duration_secs', v_dur,
      'home_score', coalesce(v_hs, 0),
      'away_score', coalesce(v_as, 0),
      'events', v_events,
      'live_odds', v_odds,
      'result', case when v_phase = 'finished'
                     then coalesce(m.secret_outcome ->> 'result', m.result) end);
  end loop;
  return v_out;
end;
$fn$;

revoke all on function public._live_odds(jsonb, int, int, int) from public, anon, authenticated;
revoke all on function public.preview_live_odds(jsonb, int, int, int) from public, anon;
grant execute on function public.preview_live_odds(jsonb, int, int, int) to authenticated;


-- ============================================================================
-- pickplay.ai — 0012: watch timeline (personal replay of a bet-on match)
-- ----------------------------------------------------------------------------
-- Fixes "can't watch a match start to finish": matches run on a global clock,
-- so a user reaching one late sees it already over. Instead, let the client
-- replay a match locally from the moment they open the watch screen (0' -> 90').
--
-- get_watch_timeline returns the FULL outcome (result + goal events + team
-- strength) — but ONLY for a match the caller has a coupon on. Since the bet is
-- already locked, revealing that match's script can't be used to cheat, and it
-- lets the client drive a smooth personal playback + live odds offline.
-- Self-contained + idempotent.
-- ============================================================================

create or replace function public.get_watch_timeline(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid   uuid := auth.uid();
  v_match public.matches;
  v_has   boolean;
  v_out   jsonb;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  -- caller must have a coupon selection on this match
  select exists (
    select 1
      from public.coupon_selections cs
      join public.market_options mo on mo.id = cs.market_option_id
      join public.markets mk       on mk.id = mo.market_id
      join public.coupons c        on c.id  = cs.coupon_id
     where mk.match_id = p_match_id and c.user_id = v_uid
  ) into v_has;
  if not v_has then
    raise exception 'no_bet_on_match';
  end if;

  select * into v_match from public.matches where id = p_match_id;
  if not found then raise exception 'Match not found'; end if;

  v_out := coalesce(v_match.secret_outcome,
                    public._make_outcome(v_match.true_probabilities));

  return jsonb_build_object(
    'match_id',      v_match.id,
    'home_team',     v_match.home_team,
    'away_team',     v_match.away_team,
    'duration_secs', coalesce(v_match.duration_secs, 100),
    'probs',         v_match.true_probabilities,
    'result',        v_out ->> 'result',
    'home_score',    (v_out ->> 'home_score')::int,
    'away_score',    (v_out ->> 'away_score')::int,
    'events',        v_out -> 'events');
end;
$fn$;

revoke all on function public.get_watch_timeline(uuid) from public, anon;
grant execute on function public.get_watch_timeline(uuid) to authenticated;


-- ============================================================================
-- pickplay.ai — 0013: single-source outcome (fix double-result)
-- ----------------------------------------------------------------------------
-- SORUN 0: a match could resolve to two DIFFERENT results — once while watched
-- live, once when settled. Root cause: both get_watch_timeline and
-- _finalize_match used `coalesce(secret_outcome, _make_outcome(...))`. For a
-- match whose secret_outcome was null, that RE-ROLLS a fresh random outcome on
-- each path (and doesn't persist it) -> divergence.
--
-- Fix: the outcome is decided ONCE and PERSISTED, then never regenerated.
-- _ensure_outcome lazily fills secret_outcome (guarded, race-safe) and returns
-- it; both the watch path and the settle path read that one stored value. So
-- what you watch live == what settles == what re-settling shows, always.
-- Self-contained + idempotent.
-- ============================================================================

-- Persist-once: generate the hidden outcome only if missing, return the stored
-- value. The WHERE ... IS NULL guard makes concurrent callers converge on one.
create or replace function public._ensure_outcome(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_out jsonb;
begin
  update public.matches
     set secret_outcome = public._make_outcome(true_probabilities)
   where id = p_match_id and secret_outcome is null;
  select secret_outcome into v_out from public.matches where id = p_match_id;
  return v_out;
end;
$fn$;

-- watch path: read the ONE stored outcome (persist if somehow missing).
create or replace function public.get_watch_timeline(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid   uuid := auth.uid();
  v_match public.matches;
  v_has   boolean;
  v_out   jsonb;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select exists (
    select 1
      from public.coupon_selections cs
      join public.market_options mo on mo.id = cs.market_option_id
      join public.markets mk       on mk.id = mo.market_id
      join public.coupons c        on c.id  = cs.coupon_id
     where mk.match_id = p_match_id and c.user_id = v_uid
  ) into v_has;
  if not v_has then raise exception 'no_bet_on_match'; end if;

  select * into v_match from public.matches where id = p_match_id;
  if not found then raise exception 'Match not found'; end if;

  v_out := public._ensure_outcome(p_match_id);

  return jsonb_build_object(
    'match_id',      v_match.id,
    'home_team',     v_match.home_team,
    'away_team',     v_match.away_team,
    'duration_secs', coalesce(v_match.duration_secs, 100),
    'probs',         v_match.true_probabilities,
    'result',        v_out ->> 'result',
    'home_score',    (v_out ->> 'home_score')::int,
    'away_score',    (v_out ->> 'away_score')::int,
    'events',        v_out -> 'events');
end;
$fn$;

-- settle path: apply the SAME stored outcome (never re-roll).
create or replace function public._finalize_match(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_match public.matches;
  v_out   jsonb;
begin
  select * into v_match from public.matches where id = p_match_id for update;
  if not found or v_match.status = 'finished' then return; end if;

  v_out := public._ensure_outcome(p_match_id);   -- the one, stored outcome

  update public.matches
     set status = 'finished',
         result = v_out ->> 'result',
         home_score = (v_out ->> 'home_score')::int,
         away_score = (v_out ->> 'away_score')::int,
         timeline = v_out -> 'events'
   where id = p_match_id;

  perform public._score_match(p_match_id);
  perform public._settle_markets(p_match_id);
end;
$fn$;

-- Backfill: make sure no match is left without a persisted outcome.
update public.matches
   set secret_outcome = public._make_outcome(true_probabilities)
 where secret_outcome is null;

revoke all on function public._ensure_outcome(uuid) from public, anon, authenticated;


