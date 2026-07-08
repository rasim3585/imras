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
