export type {
  CurrencyPair, SyntheticIndex, TradingInstrument, TrendDirection, MarketPhase, PriceLevel,
} from '../../supabase/functions/_shared/analysis/core.ts';
export {
  FOREX_PAIRS, SYNTHETIC_INDICES, ALL_INSTRUMENTS, isSyntheticIndex, getInstrumentDecimals,
} from '../../supabase/functions/_shared/analysis/core.ts';
import type { TrendDirection, MarketPhase, PriceLevel, TradingInstrument } from '../../supabase/functions/_shared/analysis/core.ts';

export type SetupType = 'trend_continuation' | 'reversal' | 'breakout' | 'range';

export type ConfidenceLevel = 'excellent' | 'good' | 'marginal' | 'no_trade';

export type TradeType = 'swing' | 'day';

export interface SessionReview {
  asianSummary: string;
  keyLevelsTested: string[];
  volatility: 'low' | 'medium' | 'high';
  newsImpact: string | null;
  relativeToYesterdayClose: 'above' | 'below' | 'at';
}

export interface DailyAnalysis {
  trend: TrendDirection;
  swingHighs: number[];
  swingLows: number[];
  marketPhase: MarketPhase;
  resistanceLevels: PriceLevel[];
  supportLevels: PriceLevel[];
  roundNumbers: number[];
  patterns: string[];
  trendlines: string[];
}

export interface FourHourAnalysis {
  alignmentWithDaily: boolean;
  structure: 'HH_HL' | 'LH_LL' | 'ranging';
  pullbackZones: number[];
  supplyDemandZones: { type: 'supply' | 'demand'; low: number; high: number }[];
  fibLevels: { level: string; price: number }[];
}

export interface IndicatorAnalysis {
  dailyRSI: { value: number; status: 'overbought' | 'oversold' | 'neutral' };
  dailyMACD: { histogram: number; signal: 'bullish' | 'bearish' | 'neutral' };
  movingAverages: {
    ma20: number;
    ma50: number;
    ma200: number;
    pricePosition: 'above_all' | 'below_all' | 'mixed';
  };
  fourHourRSI: { value: number; status: 'overbought' | 'oversold' | 'neutral' };
}

export interface CandlestickAnalysis {
  dailyCandle: {
    type: string;
    interpretation: string;
  };
  patterns: string[];
  microStructure: string;
}

export interface SessionScenario {
  bullScenario: {
    trigger: string;
    target: number;
    probability: number;
  };
  bearScenario: {
    trigger: string;
    target: number;
    probability: number;
  };
  rangeScenario: {
    condition: string;
    range: { low: number; high: number };
  };
  invalidation: number;
}

export interface RiskManagement {
  entry: number;
  /** Realistic fill after spread: entry + half spread (buy) / − half spread (sell) */
  effectiveEntry?: number;
  /** Spread used, in absolute price units (already volatility-scaled) */
  spreadApplied?: number;
  /** ATR percentile (0-100) of 1H ATR vs its trailing 200-candle distribution */
  atrPercentile?: number;
  /** Volatility multiplier applied to the base spread (1.0 = normal / non-synthetic) */
  spreadMultiplier?: number;
  stopLoss: number;
  stopDistance: number;
  riskPercent: number;
  takeProfit1: number;
  takeProfit2: number;
  takeProfit3: number;
  trailingStopLogic: string;
  breakevenRule: string;
}


export interface ConfluenceScore {
  priceAction: number;
  indicators: number;
  multiTimeframe: number;
  riskReward: number;
  marketConditions: number;
  smcConfluence: number;
  total: number;
  level: ConfidenceLevel;
}

export interface ConfidenceBreakdownItem {
  label: string;
  value: string;
  weight: number;
  maxWeight: number;
  contributing: boolean;
}

export interface TradeRecommendation {
  direction: TrendDirection;
  confidence: number;
  setupType: SetupType;
  preferPendingOrder: boolean;
  risk: RiskManagement;
  tradeType: TradeType;
  holdingPeriod: string;
  reasoning: string;
  confidenceBreakdown?: ConfidenceBreakdownItem[];
  /** Day trades only: live tick used to anchor entry/stop/targets */
  livePriceUsed?: number;
  /** Day trades only: |live − closed-candle price| expressed in 1H ATR units */
  entryDriftAtr?: number;
  /** Day trades only: live tick drifted > 0.5x 1H ATR from the structural price */
  entryStale?: boolean;
}

export interface TradePlan {
  pair: TradingInstrument;
  timestamp: Date;
  currentPrice: number;
  sessionReview: SessionReview;
  dailyAnalysis: DailyAnalysis;
  fourHourAnalysis: FourHourAnalysis;
  indicators: IndicatorAnalysis;
  candlesticks: CandlestickAnalysis;
  londonSession: SessionScenario;
  londonNYOverlap: {
    probableDirection: TrendDirection;
    stopHuntZones: number[];
  };
  recommendation: TradeRecommendation;
  dayTradeRecommendation: TradeRecommendation;
  confluenceScore: ConfluenceScore;
  alternativeScenarios: {
    planB: string;
    biasFlipCondition: string;
    warningSignals: string[];
  };
  executionPlan: {
    preLondonChecklist: string[];
    londonOpenLogic: string;
    endOfDayReview: string[];
  };
  keyLevels: PriceLevel[];
  criticalInvalidation: number;
  atr4H?: number;
}
