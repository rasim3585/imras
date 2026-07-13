# CLAUDE.md — PickPlay Kalıcı Bağlam

*Bu dosya repo kökünde durur ve her Claude Code oturumunda otomatik okunur.
Amaç: her yeni oturumun projeyi sıfırdan değil, tam bağlamla başlaması.
Türkçe konuş.*

---

## 0. ÇALIŞMA KURALLARI (altın kurallar — ihlal etme)

- **Kullanıcı: Rasim.** Türkçe konuş. Katar'da. Bilgisayar mühendisliği + mobil
  oyun geçmişi → güçlü ürün sezgisi. Teknik detaya boğma; önce "neden bunu
  yapıyoruz" (büyük resim) netleşsin.
- **SQL'i Rasim kendisi çalıştırır** (Supabase SQL Editor). Sen sorguyu
  yazarsın, o çalıştırıp çıktıyı yapıştırır. **SQL Editor çoklu sorgu
  çalıştırmıyor → sorguları TEK TEK gönder.**
- **Tek adım talimat.** "1 bunu yap, bitince 2 bunu yap" şeklinde net sırala.
- **Ölçmeden migration yazma.** Kök nedeni KANITLA, sonra tek doğru düzeltmeyi
  yap. Tahminle migration üstüne migration yazıp savrulma yasak (bu daha önce
  oldu — Aviator senkronu 0074-0078).
- **Görmediğin/eksik gördüğün fonksiyona dokunma.** Uzun fonksiyon gövdesini
  base64 ile al:
  `select encode(convert_to(pg_get_functiondef(oid),'UTF8'),'base64') from pg_proc where proname='...';`
- **Permanent çözüm, workaround değil.** Yarım bırakılmış ikilik (ör. aynı
  isimli iki fonksiyon sürümü) temizlenir.
- **Seçenek sunma — kanıtla, karar ver.** "A mı B mi" diye Rasim'e atma;
  ölç, doğrusunu göster.
- **Rasim net semptom verir** (ör. "eğri 8, crash 6"). Sen KENDİN kök nedeni
  hesapla/bul. Onun gözlemi yeter, işi sen çöz — konsol açtırıp durma (ama
  gerçekten ölçüm gerekiyorsa tek net sorgu/log ver, o yapıştırsın).
- **Belge yapıştırınca bazen boş görünebiliyor.** O zaman "düz metin olarak
  yapıştırır mısın" de.
- **Eğer bu bir SOHBET oturumuysa (Claude Code değil):** kod tabanına, canlı
  veritabanına ve dosyalara ERİŞİMİN YOK. Sadece bu dosyada ve kullanıcının
  yapıştırdığında yazan bilgiyi bilirsin. Bir fonksiyonun/dosyanın/şemanın
  içini görmen gerekiyorsa körlemesine iş yapma — kullanıcıdan ilgili dosyayı
  ya da tek bir SQL sorgu çıktısını (base64 ile) iste, sonra ilerle. Tıkır
  tıkır mühendislik işi (migration, kod düzeltme) Claude Code'da yapılmalı;
  sohbette strateji/büyük resim/karar konuşulur.

---

## 1. ÜRÜNÜN ASIL AMACI (en kritik bölüm)

PickPlay bir bahis sitesi DEĞİL — **davranış aynası + koç.**

Piyasa boşluğu: Bahis siteleri kullanıcının zaafını görür ama saklar (zaaf =
sitenin kârı). AI analiz siteleri maçı analiz eder ama kullanıcı davranışını
göremez. **Kimse ikisini birleştirip kullanıcı LEHİNE kullanmıyor.** PickPlay
bunu yapar:

> "Bu oyunun analizi şu — AMA senin geçmiş oynayışından görüyorum ki kayıp
> kovalıyorsun, açgözlü davranıyorsun, sık kazanma yanılsamasına kapılıyorsun.
> İşte deseninin aynası."

Para dönmüyor (sembolik altın, PARA YOK) → kullanıcı zarar görmeden davranışını
görür. **Asıl değer = DAVRANIŞ ANALİZİ.** Oyunlar sadece veri toplama aracı +
retention. Ayna henüz KURULMADI (en büyük iş bu, senkron bitince başlanacak).

---

## 2. ÜÇ-KOLLU MİMARİ (danışman + Rasim konsensüsü)

```
GERÇEK FUTBOL   → sadece MAÇ ÖNCESİ bahis (canlı yok)   ─┐
SANAL FUTBOL    → sadece CANLI bahis (kurgusal maçlar)  ─┼→ DAVRANIŞ MOTORU → Ayna
AVIATOR (crash) → "ne zaman çekerim" oyunu              ─┘
```

