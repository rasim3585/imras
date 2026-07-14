-- 0131: Nesine canli olcumlerine gore kalibrasyon (14 Tem gecesi, canli sayfadan):
--   * Fransa 0-2 Ispanya 62' (denk):        geride 23.60  -> bizde cap 20 OK
--   * Montrose 1-0 Dundee Utd 82' (guclu geride): 8.84    -> bizde 18.35 COK KARAMSAR
--   * Larne 2-1 Tre Fiori 69' (zayif geride):     17.00   -> bizde 20 OK
--   * Houston 17-8 Philadelphia 1C sonu (9 fark): geride 2.23 -> bizde 2.73 OK-ish,
--     ama gec macta (8 fark, %90) bizde 14.96 — Nesine ~7-9 verir.
--
-- 1) FUTBOL _comeback_floor: ikinci yari cozulmesi yumusatildi —
--    timek: dk<=45 -> 1; sonra 0.35 + 0.65*(88-dk)/43 (tabana inmez, 88'+ serbest);
--    basef fark=1: 0.30 -> 0.34. Sonuc (bariz guclu):
--    1 gol geride: 45' 3.5 | 70' ~8 | 82' ~10 (Nesine 8.84'e yakin)
--    2 gol geride: 45' ~8.5 | 60' ~12 | 70' ~15 | 84'+ 20
-- 2) BASKETBOL _bb_game_odds: kuyruk genisletildi (kitaplarin gec-mac fiyati):
--    sd = 11*sqrt(rem) min 2.5  ->  12.5*sqrt(rem) + 1.5, min 4.0.
--    9 fark 1C sonu: 2.73 -> ~2.5; guclu 8 fark %90'da: 14.96 -> ~6 (Nesine bandi).
-- 3) VOLEYBOL _vb_odds canli ML: dogrusal sezgisel yerine TAM Bo5 kosullu
--    olasilik (set olasiligi pset ile). Eski bozukluk: zayif 0-2 geride 4.06
--    gosteriyordu (gercek 20+); guclu 0-2 geride asiri iyimserdi.
--    P(0,1)=p^3(4-3p) degil— dikkat: (0,1) = p*P(1,1)+(1-p)*P(0,2) = p^3(4-3p).
-- 4) TENIS: olculdu, gercek girdi bandinda (0.92-1.16) kitaplarla uyumlu —
--    degisiklik yok (cap 20 globalden geliyor).

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
  floorp double precision;
  scale double precision;
