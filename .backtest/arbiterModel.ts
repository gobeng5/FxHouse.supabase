/**
 * BACKTEST-ONLY MODEL of the arbiter.
 *
 * The authoritative implementation is the Postgres function `public.arbitrate_signal`,
 * which both the app and the signal-engine call at runtime. This file exists solely so the
 * offline walk-forward harness can arbitrate a simulated pending book without a database
 * round-trip per candidate. It is NOT imported by any application code.
 *
 * Parity with the database function was verified on the live pending book
 * (336/336 candidate cases identical, including cancel-id sets) — re-verify if either side changes.
 *
 * Rules mirrored:
 *   1. ONE ACTIVE SETUP PER PAIR — at most one pending signal per instrument.
 *   2. NO CONFLICTING PENDING SIGNALS — opposing directions on the same pair, or directional
 *      conflicts across correlated pairs (correlation list loaded from the database).
 */

import { TradingInstrument } from '@/types/trading';
import { checkCorrelationConflicts, SignalDirection, CorrelationPair, fetchCorrelationPairs } from '@/lib/correlation';

let pairs: CorrelationPair[] = [];
/** Load the correlation list from the database before running the harness. */
export const loadCorrelationPairsForHarness = async () => { pairs = await fetchCorrelationPairs(); return pairs; };

export interface PendingSignalLike {
  id: string;
  instrument: string;
  direction: 'bullish' | 'bearish' | 'ranging';
  trade_type: 'swing' | 'day';
  confidence: number;
}

export interface ArbiterCandidate {
  instrument: TradingInstrument;
  direction: 'bullish' | 'bearish' | 'ranging';
  tradeType: 'swing' | 'day';
  confidence: number;
}

export interface ArbiterVerdict {
  /** Whether the candidate signal may be persisted */
  allowed: boolean;
  /** Human readable explanation of the decision */
  reason: string;
  /** Machine-readable decision code */
  code:
    | 'approved'
    | 'ranging'
    | 'duplicate_direction'
    | 'pair_slot_taken'
    | 'weaker_reversal'
    | 'correlation_conflict';
  /** Existing pending signal ids that must be cancelled if the candidate is approved */
  cancelIds: string[];
}

/** Minimum confidence edge a reversal must have to replace an existing setup */
export const REVERSAL_CONFIDENCE_EDGE = 5;

export const arbitrateSignal = (
  candidate: ArbiterCandidate,
  pendingSignals: PendingSignalLike[]
): ArbiterVerdict => {
  if (candidate.direction === 'ranging') {
    return { allowed: false, reason: 'Direction is ranging — no setup to arbitrate.', code: 'ranging', cancelIds: [] };
  }

  const samePair = pendingSignals.filter(
    s => s.instrument === candidate.instrument && s.direction !== 'ranging'
  );

  // ---- Rule 1 & 2: one active setup per pair, no opposing pending signals ----
  if (samePair.length > 0) {
    const sameDirection = samePair.filter(s => s.direction === candidate.direction);
    const opposing = samePair.filter(s => s.direction !== candidate.direction);

    if (sameDirection.length > 0) {
      const sameType = sameDirection.find(s => s.trade_type === candidate.tradeType);
      return {
        allowed: false,
        reason: sameType
          ? `A pending ${candidate.direction} ${candidate.tradeType} setup already exists on ${candidate.instrument}.`
          : `${candidate.instrument} already has an active ${sameDirection[0].direction} ${sameDirection[0].trade_type} setup — one setup per pair.`,
        code: sameType ? 'duplicate_direction' : 'pair_slot_taken',
        cancelIds: [],
      };
    }

    // Opposing pending signal(s): only a materially stronger reversal replaces them
    const strongestOpposing = opposing.reduce((a, b) => (b.confidence > a.confidence ? b : a));
    if (candidate.confidence < strongestOpposing.confidence + REVERSAL_CONFIDENCE_EDGE) {
      return {
        allowed: false,
        reason: `Conflicts with a pending ${strongestOpposing.direction} setup on ${candidate.instrument} (${strongestOpposing.confidence}% vs ${candidate.confidence}%) — blocked.`,
        code: 'weaker_reversal',
        cancelIds: [],
      };
    }

    // Stronger reversal wins: cancel every existing pending setup on the pair
    const correlationVerdict = checkCorrelation(candidate, pendingSignals, samePair.map(s => s.id));
    if (!correlationVerdict.allowed) return correlationVerdict;

    return {
      allowed: true,
      reason: `Reversal confirmed (${candidate.confidence}% vs ${strongestOpposing.confidence}%) — replacing existing ${candidate.instrument} setup.`,
      code: 'approved',
      cancelIds: samePair.map(s => s.id),
    };
  }

  // ---- Rule 3: correlated-pair directional conflicts ----
  return checkCorrelation(candidate, pendingSignals, []);
};

const checkCorrelation = (
  candidate: ArbiterCandidate,
  pendingSignals: PendingSignalLike[],
  ignoreIds: string[]
): ArbiterVerdict => {
  const others: SignalDirection[] = pendingSignals
    .filter(s => !ignoreIds.includes(s.id) && s.instrument !== candidate.instrument && s.direction !== 'ranging')
    .map(s => ({
      instrument: s.instrument as TradingInstrument,
      direction: s.direction as 'bullish' | 'bearish',
      confidence: s.confidence,
    }));

  const conflicts = checkCorrelationConflicts([
    ...others,
    { instrument: candidate.instrument, direction: candidate.direction as 'bullish' | 'bearish', confidence: candidate.confidence },
  ], pairs).filter(c => c.pair1 === candidate.instrument || c.pair2 === candidate.instrument);

  const critical = conflicts.find(c => c.severity === 'critical');
  if (critical) {
    return {
      allowed: false,
      reason: `Correlation conflict: ${critical.conflict}`,
      code: 'correlation_conflict',
      cancelIds: [],
    };
  }

  return { allowed: true, reason: 'No conflicts — setup approved.', code: 'approved', cancelIds: ignoreIds };
};
