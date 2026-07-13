import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/LanguageContext';
import { logEvent } from '../lib/behaviorLog';
import { fetchComments, postComment, subscribeComments, type MatchComment } from './matchChat';

// CANLI SOHBET (Nesine esinli). Maç sırasında kullanıcı yorumları — sosyal
// etkileşim + DAVRANIŞ AYNASI için altın veri: kullanıcı tilt/heyecan anında ne
// yazıyor (comment_posted eventi moat'a loglanır). Realtime ile canlı akış.

function ago(iso: string, t: (k: string, v?: Record<string, string | number>) => string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  return m < 1 ? t('chat.now') : t('chat.min', { m });
}

export default function MatchChat({ matchId }: { matchId: string }) {
  const { session } = useAuth();
  const { t } = useI18n();
  const [comments, setComments] = useState<MatchComment[]>([]);
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    fetchComments(matchId).then((c) => { if (alive) setComments(c); }).catch(() => { /* sessiz */ });
    const unsub = subscribeComments(matchId, (c) => {
      setComments((prev) => (prev.some((x) => x.id === c.id) ? prev : [...prev, c]));
    });
    return () => { alive = false; unsub(); };
  }, [matchId]);

  // yeni mesajda en alta kaydır
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [comments.length]);

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true); setErr(null);
    try {
      const row = await postComment(matchId, body);
      setComments((prev) => (prev.some((x) => x.id === row.id) ? prev : [...prev, row]));
      logEvent('match', 'comment_posted', { match_id: matchId, len: body.length });
      setText('');
    } catch (e) {
      const m = e instanceof Error ? e.message : '';
      setErr(m.includes('too_fast') ? t('chat.toofast') : t('chat.error'));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mchat">
      <div className="mchat-head">💬 {t('chat.title')}</div>
      <div className="mchat-list" ref={listRef}>
        {comments.length === 0 ? (
          <p className="mchat-empty">{t('chat.empty')}</p>
        ) : comments.map((c) => (
          <div key={c.id} className="mchat-msg">
            <div className="mchat-msg-top">
              <span className="mchat-user">{c.username}</span>
              <span className="mchat-time">{ago(c.created_at, t)}</span>
            </div>
            <p className="mchat-body">{c.body}</p>
          </div>
        ))}
      </div>
      {session ? (
        <form className="mchat-input" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <input className="input" value={text} maxLength={200} placeholder={t('chat.placeholder')}
            onChange={(e) => setText(e.target.value)} />
          <button className="btn btn-primary btn-sm" type="submit" disabled={sending || !text.trim()}>{t('chat.send')}</button>
        </form>
      ) : (
        <Link to="/login" className="mchat-login">{t('chat.login')}</Link>
      )}
      {err && <div className="mchat-err">{err}</div>}
    </div>
  );
}
