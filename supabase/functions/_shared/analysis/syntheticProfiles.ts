/**
 * Synthetic Index Behavior Profiles
 * 
 * Each index has unique market structure characteristics that affect
 * how SMC analysis parameters should be tuned for optimal signal accuracy.
 * 
 * Structure quality is inversely related to volatility:
 * V10 (cleanest) → V25 → V50 → V75 → V100 (noisiest)
 */

import { TradingInstrument, isSyntheticIndex, SyntheticIndex } from './core.ts';

export interface SyntheticProfile {
  /** Display label */
  name: string;
  /** Relative volatility tier: 1 (lowest) – 5 (highest) */
  volatilityTier: 1 | 2 | 3 | 4 | 5;
  /** Structure clarity rating 1 (noisy) – 5 (cleanest) */
  structureClarity: 1 | 2 | 3 | 4 | 5;

  // ---- Swing / structure detection ----
  /** Swing point lookback (lower = more sensitive) */
  swingLookback: number;
  /** Min swing pairs for BOS/CHoCH confirmation */
  minSwingPairsForStructure: number;

  // ---- Order Block tuning ----
  /** Quality threshold for OB to be considered valid */
  obQualityThreshold: number;
  /** Max OBs to keep (top-N by quality) */
  obMaxCount: number;
  /** Whether to use wick tips to refine OB zones (tighter zones) */
  useWickTipRefinement: boolean;

  // ---- FVG tuning ----
  /** FVGs fill more consistently on synthetics; use higher fill expectation */
  fvgFillExpectation: 'high' | 'moderate';
  /** Max FVGs to keep */
  fvgMaxCount: number;

  // ---- Liquidity ----
  /** Equal high/low tolerance multiplier (relative to default 0.0002) */
  liquidityToleranceMult: number;
  /** Liquidity sweeps of equal highs/lows reliability weight boost */
  liquiditySweepWeightBoost: number;

  // ---- Retracement ----
  /** Expected retracement depth before continuation (fib level) */
  retracementDepth: number;

  // ---- Execution ----
  /** ATR multiplier for stop-loss (wider for volatile indices) */
  slAtrMultiplier: number;
  /** ATR multiplier for TP scaling */
  tpAtrMultiplier: number;
  /** Typical strong trend duration in hours */
  trendDurationHours: [number, number];
  /** Volume expansion threshold multiplier for entry filter */
  volumeExpansionMult: number;

  // ---- Consolidation / displacement ----
  /** Whether pre-breakout consolidation is a key behavioral signature */
  consolidationBeforeBreakout: boolean;
  /** Displacement detection body/avg multiplier */
  displacementBodyMult: number;

  // ---- Mean reversion ----
  /** Whether strong mean reversion tendency exists at extremes */
  meanReversionAtExtremes: boolean;

  // ---- Scoring ----
  /** Direction score minimum difference to avoid "ranging" */
  minScoreDifference: number;
  /** Max confluence score denominator (for synthetics, uses 44-point scale) */
  maxConfluenceScore: number;

  /** Behavioral notes for reasoning text */
  behaviorNotes: string[];
}

const V10_PROFILE: SyntheticProfile = {
  name: 'Volatility 10',
  volatilityTier: 1,
  structureClarity: 5,
  swingLookback: 5,
  minSwingPairsForStructure: 3,
  obQualityThreshold: 30,
  obMaxCount: 8,
  useWickTipRefinement: true,
  fvgFillExpectation: 'high',
  fvgMaxCount: 6,
  liquidityToleranceMult: 0.8,
  liquiditySweepWeightBoost: 1.5,
  retracementDepth: 0.382,
  slAtrMultiplier: 1.5,
  tpAtrMultiplier: 1.0,
  trendDurationHours: [4, 12],
  volumeExpansionMult: 0.5,
  consolidationBeforeBreakout: false,
  displacementBodyMult: 2.0,
  meanReversionAtExtremes: false,
  minScoreDifference: 2,
  maxConfluenceScore: 44,
  behaviorNotes: [
    'Cleanest structure — HH/HL and LH/LL hold reliably',
    'Minimal false breaks',
    'OBs and FVGs are precise and respected consistently',
  ],
};

const V25_PROFILE: SyntheticProfile = {
  name: 'Volatility 25',
  volatilityTier: 2,
  structureClarity: 5,
  swingLookback: 4,
  minSwingPairsForStructure: 3,
  obQualityThreshold: 30,
  obMaxCount: 8,
  useWickTipRefinement: true,
  fvgFillExpectation: 'high',
  fvgMaxCount: 6,
  liquidityToleranceMult: 0.9,
  liquiditySweepWeightBoost: 1.5,
  retracementDepth: 0.382,
  slAtrMultiplier: 1.8,
  tpAtrMultiplier: 1.0,
  trendDurationHours: [3, 10],
  volumeExpansionMult: 0.5,
  consolidationBeforeBreakout: false,
  displacementBodyMult: 2.0,
  meanReversionAtExtremes: false,
  minScoreDifference: 2,
  maxConfluenceScore: 44,
  behaviorNotes: [
    'Excellent structure clarity — BOS/CHoCH clean and consistent',
    'FVGs between OBs and next structure level are especially reliable',
    'EMA-based trend structure holds very well',
  ],
};

