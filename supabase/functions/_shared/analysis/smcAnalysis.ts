import type { CandleData } from './core.ts';
import { TradingInstrument, TrendDirection, MarketPhase, PriceLevel, isSyntheticIndex } from './core.ts';
import { getSyntheticProfile, SyntheticProfile } from './syntheticProfiles.ts';

/**
 * Smart Money Concepts (SMC) Analysis Engine
 * 
 * Synthetic indices use per-index behavior profiles that tune swing lookback,
 * OB/FVG thresholds, liquidity tolerance, and other parameters based on
 * each index's unique market structure characteristics.
 */

// Swing High/Low Detection
export interface SwingPoint {
  price: number;
  index: number;
  epoch: number;
  type: 'high' | 'low';
}

export const findSwingPoints = (candles: CandleData[], lookback: number = 3): SwingPoint[] => {
  const swingPoints: SwingPoint[] = [];
  
  for (let i = lookback; i < candles.length - lookback; i++) {
    const current = candles[i];
    let isSwingHigh = true;
    let isSwingLow = true;
    
    for (let j = 1; j <= lookback; j++) {
      if (candles[i - j].high >= current.high || candles[i + j].high >= current.high) {
        isSwingHigh = false;
      }
      if (candles[i - j].low <= current.low || candles[i + j].low <= current.low) {
        isSwingLow = false;
      }
    }
    
    if (isSwingHigh) {
      swingPoints.push({ price: current.high, index: i, epoch: current.epoch, type: 'high' });
    }
    if (isSwingLow) {
      swingPoints.push({ price: current.low, index: i, epoch: current.epoch, type: 'low' });
    }
  }
  
  return swingPoints;
};

// Market Structure Analysis (HH, HL, LH, LL)
export interface MarketStructure {
  trend: TrendDirection;
  structure: 'HH_HL' | 'LH_LL' | 'ranging';
  lastSwingHigh: number;
  lastSwingLow: number;
  structureBreak: boolean;
  breakOfStructure: 'bullish' | 'bearish' | null;
  changeOfCharacter: 'bullish' | 'bearish' | null; // CHoCH: internal structure shift
}

export const analyzeMarketStructure = (candles: CandleData[]): MarketStructure => {
  const swingPoints = findSwingPoints(candles);
  const highs = swingPoints.filter(p => p.type === 'high').slice(-6);
  const lows = swingPoints.filter(p => p.type === 'low').slice(-6);
  
  if (highs.length < 2 || lows.length < 2) {
    return {
      trend: 'ranging',
      structure: 'ranging',
      lastSwingHigh: candles[candles.length - 1].high,
      lastSwingLow: candles[candles.length - 1].low,
      structureBreak: false,
      breakOfStructure: null,
      changeOfCharacter: null,
    };
  }
  
  // Use majority voting across recent swing pairs for more reliable structure detection
  let hhCount = 0, llCount = 0, lhCount = 0, hlCount = 0;
  for (let i = 1; i < highs.length; i++) {
    if (highs[i].price > highs[i - 1].price) hhCount++;
    else if (highs[i].price < highs[i - 1].price) lhCount++;
  }
  for (let i = 1; i < lows.length; i++) {
    if (lows[i].price > lows[i - 1].price) hlCount++;
    else if (lows[i].price < lows[i - 1].price) llCount++;
  }
  
  const lastHigh = highs[highs.length - 1].price;
  const lastLow = lows[lows.length - 1].price;
  
  let trend: TrendDirection = 'ranging';
  let structure: 'HH_HL' | 'LH_LL' | 'ranging' = 'ranging';
  
  // Require majority of swing points to confirm trend (not just last 2)
  const totalHighPairs = highs.length - 1;
  const totalLowPairs = lows.length - 1;
  
  if (hhCount > totalHighPairs * 0.5 && hlCount > totalLowPairs * 0.5) {
    trend = 'bullish';
    structure = 'HH_HL';
  } else if (lhCount > totalHighPairs * 0.5 && llCount > totalLowPairs * 0.5) {
    trend = 'bearish';
    structure = 'LH_LL';
  }
  
  // Detect Break of Structure (BOS) — price closes beyond the MAJOR structure level
  const currentPrice = candles[candles.length - 1].close;
  let structureBreak = false;
  let breakOfStructure: 'bullish' | 'bearish' | null = null;
  
  if (currentPrice > lastHigh && trend === 'bearish') {
    structureBreak = true;
    breakOfStructure = 'bullish';
  } else if (currentPrice < lastLow && trend === 'bullish') {
    structureBreak = true;
    breakOfStructure = 'bearish';
  }
  
  // Detect Change of Character (CHoCH) — internal structure shift
  // CHoCH occurs when the most recent internal swing breaks against the prevailing trend
  // WITHOUT the major structure being broken (that would be BOS)
  let changeOfCharacter: 'bullish' | 'bearish' | null = null;
  
  if (!structureBreak && highs.length >= 3 && lows.length >= 3) {
    const prevPrevHigh = highs[highs.length - 3]?.price;
    const prevPrevLow = lows[lows.length - 3]?.price;
    
    if (trend === 'bearish' || structure === 'LH_LL') {
      // In bearish trend: CHoCH = most recent low is HIGHER than previous low (HL forming in downtrend)
      // AND most recent high breaks the previous internal high
      if (lastLow > (lows[lows.length - 2]?.price ?? 0) && lastHigh > (highs[highs.length - 2]?.price ?? Infinity)) {
        changeOfCharacter = 'bullish';
      }
    }
    
    if (trend === 'bullish' || structure === 'HH_HL') {
      // In bullish trend: CHoCH = most recent high is LOWER than previous high (LH forming in uptrend)
      // AND most recent low breaks the previous internal low
      if (lastHigh < (highs[highs.length - 2]?.price ?? Infinity) && lastLow < (lows[lows.length - 2]?.price ?? 0)) {
        changeOfCharacter = 'bearish';
      }
    }
  }
  
  return {
    trend,
    structure,
    lastSwingHigh: lastHigh,
    lastSwingLow: lastLow,
    structureBreak,
    breakOfStructure,
    changeOfCharacter,
  };
};

