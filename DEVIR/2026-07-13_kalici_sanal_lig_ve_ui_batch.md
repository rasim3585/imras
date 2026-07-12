# DEVIR — 2026-07-13 · Kalıcı sanal lig + UI/UX batch

Uzun ve yoğun bir oturum. İki ana blok: (1) sanal futbolu **yaşayan bir lige**
dönüştürme, (2) Rasim'in verdiği **11 maddelik UI/UX + bug batch'i**. Öncesinde
Aviator görsel senkronu (edge-timed crash, `DEVIR/2026-07-12_*`) bu oturumun
başında Adım 2 ile tamamlanmıştı.

---

## 1. Zengin maç detayı (Faz 1)
- `MatchDetailScreen` Nesine tarzı **gruplu-sekmeli** market ekranı: All / Result /
  Over-Under / Goals. Canlıda tüm marketler; İY marketleri yalnızca upcoming'de.
- Commit **583c67b**.

## 2. Gerçek maç canlı-oran motoru — ANALİZ (kod yazılmadı)
- **Bulgu:** Motor takım gücünü ZATEN ayırt ediyor (lambda_home/away, 1X2'den
  solver). Kanıt: aynı skorda güçlü-ev 1.74 / zayıf-ev 5.46.
- **Veri kilidi:** BSD canlı REST'i **istatistik VERMİYOR** (sadece skor/dakika/
  durum). Maç-içi üstünlük (şut/possession) ancak ücretli WebSocket'le gelir.
  → Gerçek maçta dominance fiyatlaması veri-kilitli.

## 3. Kalıcı sanal lig (b seçildi) — takım kimliği: A (gerçek adlar + "Sim League")
- **Faz 3a (0082):** `vteams` (34 kulüp, kalıcı atak/defans reytingi, RLS+policy yok
  → sunucu-gizli). `matches.home_team_id/away_team_id`. `seed_matches` artık gücü
  reytingden türetiyor → **güç maçtan maça sabit** (eskiden random). Commit **2a721b6**.
- **Faz 3b (0083):** `vleague_standings()`, `_vteam_form()`, `vmatch_stats()` —
  standings/form/H2H **biten maçlardan** hesaplı (ayrı tablo yok), definer RPC.
  Commit **ddf37ad**.
- **Faz 3c:** `MatchStatsPanel` — maç detayında "Simulated League" sıralama + renkli
  form + H2H. Commit **df7f802**.
- **Faz A / Elo (0084):** reytingler her maç sonucuna göre kayar (form-duyarlı
  oranlar); taban reytinge ortalama-dönüş + [0.55,1.65] clamp. `_finalize_match`'e
  `_vupdate_ratings` hook. Commit **aab36a5**.
- **Faz B (crests):** `TeamCrest` — özgün SVG kalkan; kulübün gerçek renk çifti +
  imza deseni (Barça/Juve dikey çizgi, Celtic halka, Roma bant…). Telif riski yok.
  Commit'ler **869c075**, **a808ced**.

## 4. 11 maddelik UI/UX + bug batch (13 Tem)
| Konu | Çözüm | Commit |
|------|-------|--------|
| Ana logo | yeşil beşgen top, kalın border, okunur/iç-içe wordmark | 2773f55 → 72d07e2 |
| E-Football ikonu | tek gamepad + top | 18b34e3 |
| Sanal maç çift-live + gruplama | seed dedup (0085) + Live·Football / Live·E-Football | 362e481 |
| Gerçek maç "Connecting…" takılması | gerçek bacak /live'a linklenmez + 6sn fallback | 0570d71 |
| Sembolik gold → yeşil coin | özgün `CoinIcon` (NavBar + Aviator), landing metni | 72d07e2 |
| Live satırı lig-adı sıkışması | hideLeague | 72d07e2 |
| Kupon sayısı rozeti | NavBar Coupons'ta CartContext.count | 68a751e |
| Kazanç animasyonu | bakiye count-up + yeşil "+miktar" pill | c381698 |
| Gerçek maç kuponda "soon" | (1) settle_real_fixture finished'ta tetiklenir (0086); (2) frontend leg_status okur | 7504e04 |
| Aviator başlangıç gecikmesi | takeoff broadcast'e flying_at (0087) + frontend handler | cea8a1e |
| Aviator 1.00 crash | **orijinal davranış** (%1.67 instant), değiştirilmedi | — |

## Migrationlar
0082 vteams · 0083 stats RPC · 0084 Elo drift · 0085 seed dedup ·
0086 real-fixture settle-on-finish · 0087 aviator takeoff flying_at.
Yeni migration **0088'den** devam.

## Doğrulama notları
- Sanal lig canlı hat çalışıyor (reytingli maçlar bitip standings'e işliyor;
  Elo sapması directionally doğru; crest'ler render).
- `settle_real_fixture` sweep'i 37 takılı biten fixture'ı da düzeltti.
- **Login/canlı gerektirenler Rasim'in görsel teyidini bekliyor:** kazanç
  animasyonu, Aviator başlangıcı (takeoff artık broadcast'le).

## Açık konular / sıradaki
1. **Gerçek maç live-watch ekranı yok** — şu an gerçek bacaklar tıklanamaz. İstenirse
   real_fixture_watch_state ile basit bir skor/oran izleme ekranı.
2. **Puan tablosu ekranı** — `vleague_standings()` hazır, UI yok.
3. **Bültende mini-form / "Simulated League" etiketi** — satır seviyesinde.
4. **🎯 ASIL HEDEF — davranış analizi (ayna):** artık zengin bağlam var (favori/form/
   H2H + Aviator sinyalleri). Ayna katmanı hâlâ kurulmadı; en büyük iş bu.
5. **instacrash (cp≈1.0):** edge cold-start uçuştan yavaş → o tur ~1sn tick fallback
   (kabul edildi).
6. **Kupon `status` vs `leg_status`:** `status` legacy/bayat; kaynak `leg_status`.
   İleride `status` kolonu tamamen kaldırılabilir (temizlik).
