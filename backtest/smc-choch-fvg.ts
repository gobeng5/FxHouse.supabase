/**
 * FxHouse — check of "smc_choch_fvg_2r" from fxhouse strategies.json v3.0
 *
 * H4 structure trend -> H1 change of character (CHoCH) with the trend ->
 * limit order at the midpoint of the latest fair value gap in the leg ->
 * stop beyond the leg extreme, target 2R.
 *
 * Rules follow the file. Where it is not explicit, the choice made here is
 * written next to the rule. Differences from the file's own backtest:
 *   - fills and exits are resolved on M15 candles, not H1;
 *   - the app's spread is charged (the file lists no spread);
 *   - in the candle that fills the limit order only the stop is checked, so a
 *     target printed earlier in that candle cannot be counted as a win.
 * The news filter is not applied (no event history here).
 *
 * Besides the primary strategy this runs: the same rule on BOS triggers, the
 * optional swing-target variant, nearby parameter values, and the six
 * synthetic indices as a control (the file calls them random walks).
 *
 * Input:  ./backtest/data.json
 * Output: console report + ./backtest/smc-choch-fvg-results.json
 *
 * Run with:
 *   bun run .\backtest\smc-choch-fvg.ts
 */

import { writeFileSync } from 'node:fs';
import { getVolatilityAdjustedSpread } from '../src/lib/spreadConfig';
import {
  GRANULARITY, TRAIN_END, atrPercentileSeries, atrSeries, cleanSeries, dayOf, firstIndexAtOrAfter, fmtR, hourOf,
  loadData, simulate, stats,
} from './lib';
import type { Candle, Series, Stats, Trade } from './lib';
import { lastCompleted } from './strategy-candidates';
import type { Dir } from './strategy-candidates';

const INPUT = './backtest/data.json';
const OUTPUT = './backtest/smc-choch-fvg-results.json';

const FOREX = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'GBP/JPY', 'XAU/USD'];
const SYNTHETICS = ['V10', 'V25', 'V50', 'V75', 'V100', 'BOOM1000'];
const WARMUP = 220;          // H1 bars before the first trigger (ATR percentile lookback)
const ORDER_VALID_BARS = 24; // H1 candles a pending limit order stays live
const MAX_HOLD_BARS = 72;    // H1 candles a trade may stay open
const HALF_YEAR = Date.UTC(2026, 3, 7) / 1000; // midpoint of the data, for the file's first/second half figures

export interface Params {
  h4Fractal: number; h1Fractal: number;
  trigger: 'CHoCH' | 'BOS';
  session: boolean;
  rr: number;
  /** Optional variant: needs an order block too, target just before the latest H4 swing, skipped under 1.5R. */
  swingTarget?: boolean;
  costs: boolean;
  /**
   * How orders are handled.
   *   'file'   — as the strategy file says: limit order, expires after 24 H1 candles, cancelled
   *              if the target is reached first, trade closed after 72 H1 candles.
   *   'app'    — as the app runs it: the limit order never expires and is never cancelled, the
   *              trade has no time limit, and a new setup is ignored while one is still live.
   *   'market' — enter at the open after the trigger candle instead of waiting for a pullback.
   */
  orders?: 'file' | 'app' | 'market';
  /** 'app' mode only: keep individual rules from the file. All default to off. */
  expire?: boolean; cancelOnTarget?: boolean; holdLimit?: boolean;
}
export const PRIMARY: Params = { h4Fractal: 2, h1Fractal: 3, trigger: 'CHoCH', session: true, rr: 2, costs: true };

// =================== STRUCTURE ===================
interface Break { i: number; dir: Dir; swingIdx: number; label: 'CHoCH' | 'BOS' | 'FIRST' }
interface Structure {
  breaks: Break[];
  /** Direction of the latest break as of each candle's close (0 before the first). */
  trend: (0 | Dir)[];
  /** Level of the latest confirmed swing high / low as of each candle's close. */
  lastSwingHigh: number[]; lastSwingLow: number[];
}

