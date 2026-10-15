/**
 * FxHouse — replay of the Selective Gems as they actually run live, before and
 * after the candle fixes:
 *   1. the web app fed BOOM1000's 15M gem with 1H candles,
 *   2. gems were evaluated on the still-forming candle,
 *   3. the engine fetched only 60 15M candles (EMA50 barely seeded).
 *
 * Each variant calls the real shared gem functions (`_shared/analysis/selectiveGems.ts`)
 * with exactly the candle windows that code path would have at run time `t`.
 * A forming candle is rebuilt from the 15M history: it holds the 15M bars already
 * finished in its period plus the just-opened 15M bar (close = its open), which
 * is what a run a minute after the cron fires sees.
 *
 * Trades: entry at the gem's entry price at `t`, the gem's own SL/TP, the app's
 * spread, one trade at a time (same rules as forwardtest-2.1.ts).
 *
 * Run:
 *   bun run .\backtest\gem-candle-fix-study.ts
 */

import { writeFileSync } from 'node:fs';
import { getVolatilityAdjustedSpread } from '../src/lib/spreadConfig';
import {
  evaluateBoom1000Momentum, evaluateEurUsdZScore, evaluateGbpJpyMomentum,
} from '../supabase/functions/_shared/analysis/selectiveGems.ts';
import type { SelectiveGemSetup } from '../supabase/functions/_shared/analysis/selectiveGems.ts';
import { GRANULARITY, cleanSeries, firstIndexAtOrAfter, fmtStats, loadData, simulate, stats } from './lib';
import type { Candle, Series, Trade } from './lib';

const DATA_PATH = './backtest/data.json';
const OUT_PATH = './backtest/gem-candle-fix-results.json';
const FORWARD_SPLIT_EPOCH = Date.UTC(2026, 4, 1) / 1000; // same split as forwardtest-2.1.ts
const MAX_HOLD_HOURS = { day: 48, swing: 120 } as const;

type Tf = keyof Series;

/** Closed bars of `tf` at time t (bar end <= t). */
function closedBars(s: Series, tf: Tf, t: number): Candle[] {
  const bars = s[tf];
  const end = firstIndexAtOrAfter(bars, t - GRANULARITY[tf] + 1);
  return bars.slice(0, end);
}

/** The bar of `tf` still forming at t, rebuilt from 15M bars. */
function formingBar(s: Series, tf: Tf, t: number): Candle | null {
  const g = GRANULARITY[tf];
  const start = Math.floor(t / g) * g;
  const m15 = s.m15;
  const first = firstIndexAtOrAfter(m15, start);
  const atT = firstIndexAtOrAfter(m15, Math.floor(t / 900) * 900);
  if (atT >= m15.length) return null;
  const open = m15[first].open;
  let high = m15[atT].open, low = m15[atT].open;
  for (let k = first; k < atT; k++) { high = Math.max(high, m15[k].high); low = Math.min(low, m15[k].low); }
  high = Math.max(high, open); low = Math.min(low, open);
  return { epoch: start, open, high, low, close: m15[atT].open };
}

/** What a Deriv fetch of `count` bars returns at t: the last count-1 closed bars plus the forming one. */
function fetchLive(s: Series, tf: Tf, t: number, count: number): Candle[] {
  const closed = closedBars(s, tf, t).slice(-(count - 1));
  const forming = formingBar(s, tf, t);
  return forming ? [...closed, forming] : closed;
}

/**
 * The gems now drop candles still forming at the `nowEpoch` they are given.
 * "Current" variants pass this instead, which keeps every candle: the old behaviour.
 */
const BEFORE_FIX = Number.MAX_SAFE_INTEGER;

interface Variant {
  name: string;
  instrument: string;
  cadence: number; // seconds between runs
  evaluate: (s: Series, t: number) => SelectiveGemSetup | null;
}

