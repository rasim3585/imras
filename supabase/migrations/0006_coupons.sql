-- ============================================================================
-- pickplay.ai — 0006: gold + coupons (betting-style simulation, no real money)
-- ----------------------------------------------------------------------------
-- Adds a closed symbolic-GOLD economy on top of the simulated matches:
--   * profiles.gold_balance (starts at 1000) + a daily retention bonus
--   * coupons (a stake across one or more selections, combined odds multiply)
--   * coupon_selections (one pick per match inside a coupon)
--
-- Gold NEVER converts to money/prizes and CANNOT be purchased — fully closed.
--
-- Server-authoritative: odds, combined multiplier, potential win, stake
-- deduction and settlement all run here. The client never sets balances or
-- trusts its own odds. Match result generation is shared via _finalize_match.
-- Self-contained + idempotent.
-- ============================================================================

-- 1) balances -----------------------------------------------------------------
alter table public.profiles
  add column if not exists gold_balance       int not null default 1000,
  add column if not exists last_daily_bonus_at timestamptz;

-- 2) coupons ------------------------------------------------------------------
create table if not exists public.coupons (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  stake         int not null check (stake > 0),
  total_odds    numeric(12, 2) not null,
  potential_win int not null,
  status        text not null default 'pending'
                  check (status in ('pending', 'won', 'lost')),
  created_at    timestamptz not null default now(),
  settled_at    timestamptz
);
create index if not exists idx_coupons_user_status on public.coupons (user_id, status, created_at desc);

create table if not exists public.coupon_selections (
  id         uuid primary key default gen_random_uuid(),
  coupon_id  uuid not null references public.coupons (id) on delete cascade,
  match_id   uuid not null references public.matches (id),
  pick       text not null check (pick in ('home', 'draw', 'away')),
  odds       numeric(8, 2) not null,
  is_correct boolean,
  unique (coupon_id, match_id)   -- one selection per match within a coupon
);
create index if not exists idx_sel_coupon on public.coupon_selections (coupon_id);
create index if not exists idx_sel_match  on public.coupon_selections (match_id);

-- 3) RLS ----------------------------------------------------------------------
alter table public.coupons           enable row level security;
alter table public.coupon_selections enable row level security;

drop policy if exists coupons_select_own on public.coupons;
create policy coupons_select_own on public.coupons
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists sel_select_own on public.coupon_selections;
create policy sel_select_own on public.coupon_selections
  for select to authenticated
  using (exists (
    select 1 from public.coupons c
    where c.id = coupon_selections.coupon_id and c.user_id = auth.uid()
  ));

revoke all on public.coupons           from anon, authenticated;
revoke all on public.coupon_selections from anon, authenticated;
grant select on public.coupons           to authenticated;
grant select on public.coupon_selections to authenticated;
-- no client writes: coupons are created/settled only through the RPCs below.

