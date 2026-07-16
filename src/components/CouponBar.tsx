import { useLocation, useNavigate } from 'react-router-dom';
import { useCart } from '../coupon/CartContext';
import { formatOdds } from '../lib/format';
import { useI18n } from '../i18n/LanguageContext';

// Sticky slip summary that floats above the tab bar whenever the coupon has
// selections — the "open your coupon" affordance, accessible from any screen.
export default function CouponBar() {
  const { count, totalOdds } = useCart();
  const { t } = useI18n();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  if (count === 0 || pathname === '/coupon') return null;

  return (
    <div className="coupon-bar">
      <div className="app-shell coupon-bar-inner">
        <div className="coupon-bar-info">
          <span className="chip chip-accent">{count}</span>
          <span className="coupon-bar-odds">
            <span className="muted">{t('cpn.totalOdds')}</span>{' '}
            <b className="tnum">{formatOdds(totalOdds)}</b>
          </span>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => navigate('/coupon')}>
          {t('cb.open')}
        </button>
      </div>
    </div>
  );
}
