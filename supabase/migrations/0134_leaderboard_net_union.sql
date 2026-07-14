-- 0134: liderlik tablosu net kazanc = kupon + aviator + slot birligi
-- (day/week 0 gorunuyordu: yalniz kuponlara bakiyordu). MCP ile canliya
-- uygulandi (2026-07-14); bu dosya canlidaki gercek govdenin kaydidir.

CREATE OR REPLACE FUNCTION public.get_leaderboard(p_scope text DEFAULT 'week'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_since timestamptz;
  v_rows jsonb;
  v_me jsonb;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  if p_scope = 'wins' then
    with agg as (
      select user_id,
             count(*) as played,
             count(*) filter (where status = 'won') as won
        from public.coupons
       group by user_id
    ),
    ranked as (
      select a.user_id, p.username, a.won as value, a.played,
             rank() over (order by a.won desc, a.played asc) as rnk
        from agg a
        join public.profiles p on p.id = a.user_id
       where a.won >= 1
    )
    select
      (select coalesce(jsonb_agg(jsonb_build_object('username', username, 'rank', rnk, 'value', value, 'played', played) order by rnk), '[]'::jsonb)
         from ranked where rnk <= 50),
      (select jsonb_build_object('rank', rnk, 'value', value, 'played', played) from ranked where user_id = v_uid)
    into v_rows, v_me;
  else
    v_since := case when p_scope = 'day' then date_trunc('day', now()) else date_trunc('week', now()) end;
    with net as (
      select u.user_id, sum(u.v) as value from (
        select c.user_id,
               (case when c.status = 'won' then c.potential_win
                     when c.status = 'cashed_out' then coalesce(c.cashout_amount, 0)
                     else 0 end) - c.stake as v
          from public.coupons c
         where c.settled_at >= v_since
        union all
        select b.user_id, coalesce(b.payout, 0) - b.stake
          from public.aviator_bets b
         where b.placed_at >= v_since and b.status <> 'placed'
        union all
        select s.user_id, s.payout - s.stake
          from public.slot_spins s
         where s.created_at >= v_since
      ) u group by u.user_id
    ),
    ranked as (
      select n.user_id, p.username, n.value, rank() over (order by n.value desc) as rnk
        from net n
        join public.profiles p on p.id = n.user_id
    )
    select
      (select coalesce(jsonb_agg(jsonb_build_object('username', username, 'rank', rnk, 'value', value, 'played', null) order by rnk), '[]'::jsonb)
         from ranked where rnk <= 50),
      (select jsonb_build_object('rank', rnk, 'value', value, 'played', null) from ranked where user_id = v_uid)
    into v_rows, v_me;
  end if;

  return jsonb_build_object('scope', p_scope, 'rows', coalesce(v_rows, '[]'::jsonb),
    'me', coalesce(v_me, jsonb_build_object('rank', null, 'value', 0, 'played', null)));
end;
$function$
;
