/**
 * Selective Gems from v2.1 MTF Strategy Package
 *
 * Implements the three out-of-sample forward-test proven strategies:
 *   1. GBP/JPY Swing (Unfiltered Momentum) — H1 EMA8/21 cross + EMA50 alignment (+14.3R forward, PF 1.34)
 *   2. EUR/USD Swing (MTF Z-Score Mean Reversion) — D1 EMA50/200 bias + H1 Z-score/RSI (+5.0R forward, PF 1.25)
 *   3. BOOM1000 Day (MTF Momentum) — H4 EMA50/200 bias + M15 EMA8/21 cross (+20.6R full year, PF 1.06)
 *
 * Runtime-neutral: relative `.ts` imports only (runs in both Vite and Deno).
 * Closed candles only: deterministic, reproducible inputs.
 */

import type { CandleData, TradingInstrument, TrendDirection } from './core.ts';
import { calculateATR, calculateEMA, calculateRSI, calculateSMA } from './indicators.ts';

export const GEM_SETUP_TYPES = {
  GBPJPY_MOMENTUM: 'gem_gbpjpy_momentum',
  EURUSD_ZSCORE: 'gem_eurusd_zscore',
  BOOM1000_MOMENTUM: 'gem_boom1000_momentum',
} as const;

export interface GemParameter {
  label: string;
  value: string;
  weight: number;
  maxWeight: number;
  contributing: boolean;
}

export interface SelectiveGemSetup {
  instrument: TradingInstrument;
  direction: 'bullish' | 'bearish';
  entry: number;
  stopLoss: number;
  takeProfit: number;
  atr: number;
  confidence: number;
  setupType: string;
  tradeType: 'swing' | 'day';
  reason: string;
  parameters: GemParameter[];
}

/**
 * Calculates rolling Z-score: (close - SMA(period)) / StdDev(period)
 */
function calculateZScore(closes: number[], period = 30): number | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const sum = slice.reduce((acc, v) => acc + v, 0);
  const mean = sum / period;
  const sqDiffs = slice.reduce((acc, v) => acc + (v - mean) ** 2, 0);
  const stdDev = Math.sqrt(sqDiffs / period);
  if (stdDev <= 0) return 0;
  const current = closes[closes.length - 1];
  return (current - mean) / stdDev;
}

/**
 * Checks higher-timeframe bias against EMA50 and EMA200.
 * Returns 1 (bullish), -1 (bearish), or 0 (neutral).
 */
function getEmaBias(closes: number[]): 1 | -1 | 0 {
  if (closes.length < 200) return 0;
  const ema50 = calculateEMA(closes, 50);
  const ema200 = calculateEMA(closes, 200);
  if (!ema50.length || !ema200.length) return 0;

  const currentClose = closes[closes.length - 1];
  const e50 = ema50[ema50.length - 1];
  const e200 = ema200[ema200.length - 1];

  if (currentClose > e50 && currentClose > e200) return 1;
  if (currentClose < e50 && currentClose < e200) return -1;
  return 0;
}

/**
 * Gem 1: GBP/JPY Swing (Original Unfiltered Momentum)
 * Timeframe: H1
 * Entry: EMA(8) crosses EMA(21) with close aligned with EMA(50)
 * Risk: SL = 1.2 * ATR(14), TP = 2.0 * ATR(14) (Reward:Risk = 1.67)
 */