// Order Block Detection
export type SMCTimeframe = 'D1' | '4H' | '1H';

export interface OrderBlock {
  type: 'bullish' | 'bearish';
  high: number;
  low: number;
  epoch: number;
  strength: 'strong' | 'moderate' | 'weak';
  mitigated: boolean;
  qualityScore: number; // 0-100 imbalance quality score
  aggressionRatio: number; // how aggressively price left the zone
  testCount: number; // how many times price retested the zone
  recencyWeight: number; // 0-1, more recent = higher
  timeframe: SMCTimeframe;
}

export const findOrderBlocks = (candles: CandleData[], timeframe: SMCTimeframe = '4H'): OrderBlock[] => {
  const orderBlocks: OrderBlock[] = [];
  const totalCandles = candles.length;
  
  for (let i = 2; i < candles.length - 1; i++) {
    const current = candles[i];
    const next = candles[i + 1];
    
    // Bullish Order Block: Last bearish candle before a bullish move
    const isBearishCandle = current.close < current.open;
    const isBullishMove = next.close > next.open && next.close > current.high;
    
    if (isBearishCandle && isBullishMove) {
      const { mitigated, testCount } = countZoneTests(candles, i, 'bullish');
      const aggressionRatio = calcAggression(candles, i, 'bullish');
      const recencyWeight = calcRecency(i, totalCandles);
      const qualityScore = calcImbalanceQuality(aggressionRatio, testCount, recencyWeight);
      
      orderBlocks.push({
        type: 'bullish',
        high: current.high,
        low: current.low,
        epoch: current.epoch,
        strength: qualityScore >= 70 ? 'strong' : qualityScore >= 40 ? 'moderate' : 'weak',
        mitigated,
        qualityScore,
        aggressionRatio,
        testCount,
        recencyWeight,
        timeframe,
      });
    }
    
    // Bearish Order Block: Last bullish candle before a bearish move
    const isBullishCandle = current.close > current.open;
    const isBearishMove = next.close < next.open && next.close < current.low;
    
    if (isBullishCandle && isBearishMove) {
      const { mitigated, testCount } = countZoneTests(candles, i, 'bearish');
      const aggressionRatio = calcAggression(candles, i, 'bearish');
      const recencyWeight = calcRecency(i, totalCandles);
      const qualityScore = calcImbalanceQuality(aggressionRatio, testCount, recencyWeight);
      
      orderBlocks.push({
        type: 'bearish',
        high: current.high,
        low: current.low,
        epoch: current.epoch,
        strength: qualityScore >= 70 ? 'strong' : qualityScore >= 40 ? 'moderate' : 'weak',
        mitigated,
        qualityScore,
        aggressionRatio,
        testCount,
        recencyWeight,
        timeframe,
      });
    }
  }
  
  // Sort by quality score descending, return top 6
  return orderBlocks.sort((a, b) => b.qualityScore - a.qualityScore).slice(0, 6);
};

// Count how many times price retested a zone + mitigated check
function countZoneTests(candles: CandleData[], obIndex: number, type: 'bullish' | 'bearish'): { mitigated: boolean; testCount: number } {
  const ob = candles[obIndex];
  let testCount = 0;
  let mitigated = false;
  
  for (let j = obIndex + 2; j < candles.length; j++) {
    if (type === 'bullish') {
      // Price dips into OB zone
      if (candles[j].low <= ob.high && candles[j].low >= ob.low) {
        testCount++;
        if (testCount >= 3) { mitigated = true; } // 3+ tests = likely mitigated
      }
      if (candles[j].close < ob.low) { mitigated = true; break; } // Closed through = mitigated
    } else {
      if (candles[j].high >= ob.low && candles[j].high <= ob.high) {
        testCount++;
        if (testCount >= 3) { mitigated = true; }
      }
      if (candles[j].close > ob.high) { mitigated = true; break; }
    }
  }
  return { mitigated, testCount };
}

