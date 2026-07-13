-- DAVRANIŞ AYNASI — Faz 1b: trend serisi. "delta = ürün" — teşhis hook, asıl
-- değer davranışın ZAMANLA değişimi. mirror_aviator'a additive `series` alanı:
-- settle'lı bahisleri kronolojik ~eşit kovalara böl, her kovada yakalanma/net/
-- çekiş. PARA YOLUNA yine dokunmaz, yalnız okur. Ana teşhis mantığı aynen korunur.

create or replace function public.mirror_aviator()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
stable
as $function$
declare
  v_uid uuid := auth.uid();
  v jsonb;
  n int; wins int; net bigint;
  win_rate numeric; caught_rate numeric; auto_rate numeric;
  avg_co numeric; med_co numeric;
  loss_ratio numeric; win_ratio numeric; loss_n int; win_n int;
  rec_caught numeric; rec_net bigint; rec_n int;
  nb int; series jsonb;
  flags jsonb := '[]'::jsonb;
begin
  if v_uid is null then return jsonb_build_object('ready', false, 'reason', 'anon'); end if;

  select count(*), count(*) filter (where status='won'),
         sum(coalesce(payout,0))::bigint - sum(stake)::bigint,
         avg(cashout_multiplier) filter (where cashout_multiplier is not null),
         percentile_cont(0.5) within group (order by cashout_multiplier)
           filter (where cashout_multiplier is not null),
         avg((caught_by_crash)::int), avg((was_auto)::int)
    into n, wins, net, avg_co, med_co, caught_rate, auto_rate
  from public.aviator_bets
  where user_id = v_uid and status in ('won','lost');

  if n is null or n < 10 then
    return jsonb_build_object('ready', false, 'rounds', coalesce(n,0), 'need', 10);
  end if;
  win_rate := round(wins::numeric / n, 4);

  select percentile_cont(0.5) within group (order by stake::numeric/nullif(prev_stake,0)), count(*)
    into loss_ratio, loss_n
  from public.aviator_bets where user_id=v_uid and prev_result='lost' and prev_stake>0;
  select percentile_cont(0.5) within group (order by stake::numeric/nullif(prev_stake,0)), count(*)
    into win_ratio, win_n
  from public.aviator_bets where user_id=v_uid and prev_result='won' and prev_stake>0;

  select avg((caught_by_crash)::int), (sum(coalesce(payout,0))-sum(stake))::bigint, count(*)
    into rec_caught, rec_net, rec_n
  from (select * from public.aviator_bets
        where user_id=v_uid and status in ('won','lost')
        order by placed_at desc limit 20) r;

  -- Trend serisi: ~8+ bahis/kova, en fazla 6 kova, kronolojik.
  nb := least(6, greatest(2, n / 8));
  select jsonb_agg(jsonb_build_object(
           'i', b, 'rounds', c,
           'caught_rate', round(cr,3),
           'net_per', round(npr,1),
           'avg_cashout', round(coalesce(ac,0),2)) order by b)
    into series
  from (
    select b, count(*) c, avg(cc::int) cr,
           (sum(coalesce(pay,0))-sum(st))::numeric/count(*) npr, avg(cm) ac
    from (
      select ntile(nb) over (order by placed_at) b,
             caught_by_crash cc, payout pay, stake st, cashout_multiplier cm
      from public.aviator_bets
      where user_id=v_uid and status in ('won','lost')
    ) z group by b
  ) t;

  -- --- Deterministik bayraklar ---
  if win_rate >= 0.55 and net < 0 then
    flags := flags || jsonb_build_object('code','win_illusion','level','warn',
      'value', jsonb_build_object('win_rate', win_rate, 'net', net));
  end if;
  if caught_rate >= 0.45 then
    flags := flags || jsonb_build_object('code','greed_caught','level','warn',
      'value', jsonb_build_object('caught_rate', round(caught_rate,3)));
  end if;
  if loss_n >= 8 and win_n >= 5 and loss_ratio >= 1.20
     and loss_ratio > coalesce(win_ratio,1) * 1.10 then
    flags := flags || jsonb_build_object('code','chasing_losses','level','warn',
      'value', jsonb_build_object('loss_ratio', round(loss_ratio,2), 'win_ratio', round(coalesce(win_ratio,1),2)));
  end if;
  if auto_rate < 0.15 and caught_rate >= 0.40 then
    flags := flags || jsonb_build_object('code','low_discipline','level','warn',
      'value', jsonb_build_object('auto_rate', round(auto_rate,3)));
  end if;
  if auto_rate >= 0.50 and caught_rate < 0.25 and net >= 0 then
    flags := flags || jsonb_build_object('code','disciplined','level','good',
      'value', jsonb_build_object('auto_rate', round(auto_rate,3)));
  end if;
  if rec_n >= 10 and rec_caught > caught_rate + 0.12 then
    flags := flags || jsonb_build_object('code','trend_worse','level','warn',
      'value', jsonb_build_object('recent_caught', round(rec_caught,3), 'overall_caught', round(caught_rate,3)));
  elsif rec_n >= 10 and rec_caught < caught_rate - 0.12 then
    flags := flags || jsonb_build_object('code','trend_better','level','good',
      'value', jsonb_build_object('recent_caught', round(rec_caught,3), 'overall_caught', round(caught_rate,3)));
  end if;

  v := jsonb_build_object(
    'ready', true, 'product', 'aviator', 'rounds', n,
    'win_rate', win_rate, 'net', net,
    'avg_cashout', round(coalesce(avg_co,0),2),
    'median_cashout', round(coalesce(med_co,0),2),
    'caught_rate', round(caught_rate,3), 'auto_rate', round(auto_rate,3),
    'loss_ratio', case when loss_n>=8 then round(loss_ratio,2) else null end,
    'win_ratio', case when win_n>=5 then round(coalesce(win_ratio,1),2) else null end,
    'recent', jsonb_build_object('rounds', rec_n, 'caught_rate', round(coalesce(rec_caught,0),3), 'net', rec_net),
    'series', coalesce(series,'[]'::jsonb),
    'flags', flags
  );
  return v;
end;
$function$;
