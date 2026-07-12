-- 0089_slot_freespins.sql
-- Gates of Goal — Faz 2: scatter + free spins (biriken çarpan) + ante + buy.
-- Mekanik jenerik; tema/isim/görsel bize ait. Round mantığı saf _slot_round'a
-- alındı (slot_spin ve RTP simülasyonu ikisi de çağırır).
--
-- Scatter = sembol 9 (ödemez, tumble'da patlamaz, yerinde kalır). Bir spinde 4+
-- scatter → free spins. Free spins boyunca çarpan küreleri BİRİKEN total_mult'a
-- eklenir ve o turun kazancına uygulanır; 3+ scatter retrigger (+5). Ante scatter
-- şansını artırır (+%25 stake). Buy bonus: buy_cost×bet ile direkt free spins.

-- Eski 2-argümanlı sürümü kaldır (yeni 3-arg ile ambiguity olmasın).
drop function if exists public.slot_spin(integer, boolean);

alter table public.slot_config
  add column if not exists base_scatter numeric not null default 0.013,   -- normal scatter olasılığı/hücre (RTP ~%95)
  add column if not exists ante_scatter numeric not null default 0.018,   -- ante ile (kalibre: ante RTP ~%90, güvenli <100)
  add column if not exists free_spins   int     not null default 12,       -- başlangıç ücretsiz tur
  add column if not exists buy_cost     int     not null default 60;       -- bonus satın al = buy_cost × bet (buy RTP ~%94)

alter table public.slot_spins
  add column if not exists buy         boolean not null default false,
  add column if not exists bonus       boolean not null default false,
  add column if not exists free_spins  int     not null default 0;

-- Hücre çek: tek random ile tip (scatter / çarpan / normal) --------------------
create or replace function public._slot_cell(p_seed text, p_ctr int, p_mult_chance numeric, p_scatter_chance numeric,
  out cell int, out nctr int)
language plpgsql immutable as $function$
declare
  w   int[] := array[16,16,14,12,9,6,4,3]; wt int := 80;
  mv  int[] := array[2,3,4,5,6,8,10,12,15,20,25,50,100,250,500];
  mw  int[] := array[42,30,18,10,6,4,2,1,1,0,0,0,0,0,0]; mwt int := 114;
  sthr int; mthr int; typ int; d int; acc int; s int;
begin
  sthr := round(p_scatter_chance * 10000)::int;
  mthr := round(p_mult_chance * 10000)::int;
  nctr := p_ctr + 1;
  typ := (public._slot_next(p_seed, nctr) % 10000)::int;
  if typ < sthr then
    cell := 9; return;                                   -- scatter
  elsif typ < sthr + mthr then
    nctr := nctr + 1;
    d := (public._slot_next(p_seed, nctr) % mwt)::int; acc := 0;
    for s in 1 .. array_length(mv,1) loop acc := acc + mw[s]; if d < acc then cell := - mv[s]; return; end if; end loop;
    cell := - mv[1];
  else
    nctr := nctr + 1;
    d := (public._slot_next(p_seed, nctr) % wt)::int; acc := 0;
    for s in 1 .. 8 loop acc := acc + w[s]; if d < acc then cell := s; return; end if; end loop;
    cell := 1;
  end if;
end;
$function$;

-- Bir spin: 6x5 tumble + çarpan toplamı + scatter sayısı (ödeme/birikim çağırana ait)
create or replace function public._slot_play(p_bet int, p_seed text, p_mult_chance numeric, p_scatter_chance numeric)
returns jsonb language plpgsql immutable as $function$
declare
  p1 numeric[] := array[0.10,0.10,0.16,0.20,0.20,0.40,0.60, 1.00];
  p2 numeric[] := array[0.30,0.30,0.36,0.40,0.48,0.80,1.60, 4.00];
  p3 numeric[] := array[0.80,0.80,1.00,1.20,1.60,2.40,4.80,10.00];
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
    cnt := array_fill(0, array[8]);
    for i in 1 .. 30 loop
      if g[i] between 1 and 8 then cnt[g[i]] := cnt[g[i]] + 1; end if;
    end loop;
    step_win := 0; win_cells := array[]::int[];
    for s in 1 .. 8 loop
      if cnt[s] >= 8 then
        bucket := case when cnt[s] >= 12 then 3 when cnt[s] >= 10 then 2 else 1 end;
        step_win := step_win + round((case bucket when 1 then p1[s] when 2 then p2[s] else p3[s] end) * p_bet)::int;
        for i in 1 .. 30 loop if g[i] = s then win_cells := win_cells || i; end if; end loop;
      end if;
    end loop;
    steps := steps || jsonb_build_object('grid', to_jsonb(g), 'win', step_win, 'cells', to_jsonb(win_cells));
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
    if g[i] < 0 then mult_sum := mult_sum + (- g[i]); elsif g[i] = 9 then scatters := scatters + 1; end if;
  end loop;
  return jsonb_build_object('steps', steps, 'base_win', base_win, 'mult_sum', mult_sum,
                            'scatters', scatters, 'tumbles', n_tumbles);
end;
$function$;

-- Tam round: base spin + (4+ scatter veya buy) free spins. Saf (auth yok).
create or replace function public._slot_round(p_bet int, p_seed text, p_ante boolean, p_buy boolean)
returns jsonb language plpgsql immutable as $function$
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

  return jsonb_build_object(
    'base', jsonb_build_object('steps', base->'steps', 'base_win', (base->>'base_win')::int,
             'mult_sum', (base->>'mult_sum')::int, 'scatters', (base->>'scatters')::int, 'payout', base_payout),
    'bonus', jsonb_build_object('triggered', triggered, 'count',
             case when triggered then jsonb_array_length(bonus_spins) else 0 end,
             'spins', bonus_spins, 'win', bonus_win, 'total_mult', total_mult),
    'payout', total_payout);
end;
$function$;

-- Oynanabilir RPC ------------------------------------------------------------
create or replace function public.slot_spin(p_bet int, p_ante boolean default false, p_buy boolean default false)
returns jsonb language plpgsql security definer
set search_path to 'public', 'pg_temp', 'extensions' as $function$
declare
  v_uid uuid := auth.uid();
  v_cfg public.slot_config;
  v_bal int; v_stake int; seed text;
  v_round jsonb; v_payout int;
  v_prev public.slot_spins; v_prev_res text := 'none'; v_spin_id bigint;
begin
  if v_uid is null then raise exception 'giris gerekli'; end if;
  select * into v_cfg from public.slot_config where id = 1;
  if p_bet < v_cfg.min_bet or p_bet > v_cfg.max_bet then
    raise exception 'bet % ile % arasinda olmali', v_cfg.min_bet, v_cfg.max_bet;
  end if;
  v_stake := case when p_buy then p_bet * v_cfg.buy_cost
                  when p_ante then round(p_bet * 1.25)::int else p_bet end;

  select gold_balance into v_bal from public.profiles where id = v_uid;
  if v_bal < v_stake then raise exception 'yetersiz bakiye'; end if;

  select * into v_prev from public.slot_spins where user_id = v_uid order by id desc limit 1;
  if found then
    v_prev_res := case when v_prev.payout > v_prev.stake then 'won' when v_prev.payout > 0 then 'partial' else 'lost' end;
  end if;

  update public.profiles set gold_balance = gold_balance - v_stake where id = v_uid;

  seed := encode(extensions.gen_random_bytes(16), 'hex');
  v_round := public._slot_round(p_bet, seed, p_ante, p_buy);
  v_payout := (v_round ->> 'payout')::int;

  if v_payout > 0 then
    update public.profiles set gold_balance = gold_balance + v_payout where id = v_uid;
  end if;

  insert into public.slot_spins (user_id, bet, ante, buy, stake, seed, base_win, mult_sum, payout, tumbles,
                                 bonus, free_spins, prev_result, prev_bet)
  values (v_uid, p_bet, p_ante, p_buy, v_stake, seed,
          (v_round#>>'{base,base_win}')::int, (v_round#>>'{base,mult_sum}')::int, v_payout, 0,
          (v_round#>>'{bonus,triggered}')::boolean, (v_round#>>'{bonus,count}')::int, v_prev_res, v_prev.bet)
  returning id into v_spin_id;

  select gold_balance into v_bal from public.profiles where id = v_uid;

  return v_round || jsonb_build_object('spin_id', v_spin_id, 'bet', p_bet, 'ante', p_ante, 'buy', p_buy,
                                       'stake', v_stake, 'balance', v_bal);
end;
$function$;

grant execute on function public.slot_spin(int, boolean, boolean) to authenticated;
