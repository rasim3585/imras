-- DAVRANIŞ AYNASI — ürün-başı (kupon, slot) + çapraz-ürün (genel) teşhis.
-- Hepsi auth.uid() KENDİ verisi, SECURITY DEFINER, yalnız OKUR (para yoluna
-- dokunmaz). Deterministik; LLM sonra "ses". mirror_overview CTE tabanlı
-- (STABLE fonksiyonda temp table yasak).

-- ===== KUPON (maç bahisleri) =====
create or replace function public.mirror_coupon()
returns jsonb language plpgsql security definer set search_path to 'public' stable as $function$
declare v_uid uuid := auth.uid(); n int; wins int; net bigint;
  avg_stake numeric; avg_odds numeric; med_odds numeric; win_rate numeric; longshot numeric;
  flags jsonb := '[]'::jsonb;
begin
  if v_uid is null then return jsonb_build_object('ready', false, 'reason','anon'); end if;
  select count(*), count(*) filter (where status='won'),
    sum(case when status='won' then coalesce(potential_win,0)
             when status='cashed_out' then coalesce(cashout_amount,0) else 0 end)::bigint - sum(stake)::bigint,
    avg(stake), avg(total_odds),
    percentile_cont(0.5) within group (order by total_odds),
    avg((total_odds>=5)::int)
   into n, wins, net, avg_stake, avg_odds, med_odds, longshot
  from public.coupons where user_id=v_uid and status in ('won','lost','cashed_out');
  if n is null or n < 15 then return jsonb_build_object('ready', false, 'rounds', coalesce(n,0), 'need', 15); end if;
  win_rate := round(wins::numeric/n, 4);

  if med_odds >= 6 or longshot >= 0.40 then
    flags := flags || jsonb_build_object('code','longshot_addict','level','warn',
      'value', jsonb_build_object('median_odds', round(med_odds,2), 'longshot_rate', round(longshot,3)));
  end if;
  if net < 0 and n >= 20 then
    flags := flags || jsonb_build_object('code','coupon_bleed','level','warn',
      'value', jsonb_build_object('net', net, 'win_rate', win_rate));
  end if;
  if med_odds <= 2.2 and win_rate >= 0.48 and net >= 0 then
    flags := flags || jsonb_build_object('code','safe_player','level','good',
      'value', jsonb_build_object('median_odds', round(med_odds,2), 'win_rate', win_rate));
  end if;

  return jsonb_build_object('ready', true, 'product','coupon', 'rounds', n,
    'win_rate', win_rate, 'net', net,
    'avg_stake', round(avg_stake,0), 'avg_odds', round(avg_odds,2),
    'median_odds', round(med_odds,2), 'longshot_rate', round(longshot,3), 'flags', flags);
end; $function$;

-- ===== SLOT (Gates of Goal) =====
create or replace function public.mirror_slot()
returns jsonb language plpgsql security definer set search_path to 'public' stable as $function$
declare v_uid uuid := auth.uid(); n int; staked bigint; paid bigint; net bigint;
  rtp numeric; ante_rate numeric; buy_rate numeric; avg_bet numeric; big_win int;
  flags jsonb := '[]'::jsonb;
begin
  if v_uid is null then return jsonb_build_object('ready', false, 'reason','anon'); end if;
  select count(*), sum(stake)::bigint, sum(coalesce(payout,0))::bigint,
         avg((ante)::int), avg((buy)::int), avg(bet), max(coalesce(payout,0))
   into n, staked, paid, ante_rate, buy_rate, avg_bet, big_win
  from public.slot_spins where user_id=v_uid;
  if n is null or n < 15 then return jsonb_build_object('ready', false, 'rounds', coalesce(n,0), 'need', 15); end if;
  net := paid - staked;
  rtp := case when staked>0 then round(paid::numeric/staked, 3) else null end;

  if buy_rate >= 0.15 then
    flags := flags || jsonb_build_object('code','buy_impulse','level','warn',
      'value', jsonb_build_object('buy_rate', round(buy_rate,3)));
  end if;
  if ante_rate >= 0.40 then
    flags := flags || jsonb_build_object('code','ante_habit','level','warn',
      'value', jsonb_build_object('ante_rate', round(ante_rate,3)));
  end if;
  if net < 0 and n >= 25 then
    flags := flags || jsonb_build_object('code','slot_bleed','level','warn',
      'value', jsonb_build_object('net', net, 'rtp', rtp));
  elsif net > 0 then
    flags := flags || jsonb_build_object('code','slot_up','level','good',
      'value', jsonb_build_object('net', net, 'rtp', rtp));
  end if;

  return jsonb_build_object('ready', true, 'product','slot', 'rounds', n,
    'net', net, 'staked', staked, 'rtp', rtp,
    'ante_rate', round(ante_rate,3), 'buy_rate', round(buy_rate,3),
    'avg_bet', round(avg_bet,0), 'biggest_win', big_win, 'flags', flags);
