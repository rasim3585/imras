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
