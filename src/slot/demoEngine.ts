import type { SlotResult, SlotStep, SlotBonusSpin } from '../lib/types';

// DEMO-ONLY client engine — a faithful mirror of the 0127 server engine, used
// exclusively on /gates?demo=1 to preview animations without login, balance or
// any money movement. REAL spins always come from the slot_spin RPC; nothing
// here touches the money path.

const W = [13, 13, 12, 11, 11, 9, 8, 3, 4];
const P1 = [0.25, 0.40, 0.50, 0.80, 1.00, 1.50, 2.00, 10.00, 2.50];
const P2 = [0.75, 0.90, 1.00, 1.20, 1.50, 2.00, 5.00, 25.00, 10.00];
const P3 = [2.00, 4.00, 5.00, 8.00, 10.00, 12.00, 15.00, 50.00, 25.00];
const MV = [2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 50, 100, 250, 500];
const MW = [460, 300, 180, 110, 70, 50, 30, 20, 10, 6, 4, 2, 1, 1, 1];
const WT = W.reduce((a, b) => a + b, 0);
const MWT = MW.reduce((a, b) => a + b, 0);
const MULT = 0.0125, SCAT = 0.018, ANTE_SCAT = 0.036, FS = 15;

function draw(sc: number): number {
  const t = Math.random();
  if (t < sc) return 10;
  if (t < sc + MULT) {
    let d = Math.random() * MWT, acc = 0;
    for (let i = 0; i < MV.length; i++) { acc += MW[i]; if (d < acc) return -MV[i]; }
    return -MV[0];
  }
  let d = Math.random() * WT, acc = 0;
  for (let s = 0; s < 9; s++) { acc += W[s]; if (d < acc) return s + 1; }
  return 1;
}

function playOne(bet: number, sc: number) {
  const g = Array.from({ length: 30 }, () => draw(sc));
  const steps: SlotStep[] = [];
  let baseWin = 0, tumbles = 0;
  for (;;) {
    const cnt = Array(10).fill(0);
    for (const v of g) if (v >= 1 && v <= 9) cnt[v]++;
    let stepWin = 0; const cells: number[] = [];
    for (let s = 1; s <= 9; s++) {
      if (cnt[s] >= 8) {
        const pay = cnt[s] >= 12 ? P3[s - 1] : cnt[s] >= 10 ? P2[s - 1] : P1[s - 1];
        stepWin += Math.round(pay * bet);
        for (let i = 0; i < 30; i++) if (g[i] === s) cells.push(i);
      }
    }
    steps.push({ grid: [...g], win: stepWin, cells: [...cells] });
    if (stepWin === 0) break;
    baseWin += stepWin; tumbles++;
    for (const i of cells) g[i] = 0;
    for (let c = 0; c < 6; c++) {
      const keep: number[] = [];
      for (let r = 4; r >= 0; r--) { const v = g[r * 6 + c]; if (v !== 0) keep.push(v); }
      let k = 0;
      for (let r = 4; r >= 0; r--) g[r * 6 + c] = k < keep.length ? keep[k++] : draw(sc);
    }
    if (tumbles > 40) break;
  }
  let multSum = 0, scatters = 0;
  for (const v of g) { if (v < 0) multSum += -v; else if (v === 10) scatters++; }
  return { steps, baseWin, multSum, scatters };
}

export function demoSpin(bet: number, ante: boolean, buy: boolean): SlotResult {
  const sc = ante ? ANTE_SCAT : SCAT;
  let payout = 0, basePayout = 0;
  const base = buy ? { steps: [] as SlotStep[], baseWin: 0, multSum: 0, scatters: 0 } : playOne(bet, sc);
  if (base.baseWin > 0) { basePayout = base.baseWin * Math.max(base.multSum, 1); payout = basePayout; }
  const spins: SlotBonusSpin[] = [];
  let bonusWin = 0, totalMult = 0;
  const triggered = buy || base.scatters >= 4;
  if (triggered) {
    let fs = FS;
    for (let i = 0; i < fs && i < 250; i++) {
      const sp = playOne(bet, sc);
      totalMult += sp.multSum;
      const w = sp.baseWin > 0 ? sp.baseWin * Math.max(totalMult, 1) : 0;
      bonusWin += w;
      if (sp.scatters >= 3) fs += 5;
      spins.push({ steps: sp.steps, win: w, total_mult: totalMult, scatters: sp.scatters });
    }
    payout += bonusWin;
  }
  payout = Math.min(payout, bet * 5000);
  return {
    spin_id: 0, bet, ante, buy, stake: buy ? bet * 80 : ante ? Math.round(bet * 1.25) : bet,
    base: { steps: base.steps, base_win: base.baseWin, mult_sum: base.multSum, scatters: base.scatters, payout: basePayout },
    bonus: { triggered, count: spins.length, spins, win: bonusWin, total_mult: totalMult },
    payout, balance: 0,
  };
}
