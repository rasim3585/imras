-- DAVRANIŞ AYNASI — Faz 1c: benchmark ("vs diğer oyuncular"). Kullanıcının kendi
-- metriğini TÜM oyuncu nüfusuna (gerçek + sim) göre yüzdelik dilime oturtur.
-- 3 eksen: disiplin (aviator yakalanma, düşük iyi), risk iştahı (kupon medyan oran,
-- nötr), kupon getirisi (ROI, yüksek iyi). Yalnız OKUR. Yeterli kendi verisi olan
-- eksenler döner; hiçbiri yoksa ready:false. Nüfus için sim_ kullanıcılar da sayılır
-- (benchmark çeşitliliği), profiles.id (user_id değil).
create or replace function public.mirror_benchmark()
returns jsonb language plpgsql security definer set search_path to 'public' stable as $function$
declare v_uid uuid := auth.uid();
  axes jsonb := '[]'::jsonb;
  you numeric; popavg numeric; pct numeric;
begin
  if v_uid is null then return jsonb_build_object('ready', false, 'reason','anon'); end if;

  -- Eksen 1: Aviator disiplin (yakalanma oranı, DÜŞÜK iyi)
  with av as (
    select user_id, avg((caught_by_crash)::int)::numeric cr, count(*) n
    from public.aviator_bets where status in ('won','lost') group by user_id having count(*) >= 20
  )
  select (select cr from av where user_id=v_uid),
         (select avg(cr) from av),
         (select count(*) filter (where cr >= (select cr from av where user_id=v_uid))::numeric / nullif(count(*),0) from av)
    into you, popavg, pct;
  if you is not null then
    axes := axes || jsonb_build_object('key','discipline','label','Disiplin',
      'metric','yakalanma', 'dir','low_good', 'you', round(you,3), 'avg', round(popavg,3),
      'percentile', round(pct,3), 'unit','pct');
  end if;

  -- Eksen 2: Kupon risk iştahı (medyan oran, NÖTR)
  with cp as (
    select user_id, percentile_cont(0.5) within group (order by total_odds)::numeric mo, count(*) n
    from public.coupons where status in ('won','lost','cashed_out') group by user_id having count(*) >= 15
  )
  select (select mo from cp where user_id=v_uid),
         (select avg(mo) from cp),
         (select count(*) filter (where mo <= (select mo from cp where user_id=v_uid))::numeric / nullif(count(*),0) from cp)
    into you, popavg, pct;
  if you is not null then
    axes := axes || jsonb_build_object('key','risk','label','Risk iştahı',
      'metric','medyan oran', 'dir','neutral', 'you', round(you,2), 'avg', round(popavg,2),
      'percentile', round(pct,3), 'unit','x');
  end if;

  -- Eksen 3: Kupon getirisi (ROI = net/stake, YÜKSEK iyi)
  with cp as (
    select user_id,
      (sum(case when status='won' then coalesce(potential_win,0)
                when status='cashed_out' then coalesce(cashout_amount,0) else 0 end) - sum(stake))::numeric
        / nullif(sum(stake),0) roi,
      count(*) n
    from public.coupons where status in ('won','lost','cashed_out') group by user_id having count(*) >= 15
  )
  select (select roi from cp where user_id=v_uid),
         (select avg(roi) from cp),
         (select count(*) filter (where roi <= (select roi from cp where user_id=v_uid))::numeric / nullif(count(*),0) from cp)
    into you, popavg, pct;
  if you is not null then
    axes := axes || jsonb_build_object('key','coupon_roi','label','Kupon getirisi',
      'metric','ROI', 'dir','high_good', 'you', round(you,3), 'avg', round(popavg,3),
      'percentile', round(pct,3), 'unit','pct');
  end if;

  if jsonb_array_length(axes) = 0 then return jsonb_build_object('ready', false); end if;
  return jsonb_build_object('ready', true,
    'population', (select count(*) from public.profiles),
    'axes', axes);
end; $function$;

revoke all on function public.mirror_benchmark() from public;
revoke execute on function public.mirror_benchmark() from anon;
grant execute on function public.mirror_benchmark() to authenticated;
