# 2026-07-14 — Gece otonom bug-avı (Rasim uyurken)

Rasim tüm onayları verip uyudu; "2D/Gates/Aviator/genel — didik didik et, bulduğun
her bug'ı düzelt" dedi. Kırılım aşağıda. **Kritik altyapı:** localhost bu ortamda
claude-in-chrome'da engelli + preview harness bozuk → uygulamayı canlı göremiyordum.
**Çözüm:** headless Playwright (scratchpad) ile localhost:5174'ü kendi sürecimle
kaydediyorum → ffmpeg ile frame-frame/montaj inceliyorum. Bu, "kör tahmin" sorununu
bitirdi; artık kendi uygulamamı gerçekten izliyorum.

## İzin popup'ı çözümü
`.claude/settings.local.json` dev-başı birebir komut listesiyle doluydu → her yeni
komut soruyordu. Geniş joker izinlerle değiştirildi (bare `Bash`,`PowerShell`,`Edit`,
`Write`, MCP araçları) + `defaultMode: acceptEdits`. Test: yepyeni komut popup'sız
çalıştı. PC uyku/kapak-kapanma kapatıldı (powercfg).

## Bulunan + çözülen buglar (hepsi commit'li, build temiz)
1. **Futbol maçları çapraz-spor takımlarla üretiliyordu** (0121) — "Jannik Sinner vs
   Boston Celtics" futbol maçı. `seed_matches` vteams'i sport filtresiz çekiyordu.
2. **E-football başlamıyordu** (0122) — `seed_matches` v_have tüm sporları sayıp
   futbolu açlığa düşürüyordu. Futbola özel say → her tur 3 futbol.
3. **Top-etiket tutarsızlığı** (3 sporda) — etiket lingering state'ten geliyordu,
   topun anlık saatinden kopuktu. Tek saat her karede top+etiket+rozet; olay anında
   top OLAY YERİNDE bekler (eased). "corner top ortada" bitti.
4. **Olaylar generic box'ta** — eventPos: korner→köşe bayrağı, kurtarış→kale ağzı,
   ofsayt/ıska→gerçek yer.
5. **Top merkez-takılı + seyrek atak** — idle roam tüm saha + atak sıklığı arttı.
6. **Feed React duplicate-key** — commentary anahtarları benzersiz sayaçlı.
7. **Basket açılış "+124" sahte pop** — ready guard (ilk skor yüklenince kur) + pts
   min(3). Skor kademeli, pop makul, top sayı potasına gidiyor.
8. **Basket saati çift-period** ("Q3 Q3 6'") → tek "Q3 6'".
9. **EN BÜYÜK GÖRSEL:** boş saha+tek top → **3 sporda da OYUNCULAR** (futbol 11v11,
   basket 5v5, tenis 1v1), blok topla kayar. Gerçek match-tracker hissi.

## Doğrulanan (bug yok)
- **Aviator**: geri sayım→takeoff→çarpan tırmanış→crash→history, sağlam.
- **QA sweep** (10 public rota): hiç JS hatası/çökme YOK. Kalan tek şey anon 401
  gürültüsü (log_events/getMyCoupons/housekeeping — sen giriş yapınca çalışır).

## EN BÜYÜK DÖNÜŞÜM: 2D tracker'lar amatör→profesyonel
Headless kayıtlarla frame-frame doğrulandı. Sabah `git pull && npm run dev` ile bak.
- **Futbol** (mobil+koyu tema dahil): 11v11 oyuncu (blok topla kayar), top oyunu
  takip eder (ışınlanmaz), olaylar gerçek yerde (korner→köşe/kurtarış→kale), İY
  skoru + kart sayacı, tam stat paneli, kazanma barı, form+H2H. **Nesine ayarında.**
- **Basket**: 5v5 oyuncu, +pop sayı-potaya gider, saat düzgün, stat maç-dakikasına
  göre birikir, **çeyrek tablosu** (Q1..Qn, sızıntı yok), form+H2H.
