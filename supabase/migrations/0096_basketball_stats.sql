-- Sanal BASKETBOL — Faz BB-3c: istatistik/standings spor-dallı.
-- Yan fayda: vleague_standings()'in sport filtresi yoktu → basketbol takımları
-- eklenince futbol tablosuna sızıyordu (gizli kirlilik). 0-arg sürüm artık
-- futbolla sınırlı; genel kullanım için 1-arg (p_sport) overload eklendi.
-- Basketbolda beraberlik yok (drawn=0); gf/ga = attığı/yediği SAYI; points =
-- galibiyet*3 sadece sıralama anahtarı (frontend W-L gösterir).
-- NOT: 1-arg önce tanımlanmalı (0-arg onu çağırıyor, SQL gövdesi anında doğrulanır).

create or replace function public.vleague_standings(p_sport text)
 returns table(rank integer, team_id smallint, name text, short_name text, played integer, won integer, drawn integer, lost integer, gf integer, ga integer, gd integer, points integer)
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
    select t.id as team_id, t.name, t.short_name,
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
    group by t.id, t.name, t.short_name
  )
  select (row_number() over (order by points desc, gd desc, gf desc, name))::int as rank,
         team_id, name, short_name, played::int, won::int, drawn::int, lost::int,
         gf::int, ga::int, gd::int, points::int
  from agg order by rank;
$function$;

create or replace function public.vleague_standings()
 returns table(rank integer, team_id smallint, name text, short_name text, played integer, won integer, drawn integer, lost integer, gf integer, ga integer, gd integer, points integer)
 language sql stable security definer set search_path to 'public'
as $function$
  select * from public.vleague_standings('football');
$function$;

grant execute on function public.vleague_standings(text) to anon, authenticated;

create or replace function public.vmatch_stats(p_match_id uuid)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_h smallint; v_a smallint; v_sport text; v_home jsonb; v_away jsonb; v_h2h jsonb;
begin
  select home_team_id, away_team_id, sport into v_h, v_a, v_sport
    from public.matches where id = p_match_id;
  if v_h is null or v_a is null then return null; end if;

  select to_jsonb(s) || jsonb_build_object('form', public._vteam_form(v_h)) into v_home
    from public.vleague_standings(v_sport) s where s.team_id = v_h;
  select to_jsonb(s) || jsonb_build_object('form', public._vteam_form(v_a)) into v_away
    from public.vleague_standings(v_sport) s where s.team_id = v_a;

  select coalesce(jsonb_agg(x order by x_at desc), '[]'::jsonb) into v_h2h
  from (
    select starts_at as x_at,
           jsonb_build_object('starts_at', starts_at, 'home_team', home_team, 'away_team', away_team,
             'home_score', home_score, 'away_score', away_score) as x
    from public.matches
    where status = 'finished'
      and ((home_team_id = v_h and away_team_id = v_a) or (home_team_id = v_a and away_team_id = v_h))
    order by starts_at desc limit 6
  ) q;

  return jsonb_build_object('home', v_home, 'away', v_away, 'h2h', v_h2h, 'sport', v_sport);
end;
$function$;