/**
 * Frozen, measurement-only port of supabase/functions/signal-engine/index.ts's
 * LOCAL direction-decision engine (the ~500-line independently-reimplemented
 * SMC analysis: analyzeStructure, findOrderBlocks, findFVGs, calculateOBV,
 * detectLiquiditySweep, findBreakerBlocks, detectInducement, detectDisplacement,
 * etc.) plus generateSignal() itself, verbatim.
 *
 * This exists ONLY to answer: does the server's independent re-implementation
 * of structure/OB/FVG detection (used to decide direction, gate signals, and
 * compute risk geometry) produce different, better, or worse outcomes than the
 * client's clean single-shared-source path (generateTradePlan, which reads
 * ONLY the canonical _shared/analysis/ modules)?
 *
 * The final confidence number still goes through the real shared
 * computeSwingConfidence(analyzeMarket(...)) call, exactly as production does —
 * only the direction-decision/gating/risk-geometry layer is frozen here.
 *
 * Changes nothing live. Do not import this from production code.
 */
import { analyzeMarket } from '../supabase/functions/_shared/analysis/marketAnalysis.ts';
import type { AnalysisResult } from '../supabase/functions/_shared/analysis/marketAnalysis.ts';
import { computeSwingConfidence } from '../supabase/functions/_shared/analysis/swingConfidence.ts';
import type { TradingInstrument } from '@/types/trading';

interface CandleData { open: number; high: number; low: number; close: number; epoch: number; }

const SYNTHETIC_INDICES = ['V10', 'V25', 'V50', 'V75', 'V100', 'BOOM1000'];
const isSyntheticIndex = (instrument: string) => SYNTHETIC_INDICES.includes(instrument);
const getDecimals = (instrument: string) => {
  if (isSyntheticIndex(instrument) || instrument.includes('JPY') || instrument === 'XAU/USD') return 2;
  return 4;
};

// =================== TECHNICAL INDICATORS (local/legacy copies) ===================
function calculateSMA(data: number[], period: number): number {
  if (data.length < period) return 0;
  return data.slice(-period).reduce((s, v) => s + v, 0) / period;
}

function calculateEMA(data: number[], period: number): number[] {
  if (data.length < period) return [];
  const m = 2 / (period + 1);
  const ema: number[] = [data.slice(0, period).reduce((s, v) => s + v, 0) / period];
  for (let i = period; i < data.length; i++) ema.push((data[i] - ema[ema.length - 1]) * m + ema[ema.length - 1]);
  return ema;
}

function calculateRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain += change; else avgLoss += Math.abs(change);
  }
  avgGain /= period; avgLoss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (change < 0 ? Math.abs(change) : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

function calculateMACD(closes: number[]) {
  const fast = calculateEMA(closes, 12), slow = calculateEMA(closes, 26);
  if (!fast.length || !slow.length) return { histogram: 0, signal: 'neutral' as const };
  const offset = fast.length - slow.length;
  const macdVals = slow.map((_, i) => fast[i + offset] - slow[i]);
  const sig = calculateEMA(macdVals, 9);
  const macdLine = macdVals[macdVals.length - 1] || 0;
  const signalLine = sig[sig.length - 1] || 0;
  const histogram = macdLine - signalLine;
  return { histogram, signal: histogram > 0 && macdLine > 0 ? 'bullish' as const : histogram < 0 && macdLine < 0 ? 'bearish' as const : 'neutral' as const };
}

function calculateATR(candles: CandleData[], period = 14): number {
  if (candles.length < period + 1) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    trs.push(Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - candles[i - 1].close), Math.abs(candles[i].low - candles[i - 1].close)));
  }
  return trs.slice(-period).reduce((s, v) => s + v, 0) / period;
}

function analyzeMovingAverages(closes: number[]) {
  const ma20 = calculateSMA(closes, 20), ma50 = calculateSMA(closes, 50), ma200 = calculateSMA(closes, 200);
  const trend = ma20 > ma50 && ma50 > ma200 ? 'bullish' : ma20 < ma50 && ma50 < ma200 ? 'bearish' : 'neutral';
  return { ma20, ma50, ma200, trend };
}

// =================== MARKET STRUCTURE (local/legacy copy) ===================
function findSwingPoints(candles: CandleData[], lookback = 3) {
  const points: { price: number; type: 'high' | 'low'; index: number }[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isHigh = true, isLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i - j].high >= candles[i].high || candles[i + j].high >= candles[i].high) isHigh = false;
      if (candles[i - j].low <= candles[i].low || candles[i + j].low <= candles[i].low) isLow = false;
    }
    if (isHigh) points.push({ price: candles[i].high, type: 'high', index: i });
    if (isLow) points.push({ price: candles[i].low, type: 'low', index: i });
  }
  return points;
}

