import type { CandleData } from './core.ts';

/**
 * Technical Indicator Calculations
 */

// Simple Moving Average
export const calculateSMA = (data: number[], period: number): number => {
  if (data.length < period) return 0;
  const slice = data.slice(-period);
  return slice.reduce((sum, val) => sum + val, 0) / period;
};

// Exponential Moving Average
export const calculateEMA = (data: number[], period: number): number[] => {
  if (data.length < period) return [];
  
  const multiplier = 2 / (period + 1);
  const ema: number[] = [];
  
  // Start with SMA for first EMA value
  const sma = data.slice(0, period).reduce((sum, val) => sum + val, 0) / period;
  ema.push(sma);
  
  for (let i = period; i < data.length; i++) {
    const value = (data[i] - ema[ema.length - 1]) * multiplier + ema[ema.length - 1];
    ema.push(value);
  }
  
  return ema;
};

// RSI Calculation
export const calculateRSI = (closes: number[], period: number = 14): number => {
  if (closes.length < period + 1) return 50;
  
  const changes: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    changes.push(closes[i] - closes[i - 1]);
  }
  
  let gains = 0;
  let losses = 0;
  
  // Initial average
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) gains += changes[i];
    else losses += Math.abs(changes[i]);
  }
  
  let avgGain = gains / period;
  let avgLoss = losses / period;
  
  // Smooth the averages
  for (let i = period; i < changes.length; i++) {
    const change = changes[i];
    avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (change < 0 ? Math.abs(change) : 0)) / period;
  }
  
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
};

// MACD Calculation
export interface MACDResult {
  macdLine: number;
  signalLine: number;
  histogram: number;
  signal: 'bullish' | 'bearish' | 'neutral';
}

export const calculateMACD = (
  closes: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): MACDResult => {
  const fastEMA = calculateEMA(closes, fastPeriod);
  const slowEMA = calculateEMA(closes, slowPeriod);
  
  if (fastEMA.length === 0 || slowEMA.length === 0) {
    return { macdLine: 0, signalLine: 0, histogram: 0, signal: 'neutral' };
  }
  
  // MACD line = Fast EMA - Slow EMA
  const macdValues: number[] = [];
  const offset = fastEMA.length - slowEMA.length;
  
  for (let i = 0; i < slowEMA.length; i++) {
    macdValues.push(fastEMA[i + offset] - slowEMA[i]);
  }
  
  // Signal line = 9-period EMA of MACD
  const signalEMA = calculateEMA(macdValues, signalPeriod);
  
  const macdLine = macdValues[macdValues.length - 1] || 0;
  const signalLine = signalEMA[signalEMA.length - 1] || 0;
  const histogram = macdLine - signalLine;
  
  let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  if (histogram > 0 && macdLine > 0) signal = 'bullish';
  else if (histogram < 0 && macdLine < 0) signal = 'bearish';
  
  return { macdLine, signalLine, histogram, signal };
};

// Moving Averages with position analysis
export interface MAAnalysis {
  ma20: number;
  ma50: number;
  ma200: number;
  pricePosition: 'above_all' | 'below_all' | 'mixed';
  trend: 'bullish' | 'bearish' | 'neutral';
}

export const analyzeMovingAverages = (closes: number[]): MAAnalysis => {
  const ma20 = calculateSMA(closes, 20);
  const ma50 = calculateSMA(closes, 50);
  const ma200 = calculateSMA(closes, 200);
  const currentPrice = closes[closes.length - 1];
  
  let pricePosition: 'above_all' | 'below_all' | 'mixed' = 'mixed';
  if (currentPrice > ma20 && currentPrice > ma50 && currentPrice > ma200) {
    pricePosition = 'above_all';
  } else if (currentPrice < ma20 && currentPrice < ma50 && currentPrice < ma200) {
    pricePosition = 'below_all';
  }
  
  // Determine trend from MA alignment
  let trend: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  if (ma20 > ma50 && ma50 > ma200) trend = 'bullish';
  else if (ma20 < ma50 && ma50 < ma200) trend = 'bearish';
  
  return { ma20, ma50, ma200, pricePosition, trend };
};

// ATR for volatility and stop loss calculation
export const calculateATR = (candles: CandleData[], period: number = 14): number => {
  if (candles.length < period + 1) return 0;
  
  const trValues: number[] = [];
  
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trValues.push(tr);
  }
  
  // Simple average of last 'period' TR values
  const recentTR = trValues.slice(-period);
  return recentTR.reduce((sum, val) => sum + val, 0) / period;
};

// Bollinger Bands
export interface BollingerBands {
  upper: number;
  middle: number;
  lower: number;
  bandwidth: number;
  position: 'above_upper' | 'near_upper' | 'middle' | 'near_lower' | 'below_lower';
}

