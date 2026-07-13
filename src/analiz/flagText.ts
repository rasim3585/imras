import type { MirrorFlag } from '../lib/mirror';

// Deterministik teşhis → yerelleştirilmiş metin. Sayılar backend'de üretilir; burada
// yalnız değişkenler hazırlanıp i18n şablonuna verilir. Metinler dict'te (flag.<code>.*).

type TFn = (k: string, v?: Record<string, string | number>) => string;

const pctv = (x: unknown) => `%${Math.round(Number(x) * 100)}`;
const goldv = (n: unknown) => `${Number(n) > 0 ? '+' : ''}${Number(n).toLocaleString()}`;

// Her bayrak kodu için şablon değişkenleri (backend value'sundan türetilir).
const VARS: Record<string, (v: Record<string, number | string>) => Record<string, string | number>> = {
  greed_caught: (v) => ({ caught: pctv(v.caught_rate) }),
  low_discipline: (v) => ({ auto: pctv(v.auto_rate) }),
  win_illusion: (v) => ({ win: pctv(v.win_rate), net: goldv(v.net) }),
  chasing_losses: (v) => ({ loss: String(v.loss_ratio), win: String(v.win_ratio) }),
  disciplined: (v) => ({ auto: pctv(v.auto_rate) }),
  trend_worse: (v) => ({ recent: pctv(v.recent_caught), overall: pctv(v.overall_caught) }),
  trend_better: (v) => ({ recent: pctv(v.recent_caught), overall: pctv(v.overall_caught) }),
  longshot_addict: (v) => ({ longshot: pctv(v.longshot_rate), median: String(v.median_odds) }),
  coupon_bleed: (v) => ({ net: goldv(v.net), win: pctv(v.win_rate) }),
  safe_player: (v) => ({ median: String(v.median_odds), win: pctv(v.win_rate) }),
  buy_impulse: (v) => ({ buy: pctv(v.buy_rate) }),
  ante_habit: (v) => ({ ante: pctv(v.ante_rate) }),
  slot_bleed: (v) => ({ net: goldv(v.net), rtp: String(v.rtp) }),
  slot_up: (v) => ({ net: goldv(v.net), rtp: String(v.rtp) }),
  concentration: (v) => ({ product: String(v.product), share: pctv(v.share) }),
  worst_is_favorite: (v) => ({ product: String(v.product), plays: Number(v.plays).toLocaleString(), net: goldv(v.net) }),
  hidden_winner: (v) => ({ product: String(v.product), net: goldv(v.net), plays: Number(v.plays).toLocaleString() }),
};

// Somut "koç" önerisi olan (uyarı) kodları.
const HAS_ACTION = new Set([
  'longshot_addict', 'coupon_bleed', 'buy_impulse', 'ante_habit', 'slot_bleed',
  'concentration', 'worst_is_favorite',
  'greed_caught', 'low_discipline', 'win_illusion', 'chasing_losses',
]);

export function flagContent(f: MirrorFlag, t: TFn): { title: string; body: string; action: string | null } {
  const vars = VARS[f.code] ? VARS[f.code](f.value) : {};
  return {
    title: t(`flag.${f.code}.title`),
    body: t(`flag.${f.code}.body`, vars),
    action: f.level === 'warn' && HAS_ACTION.has(f.code) ? t(`flag.${f.code}.action`, vars) : null,
  };
}