/**
 * Fractal swings with `n` candles each side (strictly higher / lower than all
 * of them), usable `n` candles later. A break is a CLOSE beyond the latest
 * confirmed swing that has not been broken yet; a newer confirmed swing
 * replaces an older unbroken one.
 */
function structure(c: Candle[], n: number): Structure {
  const breaks: Break[] = [];
  const trend = new Array<0 | Dir>(c.length).fill(0);
  const lastSwingHigh = new Array<number>(c.length).fill(NaN);
  const lastSwingLow = new Array<number>(c.length).fill(NaN);
  let high: { idx: number; level: number } | null = null;
  let low: { idx: number; level: number } | null = null;
  let seenHigh = NaN, seenLow = NaN;
  let prev: 0 | Dir = 0;

  const isSwing = (k: number, side: 'high' | 'low') => {
    if (k < n || k + n >= c.length) return false;
    for (let d = 1; d <= n; d++) {
      if (side === 'high' ? !(c[k].high > c[k - d].high && c[k].high > c[k + d].high) : !(c[k].low < c[k - d].low && c[k].low < c[k + d].low)) return false;
    }
    return true;
  };

  for (let j = 0; j < c.length; j++) {
    const k = j - n; // the swing that candle j completes
    if (k >= 0 && isSwing(k, 'high')) { high = { idx: k, level: c[k].high }; seenHigh = c[k].high; }
    if (k >= 0 && isSwing(k, 'low')) { low = { idx: k, level: c[k].low }; seenLow = c[k].low; }

    const note = (dir: Dir, swingIdx: number) => {
      breaks.push({ i: j, dir, swingIdx, label: prev === 0 ? 'FIRST' : prev === dir ? 'BOS' : 'CHoCH' });
      prev = dir;
    };
    if (high && c[j].close > high.level) { note(1, high.idx); high = null; }
    if (low && c[j].close < low.level) { note(-1, low.idx); low = null; }

    trend[j] = prev;
    lastSwingHigh[j] = seenHigh; lastSwingLow[j] = seenLow;
  }
  return { breaks, trend, lastSwingHigh, lastSwingLow };
}

// =================== SETUPS ===================
export interface Setup { trigIdx: number; trigClose: number; dir: Dir; entry: number; stop: number; tpR: number; atr: number; atrPct: number }

export function setups(s: Series, p: Params): Setup[] {
  const { h1, h4 } = s;
  const atr = atrSeries(h1), atrPct = atrPercentileSeries(atr);
  const htf = structure(h4, p.h4Fractal);
  const ltf = structure(h1, p.h1Fractal);
  const out: Setup[] = [];

  for (const b of ltf.breaks) {
    const t = b.i;
    if (b.label !== p.trigger || t < WARMUP || t >= h1.length - 1) continue;
    const trigClose = h1[t].epoch + GRANULARITY.h1;
    // Session is judged at the moment the trigger candle closes and the order is placed.
    if (p.session && !(hourOf(trigClose) >= 7 && hourOf(trigClose) < 17)) continue;
    const k4 = lastCompleted(h4, GRANULARITY.h4, trigClose);
    if (k4 < 0 || htf.trend[k4] !== b.dir) continue;

    // Leg: from the broken swing's candle to the trigger candle.
    let ext = b.swingIdx;
    for (let m = b.swingIdx; m <= t; m++) {
      if (b.dir === 1 ? h1[m].low < h1[ext].low : h1[m].high > h1[ext].high) ext = m;
    }

    // Most recent fair value gap whose three candles lie in the leg, starting at or after the extreme.
    let entry = NaN, fvgAt = -1;
    for (let m = t; m >= ext + 2; m--) {
      const gap = b.dir === 1 ? h1[m].low > h1[m - 2].high : h1[m].high < h1[m - 2].low;
      if (!gap) continue;
      entry = b.dir === 1 ? (h1[m].low + h1[m - 2].high) / 2 : (h1[m].high + h1[m - 2].low) / 2;
      fvgAt = m;
      break;
    }
    if (fvgAt < 0) continue;
    // A limit order has to sit on the pullback side of the trigger close.
    if (!(b.dir * (h1[t].close - entry) > 0)) continue;

    const a = atr[t];
    if (!(a > 0)) continue;
    const stop = (b.dir === 1 ? h1[ext].low : h1[ext].high) - b.dir * 0.1 * a;
    const risk = b.dir * (entry - stop);
    if (!(risk >= 0.2 * a)) continue;

    let tpR = p.rr;
    if (p.swingTarget) {
      // Order block: an opposite-colour candle in the leg at or after the extreme.
      let ob = false;
      for (let m = ext; m <= t && !ob; m++) ob = b.dir === 1 ? h1[m].close < h1[m].open : h1[m].close > h1[m].open;
      const swing = b.dir === 1 ? htf.lastSwingHigh[k4] : htf.lastSwingLow[k4];
      tpR = (b.dir * (swing - b.dir * 0.1 * a - entry)) / risk;
      if (!ob || !(tpR >= 1.5)) continue;
    }

    out.push({ trigIdx: t, trigClose, dir: b.dir, entry, stop, tpR, atr: a, atrPct: atrPct[t] });
  }
  return out;
}

