# DEVIR — 2026-07-13 · Sanal Basketbol (e-Basketball) — CANLIYA ALINDI

## Ne yapıldı
Futbola paralel, **tam canlı sanal basketbol** eklendi. Futbol motoru BİREBİR
korundu; her şey `sport` alanına göre dispatch ediliyor. Migration'lar 0092–0100.

### Motor (özgün, Poisson değil)
- Skor: **normal dağılım** (BASE 108/takım, takım-çeyrek Normal(exp/4, 5.5)),
  **beraberlik yok** (eşitlikte uzatma). Çeyrek-çeyrek skor `secret_outcome`'da
  (İY/çeyrek marketleri buradan çıkacak — henüz UI'da yok).
- Oran: **normal CDF** (`_norm_cdf`). Marketler: Maç Sonucu (2y), Handikap,
  Toplam, Ev/Deplasman Takım Toplamı. Çizgiler `.5` (push yok), lambda'dan
  deterministik → settle ile tutarlı.
- `_bb_make_outcome`, `_bb_game_odds`, `_bb_ensure_markets`, `_bb_seed`,
  `_bb_state` (canlı reveal + oran), `_bb_settle_markets`, `_bb_update_ratings`,
  `_bb_finalize`.

### Dispatch (futbol bozulmadan)
- `_finalize_match` → basketbol ise `_bb_finalize`.
- `get_bulletin` → basketball_rows (`_bb_state`/`_bb_match_markets`), her satırda
  `sport` + lig; virtual_rows `sport='football'` ile sınırlandı.
- `get_live_state` → basketbol dalı (`_bb_state`).
- `vleague_standings(sport)` + `league` kolonu (NBA/EuroLeague partition);
  `vmatch_stats` spor-aware. **Yan fayda:** futbol standings'e basketbol takımı
  sızması (name-unique kaldırıldı + sport filtresi) düzeldi.
- `_tick` → `+ _bb_seed(3)` = **CANLIYA ALMA** (0100).

### Takımlar/ligler
- `vteams.sport` + `vteams.league`. **NBA (30)** + **EuroLeague (16)** gerçek
  kulüp adları. Maçlar AYNI lig içinde. Crest'ler isimden üretilen **özgün
  procedural art** (gerçek logo DEĞİL — telif). `vteams_name_key` kaldırıldı
  (basketbol futbolla aynı adı paylaşabilsin: Real Madrid vb.).

### Frontend
- `EBasketballIcon` (gamepad + basketbol topu). Tab **"e-Basketball"**.
- MatchRow sport-aware kolonlar (Maç Sonucu 1/2 · Handikap · Toplam); expand
  jenerik. FeedScreen: e-Basketball tab + canlı/upcoming lige göre bucket'lar.
  Canlı sırası: Football → E-Football → Basketball.
- MatchDetailScreen: basketbol market grupları (Winner/Handicap/Totals);
  basketbolda "Watch live" gizli (detayda canlı skor+oran var).
- MatchStatsPanel spor-aware (W-L). **StandingsScreen** (`/standings`): spor
  toggle + lige bölünmüş tablolar; feed'de "League tables" linki.

## Doğrulama (veriyle — auth'lu preview yok, local 401)
- Skor ort. beklenene birebir, 0 beraberlik, çeyrek+OT tam toplar.
- Oranlar mantıklı; settle her markette tek tutarlı kazanan.
- Bültende 21 basketbol maçı (EuroLeague/NBA, option_id'li); canlı state 86-87 @
  dakika 33 canlı oranla; standings NBA 30/EuroLeague 16. tsc temiz.

## Açık / sıradaki
- **İY/Çeyrek marketleri** (motor çeyrek skoru üretiyor, UI yok) — kolay fast-follow.
- **Basketbol canlı-izleme ekranı** (şu an "Watch live" gizli; detay yeterli).
- **Preview'de görsel QA yapılamadı** (local RPC 401 auth sorunu) → pickplay.ai'de
  Rasim doğrulamalı. Basketbol artık canlı seed ediliyor, e-Basketball sekmesi dolu.
- Basketbol takımlarına gerçekçi crest **renkleri** (teams.ts) eklenebilir (polish).
