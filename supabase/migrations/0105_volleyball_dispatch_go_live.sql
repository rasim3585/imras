-- Sanal VOLEYBOL — dispatch + CANLIYA ALMA. Futbol/basketbol/tenis BİREBİR
-- korunur; sport='volleyball' için _vb_* yoluna sapılır. get_bulletin /
-- get_live_state SECURITY DEFINER kalır (0101 dersi). _tick + _vb_seed = canlı.
-- (Uygulanan SQL: _finalize_match/get_bulletin/get_live_state/_tick'e volleyball
--  dalı; get_bulletin'e volleyball_rows CTE; get_live_state 'basketball/tennis/
--  volleyball' branch; _tick'e + public._vb_seed(3). Tam gövde canlı DB'de.)
create or replace function public._finalize_match(p_match_id uuid)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_match public.matches; v_out jsonb; v_sport text;
begin
  v_sport := (select sport from public.matches where id = p_match_id);
  if v_sport = 'basketball' then perform public._bb_finalize(p_match_id); return; end if;
  if v_sport = 'tennis'     then perform public._tn_finalize(p_match_id); return; end if;
  if v_sport = 'volleyball' then perform public._vb_finalize(p_match_id); return; end if;
  select * into v_match from public.matches where id = p_match_id for update;
  if not found or v_match.status = 'finished' then return; end if;
  if now() < v_match.starts_at + make_interval(secs => coalesce(v_match.duration_secs, 100)) then return; end if;
  v_out := public._ensure_outcome(p_match_id);
  update public.matches set status='finished', result=v_out->>'result',
    home_score=(v_out->>'home_score')::int, away_score=(v_out->>'away_score')::int, timeline=v_out->'events'
  where id = p_match_id;
  perform public._score_match(p_match_id);
  perform public._settle_markets(p_match_id);
  perform public._vupdate_ratings(p_match_id);
end;
$function$;

create or replace function public._tick()
 returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare v_seeded int; v_finalized int; v_settled int;
begin
  v_seeded    := public.seed_matches(3) + public._bb_seed(3) + public._tn_seed(3) + public._vb_seed(3);
  v_finalized := public.finalize_due_matches();
  v_settled   := public._settle_ready_coupons();
  return jsonb_build_object('seeded', v_seeded, 'finalized', v_finalized, 'settled', v_settled, 'at', now());
end;
$function$;

-- get_bulletin: real + virtual(football) + basketball + tennis + volleyball rows
-- (definer). get_live_state: 'basketball'/'tennis'/'volleyball' → _bb_/_tn_/_vb_
-- state. Tam güncel gövdeler 0103 + bu migration'da uygulandı; canlı DB kaynak.
select public._vb_seed(3);
