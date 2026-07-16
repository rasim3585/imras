-- 0148: AI KUPON HAKEMİ v2 — ürünün kalbi (2026-07-16)
-- Rasim'in tezi: maç analiz eden uygulama çok; kullanıcının KENDİ bahis
-- davranışını bilen yargıç yalnız bizde olabilir. Bu migration hakemin
-- deterministik veri katmanını kurar; LLM (coupon-judge edge fn, Sonnet)
-- yalnız bu sayıları cümleye döker.
--
-- _coupon_judge_extras(p_user, p_selections, p_stake) → jsonb:
--   per_leg[]      : her bacak için kullanıcının O TAKIMLA kendi geçmişi
--                    (bets=bacak sayısı, won=tutan bacak, net=o takımlı
--                    kuponların toplam altın net'i) + is_live
--   behavior_now   : balance, stake_pct_balance, chase (son kupon kayıp +
--                    miktar >= 2x), last_result/last_stake, bets_last_hour,
--                    loss_streak (üst üste kayıp)
--   loyalty_traps[]: bu kupondaki takımlardan >=5 bahis + negatif net'liler
--                    ("duygusal takım" aynası)
--   maturity       : coupons, days_active, level new(<5)/forming(<20)/ready
--
-- coupon_review() bu ekstraları çıktısına birleştirir (ayrı statement,
-- canlı gövde base64 alınıp genişletildi). İlkeler: sayılar HEP deterministik;
-- ayna yalnız OKUR (stable, para yoluna dokunmaz); yeni _ fonksiyona
-- anon/authenticated EXECUTE YOK (0140).
-- Tam gövde SQL Editor'den uygulandı; bu dosya kayıttır.

do $mig$
begin
  execute $fn$
    create or replace function public._coupon_judge_extras(
      p_user uuid, p_selections jsonb, p_stake int)
    returns jsonb
    language plpgsql stable
    set search_path to 'public', 'pg_temp'
    as $body$
    declare
      v_map    jsonb := '{}'::jsonb;   -- takım adı -> {team,bets,won,net}
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

      -- kupondaki tüm takımların kullanıcı geçmişi (tek geçiş, sanal+gerçek düz)
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
      per_tc as (   -- takım x kupon: bacaklar + o kuponun net'i (tek sayım)
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

      -- bacak-başına: seçilen takım (home/away pick'lerinde o taraf; diğer
      -- marketlerde iki takımdan geçmişi daha kalın olan)
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

      -- takım tuzağı: bu kupondaki takımlardan >=5 bahis + negatif net
      for r in select value as v from jsonb_each(v_map)
      loop
        if (r.v ->> 'bets')::int >= 5 and (r.v ->> 'net')::int < 0 then
          v_traps := v_traps || r.v;
        end if;
      end loop;

      -- anlık davranış
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

      -- olgunluk
      select count(*)::int into v_n from public.coupons where user_id = p_user;
      v_days  := coalesce(extract(day from now() - v_joined)::int, 0);
      v_level := case when v_n < 5 then 'new' when v_n < 20 then 'forming' else 'ready' end;

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
          'coupons', v_n, 'days_active', v_days, 'level', v_level));
    end;
    $body$
  $fn$;

  execute 'revoke execute on function public._coupon_judge_extras(uuid,jsonb,int) from public, anon, authenticated';
end
$mig$;

-- İkinci adım (ayrı statement): coupon_review() sonuna
--   v_out := v_out || public._coupon_judge_extras(auth.uid(), p_selections, p_stake);
-- birleştirmesi eklendi (canlı gövde base64 alınıp genişletildi).
