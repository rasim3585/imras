-- 0127: Gates of Goal motor v2 — Gates of Olympus paritesi.
-- ÖLÇÜM (500K spin simülasyonu): eski motor RTP %95.6 ama hit %56 ve
-- kazançların %35'i bahsin ALTINDA (toz) + tavan 368x → "sürekli kazanıyorsun
-- ama para eriyor" hissi. Yeni motor: RTP %95.4, hit %25.5, toz %10.9,
-- max 4753x (cap 5000x), FS 1/344 ort. 78x, buy 80x (RTP %96.6).
--
-- Değişiklikler:
--   * 9 ödeme sembolü (GoO 9): 9 = altın krampon. SCATTER artık 10 (eskiden 9).
--   * GoO-haritalı ödeme tablosu (tavan: kupa 12+ = 50x).
--   * Orb kuyruğu 500x'e kadar (nadir): taban oyunda da büyük vuruş mümkün.
--   * Ödeme tavanı 5000x (GoO paritesi).
--   * FS 12 → 15; ante scatter tam 2x (0.018 → 0.036); buy 60x → 80x.
--   * Eski 3-parametreli _slot_cell İKİLİĞİ silindi (tek temiz sürüm).

drop function if exists public._slot_cell(text, integer, numeric);

create or replace function public._slot_cell(
  p_seed text, p_ctr integer, p_mult_chance numeric, p_scatter_chance numeric,
  out cell integer, out nctr integer
) returns record language plpgsql immutable as $$
declare
  w   int[] := array[13,13,12,11,11,9,8,3,4]; wt int := 84;      -- 9 sembol; kupa(8) en nadir
  mv  int[] := array[2,3,4,5,6,8,10,12,15,20,25,50,100,250,500];
  mw  int[] := array[460,300,180,110,70,50,30,20,10,6,4,2,1,1,1]; mwt int := 1245;
  sthr int; mthr int; typ int; d int; acc int; s int;
begin
  sthr := round(p_scatter_chance * 10000)::int;
  mthr := round(p_mult_chance * 10000)::int;
  nctr := p_ctr + 1;
  typ := (public._slot_next(p_seed, nctr) % 10000)::int;
  if typ < sthr then
    cell := 10; return;                                           -- scatter (gol)
  elsif typ < sthr + mthr then
    nctr := nctr + 1;
    d := (public._slot_next(p_seed, nctr) % mwt)::int; acc := 0;
    for s in 1 .. array_length(mv,1) loop acc := acc + mw[s]; if d < acc then cell := - mv[s]; return; end if; end loop;
    cell := - mv[1];
  else
    nctr := nctr + 1;
    d := (public._slot_next(p_seed, nctr) % wt)::int; acc := 0;
    for s in 1 .. 9 loop acc := acc + w[s]; if d < acc then cell := s; return; end if; end loop;
    cell := 1;
  end if;
end;
$$;

create or replace function public._slot_play(
  p_bet integer, p_seed text, p_mult_chance numeric, p_scatter_chance numeric
) returns jsonb language plpgsql immutable as $$
declare
  -- GoO-haritalı ödemeler (bet x): 8-9 / 10-11 / 12+ kova
  p1 numeric[] := array[0.25,0.40,0.50,0.80,1.00,1.50,2.00,10.00,2.50];
  p2 numeric[] := array[0.75,0.90,1.00,1.20,1.50,2.00,5.00,25.00,10.00];
  p3 numeric[] := array[2.00,4.00,5.00,8.00,10.00,12.00,15.00,50.00,25.00];
  g int[]; i int; c int; r int; idx int; k int; s int;
  v_cell int; ctr int := 0;
  cnt int[]; bucket int; step_win int; base_win int := 0;
  win_cells int[]; tmp int[];
  steps jsonb := '[]'::jsonb;
  mult_sum int := 0; scatters int := 0; n_tumbles int := 0;
