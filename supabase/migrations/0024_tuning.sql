-- ============================================================================
-- pickplay.ai - 0024: tuning (share_coupon cache, red-card rate, odds clamp)
-- ----------------------------------------------------------------------------
-- IS 1: share_coupon exists + matches the client (share_coupon(p_coupon_id));
--       force PostgREST to reload its schema cache so the RPC resolves.
-- IS 2: red cards were far too frequent (~50% of matches). Drop to ~10%, still
--       deterministic (decided once at seed) and the red-card ODDS effect is
--       unchanged - only the frequency falls.
-- IS 3: live odds could reach ~14 for a side 0-2 down late, which reads as fake.
--       Clamp every priced odd to [1.05, 15.0] and compress the match-result
--       blend so extreme underdogs land ~9-10, not ~14. Settlement + the single
--       deterministic outcome are UNCHANGED - only the shown/locked live odds.
-- Pure ASCII. Idempotent. Server-authoritative, money stays closed.
-- ============================================================================

-- IS 3a: clamp ceiling 20 -> 15 (floor 1.05 kept; both markets share this).
create or replace function public._price(p double precision, blend double precision, n int)
returns numeric
language sql
immutable
set search_path = public
as $$
  select least(15.0, greatest(1.05,
    round((1.0 / (greatest(p * (1 - blend) + blend / n, 0.001) * 1.06))::numeric, 2)));
$$;

-- IS 3b: match-result live blend 0.20 -> 0.28 (extreme underdog max ~10, not ~14;
-- normal odds barely move). Other markets unchanged. Single source preserved.
create or replace function public._market_odds_ft(p_probs jsonb, p_minute int, p_hs int, p_as int)
returns jsonb
language plpgsql
immutable
set search_path = public
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
begin
  for hh in 0 .. cap loop
    fh[hh] := exp(-lh) * power(lh, hh) / factorial(hh)::double precision;
    fa[hh] := exp(-la) * power(la, hh) / factorial(hh)::double precision;
  end loop;
  for hh in 0 .. cap loop
    for aa in 0 .. cap loop
      pk := fh[hh] * fa[aa];
      s := s + pk;
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

  return jsonb_build_object(
    'home', public._price(pw, 0.28, 3), 'draw', public._price(pd, 0.28, 3), 'away', public._price(pl, 0.28, 3),
    'dc_1x', public._price(pw + pd, 0, 1), 'dc_12', public._price(pw + pl, 0, 1), 'dc_x2', public._price(pd + pl, 0, 1),
    'ou15_over', public._price(o15, 0.12, 2), 'ou15_under', public._price(1 - o15, 0.12, 2),
    'ou25_over', public._price(o25, 0.12, 2), 'ou25_under', public._price(1 - o25, 0.12, 2),
    'ou35_over', public._price(o35, 0.12, 2), 'ou35_under', public._price(1 - o35, 0.12, 2),
    'btts_yes', public._price(bt, 0.12, 2), 'btts_no', public._price(1 - bt, 0.12, 2),
    'oe_odd', public._price(od, 0.12, 2), 'oe_even', public._price(1 - od, 0.12, 2));
end;
$fn$;

-- IS 2: red-card frequency 0.50 / 0.18 -> 0.09 / 0.02 (about 1-2 in 10 matches).
-- Everything else in the outcome (score, timeline, card odds effect) is identical.
create or replace function public._make_outcome(p_probs jsonb)
returns jsonb
language plpgsql
volatile
set search_path = public
as $fn$
declare
  v_r      double precision := random();
  v_ph     double precision := (p_probs ->> 'home')::double precision;
  v_pd     double precision := (p_probs ->> 'draw')::double precision;
  v_result text;
  v_hs     int;
  v_as     int;
  v_cards  jsonb := '[]'::jsonb;
begin
  if v_r < v_ph then v_result := 'home';
  elsif v_r < v_ph + v_pd then v_result := 'draw';
  else v_result := 'away'; end if;

  if v_result = 'home' then
    v_hs := 1 + floor(random() * 3)::int; v_as := floor(random() * v_hs)::int;
  elsif v_result = 'away' then
    v_as := 1 + floor(random() * 3)::int; v_hs := floor(random() * v_as)::int;
  else
    v_hs := floor(random() * 4)::int; v_as := v_hs;
  end if;

  if random() < 0.09 then
    v_cards := v_cards || jsonb_build_object('minute', 25 + floor(random() * 60)::int,
      'team', case when random() < 0.5 then 'home' else 'away' end);
  end if;
  if random() < 0.02 then
    v_cards := v_cards || jsonb_build_object('minute', 30 + floor(random() * 55)::int,
      'team', case when random() < 0.5 then 'home' else 'away' end);
  end if;

  return jsonb_build_object(
    'result', v_result, 'home_score', v_hs, 'away_score', v_as,
    'events', public._make_timeline(v_hs, v_as), 'cards', v_cards);
end;
$fn$;

-- IS 1: reaffirm share_coupon + grant, then reload the PostgREST schema cache.
create or replace function public.share_coupon(p_coupon_id uuid)
returns void
language plpgsql security definer set search_path = public
as $fn$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  update public.coupons set shared_at = coalesce(shared_at, now())
   where id = p_coupon_id and user_id = auth.uid();
end;
$fn$;
revoke all on function public.share_coupon(uuid) from public, anon;
grant execute on function public.share_coupon(uuid) to authenticated;

notify pgrst, 'reload schema';
