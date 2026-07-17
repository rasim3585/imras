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
GERÇEK FUTBOL   → maç öncesi + CANLI bahis (0147 önbellek) ─┐
SANAL FUTBOL    → sadece CANLI bahis (kurgusal maçlar)     ─┼→ DAVRANIŞ MOTORU → Ayna
AVIATOR (crash) → "ne zaman çekerim" oyunu                 ─┘
```

- **Gerçek futbol canlı bahis — KARAR REVİZE (2026-07-16):** Eski karar
  "canlıyı kaldır"dı (absürt oran nedeniyle). Motor 0130-0136'da Nesine'yle
  kalibre edilince Rasim kararı çevirdi: **canlı bahis KALIYOR.** Ölçek sorunu
  (istek başına Poisson hesabı; 3 USA maçı canlıya düşünce DB doygunluğu +
  bülten timeout — 2026-07-16 gecesi yaşandı, ölçümle kanıtlandı) 0147
  önbelleğiyle çözüldü: oranlar `real_fixtures.markets_cache`'te hazır durur,
  BEFORE trigger sync yazınca tazeler, get_bulletin SADECE okur (~600ms).
  Para yolu (place_coupon_v2, cashout) taze hesaba devam eder (~10-50ms/bacak).
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
Yeni migration'lar **0153'ten** devam, sıfır dolgulu 4 hane. (**0151-0152 SQL
SABAH OTURUMU (2026-07-16, hepsi canlıda doğrulandı)**: coupon_stats() RPC
(kazanan=won∨kârlı-cashout tek tanım; FE getCouponStats RPC'ye geçti),
0150 uygulandı, 0151 mines_active() (Mines kurtarma aktif; mines_start zaten
'aktif oyun var' ile ikinci oyunu reddediyormuş — gövdeden kanıtlandı),
0152 _vb_state/_tn_state hayalet "Set 6·0-0" fix (revealed son seti tam
tüketmez) + pace alanı (sn/birim; tenis 36.92, vb 3.31 ölçüldü) +
get_live_state passthrough; FE tennisSim setPace + bütçe pace-ölçeği
(480sn'de f=1 → sıfır regresyon). GoO motor farkları PARK kararı: yüzey
birebir, RTP ölçülü; değişiklik=para motoru=önce 500K sim — launch sonrası.
KALAN ZORUNLU: Pro+Small sonrası cron geri-alma (SQL-KUYRUK A).) (**0150 + KÖR NOKTA
DENETİMİ (2026-07-16, 4-ajanlık ordu: auth/RTL/şans/hata-dayanıklılık)**: İKİ
LAUNCH BLOKER kapatıldı — (1) şifre sıfırlama akışı HİÇ YOKTU: AuthScreen
'forgot' modu + resetPasswordForEmail + /reset rotası (ResetScreen, updateUser);
(2) ErrorBoundary/global yakalayıcı yoktu (tek render hatası = kalıcı beyaz
ekran): RootErrorBoundary (provider'ların DIŞINDA, kendi 8-dilli mini sözlüğü)
+ window error/unhandledrejection → logEvent('app','client_error') =
behavior_events bedava Sentry-lite (launch haftası `event_type='client_error'`
tara). SİSTEMİK: src/lib/errors.ts humanizeError/mapAuthError — ham PostgREST/
Supabase/ağ mesajı kullanıcıya ASLA basılmaz (offline/busy/funds/generic ×8 dil);
CouponPanel para yolu + Feed + auth + username + 3 şans oyunu buna geçti. AUTH:
signUp identities boş = 'zaten kayıtlı' (sahte doğrulama çıkmazı bitti),
emailRedirectTo, AuthContext onAuthStateChange'te await YOK (dokümante deadlock
— setTimeout ile ertele), loadProfile hatada profili EZMEZ + 2 retry,
getSession .finally, profileReady kapısı (girişte feed flaşı bitti), RequireAuth
from-state (deep-link login sonrası geri döner), UsernameScreen finally kilidi.
0150: set_username player_XXXXXXXX deseni reddi (sonsuz UsernameScreen tuzağı).
ŞANS: Mines mount'ta minesActive() resume + catch'te resync (RPC SQL-KUYRUK'ta,
FE toleranslı), tüm catch'lerde refreshProfile (bakiye chip yalanı bitti), Dice
uçuşta yön kilidi + bayat marker temizliği, MAX floor. RTL: index.html erken-dir
script'i (LTR flaşı yok — canlıda doğrulandı), durum şeritleri/hizalar logical
properties (border-inline-start vb., saha/kort geometrisi FİZİKSEL bırakıldı),
.tnum unicode-bidi isolate + ltr, av-fair-pop RTL kuralı, fmtNum(app-dili,
Arapçada Latin rakam politikası) — tr-TR hardcode'ları söküldü. i18n: 6 ikincil
dilde eksik 11 anahtar + landing.chip ar + SharedCouponScreen (viral kapı!)
KOMPLE + CouponBar/MatchCard/LeagueDetail/placeholder — 8 dil × 674 anahtar,
scripts/check-i18n.cjs build zincirinde (parite bozuksa build KIRILIR). Hata-vs-
boş ayrımı: SharedCoupon/Team/Standings 'error'+retry, Analiz useMirror failed+
retry (sonsuz 'Yükleniyor' bitti), Aviator ilk yükleme 5sn retry (sonsuz
Connecting bitti). BİLİNÇLİ EN: PitchTV/MiniWatch yayıncı jargonu (Shot/Corner/
Key attacks) uluslararası spor dili — ÇEVİRME, bug değil.) (**2026-07-16
GECE LAUNCH CİLASI (FE-only, 18 commit)**: 5-ajanlık keşif ordusu (raporlar
scratchpad/rapor-0..4.md) + uygulama. GATES: sembol seti v3 — 5 fasetli
mücevher + altın Kupa(50x)/Krampon(25x)/Eldiven(15x)/Düdük(12x) + Altın Top
scatter; web-doğrulamalı GoO spec'iyle ödeme tablosu BİREBİR çıktı; banner
25x/100x/250x/1000x; callout tutarları sunucu adım kazancına ölçekli; motor
farkları (Buy 80x↔100x, scatter ödemesi 4/5/6=3x/5x/100x, FS retrigger +5,
max-win kesme, FS orb nüansı) SQL turu bekliyor — DEVIR sabah kuyruğu. 2D:
22 oyuncu noktası (çapa+topa çekim+salınım, PitchTV rAF); winprob barı
görünmezdi (--av-mid yalnız Aviator kapsamındaydı — sayfa-dışı token KULLANMA
dersi); 0-0 satırlar boş bar. KUPON DÜRÜSTLÜĞÜ: pending kuponlar limit muaf
(200'ün gerisine düşen bekleyen kupon KAYBOLUYORDU); kazanç çipleri NET
(brüt +150 değil +50; Plinko 0.2x kovada '+20' yalanı '−80' oldu); /coupon =
CouponPanel kabuğu (kopya slip + kapalı-bacak körlüğü silindi); NavBar sepet
rozeti kalktı (yanlış vaat). ANALİZ: Diğer sekmesi gerçek (Mines/Dice/Plinko
kartları, OverviewProduct tipi genişledi); ParallelCard→Aviator sekmesi (veri
Aviator-only); karne boş-durum teaser'ı; AI sohbet sessionStorage; mirror
fetch 30sn memo (4 mükerrer RPC bitti). PRO: OG kartı (public/og-card.png)
+ og/twitter meta; rota başına document.title; anon 401 spam fix (FE advance()
kaldırıldı — dünya ilerletme yalnız cron); behaviorLog geri-kuyruk sigortası;
ölü src/providers/ silindi; lb.sub.day/pr.biggestwin etiketleri dürüst.
UYARI: gece bülten 83 fikstürle 3-8sn + aralıklı timeout görüldü — muhtemel
compute CPU-kredi tükenmesi; launch öncesi Dashboard>Reports>CPU kontrol +
gerekirse Small'a upgrade. Edge deploy'lar git'ten OTOMATİK DEĞİL — dashboard
elle ya da MCP; coupon-judge son sürümü 640 token + 'sen' hitabı.) (**0148-0149 AI
Kupon Hakemi v2 — ÜRÜNÜN KALBİ (Rasim tezi: maç analizi yapan çok, kullanıcının
KENDİ davranışını bilen yargıç yalnız bizde)**: coupon_review artık
_coupon_judge_extras ile zengin — per_leg takım geçmişi (bets/won/net; ölçüldü:
Marseille 1156/546/-6246), behavior_now (chase/loss_streak/kasa%/saatlik tempo),
loyalty_traps (≥5 bahis + negatif net), maturity (new<5/forming<20/ready),
judge_context (30 günde dinlenmeyen uyarılar + bedeli), cross_games (son 1 saat
Aviator+şans net'i = platform-genel tilt). judge_verdicts defteri +
log_judge_verdict (FE kararname sonrası) + judge_scorecard karnesi ("uyarılara
uysaydın +X" karşı-olgusal; _judge_scorecard(uid) test edilebilir iç fn) +
judge_confrontations (My Coupons settle çipi "Hakem %9 demişti"). Kupon-kararname
bağlama TAMAMEN okuma-tarafı lateral (15dk + ~aynı oran) — para yoluna sıfır
dokunuş. Edge coupon-judge: model Sonnet (claude-sonnet-5), bacak-başına yorum
zorunluluğu, kota 20/gün (judge_quota_take + ai_chat_usage.judge_msgs, yalnız
service_role). "Uyarıldı" tanımı deterministik: prob<%20 ∨ chase ∨ trap>0.
Model-tabanlı adil olasılık BİLİNÇLİ ertelendi → aylık Nesine kalibrasyon turu.
FE: deterministik inceleme otomatik (1.2sn debounce), olgunluk bandı, bacak altı
takım aynası çipi, Analiz>Genel "Hakem Karnesi" kartı; i18n 8 dil. Ayrıca sepet
canlı oran tazeleme (12sn, kapanan bacak "Kapandı"+oynatma kilidi) ve bülten +N
rozeti = panel alan sayısı fix'i aynı gece.) (**0147 gerçek maç
oran önbelleği**: ÜRETİM KAZASI fix'i — USA maçları canlıya düşünce (2026-07-16
23:12 UTC) get_bulletin herkese timeout verdi. Ölçümle kanıt: gerçek kol her
istekte her lambda'lı fikstür için Poisson ızgarası hesaplıyordu (sakin ~460ms,
FE 5sn'de bir yoklayınca eşzamanlı yığılma → 24.5sn → anon 8sn limiti → sarmal;
pg_stat_activity'deki 116sn'lik _tick KURBANdı, neden değil).
Fix: `real_fixtures.markets_cache` + BEFORE INSERT/UPDATE trigger (durum
değişince `_real_markets_build` bir kez hesaplar), `_real_fixture_markets`
artık sadece cache okur (bayat-feed koruması aynen), para yolu taze hesapta.
Sonuç: anon tam bülten ~600ms, 3 canlı gerçek maç oranlı en üstte. DERS:
istek-başına hesap = O(kullanıcı) → asla; hesap yazma-anına, okuma düz satır.
FE'nin 5sn poll'unda timeout backoff'u yok — gelecek sertleştirme adayı.
Ayrıca aynı gece: marka lockup ortalandı + R/A/S yeşil, yeni favicon,
/analiz→/analysis.) (**0146 luck
entegrasyon**: dice/plinko/mines artık get_leaderboard net + mirror_overview
(ürün listesi/AI paketi/flag) + mirror_reality_check net7 + mirror_card
(+ 'luck_chaser' arketipi) hepsinde hesaplanıyor; product.* 8 dilde. Görsel
cila: coin yağmuru + shine, Dice zar dönüşü, Plinko peg-aydınlatma + top hale +
kova dalgası, Mines büyük canlı çarpan + elmas flip + patlama grid-shake. Lig
tabloları vteams'e ait — şans oyunları liderlik NET'inde yer alır.) (**0144-0145 Luck
Games**: 3 yeni şans oyunu — **Mines** (durumlu, 5×5, mayınlar RLS-kapalı
mines_secrets tablosunda = aviator secrets kalıbı; fair mult 0.97·C(25,k)/
C(25-M,k); start/reveal/cashout; "bir kutu daha mı" = Aviator kardeşi, ayna
sinyali), **Dice** (kullanıcı kazanma-şansını=çarpanı seçer, risk iştahı
beyanı), **Plinko** (16 sıra, 3 risk, tablolar 0.97 RTP'ye ölçekli). Hepsi
sunucu-otoriter + provably fair + %97 RTP + prev_result yakalamalı; 3 ekran +
Luck menüsü 5 oyun; i18n 8 dilde 565/565.) (**0143 Bahis AI
sohbeti**: betting-ai edge fn — kullanıcının deterministik ayna paketi (9
mirror_* RPC) sistem prompt'unda, haiku yalnız o sayılardan konuşur, tahmin/
oran ASLA; 30 mesaj/gün (ai_chat_usage); FE AnalizScreen kartı, 8 dil.
**Nesine Temmuz turu**: beraberlik bandı + MS1-kapama kitapla uyumlu; zayıf
taraf longshot'unda kitap ~17'de donduruyor biz ~26 — n=1, dokunulmadı;
gelecek ay 3+ nokta.) (**0142 e-maç
yoğunluğu**: seeder'lar tur başına 3+5 tur ileri → spor başına ~24 maç
üretiyordu; yeni denge futbol 6-8, basket 5-6, tenis/voleybol 3-4 (ölçüldü:
8/6/4/4). FE bülten limiti 120 ("hep 60" görünümü bitti), oran kutuları gap
8px, sekme 'e-football'. **i18n**: 8 dil %100 tam (531/531) — 6 ikincil dile
396'şar anahtar paralel ajan çevirisi (placeholder script-doğrulamalı),
Auth/Username ekranları yerelleşti.) (**0140 güvenlik**:
slot_config RLS açığı kapatıldı (anon her şeyi yazabiliyordu!), tüm `_` önekli
fonksiyonlar + aviator_fire_crash anon/auth'a kapatıldı (PostgREST /rpc tüm
public fonksiyonları açar — YENİ `_` FONKSİYONDA EXECUTE VERME), legacy
place_coupon vb. DROP, ölü src/cron worker silindi. **0141 denetim**: voleybol
canlı set handikapı set skoruna koşullu (2-0 önde -1.5: 27.3→2.05), paylaşılan
kupon bacakları leg_status'tan, _tick_live safe-parse, 620 çapraz-spor çöp maç
silindi; chase-boost "dip" fix'i Nesine anchorlarını bozduğu ölçülünce GERİ
ALINDI (7.07/8.05 korundu) — kalibrasyon > teorik zarafet. FE: canlı bahis
durumu legLiveStatus, winprob barı canlı oranlardan, formatKickoff yerelleşti,
6 dilde eski marka temizlendi.) (**0136 oran
soft-cap**: tavan 20→27.68, `_soft_cap` rasyonel kompresör — 20'ye kadar
birebir, üstü asimptotik; tavanda eşitlenme bitti (0-2'de 85' beraberlik 26.35
≠ galibiyet 27.60); tek dokunuş `_odds_line`+`_price`+`_make_display_odds`,
4 spor otomatik miras. **0137 bülten hijyeni**: BSD'den event almadan düşen
bayat 'notstarted' fikstürler "starting now" hayaleti yaratıyordu —
get_bulletin'e 3 saat kickoff penceresi + reaper'a cancelled/void dalı (5
fikstür temizlendi, kuponlar void). **0138 e-spor istatistik**:
vleague_standings_ex (spor-doğru puan: futbol 3G+1B, basket PCT, voleybol VNL
3/2/1, tenis ATP-race + form + seri), vteam_page/vteam_h2h/_finished_detail
(set/çeyrek dizgileri yalnız finished), parsiyel indeksler; FE /team/:id +
StandingsScreen spor-doğru kolonlar. **0139 AI tabanı**: coupon_review RPC
(adil olasılık, parlay EV=1.06^-n-1, benzer-kupon karnesi) +
match_preview_cache; edge fn **coupon-judge** + **match-preview** (haiku,
mirror-coach kalıbı, key yoksa text:null). İlke korunur: sayılar HEP
deterministik, LLM yalnız cümleye döker; para yoluna analiz mutasyonu ASLA.)
(**0134 liderlik
net birliği**: day/week net artık kupon+aviator+slot toplamı — eskiden yalnız
kupon olduğundan 0 görünüyordu; **0135**: eski 0-parametreli get_leaderboard()
düşürüldü, tek sürüm kaldı.) (**0133 Ayna+**:
user_survey (anket, RLS) + mirror_parallel (kanıtlı karşı-olgusal: gerçek vs
"hep X'te çek") + mirror_tilt (kayıp-sonrası büyütme şeridi + maliyet) +
mirror_selfgap (ölçülen risk skoru 0-100 vs öz-tanım). FE: /analiz Genel
sekmesi üstünde SurveyCard/SelfGapCard/ParallelCard/TiltCard, SVG grafikler.
İlke: her kart = 1 metrik + 1 grafik + 1 cümle; Nesine sürekli scraping
YAPILMAZ — aylık manuel kalibrasyon turu, gerekirse lisanslı odds API.) (**0132 skor
etkisi + çift yönlü çapa**: geriye düşen takımın kalan λ'sı rampalı büyür
(30'→75', ×1.6/×2.2 tavan), önde olan ×0.85'e iner — Fransa 0-2 İspanya 62'
beraberliği 16.65'ten 7.07'ye indi (Nesine 7.24!); bariz güçlü geride ise
%85 ağırlıkla spec eğrisine çapalanır: 0-2'de İY ~7.6-8 → 62' 9.9 → 70' 12 →
78' 16.5 → 85' 20.) (**0131 oran
kalibrasyonu — Nesine canlı ölçümleriyle**: futbol geri dönüş tabanı yumuşatıldı
(bariz güçlü 0-1 geride 82' → 9.41, Nesine 8.84); basket kuyruk genişletildi
(sd 12.5√rem+1.5; güçlü 8 fark %90'da 5.76, eski 14.96); voleybol canlı ML tam
Bo5 koşullu olasılık (zayıf 0-2 geride 4.06 saçmalığı → 20 cap); tenis ölçüldü,
zaten kitap bandında — dokunulmadı.) (0121-0126 sanal
maç/basket düzeltmeleri; **0127 Gates motor v2**: 9 sembol, scatter=10,
GoO-haritalı ödemeler, cap 5000x, FS 15, buy 80x — 500K spin simülasyonuyla
ayarlandı, RTP %95.4 / hit %25.5; **0128-0129 basket serbest atış** (tek sıralı
dizide +1,+1 çiftleri); **0130 canlı futbol geri dönüş tabanı + genel oran
tavanı 20** — bariz güçlü takım 0-2 geride: İY ~8.5-9, 55' ~12, 60' ~14,
70'+ 20 sabit; tavan üstü artık market kapatmaz, 20.00'ye sabitlenir.
Aviator görsel
senkron 0079–0081; kalıcı sanal lig + settle 0082–0087; slot 0091; sanal
basketbol/tenis/voleybol 0092–0106; get_bulletin security-definer fix 0101;
davranış aynası Faz 0 yakalama 0107 + Faz 1a Aviator teşhis 0108 + Faz 1b trend
0109 + Decision Replay 0110; sahte veri seed 0111; kupon/slot/genel analitik 0112;
benchmark 0113; Player Card 0114.) Her önemli oturum sonunda `DEVIR/` klasörüne
kısa devir notu yaz.

**Davranış aynası (asıl ürün) — çekirdek TAM, canlıda:** Faz 0 (moat yakalama
`behavior_events`+`log_events`; kupon/Aviator/session_start/match_detail_viewed),
Faz 1a-b (Aviator teşhis+trend+Decision Replay), **Analiz merkezi "Aynam"**
(`/analiz`): Genel/Maç/Aviator/Gates/Diğer. Backend: `mirror_aviator/coupon/slot/
overview/benchmark/card()`. Çapraz içgörüler + benchmark (vs 78 oyuncu) + Player
Card arketip + deterministik koç önerileri. **Sahte veri (0111): 36 persona.**
**LLM "ses":** `mirror-coach` EDGE FUNCTION (verify_jwt=true) — deterministik
özeti alıp kişisel Türkçe koçluk mesajına döker; **key yoksa {text:null}, frontend
gizler**. GEREKLİ: Supabase secret `ANTHROPIC_API_KEY` (Rasim ekleyince aktif).
İlke: sayılar HEP deterministik, LLM yalnız cümleye döker, uydurmaz. **Para yoluna
analiz mutasyonu ASLA eklenmez** — ayna yalnız OKUR. Sıra: park (4-spor QA, Gates
görsel), sonra daha çok yakalama/hedef-takip nudge.

---

## 7. YOL HARİTASI (2026-07-16 — launch'a ve sonrasına, önem sırasıyla)

*Bu bölüm tek doğru kaynak: "ne kaldı?" sorusunun cevabı. Bir madde bitince
buradan sil/işaretle. T0 bitmeden launch YOK.*

### T0 — LAUNCH BLOKERI (hepsi Rasim'in elinde, kod işi bitti)
1. **Pro + Small upgrade**: Settings→Billing→Pro (~$25/ay), sonra
   Settings→Compute and Disk→Small (kısa restart). Neden: Nano'nun günlük
   30dk IO burst bütçesi — 3 üretim çöküşünün kök nedeni; launch trafiği
   ilk saatte bitirir. **Hemen ardından** SQL-KUYRUK **A** (cron geri-alma:
   pickplay_live 1sn, pickplay_tick 30sn).
2. **Auth URL ayarı**: Authentication→URL Configuration→Site URL
   `https://www.imras.ai` + Redirect listesine `https://www.imras.ai/reset`.
   Şifre sıfırlamanın tek kod-dışı bağımlılığı.
