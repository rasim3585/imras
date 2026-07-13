-- DAVRANIŞ AYNASI — Faz 1b: Decision Replay tohumu. Kullanıcının en "ele veren"
-- anını somut göster: soyut yüzde değil, TEK gerçek tur → ayna içselleşir.
-- Yalnız OKUR (rounds public, caught turlar). Ayrı fonksiyon: ana mirror_aviator
-- dokunulmadan yüklenir.
--
-- Tell tanımı önemli: instacrash (crash≈1.0) açgözlülük DEĞİL şanstır. Gerçek
-- tell = uçak ÇEKİLEBİLECEK kadar yükseldi (crash>=1.5) ama yine de kaybedildi.
-- Kaçırılan kazanca göre sırala: stake*(crash-1) = "çıkabilseydin ne kazanırdın".
create or replace function public.mirror_aviator_moment()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
stable
as $function$
declare
  v_uid uuid := auth.uid();
  m record;
begin
  if v_uid is null then return jsonb_build_object('kind', 'none'); end if;

  select b.stake, b.auto_cashout_at, b.was_auto, r.crash_point, b.placed_at,
         round(b.stake * (r.crash_point - 1), 0) as missed_gain
    into m
  from public.aviator_bets b
  join public.aviator_rounds r on r.id = b.round_id
  where b.user_id = v_uid and b.caught_by_crash and b.stake > 0
    and r.crash_point >= 1.5                              -- çekilebilecek yükseklik
  order by b.stake * (r.crash_point - 1) desc             -- en büyük kaçırılan kazanç
  limit 1;

  if not found then return jsonb_build_object('kind', 'none'); end if;

  return jsonb_build_object(
    'kind', 'greed_loss',
    'stake', m.stake,
    'crash_point', m.crash_point,
    'missed_gain', m.missed_gain,
    'had_auto', (m.auto_cashout_at is not null),
    'auto_target', m.auto_cashout_at,
    'when', m.placed_at
  );
end;
$function$;

revoke all on function public.mirror_aviator_moment() from public;
revoke execute on function public.mirror_aviator_moment() from anon;
grant execute on function public.mirror_aviator_moment() to authenticated;
