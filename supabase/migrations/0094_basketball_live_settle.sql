-- Sanal BASKETBOL — Faz BB-3a: canlı state + settle + rating + finalize.
-- Hepsi YENİ, standalone _bb_* fonksiyonları; hiçbir futbol fonksiyonu
-- değişmiyor. Dispatch (get_bulletin/get_live_state/_tick'e bağlama) BB-3b'de.

-- Canlı durum: 8dk wall-clock → çeyrek/skor reveal + canlı oran.
create or replace function public._bb_state(p_match uuid)
returns jsonb language plpgsql stable as $$
declare
  m record; elapsed double precision; t double precision; phase text;
  qz jsonb; qh int; qa int; ch int := 0; ca int := 0; q int; frac double precision;
  quarter int;
begin
  select starts_at, coalesce(duration_secs,480) as dur, status, secret_outcome,
         lambda_home, lambda_away, home_score, away_score
    into m from public.matches where id = p_match and sport = 'basketball';
  if not found then return null; end if;

  elapsed := extract(epoch from (now() - m.starts_at));
  if m.status = 'finished' or elapsed >= m.dur then phase := 'finished';
  elsif elapsed < 0 then phase := 'upcoming';
  else phase := 'live'; end if;

  if phase = 'finished' then
    return jsonb_build_object('phase','finished','quarter',4,'minute',48,
      'home_score', coalesce(m.home_score, (m.secret_outcome->>'home_score')::int),
      'away_score', coalesce(m.away_score, (m.secret_outcome->>'away_score')::int),
      'live_odds', null);
  elsif phase = 'upcoming' then
    return jsonb_build_object('phase','upcoming','quarter',0,'minute',0,
      'home_score',0,'away_score',0,'live_odds',null);
  end if;

  t := least(greatest(elapsed / m.dur, 0), 0.999);
  quarter := least(4, floor(t*4)::int + 1);
  qz := m.secret_outcome->'quarters';
  for q in 0..3 loop
    qh := (qz->q->>'h')::int; qa := (qz->q->>'a')::int;
    frac := least(greatest(t*4 - q, 0), 1);
    ch := ch + round(qh*frac)::int;
    ca := ca + round(qa*frac)::int;
  end loop;

  return jsonb_build_object('phase','live','quarter',quarter,'minute',round(t*48)::int,
    'home_score',ch,'away_score',ca,
    'live_odds', public._bb_game_odds(m.lambda_home, m.lambda_away, t, ch, ca));
end; $$;

-- Bir basketbol maçının market dizisi (bülten/detay için). Maç öncesi kayıtlı
-- oran, canlıda motor oranı; kapanan (null) seçenek atlanır.
create or replace function public._bb_match_markets(p_match uuid)
returns jsonb language plpgsql stable as $$
declare st jsonb; phase text; lo jsonb;
begin
  st := public._bb_state(p_match);
  if st is null or st->>'phase' = 'finished' then return '[]'::jsonb; end if;
  phase := st->>'phase'; lo := st->'live_odds';
  return coalesce((
    select jsonb_agg(m2 order by srt)
    from (
      select mk.sort_order as srt,
             jsonb_build_object('market_type', mk.market_type, 'name', mk.name, 'options', o.opts) as m2
      from public.markets mk
      cross join lateral (
        select jsonb_agg(jsonb_build_object(
                 'outcome_key', mo.outcome_key, 'label', mo.label, 'option_id', mo.id,
                 'odds', case when phase='live' then (lo->>mo.outcome_key)::numeric else mo.odds end)
                 order by mo.sort_order) as opts
        from public.market_options mo
        where mo.market_id = mk.id
          and (phase <> 'live' or (lo->>mo.outcome_key) is not null)
      ) o
      where mk.match_id = p_match and mk.status = 'open' and o.opts is not null
    ) s
  ), '[]'::jsonb);
end; $$;

-- Settle: basketbol marketlerini final skordan derecelendir. Çizgiler
-- lambda'dan deterministik (üretimdekiyle birebir aynı → tutarlı).
create or replace function public._bb_settle_markets(p_match uuid)
returns void language plpgsql as $$
declare hs int; as_ int; lh double precision; la double precision;
  hline numeric; tline numeric; hthl numeric; atl numeric; win text[];
begin
  select home_score, away_score, lambda_home, lambda_away into hs, as_, lh, la
    from public.matches where id = p_match;
  if hs is null then return; end if;
  hline := floor(lh-la)::numeric + 0.5; tline := floor(lh+la)::numeric + 0.5;
  hthl  := floor(lh)::numeric + 0.5;    atl   := floor(la)::numeric + 0.5;
  win := array[
    case when hs > as_ then 'ml_home' else 'ml_away' end,
    case when (hs - as_) > hline then 'hcap_home' else 'hcap_away' end,
    case when (hs + as_) > tline then 'tot_over' else 'tot_under' end,
    case when hs > hthl then 'hteam_over' else 'hteam_under' end,
    case when as_ > atl then 'ateam_over' else 'ateam_under' end
  ];
  update public.market_options mo set is_winner = (mo.outcome_key = any(win))
  from public.markets mk
  where mk.id = mo.market_id and mk.match_id = p_match and mk.market_type like 'bb_%';
  update public.markets set status = 'settled' where match_id = p_match and market_type like 'bb_%';
end; $$;

-- Rating drift (sayı bazlı; futbol _vupdate_ratings muadili). Clamp [0.80,1.20].
create or replace function public._bb_update_ratings(p_match uuid)
returns void language plpgsql as $$
declare K constant double precision := 0.03; R constant double precision := 0.05; S constant double precision := 108.0;
  hid smallint; aid smallint; hs int; as_ int; lh double precision; la double precision;
begin
  select home_team_id, away_team_id, home_score, away_score, lambda_home, lambda_away
    into hid, aid, hs, as_, lh, la from public.matches where id = p_match;
  if hid is null or hs is null then return; end if;
  update public.vteams set
    attack  = least(1.20, greatest(0.80, attack  + K*((hs - lh)/S) - R*(attack  - attack_base))),
    defense = least(1.20, greatest(0.80, defense + K*((as_ - la)/S) - R*(defense - defense_base)))
  where id = hid;
  update public.vteams set
    attack  = least(1.20, greatest(0.80, attack  + K*((as_ - la)/S) - R*(attack  - attack_base))),
    defense = least(1.20, greatest(0.80, defense + K*((hs - lh)/S) - R*(defense - defense_base)))
  where id = aid;
end; $$;

-- Finalize: süresi dolmuş basketbol maçını bitir (gizli sonucu aç, settle, rating).
create or replace function public._bb_finalize(p_match uuid)
returns void language plpgsql as $$
declare m record;
begin
  select id, status, starts_at, coalesce(duration_secs,480) as dur, secret_outcome
    into m from public.matches where id = p_match and sport = 'basketball' for update;
  if not found or m.status = 'finished' then return; end if;
  if now() < m.starts_at + make_interval(secs => m.dur) then return; end if;
  update public.matches set
    status = 'finished',
    result = m.secret_outcome->>'result',
    home_score = (m.secret_outcome->>'home_score')::int,
    away_score = (m.secret_outcome->>'away_score')::int
  where id = p_match;
  perform public._bb_settle_markets(p_match);
  perform public._bb_update_ratings(p_match);
end; $$;