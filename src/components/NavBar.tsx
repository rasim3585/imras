import { NavLink, Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Brand } from './Brand';
import { MarketsIcon, CouponIcon, RanksIcon, SocialIcon, ProfileIcon } from './icons';

const NAV = [
  { to: '/', end: true, label: 'Markets', Icon: MarketsIcon },
  { to: '/coupons', end: false, label: 'Coupons', Icon: CouponIcon },
  { to: '/ranks', end: false, label: 'Ranks', Icon: RanksIcon },
  { to: '/social', end: false, label: 'Social', Icon: SocialIcon },
  { to: '/profile', end: false, label: 'Profile', Icon: ProfileIcon },
];

const SOON = ['AI Predict', 'Watch Live', 'Lucky Games'];

export default function NavBar() {
  const { profile, signOut } = useAuth();

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Brand />
          <div className="topbar-right">
            {profile ? (
              <>
                <span className="gold-chip" title="Gold balance">
                  <span className="gold-dot" aria-hidden="true" />
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
            <Icon />
            {label}
          </NavLink>
        ))}
        <div className="side-soon">
          <span className="tag">Coming soon</span>
          {SOON.map((s) => <span key={s} className="side-item is-soon">{s}</span>)}
        </div>
      </nav>

      {/* mobile bottom bar */}
      <nav className="tabbar">
        <div className="tabbar-inner">
          {NAV.map(({ to, end, label, Icon }) => (
            <NavLink key={to} to={to} end={end} className="tab">
              <Icon />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
    </>
  );
}
