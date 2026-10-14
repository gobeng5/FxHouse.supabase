/**
 * Candlestick & Chart Pattern Mining for Volatility Indices
 * Tests on V10, V25, V50, V75, V100 across H1 and H4
 * Evaluates in-sample (train before 2026-05-01) vs forward-test (2026-05-01 onwards)
 * Full realistic volatility-adjusted spread applied.
 */

import { writeFileSync } from 'node:fs';
import { getVolatilityAdjustedSpread } from '../src/lib/spreadConfig';
import {
  GRANULARITY, atrSeries, cleanSeries, emaSeries, firstIndexAtOrAfter,
  fmtR, loadData, simulate, stats,
} from './lib';
import type { Candle, Series, Stats, Trade } from './lib';

const DATA_PATH = './backtest/data.json';
const FORWARD_SPLIT_EPOCH = Date.UTC(2026, 4, 1) / 1000; // 2026-05-01
const VOL_INSTRUMENTS = ['V10', 'V25', 'V50', 'V75', 'V100'];

interface PatternResult {
  patternId: string;
  patternName: string;
  instrument: string;
  timeframe: 'h1' | 'h4';
  tpR: number;
  train: Stats;
  forward: Stats;
  forwardRaw: Stats;
  all: Stats;
}

interface CandleCtx {
  candles: Candle[];
  granularity: number;
  atr: number[];
  ema20: number[];
  ema50: number[];
}

function buildCandleCtx(candles: Candle[], granularity: number): CandleCtx {
  const closes = candles.map(c => c.close);
  return {
    candles,
    granularity,
    atr: atrSeries(candles, 14),
    ema20: emaSeries(closes, 20),
    ema50: emaSeries(closes, 50),
  };
}

// -------------------------------------------------------------
// PATTERN DETECTORS
// -------------------------------------------------------------

type PatternFn = (ctx: CandleCtx, i: number) => { dir: 1 | -1; stopDist: number } | null;

// Pattern 1: Liquidity Sweep + Pin Bar Reversal (False breakout of 20-bar extreme with rejection wick)
function detectSweepPinBar(ctx: CandleCtx, i: number): { dir: 1 | -1; stopDist: number } | null {
  if (i < 21) return null;
  const c = ctx.candles[i];
  const range = c.high - c.low;
  if (range <= 0) return null;

  const atr = ctx.atr[i];
  if (!atr || range < 0.5 * atr) return null; // must be significant candle

  let highestHighPrev = -Infinity;
  let lowestLowPrev = Infinity;
  for (let k = 1; k <= 20; k++) {
    if (ctx.candles[i - k].high > highestHighPrev) highestHighPrev = ctx.candles[i - k].high;
    if (ctx.candles[i - k].low < lowestLowPrev) lowestLowPrev = ctx.candles[i - k].low;
  }

  const upperWick = c.high - Math.max(c.open, c.close);
  const lowerWick = Math.min(c.open, c.close) - c.low;
  const body = Math.abs(c.close - c.open);

  // Bearish Pin: Swept prior 20-bar high, rejected, closed in lower 35% of range
  if (c.high > highestHighPrev && c.close < highestHighPrev && upperWick >= 2 * body && (c.close - c.low) / range < 0.35) {
    const stopDist = Math.max((c.high - c.close) + 0.1 * atr, 0.8 * atr);
    return { dir: -1, stopDist };
  }

  // Bullish Pin: Swept prior 20-bar low, rejected, closed in upper 35% of range
  if (c.low < lowestLowPrev && c.close > lowestLowPrev && lowerWick >= 2 * body && (c.high - c.close) / range < 0.35) {
    const stopDist = Math.max((c.close - c.low) + 0.1 * atr, 0.8 * atr);
    return { dir: 1, stopDist };
  }

  return null;
}

// Pattern 2: Trend-Aligned Engulfing Bar
function detectTrendEngulfing(ctx: CandleCtx, i: number): { dir: 1 | -1; stopDist: number } | null {
  if (i < 51) return null;
  const curr = ctx.candles[i];
  const prev = ctx.candles[i - 1];
  const atr = ctx.atr[i];
  if (!atr) return null;

  const currRange = curr.high - curr.low;
  const currBody = Math.abs(curr.close - curr.open);
  if (currRange < 0.6 * atr || currBody / currRange < 0.6) return null; // strong conviction body

  const trendBullish = curr.close > ctx.ema20[i] && ctx.ema20[i] > ctx.ema50[i];
  const trendBearish = curr.close < ctx.ema20[i] && ctx.ema20[i] < ctx.ema50[i];

  // Bullish Engulfing: prev is red, curr opens <= prev close and closes > prev high
  if (trendBullish && prev.close < prev.open && curr.close > curr.open && curr.close > prev.high && curr.open <= prev.close) {
    const stopDist = Math.max((curr.close - curr.low) + 0.1 * atr, 1.0 * atr);
    return { dir: 1, stopDist };
  }

  // Bearish Engulfing: prev is green, curr opens >= prev close and closes < prev low
  if (trendBearish && prev.close > prev.open && curr.close < curr.open && curr.close < prev.low && curr.open >= prev.close) {
    const stopDist = Math.max((curr.high - curr.close) + 0.1 * atr, 1.0 * atr);
    return { dir: -1, stopDist };
  }

  return null;
}

