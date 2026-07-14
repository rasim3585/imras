-- 0130: Canli futbol oranlarinda GERI DONUS TABANI + genel tavan 50 -> 20.
--
-- OLCUM (onceki davranis, guclu ev l=2.2 vs 0.9, 0-2 geride):
--   45' 9.53 -> 55' 15.0 -> 60' 19.9 -> 70' 42.4 -> 80'+ market NULL (kapali).
--   Dengeli takim 0-2 geride: 45' 34.5, sonra NULL. Zayif geride: hep NULL.
--
-- YENI KURALLAR (Rasim):
-- 1) Maks oran 20: _max_sellable_odds 50 -> 20; _odds_line ust esikte marketi
--    KAPATMAK yerine 20.00'ye SABITLER (alt esik davranisi degismedi).
-- 2) Geri donus tabani (iki futbol motoru: sanal _market_odds_ft ve gercek
--    _market_odds_ft_real): bariz guclu takim geride bile olsa kazanma
--    ihtimali maca-onu gucunden turetilen tabanin altina inmez.
--      taban = P0(kazanir) * basef(fark) * sf(barizlik) * timek(dakika)
--      basef: 1 fark 0.30 | 2 fark 0.165 | 3 fark 0.085 | 4+ 0.04
--      sf   : ((P0_kendi - P0_rakip) - 0.08) / 0.35, 0..1 kirpilir (bariz
--             guclu tam etki, dengeli neredeyse hic)
--      timek: dk<=45 -> 1 (ILK YARI SABIT); sonra ((88-dk)/43)^1.15 (IKINCI
--             YARIDA ORAN KADEMELI YUKSELIR); 88'+ taban yok.
--    Sonuc (guclu ev 0-2 geride): 45' ~9.4 | 55' ~12.6 | 60' ~15 | 70'+ 20.
--    Taban yalniz YUKSELTIR (lider tarafi ucuzlatmaz); X ve rakip orantili
--    yeniden normalize edilir; cifte sans ayni pw/pd/pl'den turedigi icin tutarli.

create or replace function public._max_sellable_odds()
returns double precision language sql immutable parallel safe
as $$ select 20.0::double precision $$;

create or replace function public._odds_line(p double precision[], margin double precision default 0.06)
returns numeric[] language plpgsql immutable parallel safe as $function$
declare
  cnt   int := array_length(p, 1);
  s     double precision := 0;
  imp   double precision[];
  si    double precision := 0;
  res   numeric[];
  i     int;
  raw   double precision;
  min_o double precision := public._min_sellable_odds();
  max_o double precision := public._max_sellable_odds();
begin
  if cnt is null or cnt = 0 then return null; end if;
  for i in 1 .. cnt loop s := s + coalesce(p[i], 0); end loop;
  if s <= 0 then return null; end if;
  for i in 1 .. cnt loop
    imp[i] := coalesce(p[i], 0) / s;
    si := si + imp[i];
  end loop;
  if si <= 0 then return null; end if;
  for i in 1 .. cnt loop imp[i] := imp[i] * (1 + margin) / si; end loop;
  for i in 1 .. cnt loop
    if imp[i] <= 0 then
      res[i] := null;                       -- skor cozmus, market kapali
    else
      raw := 1.0 / imp[i];
      if raw < min_o then
        res[i] := null;                     -- cok favori, satilamaz (0047)
      elsif raw > max_o then
        res[i] := round(max_o::numeric, 2); -- 0130: kapatma degil TAVANA sabitle
      else
        res[i] := round(raw::numeric, 2);
      end if;
    end if;
  end loop;
  return res;
end;
$function$;

-- Ortak taban mantigi: pw/pd/pl (mevcut) + pw0/pd0/pl0 (maca-onu) -> yeni uclu.
create or replace function public._comeback_floor(
  pw double precision, pd double precision, pl double precision,
  pw0 double precision, pl0 double precision,
  p_minute integer, p_hs integer, p_as integer
) returns double precision[] language plpgsql immutable parallel safe as $function$
declare
  d int := coalesce(p_as, 0) - coalesce(p_hs, 0);   -- >0: ev geride, <0: deplasman geride
  timek double precision;
  basef double precision;
  sf double precision;
  floorp double precision;
  scale double precision;
begin
  if d = 0 or coalesce(p_minute, 0) >= 88 then return array[pw, pd, pl]; end if;
  timek := case when coalesce(p_minute, 0) <= 45 then 1.0
                else power(greatest(0, 88 - p_minute)::double precision / 43.0, 1.15) end;
  basef := case abs(d) when 1 then 0.30 when 2 then 0.165 when 3 then 0.085 else 0.04 end;
  if d > 0 then                                     -- ev geride
    sf := least(1.0, greatest(0.0, ((pw0 - pl0) - 0.08) / 0.35));
    floorp := pw0 * basef * sf * timek;
    if floorp > pw and floorp < 0.9 then
      scale := (1 - floorp) / greatest(pd + pl, 1e-9);
      return array[floorp, pd * scale, pl * scale];
    end if;
  else                                              -- deplasman geride
    sf := least(1.0, greatest(0.0, ((pl0 - pw0) - 0.08) / 0.35));
    floorp := pl0 * basef * sf * timek;
    if floorp > pl and floorp < 0.9 then
      scale := (1 - floorp) / greatest(pw + pd, 1e-9);
      return array[pw * scale, pd * scale, floorp];
    end if;
  end if;
  return array[pw, pd, pl];
end;
$function$;
