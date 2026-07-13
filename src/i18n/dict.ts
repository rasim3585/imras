// Çok dilli sözlük. İngilizce (en) TEMEL/varsayılan ve tam; Türkçe (tr) tam.
// Diğer 6 dil: navigasyon + Analiz ana etiketleri çevrildi, kalan anahtarlar EN'e
// düşer (t() fallback). LLM koç ayrıca her dilde doğrudan konuşur. Aşamalı
// genişletilebilir — eksik anahtar hiçbir zaman kırılmaz, EN gösterir.

export type Lang = 'en' | 'tr' | 'ar' | 'ru' | 'es' | 'zh' | 'hi' | 'de';

export const LANGS: { code: Lang; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'tr', label: 'Türkçe' },
  { code: 'ar', label: 'العربية' },
  { code: 'ru', label: 'Русский' },
  { code: 'es', label: 'Español' },
  { code: 'zh', label: '中文' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'de', label: 'Deutsch' },
];

type Dict = Record<string, string>;

const en: Dict = {
  'nav.matches': 'Matches',
  'nav.aviator': 'Aviator',
  'nav.gates': 'Gates',
  'nav.coupons': 'Coupons',
  'nav.mirror': 'Mirror',
  'nav.ranks': 'Ranks',
  'nav.social': 'Social',
  'nav.profile': 'Profile',

  'analiz.title': 'Your Mirror',
  'analiz.lead': 'The games are a data-gathering tool; the real value is your pattern. No money — see yourself, safely.',
  'analiz.tab.overview': 'Overall',
  'analiz.tab.coupon': 'Sports bets',
  'analiz.tab.aviator': 'Aviator',
  'analiz.tab.slot': 'Gates of Goal',
  'analiz.tab.other': 'Other',
  'analiz.loading': 'Loading…',
  'analiz.nopattern': 'No clear weakness pattern — you play in a balanced way.',
  'analiz.other': 'Other games appear here as new games launch. Every new game connects to your mirror automatically.',
  'analiz.footer': "This isn't a verdict, it's a mirror. No money — see your pattern safely.",

  'analiz.stat.totalPlays': 'Total plays',
  'analiz.stat.totalNet': 'Total net',
  'analiz.stat.mostPlayed': 'Most played',
  'analiz.stat.winrate': 'Win rate',
  'analiz.stat.net': 'Net',
  'analiz.stat.medianOdds': 'Median odds',
  'analiz.stat.coupons': 'Coupons',
  'analiz.stat.spins': 'Spins',
  'analiz.stat.rtp': 'RTP',
  'analiz.stat.biggest': 'Biggest',

  'analiz.section.products': 'Where you play',
  'analiz.section.mirrorSays': 'Your mirror says',
  'analiz.section.benchmark': 'Versus other players',
  'analiz.section.pop': '{n} players',
  'analiz.prod.sub': '{plays} plays · {share} of your risk',

  'analiz.overview.notready': "For the overall picture you need a bit more play — {have}/{need} games. It sharpens as you play.",
  'analiz.coupon.notready': 'The sports-bets analysis needs a few more coupons — {have}/{need}.',
  'analiz.slot.notready': 'The Gates of Goal analysis needs a few more spins — {have}/{need}.',

  'analiz.coach.header': 'Your coach',
  'analiz.coach.loading': 'Reading your pattern…',

  'bench.axis.discipline': 'Discipline',
  'bench.axis.risk': 'Risk appetite',
  'bench.axis.coupon_roi': 'Coupon return',
  'bench.you': 'You',
  'bench.avg': 'Avg',
  'bench.note.low_good': "You're more disciplined than {p} of players.",
  'bench.note.high_good': "Your return beats {p} of players.",
  'bench.note.neutral': "You bet higher odds than {p} of players.",

  'product.coupon': 'Sports bets',
  'product.aviator': 'Aviator',
  'product.slot': 'Gates of Goal',

  'rc.title': 'Reality check',
  'rc.burn_rate': 'At this rate, your balance runs out in about {days} days. Worth slowing down.',
  'rc.long_session': "You've been playing {hours}h today ({plays} rounds). Step away for a bit.",
  'rc.high_risk': "High-risk zone: you've wiped out a big share of your balance this week. This is where losses snowball.",

  'lang.label': 'Language',
};