3. **Tap-test (7 adım)**: oran tıkla→otomatik sayılar+takım çipi → yargıç →
   oyna → settle çipi → Hakem Karnesi → Profil "kazanan" = Kuponlarım kontrolü.

### T1 — LAUNCH HAFTASI (Claude, kod; launch'ı beklemez ama bloklamaz)
4. **FE bülten poll backoff**: 5sn poll'a hata-durumunda üstel geri çekilme +
   jitter (0147 kazasının FE ayağı; eşzamanlı yığılma sarmalını FE de kessin).
5. **Gerçek maç pazar adları i18n**: MARKET_NAMES/OUTCOME_LABELS
   (supabaseMatchProvider) İngilizce — provider key döndürsün, FE çevirsin
   ("Match Result / Over 2.5" 8 dilde).
6. **client_error runbook**: her sabah
   `select event_type, payload, created_at from behavior_events where event_type='client_error' order by id desc limit 50;`
   (RootErrorBoundary + global yakalayıcı = bedava Sentry-lite; ilk hafta günlük bak).

### T2 — LAUNCH SONRASI KALİTE (Claude)
7. Argsız `toLocaleString()` süpürmesi (~35 çağrı → fmtNum): ar-SA tarayıcıda
   Doğu Arap rakamı karışması.
