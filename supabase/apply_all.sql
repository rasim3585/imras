-- pickplay.ai combined migrations (0001..0029)
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


-- ============================================================================
-- pickplay.ai — 0014: soften live odds (match the client)
-- ----------------------------------------------------------------------------
-- The live prices were too brutal at the extremes (0-0 @85' draw ~1.07, wins
-- ~15-17, cap 25). Blend each probability 20% toward uniform before pricing, and
-- tighten the bounds (floor 1.05, cap 20). Identical to the client-side model
-- (liveModel.ts, BLEND = 0.2) so a replay and the server agree.
-- Self-contained + idempotent.
-- ============================================================================

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
  lh  double precision := (0.6 + 1.7 * ph) * r;
  la  double precision := (0.6 + 1.7 * pa) * r;
  d   int := p_hs - p_as;
  cap int := 8;
  hh  int; aa int; fd int;
  pw  double precision := 0; pd double precision := 0; pl double precision := 0;
  fh  double precision[]; fa double precision[];
  pk  double precision; s double precision;
  m   double precision := 1.06;
  b   double precision := 0.20;   -- blend toward uniform
begin
  for hh in 0 .. cap loop
    fh[hh] := exp(-lh) * power(lh, hh) / factorial(hh)::double precision;
    fa[hh] := exp(-la) * power(la, hh) / factorial(hh)::double precision;
  end loop;
  for hh in 0 .. cap loop
    for aa in 0 .. cap loop
      pk := fh[hh] * fa[aa];
      fd := d + hh - aa;
      if    fd > 0 then pw := pw + pk;
      elsif fd = 0 then pd := pd + pk;
      else               pl := pl + pk;
      end if;
    end loop;
  end loop;
  s := pw + pd + pl;
  if s <= 0 then s := 1; end if;
  pw := (pw / s) * (1 - b) + b / 3;
  pd := (pd / s) * (1 - b) + b / 3;
  pl := (pl / s) * (1 - b) + b / 3;

  return jsonb_build_object(
    'home', least(20.0, greatest(1.05, round((1.0 / (greatest(pw, 0.001) * m))::numeric, 2))),
    'draw', least(20.0, greatest(1.05, round((1.0 / (greatest(pd, 0.001) * m))::numeric, 2))),
    'away', least(20.0, greatest(1.05, round((1.0 / (greatest(pl, 0.001) * m))::numeric, 2))));
end;
$fn$;


-- ============================================================================
-- pickplay.ai — 0015: Model A — real-time, user-independent matches
-- ----------------------------------------------------------------------------
-- Matches progress on a CENTRAL clock (starts_at + duration_secs), not on the
-- viewer's screen. A match finishes and persists its (pre-decided, single-
-- source) result when its real time is over — whether or not anyone watched.
-- Settlement reads that recorded result; a coupon cannot be settled while any
-- of its matches is still in progress.
--
--   * _finalize_match now only fires once a match's real time is over (no early
--     finish). Still idempotent + applies the one stored outcome.
--   * finalize_due_matches(): finalizes every match whose clock has ended — the
--     "global settlement" trigger (any active client can call it to advance the
--     world; a cron can call it too).
--   * settle_coupon: finalizes due legs, and only grades/pays when ALL legs are
--     finished; otherwise returns in_progress (no early/partial settle).
-- Self-contained + idempotent. Money/determinism/secrecy unchanged.
-- ============================================================================

-- Finish a match only when its central clock is over.
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
  -- Model A: no early finish — the match ends on the central clock, not on demand
  if now() < v_match.starts_at + make_interval(secs => coalesce(v_match.duration_secs, 100)) then
    return;
  end if;

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

-- Global trigger: finish every match whose real time has ended.
create or replace function public.finalize_due_matches()
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
  r record;
  n int := 0;
begin
  for r in
    select id from public.matches
     where status <> 'finished'
       and now() >= starts_at + make_interval(secs => coalesce(duration_secs, 100))
  loop
    perform public._finalize_match(r.id);
    n := n + 1;
  end loop;
  return n;
end;
$fn$;

-- Settle only when all legs are over; otherwise report in_progress.
create or replace function public.settle_coupon(p_coupon_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid     uuid := auth.uid();
  v_coupon  public.coupons;
  r         record;
  v_all_ok  boolean := true;
  v_all_done boolean;
  v_sels    jsonb;
  v_bal     int;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select * into v_coupon from public.coupons where id = p_coupon_id and user_id = v_uid for update;
  if not found then raise exception 'Coupon not found'; end if;

  if v_coupon.status = 'pending' then
    -- finish any legs whose real time is over
    for r in
      select distinct mk.match_id
        from public.coupon_selections cs
        join public.market_options mo on mo.id = cs.market_option_id
        join public.markets mk on mk.id = mo.market_id
       where cs.coupon_id = p_coupon_id
    loop
      perform public._finalize_match(r.match_id);
    end loop;

    -- are ALL legs finished now?
    select bool_and(m.status = 'finished') into v_all_done
      from public.coupon_selections cs
      join public.market_options mo on mo.id = cs.market_option_id
      join public.markets mk on mk.id = mo.market_id
      join public.matches m  on m.id  = mk.match_id
     where cs.coupon_id = p_coupon_id;

    if v_all_done then
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
    'coupon_id', v_coupon.id, 'status', v_coupon.status,
    'in_progress', (v_coupon.status = 'pending'),
    'stake', v_coupon.stake, 'total_odds', v_coupon.total_odds,
    'potential_win', v_coupon.potential_win, 'new_balance', v_bal, 'selections', v_sels);
end;
$fn$;

revoke all on function public.finalize_due_matches() from public, anon;
grant execute on function public.finalize_due_matches() to authenticated;


