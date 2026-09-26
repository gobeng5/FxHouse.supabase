/**
 * Wick-based intrabar resolution.
 *
 * Tick-based checks only ever see the *current* price, so a trade whose stop
 * and target were both traded through inside the same hour is resolved by
 * whichever price happened to be sampled — usually wrong. This module replays
 * 1H OHLC candles and determines which level was touched FIRST using the
 * standard intrabar path assumption:
 *
 *   bullish candle (close >= open): open -> low  -> high -> close
 *   bearish candle (close <  open): open -> high -> low  -> close
 *
 * When both SL and a closing TP sit inside the same candle and the path is
 * ambiguous, we resolve conservatively in favour of the stop loss.
 */

export interface IntrabarCandle {
  open: number;
  high: number;
  low: number;
  close: number;
  epoch: number; // seconds
}

export interface IntrabarSetup {
  direction: 'bullish' | 'bearish';
  entryPrice: number;
  stopLoss: number;
  takeProfit1?: number | null;
  takeProfit2?: number | null;
  takeProfit3?: number | null;
  /** Unix seconds — candles before this are ignored */
  generatedAtEpoch: number;
  /** true if the setup was a pending order that must be filled first */
  requiresFill?: boolean;
  /**
   * Typical spread in absolute price units. When provided, all levels are
   * compared in QUOTE space using the symmetric half-spread convention
   * (see src/lib/spreadConfig.ts): a long's levels shift up by half a spread,
   * a short's levels shift down by half a spread.
   */
  spread?: number;
  /**
   * Volatility multiplier applied to `spread` (synthetics). Should be the
   * multiplier derived from the ATR percentile AT GENERATION TIME, so the
   * adjustment reflects the regime the trade was actually taken in.
   */
  spreadMultiplier?: number;
}

export type IntrabarTarget = 'SL' | 'TP1' | 'TP2' | 'TP3';

export interface IntrabarResolution {
  outcome: 'won' | 'lost' | null;
  targetHit: IntrabarTarget | null;
  exitPrice: number | null;
  /** Unix seconds of the candle that resolved the trade */
  resolvedAtEpoch: number | null;
  entryFilled: boolean;
  entryFilledAtEpoch: number | null;
  tp1Hit: boolean;
  /** true when SL and a closing TP were both inside the resolving candle */
  ambiguous: boolean;
  candlesScanned: number;
  /** Realistic fill price after spread (equals entryPrice when spread is 0) */
  effectiveEntry: number;
  /** Spread used for the adjustment, in absolute price units (already scaled) */
  spreadApplied: number;
  /** Volatility multiplier that was applied to the base spread */
  spreadMultiplierApplied: number;
}


/** Ordered extremes a candle visits, per the path assumption above. */
function candlePath(candle: IntrabarCandle): number[] {
  return candle.close >= candle.open
    ? [candle.open, candle.low, candle.high, candle.close]
    : [candle.open, candle.high, candle.low, candle.close];
}

const touched = (
  direction: 'bullish' | 'bearish',
  level: number,
  price: number,
  isTarget: boolean
): boolean => {
  // For a bullish trade: targets are above (price >= level), stop is below.
  const above = direction === 'bullish' ? isTarget : !isTarget;
  return above ? price >= level : price <= level;
};

/**
 * Replays candles and returns the first level touched, respecting intrabar order.
 */
