import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect, type ReactNode } from 'react';
import { useAuth } from './auth/AuthContext';
import { logEvent } from './lib/behaviorLog';
import SharedCouponScreen from './screens/SharedCouponScreen';
import AuthScreen from './screens/AuthScreen';
import UsernameScreen from './screens/UsernameScreen';
import FeedScreen from './screens/FeedScreen';
import MatchDetailScreen from './screens/MatchDetailScreen';
import CouponScreen from './screens/CouponScreen';
import MyCouponsScreen from './screens/MyCouponsScreen';
import SettleScreen from './screens/SettleScreen';
import LiveMatchScreen from './screens/LiveMatchScreen';
import LiveCourtScreen from './screens/LiveCourtScreen';
import AviatorScreen from './screens/AviatorScreen';
import GatesScreen from './screens/GatesScreen';
import MinesScreen from './screens/MinesScreen';
import DiceScreen from './screens/DiceScreen';
import PlinkoScreen from './screens/PlinkoScreen';
import AnalizScreen from './screens/AnalizScreen';
import StandingsScreen from './screens/StandingsScreen';
import TeamScreen from './screens/TeamScreen';
import ProfileScreen from './screens/ProfileScreen';
import LeaderboardScreen from './screens/LeaderboardScreen';
import SocialScreen from './screens/SocialScreen';
import LeagueDetailScreen from './screens/LeagueDetailScreen';
import NavBar from './components/NavBar';
import CouponDock from './components/CouponDock';

// Module-level (stable identity) so guarded routes don't remount every time the
// auth context re-renders (that remount restarted screens like the settle reveal).
function RequireAuth({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  return session ? <>{children}</> : <Navigate to="/login" replace />;
}

function App() {
  const { loading, session, needsUsername } = useAuth();
  const loc = useLocation();

  // Oturum başlangıcı — davranış moat'ının zaman çerçevesi (ne zaman, ne sıklıkta
  // geliyor). Giriş yapıldığında bir kez; log_events null-uid'yi zaten düşürür.
  useEffect(() => {
    if (session) logEvent('app', 'session_start');
  }, [session]);

  // Sayfa başına tarayıcı başlığı (profesyonel sekme + tarihçe okunurluğu).
  useEffect(() => {
    const base = 'imras — Risk Awareness System';
    const seg = '/' + (loc.pathname.split('/')[1] || '');
    const map: Record<string, string> = {
      '/aviator': 'Aviator', '/gates': 'Gates of Goal', '/mines': 'Mines', '/dice': 'Dice',
      '/plinko': 'Plinko', '/coupons': 'My Coupons', '/analysis': 'AI Analysis', '/ranks': 'Ranks',
      '/social': 'Social', '/profile': 'Profile', '/standings': 'League Tables',
      '/live': 'Live', '/match': 'Match', '/login': 'Sign in',
    };
    document.title = map[seg] ? `${map[seg]} · imras` : base;
  }, [loc.pathname]);

  // public shared-coupon link: standalone, no nav, no auth gate
  if (loc.pathname.startsWith('/c/')) {
    return (
      <Routes>
        <Route path="/c/:token" element={<SharedCouponScreen />} />
      </Routes>
    );
  }

  if (loading) {
    return <div className="center-screen"><div className="spinner" /></div>;
  }

  // signed in but no username yet -> must pick one before anything else
  if (session && needsUsername) return <UsernameScreen />;

  return (
    <>
      <NavBar />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<FeedScreen />} />
          <Route path="/match/:matchId" element={<MatchDetailScreen />} />
          <Route path="/live/:matchId" element={<LiveMatchScreen />} />
          <Route path="/court/:matchId" element={<LiveCourtScreen />} />
          <Route path="/aviator" element={<AviatorScreen />} />
          <Route path="/gates" element={<GatesScreen />} />
          <Route path="/mines" element={<MinesScreen />} />
          <Route path="/dice" element={<DiceScreen />} />
          <Route path="/plinko" element={<PlinkoScreen />} />
          <Route path="/standings" element={<StandingsScreen />} />
          <Route path="/team/:teamId" element={<TeamScreen />} />
          <Route path="/coupon" element={<CouponScreen />} />
          <Route path="/login" element={session ? <Navigate to="/" replace /> : <AuthScreen />} />
          <Route path="/coupons" element={<RequireAuth><MyCouponsScreen /></RequireAuth>} />
          <Route path="/settle/:couponId" element={<RequireAuth><SettleScreen /></RequireAuth>} />
          {/* 0716: rota İngilizce — /analiz eski linkler için yönlendirme */}
          <Route path="/analysis" element={<RequireAuth><AnalizScreen /></RequireAuth>} />
          <Route path="/analiz" element={<Navigate to="/analysis" replace />} />
          <Route path="/ranks" element={<RequireAuth><LeaderboardScreen /></RequireAuth>} />
          <Route path="/social" element={<RequireAuth><SocialScreen /></RequireAuth>} />
          <Route path="/league/:leagueId" element={<RequireAuth><LeagueDetailScreen /></RequireAuth>} />
          <Route path="/profile" element={<RequireAuth><ProfileScreen /></RequireAuth>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <CouponDock />
    </>
  );
}

export default App;
