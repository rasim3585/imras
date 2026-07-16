-- 0149: HAKEM HAFIZASI + KARNE + ÇAPRAZ-OYUN TİLT + KOTA (2026-07-16)
-- Rasim onayı: 6 öneriden 5'i (model-tabanlı adil olasılık aylık Nesine
-- turuna ertelendi — "kalibrasyon > teorik zarafet").
--
-- Kurum: hakem artık KAYIT TUTAR (judge_verdicts), YÜZLEŞTİRİR (settle
-- sonrası "hakem %9 demişti"), KANITLAR (karşı-olgusal: "uysaydın +X"),
-- platform-genel tilt'i görür (cross_games) ve kotalıdır (20/gün Sonnet).
--
-- İLKE KORUNUR: kupon-kararname bağlama TAMAMEN OKUMA-TARAFI lateral join
-- (aynı kullanıcı, kararname sonrası 15 dk, ~aynı toplam oran). Para yoluna
-- HİÇBİR dokunuş yok. "Uyarıldı" tanımı deterministik: prob<%20 VEYA chase
-- VEYA takım tuzağı>0.
--
-- Uygulama: aşağıdaki DO bloğu SQL Editor'den çalıştırıldı; bu dosya kayıt.

do $mig$
begin
  -- 1) kararname defteri
  execute $t$
    create table if not exists public.judge_verdicts (
      id bigint generated always as identity primary key,
      user_id uuid not null,
      legs int not null,
      stake int not null,
      total_odds numeric not null,
      prob_pct numeric,
      ev_gold numeric,
      chase boolean not null default false,
      traps int not null default 0,
      maturity text,
      verdict_text text,
      created_at timestamptz not null default now()
    )
  $t$;
  execute 'alter table public.judge_verdicts enable row level security';
  execute 'drop policy if exists jv_own_select on public.judge_verdicts';
  execute $t$create policy jv_own_select on public.judge_verdicts for select using (auth.uid() = user_id)$t$;
  execute 'create index if not exists judge_verdicts_user_time on public.judge_verdicts (user_id, created_at desc)';

  -- 2) kararname kaydı — FE, yargıç metni geldikten sonra çağırır
  execute $fn$
    create or replace function public.log_judge_verdict(p_review jsonb, p_text text)
    returns bigint
    language plpgsql volatile security definer
    set search_path to 'public','pg_temp'
    as $body$
    declare v_uid uuid := auth.uid(); v_id bigint;
    begin
      if v_uid is null then raise exception 'Not authenticated'; end if;
      insert into public.judge_verdicts
        (user_id, legs, stake, total_odds, prob_pct, ev_gold, chase, traps, maturity, verdict_text)
      values (
        v_uid,
        coalesce((p_review ->> 'legs')::int, 0),
        coalesce((p_review ->> 'stake')::numeric, 0)::int,
        coalesce((p_review ->> 'total_odds')::numeric, 0),
        (p_review ->> 'combined_prob_pct')::numeric,
        (p_review ->> 'ev_gold')::numeric,
        coalesce((p_review -> 'behavior_now' ->> 'chase')::boolean, false),
        coalesce(jsonb_array_length(p_review -> 'loyalty_traps'), 0),
        p_review -> 'maturity' ->> 'level',
        left(coalesce(p_text, ''), 2000))
      returning id into v_id;
      return v_id;
    end;
    $body$
  $fn$;

  -- 3) karne: iç fonksiyon (test edilebilir) + auth sarmalayıcı
  execute $fn$
    create or replace function public._judge_scorecard(p_user uuid)
    returns jsonb
    language sql stable
    set search_path to 'public','pg_temp'
    as $body$
      with v as (
        select jv.created_at,
               ((jv.prob_pct is not null and jv.prob_pct < 20) or jv.chase or jv.traps > 0) as warned,
               c.id as cid, c.status as cst, c.stake as cstake,
               c.potential_win as cpot, c.cashout_amount as ccash
        from public.judge_verdicts jv
        left join lateral (
          select c2.* from public.coupons c2
          where c2.user_id = jv.user_id
            and c2.created_at >= jv.created_at
            and c2.created_at <  jv.created_at + interval '15 minutes'
            and abs(c2.total_odds - jv.total_odds) < 0.015
          order by c2.created_at limit 1
        ) c on true
        where jv.user_id = p_user
      ),
      agg as (
        select
          count(*)::int as verdicts,
          count(*) filter (where cid is not null)::int as played,
          count(*) filter (where warned)::int as warned,
          count(*) filter (where warned and cid is not null)::int as warned_played,
          count(*) filter (where warned and cst = 'won')::int as warned_won,
          count(*) filter (where warned and cst = 'lost')::int as warned_lost,
          coalesce(sum(cstake) filter (where warned and cst = 'lost'), 0)::int as cost,
          coalesce(sum(case when cst = 'lost' then cstake
                            when cst = 'won'  then -(cpot - cstake)
                            when cst = 'cashed_out' then cstake - coalesce(ccash, 0)
                       end) filter (where warned), 0)::int as saved,
          count(*) filter (where created_at > now() - interval '7 days')::int as verdicts_7d,
          count(*) filter (where warned and cid is not null
                             and created_at > now() - interval '7 days')::int as warned_played_7d,
          coalesce(sum(cstake) filter (where warned and cst = 'lost'
                             and created_at > now() - interval '7 days'), 0)::int as cost_7d
        from v
      )
      select jsonb_build_object(
        'ready', verdicts > 0,
        'verdicts', verdicts, 'played', played,
        'warned', warned, 'warned_played', warned_played,
        'warned_won', warned_won, 'warned_lost', warned_lost,
        'gold_lost_after_warning', cost,
        'gold_saved_if_heeded', saved,
        'week', jsonb_build_object('verdicts', verdicts_7d,
                                   'warned_played', warned_played_7d,
                                   'cost', cost_7d))
      from agg;
    $body$
  $fn$;

  execute $fn$
    create or replace function public.judge_scorecard()
    returns jsonb language sql stable security definer
    set search_path to 'public','pg_temp'
    as $body$
      select case when auth.uid() is null
                  then jsonb_build_object('ready', false)
                  else public._judge_scorecard(auth.uid()) end;
    $body$
  $fn$;

  -- 4) yüzleşme: settle olmuş kuponlara bağlı kararname özetleri
  execute $fn$
    create or replace function public.judge_confrontations(p_coupon_ids uuid[])
    returns jsonb language sql stable security definer
    set search_path to 'public','pg_temp'
    as $body$
      select coalesce(jsonb_object_agg(cid, jsonb_build_object(
               'prob_pct', prob_pct, 'ev_gold', ev_gold, 'warned', warned)), '{}'::jsonb)
      from (
        select distinct on (c.id) c.id as cid, jv.prob_pct, jv.ev_gold,
               ((jv.prob_pct is not null and jv.prob_pct < 20) or jv.chase or jv.traps > 0) as warned
        from public.coupons c
        join public.judge_verdicts jv
          on jv.user_id = c.user_id
         and c.created_at >= jv.created_at
         and c.created_at <  jv.created_at + interval '15 minutes'
         and abs(c.total_odds - jv.total_odds) < 0.015
        where c.id = any(p_coupon_ids) and c.user_id = auth.uid()
        order by c.id, jv.created_at desc
      ) x;
    $body$
  $fn$;

  -- 5) _coupon_judge_extras v2.1: + judge_context + cross_games
  execute $fn$
    create or replace function public._coupon_judge_extras(
      p_user uuid, p_selections jsonb, p_stake int)
    returns jsonb
    language plpgsql stable
    set search_path to 'public', 'pg_temp'
    as $body$
    declare
      v_map    jsonb := '{}'::jsonb;
      v_per    jsonb := '[]'::jsonb;
      v_traps  jsonb := '[]'::jsonb;
      v_bal    int;
      v_joined timestamptz;
      v_n      int := 0;
      v_days   int := 0;
      v_level  text;
      v_last_res   text;
      v_last_stake int;
      v_chase  boolean := false;
      v_streak int := 0;
      v_hour   int := 0;
      v_jv int := 0; v_jwp int := 0; v_jcost int := 0;
      v_avc int := 0; v_avn int := 0; v_lkc int := 0; v_lkn int := 0;
      leg      jsonb;
      v_team   text;
      v_home   text;
      v_away   text;
      v_th     jsonb;
      v_live   boolean;
      r        record;
    begin
      if p_user is null then
        return jsonb_build_object(
          'maturity', jsonb_build_object('coupons', 0, 'days_active', 0, 'level', 'new'));
      end if;

      with sel_teams as (
        select distinct v.t
        from jsonb_array_elements(p_selections) s,
             lateral (values (s ->> 'home_team'), (s ->> 'away_team')) v(t)
        where v.t is not null and v.t <> ''
      ),
      hist as (
        select coalesce(m.home_team, rf.home_team) as ht,
               coalesce(m.away_team, rf.away_team) as at2,
               cs.leg_status,
               c.id as cid, c.status as cst, c.stake,
               c.potential_win, c.cashout_amount
        from public.coupon_selections cs
        join public.coupons c on c.id = cs.coupon_id
        left join public.market_options mo on mo.id = cs.market_option_id
        left join public.markets mk       on mk.id = mo.market_id
        left join public.matches m        on m.id  = mk.match_id
        left join public.real_fixtures rf on rf.id = cs.real_fixture_id
        where c.user_id = p_user
          and c.status in ('won', 'lost', 'cashed_out')
      ),
      per_tc as (
        select st.t as team, h.cid,
               count(*)::int as legs,
               count(*) filter (where h.leg_status = 'won')::int as legs_won,
               max(case when h.cst = 'won'  then h.potential_win - h.stake
                        when h.cst = 'lost' then -h.stake
                        else coalesce(h.cashout_amount, 0) - h.stake end)::int as netc
        from sel_teams st
        join hist h on h.ht = st.t or h.at2 = st.t
        group by st.t, h.cid
      ),
      per_team as (
        select team,
               sum(legs)::int      as bets,
               sum(legs_won)::int  as won,
               sum(netc)::int      as net
        from per_tc group by team
      )
      select coalesce(jsonb_object_agg(team,
               jsonb_build_object('team', team, 'bets', bets, 'won', won, 'net', net)),
             '{}'::jsonb)
        into v_map
        from per_team;

      for leg in select * from jsonb_array_elements(p_selections)
      loop
        v_home := leg ->> 'home_team';
        v_away := leg ->> 'away_team';
        v_team := case
          when (leg ->> 'outcome_key') like '%home%' or (leg ->> 'outcome_key') = 'home' then v_home
          when (leg ->> 'outcome_key') like '%away%' or (leg ->> 'outcome_key') = 'away' then v_away
          when coalesce((v_map -> v_home ->> 'bets')::int, 0)
             >= coalesce((v_map -> v_away ->> 'bets')::int, 0) then v_home
          else v_away
        end;
        v_th := v_map -> v_team;
        if v_th is not null and coalesce((v_th ->> 'bets')::int, 0) = 0 then
          v_th := null;
        end if;

        if (leg ->> 'kind') = 'real' then
          select (rf.status = 'inprogress') into v_live
            from public.real_fixtures rf where rf.id = (leg ->> 'match_id')::uuid;
        else
          select (m.status = 'upcoming' and m.starts_at <= now()) into v_live
            from public.matches m where m.id = (leg ->> 'match_id')::uuid;
        end if;

        v_per := v_per || jsonb_build_object(
          'match_id', leg ->> 'match_id',
          'match',    coalesce(v_home, '?') || ' - ' || coalesce(v_away, '?'),
          'kind',     leg ->> 'kind',
          'market',   coalesce(leg ->> 'market_name', leg ->> 'market_type'),
          'pick',     coalesce(leg ->> 'option_label', leg ->> 'outcome_key'),
          'odds',     coalesce((leg ->> 'odds')::numeric, 0),
          'is_live',  coalesce(v_live, false),
          'team_history', v_th);
      end loop;

      for r in select value as v from jsonb_each(v_map)
      loop
        if (r.v ->> 'bets')::int >= 5 and (r.v ->> 'net')::int < 0 then
          v_traps := v_traps || r.v;
        end if;
      end loop;

      select gold_balance, created_at into v_bal, v_joined
        from public.profiles where id = p_user;

      select c.status, c.stake into v_last_res, v_last_stake
        from public.coupons c
       where c.user_id = p_user and c.status in ('won', 'lost')
       order by c.settled_at desc nulls last limit 1;

      v_chase := (v_last_res = 'lost' and v_last_stake is not null
                  and p_stake >= 2 * v_last_stake);

      for r in
        select c.status from public.coupons c
         where c.user_id = p_user and c.status in ('won', 'lost')
         order by c.settled_at desc nulls last limit 20
      loop
        exit when r.status = 'won';
        v_streak := v_streak + 1;
      end loop;

      select count(*)::int into v_hour
        from public.coupons c
       where c.user_id = p_user and c.created_at > now() - interval '1 hour';

      select count(*)::int into v_n from public.coupons where user_id = p_user;
      v_days  := coalesce(extract(day from now() - v_joined)::int, 0);
      v_level := case when v_n < 5 then 'new' when v_n < 20 then 'forming' else 'ready' end;

      -- hakem bağlamı (son 30 gün): dinlenmeyen uyarılar + bedeli
      select count(*)::int,
             count(*) filter (where w and cid is not null)::int,
             coalesce(sum(cstake) filter (where w and cst = 'lost'), 0)::int
        into v_jv, v_jwp, v_jcost
        from (
          select ((jv.prob_pct is not null and jv.prob_pct < 20) or jv.chase or jv.traps > 0) as w,
                 c.id as cid, c.status as cst, c.stake as cstake
          from public.judge_verdicts jv
          left join lateral (
            select c2.id, c2.status, c2.stake from public.coupons c2
            where c2.user_id = jv.user_id
              and c2.created_at >= jv.created_at
              and c2.created_at <  jv.created_at + interval '15 minutes'
              and abs(c2.total_odds - jv.total_odds) < 0.015
            order by c2.created_at limit 1
          ) c on true
          where jv.user_id = p_user and jv.created_at > now() - interval '30 days'
        ) jx;

      -- çapraz oyun (son 1 saat): platform-genel tilt sinyali
      select count(*)::int, coalesce(sum(coalesce(payout, 0) - stake), 0)::int
        into v_avc, v_avn
        from public.aviator_bets
       where user_id = p_user and placed_at > now() - interval '1 hour';

      select count(*)::int, coalesce(sum(net), 0)::int into v_lkc, v_lkn from (
        select coalesce(payout, 0) - bet   as net from public.dice_rolls
          where user_id = p_user and created_at > now() - interval '1 hour'
        union all
        select coalesce(payout, 0) - bet   as net from public.plinko_drops
          where user_id = p_user and created_at > now() - interval '1 hour'
        union all
        select coalesce(payout, 0) - bet   as net from public.mines_games
          where user_id = p_user and created_at > now() - interval '1 hour'
        union all
        select coalesce(payout, 0) - stake as net from public.slot_spins
          where user_id = p_user and created_at > now() - interval '1 hour'
      ) l;

      return jsonb_build_object(
        'per_leg', v_per,
        'behavior_now', jsonb_build_object(
          'balance', coalesce(v_bal, 0),
          'stake_pct_balance',
            case when coalesce(v_bal, 0) > 0
                 then round(100.0 * p_stake / v_bal)::int end,
          'chase', v_chase,
          'last_result', v_last_res,
          'bets_last_hour', v_hour,
          'loss_streak', v_streak),
        'loyalty_traps', v_traps,
        'maturity', jsonb_build_object(
          'coupons', v_n, 'days_active', v_days, 'level', v_level),
        'judge_context', jsonb_build_object(
          'verdicts_30d', v_jv,
          'warned_played_30d', v_jwp,
          'gold_lost_after_warning_30d', v_jcost),
        'cross_games', jsonb_build_object(
          'aviator_last_hour', jsonb_build_object('plays', v_avc, 'net', v_avn),
          'luck_last_hour',    jsonb_build_object('plays', v_lkc, 'net', v_lkn)));
    end;
    $body$
  $fn$;

  -- 6) Sonnet kotası: 20 kararname/gün (yalnız service_role — edge fn çağırır)
  execute 'alter table public.ai_chat_usage add column if not exists judge_msgs int not null default 0';
  execute $fn$
    create or replace function public.judge_quota_take(p_user uuid)
    returns int language plpgsql volatile security definer
    set search_path to 'public','pg_temp'
    as $body$
    declare v_cnt int;
    begin
      insert into public.ai_chat_usage as u (user_id, day, msgs, judge_msgs)
      values (p_user, current_date, 0, 1)
      on conflict (user_id, day)
      do update set judge_msgs = u.judge_msgs + 1, updated_at = now()
      returning u.judge_msgs into v_cnt;
      if v_cnt > 20 then return -1; end if;
      return 20 - v_cnt;
    end;
    $body$
  $fn$;

  -- 7) erişim: iç/kota fonksiyonları dışarıya kapalı (0140 kuralı)
  execute 'revoke execute on function public._judge_scorecard(uuid) from public, anon, authenticated';
  execute 'revoke execute on function public._coupon_judge_extras(uuid,jsonb,int) from public, anon, authenticated';
  execute 'revoke execute on function public.judge_quota_take(uuid) from public, anon, authenticated';
  execute 'revoke execute on function public.log_judge_verdict(jsonb,text) from public, anon';
  execute 'revoke execute on function public.judge_scorecard() from public, anon';
  execute 'revoke execute on function public.judge_confrontations(uuid[]) from public, anon';
end
$mig$;
