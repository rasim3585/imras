-- 0164: AUTH + PROFIL + SOSYAL SERTLESTIRME (Katman-2 denetiminin SON yuzeyi)
-- 2026-07-20. 17-ajanlik dusman-dogrulamali denetim: 14 dogrulanmis bulgu,
-- KRITIK/HIGH YOK. En onemli TEYIT (launch baskontrolu): kullanici RLS ile
-- kendi gold_balance'ini SISIREMEZ — authenticated'in profiles UPDATE'i YALNIZ
-- username kolonundaydi, gold_balance SELECT-only + CHECK(>=0). Para enjeksiyon
-- yuzeyi TEMIZ. Bu migration kalan medium/low'lari kapatir. Her degisiklik
-- canli gercekle + FE bagimliliklariyla dogrulandi (tahminle degil).
--
-- KAPSANAN BULGULAR:
--  #1/#4 (medium) username sunucu-dogrulamasi dogrudan PostgREST UPDATE ile bypass
--  #3    (medium) username benzersizligi buyuk/kucuk harf DUYARLI -> taklit
--  #6    (medium) get_league haftalik net yalniz kupon (global boardla tutarsiz)
--  #9    (low) claim_daily_bonus/claim_challenge bigint->int tasma
--  #14   (low) _net_since/get_rivals ::int tasma (0163 sinifi)
--  #10   (low) handle_new_user 8-hex gecici tanitici -> olcekte signup-collision
--  #8    (low) en-az-ayricalik: oyuncu-RPC'lerinden public/anon EXECUTE cekilir
--
-- ERTELENEN (rapora): #5 add_rival riza (Rasim urun karari), #2 aviator_bets
-- davranis kolonlari tablo-genelinde okunur -> deanonimizasyon: KALICI fix =
-- guvenlik-definer canli-tablo RPC'si + own-row gecmis + realtime yeniden
-- tasarim (yol haritasi #9). Kolon-grant yamasi DENENDI ama tablo-duzeyi SELECT
-- grant'i yuzunden no-op + Aviator realtime aboneligi (useAviator.ts:189) payload
-- belirsizligi tasidigi icin ISTENEREK ertelendi (workaround degil kalici cozum
-- ilkesi). #7 match_comments user_id (FE degisikligi ister), #11 coupon-judge
-- fail-open (edge — ayri deploy: bu oturumda yapiliyor), #13 "kazanan" tanim
-- birligi (3 fonksiyon + FE). seed_matches authenticated'a BIREBIR BIRAKILDI:
-- FE ensureMatches onu cagiriyor (revoke = sanal maci kirar).

-- ============================================================================
-- 1) [#1/#4] username yazisini set_username RPC'sine ZORLA (0140 kalibi).
--    FE 'profiles'a HIC dogrudan .update() yapmiyor -> grant'i cekmek guvenli.
--    (gold_balance zaten authenticated'a UPDATE-kapali — para bariyeri saglam.)
revoke update (username) on public.profiles from authenticated;

-- ============================================================================
-- 2) [#3] username benzersizligini BUYUK/KUCUK HARF DUYARSIZ yap ('rasim'='Rasim').
--    Mevcut veride case-collision YOK (olculdu). set_username'in UPDATE'i
--    case-collision'da unique_violation atar -> zaten 'already taken' yakalanir.
create unique index if not exists profiles_username_lower_key
  on public.profiles (lower(username));

-- ============================================================================
-- NOT: [#2] aviator_bets davranis-kolonu kisitlamasi BILEREK BURADA YOK.
--    authenticated'in tablo-duzeyi SELECT grant'i var -> kolon-revoke no-op;
--    ayrica useAviator.ts:189 aviator_bets postgres_changes aboneligi payload
--    belirsizligi tasir. Kalici cozum yol haritasi #9'da (canli-tablo RPC'si +
--    own-row gecmis + realtime yeniden tasarim). Half-measure eklemedik.

-- ============================================================================
-- 4) [#6] get_league haftalik net'i get_leaderboard (0134/0146) ile BIREBIR ayni
--    cok-oyun tanimina getir: kupon+aviator+slot+dice+plinko+mines (lig uyeleriyle
--    sinirli). Aksi halde yalniz Aviator/sans oynayan uye ligde net 0 gorunuyordu.
create or replace function public.get_league(p_league_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
      with mem as (
        select user_id from public.league_members where league_id = p_league_id
      ),
      net as (
        select u.user_id, sum(u.v) as net from (
          select c.user_id,
                 (case when c.status='won' then c.potential_win
                       when c.status='cashed_out' then coalesce(c.cashout_amount,0)
                       else 0 end) - c.stake as v
            from public.coupons c
            where c.user_id in (select user_id from mem) and c.settled_at >= v_week
          union all
          select b.user_id, coalesce(b.payout,0) - b.stake
            from public.aviator_bets b
            where b.user_id in (select user_id from mem) and b.placed_at >= v_week and b.status <> 'placed'
          union all
          select s.user_id, s.payout - s.stake
            from public.slot_spins s
            where s.user_id in (select user_id from mem) and s.created_at >= v_week
          union all
          select d.user_id, d.payout - d.bet
            from public.dice_rolls d
            where d.user_id in (select user_id from mem) and d.created_at >= v_week
          union all
          select pl.user_id, pl.payout - pl.bet
            from public.plinko_drops pl
            where pl.user_id in (select user_id from mem) and pl.created_at >= v_week
          union all
          select m.user_id, m.payout - m.bet
            from public.mines_games m
            where m.user_id in (select user_id from mem) and m.status <> 'active' and m.created_at >= v_week
        ) u group by u.user_id
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
$function$;

-- ============================================================================
-- 5) [#9] claim_daily_bonus + claim_challenge: gold_balance (bigint) int local'e
--    okuyordu -> 2^31 ustu bakiyede 'integer out of range', bonus/gorev KALICI
--    bloklanir. v_bal -> bigint. Govdeler aynen; yalniz tip degisti.
create or replace function public.claim_daily_bonus()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_last timestamptz;
  v_streak int;
  v_bal bigint;
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

  v_day := ((v_streak - 1) % 7) + 1;
  v_award := v_rewards[v_day];

  update public.profiles
     set gold_balance = gold_balance + v_award, last_daily_bonus_at = now(), login_streak = v_streak
   where id = v_uid;

  return jsonb_build_object('awarded', v_award, 'streak_day', v_day,
    'login_streak', v_streak, 'new_balance', v_bal + v_award);
end;
$function$;

create or replace function public.claim_challenge(p_key text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'utc')::date;
  v_targets jsonb := jsonb_build_object('place_3', 3, 'win_any', 1, 'win_combo', 1);
  v_rewards jsonb := jsonb_build_object('place_3', 60, 'win_any', 80, 'win_combo', 150);
  v_prog int; v_claimed boolean; v_bal bigint; v_reward int; v_target int;
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
$function$;

-- ============================================================================
-- 6) [#14] _net_since ::int tasma (0163 sinifi). RETURNS bigint + ::bigint.
--    Return-tipi degisimi CREATE OR REPLACE ile olmaz -> DROP+CREATE.
--    Yeni fonksiyon default PUBLIC EXECUTE alir -> /rpc/_net_since ile HERKESE
--    her kullanicinin net'ini acardi; hemen REVOKE et (yalniz get_rivals cagirir,
--    o da SECURITY DEFINER owner olarak koser, grant'a ihtiyaci yok).
drop function if exists public._net_since(uuid, timestamptz);
create function public._net_since(p_uid uuid, p_since timestamptz)
returns bigint
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(sum((case when status='won' then potential_win when status='cashed_out' then coalesce(cashout_amount,0) else 0 end) - stake), 0)::bigint
    from public.coupons where user_id = p_uid and settled_at >= p_since;
$function$;
revoke execute on function public._net_since(uuid, timestamptz) from public, anon, authenticated;

-- get_rivals net local'leri int -> bigint (aksi halde _net_since'in bigint donusu
-- int local'e atanirken tasar). Govde aynen; yalniz v_my_net/v_their_net tipi.
create or replace function public.get_rivals()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  r record;
  v_out jsonb := '[]'::jsonb;
  v_week timestamptz := date_trunc('week', now());
  v_my_won int; v_their_won int; v_my_net bigint; v_their_net bigint;
  v_my_pts int; v_their_pts int;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select count(*) filter (where status='won') into v_my_won from public.coupons where user_id = v_uid;

  for r in select rl.rival_id, p.username from public.rivals rl join public.profiles p on p.id = rl.rival_id where rl.user_id = v_uid loop
    select count(*) filter (where status='won') into v_their_won from public.coupons where user_id = r.rival_id;
    v_my_net := public._net_since(v_uid, v_week);
    v_their_net := public._net_since(r.rival_id, v_week);
    -- 7 gunluk kafa-kafaya: her gun daha yuksek net kime aitse ona puan
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
$function$;

-- ============================================================================
-- 7) [#10] handle_new_user gecici tanitici uuid'nin yalniz 8 hex'ini kullaniyordu
--    (2^32) -> ~77k kayitta %50 username-collision -> 2. kayit
--    profiles_username_key ihlaliyle DUSER (on conflict yalniz id'yi yutuyor).
--    12 hex'e cikar (2^48). set_username provisional guard'ini de tum player_+hex
--    namespace'i (6+ hex) kapsayacak sekilde genislet.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    -- gecici tanitici; kullanici gercegini set_username() ile secer
    'player_' || substr(replace(new.id::text, '-', ''), 1, 12)
  )
  on conflict (id) do nothing;
  return new;
end;
$function$;

create or replace function public.set_username(p_username text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if p_username !~ '^[A-Za-z0-9_]{3,20}$' then
    raise exception 'Username must be 3-20 characters: letters, numbers, underscore';
  end if;
  -- gecici tanitici namespace (player_ + 6+ hex) kullanici adi OLARAK secilemez
  if p_username ~* '^player_[0-9a-f]{6,}$' then
    raise exception 'Username must be 3-20 characters: letters, numbers, underscore';
  end if;

  update public.profiles set username = p_username where id = v_uid;

exception when unique_violation then
  -- hem exact hem lower(username) benzersiz indeksini kapsar (case-taklidi dahil)
  raise exception 'That username is already taken';
end;
$function$;

-- ============================================================================
-- 8) [#8] EN AZ AYRICALIK: oturum gerektiren oyuncu-RPC'lerinden public+anon
--    EXECUTE'u cek (authenticated'in AYRI grant'i kalir; fonksiyonlar zaten
--    auth.uid() null'da 'giris gerekli' atiyordu — aktif somuru yok, yuzey daralt).
--    seed_matches HARIC: FE ensureMatches onu authenticated olarak cagiriyor.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('aviator_place_bet','aviator_cashout','dice_roll','plinko_drop',
                         'create_league','join_league','leave_league','add_rival','remove_rival')
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
  end loop;
end $$;

-- ============================================================================
-- KATMAN-1 AGI: bu 8 duzeltmenin sessiz regresyonunu yakalamak icin test schema'sina
-- test.auth_social() (11 assertion) eklendi + test.run_all() 5. suite olarak baglar
-- (govdeler canli DB'de, 0160 konvansiyonu). Ilk kosu: 84/84 yesil. Kapsanan
-- kalkanlar: para bariyeri (gold_balance authenticated UPDATE-kapali), username
-- UPDATE cekildi, lower(username) unique, _net_since anon/auth EXECUTE-kapali +
-- bigint, get_rivals bigint, claim_* bigint, get_league cok-oyun net, 12-hex
-- gecici tanitici, set_username genis guard, anon oyuncu-RPC EXECUTE-kapali.
--
-- EDGE (ayni oturum, MCP ile deploy — git'ten deploy olmaz): coupon-judge v7,
-- [#11] fail-OPEN kapatildi: uid artik dogrulanmis getUser() ile alinir (anon
-- anahtarla kotasiz Sonnet cagrisi engellendi -> {text:null,reason:'auth'};
-- canli anon-key testiyle dogrulandi). verify_jwt=true korundu.

-- ============================================================================
-- KATMAN-1 ASSERTION'LARI (test schema — 0160 gibi ama bu sefer repo'da TAM
-- govde, yeniden uretilebilir olsun diye). test.run_all()'a 5. suite baglanir.
create or replace function test.auth_social()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  fails jsonb := '[]'::jsonb; n int := 0; p int := 0;
  v_body text; v_ret oid;
begin
  -- 1) PARA BARIYERI: authenticated gold_balance'i UPDATE edemez
  n := n+1;
  if not has_column_privilege('authenticated', 'public.profiles'::regclass, 'gold_balance', 'UPDATE') then p := p+1;
  else fails := fails || jsonb_build_object('suite','auth','test','gold_balance authenticated UPDATE OLMAMALI','got','YAZILABILIR'); end if;

  -- 2) username kolon-UPDATE grant'i cekildi
  n := n+1;
  if not has_column_privilege('authenticated', 'public.profiles'::regclass, 'username', 'UPDATE') then p := p+1;
  else fails := fails || jsonb_build_object('suite','auth','test','username authenticated UPDATE cekilmeli','got','YAZILABILIR'); end if;

  -- 3) lower(username) benzersiz indeksi var
  n := n+1;
  if exists (select 1 from pg_indexes where schemaname='public' and indexname='profiles_username_lower_key') then p := p+1;
  else fails := fails || jsonb_build_object('suite','auth','test','lower(username) unique index','got','yok'); end if;

  -- 4) _net_since anon/auth EXECUTE olmamali (DROP+CREATE default PUBLIC-grant tuzagi)
  n := n+1;
  select oid into v_ret from pg_proc where proname='_net_since' and pronamespace='public'::regnamespace limit 1;
  if v_ret is not null and not has_function_privilege('anon', v_ret, 'EXECUTE')
     and not has_function_privilege('authenticated', v_ret, 'EXECUTE') then p := p+1;
  else fails := fails || jsonb_build_object('suite','auth','test','_net_since anon/auth EXECUTE olmamali','got','calistirilabilir'); end if;

  -- 5) _net_since bigint dondurur
  n := n+1;
  select prorettype into v_ret from pg_proc where proname='_net_since' and pronamespace='public'::regnamespace;
  if v_ret = 'bigint'::regtype then p := p+1;
  else fails := fails || jsonb_build_object('suite','auth','test','_net_since bigint','got',coalesce(v_ret::regtype::text,'yok')); end if;

  -- 6) get_rivals net local'leri bigint
  n := n+1;
  v_body := pg_get_functiondef('public.get_rivals'::regproc);
  if v_body ilike '%v_my_net bigint%' and v_body ilike '%v_their_net bigint%' then p := p+1;
  else fails := fails || jsonb_build_object('suite','auth','test','get_rivals net bigint','got','int'); end if;

  -- 7) claim_daily_bonus + claim_challenge v_bal bigint
  n := n+1;
  if pg_get_functiondef('public.claim_daily_bonus'::regproc) ilike '%v_bal bigint%'
     and pg_get_functiondef('public.claim_challenge'::regproc) ilike '%v_bal bigint%' then p := p+1;
  else fails := fails || jsonb_build_object('suite','auth','test','claim_* v_bal bigint','got','int'); end if;

  -- 8) get_league cok-oyun net
  n := n+1;
  v_body := pg_get_functiondef('public.get_league'::regproc);
  if v_body ilike '%aviator_bets%' and v_body ilike '%slot_spins%' and v_body ilike '%mines_games%' then p := p+1;
  else fails := fails || jsonb_build_object('suite','auth','test','get_league cok-oyun net','got','yalniz kupon'); end if;

  -- 9) handle_new_user 12 hex gecici tanitici
  n := n+1;
  if pg_get_functiondef('public.handle_new_user'::regproc) ilike '%, 1, 12)%' then p := p+1;
  else fails := fails || jsonb_build_object('suite','auth','test','handle_new_user 12 hex','got','8 hex'); end if;

  -- 10) set_username provisional guard genis (player_ + 6+ hex)
  n := n+1;
  if pg_get_functiondef('public.set_username'::regproc) ilike '%player_[0-9a-f]{6,}%' then p := p+1;
  else fails := fails || jsonb_build_object('suite','auth','test','set_username guard genis','got','dar'); end if;

  -- 11) EN AZ AYRICALIK: anon aviator_place_bet CALISTIRAMAZ
  n := n+1;
  select oid into v_ret from pg_proc where proname='aviator_place_bet' and pronamespace='public'::regnamespace limit 1;
  if v_ret is not null and not has_function_privilege('anon', v_ret, 'EXECUTE') then p := p+1;
  else fails := fails || jsonb_build_object('suite','auth','test','anon aviator_place_bet EXECUTE olmamali','got','calistirilabilir'); end if;

  return jsonb_build_object('ok', jsonb_array_length(fails)=0,
    'passed', p, 'failed', jsonb_array_length(fails), 'total', n, 'failures', fails, 'at', now());
