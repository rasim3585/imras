import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Brand } from './Brand';
import { MarketsIcon, CouponIcon, RanksIcon, SocialIcon, ProfileIcon } from './icons';

export default function NavBar() {
  const { profile, signOut } = useAuth();

  return (
    <>
      <header className="topbar">
        <div className="app-shell topbar-inner">
          <Brand />
          <div className="topbar-right">
            {profile && (
              <span className="chip" title="Gold balance">
                <span className="tnum">{profile.gold_balance.toLocaleString()}</span>
                <span className="tag" style={{ color: 'inherit' }}>gold</span>
              </span>
            )}
            <button className="btn btn-ghost btn-sm" onClick={signOut}>Sign out</button>
          </div>
        </div>
      </header>

      <nav className="tabbar">
        <div className="app-shell tabbar-inner">
          <NavLink to="/" end className="tab">
            <MarketsIcon />
            Markets
          </NavLink>
          <NavLink to="/coupons" className="tab">
            <CouponIcon />
            Coupons
          </NavLink>
          <NavLink to="/ranks" className="tab">
            <RanksIcon />
            Ranks
          </NavLink>
          <NavLink to="/social" className="tab">
            <SocialIcon />
            Social
          </NavLink>
          <NavLink to="/profile" className="tab">
            <ProfileIcon />
            Profile
          </NavLink>
        </div>
      </nav>
    </>
  );
}
