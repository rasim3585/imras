import { useEffect, useState } from 'react';
import {
  fetchAviatorMirror, fetchAviatorMoment,
  type MirrorProfile, type MirrorBucket, type MirrorMoment,
} from '../lib/aviator';
import { CoinIcon } from '../components/icons';
import { useI18n } from '../i18n/LanguageContext';
import { flagContent } from '../analiz/flagText';

// DAVRANIŞ AYNASI — Aviator yüzeyi. Kullanıcının KENDİ Aviator verisinden çıkan
// deterministik teşhis (mirror_aviator RPC). Sayılar backend'de üretilir; metin
// i18n ile yerelleştirilir. Teşhis = hook: kullanıcı kendi desenini para kaybetmeden görür.

const pct = (x: number) => `%${Math.round(x * 100)}`;
const gold = (n: number) => `${n > 0 ? '+' : ''}${n.toLocaleString()}`;

type TFn = (k: string, v?: Record<string, string | number>) => string;

function TrendChart({ series, t }: { series: MirrorBucket[]; t: TFn }) {
  if (series.length < 2) return null;
  const delta = series[series.length - 1].caught_rate - series[0].caught_rate;
  const dir = delta > 0.08 ? 'worse' : delta < -0.08 ? 'better' : 'flat';
  return (
    <div className="av-mirror-trend">
      <div className="av-mirror-trend-head">
        <span className="k">{t('av.trend.title')}</span>
        <span className={`av-mirror-trend-dir ${dir}`}>{t('av.trend.' + dir)}</span>
      </div>
      <div className="av-mirror-bars">
        {series.map((b) => {
          const h = Math.max(6, Math.round(b.caught_rate * 100));
          const cls = b.caught_rate >= 0.55 ? 'hi' : b.caught_rate >= 0.4 ? 'mid' : 'lo';
          return (
            <div key={b.i} className="av-mirror-bar-wrap" title={t('av.bar.title', { rounds: b.rounds, caught: pct(b.caught_rate) })}>
              <div className={`av-mirror-bar ${cls}`} style={{ height: `${h}%` }} />
            </div>
          );
        })}
      </div>
      <div className="av-mirror-trend-axis"><span>{t('av.trend.first')}</span><span>{t('av.trend.last')}</span></div>
    </div>
  );
}

function ReplayMoment({ m, t }: { m: MirrorMoment; t: TFn }) {
  if (m.kind !== 'greed_loss') return null;
  const auto = m.had_auto ? t('av.replay.auto', { target: String(m.auto_target) }) : t('av.replay.noauto');
  return (
    <div className="av-mirror-replay">
      <div className="av-mirror-replay-h">🎞️ {t('av.replay.title')}</div>
      <p>{t('av.replay.body', {
        stake: m.stake.toLocaleString(), auto,
        crash: Number(m.crash_point).toFixed(2),
        missed: Number(m.missed_gain).toLocaleString(),
      })}</p>
    </div>
  );
}

export default function AviatorMirror() {
  const { t } = useI18n();
  const [data, setData] = useState<MirrorProfile | null>(null);
  const [moment, setMoment] = useState<MirrorMoment | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchAviatorMirror().then((d) => { if (alive) setData(d); }).catch(() => { if (alive) setErr(true); });
    fetchAviatorMoment().then((m) => { if (alive) setMoment(m); }).catch(() => { /* replay opsiyonel */ });
    return () => { alive = false; };
  }, []);

  if (err || !data) return null;
  if (!data.ready) {
    return (
      <div className="av-mirror av-mirror-wait">
        <h3 className="av-mirror-h">🪞 {t('analiz.title')}</h3>
        <p className="av-mirror-sub">{t('av.wait', { have: data.rounds ?? 0, need: data.need ?? 10 })}</p>
      </div>
    );
  }

  const warns = data.flags.filter((f) => f.level === 'warn');
  const goods = data.flags.filter((f) => f.level === 'good');
  const netCls = data.net >= 0 ? 'pos' : 'neg';

  return (
    <div className="av-mirror">
      <h3 className="av-mirror-h">🪞 {t('analiz.title')} <span className="av-mirror-n">{t('av.rounds', { n: data.rounds })}</span></h3>

      <div className="av-mirror-stats">
        <div><span className="k">{t('analiz.stat.winrate')}</span><b>{pct(data.win_rate)}</b></div>
        <div><span className="k">{t('analiz.stat.net')}</span><b className={netCls}><CoinIcon size={12} /> {gold(data.net)}</b></div>
        <div><span className="k">{t('av.stat.medianCashout')}</span><b>{data.median_cashout}x</b></div>
        <div><span className="k">{t('av.stat.caught')}</span><b>{pct(data.caught_rate)}</b></div>
      </div>

      {data.series.length >= 2 && <TrendChart series={data.series} t={t} />}

      {data.flags.length === 0 ? (
        <p className="av-mirror-sub">{t('analiz.nopattern')}</p>
      ) : (
        <ul className="av-mirror-flags">
          {[...warns, ...goods].map((f) => {
            const c = flagContent(f, t);
            return (
              <li key={f.code} className={`av-mirror-flag ${f.level}`}>
                <span className="av-mirror-dot" aria-hidden />
                <div><b>{c.title}</b><p>{c.body}</p></div>
              </li>
            );
          })}
        </ul>
      )}
      {moment && <ReplayMoment m={moment} t={t} />}

      <p className="av-mirror-foot">{t('analiz.footer')}</p>
    </div>
  );
}
