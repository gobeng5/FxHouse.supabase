import type { CandleData } from './core.ts';
import { TradingInstrument, isSyntheticIndex } from './core.ts';

/**
 * Price Action Analysis Engine
 * Detects candlestick patterns and chart patterns for improved trade accuracy
 */

// ============= CANDLESTICK PATTERN TYPES =============

export type CandlestickPatternType = 
  | 'doji'
  | 'hammer'
  | 'inverted_hammer'
  | 'shooting_star'
  | 'hanging_man'
  | 'bullish_engulfing'
  | 'bearish_engulfing'
  | 'morning_star'
  | 'evening_star'
  | 'three_white_soldiers'
  | 'three_black_crows'
  | 'bullish_harami'
  | 'bearish_harami'
  | 'tweezer_top'
  | 'tweezer_bottom'
  | 'piercing_line'
  | 'dark_cloud_cover'
  | 'spinning_top'
  | 'marubozu_bullish'
  | 'marubozu_bearish';

export type ChartPatternType =
  | 'double_top'
  | 'double_bottom'
  | 'head_and_shoulders'
  | 'inverse_head_and_shoulders'
  | 'ascending_triangle'
  | 'descending_triangle'
  | 'symmetrical_triangle'
  | 'rising_wedge'
  | 'falling_wedge'
  | 'bull_flag'
  | 'bear_flag'
  | 'ascending_channel'
  | 'descending_channel';

export interface CandlestickPattern {
  type: CandlestickPatternType;
  name: string;
  signal: 'bullish' | 'bearish' | 'neutral';
  strength: 'strong' | 'moderate' | 'weak';
  description: string;
  index: number;
  epoch: number;
}

export interface ChartPattern {
  type: ChartPatternType;
  name: string;
  signal: 'bullish' | 'bearish' | 'neutral';
  strength: 'strong' | 'moderate' | 'weak';
  description: string;
  priceTarget?: number;
  neckline?: number;
  breakoutLevel?: number;
}

export interface PriceActionAnalysis {
  candlestickPatterns: CandlestickPattern[];
  chartPatterns: ChartPattern[];
  dominantSignal: 'bullish' | 'bearish' | 'neutral';
  signalStrength: number; // 0-100
  summary: string;
}

// ============= HELPER FUNCTIONS =============

const getBodySize = (candle: CandleData): number => {
  return Math.abs(candle.close - candle.open);
};

const getUpperWick = (candle: CandleData): number => {
  return candle.high - Math.max(candle.open, candle.close);
};

const getLowerWick = (candle: CandleData): number => {
  return Math.min(candle.open, candle.close) - candle.low;
};

const getTotalRange = (candle: CandleData): number => {
  return candle.high - candle.low;
};

const isBullish = (candle: CandleData): boolean => {
  return candle.close > candle.open;
};

const isBearish = (candle: CandleData): boolean => {
  return candle.close < candle.open;
};

// ============= SINGLE CANDLE PATTERNS =============

const detectDoji = (candle: CandleData, avgRange: number): CandlestickPattern | null => {
  const body = getBodySize(candle);
  const range = getTotalRange(candle);
  
  if (body < range * 0.1 && range > avgRange * 0.3) {
    return {
      type: 'doji',
      name: 'Doji',
      signal: 'neutral',
      strength: 'moderate',
      description: 'Indecision candle - potential reversal or continuation depending on context',
      index: 0,
      epoch: candle.epoch,
    };
  }
  return null;
};

const detectHammer = (candle: CandleData, avgRange: number): CandlestickPattern | null => {
  const body = getBodySize(candle);
  const lowerWick = getLowerWick(candle);
  const upperWick = getUpperWick(candle);
  const range = getTotalRange(candle);
  
  if (lowerWick >= body * 2 && upperWick < body * 0.5 && range > avgRange * 0.5) {
    return {
      type: 'hammer',
      name: 'Hammer',
      signal: 'bullish',
      strength: lowerWick >= body * 3 ? 'strong' : 'moderate',
      description: 'Bullish reversal signal - buyers rejected lower prices',
      index: 0,
      epoch: candle.epoch,
    };
  }
  return null;
};

