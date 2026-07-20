# İMRAS.AI — İŞLEVSEL TAP-TEST CHECKLIST (Kalite Katman 3)

*İnsan testerlar (Rasim + arkadaşlar) için. Telefonda + masaüstünde gez, her
maddeyi ✅/❌ işaretle, ❌ olanı ekran görüntüsüyle bildir. Katman 1 (otomatik
testler) motoru; bu checklist "his/görsel/akış"ı yakalar.*

## A) AUTH / GİRİŞ
- [ ] Kayıt ol (yeni e-posta) → kullanıcı adı seç → ana ekran
- [ ] Çıkış → tekrar giriş
- [ ] "Şifremi unuttum" → mail gelsin → linke tıkla → yeni şifre → giriş
- [ ] Google ile giriş
- [ ] Yanlış şifre → anlaşılır Türkçe hata (ham İngilizce DEĞİL)
- [ ] Var olan e-postayla kayıt → "zaten kayıtlı" (sahte doğrulama çıkmazı yok)

## B) BÜLTEN / MAÇLAR
- [ ] Canlı sekmesi doluyor, sayılar tutuyor
- [ ] Futbol/Basket/Tenis/Voleybol sekmeleri maç gösteriyor
- [ ] Gerçek maç grubu (ülke/lig başlıkları) düzgün
- [ ] Bir orana tıkla → sepete düşüyor, oran doğru
- [ ] "+N pazar daha" → maç detayı açılıyor

## C) KUPON (para yolu — en kritik)
- [ ] Oran tıkla → AI Hakem kartı geliyor (%şans + EV)
- [ ] Miktar değiştir → olası kazanç güncelleniyor
- [ ] MOBİLDE: Oyna butonu görünür + tıklanabilir (simülatör altında EZİLMİYOR)
- [ ] "Ask the AI Judge" → senin dilinde kararname (kesilmeden)
- [ ] Kuponu oyna → bakiye düşüyor, "oynandı" onayı
- [ ] Kaydet → Kuponlarım > Kayıtlı sekmesinde
- [ ] Canlı maça bahis → maç bitince kupon settle oluyor (askıda kalmıyor)
- [ ] Cashout (varsa) → makul değer, bakiye artıyor

## D) OYUNLAR
- [ ] Aviator: bahis + otomatik/manuel çekim, crash senkron
- [ ] Mines: oyun ortasında sayfayı yenile → oyun geri geliyor (para kaybı yok)
- [ ] Dice: at, sonuç + bakiye doğru
- [ ] Plinko: at, kova/çarpan/bakiye doğru
- [ ] Gates of Goal: spin, kazanç

## E) ANALİZ / AYNA
- [ ] /analysis 5 sekme açılıyor (Genel/Maç/Aviator/Gates/Diğer)
- [ ] Hakem Karnesi kartı
- [ ] Benchmark (vs oyuncular)
- [ ] Bahis AI sohbeti cevap veriyor

## F) TUTARLILIK
- [ ] Profil "kazanan" sayısı = Kuponlarım'daki kazanan sayısı (birebir)
- [ ] Bakiye her ekranda aynı
- [ ] 8 dil: Arapça seç → sağdan sola + çeviriler (ham İngilizce kalıntı yok)
- [ ] Offline/yavaş: beyaz ekran yok, "meşgul/bağlantı yok" mesajı

## RAPORLAMA
❌ için: hangi ekran + ne yaptın + ne bekledin + ne oldu + ekran görüntüsü.
Ciddi (para/settle) hataları ÖNCE bildir.
