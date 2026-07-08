-- ============================================================================
-- pickplay.ai - 0025: odds realism calibration (display/pricing only)
-- ----------------------------------------------------------------------------
-- Makes the shown/locked odds behave like a real book (Nesine/bet365 feel).
-- Settlement, the single deterministic outcome, no-money -- ALL unchanged; only
-- the priced odds change.
--   * _odds_line(): price a mutually-exclusive market properly -- bound each
--     implied prob to [1/15, 1/1.01], RENORMALISE to a target overround, then
--     convert to odds. So the market margin stays consistent even when a leg is
--     clamped, and no odd is ever absurd (<=15) or silly (>=1.01).
--   * 1X2 / totals / btts / odd-even / first-half markets go through _odds_line
--     (3-outcome margin ~6%, 2-outcome margin ~4%).
--   * Double chance stays priced individually (overlapping bets), floor 1.01.
--   * Compression blend eased 0.28 -> 0.20 so a strong favourite reads ~1.45-1.55
--     and a side 0-2 down at 75' reads ~10 (not ~14), approaching 15 near full
--     time; the renormalise keeps the overround honest.
-- Pure ASCII. Idempotent.
-- ============================================================================

-- individual price (used by double chance): floor 1.01, cap 15
create or replace function public._price(p double precision, blend double precision, n int)
returns numeric
language sql immutable set search_path = public
as $$
  select least(15.0, greatest(1.01,
    round((1.0 / (greatest(p * (1 - blend) + blend / n, 0.001) * 1.06))::numeric, 2)));
$$;

-- price one mutually-exclusive market: clamp implied -> renormalise to overround
-- (1 + margin) -> odds in [1.01, 15]. Keeps the book margin consistent.
create or replace function public._odds_line(p double precision[], margin double precision)
returns numeric[]
language plpgsql immutable set search_path = public
as $fn$
declare
  n int := array_length(p, 1);
  i int; s double precision := 0; si double precision := 0;
  imp double precision[] := '{}'; out numeric[] := '{}';
begin
  for i in 1 .. n loop s := s + greatest(p[i], 0); end loop;
  if s <= 0 then s := 1; end if;
  for i in 1 .. n loop
    imp[i] := least(0.990099, greatest(0.066667, greatest(p[i], 0) / s));   -- bound to [1/15, 1/1.01]
    si := si + imp[i];
  end loop;
  for i in 1 .. n loop
    imp[i] := imp[i] * (1 + margin) / si;                                    -- renormalise to the overround
    out[i] := round(least(15.0, greatest(1.01, (1.0 / imp[i])))::numeric, 2);
  end loop;
  return out;
end;
$fn$;

-- Full-time market odds (single source for match_result live odds).
create or replace function public._market_odds_ft(p_probs jsonb, p_minute int, p_hs int, p_as int)
returns jsonb
language plpgsql immutable set search_path = public
as $fn$
declare
  ph double precision := coalesce((p_probs ->> 'home')::double precision, 0.40);
  pa double precision := coalesce((p_probs ->> 'away')::double precision, 0.30);
  r  double precision := greatest(0.0, (90 - least(p_minute, 90))::double precision / 90.0);
  lh double precision := (0.6 + 1.7 * ph) * r;
  la double precision := (0.6 + 1.7 * pa) * r;
  cap int := 8;
  fh double precision[]; fa double precision[];
  hh int; aa int; fhome int; faway int; tot int;
  pk double precision; s double precision := 0;
  pw double precision := 0; pd double precision := 0; pl double precision := 0;
  o15 double precision := 0; o25 double precision := 0; o35 double precision := 0;
  bt double precision := 0; od double precision := 0;
  b double precision := 0.20;                 -- 1X2 compression toward uniform
  b2 double precision := 0.10;                -- 2-outcome compression
  m3 numeric[]; l15 numeric[]; l25 numeric[]; l35 numeric[]; lbt numeric[]; loe numeric[];
