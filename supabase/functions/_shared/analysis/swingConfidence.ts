/**
 * CANONICAL swing confidence — the only place swing confidence is computed.
 * Imported unchanged by the web app and the signal engine.
 *
 * Invariants (enforced by construction):
 *   total   = Σ item.weight
 *   max     = Σ item.maxWeight  (= SWING_CONFIDENCE_MAX for every instrument)
 *   total  <= max               (each item is clamped to its own maxWeight)
 *   confidence = min(round(total / max * 100), CONFIDENCE_CAP)
 * The persisted breakdown is exactly `items`, so total/max always reproduces
 * the displayed number (up to the cap).
 *
 * Every item is scored relative to the trade direction. Earlier versions awarded
 * points for timeframes / MACDs agreeing with each other even when they agreed
 * AGAINST the trade, for OB/FVG of either polarity, used a premium/discount zone
 * measured against the daily trend instead of the trade, and counted a same-
 * direction liquidity sweep (project rule: a bullish sweep confirms bearish).
 */
import type { AnalysisResult } from './marketAnalysis.ts';

export const CONFIDENCE_CAP = 95;

export interface SwingConfidenceItem {
  label: string;
  value: string;
  weight: number;
  maxWeight: number;
  contributing: boolean;
}

export interface SwingConfidenceResult {
  confidence: number;
  total: number;
  max: number;
  items: SwingConfidenceItem[];
  categories: {
    priceAction: number; indicators: number; multiTimeframe: number;
    riskReward: number; marketConditions: number; smcConfluence: number; structural: number;
  };
}

type Dir = 'bullish' | 'bearish';

