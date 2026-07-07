import { useAuth } from './auth/AuthContext';
import AuthScreen from './screens/AuthScreen';
import UsernameScreen from './screens/UsernameScreen';

// Auth gate. Routing + the Feed/Reveal/Profile screens are added in Phase 5+.
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

  // Placeholder for the signed-in app until Phase 5 wires the router.
  return (
    <div className="center-screen">
      <div className="card" style={{ padding: 28, textAlign: 'center' }}>
        <div className="pill pill-hit" style={{ margin: '0 auto 12px' }}>SIGNED IN</div>
        <h2>You're in.</h2>
        <p className="muted" style={{ marginTop: 8 }}>Feed, Reveal and Profile land next.</p>
      </div>
    </div>
  );
}

export default App;
