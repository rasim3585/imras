import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import AuthScreen from './screens/AuthScreen';
import UsernameScreen from './screens/UsernameScreen';
import FeedScreen from './screens/FeedScreen';
import CouponScreen from './screens/CouponScreen';
import MyCouponsScreen from './screens/MyCouponsScreen';
import SettleScreen from './screens/SettleScreen';
import ProfileScreen from './screens/ProfileScreen';
import NavBar from './components/NavBar';

function App() {
  const { loading, session, needsUsername } = useAuth();

  if (loading) {
    return (
      <div className="center-screen">
        <div className="spinner" />
      </div>
    );
  }

  if (!session) return <AuthScreen />;
  if (needsUsername) return <UsernameScreen />;

  return (
    <>
      <NavBar />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<FeedScreen />} />
          <Route path="/coupon" element={<CouponScreen />} />
          <Route path="/coupons" element={<MyCouponsScreen />} />
          <Route path="/settle/:couponId" element={<SettleScreen />} />
          <Route path="/profile" element={<ProfileScreen />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  );
}

export default App;