function analyzeStructure(candles: CandleData[]) {
  const swings = findSwingPoints(candles);
  const highs = swings.filter(s => s.type === 'high').slice(-4);
  const lows = swings.filter(s => s.type === 'low').slice(-4);
  if (highs.length < 2 || lows.length < 2) return { trend: 'ranging' as const, structure: 'ranging' as const, lastHigh: candles[candles.length - 1].high, lastLow: candles[candles.length - 1].low, bos: null as string | null, choch: null as string | null };

  const lastH = highs[highs.length - 1].price, prevH = highs[highs.length - 2].price;
  const lastL = lows[lows.length - 1].price, prevL = lows[lows.length - 2].price;
  const hh = lastH > prevH, hl = lastL > prevL, lh = lastH < prevH, ll = lastL < prevL;

  let trend: 'bullish' | 'bearish' | 'ranging' = 'ranging';
  let structure: 'HH_HL' | 'LH_LL' | 'ranging' = 'ranging';
  if (hh && hl) { trend = 'bullish'; structure = 'HH_HL'; }
  else if (lh && ll) { trend = 'bearish'; structure = 'LH_LL'; }

  const price = candles[candles.length - 1].close;
  let bos: string | null = null;
  if (price > lastH && trend === 'bearish') bos = 'bullish';
  else if (price < lastL && trend === 'bullish') bos = 'bearish';

  let choch: string | null = null;
  if (!bos && highs.length >= 3 && lows.length >= 3) {
    if ((trend === 'bearish' || structure === 'LH_LL') && lastL > prevL && lastH > prevH) {
      choch = 'bullish';
    }
    if ((trend === 'bullish' || structure === 'HH_HL') && lastH < prevH && lastL < prevL) {
      choch = 'bearish';
    }
  }

  return { trend, structure, lastHigh: lastH, lastLow: lastL, bos, choch };
}

function findOrderBlocksLocal(candles: CandleData[]) {
  const obs: { type: 'bullish' | 'bearish'; high: number; low: number; mitigated: boolean }[] = [];
  for (let i = 2; i < candles.length - 1; i++) {
    const curr = candles[i], next = candles[i + 1];
    if (curr.close < curr.open && next.close > next.open && next.close > curr.high) {
      let mitigated = false;
      for (let j = i + 2; j < candles.length; j++) if (candles[j].low <= curr.high && candles[j].low >= curr.low) { mitigated = true; break; }
      obs.push({ type: 'bullish', high: curr.high, low: curr.low, mitigated });
    }
    if (curr.close > curr.open && next.close < next.open && next.close < curr.low) {
      let mitigated = false;
      for (let j = i + 2; j < candles.length; j++) if (candles[j].high >= curr.low && candles[j].high <= curr.high) { mitigated = true; break; }
      obs.push({ type: 'bearish', high: curr.high, low: curr.low, mitigated });
    }
  }
  return obs.slice(-6);
}

function findFVGs(candles: CandleData[]) {
  const fvgs: { type: 'bullish' | 'bearish'; high: number; low: number }[] = [];
  for (let i = 2; i < candles.length; i++) {
    if (candles[i].low > candles[i - 2].high) {
      let filled = false;
      for (let j = i + 1; j < candles.length; j++) if (candles[j].low <= candles[i].low) { filled = true; break; }
      if (!filled) fvgs.push({ type: 'bullish', high: candles[i].low, low: candles[i - 2].high });
    }
    if (candles[i].high < candles[i - 2].low) {
      let filled = false;
      for (let j = i + 1; j < candles.length; j++) if (candles[j].high >= candles[i].high) { filled = true; break; }
      if (!filled) fvgs.push({ type: 'bearish', high: candles[i - 2].low, low: candles[i].high });
    }
  }
  return fvgs.slice(-4);
}

function calculateOBV(candles: CandleData[]) {
  if (candles.length < 10) return { trend: 'neutral' as const, divergence: 'none' as const };
  const obv: number[] = [0];
  for (let i = 1; i < candles.length; i++) {
    const vol = (candles[i].high - candles[i].low) * 100000;
    if (candles[i].close > candles[i - 1].close) obv.push(obv[obv.length - 1] + vol);
    else if (candles[i].close < candles[i - 1].close) obv.push(obv[obv.length - 1] - vol);
    else obv.push(obv[obv.length - 1]);
  }
  const recent = obv.slice(-10);
  const sma = recent.reduce((s, v) => s + v, 0) / recent.length;
  const trend = obv[obv.length - 1] > sma * 1.02 ? 'bullish' : obv[obv.length - 1] < sma * 0.98 ? 'bearish' : 'neutral';

  let divergence: 'bullish_divergence' | 'bearish_divergence' | 'none' = 'none';
  if (candles.length >= 20) {
    const priceUp = candles[candles.length - 1].close > candles[candles.length - 20].close;
    const obvUp = obv[obv.length - 1] > obv[obv.length - 20];
    if (priceUp && !obvUp) divergence = 'bearish_divergence';
    if (!priceUp && obvUp) divergence = 'bullish_divergence';
  }
  return { trend, divergence };
}

