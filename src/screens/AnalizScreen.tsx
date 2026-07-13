import { useEffect, useState } from 'react';
import {
  fetchOverview, fetchCouponMirror, fetchSlotMirror, fetchBenchmark, fetchPlayerCard, fetchCoach, fetchRealityCheck,
  type OverviewProfile, type CouponProfile, type SlotProfile, type MirrorFlag,
  type BenchmarkProfile, type BenchmarkAxis, type PlayerCard, type RealityCheck,
} from '../lib/mirror';
import { flagText, flagAction } from '../analiz/flagText';
import AviatorMirror from '../aviator/AviatorMirror';
import { CoinIcon } from '../components/icons';
import { useI18n } from '../i18n/LanguageContext';

// DAVRANIŞ AYNASI — Analiz merkezi. Alt başlıklar: Genel (çapraz-ürün), Maç
// bahisleri, Aviator, Gates of Goal, Diğer. Her biri kullanıcının KENDİ verisinden
// deterministik teşhis gösterir. Para yok — desenini zararsız gör.

type Tab = 'genel' | 'coupon' | 'aviator' | 'slot' | 'other';
const TABS: { key: Tab; tkey: string }[] = [
  { key: 'genel', tkey: 'analiz.tab.overview' },
  { key: 'coupon', tkey: 'analiz.tab.coupon' },
  { key: 'aviator', tkey: 'analiz.tab.aviator' },
  { key: 'slot', tkey: 'analiz.tab.slot' },
  { key: 'other', tkey: 'analiz.tab.other' },
];

const pct = (x: number) => `%${Math.round(x * 100)}`;
const gold = (n: number) => `${n > 0 ? '+' : ''}${n.toLocaleString('tr-TR')}`;

