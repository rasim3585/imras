import type { ReactNode } from 'react';
import { NavLink, Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useCart } from '../coupon/CartContext';
import { Brand } from './Brand';
import { MarketsIcon, CouponIcon, RanksIcon, SocialIcon, ProfileIcon, HomeIcon, AviatorIcon, CoinIcon } from './icons';

const NAV = [
  { to: '/', end: true, label: 'Matches', Icon: MarketsIcon },
  { to: '/aviator', end: false, label: 'Aviator', Icon: AviatorIcon },
  { to: '/coupons', end: false, label: 'Coupons', Icon: CouponIcon },
  { to: '/ranks', end: false, label: 'Ranks', Icon: RanksIcon },
  { to: '/social', end: false, label: 'Social', Icon: SocialIcon },
  { to: '/profile', end: false, label: 'Profile', Icon: ProfileIcon },
];

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
                <span className="gold-chip" title="Virtual coins">
                  <CoinIcon size={15} />
                  <span className="tnum">{profile.gold_balance.toLocaleString()}</span>
                </span>
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
