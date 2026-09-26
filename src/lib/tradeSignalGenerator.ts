import { CandleData } from '@/hooks/useDerivAPI';
import {
  getVolatilityAdjustedSpread,
  appliedSpreadMultiplier,
  effectiveEntryWithSpread,
  computeAtrPercentile,
} from '@/lib/spreadConfig';

import {
  TradingInstrument,
  TradePlan,
  TrendDirection,
  ConfidenceLevel,
  SetupType,
  PriceLevel,
  isSyntheticIndex,
  getInstrumentDecimals,
} from '@/types/trading';
import {
  calculateRSI,
  calculateMACD,
  analyzeMovingAverages,
  calculateATR,
  calculateOBV,
  MACDResult,
  MAAnalysis,
  OBVResult,
} from './indicators';
import {
  analyzeMarketStructure,
  findOrderBlocks,
  findFairValueGaps,
  findLiquidityZones,
  detectLiquiditySweep,
  analyzeAsianSession,
  calculateFibonacciLevels,
  determineMarketPhase,
  generateKeyLevels,
  findSwingPoints,
  findBreakerBlocks,
  analyzePremiumDiscount,
  findConsequentEncroachments,
  detectInducement,
  detectDisplacement,
  MarketStructure,
  OrderBlock,
  FairValueGap,
  LiquidityZone,
  LiquiditySweepResult,
  BreakerBlock,
  PremiumDiscountResult,
  ConsequentEncroachment,
  InducementResult,
  DisplacementResult,
} from './smcAnalysis';
import { analyzePriceAction, PriceActionAnalysis } from './priceActionAnalysis';
import { getKillZoneStatus } from './sessionUtils';
import { getSyntheticProfile, SyntheticProfile } from './syntheticProfiles';

export { analyzeMarket } from '../../supabase/functions/_shared/analysis/marketAnalysis.ts';
export type { AnalysisResult } from '../../supabase/functions/_shared/analysis/marketAnalysis.ts';
import { computeSwingConfidence, SWING_CONFIDENCE_MAX } from '../../supabase/functions/_shared/analysis/swingConfidence.ts';
import { analyzeMarket } from '../../supabase/functions/_shared/analysis/marketAnalysis.ts';
import type { AnalysisResult } from '../../supabase/functions/_shared/analysis/marketAnalysis.ts';

// Swing confidence is computed ONLY by the shared canonical module (also used by the signal engine).

// Determine confidence level from score
const getConfidenceLevel = (score: number): ConfidenceLevel => {
  if (score >= 32) return 'excellent';
  if (score >= 24) return 'good';
  if (score >= 16) return 'marginal';
  return 'no_trade';
};

// Determine setup type
const getSetupType = (analysis: AnalysisResult, direction: TrendDirection): SetupType => {
  if (analysis.dailyStructure.structureBreak) return 'breakout';
  
  if (analysis.dailyStructure.trend === direction && analysis.fourHourStructure.trend === direction) {
    return 'trend_continuation';
  }
  
  if (analysis.dailyStructure.breakOfStructure) return 'reversal';
  
  return 'range';
};

// Determine trade direction using multi-timeframe confluence - properly balanced for BUY and SELL
interface DirectionResult {
  direction: TrendDirection;
  breakdown: import('@/types/trading').ConfidenceBreakdownItem[];
}

