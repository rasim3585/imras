# Devir — 2026-07-16 gecesi: AI Kupon Hakemi v2 + gece vardiyası durumu

## Bağlam
Rasim'in tezi netleşti: **hakem ürünün kalbi** — maç analizi yapan uygulama
çok, kullanıcının KENDİ bahis davranışını bilen yargıç yalnız bizde. "Hepsi
uygulansın" onayı verdi (6 öneriden 5'i; model-tabanlı adil olasılık aylık
Nesine kalibrasyon turuna bilinçli ertelendi). Sonra uyudu; gece vardiyasını
Claude devraldı (bilgisayar uykusu kapatıldı: `powercfg standby-timeout-ac 0`).

## Biten kod (commit'ler: ea12b2c, 8a17369; hepsi main'de, FE Vercel'de)
- **SQL 0148**: `_coupon_judge_extras` — per_leg takım geçmişi, behavior_now,
  loyalty_traps, maturity. UYGULANDI (Rasim) + gerçek veriyle doğrulandı
  (Marseille 1156 bahis/546 tutan/-6246 net; Villarreal trap -110.762).
- **SQL 0149**: judge_verdicts + log_judge_verdict + _judge_scorecard/
  judge_scorecard + judge_confrontations + extras v2.1 (judge_context +
  cross_games) + judge_quota_take (20/gün). Dosya repo'da TAM gövdeli.
- **Edge coupon-judge v2.1**: Sonnet, bacak-başına yorum, hafıza/tilt
  register'ları, kota kontrolü. Dosya repo'da hazır.
- **FE**: otomatik deterministik inceleme (1.2sn debounce), olgunluk bandı,
  bacak altı "⟳ takım: n bahis — w tuttu" çipi, My Coupons "Hakem %9 demişti"
  yüzleşme çipi, Analiz>Genel Hakem Karnesi kartı, aij.limit; i18n 8 dil tam.

## BEKLEYEN 3 UYGULAMA ADIMI (MCP kopuk + Chrome uzantısı kapalı olduğu için)
1. `coupon_review` birleştirmesi (chat'te tam SQL: sona
   `|| public._coupon_judge_extras(v_uid, p_selections, p_stake::int)` eklenmiş
   create-or-replace) — Rasim'in uyguladığı TEYİT EDİLMEDİ.
2. 0149 DO bloğu (repo dosyasından kopyala → SQL Editor).
3. Edge deploy: repo `supabase/functions/coupon-judge/index.ts` → Dashboard →
   Edge Functions → coupon-judge → değiştir → Deploy.
Claude'un kendisi uygulayabilmesi için: Supabase MCP reconnect (yol A) YA DA
Chrome açık + uzantı + supabase.com oturumu (yol B). Rasim'e soruldu.

## Doğrulama planı (adımlar bitince)
- `_judge_scorecard(uid)` + `_coupon_judge_extras` service_role REST testi
  (persona: ce1fbf70-662b-447d-8b1e-922c825d0959 — 10K kuponlu bot hesabı).
- Edge fn testi: service_role bearer ile invoke (verify_jwt geçer, sub yok →
  kota atlanır) + örnek review JSON → Sonnet metninin bacak-başına + davranış
  sayılarıyla konuştuğunu gör.
- Rasim sabah tek elle: oran tıkla → yargıç → oyna → settle çipi + karne.

## Gece sağlık notları
- 0147 sonrası bülten ~600ms stabil (36 örnek, max 752ms).
- USA maçları bitince settle_real_fixture zinciri çalışmalı — sabah kontrol:
  kuponlar settle oldu mu, bülten temiz mi.
- Uyku geri açma: `powercfg /change standby-timeout-ac 30`.

## GECE GÜNCELLEMESİ (01:5x UTC)
- Rasim 4 adımı uyguladı: judge_verdicts + tüm 0149 fonksiyonları CANLI
  (doğrulandı), edge coupon-judge v2 DEPLOY EDİLDİ ve test edildi.
- Canlı yargıç testi (zengin örnek, tr): yeni beyin ÇALIŞIYOR — Marseille
  11/3/-1840 takım geçmişi, Aviator -1200 çapraz tilt, kovalama deseni,
  benzer-kupon karnesi hepsi metinde. İKİ PÜRÜZ: 420 token Türkçede yarıda
  kesti + "siz" dedi → repo'da düzeltildi (640 + 'sen' kuralı, commit 254a5d6).
  SABAH: coupon-judge'ı repo dosyasıyla BİR KEZ redeploy et.
