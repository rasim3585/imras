-- ============================================================================
-- pickplay.ai - 0020: retention (daily bonus, win streak, leaderboard, tasks)
-- ----------------------------------------------------------------------------
-- 2.1 Daily login bonus escalates over a 7 day streak (50,75,100,150,200,300,
--     500 gold), then repeats. One claim per UTC day; a missed day resets it.
-- 2.2 Correct-prediction streak: a coupon that wins bumps the streak, a lost
--     coupon resets it (server side, via trigger; cash out is neutral).
-- 2.3 Leaderboard: weekly NET gold from settled coupons (winnings + cash outs
--     minus stakes) since the start of the UTC week. Server-computed so private
--     data is never exposed.
-- 2.4 Daily challenges: place 3 coupons / win a coupon / win a 2+ leg combo.
--     Progress is tracked by trigger; rewards are claimed once complete.
-- Pure ASCII. Idempotent. Gold stays closed + server-authoritative.
-- ============================================================================

alter table public.profiles add column if not exists login_streak int not null default 0;

-- 2.1 escalating daily bonus ------------------------------------------------
create or replace function public.claim_daily_bonus()
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_last timestamptz;
  v_streak int;
  v_bal int;
  v_today date := (now() at time zone 'utc')::date;
  v_rewards int[] := array[50, 75, 100, 150, 200, 300, 500];
  v_day int;
  v_award int;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select last_daily_bonus_at, login_streak, gold_balance into v_last, v_streak, v_bal
    from public.profiles where id = v_uid for update;

  if v_last is not null and (v_last at time zone 'utc')::date >= v_today then
    raise exception 'Daily bonus already claimed today';
  end if;
  if v_last is not null and (v_last at time zone 'utc')::date = v_today - 1 then
    v_streak := v_streak + 1;
  else
    v_streak := 1;
  end if;

  v_day := ((v_streak - 1) % 7) + 1;      -- 1..7 cycling
  v_award := v_rewards[v_day];

  update public.profiles
     set gold_balance = gold_balance + v_award, last_daily_bonus_at = now(), login_streak = v_streak
   where id = v_uid;

  return jsonb_build_object('awarded', v_award, 'streak_day', v_day,
    'login_streak', v_streak, 'new_balance', v_bal + v_award);
end;
$fn$;

-- 2.4 challenge progress ----------------------------------------------------
create table if not exists public.user_challenge_progress (
  user_id       uuid not null references public.profiles (id) on delete cascade,
  day           date not null,
  challenge_key text not null,
  progress      int not null default 0,
  claimed       boolean not null default false,
  primary key (user_id, day, challenge_key)
);
alter table public.user_challenge_progress enable row level security;
drop policy if exists ucp_select_own on public.user_challenge_progress;
create policy ucp_select_own on public.user_challenge_progress
  for select to authenticated using (auth.uid() = user_id);
revoke all on public.user_challenge_progress from anon, authenticated;
grant select on public.user_challenge_progress to authenticated;

create or replace function public._bump_challenge(p_uid uuid, p_key text, p_amt int, p_cap int)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  insert into public.user_challenge_progress (user_id, day, challenge_key, progress)
    values (p_uid, (now() at time zone 'utc')::date, p_key, least(p_amt, p_cap))
  on conflict (user_id, day, challenge_key)
    do update set progress = least(public.user_challenge_progress.progress + p_amt, p_cap);
end;
$fn$;

-- 2.2 + 2.4 trigger: streak + challenge progress on coupon lifecycle --------
create or replace function public._on_coupon_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if TG_OP = 'INSERT' then
    perform public._bump_challenge(NEW.user_id, 'place_3', 1, 3);
  elsif TG_OP = 'UPDATE' and OLD.status = 'pending' and NEW.status in ('won', 'lost') then
    if NEW.status = 'won' then
      update public.profiles
         set current_streak = current_streak + 1,
             best_streak = greatest(best_streak, current_streak + 1)
       where id = NEW.user_id;
      perform public._bump_challenge(NEW.user_id, 'win_any', 1, 1);
      if (select count(*) from public.coupon_selections where coupon_id = NEW.id) >= 2 then
        perform public._bump_challenge(NEW.user_id, 'win_combo', 1, 1);
      end if;
    else
      update public.profiles set current_streak = 0 where id = NEW.user_id;
    end if;
  end if;
  return NEW;
end;
$fn$;

