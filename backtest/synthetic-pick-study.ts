/**
 * FxHouse — the two best-looking synthetic strategies, checked against luck.
 *
 *   1. V75 inside-bar breakout (demo-candidates.ts): an H4 candle inside the
 *      previous one; buy-stop / sell-stop at the mother candle's high / low for
 *      4 hours; SL 2x ATR(14, H1), TP 4x ATR (2R), max hold 48h.
 *   2. V10 Donchian marubozu breakout (candlestick-volatility-study.ts): an H1
 *      candle with range >= 0.8 ATR and body >= 70% of range closes beyond the
 *      previous 20 candles' high / low; enter at its close; SL 1.5x ATR, TP 2.5R,
 *      max hold 72h.
 *
 * Rules, costs and one-trade-at-a-time handling are copied from those studies,
 * so the real-data rows reproduce their numbers.
 *
 * Luck check: the Vxx indices are random walks at a fixed volatility (see
 * vol-gap-study.ts). Each rule also runs on PATHS simulated random-walk years at
 * the index's own volatility. If the real result sits inside the spread of
 * random results, it is what chance alone produces.
 *
 * Input:  ./backtest/data.json
 * Output: console report + ./backtest/synthetic-pick-results.json (also feeds the chart)
 *
 * Run with:
 *   bun run .\backtest\synthetic-pick-study.ts
 */

import { writeFileSync } from 'node:fs';
import { getVolatilityAdjustedSpread } from '../src/lib/spreadConfig';
import {
  GRANULARITY, atrPercentileSeries, atrSeries, cleanSeries, firstIndexAtOrAfter, fmtStats, loadData, simulate, stats,
} from './lib';
import type { Candle, Series, Trade } from './lib';
import { lastCompleted } from './strategy-candidates';

const INPUT = './backtest/data.json';
const OUTPUT = './backtest/synthetic-pick-results.json';
const SPLIT = Date.UTC(2026, 4, 1) / 1000; // train / holdout boundary used by both source studies
const PATHS = 200;
const STEP_SECONDS = 15; // random-walk step for the simulated paths

type Dir = 1 | -1;

// =================== STRATEGY 1: V75 inside-bar breakout ===================
const WARMUP = 220;

function stopOrderFill(m15: Candle[], from: number, to: number, hi: number, lo: number) {
  let k = firstIndexAtOrAfter(m15, from);
  if (!m15[k] || m15[k].epoch >= to) return null;
  const buyLive = m15[k].open < hi, sellLive = m15[k].open > lo;
  for (; k < m15.length && m15[k].epoch < to; k++) {
    const c = m15[k];
    const up = buyLive && c.high >= hi, down = sellLive && c.low <= lo;
    if (up && down) return null;
    if (up) return { epoch: c.epoch, price: Math.max(c.open, hi), dir: 1 as Dir };
    if (down) return { epoch: c.epoch, price: Math.min(c.open, lo), dir: -1 as Dir };
  }
  return null;
}

function insideBar(instrument: string, s: Series): Trade[] {
  const atr = atrSeries(s.h1);
  const atrPct = atrPercentileSeries(atr);
  const setups: { entryEpoch: number; entry: number; dir: Dir; atr: number; atrPct: number }[] = [];
  for (let k = 1; k < s.h4.length; k++) {
    const mother = s.h4[k - 1], inside = s.h4[k];
    if (!(inside.high <= mother.high && inside.low >= mother.low)) continue;
    const from = inside.epoch + GRANULARITY.h4;
    const fill = stopOrderFill(s.m15, from, from + 4 * 3600, mother.high, mother.low);
    if (!fill) continue;
    const i = lastCompleted(s.h1, GRANULARITY.h1, fill.epoch);
    if (i < WARMUP) continue;
    setups.push({ entryEpoch: fill.epoch, entry: fill.price, dir: fill.dir, atr: atr[i], atrPct: atrPct[i] });
  }
  const trades: Trade[] = [];
  let busyUntil = 0;
  for (const su of setups.sort((a, b) => a.entryEpoch - b.entryEpoch)) {
    if (su.entryEpoch < busyUntil || !(su.atr > 0)) continue;
    const spread = getVolatilityAdjustedSpread(instrument as never, su.atrPct);
    const t = simulate(s.m15, su.entryEpoch, su.entry, su.dir, 2 * su.atr, 2, spread, 48);
    if (!t) continue;
    trades.push(t);
    busyUntil = t.exitEpoch;
  }
  return trades;
}

/**
 * The same rule as the hourly engine can run it. The engine cannot hold two
 * opposite stop orders (one live setup per instrument), so it waits for the
 * breakout: each hourly run looks at closed 15M candles in the 4h window and,
 * once one has traded through the mother bar, issues one signal.
 *   'market': enter at the run's price; SL/TP 2x/4x ATR from that entry.
 *   'level':  pending order back at the broken level, live 4h like a day signal.
 */
