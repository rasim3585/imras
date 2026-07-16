import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { matchProvider } from '../lib/matchProvider';
import { useAuth } from '../auth/AuthContext';
import { useCart } from '../coupon/CartContext';
import type { Coupon, CouponLeg, LiveState } from '../lib/types';
import { formatOdds } from '../lib/format';
import { legLiveStatus, type LegLive } from '../lib/legStatus';
import { fetchJudgeConfrontations, type JudgeConfrontation } from '../lib/mirror';
import { useI18n } from '../i18n/LanguageContext';

type ResultTab = 'ongoing' | 'won' | 'lost';
type Tab = ResultTab | 'saved';
type TFn = (k: string, v?: Record<string, string | number>) => string;

// cashed-out counts as won if you took at least your stake back, else lost
function bucketOf(c: Coupon): ResultTab {
  if (c.status === 'pending') return 'ongoing';
  if (c.status === 'won') return 'won';
  if (c.status === 'lost') return 'lost';
  return (c.cashout_amount ?? 0) >= c.stake ? 'won' : 'lost'; // cashed_out
}

function StatusChip({ c, t }: { c: Coupon; t: TFn }) {
  // NET göster (ödeme değil): liderlik/rakip ekranları net konuşuyor — "+150"
  // brütü "kazanç" gibi okunuyordu (stake 100 @1.5 → gerçek +50).
  if (c.status === 'won') return <span className="chip chip-pos tnum">{t('mc.st.won')} +{c.potential_win - c.stake}</span>;
  if (c.status === 'lost') return <span className="chip chip-neg">{t('mc.st.lost')}</span>;
  if (c.status === 'cashed_out') {
    const net = (c.cashout_amount ?? 0) - c.stake;
    return <span className="chip chip-accent tnum">{t('mc.st.cashedout')} {net >= 0 ? `+${net}` : net}</span>;
  }
  return <span className="chip">{t('mc.st.open')}</span>;
}

const MARK = { win: '✓', lose: '✗', level: '~', pending: '·' } as const;

// one leg row on an open coupon: live score + your pick + live tick/cross
function LiveLeg({ leg, live }: { leg: CouponLeg; live?: LiveState }) {
  let st: LegLive;
  let label: string;
  if (leg.status === 'won') { st = 'win'; label = 'FT'; }
  else if (leg.status === 'lost') { st = 'lose'; label = 'FT'; }
  else if (!live || live.phase === 'upcoming') { st = 'pending'; label = 'soon'; }
  else {
    const htH = (live.events ?? []).filter((e) => e.team === 'home' && e.minute <= 45).length;
    const htA = (live.events ?? []).filter((e) => e.team === 'away' && e.minute <= 45).length;
    st = legLiveStatus(leg.outcome_key, live.home_score, live.away_score, htH, htA);
    label = live.phase === 'finished' ? `${live.home_score}-${live.away_score} FT` : `${live.home_score}-${live.away_score} · ${live.minute}'`;
  }
  const inner = (
    <>
      <div className="cleg-l">
        <span className="cleg-teams">{leg.match.home_team} v {leg.match.away_team}</span>
        <span className="cleg-state tnum">{label}</span>
      </div>
      <div className="cleg-pick tnum"><span className="muted">{leg.market_name}:</span> {leg.option_label}</div>
      <span className={`cleg-mark m-${st}`}>{MARK[st]}</span>
    </>
  );
  // Only virtual matches have a live-watch screen; real legs are non-clickable
  // (routing them to /live would hang on "Connecting to the match…").
  return leg.kind === 'virtual'
    ? <Link className="cleg leg-link" to={`/live/${leg.match.id}`}>{inner}</Link>
    : <div className="cleg">{inner}</div>;
}

