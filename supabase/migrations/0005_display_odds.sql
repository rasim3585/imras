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
