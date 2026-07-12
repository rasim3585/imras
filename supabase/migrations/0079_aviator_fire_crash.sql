-- 0079_aviator_fire_crash.sql
-- Aviator görsel senkron — Adım 1/3: idempotent crash RPC.
--
-- Amaç: crash'i tetiklemenin TEK doğru yolu. Hem 1sn pg_cron tick (fallback)
-- hem de precise-timing edge function (aviator-crash-timer) AYNI bu RPC'yi
-- çağırır. Hangisi önce gelirse crash eder; diğeri no-op'a düşer.
--
-- Idempotency + yarış güvenliği: turu FOR UPDATE ile kilitler. status<>'flying'
-- ise (başkası zaten crash etmiş) hiçbir şey yapmadan döner.
--
-- Zaman guard'ı: 100ms tolerans ile crash zamanından ÖNCE çağrılırsa 'early'
-- döner (edge bug'ına karşı savunma). crashed_at DAİMA deterministik v_crash_due
-- olarak yazılır (now() değil) → para/damga tick jitter'ından bağımsız kalır.
--
-- Bu RPC, _aviator_tick içindeki mevcut crash bloğunun birebir taşınmış halidir
-- (son auto-cashout ödemesi → round crashed → kalan placed bahisler lost →
-- crash broadcast). Adım 2'de tick bu bloğu bırakıp buraya delege edecek.

create or replace function public.aviator_fire_crash(p_round_id bigint)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp', 'extensions', 'realtime'
as $function$
declare
  v_round     public.aviator_rounds%rowtype;
  v_secret    public.aviator_round_secrets%rowtype;
  v_crash_due timestamptz;
begin
  -- Turu kilitle: tick ile edge aynı anda gelebilir, yalnızca biri crash etsin.
  select * into v_round from public.aviator_rounds
   where id = p_round_id
   for update;

  if not found then
    return jsonb_build_object('action', 'not_found', 'round', p_round_id);
  end if;

  -- Idempotent: yalnızca uçan tur crash edilebilir.
  if v_round.status <> 'flying' then
    return jsonb_build_object('action', 'noop', 'status', v_round.status, 'round', p_round_id);
  end if;

  select * into v_secret from public.aviator_round_secrets where round_id = v_round.id;

  -- Deterministik crash anı (tick ile aynı formül).
  v_crash_due := v_round.flying_at + make_interval(secs => ln(v_secret.crash_point) / 0.35);

  -- Çok erken çağrı koruması (edge clock skew/bug). 100ms tolerans.
  if now() < v_crash_due - interval '100 milliseconds' then
    return jsonb_build_object('action', 'early', 'round', v_round.id,
                              'due', v_crash_due);
  end if;

  -- Son ana kadar tetiklenen auto-cashout kazananlarını öde (kaybeden
  -- işaretlemeden ÖNCE). status='placed' guard'ı çift ödemeyi önler.
  update public.aviator_bets b
     set status='won', cashout_multiplier=b.auto_cashout_at,
         payout=floor(b.stake * b.auto_cashout_at)::int,
         was_auto=true, cashed_at=now()
   where b.round_id = v_round.id and b.status='placed'
     and b.auto_cashout_at is not null
     and b.auto_cashout_at <= v_secret.crash_point;

  update public.profiles p
     set gold_balance = gold_balance + b.payout
    from public.aviator_bets b
   where b.round_id = v_round.id and b.status='won'
     and b.cashed_at >= now() - interval '2 seconds'
     and b.user_id = p.id and b.was_auto=true;

  -- Crash: damga DAİMA deterministik crash anı.
  update public.aviator_rounds
     set status='crashed', crashed_at=v_crash_due,
         crash_point=v_secret.crash_point, server_seed=v_secret.server_seed
   where id = v_round.id;

  update public.aviator_bets
     set status='lost', caught_by_crash=true
   where round_id = v_round.id and status='placed';

  -- Frontend eğriyi crash_point'e otursun.
  perform realtime.send(
    jsonb_build_object('round_id', v_round.id, 'crash_point', v_secret.crash_point),
    'crash', 'aviator', false);

  return jsonb_build_object('action', 'crashed', 'round', v_round.id,
                            'crash_point', v_secret.crash_point);
end;
$function$;
