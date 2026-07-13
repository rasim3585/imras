-- Sanal VOLEYBOL (e-Volleyball) — motor. Takım vs takım, best-of-5 set (ilk 3
-- kazanır), set 1-4 → 25 (2 fark), set 5 → 15 (2 fark), beraberlik yok. Futbol/
-- basketbol/tenis BİREBİR korunur; sport='volleyball' dispatch. Tabloya erişen
-- fonksiyonlar SECURITY DEFINER (get_bulletin definer'dan çağrılır; 0101 dersi).
-- Güç: vteams.attack; lambda_home/away = sA/sB. secret_outcome: {result, sets:
-- [{h,a}...], sets_h, sets_a}.
alter table public.vteams drop constraint if exists vteams_name_key;

insert into public.vteams (id, name, short_name, attack, defense, attack_base, defense_base, sport, league) values
  (301,'Poland','POL',1.10,1.0,1.10,1.0,'volleyball','VNL Men'),
  (302,'Italy','ITA',1.09,1.0,1.09,1.0,'volleyball','VNL Men'),
  (303,'France','FRA',1.08,1.0,1.08,1.0,'volleyball','VNL Men'),
  (304,'Brazil','BRA',1.07,1.0,1.07,1.0,'volleyball','VNL Men'),
  (305,'USA','USA',1.05,1.0,1.05,1.0,'volleyball','VNL Men'),
  (306,'Slovenia','SLO',1.04,1.0,1.04,1.0,'volleyball','VNL Men'),
  (307,'Japan','JPN',1.03,1.0,1.03,1.0,'volleyball','VNL Men'),
  (308,'Serbia','SRB',1.02,1.0,1.02,1.0,'volleyball','VNL Men'),
  (309,'Argentina','ARG',1.01,1.0,1.01,1.0,'volleyball','VNL Men'),
  (310,'Germany','GER',1.00,1.0,1.00,1.0,'volleyball','VNL Men'),
  (311,'Netherlands','NED',0.99,1.0,0.99,1.0,'volleyball','VNL Men'),
  (312,'Türkiye','TUR',0.98,1.0,0.98,1.0,'volleyball','VNL Men'),
  (313,'Iran','IRI',0.99,1.0,0.99,1.0,'volleyball','VNL Men'),
  (314,'Canada','CAN',0.97,1.0,0.97,1.0,'volleyball','VNL Men'),
  (315,'Türkiye','TUR',1.10,1.0,1.10,1.0,'volleyball','VNL Women'),
  (316,'Italy','ITA',1.09,1.0,1.09,1.0,'volleyball','VNL Women'),
  (317,'Brazil','BRA',1.08,1.0,1.08,1.0,'volleyball','VNL Women'),
  (318,'USA','USA',1.06,1.0,1.06,1.0,'volleyball','VNL Women'),
  (319,'China','CHN',1.05,1.0,1.05,1.0,'volleyball','VNL Women'),
  (320,'Poland','POL',1.04,1.0,1.04,1.0,'volleyball','VNL Women'),
  (321,'Serbia','SRB',1.03,1.0,1.03,1.0,'volleyball','VNL Women'),
  (322,'Japan','JPN',1.02,1.0,1.02,1.0,'volleyball','VNL Women'),
  (323,'Netherlands','NED',1.00,1.0,1.00,1.0,'volleyball','VNL Women'),
  (324,'Germany','GER',0.99,1.0,0.99,1.0,'volleyball','VNL Women'),
  (325,'Dominican Rep.','DOM',0.98,1.0,0.98,1.0,'volleyball','VNL Women'),
  (326,'Thailand','THA',0.96,1.0,0.96,1.0,'volleyball','VNL Women')
on conflict (id) do nothing;

create or replace function public._vb_make_outcome(p_sa double precision, p_sb double precision)
returns jsonb language plpgsql volatile as $$
declare
  pset double precision := power(p_sa,5) / (power(p_sa,5) + power(p_sb,5));
  sets jsonb := '[]'::jsonb; sh int := 0; sa int := 0; r double precision; wp int; lp int; cap int; is5 boolean; home_wins boolean;
begin
  while sh < 3 and sa < 3 loop
    home_wins := random() < pset;
    is5 := (sh + sa = 4); cap := case when is5 then 15 else 25 end;
    r := random();
    if r < 0.82 then
      wp := cap; lp := case when is5 then floor(random()*6)::int + 8 else floor(random()*9)::int + 15 end;
    else
      lp := case when is5 then 14 + floor(random()*3)::int else 24 + floor(random()*3)::int end; wp := lp + 2;
    end if;
    if home_wins then sets := sets || jsonb_build_object('h',wp,'a',lp); sh := sh + 1;
    else               sets := sets || jsonb_build_object('h',lp,'a',wp); sa := sa + 1; end if;
  end loop;
  return jsonb_build_object('result', case when sh > sa then 'home' else 'away' end,
                            'sets', sets, 'sets_h', sh, 'sets_a', sa);
end; $$;

create or replace function public._vb_odds(p_sa double precision, p_sb double precision, p_sh int, p_sa_sets int, p_t double precision)
returns jsonb language plpgsql immutable security definer set search_path to 'public' as $$
declare
  pset double precision := power(p_sa,5) / (power(p_sa,5) + power(p_sb,5));
  live boolean := (p_t > 0 or p_sh > 0 or p_sa_sets > 0);
  p30 double precision; p31 double precision; p32 double precision; p03 double precision; p13 double precision; p23 double precision;
  pm double precision; psh double precision; exp_sets double precision; ts_line numeric; p_ts_ov double precision;
  tp_mean double precision; tp_line numeric; p_tp_ov double precision;
  pcond double precision;
  ml numeric[]; sh_o numeric[]; ts numeric[]; tp numeric[]; cs numeric[]; fs numeric[];
begin
  p30 := power(pset,3); p31 := 3*power(pset,3)*(1-pset); p32 := 6*power(pset,3)*power(1-pset,2);
  p03 := power(1-pset,3); p13 := 3*power(1-pset,3)*pset; p23 := 6*power(1-pset,3)*power(pset,2);
  -- canlı: koşullu maç kazanma (kalan set sayısı azaldıkça)
  if p_sh >= 3 then pcond := 1; elsif p_sa_sets >= 3 then pcond := 0;
  else
    -- kaba: mevcut set farkına göre yeniden (basit ve monoton)
    pcond := case
      when p_sh - p_sa_sets >= 2 then 0.5 + 0.5*pset + 0.35
      when p_sh - p_sa_sets = 1 then 0.5 + 0.30*(pset-0.5) + 0.18
      when p_sh - p_sa_sets = -1 then 0.5 + 0.30*(pset-0.5) - 0.18
      when p_sh - p_sa_sets <= -2 then 0.5 + 0.5*pset - 0.35
      else pm end;
    if pcond is null then pcond := p30+p31+p32; end if;
    pcond := least(0.99, greatest(0.01, pcond));
  end if;
  pm := p30 + p31 + p32;

  ml := public._odds_line(array[case when live then pcond else pm end, 1-(case when live then pcond else pm end)], 0.05);
  psh := p30 + p31;   -- ev -1.5 set (3-0 veya 3-1)
  sh_o := public._odds_line(array[psh, 1-psh], 0.05);
  if live then
    return jsonb_build_object('ml_home', ml[1], 'ml_away', ml[2],
      'sh_home', sh_o[1], 'sh_away', sh_o[2],
      'ts_over',null,'ts_under',null,'ts_line',null,'tp_over',null,'tp_under',null,'tp_line',null,
      'cs_30',null,'cs_31',null,'cs_32',null,'cs_23',null,'cs_13',null,'cs_03',null,'fs_home',null,'fs_away',null);
  end if;
  exp_sets := 3*(p30+p03) + 4*(p31+p13) + 5*(p32+p23);
  ts_line := floor(exp_sets)::numeric + 0.5;
  -- P(set sayısı > line)
  if ts_line < 4 then p_ts_ov := 1 - p30 - p03;      -- >3.5 → 4 ya da 5
  else p_ts_ov := p32 + p23; end if;                  -- >4.5 → 5
  ts := public._odds_line(array[p_ts_ov, 1-p_ts_ov], 0.05);
  tp_mean := exp_sets * 45.5;
  tp_line := floor(tp_mean)::numeric + 0.5;
  p_tp_ov := public._norm_cdf((tp_mean - tp_line::double precision) / 13.0);
  tp := public._odds_line(array[p_tp_ov, 1-p_tp_ov], 0.05);
  cs := public._odds_line(array[p30, p31, p32, p23, p13, p03], 0.10);
  fs := public._odds_line(array[pset, 1-pset], 0.05);
  return jsonb_build_object('ml_home', ml[1], 'ml_away', ml[2],
    'sh_home', sh_o[1], 'sh_away', sh_o[2],
    'ts_over', ts[1], 'ts_under', ts[2], 'ts_line', ts_line,
    'tp_over', tp[1], 'tp_under', tp[2], 'tp_line', tp_line,
    'cs_30', cs[1], 'cs_31', cs[2], 'cs_32', cs[3], 'cs_23', cs[4], 'cs_13', cs[5], 'cs_03', cs[6],
    'fs_home', fs[1], 'fs_away', fs[2]);
end; $$;

create or replace function public._vb_tot_line(p_sa double precision, p_sb double precision)
returns numeric language sql immutable as $$
  with p as (select power(p_sa,5)/(power(p_sa,5)+power(p_sb,5)) as pset)
  select floor((3*(power(pset,3)+power(1-pset,3)) + 4*(3*power(pset,3)*(1-pset)+3*power(1-pset,3)*pset)
    + 5*(6*power(pset,3)*power(1-pset,2)+6*power(1-pset,3)*power(pset,2))) * 45.5)::numeric + 0.5
  from p;
$$;

create or replace function public._vb_state(p_match uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  m record; elapsed double precision; t double precision; phase text;
  sets jsonb; total_pts int := 0; revealed int; i int; g int;
  sh int := 0; sa int := 0; gh int := 0; ga int := 0; cur int := 0; done boolean := false;
begin
  select starts_at, coalesce(duration_secs,480) as dur, status, secret_outcome, lambda_home, lambda_away,
         home_score, away_score into m
    from public.matches where id = p_match and sport = 'volleyball';
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
  for i in 0 .. jsonb_array_length(sets)-1 loop
    total_pts := total_pts + (sets->i->>'h')::int + (sets->i->>'a')::int;
  end loop;
  t := least(greatest(elapsed / m.dur, 0), 0.999);
  revealed := round(t * total_pts)::int;
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
    'live_odds', public._vb_odds(m.lambda_home, m.lambda_away, sh, sa, t));
end; $$;

create or replace function public._vb_add_market(p_match uuid, p_type text, p_name text, p_sort int, p_opts jsonb)
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

create or replace function public._vb_ensure_markets(p_match uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare sa double precision; sb double precision; b jsonb;
begin
  select lambda_home, lambda_away into sa, sb from public.matches where id = p_match;
  if sa is null then return; end if;
  b := public._vb_odds(sa, sb, 0, 0, 0);
  perform public._vb_add_market(p_match, 'vb_moneyline', 'Maç Sonucu', 0, jsonb_build_array(
    jsonb_build_object('key','ml_home','label','1','odds', b->'ml_home'),
    jsonb_build_object('key','ml_away','label','2','odds', b->'ml_away')));
  perform public._vb_add_market(p_match, 'vb_sethcap', 'Set Handikabı', 1, jsonb_build_array(
    jsonb_build_object('key','sh_home','label','1 (-1.5)','odds', b->'sh_home'),
    jsonb_build_object('key','sh_away','label','2 (+1.5)','odds', b->'sh_away')));
  perform public._vb_add_market(p_match, 'vb_totalsets', 'Toplam Set ' || (b->>'ts_line'), 2, jsonb_build_array(
    jsonb_build_object('key','ts_over','label','Üst','odds', b->'ts_over'),
    jsonb_build_object('key','ts_under','label','Alt','odds', b->'ts_under')));
  perform public._vb_add_market(p_match, 'vb_totalpts', 'Toplam Sayı ' || (b->>'tp_line'), 3, jsonb_build_array(
    jsonb_build_object('key','tp_over','label','Üst','odds', b->'tp_over'),
    jsonb_build_object('key','tp_under','label','Alt','odds', b->'tp_under')));
  perform public._vb_add_market(p_match, 'vb_setbet', 'Set Bahsi', 4, jsonb_build_array(
    jsonb_build_object('key','cs_30','label','3-0','odds', b->'cs_30'),
    jsonb_build_object('key','cs_31','label','3-1','odds', b->'cs_31'),
    jsonb_build_object('key','cs_32','label','3-2','odds', b->'cs_32'),
    jsonb_build_object('key','cs_23','label','2-3','odds', b->'cs_23'),
    jsonb_build_object('key','cs_13','label','1-3','odds', b->'cs_13'),
    jsonb_build_object('key','cs_03','label','0-3','odds', b->'cs_03')));
  perform public._vb_add_market(p_match, 'vb_firstset', 'İlk Set', 5, jsonb_build_array(
    jsonb_build_object('key','fs_home','label','1','odds', b->'fs_home'),
    jsonb_build_object('key','fs_away','label','2','odds', b->'fs_away')));
end; $$;

create or replace function public._vb_match_markets(p_match uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare st jsonb; phase text; lo jsonb;
begin
  st := public._vb_state(p_match);
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

create or replace function public._vb_settle_markets(p_match uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare sh int; sa int; sets jsonb; sa_str double precision; sb_str double precision;
  tpts int := 0; i int; tp_line numeric; ts_line numeric; nsets int; win text[]; fs_home boolean;
begin
  select (secret_outcome->>'sets_h')::int, (secret_outcome->>'sets_a')::int, secret_outcome->'sets', lambda_home, lambda_away
    into sh, sa, sets, sa_str, sb_str from public.matches where id = p_match;
  if sh is null then return; end if;
  nsets := jsonb_array_length(sets);
  for i in 0 .. nsets-1 loop tpts := tpts + (sets->i->>'h')::int + (sets->i->>'a')::int; end loop;
  tp_line := public._vb_tot_line(sa_str, sb_str);
  ts_line := (public._vb_odds(sa_str, sb_str, 0, 0, 0)->>'ts_line')::numeric;
  fs_home := (sets->0->>'h')::int > (sets->0->>'a')::int;
  win := array[
    case when sh > sa then 'ml_home' else 'ml_away' end,
    case when (sh - sa) > 1.5 then 'sh_home' else 'sh_away' end,
    case when nsets > ts_line then 'ts_over' else 'ts_under' end,
    case when tpts > tp_line then 'tp_over' else 'tp_under' end,
    case when sh=3 and sa=0 then 'cs_30' when sh=3 and sa=1 then 'cs_31' when sh=3 and sa=2 then 'cs_32'
         when sh=2 and sa=3 then 'cs_23' when sh=1 and sa=3 then 'cs_13' else 'cs_03' end,
    case when fs_home then 'fs_home' else 'fs_away' end
  ];
  update public.market_options mo set is_winner = (mo.outcome_key = any(win))
  from public.markets mk where mk.id = mo.market_id and mk.match_id = p_match and mk.market_type like 'vb_%';
  update public.markets set status = 'settled' where match_id = p_match and market_type like 'vb_%';
end; $$;

create or replace function public._vb_update_ratings(p_match uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare K constant double precision := 0.02; R constant double precision := 0.04;
  hid smallint; aid smallint; sh int; sa int; ph double precision; res_h double precision;
begin
  select home_team_id, away_team_id, (secret_outcome->>'sets_h')::int, (secret_outcome->>'sets_a')::int
    into hid, aid, sh, sa from public.matches where id = p_match;
  if hid is null then return; end if;
  ph := (select power(a1.attack,5)/(power(a1.attack,5)+power(a2.attack,5)) from public.vteams a1, public.vteams a2 where a1.id=hid and a2.id=aid);
  res_h := case when sh > sa then 1.0 else 0.0 end;
  update public.vteams set attack = least(1.20, greatest(0.82, attack + K*(res_h - ph) - R*(attack - attack_base))) where id = hid;
  update public.vteams set attack = least(1.20, greatest(0.82, attack + K*((1-res_h) - (1-ph)) - R*(attack - attack_base))) where id = aid;
end; $$;

create or replace function public._vb_finalize(p_match uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare m record;
begin
  select id, status, starts_at, coalesce(duration_secs,480) as dur, secret_outcome
    into m from public.matches where id = p_match and sport = 'volleyball' for update;
  if not found or m.status = 'finished' then return; end if;
  if now() < m.starts_at + make_interval(secs => m.dur) then return; end if;
  update public.matches set status = 'finished', result = m.secret_outcome->>'result',
    home_score = (m.secret_outcome->>'sets_h')::int, away_score = (m.secret_outcome->>'sets_a')::int
  where id = p_match;
  perform public._vb_settle_markets(p_match);
  perform public._vb_update_ratings(p_match);
end; $$;

create or replace function public._vb_seed(p_target int default 3)
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
      where sport='volleyball' and status <> 'finished' and abs(extract(epoch from (starts_at - v_round))) < 5;
    v_make := greatest(0, 3 - v_have);
    for i in 1 .. v_make loop
      select coalesce(array_agg(distinct t), '{}') into v_busy from (
        select home_team_id t from public.matches where sport='volleyball' and status<>'finished' and home_team_id is not null and abs(extract(epoch from (starts_at - v_round))) < 480
        union
        select away_team_id from public.matches where sport='volleyball' and status<>'finished' and away_team_id is not null and abs(extract(epoch from (starts_at - v_round))) < 480
      ) x;
      select id,name,attack,league into v_hid,v_home,v_sa,v_league from public.vteams where sport='volleyball' and id <> all(v_busy) order by random() limit 1;
      select id,name,attack into v_aid,v_away,v_sb from public.vteams where sport='volleyball' and league=v_league and id <> all(v_busy) and id <> v_hid order by random() limit 1;
      if v_hid is null or v_aid is null then exit; end if;
      b := public._vb_odds(v_sa, v_sb, 0, 0, 0);
      insert into public.matches
        (sport, home_team, away_team, home_team_id, away_team_id, starts_at, status,
         lambda_home, lambda_away, true_probabilities, display_odds, secret_outcome, duration_secs)
      values
        ('volleyball', v_home, v_away, v_hid, v_aid, v_round, 'upcoming', v_sa, v_sb,
         jsonb_build_object('home', 1.0/(b->>'ml_home')::double precision, 'away', 1.0/(b->>'ml_away')::double precision),
         jsonb_build_object('home', b->'ml_home', 'away', b->'ml_away'),
         public._vb_make_outcome(v_sa, v_sb), 480)
      returning id into v_id;
      perform public._vb_ensure_markets(v_id);
      v_total := v_total + 1;
    end loop;
  end loop;
  return v_total;
end; $$;