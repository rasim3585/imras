import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useCart } from '../coupon/CartContext';
import CouponPanel from '../coupon/CouponPanel';
import { formatOdds } from '../lib/format';

// Nesine-style quick betting: a sticky "My coupon" panel on desktop, a bottom
// bar that opens a sheet on mobile. Bet from the panel without changing screens.
export default function CouponDock() {
  const { count, totalOdds } = useCart();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  if (pathname === '/coupon' || pathname.startsWith('/c/') || pathname.startsWith('/login')) return null;

  return (
    <>
      {/* desktop: reserved sticky panel */}
      <aside className="coupon-dock"><CouponPanel /></aside>

      {/* mobile: compact bottom bar */}
      {count > 0 && (
        <div className="coupon-bar">
          <div className="coupon-bar-inner">
            <div className="coupon-bar-info">
              <span className="chip chip-accent">{count}</span>
              <span className="coupon-bar-odds"><span className="muted">Total odds</span> <b className="tnum">{formatOdds(totalOdds)}</b></span>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>Coupon</button>
          </div>
        </div>
      )}

      {/* mobile: bottom sheet */}
      {open && (
        <div className="coupon-sheet-back" onClick={() => setOpen(false)}>
          <div className="coupon-sheet" onClick={(e) => e.stopPropagation()}>
            <CouponPanel onClose={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
