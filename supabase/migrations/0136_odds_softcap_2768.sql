-- 0136: oran tavani 20.00 -> 27.68 + yumusak tavan (soft-cap).
-- Sorun: sert clamp tavanda esitliyordu — canli 0-2'de beraberlik (3 gol
-- gerekir) ile deplasman galibiyeti (4 gol gerekir) ikisi de 20.00 gorunuyordu.
-- Cozum: 20'ye kadar birebir ayni (0130-0132 kalibrasyonu bozulmaz), 20 ustu
-- rasyonel kompresorle 27.68'e asimptotik: soft(r) = C - (C-20)/(1+(r-20)/(C-20)).
-- Ornekler: 20->20.00, 24->22.63, 30->24.34, 60->26.44, 100->27.01.
-- Olcum (canli): guclu ev 0-2 geride 78' 17.35 -> 85' 22.80 -> 88' 27.21;
-- zayif ev 0-2 geride 85': galibiyet 27.60 vs beraberlik 26.35 (ayristi).
-- Degisen: _soft_cap (yeni), _max_sellable_odds 27.68, _odds_line kuyruk,
-- _price kuyruk, _make_display_odds (tavansizdi ~51.8 cikabiliyordu).
-- _comeback_floor/_chase_boost OLASILIK hesaplar, 20 icermez -> dokunulmadi.
-- Tam govdeler MCP ile canliya uygulandi (2026-07-15); bu dosya kayittir.

create or replace function public._soft_cap(raw double precision)
returns double precision
language sql immutable parallel safe
as $$
  select case
    when raw is null then null
    when raw <= 20.0 then raw
    else public._max_sellable_odds()
         - (public._max_sellable_odds() - 20.0)
           / (1.0 + (raw - 20.0) / (public._max_sellable_odds() - 20.0))
  end
$$;

create or replace function public._max_sellable_odds()
returns double precision
language sql immutable parallel safe
as $$ select 27.68::double precision $$;

-- _odds_line: "elsif raw > max_o then round(max_o)" dali kaldirildi ->
--             "else round(public._soft_cap(raw), 2)"; max_o degiskeni silindi.
-- _price:     ust esik dali kaldirildi; final "return round(public._soft_cap(raw), 2)".
-- _make_display_odds: uc cikti da greatest(round(_soft_cap(o),2), 1.05) ile sarildi.
