import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export default function NavBar() {
  const { profile, signOut } = useAuth();

  return (
    <>
      <header className="app-bar">
        <div className="app-shell app-bar-inner">
          <div className="row">
            <span className="brand-mark" aria-hidden="true">◎</span>
            <span className="brand-name">pickplay</span>
          </div>
          <div className="row">
            {profile && (
              <span className="pill" title="Skill rating">
                {profile.skill_rating} SR
              </span>
            )}
            <button className="btn btn-ghost btn-sm" onClick={signOut}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      <nav className="tab-bar">
        <div className="app-shell tab-bar-inner">
          <NavLink to="/" end className="tab">
            <span className="tab-glyph" aria-hidden="true">◎</span>
            Feed
          </NavLink>
          <NavLink to="/profile" className="tab">
            <span className="tab-glyph" aria-hidden="true">◈</span>
            Profile
          </NavLink>
        </div>
      </nav>
    </>
  );
}