const tr: Dict = {
  'nav.matches': 'Maçlar',
  'nav.aviator': 'Aviator',
  'nav.gates': 'Gates',
  'nav.coupons': 'Kuponlar',
  'nav.mirror': 'Aynam',
  'nav.ranks': 'Sıralama',
  'nav.social': 'Sosyal',
  'nav.profile': 'Profil',

  'analiz.title': 'Aynam',
  'analiz.lead': 'Oyunlar bir veri toplama aracı; asıl değer senin desenin. Para yok — kendini zararsız gör.',
  'analiz.tab.overview': 'Genel',
  'analiz.tab.coupon': 'Maç bahisleri',
  'analiz.tab.aviator': 'Aviator',
  'analiz.tab.slot': 'Gates of Goal',
  'analiz.tab.other': 'Diğer',
  'analiz.loading': 'Yükleniyor…',
  'analiz.nopattern': 'Belirgin bir zaaf deseni yok — dengeli oynuyorsun.',
  'analiz.other': 'Diğer oyunlar (yeni oyunlar eklendikçe) buraya gelecek. Her yeni oyun aynana otomatik bağlanır.',
  'analiz.footer': 'Bu bir yargı değil, bir ayna. Para yok — desenini zararsız gör.',

  'analiz.stat.totalPlays': 'Toplam oyun',
  'analiz.stat.totalNet': 'Toplam net',
  'analiz.stat.mostPlayed': 'En çok',
  'analiz.stat.winrate': 'Kazanma',
  'analiz.stat.net': 'Net',
  'analiz.stat.medianOdds': 'Medyan oran',
  'analiz.stat.coupons': 'Kupon',
  'analiz.stat.spins': 'Spin',
  'analiz.stat.rtp': 'RTP',
  'analiz.stat.biggest': 'En büyük',

  'analiz.section.products': 'Ürün dağılımın',
  'analiz.section.mirrorSays': 'Aynan diyor ki',
  'analiz.section.benchmark': 'Diğer oyunculara göre',
  'analiz.section.pop': '{n} oyuncu',
  'analiz.prod.sub': '{plays} oyun · riskin {share}',

  'analiz.overview.notready': 'Genel tablo için biraz daha veri gerekiyor — {have}/{need} oyun. Oynadıkça netleşir.',
  'analiz.coupon.notready': 'Maç bahisleri analizi için biraz daha kupon gerekiyor — {have}/{need}.',
  'analiz.slot.notready': 'Gates of Goal analizi için biraz daha spin gerekiyor — {have}/{need}.',

  'analiz.coach.header': 'Koçun',
  'analiz.coach.loading': 'Desenini okuyor…',

  'bench.axis.discipline': 'Disiplin',
  'bench.axis.risk': 'Risk iştahı',
  'bench.axis.coupon_roi': 'Kupon getirisi',
  'bench.you': 'Sen',
  'bench.avg': 'Ort.',
  'bench.note.low_good': 'Oyuncuların {p} kadarından daha disiplinlisin.',
  'bench.note.high_good': "Getirin oyuncuların {p}'inden daha iyi.",
  'bench.note.neutral': "Oyuncuların {p}'inden daha yüksek oran oynuyorsun.",

  'product.coupon': 'Maç bahisleri',
  'product.aviator': 'Aviator',
  'product.slot': 'Gates of Goal',

  'rc.title': 'Gerçeklik kontrolü',
  'rc.burn_rate': 'Bu hızla bakiyen yaklaşık {days} gün sonra biter. Yavaşlamakta fayda var.',
  'rc.long_session': 'Bugün {hours} saattir oynuyorsun ({plays} el). Biraz ara ver.',
  'rc.high_risk': 'Yüksek riskli bölge: bu hafta bakiyenin büyük bir kısmını sildin. Kayıplar tam da burada çığ gibi büyür.',

  'lang.label': 'Dil',
};