function detectLiquiditySweep(candles: CandleData[], tolerance = 0.0002): { detected: boolean; direction: 'bullish' | 'bearish' | null } {
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const recentRange = 10;

  for (let i = 0; i < lows.length - 2; i++) {
    for (let j = i + 1; j < lows.length - 1; j++) {
      if (Math.abs(lows[i] - lows[j]) < tolerance * lows[i]) {
        const eqLow = (lows[i] + lows[j]) / 2;
        for (let k = Math.max(j + 1, candles.length - recentRange); k < candles.length; k++) {
          if (candles[k].low < eqLow * (1 - tolerance) && candles[k].close > eqLow) {
            return { detected: true, direction: 'bullish' };
          }
        }
      }
    }
  }

  for (let i = 0; i < highs.length - 2; i++) {
    for (let j = i + 1; j < highs.length - 1; j++) {
      if (Math.abs(highs[i] - highs[j]) < tolerance * highs[i]) {
        const eqHigh = (highs[i] + highs[j]) / 2;
        for (let k = Math.max(j + 1, candles.length - recentRange); k < candles.length; k++) {
          if (candles[k].high > eqHigh * (1 + tolerance) && candles[k].close < eqHigh) {
            return { detected: true, direction: 'bearish' };
          }
        }
      }
    }
  }

  return { detected: false, direction: null };
}

function detectSpike(candles: CandleData[]): boolean {
  if (candles.length < 5) return false;
  const last = candles[candles.length - 1];
  const avgRange = candles.slice(-20).reduce((s, c) => s + (c.high - c.low), 0) / 20;
  const lastRange = last.high - last.low;
  return lastRange > avgRange * 3;
}

interface SyntheticProfileEdge {
  volatilityTier: number; structureClarity: number; slAtrMultiplier: number;
  volumeExpansionMult: number; maxConfluenceScore: number; minScoreDifference: number;
  consolidationBeforeBreakout: boolean; meanReversionAtExtremes: boolean;
  liquiditySweepWeightBoost: number; behaviorNotes: string[];
}

const SYNTH_PROFILES: Record<string, SyntheticProfileEdge> = {
  V10: { volatilityTier: 1, structureClarity: 5, slAtrMultiplier: 1.5, volumeExpansionMult: 0.5, maxConfluenceScore: 44, minScoreDifference: 2, consolidationBeforeBreakout: false, meanReversionAtExtremes: false, liquiditySweepWeightBoost: 1.5, behaviorNotes: [] },
  V25: { volatilityTier: 2, structureClarity: 5, slAtrMultiplier: 1.8, volumeExpansionMult: 0.5, maxConfluenceScore: 44, minScoreDifference: 2, consolidationBeforeBreakout: false, meanReversionAtExtremes: false, liquiditySweepWeightBoost: 1.5, behaviorNotes: [] },
  V50: { volatilityTier: 3, structureClarity: 4, slAtrMultiplier: 2.0, volumeExpansionMult: 0.55, maxConfluenceScore: 44, minScoreDifference: 3, consolidationBeforeBreakout: true, meanReversionAtExtremes: false, liquiditySweepWeightBoost: 1.3, behaviorNotes: [] },
  V75: { volatilityTier: 4, structureClarity: 3, slAtrMultiplier: 2.5, volumeExpansionMult: 0.6, maxConfluenceScore: 44, minScoreDifference: 3, consolidationBeforeBreakout: false, meanReversionAtExtremes: false, liquiditySweepWeightBoost: 1.5, behaviorNotes: [] },
  V100: { volatilityTier: 5, structureClarity: 2, slAtrMultiplier: 3.0, volumeExpansionMult: 0.6, maxConfluenceScore: 44, minScoreDifference: 4, consolidationBeforeBreakout: false, meanReversionAtExtremes: true, liquiditySweepWeightBoost: 1.5, behaviorNotes: [] },
  BOOM1000: { volatilityTier: 4, structureClarity: 3, slAtrMultiplier: 2.5, volumeExpansionMult: 0.6, maxConfluenceScore: 44, minScoreDifference: 3, consolidationBeforeBreakout: false, meanReversionAtExtremes: false, liquiditySweepWeightBoost: 1.3, behaviorNotes: [] },
};

function getSynthProfile(instrument: string): SyntheticProfileEdge | null {
  return SYNTH_PROFILES[instrument] ?? null;
}

interface BreakerBlock { type: 'bullish' | 'bearish'; high: number; low: number; qualityScore: number; }

