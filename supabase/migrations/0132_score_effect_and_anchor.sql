-- 0132: SKOR ETKISI (chase boost) + bariz gucluye CIFT YONLU capa.
-- Rasim'in Nesine kiyasi (Fransa 0-2 Ispanya, 62'): Nesine 23.60/7.24/kapali,
-- bizde 20.16/16.65 idi. Iki kusur:
--   (a) 20.16: 0130 oncesi hesaplanmis goruntu (motor artik 20 tavanli).
--   (b) Beraberlik 16.65: modelde SKOR ETKISI yoktu — geriye dusen takimin
--       kalan gol beklentisi yukselir (kovalar), onde olanin duser. Nesine
--       Fransa'nin kalan lambdasini bizim ~2.5 katimiz fiyatliyordu.
--
-- COZUM:
-- 1) _chase_boost(d, dk): geride kalan x(1 + 0.6|1.2 * ramp), onde olan
--    x(1 - 0.15*ramp); ramp = clamp((dk-30)/45, 0, 1) — kovalamaca 30'dan
--    yumusak baslar, 75'te tam guc. Iki futbol motoruna da uygulanir
--    (OU/BTTS de gercekci sekilde etkilenir — kitaplar da boyle yapar).
-- 2) _comeback_floor artik bariz guclu icin CIFT YONLU CAPA: chase boost ham
--    modeli IY'de fazla comert yapabildiginden (4.62 gorunmustu), bariz guclu
--    tarafin olasiligi spec egrisine %85*sf agirlikla cekilir:
--      anchor = P0 * basef(fark) * timek(dk)   (0131 parametreleri)
--    Denk/zayifta sf~0 -> ham (boost'lu) model gecerli.
--
-- DOGRULAMA (SQL matrisi):
--   Bariz guclu 0-2 geride: 20' 7.8 | 45' 7.6 | 55' 8.7 | 62' 9.9 | 70' 12.1
--                           | 78' 16.5 | 85' 20  (IY ~8 bandi, 2.yari yukselis)
--   Bariz guclu 0-1 geride: 45' 3.8 | 70' 6.1 | 78' 8.0 | 85' 11 (Nesine
--                           Dundee Utd 82' 8.84 ile uyumlu)
--   Denk 0-2 (Fra-Isp λ1.38/1.33): 62' ev 17.1 / X 7.07 — Nesine 23.6 / 7.24
--                           (X neredeyse birebir; ev bizim 20 tavani politikasi)
--
-- Not: _market_odds_ft ve _market_odds_ft_real govdeleri MCP ile canliya
-- uygulandi (skor etkisi 'select * into bh, ba from public._chase_boost(...)'
-- + lambda carpimi olarak Poisson dizilerinden once eklendi; kalan govde 0130
-- ile ayni). Tam govdeler icin: pg_get_functiondef.

create or replace function public._chase_boost(d0 integer, p_minute integer, out bh double precision, out ba double precision)
returns record language plpgsql immutable parallel safe as $$
declare
  ramp double precision := least(1.0, greatest(0.0, (coalesce(p_minute,0) - 30)::double precision / 45.0));
begin
  bh := 1.0; ba := 1.0;
  if d0 < 0 then
    bh := 1.0 + (case when d0 <= -2 then 1.2 else 0.6 end) * ramp;
    ba := 1.0 - 0.15 * ramp;
  elsif d0 > 0 then
    ba := 1.0 + (case when d0 >= 2 then 1.2 else 0.6 end) * ramp;
    bh := 1.0 - 0.15 * ramp;
  end if;
end; $$;

create or replace function public._comeback_floor(
  pw double precision, pd double precision, pl double precision,
  pw0 double precision, pl0 double precision,
  p_minute integer, p_hs integer, p_as integer
) returns double precision[] language plpgsql immutable parallel safe as $function$
declare
  d int := coalesce(p_as, 0) - coalesce(p_hs, 0);
  timek double precision;
  basef double precision;
  sf double precision;
  anchor double precision;
  w double precision;
  pfin double precision;
  scale double precision;
begin
  if d = 0 or coalesce(p_minute, 0) >= 88 then return array[pw, pd, pl]; end if;
  timek := case when coalesce(p_minute, 0) <= 45 then 1.0
                else 0.35 + 0.65 * greatest(0, 88 - p_minute)::double precision / 43.0 end;
  basef := case abs(d) when 1 then 0.34 when 2 then 0.165 when 3 then 0.085 else 0.04 end;
  if d > 0 then
    sf := least(1.0, greatest(0.0, ((pw0 - pl0) - 0.08) / 0.35));
    anchor := pw0 * basef * timek;
    w := 0.85 * sf;
    pfin := pw + (anchor - pw) * w;
    if w > 0 and pfin < 0.9 and pfin > 0 then
      scale := (1 - pfin) / greatest(pd + pl, 1e-9);
      return array[pfin, pd * scale, pl * scale];
    end if;
  else
    sf := least(1.0, greatest(0.0, ((pl0 - pw0) - 0.08) / 0.35));
    anchor := pl0 * basef * timek;
    w := 0.85 * sf;
    pfin := pl + (anchor - pl) * w;
    if w > 0 and pfin < 0.9 and pfin > 0 then
      scale := (1 - pfin) / greatest(pw + pd, 1e-9);
      return array[pw * scale, pd * scale, pfin];
    end if;
  end if;
  return array[pw, pd, pl];
end;
$function$;
-- Tam motor govdeleri canli DB'de guncel (0132 skor etkisi eklenmis 0130 govdesi).
-- Kaynak dogrulama: select pg_get_functiondef('public._market_odds_ft(double precision,double precision,integer,integer,integer,integer,integer)'::regprocedure);
--                    select pg_get_functiondef('public._market_odds_ft_real(double precision,double precision,integer,integer,integer,double precision,integer,integer)'::regprocedure);
-- Degisiklik ozeti: her iki motorda Poisson dizilerinden ONCE:
--   select * into bh, ba from public._chase_boost(d0, p_minute);
--   lh := lh * bh; la := la * ba;   (real: l1/l2)
-- + declare'a: d0 int := coalesce(p_hs,0)-coalesce(p_as,0); bh/ba double precision;
