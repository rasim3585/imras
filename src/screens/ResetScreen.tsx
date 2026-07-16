import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { LogoMarkLarge, Wordmark } from '../components/Brand';
import { useI18n } from '../i18n/LanguageContext';
import { mapAuthError } from '../lib/errors';

// Şifre sıfırlama inişi: e-postadaki recovery linki buraya düşer.
// detectSessionInUrl token'ı işleyip oturum açar (AuthContext loading bunu
// bekler) — oturum yoksa link geçersiz/expired demektir.
export default function ResetScreen() {
  const { session } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      navigate('/', { replace: true });
    } catch (err) {
      setError(mapAuthError(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <div className="auth-card card">
        <div className="auth-hero" style={{ flexDirection: 'column', gap: 'var(--s3)' }}>
          <LogoMarkLarge size={72} />
          <Wordmark size={30} />
        </div>

        {!session ? (
          <>
            <div className="banner banner-error">{t('auth.reset.invalid')}</div>
            <button className="btn btn-primary btn-block" onClick={() => navigate('/login', { replace: true })}>
              {t('auth.back')}
            </button>
          </>
        ) : (
          <form onSubmit={submit}>
            <h2 style={{ fontSize: 16, margin: '0 0 var(--s3)' }}>{t('auth.reset.title')}</h2>
            <div className="field">
              <label htmlFor="new-password">{t('auth.password')}</label>
              <input
                id="new-password"
                className="input"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                autoFocus
                required
              />
            </div>

            {error && <div className="banner banner-error">{error}</div>}

            <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
              {busy ? '…' : t('auth.reset.save')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