const V50_PROFILE: SyntheticProfile = {
  name: 'Volatility 50',
  volatilityTier: 3,
  structureClarity: 4,
  swingLookback: 4,
  minSwingPairsForStructure: 3,
  obQualityThreshold: 35,
  obMaxCount: 7,
  useWickTipRefinement: true,
  fvgFillExpectation: 'high',
  fvgMaxCount: 5,
  liquidityToleranceMult: 1.0,
  liquiditySweepWeightBoost: 1.3,
  retracementDepth: 0.5,
  slAtrMultiplier: 2.0,
  tpAtrMultiplier: 1.2,
  trendDurationHours: [2, 8],
  volumeExpansionMult: 0.55,
  consolidationBeforeBreakout: true,
  displacementBodyMult: 2.0,
  meanReversionAtExtremes: false,
  minScoreDifference: 3,
  maxConfluenceScore: 44,
  behaviorNotes: [
    'Strong displacement candles clearly define OB boundaries',
    'FVGs form and fill more reliably than real markets',
    'Consolidation phases before explosive structural breaks are a key signature',
  ],
};

const V75_PROFILE: SyntheticProfile = {
  name: 'Volatility 75',
  volatilityTier: 4,
  structureClarity: 3,
  swingLookback: 3,
  minSwingPairsForStructure: 2,
  obQualityThreshold: 40,
  obMaxCount: 6,
  useWickTipRefinement: true,
  fvgFillExpectation: 'high',
  fvgMaxCount: 5,
  liquidityToleranceMult: 1.2,
  liquiditySweepWeightBoost: 1.5,
  retracementDepth: 0.618,
  slAtrMultiplier: 2.5,
  tpAtrMultiplier: 1.5,
  trendDurationHours: [2, 6],
  volumeExpansionMult: 0.6,
  consolidationBeforeBreakout: false,
  displacementBodyMult: 2.5,
  meanReversionAtExtremes: false,
  minScoreDifference: 3,
  maxConfluenceScore: 44,
  behaviorNotes: [
    'Clear BOS/CHoCH despite high volatility',
    'Explosive multi-candle displacement creating large FVGs',
    'Deep retracements of 50–61.8% before continuation',
    'Frequent liquidity sweeps of equal highs/lows',
    'Regular false breakouts before sharp reversals',
    'Strong trend phases lasting 2–6 hours once direction is established',
  ],
};

const V100_PROFILE: SyntheticProfile = {
  name: 'Volatility 100',
  volatilityTier: 5,
  structureClarity: 2,
  swingLookback: 2,
  minSwingPairsForStructure: 2,
  obQualityThreshold: 45,
  obMaxCount: 6,
  useWickTipRefinement: true,
  fvgFillExpectation: 'moderate',
  fvgMaxCount: 4,
  liquidityToleranceMult: 1.5,
  liquiditySweepWeightBoost: 1.5,
  retracementDepth: 0.5,
  slAtrMultiplier: 3.0,
  tpAtrMultiplier: 1.8,
  trendDurationHours: [1, 4],
  volumeExpansionMult: 0.6,
  consolidationBeforeBreakout: false,
  displacementBodyMult: 3.0,
  meanReversionAtExtremes: true,
  minScoreDifference: 4,
  maxConfluenceScore: 44,
  behaviorNotes: [
    'Moderate structure clarity — BOS/CHoCH form very fast',
    'Very large FVGs (100–300 pips) that only partially fill',
    'Strong mean reversion tendency at extremes',
  ],
};

const BOOM1000_PROFILE: SyntheticProfile = {
  name: 'Boom 1000',
  volatilityTier: 4,
  structureClarity: 3,
  swingLookback: 3,
  minSwingPairsForStructure: 2,
  obQualityThreshold: 40,
  obMaxCount: 6,
  useWickTipRefinement: true,
  fvgFillExpectation: 'moderate',
  fvgMaxCount: 4,
  liquidityToleranceMult: 1.2,
  liquiditySweepWeightBoost: 1.3,
  retracementDepth: 0.5,
  slAtrMultiplier: 2.5,
  tpAtrMultiplier: 1.5,
  trendDurationHours: [2, 6],
  volumeExpansionMult: 0.6,
  consolidationBeforeBreakout: false,
  displacementBodyMult: 2.5,
  meanReversionAtExtremes: false,
  minScoreDifference: 3,
  maxConfluenceScore: 44,
  behaviorNotes: [
    'Spike-driven structure — demand zone retests after consecutive bearish candles',
    'Structure quality similar to V75',
  ],
};

const SYNTHETIC_PROFILES: Record<SyntheticIndex, SyntheticProfile> = {
  V10: V10_PROFILE,
  V25: V25_PROFILE,
  V50: V50_PROFILE,
  V75: V75_PROFILE,
  V100: V100_PROFILE,
  BOOM1000: BOOM1000_PROFILE,
};

/**
 * Get the behavior profile for a synthetic index.
 * Returns null for forex pairs.
 */
export const getSyntheticProfile = (instrument: TradingInstrument): SyntheticProfile | null => {
  if (!isSyntheticIndex(instrument)) return null;
  return SYNTHETIC_PROFILES[instrument] ?? null;
};

/**
 * Key SMC adjustments that apply to ALL synthetic indices:
 * - No killzone timing — structure-based entry only, not time-based
 * - HTF bias from price structure alone — no fundamentals exist
 * - OBs are tighter and more precise than forex — use wick tips to refine zones
 * - FVGs fill more consistently than real markets across all indices
 * - Liquidity sweeps of equal highs/lows are one of the most reliable patterns
 */
export const SYNTHETIC_UNIVERSAL_RULES = {
  /** Synthetics trade 24/7 — no kill zone filtering */
  bypassKillZone: true,
  /** No fundamental analysis — pure structure bias */
  structureOnlyBias: true,
  /** Use wick tips for tighter OB zone refinement */
  useWickTipOBs: true,
  /** FVGs are more reliable on synthetics */
  fvgReliabilityBoost: true,
  /** Liquidity sweeps are highly reliable entry signals */
  liquiditySweepPriority: true,
} as const;
