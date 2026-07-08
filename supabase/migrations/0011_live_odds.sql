-- ============================================================================
-- pickplay.ai — 0011: live odds engine
-- ----------------------------------------------------------------------------
-- While a match is live, the 1/X/2 odds are recomputed from the CURRENT score
-- and the REMAINING time (not the fixed pre-match line). Model: remaining goals
-- for each team ~ Poisson(rate * remaining_fraction); combine with the current
-- score to get P(home win / draw / away win), then price with a small margin.
--
-- Behaviour this produces (the point of live betting):
--   * 0-0 at 85'  -> draw very likely  -> draw odds drop, win odds rise
--   * 1-0 at 85'  -> home nearly certain -> home ~1.10, away balloons
--   * underdog equalises -> its odds snap in (e.g. 7.80 -> ~3.5x) instantly,
--     the leader's odds jump out
--
-- Server-authoritative: uses the HIDDEN true_probabilities only to derive team
-- strength; exposes only the resulting odds. Self-contained + idempotent.
-- ============================================================================

-- Core model. Deterministic given (probs, minute, score) -> immutable.
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
  lh  double precision := (0.6 + 1.7 * ph) * r;   -- expected remaining home goals
  la  double precision := (0.6 + 1.7 * pa) * r;   -- expected remaining away goals
  d   int := p_hs - p_as;
  cap int := 8;
  hh  int; aa int; fd int;
  pw  double precision := 0; pd double precision := 0; pl double precision := 0;
  fh  double precision[]; fa double precision[];
  pk  double precision; s double precision;
  m   double precision := 1.06;   -- ~6% overround
begin
  -- Poisson pmfs for remaining goals of each team
  for hh in 0 .. cap loop
    fh[hh] := exp(-lh) * power(lh, hh) / factorial(hh)::double precision;
    fa[hh] := exp(-la) * power(la, hh) / factorial(hh)::double precision;
  end loop;

  for hh in 0 .. cap loop
    for aa in 0 .. cap loop
      pk := fh[hh] * fa[aa];
      fd := d + hh - aa;                 -- final goal difference
      if    fd > 0 then pw := pw + pk;
      elsif fd = 0 then pd := pd + pk;
      else               pl := pl + pk;
      end if;
    end loop;
  end loop;

  s := pw + pd + pl;
  if s <= 0 then s := 1; end if;
  pw := pw / s; pd := pd / s; pl := pl / s;

  return jsonb_build_object(
    'home', least(25.0, greatest(1.01, round((1.0 / (greatest(pw, 0.0005) * m))::numeric, 2))),
    'draw', least(25.0, greatest(1.01, round((1.0 / (greatest(pd, 0.0005) * m))::numeric, 2))),
    'away', least(25.0, greatest(1.01, round((1.0 / (greatest(pl, 0.0005) * m))::numeric, 2))));
end;
$fn$;

-- Public "what-if" wrapper (safe: computes only from caller-supplied inputs,
-- reveals nothing about any real match). Handy for testing + client previews.
create or replace function public.preview_live_odds(
  p_probs jsonb, p_minute int, p_home int, p_away int)
returns jsonb
language sql
immutable
security definer   -- runs as owner so it may call the internal _live_odds
set search_path = public
as $$ select public._live_odds(p_probs, p_minute, p_home, p_away); $$;

-- get_live_state now also returns live_odds: computed for live matches, the
-- pre-match line for upcoming, null once finished.
create or replace function public.get_live_state(p_match_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_now     timestamptz := now();
  v_out     jsonb := '[]'::jsonb;
  m         record;
  v_elapsed double precision;
  v_dur     int;
  v_minute  int;
  v_phase   text;
  v_events  jsonb;
  v_hs      int;
  v_as      int;
  v_odds    jsonb;
begin
  for m in select * from public.matches where id = any(p_match_ids) loop
    v_dur := coalesce(m.duration_secs, 100);
    v_elapsed := extract(epoch from (v_now - m.starts_at));

    if v_elapsed < 0 then
      v_phase := 'upcoming'; v_minute := 0;
    elsif v_elapsed >= v_dur then
      v_phase := 'finished'; v_minute := 90;
    else
      v_phase := 'live';
      v_minute := least(90, greatest(0, floor(v_elapsed / v_dur * 90)::int));
    end if;

    if m.secret_outcome is not null and v_phase <> 'upcoming' then
      select coalesce(jsonb_agg(e order by (e ->> 'minute')::int), '[]'::jsonb)
        into v_events
        from jsonb_array_elements(m.secret_outcome -> 'events') e
       where (e ->> 'minute')::int <= v_minute;
    else
      v_events := '[]'::jsonb;
    end if;

    select count(*) filter (where e ->> 'team' = 'home'),
           count(*) filter (where e ->> 'team' = 'away')
      into v_hs, v_as
      from jsonb_array_elements(v_events) e;

    if v_phase = 'live' then
      v_odds := public._live_odds(m.true_probabilities, v_minute, coalesce(v_hs, 0), coalesce(v_as, 0));
    elsif v_phase = 'upcoming' then
      v_odds := m.display_odds;
    else
      v_odds := null;
    end if;

    v_out := v_out || jsonb_build_object(
      'match_id', m.id,
      'home_team', m.home_team,
      'away_team', m.away_team,
      'phase', v_phase,
      'minute', v_minute,
      'starts_in', greatest(0, ceil(-v_elapsed))::int,
      'duration_secs', v_dur,
      'home_score', coalesce(v_hs, 0),
      'away_score', coalesce(v_as, 0),
      'events', v_events,
      'live_odds', v_odds,
      'result', case when v_phase = 'finished'
                     then coalesce(m.secret_outcome ->> 'result', m.result) end);
  end loop;
  return v_out;
end;
$fn$;

revoke all on function public._live_odds(jsonb, int, int, int) from public, anon, authenticated;
revoke all on function public.preview_live_odds(jsonb, int, int, int) from public, anon;
grant execute on function public.preview_live_odds(jsonb, int, int, int) to authenticated;
