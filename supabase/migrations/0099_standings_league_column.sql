-- Lig tablosu sayfası için standings çıktısına league ekle (basketbolu NBA /
-- EuroLeague olarak ayırabilmek için). Return type değiştiği için DROP+CREATE.
-- 0-arg 1-arg'ı çağırdığından önce 0-arg drop edilir. Rank artık lig içinde
-- (partition by league) hesaplanır.
drop function if exists public.vleague_standings();
drop function if exists public.vleague_standings(text);

create or replace function public.vleague_standings(p_sport text)
 returns table(rank integer, team_id smallint, name text, short_name text, league text, played integer, won integer, drawn integer, lost integer, gf integer, ga integer, gd integer, points integer)
 language sql stable security definer set search_path to 'public'
as $function$
  with tm as (
    select home_team_id as team_id, home_score as gf, away_score as ga, sign(home_score - away_score) as s
    from public.matches where status='finished' and home_team_id is not null and away_team_id is not null
    union all
    select away_team_id, away_score, home_score, sign(away_score - home_score)
    from public.matches where status='finished' and home_team_id is not null and away_team_id is not null
  ),
  agg as (
    select t.id as team_id, t.name, t.short_name, t.league,
      count(tm.team_id) as played,
      count(*) filter (where tm.s > 0) as won,
      count(*) filter (where tm.s = 0) as drawn,
      count(*) filter (where tm.s < 0) as lost,
      coalesce(sum(tm.gf),0) as gf, coalesce(sum(tm.ga),0) as ga,
      coalesce(sum(tm.gf),0) - coalesce(sum(tm.ga),0) as gd,
      count(*) filter (where tm.s > 0) * 3 + count(*) filter (where tm.s = 0) as points
    from public.vteams t
    left join tm on tm.team_id = t.id
    where t.sport = p_sport
    group by t.id, t.name, t.short_name, t.league
  )
  select (row_number() over (partition by league order by points desc, gd desc, gf desc, name))::int as rank,
         team_id, name, short_name, league,
         played::int, won::int, drawn::int, lost::int, gf::int, ga::int, gd::int, points::int
  from agg order by league nulls first, rank;
$function$;

create or replace function public.vleague_standings()
 returns table(rank integer, team_id smallint, name text, short_name text, league text, played integer, won integer, drawn integer, lost integer, gf integer, ga integer, gd integer, points integer)
 language sql stable security definer set search_path to 'public'
as $function$ select * from public.vleague_standings('football'); $function$;

grant execute on function public.vleague_standings() to anon, authenticated;
grant execute on function public.vleague_standings(text) to anon, authenticated;