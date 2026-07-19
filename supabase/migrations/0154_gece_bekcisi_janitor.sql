-- 0154: GECE BEKCISI (janitor) — kalici temizlik mekanizmasi (Rasim talebi
-- 2026-07-19: "workaround degil kalici cozum"). 45 saatlik disk krizinin
-- birikim ayagini kokten cozer: her gece 04:07 UTC'de kendi kendine calisir,
-- ne sildigini jsonb olarak raporlar (cron.job_run_details'te gorulur).
--
-- ILKELER:
-- * DAVRANIS VERISINE ASLA DOKUNMAZ: bahisli aviator turlari, kuponlar,
--   coupon_selections, behavior_events, match_comments KALICI.
-- * Kuponla anilan hicbir pazar/secenek silinmez (NOT EXISTS korumalari) —
--   kupon gecmisi ekrani sonsuza dek saglam.
-- * matches satirlari silinmez (16MB, yorum/ceyrek/karsilasma gecmisi
--   referanslari) — sisen kisim pazar tablolariydi (94MB), onlar temizlenir.
-- * Her blok kendi exception'ini yutar: tek tablo hatasi bekciyi durdurmaz.
--
-- Kanit (2026-07-19 olcumu): cron.job_run_details 72MB, market_options 59MB,
-- markets 35MB, aviator_rounds 11MB (cogu issiz tur), secrets 4.4MB.
-- SQL Editor: her statement TEK TEK.

create or replace function public._janitor_daily()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v jsonb := '{}'::jsonb;
  n bigint;
begin
  -- 1) pg_cron calisma gecmisi (>2 gun) — saniyelik cronlarla gunde ~100K satir
  begin
    delete from cron.job_run_details where end_time < now() - interval '2 days';
    get diagnostics n = row_count;
    v := v || jsonb_build_object('cron_gecmisi', n);
  exception when others then v := v || jsonb_build_object('cron_gecmisi_hata', sqlerrm); end;

  -- 2) pg_net HTTP yanit kayitlari (>1 gun) — edge tetiklerinin gecici izleri
  begin
    delete from net._http_response where created < now() - interval '1 day';
    get diagnostics n = row_count;
    v := v || jsonb_build_object('pg_net', n);
  exception when others then v := v || jsonb_build_object('pg_net_hata', sqlerrm); end;

  -- 3) tur sirlari (>7 gun): crash sonrasi sir ana tabloya kopyalaniyor (0073),
  --    adalet dogrulama penceresi gecince kopya gereksiz
  begin
    delete from public.aviator_round_secrets s
    using public.aviator_rounds r
    where r.id = s.round_id and r.created_at < now() - interval '7 days';
    get diagnostics n = row_count;
    v := v || jsonb_build_object('tur_sirlari', n);
  exception when others then v := v || jsonb_build_object('tur_sirlari_hata', sqlerrm); end;

  -- 4) ISSIZ turlar (>3 gun, yalniz crashed, uzerinde TEK BAHIS BILE YOKSA):
  --    kimse izlemezken uretilen turlar — davranis degeri sifir
  begin
    delete from public.aviator_round_secrets s
    using public.aviator_rounds r
    where r.id = s.round_id and r.status = 'crashed'
      and r.created_at < now() - interval '3 days'
      and not exists (select 1 from public.aviator_bets b where b.round_id = r.id);
    delete from public.aviator_rounds r
    where r.status = 'crashed' and r.created_at < now() - interval '3 days'
      and not exists (select 1 from public.aviator_bets b where b.round_id = r.id);
    get diagnostics n = row_count;
    v := v || jsonb_build_object('issiz_turlar', n);
  exception when others then v := v || jsonb_build_object('issiz_turlar_hata', sqlerrm); end;

  -- 5) eski sanal-dunya pazarlari (>14 gun bitmis/iptal mac): kuponla anilan
  --    secenekler ve pazarlari KALIR (kupon gecmisi bozulmaz)
  begin
    delete from public.market_options o
    using public.markets m, public.matches x
    where m.id = o.market_id and x.id = m.match_id
      and x.status in ('finished', 'cancelled')
      and x.starts_at < now() - interval '14 days'
      and not exists (select 1 from public.coupon_selections cs where cs.market_option_id = o.id);
    get diagnostics n = row_count;
    v := v || jsonb_build_object('eski_secenekler', n);

    delete from public.markets m
    using public.matches x
    where x.id = m.match_id
      and x.status in ('finished', 'cancelled')
      and x.starts_at < now() - interval '14 days'
      and not exists (select 1 from public.market_options o where o.market_id = m.id);
    get diagnostics n = row_count;
    v := v || jsonb_build_object('eski_pazarlar', n);
  exception when others then v := v || jsonb_build_object('eski_pazar_hata', sqlerrm); end;

  return v;
end;
$fn$;

-- PostgREST /rpc herkese acar (0140 dersi) — disaridan cagrilamaz
revoke execute on function public._janitor_daily() from public, anon, authenticated;

-- idempotent zamanlama: varsa sok, yeniden kur (her gece 04:07 UTC)
do $$ begin perform cron.unschedule('pickplay_janitor'); exception when others then null; end $$;

select cron.schedule('pickplay_janitor', '7 4 * * *', $$select public._janitor_daily();$$);
