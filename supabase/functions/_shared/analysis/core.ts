/**
 * Runtime-neutral primitives shared by the web app (Vite) and the signal engine (Deno).
 * No imports allowed here — this file must load unchanged in both runtimes.
 */
export interface CandleData { open: number; high: number; low: number; close: number; epoch: number }

export type CurrencyPair = 'EUR/USD' | 'GBP/USD' | 'USD/JPY' | 'AUD/USD' | 'GBP/JPY' | 'XAU/USD';
export type SyntheticIndex = 'V10' | 'V25' | 'V50' | 'V75' | 'V100' | 'BOOM1000';
export type TradingInstrument = CurrencyPair | SyntheticIndex;

export const FOREX_PAIRS: CurrencyPair[] = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'GBP/JPY', 'XAU/USD'];
export const SYNTHETIC_INDICES: SyntheticIndex[] = ['V10', 'V25', 'V50', 'V75', 'V100', 'BOOM1000'];
export const ALL_INSTRUMENTS: TradingInstrument[] = [...FOREX_PAIRS, ...SYNTHETIC_INDICES];

export const isSyntheticIndex = (instrument: TradingInstrument | string): instrument is SyntheticIndex =>
  SYNTHETIC_INDICES.includes(instrument as SyntheticIndex);

export const getInstrumentDecimals = (instrument: TradingInstrument): number => {
  if (isSyntheticIndex(instrument)) return 2;
  if (instrument === 'USD/JPY' || instrument === 'GBP/JPY') return 2;
  if (instrument === 'XAU/USD') return 2;
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
