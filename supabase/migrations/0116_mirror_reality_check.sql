-- DAVRANIŞ AYNASI — gerçeklik kontrolü (anti-kumar ayıraçları). Ürünün ASIL amacı:
-- kullanıcıyı LEHİNE uyarmak. Deterministik sinyaller: yakma hızı (bakiye kaç gün
-- sonra biter), oturum süresi (bugün ne kadardır oynuyorsun), yüksek-risk bölgesi.
-- Yalnız OKUR. Frontend kodları i18n ile yerelleştirir.
create or replace function public.mirror_reality_check()
returns jsonb language plpgsql security definer set search_path to 'public' stable as $function$
declare
  v_uid uuid := auth.uid();
  bal bigint; net7 bigint; plays_today int; span_min numeric;
  burn numeric; days_to_zero numeric; alerts jsonb := '[]'::jsonb;
begin
  if v_uid is null then return jsonb_build_object('ready', false); end if;
  select gold_balance into bal from public.profiles where id = v_uid;

  select
    coalesce((select sum(coalesce(payout,0))-sum(stake) from public.aviator_bets
      where user_id=v_uid and status in ('won','lost') and placed_at > now()-interval '7 days'),0)
   + coalesce((select sum(coalesce(payout,0))-sum(stake) from public.slot_spins
      where user_id=v_uid and created_at > now()-interval '7 days'),0)
   + coalesce((select sum(case when status='won' then coalesce(potential_win,0)
        when status='cashed_out' then coalesce(cashout_amount,0) else 0 end)-sum(stake)
      from public.coupons where user_id=v_uid and status in ('won','lost','cashed_out')
        and created_at > now()-interval '7 days'),0)
   into net7;

  with today as (
    select placed_at ts from public.aviator_bets where user_id=v_uid and placed_at::date = now()::date
    union all select created_at from public.slot_spins where user_id=v_uid and created_at::date = now()::date
    union all select created_at from public.coupons where user_id=v_uid and created_at::date = now()::date
  )
  select count(*), extract(epoch from (max(ts)-min(ts)))/60 into plays_today, span_min from today;

  if net7 < 0 then
    burn := (-net7)::numeric / 7.0;
    if burn > 0 and bal is not null and bal > 0 then days_to_zero := bal / burn; end if;
  end if;

  if days_to_zero is not null and days_to_zero <= 30 then
    alerts := alerts || jsonb_build_object('code','burn_rate','level','danger',
      'value', jsonb_build_object('days', round(days_to_zero), 'net7', net7));
  end if;
  if coalesce(span_min,0) >= 120 and coalesce(plays_today,0) >= 15 then
    alerts := alerts || jsonb_build_object('code','long_session','level','warn',
      'value', jsonb_build_object('hours', round(span_min/60.0,1), 'plays', plays_today));
  end if;
  if net7 < 0 and bal is not null and bal > 0 and (-net7)::numeric > bal * 0.4 then
    alerts := alerts || jsonb_build_object('code','high_risk','level','danger',
      'value', jsonb_build_object('net7', net7));
  end if;

  return jsonb_build_object('ready', true, 'balance', bal, 'net7', net7, 'alerts', alerts);
end; $function$;

revoke all on function public.mirror_reality_check() from public;
revoke execute on function public.mirror_reality_check() from anon;
grant execute on function public.mirror_reality_check() to authenticated;
