-- ============================================================================
-- pickplay.ai — 0010: re-stagger upcoming kickoffs into the near-future window
-- ----------------------------------------------------------------------------
-- Earlier migrations seeded far-future kickoffs (15 min .. 4 h). Under the live
-- model that means nothing ever goes live. Re-time every still-open match into a
-- staggered near-future window (~20s apart) so the bulletin always has matches
-- "about to start" and cycling through live. One-time data fix; ongoing
-- freshness is handled by continuous generation (a later phase).
-- Idempotent (safe to re-run).
-- ============================================================================

with u as (
  select id, row_number() over (order by random()) as rn
    from public.matches
   where status = 'upcoming'
)
update public.matches m
   set starts_at = now() + make_interval(secs => 20 + (u.rn - 1) * 20)
  from u
 where u.id = m.id;

-- ensure every re-timed match has a hidden outcome ready to play out
update public.matches
   set secret_outcome = public._make_outcome(true_probabilities)
 where status = 'upcoming' and secret_outcome is null;