// Diğer diller: navigasyon + Analiz ana başlıkları. Kalan anahtarlar EN'e düşer.
const es: Dict = {
  'nav.matches': 'Partidos', 'nav.coupons': 'Cupones', 'nav.mirror': 'Mi espejo',
  'nav.ranks': 'Ranking', 'nav.social': 'Social', 'nav.profile': 'Perfil',
  'analiz.title': 'Tu espejo', 'analiz.tab.overview': 'General', 'analiz.tab.coupon': 'Apuestas',
  'analiz.tab.other': 'Otros', 'analiz.coach.header': 'Tu entrenador', 'analiz.coach.loading': 'Leyendo tu patrón…',
  'analiz.section.products': 'Dónde juegas', 'analiz.section.mirrorSays': 'Tu espejo dice',
  'analiz.section.benchmark': 'Frente a otros jugadores', 'lang.label': 'Idioma', 'product.coupon': 'Apuestas',
};
const de: Dict = {
  'nav.matches': 'Spiele', 'nav.coupons': 'Scheine', 'nav.mirror': 'Mein Spiegel',
  'nav.ranks': 'Ränge', 'nav.social': 'Sozial', 'nav.profile': 'Profil',
  'analiz.title': 'Dein Spiegel', 'analiz.tab.overview': 'Gesamt', 'analiz.tab.coupon': 'Sportwetten',
  'analiz.tab.other': 'Andere', 'analiz.coach.header': 'Dein Coach', 'analiz.coach.loading': 'Liest dein Muster…',
  'analiz.section.products': 'Wo du spielst', 'analiz.section.mirrorSays': 'Dein Spiegel sagt',
  'analiz.section.benchmark': 'Im Vergleich zu anderen', 'lang.label': 'Sprache', 'product.coupon': 'Sportwetten',
};
const ru: Dict = {
  'nav.matches': 'Матчи', 'nav.coupons': 'Купоны', 'nav.mirror': 'Зеркало',
  'nav.ranks': 'Рейтинг', 'nav.social': 'Соцсеть', 'nav.profile': 'Профиль',
  'analiz.title': 'Твоё зеркало', 'analiz.tab.overview': 'Общее', 'analiz.tab.coupon': 'Ставки',
  'analiz.tab.other': 'Другое', 'analiz.coach.header': 'Твой тренер', 'analiz.coach.loading': 'Читаю твой паттерн…',
  'analiz.section.products': 'Где ты играешь', 'analiz.section.mirrorSays': 'Твоё зеркало говорит',
  'analiz.section.benchmark': 'В сравнении с другими', 'lang.label': 'Язык', 'product.coupon': 'Ставки',
};
const ar: Dict = {
  'nav.matches': 'المباريات', 'nav.coupons': 'القسائم', 'nav.mirror': 'مرآتي',
  'nav.ranks': 'الترتيب', 'nav.social': 'اجتماعي', 'nav.profile': 'الملف',
  'analiz.title': 'مرآتك', 'analiz.tab.overview': 'عام', 'analiz.tab.coupon': 'الرهانات',
  'analiz.tab.other': 'أخرى', 'analiz.coach.header': 'مدربك', 'analiz.coach.loading': 'يقرأ نمطك…',
  'analiz.section.products': 'أين تلعب', 'analiz.section.mirrorSays': 'مرآتك تقول',
  'analiz.section.benchmark': 'مقابل اللاعبين الآخرين', 'lang.label': 'اللغة', 'product.coupon': 'الرهانات',
};
const zh: Dict = {
  'nav.matches': '比赛', 'nav.coupons': '投注单', 'nav.mirror': '我的镜子',
  'nav.ranks': '排名', 'nav.social': '社交', 'nav.profile': '个人',
  'analiz.title': '你的镜子', 'analiz.tab.overview': '总览', 'analiz.tab.coupon': '体育投注',
  'analiz.tab.other': '其他', 'analiz.coach.header': '你的教练', 'analiz.coach.loading': '正在读取你的模式…',
  'analiz.section.products': '你在哪里玩', 'analiz.section.mirrorSays': '你的镜子说',
  'analiz.section.benchmark': '与其他玩家相比', 'lang.label': '语言', 'product.coupon': '体育投注',
};
const hi: Dict = {
  'nav.matches': 'मैच', 'nav.coupons': 'कूपन', 'nav.mirror': 'मेरा आईना',
  'nav.ranks': 'रैंक', 'nav.social': 'सोशल', 'nav.profile': 'प्रोफ़ाइल',
  'analiz.title': 'आपका आईना', 'analiz.tab.overview': 'कुल', 'analiz.tab.coupon': 'खेल दांव',
  'analiz.tab.other': 'अन्य', 'analiz.coach.header': 'आपका कोच', 'analiz.coach.loading': 'आपका पैटर्न पढ़ रहा है…',
  'analiz.section.products': 'आप कहाँ खेलते हैं', 'analiz.section.mirrorSays': 'आपका आईना कहता है',
  'analiz.section.benchmark': 'अन्य खिलाड़ियों की तुलना में', 'lang.label': 'भाषा', 'product.coupon': 'खेल दांव',
};

export const dict: Record<Lang, Dict> = { en, tr, ar, ru, es, zh, hi, de };
