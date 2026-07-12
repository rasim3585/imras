import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { matchProvider } from '../lib/matchProvider';
import SlotSymbol from '../slot/symbols';
import type { SlotResult, SlotStep } from '../lib/types';

// Gates of Goal — original football-themed tumble slot. The server computes the
// whole spin (provably fair); this screen animates the returned tumble steps and
// the free-spins bonus (accumulating multiplier). Symbols/theme are our own.

const COLS = 6, ROWS = 5;
const QUICK = [10, 50, 100, 250, 500];
const BUY_COST = 60;            // mirrors slot_config.buy_cost (buy = bet × 60)
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function initialGrid(): number[] {
  // pleasant resting board before the first spin (display only)
  const g: number[] = [];
  for (let i = 0; i < COLS * ROWS; i++) g.push(1 + Math.floor(Math.random() * 8));
  return g;
}

function cleanErr(m: string): string {
  if (m.includes('yetersiz')) return 'Not enough coins for that bet.';
  if (m.includes('giris')) return 'Log in to play.';
  if (m.includes('bet')) return 'Bet is out of range.';
  return 'Spin failed. Try again.';
}

interface FsState { active: boolean; i: number; n: number; mult: number; win: number; }
const FS_OFF: FsState = { active: false, i: 0, n: 0, mult: 0, win: 0 };

