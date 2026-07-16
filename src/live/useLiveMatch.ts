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
  // Animation clock anchor — set ONCE (not re-anchored every poll). The server
  // minute is an integer, so re-anchoring to minute*60 each poll made getClock a
  // SAWTOOTH (±~25 sim-sec every 2s), which jittered the ball and flickered event
  // holds. Client and server advance at the exact same rate (5400/dur from the
  // same real clock), so a single anchor stays in sync with no drift; we only
  // hard-correct on a big desync (join lag / tab was asleep).
  const animAnchor = useRef<{ sim: number; at: number; rate: number } | null>(null);

  // Continuous simulation clock in seconds (0..5400) — smooth & monotonic, so the
  // pitch can animate the ball every frame and hold events without stutter.
  const getClock = useRef(() => {
    const a = animAnchor.current;
    if (!a) return 0;
    const sim = a.sim + ((Date.now() - a.at) / 1000) * a.rate;
    return Math.max(0, Math.min(5400, sim));
  }).current;

  useEffect(() => {
    if (!matchId) return;
    let alive = true;
    // fresh match → drop the previous match's state entirely (otherwise the
    // screen renders — and the feed seeds from — the OLD match until the first
    // poll of the new one lands)
    setState(null);
    setMinute(0);
    anchor.current = null;
    animAnchor.current = null;

    // POLL KORUMASI: önceki istek dönmeden yenisi ATILMAZ. DB yavaşladığında
    // 2sn'lik interval istekleri üst üste bindirip yükü katlıyordu (sarmal
    // yakıtı) — artık en fazla 1 uçuşta istek; gecikince sıradaki tur atlanır.
    let inFlight = false;
    const fetchOnce = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const [s] = await matchProvider.getLiveStates([matchId]);
        if (!alive || !s) return;
        setState(s);
        const now = Date.now();
        anchor.current = { minute: s.minute, startsIn: s.starts_in, at: now, dur: s.duration_secs };
        // Set the animation clock once (only while LIVE — during the countdown it
        // must not tick); afterwards only nudge on a big desync so the ball stays
        // smooth (no per-poll sawtooth).
        if (s.phase === 'live') {
          const rate = 5400 / s.duration_secs;
          const serverSim = s.minute * 60;
          const aa = animAnchor.current;
          const cur = aa ? aa.sim + ((now - aa.at) / 1000) * aa.rate : -1;
          if (!aa || Math.abs(serverSim - cur) > 90) {
            animAnchor.current = { sim: serverSim, at: now, rate };
          }
        } else if (s.phase === 'upcoming') {
          animAnchor.current = null;
        }
        if (s.phase === 'finished') clearInterval(poll);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Live feed unavailable');
      } finally {
        inFlight = false;
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

  return { state, minute: Math.floor(minute), countdown, error, getClock };
}