- **Gerçek futbol maç öncesi:** Canlı gerçek maçta motor absürt oran veriyor
  (girdisi fakir: takım gücü/form yok). Absürtlük SADECE canlıda. Karar: gerçek
  maçta canlı bahsi kaldır. NOT: karar verildi, HENÜZ UYGULANMADI.
- **Sanal futbol canlı:** Kurgusal ("Real Madrid (Alexander)"), inandırıcılık
  sorunu yok, canlı heyecanı güvenle verir. Takım isim kuralı: gerçek takım +
  parantez içi sanal oyuncu adı → "sanal maç" sinyali.
- **Aviator:** En basit motor + en zengin/temiz davranış sinyali ("ne zaman
  çekerim" = risk psikolojisi). İlk kol olarak seçildi.

**Danışman konsensüsü:** Önce TEK kol (Aviator) ile aynayı KANITLA, sonra
genişle. Oyun retention'ı sağlar, ANALİZ farklılaştırır.

**İnandırıcılık ≠ Hassasiyet (kritik ayrım):** Oran %3 mü %6 mı marj = önemsiz
(dondurulabilir). Ama motorun İNANDIRICILIĞI (tanıdık maçta absürt oran
vermemesi, ödemelerin çalışması) = otantik davranış verisinin ÖNKOŞULU. Bozuk
motor = kirli laboratuvar = çöp veri.

---

## 3. TEKNİK ORTAM

- **Proje:** pickplay.ai
- **Supabase proje ref:** `owhvdjmxdtdaifpzttav` (hesap: kurumrasim@gmail.com)
- **Backend:** TAMAMEN Postgres (pg_cron + pg_net). Node/Railway worker YOK —
  bilinçli olarak dış bağımlılıktan kurtulduk (eski worker sessizce ölüp
  ödemeleri bozuyordu). Bu ilkeyi koru.
- **Migration'lar:** numaralı SQL dosyaları. **Aviator 0068-0078**, futbol
  0053-0067. Yeni migration **0079'dan** devam.
- **Frontend:** Vite + React + TS (`localhost:5173`). Realtime: Supabase
  broadcast + postgres_changes. Aviator dosyası: `src/aviator/useAviator.ts`.

**RLS dersi:** RLS açık + policy yok = tablo o role KAPALI. service_role
bypass eder → editör testi dolu, anon (frontend) boş olabilir.
`set local role anon; ... reset role;` ile test et.

---

## 4. DURUM ÖZETİ (nerede olduğumuz)

### Futbol motoru — STABİL, dokunma
Ödeme zinciri, Poisson oran motoru (10K kupon test, kasa marjı ~%3), lig
gruplama (bsd_leagues), 9 aktif cron. Kendi kendine dönüyor.

### Aviator — BİTTİ (görsel senkron dahil, 2026-07-12)
- **Motor (0068-0071):** provably fair crash (`crash_point` SHA-256'dan),
  `_aviator_current_multiplier = exp(0.35*t)`, k=0.35 kalibre.
- **Davranış yakalama (0072):** `aviator_bets`'te prev_result, prev_stake,
  was_auto, caught_by_crash → kayıp kovalama/greed/disiplin yakalanıyor.
- **Güvenlik (0073):** crash_point + server_seed AYRI `aviator_round_secrets`
  tablosunda (RLS, policy yok → anon tamamen kapalı). Aktif turda ana tabloda
  null, crash sonrası kopyalanıyor.
- **Cashout (0075 + temizlik):** `aviator_cashout(smallint, numeric)` —
  kullanıcının GÖRDÜĞÜ değeri esas alır, `gördüğü <= crash_point` ise o
  değerden öder, değilse "cashout_too_late". Anti-hile: `server_mult * 1.02`
  tavanı. **Eski 1-parametreli sürüm SİLİNDİ**, tek temiz sürüm kaldı.
- **Adalet mantığı deterministik:** crash zamanı = `flying_at + ln(cp)/0.35`.
  Para, tick gecikmesinden ve worker'dan bağımsız → saf Postgres.

### ✅ Görsel senkron — ÇÖZÜLDÜ (0079–0081 + edge function)
**Eski semptom:** eğri gerçek crash'i aşıyordu (crash 6 → eğri 8). **Kök neden:**
pg_cron 1sn tick jitter'ı crash'i ~0.8s geç tespit ediyordu (formül/backend
kusursuzdu). **Postgres-only fiziksel olarak imkansızdı** (pg_cron 1sn taban,
sub-second yok) → ephemeral Supabase Edge Function seçildi.

**Uygulanan mimari (hepsi canlıda, ölçümle doğrulandı):**
- **0079** `aviator_fire_crash(round_id)`: crash'in TEK idempotent kaynağı
  (`for update` kilit, `status<>'flying'` ise no-op).
- **Edge** `aviator-crash-timer` (`verify_jwt=false`): flying'de pg_net ile
  tetiklenir, `crash_at = flying_at + ln(cp)/0.35`'e kadar uyur, tam o an RPC'yi
  çağırır. **0080** tick'i bu RPC'ye delege etti + pg_net tetiğini ekledi.
- Sonuç: freeze gecikmesi **46–104ms** (eskiden 0–1000ms), `ratio≈1.00`. Edge
  her turda tick'i geçiyor; tick saf fallback (edge ölse para/history garantili).
- **0081** patlama sonrası 3sn "Auta gitti!" duraklaması (eski ölü kod düzeltmesi):
  tick artık en son turu alır, crashed ise `crashed_at + 3sn` bekler.

**Bilinen kabul edilen sınır:** cp≈1.0 instacrash'te uçuş 0.1–0.3s; edge
cold-start o kadar hızlı uyanamaz → o tur ~1sn tick fallback'e düşer (Rasim
"direkt patlıyor, sorun yok" onayladı). Detay: `DEVIR/2026-07-12_*`.

**Railway'e ASLA dönme.** Eski worker (runner.ts, Railway) kritik işi (para)
kırılgan-sürekli-ölen sürece bağladığı için gömüldü. Edge function o üç günahı
işlemiyor (ephemeral + kritik değil + Supabase içi). İlkenin ruhu: "kritik iş
kırılgana bağlanmasın", "hiç dış şey olmasın" değil.

### Aviator sonrası — ASIL İŞ (henüz başlanmadı)
Senkron bitince davranış analizi katmanı: `aviator_bets`'ten profil (kayıp
kovalama, açgözlülük, disiplin, **sık kazanma yanılsaması** — "hep 1.40x çek"
%70 kazanma ama net -%1.8). Oyun-bağımsız tasarla. Çapraz profil asıl güç:
"gerçek maçta temkinli ama Aviator'da açgözlüsün."

