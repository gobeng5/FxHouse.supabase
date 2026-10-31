/**
 * Runtime-neutral primitives shared by the web app (Vite) and the signal engine (Deno).
 * No imports allowed here — this file must load unchanged in both runtimes.
 */
export interface CandleData { open: number; high: number; low: number; close: number; epoch: number }

/** Forex, metals and the US100 index: the real-market instruments (the app's "forex" tab). */
export type CurrencyPair = 'EUR/USD' | 'GBP/USD' | 'USD/JPY' | 'AUD/USD' | 'GBP/JPY' | 'XAU/USD' | 'XAG/USD' | 'US100';
export type SyntheticIndex = 'V10' | 'V25' | 'V50' | 'V75' | 'V100' | 'BOOM1000';
export type TradingInstrument = CurrencyPair | SyntheticIndex;

export const FOREX_PAIRS: CurrencyPair[] = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'GBP/JPY', 'XAU/USD', 'XAG/USD', 'US100'];
/** Every synthetic index, including V50 and V100, which are no longer offered but still appear in old signals. */
export const SYNTHETIC_INDICES: SyntheticIndex[] = ['V10', 'V25', 'V50', 'V75', 'V100', 'BOOM1000'];
/** Synthetics the app lists and analyses. V50 and V100 were replaced by XAG/USD and US100. */
export const ACTIVE_SYNTHETICS: SyntheticIndex[] = ['V10', 'V25', 'V75', 'BOOM1000'];
export const ALL_INSTRUMENTS: TradingInstrument[] = [...FOREX_PAIRS, ...ACTIVE_SYNTHETICS];

export const isSyntheticIndex = (instrument: TradingInstrument | string): instrument is SyntheticIndex =>
  SYNTHETIC_INDICES.includes(instrument as SyntheticIndex);

export const getInstrumentDecimals = (instrument: TradingInstrument): number => {
  if (isSyntheticIndex(instrument)) return 2;
  if (instrument === 'USD/JPY' || instrument === 'GBP/JPY') return 2;
  if (instrument === 'XAU/USD' || instrument === 'US100') return 2;
  if (instrument === 'XAG/USD') return 3;
  return 4;
};

export type TrendDirection = 'bullish' | 'bearish' | 'ranging';
export type MarketPhase = 'trending' | 'consolidation' | 'reversal' | 'breakout';

export interface PriceLevel {
  price: number;
  type: 'resistance' | 'support' | 'entry' | 'stop_loss' | 'take_profit';
  description: string;
  strength: 'strong' | 'moderate' | 'weak';
}
