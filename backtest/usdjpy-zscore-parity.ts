/**
 * FxHouse — parity check: the shared evaluateUsdJpyZScore (what the app and engine run)
 * against the research version (zscore-per-pair-design.ts, L20 z2.5 RSI on, H4 trend,
 * TP 1 ATR). Replays it once an hour with the candle windows the engine fetches
 * (200 H1, 250 H4) and follows each market order the same way.
 *
 * Run with:
 *   bun run .\backtest\usdjpy-zscore-parity.ts
 */

import { getVolatilityAdjustedSpread } from '../src/lib/spreadConfig';
import { evaluateUsdJpyZScore } from '../supabase/functions/_shared/analysis/selectiveGems.ts';
import { cleanSeries, firstIndexAtOrAfter, fmtStats, loadData, simulate, stats } from './lib';
import type { Candle, Trade } from './lib';
import { prepare, run, VERSIONS } from './zscore-per-pair-design';

const s = cleanSeries(loadData('./backtest/data.json')['USD/JPY']).series;
const win = (c: Candle[], t: number, n: number) => c.slice(Math.max(0, firstIndexAtOrAfter(c, t) - n), firstIndexAtOrAfter(c, t));
const spread = getVolatilityAdjustedSpread('USD/JPY' as never, null);
const gem: Trade[] = [];
let busy = 0;
for (let g = Math.ceil(s.h1[60].epoch / 3600) * 3600; g < s.m15[s.m15.length - 1].epoch; g += 3600) {
  const t = g + 60;
  if (g < busy) continue;
  const x = evaluateUsdJpyZScore(win(s.h1, t, 200), win(s.h4, t, 250), t);
  if (!x) continue;
  const tr = simulate(s.m15, x.triggerCloseEpoch!, x.entry, x.direction === 'bullish' ? 1 : -1, x.atr, 1, spread, 72);
  if (tr) { gem.push(tr); busy = tr.exitEpoch; }
}
const v = VERSIONS.find(x => x.lookback === 20 && x.threshold === 2.5 && x.rsi && x.trend === 'h4' && x.target === 1)!;
const research = run('USD/JPY', s, prepare(s), v);
console.log(`shared gem  ${fmtStats(stats(gem))}`);
console.log(`research    ${fmtStats(stats(research))}`);
const key = (x: Trade) => `${x.entryEpoch}:${x.dir}`;
const a = new Set(gem.map(key)), b = new Set(research.map(key));
console.log(`only in gem ${[...a].filter(k => !b.has(k)).length} · only in research ${[...b].filter(k => !a.has(k)).length}`);
