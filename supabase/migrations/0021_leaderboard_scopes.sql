-- ============================================================================
-- pickplay.ai - 0021: three leaderboard scopes
-- ----------------------------------------------------------------------------
-- get_leaderboard(scope) with three boards, all server-computed:
--   'day'   King of the Day  - most NET gold from coupons settled today (UTC).
--   'week'  King of the Week - most NET gold this week (resets Monday).
--   'wins'  Most Correct     - most WON coupons all-time; ties broken by fewer
--           played (efficiency). Each row also carries games played. Ranking is
--           by wins, NOT by games played, so a player who loses everything can
--           never sit on top.
-- Pure ASCII. Idempotent. Only usernames + aggregates leave the server.
-- ============================================================================

create index if not exists idx_coupons_user_status2 on public.coupons (user_id, status);

create or replace function public.get_leaderboard(p_scope text default 'week')
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
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
      select c.user_id,
             sum((case when c.status = 'won' then c.potential_win
                       when c.status = 'cashed_out' then coalesce(c.cashout_amount, 0)
                       else 0 end) - c.stake) as value
        from public.coupons c
       where c.settled_at >= v_since
       group by c.user_id
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
$fn$;

revoke all on function public.get_leaderboard(text) from public, anon;
grant execute on function public.get_leaderboard(text) to authenticated;
