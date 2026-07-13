-- Sanal TENİS (e-Tennis) — motor. Oyuncu vs oyuncu, best-of-3 set, beraberlik
-- yok. Futbol/basketbol BİREBİR korunur; sport='tennis' ile dispatch. Tüm
-- tabloya erişen fonksiyonlar SECURITY DEFINER (get_bulletin definer'dan çağrılıyor;
-- 0101 dersi). Güç: vteams.attack (~1.0); lambda_home/away = sA/sB. secret_outcome:
-- {result, sets:[{h,a}...], sets_h, sets_a}. Süre 480sn (best-of-3 sıkıştırılmış).

alter table public.vteams drop constraint if exists vteams_name_key;  -- idempotent (0097'de düştü)

insert into public.vteams (id, name, short_name, attack, defense, attack_base, defense_base, sport, league) values
  (201,'Novak Djokovic','DJO',1.12,1.0,1.12,1.0,'tennis','ATP'),
  (202,'Carlos Alcaraz','ALC',1.11,1.0,1.11,1.0,'tennis','ATP'),
  (203,'Jannik Sinner','SIN',1.11,1.0,1.11,1.0,'tennis','ATP'),
  (204,'Daniil Medvedev','MED',1.06,1.0,1.06,1.0,'tennis','ATP'),
  (205,'Alexander Zverev','ZVE',1.05,1.0,1.05,1.0,'tennis','ATP'),
  (206,'Andrey Rublev','RUB',1.02,1.0,1.02,1.0,'tennis','ATP'),
  (207,'Stefanos Tsitsipas','TSI',1.02,1.0,1.02,1.0,'tennis','ATP'),
  (208,'Casper Ruud','RUU',1.01,1.0,1.01,1.0,'tennis','ATP'),
  (209,'Taylor Fritz','FRI',1.01,1.0,1.01,1.0,'tennis','ATP'),
  (210,'Grigor Dimitrov','DIM',1.00,1.0,1.00,1.0,'tennis','ATP'),
  (211,'Alex de Minaur','DEM',1.00,1.0,1.00,1.0,'tennis','ATP'),
  (212,'Hubert Hurkacz','HUR',0.99,1.0,0.99,1.0,'tennis','ATP'),
  (213,'Tommy Paul','PAU',0.98,1.0,0.98,1.0,'tennis','ATP'),
  (214,'Ben Shelton','SHE',0.97,1.0,0.97,1.0,'tennis','ATP'),
  (215,'Frances Tiafoe','TIA',0.97,1.0,0.97,1.0,'tennis','ATP'),
  (216,'Holger Rune','RUN',0.99,1.0,0.99,1.0,'tennis','ATP'),
  (217,'Iga Swiatek','SWI',1.11,1.0,1.11,1.0,'tennis','WTA'),
  (218,'Aryna Sabalenka','SAB',1.10,1.0,1.10,1.0,'tennis','WTA'),
  (219,'Coco Gauff','GAU',1.06,1.0,1.06,1.0,'tennis','WTA'),
  (220,'Elena Rybakina','RYB',1.05,1.0,1.05,1.0,'tennis','WTA'),
  (221,'Jessica Pegula','PEG',1.02,1.0,1.02,1.0,'tennis','WTA'),
  (222,'Ons Jabeur','JAB',1.01,1.0,1.01,1.0,'tennis','WTA'),
  (223,'Marketa Vondrousova','VON',1.00,1.0,1.00,1.0,'tennis','WTA'),
  (224,'Qinwen Zheng','ZHE',1.02,1.0,1.02,1.0,'tennis','WTA'),
  (225,'Maria Sakkari','SAK',0.99,1.0,0.99,1.0,'tennis','WTA'),
  (226,'Daria Kasatkina','KAS',0.98,1.0,0.98,1.0,'tennis','WTA'),
  (227,'Beatriz Haddad Maia','HAD',0.98,1.0,0.98,1.0,'tennis','WTA'),
  (228,'Jelena Ostapenko','OST',0.99,1.0,0.99,1.0,'tennis','WTA')
on conflict (id) do nothing;

-- Ön-taahhütlü sonuç: best-of-3 set simülasyonu.
create or replace function public._tn_make_outcome(p_sa double precision, p_sb double precision)
returns jsonb language plpgsql volatile as $$
declare
  pset double precision := power(p_sa,4) / (power(p_sa,4) + power(p_sb,4));
  sets jsonb := '[]'::jsonb; sh int := 0; sa int := 0; r double precision; wg int; lg int; home_wins boolean;
begin
  while sh < 2 and sa < 2 loop
    home_wins := random() < pset;
    r := random();
    if r < 0.75 then wg := 6; lg := floor(random()*5)::int;      -- 6-0..6-4
    elsif r < 0.9 then wg := 7; lg := 5;                          -- 7-5
    else wg := 7; lg := 6; end if;                                -- 7-6
    if home_wins then sets := sets || jsonb_build_object('h',wg,'a',lg); sh := sh + 1;
    else               sets := sets || jsonb_build_object('h',lg,'a',wg); sa := sa + 1; end if;
  end loop;
  return jsonb_build_object('result', case when sh > sa then 'home' else 'away' end,
                            'sets', sets, 'sets_h', sh, 'sets_a', sa);
end; $$;

-- Oran paketi. Maç öncesi (sh=sa=0, tfrac=0): 4 market. Canlı: sadece Maç Sonucu
-- (set/ilk-set/toplam kapanır — gerçek kitaplarda da tenis canlıda daralır).
create or replace function public._tn_odds(p_sa double precision, p_sb double precision, p_sh int, p_sa_sets int, p_t double precision)
returns jsonb language plpgsql immutable security definer set search_path to 'public' as $$
declare
  pset double precision := power(p_sa,4) / (power(p_sa,4) + power(p_sb,4));
  pcond double precision; live boolean := (p_t > 0 or p_sh > 0 or p_sa_sets > 0);
  exp_sets double precision; tmean double precision; tline numeric; pov double precision;
  ml numeric[]; st numeric[]; fs numeric[]; tt numeric[];
begin
  if p_sh >= 2 then pcond := 1; elsif p_sa_sets >= 2 then pcond := 0;
  elsif p_sh = 1 and p_sa_sets = 0 then pcond := pset*(2-pset);
  elsif p_sh = 0 and p_sa_sets = 1 then pcond := pset*pset;
  elsif p_sh = 1 and p_sa_sets = 1 then pcond := pset;
  else pcond := pset*pset*(3-2*pset); end if;

  ml := public._odds_line(array[pcond, 1-pcond], 0.05);
  if live then
    return jsonb_build_object('ml_home', ml[1], 'ml_away', ml[2],
      'set_20',null,'set_21',null,'set_12',null,'set_02',null,
      'fs_home',null,'fs_away',null,'tot_over',null,'tot_under',null,'tot_line',null);
  end if;
  st := public._odds_line(array[pset*pset, 2*pset*pset*(1-pset), 2*(1-pset)*(1-pset)*pset, (1-pset)*(1-pset)], 0.08);
  fs := public._odds_line(array[pset, 1-pset], 0.05);
  exp_sets := 2*(pset*pset + (1-pset)*(1-pset)) + 3*(2*pset*pset*(1-pset) + 2*(1-pset)*(1-pset)*pset);
  tmean := exp_sets * 9.6; tline := floor(tmean)::numeric + 0.5;
  pov := public._norm_cdf((tmean - tline::double precision) / 3.6);
  tt := public._odds_line(array[pov, 1-pov], 0.04);
  return jsonb_build_object('ml_home', ml[1], 'ml_away', ml[2],
    'set_20', st[1], 'set_21', st[2], 'set_12', st[3], 'set_02', st[4],
    'fs_home', fs[1], 'fs_away', fs[2],
    'tot_over', tt[1], 'tot_under', tt[2], 'tot_line', tline);
end; $$;

-- Prematch toplam-oyun çizgisi (settle ile tutarlı olsun diye ayrı deterministik).
create or replace function public._tn_tot_line(p_sa double precision, p_sb double precision)
returns numeric language sql immutable as $$
  select floor((2*(power(p_sa,4)/(power(p_sa,4)+power(p_sb,4))*(power(p_sa,4)/(power(p_sa,4)+power(p_sb,4)))
    + (1-power(p_sa,4)/(power(p_sa,4)+power(p_sb,4)))*(1-power(p_sa,4)/(power(p_sa,4)+power(p_sb,4))))
    + 3*(2*power(power(p_sa,4)/(power(p_sa,4)+power(p_sb,4)),2)*(1-power(p_sa,4)/(power(p_sa,4)+power(p_sb,4)))
    + 2*power(1-power(p_sa,4)/(power(p_sa,4)+power(p_sb,4)),2)*(power(p_sa,4)/(power(p_sa,4)+power(p_sb,4))))
    ) * 9.6)::numeric + 0.5;
$$;

-- Canlı durum: 480sn wall-clock → set/oyun reveal + canlı oran.
create or replace function public._tn_state(p_match uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
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
  revealed := round(t * total_games)::int;

  -- kaç set tamam + mevcut set kısmi oyunlar
  for i in 0 .. jsonb_array_length(sets)-1 loop
    exit when done;
    g := (sets->i->>'h')::int + (sets->i->>'a')::int;
    if revealed >= g then
      if (sets->i->>'h')::int > (sets->i->>'a')::int then sh := sh + 1; else sa := sa + 1; end if;
      revealed := revealed - g; cur := i + 1;
    else
      -- mevcut set: oyunları kazanana orantılı dağıt
      gh := least((sets->i->>'h')::int, round(revealed::double precision * (sets->i->>'h')::int / greatest(g,1))::int);
      ga := least((sets->i->>'a')::int, revealed - gh);
      cur := i; done := true;
    end if;
  end loop;

  return jsonb_build_object('phase','live',
    'period', 'Set ' || (cur+1) || ' · ' || gh || '-' || ga,
    'home_score', sh, 'away_score', sa, 'minute', round(t*100)::int,
    'live_odds', public._tn_odds(m.lambda_home, m.lambda_away, sh, sa, t));
end; $$;

-- Idempotent market ekleyici (basketbolun _bb_add_market muadili).
create or replace function public._tn_add_market(p_match uuid, p_type text, p_name text, p_sort int, p_opts jsonb)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_mid uuid; o jsonb; i int := 0; n int := 0;
begin
  if exists (select 1 from public.markets where match_id = p_match and market_type = p_type) then return; end if;
  insert into public.markets (match_id, market_type, name, status, sort_order)
  values (p_match, p_type, p_name, 'open', p_sort) returning id into v_mid;
  for o in select value from jsonb_array_elements(p_opts) loop
    if (o->>'odds') is not null then
      insert into public.market_options (market_id, label, outcome_key, odds, sort_order)
      values (v_mid, o->>'label', o->>'key', (o->>'odds')::numeric, i); n := n + 1;
    end if;
    i := i + 1;
  end loop;
  if n = 0 then delete from public.markets where id = v_mid; end if;
end; $$;

create or replace function public._tn_ensure_markets(p_match uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare sa double precision; sb double precision; b jsonb;
begin
  select lambda_home, lambda_away into sa, sb from public.matches where id = p_match;
  if sa is null then return; end if;
  b := public._tn_odds(sa, sb, 0, 0, 0);
  perform public._tn_add_market(p_match, 'tn_moneyline', 'Maç Sonucu', 0, jsonb_build_array(
    jsonb_build_object('key','ml_home','label','1','odds', b->'ml_home'),
    jsonb_build_object('key','ml_away','label','2','odds', b->'ml_away')));
  perform public._tn_add_market(p_match, 'tn_setbet', 'Set Bahsi', 1, jsonb_build_array(
    jsonb_build_object('key','set_20','label','2-0','odds', b->'set_20'),
    jsonb_build_object('key','set_21','label','2-1','odds', b->'set_21'),
    jsonb_build_object('key','set_12','label','1-2','odds', b->'set_12'),
    jsonb_build_object('key','set_02','label','0-2','odds', b->'set_02')));
  perform public._tn_add_market(p_match, 'tn_firstset', 'İlk Set', 2, jsonb_build_array(
    jsonb_build_object('key','fs_home','label','1','odds', b->'fs_home'),
    jsonb_build_object('key','fs_away','label','2','odds', b->'fs_away')));
  perform public._tn_add_market(p_match, 'tn_total', 'Toplam Oyun ' || (b->>'tot_line'), 3, jsonb_build_array(
    jsonb_build_object('key','tot_over','label','Üst','odds', b->'tot_over'),
    jsonb_build_object('key','tot_under','label','Alt','odds', b->'tot_under')));
end; $$;

create or replace function public._tn_match_markets(p_match uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare st jsonb; phase text; lo jsonb;
begin
  st := public._tn_state(p_match);
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
        where mo.market_id = mk.id and (phase <> 'live' or (lo->>mo.outcome_key) is not null)
      ) o
      where mk.match_id = p_match and mk.status = 'open' and o.opts is not null
    ) s
  ), '[]'::jsonb);
