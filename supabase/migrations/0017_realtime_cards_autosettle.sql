-- ============================================================================
-- pickplay.ai — 0017: reliable finish, red-card odds, auto-settle
-- ----------------------------------------------------------------------------
-- BUG 1: matches now finish reliably — get_live_state finalizes any requested
--        match whose central clock is over (finalize-on-read), and returns the
--        finished state.
-- BUG 2: coupons auto-settle — settle_due_coupons() settles all of the caller's
--        pending coupons whose matches are all finished (no manual button).
-- B4:    red cards move the live price — the outcome script now includes 0-2
--        deterministic red cards; a carded team's remaining-goal strength drops,
--        so its live odds jump out (server-authoritative; place_coupon agrees).
-- Result/score stay single-source + deterministic; the future stays hidden.
-- Self-contained + idempotent.
-- ============================================================================

-- Outcome now also carries a deterministic red-card list (atmosphere + odds;
-- never changes the score). Existing matches without 'cards' read as none.
create or replace function public._make_outcome(p_probs jsonb)
returns jsonb
language plpgsql
volatile
set search_path = public
as $fn$
declare
  v_r      double precision := random();
  v_ph     double precision := (p_probs ->> 'home')::double precision;
  v_pd     double precision := (p_probs ->> 'draw')::double precision;
  v_result text;
  v_hs     int;
  v_as     int;
  v_cards  jsonb := '[]'::jsonb;
begin
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

  if random() < 0.5 then
    v_cards := v_cards || jsonb_build_object('minute', 25 + floor(random() * 60)::int,
      'team', case when random() < 0.5 then 'home' else 'away' end);
  end if;
  if random() < 0.18 then
    v_cards := v_cards || jsonb_build_object('minute', 30 + floor(random() * 55)::int,
      'team', case when random() < 0.5 then 'home' else 'away' end);
  end if;

  return jsonb_build_object(
    'result', v_result, 'home_score', v_hs, 'away_score', v_as,
    'events', public._make_timeline(v_hs, v_as), 'cards', v_cards);
end;
$fn$;