export const calculateBollingerBands = (
  closes: number[],
  period: number = 20,
  stdDevMultiplier: number = 2
): BollingerBands => {
  const middle = calculateSMA(closes, period);
  const recentCloses = closes.slice(-period);
  
  // Calculate standard deviation
  const squaredDiffs = recentCloses.map(close => Math.pow(close - middle, 2));
  const variance = squaredDiffs.reduce((sum, val) => sum + val, 0) / period;
  const stdDev = Math.sqrt(variance);
  
  const upper = middle + (stdDev * stdDevMultiplier);
  const lower = middle - (stdDev * stdDevMultiplier);
  const bandwidth = ((upper - lower) / middle) * 100;
  
  const currentPrice = closes[closes.length - 1];
  let position: BollingerBands['position'] = 'middle';
  
  if (currentPrice > upper) position = 'above_upper';
  else if (currentPrice > middle + (upper - middle) * 0.8) position = 'near_upper';
  else if (currentPrice < lower) position = 'below_lower';
  else if (currentPrice < middle - (middle - lower) * 0.8) position = 'near_lower';
  
  return { upper, middle, lower, bandwidth, position };
};

// On-Balance Volume (OBV) Calculation
export interface OBVResult {
  values: number[];
  current: number;
  trend: 'bullish' | 'bearish' | 'neutral';
  divergence: 'bullish_divergence' | 'bearish_divergence' | 'none';
  signal: 'strong_buy' | 'buy' | 'neutral' | 'sell' | 'strong_sell';
}

export const calculateOBV = (candles: CandleData[]): OBVResult => {
  if (candles.length < 10) {
    return { values: [], current: 0, trend: 'neutral', divergence: 'none', signal: 'neutral' };
  }

  const obvValues: number[] = [0];
  
  for (let i = 1; i < candles.length; i++) {
    const prevClose = candles[i - 1].close;
    const currClose = candles[i].close;
    // Use candle body size as proxy volume (high - low range)
    const volume = (candles[i].high - candles[i].low) * 100000;
    
    if (currClose > prevClose) {
      obvValues.push(obvValues[obvValues.length - 1] + volume);
    } else if (currClose < prevClose) {
      obvValues.push(obvValues[obvValues.length - 1] - volume);
    } else {
      obvValues.push(obvValues[obvValues.length - 1]);
    }
  }

  const current = obvValues[obvValues.length - 1];

  // Determine OBV trend using 10-period SMA of OBV
  const recentOBV = obvValues.slice(-10);
  const obvSMA = recentOBV.reduce((sum, v) => sum + v, 0) / recentOBV.length;
  const trend: 'bullish' | 'bearish' | 'neutral' = 
    current > obvSMA * 1.02 ? 'bullish' : 
    current < obvSMA * 0.98 ? 'bearish' : 'neutral';

  // Check for divergence (price vs OBV)
  const lookback = 20;
  let divergence: OBVResult['divergence'] = 'none';
  
  if (candles.length >= lookback && obvValues.length >= lookback) {
    const recentPriceCloses = candles.slice(-lookback).map(c => c.close);
    const recentOBVSlice = obvValues.slice(-lookback);
    
    const priceRising = recentPriceCloses[recentPriceCloses.length - 1] > recentPriceCloses[0];
    const obvRising = recentOBVSlice[recentOBVSlice.length - 1] > recentOBVSlice[0];
    
    // Price making highs but OBV falling = bearish divergence
    if (priceRising && !obvRising) divergence = 'bearish_divergence';
    // Price making lows but OBV rising = bullish divergence
    if (!priceRising && obvRising) divergence = 'bullish_divergence';
  }

  // Combined signal
  let signal: OBVResult['signal'] = 'neutral';
  if (trend === 'bullish' && divergence === 'none') signal = 'buy';
  if (trend === 'bullish' && divergence === 'bullish_divergence') signal = 'strong_buy';
  if (trend === 'bearish' && divergence === 'none') signal = 'sell';
  if (trend === 'bearish' && divergence === 'bearish_divergence') signal = 'strong_sell';

  return { values: obvValues, current, trend, divergence, signal };
};

// Volume-weighted validation for Order Blocks
export const validateOBWithVolume = (
  candles: CandleData[],
  obIndex: number
): { valid: boolean; volumeStrength: 'high' | 'medium' | 'low' } => {
  if (obIndex < 1 || obIndex >= candles.length - 1) {
    return { valid: false, volumeStrength: 'low' };
  }

  // Use range as volume proxy
  const obRange = candles[obIndex].high - candles[obIndex].low;
  const moveRange = candles[obIndex + 1].high - candles[obIndex + 1].low;
  
  // Average range for context
  const start = Math.max(0, obIndex - 10);
  const contextCandles = candles.slice(start, obIndex);
  const avgRange = contextCandles.reduce((sum, c) => sum + (c.high - c.low), 0) / contextCandles.length;

  // Strong OB has above-average volume on the move away
  const volumeRatio = moveRange / avgRange;
  
  let volumeStrength: 'high' | 'medium' | 'low' = 'low';
  if (volumeRatio > 1.8) volumeStrength = 'high';
  else if (volumeRatio > 1.2) volumeStrength = 'medium';

  return { valid: volumeRatio > 1.0, volumeStrength };
};
