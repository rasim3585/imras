# SQL KUYRUĞU — durum (2026-07-16 sabah oturumu TAMAMLANDI)

## ✅ UYGULANDI + CANLIDA DOĞRULANDI (2026-07-16 sabahı, Rasim yapıştırdı)
- **B** coupon_stats() + anon revoke → FE geçti (getCouponStats artık RPC;
  anon 42501, service_role OK ölçüldü). "Kazanan" tanımı tek kaynak.
- **B2/0150** set_username player_XXXXXXXX reddi.
- **B3/0151** mines_active() (+ authenticated grant) → null/42501 doğrulandı;
  FE resume zaten canlıdaydı, artık aktif. mines_start'ın ikinci oyunu
  reddettiği gövdeden doğrulandı ('aktif oyun var') — para yanmıyor.
- **C/0152** _vb_state/_tn_state hayalet-set fix + pace, get_live_state
  passthrough → canlıda ölçüldü: tenis pace 36.92 (480/13 ✓), voleybol 3.31
  (480/145 ✓). FE pace kablolaması (tennisSim setPace + bütçe ölçeği,
  LiveCourtScreen/MiniWatch besleme) push'landı.
- Mines gövdeleri (start/reveal/cashout) base64 arşivde: scratchpad/govde/.

## ⏳ A) PRO+SMALL SONRASI — cron'ları eski tempoya döndür (TEK KALAN ZORUNLU)
Upgrade: Settings→Billing→Pro, sonra Settings→Compute and Disk→Small
(kısa restart yapar). Ardından tek tek:
```sql
select cron.alter_job(jobid, schedule => '1 seconds') from cron.job where jobname = 'pickplay_live';
```
```sql
select cron.alter_job(jobid, schedule => '30 seconds') from cron.job where jobname = 'pickplay_tick';
```

## 🅿️ PARK — GoO motor farkları (karar: launch için DOKUNULMUYOR)
Gövdeler çözüldü (scratchpad/govde/): scatter'ın kendi ödemesi yok (GoO
4/5/6→3x/5x/100x), Buy 80x (GoO 100x), FS birikmiş çarpan her kazanca
uygulanıyor (GoO'da yalnız yeni küre düşen seride), max-win turu erken
kesmiyor. Görünen yüzey birebir; RTP %95.4 ölçülü. Değişiklik = para motoru
= önce 500K spin simülasyonu. Launch sonrası istenirse tur açılır.

## D) SONRAKİ SEANS (edge+SQL özellikleri — ayrı iş)
- match-preview'a GERÇEK maç dalı (ana bahis yüzeyi AI'sız kalmasın)
- mirror_luck RPC (Mines derinlik / Dice beyan-edilmiş risk / Plinko risk dağılımı)
- betting-ai cevabına `remaining` (günlük hak sayacı FE'de görünsün)
- mirror_coupon derinleştirme (oran-bandı histogramı, canlı/öncesi ayrımı, takım tuzakları aynaya)
- dice_roll chance clamp canlı testi (FE slider 2-95; RPC sınırı ölçülmedi)
