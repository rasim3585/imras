-- ACİL REGRESYON DÜZELTMESİ: get_bulletin, 0095/0097 yeniden yazımında SECURITY
-- DEFINER'ı KAYBETTİ. Orijinali definer'dı (anon 'matches' tablosunu okuyamaz,
-- definer baypas ediyordu). Invoker olunca anon → 'permission denied for table
-- matches' → TÜM feed (futbol dahil) boş kaldı. Kanıt: `set local role anon` ile
-- get_bulletin hata veriyordu (service_role ile dolu görünüyordu — CLAUDE.md RLS
-- dersi). Definer'ı geri koy; basketbol yardımcılarını da futbol muadilleri
-- (_virtual_match_state/_virtual_match_markets) gibi definer yap.
alter function public._bb_state(uuid) security definer;
alter function public._bb_match_markets(uuid) security definer;

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
    where p_include_virtual and m.sport = 'football' and m.status = 'upcoming' and st.phase <> 'finished'
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
    where p_include_virtual and m.sport = 'basketball' and m.status = 'upcoming' and (s.bs->>'phase') <> 'finished'
  ),
  merged as (
    select sort_at, row from real_rows
    union all select sort_at, row from virtual_rows
    union all select sort_at, row from basketball_rows
  )
  select row from merged
  where jsonb_array_length(row -> 'markets') > 0
  order by sort_at, row ->> 'home_team'
  limit greatest(p_limit, 1);
$function$;