function FlagList({ flags }: { flags: MirrorFlag[] }) {
  const { t } = useI18n();
  if (!flags.length) return <p className="az-sub">{t('analiz.nopattern')}</p>;
  const warns = flags.filter((f) => f.level === 'warn');
  const goods = flags.filter((f) => f.level !== 'warn');
  return (
    <ul className="az-flags">
      {[...warns, ...goods].map((f) => {
        const t = flagText(f);
        const act = f.level === 'warn' ? flagAction(f.code) : null;
        return (
          <li key={f.code} className={`az-flag ${f.level}`}>
            <span className="az-dot" aria-hidden />
            <div>
              <b>{t.title}</b><p>{t.body}</p>
              {act && <p className="az-act"><span aria-hidden>→ </span>{act}</p>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Stat({ k, children, cls }: { k: string; children: React.ReactNode; cls?: string }) {
  return <div className="az-stat"><span className="k">{k}</span><b className={cls}>{children}</b></div>;
}

function useMirror<T>(fn: () => Promise<T>, dep: unknown): T | null {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    let alive = true; setData(null);
    fn().then((d) => { if (alive) setData(d); }).catch(() => { if (alive) setData(null); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dep]);
  return data;
}

// "vs diğer oyuncular": her eksende sen vs ortalama + yüzdelik dilim rozeti.
function fmtAxis(a: BenchmarkAxis, x: number): string {
  return a.unit === 'x' ? `${x.toFixed(2)}x` : `%${Math.round(x * 100)}`;
}
type TFn = (k: string, v?: Record<string, string | number>) => string;
function axisNote(a: BenchmarkAxis, t: TFn): { text: string; good: boolean | null } {
  const p = `%${Math.round(a.percentile * 100)}`;
  if (a.dir === 'low_good') return { text: t('bench.note.low_good', { p }), good: a.you < a.avg };
  if (a.dir === 'high_good') return { text: t('bench.note.high_good', { p }), good: a.you > a.avg };
  return { text: t('bench.note.neutral', { p }), good: null };
}
function BenchmarkBlock() {
  const { t } = useI18n();
  const d = useMirror<BenchmarkProfile>(fetchBenchmark, 'bench');
  if (!d || !d.ready) return null;
  return (
    <div className="az-block">
      <h3 className="az-h">{t('analiz.section.benchmark')} <span className="az-pop">{t('analiz.section.pop', { n: d.population })}</span></h3>
      <div className="az-bench">
        {d.axes.map((a) => {
          const note = axisNote(a, t);
          const max = Math.max(a.you, a.avg) * 1.15 || 1;
          return (
            <div key={a.key} className="az-bx">
              <div className="az-bx-head">
                <span className="az-bx-label">{t('bench.axis.' + a.key)}</span>
                <span className={`az-bx-pill ${note.good === true ? 'good' : note.good === false ? 'bad' : ''}`}>{note.text}</span>
              </div>
              <div className="az-bx-row"><span className="az-bx-k">{t('bench.you')}</span>
                <div className="az-bx-track"><div className="az-bx-fill you" style={{ width: `${Math.round((a.you / max) * 100)}%` }} /></div>
                <span className="az-bx-v">{fmtAxis(a, a.you)}</span></div>
              <div className="az-bx-row"><span className="az-bx-k">{t('bench.avg')}</span>
                <div className="az-bx-track"><div className="az-bx-fill avg" style={{ width: `${Math.round((a.avg / max) * 100)}%` }} /></div>
                <span className="az-bx-v">{fmtAxis(a, a.avg)}</span></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// LLM koç: deterministik özeti kişisel bir mesaja döker. Key/edge yoksa sessizce
// gizlenir (deterministik içerik zaten aşağıda). Sayılar backend'de üretilir; LLM
// yalnız cümleye döker.
function CoachBlock() {
  const { t, lang } = useI18n();
  const [text, setText] = useState<string | null>(null);
  const [state, setState] = useState<'load' | 'done' | 'off'>('load');
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [ov, card, bench] = await Promise.all([fetchOverview(), fetchPlayerCard(), fetchBenchmark()]);
        const summary = {
          card: card.ready ? { archetype: card.archetype, subtitle: card.subtitle, total_net: card.total_net } : null,
          overall: ov.ready ? { net: ov.net, most_played: ov.most_played, worst: ov.worst,
            products: ov.products.map((p) => ({ oyun: p.key, oynanma: p.plays, net: p.net, risk_payi: p.stake_share })),
            teshisler: ov.flags.map((f) => f.code) } : null,
          benchmark: bench.ready ? bench.axes.map((a) => ({ eksen: a.key, sen: a.you, ortalama: a.avg, dilim: a.percentile })) : null,
        };
        if (!summary.card && !summary.overall) { if (alive) setState('off'); return; }
        const msg = await fetchCoach(summary, lang);
        if (!alive) return;
        if (msg) { setText(msg); setState('done'); } else setState('off');
      } catch { if (alive) setState('off'); }
    })();
    return () => { alive = false; };
  }, [lang]);
  if (state === 'off') return null;
  return (
    <div className="az-coach">
      <div className="az-coach-h">💬 {t('analiz.coach.header')}</div>
      {state === 'load'
        ? <p className="az-coach-load">{t('analiz.coach.loading')}</p>
        : <p className="az-coach-text">{text}</p>}
    </div>
  );
}

// Kimlik kartı: çapraz-ürün desenden arketip + imza özellikler.
function PlayerCardBlock() {
  const c = useMirror<PlayerCard>(fetchPlayerCard, 'card');
  if (!c || !c.ready) return null;
  const netCls = c.total_net >= 0 ? 'pos' : 'neg';
  return (
    <div className="az-card">
      <div className="az-card-emoji" aria-hidden>{c.emoji}</div>
      <div className="az-card-main">
        <div className="az-card-arche">{c.archetype}</div>
        <p className="az-card-sub">{c.subtitle}</p>
        <div className="az-card-traits">
          {c.traits.map((t) => (
            <span key={t.label} className={`az-trait ${t.tone}`}>{t.label}: <b>{t.value}</b></span>
          ))}
          <span className={`az-trait ${netCls === 'pos' ? 'good' : 'warn'}`}>Net: <b>{gold(c.total_net)}</b></span>
        </div>
      </div>
    </div>
  );
}

function GenelTab() {
  const { t } = useI18n();
  const d = useMirror<OverviewProfile>(fetchOverview, 'genel');
  if (!d) return <p className="az-sub">{t('analiz.loading')}</p>;
  if (!d.ready) return <p className="az-sub">{t('analiz.overview.notready', { have: d.plays ?? 0, need: d.need ?? 20 })}</p>;
  const netCls = d.net >= 0 ? 'pos' : 'neg';
  const maxStake = Math.max(...d.products.map((p) => p.staked), 1);
  const topPlayed = [...d.products].sort((a, b) => b.plays - a.plays)[0];
  return (
    <div className="az-body">
      <PlayerCardBlock />
      <CoachBlock />

      <div className="az-stats3">
        <Stat k={t('analiz.stat.totalPlays')}>{d.plays.toLocaleString()}</Stat>
        <Stat k={t('analiz.stat.totalNet')} cls={netCls}><CoinIcon size={12} /> {gold(d.net)}</Stat>
        <Stat k={t('analiz.stat.mostPlayed')}>{topPlayed ? t('product.' + topPlayed.key) : '—'}</Stat>
      </div>

      <div className="az-block">
        <h3 className="az-h">{t('analiz.section.products')}</h3>
        <div className="az-prods">
          {d.products.map((p) => (
            <div key={p.key} className="az-prod">
              <div className="az-prod-top">
                <span className="az-prod-name">{t('product.' + p.key)}</span>
                <span className={`az-prod-net ${p.net >= 0 ? 'pos' : 'neg'}`}>{gold(p.net)}</span>
              </div>
              <div className="az-bar"><div className="az-bar-fill" style={{ width: `${Math.round((p.staked / maxStake) * 100)}%` }} /></div>
              <div className="az-prod-sub">{t('analiz.prod.sub', { plays: p.plays.toLocaleString(), share: pct(p.stake_share) })}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="az-block">
        <h3 className="az-h">{t('analiz.section.mirrorSays')}</h3>
        <FlagList flags={d.flags} />
      </div>

      <BenchmarkBlock />
    </div>
  );
}

function CouponTab() {
  const { t } = useI18n();
  const d = useMirror<CouponProfile>(fetchCouponMirror, 'coupon');
  if (!d) return <p className="az-sub">{t('analiz.loading')}</p>;
  if (!d.ready) return <p className="az-sub">{t('analiz.coupon.notready', { have: d.rounds ?? 0, need: d.need ?? 15 })}</p>;
  return (
    <div className="az-body">
      <div className="az-stats4">
        <Stat k={t('analiz.stat.coupons')}>{d.rounds.toLocaleString()}</Stat>
        <Stat k={t('analiz.stat.winrate')}>{pct(d.win_rate)}</Stat>
        <Stat k={t('analiz.stat.net')} cls={d.net >= 0 ? 'pos' : 'neg'}>{gold(d.net)}</Stat>
        <Stat k={t('analiz.stat.medianOdds')}>{d.median_odds}</Stat>
      </div>
      <FlagList flags={d.flags} />
    </div>
  );
}

function SlotTab() {
  const { t } = useI18n();
  const d = useMirror<SlotProfile>(fetchSlotMirror, 'slot');
  if (!d) return <p className="az-sub">{t('analiz.loading')}</p>;
  if (!d.ready) return <p className="az-sub">{t('analiz.slot.notready', { have: d.rounds ?? 0, need: d.need ?? 15 })}</p>;
  return (
    <div className="az-body">
      <div className="az-stats4">
        <Stat k={t('analiz.stat.spins')}>{d.rounds.toLocaleString()}</Stat>
        <Stat k={t('analiz.stat.net')} cls={d.net >= 0 ? 'pos' : 'neg'}>{gold(d.net)}</Stat>
        <Stat k={t('analiz.stat.rtp')}>{d.rtp != null ? pct(d.rtp) : '—'}</Stat>
        <Stat k={t('analiz.stat.biggest')}>{d.biggest_win.toLocaleString()}</Stat>
      </div>
      <FlagList flags={d.flags} />
    </div>
  );
}

// Gerçeklik kontrolü: kullanıcıyı LEHİNE uyaran ayıraçlar (ürünün asıl amacı).
function RealityCheckBanner() {
  const { t } = useI18n();
  const d = useMirror<RealityCheck>(fetchRealityCheck, 'rc');
  if (!d || !d.ready || d.alerts.length === 0) return null;
  return (
    <div className="az-rc">
      {d.alerts.map((a) => (
        <div key={a.code} className={`az-rc-item ${a.level}`}>
          <span className="az-rc-ic" aria-hidden>{a.level === 'danger' ? '⚠️' : '⏸️'}</span>
          <span>{t('rc.' + a.code, a.value as Record<string, number>)}</span>
        </div>
      ))}
    </div>
  );
}

export default function AnalizScreen() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('genel');
  return (
    <div className="app-shell az-screen">
      <div className="az-head">
        <h1>🪞 {t('analiz.title')}</h1>
        <p className="az-lead">{t('analiz.lead')}</p>
      </div>

      <RealityCheckBanner />

      <div className="az-tabs">
        {TABS.map((tb) => (
          <button key={tb.key} className={`az-tab ${tab === tb.key ? 'is-active' : ''}`} onClick={() => setTab(tb.key)}>
            {t(tb.tkey)}
          </button>
        ))}
      </div>

      {tab === 'genel' && <GenelTab />}
      {tab === 'coupon' && <CouponTab />}
      {tab === 'aviator' && <div className="az-body"><AviatorMirror /></div>}
      {tab === 'slot' && <SlotTab />}
      {tab === 'other' && (
        <div className="az-body"><p className="az-sub">{t('analiz.other')}</p></div>
      )}
    </div>
  );
}
