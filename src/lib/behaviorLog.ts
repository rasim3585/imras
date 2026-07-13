import { supabase } from './supabase';

// Behavior-mirror event capture (Faz 0). Fire-and-forget: buffers events client
// side and flushes them in one batch RPC, so high-volume pre-decision signals
// (hovers, edits, hesitation) never round-trip one-by-one. Failures are swallowed
// — logging must NEVER affect gameplay. The server drops events for logged-out
// users, so callers don't need to gate on auth.
//
// WHY pre-decision: the decision PROCESS (what you hovered, edited, removed, how
// long you hesitated) is the behavioural moat — it is irrecoverable if not
// captured live. Post-decision data already lives in the product tables.

type Ev = { product: string; event_type: string; payload?: unknown; context?: unknown; ts: string; session_id: string };

// One id per browser tab/session — lets us stitch a session's decisions together.
const SESSION_ID: string = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);

let buffer: Ev[] = [];
let timer: ReturnType<typeof setInterval> | null = null;

async function flush(): Promise<void> {
  if (buffer.length === 0) return;
  const batch = buffer;
  buffer = [];
  try {
    await supabase.rpc('log_events', { p_events: batch });
  } catch {
    /* swallow — never let logging break the app; dropped events are acceptable */
  }
}

function ensureTimer(): void {
  if (timer) return;
  timer = setInterval(() => { void flush(); }, 5000);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void flush(); });
    window.addEventListener('pagehide', () => { void flush(); });
  }
}

/** Record one behavioural event (buffered). Cheap; safe to call on hover/edit. */
export function logEvent(product: string, event_type: string, payload?: unknown, context?: unknown): void {
  buffer.push({ product, event_type, payload, context, ts: new Date().toISOString(), session_id: SESSION_ID });
  ensureTimer();
  if (buffer.length >= 25) void flush();   // cap batch size for bursty signals
}

export const behaviorSessionId = SESSION_ID;