export function computeSwingConfidence(a: AnalysisResult, direction: Dir): SwingConfidenceResult {
  const bull = direction === 'bullish';
  const struct = bull ? 'HH_HL' : 'LH_LL';
  const sweepConfirms = bull ? 'bearish' : 'bullish';
  const items: (SwingConfidenceItem & { cat: keyof SwingConfidenceResult['categories'] })[] = [];
  const add = (cat: keyof SwingConfidenceResult['categories'], label: string, value: string, raw: number, maxWeight: number) => {
    const weight = Math.max(0, Math.min(raw, maxWeight));
    items.push({ cat, label, value, weight, maxWeight, contributing: weight > 0 });
  };
  const yes = (c: boolean, w: number) => (c ? w : 0);
  const rsiOk = (v: number) => (bull ? v > 40 && v < 70 : v > 30 && v < 60);

  // Price action (8)
  add('priceAction', 'Daily Structure', a.dailyStructure.structure, yes(a.dailyStructure.structure === struct, 1), 1);
  add('priceAction', '4H Structure', a.fourHourStructure.structure, yes(a.fourHourStructure.structure === struct, 1), 1);
  add('priceAction', '1H Structure', a.oneHourStructure.structure, yes(a.oneHourStructure.structure === struct, 1), 1);
  const obs = a.orderBlocks.filter(o => o.type === direction && !o.mitigated);
  const bestOB = obs.reduce((m, o) => Math.max(m, o.qualityScore), 0);
  add('priceAction', '4H Order Block quality', obs.length ? `Q${Math.round(bestOB)}` : 'none', yes(bestOB >= 40, 1) + yes(bestOB >= 70, 1), 2);
  const bestFVG = a.fairValueGaps.filter(f => f.type === direction).reduce((m, f) => Math.max(m, f.qualityScore), 0);
  add('priceAction', '4H FVG quality', bestFVG ? `Q${Math.round(bestFVG)}` : 'none', yes(bestFVG >= 40, 1), 1);
  add('priceAction', 'Price Action D', a.dailyPriceAction.dominantSignal, yes(a.dailyPriceAction.dominantSignal === direction, 1), 1);
  add('priceAction', 'Price Action 4H', a.priceAction.dominantSignal, yes(a.priceAction.dominantSignal === direction, 1), 1);

  // Indicators (8)
  add('indicators', 'RSI Daily in trend band', a.dailyRSI.toFixed(1), yes(rsiOk(a.dailyRSI), 1), 1);
  add('indicators', 'RSI 4H in trend band', a.fourHourRSI.toFixed(1), yes(rsiOk(a.fourHourRSI), 1), 1);
  add('indicators', 'RSI 1H in trend band', a.oneHourRSI.toFixed(1), yes(rsiOk(a.oneHourRSI), 1), 1);
  add('indicators', 'MACD Daily', a.dailyMACD.signal, yes(a.dailyMACD.signal === direction, 2), 2);
  add('indicators', 'MACD 4H', a.fourHourMACD.signal, yes(a.fourHourMACD.signal === direction, 1), 1);
  add('indicators', 'Daily MAs', a.dailyMAs.trend, yes(a.dailyMAs.trend === direction, 2), 2);

  // Multi-timeframe alignment WITH the trade (8)
  const dT = a.dailyStructure.trend, hT = a.fourHourStructure.trend, oT = a.oneHourStructure.trend;
  add('multiTimeframe', 'Daily+4H trend with trade', `${dT}/${hT}`, yes(dT === direction && hT === direction, 2), 2);
  add('multiTimeframe', '4H+1H trend with trade', `${hT}/${oT}`, yes(hT === direction && oT === direction, 2), 2);
  add('multiTimeframe', 'Daily+1H trend with trade', `${dT}/${oT}`, yes(dT === direction && oT === direction, 1), 1);
  add('multiTimeframe', 'MACD D+4H with trade', `${a.dailyMACD.signal}/${a.fourHourMACD.signal}`, yes(a.dailyMACD.signal === direction && a.fourHourMACD.signal === direction, 1), 1);
  add('multiTimeframe', 'MACD 4H+1H with trade', `${a.fourHourMACD.signal}/${a.oneHourMACD.signal}`, yes(a.fourHourMACD.signal === direction && a.oneHourMACD.signal === direction, 1), 1);
  const rsiAll = bull ? a.dailyRSI > 50 && a.fourHourRSI > 50 && a.oneHourRSI > 50 : a.dailyRSI < 50 && a.fourHourRSI < 50 && a.oneHourRSI < 50;
  add('multiTimeframe', 'RSI D/4H/1H same side as trade', `${a.dailyRSI.toFixed(0)}/${a.fourHourRSI.toFixed(0)}/${a.oneHourRSI.toFixed(0)}`, yes(rsiAll, 1), 1);

  // Entry zone availability, trade-side only (4)
  add('riskReward', 'Directional OB available', obs.some(o => o.qualityScore >= 40) ? 'yes' : 'no', yes(obs.some(o => o.qualityScore >= 40), 2), 2);
  add('riskReward', 'Directional FVG available', bestFVG >= 40 ? 'yes' : 'no', yes(bestFVG >= 40, 2), 2);

  // Market regime (4) — intentionally direction-neutral
  add('marketConditions', 'Daily structure intact', a.dailyStructure.structureBreak ? 'break' : 'intact', yes(!a.dailyStructure.structureBreak, 2), 2);
  add('marketConditions', 'Daily trending', dT, yes(dT !== 'ranging', 2), 2);

  // SMC (10)
  add('smcConfluence', 'Breaker Block 4H', a.breakerBlocks4H.some(b => b.type === direction && b.qualityScore >= 40) ? 'aligned' : 'none',
    yes(a.breakerBlocks4H.some(b => b.type === direction && b.qualityScore >= 40), 2), 2);
  const pd = a.premiumDiscount4H;
  const pdAligned = !!pd && ((bull && pd.currentZone === 'discount') || (!bull && pd.currentZone === 'premium'));
  add('smcConfluence', 'Premium/Discount 4H', pd ? pd.currentZone : 'n/a', yes(pdAligned, 2), 2);
  const ce = a.consequentEncroachments.some(c => c.fvgType === direction && c.priceNearCE);
  add('smcConfluence', 'Consequent Encroachment', ce ? 'at CE' : 'none', yes(ce, 2), 2);
  add('smcConfluence', 'Inducement 4H/D', `${a.inducement4H.detected ? a.inducement4H.direction : 'none'}/${a.inducementDaily.detected ? a.inducementDaily.direction : 'none'}`,
    yes(a.inducement4H.detected && a.inducement4H.direction === direction, 1) + yes(a.inducementDaily.detected && a.inducementDaily.direction === direction, 1), 2);
  add('smcConfluence', 'Displacement 4H/D', `${a.displacement4H.detected ? a.displacement4H.direction : 'none'}/${a.displacementDaily.detected ? a.displacementDaily.direction : 'none'}`,
    yes(a.displacement4H.detected && a.displacement4H.direction === direction, 1) + yes(a.displacementDaily.detected && a.displacementDaily.direction === direction, 1), 2);

  // Structural confirmation (4)
  add('structural', 'BOS 4H/D', `${a.fourHourStructure.breakOfStructure ?? 'none'}/${a.dailyStructure.breakOfStructure ?? 'none'}`,
    yes(a.fourHourStructure.breakOfStructure === direction || a.dailyStructure.breakOfStructure === direction, 2), 2);
  add('structural', 'CHoCH 4H/D', `${a.fourHourStructure.changeOfCharacter ?? 'none'}/${a.dailyStructure.changeOfCharacter ?? 'none'}`,
    yes(a.fourHourStructure.changeOfCharacter === direction || a.dailyStructure.changeOfCharacter === direction, 1), 1);
  add('structural', 'Liquidity Sweep 4H (opposite side)', a.liquiditySweep4H.detected ? `${a.liquiditySweep4H.direction} sweep` : 'none',
    yes(a.liquiditySweep4H.detected && a.liquiditySweep4H.direction === sweepConfirms, 1), 1);

  const total = items.reduce((s, i) => s + i.weight, 0);
  const max = items.reduce((s, i) => s + i.maxWeight, 0);
  const categories = { priceAction: 0, indicators: 0, multiTimeframe: 0, riskReward: 0, marketConditions: 0, smcConfluence: 0, structural: 0 };
  for (const i of items) categories[i.cat] += i.weight;
  return {
    confidence: Math.min(Math.round((total / max) * 100), CONFIDENCE_CAP),
    total, max,
    items: items.map(({ cat: _c, ...rest }) => rest),
    categories,
  };
}

/** Constant denominator — identical for forex and synthetics. */
export const SWING_CONFIDENCE_MAX = 46;
