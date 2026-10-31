/**
 * FxHouse — parity check for the GBP/USD z-score fallback: the shared evaluateGbpUsdZScore
 * (what the engine and the app run) replayed hourly over the saved year with the 200 H1
 * candles the engine fetches. Writes every signal to backtest/py/out/gbpusd_zscore_ts.json;
 * backtest/py/fx_gbpusd_parity.py compares them with the Python test.
 *
 * Run with:
 *   bun run .\backtest\gbpusd-zscore-parity.ts
 */
import { writeFileSync } from 'node:fs';
import { evaluateGbpUsdZScore } from '../supabase/functions/_shared/analysis/selectiveGems.ts';
import { cleanSeries, firstIndexAtOrAfter, loadData } from './lib';

const s = cleanSeries(loadData('./backtest/data.json')['GBP/USD']).series;
const out: { trigger: number; dir: number; entry: number; stop: number; target: number }[] = [];
for (let k = 0; k < s.h1.length; k++) {
  const now = s.h1[k].epoch + 3600 + 60;
  const end = firstIndexAtOrAfter(s.h1, now);
  const g = evaluateGbpUsdZScore(s.h1.slice(Math.max(0, end - 200), end), now);
  if (g) out.push({ trigger: g.triggerCloseEpoch!, dir: g.direction === 'bullish' ? 1 : -1, entry: g.entry, stop: g.stopLoss, target: g.takeProfit });
}
writeFileSync('./backtest/py/out/gbpusd_zscore_ts.json', JSON.stringify(out));
console.log(`${out.length} signals`);
