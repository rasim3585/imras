-- 0147: GERCEK MAC ORAN ONBELLEGI — bulten olum sarmali fix'i (2026-07-16 gecesi)
--
-- SEMPTOM: USA maclari canliya dustugu anda (23:12 UTC) get_bulletin herkese
-- "statement timeout" ile bos donmeye basladi; tek satirlik sorgular bile 17sn.
--
-- OLCUMLE KANITLANAN KOK NEDEN:
--   * get_bulletin gercek kolu HER istekte HER lambda'li fikstur icin
--     _real_fixture_markets -> real_fixture_odds -> _fixture_odds ->
--     _market_odds_ft_real (81 hucre Poisson izgarasi, ~10-50ms) hesabini
--     SIFIRDAN yapiyordu. Sakin DB'de kol toplami ~460ms; ama FE her istemcide
--     5 sn'de bir yokluyor ve timeout'ta geri cekilmiyor -> es zamanli agir
--     cagrilar kuyruklandikca sure 24.5sn'ye sisti (olculdu), anon 8sn
--     limitine takildi, sarmal kendini besledi. pg_stat_activity'de _tick 116sn
--     gorunuyordu = CPU acligindan surunen KURBAN (pg_stat_statements: _tick
--     ort 284ms), neden degil.
--   * Yani mimari kusur: istek basina yeniden hesap = O(kullanici). Milyon
--     kullanici hedefiyle bagdasmaz.
--
-- COZUM (canli bahis KALIYOR — Rasim karari; motor 0130-0136'da kalibre edildi):
--   * real_fixtures.markets_cache jsonb: satirda hazir market JSON'u.
--   * BEFORE INSERT/UPDATE trigger: fikstur durumu degistiginde (sync skor/
--     dakika/oran yazinca) onbellegi TEK SEFER yeniden kurar. Maliyet artik
--     kullanici sayisindan bagimsiz (sync temposuna bagli, ~30-60sn'de bir).
--   * _real_fixture_markets: hesap yapmaz, cache okur (+ mevcut bayat-feed
--     korumasi aynen). get_bulletin degismedi — otomatik hizlandi.
--   * Bahis koyma (place_coupon_v2) ve cashout (_cashout_value) TAZE hesaba
--     devam eder (para yolu en guncel fiyattan; ~10-50ms, islem basina).
--
-- Guvenlik: yeni _ fonksiyonlarina anon/authenticated EXECUTE YOK (0140 kurali).
-- Tam govdeler canli DB'ye SQL Editor'den DO blogu olarak uygulandi; bu dosya kayittir.

-- ============ PASTE 1: DO blogu (atomik — hata olursa hicbiri uygulanmaz) ============
do $mig$
begin

  -- 1) kolonlar
  execute 'alter table public.real_fixtures
             add column if not exists markets_cache jsonb,
             add column if not exists markets_cache_at timestamptz';

  -- 2) saf kurucu: fikstur alanlarindan market JSON dizisi (eski
  --    _real_fixture_markets govdesinin hesap kismi, birebir ayni cikti)
  execute $fn1$
    create or replace function public._real_markets_build(
      p_status text, p_prematch_odds jsonb,
      p_l1 double precision, p_l2 double precision, p_l3 double precision,
      p_minute int, p_hs int, p_as int, p_rh int, p_ra int)
    returns jsonb
    language plpgsql stable
    set search_path to 'public', 'pg_temp'
    as $body$
    declare
      v_odds jsonb;
      v_out  jsonb;
    begin
      v_odds := public._fixture_odds(
        p_status, p_prematch_odds,
        p_l1, p_l2, coalesce(p_l3, 0),
        coalesce(p_minute, 0), coalesce(p_hs, 0), coalesce(p_as, 0),
        coalesce(p_rh, 0), coalesce(p_ra, 0));

      if v_odds is null then
        return '[]'::jsonb;
      end if;

      select coalesce(
        jsonb_agg(m order by sort_order)
          filter (where jsonb_array_length(m -> 'options') > 0),
        '[]'::jsonb)
        into v_out
      from (
        select
          c.sort_order,
          jsonb_build_object(
            'market_type', c.market_type,
            'name', c.name,
            'options', coalesce(
              (select jsonb_agg(
                 jsonb_build_object(
                   'outcome_key', x ->> 'key',
                   'label',       x ->> 'label',
                   'odds',        (v_odds ->> (x ->> 'key'))::numeric,
                   'option_id',   null)
                 order by ord)
               from jsonb_array_elements(c.outcomes) with ordinality as e(x, ord)
               where v_odds ->> (x ->> 'key') is not null),
              '[]'::jsonb)
          ) as m
        from public.market_catalog c
        where c.real_capable
      ) built;

      return coalesce(v_out, '[]'::jsonb);
    end;
    $body$
  $fn1$;

  -- 3) trigger fonksiyonu: NEW degerlerinden cache'i satira gomer (recursion yok)
  execute $fn2$
    create or replace function public._real_markets_cache_trg()
    returns trigger
    language plpgsql
    set search_path to 'public', 'pg_temp'
    as $body$
    begin
      new.markets_cache := public._real_markets_build(
        new.status, new.prematch_odds,
        new.lambda_home, new.lambda_away, new.lambda_shared,
        new.current_minute, new.home_score, new.away_score,
        new.red_cards_home, new.red_cards_away);
      new.markets_cache_at := now();
      return new;
    end;
    $body$
  $fn2$;

  -- 4) tetikler: insert her zaman; update yalniz ilgili alan GERCEKTEN degisince
  execute 'drop trigger if exists real_fixtures_markets_cache_ins on public.real_fixtures';
  execute 'create trigger real_fixtures_markets_cache_ins
             before insert on public.real_fixtures
             for each row execute function public._real_markets_cache_trg()';

  execute 'drop trigger if exists real_fixtures_markets_cache_upd on public.real_fixtures';
  execute $trg$
    create trigger real_fixtures_markets_cache_upd
      before update of status, prematch_odds, lambda_home, lambda_away,
                       lambda_shared, current_minute, home_score, away_score,
                       red_cards_home, red_cards_away
      on public.real_fixtures
      for each row
      when (
        row(old.status, old.prematch_odds, old.lambda_home, old.lambda_away,
            old.lambda_shared, old.current_minute, old.home_score,
            old.away_score, old.red_cards_home, old.red_cards_away)
        is distinct from
        row(new.status, new.prematch_odds, new.lambda_home, new.lambda_away,
            new.lambda_shared, new.current_minute, new.home_score,
            new.away_score, new.red_cards_home, new.red_cards_away))
      execute function public._real_markets_cache_trg()
  $trg$;

  -- 5) elle/backfill tazeleyici (markets_cache UPDATE OF listesinde degil -> tetik tekrar atesLEmez)
  execute $fn3$
    create or replace function public._real_refresh_markets_cache(p_fixture_id uuid)
    returns void
    language sql
    set search_path to 'public', 'pg_temp'
    as $body$
      update public.real_fixtures rf
         set markets_cache = public._real_markets_build(
               rf.status, rf.prematch_odds,
               rf.lambda_home, rf.lambda_away, rf.lambda_shared,
               rf.current_minute, rf.home_score, rf.away_score,
               rf.red_cards_home, rf.red_cards_away),
             markets_cache_at = now()
       where rf.id = p_fixture_id;
    $body$
  $fn3$;

  -- 6) okuyucu: HESAP YOK — bayat-feed korumasi (0056 kurali) + cache
  execute $fn4$
    create or replace function public._real_fixture_markets(p_fixture_id uuid)
    returns jsonb
    language sql stable security definer
    set search_path to 'public', 'pg_temp'
    as $body$
      select coalesce(
        (select case
                  when rf.status = 'inprogress'
                   and (rf.last_synced_at is null
                        or extract(epoch from (now() - rf.last_synced_at))
                           > public._max_feed_age_secs())
                    then '[]'::jsonb
                  else coalesce(rf.markets_cache, '[]'::jsonb)
                end
           from public.real_fixtures rf
          where rf.id = p_fixture_id),
        '[]'::jsonb);
    $body$
  $fn4$;

  -- 7) 0140 kurali: yeni _ fonksiyonlar disariya kapali
  execute 'revoke execute on function public._real_markets_build(text,jsonb,double precision,double precision,double precision,int,int,int,int,int) from public, anon, authenticated';
  execute 'revoke execute on function public._real_markets_cache_trg() from public, anon, authenticated';
  execute 'revoke execute on function public._real_refresh_markets_cache(uuid) from public, anon, authenticated';
  execute 'revoke execute on function public._real_fixture_markets(uuid) from public, anon, authenticated';

end
$mig$;

-- ============ PASTE 2: backfill (mevcut fiksturlerin cache'ini doldur) ============
-- select count(*) as doldurulan
--   from (select public._real_refresh_markets_cache(id)
--           from public.real_fixtures
--          where status in ('notstarted','inprogress')) s;
