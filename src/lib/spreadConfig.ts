/**
 * Per-instrument spread configuration.
 *
 * ---------------------------------------------------------------------------
 * QUOTING CONVENTION (used consistently in every file that imports this)
 * ---------------------------------------------------------------------------
 * Deriv streams a single quote per symbol (`ticks_history` / candles), which is
 * the mid/spot price. The tradable bid and ask sit symmetrically around it:
 *
 *     ask = quote + spread / 2
 *     bid = quote - spread / 2
 *
 * Therefore we use the SYMMETRIC HALF-SPREAD convention:
 *
 *     buy  → effective entry = entry + spread / 2      (you pay the ask)
 *     sell → effective entry = entry - spread / 2      (you receive the bid)
 *
 * The same shift applies to exits, because a long is closed at the bid and a
 * short at the ask. Expressed in QUOTE space (the space candles live in), every
 * level of a long shifts UP by half a spread and every level of a short shifts
 * DOWN by half a spread:
 *
 *     long : SL/TP in quote terms = level + spread / 2
 *     short: SL/TP in quote terms = level - spread / 2
 *
 * Net effect: spread is paid once on entry and once on exit, exactly as in a
 * real round trip.
 * ---------------------------------------------------------------------------
 *
 * Values below are TYPICAL spreads in ABSOLUTE PRICE UNITS (index points for
 * synthetics, price units for FX/gold). Edit these to match your own broker /
 * account tier — nothing else in the app hardcodes a spread.
 */

export interface SpreadSpec {
  /** Typical spread in absolute price units (not pips). */
  spread: number;
  /** Human-readable note about where the number comes from. */
  note: string;
}

export const SPREAD_TABLE: Record<string, SpreadSpec> = {
  // ---- Forex majors (standard-account typical spreads, pip = 0.0001) -------
  'EUR/USD': { spread: 0.00008, note: '0.8 pips typical' },
  'GBP/USD': { spread: 0.00012, note: '1.2 pips typical' },
  'AUD/USD': { spread: 0.00011, note: '1.1 pips typical' },

  // ---- JPY crosses (pip = 0.01) -------------------------------------------
  'USD/JPY': { spread: 0.010, note: '1.0 pip typical' },
  'GBP/JPY': { spread: 0.025, note: '2.5 pips typical' },

  // ---- Metals -------------------------------------------------------------
  'XAU/USD': { spread: 0.30, note: '$0.30 / 30 points typical' },

  // ---- Deriv synthetic indices (published typical spreads, index points) --
  'V10': { spread: 0.02, note: 'Deriv Volatility 10 — 0.02 points' },
  'V25': { spread: 0.10, note: 'Deriv Volatility 25 — 0.10 points' },
  'V50': { spread: 0.60, note: 'Deriv Volatility 50 — 0.60 points' },
  'V75': { spread: 2.50, note: 'Deriv Volatility 75 — 2.50 points' },
  'V100': { spread: 1.20, note: 'Deriv Volatility 100 — 1.20 points' },
  'BOOM1000': { spread: 0.60, note: 'Deriv Boom 1000 — 0.60 points' },
};

/** Fallback when an instrument is not in the table (conservative, 1 pip FX). */
const DEFAULT_SPREAD = 0.0001;

/** Spread in absolute price units for an instrument. */
export function getSpread(instrument: string): number {
  return SPREAD_TABLE[instrument]?.spread ?? DEFAULT_SPREAD;
}

/** Half spread — the per-side cost under the symmetric convention. */
export function getHalfSpread(instrument: string): number {
  return getSpread(instrument) / 2;
}

/**
 * Signed half spread for a direction: +half for longs, -half for shorts.
 * Add this to any theoretical level to move it into realistic quote space.
 */
export function spreadShift(instrument: string, direction: 'bullish' | 'bearish'): number {
  return direction === 'bullish' ? getHalfSpread(instrument) : -getHalfSpread(instrument);
}

/** Realistic fill price for the signal's entry. */
export function effectiveEntry(
  instrument: string,
  direction: 'bullish' | 'bearish',
  entry: number
): number {
  return entry + spreadShift(instrument, direction);
}

/**
 * Risk/reward computed from the realistic fill instead of the theoretical entry.
 * Exits are realised at the raw SL/TP (bid for a long, ask for a short), so only
 * the entry moves — which is what shrinks R:R.
 */
export function effectiveRR(
  instrument: string,
  direction: 'bullish' | 'bearish',
  entry: number,
  stopLoss: number,
  target: number
): number {
  const fill = effectiveEntry(instrument, direction, entry);
  const risk = Math.abs(fill - stopLoss);
  const reward = Math.abs(target - fill);
  return risk > 0 ? reward / risk : 0;
}

