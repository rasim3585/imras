import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';

// Onboarding step: the signup trigger gave the user a provisional handle;
// here they claim a real one via the set_username RPC (validated server-side).
export default function UsernameScreen() {
  const { refreshProfile, signOut } = useAuth();
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { error } = await supabase.rpc('set_username', { p_username: username });
      if (error) throw error;
      await refreshProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set username');
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <div className="auth-card card">
        <div className="page-head" style={{ padding: '4px 0 8px' }}>
          <div className="eyebrow">One last thing</div>
          <h1 style={{ marginTop: 6 }}>Pick your handle</h1>
          <p className="sub">This is how your calls are tracked. 3–20 characters.</p>
        </div>

        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. sharp_call_07"
              pattern="[A-Za-z0-9_]{3,20}"
              autoFocus
              required
            />
          </div>

          {error && <div className="banner banner-error">{error}</div>}

          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
            {busy ? '…' : 'Start playing'}
          </button>
        </form>

        <button className="btn btn-ghost btn-block" style={{ marginTop: 10 }} onClick={signOut}>
          Sign out
        </button>
      </div>
    </div>
  );
}
