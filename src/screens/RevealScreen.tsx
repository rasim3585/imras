import { useEffect, useRef, useState } from 'react';
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
  const ranRef = useRef(false);

  useEffect(() => {
    if (!matchId || ranRef.current) return;
    ranRef.current = true;
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
      <div className="app-shell">
        <div className="banner banner-error" style={{ marginTop: 24 }}>{error}</div>
        <button className="btn" onClick={() => navigate('/')}>Back to feed</button>
      </div>
    );
  }

  if (!reveal || phase === 'loading') {
    return (
      <div className="reveal-stage">
        <div className="spinner" />
        <p className="muted" style={{ marginTop: 16 }}>Heading out to the pitch…</p>
      </div>
    );
  }

  const correct = reveal.is_correct === true;
  const hasPick = reveal.your_pick !== null;

  return (
    <div className={`reveal-stage ${phase === 'final' ? (correct ? 'is-hit' : 'is-miss') : ''}`}>
      <div className="reveal-status">
        {phase === 'anticipation' && <span className="live-dot">KICK-OFF</span>}
        {phase === 'playing' && <span className="live-dot is-live">LIVE · {minute}&apos;</span>}
        {phase === 'final' && <span className="ft-tag">FULL TIME</span>}
      </div>

      <div className="reveal-teams">
        <span className="reveal-team">{reveal.home_team}</span>
        <div className={`reveal-score ${flash ? `flash-${flash}` : ''}`}>
          <span className="rs-num">{phase === 'anticipation' ? '–' : score.h}</span>
          <span className="rs-sep">:</span>
          <span className="rs-num">{phase === 'anticipation' ? '–' : score.a}</span>
        </div>
        <span className="reveal-team">{reveal.away_team}</span>
      </div>

      {phase !== 'final' ? (
        <p className="reveal-sub muted">
          {phase === 'anticipation'
            ? 'You made your call. Now watch it happen.'
            : 'The result is opening up…'}
        </p>
      ) : (
        <div className="verdict">
          <div className={`verdict-badge ${correct ? 'is-hit' : 'is-miss'}`}>
            {hasPick ? (correct ? '✓ You called it' : '✕ Not this time') : 'Result'}
          </div>

          <div className="verdict-lines">
            {hasPick && (
              <div className="vline">
                <span className="muted">Your call</span>
                <strong>
                  {outcomeLabel(reveal.your_pick as Outcome, reveal.home_team, reveal.away_team)}
                  <span className="vline-odds mono">@ {formatOdds(reveal.odds[reveal.your_pick as Outcome])}</span>
                </strong>
              </div>
            )}
            <div className="vline">
              <span className="muted">Result</span>
              <strong>{outcomeLabel(reveal.result, reveal.home_team, reveal.away_team)}</strong>
            </div>
            {correct && reveal.points_earned != null && (
              <div className="vline vline-points">
                <span className="muted">Earned</span>
                <strong className="points-pop">+{reveal.points_earned} points</strong>
              </div>
            )}
          </div>

          <div className="reveal-actions">
            <button className="btn btn-primary btn-block" onClick={() => navigate('/')}>
              Back to the slate
            </button>
            <button className="btn btn-ghost btn-block" onClick={() => navigate('/profile')}>
              See my accuracy
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