// How aggressively price left the zone (ratio of move-away candle body to OB candle body)
function calcAggression(candles: CandleData[], obIndex: number, type: 'bullish' | 'bearish'): number {
  const ob = candles[obIndex];
  const obBody = Math.abs(ob.close - ob.open) || 0.00001;
  
  // Look at up to 3 candles after OB for the move away
  let maxMoveBody = 0;
  for (let j = obIndex + 1; j < Math.min(obIndex + 4, candles.length); j++) {
    const body = Math.abs(candles[j].close - candles[j].open);
    if (body > maxMoveBody) maxMoveBody = body;
  }
  
  return maxMoveBody / obBody;
}

// Recency: how close to the latest candle (0-1)
function calcRecency(index: number, total: number): number {
  return Math.max(0, Math.min(1, index / (total - 1)));
}

// Combined imbalance quality score (0-100)
function calcImbalanceQuality(aggression: number, tests: number, recency: number): number {
  // Aggression: >2x = max score (40 pts)
  const aggressionScore = Math.min(aggression / 3, 1) * 40;
  
  // Tests: 0 = best (fresh), 1 = ok, 2+ = weakening (30 pts)
  const testScore = tests === 0 ? 30 : tests === 1 ? 20 : tests === 2 ? 10 : 0;
  
  // Recency: more recent = higher (30 pts)
  const recencyScore = recency * 30;
  
  return Math.round(aggressionScore + testScore + recencyScore);
}

// Fair Value Gap (FVG) / Imbalance Detection
export interface FairValueGap {
  type: 'bullish' | 'bearish';
  high: number;
  low: number;
  epoch: number;
  filled: boolean;
  qualityScore: number; // 0-100 imbalance quality
  gapSize: number; // absolute gap size
  aggressionRatio: number;
  recencyWeight: number;
  timeframe: SMCTimeframe;
}

export const findFairValueGaps = (candles: CandleData[], timeframe: SMCTimeframe = '4H'): FairValueGap[] => {
  const fvgs: FairValueGap[] = [];
  const totalCandles = candles.length;
  
  for (let i = 2; i < candles.length; i++) {
    const candle1 = candles[i - 2];
    const candle2 = candles[i - 1];
    const candle3 = candles[i];
    
    // Bullish FVG: Gap between candle1 high and candle3 low
    if (candle3.low > candle1.high) {
      let filled = false;
      for (let j = i + 1; j < candles.length; j++) {
        if (candles[j].low <= candle3.low) {
          filled = true;
          break;
        }
      }
      
      const gapSize = candle3.low - candle1.high;
      const midBody = Math.abs(candle2.close - candle2.open);
      const avgBody = candles.slice(Math.max(0, i - 10), i).reduce((s, c) => s + Math.abs(c.close - c.open), 0) / Math.min(10, i);
      const aggressionRatio = midBody / (avgBody || 0.00001);
      const recencyWeight = calcRecency(i, totalCandles);
      
      // FVG quality: large gap + aggressive candle2 + recent + unfilled
      const gapScore = Math.min(gapSize / (avgBody || 0.00001), 2) * 20; // max 40
      const aggScore = Math.min(aggressionRatio / 2, 1) * 30; // max 30
      const recScore = recencyWeight * 30; // max 30
      const qualityScore = Math.round(gapScore + aggScore + recScore);
      
      fvgs.push({
        type: 'bullish',
        high: candle3.low,
        low: candle1.high,
        epoch: candle2.epoch,
        filled,
        qualityScore,
        gapSize,
        aggressionRatio,
        recencyWeight,
        timeframe,
      });
    }
    
    // Bearish FVG: Gap between candle1 low and candle3 high
    if (candle3.high < candle1.low) {
      let filled = false;
      for (let j = i + 1; j < candles.length; j++) {
        if (candles[j].high >= candle3.high) {
          filled = true;
          break;
        }
      }
      
      const gapSize = candle1.low - candle3.high;
      const midBody = Math.abs(candle2.close - candle2.open);
      const avgBody = candles.slice(Math.max(0, i - 10), i).reduce((s, c) => s + Math.abs(c.close - c.open), 0) / Math.min(10, i);
      const aggressionRatio = midBody / (avgBody || 0.00001);
      const recencyWeight = calcRecency(i, totalCandles);
      
      const gapScore = Math.min(gapSize / (avgBody || 0.00001), 2) * 20;
      const aggScore = Math.min(aggressionRatio / 2, 1) * 30;
      const recScore = recencyWeight * 30;
      const qualityScore = Math.round(gapScore + aggScore + recScore);
      
      fvgs.push({
        type: 'bearish',
        high: candle1.low,
        low: candle3.high,
        epoch: candle2.epoch,
        filled,
        qualityScore,
        gapSize,
        aggressionRatio,
        recencyWeight,
        timeframe,
      });
    }
  }
  
  // Return unfilled FVGs sorted by quality
  return fvgs.filter(fvg => !fvg.filled).sort((a, b) => b.qualityScore - a.qualityScore).slice(0, 4);
};

