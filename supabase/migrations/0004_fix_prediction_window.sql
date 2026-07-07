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
