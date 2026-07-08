-- ============================================================================
-- pickplay.ai - 0019: market depth (more bet types)
-- ----------------------------------------------------------------------------
-- Adds 8 more markets per match, all priced from ONE Poisson engine and settled
-- deterministically from the SAME match outcome + timeline (no new randomness):
--   double_chance (1X/12/X2), total goals over/under 1.5 / 2.5 / 3.5,
--   both teams to score (yes/no), total goals odd/even, first half result,
--   first half over/under 0.5.
-- Full-time markets are live-priced (odds move with score/time/red cards); the
-- two first-half markets are pre-match only. match_result live odds are the
-- exact same numbers as before (_live_odds now reads the shared engine).
-- Pure ASCII. Idempotent. Money stays closed + deterministic.
-- ============================================================================

-- price a probability with a blend toward uniform (n outcomes) + house margin.
create or replace function public._price(p double precision, blend double precision, n int)
returns numeric
language sql
immutable
set search_path = public
as $$
  select least(20.0, greatest(1.05,
    round((1.0 / (greatest(p * (1 - blend) + blend / n, 0.001) * 1.06))::numeric, 2)));
$$;

-- Full-time market odds from the current state. Returns a map outcome_key->odds.
-- match_result (home/draw/away) matches the old _live_odds exactly (cap 8,
-- blend 0.20). Other markets derive from the same joint score distribution.
create or replace function public._market_odds_ft(p_probs jsonb, p_minute int, p_hs int, p_as int)
returns jsonb
language plpgsql
immutable
set search_path = public
as $fn$
declare
  ph double precision := coalesce((p_probs ->> 'home')::double precision, 0.40);
  pa double precision := coalesce((p_probs ->> 'away')::double precision, 0.30);
  r  double precision := greatest(0.0, (90 - least(p_minute, 90))::double precision / 90.0);
  lh double precision := (0.6 + 1.7 * ph) * r;
  la double precision := (0.6 + 1.7 * pa) * r;
  cap int := 8;
  fh double precision[]; fa double precision[];
  hh int; aa int; fhome int; faway int; tot int;
  pk double precision; s double precision := 0;
  pw double precision := 0; pd double precision := 0; pl double precision := 0;
  o15 double precision := 0; o25 double precision := 0; o35 double precision := 0;
  bt double precision := 0; od double precision := 0;
begin
  for hh in 0 .. cap loop
    fh[hh] := exp(-lh) * power(lh, hh) / factorial(hh)::double precision;
    fa[hh] := exp(-la) * power(la, hh) / factorial(hh)::double precision;
  end loop;
  for hh in 0 .. cap loop
    for aa in 0 .. cap loop
      pk := fh[hh] * fa[aa];
      s := s + pk;
      fhome := p_hs + hh; faway := p_as + aa; tot := fhome + faway;
      if fhome > faway then pw := pw + pk; elsif fhome = faway then pd := pd + pk; else pl := pl + pk; end if;
      if tot > 1 then o15 := o15 + pk; end if;
      if tot > 2 then o25 := o25 + pk; end if;
      if tot > 3 then o35 := o35 + pk; end if;
      if fhome >= 1 and faway >= 1 then bt := bt + pk; end if;
      if (tot % 2) = 1 then od := od + pk; end if;
    end loop;
  end loop;
  if s <= 0 then s := 1; end if;
  pw := pw / s; pd := pd / s; pl := pl / s;
  o15 := o15 / s; o25 := o25 / s; o35 := o35 / s; bt := bt / s; od := od / s;

  return jsonb_build_object(
    'home', public._price(pw, 0.20, 3), 'draw', public._price(pd, 0.20, 3), 'away', public._price(pl, 0.20, 3),
    'dc_1x', public._price(pw + pd, 0, 1), 'dc_12', public._price(pw + pl, 0, 1), 'dc_x2', public._price(pd + pl, 0, 1),
    'ou15_over', public._price(o15, 0.12, 2), 'ou15_under', public._price(1 - o15, 0.12, 2),
    'ou25_over', public._price(o25, 0.12, 2), 'ou25_under', public._price(1 - o25, 0.12, 2),
    'ou35_over', public._price(o35, 0.12, 2), 'ou35_under', public._price(1 - o35, 0.12, 2),
    'btts_yes', public._price(bt, 0.12, 2), 'btts_no', public._price(1 - bt, 0.12, 2),
    'oe_odd', public._price(od, 0.12, 2), 'oe_even', public._price(1 - od, 0.12, 2));
end;
$fn$;

