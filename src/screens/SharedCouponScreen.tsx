import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { matchProvider } from '../lib/matchProvider';
import { LogoMarkLarge, Wordmark } from '../components/Brand';
import { formatOdds } from '../lib/format';
import { useI18n } from '../i18n/LanguageContext';
import type { SharedCoupon } from '../lib/types';

// Public, no-auth preview of a shared coupon (the target of an external link).
// Viral edinim kapısı: 8 dilde konuşur; ağ hatası ile "link yok"u karıştırmaz
// (WhatsApp'tan gelen ilk-temas kullanıcısına yanlış teşhis koymayız).
export default function SharedCouponScreen() {
  const { token } = useParams<{ token: string }>();
  const { t } = useI18n();
  const [coupon, setCoupon] = useState<SharedCoupon | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'missing' | 'error'>('loading');

  const load = useCallback(() => {
    if (!token) return;
    setState('loading');
    matchProvider.getSharedCoupon(token)
      .then((c) => { setCoupon(c); setState(c ? 'ok' : 'missing'); })
      .catch(() => setState('error'));
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const legs = coupon?.legs ?? [];
  const won = coupon?.status === 'won';

  return (
    <div className="share-page">
      <div className="share-card card">
        <Link to="/" className="share-brand"><LogoMarkLarge size={44} /><Wordmark size={18} /></Link>

        {state === 'loading' && <div className="center-pad"><div className="spinner" /></div>}
        {state === 'missing' && (
          <div className="empty" style={{ marginTop: 'var(--s4)' }}>
            <p>{t('sc.unavail')}</p>
            <Link to="/" className="btn btn-primary">{t('sc.explore')}</Link>
          </div>
        )}
        {state === 'error' && (
          <div className="empty" style={{ marginTop: 'var(--s4)' }}>
            <p>{t('err.offline')}</p>
            <button className="btn btn-primary" onClick={load}>{t('common.retry')}</button>
          </div>
        )}

        {state === 'ok' && coupon && (
          <>
            <div className="share-head">
              <span className="tag">{t('sc.coupon', { u: coupon.username })}</span>
              <span className={`chip ${won ? 'chip-pos' : coupon.status === 'lost' ? 'chip-neg' : ''}`}>
                {won ? `${t('mc.st.won')} +${coupon.potential_win}` : coupon.status === 'lost' ? t('mc.st.lost') : coupon.status === 'cashed_out' ? t('mc.st.cashedout') : legs.length === 1 ? t('mc.single') : t('mc.fold', { n: legs.length })}
              </span>
            </div>

            <div className="coupon-legs" style={{ marginTop: 'var(--s3)' }}>
              {legs.map((s) => (
                <div key={s.option_id} className={`coupon-leg ${s.status === 'won' ? 'leg-hit' : s.status === 'lost' ? 'leg-miss' : ''}`}>
                  <span className="leg-match">{s.home_team} vs {s.away_team}</span>
                  <span className="leg-pick tnum"><span className="muted">{s.market_name}:</span> {s.option_label} @ {formatOdds(s.odds)}</span>
                </div>
              ))}
            </div>

            <div className="share-metrics">
              <div><span className="muted">{t('cpn.totalOdds')}</span><b className="tnum">{formatOdds(coupon.total_odds)}</b></div>
              <div><span className="muted">{won ? t('mc.st.won') : t('sc.potential')}</span><b className="tnum">{coupon.potential_win}</b></div>
            </div>

            <div className="share-cta">
              <p>{t('sc.play')}</p>
              <Link to="/login" className="btn btn-primary btn-block">{t('sc.signup')}</Link>
              <Link to="/" className="btn btn-ghost btn-block" style={{ marginTop: 'var(--s2)' }}>{t('sc.browse')}</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
