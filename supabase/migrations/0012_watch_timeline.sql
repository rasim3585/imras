-- ============================================================================
-- pickplay.ai — 0012: watch timeline (personal replay of a bet-on match)
-- ----------------------------------------------------------------------------
-- Fixes "can't watch a match start to finish": matches run on a global clock,
-- so a user reaching one late sees it already over. Instead, let the client
-- replay a match locally from the moment they open the watch screen (0' -> 90').
--
-- get_watch_timeline returns the FULL outcome (result + goal events + team
-- strength) — but ONLY for a match the caller has a coupon on. Since the bet is
-- already locked, revealing that match's script can't be used to cheat, and it
-- lets the client drive a smooth personal playback + live odds offline.
-- Self-contained + idempotent.
-- ============================================================================

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

  -- caller must have a coupon selection on this match
  select exists (
    select 1
      from public.coupon_selections cs
      join public.market_options mo on mo.id = cs.market_option_id
      join public.markets mk       on mk.id = mo.market_id
      join public.coupons c        on c.id  = cs.coupon_id
     where mk.match_id = p_match_id and c.user_id = v_uid
  ) into v_has;
  if not v_has then
    raise exception 'no_bet_on_match';
  end if;

  select * into v_match from public.matches where id = p_match_id;
  if not found then raise exception 'Match not found'; end if;

  v_out := coalesce(v_match.secret_outcome,
                    public._make_outcome(v_match.true_probabilities));

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

revoke all on function public.get_watch_timeline(uuid) from public, anon;
grant execute on function public.get_watch_timeline(uuid) to authenticated;
