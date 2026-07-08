import { useEffect, useRef, useState } from 'react';
import { matchProvider } from '../lib/matchProvider';
import type { LiveState } from '../lib/types';

// Polls the server for a match's live state every ~2s (source of truth for
// score/goals/odds), and interpolates the on-screen minute every 300ms between
// polls so the clock ticks smoothly. The server never sends the future.
export function useLiveMatch(matchId: string | undefined) {
  const [state, setState] = useState<LiveState | null>(null);
  const [minute, setMinute] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const anchor = useRef<{ minute: number; startsIn: number; at: number; dur: number } | null>(null);

  useEffect(() => {
    if (!matchId) return;
    let alive = true;

    const fetchOnce = async () => {
      try {
        const [s] = await matchProvider.getLiveStates([matchId]);
        if (!alive || !s) return;
        setState(s);
        anchor.current = { minute: s.minute, startsIn: s.starts_in, at: Date.now(), dur: s.duration_secs };
        if (s.phase === 'finished') clearInterval(poll);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Live feed unavailable');
      }
    };

    void fetchOnce();
    const poll = setInterval(fetchOnce, 2000);
    const tick = setInterval(() => {
      const a = anchor.current;
      if (!a) return;
      const elapsed = (Date.now() - a.at) / 1000;
      setMinute(Math.min(90, Math.max(0, a.minute + (elapsed / a.dur) * 90)));
      setCountdown(Math.max(0, Math.ceil(a.startsIn - elapsed)));
    }, 300);

    return () => {
      alive = false;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [matchId]);

  return { state, minute: Math.floor(minute), countdown, error };
}
