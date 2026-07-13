-- Sanal BASKETBOL — CANLIYA ALMA. _tick artık basketbol da seed ediyor.
-- finalize_due_matches (→ _finalize_match dispatch → _bb_finalize) ve
-- _settle_ready_coupons (oyun-bağımsız) zaten basketbolu doğru işliyor.
create or replace function public._tick()
 returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare
  v_seeded    int;
  v_finalized int;
  v_settled   int;
begin
  v_seeded    := public.seed_matches(3) + public._bb_seed(3);
  v_finalized := public.finalize_due_matches();
  v_settled   := public._settle_ready_coupons();
  return jsonb_build_object(
    'seeded', v_seeded, 'finalized', v_finalized,
    'settled', v_settled, 'at', now());
end;
$function$;

-- İlk populasyon (cron 30sn beklemeden feed dolsun).
select public._bb_seed(3);
