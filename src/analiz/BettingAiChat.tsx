import { useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useI18n } from '../i18n/LanguageContext';

// "Bahis AI'ınla Konuş" — kullanıcının KENDİ ayna verisiyle çok turlu koç
// sohbeti. Sunucu (betting-ai edge fn) deterministik mirror_* paketini kendisi
// çeker; model yalnız o sayılardan konuşur, maç tahmini/oran vermez.
// Key yoksa ilk denemede kart kendini gizler; günlük limit dolunca bildirir.

type Msg = { role: 'user' | 'assistant'; content: string };

const CHAT_KEY = 'imras.bai.v1';
function loadChat(): Msg[] {
  // sekme gezinmesi sohbeti silmesin — sessionStorage (oturum kapanınca gider)
  try { return JSON.parse(sessionStorage.getItem(CHAT_KEY) ?? '[]') as Msg[]; } catch { return []; }
}

export default function BettingAiChat() {
  const { t, lang } = useI18n();
  const [msgs, setMsgs] = useState<Msg[]>(loadChat);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  const starters = [t('bai.q1'), t('bai.q2'), t('bai.q3')];

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    const next: Msg[] = [...msgs, { role: 'user', content: q }];
    setMsgs(next); setInput(''); setBusy(true); setNote(null);
    try {
      const { data, error } = await supabase.functions.invoke('betting-ai', {
        body: { messages: next, lang },
      });
      const d = data as { text?: string | null; reason?: string } | null;
      if (error || !d) { setNote(t('bai.err')); return; }
      if (d.text) {
        const full: Msg[] = [...next, { role: 'assistant', content: d.text }];
        setMsgs(full);
        try { sessionStorage.setItem(CHAT_KEY, JSON.stringify(full.slice(-20))); } catch { /* dolu/kapalı */ }
        requestAnimationFrame(() => listRef.current?.scrollTo({ top: 99999, behavior: 'smooth' }));
      } else if (d.reason === 'no_key') {
        setHidden(true);            // anahtar kapalı → kart tamamen gizlenir
      } else if (d.reason === 'limit') {
        setNote(t('bai.limit'));
      } else {
        setNote(t('bai.err'));
      }
    } catch {
      setNote(t('bai.err'));
    } finally {
      setBusy(false);
    }
  }

  if (hidden) return null;

  return (
    <div className="card bai">
      <div className="bai-head">🤖 {t('bai.title')}</div>
      <p className="bai-sub">{t('bai.sub')}</p>

      {msgs.length === 0 && (
        <div className="bai-starters">
          {starters.map((s) => (
            <button key={s} className="bai-chip" onClick={() => void send(s)} disabled={busy}>{s}</button>
          ))}
        </div>
      )}

      {msgs.length > 0 && (
        <div className="bai-list" ref={listRef}>
          {msgs.map((m, i) => (
            <div key={i} className={`bai-msg ${m.role}`}>{m.content}</div>
          ))}
          {busy && <div className="bai-msg assistant bai-typing">…</div>}
        </div>
      )}

      {note && <div className="bai-note">{note}</div>}

      <form className="bai-row" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
        <input className="input bai-input" value={input} maxLength={500}
          placeholder={t('bai.placeholder')} onChange={(e) => setInput(e.target.value)} />
        <button className="btn btn-primary btn-sm" type="submit" disabled={busy || !input.trim()}>
          {busy ? '…' : t('bai.send')}
        </button>
      </form>
    </div>
  );
}
