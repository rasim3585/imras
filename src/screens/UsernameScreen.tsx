import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/LanguageContext';

// Onboarding step: the signup trigger gave the user a provisional handle;
// here they claim a real one via the set_username RPC (validated server-side).
export default function UsernameScreen() {
  const { refreshProfile, signOut } = useAuth();
  const { t } = useI18n();
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
      setError(err instanceof Error ? err.message : t('user.err'));
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <div className="auth-card card">
        <div style={{ marginBottom: 'var(--s5)' }}>
          <h1 style={{ marginBottom: 6 }}>{t('user.title')}</h1>
          <p className="page-sub">{t('user.sub')}</p>
        </div>

        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="username">{t('user.label')}</label>
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
            {busy ? '…' : t('user.continue')}
          </button>
        </form>

        <button className="btn btn-ghost btn-block" style={{ marginTop: 'var(--s2)' }} onClick={signOut}>
          {t('user.signout')}
        </button>
      </div>
    </div>
  );
}
