-- Sanal BASKETBOL — Faz BB-3b: dispatch. Futbol davranışı BİREBİR korunur;
-- sadece sport='basketball' için basketbol yoluna sapılır.
-- NOT: _bb_seed henüz _tick'e bağlanmadı (frontend BB-4 hazır olunca açılacak);
-- yani şu an canlıda basketbol maçı üretilmiyor, bu değişiklikler zararsız.

-- finalize_due_matches tüm sporları buraya yolluyor → basketbolu kendi zincirine sap.
create or replace function public._finalize_match(p_match_id uuid)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_match public.matches;
  v_out   jsonb;
begin
  if (select sport from public.matches where id = p_match_id) = 'basketball' then
    perform public._bb_finalize(p_match_id);
    return;
  end if;

  select * into v_match from public.matches where id = p_match_id for update;
  if not found or v_match.status = 'finished' then return; end if;
  if now() < v_match.starts_at + make_interval(secs => coalesce(v_match.duration_secs, 100)) then
    return;
  end if;

  v_out := public._ensure_outcome(p_match_id);

  update public.matches
     set status = 'finished',
         result = v_out ->> 'result',
         home_score = (v_out ->> 'home_score')::int,
         away_score = (v_out ->> 'away_score')::int,
         timeline = v_out -> 'events'
   where id = p_match_id;

  perform public._score_match(p_match_id);
  perform public._settle_markets(p_match_id);
  perform public._vupdate_ratings(p_match_id);
end;
$function$;

-- Bülten: real + virtual(futbol) + basketball. Her satıra 'sport' eklendi.
-- Futbol virtual_rows davranışı aynen; sadece m.sport='football' ile sınırlandı
-- (mevcut veride hepsi futbol → no-op) ve basketball_rows eklendi.
create or replace function public.get_bulletin(p_include_virtual boolean default true, p_include_real boolean default true, p_limit integer default 60)
 returns setof jsonb language sql stable set search_path to 'public'
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
        'league','Simulated','country',null,'is_derby',false,'markets',public._bb_match_markets(m.id)) as row
    from public.matches m
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