-- ============================================================================
-- pickplay.ai - 0022: social layer (leagues, rivals, shared coupons)
-- ----------------------------------------------------------------------------
-- 3.1 Private leagues: create one, share an unguessable invite code, friends
--     join, see a league-only weekly net-gold table.
-- 3.2 Rivals: pin a friend, see a head-to-head comparison (all-time wins,
--     weekly net) plus a 7 day day-by-day record.
-- 3.3 Shared coupons: mark a coupon shared; a community feed shows recent shared
--     coupons (username + content only) and lets others copy them.
-- All server-computed via SECURITY DEFINER RPCs so only usernames + coupon
-- content leave the server (no balances, no private data). Pure ASCII. Idem.
-- ============================================================================

-- 3.1 leagues ---------------------------------------------------------------
create table if not exists public.leagues (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  invite_code text not null unique,
  created_at  timestamptz not null default now()
);
create table if not exists public.league_members (
  league_id uuid not null references public.leagues (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (league_id, user_id)
);
alter table public.leagues enable row level security;
alter table public.league_members enable row level security;
revoke all on public.leagues, public.league_members from anon, authenticated;
-- access is only through the RPCs below (definer), so no direct policies needed.

create or replace function public.create_league(p_name text)
returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_code text := substr(md5(gen_random_uuid()::text), 1, 10);
  v_id uuid;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if length(coalesce(trim(p_name), '')) < 2 then raise exception 'League name too short'; end if;
  insert into public.leagues (name, owner_id, invite_code) values (trim(p_name), v_uid, v_code) returning id into v_id;
  insert into public.league_members (league_id, user_id) values (v_id, v_uid);
  return jsonb_build_object('id', v_id, 'name', trim(p_name), 'invite_code', v_code);
end;
$fn$;

create or replace function public.join_league(p_code text)
returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_l public.leagues;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select * into v_l from public.leagues where invite_code = lower(trim(p_code));
  if not found then raise exception 'No league with that code'; end if;
  insert into public.league_members (league_id, user_id) values (v_l.id, v_uid) on conflict do nothing;
  return jsonb_build_object('id', v_l.id, 'name', v_l.name);
end;
$fn$;

create or replace function public.leave_league(p_league_id uuid)
returns void
language plpgsql security definer set search_path = public
as $fn$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  delete from public.league_members where league_id = p_league_id and user_id = auth.uid();
end;
$fn$;

create or replace function public.get_my_leagues()
returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', l.id, 'name', l.name, 'invite_code', l.invite_code,
      'members', (select count(*) from public.league_members m2 where m2.league_id = l.id),
      'is_owner', (l.owner_id = v_uid)) order by l.created_at)
    from public.leagues l
    join public.league_members m on m.league_id = l.id
    where m.user_id = v_uid), '[]'::jsonb);
end;
$fn$;

create or replace function public.get_league(p_league_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_l public.leagues;
  v_week timestamptz := date_trunc('week', now());
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from public.league_members where league_id = p_league_id and user_id = v_uid) then
    raise exception 'Not a member of this league';
  end if;
  select * into v_l from public.leagues where id = p_league_id;

  return jsonb_build_object(
    'id', v_l.id, 'name', v_l.name, 'invite_code', v_l.invite_code,
    'rows', coalesce((
      with net as (
        select c.user_id, sum((case when c.status='won' then c.potential_win when c.status='cashed_out' then coalesce(c.cashout_amount,0) else 0 end) - c.stake) net
          from public.coupons c
          join public.league_members m on m.user_id = c.user_id and m.league_id = p_league_id
         where c.settled_at >= v_week
         group by c.user_id
      ),
      ranked as (
        select p.username, coalesce(n.net, 0) as value,
               rank() over (order by coalesce(n.net, 0) desc) as rnk
          from public.league_members lm
          join public.profiles p on p.id = lm.user_id
          left join net n on n.user_id = lm.user_id
         where lm.league_id = p_league_id
      )
      select jsonb_agg(jsonb_build_object('username', username, 'value', value, 'rank', rnk) order by rnk)
        from ranked), '[]'::jsonb));
end;
$fn$;

-- 3.2 rivals ----------------------------------------------------------------
create table if not exists public.rivals (
  user_id  uuid not null references public.profiles (id) on delete cascade,
  rival_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, rival_id)
);
alter table public.rivals enable row level security;
revoke all on public.rivals from anon, authenticated;

