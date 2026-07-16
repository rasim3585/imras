import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Profile } from '../lib/types';

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  /** True until the user has chosen a real username (still on the trigger's
   *  provisional `player_xxxxxxxx` handle). */
  needsUsername: boolean;
  /** İlk profil sorgusu (başarı ya da nihai başarısızlık) sonuçlanana dek false —
   *  App bunu bekler ki yeni kayıtlı kullanıcı bir an feed'i görüp UsernameScreen'e
   *  zıplamasın. */
  profileReady: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const PROVISIONAL_USERNAME = /^player_[0-9a-f]{8}$/;

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileReady, setProfileReady] = useState(false);
  const lastUid = useRef<string | null>(null);

  // Geçici ağ/RLS hatasında profili null'a EZME (yoksa username kapısı atlanır,
  // bakiye chip'i boşalır) — 2 kez kısa aralıkla yeniden dene, yine olmazsa
  // eldeki profili koru.
  const loadProfile = useCallback(async (userId: string, attempt = 0): Promise<void> => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (error) {
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
        return loadProfile(userId, attempt + 1);
      }
      setProfileReady(true);
      return;
    }
    setProfile((data as Profile) ?? null);
    setProfileReady(true);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (session?.user) await loadProfile(session.user.id);
  }, [session, loadProfile]);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession()
      .then(async ({ data }) => {
        if (!active) return;
        setSession(data.session);
        if (data.session?.user) {
          lastUid.current = data.session.user.id;
          await loadProfile(data.session.user.id);
        }
      })
      .catch(() => { /* offline: oturumsuz devam, login ekranı gösterilir */ })
      .finally(() => { if (active) setLoading(false); });

    // DİKKAT: callback içinde await'li Supabase çağrısı yapılmaz (supabase-js
    // dokümante deadlock — sekmeye dönüşteki TOKEN_REFRESHED'te donma).
    // Profil yüklemesi setTimeout ile callback dışına ertelenir.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (next?.user) {
        const uid = next.user.id;
        if (lastUid.current !== uid) {
          lastUid.current = uid;
          setProfileReady(false);
        }
        setTimeout(() => { void loadProfile(uid); }, 0);
      } else {
        lastUid.current = null;
        setProfile(null);
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
  }, []);

  const needsUsername = Boolean(
    profile && PROVISIONAL_USERNAME.test(profile.username),
  );

  return (
    <AuthContext.Provider
      value={{ session, profile, loading, needsUsername, profileReady, refreshProfile, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
