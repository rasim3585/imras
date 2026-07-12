# DEVIR — 2026-07-12 · Aviator görsel senkron BİTTİ

## Ne yapıldı

Aviator'ın tek açık sorunu (eğri gerçek crash'i aşıyordu) ve seans sırasında
çıkan bir yan sorun (patlama sonrası duraklama yok) **çözüldü ve ölçümle
doğrulandı.**

### 1. Görsel senkron — pg_cron 1sn tick jitter'ı → edge function (0079–0080)
- **0079** `aviator_fire_crash(round_id)`: crash'in TEK idempotent kaynağı.
  Turu `for update` kilitler, `status<>'flying'` ise no-op. Auto-cashout öder,
  turu crashed yazar (crashed_at = deterministik `flying_at + ln(cp)/0.35`),
  kalan bahisleri lost işaretler, crash broadcast atar.
- **Edge function** `aviator-crash-timer` (Supabase, `verify_jwt=false`, ACTIVE):
  betting→flying anında pg_net ile tetiklenir, `crash_at`'e kadar uyur, tam o an
  `aviator_fire_crash`'i çağırır. Kritik değil (para tick fallback'te garanti).
- **0080** tick refactor: eski satır-içi crash bloğu silindi → `aviator_fire_crash`'e
  delege. Betting→flying'de pg_net tetiği (EXCEPTION ile sarılı). Mid-flight
  auto-cashout tick'te aynen kaldı.
- **Ölçüm (geçici probe, sonra silindi):** freeze gecikmesi **46–104ms** (eskiden
  0–1000ms tick jitter). Crash'i HER turda edge ateşliyor, tick saf fallback.
  Frontend DEV logu doğruladı: normal turlar `ratio≈1.00`.

### 2. Patlama sonrası 3sn "Auta gitti!" duraklaması — ölü kod düzeltmesi (0081)
- **Kök neden (ölçümle):** tick en üstte `where status<>'crashed' ... if not found
  then yeni_tur` yapıyordu → tur crash olunca hemen (≈0–1s) yeni tur açıyordu;
  alttaki "crashed + 3sn" bloğuna asla ulaşılmıyordu (ÖLÜ KOD). Eskiden crash
  ~0.8s geç göründüğü için maskeliydi; 0080 ile crash anında olunca açığa çıktı.
- **Düzeltme:** tick artık en son turu (durumdan bağımsız) alır; crashed ise
  `crashed_at + 3sn` dolana kadar bekler ('crash_hold'), sonra açar. Ölü blok
  kaldırıldı.
- **Ölçüm:** crash→yeni betting boşluğu artık **3.0–3.9s** (eskiden ~0.1–0.9s).

### 3. Temizlik
- Geçici ölçüm probe'u (`_aviator_fire_probe` tablosu + fire_crash enstrümantasyonu)
  silindi; `aviator_fire_crash` 0079'un birebir temiz haline döndürüldü.
- Frontend DEV teşhis logları (`useAviator.ts`: +5s check, FREEZE, BROADCAST recv)
  ve sadece onlara hizmet eden `source` param + `lastAnchor` ref kaldırıldı.
  Typecheck temiz.

## Açık/İzlenecek konular (kritik değil)
- **Instacrash (cp≈1.0):** uçuş 0.1–0.3s; edge cold-start o kadar hızlı uyanamaz,
  o turu ~1sn tick fallback yakalar. Görsel: Rasim "direkt patlıyor, sorun yok"
  dedi. Fiziksel sınır, kabul edildi.
- **`place_bet` 400:** bahis penceresi tam kapanırken tıklama yarışı ("su an bahis
  penceresi kapali"). Frontend zaten hata gösteriyor. İstenirse: butonu pencere
  kapanmadan ~150ms önce kilitle (küçük polish).

## Sıradaki — ASIL İŞ
Aviator senkronu bittiğine göre artık **davranış analizi katmanı** (`aviator_bets`'ten
kayıp kovalama / açgözlülük / disiplin / sık-kazanma yanılsaması profili). Bkz.
CLAUDE.md §4 "Aviator sonrası".

## Dosyalar
- `supabase/migrations/0079_aviator_fire_crash.sql`
- `supabase/migrations/0080_aviator_tick_delegate_and_edge_trigger.sql`
- `supabase/migrations/0081_aviator_tick_fix_crash_hold.sql`
- `supabase/functions/aviator-crash-timer/index.ts`
- `src/aviator/useAviator.ts` (DEV log temizliği)
