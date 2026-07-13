-- Sanal TENİS — dispatch + CANLIYA ALMA. Futbol/basketbol BİREBİR korunur; sport
-- ='tennis' için _tn_* yoluna sapılır. get_bulletin / get_live_state SECURITY
-- DEFINER kalır (0101 dersi). _tick artık tenis de seed eder (+_tn_seed).
create or replace function public._finalize_match(p_match_id uuid)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_match public.matches; v_out jsonb; v_sport text;
begin
  v_sport := (select sport from public.matches where id = p_match_id);
  if v_sport = 'basketball' then perform public._bb_finalize(p_match_id); return; end if;
  if v_sport = 'tennis'     then perform public._tn_finalize(p_match_id); return; end if;

  select * into v_match from public.matches where id = p_match_id for update;
  if not found or v_match.status = 'finished' then return; end if;
  if now() < v_match.starts_at + make_interval(secs => coalesce(v_match.duration_secs, 100)) then return; end if;
  v_out := public._ensure_outcome(p_match_id);
  update public.matches set status='finished', result=v_out->>'result',
    home_score=(v_out->>'home_score')::int, away_score=(v_out->>'away_score')::int, timeline=v_out->'events'
  where id = p_match_id;
  perform public._score_match(p_match_id);
  perform public._settle_markets(p_match_id);
  perform public._vupdate_ratings(p_match_id);
end;
$function$;

create or replace function public.get_bulletin(p_include_virtual boolean default true, p_include_real boolean default true, p_limit integer default 60)
 returns setof jsonb language sql stable security definer set search_path to 'public'
as $function$
  with real_rows as (
    select f.kickoff_at as sort_at,
      jsonb_build_object(
        'kind','real','sport','football','id',f.id,'home_team',f.home_team,'away_team',f.away_team,
        'starts_at',f.kickoff_at,'status',f.status,'home_score',f.home_score,'away_score',f.away_score,
        'minute',f.current_minute,'period',f.period,'league',bl.name,'country',bl.country,
        'is_derby',coalesce(f.is_local_derby,false),'markets',public._real_fixture_markets(f.id)) as row
    from public.real_fixtures f
    left join public.bsd_leagues bl on bl.league_id = f.league_id
    where p_include_real and f.status in ('notstarted','inprogress')
      and (f.prematch_odds is not null or f.lambda_home is not null)
  ),
  virtual_rows as (
    select m.starts_at as sort_at,
      jsonb_build_object(
        'kind','virtual','sport','football','id',m.id,'home_team',m.home_team,'away_team',m.away_team,
        'starts_at',m.starts_at,'status',st.phase,'home_score',st.home_score,'away_score',st.away_score,
        'minute',case when st.phase='live' then st.minute end,'period',null,'league',null,'country',null,
        'is_derby',false,'markets',public._virtual_match_markets(m.id)) as row
    from public.matches m
    cross join lateral public._virtual_match_state(m.id) st
    where p_include_virtual and m.sport='football' and m.status='upcoming' and st.phase <> 'finished'
  ),
  basketball_rows as (
    select m.starts_at as sort_at,
      jsonb_build_object(
        'kind','virtual','sport','basketball','id',m.id,'home_team',m.home_team,'away_team',m.away_team,
        'starts_at',m.starts_at,'status',s.bs->>'phase',
        'home_score',(s.bs->>'home_score')::int,'away_score',(s.bs->>'away_score')::int,
        'minute',case when s.bs->>'phase'='live' then (s.bs->>'minute')::int end,
        'period',case when s.bs->>'phase'='live' then 'Q'||(s.bs->>'quarter') end,
        'league', vt.league,'country',null,'is_derby',false,'markets',public._bb_match_markets(m.id)) as row
    from public.matches m
    join public.vteams vt on vt.id = m.home_team_id
    cross join lateral (select public._bb_state(m.id) as bs) s
    where p_include_virtual and m.sport='basketball' and m.status='upcoming' and (s.bs->>'phase') <> 'finished'
  ),
  tennis_rows as (
    select m.starts_at as sort_at,
      jsonb_build_object(
        'kind','virtual','sport','tennis','id',m.id,'home_team',m.home_team,'away_team',m.away_team,
        'starts_at',m.starts_at,'status',s.ts->>'phase',
        'home_score',(s.ts->>'home_score')::int,'away_score',(s.ts->>'away_score')::int,
        'minute',case when s.ts->>'phase'='live' then (s.ts->>'minute')::int end,
        'period', s.ts->>'period','league', vt.league,'country',null,'is_derby',false,
        'markets',public._tn_match_markets(m.id)) as row
    from public.matches m
    join public.vteams vt on vt.id = m.home_team_id
    cross join lateral (select public._tn_state(m.id) as ts) s
    where p_include_virtual and m.sport='tennis' and m.status='upcoming' and (s.ts->>'phase') <> 'finished'
  ),
  merged as (
    select sort_at, row from real_rows
    union all select sort_at, row from virtual_rows
    union all select sort_at, row from basketball_rows
    union all select sort_at, row from tennis_rows
  )
  select row from merged
  where jsonb_array_length(row -> 'markets') > 0
  order by sort_at, row ->> 'home_team'
  limit greatest(p_limit, 1);
