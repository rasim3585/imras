-- 0088_slot_engine.sql
-- Gates of Goal — futbol temalı tumble/scatter-pays slot motoru (Faz 1).
-- Özgün tema/isim/ödeme tablosu; mekanik (tumble + "her yerde 8+" + çarpan)
-- jenerik. Provably-fair: seed'den deterministik PRNG. Saf Postgres (Aviator gibi).
--
-- Izgara 6 sütun × 5 satır (30 hücre, index 1..30; col=((i-1)%6)+1, row=((i-1)/6)+1,
-- row1 üst / row5 alt). Hücre: 1..8 normal sembol, negatif = çarpan küresi (-değer),
-- 0 = boş. Kazanç: bir semboldan 8+ adet ekranda → öder. Tumble: kazananlar patlar,
-- üsttekiler düşer, boşluk yeniden dolar; zincir biter. Çarpanlar zincir sonunda
-- toplanıp toplam kazanca uygulanır.

-- Config -----------------------------------------------------------------------
create table if not exists public.slot_config (
  id          smallint primary key default 1,
  min_bet     int not null default 10,
  max_bet     int not null default 1000,
  mult_chance numeric not null default 0.015,  -- yeni hücre başına çarpan küresi olasılığı (RTP ~%95 kalibre)
  constraint slot_config_one check (id = 1)
);
insert into public.slot_config (id) values (1) on conflict do nothing;

-- Spin kaydı (provably-fair seed + davranış alanları) --------------------------
create table if not exists public.slot_spins (
  id          bigserial primary key,
  user_id     uuid not null,
  bet         int not null,
  ante        boolean not null default false,
  stake       int not null,
  seed        text not null,
  base_win    int not null,
  mult_sum    int not null,
  payout      int not null,
  tumbles     int not null,
  prev_result text,
  prev_bet    int,
  created_at  timestamptz not null default now()
);
alter table public.slot_spins enable row level security;
drop policy if exists slot_spins_own on public.slot_spins;
create policy slot_spins_own on public.slot_spins for select using (user_id = auth.uid());

-- Deterministik PRNG: seed + index -> 0..2^31-1 -------------------------------
create or replace function public._slot_next(p_seed text, p_i int)
returns bigint language sql immutable as $function$
  select ('x' || substr(md5(p_seed || ':' || p_i), 1, 8))::bit(32)::bigint & 2147483647;
$function$;

-- Bir hücre çek: düşük olasılıkla çarpan küresi (negatif değer), yoksa ağırlıklı
-- sembol. nctr = ilerlemiş sayaç (rng determinizmi için).
create or replace function public._slot_cell(p_seed text, p_ctr int, p_mult_chance numeric,
  out cell int, out nctr int)
language plpgsql immutable as $function$
declare
  w   int[] := array[16,16,14,12,9,6,4,3];                                    -- sembol ağırlıkları (1..8); yüksek nadir
  wt  int := 80;
  mv  int[] := array[2,3,4,5,6,8,10,12,15,20,25,50,100,250,500];             -- çarpan değerleri
  mw  int[] := array[42,30,18,10,6,4,2,1,1,0,0,0,0,0,0];                      -- taban oyunda tavan ~15-20x
  mwt int := 114;
  d int; acc int; s int;
begin
  nctr := p_ctr + 1;
  if (public._slot_next(p_seed, nctr) % 10000) < round(p_mult_chance * 10000) then
    nctr := nctr + 1;
    d := (public._slot_next(p_seed, nctr) % mwt)::int; acc := 0;
    for s in 1 .. array_length(mv,1) loop
      acc := acc + mw[s];
      if d < acc then cell := - mv[s]; return; end if;
    end loop;
    cell := - mv[1];
  else
    nctr := nctr + 1;
    d := (public._slot_next(p_seed, nctr) % wt)::int; acc := 0;
    for s in 1 .. 8 loop
      acc := acc + w[s];
      if d < acc then cell := s; return; end if;
    end loop;
    cell := 1;
  end if;
end;
$function$;

-- Saf motor: bet + seed -> outcome (auth/bakiye/kayıt YOK). slot_spin ve RTP
-- simülasyonu ikisi de bunu çağırır.
create or replace function public._slot_play(p_bet int, p_seed text, p_mult_chance numeric)
returns jsonb language plpgsql immutable as $function$
declare
  p1 numeric[] := array[0.10,0.10,0.16,0.20,0.20,0.40,0.60, 1.00];   -- 8-9 adet (bahis katı)
  p2 numeric[] := array[0.30,0.30,0.36,0.40,0.48,0.80,1.60, 4.00];   -- 10-11
  p3 numeric[] := array[0.80,0.80,1.00,1.20,1.60,2.40,4.80,10.00];   -- 12+
  g int[]; i int; c int; r int; idx int; k int; s int;
  v_cell int; ctr int := 0;
  cnt int[]; bucket int; step_win int; base_win int := 0;
  win_cells int[]; tmp int[];
  steps jsonb := '[]'::jsonb;
  mult_sum int := 0; payout int; n_tumbles int := 0;