export function resolveIntrabar(
  setup: IntrabarSetup,
  candles: IntrabarCandle[]
): IntrabarResolution {
  const relevant = candles
    .filter(c => c.epoch >= setup.generatedAtEpoch)
    .sort((a, b) => a.epoch - b.epoch);

  const { direction, entryPrice, stopLoss } = setup;

  // Symmetric half-spread convention (see spreadConfig.ts).
  // Candles are quotes; bid = quote - half, ask = quote + half.
  const spreadMultiplier = setup.spreadMultiplier && setup.spreadMultiplier > 0 ? setup.spreadMultiplier : 1;
  const spread = (setup.spread ?? 0) * spreadMultiplier;
  const shift = direction === 'bullish' ? spread / 2 : -spread / 2;

  // Level a pending order actually fills at, in quote terms:
  // a buy limit fills when the ask reaches it → quote = entry - half.
  const qFill = entryPrice - shift;
  // Realistic fill price paid/received.
  const effEntry = entryPrice + shift;

  const result: IntrabarResolution = {
    outcome: null,
    targetHit: null,
    exitPrice: null,
    resolvedAtEpoch: null,
    entryFilled: !setup.requiresFill,
    entryFilledAtEpoch: null,
    tp1Hit: false,
    ambiguous: false,
    candlesScanned: relevant.length,
    effectiveEntry: effEntry,
    spreadApplied: spread,
    spreadMultiplierApplied: spreadMultiplier,
  };

  // Exits happen at the opposite side of the book, so every level shifts the
  // same way in quote space.
  const qSL = stopLoss + shift;
  const tp1 = setup.takeProfit1 ?? null;
  const tp2 = setup.takeProfit2 ?? null;
  const tp3 = setup.takeProfit3 ?? null;
  const qTP1 = tp1 !== null ? tp1 + shift : null;
  const qTP2 = tp2 !== null ? tp2 + shift : null;
  const qTP3 = tp3 !== null ? tp3 + shift : null;

  for (const candle of relevant) {
    const path = candlePath(candle);

    // Entry fill first — a pending order can only be resolved after it fills.
    if (!result.entryFilled) {
      if (candle.low <= qFill && candle.high >= qFill) {
        result.entryFilled = true;
        result.entryFilledAtEpoch = candle.epoch;
        // Same-candle SL+TP after a fill is ambiguous → resolve to SL below.
      } else {
        continue;
      }
    }

    const slExtreme = direction === 'bullish' ? candle.low : candle.high;
    const slInCandle = touched(direction, qSL, slExtreme, false);

    // Walk the path in order and take the first decisive touch.
    let decided = false;
    for (const price of path) {
      if (!result.tp1Hit && qTP1 !== null && touched(direction, qTP1, price, true)) {
        result.tp1Hit = true; // partial only, does not close
      }

      if (touched(direction, qSL, price, false)) {
        result.outcome = 'lost';
        result.targetHit = 'SL';
        result.exitPrice = stopLoss;
        result.resolvedAtEpoch = candle.epoch;
        decided = true;
        break;
      }

      if (qTP3 !== null && touched(direction, qTP3, price, true)) {
        result.outcome = 'won';
        result.targetHit = 'TP3';
        result.exitPrice = tp3;
        result.resolvedAtEpoch = candle.epoch;
        result.ambiguous = slInCandle;
        decided = true;
        break;
      }

      if (qTP2 !== null && touched(direction, qTP2, price, true)) {
        result.outcome = 'won';
        result.targetHit = 'TP2';
        result.exitPrice = tp2;
        result.resolvedAtEpoch = candle.epoch;
        result.ambiguous = slInCandle;
        decided = true;
        break;
      }
    }

    if (decided) {
      // Conservative override: if the stop was also inside this candle but the
      // assumed path reached the target first, flag it and prefer the stop.
      if (result.outcome === 'won' && result.ambiguous) {
        result.outcome = 'lost';
        result.targetHit = 'SL';
        result.exitPrice = stopLoss;
      }
      break;
    }
  }

  return result;
}


/** Pip size helper mirroring the journal's convention. */
export function pipSize(instrument: string): number {
  const s = instrument.toUpperCase();
  if (s.includes('JPY') || s.includes('XAU') || /^(V\d+|BOOM|CRASH)/.test(s)) return 0.01;
  return 0.0001;
}

export function pipsBetween(
  instrument: string,
  direction: 'bullish' | 'bearish',
  entry: number,
  exit: number
): number {
  const diff = direction === 'bullish' ? exit - entry : entry - exit;
  return diff / pipSize(instrument);
}
