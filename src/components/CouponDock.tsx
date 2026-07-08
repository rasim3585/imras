import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useCart } from '../coupon/CartContext';
import CouponPanel from '../coupon/CouponPanel';
import MiniWatch from '../coupon/MiniWatch';
import { formatOdds } from '../lib/format';

// Quick betting. Desktop: a fixed right column that is ALWAYS reserved (the
// bulletin never shifts) -- coupon on top, a mini live-watch of the last-added
// match below. Mobile: a bottom bar that opens a sheet (no reserved space).
export default function CouponDock() {
  const { count, totalOdds, selections } = useCart();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  if (pathname === '/coupon' || pathname.startsWith('/c/') || pathname.startsWith('/login')) return null;

  const lastMatch = selections.length ? selections[selections.length - 1].match_id : null;

  return (
    <>
      {/* desktop: always-reserved right column */}
      <aside className="coupon-dock">
        {count > 0 ? (
          <div className="dock-stack">
            <CouponPanel />
            {lastMatch && <MiniWatch matchId={lastMatch} />}
          </div>
        ) : (
          <div className="dock-empty"><p className="dim">Tap any odds to start a coupon.</p></div>
        )}
      </aside>

      {/* mobile: bottom bar + sheet (only with picks) */}
      {count > 0 && (
        <>
          <div className="coupon-bar">
            <div className="coupon-bar-inner">
              <div className="coupon-bar-info">
                <span className="chip chip-accent">{count}</span>
                <span className="coupon-bar-odds"><span className="muted">Total odds</span> <b className="tnum">{formatOdds(totalOdds)}</b></span>
              </div>
              <button className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>Coupon</button>
            </div>
          </div>
          {open && (
            <div className="coupon-sheet-back" onClick={() => setOpen(false)}>
              <div className="coupon-sheet" onClick={(e) => e.stopPropagation()}>
                <CouponPanel onClose={() => setOpen(false)} />
                {lastMatch && <MiniWatch matchId={lastMatch} />}
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