const detectInvertedHammer = (candle: CandleData, avgRange: number): CandlestickPattern | null => {
  const body = getBodySize(candle);
  const lowerWick = getLowerWick(candle);
  const upperWick = getUpperWick(candle);
  const range = getTotalRange(candle);
  
  if (upperWick >= body * 2 && lowerWick < body * 0.5 && range > avgRange * 0.5) {
    return {
      type: 'inverted_hammer',
      name: 'Inverted Hammer',
      signal: 'bullish',
      strength: 'moderate',
      description: 'Potential bullish reversal after downtrend - needs confirmation',
      index: 0,
      epoch: candle.epoch,
    };
  }
  return null;
};

const detectShootingStar = (candle: CandleData, prevCandles: CandleData[], avgRange: number): CandlestickPattern | null => {
  const body = getBodySize(candle);
  const lowerWick = getLowerWick(candle);
  const upperWick = getUpperWick(candle);
  const range = getTotalRange(candle);
  
  // Check if in uptrend
  const isUptrend = prevCandles.length >= 3 && 
    prevCandles.slice(-3).every((c, i, arr) => i === 0 || c.close > arr[i - 1].close);
  
  if (upperWick >= body * 2 && lowerWick < body * 0.5 && range > avgRange * 0.5 && isUptrend) {
    return {
      type: 'shooting_star',
      name: 'Shooting Star',
      signal: 'bearish',
      strength: upperWick >= body * 3 ? 'strong' : 'moderate',
      description: 'Bearish reversal signal - sellers rejected higher prices',
      index: 0,
      epoch: candle.epoch,
    };
  }
  return null;
};

const detectHangingMan = (candle: CandleData, prevCandles: CandleData[], avgRange: number): CandlestickPattern | null => {
  const body = getBodySize(candle);
  const lowerWick = getLowerWick(candle);
  const upperWick = getUpperWick(candle);
  const range = getTotalRange(candle);
  
  // Check if in uptrend
  const isUptrend = prevCandles.length >= 3 && 
    prevCandles.slice(-3).every((c, i, arr) => i === 0 || c.close > arr[i - 1].close);
  
  if (lowerWick >= body * 2 && upperWick < body * 0.5 && range > avgRange * 0.5 && isUptrend) {
    return {
      type: 'hanging_man',
      name: 'Hanging Man',
      signal: 'bearish',
      strength: 'moderate',
      description: 'Bearish reversal warning - selling pressure emerging',
      index: 0,
      epoch: candle.epoch,
    };
  }
  return null;
};

const detectSpinningTop = (candle: CandleData, avgRange: number): CandlestickPattern | null => {
  const body = getBodySize(candle);
  const lowerWick = getLowerWick(candle);
  const upperWick = getUpperWick(candle);
  const range = getTotalRange(candle);
  
  if (body < range * 0.3 && upperWick > body * 0.5 && lowerWick > body * 0.5 && range > avgRange * 0.3) {
    return {
      type: 'spinning_top',
      name: 'Spinning Top',
      signal: 'neutral',
      strength: 'weak',
      description: 'Indecision - market lacking direction',
      index: 0,
      epoch: candle.epoch,
    };
  }
  return null;
};

const detectMarubozu = (candle: CandleData, avgRange: number): CandlestickPattern | null => {
  const body = getBodySize(candle);
  const lowerWick = getLowerWick(candle);
  const upperWick = getUpperWick(candle);
  const range = getTotalRange(candle);
  
  if (body > range * 0.9 && range > avgRange * 0.8) {
    if (isBullish(candle)) {
      return {
        type: 'marubozu_bullish',
        name: 'Bullish Marubozu',
        signal: 'bullish',
        strength: 'strong',
        description: 'Strong bullish momentum - buyers in complete control',
        index: 0,
        epoch: candle.epoch,
      };
    } else {
      return {
        type: 'marubozu_bearish',
        name: 'Bearish Marubozu',
        signal: 'bearish',
        strength: 'strong',
        description: 'Strong bearish momentum - sellers in complete control',
        index: 0,
        epoch: candle.epoch,
      };
    }
  }
  return null;
};

// ============= TWO CANDLE PATTERNS =============