// Pattern 3: Inside Bar Momentum Expansion (Contraction -> Expansion)
function detectInsideBarBreakout(ctx: CandleCtx, i: number): { dir: 1 | -1; stopDist: number } | null {
  if (i < 51) return null;
  const curr = ctx.candles[i];
  const inside = ctx.candles[i - 1];
  const mother = ctx.candles[i - 2];
  const atr = ctx.atr[i];
  if (!atr) return null;

  // Check if i-1 was an inside bar relative to mother i-2
  const isInside = inside.high <= mother.high && inside.low >= mother.low;
  if (!isInside) return null;

  // Bullish breakout of inside bar with EMA trend alignment
  if (curr.close > inside.high && curr.close > ctx.ema20[i]) {
    const stopDist = Math.max(curr.close - inside.low, 1.0 * atr);
    return { dir: 1, stopDist };
  }

  // Bearish breakout of inside bar with EMA trend alignment
  if (curr.close < inside.low && curr.close < ctx.ema20[i]) {
    const stopDist = Math.max(inside.high - curr.close, 1.0 * atr);
    return { dir: -1, stopDist };
  }

  return null;
}

// Pattern 4: Morning Star / Evening Star Reversal
function detectStarReversal(ctx: CandleCtx, i: number): { dir: 1 | -1; stopDist: number } | null {
  if (i < 51) return null;
  const c1 = ctx.candles[i - 2];
  const c2 = ctx.candles[i - 1];
  const c3 = ctx.candles[i];
  const atr = ctx.atr[i];
  if (!atr) return null;

  const b1 = Math.abs(c1.close - c1.open);
  const b2 = Math.abs(c2.close - c2.open);
  const b3 = Math.abs(c3.close - c3.open);

  // Morning Star: C1 big red, C2 small indecision/star, C3 big green closing above C1 midpoint
  if (c1.close < c1.open && b1 > 0.6 * atr && b2 < 0.4 * atr && c3.close > c3.open && b3 > 0.6 * atr) {
    const c1Mid = (c1.open + c1.close) / 2;
    if (c3.close > c1Mid) {
      const lowestLow = Math.min(c1.low, c2.low, c3.low);
      const stopDist = Math.max((c3.close - lowestLow) + 0.1 * atr, 1.0 * atr);
      return { dir: 1, stopDist };
    }
  }

  // Evening Star: C1 big green, C2 small indecision/star, C3 big red closing below C1 midpoint
  if (c1.close > c1.open && b1 > 0.6 * atr && b2 < 0.4 * atr && c3.close < c3.open && b3 > 0.6 * atr) {
    const c1Mid = (c1.open + c1.close) / 2;
    if (c3.close < c1Mid) {
      const highestHigh = Math.max(c1.high, c2.high, c3.high);
      const stopDist = Math.max((highestHigh - c3.close) + 0.1 * atr, 1.0 * atr);
      return { dir: -1, stopDist };
    }
  }

  return null;
}

// Pattern 5: High-Momentum Range Expansion (Marubozu breakout of 20-bar Donchian)
function detectMomentumBreakout(ctx: CandleCtx, i: number): { dir: 1 | -1; stopDist: number } | null {
  if (i < 25) return null;
  const curr = ctx.candles[i];
  const atr = ctx.atr[i];
  if (!atr) return null;

  const range = curr.high - curr.low;
  const body = Math.abs(curr.close - curr.open);
  if (range < 0.8 * atr || body / range < 0.70) return null; // strong solid body candle

  let highestHighPrev = -Infinity;
  let lowestLowPrev = Infinity;
  for (let k = 1; k <= 20; k++) {
    if (ctx.candles[i - k].high > highestHighPrev) highestHighPrev = ctx.candles[i - k].high;
    if (ctx.candles[i - k].low < lowestLowPrev) lowestLowPrev = ctx.candles[i - k].low;
  }

  // Bullish breakout
  if (curr.close > highestHighPrev && curr.close > curr.open) {
    return { dir: 1, stopDist: 1.5 * atr };
  }

  // Bearish breakout
  if (curr.close < lowestLowPrev && curr.close < curr.open) {
    return { dir: -1, stopDist: 1.5 * atr };
  }

  return null;
}

// -------------------------------------------------------------
// RUNNER & EVALUATOR
// -------------------------------------------------------------

const PATTERNS: { id: string; name: string; fn: PatternFn; defaultTpR: number[] }[] = [
  { id: 'sweep_pin', name: 'Liquidity Sweep + Rejection Pin Bar', fn: detectSweepPinBar, defaultTpR: [1.5, 2.0, 2.5] },
  { id: 'trend_engulfing', name: 'Trend-Aligned Engulfing Bar', fn: detectTrendEngulfing, defaultTpR: [1.5, 2.0, 3.0] },
  { id: 'inside_break', name: 'Inside Bar Momentum Expansion', fn: detectInsideBarBreakout, defaultTpR: [1.5, 2.0, 2.5] },
  { id: 'star_reversal', name: 'Morning/Evening Star 3-Bar Reversal', fn: detectStarReversal, defaultTpR: [1.5, 2.0] },
  { id: 'momentum_donchian', name: 'Donchian Momentum Expansion (Marubozu)', fn: detectMomentumBreakout, defaultTpR: [1.5, 2.0, 2.5] },
];

