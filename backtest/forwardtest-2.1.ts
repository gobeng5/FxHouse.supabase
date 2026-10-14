/**
 * Forward-testing runner for v2.1 MTF Complete Strategy Package
 * Splits historical data at 2026-05-01 as specified in the strategy metadata.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { getVolatilityAdjustedSpread } from '../src/lib/spreadConfig';
import {
  GRANULARITY, atrSeries, cleanSeries, emaSeries, firstIndexAtOrAfter,
  fmtR, loadData, rsiSeries, simulate, stats,
} from './lib';
import type { Candle, Series, Stats, Trade } from './lib';

const DATA_PATH = './backtest/data.json';
const FORWARD_SPLIT_EPOCH = Date.UTC(2026, 4, 1) / 1000; // 2026-05-01 00:00:00 UTC
const MAX_HOLD_HOURS_DAY = 48;
const MAX_HOLD_HOURS_SWING = 120;

// Z-Score calculation: (close - SMA(30)) / StdDev(30)
function zScoreSeries(closes: number[], period = 30): number[] {
  const out = new Array<number>(closes.length).fill(NaN);
  if (closes.length < period) return out;

  for (let i = period - 1; i < closes.length; i++) {
    let sum = 0;
    for (let k = 0; k < period; k++) sum += closes[i - k];
    const mean = sum / period;

    let sqSum = 0;
    for (let k = 0; k < period; k++) sqSum += (closes[i - k] - mean) ** 2;
    const stdDev = Math.sqrt(sqSum / period);

    out[i] = stdDev > 0 ? (closes[i] - mean) / stdDev : 0;
  }
  return out;
}

// Find index of last completed HTF candle before or at the given epoch
function lastCompletedHtfIndex(htfCandles: Candle[], htfGranularity: number, currentCandleCloseEpoch: number): number {
  let lo = 0, hi = htfCandles.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const htfCloseEpoch = htfCandles[mid].epoch + htfGranularity;
    if (htfCloseEpoch <= currentCandleCloseEpoch) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

interface StrategyConfig {
  instrument: string;
  type: 'day' | 'swing';
  name: string;
  priority: string;
  timeframe: 'm15' | 'h1';
  htfFilter: 'h4' | 'd1' | 'none';
  slAtr: number;
  tpAtr: number;
  evaluateSignal: (ctx: TimeframeContext, i: number, htfBias: number) => 1 | -1 | 0;
}

interface TimeframeContext {
  candles: Candle[];
  granularity: number;
  ema8: number[];
  ema21: number[];
  ema50: number[];
  ema200: number[];
  rsi: number[];
  atr: number[];
  z: number[];
}

interface HtfContext {
  candles: Candle[];
  granularity: number;
  ema50: number[];
  ema200: number[];
}

function buildTfContext(candles: Candle[], granularity: number): TimeframeContext {
  const closes = candles.map(c => c.close);
  return {
    candles,
    granularity,
    ema8: emaSeries(closes, 8),
    ema21: emaSeries(closes, 21),
    ema50: emaSeries(closes, 50),
    ema200: emaSeries(closes, 200),
    rsi: rsiSeries(closes, 14),
    atr: atrSeries(candles, 14),
    z: zScoreSeries(closes, 30),
  };
}

function buildHtfContext(candles: Candle[], granularity: number): HtfContext {
  const closes = candles.map(c => c.close);
  return {
    candles,
    granularity,
    ema50: emaSeries(closes, 50),
    ema200: emaSeries(closes, 200),
  };
}

function getHtfBias(htf: HtfContext, currentCloseEpoch: number): number {
  const idx = lastCompletedHtfIndex(htf.candles, htf.granularity, currentCloseEpoch);
  if (idx < 0) return 0;
  const c = htf.candles[idx];
  const e50 = htf.ema50[idx];
  const e200 = htf.ema200[idx];
  if (Number.isNaN(e50) || Number.isNaN(e200)) return 0;
  if (c.close > e50 && c.close > e200) return 1;
  if (c.close < e50 && c.close < e200) return -1;
  return 0;
}

// Strategy Definitions
const STRATEGIES: StrategyConfig[] = [
  // EUR/USD
  {
    instrument: 'EUR/USD', type: 'day', name: 'MTF Z-Score Mean Reversion', priority: 'High',
    timeframe: 'm15', htfFilter: 'h4', slAtr: 0.8, tpAtr: 1.2,
    evaluateSignal: (ctx, i, bias) => {
      if (ctx.z[i] < -2.0 && ctx.rsi[i] < 35 && bias === 1) return 1;
      if (ctx.z[i] > 2.0 && ctx.rsi[i] > 65 && bias === -1) return -1;
      return 0;
    }
  },
  {
    instrument: 'EUR/USD', type: 'swing', name: 'MTF Z-Score Mean Reversion', priority: 'High',
    timeframe: 'h1', htfFilter: 'd1', slAtr: 1.0, tpAtr: 1.6,
    evaluateSignal: (ctx, i, bias) => {
      if (ctx.z[i] < -1.8 && ctx.rsi[i] < 40 && bias === 1) return 1;
      if (ctx.z[i] > 1.8 && ctx.rsi[i] > 60 && bias === -1) return -1;
      return 0;
    }
  },

  // GBP/USD
  {
    instrument: 'GBP/USD', type: 'day', name: 'MTF Z-Score Mean Reversion', priority: 'High',
    timeframe: 'm15', htfFilter: 'h4', slAtr: 0.9, tpAtr: 1.3,
    evaluateSignal: (ctx, i, bias) => {
      if (ctx.z[i] < -1.9 && ctx.rsi[i] < 37 && bias === 1) return 1;
      if (ctx.z[i] > 1.9 && ctx.rsi[i] > 63 && bias === -1) return -1;
      return 0;
    }
  },
  {
    instrument: 'GBP/USD', type: 'swing', name: 'MTF Z-Score Mean Reversion', priority: 'Medium',
    timeframe: 'h1', htfFilter: 'd1', slAtr: 1.0, tpAtr: 1.6,
    evaluateSignal: (ctx, i, bias) => {
      if (ctx.z[i] < -1.8 && ctx.rsi[i] < 40 && bias === 1) return 1;
      if (ctx.z[i] > 1.8 && ctx.rsi[i] > 60 && bias === -1) return -1;
      return 0;
    }
  },

  // AUD/USD
  {
    instrument: 'AUD/USD', type: 'day', name: 'MTF Z-Score Mean Reversion', priority: 'High',
    timeframe: 'm15', htfFilter: 'h4', slAtr: 0.8, tpAtr: 1.2,
    evaluateSignal: (ctx, i, bias) => {
      if (ctx.z[i] < -2.0 && ctx.rsi[i] < 35 && bias === 1) return 1;
      if (ctx.z[i] > 2.0 && ctx.rsi[i] > 65 && bias === -1) return -1;
      return 0;
    }
  },
  {
    instrument: 'AUD/USD', type: 'swing', name: 'MTF Z-Score Mean Reversion', priority: 'Medium',
    timeframe: 'h1', htfFilter: 'd1', slAtr: 1.0, tpAtr: 1.6,
    evaluateSignal: (ctx, i, bias) => {
      if (ctx.z[i] < -1.8 && ctx.rsi[i] < 40 && bias === 1) return 1;
      if (ctx.z[i] > 1.8 && ctx.rsi[i] > 60 && bias === -1) return -1;
      return 0;
    }
  },

  // USD/JPY
  {
    instrument: 'USD/JPY', type: 'day', name: 'MTF Z-Score Mean Reversion (Optimized)', priority: 'High',
    timeframe: 'm15', htfFilter: 'h4', slAtr: 0.9, tpAtr: 1.4,
    evaluateSignal: (ctx, i, bias) => {
      if (ctx.z[i] < -1.6 && ctx.rsi[i] < 40 && bias === 1) return 1;
      if (ctx.z[i] > 1.6 && ctx.rsi[i] > 60 && bias === -1) return -1;
      return 0;
    }
  },
  {
    instrument: 'USD/JPY', type: 'swing', name: 'MTF Z-Score Mean Reversion', priority: 'Medium',
    timeframe: 'h1', htfFilter: 'd1', slAtr: 1.0, tpAtr: 1.6,
    evaluateSignal: (ctx, i, bias) => {
      if (ctx.z[i] < -1.7 && ctx.rsi[i] < 42 && bias === 1) return 1;
      if (ctx.z[i] > 1.7 && ctx.rsi[i] > 58 && bias === -1) return -1;
      return 0;
    }
  },

  // GBP/JPY
  {
    instrument: 'GBP/JPY', type: 'day', name: 'MTF Z-Score Mean Reversion', priority: 'Medium',
    timeframe: 'm15', htfFilter: 'h4', slAtr: 0.9, tpAtr: 1.4,
    evaluateSignal: (ctx, i, bias) => {
      if (ctx.z[i] < -1.7 && ctx.rsi[i] < 38 && bias === 1) return 1;
      if (ctx.z[i] > 1.7 && ctx.rsi[i] > 62 && bias === -1) return -1;
      return 0;
    }
  },
  {
    instrument: 'GBP/JPY', type: 'swing', name: 'Original Unfiltered Momentum', priority: 'Medium',
    timeframe: 'h1', htfFilter: 'none', slAtr: 1.2, tpAtr: 2.0,
    evaluateSignal: (ctx, i) => {
      if (i < 1) return 0;
      const crossUp = ctx.ema8[i] > ctx.ema21[i] && ctx.ema8[i - 1] <= ctx.ema21[i - 1];
      const crossDown = ctx.ema8[i] < ctx.ema21[i] && ctx.ema8[i - 1] >= ctx.ema21[i - 1];
      if (crossUp && ctx.candles[i].close > ctx.ema50[i]) return 1;
      if (crossDown && ctx.candles[i].close < ctx.ema50[i]) return -1;
      return 0;
    }
  },

  // XAU/USD
  {
    instrument: 'XAU/USD', type: 'day', name: 'MTF Regime EMA Pullback', priority: 'High',
    timeframe: 'm15', htfFilter: 'h4', slAtr: 1.0, tpAtr: 1.6,
    evaluateSignal: (ctx, i, bias) => {
      const c = ctx.candles[i];
      const long = c.close > ctx.ema200[i] && c.low <= ctx.ema21[i] && c.close > ctx.ema21[i] && ctx.rsi[i] >= 40 && ctx.rsi[i] <= 55 && bias === 1;
      const short = c.close < ctx.ema200[i] && c.high >= ctx.ema21[i] && c.close < ctx.ema21[i] && ctx.rsi[i] >= 45 && ctx.rsi[i] <= 60 && bias === -1;
      if (long) return 1;
      if (short) return -1;
      return 0;
    }
  },
  {
    instrument: 'XAU/USD', type: 'swing', name: 'MTF Regime EMA Pullback', priority: 'Low',
    timeframe: 'h1', htfFilter: 'd1', slAtr: 1.0, tpAtr: 1.8,
    evaluateSignal: (ctx, i, bias) => {
      const c = ctx.candles[i];
      const long = c.close > ctx.ema200[i] && c.low <= ctx.ema21[i] && c.close > ctx.ema21[i] && ctx.rsi[i] >= 40 && ctx.rsi[i] <= 55 && bias === 1;
      const short = c.close < ctx.ema200[i] && c.high >= ctx.ema21[i] && c.close < ctx.ema21[i] && ctx.rsi[i] >= 45 && ctx.rsi[i] <= 60 && bias === -1;
      if (long) return 1;
      if (short) return -1;
      return 0;
    }
  },

  // V10
  {
    instrument: 'V10', type: 'day', name: 'MTF Momentum', priority: 'Medium',
    timeframe: 'm15', htfFilter: 'h4', slAtr: 1.2, tpAtr: 2.0,
    evaluateSignal: (ctx, i, bias) => {
      if (i < 1) return 0;
      const crossUp = ctx.ema8[i] > ctx.ema21[i] && ctx.ema8[i - 1] <= ctx.ema21[i - 1];
      const crossDown = ctx.ema8[i] < ctx.ema21[i] && ctx.ema8[i - 1] >= ctx.ema21[i - 1];
      if (crossUp && ctx.candles[i].close > ctx.ema50[i] && bias === 1) return 1;
      if (crossDown && ctx.candles[i].close < ctx.ema50[i] && bias === -1) return -1;
      return 0;
    }
  },
  {
    instrument: 'V10', type: 'swing', name: 'MTF Z-Score Mean Reversion', priority: 'Medium',
    timeframe: 'h1', htfFilter: 'd1', slAtr: 1.0, tpAtr: 1.5,
    evaluateSignal: (ctx, i, bias) => {
      if (ctx.z[i] < -2.0 && ctx.rsi[i] < 40 && bias === 1) return 1;
      if (ctx.z[i] > 2.0 && ctx.rsi[i] > 60 && bias === -1) return -1;
      return 0;
    }
  },

  // V25
  {
    instrument: 'V25', type: 'day', name: 'MTF Momentum', priority: 'High',
    timeframe: 'm15', htfFilter: 'h4', slAtr: 1.2, tpAtr: 2.0,
    evaluateSignal: (ctx, i, bias) => {
      if (i < 1) return 0;
      const crossUp = ctx.ema8[i] > ctx.ema21[i] && ctx.ema8[i - 1] <= ctx.ema21[i - 1];
      const crossDown = ctx.ema8[i] < ctx.ema21[i] && ctx.ema8[i - 1] >= ctx.ema21[i - 1];
      if (crossUp && ctx.candles[i].close > ctx.ema50[i] && bias === 1) return 1;
      if (crossDown && ctx.candles[i].close < ctx.ema50[i] && bias === -1) return -1;
      return 0;
    }
  },
  {
    instrument: 'V25', type: 'swing', name: 'MTF Z-Score Mean Reversion', priority: 'Medium',
    timeframe: 'h1', htfFilter: 'd1', slAtr: 1.0, tpAtr: 1.5,
    evaluateSignal: (ctx, i, bias) => {
      if (ctx.z[i] < -2.0 && ctx.rsi[i] < 40 && bias === 1) return 1;
      if (ctx.z[i] > 2.0 && ctx.rsi[i] > 60 && bias === -1) return -1;
      return 0;
    }
  },

  // V50
  {
    instrument: 'V50', type: 'day', name: 'MTF Momentum', priority: 'Low',
    timeframe: 'm15', htfFilter: 'h4', slAtr: 1.2, tpAtr: 2.0,
    evaluateSignal: (ctx, i, bias) => {
      if (i < 1) return 0;
      const crossUp = ctx.ema8[i] > ctx.ema21[i] && ctx.ema8[i - 1] <= ctx.ema21[i - 1];
      const crossDown = ctx.ema8[i] < ctx.ema21[i] && ctx.ema8[i - 1] >= ctx.ema21[i - 1];
      if (crossUp && ctx.candles[i].close > ctx.ema50[i] && bias === 1) return 1;
      if (crossDown && ctx.candles[i].close < ctx.ema50[i] && bias === -1) return -1;
      return 0;
    }
  },
  {
    instrument: 'V50', type: 'swing', name: 'MTF Z-Score Mean Reversion', priority: 'Medium',
    timeframe: 'h1', htfFilter: 'd1', slAtr: 1.0, tpAtr: 1.5,
    evaluateSignal: (ctx, i, bias) => {
      if (ctx.z[i] < -2.0 && ctx.rsi[i] < 40 && bias === 1) return 1;
      if (ctx.z[i] > 2.0 && ctx.rsi[i] > 60 && bias === -1) return -1;
      return 0;
    }
  },

  // V75
  {
    instrument: 'V75', type: 'swing', name: 'MTF Z-Score Mean Reversion', priority: 'High',
    timeframe: 'h1', htfFilter: 'd1', slAtr: 1.0, tpAtr: 1.5,
    evaluateSignal: (ctx, i, bias) => {
      if (ctx.z[i] < -2.0 && ctx.rsi[i] < 40 && bias === 1) return 1;
      if (ctx.z[i] > 2.0 && ctx.rsi[i] > 60 && bias === -1) return -1;
      return 0;
    }
  },

  // V100
  {
    instrument: 'V100', type: 'day', name: 'MTF Z-Score Mean Reversion', priority: 'High',
    timeframe: 'm15', htfFilter: 'h4', slAtr: 0.9, tpAtr: 1.4,
    evaluateSignal: (ctx, i, bias) => {
      if (ctx.z[i] < -1.8 && ctx.rsi[i] < 40 && bias === 1) return 1;
      if (ctx.z[i] > 1.8 && ctx.rsi[i] > 60 && bias === -1) return -1;
      return 0;
    }
  },
  {
    instrument: 'V100', type: 'swing', name: 'MTF Z-Score Mean Reversion', priority: 'Medium',
    timeframe: 'h1', htfFilter: 'd1', slAtr: 1.0, tpAtr: 1.5,
    evaluateSignal: (ctx, i, bias) => {
      if (ctx.z[i] < -2.0 && ctx.rsi[i] < 40 && bias === 1) return 1;
      if (ctx.z[i] > 2.0 && ctx.rsi[i] > 60 && bias === -1) return -1;
      return 0;
    }
  },

  // BOOM1000
  {
    instrument: 'BOOM1000', type: 'day', name: 'MTF Momentum', priority: 'High',
    timeframe: 'm15', htfFilter: 'h4', slAtr: 1.5, tpAtr: 3.0,
    evaluateSignal: (ctx, i, bias) => {
      if (i < 1) return 0;
      const crossUp = ctx.ema8[i] > ctx.ema21[i] && ctx.ema8[i - 1] <= ctx.ema21[i - 1];
      const crossDown = ctx.ema8[i] < ctx.ema21[i] && ctx.ema8[i - 1] >= ctx.ema21[i - 1];
      if (crossUp && ctx.candles[i].close > ctx.ema50[i] && bias === 1) return 1;
      if (crossDown && ctx.candles[i].close < ctx.ema50[i] && bias === -1) return -1;
      return 0;
    }
  },
  {
    instrument: 'BOOM1000', type: 'swing', name: 'MTF Regime Pullback', priority: 'Medium',
    timeframe: 'h1', htfFilter: 'd1', slAtr: 1.2, tpAtr: 2.0,
    evaluateSignal: (ctx, i, bias) => {
      const c = ctx.candles[i];
      const long = c.close > ctx.ema200[i] && c.low <= ctx.ema21[i] && c.close > ctx.ema21[i] && ctx.rsi[i] >= 40 && ctx.rsi[i] <= 58 && bias === 1;
      const short = c.close < ctx.ema200[i] && c.high >= ctx.ema21[i] && c.close < ctx.ema21[i] && ctx.rsi[i] >= 42 && ctx.rsi[i] <= 60 && bias === -1;
      if (long) return 1;
      if (short) return -1;
      return 0;
    }
  },
];

interface SimulationResult {
  strategy: StrategyConfig;
  allTrades: Trade[];
  trainTrades: Trade[];
  forwardTrades: Trade[];
  statsAll: Stats;
  statsTrain: Stats;
  statsForward: Stats;
  statsForwardRaw: Stats;
}

function runBacktest(): void {
  console.log(`Loading dataset from ${DATA_PATH}...`);
  const rawData = loadData(DATA_PATH);
  console.log(`Loaded dataset with ${Object.keys(rawData).length} instruments.`);

  const cleanData: Record<string, Series> = {};
  for (const inst of Object.keys(rawData)) {
    const { series } = cleanSeries(rawData[inst]);
    cleanData[inst] = series;
  }

  // Prebuild contexts
  const contexts: Record<string, { m15: TimeframeContext; h1: TimeframeContext; h4: HtfContext; d1: HtfContext }> = {};
  for (const inst of Object.keys(cleanData)) {
    const s = cleanData[inst];
    contexts[inst] = {
      m15: buildTfContext(s.m15, GRANULARITY.m15),
      h1: buildTfContext(s.h1, GRANULARITY.h1),
      h4: buildHtfContext(s.h4, GRANULARITY.h4),
      d1: buildHtfContext(s.d1, GRANULARITY.d1),
    };
  }

  const results: SimulationResult[] = [];

  for (const strat of STRATEGIES) {
    const inst = strat.instrument;
    const ctx = contexts[inst];
    if (!ctx) continue;

    const tfCtx = strat.timeframe === 'm15' ? ctx.m15 : ctx.h1;
    const htfCtx = strat.htfFilter === 'h4' ? ctx.h4 : strat.htfFilter === 'd1' ? ctx.d1 : null;
    const m15Series = cleanData[inst].m15;

    const maxHold = strat.type === 'day' ? MAX_HOLD_HOURS_DAY : MAX_HOLD_HOURS_SWING;
    const tpR = strat.tpAtr / strat.slAtr;

    const tradesWithSpread: Trade[] = [];
    const tradesRaw: Trade[] = [];

    // Warmup period: wait until EMA200 is available (200 bars)
    const warmup = 205;
    let nextAvailableEpoch = 0;

    for (let i = warmup; i < tfCtx.candles.length - 1; i++) {
      const c = tfCtx.candles[i];
      const candleCloseEpoch = c.epoch + tfCtx.granularity;

      // Ensure no overlapping trades
      if (candleCloseEpoch < nextAvailableEpoch) continue;

      const bias = htfCtx ? getHtfBias(htfCtx, candleCloseEpoch) : 0;
      const dir = strat.evaluateSignal(tfCtx, i, bias);
      if (dir === 0) continue;

      const atr = tfCtx.atr[i];
      if (!atr || Number.isNaN(atr) || atr <= 0) continue;

      const stopDist = strat.slAtr * atr;
      const entryPrice = c.close; // enter at close of signal candle / open of next
      const entryEpoch = candleCloseEpoch;

      const spread = getVolatilityAdjustedSpread(inst, null);

      // Simulate with realistic spread
      const trade = simulate(m15Series, entryEpoch, entryPrice, dir, stopDist, tpR, spread, maxHold);
      if (trade) {
        tradesWithSpread.push(trade);
        nextAvailableEpoch = trade.exitEpoch;
      }

      // Raw trade (0 spread)
      const rawTrade = simulate(m15Series, entryEpoch, entryPrice, dir, stopDist, tpR, 0, maxHold);
      if (rawTrade) {
        tradesRaw.push(rawTrade);
      }
    }

    const trainTrades = tradesWithSpread.filter(t => t.entryEpoch < FORWARD_SPLIT_EPOCH);
    const forwardTrades = tradesWithSpread.filter(t => t.entryEpoch >= FORWARD_SPLIT_EPOCH);
    const forwardTradesRaw = tradesRaw.filter(t => t.entryEpoch >= FORWARD_SPLIT_EPOCH);

    results.push({
      strategy: strat,
      allTrades: tradesWithSpread,
      trainTrades,
      forwardTrades,
      statsAll: stats(tradesWithSpread),
      statsTrain: stats(trainTrades),
      statsForward: stats(forwardTrades),
      statsForwardRaw: stats(forwardTradesRaw),
    });
  }

  // Print Summary Table
  console.log('\n========================================================================================================');
  console.log('FORWARD TEST RESULTS (Split Date: 2026-05-01 to Oct 2026)');
  console.log('========================================================================================================');
  console.log(
    'Instrument   Type   Priority Name                          | Fwd N  Win%   AvgR    Total R  PF    MaxDD  | Train Total R'
  );
  console.log('--------------------------------------------------------------------------------------------------------');

  for (const r of results) {
    const s = r.strategy;
    const f = r.statsForward;
    const tr = r.statsTrain;
    const pfStr = f.profitFactor === Infinity ? 'Inf' : f.profitFactor.toFixed(2);
    console.log(
      `${s.instrument.padEnd(12)} ${s.type.padEnd(6)} ${s.priority.padEnd(8)} ${s.name.slice(0, 28).padEnd(29)} | ` +
      `${String(f.n).padStart(5)}  ${f.winRate.toFixed(1).padStart(5)}% ${fmtR(f.avgR).padStart(7)} ${fmtR(f.totalR).padStart(8)}R ${pfStr.padStart(5)} ${f.maxDrawdownR.toFixed(2).padStart(6)}R | ` +
      `${fmtR(tr.totalR).padStart(9)}R`
    );
  }

  // Portfolio Aggregation
  console.log('\n========================================================================================================');
  console.log('PORTFOLIO PERFORMANCE BREAKDOWN');
  console.log('========================================================================================================');

  const coreHigh = results.filter(r => r.strategy.priority === 'High');
  const medium = results.filter(r => r.strategy.priority === 'Medium');
  const allExceptAvoid = results.filter(r => r.strategy.priority !== 'Avoid');

  function portfolioStats(resList: SimulationResult[], forwardOnly: boolean) {
    const allT: Trade[] = [];
    for (const r of resList) {
      allT.push(...(forwardOnly ? r.forwardTrades : r.allTrades));
    }
    allT.sort((a, b) => a.entryEpoch - b.entryEpoch);
    return stats(allT);
  }

  const pCoreFwd = portfolioStats(coreHigh, true);
  const pMedFwd = portfolioStats(medium, true);
  const pAllFwd = portfolioStats(allExceptAvoid, true);

  console.log(`Core High Priority Portfolio (Forward Test):`);
  console.log(`  Trades: ${pCoreFwd.n} | Win Rate: ${pCoreFwd.winRate.toFixed(1)}% | Profit Factor: ${pCoreFwd.profitFactor.toFixed(2)} | Total R: ${fmtR(pCoreFwd.totalR)}R | Max Drawdown: ${pCoreFwd.maxDrawdownR.toFixed(2)}R`);

  console.log(`Supporting Medium Priority Portfolio (Forward Test):`);
  console.log(`  Trades: ${pMedFwd.n} | Win Rate: ${pMedFwd.winRate.toFixed(1)}% | Profit Factor: ${pMedFwd.profitFactor.toFixed(2)} | Total R: ${fmtR(pMedFwd.totalR)}R | Max Drawdown: ${pMedFwd.maxDrawdownR.toFixed(2)}R`);

  console.log(`Combined Complete Portfolio (Forward Test):`);
  console.log(`  Trades: ${pAllFwd.n} | Win Rate: ${pAllFwd.winRate.toFixed(1)}% | Profit Factor: ${pAllFwd.profitFactor.toFixed(2)} | Total R: ${fmtR(pAllFwd.totalR)}R | Max Drawdown: ${pAllFwd.maxDrawdownR.toFixed(2)}R`);

  // Save JSON
  const outputData = {
    meta: {
      splitDate: '2026-05-01',
      totalStrategies: results.length,
    },
    strategies: results.map(r => ({
      instrument: r.strategy.instrument,
      type: r.strategy.type,
      name: r.strategy.name,
      priority: r.strategy.priority,
      forward: r.statsForward,
      forwardRaw: r.statsForwardRaw,
      train: r.statsTrain,
      all: r.statsAll,
    })),
    portfolios: {
      coreHighForward: pCoreFwd,
      supportingMediumForward: pMedFwd,
      combinedForward: pAllFwd,
    }
  };

  writeFileSync('./backtest/forwardtest-2.1-results.json', JSON.stringify(outputData, null, 2));
  console.log('\nResults saved to ./backtest/forwardtest-2.1-results.json');
}

runBacktest();