function findBreakerBlocks(candles: CandleData[]): BreakerBlock[] {
  const breakers: BreakerBlock[] = [];
  const totalCandles = candles.length;

  for (let i = 2; i < candles.length - 1; i++) {
    const current = candles[i];
    const next = candles[i + 1];

    if (current.close < current.open && next.close > next.open && next.close > current.high) {
      for (let j = i + 2; j < candles.length; j++) {
        if (candles[j].close < current.low) {
          const recency = Math.max(0, Math.min(1, j / (totalCandles - 1)));
          let retested = false;
          for (let k = j + 1; k < candles.length; k++) {
            if (candles[k].high >= current.low && candles[k].high <= current.high && candles[k].close < current.low) { retested = true; break; }
          }
          breakers.push({ type: 'bearish', high: current.high, low: current.low, qualityScore: Math.round(recency * 50 + (retested ? 0 : 30) + 20) });
          break;
        }
      }
    }

    if (current.close > current.open && next.close < next.open && next.close < current.low) {
      for (let j = i + 2; j < candles.length; j++) {
        if (candles[j].close > current.high) {
          const recency = Math.max(0, Math.min(1, j / (totalCandles - 1)));
          let retested = false;
          for (let k = j + 1; k < candles.length; k++) {
            if (candles[k].low <= current.high && candles[k].low >= current.low && candles[k].close > current.high) { retested = true; break; }
          }
          breakers.push({ type: 'bullish', high: current.high, low: current.low, qualityScore: Math.round(recency * 50 + (retested ? 0 : 30) + 20) });
          break;
        }
      }
    }
  }

  return breakers.sort((a, b) => b.qualityScore - a.qualityScore).slice(0, 4);
}

interface PremiumDiscountResult { currentZone: 'premium' | 'discount' | 'equilibrium'; zoneAlignment: boolean; equilibrium: number; }

function analyzePremiumDiscount(swingHigh: number, swingLow: number, currentPrice: number, direction: 'bullish' | 'bearish'): PremiumDiscountResult {
  const range = swingHigh - swingLow;
  const equilibrium = swingLow + range * 0.5;
  const premiumStart = swingLow + range * 0.75;
  const discountEnd = swingLow + range * 0.25;

  let currentZone: 'premium' | 'discount' | 'equilibrium';
  if (currentPrice >= premiumStart) currentZone = 'premium';
  else if (currentPrice <= discountEnd) currentZone = 'discount';
  else currentZone = 'equilibrium';

  const zoneAlignment = (direction === 'bullish' && currentZone === 'discount') || (direction === 'bearish' && currentZone === 'premium');
  return { currentZone, zoneAlignment, equilibrium };
}

interface ConsequentEncroachment { fvgType: 'bullish' | 'bearish'; cePrice: number; priceNearCE: boolean; }

function findConsequentEncroachments(fvgs: { type: 'bullish' | 'bearish'; high: number; low: number }[], currentPrice: number, atr: number): ConsequentEncroachment[] {
  return fvgs.map(fvg => {
    const cePrice = (fvg.high + fvg.low) / 2;
    const proximity = Math.abs(currentPrice - cePrice);
    return { fvgType: fvg.type, cePrice, priceNearCE: proximity <= atr * 0.5 };
  });
}

interface InducementResult { detected: boolean; direction: 'bullish' | 'bearish' | null; type: string | null; }

function detectInducement(candles: CandleData[], lookback = 15): InducementResult {
  const swings = findSwingPoints(candles, 3);
  const startIdx = candles.length - lookback;
  const recentCandles = candles.slice(-lookback);

  const recentHighs = swings.filter(s => s.type === 'high' && s.index < startIdx).slice(-3);
  for (const sh of recentHighs) {
    for (let i = 0; i < recentCandles.length; i++) {
      const c = recentCandles[i];
      if (c.high > sh.price && c.close < sh.price && c.close < c.open) {
        return { detected: true, type: 'false_breakout_high', direction: 'bearish' };
      }
    }
  }

  const recentLows = swings.filter(s => s.type === 'low' && s.index < startIdx).slice(-3);
  for (const sl of recentLows) {
    for (let i = 0; i < recentCandles.length; i++) {
      const c = recentCandles[i];
      if (c.low < sl.price && c.close > sl.price && c.close > c.open) {
        return { detected: true, type: 'false_breakout_low', direction: 'bullish' };
      }
    }
  }

  return { detected: false, type: null, direction: null };
}

interface DisplacementResult { detected: boolean; direction: 'bullish' | 'bearish' | null; strength: number; }

function detectDisplacement(candles: CandleData[], lookback = 10): DisplacementResult {
  const recent = candles.slice(-lookback);
  const avgBody = candles.slice(-50).reduce((s, c) => s + Math.abs(c.close - c.open), 0) / Math.min(50, candles.length);

  let bestStrength = 0;
  let bestDir: 'bullish' | 'bearish' | null = null;

  for (let i = 0; i < recent.length; i++) {
    const c = recent[i];
    const body = Math.abs(c.close - c.open);
    const totalRange = c.high - c.low;
    const wickRatio = totalRange > 0 ? body / totalRange : 0;

    if (body > avgBody * 2 && wickRatio > 0.65) {
      const strength = Math.min(Math.round((body / avgBody) * 25 + wickRatio * 50), 100);
      if (strength > bestStrength) { bestStrength = strength; bestDir = c.close > c.open ? 'bullish' : 'bearish'; }
    }
  }

  return { detected: bestStrength > 0, direction: bestDir, strength: bestStrength };
}

