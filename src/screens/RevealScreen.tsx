import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { matchProvider } from '../lib/matchProvider';
import { useAuth } from '../auth/AuthContext';
import type { Outcome, RevealResult } from '../lib/types';
import { outcomeLabel, formatOdds } from '../lib/format';

type Phase = 'loading' | 'anticipation' | 'playing' | 'final';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Order the goals into a watchable sequence (home/away tokens). */
function goalSequence(home: number, away: number): Outcome[] {
  const seq: Outcome[] = [];
  let h = home;
  let a = away;
  // alternate, roughly, so it reads like a real back-and-forth
  while (h > 0 || a > 0) {
    if (h > 0 && (a === 0 || (h + a) % 2 === 0)) {
      seq.push('home');
      h--;
    } else if (a > 0) {
      seq.push('away');
      a--;
    } else {
      seq.push('home');
      h--;
    }
  }
  return seq;
}

export default function RevealScreen() {
  const { matchId } = useParams<{ matchId: string }>();
  const navigate = useNavigate();
  const { refreshProfile } = useAuth();

  const [phase, setPhase] = useState<Phase>('loading');
  const [reveal, setReveal] = useState<RevealResult | null>(null);
  const [score, setScore] = useState({ h: 0, a: 0 });
  const [flash, setFlash] = useState<Outcome | null>(null);
  const [minute, setMinute] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!matchId) return;
    // Per-run guard only. Under StrictMode the first run is cancelled on the
    // dev remount; the second run completes. reveal_match is idempotent server
    // -side, so being called on both runs is safe (a ranRef guard here would
    // wedge the screen, because run 1 gets cancelled and run 2 is skipped).
    let cancelled = false;

    (async () => {
      try {
        const res = await matchProvider.revealMatch(matchId);
        if (cancelled) return;
        setReveal(res);

        // 1) anticipation — the whistle, before anything is known
        setPhase('anticipation');
        await sleep(1200);
        if (cancelled) return;

        // 2) the match "plays" — clock climbs, goals drop in one by one
        setPhase('playing');
        const seq = goalSequence(res.home_score, res.away_score);
        const steps = Math.max(seq.length, 1);
        const perStep = seq.length ? Math.min(900, 2600 / steps) : 1500;

        let h = 0;
        let a = 0;
        for (let i = 0; i < seq.length; i++) {
          await sleep(perStep);
          if (cancelled) return;
          if (seq[i] === 'home') h++;
          else a++;
          setScore({ h, a });
          setFlash(seq[i]);
          setMinute(Math.round(((i + 1) / (seq.length + 1)) * 90));
          await sleep(180);
          if (cancelled) return;
          setFlash(null);
        }
        // let the clock run out to full time
        await sleep(seq.length ? 500 : 1200);
        if (cancelled) return;
        setMinute(90);

        // 3) full time — the verdict
        setPhase('final');
        void refreshProfile();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not open this result');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [matchId, refreshProfile]);

  if (error) {
    return (
      <div className="app-shell" style={{ paddingTop: 'var(--s6)' }}>
        <div className="banner banner-error">{error}</div>
        <button className="btn btn-block" onClick={() => navigate('/')}>Back to markets</button>
      </div>
    );
  }

  if (!reveal || phase === 'loading') {
    return (
      <div className="settle">
        <div className="spinner" />
        <p className="settle-note">Opening the market…</p>
      </div>
    );
  }

  const correct = reveal.is_correct === true;
  const hasPick = reveal.your_pick !== null;
  const showScore = phase !== 'anticipation';

  return (
    <div className="settle">
      <div className="settle-status">
        {phase === 'anticipation' && <span className="chip">PENDING</span>}
        {phase === 'playing' && (
          <span className="chip chip-live"><span className="dot" />LIVE&nbsp;·&nbsp;<span className="tnum">{minute}&apos;</span></span>
        )}
        {phase === 'final' && <span className="chip">SETTLED</span>}
      </div>

      <div className="scoreboard">
        <span className="sb-team home">{reveal.home_team}</span>
        <span className={`sb-score tnum ${flash ? `tick-${flash}` : 'tick'}`}>
          <span className="sb-num">{showScore ? score.h : '–'}</span>
          <span className="sb-sep">:</span>
          <span className="sb-num">{showScore ? score.a : '–'}</span>
        </span>
        <span className="sb-team away">{reveal.away_team}</span>
      </div>

      {phase !== 'final' ? (
        <p className="settle-note">
          {phase === 'anticipation'
            ? 'Your position is locked. Settling the result…'
            : 'Result is resolving…'}
        </p>
      ) : (
        <div className="receipt">
          <span className={`receipt-verdict ${correct ? 'won' : 'lost'}`}>
            {hasPick ? (correct ? 'Won' : 'Missed') : 'Settled'}
          </span>

          <div className="receipt-rows">
            {hasPick && (
              <div className="receipt-row">
                <span className="k">Your call</span>
                <span className="v">
                  {outcomeLabel(reveal.your_pick as Outcome, reveal.home_team, reveal.away_team)}
                  <span className="odds tnum">@ {formatOdds(reveal.odds[reveal.your_pick as Outcome])}</span>
                </span>
              </div>
            )}
            <div className="receipt-row">
              <span className="k">Result</span>
              <span className="v">{outcomeLabel(reveal.result, reveal.home_team, reveal.away_team)}</span>
            </div>
            <div className={`receipt-row ${correct ? 'pts' : ''}`}>
              <span className="k">Points</span>
              <span className="v">
                {correct && reveal.points_earned != null ? `+${reveal.points_earned}` : '0'}
              </span>
            </div>
          </div>

          <div className="settle-actions">
            <button className="btn btn-primary btn-block" onClick={() => navigate('/')}>
              Back to markets
            </button>
            <button className="btn btn-ghost btn-block" onClick={() => navigate('/profile')}>
              View my record
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
