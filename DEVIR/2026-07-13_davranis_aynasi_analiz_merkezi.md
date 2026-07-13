# DEVİR — Davranış Aynası + Analiz Merkezi (2026-07-13)

## Ne yapıldı (asıl ürün başladı: davranış aynası)

Danışman konsensüsü "önce TEK kolla (Aviator) aynayı KANITLA, sonra genişle"
izlendi; ardından çapraz-ürün ve kimlik katmanına genişletildi. **Hepsi canlıda,
gerçek veriyle uçtan uca kanıtlandı, tsc + build temiz.**

### Backend (migration 0107–0114)
- **0107** `behavior_events` + `log_events` batch RPC — Faz 0 moat: karar-öncesi
  olay yakalama (kupon ekle/değiştir/sil/oyna + tereddüt, Aviator bet/cashout).
- **0108** `mirror_aviator()` — Aviator teşhis (deterministik bayraklar).
- **0109** aynı fonksiyona `series` (trend/delta = ürün).
- **0110** `mirror_aviator_moment()` — Decision Replay ("seni ele veren an").
- **0111** SAHTE VERİ seed — 36 persona-kullanıcı (chaser/disciplined/whale/
  slotlover/couponer/casual), tutarlı çapraz-ürün geçmiş. `sim_` önekli, idempotent.
- **0112** `mirror_coupon()`, `mirror_slot()`, `mirror_overview()` (çapraz-ürün).
- **0113** `mirror_benchmark()` — vs diğer oyuncular (yüzdelik dilim).
- **0114** `mirror_card()` — Player Card arketip.

**İLKE (bozma):** Tüm ayna fonksiyonları YALNIZ OKUR — settle/para yoluna analiz
mutasyonu ASLA eklenmedi ("kritik iş kırılgana bağlanmasın"). Sayılar deterministik;
metin şablonlu "ses" (LLM henüz YOK, en sona bırakıldı). Hepsi SECURITY DEFINER +
auth.uid() kendi verisi + anon revoke.

### Frontend
- Sol menüde **"Aynam"** (`/analiz`, MirrorIcon). `AnalizScreen` hub + alt sekmeler:
  Genel / Maç bahisleri / Aviator / Gates of Goal / Diğer.
- `src/lib/mirror.ts` (fetch+tip), `src/analiz/flagText.ts` (teşhis metni +
  `flagAction` koç önerileri), `src/aviator/AviatorMirror.tsx` (Aviator kartı,
  trend + replay), Genel'de PlayerCard + benchmark + koç önerili içgörüler.

## Kanıt (Rasim'in gerçek verisi, user ce1fbf70)
- Çapraz: kupon −3.17M (10.069, riskin %92), aviator −76k (126), slot **+3.936**
  (137). Genel bayrakları: risk yığılması / en-çok-oynadığın=en-çok-kaybettiğin /
  gizli kazanan. Arketip: **Açgözlü Pilot** (yakalanma %52, auto %7).
- Benchmark (78 oyuncu): disiplin %52 vs %60 → %67'sinden iyi; kupon ROI −%26 vs
  −%6 → %23'ünden iyi.

## Açık konular / sıra
- **LLM "ses"** — deterministik katman bitti; sıradaki büyük adım koç narratifini
  LLM ile üretmek. Ama edge function + Anthropic API key + maliyet kararı Rasim'e
  ait. Prensip: sayılar hep deterministik kalır, LLM sadece cümleye döker.
- Rasim ton/eşik/yerleşim için canlıda **toplu gözden geçirecek** (preview harness
  bu ortamda auth-gated ekranı yükleyemedi; görseller widget ile verildi).
- Park: 4 sanal spor toplu QA + Gates of Goal görsel polish.
- Migration **0115'ten** devam.
