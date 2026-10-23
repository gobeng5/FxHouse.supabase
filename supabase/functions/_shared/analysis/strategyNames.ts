/**
 * Display names for strategies (setup_type) and how each one enters, for Telegram
 * alerts and the app — one table so the engine, the app and every alert agree.
 *
 * Runtime-neutral: no imports (runs in both Vite and Deno).
 */

const NAMES: Record<string, string> = {
  smc_choch_fvg: 'SMC CHoCH + FVG',
  gem_v75_insidebar: 'V75 Inside-Bar Breakout',
  gem_v10_donchian: 'V10 Donchian Breakout',
  gem_eurusd_zscore: 'EUR/USD Z-Score Reversion',
  gem_gbpjpy_momentum: 'GBP/JPY Momentum',
  gem_boom1000_momentum: 'BOOM1000 Momentum',
  trend_continuation: 'Trend Continuation',
  reversal: 'Reversal',
  breakout: 'Breakout',
  range: 'Range',
};

const ORDER: Record<string, string> = {
  smc_choch_fvg: 'limit order',
  gem_v75_insidebar: 'pending order',
  gem_v10_donchian: 'market order',
  gem_eurusd_zscore: 'market order',
  gem_gbpjpy_momentum: 'market order',
  gem_boom1000_momentum: 'market order',
};

/** "V75 Inside-Bar Breakout"; unknown types are title-cased from the slug. */
export const strategyName = (setupType: string | null | undefined): string =>
  (setupType && NAMES[setupType]) ??
  String(setupType ?? 'Signal').replace(/^gem_/, '').split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

/** "V75 Inside-Bar Breakout (pending order)". */
export const strategyLabel = (setupType: string | null | undefined): string =>
  setupType && ORDER[setupType] ? `${strategyName(setupType)} (${ORDER[setupType]})` : strategyName(setupType);

/** Alert header, e.g. "FxHouse · Day trade". */
export const alertHeader = (tradeType: string | null | undefined): string =>
  `FxHouse · ${tradeType === 'day' ? 'Day trade' : 'Swing trade'}`;
