-- Sanal BASKETBOL — Faz BB-4b: get_live_state basketbol dalı. Futbol yolu BİREBİR
-- korunur; sport='basketball' için durum _bb_state'ten türetilir (gol event/kart
-- yok; canlı oran _bb_game_odds bundle'ı). Detay/canlı ekranı doğru skor+oran alır.
create or replace function public.get_live_state(p_match_ids uuid[])
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_now     timestamptz := now();
  v_out     jsonb := '[]'::jsonb;
  r         record;
  m         record;
  v_elapsed double precision;
  v_dur     int;
  v_minute  int;
  v_phase   text;
  v_events  jsonb;
  v_cards   jsonb;
  v_hs      int; v_as int; v_rh int; v_ra int;
  v_probs   jsonb;
  v_odds    jsonb;
  bs        jsonb;
begin
  for r in
    select id from public.matches
     where id = any(p_match_ids) and status <> 'finished'
       and v_now >= starts_at + make_interval(secs => coalesce(duration_secs, 100))
  loop
    perform public._finalize_match(r.id);
  end loop;

  for m in select * from public.matches where id = any(p_match_ids) loop
    v_dur := coalesce(m.duration_secs, 100);
    v_elapsed := extract(epoch from (v_now - m.starts_at));

    if m.sport = 'basketball' then
      bs := public._bb_state(m.id);
      v_out := v_out || jsonb_build_object(
        'match_id', m.id, 'home_team', m.home_team, 'away_team', m.away_team,
        'phase', bs->>'phase', 'minute', coalesce((bs->>'minute')::int, 0),
        'starts_in', greatest(0, ceil(-v_elapsed))::int, 'duration_secs', v_dur,
        'home_score', coalesce((bs->>'home_score')::int, 0), 'away_score', coalesce((bs->>'away_score')::int, 0),
        'events', '[]'::jsonb, 'cards', '[]'::jsonb, 'red_home', 0, 'red_away', 0,
        'period', case when bs->>'phase' = 'live' then 'Q' || (bs->>'quarter') end,
        'live_odds', bs->'live_odds',
        'result', case when bs->>'phase' = 'finished' then coalesce(m.secret_outcome->>'result', m.result) end);
      continue;
    end if;

    if m.status = 'finished' or v_elapsed >= v_dur then
      v_phase := 'finished'; v_minute := 90;
    elsif v_elapsed < 0 then
      v_phase := 'upcoming'; v_minute := 0;
    else
      v_phase := 'live';
      v_minute := least(90, greatest(0, floor(v_elapsed / v_dur * 90)::int));
    end if;

    if m.secret_outcome is not null and v_phase <> 'upcoming' then
      select coalesce(jsonb_agg(e order by (e ->> 'minute')::int), '[]'::jsonb) into v_events
        from jsonb_array_elements(m.secret_outcome -> 'events') e
       where (e ->> 'minute')::int <= v_minute;
      select coalesce(jsonb_agg(c order by (c ->> 'minute')::int), '[]'::jsonb),
             count(*) filter (where c ->> 'team' = 'home'),
             count(*) filter (where c ->> 'team' = 'away')
        into v_cards, v_rh, v_ra
        from jsonb_array_elements(coalesce(m.secret_outcome -> 'cards', '[]'::jsonb)) c
       where (c ->> 'minute')::int <= v_minute;
    else
      v_events := '[]'::jsonb; v_cards := '[]'::jsonb; v_rh := 0; v_ra := 0;
    end if;

    select count(*) filter (where e ->> 'team' = 'home'),
           count(*) filter (where e ->> 'team' = 'away')
      into v_hs, v_as from jsonb_array_elements(v_events) e;

    if v_phase = 'live' then
      v_probs := jsonb_build_object(
        'home', (m.true_probabilities ->> 'home')::double precision * power(0.72, coalesce(v_rh, 0)),
        'away', (m.true_probabilities ->> 'away')::double precision * power(0.72, coalesce(v_ra, 0)));
      v_odds := public._live_odds(v_probs, v_minute, coalesce(v_hs, 0), coalesce(v_as, 0));
    elsif v_phase = 'upcoming' then
      v_odds := m.display_odds;
    else
      v_odds := null;
    end if;

    v_out := v_out || jsonb_build_object(
      'match_id', m.id, 'home_team', m.home_team, 'away_team', m.away_team,
      'phase', v_phase, 'minute', v_minute,
      'starts_in', greatest(0, ceil(-v_elapsed))::int, 'duration_secs', v_dur,
      'home_score', coalesce(v_hs, 0), 'away_score', coalesce(v_as, 0),
      'events', v_events, 'cards', coalesce(v_cards, '[]'::jsonb),
      'red_home', coalesce(v_rh, 0), 'red_away', coalesce(v_ra, 0),
      'live_odds', v_odds,
      'result', case when v_phase = 'finished' then coalesce(m.secret_outcome ->> 'result', m.result) end);
  end loop;
  return v_out;
end;
$function$;