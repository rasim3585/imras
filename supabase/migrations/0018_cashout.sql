-- ============================================================================
-- pickplay.ai - 0018: early cash out
-- ----------------------------------------------------------------------------
-- Lets a user close an OPEN coupon while its matches are still live, for a
-- server-computed value based on the current live odds. Value formula:
--   potential_win * product(current implied prob of each still-open pick) *
--   (1 - cashout margin). A leg already won contributes prob 1; if any leg has
--   already lost, the coupon is dead and cash out is 0/unavailable.
-- The value is locked at the moment do_cashout runs (server authoritative). A
-- cashed-out coupon becomes status cashed_out and is never settled again.
-- Money stays closed + deterministic. Pure ASCII. Idempotent.
-- ============================================================================

alter table public.coupons add column if not exists cashout_amount int;
alter table public.coupons drop constraint if exists coupons_status_check;
alter table public.coupons
  add constraint coupons_status_check
  check (status in ('pending', 'won', 'lost', 'cashed_out'));

-- Current value of an open coupon (0 if not cashable). Internal.
create or replace function public._cashout_value(p_coupon_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_coupon  public.coupons;
  r         record;
  v_prob    double precision := 1;
  v_now     timestamptz := now();
  v_elapsed double precision;
  v_dur     int;
  v_minute  int;
  v_hs int; v_as int; v_rh int; v_ra int;
  v_probs jsonb; v_odds jsonb;
  v_imp double precision; v_sum double precision;
  v_margin double precision := 0.06;
  v_dead boolean := false;
  v_open int := 0;
begin
  select * into v_coupon from public.coupons where id = p_coupon_id;
  if not found or v_coupon.status <> 'pending' then return 0; end if;

  for r in
    select cs.odds as sel_odds, mo.outcome_key, mo.is_winner, mk.market_type,
           m.id as mid, m.status as mstatus, m.starts_at, m.duration_secs,
           m.true_probabilities as probs, m.secret_outcome as secret
      from public.coupon_selections cs
      join public.market_options mo on mo.id = cs.market_option_id
      join public.markets mk on mk.id = mo.market_id
      join public.matches m  on m.id  = mk.match_id
     where cs.coupon_id = p_coupon_id
  loop
    v_dur := coalesce(r.duration_secs, 100);
    v_elapsed := extract(epoch from (v_now - r.starts_at));

    if r.mstatus = 'finished' or v_elapsed >= v_dur then
      if r.is_winner is true then
        v_prob := v_prob * 1;
      else
        v_dead := true;   -- lost leg (or unresolved finished) kills the coupon
      end if;
    else
      v_open := v_open + 1;
      if v_elapsed < 0 then
        select coalesce(sum(1.0 / o.odds), 0) into v_sum
          from public.market_options o
          join public.markets mk2 on mk2.id = o.market_id
         where mk2.match_id = r.mid and mk2.market_type = r.market_type;
        v_imp := (1.0 / r.sel_odds) / nullif(v_sum, 0);
      else
        v_minute := least(90, floor(v_elapsed / v_dur * 90)::int);
        select count(*) filter (where e ->> 'team' = 'home'), count(*) filter (where e ->> 'team' = 'away')
          into v_hs, v_as from jsonb_array_elements(r.secret -> 'events') e where (e ->> 'minute')::int <= v_minute;
        select count(*) filter (where c ->> 'team' = 'home'), count(*) filter (where c ->> 'team' = 'away')
          into v_rh, v_ra from jsonb_array_elements(coalesce(r.secret -> 'cards', '[]'::jsonb)) c where (c ->> 'minute')::int <= v_minute;
        v_probs := jsonb_build_object(
          'home', (r.probs ->> 'home')::double precision * power(0.72, coalesce(v_rh, 0)),
          'away', (r.probs ->> 'away')::double precision * power(0.72, coalesce(v_ra, 0)));
        v_odds := public._live_odds(v_probs, v_minute, coalesce(v_hs, 0), coalesce(v_as, 0));
        v_imp := (1.0 / (v_odds ->> r.outcome_key)::double precision)
               / ((1.0 / (v_odds ->> 'home')::double precision)
                + (1.0 / (v_odds ->> 'draw')::double precision)
                + (1.0 / (v_odds ->> 'away')::double precision));
      end if;
      v_prob := v_prob * coalesce(v_imp, 0);
    end if;
  end loop;

  if v_dead or v_open = 0 then return 0; end if;
  return greatest(0, floor(v_coupon.potential_win * v_prob * (1 - v_margin))::int);
end;
$fn$;

-- Public: current cash-out value + whether it is available right now.
create or replace function public.get_cashout_value(p_coupon_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_coupon public.coupons;
  r record;
  v_val int;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select * into v_coupon from public.coupons where id = p_coupon_id and user_id = v_uid;
  if not found then raise exception 'Coupon not found'; end if;

  -- finalize any legs whose real time is over, so finished legs are accurate
  for r in
    select distinct mk.match_id
      from public.coupon_selections cs
      join public.market_options mo on mo.id = cs.market_option_id
      join public.markets mk on mk.id = mo.market_id
     where cs.coupon_id = p_coupon_id
  loop
    perform public._finalize_match(r.match_id);
  end loop;

  v_val := public._cashout_value(p_coupon_id);
  return jsonb_build_object('value', v_val, 'available', v_val > 0 and v_coupon.status = 'pending');
end;
$fn$;

-- Public: lock the current value and cash out.
create or replace function public.do_cashout(p_coupon_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_coupon public.coupons;
  r record;
  v_val int;
  v_bal int;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select * into v_coupon from public.coupons where id = p_coupon_id and user_id = v_uid for update;
  if not found then raise exception 'Coupon not found'; end if;
  if v_coupon.status <> 'pending' then raise exception 'cashout_unavailable'; end if;

  for r in
    select distinct mk.match_id
      from public.coupon_selections cs
      join public.market_options mo on mo.id = cs.market_option_id
      join public.markets mk on mk.id = mo.market_id
     where cs.coupon_id = p_coupon_id
  loop
    perform public._finalize_match(r.match_id);
  end loop;

  v_val := public._cashout_value(p_coupon_id);
  if v_val <= 0 then raise exception 'cashout_unavailable'; end if;

  update public.coupons
     set status = 'cashed_out', cashout_amount = v_val, settled_at = now()
   where id = p_coupon_id;
  update public.profiles set gold_balance = gold_balance + v_val where id = v_uid;
  select gold_balance into v_bal from public.profiles where id = v_uid;

  return jsonb_build_object('status', 'cashed_out', 'cashout_amount', v_val, 'new_balance', v_bal);
end;
$fn$;

revoke all on function public._cashout_value(uuid) from public, anon, authenticated;
revoke all on function public.get_cashout_value(uuid) from public, anon;
revoke all on function public.do_cashout(uuid) from public, anon;
grant execute on function public.get_cashout_value(uuid) to authenticated;
grant execute on function public.do_cashout(uuid) to authenticated;