// Liquidity Zone Detection (Equal Highs/Lows)
export interface LiquidityZone {
  price: number;
  type: 'buy_stops' | 'sell_stops';
  strength: 'strong' | 'moderate';
  swept: boolean; // Whether price has swept this zone and reversed
  sweepIndex: number | null; // Index of the candle that swept
}

export const findLiquidityZones = (candles: CandleData[], tolerance: number = 0.0002): LiquidityZone[] => {
  const zones: LiquidityZone[] = [];
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  
  // Find equal highs (buy stop liquidity)
  for (let i = 0; i < highs.length - 1; i++) {
    for (let j = i + 1; j < highs.length; j++) {
      const diff = Math.abs(highs[i] - highs[j]);
      if (diff < tolerance * highs[i]) {
        const avgPrice = (highs[i] + highs[j]) / 2;
        if (!zones.some(z => Math.abs(z.price - avgPrice) < tolerance * avgPrice)) {
          // Check for sweep: price wicks above the zone then closes back below
          let swept = false;
          let sweepIndex: number | null = null;
          for (let k = j + 1; k < candles.length; k++) {
            if (candles[k].high > avgPrice * (1 + tolerance) && candles[k].close < avgPrice) {
              swept = true;
              sweepIndex = k;
              break;
            }
          }
          zones.push({
            price: avgPrice,
            type: 'buy_stops',
            strength: j - i > 5 ? 'strong' : 'moderate',
            swept,
            sweepIndex,
          });
        }
      }
    }
  }
  
  // Find equal lows (sell stop liquidity)
  for (let i = 0; i < lows.length - 1; i++) {
    for (let j = i + 1; j < lows.length; j++) {
      const diff = Math.abs(lows[i] - lows[j]);
      if (diff < tolerance * lows[i]) {
        const avgPrice = (lows[i] + lows[j]) / 2;
        if (!zones.some(z => Math.abs(z.price - avgPrice) < tolerance * avgPrice)) {
          // Check for sweep: price wicks below the zone then closes back above
          let swept = false;
          let sweepIndex: number | null = null;
          for (let k = j + 1; k < candles.length; k++) {
            if (candles[k].low < avgPrice * (1 - tolerance) && candles[k].close > avgPrice) {
              swept = true;
              sweepIndex = k;
              break;
            }
          }
          zones.push({
            price: avgPrice,
            type: 'sell_stops',
            strength: j - i > 5 ? 'strong' : 'moderate',
            swept,
            sweepIndex,
          });
        }
      }
    }
  }
  
  return zones.slice(-6);
};

// Detect if a recent liquidity sweep occurred (for entry filter)
export interface LiquiditySweepResult {
  detected: boolean;
  direction: 'bullish' | 'bearish' | null; // bullish = sell stops swept (price going up), bearish = buy stops swept (price going down)
  sweepPrice: number | null;
  sweepCandle: number | null;
}