export const determineTradeDirection = (analysis: AnalysisResult): DirectionResult => {
  const items: { label: string; bull: number; bear: number; max: number; detail: string }[] = [];

  // Daily structure (weight: 3)
  let b = 0, s = 0;
  if (analysis.dailyStructure.structure === 'HH_HL') b = 3;
  if (analysis.dailyStructure.structure === 'LH_LL') s = 3;
  items.push({ label: 'Daily Structure', bull: b, bear: s, max: 3, detail: analysis.dailyStructure.structure || 'ranging' });

  // 4H structure (weight: 2)
  b = 0; s = 0;
  if (analysis.fourHourStructure.structure === 'HH_HL') b = 2;
  if (analysis.fourHourStructure.structure === 'LH_LL') s = 2;
  items.push({ label: '4H Structure', bull: b, bear: s, max: 2, detail: analysis.fourHourStructure.structure || 'ranging' });

  // 1H structure (weight: 1)
  b = 0; s = 0;
  if (analysis.oneHourStructure.structure === 'HH_HL') b = 1;
  if (analysis.oneHourStructure.structure === 'LH_LL') s = 1;
  items.push({ label: '1H Structure', bull: b, bear: s, max: 1, detail: analysis.oneHourStructure.structure || 'ranging' });

  // Daily trend (weight: 2)
  b = 0; s = 0;
  if (analysis.dailyStructure.trend === 'bullish') b = 2;
  if (analysis.dailyStructure.trend === 'bearish') s = 2;
  items.push({ label: 'Daily Trend', bull: b, bear: s, max: 2, detail: analysis.dailyStructure.trend });

  // Moving averages (weight: 2)
  b = 0; s = 0;
  if (analysis.dailyMAs.trend === 'bullish') b = 2;
  if (analysis.dailyMAs.trend === 'bearish') s = 2;
  items.push({ label: 'Moving Averages', bull: b, bear: s, max: 2, detail: analysis.dailyMAs.trend });

  // MACD Daily (weight: 1)
  b = 0; s = 0;
  if (analysis.dailyMACD.signal === 'bullish') b = 1;
  if (analysis.dailyMACD.signal === 'bearish') s = 1;
  items.push({ label: 'MACD Daily', bull: b, bear: s, max: 1, detail: analysis.dailyMACD.signal });

  // MACD 4H (weight: 1)
  b = 0; s = 0;
  if (analysis.fourHourMACD.signal === 'bullish') b = 1;
  if (analysis.fourHourMACD.signal === 'bearish') s = 1;
  items.push({ label: 'MACD 4H', bull: b, bear: s, max: 1, detail: analysis.fourHourMACD.signal });

  // MACD 1H (weight: 1)
  b = 0; s = 0;
  if (analysis.oneHourMACD.signal === 'bullish') b = 1;
  if (analysis.oneHourMACD.signal === 'bearish') s = 1;
  items.push({ label: 'MACD 1H', bull: b, bear: s, max: 1, detail: analysis.oneHourMACD.signal });

  // RSI Daily (weight: 1)
  b = 0; s = 0;
  if (analysis.dailyRSI > 50) b = 1;
  if (analysis.dailyRSI < 50) s = 1;
  items.push({ label: 'RSI Daily', bull: b, bear: s, max: 1, detail: analysis.dailyRSI.toFixed(1) });

  // RSI 4H (weight: 1)
  b = 0; s = 0;
  if (analysis.fourHourRSI > 50) b = 1;
  if (analysis.fourHourRSI < 50) s = 1;
  items.push({ label: 'RSI 4H', bull: b, bear: s, max: 1, detail: analysis.fourHourRSI.toFixed(1) });

  // Order Blocks (weight: 1)
  const bullishOBs = analysis.orderBlocks.filter(ob => ob.type === 'bullish' && !ob.mitigated).length;
  const bearishOBs = analysis.orderBlocks.filter(ob => ob.type === 'bearish' && !ob.mitigated).length;
  b = 0; s = 0;
  if (bullishOBs > bearishOBs) b = 1;
  if (bearishOBs > bullishOBs) s = 1;
  items.push({ label: 'Order Blocks', bull: b, bear: s, max: 1, detail: `${bullishOBs}B / ${bearishOBs}S` });

  // Fair Value Gaps (weight: 1)
  const bullishFVGs = analysis.fairValueGaps.filter(fvg => fvg.type === 'bullish').length;
  const bearishFVGs = analysis.fairValueGaps.filter(fvg => fvg.type === 'bearish').length;
  b = 0; s = 0;
  if (bullishFVGs > bearishFVGs) b = 1;
  if (bearishFVGs > bullishFVGs) s = 1;
  items.push({ label: 'Fair Value Gaps', bull: b, bear: s, max: 1, detail: `${bullishFVGs}B / ${bearishFVGs}S` });

  // Price Action Daily (weight: 2)
  b = 0; s = 0;
  if (analysis.dailyPriceAction.dominantSignal === 'bullish') b = 2;
  if (analysis.dailyPriceAction.dominantSignal === 'bearish') s = 2;
  items.push({ label: 'Price Action D', bull: b, bear: s, max: 2, detail: analysis.dailyPriceAction.dominantSignal });

  // Price Action 4H (weight: 1)
  b = 0; s = 0;
  if (analysis.priceAction.dominantSignal === 'bullish') b = 1;
  if (analysis.priceAction.dominantSignal === 'bearish') s = 1;
  items.push({ label: 'Price Action 4H', bull: b, bear: s, max: 1, detail: analysis.priceAction.dominantSignal });

  // Price Action 1H (weight: 1)
  b = 0; s = 0;
  if (analysis.oneHourPriceAction.dominantSignal === 'bullish') b = 1;
  if (analysis.oneHourPriceAction.dominantSignal === 'bearish') s = 1;
  items.push({ label: 'Price Action 1H', bull: b, bear: s, max: 1, detail: analysis.oneHourPriceAction.dominantSignal });

  // Break of Structure Daily (weight: 3)
  b = 0; s = 0;
  if (analysis.dailyStructure.breakOfStructure === 'bullish') b = 3;
  if (analysis.dailyStructure.breakOfStructure === 'bearish') s = 3;
  items.push({ label: 'BOS Daily', bull: b, bear: s, max: 3, detail: analysis.dailyStructure.breakOfStructure || 'none' });

  // Break of Structure 4H (weight: 2)
  b = 0; s = 0;
  if (analysis.fourHourStructure.breakOfStructure === 'bullish') b = 2;
  if (analysis.fourHourStructure.breakOfStructure === 'bearish') s = 2;
  items.push({ label: 'BOS 4H', bull: b, bear: s, max: 2, detail: analysis.fourHourStructure.breakOfStructure || 'none' });

  // Change of Character Daily (weight: 2)
  b = 0; s = 0;
  if (analysis.dailyStructure.changeOfCharacter === 'bullish') b = 2;
  if (analysis.dailyStructure.changeOfCharacter === 'bearish') s = 2;
  items.push({ label: 'CHoCH Daily', bull: b, bear: s, max: 2, detail: analysis.dailyStructure.changeOfCharacter || 'none' });

  // Change of Character 4H (weight: 2)
  b = 0; s = 0;
  if (analysis.fourHourStructure.changeOfCharacter === 'bullish') b = 2;
  if (analysis.fourHourStructure.changeOfCharacter === 'bearish') s = 2;
  items.push({ label: 'CHoCH 4H', bull: b, bear: s, max: 2, detail: analysis.fourHourStructure.changeOfCharacter || 'none' });

  // Liquidity Sweep 4H (weight: 2)
  // A bullish sweep = buy-side liquidity taken = bearish signal (price reverses down)
  // A bearish sweep = sell-side liquidity taken = bullish signal (price reverses up)
  b = 0; s = 0;
  if (analysis.liquiditySweep4H.detected && analysis.liquiditySweep4H.direction === 'bullish') s = 2;
  if (analysis.liquiditySweep4H.detected && analysis.liquiditySweep4H.direction === 'bearish') b = 2;
  items.push({ label: 'Liq Sweep 4H', bull: b, bear: s, max: 2, detail: analysis.liquiditySweep4H.detected ? `${analysis.liquiditySweep4H.direction} sweep` : 'none' });

  // Liquidity Sweep Daily (weight: 1)
  // Same inversion: bullish sweep confirms bearish, bearish sweep confirms bullish
  b = 0; s = 0;
  if (analysis.liquiditySweepDaily.detected && analysis.liquiditySweepDaily.direction === 'bullish') s = 1;
  if (analysis.liquiditySweepDaily.detected && analysis.liquiditySweepDaily.direction === 'bearish') b = 1;
  items.push({ label: 'Liq Sweep D', bull: b, bear: s, max: 1, detail: analysis.liquiditySweepDaily.detected ? `${analysis.liquiditySweepDaily.direction} sweep` : 'none' });

  // ===== NEW SMC GUIDE CONCEPTS =====
  
  // Breaker Blocks 4H (weight: 2) — Violated OBs that flipped polarity
  b = 0; s = 0;
  const bullBreakers = analysis.breakerBlocks4H.filter(bb => bb.type === 'bullish' && bb.qualityScore >= 40).length;
  const bearBreakers = analysis.breakerBlocks4H.filter(bb => bb.type === 'bearish' && bb.qualityScore >= 40).length;
  if (bullBreakers > 0) b = 2;
  if (bearBreakers > 0) s = 2;
  items.push({ label: 'Breaker Blocks', bull: b, bear: s, max: 2, detail: `${bullBreakers}B / ${bearBreakers}S` });

  // Premium/Discount Zone (weight: 2) — Buy in discount, sell in premium
  b = 0; s = 0;
  const pd = analysis.premiumDiscount4H;
  if (pd) {
    if (pd.currentZone === 'discount') b = 2; // Discount = bullish
    if (pd.currentZone === 'premium') s = 2; // Premium = bearish
    items.push({ label: 'Premium/Discount', bull: b, bear: s, max: 2, detail: pd.currentZone });
  } else {
    items.push({ label: 'Premium/Discount', bull: 0, bear: 0, max: 2, detail: 'N/A' });
  }

  // Inducement (weight: 2) — False breakouts confirming true direction
  b = 0; s = 0;
  if (analysis.inducement4H.detected && analysis.inducement4H.direction === 'bullish') b = 2;
  if (analysis.inducement4H.detected && analysis.inducement4H.direction === 'bearish') s = 2;
  items.push({ label: 'Inducement', bull: b, bear: s, max: 2, detail: analysis.inducement4H.detected ? `${analysis.inducement4H.type} → ${analysis.inducement4H.direction}` : 'none' });

  // Displacement (weight: 2) — Strong impulsive institutional move
  b = 0; s = 0;
  if (analysis.displacement4H.detected && analysis.displacement4H.direction === 'bullish') b = 2;
  if (analysis.displacement4H.detected && analysis.displacement4H.direction === 'bearish') s = 2;
  items.push({ label: 'Displacement', bull: b, bear: s, max: 2, detail: analysis.displacement4H.detected ? `${analysis.displacement4H.direction} (${analysis.displacement4H.strength}%)` : 'none' });

  // Consequent Encroachment (weight: 1) — Price near 50% of FVG
  b = 0; s = 0;
  const bullCE = analysis.consequentEncroachments.some(ce => ce.fvgType === 'bullish' && ce.priceNearCE);
  const bearCE = analysis.consequentEncroachments.some(ce => ce.fvgType === 'bearish' && ce.priceNearCE);
  if (bullCE) b = 1;
  if (bearCE) s = 1;
  items.push({ label: 'CE (FVG 50%)', bull: b, bear: s, max: 1, detail: bullCE || bearCE ? 'Price at CE' : 'none' });

  // OBV Daily (weight: 1)
  b = 0; s = 0;
  if (analysis.dailyOBV.trend === 'bullish') b = 1;
  if (analysis.dailyOBV.trend === 'bearish') s = 1;
  items.push({ label: 'OBV Daily', bull: b, bear: s, max: 1, detail: analysis.dailyOBV.trend });

  // OBV 4H (weight: 1)
  b = 0; s = 0;
  if (analysis.fourHourOBV.trend === 'bullish') b = 1;
  if (analysis.fourHourOBV.trend === 'bearish') s = 1;
  items.push({ label: 'OBV 4H', bull: b, bear: s, max: 1, detail: analysis.fourHourOBV.trend });

  // OBV Divergence (weight: 2)
  b = 0; s = 0;
  if (analysis.dailyOBV.divergence === 'bullish_divergence') b = 2;
  if (analysis.dailyOBV.divergence === 'bearish_divergence') s = 2;
  items.push({ label: 'OBV Divergence', bull: b, bear: s, max: 2, detail: analysis.dailyOBV.divergence || 'none' });

  // Calculate totals
  const bullishScore = items.reduce((sum, i) => sum + i.bull, 0);
  const bearishScore = items.reduce((sum, i) => sum + i.bear, 0);

  const difference = Math.abs(bullishScore - bearishScore);
  const minDifference = 3;

  const direction: TrendDirection = difference < minDifference
    ? 'ranging'
    : bullishScore > bearishScore ? 'bullish' : 'bearish';

  // Build breakdown for the winning direction
  const breakdown: import('@/types/trading').ConfidenceBreakdownItem[] = items.map(item => {
    const score = direction === 'bullish' ? item.bull : direction === 'bearish' ? item.bear : Math.max(item.bull, item.bear);
    return {
      label: item.label,
      value: item.detail,
      weight: score,
      maxWeight: item.max,
      contributing: score > 0,
    };
  });

  return { direction, breakdown };
};