drop trigger if exists on_coupon_change on public.coupons;
create trigger on_coupon_change
  after insert or update on public.coupons
  for each row execute function public._on_coupon_change();

-- today's challenges + progress
create or replace function public.get_challenges()
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'utc')::date;
  v_defs jsonb := jsonb_build_array(
    jsonb_build_object('key', 'place_3', 'label', 'Place 3 coupons', 'target', 3, 'reward', 60),
    jsonb_build_object('key', 'win_any', 'label', 'Win a coupon', 'target', 1, 'reward', 80),
    jsonb_build_object('key', 'win_combo', 'label', 'Win a 2+ leg combo', 'target', 1, 'reward', 150));
  d jsonb;
  v_prog int; v_claimed boolean;
  v_out jsonb := '[]'::jsonb;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  for d in select * from jsonb_array_elements(v_defs) loop
    select progress, claimed into v_prog, v_claimed
      from public.user_challenge_progress
     where user_id = v_uid and day = v_today and challenge_key = d ->> 'key';
    v_out := v_out || jsonb_build_object(
      'key', d ->> 'key', 'label', d ->> 'label',
      'target', (d ->> 'target')::int, 'reward', (d ->> 'reward')::int,
      'progress', coalesce(v_prog, 0), 'claimed', coalesce(v_claimed, false));
  end loop;
  return v_out;
end;
$fn$;

create or replace function public.claim_challenge(p_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'utc')::date;
  v_targets jsonb := jsonb_build_object('place_3', 3, 'win_any', 1, 'win_combo', 1);
  v_rewards jsonb := jsonb_build_object('place_3', 60, 'win_any', 80, 'win_combo', 150);
  v_prog int; v_claimed boolean; v_bal int; v_reward int; v_target int;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not (v_targets ? p_key) then raise exception 'Unknown challenge'; end if;
  v_target := (v_targets ->> p_key)::int;
  v_reward := (v_rewards ->> p_key)::int;

  select progress, claimed into v_prog, v_claimed
    from public.user_challenge_progress
   where user_id = v_uid and day = v_today and challenge_key = p_key for update;
  if coalesce(v_prog, 0) < v_target then raise exception 'Challenge not complete'; end if;
  if coalesce(v_claimed, false) then raise exception 'Already claimed'; end if;

  update public.user_challenge_progress set claimed = true
   where user_id = v_uid and day = v_today and challenge_key = p_key;
  update public.profiles set gold_balance = gold_balance + v_reward where id = v_uid;
  select gold_balance into v_bal from public.profiles where id = v_uid;
  return jsonb_build_object('awarded', v_reward, 'new_balance', v_bal);
end;
$fn$;

-- 2.3 weekly leaderboard ----------------------------------------------------
create index if not exists idx_coupons_settled on public.coupons (settled_at) where settled_at is not null;

create or replace function public.get_leaderboard()
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_week timestamptz := date_trunc('week', now());
  v_rows jsonb;
  v_me jsonb;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  with net as (
    select c.user_id,
           sum((case when c.status = 'won' then c.potential_win
                     when c.status = 'cashed_out' then coalesce(c.cashout_amount, 0)
                     else 0 end) - c.stake) as net
      from public.coupons c
     where c.settled_at >= v_week
     group by c.user_id
  ),
  ranked as (
    select n.user_id, p.username, n.net, rank() over (order by n.net desc) as rnk
      from net n join public.profiles p on p.id = n.user_id
  )
  select
    (select coalesce(jsonb_agg(jsonb_build_object('username', username, 'net', net, 'rank', rnk) order by rnk), '[]'::jsonb)
       from ranked where rnk <= 50),
    (select jsonb_build_object('rank', rnk, 'net', net) from ranked where user_id = v_uid)
  into v_rows, v_me;

  return jsonb_build_object('rows', v_rows, 'me', coalesce(v_me, jsonb_build_object('rank', null, 'net', 0)));
end;
$fn$;

revoke all on function public._bump_challenge(uuid, text, int, int) from public, anon, authenticated;
revoke all on function public.get_challenges() from public, anon;
revoke all on function public.claim_challenge(text) from public, anon;
revoke all on function public.get_leaderboard() from public, anon;
grant execute on function public.get_challenges() to authenticated;
grant execute on function public.claim_challenge(text) to authenticated;
grant execute on function public.get_leaderboard() to authenticated;