export function insideBarHourly(instrument: string, s: Series, mode: 'market' | 'level'): Trade[] {
  const atr = atrSeries(s.h1);
  const atrPct = atrPercentileSeries(atr);
  const trades: Trade[] = [];
  let busyUntil = 0;
  for (let k = 1; k < s.h4.length; k++) {
    const mother = s.h4[k - 1], inside = s.h4[k];
    if (!(inside.high <= mother.high && inside.low >= mother.low)) continue;
    const from = inside.epoch + GRANULARITY.h4;
    for (let run = from + 3600 + 60; run <= from + 4 * 3600 + 60; run += 3600) {
      const closedTo = Math.floor(run / 900) * 900; // 15M candles closed by the run
      const fill = stopOrderFill(s.m15, from, Math.min(closedTo, from + 4 * 3600), mother.high, mother.low);
      if (!fill) continue;
      if (run < busyUntil) break; // the first run after the breakout is the only one that issues it
      const i = lastCompleted(s.h1, GRANULARITY.h1, run);
      if (i < WARMUP || !(atr[i] > 0)) break;
      const spread = getVolatilityAdjustedSpread(instrument as never, atrPct[i]);
      let t: Trade | null = null;
      if (mode === 'market') {
        const bar = s.m15[firstIndexAtOrAfter(s.m15, closedTo)];
        if (bar) t = simulate(s.m15, bar.epoch, bar.open, fill.dir, 2 * atr[i], 2, spread, 48);
      } else {
        const level = fill.dir === 1 ? mother.high : mother.low;
        for (let j = firstIndexAtOrAfter(s.m15, closedTo); j < s.m15.length && s.m15[j].epoch < run + 4 * 3600; j++) {
          const c = s.m15[j];
          if (c.low <= level && c.high >= level) { t = simulate(s.m15, c.epoch, level, fill.dir, 2 * atr[i], 2, spread, 48); break; }
        }
      }
      if (t) { trades.push(t); busyUntil = t.exitEpoch; }
      break; // one signal per inside bar
    }
  }
  return trades;
}

// =================== STRATEGY 2: V10 Donchian marubozu breakout ===================
export function donchianMarubozu(instrument: string, s: Series): Trade[] {
  const h1 = s.h1;
  const atr = atrSeries(h1, 14);
  const spread = getVolatilityAdjustedSpread(instrument as never, null);
  const trades: Trade[] = [];
  let busyUntil = 0;
  for (let i = 52; i < h1.length - 1; i++) {
    const c = h1[i];
    const close = c.epoch + GRANULARITY.h1;
    if (close < busyUntil) continue;
    const a = atr[i];
    if (!a) continue;
    const range = c.high - c.low, body = Math.abs(c.close - c.open);
    if (range < 0.8 * a || body / range < 0.7) continue;
    let hi = -Infinity, lo = Infinity;
    for (let k = 1; k <= 20; k++) { hi = Math.max(hi, h1[i - k].high); lo = Math.min(lo, h1[i - k].low); }
    const dir: Dir | 0 = c.close > hi && c.close > c.open ? 1 : c.close < lo && c.close < c.open ? -1 : 0;
    if (!dir) continue;
    const t = simulate(s.m15, close, c.close, dir, 1.5 * a, 2.5, spread, 72);
    if (!t) continue;
    trades.push(t);
    busyUntil = t.exitEpoch;
  }
  return trades;
}