begin
  if d = 0 or coalesce(p_minute, 0) >= 88 then return array[pw, pd, pl]; end if;
  -- Nesine 0131 kalibrasyonu: ikinci yari cozulmesi yumusak (82'de hala guclu prim)
  timek := case when coalesce(p_minute, 0) <= 45 then 1.0
                else 0.35 + 0.65 * greatest(0, 88 - p_minute)::double precision / 43.0 end;
  basef := case abs(d) when 1 then 0.34 when 2 then 0.165 when 3 then 0.085 else 0.04 end;
  if d > 0 then
    sf := least(1.0, greatest(0.0, ((pw0 - pl0) - 0.08) / 0.35));
    floorp := pw0 * basef * sf * timek;
    if floorp > pw and floorp < 0.9 then
      scale := (1 - floorp) / greatest(pd + pl, 1e-9);
      return array[floorp, pd * scale, pl * scale];
    end if;
  else
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

create or replace function public._bb_game_odds(
  p_lh double precision, p_la double precision, p_t double precision, p_ch integer, p_ca integer
) returns jsonb language plpgsql immutable parallel safe as $function$
declare
  hline numeric; tline numeric; hthl numeric; atl numeric;
  rem double precision; rh double precision; ra double precision;
  mmean double precision; tmean double precision; hmean double precision; amean double precision;
  sdt double precision; sd2 double precision; p double precision;
  ml numeric[]; hc numeric[]; tt numeric[]; hh numeric[]; aa numeric[];
begin
  hline := floor(p_lh - p_la)::numeric + 0.5;
  tline := floor(p_lh + p_la)::numeric + 0.5;
  hthl  := floor(p_lh)::numeric + 0.5;
  atl   := floor(p_la)::numeric + 0.5;
  rem := greatest(1.0 - p_t, 0.0);
  rh := p_lh*rem; ra := p_la*rem;
  mmean := (p_ch - p_ca) + (rh - ra);
  tmean := (p_ch + p_ca) + (rh + ra);
  hmean := p_ch + rh; amean := p_ca + ra;
  -- 0131: kuyruk genis — kitaplar gec macta geri donuse Nesine gibi prim verir
  sdt := greatest(12.5*sqrt(rem) + 1.5, 4.0);
  sd2 := sdt*sqrt(2.0);
  p := public._norm_cdf(mmean/sd2);                                    ml := public._odds_line(array[p, 1-p], 0.05);
  p := public._norm_cdf((mmean - hline::double precision)/sd2);    hc := public._odds_line(array[p, 1-p], 0.04);
  p := public._norm_cdf((tmean - tline::double precision)/sd2);    tt := public._odds_line(array[p, 1-p], 0.04);
  p := public._norm_cdf((hmean - hthl::double precision)/sdt);     hh := public._odds_line(array[p, 1-p], 0.05);
  p := public._norm_cdf((amean - atl::double precision)/sdt);      aa := public._odds_line(array[p, 1-p], 0.05);
  return jsonb_build_object(
    'ml_home', ml[1], 'ml_away', ml[2],
    'hcap_line', hline, 'hcap_home', hc[1], 'hcap_away', hc[2],
    'tot_line', tline, 'tot_over', tt[1], 'tot_under', tt[2],
    'hteam_line', hthl, 'hteam_over', hh[1], 'hteam_under', hh[2],
    'ateam_line', atl,  'ateam_over', aa[1], 'ateam_under', aa[2]);
end; $function$;

create or replace function public._vb_odds(
  p_sa double precision, p_sb double precision, p_sh integer, p_sa_sets integer, p_t double precision
) returns jsonb language plpgsql immutable security definer
set search_path to 'public' as $function$
declare
  pset double precision := power(p_sa,5) / (power(p_sa,5) + power(p_sb,5));
  live boolean := (p_t > 0 or p_sh > 0 or p_sa_sets > 0);
  p30 double precision; p31 double precision; p32 double precision; p03 double precision; p13 double precision; p23 double precision;
  pm double precision; psh double precision; exp_sets double precision; ts_line numeric; p_ts_ov double precision;
  tp_mean double precision; tp_line numeric; p_tp_ov double precision; pcond double precision;
  q double precision := 1 - pset;
  ml numeric[]; sh_o numeric[]; ts numeric[]; tp numeric[]; cs numeric[]; fs numeric[];
begin
  p30 := power(pset,3); p31 := 3*power(pset,3)*(1-pset); p32 := 6*power(pset,3)*power(1-pset,2);
  p03 := power(1-pset,3); p13 := 3*power(1-pset,3)*pset; p23 := 6*power(1-pset,3)*power(pset,2);
  pm := p30 + p31 + p32;
  -- 0131: canli ML = TAM Bo5 kosullu olasilik (eski dogrusal sezgisel, zayif
  -- takima 0-2 geride ~4 veriyordu — gercek 20+; simdi matematik dogru)
  if p_sh >= 3 then pcond := 1; elsif p_sa_sets >= 3 then pcond := 0;
  else
    pcond := case
      when p_sh = 2 and p_sa_sets = 0 then 1 - q*q*q
      when p_sh = 2 and p_sa_sets = 1 then 1 - q*q
      when p_sh = 2 and p_sa_sets = 2 then pset
      when p_sh = 1 and p_sa_sets = 0 then 1 - (q*q*q)*(1 + 3*pset)
      when p_sh = 1 and p_sa_sets = 1 then pset*pset*(3 - 2*pset)
      when p_sh = 1 and p_sa_sets = 2 then pset*pset
      when p_sh = 0 and p_sa_sets = 1 then power(pset,3)*(4 - 3*pset)
      when p_sh = 0 and p_sa_sets = 2 then power(pset,3)
      else pm end;
    pcond := least(0.995, greatest(0.005, pcond));
  end if;
  ml := public._odds_line(array[case when live then pcond else pm end, 1-(case when live then pcond else pm end)], 0.05);
  psh := p30 + p31;
  sh_o := public._odds_line(array[psh, 1-psh], 0.05);
  if live then
    return jsonb_build_object('ml_home', ml[1], 'ml_away', ml[2], 'sh_home', sh_o[1], 'sh_away', sh_o[2],
      'ts_over',null,'ts_under',null,'ts_line',null,'tp_over',null,'tp_under',null,'tp_line',null,
      'cs_30',null,'cs_31',null,'cs_32',null,'cs_23',null,'cs_13',null,'cs_03',null,'fs_home',null,'fs_away',null);
  end if;
  exp_sets := 3*(p30+p03) + 4*(p31+p13) + 5*(p32+p23);
  ts_line := floor(exp_sets)::numeric + 0.5;
  if ts_line < 4 then p_ts_ov := 1 - p30 - p03; else p_ts_ov := p32 + p23; end if;
  ts := public._odds_line(array[p_ts_ov, 1-p_ts_ov], 0.05);
  tp_mean := exp_sets * 45.5; tp_line := floor(tp_mean)::numeric + 0.5;
  p_tp_ov := public._norm_cdf((tp_mean - tp_line::double precision) / 13.0);
  tp := public._odds_line(array[p_tp_ov, 1-p_tp_ov], 0.05);
  cs := public._odds_line(array[p30, p31, p32, p23, p13, p03], 0.10);
  fs := public._odds_line(array[pset, 1-pset], 0.05);
  return jsonb_build_object('ml_home', ml[1], 'ml_away', ml[2], 'sh_home', sh_o[1], 'sh_away', sh_o[2],
    'ts_over', ts[1], 'ts_under', ts[2], 'ts_line', ts_line,
    'tp_over', tp[1], 'tp_under', tp[2], 'tp_line', tp_line,
    'cs_30', cs[1], 'cs_31', cs[2], 'cs_32', cs[3], 'cs_23', cs[4], 'cs_13', cs[5], 'cs_03', cs[6],
    'fs_home', fs[1], 'fs_away', fs[2]);
end; $function$;
