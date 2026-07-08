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