const detectEngulfing = (candle1: CandleData, candle2: CandleData): CandlestickPattern | null => {
  const body1 = getBodySize(candle1);
  const body2 = getBodySize(candle2);
  
  // Bullish engulfing
  if (isBearish(candle1) && isBullish(candle2) && 
      candle2.open <= candle1.close && candle2.close >= candle1.open &&
      body2 > body1 * 1.2) {
    return {
      type: 'bullish_engulfing',
      name: 'Bullish Engulfing',
      signal: 'bullish',
      strength: body2 > body1 * 1.5 ? 'strong' : 'moderate',
      description: 'Strong bullish reversal - buyers overwhelmed sellers',
      index: 0,
      epoch: candle2.epoch,
    };
  }
  
  // Bearish engulfing
  if (isBullish(candle1) && isBearish(candle2) && 
      candle2.open >= candle1.close && candle2.close <= candle1.open &&
      body2 > body1 * 1.2) {
    return {
      type: 'bearish_engulfing',
      name: 'Bearish Engulfing',
      signal: 'bearish',
      strength: body2 > body1 * 1.5 ? 'strong' : 'moderate',
      description: 'Strong bearish reversal - sellers overwhelmed buyers',
      index: 0,
      epoch: candle2.epoch,
    };
  }
  
  return null;
};

const detectHarami = (candle1: CandleData, candle2: CandleData): CandlestickPattern | null => {
  const body1 = getBodySize(candle1);
  const body2 = getBodySize(candle2);
  
  // Bullish harami
  if (isBearish(candle1) && isBullish(candle2) && 
      candle2.open > candle1.close && candle2.close < candle1.open &&
      body2 < body1 * 0.5) {
    return {
      type: 'bullish_harami',
      name: 'Bullish Harami',
      signal: 'bullish',
      strength: 'moderate',
      description: 'Potential bullish reversal - selling momentum fading',
      index: 0,
      epoch: candle2.epoch,
    };
  }
  
  // Bearish harami
  if (isBullish(candle1) && isBearish(candle2) && 
      candle2.open < candle1.close && candle2.close > candle1.open &&
      body2 < body1 * 0.5) {
    return {
      type: 'bearish_harami',
      name: 'Bearish Harami',
      signal: 'bearish',
      strength: 'moderate',
      description: 'Potential bearish reversal - buying momentum fading',
      index: 0,
      epoch: candle2.epoch,
    };
  }
  
  return null;
};

const detectTweezers = (candle1: CandleData, candle2: CandleData, tolerance: number): CandlestickPattern | null => {
  // Tweezer top
  if (Math.abs(candle1.high - candle2.high) < tolerance && 
      isBullish(candle1) && isBearish(candle2)) {
    return {
      type: 'tweezer_top',
      name: 'Tweezer Top',
      signal: 'bearish',
      strength: 'moderate',
      description: 'Bearish reversal - double rejection at highs',
      index: 0,
      epoch: candle2.epoch,
    };
  }
  
  // Tweezer bottom
  if (Math.abs(candle1.low - candle2.low) < tolerance && 
      isBearish(candle1) && isBullish(candle2)) {
    return {
      type: 'tweezer_bottom',
      name: 'Tweezer Bottom',
      signal: 'bullish',
      strength: 'moderate',
      description: 'Bullish reversal - double rejection at lows',
      index: 0,
      epoch: candle2.epoch,
    };
  }
  
  return null;
};

const detectPiercingLine = (candle1: CandleData, candle2: CandleData): CandlestickPattern | null => {
  const body1 = getBodySize(candle1);
  const midpoint = candle1.open - body1 / 2;
  
  if (isBearish(candle1) && isBullish(candle2) && 
      candle2.open < candle1.close && candle2.close > midpoint && candle2.close < candle1.open) {
    return {
      type: 'piercing_line',
      name: 'Piercing Line',
      signal: 'bullish',
      strength: 'moderate',
      description: 'Bullish reversal - buyers pushing back above midpoint',
      index: 0,
      epoch: candle2.epoch,
    };
  }
  
  return null;
};

const detectDarkCloudCover = (candle1: CandleData, candle2: CandleData): CandlestickPattern | null => {
  const body1 = getBodySize(candle1);
  const midpoint = candle1.open + body1 / 2;
  
  if (isBullish(candle1) && isBearish(candle2) && 
      candle2.open > candle1.close && candle2.close < midpoint && candle2.close > candle1.open) {
    return {
      type: 'dark_cloud_cover',
      name: 'Dark Cloud Cover',
      signal: 'bearish',
      strength: 'moderate',
      description: 'Bearish reversal - sellers pushing back below midpoint',
      index: 0,
      epoch: candle2.epoch,
    };
  }
  
  return null;
};