export function evaluateGbpJpyMomentum(oneHourCandles: CandleData[]): SelectiveGemSetup | null {
  if (oneHourCandles.length < 60) return null;

  const closes = oneHourCandles.map(c => c.close);
  const ema8 = calculateEMA(closes, 8);
  const ema21 = calculateEMA(closes, 21);
  const ema50 = calculateEMA(closes, 50);

  if (ema8.length < 2 || ema21.length < 2 || !ema50.length) return null;

  const lastIdx = closes.length - 1;
  const e8Curr = ema8[ema8.length - 1];
  const e8Prev = ema8[ema8.length - 2];
  const e21Curr = ema21[ema21.length - 1];
  const e21Prev = ema21[ema21.length - 2];
  const e50Curr = ema50[ema50.length - 1];
  const closeCurr = closes[lastIdx];

  const crossUp = e8Curr > e21Curr && e8Prev <= e21Prev;
  const crossDown = e8Curr < e21Curr && e8Prev >= e21Prev;

  let direction: 'bullish' | 'bearish' | null = null;
  if (crossUp && closeCurr > e50Curr) direction = 'bullish';
  else if (crossDown && closeCurr < e50Curr) direction = 'bearish';

  if (!direction) return null;

  const atr = calculateATR(oneHourCandles, 14);
  if (atr <= 0) return null;

  const stopDist = 1.2 * atr;
  const tpDist = 2.0 * atr;
  const entry = closeCurr;
  const stopLoss = direction === 'bullish' ? entry - stopDist : entry + stopDist;
  const takeProfit = direction === 'bullish' ? entry + tpDist : entry - tpDist;

  return {
    instrument: 'GBP/JPY',
    direction,
    entry,
    stopLoss,
    takeProfit,
    atr,
    confidence: 65,
    setupType: GEM_SETUP_TYPES.GBPJPY_MOMENTUM,
    tradeType: 'swing',
    reason: `GBP/JPY Momentum Swing: 1H EMA8 crossed ${direction === 'bullish' ? 'above' : 'below'} EMA21 with price ${direction === 'bullish' ? 'above' : 'below'} EMA50. Validated forward PF 1.34 (+14.3R).`,
    parameters: [
      { label: 'Timeframe', value: '1H', weight: 1, maxWeight: 1, contributing: true },
      { label: 'Signal', value: `EMA(8)/EMA(21) Cross ${direction === 'bullish' ? 'Up' : 'Down'}`, weight: 1, maxWeight: 1, contributing: true },
      { label: 'Trend Alignment', value: `Close ${direction === 'bullish' ? '>' : '<'} EMA(50)`, weight: 1, maxWeight: 1, contributing: true },
      { label: 'Risk Geometry', value: 'SL 1.2x ATR, TP 2.0x ATR (1.67:1 R:R)', weight: 1, maxWeight: 1, contributing: true },
    ],
  };
}

/**
 * Gem 2: EUR/USD Swing (MTF Z-Score Mean Reversion)
 * Timeframe: H1 (with Daily filter)
 * Daily Filter: Close > EMA50 & EMA200 (bullish) / Close < EMA50 & EMA200 (bearish)
 * Entry: Z-Score(30) < -1.8 AND RSI < 40 (Long) / Z-Score > 1.8 AND RSI > 60 (Short)
 * Risk: SL = 1.0 * ATR(14), TP = 1.6 * ATR(14) (Reward:Risk = 1.60)
 */
export function evaluateEurUsdZScore(
  dailyCandles: CandleData[],
  oneHourCandles: CandleData[],
): SelectiveGemSetup | null {
  if (dailyCandles.length < 200 || oneHourCandles.length < 50) return null;

  const dailyCloses = dailyCandles.map(c => c.close);
  const htfBias = getEmaBias(dailyCloses);
  if (htfBias === 0) return null; // No trade without HTF trend confirmation

  const h1Closes = oneHourCandles.map(c => c.close);
  const z = calculateZScore(h1Closes, 30);
  if (z === null) return null;

  const rsi = calculateRSI(h1Closes, 14);

  let direction: 'bullish' | 'bearish' | null = null;
  if (z < -1.8 && rsi < 40 && htfBias === 1) direction = 'bullish';
  else if (z > 1.8 && rsi > 60 && htfBias === -1) direction = 'bearish';

  if (!direction) return null;

  const atr = calculateATR(oneHourCandles, 14);
  if (atr <= 0) return null;

  const entry = h1Closes[h1Closes.length - 1];
  const stopDist = 1.0 * atr;
  const tpDist = 1.6 * atr;
  const stopLoss = direction === 'bullish' ? entry - stopDist : entry + stopDist;
  const takeProfit = direction === 'bullish' ? entry + tpDist : entry - tpDist;

  return {
    instrument: 'EUR/USD',
    direction,
    entry,
    stopLoss,
    takeProfit,
    atr,
    confidence: 65,
    setupType: GEM_SETUP_TYPES.EURUSD_ZSCORE,
    tradeType: 'swing',
    reason: `EUR/USD MTF Z-Score Swing: Daily EMA50/200 ${direction === 'bullish' ? 'bullish' : 'bearish'} bias with 1H statistical extreme (Z=${z.toFixed(2)}, RSI=${rsi.toFixed(1)}). Validated forward PF 1.25 (+5.0R).`,
    parameters: [
      { label: 'Timeframe', value: '1H with Daily Filter', weight: 1, maxWeight: 1, contributing: true },
      { label: 'HTF Trend Bias', value: `Daily Close ${direction === 'bullish' ? '>' : '<'} EMA(50)/EMA(200)`, weight: 1, maxWeight: 1, contributing: true },
      { label: 'Statistical Extremity', value: `Z-Score(30) = ${z.toFixed(2)}`, weight: 1, maxWeight: 1, contributing: true },
      { label: 'RSI Condition', value: `RSI(14) = ${rsi.toFixed(1)}`, weight: 1, maxWeight: 1, contributing: true },
      { label: 'Risk Geometry', value: 'SL 1.0x ATR, TP 1.6x ATR (1.60:1 R:R)', weight: 1, maxWeight: 1, contributing: true },
    ],
  };
}

