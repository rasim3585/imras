import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

// Global ses aç/kapa tercihi. localStorage'da tutulur; oyunlar (Aviator, Gates)
// ileride useSound().enabled ile okuyup ses çalıp çalmayacağına karar verir.
// Varsayılan: açık.

const STORAGE = 'pickplay.sound';

function initial(): boolean {
  try { return localStorage.getItem(STORAGE) !== 'off'; } catch { return true; }
}

interface Ctx { enabled: boolean; toggle: () => void; setEnabled: (v: boolean) => void; }
const SoundContext = createContext<Ctx | undefined>(undefined);

export function SoundProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState<boolean>(initial);

  const setEnabled = useCallback((v: boolean) => {
    setEnabledState(v);
    try { localStorage.setItem(STORAGE, v ? 'on' : 'off'); } catch { /* ignore */ }
  }, []);
  const toggle = useCallback(() => setEnabled(!enabled), [enabled, setEnabled]);

  const value = useMemo(() => ({ enabled, toggle, setEnabled }), [enabled, toggle, setEnabled]);
  return <SoundContext.Provider value={value}>{children}</SoundContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSound(): Ctx {
  const ctx = useContext(SoundContext);
  if (!ctx) throw new Error('useSound must be used within <SoundProvider>');
  return ctx;
}