// =================== EXECUTION ===================
interface Filled extends Trade { instrument: string; trigEpoch: number; overnight: boolean }

/** Follows one pending limit order on M15 candles; null if it never becomes a trade. */
function execute(instrument: string, s: Series, su: Setup, p: Params): Filled | null {
  const { h1, m15 } = s;
  const { dir } = su;
  const risk = dir * (su.entry - su.stop);
  const tp = su.entry + dir * risk * su.tpR;
  const spread = p.costs ? getVolatilityAdjustedSpread(instrument, su.atrPct) : 0;
  const half = spread / 2;
  const asFile = (p.orders ?? 'file') === 'file';
  const expire = asFile || !!p.expire, cancelOnTarget = asFile || !!p.cancelOnTarget, holdLimit = asFile || !!p.holdLimit;
  const expiry = expire ? (h1[su.trigIdx + ORDER_VALID_BARS]?.epoch ?? h1[h1.length - 1].epoch) + GRANULARITY.h1 : Infinity;

  for (let k = firstIndexAtOrAfter(m15, su.trigClose); k < m15.length && m15[k].epoch < expiry; k++) {
    const c = m15[k];
    // Target reached first (or in the same candle, order unknown): the order is cancelled.
    if (cancelOnTarget && (dir === 1 ? c.high >= tp : c.low <= tp)) return null;
    if (!(dir === 1 ? c.low <= su.entry : c.high >= su.entry)) continue;

    const done = (t: Trade): Filled => ({
      ...t, entryEpoch: c.epoch, instrument, trigEpoch: su.trigClose, overnight: dayOf(t.exitEpoch) !== dayOf(c.epoch),
    });
    // Filled. Stop in the same candle counts as a loss.
    const stopQuote = su.stop + dir * half;
    if (dir === 1 ? c.low <= stopQuote : c.high >= stopQuote) {
      return done({ entryEpoch: c.epoch, exitEpoch: c.epoch, dir, exit: 'SL', r: -(risk + half) / risk, mfeR: 0, maeR: -1 });
    }
    const fillBar = lastCompleted(h1, GRANULARITY.h1, c.epoch + GRANULARITY.m15);
    const from = c.epoch + GRANULARITY.m15;
    const deadline = holdLimit ? (h1[fillBar + MAX_HOLD_BARS]?.epoch ?? h1[h1.length - 1].epoch) + GRANULARITY.h1 : from + 1e9;
    const t = simulate(m15, from, su.entry, dir, risk, su.tpR, spread, (deadline - from) / 3600);
    return t ? done(t) : null;
  }
  return null;
}

