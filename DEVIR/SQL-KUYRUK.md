# SQL KUYRUĞU — tek oturumluk yapıştırma paketi (2026-07-16)

Sıra önemli. Her blok TEK sorgu, SQL Editor'de tek tek. ▮ işaretli olanlar
çıktıyı Claude'a yapıştırmayı gerektirir (gövde alıp yama üreteceğim).

## A) PRO+SMALL SONRASI — cron'ları eski tempoya döndür
```sql
select cron.alter_job(jobid, schedule => '1 seconds') from cron.job where jobname = 'pickplay_live';
```
```sql
select cron.alter_job(jobid, schedule => '30 seconds') from cron.job where jobname = 'pickplay_tick';
```

## B) KUPON İSTATİSTİK BİRLİĞİ — "kazanan" tanımı tek kaynaktan
Sorun: Profil (status='won' sayımı) ile Kuponlarım (kârlı cashout'u da
"kazandı" sayan bucketOf) farklı sayı gösteriyor. Tek doğru: sunucu RPC.
```sql
create or replace function public.coupon_stats()
returns jsonb language sql stable security definer
set search_path to 'public','pg_temp'
as $$
  select jsonb_build_object(
    'played',  count(*),
    'settled', count(*) filter (where status in ('won','lost','cashed_out')),
    -- kazanan = status won VEYA kârlı cashout (Kuponlarım bucketOf ile AYNI tanım)
    'won',     count(*) filter (where status = 'won'
                  or (status = 'cashed_out' and coalesce(cashout_amount,0) >= stake)),
    'biggest', coalesce(max(potential_win) filter (where status = 'won'), 0))
  from public.coupons
  where user_id = auth.uid();
$$;
```
```sql
revoke execute on function public.coupon_stats() from public, anon;
```
(Uygulandıktan sonra Claude FE'yi bu RPC'ye geçirir — getCouponStats emekli.)

## B2) AUTH DENETİMİ — set_username "player_xxxxxxxx" tuzağı (0150, hazır dosya)
Repo'daki `supabase/migrations/0150_set_username_provisional_guard.sql` içeriğini
aynen yapıştır (tek sorgu). Ne yapar: kullanıcının kendine "player_deadbeef"
tarzı geçici-desenli ad seçip UsernameScreen'de sonsuz kilitlenmesini engeller.

## B3) MINES KURTARMA — mines_active() (FE HAZIR, RPC bekliyor)
FE canlıda şunu çağırıyor (yoksa sessizce es geçiyor): kullanıcının AKTİF Mines
oyunu varsa `{game_id, bet, mines, mult, revealed:[hücreler]}` döndürmeli.
Gövdeler canlıda olduğundan ÖNCE aşağıdaki C çekiminden mines fonksiyonları
gelsin, ben şemaya birebir `mines_active()` + "aktif oyun varken mines_start
reddi" migration'ını yazayım. (Neden kritik: bahis sunucuda düşmüşken sayfa
yenileyen kullanıcı oyununa dönemiyor — para/güven yüzeyi.)

## C) ▮ GÖVDE ÇEKİMİ — voleybol/tenis hayalet set + tempo alanı + GoO motor farkları + MINES
Aşağıdaki TEK sorgunun çıktısını Claude'a yapıştır; üç yamayı gövdelerden üretecek:
1. `_vb_state`: `revealed := least(round(t*total_pts)::int, total_pts-1)` —
   maç sonu 1-2sn'lik hayalet "Set 6 · 0-0" fix'i (+ `_tn_state`'te aynı kalıp varsa).
2. `_vb_state`/`_tn_state` dönüşüne `pace` alanı + get_live_state geçişi —
   FE sim temposunu iki yönde ölçekler (kısa maçta 60sn ölü top biter).
3. Gates motoru GoO birebirliği (Rasim kararı bekliyor — para motoru,
   simülasyonsuz DOKUNULMAZ): buy 80x→100x?, scatter ödemesi 4/5/6=3x/5x/100x?,
   FS retrigger 3+ = +5?, max-win 5000x'te turu anında kesme?, FS "yeni orb
   yoksa çarpan uygulanmaz" nüansı. Karar verilirse önce 500K spin simülasyonu.
```sql
select proname,
       encode(convert_to(pg_get_functiondef(oid),'UTF8'),'base64') as govde
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('_vb_state','_tn_state','get_live_state','_slot_play','_slot_round',
                  'mines_start','mines_reveal','mines_cashout');
```
(mines_* gövdeleri B3'teki mines_active() + start-reddi migration'ı için.)

## D) SONRAKİ SEANS (edge+SQL özellikleri — ayrı iş)
- match-preview'a GERÇEK maç dalı (ana bahis yüzeyi AI'sız kalmasın)
- mirror_luck RPC (Mines derinlik / Dice beyan-edilmiş risk / Plinko risk dağılımı)
- betting-ai cevabına `remaining` (günlük hak sayacı FE'de görünsün)
- mirror_coupon derinleştirme (oran-bandı histogramı, canlı/öncesi ayrımı, takım tuzakları aynaya)
