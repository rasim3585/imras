import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/LanguageContext';
import { matchProvider } from '../lib/matchProvider';
import SlotSymbol from '../slot/symbols';
import { CornerFlag } from '../slot/scene';
import { cheer } from '../lib/sfx';
import type { SlotResult, SlotStep } from '../lib/types';

type TFn = (k: string, v?: Record<string, string | number>) => string;

// Gates of Goal — original football-themed tumble slot. The server computes the
// whole spin (provably fair); this screen animates the cascade: winning symbol
// groups are shown one at a time (so the player sees WHY they won), then drop
// out toward the goal line while survivors fall to fill the gaps and new symbols
// drop in from the top. Scene art is our own — not a reskin.

const COLS = 6, ROWS = 5, N = COLS * ROWS;
const BUY_COST = 60;            // mirrors slot_config.buy_cost (buy = bet × 60)
const MIN_BET = 10, MAX_BET = 1000, BET_STEP = 10;
const AUTO_OPTIONS = [10, 25, 50, 100, Infinity];
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Our paytable (mirrors slot_config: pays PER symbol by count bucket). Lets the
// callout show each symbol's own win — same as the server's per-symbol step win.
const PAY: Record<number, [number, number, number]> = {
  1: [0.10, 0.30, 0.80], 2: [0.10, 0.30, 0.80], 3: [0.16, 0.36, 1.00], 4: [0.20, 0.40, 1.20],
  5: [0.20, 0.48, 1.60], 6: [0.40, 0.80, 2.40], 7: [0.60, 1.60, 4.80], 8: [1.00, 4.00, 10.00],
};
function symbolPay(v: number, count: number, bet: number): number {
  const bucket = count >= 12 ? 2 : count >= 10 ? 1 : 0;
  return Math.round((PAY[v]?.[bucket] ?? 0) * bet);
}

interface CellMeta { n: boolean; dy: number; }         // n = new (drops from top); else shifted down dy rows
interface WinGroup { v: number; cells: number[]; count: number; amount: number; }
interface FsState { active: boolean; i: number; n: number; mult: number; win: number; }
const FS_OFF: FsState = { active: false, i: 0, n: 0, mult: 0, win: 0 };
const ALL_NEW: CellMeta[] = Array.from({ length: N }, () => ({ n: true, dy: 0 }));

function initialGrid(): number[] {
  const g: number[] = [];
  for (let i = 0; i < N; i++) g.push(1 + Math.floor(Math.random() * 8));
  return g;
}

function cleanErr(m: string, t: TFn): string {
  if (m.includes('yetersiz')) return t('go.err.funds');
  if (m.includes('giris')) return t('go.err.login');
  if (m.includes('bet')) return t('go.err.range');
  return t('go.err.fail');
}

// Split a winning step into its per-symbol groups (each symbol pays separately).
function winGroups(grid: number[], cells: number[], bet: number): WinGroup[] {
  const byV: Record<number, number[]> = {};
  for (const c of cells) { const v = grid[c]; if (v >= 1 && v <= 8) (byV[v] ??= []).push(c); }
  return Object.keys(byV)
    .map((k) => { const v = Number(k); const cs = byV[v]; return { v, cells: cs, count: cs.length, amount: symbolPay(v, cs.length, bet) }; })
    .filter((g) => g.count >= 8)     // a symbol only wins at 8+ — never flag fewer
    .sort((a, b) => b.amount - a.amount);
}

// How the NEXT grid enters: survivors of each column fall to the bottom (shift
// down), the freed top cells are new (drop from above).
function computeMeta(prev: number[], winners: number[]): CellMeta[] {
  const meta = Array.from({ length: N }, () => ({ n: true, dy: 0 }));
  const win = new Set(winners);
  for (let c = 0; c < COLS; c++) {
    const survRows: number[] = [];
    for (let r = 0; r < ROWS; r++) { const idx = r * COLS + c; if (!win.has(idx) && prev[idx] !== 0) survRows.push(r); }
    const firstSurv = ROWS - survRows.length;
    for (let r = 0; r < ROWS; r++) {
      const idx = r * COLS + c;
      if (r < firstSurv) meta[idx] = { n: true, dy: 0 };
      else meta[idx] = { n: false, dy: r - survRows[r - firstSurv] };
    }
  }
  return meta;
}

