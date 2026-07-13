-- DAVRANIŞ AYNASI — Faz 1c: Player Card (kimlik kartı). Çapraz-ürün desenden
-- deterministik arketip + imza özellikler. Kimlik = hook: kullanıcı kendini bir
-- "tip" olarak görür. Yalnız OKUR. Sinyaller: baskın ürün, aviator disiplin,
-- kupon risk/getiri, genel net, risk yığılması.
create or replace function public.mirror_card()
returns jsonb language plpgsql security definer set search_path to 'public' stable as $function$
declare v_uid uuid := auth.uid();
  av_n int; av_caught numeric; av_auto numeric;
  cp_n int; cp_odds numeric; cp_longshot numeric; cp_roi numeric;
  slot_n int; total_net bigint; top_share numeric; most_k text;
  arche text; emoji text; subtitle text; traits jsonb := '[]'::jsonb;
begin
  if v_uid is null then return jsonb_build_object('ready', false); end if;

  select count(*), avg((caught_by_crash)::int), avg((was_auto)::int)
    into av_n, av_caught, av_auto
  from public.aviator_bets where user_id=v_uid and status in ('won','lost');
  select count(*),
    percentile_cont(0.5) within group (order by total_odds),
    avg((total_odds>=5)::int),
    (sum(case when status='won' then coalesce(potential_win,0)
              when status='cashed_out' then coalesce(cashout_amount,0) else 0 end)-sum(stake))::numeric/nullif(sum(stake),0)
    into cp_n, cp_odds, cp_longshot, cp_roi
  from public.coupons where user_id=v_uid and status in ('won','lost','cashed_out');
  select count(*) into slot_n from public.slot_spins where user_id=v_uid;

  with per as (
    select 'aviator' k, count(*) plays, coalesce(sum(stake),0) staked,
      (coalesce(sum(coalesce(payout,0)),0)-coalesce(sum(stake),0)) net
      from public.aviator_bets where user_id=v_uid and status in ('won','lost')
    union all select 'slot', count(*), coalesce(sum(stake),0),
      (coalesce(sum(coalesce(payout,0)),0)-coalesce(sum(stake),0))
      from public.slot_spins where user_id=v_uid
    union all select 'coupon', count(*), coalesce(sum(stake),0),
      (coalesce(sum(case when status='won' then coalesce(potential_win,0)
                        when status='cashed_out' then coalesce(cashout_amount,0) else 0 end),0)-coalesce(sum(stake),0))
      from public.coupons where user_id=v_uid and status in ('won','lost','cashed_out')
  )
  select (select k from per order by plays desc limit 1),
         (select sum(net) from per),
         (select round(max(staked)::numeric/nullif(sum(staked),0),3) from per)
    into most_k, total_net, top_share;

  if coalesce(av_n,0)+coalesce(cp_n,0)+coalesce(slot_n,0) < 20 then
    return jsonb_build_object('ready', false);
  end if;

  if av_n >= 20 and coalesce(av_caught,0) >= 0.50 and coalesce(av_auto,1) < 0.20 then
    arche := 'Açgözlü Pilot'; emoji := '✈️';
    subtitle := 'Aviator''da "bir saniye daha" diyen tip. Uçağı bırakmakta zorlanıyorsun.';
  elsif cp_n >= 15 and coalesce(cp_longshot,0) >= 0.40 then
    arche := 'Uzun Atış Avcısı'; emoji := '🎯';
    subtitle := 'Büyük oranların peşindesin — düşük ihtimal, yüksek hayal.';
  elsif av_n >= 20 and coalesce(av_caught,1) < 0.35 and coalesce(av_auto,0) >= 0.40 then
    arche := 'Soğukkanlı Oyuncu'; emoji := '❄️';
    subtitle := 'Planını kurar, erken çeker, dürtüye kapılmazsın. Nadir bir tip.';
  elsif most_k = 'slot' then
    arche := 'Makine Başında'; emoji := '🎰';
    subtitle := 'Vaktinin çoğu Gates of Goal''da. Tumble''ların ritmine kapılmışsın.';
  elsif most_k = 'coupon' and coalesce(top_share,0) >= 0.6 and coalesce(cp_roi,0) < 0 then
    arche := 'Kupon Bağımlısı'; emoji := '🎫';
    subtitle := 'Neredeyse her şeyin maç bahsinde. Tek kanala fazla yükleniyorsun.';
  elsif coalesce(total_net,0) > 0 then
    arche := 'Kâr Avcısı'; emoji := '💚';
    subtitle := 'Şimdilik öndesin. Zor olan: durmayı bilmek.';
  else
    arche := 'Dengeli Oyuncu'; emoji := '⚖️';
    subtitle := 'Belirgin bir aşırılığın yok — oyunları ölçülü geziyorsun.';
  end if;

  if av_n >= 20 then
    traits := traits || jsonb_build_object('label','Aviator disiplini',
      'value', case when av_caught < 0.4 then 'yüksek' when av_caught < 0.55 then 'orta' else 'düşük' end,
      'tone', case when av_caught < 0.4 then 'good' else 'warn' end);
  end if;
  if cp_n >= 15 then
    traits := traits || jsonb_build_object('label','Oran iştahı',
      'value', case when cp_odds < 2.5 then 'temkinli' when cp_odds < 5 then 'dengeli' else 'agresif' end,
      'tone', case when cp_odds >= 6 then 'warn' else 'info' end);
  end if;
  traits := traits || jsonb_build_object('label','Genel',
    'value', case when total_net > 0 then 'kârda' else 'zararda' end,
    'tone', case when total_net > 0 then 'good' else 'warn' end);

  return jsonb_build_object('ready', true, 'archetype', arche, 'emoji', emoji,
    'subtitle', subtitle, 'traits', traits,
    'total_net', total_net, 'total_plays', coalesce(av_n,0)+coalesce(cp_n,0)+coalesce(slot_n,0));
end; $function$;

revoke all on function public.mirror_card() from public;
revoke execute on function public.mirror_card() from anon;
grant execute on function public.mirror_card() to authenticated;