export const detectLiquiditySweep = (candles: CandleData[], tolerance: number = 0.0002): LiquiditySweepResult => {
  const zones = findLiquidityZones(candles, tolerance);
  const recentCandles = 10; // Look at last 10 candles for recent sweeps
  
  // Check for recent sell-stop sweep (bullish signal) — price swept lows then reversed up
  const sellStopSweeps = zones.filter(z => z.type === 'sell_stops' && z.swept && z.sweepIndex !== null && z.sweepIndex >= candles.length - recentCandles);
  if (sellStopSweeps.length > 0) {
    const sweep = sellStopSweeps[sellStopSweeps.length - 1];
    // Verify reversal: candle after sweep closes bullish
    if (sweep.sweepIndex !== null && sweep.sweepIndex + 1 < candles.length) {
      const afterSweep = candles[sweep.sweepIndex + 1];
      if (afterSweep.close > afterSweep.open) {
        return { detected: true, direction: 'bullish', sweepPrice: sweep.price, sweepCandle: sweep.sweepIndex };
      }
    }
    // Even without next candle, if the sweep candle itself has a large bullish wick
    if (sweep.sweepIndex !== null) {
      const sweepCandle = candles[sweep.sweepIndex];
      const lowerWick = Math.min(sweepCandle.open, sweepCandle.close) - sweepCandle.low;
      const body = Math.abs(sweepCandle.close - sweepCandle.open);
      if (lowerWick > body * 1.5) {
        return { detected: true, direction: 'bullish', sweepPrice: sweep.price, sweepCandle: sweep.sweepIndex };
      }
    }
  }
  
  // Check for recent buy-stop sweep (bearish signal) — price swept highs then reversed down
  const buyStopSweeps = zones.filter(z => z.type === 'buy_stops' && z.swept && z.sweepIndex !== null && z.sweepIndex >= candles.length - recentCandles);
  if (buyStopSweeps.length > 0) {
    const sweep = buyStopSweeps[buyStopSweeps.length - 1];
    if (sweep.sweepIndex !== null && sweep.sweepIndex + 1 < candles.length) {
      const afterSweep = candles[sweep.sweepIndex + 1];
      if (afterSweep.close < afterSweep.open) {
        return { detected: true, direction: 'bearish', sweepPrice: sweep.price, sweepCandle: sweep.sweepIndex };
      }
    }
    if (sweep.sweepIndex !== null) {
      const sweepCandle = candles[sweep.sweepIndex];
      const upperWick = sweepCandle.high - Math.max(sweepCandle.open, sweepCandle.close);
      const body = Math.abs(sweepCandle.close - sweepCandle.open);
      if (upperWick > body * 1.5) {
        return { detected: true, direction: 'bearish', sweepPrice: sweep.price, sweepCandle: sweep.sweepIndex };
      }
    }
  }
  
  return { detected: false, direction: null, sweepPrice: null, sweepCandle: null };
};

// Session Analysis (Asian Range for London/NY)
export interface SessionAnalysis {
  asianHigh: number;
  asianLow: number;
  asianRange: number;
  priceRelativeToAsian: 'above' | 'below' | 'within';
  volatility: 'low' | 'medium' | 'high';
}

export const analyzeAsianSession = (candles: CandleData[], currentPrice: number): SessionAnalysis => {
  // Get last 6 candles (approximately Asian session on 4H)
  const sessionCandles = candles.slice(-6);
  
  const asianHigh = Math.max(...sessionCandles.map(c => c.high));
  const asianLow = Math.min(...sessionCandles.map(c => c.low));
  const asianRange = asianHigh - asianLow;
  
  let priceRelativeToAsian: 'above' | 'below' | 'within' = 'within';
  if (currentPrice > asianHigh) priceRelativeToAsian = 'above';
  else if (currentPrice < asianLow) priceRelativeToAsian = 'below';
  
  // Determine volatility based on average candle range
  const avgRange = sessionCandles.reduce((sum, c) => sum + (c.high - c.low), 0) / sessionCandles.length;
  const normalRange = currentPrice * 0.002; // 0.2% is typical
  
  let volatility: 'low' | 'medium' | 'high' = 'medium';
  if (avgRange < normalRange * 0.5) volatility = 'low';
  else if (avgRange > normalRange * 1.5) volatility = 'high';
  
  return { asianHigh, asianLow, asianRange, priceRelativeToAsian, volatility };
};

// ===== BREAKER BLOCKS =====
// A Breaker Block is an Order Block that was violated (price closed through it).
// The broken OB flips polarity: failed bullish OB becomes bearish breaker, and vice versa.
export interface BreakerBlock {
  type: 'bullish' | 'bearish'; // The NEW polarity after flip
  high: number;
  low: number;
  epoch: number;
  originalType: 'bullish' | 'bearish'; // The original OB type that failed
  qualityScore: number;
  recencyWeight: number;
}

export const findBreakerBlocks = (candles: CandleData[]): BreakerBlock[] => {
  const breakers: BreakerBlock[] = [];
  const totalCandles = candles.length;

  for (let i = 2; i < candles.length - 1; i++) {
    const current = candles[i];
    const next = candles[i + 1];

    // Detect original bullish OB candidate
    const isBearishCandle = current.close < current.open;
    const isBullishMove = next.close > next.open && next.close > current.high;

    if (isBearishCandle && isBullishMove) {
      // Check if this bullish OB was later violated (price closed below its low)
      for (let j = i + 2; j < candles.length; j++) {
        if (candles[j].close < current.low) {
          // Bullish OB failed → becomes bearish breaker
          const recency = calcRecency(j, totalCandles);
          // Check if price later retested the breaker zone from below (for entry)
          let retested = false;
          for (let k = j + 1; k < candles.length; k++) {
            if (candles[k].high >= current.low && candles[k].high <= current.high && candles[k].close < current.low) {
              retested = true;
              break;
            }
          }
          breakers.push({
            type: 'bearish',
            high: current.high,
            low: current.low,
            epoch: candles[j].epoch,
            originalType: 'bullish',
            qualityScore: Math.round(recency * 50 + (retested ? 0 : 30) + 20),
            recencyWeight: recency,
          });
          break;
        }
      }
    }

    // Detect original bearish OB candidate
    const isBullishCandle = current.close > current.open;
    const isBearishMove = next.close < next.open && next.close < current.low;

    if (isBullishCandle && isBearishMove) {
      for (let j = i + 2; j < candles.length; j++) {
        if (candles[j].close > current.high) {
          // Bearish OB failed → becomes bullish breaker
          const recency = calcRecency(j, totalCandles);
          let retested = false;
          for (let k = j + 1; k < candles.length; k++) {
            if (candles[k].low <= current.high && candles[k].low >= current.low && candles[k].close > current.high) {
              retested = true;
              break;
            }
          }
          breakers.push({
            type: 'bullish',
            high: current.high,
            low: current.low,
            epoch: candles[j].epoch,
            originalType: 'bearish',
            qualityScore: Math.round(recency * 50 + (retested ? 0 : 30) + 20),
            recencyWeight: recency,
          });
          break;
        }
      }
    }
  }

  return breakers.sort((a, b) => b.qualityScore - a.qualityScore).slice(0, 4);
};