// =================== RANDOM-WALK PATHS ===================
let seed = 20261015;
const rand = () => { // mulberry32: reproducible runs
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
let spare: number | null = null;
const normal = () => {
  if (spare !== null) { const v = spare; spare = null; return v; }
  let u = 0, v = 0, r = 0;
  do { u = rand() * 2 - 1; v = rand() * 2 - 1; r = u * u + v * v; } while (r === 0 || r >= 1);
  const f = Math.sqrt((-2 * Math.log(r)) / r);
  spare = v * f;
  return u * f;
};

const aggregate = (m15: Candle[], g: number): Candle[] => {
  const out: Candle[] = [];
  for (const c of m15) {
    const e = Math.floor(c.epoch / g) * g;
    const last = out[out.length - 1];
    if (last && last.epoch === e) { last.high = Math.max(last.high, c.high); last.low = Math.min(last.low, c.low); last.close = c.close; }
    else out.push({ ...c, epoch: e });
  }
  return out;
};

/** One random-walk year on the real series' 15M grid, at an annual volatility. */
export function randomWalk(real: Series, annualVol: number): Series {
  const sd = annualVol * Math.sqrt(STEP_SECONDS / (365 * 86400));
  const steps = 900 / STEP_SECONDS;
  let p = real.m15[0].open;
  const m15: Candle[] = real.m15.map(r => {
    const open = p; let high = p, low = p;
    for (let k = 0; k < steps; k++) { p *= Math.exp(sd * normal() - (sd * sd) / 2); if (p > high) high = p; if (p < low) low = p; }
    return { epoch: r.epoch, open, high, low, close: p };
  });
  return { m15, h1: aggregate(m15, GRANULARITY.h1), h4: aggregate(m15, GRANULARITY.h4), d1: aggregate(m15, GRANULARITY.d1) };
}

// =================== RUN ===================
const pct = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
const STRATEGIES = [
  { id: 'v75_insidebar', name: 'V75 inside-bar breakout (SL 2×ATR, TP 4×ATR)', instrument: 'V75', vol: 0.75, run: insideBar },
  { id: 'v75_insidebar_hourly_market', name: 'V75 inside-bar, hourly engine, market entry', instrument: 'V75', vol: 0.75, run: (i: string, s: Series) => insideBarHourly(i, s, 'market') },
  { id: 'v75_insidebar_hourly_level', name: 'V75 inside-bar, hourly engine, pending at broken level', instrument: 'V75', vol: 0.75, run: (i: string, s: Series) => insideBarHourly(i, s, 'level') },
  { id: 'v10_donchian', name: 'V10 Donchian marubozu breakout (TP 2.5R)', instrument: 'V10', vol: 0.10, run: donchianMarubozu },
];

function main() {
  const raw = loadData(INPUT);
  const out: Record<string, unknown> = {};
  for (const st of STRATEGIES) {
    const s = cleanSeries(raw[st.instrument]).series;
    const trades = st.run(st.instrument, s);
    const all = stats(trades), train = stats(trades.filter(t => t.entryEpoch < SPLIT)), hold = stats(trades.filter(t => t.entryEpoch >= SPLIT));
    console.log(`\n${st.name}\n  real data  all     ${fmtStats(all)}\n             train   ${fmtStats(train)}\n             holdout ${fmtStats(hold)}`);

    // Random paths: final R and the equity curve on a daily grid.
    const t0 = s.m15[0].epoch, t1 = s.m15[s.m15.length - 1].epoch;
    const days = Math.floor((t1 - t0) / 86400) + 1;
    const curves: number[][] = [];
    const finals: number[] = [], tStats: number[] = [];
    const started = Date.now();
    for (let p = 0; p < PATHS; p++) {
      const sim = randomWalk(s, st.vol);
      const tr = st.run(st.instrument, sim);
      const curve = new Array<number>(days).fill(0);
      for (const t of tr) curve[Math.floor((t.exitEpoch - t0) / 86400)] += t.r;
      for (let d = 1; d < days; d++) curve[d] += curve[d - 1];
      curves.push(curve);
      const st2 = stats(tr);
      finals.push(st2.totalR); tStats.push(st2.t);
    }
    const sortedFinals = [...finals].sort((a, b) => a - b);
    const beat = finals.filter(f => f >= all.totalR).length / PATHS;
    const band = (q: number) => Array.from({ length: days }, (_, d) => pct(curves.map(c => c[d]).sort((a, b) => a - b), q));
    console.log(`  random walks (${PATHS} paths, ${((Date.now() - started) / 1000).toFixed(0)}s): total R  5% ${pct(sortedFinals, 0.05).toFixed(1)} · median ${pct(sortedFinals, 0.5).toFixed(1)} · 95% ${pct(sortedFinals, 0.95).toFixed(1)}`);
    console.log(`  share of random paths that did as well or better than the real ${all.totalR.toFixed(1)}R: ${(beat * 100).toFixed(1)}%`);

    out[st.id] = {
      name: st.name, instrument: st.instrument, split: SPLIT,
      real: { all, train, holdout: hold },
      trades: trades.map(t => ({ entry: t.entryEpoch, exit: t.exitEpoch, dir: t.dir, r: +t.r.toFixed(3), how: t.exit })),
      random: {
        paths: PATHS, finals: sortedFinals.map(v => +v.toFixed(2)), tStats: tStats.map(v => +v.toFixed(2)), shareAtLeastReal: beat,
        band: { start: t0, p5: band(0.05).map(v => +v.toFixed(2)), p50: band(0.5).map(v => +v.toFixed(2)), p95: band(0.95).map(v => +v.toFixed(2)) },
      },
      h4: s.h4.map(c => [c.epoch, +c.open.toFixed(3), +c.high.toFixed(3), +c.low.toFixed(3), +c.close.toFixed(3)]),
    };
  }
  writeFileSync(OUTPUT, JSON.stringify({ generatedAt: new Date().toISOString(), ...out }));
  console.log(`\nSaved ${OUTPUT}`);
}

if (import.meta.main) main();
