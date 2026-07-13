-- Sanal BASKETBOL — Faz BB-4a2: gerçekçi ligler. vteams'e league kolonu; mevcut
-- 30 takım NBA; EuroLeague takımları eklendi. Maçlar AYNI lig içinde kurulur
-- (gerçekçi). Bülten takımın ligini yayar. Takım isimleri gerçek (telif değil);
-- crest'ler isimden üretilen özgün art (gerçek logo DEĞİL).
-- Basketbol kulüpleri futbolla aynı adı paylaşabilir (Real Madrid, Barcelona,
-- Bayern — farklı spor, farklı satır). name UNIQUE kısıtı işlevsel kullanılmıyor
-- (takımlar id ile seçilir) → kaldır.
alter table public.vteams drop constraint if exists vteams_name_key;
alter table public.vteams add column if not exists league text;
update public.vteams set league = 'NBA' where sport = 'basketball' and id between 101 and 130;

insert into public.vteams (id, name, short_name, attack, defense, attack_base, defense_base, sport, league) values
  (131,'Real Madrid','RMB',1.06,0.95,1.06,0.95,'basketball','EuroLeague'),
  (132,'FC Barcelona','BAR',1.04,0.96,1.04,0.96,'basketball','EuroLeague'),
  (133,'Anadolu Efes','EFS',1.03,0.97,1.03,0.97,'basketball','EuroLeague'),
  (134,'Fenerbahçe Beko','FBB',1.04,0.96,1.04,0.96,'basketball','EuroLeague'),
  (135,'Olympiacos','OLY',1.02,0.94,1.02,0.94,'basketball','EuroLeague'),
  (136,'Panathinaikos','PAO',1.03,0.97,1.03,0.97,'basketball','EuroLeague'),
  (137,'AS Monaco','MON',1.03,0.98,1.03,0.98,'basketball','EuroLeague'),
  (138,'LDLC ASVEL','ASV',1.00,1.00,1.00,1.00,'basketball','EuroLeague'),
  (139,'Zalgiris Kaunas','ZAL',1.01,0.99,1.01,0.99,'basketball','EuroLeague'),
  (140,'Maccabi Tel Aviv','MAC',1.02,1.00,1.02,1.00,'basketball','EuroLeague'),
  (141,'Partizan','PAR',1.02,0.99,1.02,0.99,'basketball','EuroLeague'),
  (142,'Crvena Zvezda','CZV',1.00,0.98,1.00,0.98,'basketball','EuroLeague'),
  (143,'Virtus Bologna','VIR',1.01,0.98,1.01,0.98,'basketball','EuroLeague'),
  (144,'EA7 Milano','MIL',1.00,0.99,1.00,0.99,'basketball','EuroLeague'),
  (145,'Bayern Munich','BAY',1.01,1.00,1.01,1.00,'basketball','EuroLeague'),
  (146,'ALBA Berlin','ALB',0.99,1.02,0.99,1.02,'basketball','EuroLeague')
on conflict (id) do nothing;

-- Üretici: iki takım AYNI ligden.
create or replace function public._bb_seed(p_target int default 3)
returns int language plpgsql security definer set search_path to 'public' as $$
declare
  BASE constant double precision := 108.0;
  HOME_ADV constant double precision := 1.025;
  v_base bigint := (floor(extract(epoch from now())/240)*240)::bigint;
  v_round timestamptz; v_off int; v_have int; v_make int; i int; v_total int := 0;
  v_busy smallint[]; v_hid smallint; v_aid smallint; v_home text; v_away text; v_league text;
  v_oh double precision; v_dh double precision; v_oa double precision; v_da double precision;
  v_lh double precision; v_la double precision; b jsonb; v_id uuid;
begin
  for v_off in -2 .. 5 loop
    v_round := to_timestamp(v_base + v_off*240);
    if v_round + make_interval(secs => 480) <= now() then continue; end if;
    select count(*) into v_have from public.matches
      where sport='basketball' and status <> 'finished'
        and abs(extract(epoch from (starts_at - v_round))) < 5;
    v_make := greatest(0, 3 - v_have);
    for i in 1 .. v_make loop
      select coalesce(array_agg(distinct t), '{}') into v_busy from (
        select home_team_id t from public.matches where sport='basketball' and status<>'finished' and home_team_id is not null and abs(extract(epoch from (starts_at - v_round))) < 480
        union
        select away_team_id  from public.matches where sport='basketball' and status<>'finished' and away_team_id is not null and abs(extract(epoch from (starts_at - v_round))) < 480
      ) x;
      select id,name,attack,defense,league into v_hid,v_home,v_oh,v_dh,v_league
        from public.vteams where sport='basketball' and id <> all(v_busy) order by random() limit 1;
      select id,name,attack,defense into v_aid,v_away,v_oa,v_da
        from public.vteams where sport='basketball' and league = v_league and id <> all(v_busy) and id <> v_hid order by random() limit 1;
      if v_hid is null or v_aid is null then exit; end if;
      v_lh := BASE*v_oh*v_da*HOME_ADV;
      v_la := BASE*v_oa*v_dh;
      b := public._bb_game_odds(v_lh, v_la, 0, 0, 0);
      insert into public.matches
        (sport, home_team, away_team, home_team_id, away_team_id, starts_at, status,
         lambda_home, lambda_away, true_probabilities, display_odds, secret_outcome, duration_secs)
      values
        ('basketball', v_home, v_away, v_hid, v_aid, v_round, 'upcoming',
         v_lh, v_la,
         jsonb_build_object('home', 1.0/(b->>'ml_home')::double precision, 'away', 1.0/(b->>'ml_away')::double precision),
         jsonb_build_object('home', b->'ml_home', 'away', b->'ml_away'),
         public._bb_make_outcome(v_lh, v_la), 480)
      returning id into v_id;
      perform public._bb_ensure_markets(v_id);
      v_total := v_total + 1;
    end loop;
  end loop;
  return v_total;
end; $$;

-- Bülten: basketball_rows takımın ligini yayar.
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