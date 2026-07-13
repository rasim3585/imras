-- TENİS: gerçek sitelerdeki iki standart marketi ekle — Toplam Set (2.5: 3 set=Üst)
-- ve Oyun Handikabı (games handicap). Deterministik çizgiler (settle ile tutarlı).
-- _tn_odds'a ts2_* + gh_* keyleri; ensure_markets 6 markete çıktı; settle grading.
create or replace function public._tn_gh_line(p_sa double precision, p_sb double precision)
returns numeric language sql immutable as $$
  select floor((2*(power(p_sa,4)/(power(p_sa,4)+power(p_sb,4))) - 1) * 7.0)::numeric + 0.5;
$$;

create or replace function public._tn_odds(p_sa double precision, p_sb double precision, p_sh int, p_sa_sets int, p_t double precision)
returns jsonb language plpgsql immutable security definer set search_path to 'public' as $$
declare
  pset double precision := power(p_sa,4) / (power(p_sa,4) + power(p_sb,4));
  pcond double precision; live boolean := (p_t > 0 or p_sh > 0 or p_sa_sets > 0);
  exp_sets double precision; tmean double precision; tline numeric; pov double precision;
  pts2 double precision; gh_mean double precision; gh_line numeric; p_gh double precision;
  ml numeric[]; st numeric[]; fs numeric[]; tt numeric[]; ts2 numeric[]; gh numeric[];
begin
  if p_sh >= 2 then pcond := 1; elsif p_sa_sets >= 2 then pcond := 0;
  elsif p_sh = 1 and p_sa_sets = 0 then pcond := pset*(2-pset);
  elsif p_sh = 0 and p_sa_sets = 1 then pcond := pset*pset;
  elsif p_sh = 1 and p_sa_sets = 1 then pcond := pset;
  else pcond := pset*pset*(3-2*pset); end if;
  ml := public._odds_line(array[pcond, 1-pcond], 0.05);
  if live then
    return jsonb_build_object('ml_home', ml[1], 'ml_away', ml[2],
      'set_20',null,'set_21',null,'set_12',null,'set_02',null,'fs_home',null,'fs_away',null,
      'tot_over',null,'tot_under',null,'tot_line',null,
      'ts2_over',null,'ts2_under',null,'gh_home',null,'gh_away',null,'gh_line',null);
  end if;
  st := public._odds_line(array[pset*pset, 2*pset*pset*(1-pset), 2*(1-pset)*(1-pset)*pset, (1-pset)*(1-pset)], 0.08);
  fs := public._odds_line(array[pset, 1-pset], 0.05);
  exp_sets := 2*(pset*pset + (1-pset)*(1-pset)) + 3*(2*pset*pset*(1-pset) + 2*(1-pset)*(1-pset)*pset);
  tmean := exp_sets * 9.6; tline := floor(tmean)::numeric + 0.5;
  pov := public._norm_cdf((tmean - tline::double precision) / 3.6);
  tt := public._odds_line(array[pov, 1-pov], 0.04);
  pts2 := 2*pset*(1-pset);
  ts2 := public._odds_line(array[pts2, 1-pts2], 0.05);
  gh_mean := (2*pset - 1) * 7.0; gh_line := floor(gh_mean)::numeric + 0.5;
  p_gh := public._norm_cdf((gh_mean - gh_line::double precision) / 4.2);
  gh := public._odds_line(array[p_gh, 1-p_gh], 0.05);
  return jsonb_build_object('ml_home', ml[1], 'ml_away', ml[2],
    'set_20', st[1], 'set_21', st[2], 'set_12', st[3], 'set_02', st[4],
    'fs_home', fs[1], 'fs_away', fs[2], 'tot_over', tt[1], 'tot_under', tt[2], 'tot_line', tline,
    'ts2_over', ts2[1], 'ts2_under', ts2[2], 'gh_home', gh[1], 'gh_away', gh[2], 'gh_line', gh_line);
end; $$;

