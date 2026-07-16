import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCart } from './CartContext';
import { useAuth } from '../auth/AuthContext';
import { matchProvider } from '../lib/matchProvider';
import { formatOdds } from '../lib/format';
import { logEvent } from '../lib/behaviorLog';
import { humanizeError } from '../lib/errors';
import { useI18n } from '../i18n/LanguageContext';
import { fetchCouponReview, fetchCouponJudge, logJudgeVerdict, type CouponReview, type CouponLegReview } from '../lib/mirror';

const QUICK = [100, 250, 500];

// The slip itself: selections + stake + "Place now". Shared by the desktop dock
// panel and the mobile bottom sheet — bet without leaving the bulletin.
export default function CouponPanel({ onClose }: { onClose?: () => void }) {
  const { selections, count, totalOdds, remove, clear, saveDraft, flash } = useCart();
  const { profile, session, refreshProfile } = useAuth();
  const { t, lang } = useI18n();
  const navigate = useNavigate();

  const balance = profile?.gold_balance ?? 0;
  const [stake, setStake] = useState(100);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);
  // AI Kupon Hakemi v2 — ürünün kalbi: sayılar deterministik (coupon_review),
  // LLM yalnız cümleye döker. İnceleme artık OTOMATİK gelir (LLM maliyeti yok);
  // yargıç metni butonla çağrılır ve eldeki incelemeyi kullanır.
  const [review, setReview] = useState<CouponReview | null>(null);
  const [judgeText, setJudgeText] = useState<string | null>(null);
  const [judging, setJudging] = useState(false);
  const [judgeErr, setJudgeErr] = useState(false);
  const [judgeLimited, setJudgeLimited] = useState(false);

  // kupon değişince eski kararname geçersiz — SEÇİM SETİNE göre sıfırla
  // (aynı maçta pick değiştirmek count'u değiştirmez; selKey değişir)
  const selKey = selections.map((s) => `${s.match_id}:${s.market_type}:${s.outcome_key}`).join('|');
  useEffect(() => { setJudgeText(null); setJudgeErr(false); }, [selKey, stake]);

  // deterministik inceleme: seçim/miktar oturunca 1.2sn sonra kendiliğinden
  useEffect(() => {
    if (!session || count === 0) { setReview(null); return; }
    let alive = true;
    const tm = window.setTimeout(() => {
      fetchCouponReview(selections as unknown as unknown[], stake)
        .then((r) => { if (alive) setReview(r); })
        .catch(() => { if (alive) setReview(null); });
    }, 1200);
    return () => { alive = false; window.clearTimeout(tm); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey, stake, session, count]);

  async function askJudge() {
    setJudging(true); setJudgeText(null); setJudgeErr(false); setJudgeLimited(false);
    try {
      const r = review?.ready ? review : await fetchCouponReview(selections as unknown as unknown[], stake);
      if (!r?.ready) { setJudgeErr(true); return; }
      if (r !== review) setReview(r);
      logEvent('coupon', 'coupon_ai_reviewed', {
        legs: r.legs, total_odds: r.total_odds, ev_pct: r.ev_pct, stake,
      });
      const res = await fetchCouponJudge(r, lang);
      setJudgeText(res.text);
      if (!res.text) {
        if (res.reason === 'limit') setJudgeLimited(true); else setJudgeErr(true);
        return;
      }
      // hakem hafızası: kararname deftere (para yoluna dokunmaz, sessiz)
      void logJudgeVerdict(r, res.text);
    } finally { setJudging(false); }
  }

  function save() {
    saveDraft();
    setSavedMsg(true);
    window.setTimeout(() => setSavedMsg(false), 2200);
  }

  const potential = Math.round(stake * totalOdds);
  const stakeValid = stake > 0 && stake <= balance;
  const hasClosed = selections.some((s) => s.closed);

  // When this slip was opened — lets us measure hesitation (open → play), a core
  // pre-decision risk signal: impulsive vs. deliberated stakes read very differently.
  const openedAt = useRef(Date.now());

  async function place() {
    setError(null); setBusy(true);
    // Snapshot the decision the moment the user commits (moat: stake sizing vs.
    // balance, odds appetite, leg count, hesitation). Post-settle we only know the
    // outcome; the CHOICE lives here.
    const decision = {
      stake, total_odds: totalOdds, legs: count, potential,
      stake_pct_balance: balance > 0 ? Math.round((stake / balance) * 100) : null,
      kinds: selections.map((s) => s.kind),
    };
    const meta = { hesitation_ms: Date.now() - openedAt.current };
    try {
      await matchProvider.placeCoupon(selections, stake);
      logEvent('coupon', 'coupon_placed', decision, meta);
      clear(); await refreshProfile(); setPlaced(true);
    } catch (err) {
      const raw = err instanceof Error ? err.message : '';
      logEvent('coupon', 'coupon_place_failed', { ...decision, reason: raw.slice(0, 80) }, meta);
      // Para yolu: bilinen tokenlar eşlenir, gerisi ASLA ham basılmaz
      // (statement timeout SQL mesajı kullanıcıya sızıyordu) — humanizeError.
      setError(raw.includes('market_closed') ? t('cpn.err.closed')
        : raw.includes('Not enough gold') ? t('cpn.err.funds') : humanizeError(err, t));
    } finally { setBusy(false); }
  }

  return (
    <div className="cpn">
      <div className="cpn-head">
        <span className="cpn-title">{t('cpn.title')}{count > 0 ? ` · ${count}` : ''}</span>
        <div className="row" style={{ gap: 'var(--s2)' }}>
          {count > 0 && <button className="cpn-x" onClick={clear} title={t('cpn.clear')}>{t('cpn.clear')}</button>}
          {onClose && <button className="cpn-x" onClick={onClose} aria-label="Close">✕</button>}
        </div>
      </div>

      {placed && count === 0 ? (
        <div className="cpn-empty">
          <p className="cpn-ok">{t('cpn.placed')}</p>
          <Link to="/coupons" className="btn btn-ghost btn-sm" onClick={onClose}>{t('cpn.view')}</Link>
        </div>
      ) : count === 0 ? (
        <div className="cpn-empty"><p className="dim">{t('cpn.empty')}</p></div>
      ) : (
        <>
          <div className="cpn-legs">
            {selections.map((s) => {
              const fl = flash[s.match_id];
              const legRev: CouponLegReview | undefined = review?.per_leg?.find((l) => l.match_id === s.match_id);
              const th = legRev?.team_history;
              return (
                <div key={s.match_id} className={`cpn-leg ${s.closed ? 'cpn-leg-closed' : ''}`}>
                  <div className="cpn-leg-main">
                    <div className="cpn-leg-match">{s.home_team} - {s.away_team}</div>
                    <div className="cpn-leg-pick">
                      <span className="muted">{s.market_name}:</span> {s.option_label}{' '}
                      <b className={`tnum ${fl ? `fl-${fl}` : ''}`}>{formatOdds(s.odds)}{fl === 'up' ? ' ▲' : fl === 'down' ? ' ▼' : ''}</b>
                      {s.closed && <span className="cpn-closed-chip">{t('cpn.closedchip')}</span>}
                    </div>
                    {th && th.bets >= 3 && (
                      <div className={`cpn-teamhist ${th.net < 0 ? 'neg' : ''}`}>
                        ⟳ {t('aij.teamhist', { team: th.team, n: th.bets, w: th.won })}
                      </div>
                    )}
                  </div>
                  <button className="cpn-rm" onClick={() => remove(s.match_id)} aria-label="Remove">✕</button>
                </div>
              );
            })}
          </div>

          <div className="cpn-foot">
            <div className="cpn-row"><span className="muted">{t('cpn.totalOdds')}</span><b className="tnum">{formatOdds(totalOdds)}</b></div>
            <div className="cpn-stake">
              <input className="input tnum" type="number" min={1} max={session ? balance : undefined} value={stake}
                onChange={(e) => setStake(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
              <div className="cpn-quick">
                {QUICK.map((q) => <button key={q} className="btn btn-sm" onClick={() => setStake(q)}>{q}</button>)}
                {session && <button className="btn btn-sm" disabled={balance <= 0} onClick={() => setStake(balance)}>{t('cpn.max')}</button>}
              </div>
            </div>
            <div className="cpn-row cpn-win"><span>{t('cpn.potential')}</span><b className="tnum">{potential} <span className="coin" aria-hidden="true" /></b></div>

            {session && review?.ready && (
              <div className="ai-card">
                <div className="ai-card-h">✦ {t('aij.title')}</div>
                <div className="ai-nums">
                  <span className="ai-num"><b className="tnum">%{review.combined_prob_pct}</b> {t('aij.prob')}</span>
                  <span className="ai-num ai-neg"><b className="tnum">{review.ev_gold}</b> {t('aij.ev')}</span>
                  {review.riskiest && (
                    <span className="ai-num">{t('aij.risk')}: <b>{review.riskiest.label} @{Number(review.riskiest.odds).toFixed(2)}</b></span>
                  )}
                </div>
                {review.maturity && review.maturity.level !== 'ready' && (
                  <div className="ai-maturity">
                    {t(review.maturity.level === 'new' ? 'aij.maturity.new' : 'aij.maturity.forming',
                      { n: review.maturity.coupons })}
                  </div>
                )}
                {review.history && review.history.similar_played >= 5 && (
                  <div className="ai-hist">
                    {t('aij.hist')
                      .replace('{n}', String(review.history.similar_played))
                      .replace('{w}', String(review.history.similar_won))
                      .replace('{net}', String(review.history.similar_net))}
                  </div>
                )}
                {judgeText ? (
                  <p className="ai-text">{judgeText}</p>
                ) : (
                  <button className="btn btn-ghost btn-block btn-sm ai-btn" style={{ marginTop: 'var(--s2)' }}
                    disabled={judging || judgeLimited} onClick={askJudge}>
                    {judging ? '…' : judgeLimited ? t('aij.limit') : judgeErr ? t('aij.err') : <>✦ {t('aij.ask')}</>}
                  </button>
                )}
              </div>
            )}
            {session && <div className="cpn-bal dim tnum">{t('cpn.balance')}: {balance} <span className="coin" aria-hidden="true" /></div>}
            {error && <div className="banner banner-error" style={{ marginTop: 'var(--s2)' }}>{error}</div>}
            {hasClosed && <div className="banner banner-error" style={{ marginTop: 'var(--s2)' }}>{t('cpn.closedhint')}</div>}

            {session ? (
              <button className="btn btn-primary btn-block" style={{ marginTop: 'var(--s2)' }} disabled={busy || !stakeValid || hasClosed} onClick={place}>
                {busy ? '…' : <>{t('cpn.playnow')} · {stake} <span className="coin coin-light" aria-hidden="true" /></>}
              </button>
            ) : (
              <button className="btn btn-primary btn-block" style={{ marginTop: 'var(--s2)' }} onClick={() => { onClose?.(); navigate('/login'); }}>
                {t('cpn.loginToPlay')}
              </button>
            )}
            <button className="btn btn-ghost btn-block btn-sm" style={{ marginTop: 'var(--s2)' }} onClick={save}>
              {savedMsg ? t('cpn.saved') : t('cpn.save')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
