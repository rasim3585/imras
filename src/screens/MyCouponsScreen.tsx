import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { matchProvider } from '../lib/matchProvider';
import { useAuth } from '../auth/AuthContext';
import type { Coupon, CouponLeg, LiveState } from '../lib/types';
import { formatOdds } from '../lib/format';
import { legLiveStatus, type LegLive } from '../lib/legStatus';

type Tab = 'ongoing' | 'won' | 'lost';

// cashed-out counts as won if you took at least your stake back, else lost
function bucketOf(c: Coupon): Tab {
  if (c.status === 'pending') return 'ongoing';
  if (c.status === 'won') return 'won';
  if (c.status === 'lost') return 'lost';
  return (c.cashout_amount ?? 0) >= c.stake ? 'won' : 'lost'; // cashed_out
}

function StatusChip({ c }: { c: Coupon }) {
  if (c.status === 'won') return <span className="chip chip-pos tnum">Won +{c.potential_win}</span>;
  if (c.status === 'lost') return <span className="chip chip-neg">Lost</span>;
  if (c.status === 'cashed_out') return <span className="chip chip-accent tnum">Cashed out +{c.cashout_amount}</span>;
  return <span className="chip">Open</span>;
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
  return (
    <Link className="cleg leg-link" to={`/live/${leg.match.id}`}>
      <div className="cleg-l">
        <span className="cleg-teams">{leg.match.home_team} v {leg.match.away_team}</span>
        <span className="cleg-state tnum">{label}</span>
      </div>
      <div className="cleg-pick tnum"><span className="muted">{leg.market_name}:</span> {leg.option_label}</div>
      <span className={`cleg-mark m-${st}`}>{MARK[st]}</span>
    </Link>
  );
}

export default function MyCouponsScreen() {
  const { refreshProfile } = useAuth();
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

  const linkFor = (id: string) => `${window.location.origin}/c/${id}`;
  const waHref = (id: string) => `https://wa.me/?text=${encodeURIComponent('Check out my pickplay coupon: ' + linkFor(id))}`;

  async function share(couponId: string) {
    try {
      await matchProvider.shareCoupon(couponId);
      setShared((s) => new Set(s).add(couponId));
      setToast('Shared — copy the link or send it on WhatsApp');
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Could not share');
    }
    window.setTimeout(() => setToast(null), 2600);
  }

  async function copyLink(couponId: string) {
    try { await navigator.clipboard.writeText(linkFor(couponId)); setToast('Link copied to clipboard'); }
    catch { setToast(linkFor(couponId)); }
    window.setTimeout(() => setToast(null), 2600);
  }

  const load = useCallback(async () => {
    await matchProvider.settleDueCoupons().catch(() => 0);
    setCoupons(await matchProvider.getMyCoupons());
  }, []);

  useEffect(() => {
    load()
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load coupons'))
      .finally(() => setLoading(false));
  }, [load]);

  const buckets = useMemo(() => {
    const b: Record<Tab, Coupon[]> = { ongoing: [], won: [], lost: [] };
    for (const c of coupons) b[bucketOf(c)].push(c);
    return b;
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
        ? 'Cash out is no longer available for this coupon.'
        : err instanceof Error ? err.message : 'Could not cash out');
    } finally {
      setBusy(null);
    }
  }

  const shown = buckets[tab];
  const TABS: { key: Tab; label: string }[] = [
    { key: 'ongoing', label: `Ongoing (${buckets.ongoing.length})` },
    { key: 'won', label: `Won (${buckets.won.length})` },
    { key: 'lost', label: `Lost (${buckets.lost.length})` },
  ];

  return (
    <div className="app-shell">
      <div className="page-head" style={{ paddingBottom: 'var(--s3)' }}>
        <h1>My coupons</h1>
      </div>

      <div className="segmented">
        {TABS.map((t) => (
          <button key={t.key} className={`segmented-item ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>

      {error && <div className="banner banner-error">{error}</div>}
      {toast && <div className="toast">{toast}</div>}

      {loading ? (
        <div className="center-pad"><div className="spinner" /></div>
      ) : shown.length === 0 ? (
        <div className="empty">
          <p>{tab === 'ongoing' ? 'No open coupons. Build one from the markets.' : `No ${tab} coupons yet.`}</p>
          {tab === 'ongoing' && <button className="btn" onClick={() => navigate('/')}>Go to markets</button>}
        </div>
      ) : (
        <div className="coupon-list">
          {shown.map((c) => (
            <div key={c.id} className={`card coupon-card cc-${c.status}`}>
              <div className="coupon-card-head">
                <span className="tag">{c.legs.length === 1 ? 'Single' : `${c.legs.length}-fold`}</span>
                <StatusChip c={c} />
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
                <div className="dim leg-hint">Live — green tick winning, red cross losing · settles automatically at full time</div>
              )}

              <div className="coupon-card-foot">
                <div className="coupon-foot-metrics">
                  <span><span className="muted">Stake</span> <b className="tnum">{c.stake}</b></span>
                  <span><span className="muted">Odds</span> <b className="tnum">{formatOdds(c.total_odds)}</b></span>
                  <span>
                    <span className="muted">{c.status === 'won' ? 'Won' : 'To win'}</span>{' '}
                    <b className="tnum">{c.potential_win}</b>
                  </span>
                </div>
                <div className="row" style={{ gap: 'var(--s2)' }}>
                  {shared.has(c.id) ? (
                    <>
                      <button className="btn btn-ghost btn-sm" onClick={() => copyLink(c.id)}>Copy link</button>
                      <a className="btn btn-ghost btn-sm" href={waHref(c.id)} target="_blank" rel="noreferrer">WhatsApp</a>
                    </>
                  ) : (
                    <button className="btn btn-ghost btn-sm" onClick={() => share(c.id)}>Share</button>
                  )}
                  {c.status === 'pending' && cashouts[c.id]?.available && (
                    <button className="btn btn-primary btn-sm" disabled={busy === c.id} onClick={() => cashout(c.id)}>
                      {busy === c.id ? '…' : `Cash out ${cashouts[c.id].value}`}
                    </button>
                  )}
                  {c.status !== 'pending' && (
                    <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/settle/${c.id}`)}>View result</button>
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
