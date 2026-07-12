-- 0083_virtual_league_stats.sql
-- Sanal futbol: kalıcı lig — Faz 3b (istatistik veri katmanı).
--
-- Standings / form / H2H: biten (finished) + takım-id'li maçlardan hesaplanır.
-- Ayrı tablo YOK → matches geçmişi tek gerçek kaynak, senkron derdi yok.
-- Hepsi SECURITY DEFINER (vteams RLS'ini aşar) ama reyting (attack/defense)
-- ASLA dışarı verilmez → yalnızca skor/sonuç bazlı kamuya-açık istatistik.
--
-- NOT: eski rastgele-güçlü maçlar (home_team_id null) hariç → lig temiz başlar.

-- Takımın son N maçının form dizisi (en yeni önce): ["W","D","L",...]
create or replace function public._vteam_form(p_team smallint, p_n int default 5)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(res order by starts_at desc), '[]'::jsonb)
  from (
    select starts_at,
           case
             when (home_team_id = p_team and home_score > away_score)
               or (away_team_id = p_team and away_score > home_score) then 'W'
             when home_score = away_score then 'D'
             else 'L'
           end as res
    from public.matches
    where status = 'finished'
      and (home_team_id = p_team or away_team_id = p_team)
    order by starts_at desc
    limit p_n
  ) t;
$function$;

-- Lig puan tablosu (sıralı): rank, O/G/B/M/A:Y/AV/P — 34 takım (oynamamışlar 0).
create or replace function public.vleague_standings()
returns table(rank int, team_id smallint, name text, short_name text,
              played int, won int, drawn int, lost int,
              gf int, ga int, gd int, points int)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with tm as (
    select home_team_id as team_id, home_score as gf, away_score as ga,
           sign(home_score - away_score) as s
    from public.matches
    where status = 'finished' and home_team_id is not null and away_team_id is not null
    union all
    select away_team_id, away_score, home_score, sign(away_score - home_score)
    from public.matches
    where status = 'finished' and home_team_id is not null and away_team_id is not null
  ),
  agg as (
    select t.id as team_id, t.name, t.short_name,
           count(tm.team_id) as played,
           count(*) filter (where tm.s > 0) as won,
           count(*) filter (where tm.s = 0) as drawn,
           count(*) filter (where tm.s < 0) as lost,
           coalesce(sum(tm.gf), 0) as gf,
           coalesce(sum(tm.ga), 0) as ga,
           coalesce(sum(tm.gf), 0) - coalesce(sum(tm.ga), 0) as gd,
           count(*) filter (where tm.s > 0) * 3 + count(*) filter (where tm.s = 0) as points
    from public.vteams t
    left join tm on tm.team_id = t.id
    group by t.id, t.name, t.short_name
  )
  select (row_number() over (order by points desc, gd desc, gf desc, name))::int as rank,
         team_id, name, short_name,
         played::int, won::int, drawn::int, lost::int,
         gf::int, ga::int, gd::int, points::int
  from agg
  order by rank;
$function$;

-- Bir maç için istatistik demeti: iki takımın sıralama satırı + form + aralarındaki H2H.
-- Takım-id yoksa (eski maç) null döner → UI "istatistik yok" gösterir.
create or replace function public.vmatch_stats(p_match_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_h smallint; v_a smallint;
  v_home jsonb; v_away jsonb; v_h2h jsonb;
begin
  select home_team_id, away_team_id into v_h, v_a
    from public.matches where id = p_match_id;
  if v_h is null or v_a is null then
    return null;
  end if;

  select to_jsonb(s) || jsonb_build_object('form', public._vteam_form(v_h))
    into v_home from public.vleague_standings() s where s.team_id = v_h;
  select to_jsonb(s) || jsonb_build_object('form', public._vteam_form(v_a))
    into v_away from public.vleague_standings() s where s.team_id = v_a;

  select coalesce(jsonb_agg(x order by x_at desc), '[]'::jsonb) into v_h2h
  from (
    select starts_at as x_at,
           jsonb_build_object(
             'starts_at', starts_at, 'home_team', home_team, 'away_team', away_team,
             'home_score', home_score, 'away_score', away_score) as x
    from public.matches
    where status = 'finished'
      and ((home_team_id = v_h and away_team_id = v_a)
        or (home_team_id = v_a and away_team_id = v_h))
    order by starts_at desc
    limit 6
  ) q;

  return jsonb_build_object('home', v_home, 'away', v_away, 'h2h', v_h2h);
end;
$function$;

grant execute on function public.vleague_standings() to anon, authenticated;
grant execute on function public.vmatch_stats(uuid) to anon, authenticated;
