import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildAtmosphere, buildSchedule, replayState,
  type ReplayFrame, type WatchTimeline,
} from './liveModel';

// Drives a personal replay: the match starts at 0' the moment this mounts and
// plays over a variable-tempo schedule (slower near events + last 10', a pause
// at half-time), in front of the user — so a bet-on match is always watchable
// start to finish.
export function useMatchReplay(tl: WatchTimeline | null): ReplayFrame | null {
  const [frame, setFrame] = useState<ReplayFrame | null>(null);
  const startRef = useRef<number | null>(null);
  const prevMinute = useRef(0);

  const events = useMemo(() => (tl ? buildAtmosphere(tl.match_id, tl.events) : []), [tl]);
  const sched = useMemo(() => (tl ? buildSchedule(events, tl.duration_secs) : null), [tl, events]);

  useEffect(() => {
    if (!tl || !sched) { setFrame(null); return; }
    startRef.current = Date.now();
    prevMinute.current = 0;

    const step = () => {
      const elapsed = (Date.now() - (startRef.current ?? Date.now())) / 1000;
      const f = replayState(tl, events, sched, elapsed, prevMinute.current);
      prevMinute.current = f.minute;
      setFrame(f);
      if (f.phase === 'finished') clearInterval(id);
    };
    step();
    const id = setInterval(step, 200);
    return () => clearInterval(id);
  }, [tl, events, sched]);

  return frame;
}
