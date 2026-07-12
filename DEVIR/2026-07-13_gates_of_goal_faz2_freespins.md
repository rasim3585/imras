# DEVIR — 2026-07-13 · Gates of Goal Faz 2 (free spins + ante + buy)

## Ne yapıldı

Gates of Goal (orijinal, futbol temalı tumble slot) ikinci faz: **scatter →
free spins (biriken çarpan)**, **ante bet** ve **buy bonus** eklendi. Mekanik
jenerik (telif değil); isim/tema/semboller/görsel bize ait. Gates of Olympus'un
karakteri/gem'leri/ismi HİÇBİR yerde kullanılmadı.

### Backend — migration 0089_slot_freespins.sql (uygulandı + commit)
- **Scatter = sembol 9**: ödemez, tumble'da patlamaz, yerinde kalır. `_slot_cell`
  tek random ile tip seçer: `typ < sthr` scatter, `< sthr+mthr` çarpan orb, else
  normal sembol.
- **`_slot_round(bet, seed, ante, buy)`**: round mantığının TEK saf kaynağı
  (hem `slot_spin` RPC hem RTP simülasyonu bunu çağırır). Base spin + 4+ scatter
  (veya buy) → free spins döngüsü. `total_mult` tüm free spinlerdeki orb'ları
  BİRİKTİRİR; her turun kazancı `base_win × greatest(total_mult,1)`. 3+ scatter
  retrigger (+5 tur).
- **`slot_spin(bet, ante, buy)`**: eski 2-arg sürüm drop edildi. Stake: buy →
  `bet×buy_cost`, ante → `round(bet×1.25)`, normal → `bet`.
- **slot_config yeni kolonlar** (canlı + dosya defaultları eşit):
  `base_scatter=0.013`, `ante_scatter=0.018`, `free_spins=12`, `buy_cost=60`.

### RTP kalibrasyonu (SQL simülasyon, `_slot_round` üzerinden)
- **Non-ante full-round: ~%95.2** (bonus tetik ~%0.32, ort. ~12.6 free spin). Hedefte.
- **Ante: ~%85–90** — bilerek GÜVENLİ tarafta (<100). Ölçüm bonus-baskın olduğu
  için çok gürültülü: ante_scatter 0.018→%85, 0.019→%119, 0.020→%127 (aynı param
  büyük sıçrama = varyans). Yapısal analiz: ante nötr için bonus ~%0.64 gerekir
  ama ante free-spins İÇİ scatter de yüksek → retrigger uzuyor → bonus başına
  ödeme artıyor → hedef ~%0.5 → **ante_scatter=0.018**. Symbolic parada isteğe
  bağlı ante'nin hafif cimri (< non-ante) olması sömürüye karşı doğru taraf.
- **Buy: ~%94** — bought-bonus ort. kazanç **56.45×** (SD 46, SE ±1). %95 için
  `buy_cost = 56.45/0.95 ≈ 59.4 → 60`. Buy stake = bet×60.

### Frontend (commit)
- **types.ts**: `SlotResult` yeni şekle geçti — `base{steps,base_win,mult_sum,
  scatters,payout}` + `bonus{triggered,count,spins[],win,total_mult}` + `payout`,
  `balance`, `buy`. `SlotBase`, `SlotBonus`, `SlotBonusSpin` eklendi.
- **matchProvider + supabaseMatchProvider**: `slotSpin(bet, ante, buy)` → RPC'ye
  `p_buy` geçiyor.
- **symbols.tsx**: `ScatterBall` (altın "GOAL" kapı topu, v=9) eklendi;
  `SlotSymbol` v===9'u işler. (Ayrıca React 19 `JSX.Element`→`ReactNode` fix.)
- **GatesScreen.tsx**: `animate()` base→bonus akışına yeniden yazıldı. Ortak
  `playSteps()` step-animatörü. Free-spins overlay: "FREE SPINS i/n", büyük
  biriken `×total_mult`, biriken bonus kazancı. "GATE OPEN" intro banner. **Buy
  Free Spins** butonu (session'da görünür, `bet×60`). Ante etiketi "2× bonus
  chance".
- **index.css**: `.slot-scatter`, `.gates-fs*` (mor bonus board tint dahil),
  `.gates-buy`.

### Doğrulama
- `tsc --noEmit` temiz.
- Preview (Vite 5174'e bağlandı, 5173 doluydu): /gates render OK — 30 hücre/
  sembol, ante etiketi güncel, giriş yoksa "Log in to play" + buy gizli. Konsol
  hatasız. (Free-spins animasyonu authed canlı spin gerektirdiği için headless
  test edilemedi; kod typecheck-temiz + mantık düz.)

## Açık konular
- Free-spins ve buy akışının GÖRSEL akışı gerçek oturumda Rasim'le izlenmeli
  (özellikle uzun bonuslarda tempo).
- İnce RTP kalibrasyonu (Faz 3): ante/buy daha büyük örneklemle (>50k) doğrulanmalı.
- **Faz 3 — davranış alanları**: `slot_spins`'te chase/greed sinyalleri (buy
  sıklığı, ante ısrarı, bonus sonrası bet artışı) → oyun-bağımsız ayna motoruna.
