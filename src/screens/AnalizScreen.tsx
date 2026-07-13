import { useEffect, useState } from 'react';
import {
  fetchOverview, fetchCouponMirror, fetchSlotMirror, fetchBenchmark,
  type OverviewProfile, type CouponProfile, type SlotProfile, type MirrorFlag,
  type BenchmarkProfile, type BenchmarkAxis,
} from '../lib/mirror';
import { flagText } from '../analiz/flagText';
import AviatorMirror from '../aviator/AviatorMirror';
import { CoinIcon } from '../components/icons';

// DAVRANIŞ AYNASI — Analiz merkezi. Alt başlıklar: Genel (çapraz-ürün), Maç
// bahisleri, Aviator, Gates of Goal, Diğer. Her biri kullanıcının KENDİ verisinden
// deterministik teşhis gösterir. Para yok — desenini zararsız gör.

type Tab = 'genel' | 'coupon' | 'aviator' | 'slot' | 'other';
const TABS: { key: Tab; label: string }[] = [
  { key: 'genel', label: 'Genel' },
  { key: 'coupon', label: 'Maç bahisleri' },
  { key: 'aviator', label: 'Aviator' },
  { key: 'slot', label: 'Gates of Goal' },
  { key: 'other', label: 'Diğer' },
];

const pct = (x: number) => `%${Math.round(x * 100)}`;
const gold = (n: number) => `${n > 0 ? '+' : ''}${n.toLocaleString('tr-TR')}`;

