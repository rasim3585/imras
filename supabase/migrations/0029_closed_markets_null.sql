-- ============================================================================
-- pickplay.ai - 0029: closed markets return NULL (no fake odds)
-- ----------------------------------------------------------------------------
-- Once the score already settles a market it must not show a near-certain fake
-- odd (1.01 / 15). The displayed live odds (_live_odds -> get_live_state) now
-- return JSON null for those outcome keys; the client hides the button and shows
-- "Closed". A market closes when:
--   total >= 2  -> over/under 1.5     total >= 3 -> over/under 2.5
--   total >= 4  -> over/under 3.5     both scored -> both-teams-to-score
-- (match result / double chance / odd-even close only at full time, where the
-- whole live_odds map is already null.)
-- place_coupon rejects a bet on such a decided market (market_closed).
-- _cashout_value is unchanged: it prices via _market_odds_ft directly (never
-- null), so cash-out keeps working on legs whose display market has closed.
-- Pricing numbers otherwise identical. Idempotent, pure ASCII.
-- ============================================================================

-- display odds: price via the engine, then null out any market the score decides
create or replace function public._live_odds(p_probs jsonb, p_minute int, p_hs int, p_as int)
returns jsonb
language plpgsql
immutable
set search_path = public
as $fn$
declare v jsonb; tot int := p_hs + p_as;
begin
  v := public._market_odds_ft(p_probs, least(90, (floor(p_minute / 6.0) * 6))::int, p_hs, p_as);
  if tot >= 2 then v := v || jsonb_build_object('ou15_over', null::jsonb, 'ou15_under', null::jsonb); end if;
  if tot >= 3 then v := v || jsonb_build_object('ou25_over', null::jsonb, 'ou25_under', null::jsonb); end if;
  if tot >= 4 then v := v || jsonb_build_object('ou35_over', null::jsonb, 'ou35_under', null::jsonb); end if;
  if p_hs >= 1 and p_as >= 1 then v := v || jsonb_build_object('btts_yes', null::jsonb, 'btts_no', null::jsonb); end if;
  return v;
end;
$fn$;

-- place_coupon: reject a bet on a market the score has already settled
create or replace function public.place_coupon(p_option_ids uuid[], p_stake int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_balance int; v_count int; v_total numeric := 1; v_pot int; v_coupon uuid;
  v_oid uuid; rec record; v_seen uuid[] := '{}'; v_ids uuid[] := '{}'; v_locks numeric[] := '{}';
  v_elapsed double precision; v_dur int; v_minute int; v_hs int; v_as int; v_rh int; v_ra int;
  v_probs jsonb; v_lock numeric; i int; v_tot int;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if p_stake is null or p_stake <= 0 then raise exception 'Stake must be positive'; end if;
  v_count := coalesce(array_length(p_option_ids, 1), 0);
  if v_count < 1 then raise exception 'Add at least one selection'; end if;
  if v_count > 10 then raise exception 'A coupon can hold at most 10 selections'; end if;

  select gold_balance into v_balance from public.profiles where id = v_uid for update;
  if v_balance < p_stake then raise exception 'Not enough gold'; end if;

  foreach v_oid in array p_option_ids loop
    select mo.odds odds, mo.outcome_key outcome_key, mk.market_type market_type, mk.match_id match_id,
           m.starts_at starts_at, m.duration_secs duration_secs, m.status status,
           m.true_probabilities probs, m.secret_outcome secret
      into rec
      from public.market_options mo
      join public.markets mk on mk.id = mo.market_id
      join public.matches m on m.id = mk.match_id
     where mo.id = v_oid for update of mo;
    if not found then raise exception 'Selection not found'; end if;
    if rec.match_id = any(v_seen) then raise exception 'Only one pick per match is allowed on a coupon'; end if;
    v_seen := array_append(v_seen, rec.match_id);

    v_dur := coalesce(rec.duration_secs, 100);
    v_elapsed := extract(epoch from (now() - rec.starts_at));
    if rec.status = 'finished' or v_elapsed >= v_dur then
      raise exception 'market_closed';
    elsif v_elapsed < 0 then
      v_lock := rec.odds;                                  -- pre-match line (any market)
    else
      v_minute := least(90, floor(v_elapsed / v_dur * 90)::int);
      if v_minute >= 85 then raise exception 'market_closed'; end if;
      if rec.market_type in ('ht_result', 'ht_over_under_0_5') then raise exception 'market_closed'; end if;
      select count(*) filter (where e ->> 'team' = 'home'), count(*) filter (where e ->> 'team' = 'away')
        into v_hs, v_as from jsonb_array_elements(rec.secret -> 'events') e where (e ->> 'minute')::int <= v_minute;
      select count(*) filter (where c ->> 'team' = 'home'), count(*) filter (where c ->> 'team' = 'away')
        into v_rh, v_ra from jsonb_array_elements(coalesce(rec.secret -> 'cards', '[]'::jsonb)) c where (c ->> 'minute')::int <= v_minute;
      v_tot := coalesce(v_hs, 0) + coalesce(v_as, 0);
      -- a market the score has already settled is closed
      if (rec.market_type = 'over_under_1_5' and v_tot >= 2)
        or (rec.market_type = 'over_under_2_5' and v_tot >= 3)
        or (rec.market_type = 'over_under_3_5' and v_tot >= 4)
        or (rec.market_type = 'both_teams_score' and coalesce(v_hs, 0) >= 1 and coalesce(v_as, 0) >= 1)
      then raise exception 'market_closed'; end if;
      v_probs := jsonb_build_object(
        'home', (rec.probs ->> 'home')::double precision * power(0.72, coalesce(v_rh, 0)),
        'away', (rec.probs ->> 'away')::double precision * power(0.72, coalesce(v_ra, 0)));
      v_lock := (public._market_odds_ft(v_probs, v_minute, coalesce(v_hs, 0), coalesce(v_as, 0)) ->> rec.outcome_key)::numeric;
    end if;

    v_ids := array_append(v_ids, v_oid);
    v_locks := array_append(v_locks, v_lock);
    v_total := v_total * v_lock;
  end loop;

  v_total := round(v_total, 2);
  v_pot := round(p_stake * v_total)::int;
  insert into public.coupons (user_id, stake, total_odds, potential_win, status)
    values (v_uid, p_stake, v_total, v_pot, 'pending') returning id into v_coupon;
  for i in 1 .. array_length(v_ids, 1) loop
    insert into public.coupon_selections (coupon_id, market_option_id, odds) values (v_coupon, v_ids[i], v_locks[i]);
  end loop;
  update public.profiles set gold_balance = gold_balance - p_stake where id = v_uid;

  return jsonb_build_object('coupon_id', v_coupon, 'total_odds', v_total, 'potential_win', v_pot, 'new_balance', v_balance - p_stake);
end;
$fn$;

revoke all on function public.place_coupon(uuid[], int) from public, anon;
grant execute on function public.place_coupon(uuid[], int) to authenticated;

notify pgrst, 'reload schema';
