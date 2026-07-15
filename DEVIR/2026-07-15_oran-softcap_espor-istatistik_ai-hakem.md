# Devir — 2026-07-15: soft-cap 27.68 + hayalet maç + e-spor istatistik + AI hakem/önizleme

## Sim kuralları (önceki oturumun devamı, ayrı commit'ler)
- Tenis/voleybol oyuncu karakterleri kaldırıldı (yalnız top). Voleybol gerçek
  kural: servis+manşet/pas/SMAÇ, set 25 (5. set 15, 2 fark); tenis 6 oyun/deuce.
- Tempo garantisi: sim seti sunucu penceresinden ERKEN bitirir (vb 2.0 sn/sayı,
  tn 13 sn/oyun bütçe sıkıştırması); canlı 2000 maçta en kötü sunucu 2.03 sn/sayı.
- Basket +2/+3 pop artık top potaya varınca (880ms). Ceza yayı (D) yerine oturdu.

## 0136 — oran tavanı 27.68 + soft-cap
- `_soft_cap(r)`: r≤20 birebir; üstü C−(C−20)/(1+(r−20)/(C−20)), C=27.68.
- Tek dokunuş: `_max_sellable_odds`, `_odds_line`, `_price`, `_make_display_odds`.
- Tavanda eşitlenme bitti: 0-2 85'te beraberlik 26.35 ≠ galibiyet 27.60.
- `_comeback_floor`/`_chase_boost` OLASILIK hesaplar → dokunulmadı; 85' 20
  düzlüğü meğer clamp'in emergent etkisiymiş, şimdi 88'de 27.21'e tırmanıyor.

## 0137 — "starting now" hayaleti
- Kök: BSD feed'den event almadan düşen fikstürler sonsuza dek notstarted;
  get_bulletin pencere kontrolü yapmıyordu; grup gün etiketi en eski maçtan.
- Fix: get_bulletin'e kickoff > now()-3h; reaper'a notstarted→cancelled+VOID
  dalı (settle_real_fixture'ın mevcut void yolu). 5 çürük fikstür temizlendi.
- FE: formatKickoff 'starting now' yalnız ±10dk; dayLabel geçmiş≠Today.

## 0138 — e-spor Nesine düzeyi istatistik
- `vleague_standings_ex`: futbol 3G+1B | basket W-L+PCT | voleybol VNL puanı
  (3-0/3-1→3, 3-2→2, 2-3→1) + set oranı | tenis ATP-race; form(5)+seri.
- `vteam_page` (sıra+form10+son 15 maç set/çeyrek detayıyla+fikstür),
  `vteam_h2h`, `_finished_detail` (yalnız finished secret_outcome okur).
- FE: /team/:id TeamScreen; StandingsScreen spor-doğru kolonlar+form+tıklanır;
  MatchStatsPanel takım linkleri + H2H "25-18 17-25 25-21 25-18" detayları.
- Parsiyel indeksler (ölçüm: 15857 satır seq scan → 119).

## 0139 — AI Kupon Hakemi + AI Maç Önizleme (uygulandı)
- `coupon_review` RPC: adil olasılık, parlay EV=1.06^-n−1, en riskli bacak,
  benzer-bacak karnesi, mirror bayrakları. Edge: coupon-judge, match-preview
  (haiku, mirror-coach kalıbı; mac+dil başına cache → maliyet O(maç)).
- FE: CouponPanel "AI hakeme sor" (deterministik sayılar HEP görünür, LLM
  metni varsa eklenir); MatchDetail AI Önizleme kartı (login + upcoming).
- GEREKLİ: `ANTHROPIC_API_KEY` Supabase secret (mirror-coach ile ortak).

## Bekleyen AI önerileri (Rasim seçecek)
1. Haftalık Ayna Mektubu (pg_cron + snapshot + mektup)
2. Aynanla Konuş (çok turlu koç sohbeti, günlük limit)
3. Tilt Bekçisi (kayıp sonrası 2x+ stake anında tek cümle nudge)
4. Karar Tekrarı Spikeri (mirror_aviator_moment anlatıcısı)

## Doğrulamalar
- Bülten headless: 0 "starting now"; standings vb kolonları Pts=VNL (Poland
  289p 337:180), tenis Win% kolonu; /team/301 16 maç + set detayı; 0 JS hatası.
- coupon_review canlı test (yoğun kullanıcı): 3 bacak → %7.46, EV −16%,
  benzer 3314/336 net −32,527.

## Ek (ayni gun, 2. tur): Bahis AI sohbeti + Nesine Temmuz kalibrasyon turu
- ANTHROPIC_API_KEY ZATEN CALISIYOR (mirror_coach_cache'te LLM metni var,
  2026-07-14). Secret proje geneli — yeni fn'ler otomatik kullanir.
- "Bahis AI'inla Konus" CANLI: betting-ai edge fn + ai_chat_usage (0143) +
  AnalizScreen karti. Ilke: yalniz deterministik paket, tahmin/oran yok,
  30 mesaj/gun.
- NESINE KALIBRASYON (Temmuz turu, canli olcum):
  F.Dusseldorf 1-0 Ruzomberok (guclu ev):
  * 80': Nesine X 5.07 / MS2 17.00 / MS1 kapali — biz X 5.43-6.04 / MS2 ~25.8 / MS1 1.12-1.18
  * 82': Nesine X 5.30 (yukseliyor) — biz 5.87 (ayni yon, ayni bant) ✓
  SONUC: beraberlik bandi ve MS1-kapama davranisi kitapla uyumlu. TEK fark:
  zayif taraf longshot'inda kitap ~17'de DONDURUYOR (longshot bias/limit
  yonetimi), biz ~26 (matematiksel adil). n=1 -> motor AYARLANMADI (kural:
  olcmeden dokunma). Gelecek ay: 3+ longshot noktasi topla; desen dogrulanirsa
  _odds_line'a longshot-golgeleme egrisi dusun (raw>10 bolgesi).
