-- 0087_aviator_takeoff_flying_at.sql
-- Aviator başlangıç gecikmesi: "Kalkış!" ile uçuşun başlaması arası ~780ms boşluk.
--
-- KÖK NEDEN: frontend 'takeoff' broadcast'ini DİNLEMİYORdu → betting→flying
-- geçişini yalnızca ~780ms geç gelen postgres_changes satır güncellemesiyle
-- öğreniyordu. (Crash için düşük-gecikmeli broadcast vardı, kalkış için yoktu.)
--
-- ÇÖZÜM (crash fix'inin kalkış karşılığı): takeoff broadcast'ine flying_at ekle
-- ki frontend uçuş anchor'ını HEMEN precise kurabilsin. Frontend tarafında
-- 'takeoff' handler eklendi (ayrı commit). Tick'in geri kalanı BİREBİR korundu.

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

  select * into v_round from public.aviator_rounds order by id desc limit 1;

  if not found then
    v_new := public._aviator_new_round();
    return jsonb_build_object('action','opened','round',v_new);
  end if;

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
      -- flying_at broadcast'te → frontend uçuş anchor'ını hemen precise kurar.
      perform realtime.send(
        jsonb_build_object('round_id', v_round.id, 'flying_at', now()),
        'takeoff', 'aviator', false);
      v_action := 'takeoff';

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

  -- FLYING -> CRASHED (tek dogru kaynaga delege)
  elsif v_round.status = 'flying' then
    v_crash_due := v_round.flying_at
                 + make_interval(secs => ln(v_secret.crash_point) / 0.35);
    v_mult := public._aviator_current_multiplier(v_round.flying_at);

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
