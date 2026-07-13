import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { matchProvider } from '../lib/matchProvider';
import SlotSymbol from '../slot/symbols';
import { CornerFlag } from '../slot/scene';
import type { SlotResult, SlotStep } from '../lib/types';

// Gates of Goal — original football-themed tumble slot. Server computes the whole
// spin (provably fair); this screen animates the cascade (symbols drop from the
// top, winners pop and clear, the rest fall to fill gaps) plus the free-spins
// bonus. Scene art (frame, torches, mascot) is our own — not a reskin.

const COLS = 6, ROWS = 5;
const BUY_COST = 60;            // mirrors slot_config.buy_cost (buy = bet × 60)
const MIN_BET = 10, MAX_BET = 1000, BET_STEP = 10;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function initialGrid(): number[] {
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

  // Board carries a generation counter: bumping it remounts the cells so the
  // CSS drop-in animation replays on every cascade step.
  const [board, setBoard] = useState<{ cells: number[]; gen: number }>(() => ({ cells: initialGrid(), gen: 0 }));
  const [winCells, setWinCells] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [bet, setBet] = useState(50);
  const [ante, setAnte] = useState(false);
  const [auto, setAuto] = useState(false);
  const [runWin, setRunWin] = useState(0);
  const [multSum, setMultSum] = useState(0);
  const [fs, setFs] = useState<FsState>(FS_OFF);
  const [lastWin, setLastWin] = useState(0);
  const [banner, setBanner] = useState<string | null>(null);
  const [big, setBig] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const balance = profile?.gold_balance ?? 0;
  const stake = ante ? Math.round(bet * 1.25) : bet;
  const buyStake = bet * BUY_COST;

  // Refs so the autoplay loop reads live values without stale closures.
  const genRef = useRef(0);
  const autoRef = useRef(false);
  const betRef = useRef(bet); const anteRef = useRef(ante); const balRef = useRef(balance);
  useEffect(() => { betRef.current = bet; }, [bet]);
  useEffect(() => { anteRef.current = ante; }, [ante]);
  useEffect(() => { balRef.current = balance; }, [balance]);
  useEffect(() => () => { autoRef.current = false; }, []);

  function showGrid(cells: number[]) { genRef.current += 1; setBoard({ cells, gen: genRef.current }); }
  const stepBet = (d: number) => setBet((b) => Math.max(MIN_BET, Math.min(MAX_BET, b + d)));

  // Walk one spin's tumble steps: highlight winners (pop), then cascade to the
  // next grid (drop-in). Base steps slower than the many free-spin steps.
  async function playSteps(steps: SlotStep[], hi: number, gap: number, onWin?: (w: number) => void) {
    if (steps[0]) showGrid(steps[0].grid);
    for (let i = 0; i < steps.length; i++) {
      const st = steps[i];
      if (st.win > 0) {
        setWinCells(new Set(st.cells));
        onWin?.(st.win);
        await wait(hi);
        if (i + 1 < steps.length) {
          setWinCells(new Set());
          showGrid(steps[i + 1].grid);
          await wait(gap);
        }
      }
    }
    setWinCells(new Set());
  }

  async function animate(res: SlotResult) {
    // --- BASE spin (empty when the bonus was bought) ---
    let running = 0;
    await playSteps(res.base.steps, 720, 340, (w) => { running += w; setRunWin(running); });
    if (res.base.payout > 0 && res.base.mult_sum > 0) { setMultSum(res.base.mult_sum); await wait(560); }

    // --- FREE SPINS bonus ---
    if (res.bonus.triggered) {
      setRunWin(0); setMultSum(0);
      setFs({ ...FS_OFF, active: true, n: res.bonus.count });
      setBanner(res.buy ? 'FREE SPINS' : 'GATE OPEN'); setBig(true);
      await wait(1400);
      setBanner(null);
      let bwin = 0;
      for (let i = 0; i < res.bonus.spins.length; i++) {
        const sp = res.bonus.spins[i];
        setFs((f) => ({ ...f, i: i + 1 }));
        await playSteps(sp.steps, 540, 240);
        setFs((f) => ({ ...f, mult: sp.total_mult }));
        if (sp.win > 0) { bwin += sp.win; setFs((f) => ({ ...f, win: bwin })); await wait(440); }
        else await wait(150);
      }
      await wait(500);
      setFs(FS_OFF);
    }

    setWinCells(new Set());
    if (res.payout > 0) {
      setLastWin(res.payout);
      setBig(res.payout >= res.stake * 10);
      setBanner(`${res.payout.toLocaleString()} WON`);
    }
    await wait(200);
    setBig(false);
  }

  async function spin(buy = false) {
    if (!session) { navigate('/login'); return; }
    const st = buy ? buyStake : stake;
    if (busy || st > balance || st <= 0) return;
    setBusy(true); setErr(null); setBanner(null); setBig(false);
    setRunWin(0); setMultSum(0); setFs(FS_OFF); setWinCells(new Set());
    try {
      const res = await matchProvider.slotSpin(bet, buy ? false : ante, buy);
      await animate(res);
      await refreshProfile();
    } catch (e) {
      autoRef.current = false; setAuto(false);
      setErr(e instanceof Error ? cleanErr(e.message) : 'Spin failed');
    } finally {
      setBusy(false);
    }
  }

  async function autoLoop() {
    while (autoRef.current) {
      const st = anteRef.current ? Math.round(betRef.current * 1.25) : betRef.current;
      if (st > balRef.current || st <= 0) break;
      await spin(false);
      if (!autoRef.current) break;
      await wait(450);
    }
    autoRef.current = false; setAuto(false);
  }

  function toggleAuto() {
    if (!session) { navigate('/login'); return; }
    if (auto) { autoRef.current = false; setAuto(false); return; }
    if (stake > balance) return;
    autoRef.current = true; setAuto(true);
    if (!busy) void autoLoop();
  }

  const bonus = fs.active;
  const displayWin = bonus ? fs.win : (runWin || lastWin);

  return (
    <div className="go">
      <div className="go-topbanner"><span>TUMBLE PAYS</span> · UP TO 1000× BET</div>

      <div className="go-stage">
        {/* left rail — buy bonus + double chance + black win screen */}
        <aside className="go-rail">
          <button className="go-buy" disabled={busy || !session || buyStake > balance} onClick={() => spin(true)}>
            <span className="go-buy-t">BUY<br />FREE SPINS</span>
            <span className="go-buy-p tnum">{session ? buyStake.toLocaleString() : '—'}</span>
          </button>

          <div className="go-double">
            <div className="go-double-h">DOUBLE<br />CHANCE</div>
            <button className={`go-toggle ${ante ? 'on' : ''}`} disabled={busy} onClick={() => setAnte((a) => !a)}>
              <span className="go-toggle-knob" /><span className="go-toggle-lbl">{ante ? 'ON' : 'OFF'}</span>
            </button>
            <div className="go-double-note">+25% bet</div>
          </div>

          <div className={`go-winscreen ${displayWin > 0 ? 'lit' : ''}`}>
            <span className="go-winscreen-lbl">WIN</span>
            <b className="tnum">{displayWin.toLocaleString()}</b>
          </div>
        </aside>

        {/* center — football goal on a grass pitch */}
        <div className={`go-frame ${busy ? 'is-spin' : ''} ${bonus ? 'is-bonus' : ''}`}>
          <div className="go-goal">
            <div className="go-net" aria-hidden="true" />
            <div className="go-reels">
              <div className="go-grid" style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}>
                {board.cells.map((v, i) => (
                  <div
                    key={`${board.gen}-${i}`}
                    className={`go-cell ${winCells.has(i) ? 'win' : ''} ${v < 0 ? 'orb' : ''} ${v === 9 ? 'scat' : ''}`}
                    style={{ animationDelay: `${Math.floor(i / COLS) * 45}ms` }}
                  >
                    <span className="go-sym-wrap" style={{ animationDelay: `${(i % 7) * 0.28}s` }}>
                      <SlotSymbol v={v} />
                    </span>
                  </div>
                ))}
              </div>

              {multSum > 0 && <div className="go-multbadge tnum">×{multSum}</div>}
              {runWin > 0 && !banner && !bonus && <div className="go-runwin tnum">+{runWin.toLocaleString()}</div>}

              {bonus && (
                <div className="go-fs">
                  <div className="go-fs-head">FREE SPINS <span className="tnum">{fs.i}/{fs.n}</span></div>
                  <div className="go-fs-mult tnum">×{fs.mult}</div>
                  {fs.win > 0 && <div className="go-fs-win tnum">+{fs.win.toLocaleString()}</div>}
                </div>
              )}

              {banner && <div className={`go-banner ${big ? 'big' : ''}`}><span className="tnum">{banner}</span></div>}
            </div>
          </div>

          <div className="go-touchline" aria-hidden="true" />
          <CornerFlag side="left" />
          <CornerFlag side="right" />
        </div>
      </div>

      {err && <div className="banner banner-error go-err">{err}</div>}

      {/* bottom control bar */}
      <div className="go-bar">
        <div className="go-credit">
          <span className="muted">CREDIT</span>
          <b className="tnum">{session ? balance.toLocaleString() : '—'}</b>
        </div>

        <div className="go-betbox">
          <button className="go-betstep" disabled={busy || auto} onClick={() => stepBet(-BET_STEP)}>−</button>
          <div className="go-betval"><span className="muted">BET</span><b className="tnum">{stake}</b></div>
          <button className="go-betstep" disabled={busy || auto} onClick={() => stepBet(BET_STEP)}>+</button>
        </div>

        <div className="go-actions">
          <button
            className={`go-auto ${auto ? 'on' : ''}`}
            disabled={busy && !auto}
            onClick={toggleAuto}
            title="Autoplay"
          >{auto ? 'STOP' : 'AUTO'}</button>

          <button className="go-spin" disabled={busy || auto || (!!session && stake > balance)} onClick={() => spin(false)}>
            <span className="go-spin-ic" aria-hidden="true" />
            <span className="go-spin-lbl">{!session ? 'LOG IN' : busy ? '···' : 'SPIN'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