-- ============================================================================
-- pickplay.ai — 0016: live betting + continuous bulletin
-- ----------------------------------------------------------------------------
-- With Model A a match goes live almost immediately, so the pre-match market
-- would "close" before the user finishes a coupon. Fix: the market stays OPEN
-- once live — place_coupon now accepts live matches and LOCKS the current live
-- price (server-computed from the hidden probs + current minute/score). Only a
-- finished match, or one in the closing minutes (>= 85'), rejects with a clean
-- 'market_closed'. Result stays deterministic + server-authoritative.
--
-- Also: seed_matches now keeps a CONTINUOUS staggered bulletin — a few matches
-- upcoming and a few already live at various minutes, so it's never empty.
-- Self-contained + idempotent.
-- ============================================================================

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
  v_ids     uuid[] := '{}';
  v_locks   numeric[] := '{}';
  v_elapsed double precision;
  v_dur     int;
  v_minute  int;
  v_hs      int;
  v_as      int;
  v_lock    numeric;
  i         int;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if p_stake is null or p_stake <= 0 then raise exception 'Stake must be positive'; end if;
  v_count := coalesce(array_length(p_option_ids, 1), 0);
  if v_count < 1 then raise exception 'Add at least one selection'; end if;
  if v_count > 10 then raise exception 'A coupon can hold at most 10 selections'; end if;

  select gold_balance into v_balance from public.profiles where id = v_uid for update;
  if v_balance < p_stake then raise exception 'Not enough gold'; end if;

  foreach v_oid in array p_option_ids loop
    select mo.odds as odds, mo.outcome_key as outcome_key, mk.market_type as market_type,
           mk.match_id as match_id, m.starts_at as starts_at, m.duration_secs as duration_secs,
           m.status as status, m.true_probabilities as probs, m.secret_outcome as secret,
           m.home_team as home_team, m.away_team as away_team
      into rec
      from public.market_options mo
      join public.markets mk on mk.id = mo.market_id
      join public.matches m  on m.id  = mk.match_id
     where mo.id = v_oid
     for update of mo;
    if not found then raise exception 'Selection not found'; end if;
    if rec.match_id = any(v_seen) then raise exception 'Only one pick per match is allowed on a coupon'; end if;
    v_seen := array_append(v_seen, rec.match_id);

    v_dur := coalesce(rec.duration_secs, 100);
    v_elapsed := extract(epoch from (now() - rec.starts_at));

    if rec.status = 'finished' or v_elapsed >= v_dur then
      raise exception 'market_closed';                   -- match is over
    elsif v_elapsed < 0 then
      v_lock := rec.odds;                                -- pre-match fixed line
    else
      v_minute := least(90, floor(v_elapsed / v_dur * 90)::int);
      if v_minute >= 85 then raise exception 'market_closed'; end if;   -- closing minutes
      if rec.market_type <> 'match_result' then raise exception 'market_closed'; end if;
      -- current score from goals revealed so far
      select count(*) filter (where e ->> 'team' = 'home'),
             count(*) filter (where e ->> 'team' = 'away')
        into v_hs, v_as
        from jsonb_array_elements(rec.secret -> 'events') e
       where (e ->> 'minute')::int <= v_minute;
      -- LOCK the current live price for the picked outcome
      v_lock := (public._live_odds(rec.probs, v_minute, coalesce(v_hs, 0), coalesce(v_as, 0)) ->> rec.outcome_key)::numeric;
    end if;

    v_ids   := array_append(v_ids, v_oid);
    v_locks := array_append(v_locks, v_lock);
    v_total := v_total * v_lock;
  end loop;

  v_total := round(v_total, 2);
  v_pot   := round(p_stake * v_total)::int;

  insert into public.coupons (user_id, stake, total_odds, potential_win, status)
    values (v_uid, p_stake, v_total, v_pot, 'pending') returning id into v_coupon;

  for i in 1 .. array_length(v_ids, 1) loop
    insert into public.coupon_selections (coupon_id, market_option_id, odds)
      values (v_coupon, v_ids[i], v_locks[i]);
  end loop;

  update public.profiles set gold_balance = gold_balance - p_stake where id = v_uid;

  return jsonb_build_object('coupon_id', v_coupon, 'total_odds', v_total,
    'potential_win', v_pot, 'new_balance', v_balance - p_stake);
end;
$fn$;

-- Continuous bulletin: keep ~10 non-finished matches, staggered so some are
-- already live (started in the recent past) and some are upcoming.
create or replace function public.seed_matches(p_target int default 10)
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
  v_hi    int; v_ai int;
  v_h     double precision; v_d double precision; v_a double precision; v_sum double precision;
  v_probs jsonb;
  v_id    uuid;
  i       int;
begin
  p_target := least(greatest(coalesce(p_target, 10), 0), 24);
  -- count matches still in play (upcoming or live), i.e. not finished + not over
  select count(*) into v_existing
    from public.matches
   where status <> 'finished'
     and now() < starts_at + make_interval(secs => coalesce(duration_secs, 100));
  v_needed := greatest(0, p_target - v_existing);

  for i in 1 .. v_needed loop
    v_hi := 1 + floor(random() * v_n)::int;
    loop v_ai := 1 + floor(random() * v_n)::int; exit when v_ai <> v_hi; end loop;

    v_h := 0.20 + random() * 0.45; v_d := 0.15 + random() * 0.25; v_a := 0.15 + random() * 0.45;
    v_sum := v_h + v_d + v_a;
    v_h := round((v_h / v_sum)::numeric, 4); v_d := round((v_d / v_sum)::numeric, 4); v_a := round((1 - v_h - v_d)::numeric, 4);
    v_probs := jsonb_build_object('home', v_h, 'draw', v_d, 'away', v_a);

    insert into public.matches
      (sport, home_team, away_team, starts_at, status, true_probabilities, display_odds, secret_outcome, duration_secs)
    values (
      'football', v_teams[v_hi], v_teams[v_ai],
      -- staggered: from ~40s ago (already live) to ~4min ahead (upcoming)
      now() + make_interval(secs => -40 + floor(random() * 280)::int),
      'upcoming', v_probs, public._make_display_odds(v_h, v_d, v_a),
      public._make_outcome(v_probs), 100)
    returning id into v_id;

    perform public._ensure_markets(v_id);
  end loop;

  return v_needed;
end;
$fn$;

grant execute on function public.seed_matches(int) to authenticated;


-- ============================================================================
-- pickplay.ai — 0017: reliable finish, red-card odds, auto-settle
-- ----------------------------------------------------------------------------
-- BUG 1: matches now finish reliably — get_live_state finalizes any requested
--        match whose central clock is over (finalize-on-read), and returns the
--        finished state.
-- BUG 2: coupons auto-settle — settle_due_coupons() settles all of the caller's
--        pending coupons whose matches are all finished (no manual button).
-- B4:    red cards move the live price — the outcome script now includes 0-2
--        deterministic red cards; a carded team's remaining-goal strength drops,
--        so its live odds jump out (server-authoritative; place_coupon agrees).
-- Result/score stay single-source + deterministic; the future stays hidden.
-- Self-contained + idempotent.
-- ============================================================================

-- Outcome now also carries a deterministic red-card list (atmosphere + odds;
-- never changes the score). Existing matches without 'cards' read as none.
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
  v_cards  jsonb := '[]'::jsonb;
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

  if random() < 0.5 then
    v_cards := v_cards || jsonb_build_object('minute', 25 + floor(random() * 60)::int,
      'team', case when random() < 0.5 then 'home' else 'away' end);
  end if;
  if random() < 0.18 then
    v_cards := v_cards || jsonb_build_object('minute', 30 + floor(random() * 55)::int,
      'team', case when random() < 0.5 then 'home' else 'away' end);
  end if;

  return jsonb_build_object(
    'result', v_result, 'home_score', v_hs, 'away_score', v_as,
    'events', public._make_timeline(v_hs, v_as), 'cards', v_cards);
end;
$fn$;

-- get_live_state: finalize-on-read for due matches; reveal cards; live odds
-- reflect red cards (carded team weakened) so the price jumps on a sending-off.
create or replace function public.get_live_state(p_match_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_now     timestamptz := now();
  v_out     jsonb := '[]'::jsonb;
  r         record;
  m         record;
  v_elapsed double precision;
  v_dur     int;
  v_minute  int;
  v_phase   text;
  v_events  jsonb;
  v_cards   jsonb;
  v_hs      int; v_as int; v_rh int; v_ra int;
  v_probs   jsonb;
  v_odds    jsonb;
begin
  -- finalize any requested match whose real time is over (BUG 1)
  for r in
    select id from public.matches
     where id = any(p_match_ids) and status <> 'finished'
       and v_now >= starts_at + make_interval(secs => coalesce(duration_secs, 100))
  loop
    perform public._finalize_match(r.id);
  end loop;

  for m in select * from public.matches where id = any(p_match_ids) loop
    v_dur := coalesce(m.duration_secs, 100);
    v_elapsed := extract(epoch from (v_now - m.starts_at));

    if m.status = 'finished' or v_elapsed >= v_dur then
      v_phase := 'finished'; v_minute := 90;
    elsif v_elapsed < 0 then
      v_phase := 'upcoming'; v_minute := 0;
    else
      v_phase := 'live';
      v_minute := least(90, greatest(0, floor(v_elapsed / v_dur * 90)::int));
    end if;

    if m.secret_outcome is not null and v_phase <> 'upcoming' then
      select coalesce(jsonb_agg(e order by (e ->> 'minute')::int), '[]'::jsonb) into v_events
        from jsonb_array_elements(m.secret_outcome -> 'events') e
       where (e ->> 'minute')::int <= v_minute;
      select coalesce(jsonb_agg(c order by (c ->> 'minute')::int), '[]'::jsonb),
             count(*) filter (where c ->> 'team' = 'home'),
             count(*) filter (where c ->> 'team' = 'away')
        into v_cards, v_rh, v_ra
        from jsonb_array_elements(coalesce(m.secret_outcome -> 'cards', '[]'::jsonb)) c
       where (c ->> 'minute')::int <= v_minute;
    else
      v_events := '[]'::jsonb; v_cards := '[]'::jsonb; v_rh := 0; v_ra := 0;
    end if;

    select count(*) filter (where e ->> 'team' = 'home'),
           count(*) filter (where e ->> 'team' = 'away')
      into v_hs, v_as from jsonb_array_elements(v_events) e;

    if v_phase = 'live' then
      -- weaken the carded team's strength -> its live odds jump out
      v_probs := jsonb_build_object(
        'home', (m.true_probabilities ->> 'home')::double precision * power(0.72, coalesce(v_rh, 0)),
        'away', (m.true_probabilities ->> 'away')::double precision * power(0.72, coalesce(v_ra, 0)));
      v_odds := public._live_odds(v_probs, v_minute, coalesce(v_hs, 0), coalesce(v_as, 0));
    elsif v_phase = 'upcoming' then
      v_odds := m.display_odds;
    else
      v_odds := null;
    end if;

    v_out := v_out || jsonb_build_object(
      'match_id', m.id, 'home_team', m.home_team, 'away_team', m.away_team,
      'phase', v_phase, 'minute', v_minute,
      'starts_in', greatest(0, ceil(-v_elapsed))::int, 'duration_secs', v_dur,
      'home_score', coalesce(v_hs, 0), 'away_score', coalesce(v_as, 0),
      'events', v_events, 'cards', coalesce(v_cards, '[]'::jsonb),
      'red_home', coalesce(v_rh, 0), 'red_away', coalesce(v_ra, 0),
      'live_odds', v_odds,
      'result', case when v_phase = 'finished' then coalesce(m.secret_outcome ->> 'result', m.result) end);
  end loop;
  return v_out;
end;
$fn$;

-- place_coupon: live locking also reflects red cards.
create or replace function public.place_coupon(p_option_ids uuid[], p_stake int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_balance int; v_count int; v_total numeric := 1; v_pot int; v_coupon uuid;
  v_oid uuid; rec record; v_seen uuid[] := '{}'; v_ids uuid[] := '{}'; v_locks numeric[] := '{}';
  v_elapsed double precision; v_dur int; v_minute int; v_hs int; v_as int; v_rh int; v_ra int;
  v_probs jsonb; v_lock numeric; i int;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if p_stake is null or p_stake <= 0 then raise exception 'Stake must be positive'; end if;
  v_count := coalesce(array_length(p_option_ids, 1), 0);
  if v_count < 1 then raise exception 'Add at least one selection'; end if;
  if v_count > 10 then raise exception 'A coupon can hold at most 10 selections'; end if;

  select gold_balance into v_balance from public.profiles where id = v_uid for update;
  if v_balance < p_stake then raise exception 'Not enough gold'; end if;

  foreach v_oid in array p_option_ids loop
    select mo.odds odds, mo.outcome_key outcome_key, mk.market_type market_type, mk.match_id match_id,
           m.starts_at starts_at, m.duration_secs duration_secs, m.status status,
           m.true_probabilities probs, m.secret_outcome secret
      into rec
      from public.market_options mo
      join public.markets mk on mk.id = mo.market_id
      join public.matches m on m.id = mk.match_id
     where mo.id = v_oid for update of mo;
    if not found then raise exception 'Selection not found'; end if;
    if rec.match_id = any(v_seen) then raise exception 'Only one pick per match is allowed on a coupon'; end if;
    v_seen := array_append(v_seen, rec.match_id);

    v_dur := coalesce(rec.duration_secs, 100);
    v_elapsed := extract(epoch from (now() - rec.starts_at));
    if rec.status = 'finished' or v_elapsed >= v_dur then
      raise exception 'market_closed';
    elsif v_elapsed < 0 then
      v_lock := rec.odds;
    else
      v_minute := least(90, floor(v_elapsed / v_dur * 90)::int);
      if v_minute >= 85 then raise exception 'market_closed'; end if;
      if rec.market_type <> 'match_result' then raise exception 'market_closed'; end if;
      select count(*) filter (where e ->> 'team' = 'home'), count(*) filter (where e ->> 'team' = 'away')
        into v_hs, v_as from jsonb_array_elements(rec.secret -> 'events') e where (e ->> 'minute')::int <= v_minute;
      select count(*) filter (where c ->> 'team' = 'home'), count(*) filter (where c ->> 'team' = 'away')
        into v_rh, v_ra from jsonb_array_elements(coalesce(rec.secret -> 'cards', '[]'::jsonb)) c where (c ->> 'minute')::int <= v_minute;
      v_probs := jsonb_build_object(
        'home', (rec.probs ->> 'home')::double precision * power(0.72, coalesce(v_rh, 0)),
        'away', (rec.probs ->> 'away')::double precision * power(0.72, coalesce(v_ra, 0)));
      v_lock := (public._live_odds(v_probs, v_minute, coalesce(v_hs, 0), coalesce(v_as, 0)) ->> rec.outcome_key)::numeric;
    end if;

    v_ids := array_append(v_ids, v_oid);
    v_locks := array_append(v_locks, v_lock);
    v_total := v_total * v_lock;
  end loop;

  v_total := round(v_total, 2);
  v_pot := round(p_stake * v_total)::int;
  insert into public.coupons (user_id, stake, total_odds, potential_win, status)
    values (v_uid, p_stake, v_total, v_pot, 'pending') returning id into v_coupon;
  for i in 1 .. array_length(v_ids, 1) loop
    insert into public.coupon_selections (coupon_id, market_option_id, odds) values (v_coupon, v_ids[i], v_locks[i]);
  end loop;
  update public.profiles set gold_balance = gold_balance - p_stake where id = v_uid;

  return jsonb_build_object('coupon_id', v_coupon, 'total_odds', v_total, 'potential_win', v_pot, 'new_balance', v_balance - p_stake);
end;
$fn$;

-- Auto-settle: resolve every pending coupon of the caller whose legs are all done.
create or replace function public.settle_due_coupons()
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  r record;
  n int := 0;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  for r in select id from public.coupons where user_id = v_uid and status = 'pending' loop
    perform public.settle_coupon(r.id);
  end loop;
  select count(*) into n from public.coupons
   where user_id = v_uid and status <> 'pending'
     and settled_at >= now() - interval '20 seconds';
  return n;
end;
$fn$;

revoke all on function public.settle_due_coupons() from public, anon;
grant execute on function public.settle_due_coupons() to authenticated;


-- ============================================================================
-- pickplay.ai - 0018: early cash out
-- ----------------------------------------------------------------------------
-- Lets a user close an OPEN coupon while its matches are still live, for a
-- server-computed value based on the current live odds. Value formula:
--   potential_win * product(current implied prob of each still-open pick) *
--   (1 - cashout margin). A leg already won contributes prob 1; if any leg has
--   already lost, the coupon is dead and cash out is 0/unavailable.
-- The value is locked at the moment do_cashout runs (server authoritative). A
-- cashed-out coupon becomes status cashed_out and is never settled again.
-- Money stays closed + deterministic. Pure ASCII. Idempotent.
-- ============================================================================

alter table public.coupons add column if not exists cashout_amount int;
alter table public.coupons drop constraint if exists coupons_status_check;
alter table public.coupons
  add constraint coupons_status_check
  check (status in ('pending', 'won', 'lost', 'cashed_out'));

-- Current value of an open coupon (0 if not cashable). Internal.
create or replace function public._cashout_value(p_coupon_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_coupon  public.coupons;
  r         record;
  v_prob    double precision := 1;
  v_now     timestamptz := now();
  v_elapsed double precision;
  v_dur     int;
  v_minute  int;
  v_hs int; v_as int; v_rh int; v_ra int;
  v_probs jsonb; v_odds jsonb;
  v_imp double precision; v_sum double precision;
  v_margin double precision := 0.06;
  v_dead boolean := false;
  v_open int := 0;
begin
  select * into v_coupon from public.coupons where id = p_coupon_id;
  if not found or v_coupon.status <> 'pending' then return 0; end if;

  for r in
    select cs.odds as sel_odds, mo.outcome_key, mo.is_winner, mk.market_type,
           m.id as mid, m.status as mstatus, m.starts_at, m.duration_secs,
           m.true_probabilities as probs, m.secret_outcome as secret
      from public.coupon_selections cs
      join public.market_options mo on mo.id = cs.market_option_id
      join public.markets mk on mk.id = mo.market_id
      join public.matches m  on m.id  = mk.match_id
     where cs.coupon_id = p_coupon_id
  loop
    v_dur := coalesce(r.duration_secs, 100);
    v_elapsed := extract(epoch from (v_now - r.starts_at));

    if r.mstatus = 'finished' or v_elapsed >= v_dur then
      if r.is_winner is true then
        v_prob := v_prob * 1;
      else
        v_dead := true;   -- lost leg (or unresolved finished) kills the coupon
      end if;
    else
      v_open := v_open + 1;
      if v_elapsed < 0 then
        select coalesce(sum(1.0 / o.odds), 0) into v_sum
          from public.market_options o
          join public.markets mk2 on mk2.id = o.market_id
         where mk2.match_id = r.mid and mk2.market_type = r.market_type;
        v_imp := (1.0 / r.sel_odds) / nullif(v_sum, 0);
      else
        v_minute := least(90, floor(v_elapsed / v_dur * 90)::int);
        select count(*) filter (where e ->> 'team' = 'home'), count(*) filter (where e ->> 'team' = 'away')
          into v_hs, v_as from jsonb_array_elements(r.secret -> 'events') e where (e ->> 'minute')::int <= v_minute;
        select count(*) filter (where c ->> 'team' = 'home'), count(*) filter (where c ->> 'team' = 'away')
          into v_rh, v_ra from jsonb_array_elements(coalesce(r.secret -> 'cards', '[]'::jsonb)) c where (c ->> 'minute')::int <= v_minute;
        v_probs := jsonb_build_object(
          'home', (r.probs ->> 'home')::double precision * power(0.72, coalesce(v_rh, 0)),
          'away', (r.probs ->> 'away')::double precision * power(0.72, coalesce(v_ra, 0)));
        v_odds := public._live_odds(v_probs, v_minute, coalesce(v_hs, 0), coalesce(v_as, 0));
        v_imp := (1.0 / (v_odds ->> r.outcome_key)::double precision)
               / ((1.0 / (v_odds ->> 'home')::double precision)
                + (1.0 / (v_odds ->> 'draw')::double precision)
                + (1.0 / (v_odds ->> 'away')::double precision));
      end if;
      v_prob := v_prob * coalesce(v_imp, 0);
    end if;
  end loop;

  if v_dead or v_open = 0 then return 0; end if;
  return greatest(0, floor(v_coupon.potential_win * v_prob * (1 - v_margin))::int);
end;
$fn$;

-- Public: current cash-out value + whether it is available right now.
create or replace function public.get_cashout_value(p_coupon_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_coupon public.coupons;
  r record;
  v_val int;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select * into v_coupon from public.coupons where id = p_coupon_id and user_id = v_uid;
  if not found then raise exception 'Coupon not found'; end if;

  -- finalize any legs whose real time is over, so finished legs are accurate
  for r in
    select distinct mk.match_id
      from public.coupon_selections cs
      join public.market_options mo on mo.id = cs.market_option_id
      join public.markets mk on mk.id = mo.market_id
     where cs.coupon_id = p_coupon_id
  loop
    perform public._finalize_match(r.match_id);
  end loop;

  v_val := public._cashout_value(p_coupon_id);
  return jsonb_build_object('value', v_val, 'available', v_val > 0 and v_coupon.status = 'pending');
end;
$fn$;

-- Public: lock the current value and cash out.
create or replace function public.do_cashout(p_coupon_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_coupon public.coupons;
  r record;
  v_val int;
  v_bal int;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select * into v_coupon from public.coupons where id = p_coupon_id and user_id = v_uid for update;
  if not found then raise exception 'Coupon not found'; end if;
  if v_coupon.status <> 'pending' then raise exception 'cashout_unavailable'; end if;

  for r in
    select distinct mk.match_id
      from public.coupon_selections cs
      join public.market_options mo on mo.id = cs.market_option_id
      join public.markets mk on mk.id = mo.market_id
     where cs.coupon_id = p_coupon_id
  loop
    perform public._finalize_match(r.match_id);
  end loop;

  v_val := public._cashout_value(p_coupon_id);
  if v_val <= 0 then raise exception 'cashout_unavailable'; end if;

  update public.coupons
     set status = 'cashed_out', cashout_amount = v_val, settled_at = now()
   where id = p_coupon_id;
  update public.profiles set gold_balance = gold_balance + v_val where id = v_uid;
  select gold_balance into v_bal from public.profiles where id = v_uid;

  return jsonb_build_object('status', 'cashed_out', 'cashout_amount', v_val, 'new_balance', v_bal);
end;
$fn$;

revoke all on function public._cashout_value(uuid) from public, anon, authenticated;
revoke all on function public.get_cashout_value(uuid) from public, anon;
revoke all on function public.do_cashout(uuid) from public, anon;
grant execute on function public.get_cashout_value(uuid) to authenticated;
grant execute on function public.do_cashout(uuid) to authenticated;


-- ============================================================================
-- pickplay.ai - 0019: market depth (more bet types)
-- ----------------------------------------------------------------------------
-- Adds 8 more markets per match, all priced from ONE Poisson engine and settled
-- deterministically from the SAME match outcome + timeline (no new randomness):
--   double_chance (1X/12/X2), total goals over/under 1.5 / 2.5 / 3.5,
--   both teams to score (yes/no), total goals odd/even, first half result,
--   first half over/under 0.5.
-- Full-time markets are live-priced (odds move with score/time/red cards); the
-- two first-half markets are pre-match only. match_result live odds are the
-- exact same numbers as before (_live_odds now reads the shared engine).
-- Pure ASCII. Idempotent. Money stays closed + deterministic.
-- ============================================================================

-- price a probability with a blend toward uniform (n outcomes) + house margin.
create or replace function public._price(p double precision, blend double precision, n int)
returns numeric
language sql
immutable
set search_path = public
as $$
  select least(20.0, greatest(1.05,
    round((1.0 / (greatest(p * (1 - blend) + blend / n, 0.001) * 1.06))::numeric, 2)));
$$;

-- Full-time market odds from the current state. Returns a map outcome_key->odds.
-- match_result (home/draw/away) matches the old _live_odds exactly (cap 8,
-- blend 0.20). Other markets derive from the same joint score distribution.
create or replace function public._market_odds_ft(p_probs jsonb, p_minute int, p_hs int, p_as int)
returns jsonb
language plpgsql
immutable
set search_path = public
as $fn$
declare
  ph double precision := coalesce((p_probs ->> 'home')::double precision, 0.40);
  pa double precision := coalesce((p_probs ->> 'away')::double precision, 0.30);
  r  double precision := greatest(0.0, (90 - least(p_minute, 90))::double precision / 90.0);
  lh double precision := (0.6 + 1.7 * ph) * r;
  la double precision := (0.6 + 1.7 * pa) * r;
  cap int := 8;
  fh double precision[]; fa double precision[];
  hh int; aa int; fhome int; faway int; tot int;
  pk double precision; s double precision := 0;
  pw double precision := 0; pd double precision := 0; pl double precision := 0;
  o15 double precision := 0; o25 double precision := 0; o35 double precision := 0;
  bt double precision := 0; od double precision := 0;
begin
  for hh in 0 .. cap loop
    fh[hh] := exp(-lh) * power(lh, hh) / factorial(hh)::double precision;
    fa[hh] := exp(-la) * power(la, hh) / factorial(hh)::double precision;
  end loop;
  for hh in 0 .. cap loop
    for aa in 0 .. cap loop
      pk := fh[hh] * fa[aa];
      s := s + pk;
      fhome := p_hs + hh; faway := p_as + aa; tot := fhome + faway;
      if fhome > faway then pw := pw + pk; elsif fhome = faway then pd := pd + pk; else pl := pl + pk; end if;
      if tot > 1 then o15 := o15 + pk; end if;
      if tot > 2 then o25 := o25 + pk; end if;
      if tot > 3 then o35 := o35 + pk; end if;
      if fhome >= 1 and faway >= 1 then bt := bt + pk; end if;
      if (tot % 2) = 1 then od := od + pk; end if;
    end loop;
  end loop;
  if s <= 0 then s := 1; end if;
  pw := pw / s; pd := pd / s; pl := pl / s;
  o15 := o15 / s; o25 := o25 / s; o35 := o35 / s; bt := bt / s; od := od / s;

  return jsonb_build_object(
    'home', public._price(pw, 0.20, 3), 'draw', public._price(pd, 0.20, 3), 'away', public._price(pl, 0.20, 3),
    'dc_1x', public._price(pw + pd, 0, 1), 'dc_12', public._price(pw + pl, 0, 1), 'dc_x2', public._price(pd + pl, 0, 1),
    'ou15_over', public._price(o15, 0.12, 2), 'ou15_under', public._price(1 - o15, 0.12, 2),
    'ou25_over', public._price(o25, 0.12, 2), 'ou25_under', public._price(1 - o25, 0.12, 2),
    'ou35_over', public._price(o35, 0.12, 2), 'ou35_under', public._price(1 - o35, 0.12, 2),
    'btts_yes', public._price(bt, 0.12, 2), 'btts_no', public._price(1 - bt, 0.12, 2),
    'oe_odd', public._price(od, 0.12, 2), 'oe_even', public._price(1 - od, 0.12, 2));
end;
$fn$;

-- First-half market odds (pre-match). First half ~ half the match.
create or replace function public._market_odds_ht(p_probs jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $fn$
declare
  ph double precision := coalesce((p_probs ->> 'home')::double precision, 0.40);
  pa double precision := coalesce((p_probs ->> 'away')::double precision, 0.30);
  lh double precision := (0.6 + 1.7 * ph) * 0.5;
  la double precision := (0.6 + 1.7 * pa) * 0.5;
  cap int := 6;
  fh double precision[]; fa double precision[];
  hh int; aa int; pk double precision; s double precision := 0;
  pw double precision := 0; pd double precision := 0; pl double precision := 0; ov double precision := 0;
begin
  for hh in 0 .. cap loop
    fh[hh] := exp(-lh) * power(lh, hh) / factorial(hh)::double precision;
    fa[hh] := exp(-la) * power(la, hh) / factorial(hh)::double precision;
  end loop;
  for hh in 0 .. cap loop
    for aa in 0 .. cap loop
      pk := fh[hh] * fa[aa]; s := s + pk;
      if hh > aa then pw := pw + pk; elsif hh = aa then pd := pd + pk; else pl := pl + pk; end if;
      if hh + aa > 0 then ov := ov + pk; end if;
    end loop;
  end loop;
  if s <= 0 then s := 1; end if;
  pw := pw / s; pd := pd / s; pl := pl / s; ov := ov / s;
  return jsonb_build_object(
    'ht_home', public._price(pw, 0.20, 3), 'ht_draw', public._price(pd, 0.20, 3), 'ht_away', public._price(pl, 0.20, 3),
    'htou05_over', public._price(ov, 0.12, 2), 'htou05_under', public._price(1 - ov, 0.12, 2));
end;
$fn$;

-- _live_odds now reads the shared engine (match_result numbers unchanged).
create or replace function public._live_odds(p_probs jsonb, p_minute int, p_hs int, p_as int)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select public._market_odds_ft(p_probs, p_minute, p_hs, p_as);
$$;

-- Generate all markets for a match (idempotent per market_type).
create or replace function public._ensure_markets(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_match public.matches;
  v_ft jsonb;
  v_ht jsonb;
  v_mk uuid;
begin
  select * into v_match from public.matches where id = p_match_id;
  if not found then return; end if;
  v_ft := public._market_odds_ft(v_match.true_probabilities, 0, 0, 0);
  v_ht := public._market_odds_ht(v_match.true_probabilities);

  if not exists (select 1 from public.markets where match_id = p_match_id and market_type = 'match_result') then
    insert into public.markets (match_id, market_type, name, status, sort_order)
      values (p_match_id, 'match_result', 'Match Result', 'open', 0) returning id into v_mk;
    insert into public.market_options (market_id, label, outcome_key, odds, sort_order) values
      (v_mk, '1', 'home', (v_ft ->> 'home')::numeric, 0),
      (v_mk, 'X', 'draw', (v_ft ->> 'draw')::numeric, 1),
      (v_mk, '2', 'away', (v_ft ->> 'away')::numeric, 2);
  end if;

  if not exists (select 1 from public.markets where match_id = p_match_id and market_type = 'double_chance') then
    insert into public.markets (match_id, market_type, name, status, sort_order)
      values (p_match_id, 'double_chance', 'Double Chance', 'open', 1) returning id into v_mk;
    insert into public.market_options (market_id, label, outcome_key, odds, sort_order) values
      (v_mk, '1X', 'dc_1x', (v_ft ->> 'dc_1x')::numeric, 0),
      (v_mk, '12', 'dc_12', (v_ft ->> 'dc_12')::numeric, 1),
      (v_mk, 'X2', 'dc_x2', (v_ft ->> 'dc_x2')::numeric, 2);
  end if;

  if not exists (select 1 from public.markets where match_id = p_match_id and market_type = 'over_under_2_5') then
    insert into public.markets (match_id, market_type, name, status, sort_order)
      values (p_match_id, 'over_under_2_5', 'Total Goals 2.5', 'open', 2) returning id into v_mk;
    insert into public.market_options (market_id, label, outcome_key, odds, sort_order) values
      (v_mk, 'Over', 'ou25_over', (v_ft ->> 'ou25_over')::numeric, 0),
      (v_mk, 'Under', 'ou25_under', (v_ft ->> 'ou25_under')::numeric, 1);
  end if;

  if not exists (select 1 from public.markets where match_id = p_match_id and market_type = 'both_teams_score') then
    insert into public.markets (match_id, market_type, name, status, sort_order)
      values (p_match_id, 'both_teams_score', 'Both Teams to Score', 'open', 3) returning id into v_mk;
    insert into public.market_options (market_id, label, outcome_key, odds, sort_order) values
      (v_mk, 'Yes', 'btts_yes', (v_ft ->> 'btts_yes')::numeric, 0),
      (v_mk, 'No', 'btts_no', (v_ft ->> 'btts_no')::numeric, 1);
  end if;

  if not exists (select 1 from public.markets where match_id = p_match_id and market_type = 'over_under_1_5') then
    insert into public.markets (match_id, market_type, name, status, sort_order)
      values (p_match_id, 'over_under_1_5', 'Total Goals 1.5', 'open', 4) returning id into v_mk;
    insert into public.market_options (market_id, label, outcome_key, odds, sort_order) values
      (v_mk, 'Over', 'ou15_over', (v_ft ->> 'ou15_over')::numeric, 0),
      (v_mk, 'Under', 'ou15_under', (v_ft ->> 'ou15_under')::numeric, 1);
  end if;

  if not exists (select 1 from public.markets where match_id = p_match_id and market_type = 'over_under_3_5') then
    insert into public.markets (match_id, market_type, name, status, sort_order)
      values (p_match_id, 'over_under_3_5', 'Total Goals 3.5', 'open', 5) returning id into v_mk;
    insert into public.market_options (market_id, label, outcome_key, odds, sort_order) values
      (v_mk, 'Over', 'ou35_over', (v_ft ->> 'ou35_over')::numeric, 0),
      (v_mk, 'Under', 'ou35_under', (v_ft ->> 'ou35_under')::numeric, 1);
  end if;

  if not exists (select 1 from public.markets where match_id = p_match_id and market_type = 'odd_even') then
    insert into public.markets (match_id, market_type, name, status, sort_order)
      values (p_match_id, 'odd_even', 'Total Goals Odd/Even', 'open', 6) returning id into v_mk;
    insert into public.market_options (market_id, label, outcome_key, odds, sort_order) values
      (v_mk, 'Odd', 'oe_odd', (v_ft ->> 'oe_odd')::numeric, 0),
      (v_mk, 'Even', 'oe_even', (v_ft ->> 'oe_even')::numeric, 1);
  end if;

  if not exists (select 1 from public.markets where match_id = p_match_id and market_type = 'ht_result') then
    insert into public.markets (match_id, market_type, name, status, sort_order)
      values (p_match_id, 'ht_result', 'First Half Result', 'open', 7) returning id into v_mk;
    insert into public.market_options (market_id, label, outcome_key, odds, sort_order) values
      (v_mk, '1', 'ht_home', (v_ht ->> 'ht_home')::numeric, 0),
      (v_mk, 'X', 'ht_draw', (v_ht ->> 'ht_draw')::numeric, 1),
      (v_mk, '2', 'ht_away', (v_ht ->> 'ht_away')::numeric, 2);
  end if;

  if not exists (select 1 from public.markets where match_id = p_match_id and market_type = 'ht_over_under_0_5') then
    insert into public.markets (match_id, market_type, name, status, sort_order)
      values (p_match_id, 'ht_over_under_0_5', 'First Half 0.5', 'open', 8) returning id into v_mk;
    insert into public.market_options (market_id, label, outcome_key, odds, sort_order) values
      (v_mk, 'Over', 'htou05_over', (v_ht ->> 'htou05_over')::numeric, 0),
      (v_mk, 'Under', 'htou05_under', (v_ht ->> 'htou05_under')::numeric, 1);
  end if;
end;
$fn$;

-- Settle EVERY market from the one deterministic outcome + timeline.
create or replace function public._settle_markets(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  m public.matches;
  total int; ht_hs int; ht_as int; ht_total int;
  win text[] := '{}';
begin
  select * into m from public.matches where id = p_match_id;
  if m.result is null then return; end if;
  total := coalesce(m.home_score, 0) + coalesce(m.away_score, 0);

  select count(*) filter (where e ->> 'team' = 'home'), count(*) filter (where e ->> 'team' = 'away')
    into ht_hs, ht_as
    from jsonb_array_elements(coalesce(m.timeline, '[]'::jsonb)) e
   where (e ->> 'minute')::int <= 45;
  ht_hs := coalesce(ht_hs, 0); ht_as := coalesce(ht_as, 0); ht_total := ht_hs + ht_as;

  win := array_append(win, m.result);                                      -- match_result
  if m.result in ('home', 'draw') then win := array_append(win, 'dc_1x'); end if;
  if m.result in ('home', 'away') then win := array_append(win, 'dc_12'); end if;
  if m.result in ('draw', 'away') then win := array_append(win, 'dc_x2'); end if;
  win := array_append(win, case when total > 1 then 'ou15_over' else 'ou15_under' end);
  win := array_append(win, case when total > 2 then 'ou25_over' else 'ou25_under' end);
  win := array_append(win, case when total > 3 then 'ou35_over' else 'ou35_under' end);
  win := array_append(win, case when m.home_score >= 1 and m.away_score >= 1 then 'btts_yes' else 'btts_no' end);
  win := array_append(win, case when (total % 2) = 1 then 'oe_odd' else 'oe_even' end);
  win := array_append(win, case when ht_hs > ht_as then 'ht_home' when ht_hs < ht_as then 'ht_away' else 'ht_draw' end);
  win := array_append(win, case when ht_total > 0 then 'htou05_over' else 'htou05_under' end);

  update public.market_options mo
     set is_winner = (mo.outcome_key = any(win))
    from public.markets mk
   where mk.id = mo.market_id and mk.match_id = p_match_id;
  update public.markets set status = 'settled' where match_id = p_match_id and status <> 'settled';
end;
$fn$;

-- place_coupon: FT markets live-price at the current odds; HT markets are
-- pre-match only; finished / closing minutes reject.
create or replace function public.place_coupon(p_option_ids uuid[], p_stake int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_balance int; v_count int; v_total numeric := 1; v_pot int; v_coupon uuid;
  v_oid uuid; rec record; v_seen uuid[] := '{}'; v_ids uuid[] := '{}'; v_locks numeric[] := '{}';
  v_elapsed double precision; v_dur int; v_minute int; v_hs int; v_as int; v_rh int; v_ra int;
  v_probs jsonb; v_lock numeric; i int;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if p_stake is null or p_stake <= 0 then raise exception 'Stake must be positive'; end if;
  v_count := coalesce(array_length(p_option_ids, 1), 0);
  if v_count < 1 then raise exception 'Add at least one selection'; end if;
  if v_count > 10 then raise exception 'A coupon can hold at most 10 selections'; end if;

  select gold_balance into v_balance from public.profiles where id = v_uid for update;
  if v_balance < p_stake then raise exception 'Not enough gold'; end if;

  foreach v_oid in array p_option_ids loop
    select mo.odds odds, mo.outcome_key outcome_key, mk.market_type market_type, mk.match_id match_id,
           m.starts_at starts_at, m.duration_secs duration_secs, m.status status,
           m.true_probabilities probs, m.secret_outcome secret
      into rec
      from public.market_options mo
      join public.markets mk on mk.id = mo.market_id
      join public.matches m on m.id = mk.match_id
     where mo.id = v_oid for update of mo;
    if not found then raise exception 'Selection not found'; end if;
    if rec.match_id = any(v_seen) then raise exception 'Only one pick per match is allowed on a coupon'; end if;
    v_seen := array_append(v_seen, rec.match_id);

    v_dur := coalesce(rec.duration_secs, 100);
    v_elapsed := extract(epoch from (now() - rec.starts_at));
    if rec.status = 'finished' or v_elapsed >= v_dur then
      raise exception 'market_closed';
    elsif v_elapsed < 0 then
      v_lock := rec.odds;                                  -- pre-match line (any market)
    else
      v_minute := least(90, floor(v_elapsed / v_dur * 90)::int);
      if v_minute >= 85 then raise exception 'market_closed'; end if;
      if rec.market_type in ('ht_result', 'ht_over_under_0_5') then raise exception 'market_closed'; end if;  -- first-half markets are pre-match only
      select count(*) filter (where e ->> 'team' = 'home'), count(*) filter (where e ->> 'team' = 'away')
        into v_hs, v_as from jsonb_array_elements(rec.secret -> 'events') e where (e ->> 'minute')::int <= v_minute;
      select count(*) filter (where c ->> 'team' = 'home'), count(*) filter (where c ->> 'team' = 'away')
        into v_rh, v_ra from jsonb_array_elements(coalesce(rec.secret -> 'cards', '[]'::jsonb)) c where (c ->> 'minute')::int <= v_minute;
      v_probs := jsonb_build_object(
        'home', (rec.probs ->> 'home')::double precision * power(0.72, coalesce(v_rh, 0)),
        'away', (rec.probs ->> 'away')::double precision * power(0.72, coalesce(v_ra, 0)));
      v_lock := (public._market_odds_ft(v_probs, v_minute, coalesce(v_hs, 0), coalesce(v_as, 0)) ->> rec.outcome_key)::numeric;
    end if;

    v_ids := array_append(v_ids, v_oid);
    v_locks := array_append(v_locks, v_lock);
    v_total := v_total * v_lock;
  end loop;

  v_total := round(v_total, 2);
  v_pot := round(p_stake * v_total)::int;
  insert into public.coupons (user_id, stake, total_odds, potential_win, status)
    values (v_uid, p_stake, v_total, v_pot, 'pending') returning id into v_coupon;
  for i in 1 .. array_length(v_ids, 1) loop
    insert into public.coupon_selections (coupon_id, market_option_id, odds) values (v_coupon, v_ids[i], v_locks[i]);
  end loop;
  update public.profiles set gold_balance = gold_balance - p_stake where id = v_uid;

  return jsonb_build_object('coupon_id', v_coupon, 'total_odds', v_total, 'potential_win', v_pot, 'new_balance', v_balance - p_stake);
end;
$fn$;

-- Cash-out value across any market type: implied prob per open leg is 1/current
-- odds (live FT via the engine, otherwise the leg's locked line). Conservative.
create or replace function public._cashout_value(p_coupon_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_coupon public.coupons;
  r record;
  v_prob double precision := 1;
  v_now timestamptz := now();
  v_elapsed double precision; v_dur int; v_minute int;
  v_hs int; v_as int; v_rh int; v_ra int;
  v_probs jsonb; v_imp double precision;
  v_margin double precision := 0.06;
  v_dead boolean := false; v_open int := 0;
begin
  select * into v_coupon from public.coupons where id = p_coupon_id;
  if not found or v_coupon.status <> 'pending' then return 0; end if;

  for r in
    select cs.odds as sel_odds, mo.outcome_key, mo.is_winner, mk.market_type,
           m.id as mid, m.status as mstatus, m.starts_at, m.duration_secs,
           m.true_probabilities as probs, m.secret_outcome as secret
      from public.coupon_selections cs
      join public.market_options mo on mo.id = cs.market_option_id
      join public.markets mk on mk.id = mo.market_id
      join public.matches m  on m.id  = mk.match_id
     where cs.coupon_id = p_coupon_id
  loop
    v_dur := coalesce(r.duration_secs, 100);
    v_elapsed := extract(epoch from (v_now - r.starts_at));
    if r.mstatus = 'finished' or v_elapsed >= v_dur then
      if r.is_winner is true then v_prob := v_prob * 1; else v_dead := true; end if;
    else
      v_open := v_open + 1;
      if v_elapsed >= 0 and r.market_type not in ('ht_result', 'ht_over_under_0_5') then
        v_minute := least(90, floor(v_elapsed / v_dur * 90)::int);
        select count(*) filter (where e ->> 'team' = 'home'), count(*) filter (where e ->> 'team' = 'away')
          into v_hs, v_as from jsonb_array_elements(r.secret -> 'events') e where (e ->> 'minute')::int <= v_minute;
        select count(*) filter (where c ->> 'team' = 'home'), count(*) filter (where c ->> 'team' = 'away')
          into v_rh, v_ra from jsonb_array_elements(coalesce(r.secret -> 'cards', '[]'::jsonb)) c where (c ->> 'minute')::int <= v_minute;
        v_probs := jsonb_build_object(
          'home', (r.probs ->> 'home')::double precision * power(0.72, coalesce(v_rh, 0)),
          'away', (r.probs ->> 'away')::double precision * power(0.72, coalesce(v_ra, 0)));
        v_imp := 1.0 / (public._market_odds_ft(v_probs, v_minute, coalesce(v_hs, 0), coalesce(v_as, 0)) ->> r.outcome_key)::double precision;
      else
        v_imp := 1.0 / r.sel_odds;   -- upcoming or first-half leg: use the locked line
      end if;
      v_prob := v_prob * coalesce(v_imp, 0);
    end if;
  end loop;

  if v_dead or v_open = 0 then return 0; end if;
  return greatest(0, floor(v_coupon.potential_win * v_prob * (1 - v_margin))::int);
end;
$fn$;

revoke all on function public._cashout_value(uuid) from public, anon, authenticated;

-- Backfill the new markets onto matches still in play.
select public._ensure_markets(id)
  from public.matches
 where status <> 'finished';

revoke all on function public._price(double precision, double precision, int) from public, anon, authenticated;
revoke all on function public._market_odds_ft(jsonb, int, int, int) from public, anon, authenticated;
revoke all on function public._market_odds_ht(jsonb) from public, anon, authenticated;


-- ============================================================================
-- pickplay.ai - 0020: retention (daily bonus, win streak, leaderboard, tasks)
-- ----------------------------------------------------------------------------
-- 2.1 Daily login bonus escalates over a 7 day streak (50,75,100,150,200,300,
--     500 gold), then repeats. One claim per UTC day; a missed day resets it.
-- 2.2 Correct-prediction streak: a coupon that wins bumps the streak, a lost
--     coupon resets it (server side, via trigger; cash out is neutral).
-- 2.3 Leaderboard: weekly NET gold from settled coupons (winnings + cash outs
--     minus stakes) since the start of the UTC week. Server-computed so private
--     data is never exposed.
-- 2.4 Daily challenges: place 3 coupons / win a coupon / win a 2+ leg combo.
--     Progress is tracked by trigger; rewards are claimed once complete.
-- Pure ASCII. Idempotent. Gold stays closed + server-authoritative.
-- ============================================================================

alter table public.profiles add column if not exists login_streak int not null default 0;

-- 2.1 escalating daily bonus ------------------------------------------------
create or replace function public.claim_daily_bonus()
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_last timestamptz;
  v_streak int;
  v_bal int;
  v_today date := (now() at time zone 'utc')::date;
  v_rewards int[] := array[50, 75, 100, 150, 200, 300, 500];
  v_day int;
  v_award int;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select last_daily_bonus_at, login_streak, gold_balance into v_last, v_streak, v_bal
    from public.profiles where id = v_uid for update;

  if v_last is not null and (v_last at time zone 'utc')::date >= v_today then
    raise exception 'Daily bonus already claimed today';
  end if;
  if v_last is not null and (v_last at time zone 'utc')::date = v_today - 1 then
    v_streak := v_streak + 1;
  else
    v_streak := 1;
  end if;

  v_day := ((v_streak - 1) % 7) + 1;      -- 1..7 cycling
  v_award := v_rewards[v_day];

  update public.profiles
     set gold_balance = gold_balance + v_award, last_daily_bonus_at = now(), login_streak = v_streak
   where id = v_uid;

  return jsonb_build_object('awarded', v_award, 'streak_day', v_day,
    'login_streak', v_streak, 'new_balance', v_bal + v_award);
end;
$fn$;

-- 2.4 challenge progress ----------------------------------------------------
create table if not exists public.user_challenge_progress (
  user_id       uuid not null references public.profiles (id) on delete cascade,
  day           date not null,
  challenge_key text not null,
  progress      int not null default 0,
  claimed       boolean not null default false,
  primary key (user_id, day, challenge_key)
);
alter table public.user_challenge_progress enable row level security;
drop policy if exists ucp_select_own on public.user_challenge_progress;
create policy ucp_select_own on public.user_challenge_progress
  for select to authenticated using (auth.uid() = user_id);
revoke all on public.user_challenge_progress from anon, authenticated;
grant select on public.user_challenge_progress to authenticated;

create or replace function public._bump_challenge(p_uid uuid, p_key text, p_amt int, p_cap int)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  insert into public.user_challenge_progress (user_id, day, challenge_key, progress)
    values (p_uid, (now() at time zone 'utc')::date, p_key, least(p_amt, p_cap))
  on conflict (user_id, day, challenge_key)
    do update set progress = least(public.user_challenge_progress.progress + p_amt, p_cap);
end;
$fn$;

-- 2.2 + 2.4 trigger: streak + challenge progress on coupon lifecycle --------
create or replace function public._on_coupon_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if TG_OP = 'INSERT' then
    perform public._bump_challenge(NEW.user_id, 'place_3', 1, 3);
  elsif TG_OP = 'UPDATE' and OLD.status = 'pending' and NEW.status in ('won', 'lost') then
    if NEW.status = 'won' then
      update public.profiles
         set current_streak = current_streak + 1,
             best_streak = greatest(best_streak, current_streak + 1)
       where id = NEW.user_id;
      perform public._bump_challenge(NEW.user_id, 'win_any', 1, 1);
      if (select count(*) from public.coupon_selections where coupon_id = NEW.id) >= 2 then
        perform public._bump_challenge(NEW.user_id, 'win_combo', 1, 1);
      end if;
    else
      update public.profiles set current_streak = 0 where id = NEW.user_id;
    end if;
  end if;
  return NEW;
end;
$fn$;

drop trigger if exists on_coupon_change on public.coupons;
create trigger on_coupon_change
  after insert or update on public.coupons
  for each row execute function public._on_coupon_change();

-- today's challenges + progress
create or replace function public.get_challenges()
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'utc')::date;
  v_defs jsonb := jsonb_build_array(
    jsonb_build_object('key', 'place_3', 'label', 'Place 3 coupons', 'target', 3, 'reward', 60),
    jsonb_build_object('key', 'win_any', 'label', 'Win a coupon', 'target', 1, 'reward', 80),
    jsonb_build_object('key', 'win_combo', 'label', 'Win a 2+ leg combo', 'target', 1, 'reward', 150));
  d jsonb;
  v_prog int; v_claimed boolean;
  v_out jsonb := '[]'::jsonb;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  for d in select * from jsonb_array_elements(v_defs) loop
    select progress, claimed into v_prog, v_claimed
      from public.user_challenge_progress
     where user_id = v_uid and day = v_today and challenge_key = d ->> 'key';
    v_out := v_out || jsonb_build_object(
      'key', d ->> 'key', 'label', d ->> 'label',
      'target', (d ->> 'target')::int, 'reward', (d ->> 'reward')::int,
      'progress', coalesce(v_prog, 0), 'claimed', coalesce(v_claimed, false));
  end loop;
  return v_out;
end;
$fn$;

create or replace function public.claim_challenge(p_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'utc')::date;
  v_targets jsonb := jsonb_build_object('place_3', 3, 'win_any', 1, 'win_combo', 1);
  v_rewards jsonb := jsonb_build_object('place_3', 60, 'win_any', 80, 'win_combo', 150);
  v_prog int; v_claimed boolean; v_bal int; v_reward int; v_target int;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not (v_targets ? p_key) then raise exception 'Unknown challenge'; end if;
  v_target := (v_targets ->> p_key)::int;
  v_reward := (v_rewards ->> p_key)::int;

  select progress, claimed into v_prog, v_claimed
    from public.user_challenge_progress
   where user_id = v_uid and day = v_today and challenge_key = p_key for update;
  if coalesce(v_prog, 0) < v_target then raise exception 'Challenge not complete'; end if;
  if coalesce(v_claimed, false) then raise exception 'Already claimed'; end if;

  update public.user_challenge_progress set claimed = true
   where user_id = v_uid and day = v_today and challenge_key = p_key;
  update public.profiles set gold_balance = gold_balance + v_reward where id = v_uid;
  select gold_balance into v_bal from public.profiles where id = v_uid;
  return jsonb_build_object('awarded', v_reward, 'new_balance', v_bal);
end;
$fn$;

-- 2.3 weekly leaderboard ----------------------------------------------------
create index if not exists idx_coupons_settled on public.coupons (settled_at) where settled_at is not null;

create or replace function public.get_leaderboard()
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_week timestamptz := date_trunc('week', now());
  v_rows jsonb;
  v_me jsonb;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  with net as (
    select c.user_id,
           sum((case when c.status = 'won' then c.potential_win
                     when c.status = 'cashed_out' then coalesce(c.cashout_amount, 0)
                     else 0 end) - c.stake) as net
      from public.coupons c
     where c.settled_at >= v_week
     group by c.user_id
  ),
  ranked as (
    select n.user_id, p.username, n.net, rank() over (order by n.net desc) as rnk
      from net n join public.profiles p on p.id = n.user_id
  )
  select
    (select coalesce(jsonb_agg(jsonb_build_object('username', username, 'net', net, 'rank', rnk) order by rnk), '[]'::jsonb)
       from ranked where rnk <= 50),
    (select jsonb_build_object('rank', rnk, 'net', net) from ranked where user_id = v_uid)
  into v_rows, v_me;

  return jsonb_build_object('rows', v_rows, 'me', coalesce(v_me, jsonb_build_object('rank', null, 'net', 0)));
end;
$fn$;

revoke all on function public._bump_challenge(uuid, text, int, int) from public, anon, authenticated;
revoke all on function public.get_challenges() from public, anon;
revoke all on function public.claim_challenge(text) from public, anon;
revoke all on function public.get_leaderboard() from public, anon;
grant execute on function public.get_challenges() to authenticated;
grant execute on function public.claim_challenge(text) to authenticated;
grant execute on function public.get_leaderboard() to authenticated;


-- ============================================================================
-- pickplay.ai - 0021: three leaderboard scopes
-- ----------------------------------------------------------------------------
-- get_leaderboard(scope) with three boards, all server-computed:
--   'day'   King of the Day  - most NET gold from coupons settled today (UTC).
--   'week'  King of the Week - most NET gold this week (resets Monday).
--   'wins'  Most Correct     - most WON coupons all-time; ties broken by fewer
--           played (efficiency). Each row also carries games played. Ranking is
--           by wins, NOT by games played, so a player who loses everything can
--           never sit on top.
-- Pure ASCII. Idempotent. Only usernames + aggregates leave the server.
-- ============================================================================

create index if not exists idx_coupons_user_status2 on public.coupons (user_id, status);

create or replace function public.get_leaderboard(p_scope text default 'week')
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_since timestamptz;
  v_rows jsonb;
  v_me jsonb;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  if p_scope = 'wins' then
    with agg as (
      select user_id,
             count(*) as played,
             count(*) filter (where status = 'won') as won
        from public.coupons
       group by user_id
    ),
    ranked as (
      select a.user_id, p.username, a.won as value, a.played,
             rank() over (order by a.won desc, a.played asc) as rnk
        from agg a
        join public.profiles p on p.id = a.user_id
       where a.won >= 1
    )
    select
      (select coalesce(jsonb_agg(jsonb_build_object('username', username, 'rank', rnk, 'value', value, 'played', played) order by rnk), '[]'::jsonb)
         from ranked where rnk <= 50),
      (select jsonb_build_object('rank', rnk, 'value', value, 'played', played) from ranked where user_id = v_uid)
    into v_rows, v_me;
  else
    v_since := case when p_scope = 'day' then date_trunc('day', now()) else date_trunc('week', now()) end;
    with net as (
      select c.user_id,
             sum((case when c.status = 'won' then c.potential_win
                       when c.status = 'cashed_out' then coalesce(c.cashout_amount, 0)
                       else 0 end) - c.stake) as value
        from public.coupons c
       where c.settled_at >= v_since
       group by c.user_id
    ),
    ranked as (
      select n.user_id, p.username, n.value, rank() over (order by n.value desc) as rnk
        from net n
        join public.profiles p on p.id = n.user_id
    )
    select
      (select coalesce(jsonb_agg(jsonb_build_object('username', username, 'rank', rnk, 'value', value, 'played', null) order by rnk), '[]'::jsonb)
         from ranked where rnk <= 50),
      (select jsonb_build_object('rank', rnk, 'value', value, 'played', null) from ranked where user_id = v_uid)
    into v_rows, v_me;
  end if;

  return jsonb_build_object('scope', p_scope, 'rows', coalesce(v_rows, '[]'::jsonb),
    'me', coalesce(v_me, jsonb_build_object('rank', null, 'value', 0, 'played', null)));
end;
$fn$;

revoke all on function public.get_leaderboard(text) from public, anon;
grant execute on function public.get_leaderboard(text) to authenticated;


-- ============================================================================
-- pickplay.ai - 0022: social layer (leagues, rivals, shared coupons)
-- ----------------------------------------------------------------------------
-- 3.1 Private leagues: create one, share an unguessable invite code, friends
--     join, see a league-only weekly net-gold table.
-- 3.2 Rivals: pin a friend, see a head-to-head comparison (all-time wins,
--     weekly net) plus a 7 day day-by-day record.
-- 3.3 Shared coupons: mark a coupon shared; a community feed shows recent shared
--     coupons (username + content only) and lets others copy them.
-- All server-computed via SECURITY DEFINER RPCs so only usernames + coupon
-- content leave the server (no balances, no private data). Pure ASCII. Idem.
-- ============================================================================

-- 3.1 leagues ---------------------------------------------------------------
create table if not exists public.leagues (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  invite_code text not null unique,
  created_at  timestamptz not null default now()
);
create table if not exists public.league_members (
  league_id uuid not null references public.leagues (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (league_id, user_id)
);
alter table public.leagues enable row level security;
alter table public.league_members enable row level security;
revoke all on public.leagues, public.league_members from anon, authenticated;
-- access is only through the RPCs below (definer), so no direct policies needed.

create or replace function public.create_league(p_name text)
returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_code text := substr(md5(gen_random_uuid()::text), 1, 10);
  v_id uuid;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if length(coalesce(trim(p_name), '')) < 2 then raise exception 'League name too short'; end if;
  insert into public.leagues (name, owner_id, invite_code) values (trim(p_name), v_uid, v_code) returning id into v_id;
  insert into public.league_members (league_id, user_id) values (v_id, v_uid);
  return jsonb_build_object('id', v_id, 'name', trim(p_name), 'invite_code', v_code);
end;
$fn$;

create or replace function public.join_league(p_code text)
returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_l public.leagues;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select * into v_l from public.leagues where invite_code = lower(trim(p_code));
  if not found then raise exception 'No league with that code'; end if;
  insert into public.league_members (league_id, user_id) values (v_l.id, v_uid) on conflict do nothing;
  return jsonb_build_object('id', v_l.id, 'name', v_l.name);
end;
$fn$;

create or replace function public.leave_league(p_league_id uuid)
returns void
language plpgsql security definer set search_path = public
as $fn$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  delete from public.league_members where league_id = p_league_id and user_id = auth.uid();
end;
$fn$;

create or replace function public.get_my_leagues()
returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', l.id, 'name', l.name, 'invite_code', l.invite_code,
      'members', (select count(*) from public.league_members m2 where m2.league_id = l.id),
      'is_owner', (l.owner_id = v_uid)) order by l.created_at)
    from public.leagues l
    join public.league_members m on m.league_id = l.id
    where m.user_id = v_uid), '[]'::jsonb);
end;
$fn$;

create or replace function public.get_league(p_league_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_l public.leagues;
  v_week timestamptz := date_trunc('week', now());
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from public.league_members where league_id = p_league_id and user_id = v_uid) then
    raise exception 'Not a member of this league';
  end if;
  select * into v_l from public.leagues where id = p_league_id;

  return jsonb_build_object(
    'id', v_l.id, 'name', v_l.name, 'invite_code', v_l.invite_code,
    'rows', coalesce((
      with net as (
        select c.user_id, sum((case when c.status='won' then c.potential_win when c.status='cashed_out' then coalesce(c.cashout_amount,0) else 0 end) - c.stake) net
          from public.coupons c
          join public.league_members m on m.user_id = c.user_id and m.league_id = p_league_id
         where c.settled_at >= v_week
         group by c.user_id
      ),
      ranked as (
        select p.username, coalesce(n.net, 0) as value,
               rank() over (order by coalesce(n.net, 0) desc) as rnk
          from public.league_members lm
          join public.profiles p on p.id = lm.user_id
          left join net n on n.user_id = lm.user_id
         where lm.league_id = p_league_id
      )
      select jsonb_agg(jsonb_build_object('username', username, 'value', value, 'rank', rnk) order by rnk)
        from ranked), '[]'::jsonb));
end;
$fn$;

-- 3.2 rivals ----------------------------------------------------------------
create table if not exists public.rivals (
  user_id  uuid not null references public.profiles (id) on delete cascade,
  rival_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, rival_id)
);
alter table public.rivals enable row level security;
revoke all on public.rivals from anon, authenticated;

create or replace function public.add_rival(p_username text)
returns void
language plpgsql security definer set search_path = public
as $fn$
declare v_uid uuid := auth.uid(); v_rid uuid;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select id into v_rid from public.profiles where username = p_username;
  if not found then raise exception 'No player with that username'; end if;
  if v_rid = v_uid then raise exception 'You cannot rival yourself'; end if;
  insert into public.rivals (user_id, rival_id) values (v_uid, v_rid) on conflict do nothing;
end;
$fn$;

create or replace function public.remove_rival(p_username text)
returns void
language plpgsql security definer set search_path = public
as $fn$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  delete from public.rivals where user_id = auth.uid()
    and rival_id = (select id from public.profiles where username = p_username);
end;
$fn$;

-- net per user over a period, used by rival comparison
create or replace function public._net_since(p_uid uuid, p_since timestamptz)
returns int
language sql stable security definer set search_path = public
as $$
  select coalesce(sum((case when status='won' then potential_win when status='cashed_out' then coalesce(cashout_amount,0) else 0 end) - stake), 0)::int
    from public.coupons where user_id = p_uid and settled_at >= p_since;
$$;

create or replace function public.get_rivals()
returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  r record;
  v_out jsonb := '[]'::jsonb;
  v_week timestamptz := date_trunc('week', now());
  v_my_won int; v_their_won int; v_my_net int; v_their_net int;
  v_my_pts int; v_their_pts int;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select count(*) filter (where status='won') into v_my_won from public.coupons where user_id = v_uid;

  for r in select rl.rival_id, p.username from public.rivals rl join public.profiles p on p.id = rl.rival_id where rl.user_id = v_uid loop
    select count(*) filter (where status='won') into v_their_won from public.coupons where user_id = r.rival_id;
    v_my_net := public._net_since(v_uid, v_week);
    v_their_net := public._net_since(r.rival_id, v_week);
    -- 7 day head to head: point per day to whoever had the higher net
    select
      count(*) filter (where mine > theirs), count(*) filter (where theirs > mine)
      into v_my_pts, v_their_pts
      from (
        select d.d,
          coalesce((select sum((case when c.status='won' then c.potential_win when c.status='cashed_out' then coalesce(c.cashout_amount,0) else 0 end)-c.stake) from public.coupons c where c.user_id=v_uid and c.settled_at::date = d.d),0) mine,
          coalesce((select sum((case when c.status='won' then c.potential_win when c.status='cashed_out' then coalesce(c.cashout_amount,0) else 0 end)-c.stake) from public.coupons c where c.user_id=r.rival_id and c.settled_at::date = d.d),0) theirs
        from generate_series((now()::date - 6), now()::date, interval '1 day') d(d)
      ) q;

    v_out := v_out || jsonb_build_object('username', r.username,
      'my_won', v_my_won, 'their_won', v_their_won,
      'my_net', v_my_net, 'their_net', v_their_net,
      'h2h_me', v_my_pts, 'h2h_them', v_their_pts,
      'leader', case when v_my_pts > v_their_pts then 'me' when v_their_pts > v_my_pts then 'them' else 'tie' end);
  end loop;
  return v_out;
end;
$fn$;

-- 3.3 shared coupons --------------------------------------------------------
alter table public.coupons add column if not exists shared_at timestamptz;

create or replace function public.share_coupon(p_coupon_id uuid)
returns void
language plpgsql security definer set search_path = public
as $fn$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  update public.coupons set shared_at = coalesce(shared_at, now())
   where id = p_coupon_id and user_id = auth.uid();
end;
$fn$;

create or replace function public.get_shared_feed()
returns jsonb
language plpgsql security definer set search_path = public
as $fn$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'coupon_id', c.id, 'username', p.username, 'stake', c.stake,
      'total_odds', c.total_odds, 'potential_win', c.potential_win,
      'status', c.status, 'shared_at', c.shared_at,
      'legs', (select coalesce(jsonb_agg(jsonb_build_object(
                 'option_id', cs.market_option_id, 'match_id', m.id, 'odds', cs.odds, 'status', cs.status,
                 'market_name', mk.name, 'option_label', mo.label,
                 'home_team', m.home_team, 'away_team', m.away_team) order by cs.id), '[]'::jsonb)
               from public.coupon_selections cs
               join public.market_options mo on mo.id = cs.market_option_id
               join public.markets mk on mk.id = mo.market_id
               join public.matches m on m.id = mk.match_id
              where cs.coupon_id = c.id))
      order by c.shared_at desc)
    from public.coupons c
    join public.profiles p on p.id = c.user_id
    where c.shared_at is not null
    limit 30), '[]'::jsonb);
end;
$fn$;

revoke all on function public._net_since(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.create_league(text), public.join_league(text), public.leave_league(uuid),
  public.get_my_leagues(), public.get_league(uuid), public.add_rival(text), public.remove_rival(text),
  public.get_rivals(), public.share_coupon(uuid), public.get_shared_feed() to authenticated;


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


-- ============================================================================
-- pickplay.ai - 0024: tuning (share_coupon cache, red-card rate, odds clamp)
-- ----------------------------------------------------------------------------
-- IS 1: share_coupon exists + matches the client (share_coupon(p_coupon_id));
--       force PostgREST to reload its schema cache so the RPC resolves.
-- IS 2: red cards were far too frequent (~50% of matches). Drop to ~10%, still
--       deterministic (decided once at seed) and the red-card ODDS effect is
--       unchanged - only the frequency falls.
-- IS 3: live odds could reach ~14 for a side 0-2 down late, which reads as fake.
--       Clamp every priced odd to [1.05, 15.0] and compress the match-result
--       blend so extreme underdogs land ~9-10, not ~14. Settlement + the single
--       deterministic outcome are UNCHANGED - only the shown/locked live odds.
-- Pure ASCII. Idempotent. Server-authoritative, money stays closed.
-- ============================================================================

-- IS 3a: clamp ceiling 20 -> 15 (floor 1.05 kept; both markets share this).
create or replace function public._price(p double precision, blend double precision, n int)
returns numeric
language sql
immutable
set search_path = public
as $$
  select least(15.0, greatest(1.05,
    round((1.0 / (greatest(p * (1 - blend) + blend / n, 0.001) * 1.06))::numeric, 2)));
$$;

-- IS 3b: match-result live blend 0.20 -> 0.28 (extreme underdog max ~10, not ~14;
-- normal odds barely move). Other markets unchanged. Single source preserved.
create or replace function public._market_odds_ft(p_probs jsonb, p_minute int, p_hs int, p_as int)
returns jsonb
language plpgsql
immutable
set search_path = public
as $fn$
declare
  ph double precision := coalesce((p_probs ->> 'home')::double precision, 0.40);
  pa double precision := coalesce((p_probs ->> 'away')::double precision, 0.30);
  r  double precision := greatest(0.0, (90 - least(p_minute, 90))::double precision / 90.0);
  lh double precision := (0.6 + 1.7 * ph) * r;
  la double precision := (0.6 + 1.7 * pa) * r;
  cap int := 8;
  fh double precision[]; fa double precision[];
  hh int; aa int; fhome int; faway int; tot int;
  pk double precision; s double precision := 0;
  pw double precision := 0; pd double precision := 0; pl double precision := 0;
  o15 double precision := 0; o25 double precision := 0; o35 double precision := 0;
  bt double precision := 0; od double precision := 0;
begin
  for hh in 0 .. cap loop
    fh[hh] := exp(-lh) * power(lh, hh) / factorial(hh)::double precision;
    fa[hh] := exp(-la) * power(la, hh) / factorial(hh)::double precision;
  end loop;
  for hh in 0 .. cap loop
    for aa in 0 .. cap loop
      pk := fh[hh] * fa[aa];
      s := s + pk;
      fhome := p_hs + hh; faway := p_as + aa; tot := fhome + faway;
      if fhome > faway then pw := pw + pk; elsif fhome = faway then pd := pd + pk; else pl := pl + pk; end if;
      if tot > 1 then o15 := o15 + pk; end if;
      if tot > 2 then o25 := o25 + pk; end if;
      if tot > 3 then o35 := o35 + pk; end if;
      if fhome >= 1 and faway >= 1 then bt := bt + pk; end if;
      if (tot % 2) = 1 then od := od + pk; end if;
    end loop;
  end loop;
  if s <= 0 then s := 1; end if;
  pw := pw / s; pd := pd / s; pl := pl / s;
  o15 := o15 / s; o25 := o25 / s; o35 := o35 / s; bt := bt / s; od := od / s;

  return jsonb_build_object(
    'home', public._price(pw, 0.28, 3), 'draw', public._price(pd, 0.28, 3), 'away', public._price(pl, 0.28, 3),
    'dc_1x', public._price(pw + pd, 0, 1), 'dc_12', public._price(pw + pl, 0, 1), 'dc_x2', public._price(pd + pl, 0, 1),
    'ou15_over', public._price(o15, 0.12, 2), 'ou15_under', public._price(1 - o15, 0.12, 2),
    'ou25_over', public._price(o25, 0.12, 2), 'ou25_under', public._price(1 - o25, 0.12, 2),
    'ou35_over', public._price(o35, 0.12, 2), 'ou35_under', public._price(1 - o35, 0.12, 2),
    'btts_yes', public._price(bt, 0.12, 2), 'btts_no', public._price(1 - bt, 0.12, 2),
    'oe_odd', public._price(od, 0.12, 2), 'oe_even', public._price(1 - od, 0.12, 2));
end;
$fn$;

-- IS 2: red-card frequency 0.50 / 0.18 -> 0.09 / 0.02 (about 1-2 in 10 matches).
-- Everything else in the outcome (score, timeline, card odds effect) is identical.
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
  v_cards  jsonb := '[]'::jsonb;
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

  if random() < 0.09 then
    v_cards := v_cards || jsonb_build_object('minute', 25 + floor(random() * 60)::int,
      'team', case when random() < 0.5 then 'home' else 'away' end);
  end if;
  if random() < 0.02 then
    v_cards := v_cards || jsonb_build_object('minute', 30 + floor(random() * 55)::int,
      'team', case when random() < 0.5 then 'home' else 'away' end);
  end if;

  return jsonb_build_object(
    'result', v_result, 'home_score', v_hs, 'away_score', v_as,
    'events', public._make_timeline(v_hs, v_as), 'cards', v_cards);
end;
$fn$;

-- IS 1: reaffirm share_coupon + grant, then reload the PostgREST schema cache.
create or replace function public.share_coupon(p_coupon_id uuid)
returns void
language plpgsql security definer set search_path = public
as $fn$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  update public.coupons set shared_at = coalesce(shared_at, now())
   where id = p_coupon_id and user_id = auth.uid();
end;
$fn$;
revoke all on function public.share_coupon(uuid) from public, anon;
grant execute on function public.share_coupon(uuid) to authenticated;

notify pgrst, 'reload schema';


-- ============================================================================
-- pickplay.ai - 0025: odds realism calibration (display/pricing only)
-- ----------------------------------------------------------------------------
-- Makes the shown/locked odds behave like a real book (Nesine/bet365 feel).
-- Settlement, the single deterministic outcome, no-money -- ALL unchanged; only
-- the priced odds change.
--   * _odds_line(): price a mutually-exclusive market properly -- bound each
--     implied prob to [1/15, 1/1.01], RENORMALISE to a target overround, then
--     convert to odds. So the market margin stays consistent even when a leg is
--     clamped, and no odd is ever absurd (<=15) or silly (>=1.01).
--   * 1X2 / totals / btts / odd-even / first-half markets go through _odds_line
--     (3-outcome margin ~6%, 2-outcome margin ~4%).
--   * Double chance stays priced individually (overlapping bets), floor 1.01.
--   * Compression blend eased 0.28 -> 0.20 so a strong favourite reads ~1.45-1.55
--     and a side 0-2 down at 75' reads ~10 (not ~14), approaching 15 near full
--     time; the renormalise keeps the overround honest.
-- Pure ASCII. Idempotent.
-- ============================================================================

-- individual price (used by double chance): floor 1.01, cap 15
create or replace function public._price(p double precision, blend double precision, n int)
returns numeric
language sql immutable set search_path = public
as $$
  select least(15.0, greatest(1.01,
    round((1.0 / (greatest(p * (1 - blend) + blend / n, 0.001) * 1.06))::numeric, 2)));
$$;

-- price one mutually-exclusive market: clamp implied -> renormalise to overround
-- (1 + margin) -> odds in [1.01, 15]. Keeps the book margin consistent.
create or replace function public._odds_line(p double precision[], margin double precision)
returns numeric[]
language plpgsql immutable set search_path = public
as $fn$
declare
  n int := array_length(p, 1);
  i int; s double precision := 0; si double precision := 0;
  imp double precision[] := '{}'; out numeric[] := '{}';
begin
  for i in 1 .. n loop s := s + greatest(p[i], 0); end loop;
  if s <= 0 then s := 1; end if;
  for i in 1 .. n loop
    imp[i] := least(0.990099, greatest(0.066667, greatest(p[i], 0) / s));   -- bound to [1/15, 1/1.01]
    si := si + imp[i];
  end loop;
  for i in 1 .. n loop
    imp[i] := imp[i] * (1 + margin) / si;                                    -- renormalise to the overround
    out[i] := round(least(15.0, greatest(1.01, (1.0 / imp[i])))::numeric, 2);
  end loop;
  return out;
end;
$fn$;

-- Full-time market odds (single source for match_result live odds).
create or replace function public._market_odds_ft(p_probs jsonb, p_minute int, p_hs int, p_as int)
returns jsonb
language plpgsql immutable set search_path = public
as $fn$
declare
  ph double precision := coalesce((p_probs ->> 'home')::double precision, 0.40);
  pa double precision := coalesce((p_probs ->> 'away')::double precision, 0.30);
  r  double precision := greatest(0.0, (90 - least(p_minute, 90))::double precision / 90.0);
  lh double precision := (0.6 + 1.7 * ph) * r;
  la double precision := (0.6 + 1.7 * pa) * r;
  cap int := 8;
  fh double precision[]; fa double precision[];
  hh int; aa int; fhome int; faway int; tot int;
  pk double precision; s double precision := 0;
  pw double precision := 0; pd double precision := 0; pl double precision := 0;
  o15 double precision := 0; o25 double precision := 0; o35 double precision := 0;
  bt double precision := 0; od double precision := 0;
  -- time-aware 1X2 compression, a hump peaking mid-late game: ~0 pre-match (so a
  -- strong favourite stays sharp ~1.35), ~0.26 around 75' (a 0-2 deficit reads
  -- ~10 not ~14), easing to ~0.15 by 88' so a lost cause drifts to the 15 cap.
  b double precision := 0.28 * exp(- power(r - 0.25, 2) / 0.08);
  b2 double precision := 0.10;                -- 2-outcome compression
  m3 numeric[]; l15 numeric[]; l25 numeric[]; l35 numeric[]; lbt numeric[]; loe numeric[];
begin
  for hh in 0 .. cap loop
    fh[hh] := exp(-lh) * power(lh, hh) / factorial(hh)::double precision;
    fa[hh] := exp(-la) * power(la, hh) / factorial(hh)::double precision;
  end loop;
  for hh in 0 .. cap loop
    for aa in 0 .. cap loop
      pk := fh[hh] * fa[aa]; s := s + pk;
      fhome := p_hs + hh; faway := p_as + aa; tot := fhome + faway;
      if fhome > faway then pw := pw + pk; elsif fhome = faway then pd := pd + pk; else pl := pl + pk; end if;
      if tot > 1 then o15 := o15 + pk; end if;
      if tot > 2 then o25 := o25 + pk; end if;
      if tot > 3 then o35 := o35 + pk; end if;
      if fhome >= 1 and faway >= 1 then bt := bt + pk; end if;
      if (tot % 2) = 1 then od := od + pk; end if;
    end loop;
  end loop;
  if s <= 0 then s := 1; end if;
  pw := pw / s; pd := pd / s; pl := pl / s;
  o15 := o15 / s; o25 := o25 / s; o35 := o35 / s; bt := bt / s; od := od / s;

  m3  := public._odds_line(array[pw*(1-b)+b/3, pd*(1-b)+b/3, pl*(1-b)+b/3], 0.06);
  l15 := public._odds_line(array[o15*(1-b2)+b2/2, (1-o15)*(1-b2)+b2/2], 0.04);
  l25 := public._odds_line(array[o25*(1-b2)+b2/2, (1-o25)*(1-b2)+b2/2], 0.04);
  l35 := public._odds_line(array[o35*(1-b2)+b2/2, (1-o35)*(1-b2)+b2/2], 0.04);
  lbt := public._odds_line(array[bt*(1-b2)+b2/2, (1-bt)*(1-b2)+b2/2], 0.04);
  loe := public._odds_line(array[od*(1-b2)+b2/2, (1-od)*(1-b2)+b2/2], 0.04);

  return jsonb_build_object(
    'home', m3[1], 'draw', m3[2], 'away', m3[3],
    'dc_1x', public._price(pw + pd, 0, 1), 'dc_12', public._price(pw + pl, 0, 1), 'dc_x2', public._price(pd + pl, 0, 1),
    'ou15_over', l15[1], 'ou15_under', l15[2],
    'ou25_over', l25[1], 'ou25_under', l25[2],
    'ou35_over', l35[1], 'ou35_under', l35[2],
    'btts_yes', lbt[1], 'btts_no', lbt[2],
    'oe_odd', loe[1], 'oe_even', loe[2]);
end;
$fn$;

-- First-half markets (pre-match).
create or replace function public._market_odds_ht(p_probs jsonb)
returns jsonb
language plpgsql immutable set search_path = public
as $fn$
declare
  ph double precision := coalesce((p_probs ->> 'home')::double precision, 0.40);
  pa double precision := coalesce((p_probs ->> 'away')::double precision, 0.30);
  lh double precision := (0.6 + 1.7 * ph) * 0.5;
  la double precision := (0.6 + 1.7 * pa) * 0.5;
  cap int := 6;
  fh double precision[]; fa double precision[];
  hh int; aa int; pk double precision; s double precision := 0;
  pw double precision := 0; pd double precision := 0; pl double precision := 0; ov double precision := 0;
  m3 numeric[]; lov numeric[];
begin
  for hh in 0 .. cap loop
    fh[hh] := exp(-lh) * power(lh, hh) / factorial(hh)::double precision;
    fa[hh] := exp(-la) * power(la, hh) / factorial(hh)::double precision;
  end loop;
  for hh in 0 .. cap loop
    for aa in 0 .. cap loop
      pk := fh[hh] * fa[aa]; s := s + pk;
      if hh > aa then pw := pw + pk; elsif hh = aa then pd := pd + pk; else pl := pl + pk; end if;
      if hh + aa > 0 then ov := ov + pk; end if;
    end loop;
  end loop;
  if s <= 0 then s := 1; end if;
  pw := pw / s; pd := pd / s; pl := pl / s; ov := ov / s;
  m3  := public._odds_line(array[pw*0.88+0.04, pd*0.88+0.04, pl*0.88+0.04], 0.06);
  lov := public._odds_line(array[ov*0.9+0.05, (1-ov)*0.9+0.05], 0.04);
  return jsonb_build_object(
    'ht_home', m3[1], 'ht_draw', m3[2], 'ht_away', m3[3],
    'htou05_over', lov[1], 'htou05_under', lov[2]);
end;
$fn$;

revoke all on function public._odds_line(double precision[], double precision) from public, anon, authenticated;

notify pgrst, 'reload schema';


-- ============================================================================
-- pickplay.ai - 0026: public shareable coupon link
-- ----------------------------------------------------------------------------
-- get_shared_coupon(id): returns ONE shared coupon by its (unguessable, random
-- UUIDv4) id for a public preview page -- callable by anon. Exposes only safe
-- fields (username + coupon content); never balance/email/private data, and
-- only when the coupon has actually been shared (shared_at is not null).
-- No new tables (reuses coupons.shared_at from 0022). Pure ASCII. Idempotent.
-- ============================================================================

create or replace function public.get_shared_coupon(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare v_out jsonb;
begin
  select jsonb_build_object(
    'coupon_id', c.id, 'username', p.username, 'stake', c.stake,
    'total_odds', c.total_odds, 'potential_win', c.potential_win,
    'status', c.status, 'shared_at', c.shared_at,
    'legs', (select coalesce(jsonb_agg(jsonb_build_object(
               'option_id', cs.market_option_id, 'match_id', m.id, 'odds', cs.odds, 'status', cs.status,
               'market_name', mk.name, 'option_label', mo.label,
               'home_team', m.home_team, 'away_team', m.away_team) order by cs.id), '[]'::jsonb)
             from public.coupon_selections cs
             join public.market_options mo on mo.id = cs.market_option_id
             join public.markets mk on mk.id = mo.market_id
             join public.matches m on m.id = mk.match_id
            where cs.coupon_id = c.id))
    into v_out
    from public.coupons c
    join public.profiles p on p.id = c.user_id
   where c.id = p_id and c.shared_at is not null;
  return v_out;   -- null if not found / not shared
end;
$fn$;

revoke all on function public.get_shared_coupon(uuid) from public;
grant execute on function public.get_shared_coupon(uuid) to anon, authenticated;

notify pgrst, 'reload schema';


-- ============================================================================
-- pickplay.ai - 0027: match duration 2 x 4 minutes (~8 min total)
-- ----------------------------------------------------------------------------
-- Matches ran in ~100s; too fast to watch/bet. Slow the central clock to 480s
-- (2 x 4 min). Everything keyed on the DERIVED minute (0-90) stays consistent
-- (live odds time-scaling, timeline goal minutes, cash-out window, settlement) --
-- only the wall-clock pace changes. Seeding staggers wider so plenty of matches
-- run in PARALLEL (you never wait 8 min for one). Pure pace change; the
-- deterministic outcome / money-closed model is untouched.
-- ============================================================================

-- new matches default to 8 minutes; bring not-yet-started ones up to the new pace
alter table public.matches alter column duration_secs set default 480;
update public.matches set duration_secs = 480
 where status <> 'finished' and starts_at > now();

create or replace function public.seed_matches(p_target int default 10)
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
  v_hi    int; v_ai int;
  v_h     double precision; v_d double precision; v_a double precision; v_sum double precision;
  v_probs jsonb;
  v_id    uuid;
  i       int;
begin
  p_target := least(greatest(coalesce(p_target, 10), 0), 24);
  select count(*) into v_existing
    from public.matches
   where status <> 'finished'
     and now() < starts_at + make_interval(secs => coalesce(duration_secs, 480));
  v_needed := greatest(0, p_target - v_existing);

  for i in 1 .. v_needed loop
    v_hi := 1 + floor(random() * v_n)::int;
    loop v_ai := 1 + floor(random() * v_n)::int; exit when v_ai <> v_hi; end loop;

    v_h := 0.20 + random() * 0.45; v_d := 0.15 + random() * 0.25; v_a := 0.15 + random() * 0.45;
    v_sum := v_h + v_d + v_a;
    v_h := round((v_h / v_sum)::numeric, 4); v_d := round((v_d / v_sum)::numeric, 4); v_a := round((1 - v_h - v_d)::numeric, 4);
    v_probs := jsonb_build_object('home', v_h, 'draw', v_d, 'away', v_a);

    insert into public.matches
      (sport, home_team, away_team, starts_at, status, true_probabilities, display_odds, secret_outcome, duration_secs)
    values (
      'football', v_teams[v_hi], v_teams[v_ai],
      -- staggered across ~10 min so several are mid-play (live) and several upcoming
      now() + make_interval(secs => -420 + floor(random() * 620)::int),
      'upcoming', v_probs, public._make_display_odds(v_h, v_d, v_a),
      public._make_outcome(v_probs), 480)
    returning id into v_id;

    perform public._ensure_markets(v_id);
  end loop;

  return v_needed;
end;
$fn$;

revoke all on function public.seed_matches(int) from public, anon;
grant execute on function public.seed_matches(int) to authenticated;

notify pgrst, 'reload schema';


-- ============================================================================
-- pickplay.ai - 0028: round-based scheduling + calmer live-odds drift
-- ----------------------------------------------------------------------------
-- 1) Matches now seed in ROUNDS of 3 on a 240s (4 min) grid. With 480s (2x4 min)
--    matches, ~2 rounds are live at once (~6 live), 1 round is "starting", and a
--    few rounds are scheduled ahead -- a continuously flowing, never-empty
--    bulletin. Round times align to the grid so the client can group them under
--    league headers.
-- 2) Calmer odds: the live price now uses the match minute QUANTISED to 6-minute
--    steps, so odds no longer drift on every 2.5s poll (idle flicker). Score and
--    red cards still flow through instantly (they change the inputs), so goals/
--    cards still move the price -- only the time-based micro-drift is slowed.
-- Deterministic outcome / settlement / money-closed all unchanged.
-- ============================================================================

-- calmer drift: quantise the minute used for pricing (events still instant)
create or replace function public._live_odds(p_probs jsonb, p_minute int, p_hs int, p_as int)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select public._market_odds_ft(p_probs, least(90, (floor(p_minute / 6.0) * 6))::int, p_hs, p_as);
$$;

-- round-based seeding: keep 3 matches per 4-minute round, from the round that is
-- finishing through ~5 rounds ahead.
create or replace function public.seed_matches(p_target int default 10)
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_teams text[] := array[
    'Arsenal','Chelsea','Liverpool','Man City','Man United','Tottenham',
    'Newcastle','Aston Villa','Brighton','West Ham','Everton','Leeds',
    'Real Madrid','Barcelona','Atletico','Sevilla','Valencia','Villarreal',
    'Bayern','Dortmund','Leipzig','Leverkusen','Juventus','Inter','Milan',
    'Napoli','Roma','PSG','Marseille','Lyon','Ajax','Porto','Benfica','Celtic'
  ];
  v_n int := array_length(v_teams, 1);
  v_base bigint := (floor(extract(epoch from now()) / 240) * 240)::bigint;
  v_round timestamptz;
  v_off int; v_have int; v_make int; i int; v_total int := 0;
  v_hi int; v_ai int;
  v_h double precision; v_d double precision; v_a double precision; v_sum double precision;
  v_probs jsonb; v_id uuid;
begin
  for v_off in -2 .. 5 loop
    v_round := to_timestamp(v_base + v_off * 240);
    if v_round + make_interval(secs => 480) <= now() then continue; end if;  -- round already over

    select count(*) into v_have from public.matches
     where status <> 'finished'
       and abs(extract(epoch from (starts_at - v_round))) < 5;
    v_make := greatest(0, 3 - v_have);

    for i in 1 .. v_make loop
      v_hi := 1 + floor(random() * v_n)::int;
      loop v_ai := 1 + floor(random() * v_n)::int; exit when v_ai <> v_hi; end loop;
      v_h := 0.20 + random() * 0.45; v_d := 0.15 + random() * 0.25; v_a := 0.15 + random() * 0.45;
      v_sum := v_h + v_d + v_a;
      v_h := round((v_h / v_sum)::numeric, 4); v_d := round((v_d / v_sum)::numeric, 4); v_a := round((1 - v_h - v_d)::numeric, 4);
      v_probs := jsonb_build_object('home', v_h, 'draw', v_d, 'away', v_a);

      insert into public.matches
        (sport, home_team, away_team, starts_at, status, true_probabilities, display_odds, secret_outcome, duration_secs)
      values ('football', v_teams[v_hi], v_teams[v_ai], v_round, 'upcoming',
              v_probs, public._make_display_odds(v_h, v_d, v_a), public._make_outcome(v_probs), 480)
      returning id into v_id;
      perform public._ensure_markets(v_id);
      v_total := v_total + 1;
    end loop;
  end loop;

  return v_total;
end;
$fn$;

revoke all on function public.seed_matches(int) from public, anon;
grant execute on function public.seed_matches(int) to authenticated;

notify pgrst, 'reload schema';


-- ============================================================================
-- pickplay.ai - 0029: closed markets return NULL (no fake odds)
-- ----------------------------------------------------------------------------
-- Once the score already settles a market it must not show a near-certain fake
-- odd (1.01 / 15). The displayed live odds (_live_odds -> get_live_state) now
-- return JSON null for those outcome keys; the client hides the button and shows
-- "Closed". A market closes when:
--   total >= 2  -> over/under 1.5     total >= 3 -> over/under 2.5
--   total >= 4  -> over/under 3.5     both scored -> both-teams-to-score
-- (match result / double chance / odd-even close only at full time, where the
-- whole live_odds map is already null.)
-- place_coupon rejects a bet on such a decided market (market_closed).
-- _cashout_value is unchanged: it prices via _market_odds_ft directly (never
-- null), so cash-out keeps working on legs whose display market has closed.
-- Pricing numbers otherwise identical. Idempotent, pure ASCII.
-- ============================================================================

-- display odds: price via the engine, then null out any market the score decides
create or replace function public._live_odds(p_probs jsonb, p_minute int, p_hs int, p_as int)
returns jsonb
language plpgsql
immutable
set search_path = public
as $fn$
declare v jsonb; tot int := p_hs + p_as;
begin
  v := public._market_odds_ft(p_probs, least(90, (floor(p_minute / 6.0) * 6))::int, p_hs, p_as);
  if tot >= 2 then v := v || jsonb_build_object('ou15_over', null::jsonb, 'ou15_under', null::jsonb); end if;
  if tot >= 3 then v := v || jsonb_build_object('ou25_over', null::jsonb, 'ou25_under', null::jsonb); end if;
  if tot >= 4 then v := v || jsonb_build_object('ou35_over', null::jsonb, 'ou35_under', null::jsonb); end if;
  if p_hs >= 1 and p_as >= 1 then v := v || jsonb_build_object('btts_yes', null::jsonb, 'btts_no', null::jsonb); end if;
  return v;
end;
$fn$;

-- place_coupon: reject a bet on a market the score has already settled
create or replace function public.place_coupon(p_option_ids uuid[], p_stake int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_balance int; v_count int; v_total numeric := 1; v_pot int; v_coupon uuid;
  v_oid uuid; rec record; v_seen uuid[] := '{}'; v_ids uuid[] := '{}'; v_locks numeric[] := '{}';
  v_elapsed double precision; v_dur int; v_minute int; v_hs int; v_as int; v_rh int; v_ra int;
  v_probs jsonb; v_lock numeric; i int; v_tot int;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if p_stake is null or p_stake <= 0 then raise exception 'Stake must be positive'; end if;
  v_count := coalesce(array_length(p_option_ids, 1), 0);
  if v_count < 1 then raise exception 'Add at least one selection'; end if;
  if v_count > 10 then raise exception 'A coupon can hold at most 10 selections'; end if;

  select gold_balance into v_balance from public.profiles where id = v_uid for update;
  if v_balance < p_stake then raise exception 'Not enough gold'; end if;

  foreach v_oid in array p_option_ids loop
    select mo.odds odds, mo.outcome_key outcome_key, mk.market_type market_type, mk.match_id match_id,
           m.starts_at starts_at, m.duration_secs duration_secs, m.status status,
           m.true_probabilities probs, m.secret_outcome secret
      into rec
      from public.market_options mo
      join public.markets mk on mk.id = mo.market_id
      join public.matches m on m.id = mk.match_id
     where mo.id = v_oid for update of mo;
    if not found then raise exception 'Selection not found'; end if;
    if rec.match_id = any(v_seen) then raise exception 'Only one pick per match is allowed on a coupon'; end if;
    v_seen := array_append(v_seen, rec.match_id);

    v_dur := coalesce(rec.duration_secs, 100);
    v_elapsed := extract(epoch from (now() - rec.starts_at));
    if rec.status = 'finished' or v_elapsed >= v_dur then
      raise exception 'market_closed';
    elsif v_elapsed < 0 then
      v_lock := rec.odds;                                  -- pre-match line (any market)
    else
      v_minute := least(90, floor(v_elapsed / v_dur * 90)::int);
      if v_minute >= 85 then raise exception 'market_closed'; end if;
      if rec.market_type in ('ht_result', 'ht_over_under_0_5') then raise exception 'market_closed'; end if;
      select count(*) filter (where e ->> 'team' = 'home'), count(*) filter (where e ->> 'team' = 'away')
        into v_hs, v_as from jsonb_array_elements(rec.secret -> 'events') e where (e ->> 'minute')::int <= v_minute;
      select count(*) filter (where c ->> 'team' = 'home'), count(*) filter (where c ->> 'team' = 'away')
        into v_rh, v_ra from jsonb_array_elements(coalesce(rec.secret -> 'cards', '[]'::jsonb)) c where (c ->> 'minute')::int <= v_minute;
      v_tot := coalesce(v_hs, 0) + coalesce(v_as, 0);
      -- a market the score has already settled is closed
      if (rec.market_type = 'over_under_1_5' and v_tot >= 2)
        or (rec.market_type = 'over_under_2_5' and v_tot >= 3)
        or (rec.market_type = 'over_under_3_5' and v_tot >= 4)
        or (rec.market_type = 'both_teams_score' and coalesce(v_hs, 0) >= 1 and coalesce(v_as, 0) >= 1)
      then raise exception 'market_closed'; end if;
      v_probs := jsonb_build_object(
        'home', (rec.probs ->> 'home')::double precision * power(0.72, coalesce(v_rh, 0)),
        'away', (rec.probs ->> 'away')::double precision * power(0.72, coalesce(v_ra, 0)));
      v_lock := (public._market_odds_ft(v_probs, v_minute, coalesce(v_hs, 0), coalesce(v_as, 0)) ->> rec.outcome_key)::numeric;
    end if;

    v_ids := array_append(v_ids, v_oid);
    v_locks := array_append(v_locks, v_lock);
    v_total := v_total * v_lock;
  end loop;

  v_total := round(v_total, 2);
  v_pot := round(p_stake * v_total)::int;
  insert into public.coupons (user_id, stake, total_odds, potential_win, status)
    values (v_uid, p_stake, v_total, v_pot, 'pending') returning id into v_coupon;
  for i in 1 .. array_length(v_ids, 1) loop
    insert into public.coupon_selections (coupon_id, market_option_id, odds) values (v_coupon, v_ids[i], v_locks[i]);
  end loop;
  update public.profiles set gold_balance = gold_balance - p_stake where id = v_uid;

  return jsonb_build_object('coupon_id', v_coupon, 'total_odds', v_total, 'potential_win', v_pot, 'new_balance', v_balance - p_stake);
end;
$fn$;

revoke all on function public.place_coupon(uuid[], int) from public, anon;
grant execute on function public.place_coupon(uuid[], int) to authenticated;

notify pgrst, 'reload schema';


