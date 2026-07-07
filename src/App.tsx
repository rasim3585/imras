import { isSupabaseConfigured } from './lib/supabase';

// Phase 1 placeholder. Routing, auth and the four screens (Feed / Reveal /
// Profile / Auth) land in later phases and replace this.
function App() {
  return (
    <div className="center-screen">
      <div className="card" style={{ maxWidth: 460, padding: '32px 28px', textAlign: 'center' }}>
        <div className="pill" style={{ margin: '0 auto 16px' }}>PICKPLAY.AI</div>
        <h1>predict. watch. be right.</h1>
        <p className="muted" style={{ marginTop: 12 }}>
          Turn what you know into a call, watch it play out minute by minute, and
          see how sharp your read really is. No money. Just accuracy, streaks, and
          the thrill of being right.
        </p>
        <p className="dim" style={{ marginTop: 24, fontSize: '0.85rem' }}>
          {isSupabaseConfigured
            ? 'Supabase connected — scaffolding ready.'
            : 'Setup: copy .env.example → .env and add your Supabase keys.'}
        </p>
      </div>
    </div>
  );
}

export default App;
