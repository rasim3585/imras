-- ============================================================================
-- pickplay.ai — 0016: live betting + continuous bulletin
-- ----------------------------------------------------------------------------
-- With Model A a match goes live almost immediately, so the pre-match market
-- would "close" before the user finishes a coupon. Fix: the market stays OPEN
-- once live — place_coupon now accepts live matches and LOCKS the current live
-- price (server-computed from the hidden probs + current minute/score). Only a
-- finished match, or one in the closing minutes (>= 85'), rejects with a clean
-- 'market_closed'. Result stays deterministic + server-authoritative.
--
-- Also: seed_matches now keeps a CONTINUOUS staggered bulletin — a few matches
-- upcoming and a few already live at various minutes, so it's never empty.
-- Self-contained + idempotent.
-- ============================================================================

create or replace function public.place_coupon(p_option_ids uuid[], p_stake int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid     uuid := auth.uid();
  v_balance int;
  v_count   int;
  v_total   numeric := 1;
  v_pot     int;
  v_coupon  uuid;
  v_oid     uuid;
  rec       record;
  v_seen    uuid[] := '{}';
  v_ids     uuid[] := '{}';
  v_locks   numeric[] := '{}';
  v_elapsed double precision;
  v_dur     int;
  v_minute  int;
  v_hs      int;
  v_as      int;
  v_lock    numeric;
  i         int;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if p_stake is null or p_stake <= 0 then raise exception 'Stake must be positive'; end if;
  v_count := coalesce(array_length(p_option_ids, 1), 0);
  if v_count < 1 then raise exception 'Add at least one selection'; end if;
  if v_count > 10 then raise exception 'A coupon can hold at most 10 selections'; end if;

  select gold_balance into v_balance from public.profiles where id = v_uid for update;
  if v_balance < p_stake then raise exception 'Not enough gold'; end if;

  foreach v_oid in array p_option_ids loop
    select mo.odds as odds, mo.outcome_key as outcome_key, mk.market_type as market_type,
           mk.match_id as match_id, m.starts_at as starts_at, m.duration_secs as duration_secs,
           m.status as status, m.true_probabilities as probs, m.secret_outcome as secret,
           m.home_team as home_team, m.away_team as away_team
      into rec
      from public.market_options mo
      join public.markets mk on mk.id = mo.market_id
      join public.matches m  on m.id  = mk.match_id
     where mo.id = v_oid
     for update of mo;
    if not found then raise exception 'Selection not found'; end if;
    if rec.match_id = any(v_seen) then raise exception 'Only one pick per match is allowed on a coupon'; end if;
    v_seen := array_append(v_seen, rec.match_id);

    v_dur := coalesce(rec.duration_secs, 100);
    v_elapsed := extract(epoch from (now() - rec.starts_at));

    if rec.status = 'finished' or v_elapsed >= v_dur then
      raise exception 'market_closed';                   -- match is over
    elsif v_elapsed < 0 then
      v_lock := rec.odds;                                -- pre-match fixed line
    else
      v_minute := least(90, floor(v_elapsed / v_dur * 90)::int);
      if v_minute >= 85 then raise exception 'market_closed'; end if;   -- closing minutes
      if rec.market_type <> 'match_result' then raise exception 'market_closed'; end if;
      -- current score from goals revealed so far
      select count(*) filter (where e ->> 'team' = 'home'),
             count(*) filter (where e ->> 'team' = 'away')
        into v_hs, v_as
        from jsonb_array_elements(rec.secret -> 'events') e
       where (e ->> 'minute')::int <= v_minute;
      -- LOCK the current live price for the picked outcome
      v_lock := (public._live_odds(rec.probs, v_minute, coalesce(v_hs, 0), coalesce(v_as, 0)) ->> rec.outcome_key)::numeric;
    end if;

    v_ids   := array_append(v_ids, v_oid);
    v_locks := array_append(v_locks, v_lock);
    v_total := v_total * v_lock;
  end loop;

  v_total := round(v_total, 2);
  v_pot   := round(p_stake * v_total)::int;

  insert into public.coupons (user_id, stake, total_odds, potential_win, status)
    values (v_uid, p_stake, v_total, v_pot, 'pending') returning id into v_coupon;

  for i in 1 .. array_length(v_ids, 1) loop
    insert into public.coupon_selections (coupon_id, market_option_id, odds)
      values (v_coupon, v_ids[i], v_locks[i]);
  end loop;

  update public.profiles set gold_balance = gold_balance - p_stake where id = v_uid;

  return jsonb_build_object('coupon_id', v_coupon, 'total_odds', v_total,
    'potential_win', v_pot, 'new_balance', v_balance - p_stake);
end;
$fn$;

-- Continuous bulletin: keep ~10 non-finished matches, staggered so some are
-- already live (started in the recent past) and some are upcoming.
create or replace function public.seed_matches(p_target int default 10)
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_existing int;
  v_needed   int;
  v_teams    text[] := array[
    'Arsenal','Chelsea','Liverpool','Man City','Man United','Tottenham',
    'Newcastle','Aston Villa','Brighton','West Ham','Everton','Leeds',
    'Real Madrid','Barcelona','Atletico','Sevilla','Valencia','Villarreal',
    'Bayern','Dortmund','Leipzig','Leverkusen','Juventus','Inter','Milan',
    'Napoli','Roma','PSG','Marseille','Lyon','Ajax','Porto','Benfica','Celtic'
  ];
  v_n     int := array_length(v_teams, 1);
  v_hi    int; v_ai int;
  v_h     double precision; v_d double precision; v_a double precision; v_sum double precision;
  v_probs jsonb;
  v_id    uuid;
  i       int;
begin
  p_target := least(greatest(coalesce(p_target, 10), 0), 24);
  -- count matches still in play (upcoming or live), i.e. not finished + not over
  select count(*) into v_existing
    from public.matches
   where status <> 'finished'
     and now() < starts_at + make_interval(secs => coalesce(duration_secs, 100));
  v_needed := greatest(0, p_target - v_existing);

  for i in 1 .. v_needed loop
    v_hi := 1 + floor(random() * v_n)::int;
    loop v_ai := 1 + floor(random() * v_n)::int; exit when v_ai <> v_hi; end loop;

    v_h := 0.20 + random() * 0.45; v_d := 0.15 + random() * 0.25; v_a := 0.15 + random() * 0.45;
    v_sum := v_h + v_d + v_a;
    v_h := round((v_h / v_sum)::numeric, 4); v_d := round((v_d / v_sum)::numeric, 4); v_a := round((1 - v_h - v_d)::numeric, 4);
    v_probs := jsonb_build_object('home', v_h, 'draw', v_d, 'away', v_a);

    insert into public.matches
      (sport, home_team, away_team, starts_at, status, true_probabilities, display_odds, secret_outcome, duration_secs)
    values (
      'football', v_teams[v_hi], v_teams[v_ai],
      -- staggered: from ~40s ago (already live) to ~4min ahead (upcoming)
      now() + make_interval(secs => -40 + floor(random() * 280)::int),
      'upcoming', v_probs, public._make_display_odds(v_h, v_d, v_a),
      public._make_outcome(v_probs), 100)
    returning id into v_id;

    perform public._ensure_markets(v_id);
  end loop;

  return v_needed;
end;
$fn$;

grant execute on function public.seed_matches(int) to authenticated;