// ===== PREMIUM / DISCOUNT ZONES =====
// Between any swing high and swing low, the 50% level is equilibrium.
// Above 50% = Premium (sell zone), Below 50% = Discount (buy zone).
export interface PremiumDiscountResult {
  swingHigh: number;
  swingLow: number;
  equilibrium: number; // 50% level
  premiumStart: number; // 75% level
  discountEnd: number; // 25% level
  currentZone: 'premium' | 'discount' | 'equilibrium';
  zoneAlignment: boolean; // true if zone matches trade direction (buy in discount, sell in premium)
}

export const analyzePremiumDiscount = (
  swingHigh: number,
  swingLow: number,
  currentPrice: number,
  direction: 'bullish' | 'bearish'
): PremiumDiscountResult => {
  const range = swingHigh - swingLow;
  const equilibrium = swingLow + range * 0.5;
  const premiumStart = swingLow + range * 0.75;
  const discountEnd = swingLow + range * 0.25;

  let currentZone: 'premium' | 'discount' | 'equilibrium';
  if (currentPrice >= premiumStart) {
    currentZone = 'premium';
  } else if (currentPrice <= discountEnd) {
    currentZone = 'discount';
  } else {
    currentZone = 'equilibrium';
  }

  // Buy in discount, sell in premium
  const zoneAlignment =
    (direction === 'bullish' && currentZone === 'discount') ||
    (direction === 'bearish' && currentZone === 'premium');

  return { swingHigh, swingLow, equilibrium, premiumStart, discountEnd, currentZone, zoneAlignment };
};

// ===== CONSEQUENT ENCROACHMENT (CE) =====
// The 50% midpoint of an FVG — a key retest/entry level within the gap.
export interface ConsequentEncroachment {
  price: number; // The CE level (50% of FVG)
  fvgHigh: number;
  fvgLow: number;
  fvgType: 'bullish' | 'bearish';
  priceNearCE: boolean; // Is current price within 20% of CE
  qualityScore: number;
}

export const findConsequentEncroachments = (
  fvgs: FairValueGap[],
  currentPrice: number,
  atr: number
): ConsequentEncroachment[] => {
  return fvgs.map(fvg => {
    const cePrice = (fvg.high + fvg.low) / 2;
    const proximity = Math.abs(currentPrice - cePrice);
    const priceNearCE = proximity <= atr * 0.5;

    return {
      price: cePrice,
      fvgHigh: fvg.high,
      fvgLow: fvg.low,
      fvgType: fvg.type,
      priceNearCE,
      qualityScore: fvg.qualityScore,
    };
  });
};

// ===== INDUCEMENT DETECTION =====
// Inducement is a deliberate manipulation move to trap retail traders.
// Detected as false breakouts of swing points that quickly reverse.
export interface InducementResult {
  detected: boolean;
  type: 'false_breakout_high' | 'false_breakout_low' | 'equal_high_sweep' | 'equal_low_sweep' | null;
  level: number | null;
  direction: 'bullish' | 'bearish' | null; // The TRUE direction after inducement
  candleIndex: number | null;
}

