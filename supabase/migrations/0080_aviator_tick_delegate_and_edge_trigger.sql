-- 0080_aviator_tick_delegate_and_edge_trigger.sql
-- Aviator görsel senkron — Adım 2/3: tick'i tek doğru kaynağa delege et +
-- precise-timing edge function'ı pg_net ile tetikle.
--
-- İki değişiklik (geri kalan tick mantığı BİREBİR korunur):
--
-- 1) BETTING -> FLYING geçişinde: tur uçmaya başladığı AN, deterministik crash
--    zamanını (crash_at = flying_at + ln(crash_point)/0.35) hesaplayıp
--    aviator-crash-timer edge function'ına pg_net ile POST eder. Edge o ana
--    kadar uyur ve TAM zamanında aviator_fire_crash'i çağırır → freezeDelay≈0.
--    pg_net çağrısı EXCEPTION ile sarılıdır: edge tetiği kritik değil, hata
--    olsa bile tick fallback crash'i garanti eder (para/damga etkilenmez).
--
-- 2) FLYING -> CRASHED: eski satır-içi crash/settle/broadcast bloğu KALDIRILDI;
--    yerine tek idempotent aviator_fire_crash(round_id) RPC'sine delege edilir.
--    Artık crash mantığı TEK yerde (0079). Tick fallback, edge ise precise yol;
--    ikisi de AYNI RPC'yi çağırır, hangisi önce gelirse crash eder, diğeri no-op.
--
-- Mid-flight auto-cashout (uçuş sırasında auto_cashout_at'e ulaşan bahisleri
-- anında ödeme) tick'te AYNEN kalır — crash'ten bağımsız, her tick çalışır.

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

  select * into v_round from public.aviator_rounds
   where status <> 'crashed' order by id desc limit 1;

  if not found then
    v_new := public._aviator_new_round();
    return jsonb_build_object('action','opened','round',v_new);
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
      -- Kritik değil → hata tick'i düşürmesin (fallback crash tick'te kalır).
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

  -- FLYING -> CRASHED
  elsif v_round.status = 'flying' then
    v_crash_due := v_round.flying_at
                 + make_interval(secs => ln(v_secret.crash_point) / 0.35);
    v_mult := public._aviator_current_multiplier(v_round.flying_at);

    -- Mid-flight auto cashout (crash'ten bağımsız, her tick) — AYNEN korunur.
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

    -- Crash zamanına ulaşıldı mı → TEK doğru kaynağa delege et (fallback yol).
    if now() >= v_crash_due then
      perform public.aviator_fire_crash(v_round.id);
      v_action := 'crashed';
    else
      v_action := 'flying';
    end if;
  end if;

  -- CRASHED + 3sn -> yeni tur
  select * into v_round from public.aviator_rounds order by id desc limit 1;
  if v_round.status='crashed'
     and now() >= v_round.crashed_at + interval '3 seconds' then
    v_new := public._aviator_new_round();
    v_action := 'opened';
  end if;

  return jsonb_build_object('action', v_action, 'round', v_round.id);
end;
$function$;
