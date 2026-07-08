-- ============================================================================
-- pickplay.ai — 0014: soften live odds (match the client)
-- ----------------------------------------------------------------------------
-- The live prices were too brutal at the extremes (0-0 @85' draw ~1.07, wins
-- ~15-17, cap 25). Blend each probability 20% toward uniform before pricing, and
-- tighten the bounds (floor 1.05, cap 20). Identical to the client-side model
-- (liveModel.ts, BLEND = 0.2) so a replay and the server agree.
-- Self-contained + idempotent.
-- ============================================================================

create or replace function public._live_odds(
  p_probs jsonb, p_minute int, p_hs int, p_as int)
returns jsonb
language plpgsql
immutable
set search_path = public
as $fn$
declare
  ph  double precision := coalesce((p_probs ->> 'home')::double precision, 0.40);
  pa  double precision := coalesce((p_probs ->> 'away')::double precision, 0.30);
  r   double precision := greatest(0.0, (90 - least(p_minute, 90))::double precision / 90.0);
  lh  double precision := (0.6 + 1.7 * ph) * r;
  la  double precision := (0.6 + 1.7 * pa) * r;
  d   int := p_hs - p_as;
  cap int := 8;
  hh  int; aa int; fd int;
  pw  double precision := 0; pd double precision := 0; pl double precision := 0;
  fh  double precision[]; fa double precision[];
  pk  double precision; s double precision;
  m   double precision := 1.06;
  b   double precision := 0.20;   -- blend toward uniform
begin
  for hh in 0 .. cap loop
    fh[hh] := exp(-lh) * power(lh, hh) / factorial(hh)::double precision;
    fa[hh] := exp(-la) * power(la, hh) / factorial(hh)::double precision;
  end loop;
  for hh in 0 .. cap loop
    for aa in 0 .. cap loop
      pk := fh[hh] * fa[aa];
      fd := d + hh - aa;
      if    fd > 0 then pw := pw + pk;
      elsif fd = 0 then pd := pd + pk;
      else               pl := pl + pk;
      end if;
    end loop;
  end loop;
  s := pw + pd + pl;
  if s <= 0 then s := 1; end if;
  pw := (pw / s) * (1 - b) + b / 3;
  pd := (pd / s) * (1 - b) + b / 3;
  pl := (pl / s) * (1 - b) + b / 3;

  return jsonb_build_object(
    'home', least(20.0, greatest(1.05, round((1.0 / (greatest(pw, 0.001) * m))::numeric, 2))),
    'draw', least(20.0, greatest(1.05, round((1.0 / (greatest(pd, 0.001) * m))::numeric, 2))),
    'away', least(20.0, greatest(1.05, round((1.0 / (greatest(pl, 0.001) * m))::numeric, 2))));
end;
$fn$;