-- 4) shared match finalizer (extracted so reveal + settle agree) --------------
create or replace function public._finalize_match(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_match  public.matches;
  v_probs  jsonb;
  v_r      double precision;
  v_ph     double precision;
  v_pd     double precision;
  v_result text;
  v_hs     int;
  v_as     int;
begin
  select * into v_match from public.matches where id = p_match_id for update;
  if not found or v_match.status = 'finished' then
    return;
  end if;

  v_probs := v_match.true_probabilities;
  v_ph := (v_probs ->> 'home')::double precision;
  v_pd := (v_probs ->> 'draw')::double precision;
  v_r  := random();
  if v_r < v_ph then
    v_result := 'home';
  elsif v_r < v_ph + v_pd then
    v_result := 'draw';
  else
    v_result := 'away';
  end if;

  if v_result = 'home' then
    v_hs := 1 + floor(random() * 3)::int;
    v_as := floor(random() * v_hs)::int;
  elsif v_result = 'away' then
    v_as := 1 + floor(random() * 3)::int;
    v_hs := floor(random() * v_as)::int;
  else
    v_hs := floor(random() * 4)::int;
    v_as := v_hs;
  end if;

  update public.matches
     set status = 'finished', result = v_result,
         home_score = v_hs, away_score = v_as
   where id = p_match_id;

  perform public._score_match(p_match_id);   -- harmless if no legacy predictions
end;
$fn$;

-- reveal_match now delegates finalization to the shared helper
create or replace function public.reveal_match(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid   uuid := auth.uid();
  v_match public.matches;
  v_pred  public.predictions;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._finalize_match(p_match_id);
  select * into v_match from public.matches where id = p_match_id;
  if not found then raise exception 'Match not found'; end if;
  select * into v_pred from public.predictions where match_id = p_match_id and user_id = v_uid;
  return jsonb_build_object(
    'match_id', v_match.id, 'home_team', v_match.home_team, 'away_team', v_match.away_team,
    'result', v_match.result, 'home_score', v_match.home_score, 'away_score', v_match.away_score,
    'odds', v_match.display_odds, 'your_pick', v_pred.pick,
    'is_correct', v_pred.is_correct, 'points_earned', v_pred.points_earned);
end;
$fn$;

-- 5) place a coupon (server computes odds/total/potential, deducts stake) ------
create or replace function public.place_coupon(p_selections jsonb, p_stake int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid      uuid := auth.uid();
  v_balance  int;
  v_count    int;
  v_total    numeric := 1;
  v_pot      int;
  v_coupon   uuid;
  sel        jsonb;
  v_mid      uuid;
  v_pick     text;
  v_match    public.matches;
  v_seen     uuid[] := '{}';
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if p_stake is null or p_stake <= 0 then raise exception 'Stake must be positive'; end if;

  v_count := jsonb_array_length(coalesce(p_selections, '[]'::jsonb));
  if v_count < 1 then raise exception 'Add at least one selection'; end if;
  if v_count > 10 then raise exception 'A coupon can hold at most 10 selections'; end if;

  select gold_balance into v_balance from public.profiles where id = v_uid for update;
  if v_balance < p_stake then raise exception 'Not enough gold'; end if;

  -- validate + compute combined odds (matches locked so odds are stable)
  for sel in select value from jsonb_array_elements(p_selections) loop
    v_mid  := (sel ->> 'match_id')::uuid;
    v_pick := sel ->> 'pick';
    if v_pick not in ('home', 'draw', 'away') then raise exception 'Invalid pick'; end if;
    if v_mid = any(v_seen) then raise exception 'The same match appears twice'; end if;
    v_seen := array_append(v_seen, v_mid);

    select * into v_match from public.matches where id = v_mid for update;
    if not found then raise exception 'Match not found'; end if;
    if v_match.status <> 'upcoming' or v_match.starts_at <= now() then
      raise exception 'Market closed: % vs %', v_match.home_team, v_match.away_team;
    end if;

    v_total := v_total * (v_match.display_odds ->> v_pick)::numeric;
  end loop;

  v_total := round(v_total, 2);
  v_pot   := round(p_stake * v_total)::int;

  insert into public.coupons (user_id, stake, total_odds, potential_win, status)
    values (v_uid, p_stake, v_total, v_pot, 'pending')
    returning id into v_coupon;

  for sel in select value from jsonb_array_elements(p_selections) loop
    v_mid  := (sel ->> 'match_id')::uuid;
    v_pick := sel ->> 'pick';
    insert into public.coupon_selections (coupon_id, match_id, pick, odds)
      values (v_coupon, v_mid, v_pick,
              (select (display_odds ->> v_pick)::numeric from public.matches where id = v_mid));
  end loop;

  update public.profiles set gold_balance = gold_balance - p_stake where id = v_uid;

  return jsonb_build_object(
    'coupon_id', v_coupon, 'total_odds', v_total,
    'potential_win', v_pot, 'new_balance', v_balance - p_stake);
end;
$fn$;

-- 6) settle a coupon (finalize its matches, evaluate, pay out on a full hit) ---
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
    -- finalize every match on the coupon
    for r in select match_id from public.coupon_selections where coupon_id = p_coupon_id loop
      perform public._finalize_match(r.match_id);
    end loop;

    -- grade each selection; a single miss loses the coupon
    for r in
      select cs.id, cs.pick, m.result
        from public.coupon_selections cs
        join public.matches m on m.id = cs.match_id
       where cs.coupon_id = p_coupon_id
    loop
      update public.coupon_selections set is_correct = (r.pick = r.result) where id = r.id;
      if r.pick is distinct from r.result then v_all_ok := false; end if;
    end loop;

    if v_all_ok then
      update public.coupons set status = 'won', settled_at = now() where id = p_coupon_id;
      update public.profiles set gold_balance = gold_balance + v_coupon.potential_win where id = v_uid;
    else
      update public.coupons set status = 'lost', settled_at = now() where id = p_coupon_id;
    end if;

    select * into v_coupon from public.coupons where id = p_coupon_id;
  end if;

  select gold_balance into v_bal from public.profiles where id = v_uid;

  select jsonb_agg(jsonb_build_object(
           'match_id', cs.match_id, 'home_team', m.home_team, 'away_team', m.away_team,
           'pick', cs.pick, 'odds', cs.odds, 'result', m.result,
           'home_score', m.home_score, 'away_score', m.away_score, 'is_correct', cs.is_correct)
           order by cs.id)
    into v_sels
    from public.coupon_selections cs
    join public.matches m on m.id = cs.match_id
   where cs.coupon_id = p_coupon_id;

  return jsonb_build_object(
    'coupon_id', v_coupon.id, 'status', v_coupon.status, 'stake', v_coupon.stake,
    'total_odds', v_coupon.total_odds, 'potential_win', v_coupon.potential_win,
    'new_balance', v_bal, 'selections', v_sels);
end;
$fn$;

-- 7) gold top-ups -------------------------------------------------------------
-- daily retention bonus: +500, once per calendar day
create or replace function public.claim_daily_bonus()
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid  uuid := auth.uid();
  v_last timestamptz;
  v_bal  int;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select last_daily_bonus_at, gold_balance into v_last, v_bal
    from public.profiles where id = v_uid for update;
  if v_last is not null and v_last::date >= now()::date then
    raise exception 'Daily bonus already claimed today';
  end if;
  update public.profiles
     set gold_balance = gold_balance + 500, last_daily_bonus_at = now()
   where id = v_uid;
  return jsonb_build_object('new_balance', v_bal + 500, 'awarded', 500);
end;
$fn$;

-- safety net: if you bust out (< 100), refill to 500 so you can keep playing
create or replace function public.topup_gold()
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_bal int;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select gold_balance into v_bal from public.profiles where id = v_uid for update;
  if v_bal >= 100 then raise exception 'Top-up is only available under 100 gold'; end if;
  update public.profiles set gold_balance = 500 where id = v_uid;
  return jsonb_build_object('new_balance', 500);
end;
$fn$;

-- 8) privileges ---------------------------------------------------------------
revoke all on function public._finalize_match(uuid)     from public, anon, authenticated;
revoke all on function public.place_coupon(jsonb, int)  from public, anon;
revoke all on function public.settle_coupon(uuid)       from public, anon;
revoke all on function public.claim_daily_bonus()       from public, anon;
revoke all on function public.topup_gold()              from public, anon;
grant execute on function public.place_coupon(jsonb, int) to authenticated;
grant execute on function public.settle_coupon(uuid)      to authenticated;
grant execute on function public.claim_daily_bonus()      to authenticated;
grant execute on function public.topup_gold()             to authenticated;