/* ===========================================================================
 * VOLATILITY-SCALED SPREAD (synthetics only)
 * ===========================================================================
 * The static table above is a *normal-conditions* spread. On Deriv synthetic
 * indices the quoted spread genuinely widens during displacement/spike moves,
 * so a flat value understates cost exactly when the trade is most likely to be
 * filled badly. We scale it by where current volatility sits in its own recent
 * distribution — the ATR percentile — rather than pretending to model
 * tick-level slippage (we have no order-book data for that).
 *
 * Bands (chosen over the simpler 50/80 → 1.0/1.5/2.5 split):
 *
 *   percentile < 50      → x1.0   normal regime, table value as-is
 *   50 <= p < 80         → x1.4   elevated but orderly
 *   80 <= p < 95         → x2.0   displacement regime
 *   p >= 95              → x3.0   spike / tail regime
 *
 * Why four bands: a single x2.5 across everything above the 80th percentile
 * overcharges the 80–95 range (where widening is real but moderate) and
 * undercharges the top 5%, which is where the actual fill damage happens on
 * V75/V100. Splitting the tail keeps the average cost close to the 3-band
 * version while putting the penalty where the evidence is.
 * Forex/metals are left at x1.0 — their measured gap was an order of magnitude
 * smaller and does not justify a regime model.
 * ========================================================================= */

export interface VolatilityBand {
  /** Inclusive lower bound of the ATR percentile band. */
  minPercentile: number;
  multiplier: number;
  label: string;
}

export const VOLATILITY_BANDS: VolatilityBand[] = [
  { minPercentile: 95, multiplier: 3.0, label: 'spike' },
  { minPercentile: 80, multiplier: 2.0, label: 'displacement' },
  { minPercentile: 50, multiplier: 1.4, label: 'elevated' },
  { minPercentile: 0, multiplier: 1.0, label: 'normal' },
];

/** True for Deriv synthetic indices (V10/V25/.../BOOM/CRASH). */
export function isVolatilityScaledInstrument(instrument: string): boolean {
  return /^(V\d+|BOOM|CRASH)/i.test(instrument);
}

/** Multiplier for an ATR percentile (0-100). Null/undefined → 1.0. */
export function getSpreadMultiplier(atrPercentile?: number | null): number {
  if (atrPercentile == null || !Number.isFinite(atrPercentile)) return 1;
  const band = VOLATILITY_BANDS.find(b => atrPercentile >= b.minPercentile);
  return band ? band.multiplier : 1;
}

/** Band label for an ATR percentile, for reasoning/audit strings. */
export function getVolatilityBandLabel(atrPercentile?: number | null): string {
  if (atrPercentile == null || !Number.isFinite(atrPercentile)) return 'unknown';
  return VOLATILITY_BANDS.find(b => atrPercentile >= b.minPercentile)?.label ?? 'normal';
}

/**
 * Spread scaled by the volatility regime. Synthetics only — forex and metals
 * return the static table value unchanged.
 */
export function getVolatilityAdjustedSpread(
  instrument: string,
  atrPercentile?: number | null
): number {
  const base = getSpread(instrument);
  if (!isVolatilityScaledInstrument(instrument)) return base;
  return base * getSpreadMultiplier(atrPercentile);
}

/** The multiplier that was actually applied for this instrument (1.0 for FX). */
export function appliedSpreadMultiplier(
  instrument: string,
  atrPercentile?: number | null
): number {
  return isVolatilityScaledInstrument(instrument) ? getSpreadMultiplier(atrPercentile) : 1;
}

interface OHLC { high: number; low: number; close: number }

/**
 * Percentile rank (0-100) of the most recent ATR against its own trailing
 * distribution. Reuses candles already fetched for analysis — no extra pull.
 *
 * @param candles  1H candles, oldest → newest
 * @param period   ATR period (14)
 * @param lookback how many trailing ATR readings form the distribution (200)
 */
export function computeAtrPercentile(
  candles: OHLC[],
  period = 14,
  lookback = 200
): number | null {
  if (!candles || candles.length < period + 2) return null;

  // True range series
  const tr: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prevClose = candles[i - 1].close;
    tr.push(
      Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - prevClose),
        Math.abs(candles[i].low - prevClose)
      )
    );
  }
  if (tr.length < period) return null;

  // Rolling simple ATR series
  const atrs: number[] = [];
  let sum = 0;
  for (let i = 0; i < tr.length; i++) {
    sum += tr[i];
    if (i >= period) sum -= tr[i - period];
    if (i >= period - 1) atrs.push(sum / period);
  }
  if (atrs.length < 20) return null;

  const window = atrs.slice(-lookback);
  const current = window[window.length - 1];
  const below = window.filter(v => v < current).length;
  return (below / window.length) * 100;
}

/** Realistic fill using an explicit spread (e.g. the volatility-adjusted one). */
export function effectiveEntryWithSpread(
  direction: 'bullish' | 'bearish',
  entry: number,
  spread: number
): number {
  return entry + (direction === 'bullish' ? spread / 2 : -spread / 2);
}

/** R:R from the realistic fill, using an explicit spread. */
export function effectiveRRWithSpread(
  direction: 'bullish' | 'bearish',
  entry: number,
  stopLoss: number,
  target: number,
  spread: number
): number {
  const fill = effectiveEntryWithSpread(direction, entry, spread);
  const risk = Math.abs(fill - stopLoss);
  const reward = Math.abs(target - fill);
  return risk > 0 ? reward / risk : 0;
}
