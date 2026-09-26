/** Frozen copy of the pre-unification client swing score, for measurement only. */
import type { AnalysisResult } from '../supabase/functions/_shared/analysis/marketAnalysis.ts';
type TrendDirection = 'bullish'|'bearish'|'ranging';
export const legacyConfluenceScore = (
  analysis: AnalysisResult,
  direction: TrendDirection
): { score: number; breakdown: Record<string, number> } => {
  let priceAction = 0;
  let indicators = 0;
  let multiTimeframe = 0;
  let riskReward = 0;
  let marketConditions = 0;
  let smcConfluence = 0; // NEW: dedicated SMC category
  
  // Price Action (max 8) - Structure + OB/FVG + candlestick patterns
  if (direction === 'bullish') {
    if (analysis.dailyStructure.structure === 'HH_HL') priceAction += 1;
    if (analysis.fourHourStructure.structure === 'HH_HL') priceAction += 1;
    if (analysis.oneHourStructure.structure === 'HH_HL') priceAction += 1;
    if (analysis.orderBlocks.some(ob => ob.type === 'bullish' && !ob.mitigated && ob.qualityScore >= 40)) priceAction += 1;
    if (analysis.orderBlocks.some(ob => ob.type === 'bullish' && !ob.mitigated && ob.qualityScore >= 70)) priceAction += 1;
    if (analysis.fairValueGaps.some(fvg => fvg.type === 'bullish' && fvg.qualityScore >= 40)) priceAction += 1;
    if (analysis.dailyPriceAction.dominantSignal === 'bullish') priceAction += 1;
    if (analysis.priceAction.dominantSignal === 'bullish') priceAction += 1;
  } else if (direction === 'bearish') {
    if (analysis.dailyStructure.structure === 'LH_LL') priceAction += 1;
    if (analysis.fourHourStructure.structure === 'LH_LL') priceAction += 1;
    if (analysis.oneHourStructure.structure === 'LH_LL') priceAction += 1;
    if (analysis.orderBlocks.some(ob => ob.type === 'bearish' && !ob.mitigated && ob.qualityScore >= 40)) priceAction += 1;
    if (analysis.orderBlocks.some(ob => ob.type === 'bearish' && !ob.mitigated && ob.qualityScore >= 70)) priceAction += 1;
    if (analysis.fairValueGaps.some(fvg => fvg.type === 'bearish' && fvg.qualityScore >= 40)) priceAction += 1;
    if (analysis.dailyPriceAction.dominantSignal === 'bearish') priceAction += 1;
    if (analysis.priceAction.dominantSignal === 'bearish') priceAction += 1;
  }
  
  // Indicators (max 8)
  if (direction === 'bullish') {
    if (analysis.dailyRSI > 40 && analysis.dailyRSI < 70) indicators += 1;
    if (analysis.fourHourRSI > 40 && analysis.fourHourRSI < 70) indicators += 1;
    if (analysis.oneHourRSI > 40 && analysis.oneHourRSI < 70) indicators += 1;
    if (analysis.dailyMACD.signal === 'bullish') indicators += 2;
    if (analysis.fourHourMACD.signal === 'bullish') indicators += 1;
    if (analysis.dailyMAs.trend === 'bullish') indicators += 2;
  } else if (direction === 'bearish') {
    if (analysis.dailyRSI > 30 && analysis.dailyRSI < 60) indicators += 1;
    if (analysis.fourHourRSI > 30 && analysis.fourHourRSI < 60) indicators += 1;
    if (analysis.oneHourRSI > 30 && analysis.oneHourRSI < 60) indicators += 1;
    if (analysis.dailyMACD.signal === 'bearish') indicators += 2;
    if (analysis.fourHourMACD.signal === 'bearish') indicators += 1;
    if (analysis.dailyMAs.trend === 'bearish') indicators += 2;
  }
  
  // Multi-timeframe alignment (max 8)
  if (analysis.dailyStructure.trend === analysis.fourHourStructure.trend) multiTimeframe += 2;
  if (analysis.fourHourStructure.trend === analysis.oneHourStructure.trend) multiTimeframe += 2;
  if (analysis.dailyStructure.trend === analysis.oneHourStructure.trend) multiTimeframe += 1;
  if (analysis.dailyMACD.signal === analysis.fourHourMACD.signal) multiTimeframe += 1;
  if (analysis.fourHourMACD.signal === analysis.oneHourMACD.signal) multiTimeframe += 1;
  if (
    (analysis.dailyRSI > 50 && analysis.fourHourRSI > 50 && analysis.oneHourRSI > 50) ||
    (analysis.dailyRSI < 50 && analysis.fourHourRSI < 50 && analysis.oneHourRSI < 50)
  ) multiTimeframe += 1;
  
  // Risk/Reward estimation (max 4)
  riskReward = 0;
  if (analysis.orderBlocks.filter(ob => !ob.mitigated && ob.qualityScore >= 40).length > 0) riskReward += 2;
  if (analysis.fairValueGaps.filter(fvg => fvg.qualityScore >= 40).length > 0) riskReward += 2;
  
  // Market conditions (max 4)
  if (!analysis.dailyStructure.structureBreak) marketConditions += 2;
  if (analysis.dailyStructure.trend !== 'ranging') marketConditions += 2;
  
  // ===== NEW: SMC Confluence (max 12) — From SMC Guide =====
  
  // Breaker Blocks (max 2): Violated OBs that flipped polarity
  const breakerAligned = direction === 'bullish'
    ? analysis.breakerBlocks4H.some(bb => bb.type === 'bullish' && bb.qualityScore >= 40)
    : analysis.breakerBlocks4H.some(bb => bb.type === 'bearish' && bb.qualityScore >= 40);
  if (breakerAligned) smcConfluence += 2;
  
  // Premium/Discount Zone (max 2): Buy in discount, sell in premium
  const pd = analysis.premiumDiscount4H;
  if (pd) {
    if (pd.zoneAlignment) smcConfluence += 2;
  }
  
  // Consequent Encroachment (max 2): Price near CE of a directional FVG
  const ceAligned = analysis.consequentEncroachments.some(ce => 
    ce.fvgType === direction && ce.priceNearCE
  );
  if (ceAligned) smcConfluence += 2;
  
  // Inducement / Stop Hunt (max 2): Inducement detected confirming direction
  if (analysis.inducement4H.detected && analysis.inducement4H.direction === direction) smcConfluence += 1;
  if (analysis.inducementDaily.detected && analysis.inducementDaily.direction === direction) smcConfluence += 1;
  
  // Displacement (max 2): Strong impulsive move confirming direction
  if (analysis.displacement4H.detected && analysis.displacement4H.direction === direction) smcConfluence += 1;
  if (analysis.displacementDaily.detected && analysis.displacementDaily.direction === direction) smcConfluence += 1;
  
  // Structural confirmation bonus (max 4) — BOS, CHoCH, Liquidity Sweep
  let structuralBonus = 0;
  if (analysis.fourHourStructure.breakOfStructure === direction || analysis.dailyStructure.breakOfStructure === direction) structuralBonus += 2;
  if (analysis.fourHourStructure.changeOfCharacter === direction || analysis.dailyStructure.changeOfCharacter === direction) structuralBonus += 1;
  if (analysis.liquiditySweep4H.detected && analysis.liquiditySweep4H.direction === direction) structuralBonus += 1;
  
  return {
    score: Math.min(priceAction + indicators + multiTimeframe + riskReward + marketConditions + smcConfluence + structuralBonus, 48),
    breakdown: { priceAction, indicators, multiTimeframe, riskReward, marketConditions, smcConfluence },
  };
};