// Generate day trade recommendation using 1H and 4H analysis
const generateDayTradeRecommendation = (
  analysis: AnalysisResult,
  swingDirection: TrendDirection,
  currentPrice: number,
  pip: number,
  sessionAnalysis: { asianHigh: number; asianLow: number; volatility: 'low' | 'medium' | 'high' },
  decimals: number,
  isSynth: boolean = false,
  instrumentForSpread: TradingInstrument = 'EUR/USD',
  atrPercentile: number | null = null,
  oneHourOrderBlocks: OrderBlock[] = [],
  oneHourFVGs: FairValueGap[] = [],
  /** Real-time tick. Day trades are market-price entries, so entry/stop/TPs are
   *  anchored to this, NOT to the closed-candle price used for structure. */
  livePrice: number | null = null


): import('@/types/trading').TradeRecommendation => {
  // Day trade direction based on 1H structure aligned with 4H
  let dayDirection: TrendDirection = analysis.oneHourStructure.trend;
  
  // If 1H is ranging, use 4H trend but with reduced confidence
  if (dayDirection === 'ranging') {
    dayDirection = analysis.fourHourStructure.trend;
  }
  
  // If still ranging, mark as ranging — don't guess from swing bias
  // This prevents false signals when there's no clear intraday direction

  // ===== HARD GATES (mirror of the swing gates, scaled to the 1H timeframe) =====
  // Applied AFTER dayDirection is resolved and BEFORE any scoring/risk geometry.
  let gateReason: string | null = null;

  // 1) Structural gate: 1H BOS/CHoCH matching direction, a 1H liquidity sweep in
  //    the confirming (opposite) direction, or 1H trend aligned with 4H trend.
  if (dayDirection !== 'ranging') {
    const hasBOS1H = analysis.oneHourStructure.breakOfStructure === dayDirection;
    const hasCHoCH1H = analysis.oneHourStructure.changeOfCharacter === dayDirection;
    const sweepConfirms = dayDirection === 'bearish' ? 'bullish' : 'bearish';
    const hasSweep = analysis.liquiditySweep4H.detected && analysis.liquiditySweep4H.direction === sweepConfirms;
    const tfAligned = analysis.oneHourStructure.trend === dayDirection &&
                      analysis.fourHourStructure.trend === dayDirection;

    if (!hasBOS1H && !hasCHoCH1H && !hasSweep && !tfAligned) {
      gateReason = `No 1H structural confirmation (BOS/CHoCH/sweep/1H-4H alignment) for ${dayDirection}`;
      dayDirection = 'ranging';
    }
  }

  // 2) Zone gate: an unmitigated OB or FVG of matching type, qualityScore >= 30,
  //    AND near current price (within 1x 1H ATR of the zone edge) — presence
  //    somewhere in the range is not enough.
  const zoneProximity = analysis.oneHourATR * 1.0;
  const nearZone = (low: number, high: number) =>
    currentPrice >= low - zoneProximity && currentPrice <= high + zoneProximity;
  const dayOBs = oneHourOrderBlocks.length ? oneHourOrderBlocks : analysis.orderBlocks;
  const dayFVGs = oneHourFVGs.length ? oneHourFVGs : analysis.fairValueGaps;

  const qualifyingOB = (dir: TrendDirection) =>
    dayOBs.find(ob => ob.type === dir && !ob.mitigated && ob.qualityScore >= 30 && nearZone(ob.low, ob.high)) ?? null;
  const qualifyingFVG = (dir: TrendDirection) =>
    dayFVGs.find(fvg => fvg.type === dir && fvg.qualityScore >= 30 && nearZone(fvg.low, fvg.high)) ?? null;

  if (dayDirection !== 'ranging') {
    if (!qualifyingOB(dayDirection) && !qualifyingFVG(dayDirection)) {
      gateReason = `No unmitigated 1H OB/FVG (quality >= 30) within 1x 1H ATR of price for ${dayDirection}`;
      dayDirection = 'ranging';
    }
  }


  if (gateReason) {
    console.log(`[day-trade gate] ${gateReason} — suppressing to ranging`);
    return {
      direction: 'ranging',
      confidence: 0,
      setupType: 'range',
      preferPendingOrder: false,
      tradeType: 'day',
      holdingPeriod: '—',
      reasoning: `Day trade suppressed: ${gateReason}. Wait for structural confirmation and a zone retest.`,
      risk: {
        entry: currentPrice,
        stopLoss: currentPrice,
        stopDistance: 0,
        riskPercent: 0,
        takeProfit1: currentPrice,
        takeProfit2: currentPrice,
        takeProfit3: currentPrice,
        trailingStopLogic: 'N/A',
        breakevenRule: 'N/A',
      },
      confidenceBreakdown: [],
    };
  }
  

  
  // Build day trade confidence breakdown
  const dayBreakdown: import('@/types/trading').ConfidenceBreakdownItem[] = [];

  // Day trade confluence score — 12 points, each component an INDEPENDENT read.
  // MACD alignment was removed: it restated the same directional 1H/4H trend
  // agreement already scored below (double counting one read).
  let dayScore = 0;

  // 1) 1H/4H structural alignment (3)
  const tfAlign = analysis.oneHourStructure.trend === analysis.fourHourStructure.trend ? 3 : 0;
  dayScore += tfAlign;
  dayBreakdown.push({ label: '1H/4H Alignment', value: `${analysis.oneHourStructure.trend}/${analysis.fourHourStructure.trend}`, weight: tfAlign, maxWeight: 3, contributing: tfAlign > 0 });

  // 2) Discrete 1H structural event, independent of the trend read (1)
  const bosCHoCH = analysis.oneHourStructure.breakOfStructure === dayDirection ||
                   analysis.oneHourStructure.changeOfCharacter === dayDirection;
  const sweepDir = dayDirection === 'bearish' ? 'bullish' : 'bearish';
  const sweepConfirm = analysis.liquiditySweep4H.detected && analysis.liquiditySweep4H.direction === sweepDir;
  const eventScore = (bosCHoCH || sweepConfirm) ? 1 : 0;
  dayScore += eventScore;
  dayBreakdown.push({ label: '1H Structural Event', value: bosCHoCH ? 'BOS/CHoCH' : sweepConfirm ? 'liquidity sweep' : 'none', weight: eventScore, maxWeight: 1, contributing: eventScore > 0 });

  // 3) 1H candlestick price action (2)
  const paMatch = analysis.oneHourPriceAction.dominantSignal === dayDirection ? 2 : 0;
  dayScore += paMatch;
  dayBreakdown.push({ label: '1H Price Action', value: analysis.oneHourPriceAction.dominantSignal, weight: paMatch, maxWeight: 2, contributing: paMatch > 0 });

  // 4) RSI in favorable zone (1 + 1)
  let rsi1HScore = 0, rsi4hScore = 0;
  if (dayDirection === 'bullish') {
    if (analysis.oneHourRSI > 40 && analysis.oneHourRSI < 70) rsi1HScore = 1;
    if (analysis.fourHourRSI > 40 && analysis.fourHourRSI < 70) rsi4hScore = 1;
  } else if (dayDirection === 'bearish') {
    if (analysis.oneHourRSI > 30 && analysis.oneHourRSI < 60) rsi1HScore = 1;
    if (analysis.fourHourRSI > 30 && analysis.fourHourRSI < 60) rsi4hScore = 1;
  }
  dayScore += rsi1HScore + rsi4hScore;
  dayBreakdown.push({ label: 'RSI 1H', value: analysis.oneHourRSI.toFixed(1), weight: rsi1HScore, maxWeight: 1, contributing: rsi1HScore > 0 });
  dayBreakdown.push({ label: 'RSI 4H', value: analysis.fourHourRSI.toFixed(1), weight: rsi4hScore, maxWeight: 1, contributing: rsi4hScore > 0 });

  // 5) Zone quality — same quality-score + proximity requirement as the entry
  //    gate (unmitigated, qualityScore >= 30, within 1x 1H ATR), not presence.
  const gateOB = dayDirection === 'ranging' ? null : qualifyingOB(dayDirection);
  const gateFVG = dayDirection === 'ranging' ? null : qualifyingFVG(dayDirection);
  const obScore = gateOB ? (gateOB.qualityScore >= 60 ? 2 : 1) : 0;
  dayScore += obScore;
  dayBreakdown.push({ label: '1H Order Block (quality + proximity)', value: gateOB ? `Q${Math.round(gateOB.qualityScore)} near price` : 'none qualifying', weight: obScore, maxWeight: 2, contributing: obScore > 0 });

  const fvgScore = gateFVG ? (gateFVG.qualityScore >= 60 ? 2 : 1) : 0;
  dayScore += fvgScore;
  dayBreakdown.push({ label: '1H FVG (quality + proximity)', value: gateFVG ? `Q${Math.round(gateFVG.qualityScore)} near price` : 'none qualifying', weight: fvgScore, maxWeight: 2, contributing: fvgScore > 0 });

  const dayConfidence = Math.min(Math.round((dayScore / 12) * 100), 95);

  
  // Use Asian session levels for day trade entries
  const asianRange = sessionAnalysis.asianHigh - sessionAnalysis.asianLow;
  
  let dayEntry: number;
  let dayStopLoss: number;
  let dayTp1: number, dayTp2: number, dayTp3: number;
  
  // ATR-scaled TP multipliers for day trades
  const dayAtr = analysis.oneHourATR;
  // Synthetics revert fast — keep the intraday ladder inside a realistic
  // 1H ATR reach instead of stretching to 4R.
  const atrTp1Mult = isSynth ? 1.0 : 1.5;
  const atrTp2Mult = isSynth ? 1.8 : 2.5;
  const atrTp3Mult = isSynth ? 2.8 : 4.0;
  
  // DAY TRADES: market execution — anchor entry to the LIVE tick, not the
  // closed-candle price (which can lag by up to one 4H bar). Structure/gates
  // above still use `currentPrice` (closed candle) for determinism.
  const execPrice = livePrice && livePrice > 0 ? livePrice : currentPrice;
  const entryDriftAtr = dayAtr > 0 ? Math.abs(execPrice - currentPrice) / dayAtr : 0;
  // Drift sanity check: > 0.5x 1H ATR means the structural read may itself be
  // outdated, so the setup is flagged stale instead of shown as "execute now".
  const entryStale = entryDriftAtr > 0.5;

  dayEntry = execPrice;

  // COST FLOOR (synthetics): a stop tighter than ~8x the volatility-adjusted
  // spread is eaten by transaction cost before the setup can resolve. Backtest
  // on V50 showed spread averaging 65% of risk (86% on day trades), which alone
  // turned a +0.31R zero-cost edge into -0.18R live.
  const daySpreadForFloor = getVolatilityAdjustedSpread(instrumentForSpread, atrPercentile);
  const dayMinStopDist = isSynth ? daySpreadForFloor * 8 : 0;

  if (dayDirection === 'bullish') {
    // SL below Asian low or ATR-based, whichever is tighter — measured from the
    // corrected live entry so R:R stays consistent.
    const asianStop = sessionAnalysis.asianLow - (dayAtr * 0.5);
    const atrStop = execPrice - (dayAtr * 1.5);
    dayStopLoss = Math.max(asianStop, atrStop); // Tighter stop
    if (dayEntry - dayStopLoss < dayMinStopDist) dayStopLoss = dayEntry - dayMinStopDist;
    
    const dayRisk = dayEntry - dayStopLoss;
    dayTp1 = dayEntry + (dayRisk * atrTp1Mult);
    dayTp2 = dayEntry + (dayRisk * atrTp2Mult);
    dayTp3 = dayEntry + (dayRisk * atrTp3Mult);
  } else {
    // SL above Asian high or ATR-based, whichever is tighter
    const asianStop = sessionAnalysis.asianHigh + (dayAtr * 0.5);
    const atrStop = execPrice + (dayAtr * 1.5);
    dayStopLoss = Math.min(asianStop, atrStop); // Tighter stop
    if (dayStopLoss - dayEntry < dayMinStopDist) dayStopLoss = dayEntry + dayMinStopDist;
    
    
    const dayRisk = dayStopLoss - dayEntry;
    dayTp1 = dayEntry - (dayRisk * atrTp1Mult);
    dayTp2 = dayEntry - (dayRisk * atrTp2Mult);
    dayTp3 = dayEntry - (dayRisk * atrTp3Mult);
  }
  
  // Spread-adjusted fill: day trades are market orders, so the fill is the
  // ask (buy) or bid (sell), not the mid quote shown on the chart.
  const dayDir: 'bullish' | 'bearish' = dayDirection === 'bearish' ? 'bearish' : 'bullish';
  // Volatility-scaled spread (synthetics only; forex keeps the static value).
  const daySpread = getVolatilityAdjustedSpread(instrumentForSpread, atrPercentile);
  const daySpreadMultiplier = appliedSpreadMultiplier(instrumentForSpread, atrPercentile);
  const dayEffectiveEntry = effectiveEntryWithSpread(dayDir, dayEntry, daySpread);
  // Risk/stop distance measured from the realistic fill.
  const dayStopDistance = Math.abs(dayEffectiveEntry - dayStopLoss) / pip;

  
  const setupType = analysis.oneHourStructure.structureBreak ? 'breakout' : 
    analysis.oneHourStructure.trend === analysis.fourHourStructure.trend ? 'trend_continuation' : 'range';
  
  return {
    direction: dayDirection,
    confidence: dayConfidence,
    setupType,
    preferPendingOrder: false,
    tradeType: 'day',
    holdingPeriod: '2-8 hours',
    livePriceUsed: execPrice,
    entryDriftAtr: Number(entryDriftAtr.toFixed(2)),
    entryStale,
    reasoning: entryStale
      ? `⚠ STALE ENTRY — live price ${execPrice.toFixed(decimals)} has drifted ${entryDriftAtr.toFixed(2)}x 1H ATR from the structural price ${currentPrice.toFixed(decimals)}. Re-analyze before executing; the 1H structural read may be outdated.`
      : `⚡ MARKET EXECUTION at ${execPrice.toFixed(decimals)} (live). Structure read at ${currentPrice.toFixed(decimals)}. 1H ${analysis.oneHourStructure.trend} structure. ${analysis.oneHourPriceAction.candlestickPatterns.length > 0 ? analysis.oneHourPriceAction.candlestickPatterns[0].name + ' pattern detected. ' : ''}Asian session ${sessionAnalysis.volatility} volatility.`,
    risk: {
      entry: dayEntry,
      effectiveEntry: dayEffectiveEntry,
      spreadApplied: daySpread,
      atrPercentile: atrPercentile ?? undefined,
      spreadMultiplier: daySpreadMultiplier,

      stopLoss: dayStopLoss,
      stopDistance: Math.round(dayStopDistance),
      riskPercent: 0.5,
      takeProfit1: dayTp1,
      takeProfit2: dayTp2,
      takeProfit3: dayTp3,
      trailingStopLogic: 'Trail 10 pips behind after TP1, close 50% at TP2',
      breakevenRule: 'Move to breakeven when price reaches TP1',
    },
    confidenceBreakdown: dayBreakdown,
  };
};

