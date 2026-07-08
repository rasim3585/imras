import { Routes, Route, Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from './auth/AuthContext';
import AuthScreen from './screens/AuthScreen';
import UsernameScreen from './screens/UsernameScreen';
import FeedScreen from './screens/FeedScreen';
import MatchDetailScreen from './screens/MatchDetailScreen';
import CouponScreen from './screens/CouponScreen';
import MyCouponsScreen from './screens/MyCouponsScreen';
import SettleScreen from './screens/SettleScreen';
import LiveMatchScreen from './screens/LiveMatchScreen';
import ProfileScreen from './screens/ProfileScreen';
import LeaderboardScreen from './screens/LeaderboardScreen';
import SocialScreen from './screens/SocialScreen';
import LeagueDetailScreen from './screens/LeagueDetailScreen';
import NavBar from './components/NavBar';
import CouponBar from './components/CouponBar';

function App() {
  const { loading, session, needsUsername } = useAuth();

  if (loading) {
    return <div className="center-screen"><div className="spinner" /></div>;
  }

  // signed in but no username yet -> must pick one before anything else
  if (session && needsUsername) return <UsernameScreen />;

  // browse freely; auth-required routes send you to /login (the commitment point)
  const RequireAuth = ({ children }: { children: ReactNode }) =>
    (session ? <>{children}</> : <Navigate to="/login" replace />);

  return (
    <>
      <NavBar />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<FeedScreen />} />
          <Route path="/match/:matchId" element={<MatchDetailScreen />} />
          <Route path="/live/:matchId" element={<LiveMatchScreen />} />
          <Route path="/coupon" element={<CouponScreen />} />
          <Route path="/login" element={session ? <Navigate to="/" replace /> : <AuthScreen />} />
          <Route path="/coupons" element={<RequireAuth><MyCouponsScreen /></RequireAuth>} />
          <Route path="/settle/:couponId" element={<RequireAuth><SettleScreen /></RequireAuth>} />
          <Route path="/ranks" element={<RequireAuth><LeaderboardScreen /></RequireAuth>} />
          <Route path="/social" element={<RequireAuth><SocialScreen /></RequireAuth>} />
          <Route path="/league/:leagueId" element={<RequireAuth><LeagueDetailScreen /></RequireAuth>} />
          <Route path="/profile" element={<RequireAuth><ProfileScreen /></RequireAuth>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <CouponBar />
    </>
  );
}

export default App;
