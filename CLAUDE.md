# CLAUDE.md — imras.ai (PickPlay) Kalıcı Bağlam

*Repo kökünde durur, her Claude Code oturumunda otomatik okunur. Amaç: her
oturum projeyi sıfırdan değil TAM bağlamla açsın. Türkçe konuş.
Son büyük derleme: 2026-07-19 (kriz sonrası, Rasim talebiyle).*

---

## 0. ÇALIŞMA KURALLARI (altın kurallar — ihlal etme)

- **Kullanıcı: Rasim.** Türkçe konuş. Katar'da. Bilgisayar müh. + mobil oyun
  geçmişi → güçlü ürün sezgisi. Teknik detaya boğma; önce büyük resim.
- **SQL/DB işleri (2026-07-19'dan beri): Claude MCP ile DOĞRUDAN yapar**
  (`mcp__supabase__execute_sql` / `apply_migration` çalışıyor; Rasim "orada
  sen yap" dedi). Her uygulanan değişikliğin repo'da `supabase/migrations/`
  kaydı tutulur (tam gövde ya da özet + "gövde canlıda" notu).
  **MCP koparsa** eski düzene dön: sorguyu yaz, Rasim SQL Editor'de TEK TEK
  çalıştırıp çıktıyı yapıştırır.
- **Tek adım talimat.** "1 bunu yap, bitince 2" diye net sırala.
- **Ölçmeden migration yazma.** Kök nedeni KANITLA, tek doğru düzeltmeyi yap.
  Tahmin üstüne migration savrulması yasak (Aviator 0074-0078 dersi).
- **Görmediğin fonksiyona dokunma.** Gövdeyi çek:
  `select pg_get_functiondef(oid) from pg_proc where proname='...'`
  (uzunsa base64). Kapı/guard eklerken DB-içi ameliyat kalıbı güvenli:
  `pg_get_functiondef` → regexp ile satır ekle → `execute` (0156 böyle yapıldı).
- **Permanent çözüm, workaround değil.** (Rasim'in en sık vurguladığı ilke.)
- **Seçenek sunma — kanıtla, karar ver.** Ama İKİ İSTİSNA Rasim'in kararı:
  para harcayan her şey ve para motoruna dokunan her şey.
- **Rasim net semptom verir, kök nedeni SEN bul.** Konsol açtırıp durma;
  gerçekten gerekirse tek net sorgu/ekran görüntüsü iste.
- **Para yoluna analiz/ayna mutasyonu ASLA eklenmez** — ayna yalnız OKUR.
- **PostgREST /rpc tüm public fonksiyonları açar** → yeni `_` önekli
  fonksiyonda EXECUTE'u public/anon/authenticated'dan REVOKE et (0140).
- **Supabase default privilege'ları** anon/authenticated/service_role'e AYRI
  AYRI grant verir → "revoke from public, anon" authenticated'ı KIRMAZ.
- **RLS dersi:** RLS açık + policy yok = tablo o role tamamen KAPALI
  (secrets kalıbı 0073). service_role bypass eder — editör testi yanıltır.
- **Sohbet oturumuysa (Claude Code değil):** kod/DB erişimi YOK; strateji
  konuş, mühendislik işini Code'a bırak.

---

## 1. ÜRÜNÜN ASIL AMACI (en kritik bölüm)

imras.ai bir bahis sitesi DEĞİL — **davranış aynası + koç** (RAS = Risk
Awareness System). Para dönmüyor (sembolik altın). Piyasa boşluğu: bahis
siteleri kullanıcının zaafını görür ama saklar; analiz siteleri maçı bilir
ama kullanıcıyı bilmez. **imras ikisini kullanıcı LEHİNE birleştirir:**

> "Bu maçın analizi şu — AMA senin geçmişinden görüyorum ki Marseille'e
> 11. bahsin, 3'ü tuttu, net -1840. Bu analiz değil, alışkanlık."

**Ayna + Yargıç CANLIDA:** /analysis merkezi (5 sekme), AI Kupon Hakemi v2
(bacak bilinci + takım sadakati + çapraz-oyun tilt + hakem hafızası),
benchmark, Player Card, Ayna+ kartları, bahis AI sohbeti. Oyunlar (sanal
4 spor + gerçek futbol + Aviator + Gates + Mines/Dice/Plinko) veri toplama
aracı + retention; **farklılaştıran ANALİZ.**

**İnandırıcılık ≠ Hassasiyet:** marj %3 mü %6 mı önemsiz; motorun tanıdık
maçta absürt oran VERMEMESİ ve ödemelerin çalışması = otantik davranış
verisinin önkoşulu. Bozuk motor = kirli laboratuvar = çöp veri.

---

## 2. MİMARİ

```
GERÇEK FUTBOL  → maç öncesi + CANLI (0147 markets_cache)  ─┐
SANAL 4 SPOR   → CANLI bahis (kurgusal, "Takım (Oyuncu)") ─┼→ DAVRANIŞ MOTORU → AYNA
AVIATOR        → "ne zaman çekerim" (en temiz risk sinyali)─┤   (behavior_events
ŞANS OYUNLARI  → Mines/Dice/Plinko + Gates (RTP %97/%95.4) ─┘    + ürün tabloları)
```

- Gerçek canlı bahis KALIYOR (Rasim kararı 2026-07-16; motor Nesine'yle
  kalibre). Ölçek: istek-başına hesap YASAK — oranlar `markets_cache`'te
  hazır, get_bulletin yalnız okur (~600ms); para yolu taze hesap.
- **UYUYAN DÜNYA (2026-07-19):** izleyen yokken motorlar durur (aşağıda §4-Ops).

---

## 3. TEKNİK ORTAM

- **Barındırma:** Supabase proje ref `owhvdjmxdtdaifpzttav`, artık Rasim'in
  **PRO organizasyonunda** (hesap: rasimkurum — dashboard'da "imras" projesi;
  eski kurumrasim hesabından 2026-07-19'da transfer edildi). **Micro compute,
  8 GB disk, günlük otomatik yedek.** Ek proje maliyeti ~$10/ay (Pro'daki
  diğer proje pause edilirse kredi devri = net $0 — Rasim'in tasarrufunda).
- **Backend:** TAMAMEN Postgres (pg_cron + pg_net + vault). Dış worker YOK,
  Railway'e ASLA dönülmez. Kritik-olmayan hız işleri ephemeral Edge Function
  olabilir (ilkenin ruhu: "kritik iş kırılgana bağlanmasın").
- **Veri beslemesi:** BSD (sports.bzzoiro.com, key vault'ta `bsd_api_key`).
  Fikstür: gece 03:00 gün-gün istek + 5dk'da bir kendini-zincirleyen toplama
  (0155, tam kapsama). Ligler: 02:00 (2 sayfa). Lambda: solve-lambdas edge'i
  15dk'da 20 fikstür. Canlı: _tick_live 2sn (uyanıkken).
- **Cron envanteri:** aviator_tick 1sn · pickplay_live 2sn · pickplay_tick
  60sn · pickplay_lambda */15 · pickplay_lambda_log · pickplay_fixtures_req
  03:00 · pickplay_fixtures_collect */5 · pickplay_leagues_req/collect 02:00 ·
  pickplay_reap */5 · **pickplay_janitor 04:07** (gece bekçisi).
- **Edge functions** (git'ten OTOMATİK DEPLOY OLMAZ — dashboard'dan elle ya
  da MCP): aviator-crash-timer, solve-lambdas, coupon-judge (Sonnet 5,
  thinking disabled, 640 token, "sen" hitabı), mirror-coach, match-preview,
  betting-ai. `ANTHROPIC_API_KEY` Supabase secret'ta.
- **Frontend:** Vite+React+TS, Vercel'e GitHub main push'uyla otomatik deploy
  (repo: rasim3585/imras). Domain: www.imras.ai. 8 dil (en,tr,es,de,ru,ar,zh,
  hi) × 675 anahtar; `scripts/check-i18n.cjs` build zincirinde (parite
  bozulursa build KIRILIR). RTL (ar) destekli.
- **Migration'lar:** sıfır dolgulu 4 hane, yeni migration **0157'den** devam.
  Kilometre taşları listesi §6'da.
- **Teşhis kanalları:** MCP get_logs (DB kapalıyken bile çalışır — yönetim
  düzlemi), service_role REST (.env'de), `behavior_events`'te
  `event_type='client_error'` (bedava Sentry-lite; RootErrorBoundary + global
  yakalayıcı besler).

---

## 4. SİSTEM ENVANTERİ (ne var, durumu ne)

### Oyun motorları
- **Futbol (sanal) motoru:** STABİL. Poisson oran motoru (10K kupon test,
  marj ~%3), soft-cap 27.68 (0136), skor etkisi + çift yönlü çapa (0130-0132),
  Nesine kalibrasyonlu. Ödeme zinciri kendi kendine döner.
- **4 sanal spor:** futbol/basket/tenis/voleybol; spor-doğru istatistik ve
  lig ekranları (0138); yoğunluk 6-8/5-6/3-4 (0142). Voleybol hayalet-set
  fix + pace alanı (0152).
- **Gerçek futbol:** fikstür+lig+lambda+canlı besleme zinciri (§3); canlı
  oranlar markets_cache'ten; settle/reap otomatik; kupon void yolları var.
- **Aviator:** BİTTİ. Provably fair, edge-hassas crash (46-104ms), davranış
  yakalama (prev_result, caught_by_crash...), cashout anti-hile tavanı.
- **Gates of Goal:** motor v2 (0127), 500K spin simüle, RTP %95.4; sembol
  seti v3 GoO-paritede. Görsel his "oturmadı" — Rasim dönecek (PARK).
- **Şans oyunları (0144-146):** Mines (kurtarma dahil — mines_active),
  Dice, Plinko; hepsi sunucu-otoriter, %97 RTP, liderlik+aynada.

### Ayna / AI (ürünün kalbi)
- **Analiz merkezi /analysis:** Genel/Maç/Aviator/Gates/Diğer sekmeleri,
  benchmark (vs oyuncular), Player Card arketipi, Ayna+ (anket/karşı-olgusal/
  tilt/öz-tanı), reality check, sohbet aynası.
- **AI Kupon Hakemi v2 (0148-149):** coupon_review deterministik sayılar
  (bacak-başına takım geçmişi, chase/tempo, sadakat tuzağı, olgunluk,
  çapraz-oyun tilt, hakem hafızası) + coupon-judge edge'i cümleye döker.
  judge_verdicts defteri, karne, yüzleşme çipleri. Kota 20/gün.
  Kart+buton ASLA sessizce kaybolmaz (hesaplanıyor/retry durumları).
- **Bahis AI sohbeti (0143):** kullanıcının kendi sayılarından konuşur,
  tahmin ASLA. 30 mesaj/gün.
- **İlke:** sayılar HEP deterministik; LLM yalnız cümleye döker.

### Operasyon (2026-07-17/19 krizi sonrası kurulan bağışıklık)
- **Uyuyan Dünya (0153+0156):** FE dakikalık nabız (görünür sekme) →
  `app_presence`; son 5dk nabız yoksa `_tick`/`_tick_live`/`_reap` uyur
  (sıfır yazma/HTTP). `_aviator_tick`: açık tur (betting/flying) varken
  ASLA uyumaz — para döngüsü tamamlanır, sonra uyur. İlk nabız advisory-lock
  korumalı tek-çalışan catch-up `_tick` koşturur. CANLI TEST EDİLDİ.
- **Gece Bekçisi (0154, 04:07):** cron geçmişi >2g, pg_net izleri >1g, tur
  sırları >7g, ıssız (bahissiz) turlar >3g, eski pazar/seçenek >14g
  (kuponla anılan ASLA silinmez). İlk süpürme: 28.441 ıssız tur.
- **Fikstür tam kapsama (0155):** gün-gün pencere + count'a göre kendini
  zincirleyen sayfalama; beslemeyle birebir doğrulandı (50/50, 11/11, 56/56).
- **FE yük diyeti (2026-07-17):** tüm poll'larda gizli-sekme durdurması,
  frekans disiplini (kort 3s, canlı 4s, mini 4s, detay faz-duyarlı, feed
  backoff'lu), kupon incelemesi yalnız seçim değişince (EV yerelde ölçeklenir).
  Kullanıcı başına DB trafiği ~%70-80 düştü, UX değişmedi.
- **Hata dayanıklılığı:** RootErrorBoundary + global yakalayıcı →
  client_error; humanizeError/mapAuthError (ham mesaj kullanıcıya ASLA);
  hata-vs-boş ayrımı her kritik ekranda; Aviator/Analiz retry'lı.
- **Auth:** şifre sıfırlama akışı (forgot + /reset), identities-boş kayıt
  teşhisi, profil retry+koruma, deep-link dönüşü. Dashboard URL config ✓
  (Site URL www.imras.ai + joker redirect listesi).

### 2D izleme
- 4 sporda tek tutarlı motor: yerel monoton saat + varışa-bağlı sunum +
  kuyruk/buffer; kanıt: 30/30 basket pota dibinde, tabela aynı karede.
  Pace alanıyla sim temposu sunucuya bağlı (480sn'de birebir eski davranış).

---

## 5. İŞ BÖLÜMÜ

- **Claude Code:** kod + DB (MCP doğrudan) + deploy zinciri + ölçüm gereken
  her şey. Edge deploy'ları Rasim dashboard'dan yapıştırır (ya da MCP
  deploy_edge_function bağlıysa Claude).
- **Rasim:** ürün kararları, para kararları, dashboard-only işler (billing,
  auth ayarları, support), tap-testler, görsel QA.
- **Sohbet arayüzü:** strateji/büyük resim. Aynı dosyaya iki taraf dokunmaz.

---

## 6. KİLOMETRE TAŞLARI (özet; ayrıntı git log + DEVIR/)

0053-0067 futbol · 0068-0078 Aviator motor · 0079-0081 görsel senkron (edge)
· 0082-0087 kalıcı lig+settle · 0091 slot · 0092-0106 basket/tenis/voleybol
· 0107-0114 ayna Faz0-1 + analitik + benchmark + Player Card · 0121-0129
sanal maç düzeltmeleri + Gates v2 + basket serbest atış · 0130-0136 canlı
oran kalibrasyonu (Nesine) + soft-cap · 0137 bülten hijyeni · 0138 e-spor
istatistik · 0139 AI tabanı (coupon_review, match_preview_cache) · 0140
güvenlik süpürmesi (RLS/EXECUTE) · 0141 denetim · 0142 yoğunluk + i18n 8 dil
· 0143 bahis AI sohbeti · 0144-0146 şans oyunları + entegrasyon · 0147
markets_cache (istek-başına hesap yasağı) · 0148-0149 Hakem v2 + hafıza ·
0150 auth/kör-nokta dalgası (şifre sıfırlama, ErrorBoundary, humanizeError,
RTL, i18n 675) · 0151 mines_active · 0152 hayalet set + pace · 0153-0156
UYUYAN DÜNYA EKOSİSTEMİ (nabız, bekçi, tam kapsama, motor kapıları) · 0157
RLS initplan + FK indeks · 0158 gerçek canlı monotonik dakika + uyku istisnası
· 0159 GERÇEK MAÇ UÇTAN UCA SERTLEŞTİRME (4-ajanlık denetim, 22 bulgu: FT 90dk
snapshot=uzatma golü sızması, terminal settle, void iade, fixtures regresyon
kalkanı, collect zehir-hapı, lambda timeout, cashout bayat-feed).

**Kriz günlükleri:** 2026-07-16 get_bulletin timeout (kök: istek-başına
Poisson; fix 0147) · 2026-07-17→19 disk-dolu 45 saat kesinti (kök: 1GB disk
× WAL+birikim; fix: Pro org transfer + 8GB + Micro + 0153-0156 zinciri).
Detay: DEVIR/ klasörü.

---

## 7. YOL HARİTASI (2026-07-19 günceli — önem sırasıyla)

*Tek doğru kaynak. Bir madde bitince buradan güncelle. T0 bitmeden launch YOK.*

### T0 — LAUNCH ÖNCESİ (kalan tek madde!)
1. ✅ ~~Altyapı krizi~~ (Pro org + 8GB + Micro + uyuyan dünya, 2026-07-19)
2. ✅ ~~Auth URL ayarı~~ (2026-07-19, joker listeyle)
3. **Tap-test (Rasim, ~10 dk):** (a) şifre sıfırlama e2e (forgot→mail→/reset)
   → (b) oran tıkla → otomatik sayılar+takım çipi → (c) yargıç kararnamesi →
   (d) kuponu oyna → (e) settle sonrası "Hakem %X demişti" çipi → (f) Analiz
   > Hakem Karnesi → (g) Profil "kazanan" = Kuponlarım birebir.

### T1 — LAUNCH HAFTASI (Claude)
4. **Gerçek maç pazar adları i18n:** MARKET_NAMES/OUTCOME_LABELS provider'da
   İngilizce — provider key döndürsün, FE 8 dilde çevirsin.
5. **Sabah runbook** (ilk hafta her sabah): (a) client_error:
   `select event_type, payload, created_at from behavior_events where event_type='client_error' order by id desc limit 50;`
   (b) self-test (0160): `select * from test.log where not ok order by id desc limit 5;`
   (boş = para/settle motoru sağlıklı; satır varsa regresyon — report'a bak).
6. Launch sonrası 24-48. saatte Reports kontrol (Micro'da RAM/IO seyri +
   uyuyan dünyanın boşta-sıfır kanıtı).

### T2 — KALİTE (Claude)
7. Argsız `toLocaleString()` süpürmesi (~35 çağrı → fmtNum; ar-SA tarayıcıda
   Doğu Arap rakamı riski).
8. RTL kalan fiziksel CSS (~30 düşük etki) + Arapça webfont.
9. **Aviator realtime O(oyuncu²):** aviator_bets aboneliği filtresiz — tur
   filtreli kanal ya da sunucu-özet broadcast tasarla (kalabalıkta şart).
10. `dice_roll` chance clamp canlı testi (FE 2-95; RPC sınırı ölçülmedi).
11. Lig kapsaması: leagues sync 2 sayfa (100 lig) — fikstürdeki 0155
    zincirleme kalıbını leagues'e de uygula (eşleşmeyen lig 'Other' düşer).
12b. **Gerçek maç denetimi Tier-3 (0159 ertelenenleri):** (a) uzatma DISPLAY:
    _market_odds_ft_real 90'da tüm oranları null'lar — doğru (bahis kapalı) ama
    watch ekranı 90-120 arası maçı göstermeli (real_fixture_watch_state canlı
    kalsın); (b) açık kuponda gerçek bacak canlı tik/çarpı (MyCouponsScreen
    get_live_state gerçek fikstür kolu — hep "soon"); (c) canlı kırmızı kart
    yazımı (feed'de yok/live_incidents boş — önce feed alan araştır) → _red_factor
    ölü; (d) shared-goal (lambda_shared hep 0 — bağımsız Poisson; kalibrasyon);
    (e) league_name ingestion'da null (bsd_leagues join'ine bağlı); (f)
    real_fixture_watch_state.live_odds argüman tutarsızlığı (5-arg, kırmızı/shared
    düşüyor).

### KALİTE SİSTEMİ (Rasim kararı 2026-07-20: "3'ü de sırayla")
- ✅ **Katman 1 — otomatik regresyon ağı (0160-0162):** test.money_path (55) +
  settle_flow (5) + luck_math (7) + aviator_math (6) = **73 test**; cron
  pickplay_selftest 04:20 → test.log. Para/settle/şans/aviator kırmızı/yeşil
  bekçili. YENİ para fonksiyonu = önce test ekle.
- ⏳ **Katman 2 — proaktif yüzey denetimi (Claude, sırayla):**
  ✅ gerçek maç (22 → 0159) · ✅ şans oyunları (14 → 0161: TOCTOU+taşma+index) ·
  ✅ Aviator (14 → 0162: KRİTİK çift-kredi/çift-ödeme) · ✅ ayna/yargıç (12,
  kritik YOK — 0163 bigint regresyon + hijyen) · ⏳ SIRADA: auth+profil+sosyal. Her denetim → düzelt → yeni test.
  AÇIK (aviator, düşük): realtime O(oyuncu²) fan-out + anonim oyuncu-view;
  IMMUTABLE→STABLE; FE optimistic overlay uzlaşımı.
- ⏳ **Katman 3 — insan tap-test:** DEVIR/QA-TAP-TEST-CHECKLIST.md hazır
  (Rasim + arkadaşlar). Katman 4 (ücretli QA) = launch sonrası trafikle.

### T3 — ÜRÜN DERİNLİĞİ (Claude + kısa oturumlar)
12. **match-preview'a gerçek maç dalı** (ana bahis yüzeyi AI önizlemesiz).
13. **mirror_luck RPC** (Mines derinlik / Dice risk beyanı / Plinko dağılım)
    → Analiz "Diğer" gerçek aynaya dönsün.
14. betting-ai cevabına `remaining` (günlük hak FE'de görünsün).
15. mirror_coupon derinleştirme (oran-bandı histogramı, canlı/öncesi ayrımı).
16. Ayna Faz 2: hedef-takip nudge + daha çok yakalama (oyun-bağımsız tasarım).

### PARK — bilinçli erteleme (tetik: Rasim kararı / veri birikimi)
- **GoO motor birebirliği** (farklar belgeli; değişiklik = para motoru =
  önce 500K spin sim). Tetik: Rasim "yap" derse.
- **Aylık Nesine kalibrasyon turu** (longshot bulgusu n=1; ağustos ortası
  3+ nokta) + model-tabanlı adil olasılık.
- **Gates görsel/gameplay hissi** (Rasim: "oturmadı, dönülecek").
- **4 sanal spor toplu görsel QA** (Rasim).
- **BSD canlı momentum / $3 WebSocket** (gerçek maç canlı derinliği istenirse).
- **Pro org'daki diğer projeyi pause etme** (kredi devri, net $0) — Rasim.

### OLABİLİRLER (fikir havuzu — taahhüt değil)
- Haftalık "ayna özeti" e-postası/bildirimi (davranış raporu).
- Sosyal karşılaştırma derinliği (lig içi davranış kıyası — "ligindeki en
  disiplinli oyuncu").
- Aviator turnuvası / görev sistemi (retention).
- Çapraz-profil vurgusu landing'de ("maçta temkinli, Aviator'da açgözlü").
- PWA / mobil sarmalayıcı.
- Çoklu dil pazarlama sayfaları (ar/hi odaklı pazarlar).
