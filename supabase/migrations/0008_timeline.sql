-- ============================================================================
-- pickplay.ai — 0008: match timeline (for virtual live playback)
-- ----------------------------------------------------------------------------
-- The result stays server-authoritative and deterministic (unchanged). This
-- adds, alongside the final score, a TIMELINE of goal events consistent with
-- that score, so the client can replay a match "live" over time instead of
-- revealing it instantly. Presentation only — no money/settlement change.
--
-- timeline shape: [{ "minute": 23, "type": "goal", "team": "home" }, ...]
-- (sorted by minute; exactly home_score home goals + away_score away goals).
-- Half-time / full-time markers are synthesized client-side.
--
-- Self-contained + idempotent.
-- ============================================================================

alter table public.matches add column if not exists timeline jsonb;
grant select (timeline) on public.matches to authenticated;

-- Build a score-consistent, minute-sorted goal timeline.
create or replace function public._make_timeline(p_h int, p_a int)
returns jsonb
language plpgsql
volatile
set search_path = public
as $fn$
declare
  v_tot   int := coalesce(p_h, 0) + coalesce(p_a, 0);
  v_mins  int[] := '{}';
  v_teams text[] := '{}';
  v_ev    jsonb[] := '{}';
  m       int;
  i       int;
begin
  if v_tot = 0 then
    return '[]'::jsonb;
  end if;

  -- team-per-goal list (home_score homes + away_score aways), shuffled so the
  -- scoring order is unpredictable
  for i in 1 .. coalesce(p_h, 0) loop v_teams := array_append(v_teams, 'home'); end loop;
  for i in 1 .. coalesce(p_a, 0) loop v_teams := array_append(v_teams, 'away'); end loop;
  select array_agg(t order by random()) into v_teams from unnest(v_teams) t;

  -- pick v_tot distinct minutes in 1..90, then sort ascending
  while coalesce(array_length(v_mins, 1), 0) < v_tot loop
    m := 1 + floor(random() * 90)::int;
    if not (m = any(v_mins)) then v_mins := array_append(v_mins, m); end if;
  end loop;
  select array_agg(x order by x) into v_mins from unnest(v_mins) x;

  for i in 1 .. v_tot loop
    v_ev := array_append(v_ev, jsonb_build_object(
      'minute', v_mins[i], 'type', 'goal', 'team', v_teams[i]));
  end loop;

  return to_jsonb(v_ev);
end;
$fn$;

-- _finalize_match: same result/score logic, now also stamps the timeline.
create or replace function public._finalize_match(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_match  public.matches;
  v_r      double precision;
  v_ph     double precision;
  v_pd     double precision;
  v_result text;
  v_hs     int;
  v_as     int;
begin
  select * into v_match from public.matches where id = p_match_id for update;
  if not found or v_match.status = 'finished' then return; end if;

  v_ph := (v_match.true_probabilities ->> 'home')::double precision;
  v_pd := (v_match.true_probabilities ->> 'draw')::double precision;
  v_r  := random();
  if v_r < v_ph then v_result := 'home';
  elsif v_r < v_ph + v_pd then v_result := 'draw';
  else v_result := 'away'; end if;

  if v_result = 'home' then
    v_hs := 1 + floor(random() * 3)::int; v_as := floor(random() * v_hs)::int;
  elsif v_result = 'away' then
    v_as := 1 + floor(random() * 3)::int; v_hs := floor(random() * v_as)::int;
  else
    v_hs := floor(random() * 4)::int; v_as := v_hs;
  end if;

  update public.matches
     set status = 'finished', result = v_result, home_score = v_hs, away_score = v_as,
         timeline = public._make_timeline(v_hs, v_as)
   where id = p_match_id;

  perform public._score_match(p_match_id);
  perform public._settle_markets(p_match_id);
end;
$fn$;

-- settle_coupon: include each leg's match timeline in the returned breakdown.
create or replace function public.settle_coupon(p_coupon_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_coupon public.coupons;
  r        record;
  v_all_ok boolean := true;
  v_sels   jsonb;
  v_bal    int;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select * into v_coupon from public.coupons where id = p_coupon_id and user_id = v_uid for update;
  if not found then raise exception 'Coupon not found'; end if;

  if v_coupon.status = 'pending' then
    for r in
      select distinct mk.match_id
        from public.coupon_selections cs
        join public.market_options mo on mo.id = cs.market_option_id
        join public.markets mk on mk.id = mo.market_id
       where cs.coupon_id = p_coupon_id
    loop
      perform public._finalize_match(r.match_id);
    end loop;

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
    'coupon_id', v_coupon.id, 'status', v_coupon.status, 'stake', v_coupon.stake,
    'total_odds', v_coupon.total_odds, 'potential_win', v_coupon.potential_win,
    'new_balance', v_bal, 'selections', v_sels);
end;
$fn$;

-- backfill timelines for already-finished matches
update public.matches
   set timeline = public._make_timeline(home_score, away_score)
 where status = 'finished' and timeline is null;

revoke all on function public._make_timeline(int, int) from public, anon, authenticated;
