import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { dict, type Lang, LANGS } from './dict';

// Çok dilli altyapı. İngilizce varsayılan; kullanıcı seçince localStorage'a yazılır,
// <html lang/dir> güncellenir (Arapça RTL). t(key, vars) → seçili dil, yoksa EN'e
// düşer, sonra key'in kendisi. LLM koç ayrı: kullanıcının dilini parametre alır.

const RTL = new Set<Lang>(['ar']);
const STORAGE = 'pickplay.lang';

function detect(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE) as Lang | null;
    if (saved && LANGS.some((l) => l.code === saved)) return saved;
    const nav = (navigator.language || 'en').slice(0, 2) as Lang;
    if (LANGS.some((l) => l.code === nav)) return nav;
  } catch { /* ignore */ }
  return 'en';
}

interface Ctx { lang: Lang; setLang: (l: Lang) => void; t: (key: string, vars?: Record<string, string | number>) => string; }
const LanguageContext = createContext<Ctx | undefined>(undefined);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detect);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = RTL.has(lang) ? 'rtl' : 'ltr';
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem(STORAGE, l); } catch { /* ignore */ }
  }, []);

  const t = useCallback((key: string, vars?: Record<string, string | number>) => {
    const s = dict[lang]?.[key] ?? dict.en[key] ?? key;
    if (!vars) return s;
    return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : `{${k}}`));
  }, [lang]);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useI18n(): Ctx {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useI18n must be used within <LanguageProvider>');
  return ctx;
}
