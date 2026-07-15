import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useCart } from '../coupon/CartContext';
import CouponPanel from '../coupon/CouponPanel';
import MiniWatch, { type MiniSport } from '../coupon/MiniWatch';
import { formatOdds } from '../lib/format';
import { useI18n } from '../i18n/LanguageContext';

// Quick betting. Desktop: a fixed right column that is ALWAYS reserved (the
// bulletin never shifts) -- coupon on top, a mini live-watch of the last-added
// match below. Mobile: a bottom bar that opens a sheet (no reserved space).
export default function CouponDock() {
  const { count, totalOdds, selections } = useCart();
  const { pathname } = useLocation();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  // 0715: kupon paneli yalnız bahis akışında görünür (bülten, maç detay, canlı
  // izleme). Gates/Aviator/AI Analiz/Profil gibi sayfalarda gereksizdi.
  const betting = pathname === '/'
    || pathname.startsWith('/match') || pathname.startsWith('/live')
    || pathname.startsWith('/court') || pathname.startsWith('/standings');
  if (!betting) return null;

  // 0715: mini izleme yalnız SANAL maçlarda anlamlı (gerçek maçın simülasyonu
  // yok) — son sanal seçimi göster; spor, market tipinin önekinden gelir.
  const lastVirtual = [...selections].reverse().find((s) => s.kind === 'virtual') ?? null;
  const sportOf = (mt: string): MiniSport =>
    mt.startsWith('bb_') ? 'basketball' : mt.startsWith('tn_') ? 'tennis'
      : mt.startsWith('vb_') ? 'volleyball' : 'football';

  return (
    <>
      {/* desktop: always-reserved right column */}
      <aside className="coupon-dock">
        {count > 0 ? (
          <div className="dock-stack">
            <CouponPanel />
            {lastVirtual && <MiniWatch matchId={lastVirtual.match_id} sport={sportOf(lastVirtual.market_type)} />}
          </div>
        ) : (
          <div className="dock-empty"><p className="dim">{t('dock.empty')}</p></div>
        )}
      </aside>

      {/* mobile: bottom bar + sheet (only with picks) */}
      {count > 0 && (
        <>
          <div className="coupon-bar">
            <div className="coupon-bar-inner">
              <div className="coupon-bar-info">
                <span className="chip chip-accent">{count}</span>
                <span className="coupon-bar-odds"><span className="muted">{t('cpn.totalOdds')}</span> <b className="tnum">{formatOdds(totalOdds)}</b></span>
              </div>
              <button className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>{t('dock.coupon')}</button>
            </div>
          </div>
          {open && (
            <div className="coupon-sheet-back" onClick={() => setOpen(false)}>
              <div className="coupon-sheet" onClick={(e) => e.stopPropagation()}>
                <CouponPanel onClose={() => setOpen(false)} />
                {lastVirtual && <MiniWatch matchId={lastVirtual.match_id} sport={sportOf(lastVirtual.market_type)} />}
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
