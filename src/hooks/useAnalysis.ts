import { useState, useMemo, useEffect, useCallback } from 'react';
import { TradingInstrument, TradePlan, isSyntheticIndex, ALL_INSTRUMENTS } from '@/types/trading';
import { generateMockTradePlan } from '@/lib/mockData';
import { generateTradePlan } from '@/lib/tradeSignalGenerator';
import { useDerivAPI, CandleData } from '@/hooks/useDerivAPI';
import { useSignalCache } from '@/hooks/useSignalCache';
import { useGeneratedSignals } from '@/hooks/useGeneratedSignals';
import { useAutoAnalysis } from '@/hooks/useAutoAnalysis';

import { findOrderBlocks, findFairValueGaps, OrderBlock, FairValueGap, extractSMCChartPoints, SMCChartPoints, mergeSMCChartPoints } from '@/lib/smcAnalysis';
import { analyzePriceAction, PriceActionAnalysis } from '@/lib/priceActionAnalysis';
import { calculateOBV, OBVResult } from '@/lib/indicators';
import { toast } from 'sonner';

export const useAnalysis = () => {
  const [selectedInstrument, setSelectedInstrument] = useState<TradingInstrument>('EUR/USD');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [tradePlan, setTradePlan] = useState<TradePlan | null>(null);
  const [hasRealAnalysis, setHasRealAnalysis] = useState(false);
  const [chartCandles, setChartCandles] = useState<CandleData[]>([]);
  const [orderBlocks, setOrderBlocks] = useState<OrderBlock[]>([]);
  const [fairValueGaps, setFairValueGaps] = useState<FairValueGap[]>([]);
  const [priceActionAnalysis, setPriceActionAnalysis] = useState<PriceActionAnalysis | null>(null);
  const [signalTimestamp, setSignalTimestamp] = useState<Date | null>(null);
  const [obvData, setObvData] = useState<OBVResult | null>(null);
  const [smcChartPoints, setSMCChartPoints] = useState<SMCChartPoints | null>(null);

  const { prices, isConnected, error, isMarketClosed, reconnect, getCandles } = useDerivAPI();
  const { getCachedSignal, setCachedSignal } = useSignalCache();
  const { logSignal } = useGeneratedSignals();
  const { state: autoAnalysisState, isAutoEnabled, toggleAutoAnalysis, runFullAnalysis } = useAutoAnalysis();
  

  const isCurrentMarketClosed = isMarketClosed && !isSyntheticIndex(selectedInstrument);

  const pairData = useMemo(() => {
    const data: Record<TradingInstrument, { price: number; change: number; trend: 'up' | 'down' | 'flat' }> = {} as any;
    ALL_INSTRUMENTS.forEach(instrument => {
      data[instrument] = {
        price: prices[instrument].price,
        change: prices[instrument].change,
        trend: prices[instrument].trend,
      };
    });
    return data;
  }, [prices]);

  const currentPlan = useMemo(() => {
    if (tradePlan && tradePlan.pair === selectedInstrument) {
      if (prices[selectedInstrument].price > 0) {
        return { ...tradePlan, currentPrice: prices[selectedInstrument].price };
      }
      return tradePlan;
    }
    const plan = generateMockTradePlan(selectedInstrument);
    if (prices[selectedInstrument].price > 0) {
      plan.currentPrice = prices[selectedInstrument].price;
    }
    return plan;
  }, [selectedInstrument, prices, tradePlan]);

  useEffect(() => {
    if (isConnected) {
      toast.success('Connected to Deriv API', { description: 'Receiving live forex prices' });
    }
  }, [isConnected]);

  useEffect(() => {
    if (tradePlan?.pair !== selectedInstrument) {
      setHasRealAnalysis(false);
      setChartCandles([]);
      setOrderBlocks([]);
      setFairValueGaps([]);
      setPriceActionAnalysis(null);
      setSignalTimestamp(null);
      setTradePlan(null);
      setObvData(null);
      setSMCChartPoints(null);
    }
  }, [selectedInstrument, tradePlan?.pair]);

  const handleAnalyze = useCallback(async (forceRefresh: boolean = false) => {
    setIsAnalyzing(true);
    toast.info(`Analyzing ${selectedInstrument}`, { description: 'Running SMC + Volume analysis...' });

    try {
      // ---- Cache check FIRST: a hit must not pay any network cost ----
      const cached = forceRefresh ? null : getCachedSignal(selectedInstrument);
      if (cached) {
        const updatedPlan = {
          ...cached.tradePlan,
          currentPrice: prices[selectedInstrument].price > 0 ? prices[selectedInstrument].price : cached.tradePlan.currentPrice,
        };
        setChartCandles(cached.fourHourCandles);
        const dailyOBs = findOrderBlocks(cached.dailyCandles ?? [], 'D1');
        const fourHourOBs = findOrderBlocks(cached.fourHourCandles, '4H');
        const oneHourOBs = findOrderBlocks(cached.oneHourCandles ?? [], '1H');
        setOrderBlocks([...dailyOBs, ...fourHourOBs, ...oneHourOBs]);
        const dailyFVGs = findFairValueGaps(cached.dailyCandles ?? [], 'D1');
        const fourHourFVGs = findFairValueGaps(cached.fourHourCandles, '4H');
        const oneHourFVGs = findFairValueGaps(cached.oneHourCandles ?? [], '1H');
        setFairValueGaps([...dailyFVGs, ...fourHourFVGs, ...oneHourFVGs]);
        setPriceActionAnalysis(analyzePriceAction(cached.fourHourCandles, selectedInstrument));
        setObvData(calculateOBV(cached.fourHourCandles));
        const smc4H = extractSMCChartPoints(cached.fourHourCandles, '4H');
        const smcD1 = extractSMCChartPoints(cached.dailyCandles ?? [], 'D1');
        setSMCChartPoints(mergeSMCChartPoints(smcD1, smc4H));
        setTradePlan(updatedPlan);
        setHasRealAnalysis(true);
        setSignalTimestamp(new Date(cached.generatedAt));
        setIsAnalyzing(false);
        toast.success('Analysis Complete', { description: `Signal loaded from cache for ${selectedInstrument} (same 4H period)` });
        return;
      }

      // ---- Cache miss or explicit force-refresh: fetch fresh candles ----
      const [dailyCandles, fourHourCandles, oneHourCandles] = await Promise.all([
        getCandles(selectedInstrument, 86400, 200),
        getCandles(selectedInstrument, 14400, 300),
        getCandles(selectedInstrument, 3600, 200),
      ]);

      if (dailyCandles.length < 50 || fourHourCandles.length < 50 || oneHourCandles.length < 30) {
        toast.error('Insufficient Data', { description: `Not enough candle data for ${selectedInstrument}` });
        setIsAnalyzing(false);
        return;
      }

      // Always analyze the freshly fetched candles — including on force-refresh.
      const candlesToUse = { daily: dailyCandles, fourHour: fourHourCandles, oneHour: oneHourCandles };

      const closedCandlePrice = candlesToUse.fourHour[Math.max(0, candlesToUse.fourHour.length - 2)]?.close;
      const currentPrice = closedCandlePrice ?? candlesToUse.fourHour[candlesToUse.fourHour.length - 1].close;
      // Live tick: used ONLY to anchor day-trade entry/stop/targets. Structural
      // (SMC/BOS/CHoCH) analysis still runs off the closed-candle price.
      const liveTick = prices[selectedInstrument].price > 0 ? prices[selectedInstrument].price : null;

      const plan = generateTradePlan(selectedInstrument, candlesToUse.daily, candlesToUse.fourHour, candlesToUse.oneHour, currentPrice, liveTick);
      setCachedSignal(selectedInstrument, plan, candlesToUse.daily, candlesToUse.fourHour, candlesToUse.oneHour);

      if (plan.recommendation.direction !== 'ranging') {
        await logSignal(selectedInstrument, plan.recommendation, 'swing');
      }
      if (plan.dayTradeRecommendation.direction !== 'ranging') {
        await logSignal(selectedInstrument, plan.dayTradeRecommendation, 'day');
      }

      setChartCandles(candlesToUse.fourHour);
      const dailyOBs = findOrderBlocks(candlesToUse.daily, 'D1');
      const fourHourOBs = findOrderBlocks(candlesToUse.fourHour, '4H');
      const oneHourOBs = findOrderBlocks(candlesToUse.oneHour, '1H');
      setOrderBlocks([...dailyOBs, ...fourHourOBs, ...oneHourOBs]);
      const dailyFVGs = findFairValueGaps(candlesToUse.daily, 'D1');
      const fourHourFVGs = findFairValueGaps(candlesToUse.fourHour, '4H');
      const oneHourFVGs = findFairValueGaps(candlesToUse.oneHour, '1H');
      setFairValueGaps([...dailyFVGs, ...fourHourFVGs, ...oneHourFVGs]);
      setPriceActionAnalysis(analyzePriceAction(candlesToUse.fourHour, selectedInstrument));
      setObvData(calculateOBV(candlesToUse.fourHour));
      const smc4H = extractSMCChartPoints(candlesToUse.fourHour, '4H');
      const smcD1 = extractSMCChartPoints(candlesToUse.daily, 'D1');
      setSMCChartPoints(mergeSMCChartPoints(smcD1, smc4H));
      setTradePlan(plan);
      setHasRealAnalysis(true);
      setSignalTimestamp(new Date());
      toast.success('Analysis Complete', { description: `Signal generated for ${selectedInstrument}` });
    } catch (err) {
      console.error('Analysis error:', err);
      toast.error('Analysis Error', { description: 'Could not complete analysis. Using mock data.' });
      setHasRealAnalysis(false);
    }

    setIsAnalyzing(false);
  }, [selectedInstrument, getCandles, getCachedSignal, setCachedSignal, prices, logSignal]);

  const handleExport = () => {
    const content = JSON.stringify(currentPlan, null, 2);
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trade-plan-${selectedInstrument.replace('/', '-')}-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return {
    selectedInstrument,
    setSelectedInstrument,
    isAnalyzing,
    tradePlan,
    hasRealAnalysis,
    chartCandles,
    orderBlocks,
    fairValueGaps,
    priceActionAnalysis,
    signalTimestamp,
    obvData,
    smcChartPoints,
    prices,
    isConnected,
    error,
    isCurrentMarketClosed,
    reconnect,
    pairData,
    currentPlan,
    handleAnalyze,
    handleExport,
    autoAnalysisState,
    isAutoEnabled,
    toggleAutoAnalysis,
    runFullAnalysis,
  };
};
