// Stub — the reveal experience (staged score animation + scoring) lands in
// Phase 6. Kept minimal so the route compiles.
import { useNavigate } from 'react-router-dom';

export default function RevealScreen() {
  const navigate = useNavigate();
  return (
    <div className="app-shell">
      <div className="empty-state">
        <p>Reveal coming in Phase 6.</p>
        <button className="btn" style={{ marginTop: 14 }} onClick={() => navigate('/')}>
          Back to feed
        </button>
      </div>
    </div>
  );
}
