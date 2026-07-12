-- 0086_settle_real_fixture_on_finish.sql
-- Gerçek maç bitince kupon settle olmuyordu → kuponda sonsuz "soon" / pending.
--
-- KÖK NEDEN: _live_apply_events (canlı sync, 30sn) maçı BSD 'finished' deyince
-- status='finished' yazıyor ama settle_real_fixture'ı ÇAĞIRMIYORdu. Böylece
-- coupon_selections bacakları 'pending' kalıyor, _settle_ready_coupons bunları
-- "hâlâ bekleyen" sayıp kuponu settle etmiyordu. _reap_stale_real_fixtures ise
-- sadece TAKILI (3s+ inprogress) maçları settle ediyor, normal bitenleri değil.
--
-- ÇÖZÜM: _live_apply_events bir fixture'ı finished/penalties yaptığı an
-- settle_real_fixture'ı çağırsın (idempotent: settled_at doluysa no-op;
-- exception ile sarılı → settle hatası skor senkronunu bozmaz).

create or replace function public._live_apply_events(p_events jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  e        jsonb;
  v_fix    uuid;
  v_count  int := 0;
begin
  if p_events is null or jsonb_array_length(p_events) = 0 then
    return 0;
  end if;

  for e in select * from jsonb_array_elements(p_events)
  loop
    -- A) Skor/status/dakika upsert. Sadece BSD'nin canli alanlari.
    update public.real_fixtures rf
       set status         = public._bsd_map_status(e ->> 'status'),
           period         = e ->> 'period',
           current_minute = nullif(e ->> 'current_minute', '')::int,
           home_score     = nullif(e ->> 'home_score', '')::int,
           away_score     = nullif(e ->> 'away_score', '')::int,
           home_score_ht  = nullif(e ->> 'home_score_ht', '')::int,
           away_score_ht  = nullif(e ->> 'away_score_ht', '')::int,
           last_synced_at = now()
     where rf.provider = 'bsd'
       and rf.external_id = (e ->> 'id')::bigint
    returning rf.id into v_fix;

    if v_fix is null then
      continue;
    end if;

    v_count := v_count + 1;

    -- Maç finished/penalties'e geçtiyse bacakları grade et + kuponları settle et.
    -- Idempotent (settle_real_fixture settled_at doluysa 'already_settled' döner).
    if public._bsd_map_status(e ->> 'status') in ('finished', 'penalties') then
      begin
        perform public.settle_real_fixture(v_fix);
      exception when others then
        null;   -- settle hatasi skor senkronunu bozmamali
      end;
    end if;

    -- B) Feed pulse.
    begin
      perform public.record_feed_pulse(
        v_fix,
        coalesce(nullif(e ->> 'current_minute','')::numeric, 0),
        coalesce(nullif(e ->> 'home_score','')::int, 0),
        coalesce(nullif(e ->> 'away_score','')::int, 0),
        public._bsd_map_status(e ->> 'status'));
    exception when others then
      null;
    end;
  end loop;

  return v_count;
end;
$function$;
