import { useMemo, useEffect, useState } from 'react';
import { GeneratedSignal } from '@/hooks/useGeneratedSignals';
import { TradingInstrument } from '@/types/trading';

export type RevalidationStatus = 'valid' | 'stale' | 'drifted' | 'invalidated';

export interface RevalidationResult {
  signal: GeneratedSignal;
  status: RevalidationStatus;
  ageHours: number;
  currentPrice: number | null;
  distanceToEntryPips: number | null;
  reason: string;
  /** Confidence after automatic decay from age, drift and SL proximity */
  decayedConfidence: number;
  /** Points lost vs the original signal confidence */
  confidenceDelta: number;
  decayFactors: { time: number; drift: number; slProximity: number };
  /** Live risk metrics recalculated against the current price */
  liveRiskReward: number | null;
  liveStopDistancePips: number | null;
  liveTargetDistancePips: number | null;
}

// Thresholds (hours) after which a pending signal is considered stale
const STALE_THRESHOLDS: Record<'swing' | 'day', number> = {
  swing: 24,
  day: 4,
};

// Distance from entry (in pips) beyond which a non-filled signal is "drifted"
const DRIFT_THRESHOLD_PIPS: Record<'swing' | 'day', number> = {
  swing: 80,
  day: 40,
};

const getPipMultiplier = (instrument: string) => {
  if (instrument.includes('JPY')) return 100;
  if (instrument === 'XAU/USD' || instrument.toLowerCase().includes('gold')) return 100;
  if (instrument.startsWith('V') || instrument.toLowerCase().includes('volatility')) return 100;
  return 10000;
};

// Confidence half-life (hours): how long before time-decay removes half of its max penalty
const CONFIDENCE_HALF_LIFE: Record<'swing' | 'day', number> = { swing: 18, day: 3 };
const MAX_TIME_PENALTY = 25;
const MAX_DRIFT_PENALTY = 20;
const MAX_SL_PROXIMITY_PENALTY = 12;

/** Re-evaluates confidence + risk metrics from live conditions. Pure. */
const computeDecay = (
  signal: GeneratedSignal,
  currentPrice: number | null,
  ageHours: number,
  distanceToEntryPips: number | null,
  status: RevalidationStatus,
  pipMult: number
) => {
  const halfLife = CONFIDENCE_HALF_LIFE[signal.trade_type] ?? 12;
  // Exponential decay: penalty grows toward MAX_TIME_PENALTY as age accumulates
  const time = MAX_TIME_PENALTY * (1 - Math.pow(0.5, ageHours / halfLife));

  const driftLimit = DRIFT_THRESHOLD_PIPS[signal.trade_type] ?? 60;
  const drift = distanceToEntryPips !== null
    ? Math.min(MAX_DRIFT_PENALTY, (distanceToEntryPips / driftLimit) * MAX_DRIFT_PENALTY)
    : 0;

  // How much of the entry→SL room has already been eaten by adverse movement
  let slProximity = 0;
  let liveRiskReward: number | null = null;
  let liveStopDistancePips: number | null = null;
  let liveTargetDistancePips: number | null = null;

  if (currentPrice !== null) {
    const slRoom = Math.abs(signal.entry_price - signal.stop_loss);
    const adverse = signal.direction === 'bullish'
      ? signal.entry_price - currentPrice
      : currentPrice - signal.entry_price;
    if (slRoom > 0 && adverse > 0) {
      slProximity = Math.min(MAX_SL_PROXIMITY_PENALTY, (adverse / slRoom) * MAX_SL_PROXIMITY_PENALTY);
    }

    const riskNow = Math.abs(currentPrice - signal.stop_loss);
    const rewardNow = Math.abs(signal.take_profit_1 - currentPrice);
    liveStopDistancePips = riskNow * pipMult;
    liveTargetDistancePips = rewardNow * pipMult;
    liveRiskReward = riskNow > 0 ? rewardNow / riskNow : null;
  }

  const base = signal.confidence ?? 0;
  const decayedConfidence = status === 'invalidated'
    ? 0
    : Math.max(0, Math.round(base - time - drift - slProximity));

  return {
    decayedConfidence,
    confidenceDelta: decayedConfidence - base,
    decayFactors: {
      time: Math.round(time),
      drift: Math.round(drift),
      slProximity: Math.round(slProximity),
    },
    liveRiskReward,
    liveStopDistancePips,
    liveTargetDistancePips,
  };
};

/**
 * Re-validates pending signals against current market price + age.
 * Pure derivation — no side effects. Computed on every render from latest props.
 */
export const useSignalRevalidation = (
  signals: GeneratedSignal[],
  prices: Record<string, { price: number }>
): RevalidationResult[] => {
  // Ticks every 30s so decay recalculates automatically without user action
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  return useMemo(() => {
    const pending = signals.filter(s => !s.outcome || s.outcome === 'pending');
    const now = Date.now();

    return pending.map<RevalidationResult>(signal => {
      const priceData = prices[signal.instrument as TradingInstrument];
      const currentPrice = priceData && priceData.price > 0 ? priceData.price : null;
      const generatedAt = new Date(signal.generated_at).getTime();
      const ageHours = (now - generatedAt) / (1000 * 60 * 60);
      const pipMult = getPipMultiplier(signal.instrument);

      let distanceToEntryPips: number | null = null;
      let status: RevalidationStatus = 'valid';
      let reason = 'Setup structurally valid';

      if (currentPrice !== null) {
        distanceToEntryPips = Math.abs(currentPrice - signal.entry_price) * pipMult;

        // Hard invalidation: price has crossed stop-loss before reaching entry
        const slBreached = signal.direction === 'bullish'
          ? currentPrice <= signal.stop_loss
          : currentPrice >= signal.stop_loss;
        if (slBreached) {
          status = 'invalidated';
          reason = 'Stop-loss breached before fill — setup invalidated';
          return {
            signal, status, ageHours, currentPrice, distanceToEntryPips, reason,
            ...computeDecay(signal, currentPrice, ageHours, distanceToEntryPips, status, pipMult),
          };
        }

        // Drift: price moved far away from entry without filling
        const driftLimit = DRIFT_THRESHOLD_PIPS[signal.trade_type] ?? 60;
        if (distanceToEntryPips > driftLimit) {
          status = 'drifted';
          reason = `Price has drifted ${distanceToEntryPips.toFixed(0)} pips from entry — structure likely shifted`;
          return {
            signal, status, ageHours, currentPrice, distanceToEntryPips, reason,
            ...computeDecay(signal, currentPrice, ageHours, distanceToEntryPips, status, pipMult),
          };
        }
      }

      // Stale: signal has been pending too long
      const staleLimit = STALE_THRESHOLDS[signal.trade_type] ?? 12;
      if (ageHours > staleLimit) {
        status = 'stale';
        reason = `Pending for ${ageHours.toFixed(1)}h — re-run analysis to confirm setup`;
      }

      return {
        signal, status, ageHours, currentPrice, distanceToEntryPips, reason,
        ...computeDecay(signal, currentPrice, ageHours, distanceToEntryPips, status, pipMult),
      };
    });
  }, [signals, prices, tick]);
};
