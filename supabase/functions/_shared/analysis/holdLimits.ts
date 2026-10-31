/**
 * Longest a filled trade stays open before it is closed at market ("time exit").
 *
 * The research for each rule closed trades still open after these hours, and the
 * backtest results include those exits; without them a stalled trade holds its
 * pair slot (and the user's risk) forever. Both outcome resolvers — the engine's
 * and the web app's — read this table, so a stored outcome is the same whichever
 * one resolved it.
 *
 * Runtime-neutral: no imports (runs in both Vite and Deno).
 */

const HOLD_HOURS_BY_SETUP: Record<string, number> = {
  smc_choch_fvg: 72,          // backtest/smc-choch-fvg.ts, 72h trade limit
  gem_v75_insidebar: 48,      // backtest/synthetic-pick-study.ts
  gem_v10_donchian: 72,       // backtest/synthetic-pick-study.ts
  gem_v10_star: 168,          // backtest/research-agent.ts (H4 rules, 7 days)
  gem_boom1000_donchian: 168, // backtest/research-agent.ts (H4 rules, 7 days)
  gem_xag_donchian: 168,      // backtest/candidate-instruments-study.ts
  smc_choch_fvg_us100: 72,    // the SMC rule unchanged
  gem_eurusd_zscore: 120,     // backtest/forwardtest-2.1.ts, swing
  gem_usdjpy_zscore: 72,      // backtest/zscore-per-pair-design.ts
  gem_gbpjpy_momentum: 120,   // backtest/forwardtest-2.1.ts, swing
  gem_boom1000_momentum: 48,  // backtest/forwardtest-2.1.ts, day
};

/** Scored strategies had no tested limit; these match the forward test's defaults. */
const DEFAULT_HOLD_HOURS = { day: 48, swing: 120 } as const;

export const maxHoldHours = (setupType: string | null | undefined, tradeType: string | null | undefined): number =>
  (setupType && HOLD_HOURS_BY_SETUP[setupType]) ?? (tradeType === 'day' ? DEFAULT_HOLD_HOURS.day : DEFAULT_HOLD_HOURS.swing);
