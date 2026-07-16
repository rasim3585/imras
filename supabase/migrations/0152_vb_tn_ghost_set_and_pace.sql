-- 0152: voleybol/tenis hayalet "Set N+1 - 0-0" fix + pace alani.
-- Kaynak govdeler canlidan base64 ile cekildi (2026-07-16), degisiklikler:
-- 1) _vb_state/_tn_state: revealed son seti asla tam tuketmez (mac sonu 1-2sn
--    hayalet bos set bitti). 2) live donusune pace (saniye/puan vb, saniye/game
--    tenis) eklendi. 3) get_live_state raket dalinda pace passthrough.
-- SQL Editor: her CREATE ayri yapistirilir.

CREATE OR REPLACE FUNCTION public._vb_state(p_match uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  m record; elapsed double precision; t double precision; phase text;
  sets jsonb; total_pts int := 0; revealed int; i int; g int;
  sh int := 0; sa int := 0; gh int := 0; ga int := 0; cur int := 0; done boolean := false;
begin
  select starts_at, coalesce(duration_secs,480) as dur, status, secret_outcome, lambda_home, lambda_away,
         home_score, away_score into m from public.matches where id = p_match and sport = 'volleyball';
  if not found then return null; end if;
  elapsed := extract(epoch from (now() - m.starts_at));
  if m.status = 'finished' or elapsed >= m.dur then phase := 'finished';
  elsif elapsed < 0 then phase := 'upcoming'; else phase := 'live'; end if;
  if phase = 'finished' then
    return jsonb_build_object('phase','finished','period',null,
      'home_score', coalesce(m.home_score,(m.secret_outcome->>'sets_h')::int),
      'away_score', coalesce(m.away_score,(m.secret_outcome->>'sets_a')::int),'minute',0,'live_odds',null);
  elsif phase = 'upcoming' then
    return jsonb_build_object('phase','upcoming','period',null,'home_score',0,'away_score',0,'minute',0,'live_odds',null);
  end if;
  sets := m.secret_outcome->'sets';
  for i in 0 .. jsonb_array_length(sets)-1 loop total_pts := total_pts + (sets->i->>'h')::int + (sets->i->>'a')::int; end loop;
  t := least(greatest(elapsed / m.dur, 0), 0.999);
  -- 0152: hayalet "Set 6 - 0-0" fix — t=0.999 iken round toplam puana ulasip
  -- TUM setleri tuketebiliyordu; son set asla tam tuketilmez.
  revealed := least(round(t * total_pts)::int, greatest(total_pts - 1, 0));
  for i in 0 .. jsonb_array_length(sets)-1 loop
    exit when done;
    g := (sets->i->>'h')::int + (sets->i->>'a')::int;
    if revealed >= g then
      if (sets->i->>'h')::int > (sets->i->>'a')::int then sh := sh + 1; else sa := sa + 1; end if;
      revealed := revealed - g; cur := i + 1;
    else
      gh := least((sets->i->>'h')::int, round(revealed::double precision * (sets->i->>'h')::int / greatest(g,1))::int);
      ga := least((sets->i->>'a')::int, revealed - gh); cur := i; done := true;
    end if;
  end loop;
  return jsonb_build_object('phase','live', 'period', 'Set ' || (cur+1) || ' · ' || gh || '-' || ga,
    'home_score', sh, 'away_score', sa, 'minute', round(t*100)::int,
    'pace', round(m.dur::numeric / greatest(total_pts, 1), 2),
    'live_odds', public._vb_odds(m.lambda_home, m.lambda_away, sh, sa, t));
end; $function$


CREATE OR REPLACE FUNCTION public._tn_state(p_match uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  m record; elapsed double precision; t double precision; phase text;
  sets jsonb; total_games int := 0; revealed int; i int; g int;
  sh int := 0; sa int := 0; gh int := 0; ga int := 0; cur int := 0; done boolean := false;
begin
  select starts_at, coalesce(duration_secs,480) as dur, status, secret_outcome, lambda_home, lambda_away,
         home_score, away_score into m
    from public.matches where id = p_match and sport = 'tennis';
  if not found then return null; end if;
  elapsed := extract(epoch from (now() - m.starts_at));
  if m.status = 'finished' or elapsed >= m.dur then phase := 'finished';
  elsif elapsed < 0 then phase := 'upcoming'; else phase := 'live'; end if;
  if phase = 'finished' then
    return jsonb_build_object('phase','finished','period',null,
      'home_score', coalesce(m.home_score,(m.secret_outcome->>'sets_h')::int),
      'away_score', coalesce(m.away_score,(m.secret_outcome->>'sets_a')::int),
      'minute',0,'live_odds',null);
  elsif phase = 'upcoming' then
    return jsonb_build_object('phase','upcoming','period',null,'home_score',0,'away_score',0,'minute',0,'live_odds',null);
  end if;
  sets := m.secret_outcome->'sets';
  for i in 0 .. jsonb_array_length(sets)-1 loop
    total_games := total_games + (sets->i->>'h')::int + (sets->i->>'a')::int;
  end loop;
  t := least(greatest(elapsed / m.dur, 0), 0.999);
  -- 0152: hayalet set fix (vb ile ayni kalip) — son set asla tam tuketilmez.
  revealed := least(round(t * total_games)::int, greatest(total_games - 1, 0));
  for i in 0 .. jsonb_array_length(sets)-1 loop
    exit when done;
    g := (sets->i->>'h')::int + (sets->i->>'a')::int;
    if revealed >= g then
      if (sets->i->>'h')::int > (sets->i->>'a')::int then sh := sh + 1; else sa := sa + 1; end if;
      revealed := revealed - g; cur := i + 1;
    else
      gh := least((sets->i->>'h')::int, round(revealed::double precision * (sets->i->>'h')::int / greatest(g,1))::int);
      ga := least((sets->i->>'a')::int, revealed - gh);
      cur := i; done := true;
    end if;
  end loop;
  return jsonb_build_object('phase','live',
    'period', 'Set ' || (cur+1) || ' · ' || gh || '-' || ga,
    'home_score', sh, 'away_score', sa, 'minute', round(t*100)::int,
    'pace', round(m.dur::numeric / greatest(total_games, 1), 2),
    'live_odds', public._tn_odds(m.lambda_home, m.lambda_away, sh, sa, t));
end; $function$


CREATE OR REPLACE FUNCTION public.get_live_state(p_match_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_now timestamptz := now(); v_out jsonb := '[]'::jsonb; r record; m record;
  v_elapsed double precision; v_dur int; v_minute int; v_phase text;
  v_events jsonb; v_cards jsonb; v_hs int; v_as int; v_rh int; v_ra int;
  v_probs jsonb; v_odds jsonb; bs jsonb;
begin
  for r in select id from public.matches where id = any(p_match_ids) and status <> 'finished'
       and v_now >= starts_at + make_interval(secs => coalesce(duration_secs, 100)) loop
    perform public._finalize_match(r.id);
  end loop;
  for m in select * from public.matches where id = any(p_match_ids) loop
    v_dur := coalesce(m.duration_secs, 100); v_elapsed := extract(epoch from (v_now - m.starts_at));
    if m.sport in ('basketball','tennis','volleyball') then
      bs := case m.sport when 'basketball' then public._bb_state(m.id) when 'tennis' then public._tn_state(m.id) else public._vb_state(m.id) end;
      v_out := v_out || jsonb_build_object(
        'match_id',m.id,'home_team',m.home_team,'away_team',m.away_team,
        'phase',bs->>'phase','minute',coalesce((bs->>'minute')::int,0),
        'starts_in',greatest(0,ceil(-v_elapsed))::int,'duration_secs',v_dur,
        'home_score',coalesce((bs->>'home_score')::int,0),'away_score',coalesce((bs->>'away_score')::int,0),
        'events','[]'::jsonb,'cards','[]'::jsonb,'red_home',0,'red_away',0,
        'period', case when m.sport='basketball' and bs->>'phase'='live' then 'Q'||(bs->>'quarter') else bs->>'period' end,
        'live_odds',bs->'live_odds', 'pace', bs->'pace',
        'result',case when bs->>'phase'='finished' then coalesce(m.secret_outcome->>'result',m.result) end);
      continue;
    end if;
    if m.status = 'finished' or v_elapsed >= v_dur then v_phase := 'finished'; v_minute := 90;
    elsif v_elapsed < 0 then v_phase := 'upcoming'; v_minute := 0;
    else v_phase := 'live'; v_minute := least(90, greatest(0, floor(v_elapsed / v_dur * 90)::int)); end if;
    if m.secret_outcome is not null and v_phase <> 'upcoming' then
      select coalesce(jsonb_agg(e order by (e ->> 'minute')::int), '[]'::jsonb) into v_events
        from jsonb_array_elements(m.secret_outcome -> 'events') e where (e ->> 'minute')::int <= v_minute;
      select coalesce(jsonb_agg(c order by (c ->> 'minute')::int), '[]'::jsonb),
             count(*) filter (where c ->> 'team' = 'home'), count(*) filter (where c ->> 'team' = 'away')
        into v_cards, v_rh, v_ra
        from jsonb_array_elements(coalesce(m.secret_outcome -> 'cards', '[]'::jsonb)) c where (c ->> 'minute')::int <= v_minute;
    else v_events := '[]'::jsonb; v_cards := '[]'::jsonb; v_rh := 0; v_ra := 0; end if;
    select count(*) filter (where e ->> 'team' = 'home'), count(*) filter (where e ->> 'team' = 'away')
      into v_hs, v_as from jsonb_array_elements(v_events) e;
    if v_phase = 'live' then
      v_probs := jsonb_build_object('home', (m.true_probabilities ->> 'home')::double precision * power(0.72, coalesce(v_rh, 0)),
        'away', (m.true_probabilities ->> 'away')::double precision * power(0.72, coalesce(v_ra, 0)));
      v_odds := public._live_odds(v_probs, v_minute, coalesce(v_hs, 0), coalesce(v_as, 0));
    elsif v_phase = 'upcoming' then v_odds := m.display_odds; else v_odds := null; end if;
    v_out := v_out || jsonb_build_object('match_id', m.id, 'home_team', m.home_team, 'away_team', m.away_team,
      'phase', v_phase, 'minute', v_minute, 'starts_in', greatest(0, ceil(-v_elapsed))::int, 'duration_secs', v_dur,
      'home_score', coalesce(v_hs, 0), 'away_score', coalesce(v_as, 0),
      'events', v_events, 'cards', coalesce(v_cards, '[]'::jsonb),
      'red_home', coalesce(v_rh, 0), 'red_away', coalesce(v_ra, 0), 'live_odds', v_odds,
      'result', case when v_phase = 'finished' then coalesce(m.secret_outcome ->> 'result', m.result) end);
  end loop;
  return v_out;
end;
$function$