8. RTL kalan fiziksel CSS süpürmesi (kritikler yapıldı; kalan ~30 düşük etki)
   + Arapça webfont (Montserrat Latin-only, sistem fontuna düşüyor).
9. `dice_roll` chance clamp canlı testi (FE slider 2-95; RPC sınırı ölçülmedi).
9b. Aviator realtime: aviator_bets aboneliği FİLTRESİZ — her istemci herkesin
   her bahsini alır (O(oyuncu²) mesaj; yük sayımı 2026-07-17). Tur-başına
   filtreli kanal ya da sunucu-özet broadcast tasarlanmalı.

### T3 — ÜRÜN DERİNLİĞİ (Claude + kısa SQL oturumları; SQL-KUYRUK D)
10. **match-preview'a gerçek maç dalı** — ana bahis yüzeyi (gerçek maçlar)
    şu an AI önizlemesiz; ürünün kalbi oradan da konuşmalı.
11. **mirror_luck RPC**: Mines derinlik / Dice beyan-edilmiş risk iştahı /
    Plinko risk dağılımı → Analiz "Diğer" sekmesi gerçek aynaya dönsün.
12. betting-ai cevabına `remaining` (günlük hak sayacı FE'de görünsün).
13. mirror_coupon derinleştirme: oran-bandı histogramı, canlı/maç-öncesi
    ayrımı, takım tuzakları aynada.
14. Ayna genişleme: daha çok yakalama + hedef-takip nudge (Faz 2 — oyun
    bağımsız tasarım ilkesi korunur).

### PARK — bilinçli erteleme (tetikleyen: Rasim kararı / veri birikimi)
- **GoO motor birebirliği**: farklar belgeli (SQL-KUYRUK); değişiklik = para
  motoru = önce 500K spin sim. Tetik: Rasim "yap" derse.
- **Aylık Nesine kalibrasyon turu** (model-tabanlı adil olasılık dahil):
  longshot dondurma bulgusu n=1'di; ağustos ortası 3+ nokta ölç.
- **Gates görsel/gameplay hissi** (Rasim: "oturmadı, dönülecek").
- **4 sanal spor toplu görsel QA** (Rasim yapacak).
- **BSD canlı momentum / $3 WebSocket kararı** (eski bekleyen; gerçek maç
  canlı verisi derinleşsin istenirse).