// =================== SPREAD CONFIG (local/legacy copy) ===================
const SPREAD_TABLE: Record<string, number> = {
  'EUR/USD': 0.00008, 'GBP/USD': 0.00012, 'AUD/USD': 0.00011, 'USD/JPY': 0.010,
  'GBP/JPY': 0.025, 'XAU/USD': 0.30, 'V10': 0.02, 'V25': 0.10, 'V50': 0.60,
  'V75': 2.50, 'V100': 1.20, 'BOOM1000': 0.60,
};
const DEFAULT_SPREAD = 0.0001;
function getSpread(instrument: string): number { return SPREAD_TABLE[instrument] ?? DEFAULT_SPREAD; }

const VOLATILITY_BANDS: Array<{ minPercentile: number; multiplier: number }> = [
  { minPercentile: 95, multiplier: 3.0 }, { minPercentile: 80, multiplier: 2.0 },
  { minPercentile: 50, multiplier: 1.4 }, { minPercentile: 0, multiplier: 1.0 },
];
function isVolatilityScaledInstrument(instrument: string): boolean { return /^(V\d+|BOOM|CRASH)/i.test(instrument); }
function getSpreadMultiplier(atrPercentile?: number | null): number {
  if (atrPercentile === null || atrPercentile === undefined || !isFinite(atrPercentile)) return 1;
  return VOLATILITY_BANDS.find(b => atrPercentile >= b.minPercentile)?.multiplier ?? 1;
}
function appliedSpreadMultiplier(instrument: string, atrPercentile?: number | null): number {
  return isVolatilityScaledInstrument(instrument) ? getSpreadMultiplier(atrPercentile) : 1;
}
function getVolatilityAdjustedSpread(instrument: string, atrPercentile?: number | null): number {
  return getSpread(instrument) * appliedSpreadMultiplier(instrument, atrPercentile);
}
function effectiveEntryWithSpread(direction: 'bullish' | 'bearish', entry: number, spread: number): number {
  return entry + (direction === 'bullish' ? spread / 2 : -spread / 2);
}

function computeAtrPercentile(candles: CandleData[], period = 14, lookback = 200): number | null {
  if (!candles || candles.length < period + 2) return null;
  const tr: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prevClose = candles[i - 1].close;
    tr.push(Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - prevClose), Math.abs(candles[i].low - prevClose)));
  }
  if (tr.length < period) return null;
  const atrs: number[] = [];
  let sum = 0;
  for (let i = 0; i < tr.length; i++) {
    sum += tr[i];
    if (i >= period) sum -= tr[i - period];
    if (i >= period - 1) atrs.push(sum / period);
  }
  if (atrs.length < 20) return null;
  const window = atrs.slice(-lookback);
  const current = window[window.length - 1];
  return (window.filter(v => v < current).length / window.length) * 100;
}

export interface ServerSignalOutput {
  instrument: string; direction: 'bullish' | 'bearish';
  entry_price: number; effective_entry: number; spread_applied: number;
  atr_percentile_at_entry: number | null; spread_multiplier_applied: number;
  stop_loss: number; take_profit_1: number; take_profit_2: number; take_profit_3: number;
  risk_reward_ratio: number; confidence: number; trade_type: 'swing'; setup_type: string;
  reasoning: string;
  confluence_breakdown: { label: string; value: string; weight: number; maxWeight: number; contributing: boolean }[];
  confluence_score_total: number; confluence_score_max: number;
}

