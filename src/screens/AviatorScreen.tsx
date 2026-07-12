import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useAviator } from '../aviator/useAviator';
import PitchCurve from '../aviator/PitchCurve';
import BetPanel from '../aviator/BetPanel';
import HistoryStrip from '../aviator/HistoryStrip';
import PlayersList from '../aviator/PlayersList';

// Aviator screen. Public to WATCH (anon SELECT is open); betting is login-gated
// per slot. The multiplier animates client-side; realtime drives phase + players.
export default function AviatorScreen() {
  const { session, profile } = useAuth();
  const navigate = useNavigate();
  const {
    round, phase, crashPoint, flightAnchor, bettingEndsAtMs,
    config, history, myBets, players, place, cashOut,
  } = useAviator();

  const loggedIn = Boolean(session);
  const requireLogin = () => navigate('/login');
  const seed = round?.server_seed_hash;

  return (
    <div className="app-shell av-screen">
      <div className="av-top">
        <div className="av-title">
          <h1>Aviator</h1>
          <PhaseTag phase={phase} bettingEndsAtMs={bettingEndsAtMs} />
        </div>
        <div className="av-top-right">
          {loggedIn && <span className="av-bal-chip tnum">{(profile?.gold_balance ?? 0).toLocaleString()} 🪙</span>}
          {seed && (
            <span className="av-fair" title={`Provably fair · server seed hash:\n${seed}`}>
              🔒 doğrulanabilir <span className="av-fair-hash tnum">{seed.slice(0, 8)}…</span>
            </span>
          )}
        </div>
      </div>

      <HistoryStrip rounds={history} />

      <div className="av-main">
        <PitchCurve
          phase={phase}
          anchor={flightAnchor}
          crashMultiplier={crashPoint}
          cap={config.max_multiplier}
          bettingEndsAtMs={bettingEndsAtMs}
          bettingMs={config.bet_window_secs * 1000}
        />
        <PlayersList players={players} meId={session?.user?.id} />
      </div>

      <div className="av-bets">
        {[1, 2].map((s) => (
          <BetPanel
            key={s}
            slot={s as 1 | 2}
            phase={phase}
            anchor={flightAnchor}
            cap={config.max_multiplier}
            config={config}
            bet={myBets[s]}
            loggedIn={loggedIn}
            onPlace={place}
            onCashout={cashOut}
            onRequireLogin={requireLogin}
          />
        ))}
      </div>
    </div>
  );
}

function PhaseTag({ phase, bettingEndsAtMs }: { phase: string | undefined; bettingEndsAtMs: number | null }) {
  if (phase === 'betting') return <span className="av-phase av-phase-bet">Bahisler açık <Countdown to={bettingEndsAtMs} /></span>;
  if (phase === 'flying') return <span className="av-phase av-phase-fly"><span className="pulse" /> Uçuyor</span>;
  if (phase === 'crashed') return <span className="av-phase av-phase-crash">Uçtu — yeni tur geliyor</span>;
  return <span className="av-phase">Bağlanıyor…</span>;
}

function Countdown({ to }: { to: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (to == null) return;
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [to]);
  if (to == null) return null;
  const secs = Math.max(0, (to - now) / 1000);
  return <b className="tnum">{secs.toFixed(1)}s</b>;
}
