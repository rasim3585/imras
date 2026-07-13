-- Faz 1'den kalan 3-argümanlı _slot_play artık çağrılmıyor (aktif motor 4-arg
-- sürümü; _slot_round ve slot_spin onu kullanıyor). İkiliği temizle.
drop function if exists public._slot_play(integer, text, numeric);
