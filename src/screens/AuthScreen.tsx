import { useState, type FormEvent } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Brand } from '../components/Brand';

type Mode = 'signin' | 'signup';

export default function AuthScreen() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleEmail(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        // If email confirmation is on, there's no session yet.
        if (!data.session) {
          setNotice('Check your email to confirm, then sign in.');
          setMode('signin');
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      // On success, AuthProvider's listener takes over and the app re-routes.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogle() {
    setError(null);
    setBusy(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (error) {
      setError(error.message);
      setBusy(false);
    }
    // On success the browser is redirected to Google.
  }

  return (
    <div className="center-screen">
      <div className="auth-card card">
        <Brand size={24} />

        {!isSupabaseConfigured && (
          <div className="banner">
            Supabase isn't configured yet. Add your keys to <code>.env</code> to
            sign in.
          </div>
        )}

        <div className="segmented">
          <button
            className={`segmented-item ${mode === 'signin' ? 'active' : ''}`}
            onClick={() => setMode('signin')}
            type="button"
          >
            Sign in
          </button>
          <button
            className={`segmented-item ${mode === 'signup' ? 'active' : ''}`}
            onClick={() => setMode('signup')}
            type="button"
          >
            Create account
          </button>
        </div>

        <form onSubmit={handleEmail}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              className="input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              className="input"
              type="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              required
            />
          </div>

          {error && <div className="banner banner-error">{error}</div>}
          {notice && <div className="banner">{notice}</div>}

          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
            {busy ? '…' : mode === 'signup' ? 'Create account' : 'Sign in'}
          </button>
        </form>

        <div className="divider">or</div>

        <button
          className="btn btn-block"
          type="button"
          onClick={handleGoogle}
          disabled={busy}
        >
          Continue with Google
        </button>

        <p className="auth-legal">
          No money, no wagering — accuracy is the only score.
        </p>
      </div>
    </div>
  );
}