export default function GatesScreen() {
  const { profile, session, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [grid, setGrid] = useState<number[]>(initialGrid);
  const [winCells, setWinCells] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [bet, setBet] = useState(50);
  const [ante, setAnte] = useState(false);
  const [runWin, setRunWin] = useState(0);
  const [multSum, setMultSum] = useState(0);
  const [fs, setFs] = useState<FsState>(FS_OFF);
  const [banner, setBanner] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const balance = profile?.gold_balance ?? 0;
  const stake = ante ? Math.round(bet * 1.25) : bet;
  const buyStake = bet * BUY_COST;
  const step = (d: number) => setBet((b) => Math.max(10, Math.min(1000, b + d)));

  // Walk one spin's tumble steps: highlight winning cells, then cascade to the
  // next grid. Base steps run slower than the many free-spin steps.
  async function playSteps(steps: SlotStep[], hi: number, gap: number, onWin?: (w: number) => void) {
    if (steps[0]) setGrid(steps[0].grid);
    for (let i = 0; i < steps.length; i++) {
      const st = steps[i];
      if (st.win > 0) {
        setWinCells(new Set(st.cells));
        onWin?.(st.win);
        await wait(hi);
        if (i + 1 < steps.length) {
          setWinCells(new Set());
          setGrid(steps[i + 1].grid);
          await wait(gap);
        }
      }
    }
    setWinCells(new Set());
  }

  async function animate(res: SlotResult) {
    // --- BASE spin (empty when the bonus was bought) ---
    let running = 0;
    await playSteps(res.base.steps, 720, 360, (w) => { running += w; setRunWin(running); });
    if (res.base.payout > 0 && res.base.mult_sum > 0) { setMultSum(res.base.mult_sum); await wait(560); }

    // --- FREE SPINS bonus ---
    if (res.bonus.triggered) {
      setRunWin(0); setMultSum(0);
      setFs({ ...FS_OFF, active: true, n: res.bonus.count });
      setBanner(res.buy ? 'FREE SPINS' : 'GATE OPEN');
      await wait(1300);
      setBanner(null);
      let bwin = 0;
      for (let i = 0; i < res.bonus.spins.length; i++) {
        const sp = res.bonus.spins[i];
        setFs((f) => ({ ...f, i: i + 1 }));
        await playSteps(sp.steps, 560, 260);
        setFs((f) => ({ ...f, mult: sp.total_mult }));
        if (sp.win > 0) { bwin += sp.win; setFs((f) => ({ ...f, win: bwin })); await wait(440); }
        else await wait(160);
      }
      await wait(500);
      setFs(FS_OFF);
    }

    setWinCells(new Set());
    if (res.payout > 0) setBanner(`${res.payout.toLocaleString()} won`);
  }

  async function spin(buy = false) {
    if (!session) { navigate('/login'); return; }
    const st = buy ? buyStake : stake;
    if (busy || st > balance || st <= 0) return;
    setBusy(true); setErr(null); setBanner(null);
    setRunWin(0); setMultSum(0); setFs(FS_OFF); setWinCells(new Set());
    try {
      const res = await matchProvider.slotSpin(bet, buy ? false : ante, buy);
      await animate(res);
      await refreshProfile();
    } catch (e) {
      setErr(e instanceof Error ? cleanErr(e.message) : 'Spin failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell gates">
      <div className="gates-top">
        <div className="gates-title"><h1>Gates of Goal</h1><span className="gates-sub">football tumble</span></div>
        {session && (
          <span className="gold-chip" title="Virtual coins">
            <span className="coin" aria-hidden="true" />
            <span className="tnum">{balance.toLocaleString()}</span>
          </span>
        )}
      </div>

      <div className={`gates-board ${busy ? 'is-spin' : ''} ${fs.active ? 'is-bonus' : ''}`}>
        <div className="gates-grid" style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}>
          {grid.map((v, i) => (
            <div key={i} className={`gates-cell ${winCells.has(i) ? 'win' : ''} ${v < 0 ? 'orb' : ''} ${v === 9 ? 'scat' : ''}`}>
              <SlotSymbol v={v} />
            </div>
          ))}
        </div>

        {multSum > 0 && <div className="gates-mult tnum">×{multSum}</div>}
        {runWin > 0 && !banner && !fs.active && <div className="gates-runwin tnum">+{runWin.toLocaleString()}</div>}

        {fs.active && (
          <div className="gates-fs">
            <div className="gates-fs-head">FREE SPINS <span className="tnum">{fs.i}/{fs.n}</span></div>
            <div className="gates-fs-mult tnum">×{fs.mult}</div>
            {fs.win > 0 && <div className="gates-fs-win tnum">+{fs.win.toLocaleString()}</div>}
          </div>
        )}

        {banner && <div className="gates-banner"><span className="tnum">{banner}</span></div>}
      </div>

      {err && <div className="banner banner-error" style={{ marginTop: 'var(--s2)' }}>{err}</div>}

      <div className="gates-controls">
        <label className={`gates-ante ${ante ? 'on' : ''}`}>
          <input type="checkbox" checked={ante} disabled={busy} onChange={(e) => setAnte(e.target.checked)} />
          Ante bet <span className="muted">+25% · 2× bonus chance</span>
        </label>

        <div className="gates-bet">
          <button className="gates-step" disabled={busy} onClick={() => step(-10)}>−</button>
          <div className="gates-betval"><span className="muted">Bet</span><b className="tnum">{bet}</b></div>
          <button className="gates-step" disabled={busy} onClick={() => step(10)}>+</button>
        </div>
        <div className="gates-quick">
          {QUICK.map((q) => <button key={q} className="av-chip" disabled={busy} onClick={() => setBet(q)}>{q}</button>)}
          {session && <button className="av-chip" disabled={busy || balance <= 0} onClick={() => setBet(Math.min(1000, Math.max(10, balance)))}>max</button>}
        </div>

        <button className="btn btn-primary btn-block gates-spin" disabled={busy || (!!session && stake > balance)} onClick={() => spin(false)}>
          {busy ? 'Spinning…' : !session ? 'Log in to play'
            : <>Spin · {stake} <span className="coin coin-light" aria-hidden="true" /></>}
        </button>

        {session && (
          <button className="btn btn-block gates-buy" disabled={busy || buyStake > balance} onClick={() => spin(true)}>
            Buy Free Spins · {buyStake.toLocaleString()} <span className="coin coin-light" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