---

## 5. İŞ BÖLÜMÜ (Claude Code vs sohbet)

- **Claude Code (burası):** kod tabanının içi — frontend, build/test, SQL,
  migration, motor mantığı, ölçüm gereken her şey. Bağlam repo'da kalıcı.
- **Sohbet arayüzü:** strateji, büyük resim, danışman-tarzı düşünme.
- **Sınır:** aynı anda aynı dosyaya iki taraf dokunmasın.

---

## 6. DOSYA/MIGRATION NUMARALANDIRMA
Yeni migration'lar **0115'ten** devam, sıfır dolgulu 4 hane. (Aviator görsel
senkron 0079–0081; kalıcı sanal lig + settle 0082–0087; slot 0091; sanal
basketbol/tenis/voleybol 0092–0106; get_bulletin security-definer fix 0101;
davranış aynası Faz 0 yakalama 0107 + Faz 1a Aviator teşhis 0108 + Faz 1b trend
0109 + Decision Replay 0110; sahte veri seed 0111; kupon/slot/genel analitik 0112;
benchmark 0113; Player Card 0114.) Her önemli oturum sonunda `DEVIR/` klasörüne
kısa devir notu yaz.

**Davranış aynası (asıl ürün) — canlıda büyüyor:** Faz 0 (moat yakalama
`behavior_events`+`log_events`), Faz 1a-b (Aviator teşhis+trend+Decision Replay),
ve **Analiz merkezi "Aynam"** (`/analiz`, sol menü): alt sekmeler Genel/Maç
bahisleri/Aviator/Gates/Diğer. Backend: `mirror_aviator/coupon/slot/overview()`.
Çapraz içgörüler: risk yığılması, "en çok oynadığın=en çok kaybettiğin", gizli
kazanan. **Sahte veri (0111): 36 persona-kullanıcı** çapraz-ürün — benchmark +
çeşitlilik için. İlke: teşhis=hook, delta=ürün, sayılar deterministik, LLM sadece
"ses" (henüz yok). **Para yoluna analiz mutasyonu ASLA eklenmez** — ayna yalnız
OKUR. Sıra: benchmark ("vs diğer oyuncular"), Player Card kimliği, en son LLM ses.