function FlagList({ flags }: { flags: MirrorFlag[] }) {
  if (!flags.length) return <p className="az-sub">Belirgin bir zaaf deseni yok — dengeli oynuyorsun.</p>;
  const warns = flags.filter((f) => f.level === 'warn');
  const goods = flags.filter((f) => f.level !== 'warn');
  return (
    <ul className="az-flags">
      {[...warns, ...goods].map((f) => {
        const t = flagText(f);
        return (
          <li key={f.code} className={`az-flag ${f.level}`}>
            <span className="az-dot" aria-hidden />
            <div><b>{t.title}</b><p>{t.body}</p></div>
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
function axisNote(a: BenchmarkAxis): { text: string; good: boolean | null } {
  const p = Math.round(a.percentile * 100);
  if (a.dir === 'low_good')
    return { text: `Oyuncuların %${p} kadarından daha disiplinlisin.`, good: a.you < a.avg };
  if (a.dir === 'high_good')
    return { text: `Getirin oyuncuların %${p}'inden daha iyi.`, good: a.you > a.avg };
  return { text: `Oyuncuların %${p}'inden daha yüksek oran oynuyorsun.`, good: null };
}
function BenchmarkBlock() {
  const d = useMirror<BenchmarkProfile>(fetchBenchmark, 'bench');
  if (!d || !d.ready) return null;
  return (
    <div className="az-block">
      <h3 className="az-h">Diğer oyunculara göre <span className="az-pop">{d.population} oyuncu</span></h3>
      <div className="az-bench">
        {d.axes.map((a) => {
          const note = axisNote(a);
          const max = Math.max(a.you, a.avg) * 1.15 || 1;
          return (
            <div key={a.key} className="az-bx">
              <div className="az-bx-head">
                <span className="az-bx-label">{a.label}</span>
                <span className={`az-bx-pill ${note.good === true ? 'good' : note.good === false ? 'bad' : ''}`}>{note.text}</span>
              </div>
              <div className="az-bx-row"><span className="az-bx-k">Sen</span>
                <div className="az-bx-track"><div className="az-bx-fill you" style={{ width: `${Math.round((a.you / max) * 100)}%` }} /></div>
                <span className="az-bx-v">{fmtAxis(a, a.you)}</span></div>
              <div className="az-bx-row"><span className="az-bx-k">Ort.</span>
                <div className="az-bx-track"><div className="az-bx-fill avg" style={{ width: `${Math.round((a.avg / max) * 100)}%` }} /></div>
                <span className="az-bx-v">{fmtAxis(a, a.avg)}</span></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GenelTab() {
  const d = useMirror<OverviewProfile>(fetchOverview, 'genel');
  if (!d) return <p className="az-sub">Yükleniyor…</p>;
  if (!d.ready) return <p className="az-sub">Genel tablo için biraz daha veri gerekiyor — {d.plays ?? 0}/{d.need ?? 20} oyun. Oynadıkça netleşir.</p>;
  const netCls = d.net >= 0 ? 'pos' : 'neg';
  const maxStake = Math.max(...d.products.map((p) => p.staked), 1);
  return (
    <div className="az-body">
      <div className="az-stats3">
        <Stat k="Toplam oyun">{d.plays.toLocaleString('tr-TR')}</Stat>
        <Stat k="Toplam net" cls={netCls}><CoinIcon size={12} /> {gold(d.net)}</Stat>
        <Stat k="En çok">{d.most_played}</Stat>
      </div>

      <div className="az-block">
        <h3 className="az-h">Ürün dağılımın</h3>
        <div className="az-prods">
          {d.products.map((p) => (
            <div key={p.key} className="az-prod">
              <div className="az-prod-top">
                <span className="az-prod-name">{p.label}</span>
                <span className={`az-prod-net ${p.net >= 0 ? 'pos' : 'neg'}`}>{gold(p.net)}</span>
              </div>
              <div className="az-bar"><div className="az-bar-fill" style={{ width: `${Math.round((p.staked / maxStake) * 100)}%` }} /></div>
              <div className="az-prod-sub">{p.plays.toLocaleString('tr-TR')} oyun · riskin {pct(p.stake_share)}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="az-block">
        <h3 className="az-h">Aynan diyor ki</h3>
        <FlagList flags={d.flags} />
      </div>

      <BenchmarkBlock />
    </div>
  );
}

function CouponTab() {
  const d = useMirror<CouponProfile>(fetchCouponMirror, 'coupon');
  if (!d) return <p className="az-sub">Yükleniyor…</p>;
  if (!d.ready) return <p className="az-sub">Maç bahisleri analizi için biraz daha kupon gerekiyor — {d.rounds ?? 0}/{d.need ?? 15}.</p>;
  return (
    <div className="az-body">
      <div className="az-stats4">
        <Stat k="Kupon">{d.rounds.toLocaleString('tr-TR')}</Stat>
        <Stat k="Kazanma">{pct(d.win_rate)}</Stat>
        <Stat k="Net" cls={d.net >= 0 ? 'pos' : 'neg'}>{gold(d.net)}</Stat>
        <Stat k="Medyan oran">{d.median_odds}</Stat>
      </div>
      <FlagList flags={d.flags} />
    </div>
  );
}

function SlotTab() {
  const d = useMirror<SlotProfile>(fetchSlotMirror, 'slot');
  if (!d) return <p className="az-sub">Yükleniyor…</p>;
  if (!d.ready) return <p className="az-sub">Gates of Goal analizi için biraz daha spin gerekiyor — {d.rounds ?? 0}/{d.need ?? 15}.</p>;
  return (
    <div className="az-body">
      <div className="az-stats4">
        <Stat k="Spin">{d.rounds.toLocaleString('tr-TR')}</Stat>
        <Stat k="Net" cls={d.net >= 0 ? 'pos' : 'neg'}>{gold(d.net)}</Stat>
        <Stat k="RTP">{d.rtp != null ? pct(d.rtp) : '—'}</Stat>
        <Stat k="En büyük">{d.biggest_win.toLocaleString('tr-TR')}</Stat>
      </div>
      <FlagList flags={d.flags} />
    </div>
  );
}

export default function AnalizScreen() {
  const [tab, setTab] = useState<Tab>('genel');
  return (
    <div className="app-shell az-screen">
      <div className="az-head">
        <h1>🪞 Aynan</h1>
        <p className="az-lead">Oyunların bir veri toplama aracı; asıl değer senin desenin. Para yok — kendini zararsız gör.</p>
      </div>

      <div className="az-tabs">
        {TABS.map((t) => (
          <button key={t.key} className={`az-tab ${tab === t.key ? 'is-active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'genel' && <GenelTab />}
      {tab === 'coupon' && <CouponTab />}
      {tab === 'aviator' && <div className="az-body"><AviatorMirror /></div>}
      {tab === 'slot' && <SlotTab />}
      {tab === 'other' && (
        <div className="az-body"><p className="az-sub">Diğer oyunlar (yeni oyunlar eklendikçe) buraya gelecek. Her yeni oyun aynana otomatik bağlanır.</p></div>
      )}
    </div>
  );
}
