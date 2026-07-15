# Devir — 2026-07-16: İlk üretim kazası + gerçek maç oran önbelleği (0147)

## Ne oldu (zaman çizgisi, UTC)
- 23:05 — USA maçları başladı (USL Championship ×2, NWSL ×1); BSD feed ~7 dk
  gecikmeyle 23:12'de `inprogress`'e çevirdi (alt liglerde normal gecikme).
- 23:12+ — imras.ai bülteni HERKESE boş: `canceling statement due to statement
  timeout`. Tek satırlık PK sorguları bile 3-17sn (DB doygun).
- MCP bağlantısı kopuktu → teşhis service_role REST + Rasim'in SQL Editor
  yapıştırmalarıyla yürüdü (pg_stat_activity, pg_stat_statements, base64 gövdeler).

## Kök neden (ölçümle kanıtlı — tahmin değil)
- `get_bulletin` gerçek kolu HER İSTEKTE her lambda'lı fikstür için
  `_real_fixture_markets → real_fixture_odds → _fixture_odds →
  _market_odds_ft_real` (81 hücre Poisson ızgarası ~10-50ms) hesaplıyordu.
- Sakin DB'de kol ~460ms. Ama FE her istemcide 5sn'de bir yoklar ve timeout'ta
  geri çekilmez → eşzamanlı ağır çağrılar kuyruklanır → aynı sorgu 24.5sn
  (ölçüldü) → anon 8sn limiti → herkes timeout → sarmal kendini besler.
- Yanılgı tuzağı: pg_stat_activity'de `_tick()` 116sn görünüyordu → suçlu
  sanılabilirdi. pg_stat_statements ortalaması 284ms → _tick CPU açlığının
  KURBANI, nedeni değil. (İlk şüphelenilen `_market_odds_ft_real`in "2sn"
  ölçümleri de doygunluk şişmesiydi; gerçek maliyeti ~20-50ms.)

## Karar revizyonu
Eski karar "gerçek maçta canlıyı kaldır"dı (absürt oran dönemi). Motor
0130-0136'da kalibre edildiği için Rasim kararı çevirdi: **canlı bahis
KALIYOR**; sorun mimariyle çözüldü ("milyonlarca kullanıcıda patlamasın").

## Fix — 0147 (SQL Editor'den DO bloğu, dosya: 0147_real_markets_cache.sql)
- `real_fixtures.markets_cache jsonb` + `markets_cache_at`.
- `_real_markets_build(...)`: eski hesap yolunun birebir çıktısını üreten saf
  kurucu (aynı `_fixture_odds` primitifi — davranış değişmedi).
- BEFORE INSERT + BEFORE UPDATE OF (status/oran/skor/dakika/kırmızı) WHEN
  distinct trigger: sync yazınca cache'i BİR KEZ tazeler. Maliyet artık
  kullanıcı sayısından bağımsız (sync temposu ~30-60sn).
- `_real_fixture_markets`: hesap yapmaz, cache okur; bayat-feed koruması
  (0056) aynen. get_bulletin'e dokunulmadı.
- Para yolu bilinçli olarak TAZE kaldı: `place_coupon_v2` + `_cashout_value`
  bahis/cashout anında `_fixture_odds`'u çağırır (~10-50ms, işlem başına).
- Yeni `_` fonksiyonlara anon/authenticated EXECUTE YOK (0140 kuralı).

## Doğrulama
- Anon tam bülten 5/5: 432-851ms, 60 maç, 3 canlı gerçek (timeout'lu dönemde ∞).
- Orlando 0-1 geride canlı cache oranları makul: 1→4.42, X→3.27, 2→1.89.
- Canlı sitede Live sekmesi: **Live · Football en üstte, 3 USA maçı ilk
  sırada** REAL rozet + skor + dakika + tıklanabilir oranlarla.
- FE ajan analizi: FE tamamen sunucu-otoriter, değişiklik gerekmedi
  (markets boşsa hücreler "–" disabled; settle/cashout final skora dayalı).

## Aynı gece biten diğer işler (deploy edildi, commit 95360dd)
- Marka: "I'm Ras" + "Risk Awareness System" ortak eksende, R/A/S baş harfleri
  yeşil (#12a150). Yeni favicon (beyaz top, siyah border, yeşil beşgen).
- URL İngilizce: `/analysis` ana rota, `/analiz` kalıcı yönlendirme.

## Açık uçlar / gelecek sertleştirme
- FE 5sn bülten poll'unda timeout backoff YOK — sarmalın yakıtıydı; exponential
  backoff / ETag / edge cache adayı (milyon kullanıcı hedefinde şart olacak).
- SC Jacksonville–Pittsburgh canlıydı ama bültende yok: prematch_odds/lambda
  yok (mevcut filtre, regresyon değil). Lambda kapsaması ayrı konu.
- Örnekleyicide kriz sonrası tek tük 5-16sn diken görüldü; 0147 sonrası kısa
  örnekleme temizdi. Tekrarlarsa `_tick` için ayrı zamanlayıcı sarmalayıcı kur.
- MCP (supabase) oturum boyu kopuk kaldı — sonraki oturumda bağlantıyı kontrol et.