// ============= THREE CANDLE PATTERNS =============

const detectMorningStar = (candle1: CandleData, candle2: CandleData, candle3: CandleData): CandlestickPattern | null => {
  const body1 = getBodySize(candle1);
  const body2 = getBodySize(candle2);
  const body3 = getBodySize(candle3);
  
  if (isBearish(candle1) && body1 > body2 * 2 && isBullish(candle3) && body3 > body2 * 2 &&
      candle2.close < candle1.close && candle3.close > (candle1.open + candle1.close) / 2) {
    return {
      type: 'morning_star',
      name: 'Morning Star',
      signal: 'bullish',
      strength: 'strong',
      description: 'Strong bullish reversal - three-candle bottom formation',
      index: 0,
      epoch: candle3.epoch,
    };
  }
  
  return null;
};

const detectEveningStar = (candle1: CandleData, candle2: CandleData, candle3: CandleData): CandlestickPattern | null => {
  const body1 = getBodySize(candle1);
  const body2 = getBodySize(candle2);
  const body3 = getBodySize(candle3);
  
  if (isBullish(candle1) && body1 > body2 * 2 && isBearish(candle3) && body3 > body2 * 2 &&
      candle2.close > candle1.close && candle3.close < (candle1.open + candle1.close) / 2) {
    return {
      type: 'evening_star',
      name: 'Evening Star',
      signal: 'bearish',
      strength: 'strong',
      description: 'Strong bearish reversal - three-candle top formation',
      index: 0,
      epoch: candle3.epoch,
    };
  }
  
  return null;
};

const detectThreeWhiteSoldiers = (candles: CandleData[]): CandlestickPattern | null => {
  if (candles.length < 3) return null;
  
  const [c1, c2, c3] = candles.slice(-3);
  
  if (isBullish(c1) && isBullish(c2) && isBullish(c3) &&
      c2.open > c1.open && c2.close > c1.close &&
      c3.open > c2.open && c3.close > c2.close &&
      getUpperWick(c1) < getBodySize(c1) * 0.3 &&
      getUpperWick(c2) < getBodySize(c2) * 0.3 &&
      getUpperWick(c3) < getBodySize(c3) * 0.3) {
    return {
      type: 'three_white_soldiers',
      name: 'Three White Soldiers',
      signal: 'bullish',
      strength: 'strong',
      description: 'Strong bullish continuation - sustained buying pressure',
      index: 0,
      epoch: c3.epoch,
    };
  }
  
  return null;
};

const detectThreeBlackCrows = (candles: CandleData[]): CandlestickPattern | null => {
  if (candles.length < 3) return null;
  
  const [c1, c2, c3] = candles.slice(-3);
  
  if (isBearish(c1) && isBearish(c2) && isBearish(c3) &&
      c2.open < c1.open && c2.close < c1.close &&
      c3.open < c2.open && c3.close < c2.close &&
      getLowerWick(c1) < getBodySize(c1) * 0.3 &&
      getLowerWick(c2) < getBodySize(c2) * 0.3 &&
      getLowerWick(c3) < getBodySize(c3) * 0.3) {
    return {
      type: 'three_black_crows',
      name: 'Three Black Crows',
      signal: 'bearish',
      strength: 'strong',
      description: 'Strong bearish continuation - sustained selling pressure',
      index: 0,
      epoch: c3.epoch,
    };
  }
  
  return null;
};

// ============= CHART PATTERNS =============

const detectDoubleTop = (candles: CandleData[], tolerance: number): ChartPattern | null => {
  if (candles.length < 20) return null;
  
  const highs: { price: number; index: number }[] = [];
  
  for (let i = 3; i < candles.length - 3; i++) {
    const isLocalHigh = candles.slice(i - 3, i).every(c => c.high < candles[i].high) &&
                        candles.slice(i + 1, i + 4).every(c => c.high < candles[i].high);
    if (isLocalHigh) {
      highs.push({ price: candles[i].high, index: i });
    }
  }
  
  for (let i = 0; i < highs.length - 1; i++) {
    for (let j = i + 1; j < highs.length; j++) {
      if (Math.abs(highs[i].price - highs[j].price) < tolerance && 
          highs[j].index - highs[i].index > 5) {
        const neckline = Math.min(...candles.slice(highs[i].index, highs[j].index).map(c => c.low));
        return {
          type: 'double_top',
          name: 'Double Top',
          signal: 'bearish',
          strength: 'strong',
          description: 'Bearish reversal pattern - price rejected twice at same level',
          priceTarget: neckline - (highs[i].price - neckline),
          neckline,
          breakoutLevel: neckline,
        };
      }
    }
  }
  
  return null;
};