-- get_live_state: finalize-on-read for due matches; reveal cards; live odds
-- reflect red cards (carded team weakened) so the price jumps on a sending-off.
create or replace function public.get_live_state(p_match_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_now     timestamptz := now();
  v_out     jsonb := '[]'::jsonb;
  r         record;
  m         record;
  v_elapsed double precision;
  v_dur     int;
  v_minute  int;
  v_phase   text;
  v_events  jsonb;
  v_cards   jsonb;
  v_hs      int; v_as int; v_rh int; v_ra int;
  v_probs   jsonb;
  v_odds    jsonb;
begin
  -- finalize any requested match whose real time is over (BUG 1)
  for r in
    select id from public.matches
     where id = any(p_match_ids) and status <> 'finished'
       and v_now >= starts_at + make_interval(secs => coalesce(duration_secs, 100))
  loop
    perform public._finalize_match(r.id);
  end loop;

  for m in select * from public.matches where id = any(p_match_ids) loop
    v_dur := coalesce(m.duration_secs, 100);
    v_elapsed := extract(epoch from (v_now - m.starts_at));

    if m.status = 'finished' or v_elapsed >= v_dur then
      v_phase := 'finished'; v_minute := 90;
    elsif v_elapsed < 0 then
      v_phase := 'upcoming'; v_minute := 0;
    else
      v_phase := 'live';
      v_minute := least(90, greatest(0, floor(v_elapsed / v_dur * 90)::int));
    end if;

    if m.secret_outcome is not null and v_phase <> 'upcoming' then
      select coalesce(jsonb_agg(e order by (e ->> 'minute')::int), '[]'::jsonb) into v_events
        from jsonb_array_elements(m.secret_outcome -> 'events') e
       where (e ->> 'minute')::int <= v_minute;
      select coalesce(jsonb_agg(c order by (c ->> 'minute')::int), '[]'::jsonb),
             count(*) filter (where c ->> 'team' = 'home'),
             count(*) filter (where c ->> 'team' = 'away')
        into v_cards, v_rh, v_ra
        from jsonb_array_elements(coalesce(m.secret_outcome -> 'cards', '[]'::jsonb)) c
       where (c ->> 'minute')::int <= v_minute;
    else
      v_events := '[]'::jsonb; v_cards := '[]'::jsonb; v_rh := 0; v_ra := 0;
    end if;

    select count(*) filter (where e ->> 'team' = 'home'),
           count(*) filter (where e ->> 'team' = 'away')
      into v_hs, v_as from jsonb_array_elements(v_events) e;

    if v_phase = 'live' then
      -- weaken the carded team's strength -> its live odds jump out
      v_probs := jsonb_build_object(
        'home', (m.true_probabilities ->> 'home')::double precision * power(0.72, coalesce(v_rh, 0)),
        'away', (m.true_probabilities ->> 'away')::double precision * power(0.72, coalesce(v_ra, 0)));
      v_odds := public._live_odds(v_probs, v_minute, coalesce(v_hs, 0), coalesce(v_as, 0));
    elsif v_phase = 'upcoming' then
      v_odds := m.display_odds;
    else
      v_odds := null;
    end if;

    v_out := v_out || jsonb_build_object(
      'match_id', m.id, 'home_team', m.home_team, 'away_team', m.away_team,
      'phase', v_phase, 'minute', v_minute,
      'starts_in', greatest(0, ceil(-v_elapsed))::int, 'duration_secs', v_dur,
      'home_score', coalesce(v_hs, 0), 'away_score', coalesce(v_as, 0),
      'events', v_events, 'cards', coalesce(v_cards, '[]'::jsonb),
      'red_home', coalesce(v_rh, 0), 'red_away', coalesce(v_ra, 0),
      'live_odds', v_odds,
      'result', case when v_phase = 'finished' then coalesce(m.secret_outcome ->> 'result', m.result) end);
  end loop;
  return v_out;
end;
$fn$;

-- place_coupon: live locking also reflects red cards.
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
  v_probs jsonb; v_lock numeric; i int;
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
      v_lock := rec.odds;
    else
      v_minute := least(90, floor(v_elapsed / v_dur * 90)::int);
      if v_minute >= 85 then raise exception 'market_closed'; end if;
      if rec.market_type <> 'match_result' then raise exception 'market_closed'; end if;
      select count(*) filter (where e ->> 'team' = 'home'), count(*) filter (where e ->> 'team' = 'away')
        into v_hs, v_as from jsonb_array_elements(rec.secret -> 'events') e where (e ->> 'minute')::int <= v_minute;
      select count(*) filter (where c ->> 'team' = 'home'), count(*) filter (where c ->> 'team' = 'away')
        into v_rh, v_ra from jsonb_array_elements(coalesce(rec.secret -> 'cards', '[]'::jsonb)) c where (c ->> 'minute')::int <= v_minute;
      v_probs := jsonb_build_object(
        'home', (rec.probs ->> 'home')::double precision * power(0.72, coalesce(v_rh, 0)),
        'away', (rec.probs ->> 'away')::double precision * power(0.72, coalesce(v_ra, 0)));
      v_lock := (public._live_odds(v_probs, v_minute, coalesce(v_hs, 0), coalesce(v_as, 0)) ->> rec.outcome_key)::numeric;
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

-- Auto-settle: resolve every pending coupon of the caller whose legs are all done.
create or replace function public.settle_due_coupons()
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  r record;
  n int := 0;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  for r in select id from public.coupons where user_id = v_uid and status = 'pending' loop
    perform public.settle_coupon(r.id);
  end loop;
  select count(*) into n from public.coupons
   where user_id = v_uid and status <> 'pending'
     and settled_at >= now() - interval '20 seconds';
  return n;
end;
$fn$;

revoke all on function public.settle_due_coupons() from public, anon;
grant execute on function public.settle_due_coupons() to authenticated;
