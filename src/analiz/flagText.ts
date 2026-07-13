import type { MirrorFlag } from '../lib/mirror';

// Deterministik teşhis → Türkçe "ses" (şablonlu, LLM değil). Sayılar backend'de
// üretilir; burada yalnız cümleye dökülür. Kupon + slot + genel kodları.

const pct = (x: number) => `%${Math.round(Number(x) * 100)}`;
const gold = (n: number) => `${Number(n) > 0 ? '+' : ''}${Number(n).toLocaleString('tr-TR')}`;

// Her uyarıya somut bir "koç" önerisi (LLM değil — deterministik nudge). İyi/nötr
// bayraklara öneri yok.
export function flagAction(code: string): string | null {
  switch (code) {
    case 'longshot_addict': return 'Sonraki 10 kuponda oranı 3.00 altında tut — tutma ihtimalin katlanır.';
    case 'coupon_bleed': return 'Bacak sayısını azalt: tek maç, düşük oran. Kayıp yavaşlar.';
    case 'buy_impulse': return 'Bonusu satın alma; normal spinle bekle — uzun vadede çok daha ucuz.';
    case 'ante_habit': return 'Ante\'yi kapat: aynı keyif, daha yumuşak varyans.';
    case 'slot_bleed': return 'Bahsi bir kademe düşür; slot uzun vadede kazanamazsın, eğlence için oyna.';
    case 'concentration': return 'Bahsini ürünlere böl — tek kanala %90 yüklemek tek kötü seri demek.';
    case 'worst_is_favorite': return 'En çok kaybettiğin yerde bahsi küçült; kârlı olduğun oyuna kaydır.';
    // aviator kodları (AviatorMirror kendi metnini kullanıyor; hub tutarlılığı için burada da var)
    case 'greed_caught': return 'Otomatik çekişi 1.8x\'e kur; disiplini makineye bırak.';
    case 'low_discipline': return 'Her bahiste auto-cashout koy — anlık dürtüyü devre dışı bırakır.';
    case 'win_illusion': return 'Kazanma oranına değil, nete bak. Küçük kazançlar tabloyu yalıyor.';
    case 'chasing_losses': return 'Kayıptan sonra bahsi ASLA büyütme; aynı tut ya da mola ver.';
    default: return null;
  }
}

export function flagText(f: MirrorFlag): { title: string; body: string } {
  const v = f.value as Record<string, number | string>;
  switch (f.code) {
    // ---- kupon ----
    case 'longshot_addict':
      return { title: 'Yüksek oran bağımlısı', body:
        `Kuponlarının ${pct(Number(v.longshot_rate))}'i 5.00+ oran, medyan oranın ${v.median_odds}. Büyük oran = düşük ihtimal; heyecan yüksek ama tutması zor.` };
    case 'coupon_bleed':
      return { title: 'Kupon kaybı', body:
        `Maç bahislerinde net ${gold(Number(v.net))} gold, kazanma ${pct(Number(v.win_rate))}. Oranları düşürmek (daha az bacak) kaybı yavaşlatır.` };
    case 'safe_player':
      return { title: 'Temkinli oyuncu', body:
        `Medyan oranın ${v.median_odds}, kazanma ${pct(Number(v.win_rate))} ve zararda değilsin. Disiplinli bir bahis profili.` };

    // ---- slot ----
    case 'buy_impulse':
      return { title: 'Bonus satın alma dürtüsü', body:
        `Spinlerinin ${pct(Number(v.buy_rate))}'inde bonusu satın alıyorsun. Beklemek yerine ödeyip atlamak = sabırsızlık; en pahalı slot alışkanlığı.` };
    case 'ante_habit':
      return { title: 'Ante alışkanlığı', body:
        `Spinlerinin ${pct(Number(v.ante_rate))}'i ante'li (%25 fazla bahis). Volatiliteyi artırıyor — kazanç da kayıp da sertleşiyor.` };
    case 'slot_bleed':
      return { title: 'Slot kaybı', body:
        `Gates of Goal'da net ${gold(Number(v.net))} gold (RTP ${v.rtp}). Uzun vadede slot kasanın; bahsi küçük tut.` };
    case 'slot_up':
      return { title: 'Slotta kârdasın', body:
        `Gates of Goal'da net ${gold(Number(v.net))} gold (RTP ${v.rtp}). Şimdilik öndesin — şansın döndüğü yerde durmayı bil.` };

    // ---- genel (çapraz-ürün) ----
    case 'concentration':
      return { title: 'Riski eşit dağıtmıyorsun', body:
        `Tüm bahsinin ${pct(Number(v.share))}'i tek yerde: ${v.product}. Yumurtaların çoğu tek sepette — kötü bir tur seni orada vurur.` };
    case 'worst_is_favorite':
      return { title: 'En çok oynadığın seni en çok üzüyor', body:
        `${v.product} en sık oynadığın oyun (${Number(v.plays).toLocaleString('tr-TR')} kez) ama en çok parayı orada kaybediyorsun (${gold(Number(v.net))}). Sevmek ve kazanmak aynı şey değil.` };
    case 'hidden_winner':
      return { title: 'Gizli kazananın', body:
        `${v.product}'da kârdasın (${gold(Number(v.net))}) ama az oynuyorsun (${Number(v.plays).toLocaleString('tr-TR')} kez). İyi olduğun yere daha çok zaman ayır.` };

    default:
      return { title: f.code, body: '' };
  }
}