const detectDoubleBottom = (candles: CandleData[], tolerance: number): ChartPattern | null => {
  if (candles.length < 20) return null;
  
  const lows: { price: number; index: number }[] = [];
  
  for (let i = 3; i < candles.length - 3; i++) {
    const isLocalLow = candles.slice(i - 3, i).every(c => c.low > candles[i].low) &&
                       candles.slice(i + 1, i + 4).every(c => c.low > candles[i].low);
    if (isLocalLow) {
      lows.push({ price: candles[i].low, index: i });
    }
  }
  
  for (let i = 0; i < lows.length - 1; i++) {
    for (let j = i + 1; j < lows.length; j++) {
      if (Math.abs(lows[i].price - lows[j].price) < tolerance && 
          lows[j].index - lows[i].index > 5) {
        const neckline = Math.max(...candles.slice(lows[i].index, lows[j].index).map(c => c.high));
        return {
          type: 'double_bottom',
          name: 'Double Bottom',
          signal: 'bullish',
          strength: 'strong',
          description: 'Bullish reversal pattern - price supported twice at same level',
          priceTarget: neckline + (neckline - lows[i].price),
          neckline,
          breakoutLevel: neckline,
        };
      }
    }
  }
  
  return null;
};

const detectTriangle = (candles: CandleData[]): ChartPattern | null => {
  if (candles.length < 15) return null;
  
  const recentCandles = candles.slice(-15);
  const highs = recentCandles.map(c => c.high);
  const lows = recentCandles.map(c => c.low);
  
  // Calculate trends
  const highTrend = (highs[highs.length - 1] - highs[0]) / highs.length;
  const lowTrend = (lows[lows.length - 1] - lows[0]) / lows.length;
  const avgPrice = recentCandles.reduce((sum, c) => sum + c.close, 0) / recentCandles.length;
  const threshold = avgPrice * 0.0001;
  
  // Ascending triangle: flat highs, rising lows
  if (Math.abs(highTrend) < threshold && lowTrend > threshold) {
    return {
      type: 'ascending_triangle',
      name: 'Ascending Triangle',
      signal: 'bullish',
      strength: 'moderate',
      description: 'Bullish continuation - price compressing with higher lows',
      breakoutLevel: Math.max(...highs),
    };
  }
  
  // Descending triangle: falling highs, flat lows
  if (highTrend < -threshold && Math.abs(lowTrend) < threshold) {
    return {
      type: 'descending_triangle',
      name: 'Descending Triangle',
      signal: 'bearish',
      strength: 'moderate',
      description: 'Bearish continuation - price compressing with lower highs',
      breakoutLevel: Math.min(...lows),
    };
  }
  
  // Symmetrical triangle: converging highs and lows
  if (highTrend < -threshold && lowTrend > threshold) {
    return {
      type: 'symmetrical_triangle',
      name: 'Symmetrical Triangle',
      signal: 'neutral',
      strength: 'moderate',
      description: 'Consolidation pattern - breakout direction uncertain',
    };
  }
  
  return null;
};

const detectWedge = (candles: CandleData[]): ChartPattern | null => {
  if (candles.length < 15) return null;
  
  const recentCandles = candles.slice(-15);
  const highs = recentCandles.map(c => c.high);
  const lows = recentCandles.map(c => c.low);
  
  const highTrend = (highs[highs.length - 1] - highs[0]) / highs.length;
  const lowTrend = (lows[lows.length - 1] - lows[0]) / lows.length;
  const avgPrice = recentCandles.reduce((sum, c) => sum + c.close, 0) / recentCandles.length;
  const threshold = avgPrice * 0.00005;
  
  // Rising wedge: both rising but converging
  if (highTrend > threshold && lowTrend > threshold && highTrend < lowTrend) {
    return {
      type: 'rising_wedge',
      name: 'Rising Wedge',
      signal: 'bearish',
      strength: 'moderate',
      description: 'Bearish reversal - rising price with weakening momentum',
    };
  }
  
  // Falling wedge: both falling but converging
  if (highTrend < -threshold && lowTrend < -threshold && Math.abs(highTrend) < Math.abs(lowTrend)) {
    return {
      type: 'falling_wedge',
      name: 'Falling Wedge',
      signal: 'bullish',
      strength: 'moderate',
      description: 'Bullish reversal - falling price with decreasing selling pressure',
    };
  }
  
  return null;
};

