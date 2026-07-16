import { useState, type FormEvent } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { LogoMarkLarge, Wordmark } from '../components/Brand';
import { useI18n } from '../i18n/LanguageContext';
import { mapAuthError } from '../lib/errors';

type Mode = 'signin' | 'signup' | 'forgot';

export default function AuthScreen() {
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function switchMode(m: Mode) {
    setMode(m);
    setError(null);
    setNotice(null);
  }

  async function handleEmail(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + '/reset',
        });
        if (error) throw error;
        setNotice(t('auth.resetSent'));
        setMode('signin');
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        // Var olan e-posta: Supabase enumeration koruması hata DÖNDÜRMEZ —
        // user dolu ama identities boş gelir. "E-postanı doğrula" çıkmazına
        // sokma, gerçeği söyle.
        if (data.user && (data.user.identities?.length ?? 0) === 0) {
          setError(t('auth.exists'));
          setMode('signin');
        } else if (!data.session) {
          // Email confirmation açık: henüz oturum yok.
          setNotice(t('auth.confirm'));
          setMode('signin');
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      // On success, AuthProvider's listener takes over and the app re-routes.
    } catch (err) {
      setError(mapAuthError(err, t));
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
      setError(mapAuthError(error, t));
      setBusy(false);
    }
    // On success the browser is redirected to Google.
  }

  return (
    <div className="center-screen">
      <div className="auth-card card">
        <div className="auth-hero" style={{ flexDirection: 'column', gap: 'var(--s3)' }}>
          <LogoMarkLarge size={72} />
          <Wordmark size={30} />
        </div>

        {!isSupabaseConfigured && (
          <div className="banner">
            Supabase isn't configured yet. Add your keys to <code>.env</code> to
            sign in.
          </div>
        )}

        {mode !== 'forgot' && (
          <div className="segmented">
            <button
              className={`segmented-item ${mode === 'signin' ? 'active' : ''}`}
              onClick={() => switchMode('signin')}
              type="button"
            >
              {t('auth.signin')}
            </button>
            <button
              className={`segmented-item ${mode === 'signup' ? 'active' : ''}`}
              onClick={() => switchMode('signup')}
              type="button"
            >
              {t('auth.signup')}
            </button>
          </div>
        )}
        {mode === 'forgot' && <h2 style={{ fontSize: 16, margin: '0 0 var(--s3)' }}>{t('auth.forgot')}</h2>}

        <form onSubmit={handleEmail}>
          <div className="field">
            <label htmlFor="email">{t('auth.email')}</label>
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
          {mode !== 'forgot' && (
            <div className="field">
              <label htmlFor="password">{t('auth.password')}</label>
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
          )}

          {error && <div className="banner banner-error">{error}</div>}
          {notice && <div className="banner">{notice}</div>}

          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
            {busy ? '…' : mode === 'forgot' ? t('auth.sendReset') : mode === 'signup' ? t('auth.signup') : t('auth.signin')}
          </button>
        </form>

        {mode === 'signin' && (
          <button className="btn btn-ghost btn-block" type="button" style={{ marginTop: 'var(--s2)' }} onClick={() => switchMode('forgot')}>
            {t('auth.forgot')}
          </button>
        )}
        {mode === 'forgot' && (
          <button className="btn btn-ghost btn-block" type="button" style={{ marginTop: 'var(--s2)' }} onClick={() => switchMode('signin')}>
            {t('auth.back')}
          </button>
        )}

        {mode !== 'forgot' && (
          <>
            <div className="divider">{t('auth.or')}</div>

            <button
              className="btn btn-block"
              type="button"
              onClick={handleGoogle}
              disabled={busy}
            >
              {t('auth.google')}
            </button>
          </>
        )}

        <p className="auth-legal">
          {t('auth.legal')}
        </p>
      </div>
    </div>
  );
}
