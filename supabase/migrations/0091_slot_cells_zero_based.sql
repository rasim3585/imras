-- BUG: _slot_play, kazanan hücre indekslerini (cells) PL/pgSQL'in 1-tabanlı
-- diziliğiyle yayıyordu; ama JSON 'grid' (to_jsonb) ve frontend 0-tabanlı.
-- Sonuç: frontend grid[cell]'de KOMŞU hücreyi okuyup farklı sembolleri birlikte
-- grupluyordu (görsel bug; ödeme etkilenmiyor — step_win ve g[] dahili kullanım
-- 1-tabanlı ve doğru). Düzeltme: cells'i 0-tabanlı yay (grid ile tutarlı).
-- Dahili win_cells 1-tabanlı kalır (g[i] temizliği doğru); sadece JSON çıktısı -1.
-- Veriyle doğrulandı: düzeltme sonrası kazanan hücrelerin tamamı 1-8 arası gerçek
-- sembol; adım başına en fazla 3 farklı sembol (gerçek çoklu-grup), 9 değil.
create or replace function public._slot_play(p_bet integer, p_seed text, p_mult_chance numeric, p_scatter_chance numeric)
 returns jsonb
 language plpgsql
 immutable
as $function$
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
    if g[i] < 0 then mult_sum := mult_sum + (- g[i]); elsif g[i] = 9 then scatters := scatters + 1; end if;
  end loop;
  return jsonb_build_object('steps', steps, 'base_win', base_win, 'mult_sum', mult_sum,
                            'scatters', scatters, 'tumbles', n_tumbles);
end;
$function$;
