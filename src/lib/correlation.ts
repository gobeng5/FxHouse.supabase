import { TradingInstrument, isSyntheticIndex } from '@/types/trading';
import { supabase } from '@/integrations/supabase/client';

/**
 * Correlation pairs are stored in the database (`public.correlation_pairs`) and are the
 * SINGLE SOURCE OF TRUTH for both the app and the Postgres arbitration function
 * (`public.arbitrate_signal`). There is deliberately no hardcoded copy in the codebase —
 * client and server must never be able to drift on this list again.
 */
export interface CorrelationPair {
  pair1: TradingInstrument;
  pair2: TradingInstrument;
  correlation: 'positive' | 'negative';
}

export interface SignalDirection {
  instrument: TradingInstrument;
  direction: 'bullish' | 'bearish' | 'ranging';
  confidence: number;
}

export interface CorrelationConflict {
  pair1: TradingInstrument;
  pair2: TradingInstrument;
  correlation: 'positive' | 'negative';
  conflict: string;
  severity: 'warning' | 'critical';
}

let pairsPromise: Promise<CorrelationPair[]> | null = null;

/** Loads the correlation table once per session. Returns [] if it cannot be read. */
export const fetchCorrelationPairs = (): Promise<CorrelationPair[]> => {
  if (!pairsPromise) {
    pairsPromise = (async (): Promise<CorrelationPair[]> => {
      const { data, error } = await supabase
        .from('correlation_pairs')
        .select('pair_1, pair_2, correlation');
      if (error || !data) {
        console.error('Failed to load correlation pairs:', error);
        pairsPromise = null; // allow a retry later
        return [];
      }
      return data.map(r => ({
        pair1: r.pair_1 as TradingInstrument,
        pair2: r.pair_2 as TradingInstrument,
        correlation: r.correlation as 'positive' | 'negative',
      }));
    })();
  }
  return pairsPromise;
};

/**
 * Check for conflicting signals between correlated pairs.
 * `pairs` must come from the database (see fetchCorrelationPairs / useCorrelationPairs).
 */
export const checkCorrelationConflicts = (
  activeSignals: SignalDirection[],
  pairs: CorrelationPair[]
): CorrelationConflict[] => {
  const conflicts: CorrelationConflict[] = [];
  const signalMap = new Map<TradingInstrument, SignalDirection>();

  activeSignals
    .filter(s => s.direction !== 'ranging' && !isSyntheticIndex(s.instrument))
    .forEach(s => signalMap.set(s.instrument, s));

  for (const { pair1, pair2, correlation } of pairs) {
    const s1 = signalMap.get(pair1);
    const s2 = signalMap.get(pair2);

    if (!s1 || !s2) continue;

    const isConflict = correlation === 'positive'
      ? s1.direction !== s2.direction  // Positively correlated pairs should move same way
      : s1.direction === s2.direction; // Negatively correlated pairs should move opposite

    if (isConflict) {
      const avgConfidence = (s1.confidence + s2.confidence) / 2;
      conflicts.push({
        pair1,
        pair2,
        correlation,
        conflict: correlation === 'positive'
          ? `${pair1} is ${s1.direction} but ${pair2} is ${s2.direction} — these pairs are positively correlated and should move together`
          : `${pair1} is ${s1.direction} and ${pair2} is ${s2.direction} — these pairs are negatively correlated and should move opposite`,
        severity: avgConfidence >= 70 ? 'critical' : 'warning',
      });
    }
  }

  return conflicts;
};

/**
 * Get a correlation risk score (0-100) based on how many conflicts exist.
 * Higher = more risk from conflicting signals.
 */
export const getCorrelationRiskScore = (conflicts: CorrelationConflict[]): number => {
  if (conflicts.length === 0) return 0;
  const criticalCount = conflicts.filter(c => c.severity === 'critical').length;
  const warningCount = conflicts.filter(c => c.severity === 'warning').length;
  return Math.min(100, criticalCount * 35 + warningCount * 15);
};