end; $function$;

-- ===== GENEL (çapraz-ürün) =====
create or replace function public.mirror_overview()
returns jsonb language plpgsql security definer set search_path to 'public' stable as $function$
declare v_uid uuid := auth.uid(); d jsonb;
  total_plays int; total_net bigint; top_share numeric;
  most_k text; worst_k text; best_k text; best_net bigint; top_k text;
  per_net jsonb; per_plays jsonb; flags jsonb := '[]'::jsonb;
  lbl jsonb := jsonb_build_object('aviator','Aviator','slot','Gates of Goal','coupon','Maç bahisleri');
begin
  if v_uid is null then return jsonb_build_object('ready', false, 'reason','anon'); end if;

  with per as (
    select 'aviator'::text k, count(*)::int plays, coalesce(sum(stake),0)::bigint staked,
           (coalesce(sum(coalesce(payout,0)),0)-coalesce(sum(stake),0))::bigint net
      from public.aviator_bets where user_id=v_uid and status in ('won','lost')
    union all
    select 'slot', count(*)::int, coalesce(sum(stake),0)::bigint,
           (coalesce(sum(coalesce(payout,0)),0)-coalesce(sum(stake),0))::bigint
      from public.slot_spins where user_id=v_uid
    union all
    select 'coupon', count(*)::int, coalesce(sum(stake),0)::bigint,
           (coalesce(sum(case when status='won' then coalesce(potential_win,0)
                              when status='cashed_out' then coalesce(cashout_amount,0) else 0 end),0)
            - coalesce(sum(stake),0))::bigint
      from public.coupons where user_id=v_uid and status in ('won','lost','cashed_out')
  ), tot as (select sum(plays) tp, sum(staked) ts, sum(net) tn from per)
  select jsonb_build_object(
    'products', (select jsonb_agg(jsonb_build_object(
        'key',k,'label',lbl->>k,'plays',plays,'staked',staked,'net',net,
        'stake_share', round(staked::numeric/nullif((select ts from tot),0),3)) order by staked desc) from per),
    'plays', (select tp from tot), 'staked', (select ts from tot), 'net', (select tn from tot),
    'most_k', (select k from per order by plays desc limit 1),
    'worst_k', (select k from per order by net asc limit 1),
    'best_k', (select k from per order by net desc limit 1),
    'best_net', (select net from per order by net desc limit 1),
    'top_k', (select k from per order by staked desc limit 1),
    'top_share', (select round(staked::numeric/nullif((select ts from tot),0),3) from per order by staked desc limit 1),
    'per_net', (select jsonb_object_agg(k, net) from per),
    'per_plays', (select jsonb_object_agg(k, plays) from per)
  ) into d;

  total_plays := (d->>'plays')::int;
  if coalesce(total_plays,0) < 20 then
    return jsonb_build_object('ready', false, 'plays', coalesce(total_plays,0), 'need', 20);
  end if;
  total_net := (d->>'net')::bigint; most_k := d->>'most_k'; worst_k := d->>'worst_k';
  best_k := d->>'best_k'; best_net := (d->>'best_net')::bigint; top_k := d->>'top_k';
  top_share := (d->>'top_share')::numeric; per_net := d->'per_net'; per_plays := d->'per_plays';

  if top_share >= 0.55 then
    flags := flags || jsonb_build_object('code','concentration','level','warn',
      'value', jsonb_build_object('product', lbl->>top_k, 'share', top_share));
  end if;
  if most_k = worst_k and (per_net->>worst_k)::bigint < 0 then
    flags := flags || jsonb_build_object('code','worst_is_favorite','level','warn',
      'value', jsonb_build_object('product', lbl->>most_k,
        'net', (per_net->>most_k)::bigint, 'plays', (per_plays->>most_k)::int));
  end if;
  if best_net > 0 and best_k <> most_k then
    flags := flags || jsonb_build_object('code','hidden_winner','level','good',
      'value', jsonb_build_object('product', lbl->>best_k, 'net', best_net,
        'plays', (per_plays->>best_k)::int));
  end if;

  return jsonb_build_object('ready', true, 'plays', total_plays,
    'staked', (d->>'staked')::bigint, 'net', total_net, 'products', d->'products',
    'most_played', lbl->>most_k, 'worst', lbl->>worst_k, 'flags', flags);
end; $function$;

revoke all on function public.mirror_coupon() from public;   revoke execute on function public.mirror_coupon() from anon;   grant execute on function public.mirror_coupon() to authenticated;
revoke all on function public.mirror_slot() from public;     revoke execute on function public.mirror_slot() from anon;     grant execute on function public.mirror_slot() to authenticated;
revoke all on function public.mirror_overview() from public; revoke execute on function public.mirror_overview() from anon; grant execute on function public.mirror_overview() to authenticated;