export const detectInducement = (candles: CandleData[], lookback: number = 15): InducementResult => {
  const swings = findSwingPoints(candles, 3);
  const recentCandles = candles.slice(-lookback);
  const startIdx = candles.length - lookback;

  // Check for false breakout of swing highs (inducement = bearish trap → real direction bullish? No: bearish)
  // Actually: false breakout HIGH = retail buys the breakout → SM sells → price drops = bearish inducement
  // false breakout LOW = retail sells the breakdown → SM buys → price rises = bullish inducement
  const recentHighs = swings.filter(s => s.type === 'high' && s.index < startIdx).slice(-3);
  const recentLows = swings.filter(s => s.type === 'low' && s.index < startIdx).slice(-3);

  // False breakout of highs (bearish inducement = true direction is bearish after trapping buyers)
  for (const sh of recentHighs) {
    for (let i = 0; i < recentCandles.length; i++) {
      const c = recentCandles[i];
      // Wick above swing high but close back below
      if (c.high > sh.price && c.close < sh.price && c.close < c.open) {
        return {
          detected: true,
          type: 'false_breakout_high',
          level: sh.price,
          direction: 'bearish',
          candleIndex: startIdx + i,
        };
      }
    }
  }

  // False breakout of lows (bullish inducement = true direction is bullish after trapping sellers)
  for (const sl of recentLows) {
    for (let i = 0; i < recentCandles.length; i++) {
      const c = recentCandles[i];
      if (c.low < sl.price && c.close > sl.price && c.close > c.open) {
        return {
          detected: true,
          type: 'false_breakout_low',
          level: sl.price,
          direction: 'bullish',
          candleIndex: startIdx + i,
        };
      }
    }
  }

  // Equal high sweep (BSL taken → bearish)
  const zones = findLiquidityZones(candles);
  const recentBSLSweeps = zones.filter(z => z.type === 'buy_stops' && z.swept && z.sweepIndex !== null && z.sweepIndex >= startIdx);
  if (recentBSLSweeps.length > 0) {
    return {
      detected: true,
      type: 'equal_high_sweep',
      level: recentBSLSweeps[0].price,
      direction: 'bearish',
      candleIndex: recentBSLSweeps[0].sweepIndex,
    };
  }

  const recentSSLSweeps = zones.filter(z => z.type === 'sell_stops' && z.swept && z.sweepIndex !== null && z.sweepIndex >= startIdx);
  if (recentSSLSweeps.length > 0) {
    return {
      detected: true,
      type: 'equal_low_sweep',
      level: recentSSLSweeps[0].price,
      direction: 'bullish',
      candleIndex: recentSSLSweeps[0].sweepIndex,
    };
  }

  return { detected: false, type: null, level: null, direction: null, candleIndex: null };
};

// ===== DISPLACEMENT DETECTION =====
// Strong impulsive moves characterized by large-bodied candles with minimal wicks.
export interface DisplacementResult {
  detected: boolean;
  direction: 'bullish' | 'bearish' | null;
  strength: number; // 0-100
  candleIndex: number | null;
}

export const detectDisplacement = (candles: CandleData[], lookback: number = 10): DisplacementResult => {
  const recent = candles.slice(-lookback);
  const avgBody = candles.slice(-50).reduce((s, c) => s + Math.abs(c.close - c.open), 0) / Math.min(50, candles.length);

  let bestStrength = 0;
  let bestDir: 'bullish' | 'bearish' | null = null;
  let bestIdx: number | null = null;

  for (let i = 0; i < recent.length; i++) {
    const c = recent[i];
    const body = Math.abs(c.close - c.open);
    const totalRange = c.high - c.low;
    const wickRatio = totalRange > 0 ? body / totalRange : 0;

    // Displacement: body is >2x average AND wicks are small (>70% body ratio)
    if (body > avgBody * 2 && wickRatio > 0.65) {
      const strength = Math.min(Math.round((body / avgBody) * 25 + wickRatio * 50), 100);
      if (strength > bestStrength) {
        bestStrength = strength;
        bestDir = c.close > c.open ? 'bullish' : 'bearish';
        bestIdx = candles.length - lookback + i;
      }
    }
  }

  return { detected: bestStrength > 0, direction: bestDir, strength: bestStrength, candleIndex: bestIdx };
};

// Calculate Fibonacci Levels
export interface FibLevel {
  level: string;
  price: number;
}

export const calculateFibonacciLevels = (
  swingHigh: number,
  swingLow: number,
  direction: 'bullish' | 'bearish'
): FibLevel[] => {
  const diff = swingHigh - swingLow;
  const levels = [0.236, 0.382, 0.5, 0.618, 0.786];
  
  if (direction === 'bullish') {
    // Retracement from high to low
    return levels.map(level => ({
      level: `${(level * 100).toFixed(1)}%`,
      price: swingHigh - (diff * level),
    }));
  } else {
    // Retracement from low to high
    return levels.map(level => ({
      level: `${(level * 100).toFixed(1)}%`,
      price: swingLow + (diff * level),
    }));
  }
};

