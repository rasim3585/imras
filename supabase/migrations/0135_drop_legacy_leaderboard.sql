-- 0135: eski 0-parametreli get_leaderboard() kaldirildi.
-- Frontend her zaman p_scope ile cagiriyor (supabaseMatchProvider.ts:197);
-- ayni isimli iki surum = yarim birakilmis ikilik, temizlendi (altin kural).
-- Dogrulama: pg_proc'ta proname='get_leaderboard' -> 1 satir.
drop function if exists public.get_leaderboard();