-- First-half market odds (pre-match). First half ~ half the match.
create or replace function public._market_odds_ht(p_probs jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $fn$
declare
  ph double precision := coalesce((p_probs ->> 'home')::double precision, 0.40);
  pa double precision := coalesce((p_probs ->> 'away')::double precision, 0.30);
  lh double precision := (0.6 + 1.7 * ph) * 0.5;
  la double precision := (0.6 + 1.7 * pa) * 0.5;
  cap int := 6;
  fh double precision[]; fa double precision[];
  hh int; aa int; pk double precision; s double precision := 0;
  pw double precision := 0; pd double precision := 0; pl double precision := 0; ov double precision := 0;
begin
  for hh in 0 .. cap loop
    fh[hh] := exp(-lh) * power(lh, hh) / factorial(hh)::double precision;
    fa[hh] := exp(-la) * power(la, hh) / factorial(hh)::double precision;
  end loop;
  for hh in 0 .. cap loop
    for aa in 0 .. cap loop
      pk := fh[hh] * fa[aa]; s := s + pk;
      if hh > aa then pw := pw + pk; elsif hh = aa then pd := pd + pk; else pl := pl + pk; end if;
      if hh + aa > 0 then ov := ov + pk; end if;
    end loop;
  end loop;
  if s <= 0 then s := 1; end if;
  pw := pw / s; pd := pd / s; pl := pl / s; ov := ov / s;
  return jsonb_build_object(
    'ht_home', public._price(pw, 0.20, 3), 'ht_draw', public._price(pd, 0.20, 3), 'ht_away', public._price(pl, 0.20, 3),
    'htou05_over', public._price(ov, 0.12, 2), 'htou05_under', public._price(1 - ov, 0.12, 2));
end;
$fn$;

-- _live_odds now reads the shared engine (match_result numbers unchanged).
create or replace function public._live_odds(p_probs jsonb, p_minute int, p_hs int, p_as int)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select public._market_odds_ft(p_probs, p_minute, p_hs, p_as);
$$;

-- Generate all markets for a match (idempotent per market_type).
create or replace function public._ensure_markets(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_match public.matches;
  v_ft jsonb;
  v_ht jsonb;
  v_mk uuid;
begin
  select * into v_match from public.matches where id = p_match_id;
  if not found then return; end if;
  v_ft := public._market_odds_ft(v_match.true_probabilities, 0, 0, 0);
  v_ht := public._market_odds_ht(v_match.true_probabilities);

  if not exists (select 1 from public.markets where match_id = p_match_id and market_type = 'match_result') then
    insert into public.markets (match_id, market_type, name, status, sort_order)
      values (p_match_id, 'match_result', 'Match Result', 'open', 0) returning id into v_mk;
    insert into public.market_options (market_id, label, outcome_key, odds, sort_order) values
      (v_mk, '1', 'home', (v_ft ->> 'home')::numeric, 0),
      (v_mk, 'X', 'draw', (v_ft ->> 'draw')::numeric, 1),
      (v_mk, '2', 'away', (v_ft ->> 'away')::numeric, 2);
  end if;

  if not exists (select 1 from public.markets where match_id = p_match_id and market_type = 'double_chance') then
    insert into public.markets (match_id, market_type, name, status, sort_order)
      values (p_match_id, 'double_chance', 'Double Chance', 'open', 1) returning id into v_mk;
    insert into public.market_options (market_id, label, outcome_key, odds, sort_order) values
      (v_mk, '1X', 'dc_1x', (v_ft ->> 'dc_1x')::numeric, 0),
      (v_mk, '12', 'dc_12', (v_ft ->> 'dc_12')::numeric, 1),
      (v_mk, 'X2', 'dc_x2', (v_ft ->> 'dc_x2')::numeric, 2);
  end if;

  if not exists (select 1 from public.markets where match_id = p_match_id and market_type = 'over_under_2_5') then
    insert into public.markets (match_id, market_type, name, status, sort_order)
      values (p_match_id, 'over_under_2_5', 'Total Goals 2.5', 'open', 2) returning id into v_mk;
    insert into public.market_options (market_id, label, outcome_key, odds, sort_order) values
      (v_mk, 'Over', 'ou25_over', (v_ft ->> 'ou25_over')::numeric, 0),
      (v_mk, 'Under', 'ou25_under', (v_ft ->> 'ou25_under')::numeric, 1);
  end if;

  if not exists (select 1 from public.markets where match_id = p_match_id and market_type = 'both_teams_score') then
    insert into public.markets (match_id, market_type, name, status, sort_order)
      values (p_match_id, 'both_teams_score', 'Both Teams to Score', 'open', 3) returning id into v_mk;
    insert into public.market_options (market_id, label, outcome_key, odds, sort_order) values
      (v_mk, 'Yes', 'btts_yes', (v_ft ->> 'btts_yes')::numeric, 0),
      (v_mk, 'No', 'btts_no', (v_ft ->> 'btts_no')::numeric, 1);
  end if;

  if not exists (select 1 from public.markets where match_id = p_match_id and market_type = 'over_under_1_5') then
    insert into public.markets (match_id, market_type, name, status, sort_order)
      values (p_match_id, 'over_under_1_5', 'Total Goals 1.5', 'open', 4) returning id into v_mk;
    insert into public.market_options (market_id, label, outcome_key, odds, sort_order) values
      (v_mk, 'Over', 'ou15_over', (v_ft ->> 'ou15_over')::numeric, 0),
      (v_mk, 'Under', 'ou15_under', (v_ft ->> 'ou15_under')::numeric, 1);
  end if;

  if not exists (select 1 from public.markets where match_id = p_match_id and market_type = 'over_under_3_5') then
    insert into public.markets (match_id, market_type, name, status, sort_order)
      values (p_match_id, 'over_under_3_5', 'Total Goals 3.5', 'open', 5) returning id into v_mk;
    insert into public.market_options (market_id, label, outcome_key, odds, sort_order) values
      (v_mk, 'Over', 'ou35_over', (v_ft ->> 'ou35_over')::numeric, 0),
      (v_mk, 'Under', 'ou35_under', (v_ft ->> 'ou35_under')::numeric, 1);
  end if;

  if not exists (select 1 from public.markets where match_id = p_match_id and market_type = 'odd_even') then
    insert into public.markets (match_id, market_type, name, status, sort_order)
      values (p_match_id, 'odd_even', 'Total Goals Odd/Even', 'open', 6) returning id into v_mk;
    insert into public.market_options (market_id, label, outcome_key, odds, sort_order) values
      (v_mk, 'Odd', 'oe_odd', (v_ft ->> 'oe_odd')::numeric, 0),
      (v_mk, 'Even', 'oe_even', (v_ft ->> 'oe_even')::numeric, 1);
  end if;

  if not exists (select 1 from public.markets where match_id = p_match_id and market_type = 'ht_result') then
    insert into public.markets (match_id, market_type, name, status, sort_order)
      values (p_match_id, 'ht_result', 'First Half Result', 'open', 7) returning id into v_mk;
    insert into public.market_options (market_id, label, outcome_key, odds, sort_order) values
      (v_mk, '1', 'ht_home', (v_ht ->> 'ht_home')::numeric, 0),
      (v_mk, 'X', 'ht_draw', (v_ht ->> 'ht_draw')::numeric, 1),
      (v_mk, '2', 'ht_away', (v_ht ->> 'ht_away')::numeric, 2);
  end if;

  if not exists (select 1 from public.markets where match_id = p_match_id and market_type = 'ht_over_under_0_5') then
    insert into public.markets (match_id, market_type, name, status, sort_order)
      values (p_match_id, 'ht_over_under_0_5', 'First Half 0.5', 'open', 8) returning id into v_mk;
    insert into public.market_options (market_id, label, outcome_key, odds, sort_order) values
      (v_mk, 'Over', 'htou05_over', (v_ht ->> 'htou05_over')::numeric, 0),
      (v_mk, 'Under', 'htou05_under', (v_ht ->> 'htou05_under')::numeric, 1);
  end if;
end;
$fn$;

-- Settle EVERY market from the one deterministic outcome + timeline.
create or replace function public._settle_markets(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  m public.matches;
  total int; ht_hs int; ht_as int; ht_total int;
  win text[] := '{}';
begin
  select * into m from public.matches where id = p_match_id;
  if m.result is null then return; end if;
  total := coalesce(m.home_score, 0) + coalesce(m.away_score, 0);

  select count(*) filter (where e ->> 'team' = 'home'), count(*) filter (where e ->> 'team' = 'away')
    into ht_hs, ht_as
    from jsonb_array_elements(coalesce(m.timeline, '[]'::jsonb)) e
   where (e ->> 'minute')::int <= 45;
  ht_hs := coalesce(ht_hs, 0); ht_as := coalesce(ht_as, 0); ht_total := ht_hs + ht_as;

  win := array_append(win, m.result);                                      -- match_result
  if m.result in ('home', 'draw') then win := array_append(win, 'dc_1x'); end if;
  if m.result in ('home', 'away') then win := array_append(win, 'dc_12'); end if;
  if m.result in ('draw', 'away') then win := array_append(win, 'dc_x2'); end if;
  win := array_append(win, case when total > 1 then 'ou15_over' else 'ou15_under' end);
  win := array_append(win, case when total > 2 then 'ou25_over' else 'ou25_under' end);
  win := array_append(win, case when total > 3 then 'ou35_over' else 'ou35_under' end);
  win := array_append(win, case when m.home_score >= 1 and m.away_score >= 1 then 'btts_yes' else 'btts_no' end);
  win := array_append(win, case when (total % 2) = 1 then 'oe_odd' else 'oe_even' end);
  win := array_append(win, case when ht_hs > ht_as then 'ht_home' when ht_hs < ht_as then 'ht_away' else 'ht_draw' end);
  win := array_append(win, case when ht_total > 0 then 'htou05_over' else 'htou05_under' end);

  update public.market_options mo
     set is_winner = (mo.outcome_key = any(win))
    from public.markets mk
   where mk.id = mo.market_id and mk.match_id = p_match_id;
  update public.markets set status = 'settled' where match_id = p_match_id and status <> 'settled';
end;
$fn$;

-- place_coupon: FT markets live-price at the current odds; HT markets are
-- pre-match only; finished / closing minutes reject.
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
      v_lock := rec.odds;                                  -- pre-match line (any market)
    else
      v_minute := least(90, floor(v_elapsed / v_dur * 90)::int);
      if v_minute >= 85 then raise exception 'market_closed'; end if;
      if rec.market_type in ('ht_result', 'ht_over_under_0_5') then raise exception 'market_closed'; end if;  -- first-half markets are pre-match only
      select count(*) filter (where e ->> 'team' = 'home'), count(*) filter (where e ->> 'team' = 'away')
        into v_hs, v_as from jsonb_array_elements(rec.secret -> 'events') e where (e ->> 'minute')::int <= v_minute;
      select count(*) filter (where c ->> 'team' = 'home'), count(*) filter (where c ->> 'team' = 'away')
        into v_rh, v_ra from jsonb_array_elements(coalesce(rec.secret -> 'cards', '[]'::jsonb)) c where (c ->> 'minute')::int <= v_minute;
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

-- Cash-out value across any market type: implied prob per open leg is 1/current
-- odds (live FT via the engine, otherwise the leg's locked line). Conservative.
create or replace function public._cashout_value(p_coupon_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_coupon public.coupons;
  r record;
  v_prob double precision := 1;
  v_now timestamptz := now();
  v_elapsed double precision; v_dur int; v_minute int;
  v_hs int; v_as int; v_rh int; v_ra int;
  v_probs jsonb; v_imp double precision;
  v_margin double precision := 0.06;
  v_dead boolean := false; v_open int := 0;
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
      if r.is_winner is true then v_prob := v_prob * 1; else v_dead := true; end if;
    else
      v_open := v_open + 1;
      if v_elapsed >= 0 and r.market_type not in ('ht_result', 'ht_over_under_0_5') then
        v_minute := least(90, floor(v_elapsed / v_dur * 90)::int);
        select count(*) filter (where e ->> 'team' = 'home'), count(*) filter (where e ->> 'team' = 'away')
          into v_hs, v_as from jsonb_array_elements(r.secret -> 'events') e where (e ->> 'minute')::int <= v_minute;
        select count(*) filter (where c ->> 'team' = 'home'), count(*) filter (where c ->> 'team' = 'away')
          into v_rh, v_ra from jsonb_array_elements(coalesce(r.secret -> 'cards', '[]'::jsonb)) c where (c ->> 'minute')::int <= v_minute;
        v_probs := jsonb_build_object(
          'home', (r.probs ->> 'home')::double precision * power(0.72, coalesce(v_rh, 0)),
          'away', (r.probs ->> 'away')::double precision * power(0.72, coalesce(v_ra, 0)));
        v_imp := 1.0 / (public._market_odds_ft(v_probs, v_minute, coalesce(v_hs, 0), coalesce(v_as, 0)) ->> r.outcome_key)::double precision;
      else
        v_imp := 1.0 / r.sel_odds;   -- upcoming or first-half leg: use the locked line
      end if;
      v_prob := v_prob * coalesce(v_imp, 0);
    end if;
  end loop;

  if v_dead or v_open = 0 then return 0; end if;
  return greatest(0, floor(v_coupon.potential_win * v_prob * (1 - v_margin))::int);
end;
$fn$;

revoke all on function public._cashout_value(uuid) from public, anon, authenticated;

-- Backfill the new markets onto matches still in play.
select public._ensure_markets(id)
  from public.matches
 where status <> 'finished';

revoke all on function public._price(double precision, double precision, int) from public, anon, authenticated;
revoke all on function public._market_odds_ft(jsonb, int, int, int) from public, anon, authenticated;
revoke all on function public._market_odds_ht(jsonb) from public, anon, authenticated;
