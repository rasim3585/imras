import { useEffect, useRef, useState } from 'react';
import { replayFrame, type ReplayFrame, type WatchTimeline } from './liveModel';

// Drives a personal replay: the match starts at 0' the moment this mounts and
// plays over the timeline's duration, in front of the user — so a bet-on match
// is ALWAYS watchable start to finish, regardless of the global clock.
export function useMatchReplay(tl: WatchTimeline | null): ReplayFrame | null {
  const [frame, setFrame] = useState<ReplayFrame | null>(null);
  const startRef = useRef<number | null>(null);
  const prevMinute = useRef(0);

  useEffect(() => {
    if (!tl) { setFrame(null); return; }
    startRef.current = Date.now();
    prevMinute.current = 0;

    const step = () => {
      const elapsed = (Date.now() - (startRef.current ?? Date.now())) / 1000;
      const f = replayFrame(tl, elapsed, prevMinute.current);
      prevMinute.current = f.minute;
      setFrame(f);
      if (f.phase === 'finished') clearInterval(id);
    };
    step();
    const id = setInterval(step, 250);
    return () => clearInterval(id);
  }, [tl]);

  return frame;
}