begin
  g := array_fill(0, array[30]);
  for i in 1 .. 30 loop
    select cell, nctr into v_cell, ctr from public._slot_cell(p_seed, ctr, p_mult_chance, p_scatter_chance);
    g[i] := v_cell;
  end loop;
  loop
    cnt := array_fill(0, array[9]);
    for i in 1 .. 30 loop
      if g[i] between 1 and 9 then cnt[g[i]] := cnt[g[i]] + 1; end if;
    end loop;
    step_win := 0; win_cells := array[]::int[];
    for s in 1 .. 9 loop
      if cnt[s] >= 8 then
        bucket := case when cnt[s] >= 12 then 3 when cnt[s] >= 10 then 2 else 1 end;
        step_win := step_win + round((case bucket when 1 then p1[s] when 2 then p2[s] else p3[s] end) * p_bet)::int;
        for i in 1 .. 30 loop if g[i] = s then win_cells := win_cells || i; end if; end loop;
      end if;
    end loop;
    steps := steps || jsonb_build_object('grid', to_jsonb(g), 'win', step_win,
      'cells', to_jsonb(coalesce((select array_agg(wc - 1 order by wc) from unnest(win_cells) wc), array[]::int[])));
    exit when step_win = 0;
    base_win := base_win + step_win; n_tumbles := n_tumbles + 1;
    foreach i in array win_cells loop g[i] := 0; end loop;
    for c in 1 .. 6 loop
      tmp := array[]::int[];
      for r in reverse 5 .. 1 loop
        idx := (r-1)*6 + c; if g[idx] <> 0 then tmp := tmp || g[idx]; end if;
      end loop;
      k := 0;
      for r in reverse 5 .. 1 loop
        idx := (r-1)*6 + c; k := k + 1;
        if k <= coalesce(array_length(tmp,1),0) then g[idx] := tmp[k];
        else select cell, nctr into v_cell, ctr from public._slot_cell(p_seed, ctr, p_mult_chance, p_scatter_chance); g[idx] := v_cell; end if;
      end loop;
    end loop;
    if n_tumbles > 40 then exit; end if;
  end loop;
  for i in 1 .. 30 loop
    if g[i] < 0 then mult_sum := mult_sum + (- g[i]); elsif g[i] = 10 then scatters := scatters + 1; end if;
  end loop;
  return jsonb_build_object('steps', steps, 'base_win', base_win, 'mult_sum', mult_sum,
                            'scatters', scatters, 'tumbles', n_tumbles);
end;
$$;

create or replace function public._slot_round(p_bet integer, p_seed text, p_ante boolean, p_buy boolean)
returns jsonb language plpgsql immutable as $$
declare
  v_cfg public.slot_config;
  sc numeric; base jsonb; base_payout int := 0; total_payout int := 0;
  bonus_spins jsonb := '[]'::jsonb; bonus_win int := 0;
  fs int; i int := 0; total_mult int := 0; spin jsonb; fs_win int; triggered boolean := false;
begin
  select * into v_cfg from public.slot_config where id = 1;
  sc := case when p_ante then v_cfg.ante_scatter else v_cfg.base_scatter end;

  if not p_buy then
    base := public._slot_play(p_bet, p_seed || ':b', v_cfg.mult_chance, sc);
    if (base->>'base_win')::int > 0 then
      base_payout := (base->>'base_win')::int * greatest((base->>'mult_sum')::int, 1);
    end if;
    total_payout := base_payout;
  else
    base := jsonb_build_object('steps','[]'::jsonb,'base_win',0,'mult_sum',0,'scatters',0,'tumbles',0);
  end if;

  if p_buy or (base->>'scatters')::int >= 4 then
    triggered := true;
    fs := v_cfg.free_spins;
    while i < fs loop
      i := i + 1;
      spin := public._slot_play(p_bet, p_seed || ':f' || i, v_cfg.mult_chance, sc);
      total_mult := total_mult + (spin->>'mult_sum')::int;
      fs_win := case when (spin->>'base_win')::int > 0 then (spin->>'base_win')::int * greatest(total_mult, 1) else 0 end;
      bonus_win := bonus_win + fs_win;
      if (spin->>'scatters')::int >= 3 then fs := fs + 5; end if;
      bonus_spins := bonus_spins || jsonb_build_object(
        'steps', spin->'steps', 'win', fs_win, 'total_mult', total_mult, 'scatters', (spin->>'scatters')::int);
    end loop;
    total_payout := total_payout + bonus_win;
  end if;

  -- GoO paritesi: tek turda ödeme tavanı 5000x bet
  total_payout := least(total_payout, p_bet * 5000);

  return jsonb_build_object(
    'base', jsonb_build_object('steps', base->'steps', 'base_win', (base->>'base_win')::int,
             'mult_sum', (base->>'mult_sum')::int, 'scatters', (base->>'scatters')::int, 'payout', base_payout),
    'bonus', jsonb_build_object('triggered', triggered, 'count',
             case when triggered then jsonb_array_length(bonus_spins) else 0 end,
             'spins', bonus_spins, 'win', bonus_win, 'total_mult', total_mult),
    'payout', total_payout);
end;
$$;

update public.slot_config
   set mult_chance = 0.0125, base_scatter = 0.018, ante_scatter = 0.036,
       free_spins = 15, buy_cost = 80
 where id = 1;