begin
  for hh in 0 .. cap loop
    fh[hh] := exp(-lh) * power(lh, hh) / factorial(hh)::double precision;
    fa[hh] := exp(-la) * power(la, hh) / factorial(hh)::double precision;
  end loop;
  for hh in 0 .. cap loop
    for aa in 0 .. cap loop
      pk := fh[hh] * fa[aa]; s := s + pk;
      fhome := p_hs + hh; faway := p_as + aa; tot := fhome + faway;
      if fhome > faway then pw := pw + pk; elsif fhome = faway then pd := pd + pk; else pl := pl + pk; end if;
      if tot > 1 then o15 := o15 + pk; end if;
      if tot > 2 then o25 := o25 + pk; end if;
      if tot > 3 then o35 := o35 + pk; end if;
      if fhome >= 1 and faway >= 1 then bt := bt + pk; end if;
      if (tot % 2) = 1 then od := od + pk; end if;
    end loop;
  end loop;
  if s <= 0 then s := 1; end if;
  pw := pw / s; pd := pd / s; pl := pl / s;
  o15 := o15 / s; o25 := o25 / s; o35 := o35 / s; bt := bt / s; od := od / s;

  m3  := public._odds_line(array[pw*(1-b)+b/3, pd*(1-b)+b/3, pl*(1-b)+b/3], 0.06);
  l15 := public._odds_line(array[o15*(1-b2)+b2/2, (1-o15)*(1-b2)+b2/2], 0.04);
  l25 := public._odds_line(array[o25*(1-b2)+b2/2, (1-o25)*(1-b2)+b2/2], 0.04);
  l35 := public._odds_line(array[o35*(1-b2)+b2/2, (1-o35)*(1-b2)+b2/2], 0.04);
  lbt := public._odds_line(array[bt*(1-b2)+b2/2, (1-bt)*(1-b2)+b2/2], 0.04);
  loe := public._odds_line(array[od*(1-b2)+b2/2, (1-od)*(1-b2)+b2/2], 0.04);

  return jsonb_build_object(
    'home', m3[1], 'draw', m3[2], 'away', m3[3],
    'dc_1x', public._price(pw + pd, 0, 1), 'dc_12', public._price(pw + pl, 0, 1), 'dc_x2', public._price(pd + pl, 0, 1),
    'ou15_over', l15[1], 'ou15_under', l15[2],
    'ou25_over', l25[1], 'ou25_under', l25[2],
    'ou35_over', l35[1], 'ou35_under', l35[2],
    'btts_yes', lbt[1], 'btts_no', lbt[2],
    'oe_odd', loe[1], 'oe_even', loe[2]);
end;
$fn$;

-- First-half markets (pre-match).
create or replace function public._market_odds_ht(p_probs jsonb)
returns jsonb
language plpgsql immutable set search_path = public
as $fn$
declare
  ph double precision := coalesce((p_probs ->> 'home')::double precision, 0.40);
  pa double precision := coalesce((p_probs ->> 'away')::double precision, 0.30);
  lh double precision := (0.6 + 1.7 * ph) * 0.5;
  la double precision := (0.6 + 1.7 * pa) * 0.5;
  cap int := 6;
  fh double precision[]; fa double precision[];
  hh int; aa int; pk double precision; s double precision := 0;
  pw double precision := 0; pd double precision := 0; pl double precision := 0; ov double precision := 0;
  m3 numeric[]; lov numeric[];
begin
  for hh in 0 .. cap loop
    fh[hh] := exp(-lh) * power(lh, hh) / factorial(hh)::double precision;
    fa[hh] := exp(-la) * power(la, hh) / factorial(hh)::double precision;
  end loop;
  for hh in 0 .. cap loop
    for aa in 0 .. cap loop
      pk := fh[hh] * fa[aa]; s := s + pk;
      if hh > aa then pw := pw + pk; elsif hh = aa then pd := pd + pk; else pl := pl + pk; end if;
      if hh + aa > 0 then ov := ov + pk; end if;
    end loop;
  end loop;
  if s <= 0 then s := 1; end if;
  pw := pw / s; pd := pd / s; pl := pl / s; ov := ov / s;
  m3  := public._odds_line(array[pw*0.8+0.0667, pd*0.8+0.0667, pl*0.8+0.0667], 0.06);
  lov := public._odds_line(array[ov*0.9+0.05, (1-ov)*0.9+0.05], 0.04);
  return jsonb_build_object(
    'ht_home', m3[1], 'ht_draw', m3[2], 'ht_away', m3[3],
    'htou05_over', lov[1], 'htou05_under', lov[2]);
end;
$fn$;

revoke all on function public._odds_line(double precision[], double precision) from public, anon, authenticated;

notify pgrst, 'reload schema';