end; $$;

create or replace function public._tn_settle_markets(p_match uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare sh int; sa int; sets jsonb; sa_str double precision; sb_str double precision;
  tgames int := 0; i int; tline numeric; win text[]; fs_home boolean;
begin
  select (secret_outcome->>'sets_h')::int, (secret_outcome->>'sets_a')::int, secret_outcome->'sets', lambda_home, lambda_away
    into sh, sa, sets, sa_str, sb_str from public.matches where id = p_match;
  if sh is null then return; end if;
  for i in 0 .. jsonb_array_length(sets)-1 loop
    tgames := tgames + (sets->i->>'h')::int + (sets->i->>'a')::int;
  end loop;
  tline := public._tn_tot_line(sa_str, sb_str);
  fs_home := (sets->0->>'h')::int > (sets->0->>'a')::int;
  win := array[
    case when sh > sa then 'ml_home' else 'ml_away' end,
    case when sh=2 and sa=0 then 'set_20' when sh=2 and sa=1 then 'set_21'
         when sh=1 and sa=2 then 'set_12' else 'set_02' end,
    case when fs_home then 'fs_home' else 'fs_away' end,
    case when tgames > tline then 'tot_over' else 'tot_under' end
  ];
  update public.market_options mo set is_winner = (mo.outcome_key = any(win))
  from public.markets mk where mk.id = mo.market_id and mk.match_id = p_match and mk.market_type like 'tn_%';
  update public.markets set status = 'settled' where match_id = p_match and market_type like 'tn_%';
end; $$;

create or replace function public._tn_update_ratings(p_match uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare K constant double precision := 0.02; R constant double precision := 0.04;
  hid smallint; aid smallint; sh int; sa int; ph double precision; res_h double precision;
begin
  select home_team_id, away_team_id, (secret_outcome->>'sets_h')::int, (secret_outcome->>'sets_a')::int
    into hid, aid, sh, sa from public.matches where id = p_match;
  if hid is null then return; end if;
  ph := (select power(a1.attack,4)/(power(a1.attack,4)+power(a2.attack,4))
         from public.vteams a1, public.vteams a2 where a1.id=hid and a2.id=aid);
  res_h := case when sh > sa then 1.0 else 0.0 end;
  update public.vteams set attack = least(1.20, greatest(0.82, attack + K*(res_h - ph) - R*(attack - attack_base))) where id = hid;
  update public.vteams set attack = least(1.20, greatest(0.82, attack + K*((1-res_h) - (1-ph)) - R*(attack - attack_base))) where id = aid;
end; $$;

create or replace function public._tn_finalize(p_match uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare m record;
begin
  select id, status, starts_at, coalesce(duration_secs,480) as dur, secret_outcome
    into m from public.matches where id = p_match and sport = 'tennis' for update;
  if not found or m.status = 'finished' then return; end if;
  if now() < m.starts_at + make_interval(secs => m.dur) then return; end if;
  update public.matches set status = 'finished', result = m.secret_outcome->>'result',
    home_score = (m.secret_outcome->>'sets_h')::int, away_score = (m.secret_outcome->>'sets_a')::int
  where id = p_match;
  perform public._tn_settle_markets(p_match);
  perform public._tn_update_ratings(p_match);
end; $$;

create or replace function public._tn_seed(p_target int default 3)
returns int language plpgsql security definer set search_path to 'public' as $$
declare
  v_base bigint := (floor(extract(epoch from now())/240)*240)::bigint;
  v_round timestamptz; v_off int; v_have int; v_make int; i int; v_total int := 0;
  v_busy smallint[]; v_hid smallint; v_aid smallint; v_home text; v_away text; v_league text;
  v_sa double precision; v_sb double precision; b jsonb; v_id uuid;
begin
  for v_off in -2 .. 5 loop
    v_round := to_timestamp(v_base + v_off*240);
    if v_round + make_interval(secs => 480) <= now() then continue; end if;
    select count(*) into v_have from public.matches
      where sport='tennis' and status <> 'finished' and abs(extract(epoch from (starts_at - v_round))) < 5;
    v_make := greatest(0, 3 - v_have);
    for i in 1 .. v_make loop
      select coalesce(array_agg(distinct t), '{}') into v_busy from (
        select home_team_id t from public.matches where sport='tennis' and status<>'finished' and home_team_id is not null and abs(extract(epoch from (starts_at - v_round))) < 480
        union
        select away_team_id from public.matches where sport='tennis' and status<>'finished' and away_team_id is not null and abs(extract(epoch from (starts_at - v_round))) < 480
      ) x;
      select id,name,attack,league into v_hid,v_home,v_sa,v_league from public.vteams where sport='tennis' and id <> all(v_busy) order by random() limit 1;
      select id,name,attack into v_aid,v_away,v_sb from public.vteams where sport='tennis' and league=v_league and id <> all(v_busy) and id <> v_hid order by random() limit 1;
      if v_hid is null or v_aid is null then exit; end if;
      b := public._tn_odds(v_sa, v_sb, 0, 0, 0);
      insert into public.matches
        (sport, home_team, away_team, home_team_id, away_team_id, starts_at, status,
         lambda_home, lambda_away, true_probabilities, display_odds, secret_outcome, duration_secs)
      values
        ('tennis', v_home, v_away, v_hid, v_aid, v_round, 'upcoming', v_sa, v_sb,
         jsonb_build_object('home', 1.0/(b->>'ml_home')::double precision, 'away', 1.0/(b->>'ml_away')::double precision),
         jsonb_build_object('home', b->'ml_home', 'away', b->'ml_away'),
         public._tn_make_outcome(v_sa, v_sb), 480)
      returning id into v_id;
      perform public._tn_ensure_markets(v_id);
      v_total := v_total + 1;
    end loop;
  end loop;
  return v_total;
end; $$;