/** Enter at the open after the trigger candle; stop and 2R target measured from that price. */
function executeMarket(instrument: string, s: Series, su: Setup, p: Params): Filled | null {
  const { h1, m15 } = s;
  const bar = h1[su.trigIdx + 1];
  const risk = su.dir * (bar.open - su.stop);
  if (!(risk >= 0.2 * su.atr)) return null;
  const spread = p.costs ? getVolatilityAdjustedSpread(instrument, su.atrPct) : 0;
  const deadline = (h1[su.trigIdx + 1 + MAX_HOLD_BARS]?.epoch ?? h1[h1.length - 1].epoch) + GRANULARITY.h1;
  const t = simulate(m15, bar.epoch, bar.open, su.dir, risk, su.tpR, spread, (deadline - bar.epoch) / 3600);
  return t ? { ...t, instrument, trigEpoch: su.trigClose, overnight: dayOf(t.exitEpoch) !== dayOf(t.entryEpoch) } : null;
}

interface LiveStats { setups: number; ignored: number; neverFilled: number; filledAfter24h: number; fillWaitHours: number[] }
const liveStats = new Map<string, LiveStats>();

/** One live signal per instrument: a setup is ignored while an earlier one is still pending or open. */
function runOneAtATime(instrument: string, s: Series, p: Params): Filled[] {
  const run = p.orders === 'market' ? executeMarket : execute;
  const accepted: Filled[] = [];
  const st: LiveStats = { setups: 0, ignored: 0, neverFilled: 0, filledAfter24h: 0, fillWaitHours: [] };
  let liveUntil = 0;
  for (const su of setups(s, p).sort((a, b) => a.trigClose - b.trigClose)) {
    st.setups++;
    if (su.trigClose < liveUntil) { st.ignored++; continue; }
    const t = run(instrument, s, su, p);
    if (!t) {
      st.neverFilled++;
      // Without expiry or cancellation the order waits for ever and keeps the slot. With either
      // rule it is gone within the order's 24 H1 candles at the latest (conservative: the full window).
      liveUntil = p.expire ? (s.h1[su.trigIdx + ORDER_VALID_BARS]?.epoch ?? Infinity) + GRANULARITY.h1 : Infinity;
      continue;
    }
    const wait = (t.entryEpoch - su.trigClose) / 3600;
    st.fillWaitHours.push(wait);
    if (wait > 24) st.filledAfter24h++;
    accepted.push(t);
    liveUntil = t.exitEpoch;
  }
  liveStats.set(`${p.orders}:${instrument}`, st);
  return accepted;
}

export function runInstrument(instrument: string, s: Series, p: Params): Filled[] {
  if ((p.orders ?? 'file') !== 'file') return runOneAtATime(instrument, s, p);
  const fills = setups(s, p).map(su => execute(instrument, s, su, p)).filter((t): t is Filled => t !== null)
    .sort((a, b) => a.entryEpoch - b.entryEpoch);
  const accepted: Filled[] = [];
  for (const t of fills) {
    const last = accepted[accepted.length - 1];
    // One open trade per instrument; an order still pending when another trade opened was cancelled.
    if (last && (t.entryEpoch < last.exitEpoch || t.trigEpoch <= last.entryEpoch)) continue;
    accepted.push(t);
  }
  return accepted;
}

// =================== REPORT ===================
const brief = (s: Stats) => `n=${String(s.n).padStart(3)} win ${s.winRate.toFixed(0).padStart(3)}% avgR ${fmtR(s.avgR)} total ${fmtR(s.totalR).padStart(8)}R t ${s.t.toFixed(2).padStart(5)}`;
const CLAIMED: Record<string, { trades: number; winRate: number; totalR: number }> = {
  'EUR/USD': { trades: 7, winRate: 43, totalR: 1.6 }, 'GBP/USD': { trades: 8, winRate: 50, totalR: 2.6 },
  'USD/JPY': { trades: 5, winRate: 20, totalR: -2.9 }, 'AUD/USD': { trades: 7, winRate: 43, totalR: 1.5 },
  'GBP/JPY': { trades: 9, winRate: 78, totalR: 11.2 }, 'XAU/USD': { trades: 10, winRate: 50, totalR: 4.9 },
};

