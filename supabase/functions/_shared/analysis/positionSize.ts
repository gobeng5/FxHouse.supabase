/**
 * Suggested lot size for a signal on Deriv MT5, risking a share of the balance.
 *
 *   lots = (balance × risk%) ÷ (|entry − stop| × value of a 1.0 price move per lot)
 *
 * rounded DOWN to the lot step, so the real risk never exceeds the target. When
 * even the minimum lot risks more than the target, no size is suggested and the
 * risk of the minimum lot is reported instead.
 *
 * Contract sizes and lot limits are Deriv MT5's usual values. Deriv does not
 * publish a fixed sheet and can change them per symbol and account type, so every
 * suggestion tells the user to check the symbol's Specification in MT5.
 * Account currency is assumed to be USD.
 *
 * Runtime-neutral: no imports (runs in both Vite and Deno).
 */

interface ContractSpec {
  /** Units per 1.0 lot. */
  contractSize: number;
  /** 'USD' when the quote currency is USD; 'JPY' needs a USD/JPY rate to convert. */
  quote: 'USD' | 'JPY';
  minLot: number;
  lotStep: number;
}

const FOREX_USD: ContractSpec = { contractSize: 100_000, quote: 'USD', minLot: 0.01, lotStep: 0.01 };
const FOREX_JPY: ContractSpec = { contractSize: 100_000, quote: 'JPY', minLot: 0.01, lotStep: 0.01 };

export const CONTRACT_SPECS: Record<string, ContractSpec> = {
  'EUR/USD': FOREX_USD,
  'GBP/USD': FOREX_USD,
  'AUD/USD': FOREX_USD,
  'USD/JPY': FOREX_JPY,
  'GBP/JPY': FOREX_JPY,
  'XAU/USD': { contractSize: 100, quote: 'USD', minLot: 0.01, lotStep: 0.01 },
  'XAG/USD': { contractSize: 5_000, quote: 'USD', minLot: 0.01, lotStep: 0.01 },
  US100: { contractSize: 1, quote: 'USD', minLot: 0.1, lotStep: 0.1 },
  V10: { contractSize: 1, quote: 'USD', minLot: 0.5, lotStep: 0.01 },
  V75: { contractSize: 1, quote: 'USD', minLot: 0.001, lotStep: 0.001 },
};

/** Synthetics not in the table: Deriv prices them in USD, one unit per lot. */
const SYNTHETIC_FALLBACK: ContractSpec = { contractSize: 1, quote: 'USD', minLot: 0.01, lotStep: 0.01 };

/** Used for GBP/JPY when no live USD/JPY rate is passed. */
export const FALLBACK_USDJPY = 150;

export interface LotSuggestion {
  /** Lots to trade (0 when below the minimum lot). */
  lots: number;
  /** Target risk in USD (balance × risk%). */
  riskAmount: number;
  /** Risk of the suggested lots in USD (≤ riskAmount after rounding down). */
  actualRisk: number;
  actualRiskPercent: number;
  minLot: number;
  lotStep: number;
  /** True when the minimum lot already risks more than the target. */
  belowMin: boolean;
  /** Risk of one minimum lot, as % of the balance. */
  minLotRiskPercent: number;
  /** True when a JPY pair was converted at the fallback rate instead of a live one. */
  usedFallbackRate: boolean;
}

export function suggestLots(p: {
  instrument: string;
  entry: number;
  stopLoss: number;
  balance: number;
  riskPercent: number;
  /** Live USD/JPY rate; needed for GBP/JPY (USD/JPY uses its own entry). */
  usdJpy?: number | null;
}): LotSuggestion | null {
  const distance = Math.abs(p.entry - p.stopLoss);
  if (!(p.balance > 0) || !(p.riskPercent > 0) || !(distance > 0)) return null;
  const spec = CONTRACT_SPECS[p.instrument] ?? (p.instrument.includes('/') ? null : SYNTHETIC_FALLBACK);
  if (!spec) return null;

  let usdPerQuote = 1, usedFallbackRate = false;
  if (spec.quote === 'JPY') {
    const rate = p.instrument === 'USD/JPY' ? p.entry : p.usdJpy && p.usdJpy > 0 ? p.usdJpy : (usedFallbackRate = true, FALLBACK_USDJPY);
    usdPerQuote = 1 / rate;
  }
  const riskPerLot = distance * spec.contractSize * usdPerQuote;
  const riskAmount = p.balance * (p.riskPercent / 100);

  // Round down to the step; the epsilon keeps 0.29999… from becoming 0.28.
  const steps = Math.floor(riskAmount / riskPerLot / spec.lotStep + 1e-9);
  let lots = Number((steps * spec.lotStep).toFixed(6));
  const belowMin = lots < spec.minLot;
  if (belowMin) lots = 0;
  const actualRisk = lots * riskPerLot;
  return {
    lots, riskAmount, actualRisk,
    actualRiskPercent: (actualRisk / p.balance) * 100,
    minLot: spec.minLot, lotStep: spec.lotStep, belowMin,
    minLotRiskPercent: ((spec.minLot * riskPerLot) / p.balance) * 100,
    usedFallbackRate,
  };
}

/**
 * P&L in USD of a closed trade from its lot size, with the same contract table:
 * direction × (exit − entry) × contract size × lots, JPY converted to USD.
 * Null for an instrument with no known contract.
 */
export function tradePnlUsd(p: {
  instrument: string; direction: 1 | -1; entry: number; exit: number; lots: number; usdJpy?: number | null;
}): number | null {
  const spec = CONTRACT_SPECS[p.instrument] ?? (p.instrument.includes('/') ? null : SYNTHETIC_FALLBACK);
  if (!spec || !(p.lots > 0)) return null;
  const usdPerQuote = spec.quote === 'JPY' ? 1 / (p.instrument === 'USD/JPY' ? p.exit : p.usdJpy && p.usdJpy > 0 ? p.usdJpy : FALLBACK_USDJPY) : 1;
  return p.direction * (p.exit - p.entry) * spec.contractSize * p.lots * usdPerQuote;
}

const stepDecimals = (step: number) => Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
const usd = (v: number) => `$${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

/** One line for alerts and cards, e.g. "0.12 lots (risk $49.80 = 1.0% of $5,000)". */
export function formatLotSuggestion(s: LotSuggestion, balance: number): string {
  if (s.belowMin) {
    return `below the ${s.minLot.toFixed(stepDecimals(s.lotStep))} minimum lot — the minimum lot risks ${s.minLotRiskPercent.toFixed(1)}% of ${usd(balance)}`;
  }
  return `${s.lots.toFixed(stepDecimals(s.lotStep))} lots (risk ${usd(s.actualRisk)} = ${s.actualRiskPercent.toFixed(1)}% of ${usd(balance)})`;
}
