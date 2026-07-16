import { useEffect, useState } from 'react';
import {
  fetchSurvey, saveSurvey, fetchParallel, fetchTilt, fetchSelfGap,
  type Survey, type ParallelProfile, type TiltProfile, type SelfGapProfile,
} from '../lib/mirror';
import { useI18n } from '../i18n/LanguageContext';

// AYNA+ — üç "wow" kartı. İlke: her kart = 1 metrik + 1 grafik + 1 cümle.
// Sayılar tamamen deterministik (backend RPC); grafikler el yapımı SVG.

const gold = (n: number) => `${n > 0 ? '+' : ''}${n.toLocaleString('tr-TR')}`;

function useData<T>(fn: () => Promise<T>): T | null {
  const [d, setD] = useState<T | null>(null);
  useEffect(() => {
    let alive = true;
    fn().then((x) => { if (alive) setD(x); }).catch(() => { if (alive) setD(null); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return d;
}

// --- Anket formu (ortak): Aynam'da ilk doldurma, Profil'de düzenleme ----------
function SurveyForm({ initial, title, sub, onSaved }: {
  initial: Survey | null; title: string; sub: string; onSaved?: () => void;
}) {
  const { t } = useI18n();
  const [team, setTeam] = useState(initial?.team ?? '');
  const [fav, setFav] = useState(initial?.fav_game ?? '');
  const [style, setStyle] = useState<Survey['self_style']>(initial?.self_style ?? null);
  const [city, setCity] = useState(initial?.city ?? '');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function submit() {
    if (!style) return;
    setBusy(true); setSaved(false);
    try {
      await saveSurvey({ team: team.trim() || null, fav_game: fav || null, self_style: style, city: city.trim() || null });
      setSaved(true); onSaved?.();
      window.setTimeout(() => setSaved(false), 2200);
    } catch { /* sessiz */ } finally { setBusy(false); }
  }

  return (
    <div className="az-survey">
      <div className="az-survey-h">🪞 {title}</div>
      <p className="az-survey-sub">{sub}</p>
      <div className="az-survey-grid">
        <label>{t('svy.team')}<input value={team} onChange={(e) => setTeam(e.target.value)} placeholder={t('svy.team.ph')} maxLength={40} /></label>
        <label>{t('svy.fav')}
          <select value={fav} onChange={(e) => setFav(e.target.value)}>
            <option value="">—</option>
            <option value="coupon">{t('product.coupon')}</option>
            <option value="aviator">Aviator</option>
            <option value="slot">Gates of Goal</option>
            <option value="live">{t('svy.fav.live')}</option>
          </select>
        </label>
        <label>{t('svy.city')}<input value={city} onChange={(e) => setCity(e.target.value)} placeholder={t('svy.city.ph')} maxLength={40} /></label>
      </div>
      <div className="az-survey-style">
        <span>{t('svy.style')}</span>
        {(['temkinli', 'dengeli', 'agresif'] as const).map((s) => (
          <button key={s} className={`az-chip ${style === s ? 'on' : ''}`} onClick={() => setStyle(s)}>{t('style.' + s)}</button>
        ))}
      </div>
      <button className="btn az-survey-save" disabled={!style || busy} onClick={submit}>
        {busy ? '…' : saved ? t('svy.saved') : t('svy.save')}
      </button>
    </div>
  );
}

// Aynam üstü: yalnız hiç doldurulmamışsa görünür; sonrası Profil'den düzenlenir.
export function SurveyCard({ onSaved }: { onSaved: () => void }) {
  const { t } = useI18n();
  const [loaded, setLoaded] = useState(false);
  const [have, setHave] = useState(false);
  useEffect(() => {
    fetchSurvey().then((s) => { setHave(!!s?.self_style); setLoaded(true); }).catch(() => setLoaded(true));
  }, []);
  if (!loaded || have) return null;
  return <SurveyForm initial={null} title={t('svy.title')} sub={t('svy.sub')} onSaved={() => { setHave(true); onSaved(); }} />;
}

// Profil sekmesi: her zaman görünür, mevcut cevaplarla dolu, düzenlenebilir.
export function SurveyEditor() {
  const { t } = useI18n();
  const [s, setS] = useState<Survey | null | 'load'>('load');
  useEffect(() => {
    fetchSurvey().then((x) => setS(x)).catch(() => setS(null));
  }, []);
  if (s === 'load') return null;
  return <SurveyForm key={s ? 'has' : 'new'} initial={s} title={t('svy.edit.title')} sub={t('svy.sub')} />;
}

// --- Öz-algı vs ölçülen davranış ---------------------------------------------
export function SelfGapCard({ refreshKey }: { refreshKey: number }) {
  const { t } = useI18n();
  const [d, setD] = useState<SelfGapProfile | null>(null);
  useEffect(() => {
    let alive = true;
    fetchSelfGap().then((x) => { if (alive) setD(x); }).catch(() => {});
    return () => { alive = false; };
  }, [refreshKey]);
  if (!d || !d.ready) return null;
  const said = d.survey?.self_style ?? null;
  const match = said === d.style;
  return (
    <div className="az-block">
      <div className="az-h-row">
        <h3 className="az-h">🎭 {t('gap.title')}</h3>
        {/* RAS Score — markanın ürün içi metriği (ölçülen 0-100 risk skoru).
            Marka tek dil: İngilizce etiket her dilde aynı kalır. */}
        <span className="ras-score tnum" title="Risk Awareness Score">RAS Score · {d.score}/100</span>
      </div>
      <div className="az-gap-gauge">
        <div className="az-gap-track">
          <div className="az-gap-zone z1" /><div className="az-gap-zone z2" /><div className="az-gap-zone z3" />
          <div className="az-gap-needle" style={{ left: `${d.score}%` }} />
          {said && <div className="az-gap-said" style={{ left: `${said === 'temkinli' ? 16 : said === 'dengeli' ? 50 : 84}%` }} title={t('gap.saidmark')} />}
        </div>
        <div className="az-gap-labels"><span>{t('style.temkinli')}</span><span>{t('style.dengeli')}</span><span>{t('style.agresif')}</span></div>
      </div>
      <p className="az-gap-line">
        {said
          ? (match
            ? t('gap.match', { style: t('style.' + d.style), score: d.score })
            : t('gap.mismatch', { said: t('style.' + said), real: t('style.' + d.style), score: d.score }))
          : t('gap.nosurvey', { style: t('style.' + d.style), score: d.score })}
      </p>
      <div className="az-gap-comps">
        <span>{t('gap.target')}: <b>{d.comps.target.toFixed(2)}x</b></span>
        <span>{t('gap.chase')}: <b>%{Math.round(d.comps.chase * 100)}</b></span>
        <span>{t('gap.vol')}: <b>{d.comps.vol.toFixed(2)}</b></span>
      </div>
    </div>
  );
}

// --- Paralel Sen: gerçek sonuç vs "hep X'te çek" stratejileri -----------------
export function ParallelCard() {
  const { t } = useI18n();
  const d = useData<ParallelProfile>(fetchParallel);
  if (!d || !d.ready || d.series.length < 2) return null;
  const W = 320, H = 120, P = 6;
  const all = d.series.flatMap((p) => [p.a, p.b, p.c]);
  const lo = Math.min(...all, 0), hi = Math.max(...all, 0);
  const span = hi - lo || 1;
  const x = (i: number) => P + (i / (d.series.length - 1)) * (W - 2 * P);
  const y = (v: number) => P + (1 - (v - lo) / span) * (H - 2 * P);
  const line = (key: 'a' | 'b' | 'c') => d.series.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(p[key]).toFixed(1)}`).join(' ');
  const best = [...d.strat].sort((s1, s2) => s2.net - s1.net)[0];
  const diff = best.net - d.actual;
  return (
    <div className="az-block">
      <h3 className="az-h">🔀 {t('par.title')} <span className="az-pop">{t('par.n', { n: d.n })}</span></h3>
      <svg viewBox={`0 0 ${W} ${H}`} className="az-par-svg" aria-hidden>
        <line x1={P} x2={W - P} y1={y(0)} y2={y(0)} stroke="currentColor" opacity="0.18" strokeDasharray="3 3" />
        <path d={line('c')} fill="none" stroke="#e2a04a" strokeWidth="1.6" opacity="0.75" />
        <path d={line('b')} fill="none" stroke="#4aa3e2" strokeWidth="1.6" opacity="0.75" />
        <path d={line('a')} fill="none" stroke="#1f9e75" strokeWidth="2.4" />
      </svg>
      <div className="az-par-legend">
        <span><i className="lg you" /> {t('par.you')} <b className={d.actual >= 0 ? 'pos' : 'neg'}>{gold(d.actual)}</b></span>
        <span><i className="lg b15" /> 1.5x <b className={(d.strat[1]?.net ?? 0) >= 0 ? 'pos' : 'neg'}>{gold(d.strat[1]?.net ?? 0)}</b></span>
        <span><i className="lg b30" /> 3.0x <b className={(d.strat[3]?.net ?? 0) >= 0 ? 'pos' : 'neg'}>{gold(d.strat[3]?.net ?? 0)}</b></span>
      </div>
      <p className="az-gap-line">
        {diff > 0
          ? t('par.better', { t: best.t.toFixed(1), diff: gold(diff) })
          : t('par.youbest')}
      </p>
    </div>
  );
}

// --- Tilt şeridi: kayıptan sonra büyütme anları + refleksin maliyeti ----------
export function TiltCard() {
  const { t } = useI18n();
  const d = useData<TiltProfile>(fetchTilt);
  if (!d || !d.ready) return null;
  const maxSt = Math.max(...d.points.map((p) => p.st), 1);
  return (
    <div className="az-block">
      <h3 className="az-h">🌡 {t('tilt.title')} <span className="az-pop">{t('tilt.n', { n: d.n })}</span></h3>
      <div className="az-tilt-strip" aria-hidden>
        {d.points.map((p, i) => (
          <span
            key={i}
            className={`az-tilt-dot ${p.tl ? 'tl' : ''} ${p.net >= 0 ? 'w' : 'l'}`}
            style={{ ['--s' as string]: (0.35 + 0.65 * (p.st / maxSt)).toFixed(2) }}
            title={`${p.g === 'av' ? 'Aviator' : 'Gates'} · ${p.st} · ${gold(p.net)}${p.tl ? ' · TILT' : ''}`}
          />
        ))}
      </div>
      <p className="az-gap-line">
        {d.raise_loss != null && d.raise_loss > 0.05
          ? t('tilt.line', { pct: Math.round(d.raise_loss * 100), cost: gold(d.tilt_net), n: d.tilt_count })
          : t('tilt.calm')}
        {d.raise_loss != null && d.raise_win != null && d.raise_loss > d.raise_win + 0.1 && ' ' + t('tilt.asym', { l: Math.round(d.raise_loss * 100), w: Math.round(Math.max(0, d.raise_win) * 100) })}
      </p>
    </div>
  );
}

// ParallelCard (zaten export'lu) artık Aviator sekmesinde render edilir —
// verisi Aviator-only (son 300 bahis); Genel'de "tüm oyunum" sanılıyordu.
export default function MirrorPlus() {
  const [rk, setRk] = useState(0);
  return (
    <>
      <SurveyCard onSaved={() => setRk((k) => k + 1)} />
      <SelfGapCard refreshKey={rk} />
      <TiltCard />
    </>
  );
}