export default function MyCouponsScreen() {
  const { refreshProfile } = useAuth();
  const { t } = useI18n();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [tab, setTab] = useState<Tab>('ongoing');
  const [liveMap, setLiveMap] = useState<Record<string, LiveState>>({});
  const [cashouts, setCashouts] = useState<Record<string, { value: number; available: boolean }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [shared, setShared] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { saved, loadDraft, deleteDraft, count: cartCount } = useCart();

  const linkFor = (id: string) => `${window.location.origin}/c/${id}`;
  const waHref = (id: string) => `https://wa.me/?text=${encodeURIComponent('Check out my pickplay coupon: ' + linkFor(id))}`;

  async function share(couponId: string) {
    try {
      await matchProvider.shareCoupon(couponId);
      setShared((s) => new Set(s).add(couponId));
      setToast(t('mc.shared'));
    } catch (err) {
      setToast(err instanceof Error ? err.message : t('mc.shareErr'));
    }
    window.setTimeout(() => setToast(null), 2600);
  }

  async function copyLink(couponId: string) {
    try { await navigator.clipboard.writeText(linkFor(couponId)); setToast(t('mc.copied')); }
    catch { setToast(linkFor(couponId)); }
    window.setTimeout(() => setToast(null), 2600);
  }

  const load = useCallback(async () => {
    await matchProvider.settleDueCoupons().catch(() => 0);
    setCoupons(await matchProvider.getMyCoupons());
  }, []);

  useEffect(() => {
    load()
      .catch((err) => setError(err instanceof Error ? err.message : t('mc.loadErr')))
      .finally(() => setLoading(false));
  }, [load]);

  const buckets = useMemo(() => {
    const b: Record<ResultTab, Coupon[]> = { ongoing: [], won: [], lost: [] };
    for (const c of coupons) b[bucketOf(c)].push(c);
    return b;
  }, [coupons]);

  // Yüzleşme (0149): settle olmuş kuponlara bağlı hakem kararnameleri —
  // "hakem %9 demişti" çipi. Salt-okuma, tek seferlik.
  const [verdicts, setVerdicts] = useState<Record<string, JudgeConfrontation>>({});
  useEffect(() => {
    const ids = coupons.filter((c) => c.status !== 'pending').map((c) => c.id).slice(0, 120);
    if (ids.length === 0) return;
    fetchJudgeConfrontations(ids).then(setVerdicts).catch(() => {});
  }, [coupons]);

  const ongoing = buckets.ongoing;

  // live score + cash-out values for open coupons (drives the leg ticks/crosses)
  useEffect(() => {
    if (ongoing.length === 0) { setLiveMap({}); return; }
    const ids = [...new Set(ongoing.flatMap((c) => c.legs.map((l) => l.match.id)))];
    let alive = true;
    const poll = async () => {
      try {
        const states = await matchProvider.getLiveStates(ids);
        if (alive) setLiveMap(Object.fromEntries(states.map((s) => [s.match_id, s])));
      } catch { /* transient */ }
      const entries = await Promise.all(ongoing.map(async (c) => {
        try { return [c.id, await matchProvider.getCashoutValue(c.id)] as const; }
        catch { return [c.id, { value: 0, available: false }] as const; }
      }));
      if (alive) setCashouts(Object.fromEntries(entries));
    };
    void poll();
    const id = setInterval(poll, 3500);
    return () => { alive = false; clearInterval(id); };
  }, [ongoing]);

  async function cashout(couponId: string) {
    setBusy(couponId);
    try {
      await matchProvider.doCashout(couponId);
      await refreshProfile();
      await load();
    } catch (err) {
      setError(err instanceof Error && err.message.includes('cashout_unavailable')
        ? t('mc.cashoutGone')
        : err instanceof Error ? err.message : t('mc.cashoutErr'));
    } finally {
      setBusy(null);
    }
  }

  const shown = tab === 'saved' ? [] : buckets[tab];
  const TABS: { key: Tab; label: string }[] = [
    { key: 'ongoing', label: `${t('mc.tab.ongoing')} (${buckets.ongoing.length})` },
    { key: 'won', label: `${t('mc.tab.won')} (${buckets.won.length})` },
    { key: 'lost', label: `${t('mc.tab.lost')} (${buckets.lost.length})` },
    { key: 'saved', label: `${t('mc.tab.saved')} (${saved.length})` },
  ];

  const playDraft = (id: string) => { loadDraft(id); navigate('/coupon'); };

  return (
    <div className="app-shell">
      <div className="page-head" style={{ paddingBottom: 'var(--s3)' }}>
        <h1>{t('mc.title')}</h1>
      </div>

      {/* 0715: seçilmiş ama oynanmamış/kaydedilmemiş kupon → tamamlanmamış */}
      {cartCount > 0 && (
        <div className="card mc-unfin">
          <div>
            <b>⏳ {t('mc.unfinished')}</b>
            <p className="dim" style={{ margin: '2px 0 0', fontSize: '0.8rem' }}>{t('mc.unfinished.sub', { n: cartCount })}</p>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => navigate('/coupon')}>{t('mc.unfinished.cta')}</button>
        </div>
      )}

      <div className="segmented">
        {TABS.map((tb) => (
          <button key={tb.key} className={`segmented-item ${tab === tb.key ? 'active' : ''}`} onClick={() => setTab(tb.key)}>{tb.label}</button>
        ))}
      </div>

      {error && <div className="banner banner-error">{error}</div>}
      {toast && <div className="toast">{toast}</div>}

      {loading ? (
        <div className="center-pad"><div className="spinner" /></div>
      ) : tab === 'saved' ? (
        saved.length === 0 ? (
          <div className="empty">
            <p>{t('mc.nosaved')}</p>
            <button className="btn" onClick={() => navigate('/')}>{t('mc.gotomarkets')}</button>
          </div>
        ) : (
          <div className="coupon-list">
            {saved.map((d) => {
              const odds = d.selections.reduce((a, s) => a * s.odds, 1);
              return (
                <div key={d.id} className="card coupon-card">
                  <div className="coupon-card-head">
                    <span className="tag">{d.selections.length === 1 ? t('mc.single') : t('mc.fold', { n: d.selections.length })}</span>
                    <span className="chip tnum">{formatOdds(odds)}</span>
                  </div>
                  <div className="coupon-legs">
                    {d.selections.map((s) => (
                      <div key={s.match_id} className={`cleg ${s.closed ? 'cleg-closed' : ''}`}>
                        <div className="cleg-l"><span className="cleg-teams">{s.home_team} v {s.away_team}</span></div>
                        <div className="cleg-pick tnum">
                          <span className="muted">{s.market_name}:</span> {s.option_label} <b>{formatOdds(s.odds)}</b>
                          {s.closed && <span className="cpn-closed-chip">{t('cpn.closedchip')}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="row" style={{ gap: 'var(--s2)', marginTop: 'var(--s2)' }}>
                    <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={() => playDraft(d.id)}>{t('mc.loadplay')}</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => deleteDraft(d.id)}>{t('mc.delete')}</button>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : shown.length === 0 ? (
        <div className="empty">
          <p>{tab === 'ongoing' ? t('mc.noopen') : t('mc.nonecoupons')}</p>
          {tab === 'ongoing' && <button className="btn" onClick={() => navigate('/')}>{t('mc.gotomarkets')}</button>}
        </div>
      ) : (
        <div className="coupon-list">
          {shown.map((c) => (
            <div key={c.id} className={`card coupon-card cc-${c.status}`}>
              <div className="coupon-card-head">
                <span className="tag">{c.legs.length === 1 ? t('mc.single') : t('mc.fold', { n: c.legs.length })}</span>
                <span className="row" style={{ gap: 6 }}>
                  {c.status !== 'pending' && verdicts[c.id]?.prob_pct != null && (
                    <span className={`chip jv-chip ${verdicts[c.id].warned ? 'jv-warn' : ''}`}>
                      ✦ {t('mc.judgesaid', { p: Math.round(Number(verdicts[c.id].prob_pct)) })}
                    </span>
                  )}
                  <StatusChip c={c} t={t} />
                </span>
              </div>

              <div className="coupon-legs">
                {c.status === 'pending'
                  ? c.legs.map((s) => <LiveLeg key={s.id} leg={s} live={liveMap[s.match.id]} />)
                  : c.legs.map((s) => (
                    <div key={s.id} className={`coupon-leg ${s.status === 'won' ? 'leg-hit' : s.status === 'lost' ? 'leg-miss' : ''}`}>
                      <span className="leg-match">{s.match.home_team} vs {s.match.away_team}</span>
                      <span className="leg-pick tnum"><span className="muted">{s.market_name}:</span> {s.option_label} @ {formatOdds(s.odds)}</span>
                    </div>
                  ))}
              </div>

              {c.status === 'pending' && (
                <div className="dim leg-hint">{t('mc.livehint')}</div>
              )}

              <div className="coupon-card-foot">
                <div className="coupon-foot-metrics">
                  <span><span className="muted">{t('mc.stake')}</span> <b className="tnum">{c.stake}</b></span>
                  <span><span className="muted">{t('mc.odds')}</span> <b className="tnum">{formatOdds(c.total_odds)}</b></span>
                  <span>
                    <span className="muted">{c.status === 'won' ? t('mc.st.won') : t('mc.towin')}</span>{' '}
                    <b className="tnum">{c.potential_win}</b>
                  </span>
                </div>
                <div className="row" style={{ gap: 'var(--s2)' }}>
                  {shared.has(c.id) ? (
                    <>
                      <button className="btn btn-ghost btn-sm" onClick={() => copyLink(c.id)}>{t('mc.copylink')}</button>
                      <a className="btn btn-ghost btn-sm" href={waHref(c.id)} target="_blank" rel="noreferrer">WhatsApp</a>
                    </>
                  ) : (
                    <button className="btn btn-ghost btn-sm" onClick={() => share(c.id)}>{t('mc.share')}</button>
                  )}
                  {c.status === 'pending' && cashouts[c.id]?.available && (
                    <button className="btn btn-primary btn-sm" disabled={busy === c.id} onClick={() => cashout(c.id)}>
                      {busy === c.id ? '…' : t('mc.cashout', { v: cashouts[c.id].value })}
                    </button>
                  )}
                  {c.status !== 'pending' && (
                    <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/settle/${c.id}`)}>{t('mc.viewresult')}</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