export default function GatesScreen() {
  const { profile, session, refreshProfile } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();

  const [board, setBoard] = useState<{ cells: number[]; meta: CellMeta[]; gen: number }>(() => ({ cells: initialGrid(), meta: ALL_NEW, gen: 0 }));
  const [boardOut, setBoardOut] = useState(false);       // whole grid dropping out (spin start)
  const [winCells, setWinCells] = useState<Set<number>>(new Set());   // aktif grup (callout + parlak vurgu)
  const [allWin, setAllWin] = useState<Set<number>>(new Set());        // TUM kazanan hucreler (birliktelik cercevesi)
  const [winPhase, setWinPhase] = useState<'show' | 'boom' | null>(null);
  const [dim, setDim] = useState(false);
  const [callout, setCallout] = useState<{ v: number; count: number; amount: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [bet, setBet] = useState(50);
  const [ante, setAnte] = useState(false);
  const [auto, setAuto] = useState(false);
  const [autoPanel, setAutoPanel] = useState(false);
  const [autoLeft, setAutoLeft] = useState(0);
  const [runWin, setRunWin] = useState(0);
  const [tumbles, setTumbles] = useState<number[]>([]);   // her cascade adiminin kazanci (sol ray yigini)
  const [turbo, setTurbo] = useState(false);
  const [multSum, setMultSum] = useState(0);
  const [fs, setFs] = useState<FsState>(FS_OFF);
  const [lastWin, setLastWin] = useState(0);
  const [banner, setBanner] = useState<string | null>(null);
  const [big, setBig] = useState(false);
  const [bigWin, setBigWin] = useState<{ tier: string; shown: number; target: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const balance = profile?.gold_balance ?? 0;
  const stake = ante ? Math.round(bet * 1.25) : bet;
  const buyStake = bet * BUY_COST;

  const genRef = useRef(0);
  const autoRef = useRef(false);
  const autoLeftRef = useRef(0);
  const betRef = useRef(bet); const anteRef = useRef(ante); const balRef = useRef(balance); const turboRef = useRef(turbo);
  useEffect(() => { turboRef.current = turbo; }, [turbo]);
  useEffect(() => { betRef.current = bet; }, [bet]);
  useEffect(() => { anteRef.current = ante; }, [ante]);
  useEffect(() => { balRef.current = balance; }, [balance]);
  useEffect(() => () => { autoRef.current = false; }, []);

  function showGrid(cells: number[], meta: CellMeta[] = ALL_NEW) { genRef.current += 1; setBoard({ cells, meta, gen: genRef.current }); }
  const stepBet = (d: number) => setBet((b) => Math.max(MIN_BET, Math.min(MAX_BET, b + d)));

  // Drop the whole current board out toward the line (used at spin start).
  async function fallOutBoard() { setBoardOut(true); await wait(500); setBoardOut(false); }

  async function playSteps(steps: SlotStep[], t: { show: number; boom: number; gap: number }, bt: number, onWin?: (w: number) => void) {
    if (steps[0]) showGrid(steps[0].grid, ALL_NEW);
    for (let i = 0; i < steps.length; i++) {
      const st = steps[i];
      if (st.win > 0) {
        onWin?.(st.win);
        setTumbles((prev) => [...prev, st.win].slice(-8));   // sol ray: son 8 tumble kazanci
        // SHOW — frame ALL winning cells together (birliktelik), then walk each
        // symbol group so the player sees why it won (active group glows brighter)
        setDim(true); setWinPhase('show'); setAllWin(new Set(st.cells));
        for (const g of winGroups(st.grid, st.cells, bt)) {
          setWinCells(new Set(g.cells));
          setCallout({ v: g.v, count: g.count, amount: g.amount });
          await wait(t.show);
        }
        // BOOM — all winners EXPLODE in place together
        setWinCells(new Set(st.cells)); setWinPhase('boom'); setCallout(null);
        await wait(t.boom);
        setWinCells(new Set()); setAllWin(new Set()); setWinPhase(null); setDim(false);
        if (i + 1 < steps.length) { showGrid(steps[i + 1].grid, computeMeta(st.grid, st.cells)); await wait(t.gap); }
      }
    }
    setWinCells(new Set()); setWinPhase(null); setCallout(null); setDim(false);
  }

  // GoO-tarzi buyuk kazanc sekansi: kademeli baslik + 0'dan hedefe sayan sayac +
  // ekran sarsintisi + konfeti. Esik: stake'in 12 katindan sonra.
  async function runBigWin(amount: number, stakeAmt: number) {
    const r = amount / stakeAmt;
    const tier = r >= 100 ? 'legend' : r >= 50 ? 'epic' : r >= 25 ? 'mega' : 'big';
    cheer();
    const dur = turboRef.current ? 900 : 1900;
    const t0 = Date.now();
    setBigWin({ tier, shown: 0, target: amount });
    await new Promise<void>((resolve) => {
      const step = () => {
        const p = Math.min(1, (Date.now() - t0) / dur);
        const eased = p * p * (3 - 2 * p);
        setBigWin((b) => (b ? { ...b, shown: Math.round(amount * eased) } : b));
        if (p < 1) requestAnimationFrame(step); else resolve();
      };
      requestAnimationFrame(step);
    });
    await wait(turboRef.current ? 550 : 1000);
    setBigWin(null);
  }

  async function animate(res: SlotResult) {
    const tb = turboRef.current;
    const baseT = tb ? { show: 420, boom: 260, gap: 70 } : { show: 950, boom: 600, gap: 150 };
    const fsT = tb ? { show: 320, boom: 220, gap: 60 } : { show: 680, boom: 480, gap: 120 };
    if (!res.buy) await fallOutBoard();           // old board falls away first
    let running = 0;
    await playSteps(res.base.steps, baseT, res.bet, (w) => { running += w; setRunWin(running); });
    if (res.base.payout > 0 && res.base.mult_sum > 0) { setMultSum(res.base.mult_sum); await wait(tb ? 320 : 560); }

    if (res.bonus.triggered) {
      setRunWin(0); setMultSum(0);
      setFs({ ...FS_OFF, active: true, n: res.bonus.count });
      setBanner(res.buy ? t('go.freespins') : t('go.gateopen')); setBig(true);
      await wait(1400); setBanner(null);
      let bwin = 0;
      for (let i = 0; i < res.bonus.spins.length; i++) {
        const sp = res.bonus.spins[i];
        setFs((f) => ({ ...f, i: i + 1 }));
        await playSteps(sp.steps, fsT, res.bet);
        setFs((f) => ({ ...f, mult: sp.total_mult }));
        if (sp.win > 0) { bwin += sp.win; setFs((f) => ({ ...f, win: bwin })); await wait(420); }
        else await wait(150);
      }
      await wait(500); setFs(FS_OFF);
    }

    setWinCells(new Set());
    if (res.payout > 0) {
      setLastWin(res.payout);
      if (res.payout >= res.stake * 12) {
        await runBigWin(res.payout, res.stake);
      } else {
        setBanner(t('go.won', { n: res.payout.toLocaleString() }));
        await wait(900); setBanner(null);
      }
    }
    setBig(false);
  }

  async function spin(buy = false) {
    if (!session) { navigate('/login'); return; }
    const st = buy ? buyStake : stake;
    if (busy || st > balance || st <= 0) return;
    setBusy(true); setErr(null); setBanner(null); setBig(false);
    setRunWin(0); setTumbles([]); setMultSum(0); setFs(FS_OFF); setWinCells(new Set()); setAllWin(new Set()); setBigWin(null);
    setWinPhase(null); setDim(false); setCallout(null);
    try {
      const res = await matchProvider.slotSpin(bet, buy ? false : ante, buy);
      await animate(res);
      await refreshProfile();
    } catch (e) {
      autoRef.current = false; setAuto(false);
      setErr(e instanceof Error ? cleanErr(e.message, t) : t('go.err.spinfail'));
    } finally {
      setBusy(false);
    }
  }

  async function autoLoop() {
    while (autoRef.current && autoLeftRef.current > 0) {
      const st = anteRef.current ? Math.round(betRef.current * 1.25) : betRef.current;
      if (st > balRef.current || st <= 0) break;
      await spin(false);
      if (!autoRef.current) break;
      if (autoLeftRef.current !== Infinity) { autoLeftRef.current -= 1; setAutoLeft(autoLeftRef.current); }
      if (autoLeftRef.current <= 0) break;
      await wait(420);
    }
    autoRef.current = false; setAuto(false);
  }
  function startAuto(count: number) {
    setAutoPanel(false);
    if (stake > balance) return;
    autoRef.current = true; setAuto(true);
    autoLeftRef.current = count; setAutoLeft(count);
    if (!busy) void autoLoop();
  }
  function onAutoBtn() {
    if (!session) { navigate('/login'); return; }
    if (auto) { autoRef.current = false; setAuto(false); return; }
    setAutoPanel(true);
  }

  const bonus = fs.active;
  const displayWin = bonus ? fs.win : (runWin || lastWin);

  return (
    <div className="go">
      <div className="go-marquee">
        <div className="go-marquee-track"><span>{t('go.marquee')}</span><span>{t('go.marquee')}</span></div>
      </div>

      <div className="go-stage">
        <aside className="go-rail">
          <button className="go-buy" disabled={busy || !session || buyStake > balance} onClick={() => spin(true)}>
            <span className="go-buy-t">{t('go.buyfs')}</span>
            <span className="go-buy-p tnum">{session ? buyStake.toLocaleString() : '—'}</span>
          </button>

          <div className="go-double">
            <div className="go-double-h">{t('go.doublechance')}</div>
            <button className={`go-toggle ${ante ? 'on' : ''}`} disabled={busy} onClick={() => setAnte((a) => !a)}>
              <span className="go-toggle-knob" /><span className="go-toggle-lbl">{ante ? t('go.on') : t('go.off')}</span>
            </button>
            <div className="go-double-note">{t('go.betplus')}</div>
          </div>

          {tumbles.length > 0 && (
            <div className="go-tstack">
              {tumbles.map((w, i) => (
                <div key={i} className={`go-tstack-row ${i === tumbles.length - 1 ? 'new' : ''}`}>
                  <span className="tnum">+{w.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}

          <div className={`go-winscreen ${displayWin > 0 ? 'lit' : ''}`}>
            <span className="go-winscreen-lbl">{t('go.win')}</span>
            <b className="tnum">{displayWin.toLocaleString()}</b>
          </div>
        </aside>

        <div className={`go-frame ${busy ? 'is-spin' : ''} ${bonus ? 'is-bonus' : ''} ${bigWin ? 'shake' : ''}`}>
          <div className="go-goal">
            <div className="go-net" aria-hidden="true" />
            <div className="go-reels">
              <div className={`go-grid ${dim ? 'dim' : ''}`} style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}>
                {board.cells.map((v, i) => {
                  const m = board.meta[i] ?? ALL_NEW[i];
                  const enter = boardOut ? 'out' : m.n ? 'drop' : m.dy > 0 ? 'shift' : '';
                  const winCls = winCells.has(i) ? `win ${winPhase ?? ''}` : '';
                  const frameCls = allWin.has(i) && winPhase === 'show' ? 'wframe' : '';
                  return (
                    <div
                      key={`${board.gen}-${i}`}
                      className={`go-cell ${winCls || enter} ${frameCls} ${v < 0 ? 'orb' : ''} ${v === 9 ? 'scat' : ''}`}
                      style={{ animationDelay: enter === 'drop' ? `${Math.floor(i / COLS) * 40}ms` : '0ms', ['--dy' as string]: m.dy }}
                    >
                      <span className="go-sym-wrap" style={{ animationDelay: `${(i % 7) * 0.28}s` }}>
                        <SlotSymbol v={v} />
                      </span>
                    </div>
                  );
                })}
              </div>

              {callout && (
                <div className="go-callout">
                  <span className="go-callout-ic"><SlotSymbol v={callout.v} /></span>
                  <span className="go-callout-cnt tnum">×{callout.count}</span>
                  <b className="go-callout-win tnum">+{callout.amount.toLocaleString()}</b>
                </div>
              )}

              {multSum > 0 && <div className="go-multbadge tnum">×{multSum}</div>}
              {runWin > 0 && !banner && !bonus && (
                <div className="go-tumblewin">
                  <span className="go-tumblewin-l">{t('go.tumblewin')}</span>
                  <b className="tnum">+{runWin.toLocaleString()}</b>
                </div>
              )}

              {bonus && (
                <div className="go-fs">
                  <div className="go-fs-head">{t('go.freespins')} <span className="tnum">{fs.i}/{fs.n}</span></div>
                  <div className="go-fs-mult tnum">×{fs.mult}</div>
                  {fs.win > 0 && <div className="go-fs-win tnum">+{fs.win.toLocaleString()}</div>}
                </div>
              )}

              {banner && <div className={`go-banner ${big ? 'big' : ''}`}><span className="tnum">{banner}</span></div>}

              {bigWin && (
                <div className={`go-bigwin tier-${bigWin.tier}`}>
                  <div className="go-bigwin-rays" aria-hidden="true" />
                  <div className="go-bigwin-confetti" aria-hidden="true">
                    {Array.from({ length: 18 }).map((_, i) => <span key={i} style={{ ['--i' as string]: i }} />)}
                  </div>
                  <div className="go-bigwin-tier">{t(`go.${bigWin.tier}`)}</div>
                  <div className="go-bigwin-amt tnum">{bigWin.shown.toLocaleString()}</div>
                </div>
              )}
            </div>
          </div>

          <div className="go-ground" aria-hidden="true">
            <CornerFlag side="left" />
            <CornerFlag side="right" />
          </div>

          {autoPanel && (
            <div className="go-modal" onClick={() => setAutoPanel(false)}>
              <div className="go-auto-panel" onClick={(e) => e.stopPropagation()}>
                <div className="go-auto-title">{t('go.autoplay')}</div>
                <div className="go-auto-sub">{t('go.autosub', { stake })}</div>
                <button className={`go-turbo ${turbo ? 'on' : ''}`} onClick={() => setTurbo((v) => !v)}>
                  <span className="go-turbo-ic">⚡</span> {t('go.turbo')} <span className="go-turbo-st">{turbo ? t('go.on') : t('go.off')}</span>
                </button>
                <div className="go-auto-grid">
                  {AUTO_OPTIONS.map((o) => (
                    <button key={o} className="go-auto-opt" disabled={stake > balance} onClick={() => startAuto(o)}>
                      {o === Infinity ? '∞' : o}
                    </button>
                  ))}
                </div>
                <button className="go-auto-cancel" onClick={() => setAutoPanel(false)}>{t('go.cancel')}</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {err && <div className="banner banner-error go-err">{err}</div>}

      <div className="go-bar">
        <div className="go-credit">
          <span className="muted">{t('go.credit')}</span>
          <b className="tnum">{session ? balance.toLocaleString() : '—'}</b>
        </div>

        <div className="go-betbox">
          <button className="go-betstep" disabled={busy || auto} onClick={() => stepBet(-BET_STEP)}>−</button>
          <div className="go-betval"><span className="muted">{t('go.bet')}</span><b className="tnum">{stake}</b></div>
          <button className="go-betstep" disabled={busy || auto} onClick={() => stepBet(BET_STEP)}>+</button>
        </div>

        <div className="go-actions">
          <button className={`go-auto ${auto ? 'on' : ''}`} disabled={busy && !auto} onClick={onAutoBtn} title="Autoplay">
            {auto ? <>{t('go.stop')}<span className="go-auto-left tnum">{autoLeft === Infinity ? '∞' : autoLeft}</span></> : t('go.auto')}
          </button>

          <button className="go-spin" disabled={busy || auto || (!!session && stake > balance)} onClick={() => spin(false)}>
            <span className="go-spin-ic" aria-hidden="true" />
            <span className="go-spin-lbl">{!session ? t('go.login') : busy ? '···' : t('go.spin')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
