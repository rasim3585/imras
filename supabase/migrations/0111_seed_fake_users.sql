-- SAHTE VERİ ÜRETİMİ (DEV/DEMO) — çapraz-ürün davranış analizini beklemeden
-- kurmak için persona-tabanlı sahte kullanıcılar + tutarlı geçmiş. auth.users'a id
-- eklenir (on_auth_user_created trigger'ı provisional profil kurar), sonra profil
-- güncellenir. Aviator TUTARLI üretilir (gerçek round crash_point'e göre kazanç/
-- yakalanma) → ayna gerçek sinyal görür; her kullanıcıya FARKLI round örneklemi
-- (unique round_id,user_id,slot). Sadece 'sim_' önekli kullanıcılar; İDEMPOTENT
-- (baştan tüm sim verisini siler). Personalar: chaser, disciplined, casual, whale,
-- slotlover, couponer — analitik çeşitliliği ve benchmark için.
--
-- NOT: Bu bir veri (seed) migration'ıdır, şema değiştirmez. Prod-benzeri tek ortam
-- olduğu için repoda tutulur; yeniden çalıştırmak güvenlidir.

do $$
declare
  personas text[] := array['chaser','disciplined','casual','whale','slotlover','couponer'];
  persona text; uid uuid; uname text;
  i int; k int; n int;
  rids bigint[]; rcps numeric[];
  t timestamptz; stake int; tgt numeric; cp numeric; won boolean; auto boolean;
  prev_res text; prev_st int;
  b int; pay int; bw int; ms int; tm int; ante boolean;
  odds numeric; pot int; pwin numeric; st text;
begin
  create temp table _sim on commit drop as
    select id from public.profiles where username like 'sim\_%';
  delete from public.aviator_bets    where user_id in (select id from _sim);
  delete from public.slot_spins      where user_id in (select id from _sim);
  delete from public.coupons         where user_id in (select id from _sim);
  delete from public.behavior_events where user_id in (select id from _sim);
  delete from public.profiles        where id in (select id from _sim);
  delete from auth.users             where id in (select id from _sim);

  for i in 1..36 loop
    persona := personas[1 + (i % array_length(personas,1))];
    uid := gen_random_uuid();
    uname := 'sim_' || persona || '_' || i;
    insert into auth.users(id, is_sso_user, is_anonymous) values (uid, false, false);
    update public.profiles set username = uname,
      created_at = now() - (random()*60 + 5) * interval '1 day',
      gold_balance = (random()*2000000)::int + 50000,
      skill_rating = (random()*800)::int + 700
      where id = uid;

    -- ===== AVIATOR (tutarlı, farklı round örneklemi) =====
    n := case persona when 'chaser' then 60+(random()*60)::int
                      when 'whale' then 30+(random()*50)::int
                      when 'disciplined' then 40+(random()*50)::int
                      when 'slotlover' then (random()*15)::int
                      when 'couponer' then (random()*12)::int
                      else 15+(random()*40)::int end;
    if n > 0 then
      select array_agg(id order by rn), array_agg(crash_point order by rn) into rids, rcps
      from (select id, crash_point, row_number() over (order by random()) rn
            from public.aviator_rounds where status='crashed' limit n) s;
    end if;
    t := now() - interval '45 days'; prev_res := null; prev_st := null;
    for k in 1..greatest(n,0) loop
      t := t + (random()*180 + 10) * interval '1 minute';
      stake := case persona when 'whale' then 3000+(random()*12000)::int
                            when 'chaser' then 500+(random()*1800)::int
                            when 'disciplined' then 100+(random()*300)::int
                            else 100+(random()*600)::int end;
      if prev_res='lost' and persona in ('chaser','whale') then stake := (stake*1.6)::int; end if;
      auto := case persona when 'disciplined' then random()<0.7
                           when 'casual' then random()<0.3 else random()<0.1 end;
      tgt := case persona when 'chaser' then 2.5+(random()*4)
                          when 'whale' then 2.0+(random()*3.5)
                          when 'disciplined' then 1.3+(random()*0.6)
                          else 1.5+(random()*2) end;
      tgt := round(tgt,2); cp := rcps[k]; won := (tgt <= cp);
      insert into public.aviator_bets(round_id, user_id, slot, stake, auto_cashout_at,
        status, was_auto, caught_by_crash, cashout_multiplier, payout, placed_at,
        cashed_at, prev_result, prev_stake)
      values (rids[k], uid, 1, stake, case when auto then tgt else null end,
        case when won then 'won' else 'lost' end, auto, not won,
        case when won then tgt else null end,
        case when won then floor(stake*tgt)::int else 0 end, t,
        case when won then t else null end, prev_res, prev_st);
      prev_res := case when won then 'won' else 'lost' end; prev_st := stake;
    end loop;

    -- ===== SLOT =====
    n := case persona when 'slotlover' then 80+(random()*120)::int
                      when 'casual' then 20+(random()*40)::int
                      when 'couponer' then (random()*15)::int
                      else 10+(random()*40)::int end;
    t := now() - interval '40 days'; prev_res := null; prev_st := null;
    for k in 1..greatest(n,0) loop
      t := t + (random()*90 + 5) * interval '1 minute';
      b := (array[20,50,100,200,500])[1+(random()*4)::int];
      ante := random() < 0.3; stake := b + case when ante then (b*0.25)::int else 0 end;
      if random() < 0.27 then
        bw := (stake * (0.5+random()*3))::int; ms := 1+(random()*15)::int;
        pay := (bw * greatest(ms,1) * (0.4+random()*1.2))::int; tm := 1+(random()*6)::int;
      else bw := 0; ms := 0; pay := 0; tm := (random()*3)::int; end if;
      insert into public.slot_spins(user_id, bet, ante, stake, seed, base_win, mult_sum,
        payout, tumbles, prev_result, prev_bet, created_at, buy, bonus, free_spins)
      values (uid, b, ante, stake, md5(random()::text), bw, ms, pay, tm,
        prev_res, prev_st, t, false, ms>0 and random()<0.2, case when ms>0 then (random()*8)::int else 0 end);
      prev_res := case when pay>stake then 'win' else 'loss' end; prev_st := b;
    end loop;

    -- ===== KUPON (maç bahisleri) =====
    n := case persona when 'couponer' then 120+(random()*200)::int
                      when 'chaser' then 40+(random()*80)::int
                      when 'slotlover' then (random()*20)::int
                      else 25+(random()*70)::int end;
    t := now() - interval '50 days';
    for k in 1..greatest(n,0) loop
      t := t + (random()*240 + 20) * interval '1 minute';
      stake := case persona when 'whale' then 2000+(random()*8000)::int
                            when 'couponer' then 100+(random()*400)::int
                            else 100+(random()*700)::int end;
      odds := case persona when 'chaser' then round((3+random()*25)::numeric,2)
                           when 'disciplined' then round((1.4+random()*1.6)::numeric,2)
                           else round((1.6+random()*6)::numeric,2) end;
      pot := floor(stake*odds)::int;
      pwin := least(0.95, (1.0/odds) * (0.85 + random()*0.2));
      won := random() < pwin;
      st := case when won then 'won' else 'lost' end;
      insert into public.coupons(user_id, stake, total_odds, potential_win, status, created_at, settled_at)
      values (uid, stake, odds, pot, st, t, t + (random()*180+30)*interval '1 minute');
    end loop;
  end loop;
end $$;