$function$;

create or replace function public.get_live_state(p_match_ids uuid[])
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_now timestamptz := now(); v_out jsonb := '[]'::jsonb; r record; m record;
  v_elapsed double precision; v_dur int; v_minute int; v_phase text;
  v_events jsonb; v_cards jsonb; v_hs int; v_as int; v_rh int; v_ra int;
  v_probs jsonb; v_odds jsonb; bs jsonb;
begin
  for r in select id from public.matches where id = any(p_match_ids) and status <> 'finished'
       and v_now >= starts_at + make_interval(secs => coalesce(duration_secs, 100)) loop
    perform public._finalize_match(r.id);
  end loop;

  for m in select * from public.matches where id = any(p_match_ids) loop
    v_dur := coalesce(m.duration_secs, 100);
    v_elapsed := extract(epoch from (v_now - m.starts_at));

    if m.sport in ('basketball','tennis') then
      bs := case when m.sport='basketball' then public._bb_state(m.id) else public._tn_state(m.id) end;
      v_out := v_out || jsonb_build_object(
        'match_id',m.id,'home_team',m.home_team,'away_team',m.away_team,
        'phase',bs->>'phase','minute',coalesce((bs->>'minute')::int,0),
        'starts_in',greatest(0,ceil(-v_elapsed))::int,'duration_secs',v_dur,
        'home_score',coalesce((bs->>'home_score')::int,0),'away_score',coalesce((bs->>'away_score')::int,0),
        'events','[]'::jsonb,'cards','[]'::jsonb,'red_home',0,'red_away',0,
        'period', case when m.sport='basketball' and bs->>'phase'='live' then 'Q'||(bs->>'quarter') else bs->>'period' end,
        'live_odds',bs->'live_odds',
        'result',case when bs->>'phase'='finished' then coalesce(m.secret_outcome->>'result',m.result) end);
      continue;
    end if;

    if m.status = 'finished' or v_elapsed >= v_dur then v_phase := 'finished'; v_minute := 90;
    elsif v_elapsed < 0 then v_phase := 'upcoming'; v_minute := 0;
    else v_phase := 'live'; v_minute := least(90, greatest(0, floor(v_elapsed / v_dur * 90)::int)); end if;

    if m.secret_outcome is not null and v_phase <> 'upcoming' then
      select coalesce(jsonb_agg(e order by (e ->> 'minute')::int), '[]'::jsonb) into v_events
        from jsonb_array_elements(m.secret_outcome -> 'events') e where (e ->> 'minute')::int <= v_minute;
      select coalesce(jsonb_agg(c order by (c ->> 'minute')::int), '[]'::jsonb),
             count(*) filter (where c ->> 'team' = 'home'), count(*) filter (where c ->> 'team' = 'away')
        into v_cards, v_rh, v_ra
        from jsonb_array_elements(coalesce(m.secret_outcome -> 'cards', '[]'::jsonb)) c where (c ->> 'minute')::int <= v_minute;
    else v_events := '[]'::jsonb; v_cards := '[]'::jsonb; v_rh := 0; v_ra := 0; end if;

    select count(*) filter (where e ->> 'team' = 'home'), count(*) filter (where e ->> 'team' = 'away')
      into v_hs, v_as from jsonb_array_elements(v_events) e;

    if v_phase = 'live' then
      v_probs := jsonb_build_object(
        'home', (m.true_probabilities ->> 'home')::double precision * power(0.72, coalesce(v_rh, 0)),
        'away', (m.true_probabilities ->> 'away')::double precision * power(0.72, coalesce(v_ra, 0)));
      v_odds := public._live_odds(v_probs, v_minute, coalesce(v_hs, 0), coalesce(v_as, 0));
    elsif v_phase = 'upcoming' then v_odds := m.display_odds; else v_odds := null; end if;

    v_out := v_out || jsonb_build_object(
      'match_id', m.id, 'home_team', m.home_team, 'away_team', m.away_team,
      'phase', v_phase, 'minute', v_minute, 'starts_in', greatest(0, ceil(-v_elapsed))::int, 'duration_secs', v_dur,
      'home_score', coalesce(v_hs, 0), 'away_score', coalesce(v_as, 0),
      'events', v_events, 'cards', coalesce(v_cards, '[]'::jsonb),
      'red_home', coalesce(v_rh, 0), 'red_away', coalesce(v_ra, 0), 'live_odds', v_odds,
      'result', case when v_phase = 'finished' then coalesce(m.secret_outcome ->> 'result', m.result) end);
  end loop;
  return v_out;
end;
$function$;

create or replace function public._tick()
 returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare v_seeded int; v_finalized int; v_settled int;
begin
  v_seeded    := public.seed_matches(3) + public._bb_seed(3) + public._tn_seed(3);
  v_finalized := public.finalize_due_matches();
  v_settled   := public._settle_ready_coupons();
  return jsonb_build_object('seeded', v_seeded, 'finalized', v_finalized, 'settled', v_settled, 'at', now());
end;
$function$;

-- İlk populasyon
select public._tn_seed(3);