begin
  g := array_fill(0, array[30]);
  for i in 1 .. 30 loop
    select cell, nctr into v_cell, ctr from public._slot_cell(p_seed, ctr, p_mult_chance);
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

    base_win := base_win + step_win;
    n_tumbles := n_tumbles + 1;
    foreach i in array win_cells loop g[i] := 0; end loop;

    for c in 1 .. 6 loop
      tmp := array[]::int[];
      for r in reverse 5 .. 1 loop
        idx := (r-1)*6 + c;
        if g[idx] <> 0 then tmp := tmp || g[idx]; end if;
      end loop;
      k := 0;
      for r in reverse 5 .. 1 loop
        idx := (r-1)*6 + c; k := k + 1;
        if k <= coalesce(array_length(tmp,1),0) then
          g[idx] := tmp[k];
        else
          select cell, nctr into v_cell, ctr from public._slot_cell(p_seed, ctr, p_mult_chance);
          g[idx] := v_cell;
        end if;
      end loop;
    end loop;

    if n_tumbles > 40 then exit; end if;
  end loop;

  for i in 1 .. 30 loop if g[i] < 0 then mult_sum := mult_sum + (- g[i]); end if; end loop;
  if base_win > 0 and mult_sum > 0 then payout := base_win * mult_sum; else payout := base_win; end if;

  return jsonb_build_object('steps', steps, 'base_win', base_win, 'mult_sum', mult_sum,
                            'payout', payout, 'tumbles', n_tumbles);
end;
$function$;

-- Oynanabilir RPC: auth + bakiye + kayıt + animasyon dizisi --------------------
create or replace function public.slot_spin(p_bet int, p_ante boolean default false)
returns jsonb language plpgsql security definer
set search_path to 'public', 'pg_temp', 'extensions' as $function$
declare
  v_uid uuid := auth.uid();
  v_cfg public.slot_config;
  v_bal int; v_stake int; seed text;
  v_out jsonb; v_payout int;
  v_prev public.slot_spins; v_prev_res text := 'none'; v_spin_id bigint;
begin
  if v_uid is null then raise exception 'giris gerekli'; end if;
  select * into v_cfg from public.slot_config where id = 1;
  if p_bet < v_cfg.min_bet or p_bet > v_cfg.max_bet then
    raise exception 'bet % ile % arasinda olmali', v_cfg.min_bet, v_cfg.max_bet;
  end if;
  v_stake := case when p_ante then round(p_bet * 1.25)::int else p_bet end;

  select gold_balance into v_bal from public.profiles where id = v_uid;
  if v_bal < v_stake then raise exception 'yetersiz bakiye'; end if;

  select * into v_prev from public.slot_spins where user_id = v_uid order by id desc limit 1;
  if found then
    v_prev_res := case when v_prev.payout > v_prev.stake then 'won'
                       when v_prev.payout > 0 then 'partial' else 'lost' end;
  end if;

  update public.profiles set gold_balance = gold_balance - v_stake where id = v_uid;

  seed := encode(extensions.gen_random_bytes(16), 'hex');
  v_out := public._slot_play(p_bet, seed, v_cfg.mult_chance);
  v_payout := (v_out ->> 'payout')::int;

  if v_payout > 0 then
    update public.profiles set gold_balance = gold_balance + v_payout where id = v_uid;
  end if;

  insert into public.slot_spins (user_id, bet, ante, stake, seed, base_win, mult_sum, payout, tumbles, prev_result, prev_bet)
  values (v_uid, p_bet, p_ante, v_stake, seed,
          (v_out->>'base_win')::int, (v_out->>'mult_sum')::int, v_payout, (v_out->>'tumbles')::int,
          v_prev_res, v_prev.bet)
  returning id into v_spin_id;

  select gold_balance into v_bal from public.profiles where id = v_uid;

  return v_out || jsonb_build_object('spin_id', v_spin_id, 'bet', p_bet, 'ante', p_ante,
                                     'stake', v_stake, 'balance', v_bal);
end;
$function$;

grant execute on function public.slot_spin(int, boolean) to authenticated;
