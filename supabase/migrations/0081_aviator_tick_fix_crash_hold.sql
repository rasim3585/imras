-- 0081_aviator_tick_fix_crash_hold.sql
-- Aviator: patlama sonrası 3 saniyelik "sonuç gösterimi" duraklamasını GERÇEKTEN
-- uygula (ölü kod düzeltmesi).
--
-- SEMPTOM (Rasim): patlamadan hemen sonra "Auta gitti!" sonuç ekranı görünmeden
-- betting geri sayımı başlıyor. Turlar arası boşluk ölçüldü: ~0.1–0.95s (3s DEĞİL).
--
-- KÖK NEDEN (kanıtlandı): eski tick en üstte
--     select ... where status <> 'crashed' ...; if not found then yeni_tur;
-- yapıyordu. Tur crash olunca "crashed olmayan tur" bulunamıyor → tick BİR SONRAKİ
-- tick'te (≈0–1s) hemen yeni tur açıyordu. En alttaki "crashed + 3sn -> yeni tur"
-- bloğuna asla ulaşılmıyordu (ÖLÜ KOD). Bu hata eskiden de vardı ama crash ~0.8s
-- geç göründüğü için maskeleniyordu; 0080 ile crash anında olunca açığa çıktı.
--
-- DÜZELTME: en son turu (durumdan bağımsız) al; crashed ise crashed_at + 3sn
-- dolana kadar BEKLE ('crash_hold'), sonra yeni tur aç. Ölü alt blok kaldırıldı.
-- Betting/flying mantığı ve 0080'deki edge tetiği + delege AYNEN korunur.

create or replace function public._aviator_tick()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp', 'extensions', 'realtime'
as $function$
declare
  v_round   public.aviator_rounds%rowtype;
  v_cfg     public.aviator_config%rowtype;
  v_secret  public.aviator_round_secrets%rowtype;
  v_mult    numeric;
  v_crash_due timestamptz;
  v_action  text := 'none';
  v_new     bigint;
begin
  select * into v_cfg from public.aviator_config where id=1;

  -- En son tur (durumdan bağımsız).
  select * into v_round from public.aviator_rounds order by id desc limit 1;

  -- Hiç tur yok (soğuk başlangıç).
  if not found then
    v_new := public._aviator_new_round();
    return jsonb_build_object('action','opened','round',v_new);
  end if;

  -- CRASHED: 3sn "Auta gitti!" sonuç gösterimini BEKLE, sonra yeni tur aç.
  -- (Eskiden ölü koddu; yeni turun hemen açılmasını bu engelliyor.)
  if v_round.status = 'crashed' then
    if now() >= v_round.crashed_at + interval '3 seconds' then
      v_new := public._aviator_new_round();
      return jsonb_build_object('action','opened','round',v_new);
    end if;
    return jsonb_build_object('action','crash_hold','round',v_round.id);
  end if;

  select * into v_secret from public.aviator_round_secrets where round_id=v_round.id;

  -- BETTING -> FLYING (+ takeoff broadcast, HEMEN, blokesiz)
  if v_round.status = 'betting' then
    if now() >= v_round.betting_at + make_interval(secs => v_cfg.bet_window_secs) then
      update public.aviator_rounds set status='flying', flying_at=now() where id=v_round.id;
      perform realtime.send(
        jsonb_build_object('round_id', v_round.id),
        'takeoff', 'aviator', false);
      v_action := 'takeoff';

      -- Precise-timing tetiği: edge function crash anına kadar uyup fire_crash'i
      -- çağırsın. crash_at deterministik; flying_at = now() (aynı tx).
      -- Kritik değil -> hata tick'i düşürmesin (fallback crash tick'te kalır).
      begin
        perform net.http_post(
          url     := 'https://owhvdjmxdtdaifpzttav.supabase.co/functions/v1/aviator-crash-timer',
          body    := jsonb_build_object(
                       'round_id', v_round.id,
                       'crash_at', now() + make_interval(secs => ln(v_secret.crash_point) / 0.35)),
          headers := jsonb_build_object('Content-Type','application/json'),
          timeout_milliseconds := 20000);
      exception when others then
        null;
      end;
    end if;

  -- FLYING -> CRASHED (tek doğru kaynağa delege)
  elsif v_round.status = 'flying' then
    v_crash_due := v_round.flying_at
                 + make_interval(secs => ln(v_secret.crash_point) / 0.35);
    v_mult := public._aviator_current_multiplier(v_round.flying_at);

    -- Mid-flight auto cashout (crash'ten bağımsız, her tick) -- AYNEN korunur.
    update public.aviator_bets b
       set status='won', cashout_multiplier=b.auto_cashout_at,
           payout=floor(b.stake * b.auto_cashout_at)::int,
           was_auto=true, cashed_at=now()
     where b.round_id=v_round.id and b.status='placed'
       and b.auto_cashout_at is not null
       and b.auto_cashout_at <= v_mult
       and b.auto_cashout_at <= v_secret.crash_point;
    update public.profiles p
       set gold_balance = gold_balance + b.payout
      from public.aviator_bets b
     where b.round_id=v_round.id and b.status='won'
       and b.cashed_at >= now() - interval '2 seconds'
       and b.user_id=p.id and b.was_auto=true;

    -- Crash zamanına ulaşıldı mı -> fire_crash (fallback yol; edge zaten geçmiş olur).
    if now() >= v_crash_due then
      perform public.aviator_fire_crash(v_round.id);
      v_action := 'crashed';
    else
      v_action := 'flying';
    end if;
  end if;

  return jsonb_build_object('action', v_action, 'round', v_round.id);
end;
$function$;