- coupon_review birleştirmesi (ADIM 2) büyük olasılıkla uygulandı ama JWT'siz
  doğrulanamıyor — sabah tap-testinde bacak altı takım çipi görünüyorsa tamam.
- NOT: ce1fbf70 hesabı Rasim'in KENDİ hesabı çıktı (10K test kuponu onda);
  hesabına oturum üretme yolu bilinçli KAPATILDI (çizgi: kimlik doğrulama).
- Bülten 703ms, settle zinciri sağlıklı (Miami 2-0, Lexington 1-4 settle OK).

## GECE VARDİYASI 2. YARI (03:00-06:30 UTC) — "launch cilası" mandası
Rasim tam yetki verdi ("onay sorma, muhteşem bir şey çıkart"). 5 ajanlık keşif
ordusu (546K token) + solo uygulama. Biten işler (hepsi commit+push, Vercel'de):

**Gates of Goal — GoO hizalaması:**
- Sembol seti v3: 5 fasetli mücevher + altın Kupa/Krampon/Eldiven/Düdük +
  ışın taçlı Altın Top scatter. Web-doğrulamalı GoO spec'iyle ödeme tablosu
  BİREBİR çıktı (9 sembol 3 eşik tam eşleşme — rapor: scratchpad/rapor-1.md).
- Banner eşikleri GoO bandına (25x/100x/250x/1000x); callout tutarları sunucu
  adım kazancına ölçekleniyor; FS ×0 rozeti gizli; "Gates of" → "Gates of Goal".
**2D canlı maç:** 22 oyuncu noktası (diziliş+topa çekim+salınım), görünmez
winprob barı fix (kapsam-dışı token), 0-0 bar fix, skorbord dizilim fix.
**Kupon dürüstlüğü:** pending kuponlar 200 limitinden muaf (kaybolamazdı ama
kayboluyordu!); kazanç çipleri NET (+brüt değil); Plinko 0.2x kovada "+20"
yalanı bitti ("−80"); /coupon sayfası CouponPanel kabuğu (kopya slip mantığı +
kapalı-bacak körlüğü silindi); NavBar yanlış-vaat rozeti kaldırıldı.
**Analiz:** "Diğer" sekmesi gerçek oldu (Mines/Dice/Plinko kartları);
ParallelCard Aviator'a taşındı (yanlış atıf); karne boş-durum teaser'ı;
AI sohbet sessionStorage; mirror fetch 30sn memo (4 mükerrer RPC bitti).
**Profesyonellik:** OG paylaşım kartı (og-card.png) + og/twitter meta;
sayfa başına sekme başlığı; anon 401 spam'i kalıcı fix (advance() kaldırıldı);
LiveMatch Infinity% fix; behaviorLog moat sigortası (geri-kuyruk + uyarı);
ölü src/providers/ silindi; lb.sub.day + pr.biggestwin etiketleri dürüst (8 dil).

## SABAH KUYRUĞU (Rasim + SQL/edge erişimi gerektirir)
1. **Edge redeploy**: coupon-judge → repo dosyasıyla (640 token + 'sen' hitabı).
2. **Tap-test**: oran tıkla → sayılar & takım çipi (ADIM 2 kanıtı) → yargıç →
   oyna → settle çipi + Analiz karnesi.
3. **DB sağlığı**: bülten gece 543ms→3-8sn'ye yavaşladı + aralıklı timeout
   (83 gerçek fikstür + muhtemel CPU-kredi tükenmesi). Supabase dashboard →
   Reports → CPU/IO bak; Nano/Micro ise compute upgrade DÜŞÜN (launch şartı).
   Ayrıca anon statement_timeout artışı (8s?) + bülten kickoff penceresi
   daraltma (ör. 36h) SQL adayları.
4. **GoO motor farkları** (bilinçli karar iste): Buy 80x→100x?, scatter ödemesi
   4/5/6=3x/5x/100x?, FS retrigger 3+ = +5?, max-win anında kesme?, FS "yeni
   orb yoksa çarpan uygulanmaz" nüansı — hepsi SQL/simülasyon turu ister.
5. coupon_review won-tanımı hizalama (cashed_out kârlıysa "won" — profil vs
   kuponlarım çelişkisi), Gates buy_cost'u slot_config'ten okuma, dice/mines
   yuvarlama sırası teyidi, match-preview'a gerçek-maç dalı, mirror_luck RPC,
   betting-ai remaining alanı. (Detay: scratchpad/rapor-*.md — 5 keşif raporu.)