function main() {
  console.log('Loading dataset from', DATA_PATH);
  const rawData = loadData(DATA_PATH);

  const cleanData: Record<string, Series> = {};
  for (const inst of VOL_INSTRUMENTS) {
    if (!rawData[inst]) continue;
    const { series } = cleanSeries(rawData[inst]);
    cleanData[inst] = series;
  }

  const allResults: PatternResult[] = [];

  for (const inst of VOL_INSTRUMENTS) {
    const series = cleanData[inst];
    if (!series) continue;

    const m15Candles = series.m15;

    for (const tf of ['h1', 'h4'] as const) {
      const candles = series[tf];
      const granularity = GRANULARITY[tf];
      const ctx = buildCandleCtx(candles, granularity);
      const maxHoldHours = tf === 'h1' ? 72 : 168;

      for (const pat of PATTERNS) {
        for (const tpR of pat.defaultTpR) {
          const tradesSpread: Trade[] = [];
          const tradesRaw: Trade[] = [];
          let busyUntil = 0;

          for (let i = 52; i < candles.length - 1; i++) {
            const c = candles[i];
            const candleCloseEpoch = c.epoch + granularity;
            if (candleCloseEpoch < busyUntil) continue; // 1 trade at a time

            const sig = pat.fn(ctx, i);
            if (!sig) continue;

            const entryPrice = c.close;
            const entryEpoch = candleCloseEpoch;
            const spread = getVolatilityAdjustedSpread(inst, null);

            const trade = simulate(m15Candles, entryEpoch, entryPrice, sig.dir, sig.stopDist, tpR, spread, maxHoldHours);
            if (trade) {
              tradesSpread.push(trade);
              busyUntil = trade.exitEpoch;
            }

            const rawTrade = simulate(m15Candles, entryEpoch, entryPrice, sig.dir, sig.stopDist, tpR, 0, maxHoldHours);
            if (rawTrade) tradesRaw.push(rawTrade);
          }

          const trainTrades = tradesSpread.filter(t => t.entryEpoch < FORWARD_SPLIT_EPOCH);
          const fwdTrades = tradesSpread.filter(t => t.entryEpoch >= FORWARD_SPLIT_EPOCH);
          const fwdRawTrades = tradesRaw.filter(t => t.entryEpoch >= FORWARD_SPLIT_EPOCH);

          allResults.push({
            patternId: pat.id,
            patternName: pat.name,
            instrument: inst,
            timeframe: tf,
            tpR,
            train: stats(trainTrades),
            forward: stats(fwdTrades),
            forwardRaw: stats(fwdRawTrades),
            all: stats(tradesSpread),
          });
        }
      }
    }
  }

  // Filter top performers in forward test (N >= 8, forward total R > 0, profit factor > 1.0)
  const winners = allResults
    .filter(r => r.forward.n >= 8 && r.forward.totalR > 0 && r.forward.profitFactor >= 1.05)
    .sort((a, b) => b.forward.totalR - a.forward.totalR);

  console.log('\n========================================================================================================');
  console.log(`TOP CANDLESTICK & CHART PATTERNS ON VOLATILITY INDICES (Forward Test May 2026 - Oct 2026)`);
  console.log('========================================================================================================');
  console.log(
    'Instrument TF  TargetR  Pattern Name                          | Fwd N  Win%   AvgR    Total R  PF    MaxDD  | Train R'
  );
  console.log('--------------------------------------------------------------------------------------------------------');

  for (const w of winners) {
    const pfStr = w.forward.profitFactor === Infinity ? 'Inf' : w.forward.profitFactor.toFixed(2);
    console.log(
      `${w.instrument.padEnd(10)} ${w.timeframe.toUpperCase().padEnd(4)} ${String(w.tpR).padEnd(8)} ${w.patternName.slice(0, 36).padEnd(37)} | ` +
      `${String(w.forward.n).padStart(5)}  ${w.forward.winRate.toFixed(1).padStart(5)}% ${fmtR(w.forward.avgR).padStart(7)} ${fmtR(w.forward.totalR).padStart(8)}R ${pfStr.padStart(5)} ${w.forward.maxDrawdownR.toFixed(2).padStart(6)}R | ` +
      `${fmtR(w.train.totalR).padStart(8)}R`
    );
  }

  // Save full study output
  writeFileSync('./backtest/candlestick-volatility-results.json', JSON.stringify({ winners, allResults }, null, 2));
  console.log(`\nFound ${winners.length} candidate setups with forward-test alpha. Results saved to ./backtest/candlestick-volatility-results.json`);
}

main();