// Determine Market Phase
export const determineMarketPhase = (
  structure: MarketStructure,
  recentCandles: CandleData[]
): MarketPhase => {
  if (structure.structureBreak) {
    return 'breakout';
  }
  
  if (structure.trend === 'ranging') {
    return 'consolidation';
  }
  
  // Check for reversal signs
  const lastCandles = recentCandles.slice(-5);
  const avgBodySize = lastCandles.reduce((sum, c) => sum + Math.abs(c.close - c.open), 0) / lastCandles.length;
  const lastCandle = lastCandles[lastCandles.length - 1];
  const lastBodySize = Math.abs(lastCandle.close - lastCandle.open);
  
  // If last candle is significantly larger and opposite direction, might be reversal
  if (lastBodySize > avgBodySize * 2) {
    const isBullishCandle = lastCandle.close > lastCandle.open;
    if ((structure.trend === 'bearish' && isBullishCandle) ||
        (structure.trend === 'bullish' && !isBullishCandle)) {
      return 'reversal';
    }
  }
  
  return 'trending';
};

// Generate Support/Resistance Levels
export const generateKeyLevels = (
  candles: CandleData[],
  currentPrice: number,
  instrument: TradingInstrument
): { support: PriceLevel[]; resistance: PriceLevel[] } => {
  const swingPoints = findSwingPoints(candles, 5);
  const pip = instrument === 'USD/JPY' ? 0.01 : 0.0001;
  
  const highs = swingPoints.filter(p => p.type === 'high' && p.price > currentPrice);
  const lows = swingPoints.filter(p => p.type === 'low' && p.price < currentPrice);
  
  // Sort and take top 3 each
  highs.sort((a, b) => a.price - b.price);
  lows.sort((a, b) => b.price - a.price);
  
  const resistance: PriceLevel[] = highs.slice(0, 3).map((h, i) => ({
    price: h.price,
    type: 'resistance' as const,
    description: i === 0 ? 'Nearest swing high' : i === 1 ? 'Previous swing high' : 'Major resistance',
    strength: i === 0 ? 'moderate' : 'strong' as const,
  }));
  
  const support: PriceLevel[] = lows.slice(0, 3).map((l, i) => ({
    price: l.price,
    type: 'support' as const,
    description: i === 0 ? 'Nearest swing low' : i === 1 ? 'Previous swing low' : 'Major support',
    strength: i === 0 ? 'moderate' : 'strong' as const,
  }));
  
  // Add round numbers
  const roundUp = Math.ceil(currentPrice * 100) / 100;
  const roundDown = Math.floor(currentPrice * 100) / 100;
  
  if (!resistance.some(r => Math.abs(r.price - roundUp) < pip * 10)) {
    resistance.push({
      price: roundUp,
      type: 'resistance',
      description: 'Psychological round number',
      strength: 'moderate',
    });
  }
  
  if (!support.some(s => Math.abs(s.price - roundDown) < pip * 10)) {
    support.push({
      price: roundDown,
      type: 'support',
      description: 'Psychological round number',
      strength: 'moderate',
    });
  }
  
  return { support, resistance };
};

// ─── Chart-ready SMC data extraction ────────────────────────
export interface SMCStructuralPoint {
  direction: 'bullish' | 'bearish';
  price: number;
  epoch: number;
  timeframe: SMCTimeframe;
}

export interface SMCChartPoints {
  swingPoints: SwingPoint[];
  choch: SMCStructuralPoint[];
  bos: SMCStructuralPoint[];
  liquidityZones: LiquidityZone[];
}

export const extractSMCChartPoints = (candles: CandleData[], timeframe: SMCTimeframe = '4H'): SMCChartPoints => {
  const swingPoints = findSwingPoints(candles);
  const structure = analyzeMarketStructure(candles);
  const liquidityZones = findLiquidityZones(candles);
  const highs = swingPoints.filter(p => p.type === 'high');
  const lows = swingPoints.filter(p => p.type === 'low');

  const choch: SMCStructuralPoint[] = [];
  const bos: SMCStructuralPoint[] = [];

  if (structure.changeOfCharacter && highs.length >= 2 && lows.length >= 2) {
    const anchor = structure.changeOfCharacter === 'bullish'
      ? highs[highs.length - 1]
      : lows[lows.length - 1];
    choch.push({
      direction: structure.changeOfCharacter,
      price: anchor.price,
      epoch: anchor.epoch,
      timeframe,
    });
  }

  if (structure.breakOfStructure && highs.length >= 2 && lows.length >= 2) {
    const anchor = structure.breakOfStructure === 'bullish'
      ? highs[highs.length - 1]
      : lows[lows.length - 1];
    bos.push({
      direction: structure.breakOfStructure,
      price: anchor.price,
      epoch: anchor.epoch,
      timeframe,
    });
  }

  return { swingPoints, choch, bos, liquidityZones };
};

/** Merge SMC chart points from multiple timeframes */
export const mergeSMCChartPoints = (...points: SMCChartPoints[]): SMCChartPoints => {
  return {
    swingPoints: points.flatMap(p => p.swingPoints),
    choch: points.flatMap(p => p.choch),
    bos: points.flatMap(p => p.bos),
    liquidityZones: points.flatMap(p => p.liquidityZones),
  };
};
