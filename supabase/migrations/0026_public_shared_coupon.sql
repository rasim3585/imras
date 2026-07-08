-- ============================================================================
-- pickplay.ai - 0026: public shareable coupon link
-- ----------------------------------------------------------------------------
-- get_shared_coupon(id): returns ONE shared coupon by its (unguessable, random
-- UUIDv4) id for a public preview page -- callable by anon. Exposes only safe
-- fields (username + coupon content); never balance/email/private data, and
-- only when the coupon has actually been shared (shared_at is not null).
-- No new tables (reuses coupons.shared_at from 0022). Pure ASCII. Idempotent.
-- ============================================================================

create or replace function public.get_shared_coupon(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare v_out jsonb;
begin
  select jsonb_build_object(
    'coupon_id', c.id, 'username', p.username, 'stake', c.stake,
    'total_odds', c.total_odds, 'potential_win', c.potential_win,
    'status', c.status, 'shared_at', c.shared_at,
    'legs', (select coalesce(jsonb_agg(jsonb_build_object(
               'option_id', cs.market_option_id, 'match_id', m.id, 'odds', cs.odds, 'status', cs.status,
               'market_name', mk.name, 'option_label', mo.label,
               'home_team', m.home_team, 'away_team', m.away_team) order by cs.id), '[]'::jsonb)
             from public.coupon_selections cs
             join public.market_options mo on mo.id = cs.market_option_id
             join public.markets mk on mk.id = mo.market_id
             join public.matches m on m.id = mk.match_id
            where cs.coupon_id = c.id))
    into v_out
    from public.coupons c
    join public.profiles p on p.id = c.user_id
   where c.id = p_id and c.shared_at is not null;
  return v_out;   -- null if not found / not shared
end;
$fn$;

revoke all on function public.get_shared_coupon(uuid) from public;
grant execute on function public.get_shared_coupon(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