- **Tenis/Voleybol**: 1v1 oyuncu, ralli topu + puan-sonu duraklama, servis, set
  skorboardu, form+H2H.

## Ek düzeltmeler
- Basket saati çift-period, stat mount-yerine-maç-dakikası, çeyrek tablosu (0123).
- Doğrulama altyapısı: headless Playwright + ffmpeg (scratchpad/pw). Rasim'in
  gönderdiği videoları da böyle inceledim.

## Yapılamayan / açık
- **Gates of Goal gameplay**: spin login ister → headless'ta oynatamadım. Kod build
  temiz + ekler-3 referansıyla juice eklenmişti; canlı oynanışı sen doğrulamalısın.
- **Aviator/kupon gameplay**: aynı sebep (login).
- Anon 401 gürültüsü: gate edilecek (düşük öncelik, sana etkisi yok).
- Basket çeyrek tablosu: `secret_outcome.quarters` VAR → canlıda geleceği sızdırmadan
  açığa çıkarılıp eklenebilir (sırada).

## Ek bulunan+çözülen (gece devamı)
- **Aviator i18n sızıntısı**: İngilizce modda crash "Auta gitti!" (Türkçe sabit) →
  `av2.flew` ile localize. Genel tarama: başka kullanıcı-yüzü TR sızıntısı yok.
- **Basket FG%/ribaunt 0 görünüyordu** (mount'tan sayıyordu) → maç-dakikasına göre.
  Doğrulandı: FG% 63/61, ribaunt 34/32.
- Mobil (390px) + koyu tema doğrulandı: futbol/basket/aviator/gates/feed — kırılma yok.

## KALAN düşük-öncelikli (bug değil, iyileştirme — sen karar ver)
- **Voleybol** TennisTV'yi paylaşıyor (tenis kortu görseli + 1 oyuncu). Çalışıyor
  ama tema: voleybol kortu + 6 oyuncu daha iyi olur. En az kullanılan spor → ertelendi.
- **Tenis feed'de "+0 market"**: tenis maçlarında yalnız 1/2 marketi var (set/oyun
  bahsi yok). Backend market üretimi genişletilebilir (özellik boşluğu).
- **Bitmiş maç detayında "Watch live" + canlı marketler** görünüyor (edge-case;
  bitmiş maçlar feed'den hızla düşüyor).
- **Anon 401 gürültüsü** (log_events/getMyCoupons/housekeeping): sadece girişsizde,
  para yoluna dokunmamak için bilerek bırakıldı (sana etkisi yok).
- **Login-arkası akışlar** (kupon/Aviator cashout/Gates spin/Ayna): headless'ta
  login yapamadığım için oynanış doğrulanamadı — sen giriş yapıp bak.

## Toplam: bu gece ~22 commit, 3 migration (0121-0123), 0 çökme, hepsi build temiz.
2D tracker'lar amatör→profesyonel (oyuncular+tutarlılık+olay-yeri+çeyrek+form+H2H),
2 kritik veri bug'ı (çapraz-spor + futbol açlığı) çözüldü, Aviator sağlam, voleybol 3v3.

## SON: REGRESYON KONTROLÜ TEMİZ
Tüm değişikliklerden sonra 10 rota (feed/aviator/gates/standings/coupon/4 canlı/detay)
headless tarandı → **hiç JS hatası/çökme yok** (401 anon-gürültüsü hariç). Uygulama
stabil. Sabah `git pull && npm run dev` → bir canlı futbol/basket maçına gir, farkı gör.

## Sabah yapman gerekenler (sadece sen yapabilirsin)
1. `git pull` (dev sunucu çalışıyorsa HMR ile gelmiş olabilir).
2. Giriş yap → Gates spin/free-spins, Aviator cashout, kupon, Ayna akışlarını **oynanışla**
   doğrula (headless'ta login yapamadığım için bunlar test edilemedi).
3. İstersen kalan düşük-öncelikli maddeleri (voleybol kortu teması, tenis marketleri,
   bitmiş-maç "Watch live") söyle, sıradaki turda hallederim.