/** Verbatim port of signal-engine's generateSignal(). See file header. */
export function generateServerSignal(
  instrument: string,
  dailyCandles: CandleData[],
  fourHourCandles: CandleData[],
  fifteenMinCandles: CandleData[],
  oneHourCandles: CandleData[],
  settings: { forex_min_rr: number; synthetic_min_rr: number; ignore_counter_trend: boolean },
): ServerSignalOutput | null {
  const isSynthetic = isSyntheticIndex(instrument);
  const closesDaily = dailyCandles.map(c => c.close);
  const closes4h = fourHourCandles.map(c => c.close);
  const closes1h = oneHourCandles.map(c => c.close);
  const synthProfile = getSynthProfile(instrument);

  const dailyStruct = analyzeStructure(dailyCandles);
  const fourHourStruct = analyzeStructure(fourHourCandles);
  const oneHourStruct = analyzeStructure(oneHourCandles);
  const dailyMAs = analyzeMovingAverages(closesDaily);
  const dailyRSI = calculateRSI(closesDaily);
  const fourHourRSI = calculateRSI(closes4h);
  const oneHourRSI = calculateRSI(closes1h);
  const dailyMACD = calculateMACD(closesDaily);
  const fourHourMACD = calculateMACD(closes4h);
  const oneHourMACD = calculateMACD(closes1h);
  const fourHourATR = calculateATR(fourHourCandles);
  const obs = findOrderBlocksLocal(fourHourCandles);
  const obs1h = findOrderBlocksLocal(oneHourCandles);
  const fvgs = findFVGs(fourHourCandles);
  const fvgs1h = findFVGs(oneHourCandles);
  const obv4h = calculateOBV(fourHourCandles);
  const obv1h = calculateOBV(oneHourCandles);
  const liqSweep4H = detectLiquiditySweep(fourHourCandles);
  const liqSweep1H = detectLiquiditySweep(oneHourCandles);
  const liqSweepDaily = detectLiquiditySweep(dailyCandles);

  const breakers4H = findBreakerBlocks(fourHourCandles);
  const breakersDaily = findBreakerBlocks(dailyCandles);
  const inducement4H = detectInducement(fourHourCandles);
  const inducementDaily = detectInducement(dailyCandles);
  const displacement4H = detectDisplacement(fourHourCandles);
  const displacementDaily = detectDisplacement(dailyCandles);
  const currentPrice = fourHourCandles[fourHourCandles.length - 1].close;
  const ces = findConsequentEncroachments(fvgs, currentPrice, fourHourATR);

  if (isSynthetic && detectSpike(fourHourCandles)) return null;

  let bullScore = 0, bearScore = 0;
  if (dailyStruct.trend === 'bullish') bullScore += 3;
  if (dailyStruct.trend === 'bearish') bearScore += 3;
  if (fourHourStruct.structure === 'HH_HL') bullScore += 3;
  if (fourHourStruct.structure === 'LH_LL') bearScore += 3;
  if (oneHourStruct.structure === 'HH_HL') bullScore += 2;
  if (oneHourStruct.structure === 'LH_LL') bearScore += 2;
  if (oneHourStruct.bos === 'bullish') bullScore += 2;
  if (oneHourStruct.bos === 'bearish') bearScore += 2;
  if (oneHourStruct.choch === 'bullish') bullScore += 2;
  if (oneHourStruct.choch === 'bearish') bearScore += 2;
  if (fourHourStruct.bos === 'bullish') bullScore += 3;
  if (fourHourStruct.bos === 'bearish') bearScore += 3;
  if (fourHourStruct.choch === 'bullish') bullScore += 2;
  if (fourHourStruct.choch === 'bearish') bearScore += 2;
  if (dailyStruct.choch === 'bullish') bullScore += 1;
  if (dailyStruct.choch === 'bearish') bearScore += 1;
  if (liqSweep4H.detected && liqSweep4H.direction === 'bullish') bearScore += 2;
  if (liqSweep4H.detected && liqSweep4H.direction === 'bearish') bullScore += 2;
  if (liqSweep1H.detected && liqSweep1H.direction === 'bullish') bearScore += 1;
  if (liqSweep1H.detected && liqSweep1H.direction === 'bearish') bullScore += 1;
  if (liqSweepDaily.detected && liqSweepDaily.direction === 'bullish') bearScore += 1;
  if (liqSweepDaily.detected && liqSweepDaily.direction === 'bearish') bullScore += 1;
  if (dailyMAs.trend === 'bullish') bullScore += 2;
  if (dailyMAs.trend === 'bearish') bearScore += 2;
  if (dailyMACD.signal === 'bullish') bullScore += 1;
  if (dailyMACD.signal === 'bearish') bearScore += 1;
  if (fourHourMACD.signal === 'bullish') bullScore += 1;
  if (fourHourMACD.signal === 'bearish') bearScore += 1;
  if (oneHourMACD.signal === 'bullish') bullScore += 1;
  if (oneHourMACD.signal === 'bearish') bearScore += 1;
  if (dailyRSI > 50) bullScore += 1; else bearScore += 1;
  if (fourHourRSI > 50) bullScore += 1; else bearScore += 1;
  if (oneHourRSI > 50) bullScore += 1; else bearScore += 1;

  const bullOBs = obs.filter(o => o.type === 'bullish' && !o.mitigated).length + obs1h.filter(o => o.type === 'bullish' && !o.mitigated).length;
  const bearOBs = obs.filter(o => o.type === 'bearish' && !o.mitigated).length + obs1h.filter(o => o.type === 'bearish' && !o.mitigated).length;
  if (bullOBs > bearOBs) bullScore += 1; else if (bearOBs > bullOBs) bearScore += 1;

  const bullFVGs = fvgs.filter(f => f.type === 'bullish').length + fvgs1h.filter(f => f.type === 'bullish').length;
  const bearFVGs = fvgs.filter(f => f.type === 'bearish').length + fvgs1h.filter(f => f.type === 'bearish').length;
  if (bullFVGs > bearFVGs) bullScore += 1; else if (bearFVGs > bullFVGs) bearScore += 1;

  if (obv4h.trend === 'bullish') bullScore += 1; else if (obv4h.trend === 'bearish') bearScore += 1;
  if (obv1h.trend === 'bullish') bullScore += 1; else if (obv1h.trend === 'bearish') bearScore += 1;
  if (obv4h.divergence === 'bullish_divergence') bullScore += 2;
  if (obv4h.divergence === 'bearish_divergence') bearScore += 2;
  if (obv1h.divergence === 'bullish_divergence') bullScore += 1;
  if (obv1h.divergence === 'bearish_divergence') bearScore += 1;

  const bullBreakers = breakers4H.filter(b => b.type === 'bullish' && b.qualityScore >= 40).length + breakersDaily.filter(b => b.type === 'bullish' && b.qualityScore >= 40).length;
  const bearBreakers = breakers4H.filter(b => b.type === 'bearish' && b.qualityScore >= 40).length + breakersDaily.filter(b => b.type === 'bearish' && b.qualityScore >= 40).length;
  if (bullBreakers > 0) bullScore += 2;
  if (bearBreakers > 0) bearScore += 2;

  if (inducement4H.detected && inducement4H.direction === 'bullish') bullScore += 1;
  if (inducement4H.detected && inducement4H.direction === 'bearish') bearScore += 1;
  if (inducementDaily.detected && inducementDaily.direction === 'bullish') bullScore += 1;
  if (inducementDaily.detected && inducementDaily.direction === 'bearish') bearScore += 1;

  if (displacement4H.detected && displacement4H.direction === 'bullish') bullScore += 1;
  if (displacement4H.detected && displacement4H.direction === 'bearish') bearScore += 1;
  if (displacementDaily.detected && displacementDaily.direction === 'bullish') bullScore += 1;
  if (displacementDaily.detected && displacementDaily.direction === 'bearish') bearScore += 1;

  const minDiff = synthProfile ? synthProfile.minScoreDifference : 3;
  const diff = Math.abs(bullScore - bearScore);
  if (diff < minDiff) return null;

  const direction: 'bullish' | 'bearish' = bullScore > bearScore ? 'bullish' : 'bearish';

  let pdResult: PremiumDiscountResult | null = null;
  if (fourHourStruct.trend !== 'ranging') {
    pdResult = analyzePremiumDiscount(fourHourStruct.lastHigh, fourHourStruct.lastLow, currentPrice, direction);
    if (pdResult.zoneAlignment) { if (direction === 'bullish') bullScore += 2; else bearScore += 2; }
  }

  const ceAligned = ces.some(ce => ce.fvgType === direction && ce.priceNearCE);
  if (ceAligned) { if (direction === 'bullish') bullScore += 1; else bearScore += 1; }

  if (settings.ignore_counter_trend) {
    if (direction === 'bullish' && dailyStruct.trend === 'bearish') return null;
    if (direction === 'bearish' && dailyStruct.trend === 'bullish') return null;
  }

  const hasBOS = fourHourStruct.bos === direction || dailyStruct.bos === direction || oneHourStruct.bos === direction;
  const hasCHoCH = fourHourStruct.choch === direction || dailyStruct.choch === direction || oneHourStruct.choch === direction;
  const sweepConfirms = direction === 'bearish' ? 'bullish' : 'bearish';
  const hasLiqSweep = (liqSweep4H.detected && liqSweep4H.direction === sweepConfirms) || (liqSweep1H.detected && liqSweep1H.direction === sweepConfirms) || (liqSweepDaily.detected && liqSweepDaily.direction === sweepConfirms);
  const hasStructAlign = fourHourStruct.trend === direction && dailyStruct.trend === direction;
  const has1HEarlyShift = (oneHourStruct.bos === direction || oneHourStruct.choch === direction) && fourHourStruct.trend !== direction;
  const hasDisplacement = (displacement4H.detected && displacement4H.direction === direction) || (displacementDaily.detected && displacementDaily.direction === direction);
  if (!hasBOS && !hasCHoCH && !hasLiqSweep && !hasStructAlign && !has1HEarlyShift && !hasDisplacement) return null;

  const hasOB = obs.some(o => o.type === direction && !o.mitigated) || obs1h.some(o => o.type === direction && !o.mitigated);
  const hasFVG = fvgs.some(f => f.type === direction) || fvgs1h.some(f => f.type === direction);
  const hasBreaker = breakers4H.some(b => b.type === direction && b.qualityScore >= 40) || breakersDaily.some(b => b.type === direction && b.qualityScore >= 40);
  if (!hasOB && !hasFVG && !hasBreaker) return null;

  if (!isSynthetic) {
    const recentRanges = fourHourCandles.slice(-20).map(c => c.high - c.low);
    const avgRange = recentRanges.reduce((s, v) => s + v, 0) / recentRanges.length;
    const lastRange = fourHourCandles[fourHourCandles.length - 1].high - fourHourCandles[fourHourCandles.length - 1].low;
    if (lastRange < avgRange * 0.8) return null;
  } else {
    const volExpMult = synthProfile ? synthProfile.volumeExpansionMult : 0.6;
    const recentRanges = fourHourCandles.slice(-20).map(c => c.high - c.low);
    const avgRange = recentRanges.reduce((s, v) => s + v, 0) / recentRanges.length;
    const recentAvg = fourHourCandles.slice(-3).reduce((s, c) => s + (c.high - c.low), 0) / 3;
    if (recentAvg < avgRange * volExpMult) return null;
  }

  let entry: number, stopLoss: number, tp1: number, tp2: number, tp3: number;
  const slMult = synthProfile ? synthProfile.slAtrMultiplier : 1.5;

  const atrPercentile = computeAtrPercentile(oneHourCandles, 14, 200);
  const spreadMultiplierApplied = appliedSpreadMultiplier(instrument, atrPercentile);
  const spreadApplied = getVolatilityAdjustedSpread(instrument, atrPercentile);

  const isSynth = synthProfile !== null && synthProfile !== undefined;
  const costFloorDist = isSynth ? spreadApplied * 8 : 0;
  const minStopDist = Math.max(isSynth ? fourHourATR * 1.0 : fourHourATR * 0.8, costFloorDist);
  const maxStopDist = Math.max(isSynth ? fourHourATR * slMult * 1.3 : fourHourATR * slMult * 2, minStopDist);
  const clampStopDistance = (dist: number) => Math.min(Math.max(dist, minStopDist), maxStopDist);

  if (direction === 'bullish') {
    const ob = obs.find(o => o.type === 'bullish' && !o.mitigated);
    const fvg = fvgs.find(f => f.type === 'bullish');
    const breaker = breakers4H.find(b => b.type === 'bullish' && b.qualityScore >= 40);
    entry = ob ? (ob.high + ob.low) / 2 : fvg ? (fvg.high + fvg.low) / 2 : breaker ? (breaker.high + breaker.low) / 2 : currentPrice - fourHourATR * 0.5;
    const rawStop = Math.min(fourHourStruct.lastLow - fourHourATR * 0.5, entry - fourHourATR * slMult);
    stopLoss = entry - clampStopDistance(entry - rawStop);
    const risk = entry - stopLoss;
    tp1 = entry + risk * 1.5; tp2 = entry + risk * 2.5; tp3 = entry + risk * 4;
  } else {
    const ob = obs.find(o => o.type === 'bearish' && !o.mitigated);
    const fvg = fvgs.find(f => f.type === 'bearish');
    const breaker = breakers4H.find(b => b.type === 'bearish' && b.qualityScore >= 40);
    entry = ob ? (ob.high + ob.low) / 2 : fvg ? (fvg.high + fvg.low) / 2 : breaker ? (breaker.high + breaker.low) / 2 : currentPrice + fourHourATR * 0.5;
    const rawStop = Math.max(fourHourStruct.lastHigh + fourHourATR * 0.5, entry + fourHourATR * slMult);
    stopLoss = entry + clampStopDistance(rawStop - entry);
    const risk = stopLoss - entry;
    tp1 = entry - risk * 1.5; tp2 = entry - risk * 2.5; tp3 = entry - risk * 4;
  }

  const effEntry = effectiveEntryWithSpread(direction, entry, spreadApplied);
  const risk = Math.abs(effEntry - stopLoss);
  const reward = Math.abs(tp2 - effEntry);
  const rr = risk > 0 ? reward / risk : 0;
  const minRR = isSynthetic ? settings.synthetic_min_rr : settings.forex_min_rr;
  if (rr < minRR) return null;

  // Confidence — the real shared module, exactly as production calls it.
  const swingScore = computeSwingConfidence(
    analyzeMarket(dailyCandles.slice(0, -1), fourHourCandles.slice(0, -1), oneHourCandles.slice(0, -1), instrument as TradingInstrument),
    direction,
  );
  const confidence = swingScore.confidence;
  const confluenceBreakdown = [...swingScore.items, { label: 'Risk/Reward (info, unscored)', value: `${rr.toFixed(2)}:1`, weight: 0, maxWeight: 0, contributing: false }];

  const setupType = fourHourStruct.bos ? 'breakout' : fourHourStruct.choch ? 'reversal' : fourHourStruct.trend === dailyStruct.trend ? 'trend_continuation' : 'reversal';
  const decimals = getDecimals(instrument);

  return {
    instrument, direction, entry_price: Number(entry.toFixed(decimals)),
    effective_entry: Number(effEntry.toFixed(decimals + 1)),
    spread_applied: spreadApplied,
    atr_percentile_at_entry: atrPercentile !== null ? Number(atrPercentile.toFixed(1)) : null,
    spread_multiplier_applied: spreadMultiplierApplied,
    stop_loss: Number(stopLoss.toFixed(decimals)),
    take_profit_1: Number(tp1.toFixed(decimals)), take_profit_2: Number(tp2.toFixed(decimals)), take_profit_3: Number(tp3.toFixed(decimals)),
    risk_reward_ratio: Number(rr.toFixed(2)),
    confidence, trade_type: 'swing', setup_type: setupType,
    reasoning: `[server-engine] bullScore=${bullScore} bearScore=${bearScore}`,
    confluence_breakdown: confluenceBreakdown,
    confluence_score_total: swingScore.total, confluence_score_max: swingScore.max,
  };
}
