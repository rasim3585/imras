-- 0151: mines_active() — aktif Mines oyununu geri getir (para/guven yuzeyi).
-- Senaryo: bahis mines_start'ta dusmusken kullanici sayfayi yenilerse oyun
-- UI'dan kayboluyordu; mines_start ikinci oyunu zaten reddediyor ('aktif oyun
-- var' — govde dogrulandi), kurtarma RPC'si eksikti. FE canlida hazir:
-- MinesScreen mount'ta cagirir, yoksa/sessizce gecer; catch'lerde resync eder.
-- Donen sekil FE MinesActiveGame ile birebir: {game_id, bet, mines, mult, revealed[]}.
-- Aktif oyun yoksa NULL doner (sql fonksiyonu, satir yok = null).

create or replace function public.mines_active()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select jsonb_build_object(
    'game_id', id,
    'bet', bet,
    'mines', mines,
    'mult', coalesce(mult, 1.0),
    'revealed', coalesce(to_jsonb(revealed), '[]'::jsonb))
  from public.mines_games
  where user_id = auth.uid() and status = 'active'
  order by id desc
  limit 1;
$$;

-- PostgREST /rpc tum public fonksiyonlari acar (0140 dersi): anon'a kapat,
-- yalnizca girisli kullanici + service_role cagirabilsin.
revoke execute on function public.mines_active() from public, anon;

grant execute on function public.mines_active() to authenticated, service_role;
