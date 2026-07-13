-- Sanal BASKETBOL — Faz BB-2b: skor + oran çekirdeği (özgün motor).
-- Futbol Poisson yerine NORMAL-dağılım sayı modeli. Beraberlik yok (eşitlikte
-- uzatma). Skor çeyrek-çeyrek üretilir (İY/çeyrek marketleri sonra buradan
-- çıkacak). Hiçbir futbol fonksiyonu değişmiyor; _bb_seed henüz _tick'e bağlı
-- DEĞİL (canlı akış BB-3'te dispatch ile açılacak).

-- Standart normal CDF (Abramowitz-Stegun 7.1.26, ~7 hane doğruluk).
create or replace function public._norm_cdf(z double precision)
returns double precision language plpgsql immutable parallel safe as $$
declare ax double precision; t double precision; d double precision; tail double precision;
begin
  ax := abs(z);
  t  := 1.0 / (1.0 + 0.2316419 * ax);
  d  := 0.3989422804014327 * exp(-ax*ax/2.0);
  tail := d*t*(0.319381530 + t*(-0.356563782 + t*(1.781477937 + t*(-1.821255978 + t*1.330274429))));
  if z >= 0 then return 1.0 - tail; else return tail; end if;
end; $$;

-- Handikap/çizgi işaret formatı: +5.5 / -5.5
create or replace function public._bb_sgn(v numeric)
returns text language sql immutable as $$
  select case when v >= 0 then '+' || v::text else v::text end;
$$;

-- Ön-taahhütlü sonuç: 4 çeyrek skor + (gerekiyorsa) uzatma. Box-Muller ile
-- takım-çeyrek başına Normal(beklenen/4, 5.5). Beraberlik olamaz.
create or replace function public._bb_make_outcome(p_lh double precision, p_la double precision)
returns jsonb language plpgsql volatile as $$
declare
  QSD constant double precision := 5.5;
  qh int[] := '{}'; qa int[] := '{}';
  th int := 0; ta int := 0; q int; hh int; aa int; oth int := 0; ota int := 0;
begin
  for q in 1..4 loop
    hh := greatest(8, round(p_lh/4.0 + QSD*sqrt(-2.0*ln(greatest(random(),1e-12)))*cos(2*pi()*random()))::int);
    aa := greatest(8, round(p_la/4.0 + QSD*sqrt(-2.0*ln(greatest(random(),1e-12)))*cos(2*pi()*random()))::int);
    qh := qh || hh; qa := qa || aa; th := th + hh; ta := ta + aa;
  end loop;
  if th = ta then
    if p_lh >= p_la then oth := 3 + floor(random()*6)::int; ota := floor(random()*greatest(oth-1,1))::int;
    else                ota := 3 + floor(random()*6)::int; oth := floor(random()*greatest(ota-1,1))::int; end if;
    th := th + oth; ta := ta + ota;
    if th = ta then th := th + 1; oth := oth + 1; end if;
  end if;
  return jsonb_build_object(
    'result', case when th > ta then 'home' else 'away' end,
    'home_score', th, 'away_score', ta,
    'quarters', jsonb_build_array(
      jsonb_build_object('h',qh[1],'a',qa[1]), jsonb_build_object('h',qh[2],'a',qa[2]),
      jsonb_build_object('h',qh[3],'a',qa[3]), jsonb_build_object('h',qh[4],'a',qa[4])),
    'ot', jsonb_build_object('h',oth,'a',ota));
end; $$;

-- Oyun-seviyesi market oran paketi. Hem maç öncesi (t=0, skor 0) hem canlı
-- (t=geçen kesir, ch/ca=anlık skor) için. Çizgiler beklenen sayıdan deterministik.
create or replace function public._bb_game_odds(p_lh double precision, p_la double precision, p_t double precision, p_ch int, p_ca int)
returns jsonb language plpgsql immutable parallel safe as $$
declare
  SD constant double precision := 11.0;
  hline numeric; tline numeric; hthl numeric; atl numeric;
  rem double precision; rh double precision; ra double precision;
  mmean double precision; tmean double precision; hmean double precision; amean double precision;
  sdt double precision; sd2 double precision; p double precision;
  ml numeric[]; hc numeric[]; tt numeric[]; hh numeric[]; aa numeric[];
begin
  hline := floor(p_lh - p_la)::numeric + 0.5;   -- ev sahibi spread (hep .5 → push yok)
  tline := floor(p_lh + p_la)::numeric + 0.5;   -- toplam sayı çizgisi
  hthl  := floor(p_lh)::numeric + 0.5;          -- ev takım toplamı
  atl   := floor(p_la)::numeric + 0.5;          -- deplasman takım toplamı
  rem := greatest(1.0 - p_t, 0.0);
  rh := p_lh*rem; ra := p_la*rem;
  mmean := (p_ch - p_ca) + (rh - ra);
  tmean := (p_ch + p_ca) + (rh + ra);
  hmean := p_ch + rh; amean := p_ca + ra;
  sdt := greatest(SD*sqrt(rem), 2.5);
  sd2 := sdt*sqrt(2.0);
  p := public._norm_cdf(mmean/sd2);                       ml := public._odds_line(array[p, 1-p], 0.05);
  p := public._norm_cdf((mmean - hline::double precision)/sd2);  hc := public._odds_line(array[p, 1-p], 0.04);
  p := public._norm_cdf((tmean - tline::double precision)/sd2);  tt := public._odds_line(array[p, 1-p], 0.04);
  p := public._norm_cdf((hmean - hthl::double precision)/sdt);   hh := public._odds_line(array[p, 1-p], 0.05);
  p := public._norm_cdf((amean - atl::double precision)/sdt);    aa := public._odds_line(array[p, 1-p], 0.05);
  return jsonb_build_object(
    'ml_home', ml[1], 'ml_away', ml[2],
    'hcap_line', hline, 'hcap_home', hc[1], 'hcap_away', hc[2],
    'tot_line', tline, 'tot_over', tt[1], 'tot_under', tt[2],
    'hteam_line', hthl, 'hteam_over', hh[1], 'hteam_under', hh[2],
    'ateam_line', atl,  'ateam_over', aa[1], 'ateam_under', aa[2]);
end; $$;

-- Idempotent market+seçenek ekleyici (null oranlı seçenek atlanır; hepsi null
-- ise market düşürülür).
create or replace function public._bb_add_market(p_match uuid, p_type text, p_name text, p_sort int, p_opts jsonb)
returns void language plpgsql as $$
declare v_mid uuid; o jsonb; i int := 0; n int := 0;
begin
  if exists (select 1 from public.markets where match_id = p_match and market_type = p_type) then return; end if;
  insert into public.markets (match_id, market_type, name, status, sort_order)
  values (p_match, p_type, p_name, 'open', p_sort) returning id into v_mid;
  for o in select value from jsonb_array_elements(p_opts) loop
    if (o->>'odds') is not null then
      insert into public.market_options (market_id, label, outcome_key, odds, sort_order)
      values (v_mid, o->>'label', o->>'key', (o->>'odds')::numeric, i);
      n := n + 1;
    end if;
    i := i + 1;
  end loop;
  if n = 0 then delete from public.markets where id = v_mid; end if;
end; $$;

-- Basketbol oyun-seviyesi marketleri (maç öncesi oranlarla).
create or replace function public._bb_ensure_markets(p_match uuid)
returns void language plpgsql as $$
declare lh double precision; la double precision; b jsonb; hl numeric;
begin
  select lambda_home, lambda_away into lh, la from public.matches where id = p_match;
  if lh is null then return; end if;
  b := public._bb_game_odds(lh, la, 0, 0, 0);
  hl := (b->>'hcap_line')::numeric;
  perform public._bb_add_market(p_match, 'bb_moneyline', 'Maç Sonucu', 0, jsonb_build_array(
    jsonb_build_object('key','ml_home','label','1','odds', b->'ml_home'),
    jsonb_build_object('key','ml_away','label','2','odds', b->'ml_away')));
  perform public._bb_add_market(p_match, 'bb_handicap', 'Handikap', 1, jsonb_build_array(
    jsonb_build_object('key','hcap_home','label','1 ('|| public._bb_sgn(-hl) ||')','odds', b->'hcap_home'),
    jsonb_build_object('key','hcap_away','label','2 ('|| public._bb_sgn(hl)  ||')','odds', b->'hcap_away')));
  perform public._bb_add_market(p_match, 'bb_total', 'Toplam Sayı ' || (b->>'tot_line'), 2, jsonb_build_array(
    jsonb_build_object('key','tot_over','label','Üst','odds', b->'tot_over'),
    jsonb_build_object('key','tot_under','label','Alt','odds', b->'tot_under')));
  perform public._bb_add_market(p_match, 'bb_total_home', 'Ev Sahibi Toplam ' || (b->>'hteam_line'), 3, jsonb_build_array(
    jsonb_build_object('key','hteam_over','label','Üst','odds', b->'hteam_over'),
    jsonb_build_object('key','hteam_under','label','Alt','odds', b->'hteam_under')));
  perform public._bb_add_market(p_match, 'bb_total_away', 'Deplasman Toplam ' || (b->>'ateam_line'), 4, jsonb_build_array(
    jsonb_build_object('key','ateam_over','label','Üst','odds', b->'ateam_over'),
    jsonb_build_object('key','ateam_under','label','Alt','odds', b->'ateam_under')));
end; $$;

-- Basketbol maç üretici (futbol seed_matches'ın basketbol muadili). BASE=108,
-- ev avantajı 1.025. HENÜZ _tick'e bağlı değil (BB-3'te).
create or replace function public._bb_seed(p_target int default 3)
returns int language plpgsql security definer set search_path to 'public' as $$
declare
  BASE constant double precision := 108.0;
  HOME_ADV constant double precision := 1.025;
  v_base bigint := (floor(extract(epoch from now())/240)*240)::bigint;
  v_round timestamptz; v_off int; v_have int; v_make int; i int; v_total int := 0;
  v_busy smallint[]; v_hid smallint; v_aid smallint; v_home text; v_away text;
  v_oh double precision; v_dh double precision; v_oa double precision; v_da double precision;
  v_lh double precision; v_la double precision; b jsonb; v_id uuid;
begin
  for v_off in -2 .. 5 loop
    v_round := to_timestamp(v_base + v_off*240);
    if v_round + make_interval(secs => 480) <= now() then continue; end if;
    select count(*) into v_have from public.matches
      where sport='basketball' and status <> 'finished'
        and abs(extract(epoch from (starts_at - v_round))) < 5;
    v_make := greatest(0, 3 - v_have);
    for i in 1 .. v_make loop
      select coalesce(array_agg(distinct t), '{}') into v_busy from (
        select home_team_id t from public.matches where sport='basketball' and status<>'finished' and home_team_id is not null and abs(extract(epoch from (starts_at - v_round))) < 480
        union
        select away_team_id  from public.matches where sport='basketball' and status<>'finished' and away_team_id is not null and abs(extract(epoch from (starts_at - v_round))) < 480
      ) x;
      select id,name,attack,defense into v_hid,v_home,v_oh,v_dh from public.vteams where sport='basketball' and id <> all(v_busy) order by random() limit 1;
      select id,name,attack,defense into v_aid,v_away,v_oa,v_da from public.vteams where sport='basketball' and id <> all(v_busy) and id <> v_hid order by random() limit 1;
      if v_hid is null or v_aid is null then exit; end if;
      v_lh := BASE*v_oh*v_da*HOME_ADV;
      v_la := BASE*v_oa*v_dh;
      b := public._bb_game_odds(v_lh, v_la, 0, 0, 0);
      insert into public.matches
        (sport, home_team, away_team, home_team_id, away_team_id, starts_at, status,
         lambda_home, lambda_away, true_probabilities, display_odds, secret_outcome, duration_secs)
      values
        ('basketball', v_home, v_away, v_hid, v_aid, v_round, 'upcoming',
         v_lh, v_la,
         jsonb_build_object('home', 1.0/(b->>'ml_home')::double precision, 'away', 1.0/(b->>'ml_away')::double precision),
         jsonb_build_object('home', b->'ml_home', 'away', b->'ml_away'),
         public._bb_make_outcome(v_lh, v_la), 480)
      returning id into v_id;
      perform public._bb_ensure_markets(v_id);
      v_total := v_total + 1;
    end loop;
  end loop;
  return v_total;
end; $$;