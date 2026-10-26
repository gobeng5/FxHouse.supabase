/**
 * Strategy health and market regime — what Yaw reports each day.
 *
 * Benchmarks are each live strategy's one-year backtest (data.json, costs on,
 * one trade at a time), measured with the same research runners the parity checks
 * use: average R, its standard deviation, the worst losing streak, and the average
 * R by volatility regime at entry (H1 ATR percentile: quiet < 25 <= normal < 75 <= wild).
 *
 * A strategy's live average R is judged against a 95% band around its backtest
 * average: expected ± 2 × sd / √n. The band is wide while trades are few, so a
 * verdict below 30 trades only fires on a result that is bad even for a small sample.
 *
 * Runtime-neutral: no imports (runs in both Vite and Deno).
 */

export interface Benchmark {
  label: string;
  /** Live since (UTC ISO); trades before it ran on older rules. */
  liveSince: string;
  avgR: number;
  sdR: number;
  winRate: number;
  worstLosingStreak: number;
  /** Backtest trades per year, for context. */
  tradesPerYear: number;
  byRegime: Record<Regime, { n: number; avgR: number }>;
}

export type Regime = 'quiet' | 'normal' | 'wild';

export const BENCHMARKS: Record<string, Benchmark> = {
  gem_v75_insidebar: {
    label: 'V75 inside-bar', liveSince: '2026-10-15T21:00:00Z', avgR: 0.476, sdR: 1.431, winRate: 52.1, worstLosingStreak: 5, tradesPerYear: 96,
    byRegime: { quiet: { n: 22, avgR: 0.612 }, normal: { n: 44, avgR: 0.121 }, wild: { n: 30, avgR: 0.898 } },
  },
  gem_v10_star: {
    label: 'V10 Star', liveSince: '2026-10-23T22:00:00Z', avgR: 0.409, sdR: 1.499, winRate: 47.7, worstLosingStreak: 3, tradesPerYear: 44,
    byRegime: { quiet: { n: 8, avgR: -0.625 }, normal: { n: 20, avgR: 1.25 }, wild: { n: 16, avgR: -0.124 } },
  },
  // ---- Shadow strategies: forward test only, signals to the admin marked "do not trade" ----
  gem_xag_donchian: {
    label: 'Silver Donchian (shadow)', liveSince: '2026-10-26T12:00:00Z', avgR: 0.587, sdR: 1.899, winRate: 45.3, worstLosingStreak: 3, tradesPerYear: 53,
    byRegime: { quiet: { n: 8, avgR: 0.99 }, normal: { n: 21, avgR: 0.501 }, wild: { n: 24, avgR: 0.528 } },
  },
  smc_choch_fvg_us100: {
    label: 'US100 SMC (shadow)', liveSince: '2026-10-26T12:00:00Z', avgR: 0.91, sdR: 1.619, winRate: 66.7, worstLosingStreak: 1, tradesPerYear: 12,
    byRegime: { quiet: { n: 5, avgR: 1.194 }, normal: { n: 5, avgR: 0.794 }, wild: { n: 2, avgR: 0.493 } },
  },
  gem_boom1000_donchian: {
    label: 'BOOM1000 Donchian', liveSince: '2026-10-23T22:00:00Z', avgR: 0.559, sdR: 1.934, winRate: 39.6, worstLosingStreak: 5, tradesPerYear: 48,
    byRegime: { quiet: { n: 14, avgR: 0.427 }, normal: { n: 12, avgR: 0.998 }, wild: { n: 22, avgR: 0.403 } },
  },
  smc_choch_fvg: {
    label: 'SMC (6 pairs)', liveSince: '2026-10-11T13:00:00Z', avgR: 0.392, sdR: 1.509, winRate: 49.2, worstLosingStreak: 6, tradesPerYear: 59,
    byRegime: { quiet: { n: 14, avgR: 0.206 }, normal: { n: 35, avgR: 0.441 }, wild: { n: 10, avgR: 0.484 } },
  },
  gem_eurusd_zscore: {
    label: 'EUR/USD Z-score', liveSince: '2026-10-17T08:00:00Z', avgR: 0.126, sdR: 1.335, winRate: 45.7, worstLosingStreak: 3, tradesPerYear: 35,
    byRegime: { quiet: { n: 6, avgR: -0.209 }, normal: { n: 12, avgR: -0.447 }, wild: { n: 17, avgR: 0.649 } },
  },
};

