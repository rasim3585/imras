# 2026-07-14 (akşam) — Canlı 2D: tek saat + aksiyon tutuşu (4 spor)

## Ne yapıldı
- **Kök neden bulundu (futbol):** `getClock` her poll'de sunucunun tam-sayı
  dakikasına yeniden çıpalanıyordu → testere dişi (±25 sim-sn/2sn) → top/rozet
  titriyor, tutuşlar kırpılıyordu. Ayrıca pas yolu son olayda (82'-87') bitiyor,
  top kalan süreyi son noktada donarak geçiriyordu ("penaltı noktasında kaldı").
- **Çözüm (tüm sporlar aynı desen):** tek monoton saat (bir kez çıpala, >90
  sim-sn kaymada düzelt) + olay tutuşu holdSec = 2.2 gerçek-sn × sıkıştırma +
  yol maç sonuna kadar + FT'de top ortada. Top, rozet, feed, istatistik tek
  olay listesinden, tek saatten.
- **Basket:** courtSim yeniden yazıldı (2880 sim-sn maç saati, miss/steal/foul/
  block tutuşları, server basketi potada 2.2sn, courtStats/courtFeed aynı liste).
- **Tenis/voley:** tennisSim yeniden yazıldı (set başına tek ralli listesi +
  paylaşılan set saati `setClockSec`; as/winner/error topu öldüğü yerde 2.2sn
  tutar, merdiven+feed aynı anda ticklar). Başlıkta çift merdiven çelişkisi
  kaldırıldı (yalnız "Set N" + ralli-kilitli merdiven).
- **Review bulguları düzeltildi:** Shots 0-0, maç geçişinde eski state, aynı
  dakika 2 gol key çakışması, katılımda gol draması, MiniWatch ayrı-saat/ayrı-
  feed → ana sim'e bağlandı. `liveSim.ts` + `atmosphereScript` silindi.

## Doğrulama
Headless Playwright poll (scratchpad/pw/sync2.mjs + courtsync.mjs, 430ms):
futbol korner/faul/save tutuş+rozet+feed kilitli; FT testi 85'→89' top oyunda,
FT'de ortaya; basket miss=çember/block tutuşları + +2/+3 potada; tenis as →
servis kutusunda ölü + (15-0) + feed aynı anda; voley senkron. Sayısal (esbuild):
futbol 80 maç, basket 30 maç, tenis/voley 10'ar — kapsama tam, donma yok,
merdiven monoton.

## Commit'ler
55e3e4e (top yolu 90'a + FT orta + gol dizisi), dd14179 (review bulguları),
adb11fe (basket+tenis+voley tek-saat mimarisi).

## Açık
- Görsel zenginlik cilası (asset/oyuncu figürü, gol koreografisi) — ayrı tur.
- Rasim'in gözle QA'sı: futbol hız/his onayı + 4 sporun yeni hali.
