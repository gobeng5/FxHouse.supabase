/**
 * Canonical multi-timeframe market analysis (Daily / 4H / 1H).
 * Shared verbatim by the web app and the signal engine.
 */
import type { CandleData, TradingInstrument } from './core.ts';
import { calculateRSI, calculateMACD, analyzeMovingAverages, calculateATR, calculateOBV } from './indicators.ts';
import type { MACDResult, MAAnalysis, OBVResult } from './indicators.ts';
import {
  analyzeMarketStructure, findOrderBlocks, findFairValueGaps, findLiquidityZones, detectLiquiditySweep,
  findBreakerBlocks, analyzePremiumDiscount, findConsequentEncroachments, detectInducement, detectDisplacement,
} from './smcAnalysis.ts';
import type {
  MarketStructure, OrderBlock, FairValueGap, LiquidityZone, LiquiditySweepResult, BreakerBlock,
  PremiumDiscountResult, ConsequentEncroachment, InducementResult, DisplacementResult,
} from './smcAnalysis.ts';
import { analyzePriceAction } from './priceActionAnalysis.ts';
import type { PriceActionAnalysis } from './priceActionAnalysis.ts';

export interface AnalysisResult {
  dailyStructure: MarketStructure;
  fourHourStructure: MarketStructure;
  oneHourStructure: MarketStructure;
  dailyRSI: number;
  fourHourRSI: number;
  oneHourRSI: number;
  dailyMACD: MACDResult;
  fourHourMACD: MACDResult;
  oneHourMACD: MACDResult;
  dailyMAs: MAAnalysis;
  dailyATR: number;
  fourHourATR: number;
  oneHourATR: number;
  orderBlocks: OrderBlock[];
  fairValueGaps: FairValueGap[];
  liquidityZones: LiquidityZone[];
  liquiditySweep4H: LiquiditySweepResult;
  liquiditySweepDaily: LiquiditySweepResult;
  priceAction: PriceActionAnalysis;
  dailyPriceAction: PriceActionAnalysis;
  oneHourPriceAction: PriceActionAnalysis;
  dailyOBV: OBVResult;
  fourHourOBV: OBVResult;
  // New SMC concepts from guide
  breakerBlocks4H: BreakerBlock[];
  breakerBlocksDaily: BreakerBlock[];
  premiumDiscount4H: PremiumDiscountResult | null;
  premiumDiscountDaily: PremiumDiscountResult | null;
  consequentEncroachments: ConsequentEncroachment[];
  inducement4H: InducementResult;
  inducementDaily: InducementResult;
  displacement4H: DisplacementResult;
  displacementDaily: DisplacementResult;
}

// Main analysis function - Multi-timeframe (Daily, 4H, 1H)
export const analyzeMarket = (
  dailyCandles: CandleData[],
  fourHourCandles: CandleData[],
  oneHourCandles: CandleData[],
  instrument: TradingInstrument
): AnalysisResult => {
  const dailyCloses = dailyCandles.map(c => c.close);
  const fourHourCloses = fourHourCandles.map(c => c.close);
  const oneHourCloses = oneHourCandles.map(c => c.close);
  
  const dailyStructure = analyzeMarketStructure(dailyCandles);
  const fourHourStructure = analyzeMarketStructure(fourHourCandles);
  const fourHourATR = calculateATR(fourHourCandles, 14);
  const fvgs = findFairValueGaps(fourHourCandles);
  const currentPrice = fourHourCandles[fourHourCandles.length - 1].close;
  
  // Determine preliminary direction for premium/discount analysis
  const prelimDirection = dailyStructure.trend === 'bullish' ? 'bullish' as const : 
                          dailyStructure.trend === 'bearish' ? 'bearish' as const : 'bullish' as const;
  
  return {
    dailyStructure,
    fourHourStructure,
    oneHourStructure: analyzeMarketStructure(oneHourCandles),
    dailyRSI: calculateRSI(dailyCloses, 14),
    fourHourRSI: calculateRSI(fourHourCloses, 14),
    oneHourRSI: calculateRSI(oneHourCloses, 14),
    dailyMACD: calculateMACD(dailyCloses),
    fourHourMACD: calculateMACD(fourHourCloses),
    oneHourMACD: calculateMACD(oneHourCloses),
    dailyMAs: analyzeMovingAverages(dailyCloses),
    dailyATR: calculateATR(dailyCandles, 14),
    fourHourATR,
    oneHourATR: calculateATR(oneHourCandles, 14),
    orderBlocks: findOrderBlocks(fourHourCandles),
    fairValueGaps: fvgs,
    liquidityZones: findLiquidityZones(fourHourCandles),
    liquiditySweep4H: detectLiquiditySweep(fourHourCandles),
    liquiditySweepDaily: detectLiquiditySweep(dailyCandles),
    priceAction: analyzePriceAction(fourHourCandles, instrument),
    dailyPriceAction: analyzePriceAction(dailyCandles, instrument),
    oneHourPriceAction: analyzePriceAction(oneHourCandles, instrument),
    dailyOBV: calculateOBV(dailyCandles),
    fourHourOBV: calculateOBV(fourHourCandles),
    // New SMC concepts
    breakerBlocks4H: findBreakerBlocks(fourHourCandles),
    breakerBlocksDaily: findBreakerBlocks(dailyCandles),
    premiumDiscount4H: fourHourStructure.trend !== 'ranging' 
      ? analyzePremiumDiscount(fourHourStructure.lastSwingHigh, fourHourStructure.lastSwingLow, currentPrice, prelimDirection) 
      : null,
    premiumDiscountDaily: dailyStructure.trend !== 'ranging'
      ? analyzePremiumDiscount(dailyStructure.lastSwingHigh, dailyStructure.lastSwingLow, currentPrice, prelimDirection)
      : null,
    consequentEncroachments: findConsequentEncroachments(fvgs, currentPrice, fourHourATR),
    inducement4H: detectInducement(fourHourCandles),
    inducementDaily: detectInducement(dailyCandles),
    displacement4H: detectDisplacement(fourHourCandles),
    displacementDaily: detectDisplacement(dailyCandles),
  };
};