const detectFlag = (candles: CandleData[]): ChartPattern | null => {
  if (candles.length < 20) return null;
  
  // Look for strong impulse followed by consolidation
  const impulseCandles = candles.slice(-20, -10);
  const flagCandles = candles.slice(-10);
  
  const impulseMove = impulseCandles[impulseCandles.length - 1].close - impulseCandles[0].open;
  const flagMove = flagCandles[flagCandles.length - 1].close - flagCandles[0].open;
  const avgPrice = flagCandles.reduce((sum, c) => sum + c.close, 0) / flagCandles.length;
  
  // Strong impulse up, slight pullback
  if (impulseMove > avgPrice * 0.02 && flagMove < -avgPrice * 0.005 && flagMove > -avgPrice * 0.015) {
    return {
      type: 'bull_flag',
      name: 'Bull Flag',
      signal: 'bullish',
      strength: 'strong',
      description: 'Bullish continuation - consolidation after strong rally',
      priceTarget: flagCandles[flagCandles.length - 1].high + Math.abs(impulseMove),
    };
  }
  
  // Strong impulse down, slight rebound
  if (impulseMove < -avgPrice * 0.02 && flagMove > avgPrice * 0.005 && flagMove < avgPrice * 0.015) {
    return {
      type: 'bear_flag',
      name: 'Bear Flag',
      signal: 'bearish',
      strength: 'strong',
      description: 'Bearish continuation - consolidation after strong drop',
      priceTarget: flagCandles[flagCandles.length - 1].low - Math.abs(impulseMove),
    };
  }
  
  return null;
};

const detectChannel = (candles: CandleData[]): ChartPattern | null => {
  if (candles.length < 20) return null;
  
  const recentCandles = candles.slice(-20);
  
  // Calculate linear regression for highs and lows
  const n = recentCandles.length;
  let sumX = 0, sumYH = 0, sumYL = 0, sumXY_H = 0, sumXY_L = 0, sumX2 = 0;
  
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumYH += recentCandles[i].high;
    sumYL += recentCandles[i].low;
    sumXY_H += i * recentCandles[i].high;
    sumXY_L += i * recentCandles[i].low;
    sumX2 += i * i;
  }
  
  const slopeHigh = (n * sumXY_H - sumX * sumYH) / (n * sumX2 - sumX * sumX);
  const slopeLow = (n * sumXY_L - sumX * sumYL) / (n * sumX2 - sumX * sumX);
  const avgPrice = recentCandles.reduce((sum, c) => sum + c.close, 0) / n;
  const threshold = avgPrice * 0.00005;
  
  // Parallel channels
  if (Math.abs(slopeHigh - slopeLow) < threshold * 0.5) {
    if (slopeHigh > threshold) {
      return {
        type: 'ascending_channel',
        name: 'Ascending Channel',
        signal: 'bullish',
        strength: 'moderate',
        description: 'Bullish trend channel - trading within rising boundaries',
      };
    } else if (slopeHigh < -threshold) {
      return {
        type: 'descending_channel',
        name: 'Descending Channel',
        signal: 'bearish',
        strength: 'moderate',
        description: 'Bearish trend channel - trading within falling boundaries',
      };
    }
  }
  
  return null;
};

// ============= MAIN ANALYSIS FUNCTION =============