create or replace function public.add_rival(p_username text)
returns void
language plpgsql security definer set search_path = public
as $fn$
declare v_uid uuid := auth.uid(); v_rid uuid;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select id into v_rid from public.profiles where username = p_username;
  if not found then raise exception 'No player with that username'; end if;
  if v_rid = v_uid then raise exception 'You cannot rival yourself'; end if;
  insert into public.rivals (user_id, rival_id) values (v_uid, v_rid) on conflict do nothing;
end;
$fn$;

create or replace function public.remove_rival(p_username text)
returns void
language plpgsql security definer set search_path = public
as $fn$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  delete from public.rivals where user_id = auth.uid()
    and rival_id = (select id from public.profiles where username = p_username);
end;
$fn$;

-- net per user over a period, used by rival comparison
create or replace function public._net_since(p_uid uuid, p_since timestamptz)
returns int
language sql stable security definer set search_path = public
as $$
  select coalesce(sum((case when status='won' then potential_win when status='cashed_out' then coalesce(cashout_amount,0) else 0 end) - stake), 0)::int
    from public.coupons where user_id = p_uid and settled_at >= p_since;
$$;

create or replace function public.get_rivals()
returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  r record;
  v_out jsonb := '[]'::jsonb;
  v_week timestamptz := date_trunc('week', now());
  v_my_won int; v_their_won int; v_my_net int; v_their_net int;
  v_my_pts int; v_their_pts int;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select count(*) filter (where status='won') into v_my_won from public.coupons where user_id = v_uid;

  for r in select rl.rival_id, p.username from public.rivals rl join public.profiles p on p.id = rl.rival_id where rl.user_id = v_uid loop
    select count(*) filter (where status='won') into v_their_won from public.coupons where user_id = r.rival_id;
    v_my_net := public._net_since(v_uid, v_week);
    v_their_net := public._net_since(r.rival_id, v_week);
    -- 7 day head to head: point per day to whoever had the higher net
    select
      count(*) filter (where mine > theirs), count(*) filter (where theirs > mine)
      into v_my_pts, v_their_pts
      from (
        select d.d,
          coalesce((select sum((case when c.status='won' then c.potential_win when c.status='cashed_out' then coalesce(c.cashout_amount,0) else 0 end)-c.stake) from public.coupons c where c.user_id=v_uid and c.settled_at::date = d.d),0) mine,
          coalesce((select sum((case when c.status='won' then c.potential_win when c.status='cashed_out' then coalesce(c.cashout_amount,0) else 0 end)-c.stake) from public.coupons c where c.user_id=r.rival_id and c.settled_at::date = d.d),0) theirs
        from generate_series((now()::date - 6), now()::date, interval '1 day') d(d)
      ) q;

    v_out := v_out || jsonb_build_object('username', r.username,
      'my_won', v_my_won, 'their_won', v_their_won,
      'my_net', v_my_net, 'their_net', v_their_net,
      'h2h_me', v_my_pts, 'h2h_them', v_their_pts,
      'leader', case when v_my_pts > v_their_pts then 'me' when v_their_pts > v_my_pts then 'them' else 'tie' end);
  end loop;
  return v_out;
end;
$fn$;

-- 3.3 shared coupons --------------------------------------------------------
alter table public.coupons add column if not exists shared_at timestamptz;

create or replace function public.share_coupon(p_coupon_id uuid)
returns void
language plpgsql security definer set search_path = public
as $fn$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  update public.coupons set shared_at = coalesce(shared_at, now())
   where id = p_coupon_id and user_id = auth.uid();
end;
$fn$;

create or replace function public.get_shared_feed()
returns jsonb
language plpgsql security definer set search_path = public
as $fn$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
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
      order by c.shared_at desc)
    from public.coupons c
    join public.profiles p on p.id = c.user_id
    where c.shared_at is not null
    limit 30), '[]'::jsonb);
end;
$fn$;

revoke all on function public._net_since(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.create_league(text), public.join_league(text), public.leave_league(uuid),
  public.get_my_leagues(), public.get_league(uuid), public.add_rival(text), public.remove_rival(text),
  public.get_rivals(), public.share_coupon(uuid), public.get_shared_feed() to authenticated;