end;
$function$;

create or replace function test.run_all()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  a jsonb := test.money_path(); b jsonb := test.settle_flow();
  c jsonb := test.luck_math(); d jsonb := test.aviator_math();
  e jsonb := test.auth_social();
  v_ok boolean := (a->>'ok')::boolean and (b->>'ok')::boolean and (c->>'ok')::boolean and (d->>'ok')::boolean and (e->>'ok')::boolean;
  v_pass int := (a->>'passed')::int+(b->>'passed')::int+(c->>'passed')::int+(d->>'passed')::int+(e->>'passed')::int;
  v_fail int := (a->>'failed')::int+(b->>'failed')::int+(c->>'failed')::int+(d->>'failed')::int+(e->>'failed')::int;
  v_tot int := (a->>'total')::int+(b->>'total')::int+(c->>'total')::int+(d->>'total')::int+(e->>'total')::int;
begin
  insert into test.log (ok, passed, failed, total, report)
  values (v_ok, v_pass, v_fail, v_tot,
    case when v_ok then null else jsonb_build_object('money_path',a,'settle_flow',b,'luck_math',c,'aviator_math',d,'auth_social',e) end);
  return jsonb_build_object('ok', v_ok, 'passed', v_pass, 'failed', v_fail, 'total', v_tot, 'at', now());
end;
$function$;
