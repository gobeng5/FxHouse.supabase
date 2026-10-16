/**
 * Selective Gems from v2.1 MTF Strategy Package
 *
 * Implements the three out-of-sample forward-test proven strategies:
 *   1. GBP/JPY Swing (Unfiltered Momentum) — H1 EMA8/21 cross + EMA50 alignment (+14.3R forward, PF 1.34)
 *   2. EUR/USD Swing (MTF Z-Score Mean Reversion) — D1 EMA50/200 bias + H1 Z-score/RSI (+5.0R forward, PF 1.25)
 *   3. BOOM1000 Day (MTF Momentum) — H4 EMA50/200 bias + M15 EMA8/21 cross (+20.6R full year, PF 1.06)
 *   4. V75 Day (H4 inside-bar breakout, retest entry) — backtest/synthetic-pick-study.ts
 *   5. V10 Day (H1 Donchian marubozu breakout) — backtest/synthetic-pick-study.ts
 *
 * Runtime-neutral: relative `.ts` imports only (runs in both Vite and Deno).
 * Closed candles only: each gem drops candles still forming at `nowEpoch`, so
 * a setup never rests on a cross that can repaint before the candle closes.
 */

import type { CandleData, TradingInstrument, TrendDirection } from './core.ts';
import { calculateATR, calculateEMA, calculateRSI, calculateSMA } from './indicators.ts';

export const GEM_SETUP_TYPES = {
  GBPJPY_MOMENTUM: 'gem_gbpjpy_momentum',
  EURUSD_ZSCORE: 'gem_eurusd_zscore',
  BOOM1000_MOMENTUM: 'gem_boom1000_momentum',
  V75_INSIDEBAR: 'gem_v75_insidebar',
  V10_DONCHIAN: 'gem_v10_donchian',
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
  /** Close of the candle that completed the setup; the engine issues a setup once per trigger. */
  triggerCloseEpoch?: number;
  /** True when the entry is a pending order at `entry` rather than a market order. */
  pendingEntry?: boolean;
}

const M15_SECONDS = 900;
const H1_SECONDS = 3600;
const H4_SECONDS = 14400;
const D1_SECONDS = 86400;

