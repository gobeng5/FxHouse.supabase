import { useState, useCallback, useRef } from 'react';
import { TradePlan, TradingInstrument } from '@/types/trading';
import { CandleData } from '@/hooks/useDerivAPI';

interface CachedSignal {
  tradePlan: TradePlan;
  dailyCandles: CandleData[];
  fourHourCandles: CandleData[];
  oneHourCandles: CandleData[];
  generatedAt: number;
  fourHourWindow: number; // Which 4H window this was generated in
}

interface SignalCache {
  [instrument: string]: CachedSignal;
}

/**
 * Get the current 4-hour window index.
 * Signals generated in the same 4H window are considered equivalent.
 * This prevents re-analysis from producing different results due to tick-level candle changes.
 */
const get4HWindow = (): number => {
  const now = Date.now();
  // 4 hours = 14400000 ms
  return Math.floor(now / 14400000);
};

/**
 * Hook to cache trade signals and ensure consistency
 * Signals are only regenerated when a new 4H candle period begins
 */
export const useSignalCache = () => {
  const cacheRef = useRef<SignalCache>({});
  const [lastCacheUpdate, setLastCacheUpdate] = useState<Record<string, number>>({});

  /**
   * Cheap synchronous lookup meant to be called BEFORE any network fetch,
   * so a cache hit costs zero requests.
   */
  const hasFreshSignal = useCallback((instrument: TradingInstrument): boolean => {
    const cached = cacheRef.current[instrument];
    return !!cached && cached.fourHourWindow === get4HWindow();
  }, []);

  const getCachedSignal = useCallback((
    instrument: TradingInstrument,
  ): CachedSignal | null => {
    const cached = cacheRef.current[instrument];
    if (!cached) return null;

    // Check if we're still in the same 4H window
    const currentWindow = get4HWindow();
    if (cached.fourHourWindow === currentWindow) {
      return cached;
    }
    
    return null;
  }, []);

  const setCachedSignal = useCallback((
    instrument: TradingInstrument,
    tradePlan: TradePlan,
    dailyCandles: CandleData[],
    fourHourCandles: CandleData[],
    oneHourCandles: CandleData[]
  ): void => {
    cacheRef.current[instrument] = {
      tradePlan,
      dailyCandles,
      fourHourCandles,
      oneHourCandles,
      generatedAt: Date.now(),
      fourHourWindow: get4HWindow(),
    };
    
    setLastCacheUpdate(prev => ({
      ...prev,
      [instrument]: Date.now(),
    }));
  }, []);

  const clearCache = useCallback((instrument?: TradingInstrument) => {
    if (instrument) {
      delete cacheRef.current[instrument];
      setLastCacheUpdate(prev => {
        const next = { ...prev };
        delete next[instrument];
        return next;
      });
    } else {
      cacheRef.current = {};
      setLastCacheUpdate({});
    }
  }, []);

  const getCacheInfo = useCallback((instrument: TradingInstrument) => {
    const cached = cacheRef.current[instrument];
    if (!cached) return null;
    
    return {
      generatedAt: new Date(cached.generatedAt),
      fourHourWindow: cached.fourHourWindow,
      age: Date.now() - cached.generatedAt,
    };
  }, []);

  return {
    getCachedSignal,
    hasFreshSignal,
    setCachedSignal,
    clearCache,
    getCacheInfo,
    lastCacheUpdate,
  };
};