export const analyzePriceAction = (
  candles: CandleData[],
  instrument: TradingInstrument
): PriceActionAnalysis => {
  if (candles.length < 5) {
    return {
      candlestickPatterns: [],
      chartPatterns: [],
      dominantSignal: 'neutral',
      signalStrength: 0,
      summary: 'Insufficient data for price action analysis',
    };
  }
  
  const candlestickPatterns: CandlestickPattern[] = [];
  const chartPatterns: ChartPattern[] = [];
  
  // Calculate average range for pattern detection
  const avgRange = candles.slice(-20).reduce((sum, c) => sum + getTotalRange(c), 0) / Math.min(20, candles.length);
  const tolerance = isSyntheticIndex(instrument) ? avgRange * 0.01 : avgRange * 0.1;
  
  // Detect single candle patterns on last candle
  const lastCandle = candles[candles.length - 1];
  const prevCandles = candles.slice(0, -1);
  
  const singlePatterns = [
    detectDoji(lastCandle, avgRange),
    detectHammer(lastCandle, avgRange),
    detectInvertedHammer(lastCandle, avgRange),
    detectShootingStar(lastCandle, prevCandles, avgRange),
    detectHangingMan(lastCandle, prevCandles, avgRange),
    detectSpinningTop(lastCandle, avgRange),
    detectMarubozu(lastCandle, avgRange),
  ].filter((p): p is CandlestickPattern => p !== null);
  
  candlestickPatterns.push(...singlePatterns);
  
  // Detect two candle patterns
  if (candles.length >= 2) {
    const c1 = candles[candles.length - 2];
    const c2 = candles[candles.length - 1];
    
    const twoPatterns = [
      detectEngulfing(c1, c2),
      detectHarami(c1, c2),
      detectTweezers(c1, c2, tolerance),
      detectPiercingLine(c1, c2),
      detectDarkCloudCover(c1, c2),
    ].filter((p): p is CandlestickPattern => p !== null);
    
    candlestickPatterns.push(...twoPatterns);
  }
  
  // Detect three candle patterns
  if (candles.length >= 3) {
    const c1 = candles[candles.length - 3];
    const c2 = candles[candles.length - 2];
    const c3 = candles[candles.length - 1];
    
    const threePatterns = [
      detectMorningStar(c1, c2, c3),
      detectEveningStar(c1, c2, c3),
      detectThreeWhiteSoldiers(candles),
      detectThreeBlackCrows(candles),
    ].filter((p): p is CandlestickPattern => p !== null);
    
    candlestickPatterns.push(...threePatterns);
  }
  
  // Detect chart patterns
  const chartPatternResults = [
    detectDoubleTop(candles, tolerance),
    detectDoubleBottom(candles, tolerance),
    detectTriangle(candles),
    detectWedge(candles),
    detectFlag(candles),
    detectChannel(candles),
  ].filter((p): p is ChartPattern => p !== null);
  
  chartPatterns.push(...chartPatternResults);
  
  // Calculate dominant signal
  let bullishScore = 0;
  let bearishScore = 0;
  
  const strengthMultiplier = { strong: 3, moderate: 2, weak: 1 };
  
  candlestickPatterns.forEach(p => {
    const mult = strengthMultiplier[p.strength];
    if (p.signal === 'bullish') bullishScore += mult;
    else if (p.signal === 'bearish') bearishScore += mult;
  });
  
  chartPatterns.forEach(p => {
    const mult = strengthMultiplier[p.strength];
    if (p.signal === 'bullish') bullishScore += mult * 2;
    else if (p.signal === 'bearish') bearishScore += mult * 2;
  });
  
  const totalScore = bullishScore + bearishScore;
  let dominantSignal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let signalStrength = 0;
  
  if (totalScore > 0) {
    if (bullishScore > bearishScore * 1.5) {
      dominantSignal = 'bullish';
      signalStrength = Math.min(100, (bullishScore / (totalScore)) * 100);
    } else if (bearishScore > bullishScore * 1.5) {
      dominantSignal = 'bearish';
      signalStrength = Math.min(100, (bearishScore / (totalScore)) * 100);
    } else {
      signalStrength = 50;
    }
  }
  
  // Generate summary
  const patternNames = [
    ...candlestickPatterns.map(p => p.name),
    ...chartPatterns.map(p => p.name),
  ];
  
  let summary = 'No significant patterns detected.';
  if (patternNames.length > 0) {
    summary = `Detected: ${patternNames.slice(0, 3).join(', ')}${patternNames.length > 3 ? ` and ${patternNames.length - 3} more` : ''}. `;
    summary += dominantSignal === 'neutral' 
      ? 'Mixed signals - exercise caution.'
      : `${dominantSignal.charAt(0).toUpperCase() + dominantSignal.slice(1)} bias with ${signalStrength.toFixed(0)}% confidence.`;
  }
  
  return {
    candlestickPatterns,
    chartPatterns,
    dominantSignal,
    signalStrength,
    summary,
  };
};
