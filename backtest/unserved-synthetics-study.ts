/**
 * FxHouse — one more try for the synthetics with no strategy (V25, V50, V100, BOOM1000).
 *
 * The best near-misses from earlier studies, with their rules copied unchanged and
 * fixed before this run (nothing tuned here), plus one new BOOM1000 idea:
 *
 *   V25  H4 impulse continuation with the D1 trend, TP 2R   (followup-study.ts)
 *   V25  H1 liquidity sweep + rejection pin bar, TP 2.5R    (candlestick-volatility-study.ts)
 *   V100 H4 morning/evening star reversal, TP 2R            (candlestick-volatility-study.ts)
 *   BOOM1000 short the drift: sell every H1 close / only after an up-spike H1 candle
 *       (body > 2x ATR), SL 1.5x ATR, TP 1.5x ATR, out after 8h   (new)
 *
 * Pass rules — all of them, decided before running:
 *   1. positive average R after costs in BOTH the train and the holdout half;
 *   2. full-year t >= 2;
 *   3. Vxx only: fewer than 5% of 200 random-walk years at the index's volatility
 *      do as well (BOOM1000 is not a plain random walk, so it has no such test and
 *      must clear rule 2 on its own).
 * V50 is left out: every rule tried on it so far lost.
 *
 * Run with:
 *   bun run .\backtest\unserved-synthetics-study.ts
 */

import { writeFileSync } from 'node:fs';
import { getVolatilityAdjustedSpread } from '../src/lib/spreadConfig';
import { GRANULARITY, atrPercentileSeries, atrSeries, cleanSeries, emaSeries, fmtStats, loadData, median, simulate, stats } from './lib';
import type { Candle, Series, Stats, Trade } from './lib';
import { lastCompleted, trendD1 } from './strategy-candidates';
import { randomWalk } from './synthetic-pick-study';

const SPLIT = Date.UTC(2026, 4, 1) / 1000;
const PATHS = 200;
type Dir = 1 | -1;

/** One open trade at a time; each signal enters at `entryEpoch` / `entry`. */
function runSignals(s: Series, signals: { entryEpoch: number; entry: number; dir: Dir; stopDist: number; spread: number }[], tpR: number, holdHours: number): Trade[] {
  const out: Trade[] = [];
  let busyUntil = 0;
  for (const g of signals) {
    if (g.entryEpoch < busyUntil || !(g.stopDist > 0)) continue;
    const t = simulate(s.m15, g.entryEpoch, g.entry, g.dir, g.stopDist, tpR, g.spread, holdHours);
    if (!t) continue;
    out.push(t);
    busyUntil = t.exitEpoch;
  }
  return out;
}

// ---- V25: H4 impulse continuation with the D1 trend (followup-study.ts h4Tests) ----
function h4ImpulseD1(instrument: string, s: Series): Trade[] {
  const h4 = s.h4, atr = atrSeries(h4), atrPct = atrPercentileSeries(atr), d1T = trendD1(s.d1);
  const sign = (v: number): 0 | Dir => (v > 0 ? 1 : v < 0 ? -1 : 0);
  const sig = [];
  for (let i = 220; i < h4.length - 1; i++) {
    const dir = d1T[lastCompleted(s.d1, GRANULARITY.d1, h4[i].epoch + GRANULARITY.h4)] ?? 0;
    if (dir === 0) continue;
    const c = h4[i], range = c.high - c.low;
    const med = median(h4.slice(i - 20, i).map(b => b.high - b.low));
    if (!(sign(c.close - c.open) === dir && range >= 1.5 * med && range >= 1.2 * atr[i - 1] && sign(h4[i - 1].close - h4[i - 4].close) === dir)) continue;
    sig.push({ entryEpoch: h4[i + 1].epoch, entry: h4[i + 1].open, dir: dir as Dir, stopDist: 1.5 * atr[i], spread: getVolatilityAdjustedSpread(instrument as never, atrPct[i]) });
  }
  return runSignals(s, sig, 2, 192);
}

// ---- Candle patterns (candlestick-volatility-study.ts): enter at the signal candle's close ----
type Pattern = (c: Candle[], atr: number[], i: number) => { dir: Dir; stopDist: number } | null;

const sweepPinBar: Pattern = (cs, atrS, i) => {
  if (i < 21) return null;
  const c = cs[i], range = c.high - c.low, atr = atrS[i];
  if (range <= 0 || !atr || range < 0.5 * atr) return null;
  let hi = -Infinity, lo = Infinity;
  for (let k = 1; k <= 20; k++) { hi = Math.max(hi, cs[i - k].high); lo = Math.min(lo, cs[i - k].low); }
  const upper = c.high - Math.max(c.open, c.close), lower = Math.min(c.open, c.close) - c.low, body = Math.abs(c.close - c.open);
  if (c.high > hi && c.close < hi && upper >= 2 * body && (c.close - c.low) / range < 0.35) return { dir: -1, stopDist: Math.max(c.high - c.close + 0.1 * atr, 0.8 * atr) };
  if (c.low < lo && c.close > lo && lower >= 2 * body && (c.high - c.close) / range < 0.35) return { dir: 1, stopDist: Math.max(c.close - c.low + 0.1 * atr, 0.8 * atr) };
  return null;
};

