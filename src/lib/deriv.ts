import { TradingInstrument } from '@/types/trading';

// Deriv's current public market-data endpoint requires no authentication.
// Keep the legacy app-id endpoints as fallbacks for environments where needed.
export const DERIV_WS_BASE_URLS = [
  'wss://api.derivws.com/trading/v1/options/ws/public',
  'wss://ws.derivws.com/websockets/v3',
  'wss://ws.binaryws.com/websockets/v3',
] as const;

// Deriv app_id. Newer Deriv registrations may issue alphanumeric client IDs,
// which work fine as the `app_id` query parameter. Override via env if desired.
export const DEFAULT_DERIV_APP_ID: string | number =
  import.meta.env?.VITE_DERIV_APP_ID ?? '33WEdZurDjmrV0NAA8yZC';

export const getDerivWsUrl = (appId: string | number, baseIndex: number) => {
  const base = DERIV_WS_BASE_URLS[Math.max(0, Math.min(baseIndex, DERIV_WS_BASE_URLS.length - 1))];
  if (base.includes('/ws/public')) {
    return base;
  }
  return `${base}?app_id=${appId}`;
};

// Map our trading instruments to Deriv symbols
export const DERIV_SYMBOL_MAP: Record<TradingInstrument, string> = {
  // Forex pairs
  'EUR/USD': 'frxEURUSD',
  'GBP/USD': 'frxGBPUSD',
  'USD/JPY': 'frxUSDJPY',
  'AUD/USD': 'frxAUDUSD',
  'GBP/JPY': 'frxGBPJPY',
  'XAU/USD': 'frxXAUUSD',
  // Synthetic indices (trade 24/7)
  'V10': 'R_10',
  'V25': 'R_25',
  'V50': 'R_50',
  'V75': 'R_75',
  'V100': 'R_100',
  'BOOM1000': 'BOOM1000',
};

// Display names for instruments
export const INSTRUMENT_DISPLAY_NAMES: Record<TradingInstrument, string> = {
  'EUR/USD': 'EUR/USD',
  'GBP/USD': 'GBP/USD',
  'USD/JPY': 'USD/JPY',
  'AUD/USD': 'AUD/USD',
  'GBP/JPY': 'GBP/JPY',
  'XAU/USD': 'Gold (XAU/USD)',
  'V10': 'Volatility 10',
  'V25': 'Volatility 25',
  'V50': 'Volatility 50',
  'V75': 'Volatility 75',
  'V100': 'Volatility 100',
  'BOOM1000': 'Boom 1000',
};