export const VARIANTS: Variant[] = [
  // ---- BOOM1000 day ----
  {
    name: 'BOOM1000 engine — current (forming bars, 60×15M)', instrument: 'BOOM1000', cadence: 3600,
    evaluate: (s, t) => evaluateBoom1000Momentum(fetchLive(s, 'h4', t, 250), fetchLive(s, 'm15', t, 60), BEFORE_FIX),
  },
  {
    name: 'BOOM1000 engine — fixed (closed bars, 300×15M)', instrument: 'BOOM1000', cadence: 3600,
    evaluate: (s, t) => evaluateBoom1000Momentum(fetchLive(s, 'h4', t, 250), fetchLive(s, 'm15', t, 300), t),
  },
  {
    name: 'BOOM1000 app — current (1H as 15M, forming 4H)', instrument: 'BOOM1000', cadence: 3600,
    evaluate: (s, t) => evaluateBoom1000Momentum(fetchLive(s, 'h4', t, 300), fetchLive(s, 'h1', t, 200).slice(0, -1), BEFORE_FIX),
  },
  {
    name: 'BOOM1000 reference — fixed, run every 15 min', instrument: 'BOOM1000', cadence: 900,
    evaluate: (s, t) => evaluateBoom1000Momentum(fetchLive(s, 'h4', t, 250), fetchLive(s, 'm15', t, 300), t),
  },
  // ---- GBP/JPY swing ----
  {
    name: 'GBP/JPY — current (forming 1H)', instrument: 'GBP/JPY', cadence: 3600,
    evaluate: (s, t) => evaluateGbpJpyMomentum(fetchLive(s, 'h1', t, 200), BEFORE_FIX),
  },
  {
    name: 'GBP/JPY — fixed (closed 1H)', instrument: 'GBP/JPY', cadence: 3600,
    evaluate: (s, t) => evaluateGbpJpyMomentum(fetchLive(s, 'h1', t, 200), t),
  },
  // ---- EUR/USD swing ----
  {
    name: 'EUR/USD — current (forming D1 + 1H)', instrument: 'EUR/USD', cadence: 3600,
    evaluate: (s, t) => evaluateEurUsdZScore(fetchLive(s, 'd1', t, 250), fetchLive(s, 'h1', t, 200), BEFORE_FIX),
  },
  {
    name: 'EUR/USD — fixed (closed D1 + 1H)', instrument: 'EUR/USD', cadence: 3600,
    evaluate: (s, t) => evaluateEurUsdZScore(fetchLive(s, 'd1', t, 250), fetchLive(s, 'h1', t, 200), t),
  },
];

export function run(v: Variant, s: Series) {
  const m15 = s.m15;
  // Gems return null until they have enough history. Cron fires on the grid; the run lands a minute later.
  const start = Math.ceil((m15[0].epoch + 30 * 86400) / v.cadence) * v.cadence;
  const end = m15[m15.length - 1].epoch;
  const spread = getVolatilityAdjustedSpread(v.instrument as never, null);
  const trades: Trade[] = [];
  let busyUntil = 0;
  let signals = 0;

  for (let grid = start; grid < end; grid += v.cadence) {
    const t = grid + 60;
    if (t < busyUntil) continue;
    const setup = v.evaluate(s, t);
    if (!setup) continue;
    signals++;
    const dir = setup.direction === 'bullish' ? 1 : -1;
    const stopDist = Math.abs(setup.entry - setup.stopLoss);
    const tpR = Math.abs(setup.takeProfit - setup.entry) / stopDist;
    const trade = simulate(m15, t, setup.entry, dir, stopDist, tpR, spread, MAX_HOLD_HOURS[setup.tradeType]);
    if (!trade) continue;
    trades.push(trade);
    busyUntil = trade.exitEpoch;
  }
  return { signals, trades };
}

function main() {
  const raw = loadData(DATA_PATH);
  const results: Record<string, unknown>[] = [];
  for (const v of VARIANTS) {
    const { series } = cleanSeries(raw[v.instrument]);
    const { signals, trades } = run(v, series);
    const all = stats(trades);
    const train = stats(trades.filter(tr => tr.entryEpoch < FORWARD_SPLIT_EPOCH));
    const fwd = stats(trades.filter(tr => tr.entryEpoch >= FORWARD_SPLIT_EPOCH));
    console.log(`\n${v.name}\n  signals ${signals}\n  all     ${fmtStats(all)}\n  train   ${fmtStats(train)}\n  forward ${fmtStats(fwd)}`);
    results.push({ name: v.name, instrument: v.instrument, cadenceSeconds: v.cadence, signals, all, train, forward: fwd });
  }
  writeFileSync(OUT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), forwardSplit: '2026-05-01', results }, null, 2));
  console.log(`\nSaved ${OUT_PATH}`);
}

if (import.meta.main) main();