function main() {
  const data = loadData(INPUT);
  const series = new Map<string, Series>();
  for (const k of [...FOREX, ...SYNTHETICS]) {
    if (!data[k]) throw new Error(`${k}: missing from ${INPUT}`);
    series.set(k, cleanSeries(data[k]).series);
  }
  // In time order across instruments, so drawdown and losing streaks are the ones a trader would live through.
  const pooled = (instruments: string[], p: Params) =>
    instruments.flatMap(k => runInstrument(k, series.get(k)!, p)).sort((a, b) => a.entryEpoch - b.entryEpoch);
  const out: Record<string, unknown> = {};

  console.log('FxHouse check of smc_choch_fvg_2r (fxhouse strategies.json v3.0)\n');

  console.log('===== Primary strategy, per instrument =====');
  const perInstrument: Record<string, { claimed: typeof CLAIMED[string]; noCost: Stats; withCost: Stats }> = {};
  for (const k of FOREX) {
    const paid = stats(runInstrument(k, series.get(k)!, PRIMARY));
    const free = stats(runInstrument(k, series.get(k)!, { ...PRIMARY, costs: false }));
    perInstrument[k] = { claimed: CLAIMED[k], noCost: free, withCost: paid };
    console.log(`  ${k.padEnd(8)} file n=${String(CLAIMED[k].trades).padStart(2)} win ${String(CLAIMED[k].winRate).padStart(2)}% total ${fmtR(CLAIMED[k].totalR).padStart(8)}R | no costs ${brief(free)} | with spread ${brief(paid)}`);
  }

  const all = pooled(FOREX, PRIMARY);
  const free = pooled(FOREX, { ...PRIMARY, costs: false });
  const part = (f: (t: Filled) => boolean) => stats(all.filter(f));
  console.log('\n===== Primary strategy, pooled over the six instruments =====');
  console.log('  file claims          n= 46 win  50% avgR +0.410 total  +18.900R   (first half +9.3R, second half +9.6R)');
  console.log(`  no costs             ${brief(stats(free))}`);
  const st = stats(all);
  console.log(`  with spread          ${brief(st)}  PF ${st.profitFactor.toFixed(2)}  maxDD ${st.maxDrawdownR.toFixed(1)}R  losing streak ${st.maxConsecLosses}`);
  console.log(`    first half         ${brief(part(t => t.entryEpoch < HALF_YEAR))}`);
  console.log(`    second half        ${brief(part(t => t.entryEpoch >= HALF_YEAR))}`);
  console.log(`    first 8 months     ${brief(part(t => t.entryEpoch < TRAIN_END))}`);
  console.log(`    last 4 months      ${brief(part(t => t.entryEpoch >= TRAIN_END))}`);
  console.log(`    closed same day    ${brief(part(t => !t.overnight))}   (file: 18 trades, 28% win, -4.3R)`);
  console.log(`    held overnight     ${brief(part(t => t.overnight))}   (file: 28 trades, 64% win, +23.2R)`);
  console.log(`    long               ${brief(part(t => t.dir === 1))}`);
  console.log(`    short              ${brief(part(t => t.dir === -1))}`);
  console.log(`    exits              TP ${st.tpRate.toFixed(0)}% / SL ${st.slRate.toFixed(0)}% / time ${st.timeRate.toFixed(0)}%   avg hold ${st.avgHoldHours.toFixed(0)}h`);
  out.primary = { perInstrument, pooled: st, pooledNoCost: stats(free), trades: all };

  console.log('\n===== Same rule, other settings (pooled, with spread) =====');
  const variants: [string, Params][] = [
    ['primary (H4 fractal 2, H1 fractal 3, CHoCH, session, 2R)', PRIMARY],
    ['BOS trigger instead of CHoCH', { ...PRIMARY, trigger: 'BOS' }],
    ['no session filter', { ...PRIMARY, session: false }],
    ['target 1.5R', { ...PRIMARY, rr: 1.5 }],
    ['target 3R', { ...PRIMARY, rr: 3 }],
    ['H1 fractal 2', { ...PRIMARY, h1Fractal: 2 }],
    ['H1 fractal 4', { ...PRIMARY, h1Fractal: 4 }],
    ['H4 fractal 3', { ...PRIMARY, h4Fractal: 3 }],
    ['H4 fractal 3, H1 fractal 2', { ...PRIMARY, h4Fractal: 3, h1Fractal: 2 }],
    ['H4 fractal 3, H1 fractal 4', { ...PRIMARY, h4Fractal: 3, h1Fractal: 4 }],
    ['optional variant: order block + H4 swing target (file: 16 trades, 50%, +12.8R)', { ...PRIMARY, swingTarget: true }],
  ];
  const variantRows = variants.map(([name, p]) => {
    const s = stats(pooled(FOREX, p));
    console.log(`  ${brief(s)}  ${name}`);
    return { name, stats: s };
  });
  out.variants = variantRows;

  console.log('\n===== Order handling (pooled, with spread) =====');
  const handling: [string, Params][] = [
    ['as the file says: order expires after 24h, cancelled if target hit first, 72h trade limit', PRIMARY],
    ['as the app runs it: order never expires or cancels, no trade time limit, one live signal per instrument', { ...PRIMARY, orders: 'app' }],
    ['market entry at the trigger instead of a limit order (72h trade limit)', { ...PRIMARY, orders: 'market' }],
    ['app + unfilled order expires after 24h (what the app already does today)', { ...PRIMARY, orders: 'app', expire: true }],
    ['app + 24h expiry + cancelled if target hit first', { ...PRIMARY, orders: 'app', expire: true, cancelOnTarget: true }],
    ['app + 24h expiry + cancel on target + 72h trade limit (file rules, one live signal per instrument)', { ...PRIMARY, orders: 'app', expire: true, cancelOnTarget: true, holdLimit: true }],
  ];
  const handlingRows = handling.map(([name, p]) => {
    const trades = pooled(FOREX, p);
    const st2 = stats(trades);
    console.log(`  ${brief(st2)}  PF ${st2.profitFactor.toFixed(2)} maxDD ${st2.maxDrawdownR.toFixed(1)}R streak ${st2.maxConsecLosses}  ${name}`);
    console.log(`      first half ${brief(stats(trades.filter(t => t.entryEpoch < HALF_YEAR)))}`);
    console.log(`      second half ${brief(stats(trades.filter(t => t.entryEpoch >= HALF_YEAR)))}`);
    if (p.orders) {
      for (const k of FOREX) {
        const l = liveStats.get(`${p.orders}:${k}`)!;
        const waits = [...l.fillWaitHours].sort((a, b) => a - b);
        const st3 = stats(trades.filter(t => t.instrument === k));
        console.log(`      ${k.padEnd(8)} setups ${String(l.setups).padStart(3)} | ignored (slot busy) ${String(l.ignored).padStart(3)} | never filled ${l.neverFilled} | filled after >24h ${String(l.filledAfter24h).padStart(2)} | median wait ${(waits[waits.length >> 1] ?? 0).toFixed(1)}h max ${(waits[waits.length - 1] ?? 0).toFixed(0)}h | ${brief(st3)}`);
      }
    }
    return { name, stats: st2 };
  });
  out.orderHandling = handlingRows;

  console.log('\n===== Control: the primary rule on the six synthetic indices (no costs) =====');
  const control: Record<string, Stats> = {};
  for (const k of SYNTHETICS) {
    control[k] = stats(runInstrument(k, series.get(k)!, { ...PRIMARY, costs: false, session: false }));
    console.log(`  ${k.padEnd(8)} ${brief(control[k])}`);
  }
  const controlPooled = stats(pooled(SYNTHETICS, { ...PRIMARY, costs: false, session: false }));
  console.log(`  pooled   ${brief(controlPooled)}`);
  out.control = { perInstrument: control, pooled: controlPooled };

  writeFileSync(OUTPUT, JSON.stringify({ generatedAt: new Date().toISOString(), ...out }, null, 2));
  console.log(`\nFull results written to ${OUTPUT}`);
}

if (import.meta.main) main();
