import { TradePlan, TradingInstrument, isSyntheticIndex, getInstrumentDecimals } from '@/types/trading';

export const generateMockTradePlan = (instrument: TradingInstrument): TradePlan => {
  const baseData: Record<TradingInstrument, { price: number; direction: 'bullish' | 'bearish' | 'ranging' }> = {
    'EUR/USD': { price: 1.0845, direction: 'bullish' },
    'GBP/USD': { price: 1.2635, direction: 'bearish' },
    'USD/JPY': { price: 149.85, direction: 'bullish' },
    'AUD/USD': { price: 0.6520, direction: 'bullish' },
    'GBP/JPY': { price: 189.45, direction: 'bearish' },
    'XAU/USD': { price: 2045.50, direction: 'bullish' },
    'V10': { price: 8500, direction: 'ranging' },
    'V25': { price: 125000, direction: 'bullish' },
    'V50': { price: 250000, direction: 'bullish' },
    'V75': { price: 425000, direction: 'bullish' },
    'V100': { price: 850000, direction: 'bearish' },
    'BOOM1000': { price: 9500, direction: 'bullish' },
  };

  const data = baseData[instrument];
  const decimals = getInstrumentDecimals(instrument);
  const pip = isSyntheticIndex(instrument) ? 0.01 : (instrument === 'USD/JPY' ? 0.01 : 0.0001);

  return {
    pair: instrument,
    timestamp: new Date(),
    currentPrice: data.price,
    sessionReview: {
      asianSummary: `${instrument} consolidated during Asian session with moderate range. Price tested key support on 4H chart without breaking below.`,
      keyLevelsTested: [
        `${(data.price - 30 * pip).toFixed(decimals)} support tested twice`,
        `${(data.price + 15 * pip).toFixed(decimals)} minor resistance rejected`,
      ],
      volatility: 'low',
      newsImpact: null,
      relativeToYesterdayClose: 'above',
    },
    dailyAnalysis: {
      trend: data.direction,
      swingHighs: [
        data.price + 120 * pip,
        data.price + 85 * pip,
        data.price + 45 * pip,
      ],
      swingLows: [
        data.price - 95 * pip,
        data.price - 65 * pip,
        data.price - 35 * pip,
      ],
      marketPhase: 'trending',
      resistanceLevels: [
        { price: data.price + 45 * pip, type: 'resistance', description: 'Previous week high', strength: 'strong' },
        { price: data.price + 80 * pip, type: 'resistance', description: 'Monthly pivot R1', strength: 'moderate' },
        { price: data.price + 120 * pip, type: 'resistance', description: 'Major swing high', strength: 'strong' },
      ],
      supportLevels: [
        { price: data.price - 30 * pip, type: 'support', description: '50 MA confluence', strength: 'strong' },
        { price: data.price - 65 * pip, type: 'support', description: 'Previous swing low', strength: 'moderate' },
        { price: data.price - 95 * pip, type: 'support', description: 'Weekly support zone', strength: 'strong' },
      ],
      roundNumbers: [
        Math.floor(data.price * 100) / 100,
        Math.ceil(data.price * 100) / 100,
      ],
      patterns: ['Ascending channel forming on daily', 'Bull flag consolidation'],
      trendlines: [
        'Rising trendline from Oct low (3 touches)',
        'Descending resistance broken',
      ],
    },
    fourHourAnalysis: {
      alignmentWithDaily: true,
      structure: data.direction === 'bullish' ? 'HH_HL' : 'LH_LL',
      pullbackZones: [
        data.price - 20 * pip,
        data.price - 35 * pip,
      ],
      supplyDemandZones: [
        { type: 'demand', low: data.price - 40 * pip, high: data.price - 25 * pip },
        { type: 'supply', low: data.price + 50 * pip, high: data.price + 65 * pip },
      ],
      fibLevels: [
        { level: '38.2%', price: data.price - 18 * pip },
        { level: '50%', price: data.price - 28 * pip },
        { level: '61.8%', price: data.price - 38 * pip },
      ],
    },
    indicators: {
      dailyRSI: { value: 58, status: 'neutral' },
      dailyMACD: { histogram: 0.0012, signal: data.direction === 'bullish' ? 'bullish' : 'bearish' },
      movingAverages: {
        ma20: data.price - 15 * pip,
        ma50: data.price - 45 * pip,
        ma200: data.price - 180 * pip,
        pricePosition: 'above_all',
      },
      fourHourRSI: { value: 52, status: 'neutral' },
    },
    candlesticks: {
      dailyCandle: {
        type: 'Bullish Engulfing',
        interpretation: 'Strong bullish momentum continuation signal after yesterday\'s pullback',
      },
      patterns: ['Morning star on 4H', 'Higher low formation'],
      microStructure: '4H showing bullish inside bar at demand zone',
    },
    londonSession: {
      bullScenario: {
        trigger: `Break above ${(data.price + 25 * pip).toFixed(decimals)} with momentum`,
        target: data.price + 70 * pip,
        probability: 65,
      },
      bearScenario: {
        trigger: `Break below ${(data.price - 35 * pip).toFixed(decimals)} demand zone`,
        target: data.price - 80 * pip,
        probability: 25,
      },
      rangeScenario: {
        condition: 'Low volatility, no clear catalyst',
        range: { low: data.price - 30 * pip, high: data.price + 30 * pip },
      },
      invalidation: data.price - 50 * pip,
    },
    londonNYOverlap: {
      probableDirection: data.direction,
      stopHuntZones: [
        data.price - 40 * pip,
        data.price + 35 * pip,
      ],
    },
    recommendation: {
      direction: data.direction,
      confidence: 72,
      setupType: 'trend_continuation',
      preferPendingOrder: true,
      tradeType: 'swing',
      holdingPeriod: '2-5 days',
      reasoning: 'Daily trend aligned with 4H structure, pullback to demand zone with RSI support',
      risk: {
        entry: data.price - 15 * pip,
        stopLoss: data.price - 55 * pip,
        stopDistance: 40,
        riskPercent: 1,
        takeProfit1: data.price + 45 * pip,
        takeProfit2: data.price + 80 * pip,
        takeProfit3: data.price + 120 * pip,
        trailingStopLogic: 'Move SL to breakeven at TP1, trail 30 pips behind price after TP2',
        breakevenRule: 'Move to breakeven + 5 pips when price reaches TP1',
      },
    },
    dayTradeRecommendation: {
      direction: data.direction,
      confidence: 65,
      setupType: 'trend_continuation',
      preferPendingOrder: false,
      tradeType: 'day',
      holdingPeriod: '2-8 hours',
      reasoning: '1H structure aligned with 4H, entry at Asian session sweep with quick targets',
      risk: {
        entry: data.price - 8 * pip,
        stopLoss: data.price - 25 * pip,
        stopDistance: 17,
        riskPercent: 0.5,
        takeProfit1: data.price + 20 * pip,
        takeProfit2: data.price + 35 * pip,
        takeProfit3: data.price + 50 * pip,
        trailingStopLogic: 'Trail 10 pips behind after TP1',
        breakevenRule: 'Move to breakeven when price reaches TP1',
      },
    },
    confluenceScore: {
      priceAction: 5,
      indicators: 4,
      multiTimeframe: 5,
      riskReward: 3,
      marketConditions: 4,
      smcConfluence: 3,
      total: 24,
      level: 'good',
    },
    alternativeScenarios: {
      planB: 'If London breaks support, wait for NY session retest of broken level as resistance before shorting',
      biasFlipCondition: `Daily close below ${(data.price - 65 * pip).toFixed(decimals)} would flip bias to bearish`,
      warningSignals: [
        'Unexpected central bank commentary',
        'Break of 4H market structure',
        'RSI divergence on momentum push',
      ],
    },
    executionPlan: {
      preLondonChecklist: [
        'Confirm Asian range boundaries',
        'Check economic calendar for London session',
        'Verify no overnight news impact',
        'Set pending orders at identified levels',
      ],
      londonOpenLogic: 'Wait for first 15-min candle close. If bullish, trigger buy limit at pullback zone. If bearish, wait for structure break.',
      endOfDayReview: [
        'Check if targets were hit',
        'Adjust trailing stop if applicable',
        'Note any pattern changes for tomorrow',
        'Update trade journal',
      ],
    },
    keyLevels: [
      { price: data.price + 120 * pip, type: 'resistance', description: 'Major resistance - TP3', strength: 'strong' },
      { price: data.price + 80 * pip, type: 'take_profit', description: 'TP2 - Monthly pivot', strength: 'moderate' },
      { price: data.price + 45 * pip, type: 'take_profit', description: 'TP1 - Week high', strength: 'strong' },
      { price: data.price - 15 * pip, type: 'entry', description: 'Entry - Pullback zone', strength: 'strong' },
      { price: data.price - 30 * pip, type: 'support', description: 'Key support - 50 MA', strength: 'strong' },
      { price: data.price - 55 * pip, type: 'stop_loss', description: 'Stop loss', strength: 'strong' },
      { price: data.price - 95 * pip, type: 'support', description: 'Major support', strength: 'strong' },
    ],
    criticalInvalidation: data.price - 65 * pip,
  };
};