/**
 * Gem 3: BOOM1000 Day (MTF Momentum)
 * Timeframe: M15 (with H4 filter)
 * H4 Filter: Close > EMA50 & EMA200 (bullish) / Close < EMA50 & EMA200 (bearish)
 * Entry: M15 EMA(8) crosses EMA(21) with close aligned with EMA(50) in HTF direction
 * Risk: SL = 1.5 * ATR(14), TP = 3.0 * ATR(14) (Reward:Risk = 2.00)
 */
export function evaluateBoom1000Momentum(
  fourHourCandles: CandleData[],
  fifteenMinCandles: CandleData[],
): SelectiveGemSetup | null {
  if (fourHourCandles.length < 200 || fifteenMinCandles.length < 60) return null;

  const h4Closes = fourHourCandles.map(c => c.close);
  const htfBias = getEmaBias(h4Closes);
  if (htfBias === 0) return null;

  const m15Closes = fifteenMinCandles.map(c => c.close);
  const ema8 = calculateEMA(m15Closes, 8);
  const ema21 = calculateEMA(m15Closes, 21);
  const ema50 = calculateEMA(m15Closes, 50);

  if (ema8.length < 2 || ema21.length < 2 || !ema50.length) return null;

  const lastIdx = m15Closes.length - 1;
  const e8Curr = ema8[ema8.length - 1];
  const e8Prev = ema8[ema8.length - 2];
  const e21Curr = ema21[ema21.length - 1];
  const e21Prev = ema21[ema21.length - 2];
  const e50Curr = ema50[ema50.length - 1];
  const closeCurr = m15Closes[lastIdx];

  const crossUp = e8Curr > e21Curr && e8Prev <= e21Prev;
  const crossDown = e8Curr < e21Curr && e8Prev >= e21Prev;

  let direction: 'bullish' | 'bearish' | null = null;
  if (crossUp && closeCurr > e50Curr && htfBias === 1) direction = 'bullish';
  else if (crossDown && closeCurr < e50Curr && htfBias === -1) direction = 'bearish';

  if (!direction) return null;

  const atr = calculateATR(fifteenMinCandles, 14);
  if (atr <= 0) return null;

  const entry = closeCurr;
  const stopDist = 1.5 * atr;
  const tpDist = 3.0 * atr;
  const stopLoss = direction === 'bullish' ? entry - stopDist : entry + stopDist;
  const takeProfit = direction === 'bullish' ? entry + tpDist : entry - tpDist;

  return {
    instrument: 'BOOM1000',
    direction,
    entry,
    stopLoss,
    takeProfit,
    atr,
    confidence: 65,
    setupType: GEM_SETUP_TYPES.BOOM1000_MOMENTUM,
    tradeType: 'day',
    reason: `BOOM1000 MTF Momentum: 4H EMA50/200 ${direction === 'bullish' ? 'bullish' : 'bearish'} trend with 15M EMA8/21 cross and EMA50 alignment. Validated full-year +20.6R (PF 1.06).`,
    parameters: [
      { label: 'Timeframe', value: '15M with 4H Filter', weight: 1, maxWeight: 1, contributing: true },
      { label: 'HTF Trend Bias', value: `4H Close ${direction === 'bullish' ? '>' : '<'} EMA(50)/EMA(200)`, weight: 1, maxWeight: 1, contributing: true },
      { label: 'Intraday Trigger', value: `M15 EMA(8)/EMA(21) Cross ${direction === 'bullish' ? 'Up' : 'Down'}`, weight: 1, maxWeight: 1, contributing: true },
      { label: 'Risk Geometry', value: 'SL 1.5x ATR, TP 3.0x ATR (2.00:1 R:R)', weight: 1, maxWeight: 1, contributing: true },
    ],
  };
}

