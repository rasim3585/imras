import type { MirrorFlag } from '../lib/mirror';

// Deterministik teşhis → Türkçe "ses" (şablonlu, LLM değil). Sayılar backend'de
// üretilir; burada yalnız cümleye dökülür. Kupon + slot + genel kodları.

const pct = (x: number) => `%${Math.round(Number(x) * 100)}`;
const gold = (n: number) => `${Number(n) > 0 ? '+' : ''}${Number(n).toLocaleString('tr-TR')}`;

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