const starReversal: Pattern = (cs, atrS, i) => {
  if (i < 51) return null;
  const [c1, c2, c3] = [cs[i - 2], cs[i - 1], cs[i]], atr = atrS[i];
  if (!atr) return null;
  const b1 = Math.abs(c1.close - c1.open), b2 = Math.abs(c2.close - c2.open), b3 = Math.abs(c3.close - c3.open);
  if (c1.close < c1.open && b1 > 0.6 * atr && b2 < 0.4 * atr && c3.close > c3.open && b3 > 0.6 * atr && c3.close > (c1.open + c1.close) / 2) {
    return { dir: 1, stopDist: Math.max(c3.close - Math.min(c1.low, c2.low, c3.low) + 0.1 * atr, atr) };
  }
  if (c1.close > c1.open && b1 > 0.6 * atr && b2 < 0.4 * atr && c3.close < c3.open && b3 > 0.6 * atr && c3.close < (c1.open + c1.close) / 2) {
    return { dir: -1, stopDist: Math.max(Math.max(c1.high, c2.high, c3.high) - c3.close + 0.1 * atr, atr) };
  }
  return null;
};

function candlePattern(instrument: string, s: Series, tf: 'h1' | 'h4', fn: Pattern, tpR: number): Trade[] {
  const cs = s[tf], atr = atrSeries(cs, 14), g = GRANULARITY[tf];
  const spread = getVolatilityAdjustedSpread(instrument as never, null);
  const sig = [];
  for (let i = 52; i < cs.length - 1; i++) {
    const p = fn(cs, atr, i);
    if (p) sig.push({ entryEpoch: cs[i].epoch + g, entry: cs[i].close, dir: p.dir, stopDist: p.stopDist, spread });
  }
  return runSignals(s, sig, tpR, tf === 'h1' ? 72 : 168);
}

// ---- BOOM1000: short the slow drift between up-spikes (new) ----
function boomDrift(s: Series, onlyAfterSpike: boolean): Trade[] {
  const h1 = s.h1, atr = atrSeries(h1, 14), atrPct = atrPercentileSeries(atr);
  const sig = [];
  for (let i = 220; i < h1.length - 1; i++) {
    const c = h1[i];
    if (!atr[i]) continue;
    if (onlyAfterSpike && !(c.close - c.open > 2 * atr[i])) continue;
    sig.push({ entryEpoch: c.epoch + 3600, entry: c.close, dir: -1 as Dir, stopDist: 1.5 * atr[i], spread: getVolatilityAdjustedSpread('BOOM1000' as never, atrPct[i]) });
  }
  return runSignals(s, sig, 1, 8);
}

const CANDIDATES: { id: string; name: string; instrument: string; vol: number | null; run: (s: Series) => Trade[] }[] = [
  { id: 'v25_h4_impulse_d1', name: 'V25 H4 impulse continuation with D1 trend (TP 2R)', instrument: 'V25', vol: 0.25, run: s => h4ImpulseD1('V25', s) },
  { id: 'v25_h1_sweep_pin', name: 'V25 H1 liquidity sweep + pin bar (TP 2.5R)', instrument: 'V25', vol: 0.25, run: s => candlePattern('V25', s, 'h1', sweepPinBar, 2.5) },
  { id: 'v100_h4_star', name: 'V100 H4 morning/evening star (TP 2R)', instrument: 'V100', vol: 1.0, run: s => candlePattern('V100', s, 'h4', starReversal, 2) },
  { id: 'boom_drift_all', name: 'BOOM1000 short every H1 close (SL/TP 1.5x ATR, 8h)', instrument: 'BOOM1000', vol: null, run: s => boomDrift(s, false) },
  { id: 'boom_drift_spike', name: 'BOOM1000 short after an up-spike H1 candle (SL/TP 1.5x ATR, 8h)', instrument: 'BOOM1000', vol: null, run: s => boomDrift(s, true) },
];

function main() {
  const raw = loadData('./backtest/data.json');
  const results: Record<string, unknown>[] = [];
  const pathCache = new Map<string, Series[]>();
  for (const c of CANDIDATES) {
    const s = cleanSeries(raw[c.instrument]).series;
    const trades = c.run(s);
    const all = stats(trades), train = stats(trades.filter(t => t.entryEpoch < SPLIT)), hold = stats(trades.filter(t => t.entryEpoch >= SPLIT));
    let luck: number | null = null;
    if (c.vol !== null) {
      if (!pathCache.has(c.instrument)) pathCache.set(c.instrument, Array.from({ length: PATHS }, () => randomWalk(s, c.vol!)));
      const finals = pathCache.get(c.instrument)!.map(p => stats(c.run(p)).totalR);
      luck = finals.filter(f => f >= all.totalR).length / PATHS;
    }
    const pass = train.avgR > 0 && hold.avgR > 0 && all.t >= 2 && (luck === null || luck < 0.05);
    console.log(`\n${c.name}\n  all     ${fmtStats(all)}\n  train   ${fmtStats(train)}\n  holdout ${fmtStats(hold)}` +
      `${luck !== null ? `\n  random-walk years doing as well: ${(luck * 100).toFixed(1)}%` : ''}\n  VERDICT ${pass ? 'PASS' : 'FAIL'}`);
    results.push({ id: c.id, name: c.name, instrument: c.instrument, all, train, holdout: hold, luckShare: luck, pass });
  }
  writeFileSync('./backtest/unserved-synthetics-results.json', JSON.stringify({ generatedAt: new Date().toISOString(), split: '2026-05-01', results }, null, 2));
}

if (import.meta.main) main();
