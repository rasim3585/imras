-- ============================================================================
-- pickplay.ai — 0015: Model A — real-time, user-independent matches
-- ----------------------------------------------------------------------------
-- Matches progress on a CENTRAL clock (starts_at + duration_secs), not on the
-- viewer's screen. A match finishes and persists its (pre-decided, single-
-- source) result when its real time is over — whether or not anyone watched.
-- Settlement reads that recorded result; a coupon cannot be settled while any
-- of its matches is still in progress.
--
--   * _finalize_match now only fires once a match's real time is over (no early
--     finish). Still idempotent + applies the one stored outcome.
--   * finalize_due_matches(): finalizes every match whose clock has ended — the
--     "global settlement" trigger (any active client can call it to advance the
--     world; a cron can call it too).
--   * settle_coupon: finalizes due legs, and only grades/pays when ALL legs are
--     finished; otherwise returns in_progress (no early/partial settle).
-- Self-contained + idempotent. Money/determinism/secrecy unchanged.
-- ============================================================================

-- Finish a match only when its central clock is over.
create or replace function public._finalize_match(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_match public.matches;
  v_out   jsonb;
begin
  select * into v_match from public.matches where id = p_match_id for update;
  if not found or v_match.status = 'finished' then return; end if;
  -- Model A: no early finish — the match ends on the central clock, not on demand
  if now() < v_match.starts_at + make_interval(secs => coalesce(v_match.duration_secs, 100)) then
    return;
  end if;

  v_out := public._ensure_outcome(p_match_id);   -- the one, stored outcome

  update public.matches
     set status = 'finished',
         result = v_out ->> 'result',
         home_score = (v_out ->> 'home_score')::int,
         away_score = (v_out ->> 'away_score')::int,
         timeline = v_out -> 'events'
   where id = p_match_id;

  perform public._score_match(p_match_id);
  perform public._settle_markets(p_match_id);
end;
$fn$;

-- Global trigger: finish every match whose real time has ended.
create or replace function public.finalize_due_matches()
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
  r record;
  n int := 0;
begin
  for r in
    select id from public.matches
     where status <> 'finished'
       and now() >= starts_at + make_interval(secs => coalesce(duration_secs, 100))
  loop
    perform public._finalize_match(r.id);
    n := n + 1;
  end loop;
  return n;
end;
$fn$;

-- Settle only when all legs are over; otherwise report in_progress.
create or replace function public.settle_coupon(p_coupon_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid     uuid := auth.uid();
  v_coupon  public.coupons;
  r         record;
  v_all_ok  boolean := true;
  v_all_done boolean;
  v_sels    jsonb;
  v_bal     int;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select * into v_coupon from public.coupons where id = p_coupon_id and user_id = v_uid for update;
  if not found then raise exception 'Coupon not found'; end if;

  if v_coupon.status = 'pending' then
    -- finish any legs whose real time is over
    for r in
      select distinct mk.match_id
        from public.coupon_selections cs
        join public.market_options mo on mo.id = cs.market_option_id
        join public.markets mk on mk.id = mo.market_id
       where cs.coupon_id = p_coupon_id
    loop
      perform public._finalize_match(r.match_id);
    end loop;

    -- are ALL legs finished now?
    select bool_and(m.status = 'finished') into v_all_done
      from public.coupon_selections cs
      join public.market_options mo on mo.id = cs.market_option_id
      join public.markets mk on mk.id = mo.market_id
      join public.matches m  on m.id  = mk.match_id
     where cs.coupon_id = p_coupon_id;

    if v_all_done then
      for r in
        select cs.id, mo.is_winner
          from public.coupon_selections cs
          join public.market_options mo on mo.id = cs.market_option_id
         where cs.coupon_id = p_coupon_id
      loop
        update public.coupon_selections
           set status = case when r.is_winner is true then 'won' else 'lost' end
         where id = r.id;
        if r.is_winner is not true then v_all_ok := false; end if;
      end loop;

      update public.coupons
         set status = case when v_all_ok then 'won' else 'lost' end, settled_at = now()
       where id = p_coupon_id;
      if v_all_ok then
        update public.profiles set gold_balance = gold_balance + v_coupon.potential_win where id = v_uid;
      end if;

      select * into v_coupon from public.coupons where id = p_coupon_id;
    end if;
  end if;

  select gold_balance into v_bal from public.profiles where id = v_uid;

  select jsonb_agg(jsonb_build_object(
           'selection_id', cs.id, 'match_id', mk.match_id,
           'home_team', m.home_team, 'away_team', m.away_team,
           'market_name', mk.name, 'market_type', mk.market_type,
           'option_label', mo.label, 'outcome_key', mo.outcome_key,
           'odds', cs.odds, 'status', cs.status, 'result', m.result,
           'home_score', m.home_score, 'away_score', m.away_score,
           'timeline', coalesce(m.timeline, '[]'::jsonb))
           order by cs.id)
    into v_sels
    from public.coupon_selections cs
    join public.market_options mo on mo.id = cs.market_option_id
    join public.markets mk on mk.id = mo.market_id
    join public.matches m  on m.id  = mk.match_id
   where cs.coupon_id = p_coupon_id;

  return jsonb_build_object(
    'coupon_id', v_coupon.id, 'status', v_coupon.status,
    'in_progress', (v_coupon.status = 'pending'),
    'stake', v_coupon.stake, 'total_odds', v_coupon.total_odds,
    'potential_win', v_coupon.potential_win, 'new_balance', v_bal, 'selections', v_sels);
end;
$fn$;

revoke all on function public.finalize_due_matches() from public, anon;
grant execute on function public.finalize_due_matches() to authenticated;
