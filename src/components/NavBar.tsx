import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useCart } from '../coupon/CartContext';
import { Brand } from './Brand';
import { MarketsIcon, CouponIcon, RanksIcon, SocialIcon, ProfileIcon, HomeIcon, AviatorIcon, GatesIcon, CoinIcon } from './icons';

const NAV = [
  { to: '/', end: true, label: 'Matches', Icon: MarketsIcon },
  { to: '/aviator', end: false, label: 'Aviator', Icon: AviatorIcon },
  { to: '/gates', end: false, label: 'Gates', Icon: GatesIcon },
  { to: '/coupons', end: false, label: 'Coupons', Icon: CouponIcon },
  { to: '/ranks', end: false, label: 'Ranks', Icon: RanksIcon },
  { to: '/social', end: false, label: 'Social', Icon: SocialIcon },
  { to: '/profile', end: false, label: 'Profile', Icon: ProfileIcon },
];

// Top-right balance: counts up on a win and floats a green "+amount" below it.
function BalanceChip({ balance }: { balance: number }) {
  const [display, setDisplay] = useState(balance);
  const [gain, setGain] = useState<number | null>(null);
  const prev = useRef(balance);

  useEffect(() => {
    const from = prev.current;
    const to = balance;
    prev.current = to;
    if (to <= from) { setDisplay(to); return; }   // bet placed / no change → snap
    setGain(to - from);
    const clr = window.setTimeout(() => setGain(null), 2600);
    let raf = 0;
    const start = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / 700);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(from + (to - from) * eased));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); window.clearTimeout(clr); };
  }, [balance]);

  return (
    <span className={`gold-chip ${gain != null ? 'is-gain' : ''}`} title="Virtual coins">
      <CoinIcon size={15} />
      <span className="tnum">{display.toLocaleString()}</span>
      {gain != null && <span className="gold-gain tnum">+{gain.toLocaleString()}</span>}
    </span>
  );
}

export default function NavBar() {
  const { profile, signOut } = useAuth();
  const { count } = useCart();

  // icon + an active-selection count badge on the Coupons item
  const navIcon = (icon: ReactNode, to: string) => (
    <span className="nav-ic">
      {icon}
      {to === '/coupons' && count > 0 && <span className="nav-badge tnum">{count}</span>}
    </span>
  );

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Brand />
          <div className="topbar-right">
            <NavLink to="/" end className="home-btn" title="Home" aria-label="Home"><HomeIcon /></NavLink>
            {profile ? (
              <>
                <BalanceChip balance={profile.gold_balance} />
                <button className="btn btn-ghost btn-sm" onClick={signOut}>Sign out</button>
              </>
            ) : (
              <nav className="top-auth">
                <NavLink to="/" end className="top-link">Home</NavLink>
                <Link to="/login" className="top-link">Log in</Link>
                <Link to="/login" className="btn btn-primary btn-sm">Sign up</Link>
              </nav>
            )}
          </div>
        </div>
      </header>

      {/* desktop sidebar */}
      <nav className="sidebar">
        {NAV.map(({ to, end, label, Icon }) => (
          <NavLink key={to} to={to} end={end} className="side-item">
            {navIcon(<Icon />, to)}
            {label}
          </NavLink>
        ))}
      </nav>

      {/* mobile bottom bar */}
      <nav className="tabbar">
        <div className="tabbar-inner">
          {NAV.map(({ to, end, label, Icon }) => (
            <NavLink key={to} to={to} end={end} className="tab">
              {navIcon(<Icon />, to)}
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
    </>
  );
}
