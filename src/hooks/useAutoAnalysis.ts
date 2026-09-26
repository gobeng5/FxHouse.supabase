import { useState, useEffect, useCallback, useRef } from 'react';
import { TradingInstrument, ALL_INSTRUMENTS, TradePlan, isSyntheticIndex } from '@/types/trading';
import { generateTradePlan } from '@/lib/tradeSignalGenerator';
import { getKillZoneStatus } from '@/lib/sessionUtils';
import { useDerivAPI } from '@/hooks/useDerivAPI';
import { useGeneratedSignals, GeneratedSignal } from '@/hooks/useGeneratedSignals';
import { toast } from 'sonner';

const OUTCOME_CHECK_INTERVAL = 30 * 1000; // Check outcomes every 30 seconds

export interface AutoAnalysisState {
  isRunning: boolean;
  lastRunTime: Date | null;
  nextRunTime: Date | null;
  currentlyAnalyzing: TradingInstrument | null;
  analyzedCount: number;
  totalCount: number;
  errors: string[];
}

const AUTO_ANALYSIS_INTERVAL = 60 * 60 * 1000; // 1 hour in milliseconds

export const useAutoAnalysis = () => {
  const { prices, getCandles, isConnected } = useDerivAPI();
  const { signals, logSignal, refreshSignals, autoCheckOutcomes, getPendingSignals } = useGeneratedSignals();
  
  const [state, setState] = useState<AutoAnalysisState>({
    isRunning: false,
    lastRunTime: null,
    nextRunTime: null,
    currentlyAnalyzing: null,
    analyzedCount: 0,
    totalCount: ALL_INSTRUMENTS.length,
    errors: [],
  });
  
  const [isAutoEnabled, setIsAutoEnabled] = useState(() => {
    const saved = localStorage.getItem('autoAnalysisEnabled');
    return saved === 'true';
  });
  
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const outcomeCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isAnalyzingRef = useRef(false);
  const isCheckingOutcomesRef = useRef(false);

  // Check if conditions invalidate an existing signal
  const shouldUpdateSignal = useCallback((
    existingSignal: GeneratedSignal,
    newPlan: TradePlan,
    tradeType: 'swing' | 'day',
    currentPrice: number
  ): boolean => {
    const newRec = tradeType === 'swing' ? newPlan.recommendation : newPlan.dayTradeRecommendation;
    
    // If signal is not pending, don't update
    if (existingSignal.outcome !== 'pending') {
      return false;
    }
    
    // Check if direction changed
    if (existingSignal.direction !== newRec.direction) {
      console.log(`Direction changed for ${existingSignal.instrument}: ${existingSignal.direction} -> ${newRec.direction}`);
      return true;
    }
    
    // Check if stop loss was hit
    if (existingSignal.direction === 'bullish' && currentPrice < existingSignal.stop_loss) {
      console.log(`Stop loss hit for bullish ${existingSignal.instrument}`);
      return true;
    }
    if (existingSignal.direction === 'bearish' && currentPrice > existingSignal.stop_loss) {
      console.log(`Stop loss hit for bearish ${existingSignal.instrument}`);
      return true;
    }
    
    // Check if take profit 3 was reached (signal completed)
    if (existingSignal.direction === 'bullish' && currentPrice >= existingSignal.take_profit_3) {
      console.log(`TP3 reached for bullish ${existingSignal.instrument}`);
      return true;
    }
    if (existingSignal.direction === 'bearish' && currentPrice <= existingSignal.take_profit_3) {
      console.log(`TP3 reached for bearish ${existingSignal.instrument}`);
      return true;
    }
    
    // Check if confidence dropped significantly (>20%)
    const confidenceDrop = existingSignal.confidence - newRec.confidence;
    if (confidenceDrop > 20) {
      console.log(`Confidence dropped for ${existingSignal.instrument}: ${existingSignal.confidence} -> ${newRec.confidence}`);
      return true;
    }
    
    return false;
  }, []);

  // Get pending signal for instrument and trade type
  const getPendingSignal = useCallback((
    instrument: TradingInstrument,
    tradeType: 'swing' | 'day'
  ): GeneratedSignal | null => {
    return signals.find(
      s => s.instrument === instrument && 
           s.trade_type === tradeType && 
           s.outcome === 'pending'
    ) || null;
  }, [signals]);

  // Analyze a single instrument
  const analyzeInstrument = useCallback(async (
    instrument: TradingInstrument
  ): Promise<{ swing: boolean; day: boolean; errors: string[] }> => {
    const result = { swing: false, day: false, errors: [] as string[] };
    
    try {
      const [dailyCandles, fourHourCandles, oneHourCandles] = await Promise.all([
        getCandles(instrument, 86400, 200),
        getCandles(instrument, 14400, 300),
        getCandles(instrument, 3600, 200),
      ]);
      
      if (dailyCandles.length < 50 || fourHourCandles.length < 50 || oneHourCandles.length < 30) {
        result.errors.push(`${instrument}: Insufficient candle data`);
        return result;
      }
      
      const closedCandlePrice = fourHourCandles[Math.max(0, fourHourCandles.length - 2)]?.close;
      const currentPrice = closedCandlePrice ?? fourHourCandles[fourHourCandles.length - 1].close;
      const plan = generateTradePlan(instrument, dailyCandles, fourHourCandles, oneHourCandles, currentPrice);
      
      // Check swing trade
      const pendingSwing = getPendingSignal(instrument, 'swing');
      if (plan.recommendation.direction !== 'ranging') {
        if (pendingSwing) {
          if (shouldUpdateSignal(pendingSwing, plan, 'swing', currentPrice)) {
            // Log new signal (old one stays with pending status for manual review)
            await logSignal(instrument, plan.recommendation, 'swing');
            result.swing = true;
          }
          // Else keep existing signal
        } else {
          // No pending signal, create new one
          await logSignal(instrument, plan.recommendation, 'swing');
          result.swing = true;
        }
      }
      
      // Check day trade — skip forex day trades outside kill zones
      const pendingDay = getPendingSignal(instrument, 'day');
      const kzStatus = getKillZoneStatus();
      const isForexOutsideKZ = !isSyntheticIndex(instrument) && !kzStatus.isInKillZone;
      if (plan.dayTradeRecommendation.direction !== 'ranging' && !isForexOutsideKZ) {
        if (pendingDay) {
          if (shouldUpdateSignal(pendingDay, plan, 'day', currentPrice)) {
            await logSignal(instrument, plan.dayTradeRecommendation, 'day');
            result.day = true;
          }
        } else {
          await logSignal(instrument, plan.dayTradeRecommendation, 'day');
          result.day = true;
        }
      }
      
    } catch (err) {
      console.error(`Error analyzing ${instrument}:`, err);
      result.errors.push(`${instrument}: Analysis failed`);
    }
    
    return result;
  }, [getCandles, prices, getPendingSignal, shouldUpdateSignal, logSignal]);

  // Run full analysis cycle for all instruments
  const runFullAnalysis = useCallback(async () => {
    if (isAnalyzingRef.current) {
      console.log('Analysis already in progress, skipping...');
      return;
    }
    
    isAnalyzingRef.current = true;
    const errors: string[] = [];
    let newSignalsCount = 0;
    
    setState(prev => ({
      ...prev,
      isRunning: true,
      analyzedCount: 0,
      errors: [],
    }));
    
    toast.info('Auto-Analysis Started', {
      description: `Analyzing ${ALL_INSTRUMENTS.length} instruments...`,
    });
    
    for (let i = 0; i < ALL_INSTRUMENTS.length; i++) {
      const instrument = ALL_INSTRUMENTS[i];
      
      setState(prev => ({
        ...prev,
        currentlyAnalyzing: instrument,
        analyzedCount: i,
      }));
      
      const result = await analyzeInstrument(instrument);
      errors.push(...result.errors);
      if (result.swing || result.day) newSignalsCount++;
      
      // Small delay between instruments to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    const now = new Date();
    const nextRun = new Date(now.getTime() + AUTO_ANALYSIS_INTERVAL);
    
    setState(prev => ({
      ...prev,
      isRunning: false,
      lastRunTime: now,
      nextRunTime: nextRun,
      currentlyAnalyzing: null,
      analyzedCount: ALL_INSTRUMENTS.length,
      errors,
    }));
    
    isAnalyzingRef.current = false;
    
    // Refresh signals to get updated list
    await refreshSignals();
    
    toast.success('Auto-Analysis Complete', {
      description: `${newSignalsCount} new/updated signals. ${errors.length > 0 ? `${errors.length} errors.` : ''}`,
    });
  }, [analyzeInstrument, refreshSignals]);

  // Toggle auto analysis
  const toggleAutoAnalysis = useCallback((enabled: boolean) => {
    setIsAutoEnabled(enabled);
    localStorage.setItem('autoAnalysisEnabled', enabled.toString());
    
    if (enabled) {
      toast.success('Auto-Analysis Enabled', {
        description: 'Analysis will run every hour automatically',
      });
      // Run immediately when enabled
      runFullAnalysis();
    } else {
      toast.info('Auto-Analysis Disabled');
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setState(prev => ({ ...prev, nextRunTime: null }));
    }
  }, [runFullAnalysis]);

  // Set up interval
  useEffect(() => {
    if (isAutoEnabled && isConnected) {
      // Set up hourly interval
      intervalRef.current = setInterval(() => {
        runFullAnalysis();
      }, AUTO_ANALYSIS_INTERVAL);
      
      // Set initial next run time
      setState(prev => ({
        ...prev,
        nextRunTime: new Date(Date.now() + AUTO_ANALYSIS_INTERVAL),
      }));
      
      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
      };
    }
  }, [isAutoEnabled, isConnected, runFullAnalysis]);

  // Run analysis on initial load if enabled and never ran
  useEffect(() => {
    if (isAutoEnabled && isConnected && !state.lastRunTime && !isAnalyzingRef.current) {
      // Delay initial run to allow prices to load
      const timeout = setTimeout(() => {
        runFullAnalysis();
      }, 5000);
      
      return () => clearTimeout(timeout);
    }
  }, [isAutoEnabled, isConnected, state.lastRunTime, runFullAnalysis]);

  // Check signal outcomes against current prices
  const checkOutcomes = useCallback(async () => {
    if (isCheckingOutcomesRef.current || !isConnected) return;
    
    const pendingCount = getPendingSignals().length;
    if (pendingCount === 0) return;
    
    isCheckingOutcomesRef.current = true;
    
    try {
      const result = await autoCheckOutcomes(prices, (instrument, granularity, count) =>
        getCandles(instrument as TradingInstrument, granularity, count)
      );
      
      if (result.updated > 0) {
        toast.success('Signals Auto-Updated', {
          description: `${result.won} won, ${result.lost} lost based on price action`,
        });
        await refreshSignals();
      }
    } catch (err) {
      console.error('Error checking outcomes:', err);
    } finally {
      isCheckingOutcomesRef.current = false;
    }
  }, [prices, isConnected, autoCheckOutcomes, getPendingSignals, refreshSignals, getCandles]);

  // Set up outcome checking interval
  useEffect(() => {
    if (isAutoEnabled && isConnected) {
      // Check outcomes every 30 seconds
      outcomeCheckRef.current = setInterval(() => {
        checkOutcomes();
      }, OUTCOME_CHECK_INTERVAL);
      
      // Initial check after prices load
      const initialCheck = setTimeout(() => {
        checkOutcomes();
      }, 10000);
      
      return () => {
        if (outcomeCheckRef.current) {
          clearInterval(outcomeCheckRef.current);
        }
        clearTimeout(initialCheck);
      };
    }
  }, [isAutoEnabled, isConnected, checkOutcomes]);

  return {
    state,
    isAutoEnabled,
    toggleAutoAnalysis,
    runFullAnalysis,
    analyzeInstrument,
    checkOutcomes,
  };
};