/** Candles that have fully closed by `nowEpoch`. The still-forming candle can repaint, so it never decides a setup. */
const closedOnly = (candles: CandleData[], seconds: number, nowEpoch: number): CandleData[] =>
  candles.filter(c => c.epoch + seconds <= nowEpoch);

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
export function evaluateGbpJpyMomentum(h1Candles: CandleData[], nowEpoch: number): SelectiveGemSetup | null {
  const oneHourCandles = closedOnly(h1Candles, H1_SECONDS, nowEpoch);
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
  d1Candles: CandleData[],
  h1Candles: CandleData[],
  nowEpoch: number,
): SelectiveGemSetup | null {
  const dailyCandles = closedOnly(d1Candles, D1_SECONDS, nowEpoch);
  const oneHourCandles = closedOnly(h1Candles, H1_SECONDS, nowEpoch);
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
 * Timeframe: M15 (with H4 filter). Needs real 15M candles — at least 60 closed;
 * pass ~300 so EMA(50) is well seeded and matches the backtest.
 * H4 Filter: Close > EMA50 & EMA200 (bullish) / Close < EMA50 & EMA200 (bearish)
 * Entry: M15 EMA(8) crosses EMA(21) with close aligned with EMA(50) in HTF direction
 * Risk: SL = 1.5 * ATR(14), TP = 3.0 * ATR(14) (Reward:Risk = 2.00)
 */
export function evaluateBoom1000Momentum(
  h4Candles: CandleData[],
  m15Candles: CandleData[],
  nowEpoch: number,
): SelectiveGemSetup | null {
  const fourHourCandles = closedOnly(h4Candles, H4_SECONDS, nowEpoch);
  const fifteenMinCandles = closedOnly(m15Candles, M15_SECONDS, nowEpoch);
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

/**
 * Gem 4: V75 Day (H4 inside-bar breakout, retest entry)
 * Setup: the H4 candle that closed at `from` sits inside the one before it (the mother).
 * Breakout: in the 4 hours after `from`, the first closed 15M candle to trade through the
 *   mother's high (long) or low (short). A side already beyond the first 15M open is not
 *   armed, and a 15M candle that takes both sides voids the setup.
 * Signal: issued within the hour after the breakout candle closes (the engine runs hourly),
 *   as a pending order back at the broken level, live 4 hours like any day signal.
 * Risk: SL = 2.0 * ATR(14, H1), TP = 4.0 * ATR (2R).
 * Backtest, one year of Deriv V75 (synthetic-pick-study.ts, "pending at broken level"):
 *   96 trades, 52% wins, +45.7R; none of 200 random-walk years at 75% volatility did as well.
 *   backtest/v75-gem-parity.ts checks that this function reproduces those trades.
 *   It was the best of several hundred rules tried, so treat it as unproven until it holds live.
 */
export function evaluateV75InsideBar(
  h4Candles: CandleData[],
  h1Candles: CandleData[],
  m15Candles: CandleData[],
  nowEpoch: number,
): SelectiveGemSetup | null {
  const h4 = closedOnly(h4Candles, H4_SECONDS, nowEpoch);
  const h1 = closedOnly(h1Candles, H1_SECONDS, nowEpoch);
  const m15 = closedOnly(m15Candles, M15_SECONDS, nowEpoch);
  if (h4.length < 3 || h1.length < 15 || !m15.length) return null;

  // The older inside bar first: its window ended at the last H4 close; the newest may still be open.
  for (const j of [h4.length - 2, h4.length - 1]) {
    const mother = h4[j - 1], inside = h4[j];
    if (!(inside.high <= mother.high && inside.low >= mother.low)) continue;
    const from = inside.epoch + H4_SECONDS;
    const window = m15.filter(c => c.epoch >= from && c.epoch < from + H4_SECONDS);
    if (!window.length || window[0].epoch !== from) continue;

    const buyLive = window[0].open < mother.high, sellLive = window[0].open > mother.low;
    let dir: 1 | -1 | 0 = 0, fillClose = 0;
    for (const c of window) {
      const up = buyLive && c.high >= mother.high, down = sellLive && c.low <= mother.low;
      if (up && down) break;
      if (up || down) { dir = up ? 1 : -1; fillClose = c.epoch + M15_SECONDS; break; }
    }
    // Issue only on the first hourly run after the breakout candle closed.
    if (!dir || fillClose <= nowEpoch - H1_SECONDS) continue;

    const atr = calculateATR(h1, 14);
    if (atr <= 0) return null;
    const direction = dir === 1 ? 'bullish' : 'bearish';
    // Prices in V75 points to 2 decimals, as the alert and the broker show them.
    const round2 = (v: number) => Math.round(v * 100) / 100;
    const entry = round2(dir === 1 ? mother.high : mother.low);
    const stopLoss = round2(entry - dir * 2 * atr);
    const takeProfit = round2(entry + dir * 4 * atr);
    const utc = (e: number) => new Date(e * 1000).toISOString().slice(11, 16);
    const side = dir === 1 ? 'high' : 'low';

    return {
      instrument: 'V75',
      direction,
      entry,
      stopLoss,
      takeProfit,
      atr,
      confidence: 65,
      setupType: GEM_SETUP_TYPES.V75_INSIDEBAR,
      tradeType: 'day',
      triggerCloseEpoch: fillClose,
      pendingEntry: true,
      reason: `V75 Inside-Bar Breakout: the H4 candle closed at ${utc(from)} UTC inside the one before it; 15M broke the mother ${side} ${entry.toFixed(2)} by ${utc(fillClose)} UTC. Pending order back at the broken level for 4h. Backtest +45.7R on 96 trades over one year; not yet proven live.`,
      parameters: [
        { label: 'Setup', value: `H4 inside bar closed ${utc(from)} UTC`, weight: 1, maxWeight: 1, contributing: true },
        { label: 'Mother bar', value: `high ${mother.high.toFixed(2)} / low ${mother.low.toFixed(2)}`, weight: 1, maxWeight: 1, contributing: true },
        { label: 'Breakout', value: `15M through the ${side} by ${utc(fillClose)} UTC`, weight: 1, maxWeight: 1, contributing: true },
        { label: 'Entry', value: `Pending at ${entry.toFixed(2)}, live 4h`, weight: 1, maxWeight: 1, contributing: true },
        { label: 'Risk Geometry', value: 'SL 2.0x ATR, TP 4.0x ATR (2:1 R:R)', weight: 1, maxWeight: 1, contributing: true },
      ],
    };
  }
  return null;
}

/**
 * Gem 5: V10 Day (H1 Donchian marubozu breakout)
 * Setup: the last closed H1 candle has range >= 0.8 * ATR(14, H1) and body >= 70% of range,
 *   and closes beyond the high (long, green candle) or low (short, red candle) of the 20 before it.
 * Signal: issued within the hour after that candle closes (the engine runs hourly), as a market
 *   order at its close.
 * Risk: SL = 1.5 * ATR, TP = 2.5R (3.75 * ATR); the research closed trades still open after 72h.
 * Backtest, one year of Deriv V10 (synthetic-pick-study.ts): 302 trades, +49.2R, t 1.72;
 *   13 of 200 random-walk years at 10% volatility did as well, so the edge is weaker than V75's.
 *   backtest/v10-gem-parity.ts checks that this function reproduces those trades.
 */
export function evaluateV10DonchianMarubozu(h1Candles: CandleData[], nowEpoch: number): SelectiveGemSetup | null {
  const h1 = closedOnly(h1Candles, H1_SECONDS, nowEpoch);
  if (h1.length < 22) return null;
  const i = h1.length - 1;
  const c = h1[i];
  const closeEpoch = c.epoch + H1_SECONDS;
  // Issue only on the first hourly run after the signal candle closed.
  if (closeEpoch <= nowEpoch - H1_SECONDS) return null;

  const atr = calculateATR(h1, 14);
  if (atr <= 0) return null;
  const range = c.high - c.low, body = Math.abs(c.close - c.open);
  if (range < 0.8 * atr || body / range < 0.7) return null;

  let hi = -Infinity, lo = Infinity;
  for (let k = 1; k <= 20; k++) { hi = Math.max(hi, h1[i - k].high); lo = Math.min(lo, h1[i - k].low); }
  const dir: 1 | -1 | 0 = c.close > hi && c.close > c.open ? 1 : c.close < lo && c.close < c.open ? -1 : 0;
  if (!dir) return null;

  const direction = dir === 1 ? 'bullish' : 'bearish';
  const round2 = (v: number) => Math.round(v * 100) / 100;
  const entry = c.close;
  const stopLoss = round2(entry - dir * 1.5 * atr);
  const takeProfit = round2(entry + dir * 3.75 * atr);
  const utc = (e: number) => new Date(e * 1000).toISOString().slice(11, 16);
  const side = dir === 1 ? 'high' : 'low';

  return {
    instrument: 'V10',
    direction,
    entry,
    stopLoss,
    takeProfit,
    atr,
    confidence: 65,
    setupType: GEM_SETUP_TYPES.V10_DONCHIAN,
    tradeType: 'day',
    triggerCloseEpoch: closeEpoch,
    reason: `V10 Donchian Marubozu: the H1 candle closed at ${utc(closeEpoch)} UTC with a ${Math.round((body / range) * 100)}% body beyond the 20-hour ${side} ${(dir === 1 ? hi : lo).toFixed(2)}. Market entry at its close. Backtest +49.2R on 302 trades over one year; not yet proven live.`,
    parameters: [
      { label: 'Signal candle', value: `H1 closed ${utc(closeEpoch)} UTC`, weight: 1, maxWeight: 1, contributing: true },
      { label: 'Marubozu', value: `range ${(range / atr).toFixed(2)}x ATR, body ${Math.round((body / range) * 100)}%`, weight: 1, maxWeight: 1, contributing: true },
      { label: 'Breakout', value: `close beyond the 20-hour ${side} ${(dir === 1 ? hi : lo).toFixed(2)}`, weight: 1, maxWeight: 1, contributing: true },
      { label: 'Risk Geometry', value: 'SL 1.5x ATR, TP 3.75x ATR (2.5:1 R:R)', weight: 1, maxWeight: 1, contributing: true },
    ],
  };
}
