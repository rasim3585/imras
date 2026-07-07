import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Brand } from './Brand';
import { MarketsIcon, ProfileIcon } from './icons';

export default function NavBar() {
  const { profile, signOut } = useAuth();

  return (
    <>
      <header className="topbar">
        <div className="app-shell topbar-inner">
          <Brand />
          <div className="topbar-right">
            {profile && (
              <span className="chip" title="Skill rating">
                <span className="tag" style={{ color: 'inherit' }}>SR</span>
                {profile.skill_rating}
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
          <NavLink to="/profile" className="tab">
            <ProfileIcon />
            Profile
          </NavLink>
        </div>
      </nav>
    </>
  );
}
