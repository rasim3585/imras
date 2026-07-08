-- ============================================================================
-- pickplay.ai — 0013: single-source outcome (fix double-result)
-- ----------------------------------------------------------------------------
-- SORUN 0: a match could resolve to two DIFFERENT results — once while watched
-- live, once when settled. Root cause: both get_watch_timeline and
-- _finalize_match used `coalesce(secret_outcome, _make_outcome(...))`. For a
-- match whose secret_outcome was null, that RE-ROLLS a fresh random outcome on
-- each path (and doesn't persist it) -> divergence.
--
-- Fix: the outcome is decided ONCE and PERSISTED, then never regenerated.
-- _ensure_outcome lazily fills secret_outcome (guarded, race-safe) and returns
-- it; both the watch path and the settle path read that one stored value. So
-- what you watch live == what settles == what re-settling shows, always.
-- Self-contained + idempotent.
-- ============================================================================

-- Persist-once: generate the hidden outcome only if missing, return the stored
-- value. The WHERE ... IS NULL guard makes concurrent callers converge on one.
create or replace function public._ensure_outcome(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_out jsonb;
begin
  update public.matches
     set secret_outcome = public._make_outcome(true_probabilities)
   where id = p_match_id and secret_outcome is null;
  select secret_outcome into v_out from public.matches where id = p_match_id;
  return v_out;
end;
$fn$;

-- watch path: read the ONE stored outcome (persist if somehow missing).
create or replace function public.get_watch_timeline(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid   uuid := auth.uid();
  v_match public.matches;
  v_has   boolean;
  v_out   jsonb;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select exists (
    select 1
      from public.coupon_selections cs
      join public.market_options mo on mo.id = cs.market_option_id
      join public.markets mk       on mk.id = mo.market_id
      join public.coupons c        on c.id  = cs.coupon_id
     where mk.match_id = p_match_id and c.user_id = v_uid
  ) into v_has;
  if not v_has then raise exception 'no_bet_on_match'; end if;

  select * into v_match from public.matches where id = p_match_id;
  if not found then raise exception 'Match not found'; end if;

  v_out := public._ensure_outcome(p_match_id);

  return jsonb_build_object(
    'match_id',      v_match.id,
    'home_team',     v_match.home_team,
    'away_team',     v_match.away_team,
    'duration_secs', coalesce(v_match.duration_secs, 100),
    'probs',         v_match.true_probabilities,
    'result',        v_out ->> 'result',
    'home_score',    (v_out ->> 'home_score')::int,
    'away_score',    (v_out ->> 'away_score')::int,
    'events',        v_out -> 'events');
end;
$fn$;

-- settle path: apply the SAME stored outcome (never re-roll).
create or replace function public._finalize_match(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_match public.matches;
  v_out   jsonb;
begin
  select * into v_match from public.matches where id = p_match_id for update;
  if not found or v_match.status = 'finished' then return; end if;

  v_out := public._ensure_outcome(p_match_id);   -- the one, stored outcome

  update public.matches
     set status = 'finished',
         result = v_out ->> 'result',
         home_score = (v_out ->> 'home_score')::int,
         away_score = (v_out ->> 'away_score')::int,
         timeline = v_out -> 'events'
   where id = p_match_id;

  perform public._score_match(p_match_id);
  perform public._settle_markets(p_match_id);
end;
$fn$;

-- Backfill: make sure no match is left without a persisted outcome.
update public.matches
   set secret_outcome = public._make_outcome(true_probabilities)
 where secret_outcome is null;

revoke all on function public._ensure_outcome(uuid) from public, anon, authenticated;