/** Which strategies trade each live instrument, for the regime notes. */
export const STRATEGIES_BY_INSTRUMENT: Record<string, string[]> = {
  V75: ['gem_v75_insidebar'],
  V10: ['gem_v10_star'],
  BOOM1000: ['gem_boom1000_donchian'],
  'EUR/USD': ['smc_choch_fvg', 'gem_eurusd_zscore'],
  'GBP/USD': ['smc_choch_fvg'], 'USD/JPY': ['smc_choch_fvg'], 'AUD/USD': ['smc_choch_fvg'],
  'GBP/JPY': ['smc_choch_fvg'], 'XAU/USD': ['smc_choch_fvg'],
};

/** Deriv's stated annual volatility for the indices (V10 = 10%, ...). */
export const STATED_VOLATILITY: Record<string, number> = { V10: 0.10, V75: 0.75 };

export const MIN_TRADES_FOR_VERDICT = 30;

export type HealthStatus = 'OK' | 'OK (too early)' | 'WATCH' | 'FAILING' | 'NO TRADES';

export interface Health {
  setupType: string;
  label: string;
  n: number;
  liveAvgR: number | null;
  expected: number;
  lower: number | null;
  upper: number | null;
  status: HealthStatus;
  /** Current run of losses, newest trades last in the input. */
  currentLosingStreak: number;
  worstLosingStreak: number;
  streakBeyondBacktest: boolean;
}

/** `rs`: R of the strategy's closed live trades, oldest first. */
export function healthOf(setupType: string, rs: number[]): Health {
  const b = BENCHMARKS[setupType];
  const n = rs.length;
  let streak = 0;
  for (let k = n - 1; k >= 0 && rs[k] <= 0; k--) streak++;
  const base = { setupType, label: b.label, n, expected: b.avgR, currentLosingStreak: streak, worstLosingStreak: b.worstLosingStreak, streakBeyondBacktest: streak > b.worstLosingStreak };
  if (!n) return { ...base, liveAvgR: null, lower: null, upper: null, status: 'NO TRADES' };
  const avg = rs.reduce((x, y) => x + y, 0) / n;
  const half = (2 * b.sdR) / Math.sqrt(n);
  const lower = b.avgR - half, upper = b.avgR + half;
  const status: HealthStatus = avg < lower ? 'FAILING'
    : n < MIN_TRADES_FOR_VERDICT ? 'OK (too early)'
    : avg < b.avgR ? 'WATCH' : 'OK';
  return { ...base, liveAvgR: avg, lower, upper, status };
}

export const regimeOf = (percentile: number): Regime => (percentile >= 75 ? 'wild' : percentile < 25 ? 'quiet' : 'normal');

/** ATR(14) percentile (0-100) of each H1 bar against its trailing 200 readings, as the engine measures it. */
export function atrPercentiles(h1: { high: number; low: number; close: number }[]): number[] {
  const atr: number[] = new Array(h1.length).fill(NaN);
  const tr: number[] = [0];
  let sum = 0;
  for (let i = 1; i < h1.length; i++) {
    const pc = h1[i - 1].close;
    tr.push(Math.max(h1[i].high - h1[i].low, Math.abs(h1[i].high - pc), Math.abs(h1[i].low - pc)));
    sum += tr[i];
    if (i > 14) sum -= tr[i - 14];
    if (i >= 14) atr[i] = sum / 14;
  }
  return atr.map((a, i) => {
    if (Number.isNaN(a) || i < 214) return NaN;
    const window = atr.slice(i - 200, i);
    return (window.filter(x => x <= a).length / window.length) * 100;
  });
}

/** Annualised realised volatility from H1 log returns. */
export function realisedVolatility(closes: number[]): number | null {
  if (closes.length < 25) return null;
  const r = closes.slice(1).map((c, i) => Math.log(c / closes[i]));
  const m = r.reduce((x, y) => x + y, 0) / r.length;
  const sd = Math.sqrt(r.reduce((x, y) => x + (y - m) ** 2, 0) / (r.length - 1));
  return sd * Math.sqrt(24 * 365);
}