create or replace function public._tn_ensure_markets(p_match uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare sa double precision; sb double precision; b jsonb; ghl numeric;
begin
  select lambda_home, lambda_away into sa, sb from public.matches where id = p_match;
  if sa is null then return; end if;
  b := public._tn_odds(sa, sb, 0, 0, 0); ghl := (b->>'gh_line')::numeric;
  perform public._tn_add_market(p_match, 'tn_moneyline', 'Maç Sonucu', 0, jsonb_build_array(
    jsonb_build_object('key','ml_home','label','1','odds', b->'ml_home'),
    jsonb_build_object('key','ml_away','label','2','odds', b->'ml_away')));
  perform public._tn_add_market(p_match, 'tn_setbet', 'Set Bahsi', 1, jsonb_build_array(
    jsonb_build_object('key','set_20','label','2-0','odds', b->'set_20'),
    jsonb_build_object('key','set_21','label','2-1','odds', b->'set_21'),
    jsonb_build_object('key','set_12','label','1-2','odds', b->'set_12'),
    jsonb_build_object('key','set_02','label','0-2','odds', b->'set_02')));
  perform public._tn_add_market(p_match, 'tn_totalsets', 'Toplam Set 2.5', 2, jsonb_build_array(
    jsonb_build_object('key','ts2_over','label','Üst','odds', b->'ts2_over'),
    jsonb_build_object('key','ts2_under','label','Alt','odds', b->'ts2_under')));
  perform public._tn_add_market(p_match, 'tn_gameshcap', 'Oyun Handikabı', 3, jsonb_build_array(
    jsonb_build_object('key','gh_home','label','1 ('|| public._bb_sgn(-ghl) ||')','odds', b->'gh_home'),
    jsonb_build_object('key','gh_away','label','2 ('|| public._bb_sgn(ghl)  ||')','odds', b->'gh_away')));
  perform public._tn_add_market(p_match, 'tn_firstset', 'İlk Set', 4, jsonb_build_array(
    jsonb_build_object('key','fs_home','label','1','odds', b->'fs_home'),
    jsonb_build_object('key','fs_away','label','2','odds', b->'fs_away')));
  perform public._tn_add_market(p_match, 'tn_total', 'Toplam Oyun ' || (b->>'tot_line'), 5, jsonb_build_array(
    jsonb_build_object('key','tot_over','label','Üst','odds', b->'tot_over'),
    jsonb_build_object('key','tot_under','label','Alt','odds', b->'tot_under')));
end; $$;

create or replace function public._tn_settle_markets(p_match uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare sh int; sa int; sets jsonb; sa_str double precision; sb_str double precision;
  tgames int := 0; gh_margin int := 0; i int; tline numeric; ghl numeric; nsets int; win text[]; fs_home boolean;
begin
  select (secret_outcome->>'sets_h')::int, (secret_outcome->>'sets_a')::int, secret_outcome->'sets', lambda_home, lambda_away
    into sh, sa, sets, sa_str, sb_str from public.matches where id = p_match;
  if sh is null then return; end if;
  nsets := jsonb_array_length(sets);
  for i in 0 .. nsets-1 loop
    tgames := tgames + (sets->i->>'h')::int + (sets->i->>'a')::int;
    gh_margin := gh_margin + (sets->i->>'h')::int - (sets->i->>'a')::int;
  end loop;
  tline := public._tn_tot_line(sa_str, sb_str); ghl := public._tn_gh_line(sa_str, sb_str);
  fs_home := (sets->0->>'h')::int > (sets->0->>'a')::int;
  win := array[
    case when sh > sa then 'ml_home' else 'ml_away' end,
    case when sh=2 and sa=0 then 'set_20' when sh=2 and sa=1 then 'set_21'
         when sh=1 and sa=2 then 'set_12' else 'set_02' end,
    case when nsets > 2 then 'ts2_over' else 'ts2_under' end,
    case when gh_margin > ghl then 'gh_home' else 'gh_away' end,
    case when fs_home then 'fs_home' else 'fs_away' end,
    case when tgames > tline then 'tot_over' else 'tot_under' end
  ];
  update public.market_options mo set is_winner = (mo.outcome_key = any(win))
  from public.markets mk where mk.id = mo.market_id and mk.match_id = p_match and mk.market_type like 'tn_%';
  update public.markets set status = 'settled' where match_id = p_match and market_type like 'tn_%';
end; $$;