// Generate complete trade plan - Multi-timeframe analysis
export const generateTradePlan = (
  instrument: TradingInstrument,
  dailyCandles: CandleData[],
  fourHourCandles: CandleData[],
  oneHourCandles: CandleData[],
  currentPrice: number,
  /** Optional real-time tick. Used ONLY for day-trade entry/stop/target geometry. */
  livePrice: number | null = null
): TradePlan => {
  const syntheticProfile = getSyntheticProfile(instrument);
  const pip = isSyntheticIndex(instrument) ? 0.01 : (instrument === 'USD/JPY' || instrument === 'GBP/JPY' ? 0.01 : instrument === 'XAU/USD' ? 0.01 : 0.0001);
  
  // CRITICAL: Use only CLOSED candles (exclude the last/current incomplete candle)
  // This ensures deterministic results regardless of when analysis is run
  const closedDaily = dailyCandles.slice(0, -1);
  const closedFourHour = fourHourCandles.slice(0, -1);
  const closedFifteenMin = oneHourCandles.slice(0, -1);
  
  // Fallback if not enough closed candles
  const safeDaily = closedDaily.length >= 50 ? closedDaily : dailyCandles;
  const safeFourHour = closedFourHour.length >= 50 ? closedFourHour : fourHourCandles;
  const safeFifteenMin = closedFifteenMin.length >= 30 ? closedFifteenMin : oneHourCandles;
  
  const analysis = analyzeMarket(safeDaily, safeFourHour, safeFifteenMin, instrument);

  // Volatility regime: percentile rank of the current 1H ATR against its own
  // trailing 200-candle distribution. Reuses candles already fetched.
  const atrPercentile = computeAtrPercentile(safeFifteenMin, 14, 200);
  
  // Determine trade direction based on multi-timeframe confluence
  const { direction: directionResult, breakdown: directionBreakdown } = determineTradeDirection(analysis);
  let direction: TrendDirection = directionResult;
  
  // ===== STRICT STRUCTURAL GATE =====
  // At least one form of structural confirmation is REQUIRED before generating a directional signal.
  // Without BOS, CHoCH, or Liquidity Sweep, the signal is suppressed to 'ranging'.
  if (direction !== 'ranging') {
    const hasBOS = analysis.fourHourStructure.breakOfStructure === direction || analysis.dailyStructure.breakOfStructure === direction;
    const hasCHoCH = analysis.fourHourStructure.changeOfCharacter === direction || analysis.dailyStructure.changeOfCharacter === direction;
    // Sweep direction is opposite: bullish sweep (buy-side taken) confirms bearish, and vice versa
    const sweepConfirmsDirection = direction === 'bearish' ? 'bullish' : 'bearish';
    const hasLiqSweep = (analysis.liquiditySweep4H.detected && analysis.liquiditySweep4H.direction === sweepConfirmsDirection) ||
                        (analysis.liquiditySweepDaily.detected && analysis.liquiditySweepDaily.direction === sweepConfirmsDirection);
    const hasStructureAlignment = analysis.fourHourStructure.trend === direction && analysis.dailyStructure.trend === direction;
    
    if (!hasBOS && !hasCHoCH && !hasLiqSweep && !hasStructureAlignment) {
      console.log(`[${instrument}] No structural confirmation (BOS/CHoCH/Sweep/Alignment) for ${direction} — suppressing to ranging`);
      direction = 'ranging';
    }
  }
  
  // Require OB or FVG for entry validation
  if (direction !== 'ranging') {
    const hasOB = analysis.orderBlocks.some(ob => ob.type === direction && !ob.mitigated && ob.qualityScore >= 30);
    const hasFVG = analysis.fairValueGaps.some(fvg => fvg.type === direction && fvg.qualityScore >= 30);
    if (!hasOB && !hasFVG) {
      console.log(`[${instrument}] No valid OB or FVG for ${direction} entry — suppressing to ranging`);
      direction = 'ranging';
    }
  }
  
  const swingScore = direction === 'ranging'
    ? { confidence: 0, total: 0, max: SWING_CONFIDENCE_MAX, items: [] as ReturnType<typeof computeSwingConfidence>['items'],
        categories: { priceAction: 0, indicators: 0, multiTimeframe: 0, riskReward: 0, marketConditions: 0, smcConfluence: 0, structural: 0 } }
    : computeSwingConfidence(analysis, direction);
  const score = swingScore.total;
  const breakdown = swingScore.categories;
  const confidenceLevel = getConfidenceLevel(score);
  const setupType = getSetupType(analysis, direction);
  const marketPhase = determineMarketPhase(analysis.dailyStructure, dailyCandles);
  
  // Generate key levels
  const { support, resistance } = generateKeyLevels(dailyCandles, currentPrice, instrument);
  
  // Find swing points
  const dailySwings = findSwingPoints(dailyCandles, 5);
  const swingHighs = dailySwings.filter(s => s.type === 'high').map(s => s.price).slice(-3);
  const swingLows = dailySwings.filter(s => s.type === 'low').map(s => s.price).slice(-3);
  
  // Calculate entry, SL, and TPs based on direction
  let entry: number;
  let stopLoss: number;
  let tp1: number, tp2: number, tp3: number;
  
  // ATR-based dynamic stop loss distances (wider for volatile indices)
  const atrMultiplierSL = syntheticProfile ? syntheticProfile.slAtrMultiplier : 2.5;
  const atr4H = analysis.fourHourATR;

  // ---- Synthetic-aware risk geometry ----------------------------------------
  // Synthetics (esp. V25) sweep structural lows/highs constantly. A structure
  // stop taken verbatim produces an over-wide stop, and because targets were
  // pure R-multiples of that stop, TP1 sat far beyond the index's typical
  // 3-10h trend leg — so price mean-reverted into the stop before any target.
  // Fix: clamp the stop to an ATR band and anchor targets to ATR reach.
  const isSynth = syntheticProfile !== null;
  // Cost floor: never let a synthetic stop sit closer than 8x the
  // volatility-adjusted spread — below that, spread dominates the R geometry.
  const costFloorDist = isSynth ? getVolatilityAdjustedSpread(instrument, atrPercentile) * 8 : 0;
  const minStopDist = Math.max(isSynth ? atr4H * 1.0 : atr4H * 0.8, costFloorDist);
  const maxStopDist = Math.max(
    isSynth ? atr4H * atrMultiplierSL * 1.3 : atr4H * atrMultiplierSL * 2,
    minStopDist
  );
  const clampStopDistance = (dist: number) => Math.min(Math.max(dist, minStopDist), maxStopDist);
  // Target ladder: synthetics use a shorter, ATR-reachable ladder
  const tpAtr = syntheticProfile ? syntheticProfile.tpAtrMultiplier : 1;
  const rMults: [number, number, number] = isSynth ? [1.2, 2.0, 3.0] : [2, 3.5, 5.5];
  const atrReach: [number, number, number] = [atr4H * tpAtr * 1.0, atr4H * tpAtr * 2.0, atr4H * tpAtr * 3.2];
  const targetOffsets = (risk: number): [number, number, number] =>
    isSynth
      ? [
          Math.min(risk * rMults[0], atrReach[0]),
          Math.min(risk * rMults[1], atrReach[1]),
          Math.min(risk * rMults[2], atrReach[2]),
        ]
      : [risk * rMults[0], risk * rMults[1], risk * rMults[2]];
  
  // Helper: check if price is inside a zone
  const isPriceInZone = (price: number, low: number, high: number, buffer: number = 0): boolean => {
    return price >= (low - buffer) && price <= (high + buffer);
  };
  
  // Check if current price is already inside an OB or FVG zone
  let priceInActiveZone = false;
  let activeZoneEntry: number | null = null;
  
  if (direction === 'bullish') {
    const bullishOB = analysis.orderBlocks
      .filter(ob => ob.type === 'bullish' && !ob.mitigated)
      .sort((a, b) => b.qualityScore - a.qualityScore)[0];
    const bullishFVG = analysis.fairValueGaps
      .filter(fvg => fvg.type === 'bullish')
      .sort((a, b) => b.qualityScore - a.qualityScore)[0];
    
    const atrBuffer = atr4H * 0.3;
    
    if (bullishOB && isPriceInZone(currentPrice, bullishOB.low, bullishOB.high, atrBuffer)) {
      priceInActiveZone = true;
      activeZoneEntry = currentPrice;
    } else if (bullishFVG && isPriceInZone(currentPrice, bullishFVG.low, bullishFVG.high, atrBuffer)) {
      priceInActiveZone = true;
      activeZoneEntry = currentPrice;
    }
    
    // Pending order entry (fallback)
    const pendingEntry = bullishOB ? (bullishOB.high + bullishOB.low) / 2 :
            bullishFVG ? (bullishFVG.high + bullishFVG.low) / 2 :
            currentPrice - (atr4H * 0.5);
    
    // Reject stale zones sitting more than 1.5 ATR away — by the time price
    // travels that far the structure that created the zone is usually gone.
    const maxEntryDistance = atr4H * 1.5;
    entry = (currentPrice - pendingEntry) > maxEntryDistance
      ? currentPrice - maxEntryDistance
      : pendingEntry;
    
    const atrStop = entry - (atr4H * atrMultiplierSL);
    const structureStop = analysis.fourHourStructure.lastSwingLow - (atr4H * 0.5);
    const rawStop = Math.min(atrStop, structureStop);
    stopLoss = entry - clampStopDistance(entry - rawStop);

    const risk = Math.abs(entry - stopLoss);
    const [o1, o2, o3] = targetOffsets(risk);
    tp1 = entry + o1;
    tp2 = entry + o2;
    tp3 = entry + o3;
  } else {
    const bearishOB = analysis.orderBlocks
      .filter(ob => ob.type === 'bearish' && !ob.mitigated)
      .sort((a, b) => b.qualityScore - a.qualityScore)[0];
    const bearishFVG = analysis.fairValueGaps
      .filter(fvg => fvg.type === 'bearish')
      .sort((a, b) => b.qualityScore - a.qualityScore)[0];
    
    const atrBuffer = atr4H * 0.3;
    
    if (bearishOB && isPriceInZone(currentPrice, bearishOB.low, bearishOB.high, atrBuffer)) {
      priceInActiveZone = true;
      activeZoneEntry = currentPrice;
    } else if (bearishFVG && isPriceInZone(currentPrice, bearishFVG.low, bearishFVG.high, atrBuffer)) {
      priceInActiveZone = true;
      activeZoneEntry = currentPrice;
    }
    
    const pendingEntry = bearishOB ? (bearishOB.high + bearishOB.low) / 2 :
            bearishFVG ? (bearishFVG.high + bearishFVG.low) / 2 :
            currentPrice + (atr4H * 0.5);
    
    const maxEntryDistance = atr4H * 1.5;
    entry = (pendingEntry - currentPrice) > maxEntryDistance
      ? currentPrice + maxEntryDistance
      : pendingEntry;
    
    const atrStop = entry + (atr4H * atrMultiplierSL);
    const structureStop = analysis.fourHourStructure.lastSwingHigh + (atr4H * 0.5);
    const rawStop = Math.max(atrStop, structureStop);
    stopLoss = entry + clampStopDistance(rawStop - entry);

    const risk = Math.abs(stopLoss - entry);
    const [o1, o2, o3] = targetOffsets(risk);
    tp1 = entry - o1;
    tp2 = entry - o2;
    tp3 = entry - o3;
  }
  
  // INSTANT EXECUTION LOGIC for swing trades:
  // If price is in the active OB/FVG zone AND confidence is high (≥65%), use market execution
  const swingConfidence = swingScore.confidence;
  const useInstantExecution = priceInActiveZone && swingConfidence >= 100;
  
  if (useInstantExecution && activeZoneEntry !== null) {
    entry = activeZoneEntry;
    // Recalculate TPs from new entry
    if (direction === 'bullish') {
      const risk = Math.abs(entry - stopLoss);
      const [o1, o2, o3] = targetOffsets(risk);
      tp1 = entry + o1;
      tp2 = entry + o2;
      tp3 = entry + o3;
    } else {
      const risk = Math.abs(stopLoss - entry);
      const [o1, o2, o3] = targetOffsets(risk);
      tp1 = entry - o1;
      tp2 = entry - o2;
      tp3 = entry - o3;
    }
  }
  
  // Spread-adjusted fill (symmetric half-spread convention — see spreadConfig.ts)
  const swingDir: 'bullish' | 'bearish' = direction === 'bearish' ? 'bearish' : 'bullish';
  const swingSpread = getVolatilityAdjustedSpread(instrument, atrPercentile);
  const swingSpreadMultiplier = appliedSpreadMultiplier(instrument, atrPercentile);
  const swingEffectiveEntry = effectiveEntryWithSpread(swingDir, entry, swingSpread);
  // Stop distance measured from the realistic fill, not the theoretical entry.
  const stopDistance = Math.abs(swingEffectiveEntry - stopLoss) / pip;

  
  // Session analysis
  const sessionAnalysis = analyzeAsianSession(fourHourCandles, currentPrice);
  
  // Generate Fibonacci levels
  const fibLevels = calculateFibonacciLevels(
    analysis.fourHourStructure.lastSwingHigh,
    analysis.fourHourStructure.lastSwingLow,
    direction === 'bullish' ? 'bullish' : 'bearish'
  );
  
  // Build patterns and trendlines descriptions - now includes price action patterns
  const patterns: string[] = [];
  if (analysis.dailyStructure.structure === 'HH_HL') patterns.push('Higher Highs & Higher Lows forming');
  if (analysis.dailyStructure.structure === 'LH_LL') patterns.push('Lower Highs & Lower Lows forming');
  if (analysis.orderBlocks.filter(ob => !ob.mitigated).length > 0) {
    patterns.push(`${analysis.orderBlocks.filter(ob => !ob.mitigated).length} unmitigated order blocks`);
  }
  if (analysis.fairValueGaps.length > 0) {
    patterns.push(`${analysis.fairValueGaps.length} unfilled fair value gaps`);
  }
  // Add detected chart patterns
  analysis.priceAction.chartPatterns.forEach(cp => {
    patterns.push(cp.name);
  });
  
  // Round numbers
  const roundNumbers = [
    Math.floor(currentPrice * 100) / 100,
    Math.ceil(currentPrice * 100) / 100,
  ];
  
  // Candlestick analysis
  const lastDailyCandle = dailyCandles[dailyCandles.length - 1];
  const candleType = lastDailyCandle.close > lastDailyCandle.open ? 
    (lastDailyCandle.close - lastDailyCandle.open > (lastDailyCandle.high - lastDailyCandle.low) * 0.6 ? 'Strong Bullish' : 'Bullish') :
    (lastDailyCandle.open - lastDailyCandle.close > (lastDailyCandle.high - lastDailyCandle.low) * 0.6 ? 'Strong Bearish' : 'Bearish');
  
  const decimals = getInstrumentDecimals(instrument);
  
  // Key levels for table
  const keyLevels: PriceLevel[] = [
    ...resistance.slice(0, 3),
    { price: tp3, type: 'take_profit' as const, description: 'TP3 - Extended target', strength: 'strong' as const },
    { price: tp2, type: 'take_profit' as const, description: 'TP2 - Main target', strength: 'strong' as const },
    { price: tp1, type: 'take_profit' as const, description: 'TP1 - Conservative target', strength: 'moderate' as const },
    { price: entry, type: 'entry' as const, description: useInstantExecution ? `⚡ Market ${direction === 'bullish' ? 'buy' : 'sell'} (instant)` : `${direction === 'bullish' ? 'Buy' : 'Sell'} limit entry`, strength: 'strong' as const },
    { price: stopLoss, type: 'stop_loss' as const, description: 'Stop loss', strength: 'strong' as const },
    ...support.slice(0, 3),
  ].sort((a, b) => b.price - a.price);
  
  return {
    pair: instrument,
    timestamp: new Date(),
    currentPrice,
    sessionReview: {
      asianSummary: `${instrument} ${sessionAnalysis.volatility} volatility during Asian session. Price currently ${sessionAnalysis.priceRelativeToAsian} Asian range (${sessionAnalysis.asianHigh.toFixed(decimals)} - ${sessionAnalysis.asianLow.toFixed(decimals)}).`,
      keyLevelsTested: [
        `Asian High: ${sessionAnalysis.asianHigh.toFixed(decimals)}`,
        `Asian Low: ${sessionAnalysis.asianLow.toFixed(decimals)}`,
        ...(analysis.orderBlocks.slice(0, 2).map(ob => `${ob.type} OB: ${ob.low.toFixed(decimals)}-${ob.high.toFixed(decimals)}`)),
      ],
      volatility: sessionAnalysis.volatility,
      newsImpact: null,
      relativeToYesterdayClose: currentPrice > dailyCandles[dailyCandles.length - 2]?.close ? 'above' : 'below',
    },
    dailyAnalysis: {
      trend: analysis.dailyStructure.trend,
      swingHighs,
      swingLows,
      marketPhase,
      resistanceLevels: resistance,
      supportLevels: support,
      roundNumbers,
      patterns,
      trendlines: [
        `Market structure: ${analysis.dailyStructure.structure}`,
        analysis.dailyStructure.structureBreak ? `Break of structure detected (${analysis.dailyStructure.breakOfStructure})` : 'Structure intact',
      ],
    },
    fourHourAnalysis: {
      alignmentWithDaily: analysis.dailyStructure.trend === analysis.fourHourStructure.trend,
      structure: analysis.fourHourStructure.structure,
      pullbackZones: analysis.orderBlocks.filter(ob => !ob.mitigated).map(ob => (ob.high + ob.low) / 2),
      supplyDemandZones: analysis.orderBlocks.map(ob => ({
        type: ob.type === 'bullish' ? 'demand' as const : 'supply' as const,
        low: ob.low,
        high: ob.high,
      })),
      fibLevels,
    },
    indicators: {
      dailyRSI: {
        value: Math.round(analysis.dailyRSI),
        status: analysis.dailyRSI > 70 ? 'overbought' : analysis.dailyRSI < 30 ? 'oversold' : 'neutral',
      },
      dailyMACD: {
        histogram: analysis.dailyMACD.histogram,
        signal: analysis.dailyMACD.signal,
      },
      movingAverages: analysis.dailyMAs,
      fourHourRSI: {
        value: Math.round(analysis.fourHourRSI),
        status: analysis.fourHourRSI > 70 ? 'overbought' : analysis.fourHourRSI < 30 ? 'oversold' : 'neutral',
      },
    },
    candlesticks: {
      dailyCandle: {
        type: analysis.priceAction.candlestickPatterns.length > 0 
          ? analysis.priceAction.candlestickPatterns[0].name 
          : candleType,
        interpretation: analysis.priceAction.candlestickPatterns.length > 0
          ? analysis.priceAction.candlestickPatterns[0].description
          : `${candleType} candle showing ${direction === 'bullish' ? 'buying' : 'selling'} pressure${analysis.dailyStructure.structureBreak ? ' with structure break' : ''}`,
      },
      patterns: analysis.priceAction.candlestickPatterns.length > 0
        ? analysis.priceAction.candlestickPatterns.map(p => p.name)
        : (analysis.fairValueGaps.length > 0 ? [`FVG at ${analysis.fairValueGaps[0].low.toFixed(decimals)}-${analysis.fairValueGaps[0].high.toFixed(decimals)}`] : ['No significant patterns']),
      microStructure: `4H: ${analysis.fourHourStructure.structure} structure. ${analysis.priceAction.summary}`,
    },
    londonSession: {
      bullScenario: {
        trigger: `Break above ${sessionAnalysis.asianHigh.toFixed(decimals)} with momentum`,
        target: sessionAnalysis.asianHigh + (analysis.fourHourATR * 2),
        probability: direction === 'bullish' ? 65 : 35,
      },
      bearScenario: {
        trigger: `Break below ${sessionAnalysis.asianLow.toFixed(decimals)} with momentum`,
        target: sessionAnalysis.asianLow - (analysis.fourHourATR * 2),
        probability: direction === 'bearish' ? 65 : 35,
      },
      rangeScenario: {
        condition: 'No clear catalyst, low volatility expected',
        range: { low: sessionAnalysis.asianLow, high: sessionAnalysis.asianHigh },
      },
      invalidation: direction === 'bullish' ? analysis.fourHourStructure.lastSwingLow : analysis.fourHourStructure.lastSwingHigh,
    },
    londonNYOverlap: {
      probableDirection: direction,
      stopHuntZones: analysis.liquidityZones.slice(0, 2).map(lz => lz.price),
    },
    recommendation: {
      direction,
      confidence: swingConfidence,
      setupType,
      preferPendingOrder: !useInstantExecution,
      tradeType: 'swing',
      holdingPeriod: syntheticProfile ? `${syntheticProfile.trendDurationHours[0]}-${syntheticProfile.trendDurationHours[1]} hours` : '2-5 days',
      reasoning: `${useInstantExecution ? '⚡ INSTANT EXECUTION — Price is inside active zone with high confluence. ' : ''}${syntheticProfile ? `[${syntheticProfile.name}] Structure clarity: ${syntheticProfile.structureClarity}/5. ` : ''}Daily ${analysis.dailyStructure.trend} trend with ${analysis.fourHourStructure.structure} structure on 4H.${analysis.fourHourStructure.breakOfStructure ? ` ${analysis.fourHourStructure.breakOfStructure} BOS confirmed.` : ''}${analysis.fourHourStructure.changeOfCharacter ? ` ${analysis.fourHourStructure.changeOfCharacter} CHoCH detected.` : ''}${analysis.liquiditySweep4H.detected ? ` Liquidity sweep (${analysis.liquiditySweep4H.direction}) confirmed.` : ''}${analysis.breakerBlocks4H.some(bb => bb.type === direction && bb.qualityScore >= 40) ? ` Breaker block (${direction}) active.` : ''}${analysis.premiumDiscount4H?.zoneAlignment ? ` Price in ${analysis.premiumDiscount4H.currentZone} zone (aligned).` : ''}${analysis.inducement4H.detected && analysis.inducement4H.direction === direction ? ` Inducement (${analysis.inducement4H.type}) confirms ${direction}.` : ''}${analysis.displacement4H.detected && analysis.displacement4H.direction === direction ? ` Displacement confirmed (${analysis.displacement4H.strength}%).` : ''}${syntheticProfile?.consolidationBeforeBreakout ? ' Watching for consolidation-before-breakout signature.' : ''}${syntheticProfile?.meanReversionAtExtremes ? ' Mean reversion tendency active at extremes.' : ''} ATR-based dynamic SL at ${atrMultiplierSL}x ATR (${atr4H.toFixed(decimals)}). ${analysis.orderBlocks.filter(ob => !ob.mitigated).length} unmitigated OBs${analysis.orderBlocks.some(ob => ob.qualityScore >= 70) ? ' (high quality)' : ''}.`,
      confidenceBreakdown: swingScore.items,
      risk: {
        entry,
        effectiveEntry: swingEffectiveEntry,
        spreadApplied: swingSpread,
        atrPercentile: atrPercentile ?? undefined,
        spreadMultiplier: swingSpreadMultiplier,

        stopLoss,
        stopDistance: Math.round(stopDistance),
        riskPercent: 1,
        takeProfit1: tp1,
        takeProfit2: tp2,
        takeProfit3: tp3,
        trailingStopLogic: 'Move SL to breakeven at TP1, trail 30 pips behind price after TP2',
        breakevenRule: 'Move to breakeven + 5 pips when price reaches TP1',
      },
    },
    dayTradeRecommendation: (() => {
      const dayRec = generateDayTradeRecommendation(analysis, direction, currentPrice, pip, sessionAnalysis, decimals, syntheticProfile !== null, instrument, atrPercentile, findOrderBlocks(safeFifteenMin, '1H'), findFairValueGaps(safeFifteenMin, '1H'), livePrice);
      // CONFLICT PREVENTION: If day trade direction opposes swing direction, suppress the day trade signal
      if (direction !== 'ranging' && dayRec.direction !== 'ranging' && dayRec.direction !== direction) {
        return {
          ...dayRec,
          direction: 'ranging' as TrendDirection,
          confidence: 0,
          reasoning: `Day trade signal suppressed: 1H structure (${dayRec.direction}) conflicts with swing bias (${direction}). Wait for alignment.`,
        };
      }
      // KILL ZONE FILTER: For forex instruments, suppress day trades outside kill zones
      if (!isSyntheticIndex(instrument)) {
        const kzStatus = getKillZoneStatus();
        if (!kzStatus.isInKillZone) {
          return {
            ...dayRec,
            direction: 'ranging' as TrendDirection,
            confidence: 0,
            reasoning: `Day trade signal suppressed: Outside kill zone. ${kzStatus.upcoming ? `Next: ${kzStatus.upcoming.name} in ${kzStatus.minutesUntilNext}min.` : ''} Wait for London (07-09 UTC) or NY (12-14 UTC) kill zone.`,
          };
        }
      }
      return dayRec;
    })(),
    confluenceScore: {
      priceAction: breakdown.priceAction,
      indicators: breakdown.indicators,
      multiTimeframe: breakdown.multiTimeframe,
      riskReward: breakdown.riskReward,
      marketConditions: breakdown.marketConditions,
      smcConfluence: breakdown.smcConfluence + breakdown.structural,
      total: score,
      level: confidenceLevel,
    },
    alternativeScenarios: {
      planB: direction === 'bullish' 
        ? `If price breaks below ${analysis.fourHourStructure.lastSwingLow.toFixed(decimals)}, wait for bearish confirmation before shorting`
        : `If price breaks above ${analysis.fourHourStructure.lastSwingHigh.toFixed(decimals)}, wait for bullish confirmation before going long`,
      biasFlipCondition: direction === 'bullish'
        ? `Daily close below ${analysis.fourHourStructure.lastSwingLow.toFixed(decimals)} would flip bias to bearish`
        : `Daily close above ${analysis.fourHourStructure.lastSwingHigh.toFixed(decimals)} would flip bias to bullish`,
      warningSignals: [
        'Unexpected central bank commentary',
        `Break of 4H ${direction === 'bullish' ? 'swing low' : 'swing high'}`,
        'RSI divergence on momentum push',
        analysis.dailyRSI > 65 ? 'RSI approaching overbought' : analysis.dailyRSI < 35 ? 'RSI approaching oversold' : 'Monitor RSI for extremes',
      ],
    },
    executionPlan: {
      preLondonChecklist: [
        `Confirm Asian range: ${sessionAnalysis.asianLow.toFixed(decimals)} - ${sessionAnalysis.asianHigh.toFixed(decimals)}`,
        'Check economic calendar for London session news',
        'Verify no overnight news impact',
        useInstantExecution 
          ? `⚡ Execute ${direction === 'bullish' ? 'BUY' : 'SELL'} now at market price ${entry.toFixed(decimals)}`
          : `Set ${direction === 'bullish' ? 'buy' : 'sell'} limit at ${entry.toFixed(decimals)}`,
      ],
      londonOpenLogic: direction === 'bullish'
        ? `Wait for price to sweep Asian low then reclaim. Entry at order block/FVG. Target Asian high + extension.`
        : `Wait for price to sweep Asian high then reject. Entry at order block/FVG. Target Asian low - extension.`,
      endOfDayReview: [
        'Check if targets were hit',
        'Adjust trailing stop if applicable',
        'Note any pattern changes for tomorrow',
        'Update trade journal with SMC observations',
      ],
    },
    keyLevels,
    criticalInvalidation: direction === 'bullish' ? analysis.dailyStructure.lastSwingLow : analysis.dailyStructure.lastSwingHigh,
    atr4H: analysis.fourHourATR,
  };
};
