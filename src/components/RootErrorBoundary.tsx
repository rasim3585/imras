import { Component, type ReactNode } from 'react';
import { logEvent } from '../lib/behaviorLog';

// Kök hata sınırı — tek bir render hatası tüm siteyi beyaz ekrana çevirmesin.
// Provider'ların DIŞINDA durur (onlar da çökebilir), bu yüzden i18n context'i
// yerine localStorage'daki dile bakan kendi mini sözlüğü var.
// Hata behavior_events'e düşer (bedava Sentry-lite): launch haftası
// `select * from log_events where event_type='client_error'` ile taranır.

const MSG: Record<string, [string, string]> = {
  en: ['Something went wrong', 'Reload'],
  tr: ['Bir şeyler ters gitti', 'Yenile'],
  es: ['Algo salió mal', 'Recargar'],
  de: ['Etwas ist schiefgelaufen', 'Neu laden'],
  ru: ['Что-то пошло не так', 'Обновить'],
  ar: ['حدث خطأ ما', 'إعادة التحميل'],
  zh: ['出错了', '重新加载'],
  hi: ['कुछ गलत हो गया', 'फिर से लोड करें'],
};

function msgs(): [string, string] {
  try {
    const l = localStorage.getItem('pickplay.lang') ?? '';
    if (MSG[l]) return MSG[l];
  } catch { /* ignore */ }
  return MSG.en;
}

interface State { crashed: boolean }

export default class RootErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { crashed: false };

  static getDerivedStateFromError(): State {
    return { crashed: true };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    try {
      logEvent('app', 'client_error', {
        kind: 'render',
        msg: String(error instanceof Error ? error.message : error).slice(0, 300),
        stack: (info.componentStack ?? '').slice(0, 300),
      });
    } catch { /* logging asla ikinci bir crash üretmesin */ }
  }

  render() {
    if (!this.state.crashed) return this.props.children;
    const [title, reload] = msgs();
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24, textAlign: 'center' }}>
        <span style={{ fontSize: 40 }} aria-hidden>⚠️</span>
        <h1 style={{ fontSize: 18, margin: 0 }}>{title}</h1>
        <button
          style={{ padding: '10px 22px', borderRadius: 10, border: 'none', background: '#12a150', color: '#fff', fontWeight: 700, cursor: 'pointer' }}
          onClick={() => window.location.reload()}
        >
          {reload}
        </button>
      </div>
    );
  }
}

// Render dışı hatalar (event handler, async, promise) da aynı kanala düşsün.
// Döngü sigortası: oturum başına en fazla 10 kayıt.
let reported = 0;
export function installGlobalErrorLog(): void {
  window.addEventListener('error', (e) => {
    if (reported >= 10) return;
    reported += 1;
    logEvent('app', 'client_error', { kind: 'window', msg: String(e.message ?? '').slice(0, 300) });
  });
  window.addEventListener('unhandledrejection', (e) => {
    if (reported >= 10) return;
    reported += 1;
    const r = (e as PromiseRejectionEvent).reason;
    logEvent('app', 'client_error', {
      kind: 'promise',
      msg: String(r instanceof Error ? r.message : r).slice(0, 300),
    });
  });
}
