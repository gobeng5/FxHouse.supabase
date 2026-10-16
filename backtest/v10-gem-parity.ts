/**
 * FxHouse — parity check: the shared V10 Donchian marubozu gem (what the app and
 * the engine run) against the research version in synthetic-pick-study.ts.
 *
 * Replays the gem once an hour over the saved year, a minute after each hour,
 * with the 200 H1 candles the engine fetches, then follows each market order
 * the way the research version does. Totals must match the study's V10 row.
 *
 * Run with:
 *   bun run .\backtest\v10-gem-parity.ts
 */

import { getVolatilityAdjustedSpread } from '../src/lib/spreadConfig';
import { evaluateV10DonchianMarubozu } from '../supabase/functions/_shared/analysis/selectiveGems.ts';
import { GRANULARITY, cleanSeries, firstIndexAtOrAfter, fmtStats, loadData, simulate, stats } from './lib';
import type { Candle, Series, Trade } from './lib';
import { donchianMarubozu } from './synthetic-pick-study';

const s: Series = cleanSeries(loadData('./backtest/data.json')['V10']).series;
const window = (c: Candle[], t: number, n: number) => c.slice(Math.max(0, firstIndexAtOrAfter(c, t) - n), firstIndexAtOrAfter(c, t));

const spread = getVolatilityAdjustedSpread('V10' as never, null);
const trades: Trade[] = [];
let busyUntil = 0;
for (let grid = Math.ceil(s.h1[0].epoch / 3600) * 3600; grid < s.m15[s.m15.length - 1].epoch; grid += 3600) {
  const t = grid + 60;
  if (grid < busyUntil) continue;
  const h1 = window(s.h1, t, 200);
  if (h1.length < 53) continue; // the research version starts at H1 bar 52
  const g = evaluateV10DonchianMarubozu(h1, t);
  if (!g) continue;
  const entryEpoch = g.triggerCloseEpoch!;
  const dir = g.direction === 'bullish' ? 1 : -1;
  const tr = simulate(s.m15, entryEpoch, g.entry, dir, 1.5 * g.atr, 2.5, spread, 72);
  if (tr) { trades.push(tr); busyUntil = tr.exitEpoch; }
}
const research = donchianMarubozu('V10', s);
console.log(`shared gem  ${fmtStats(stats(trades))}`);
console.log(`research    ${fmtStats(stats(research))}`);
const key = (x: Trade) => `${x.entryEpoch}:${x.dir}:${x.exit}`;
const a = new Set(trades.map(key)), b = new Set(research.map(key));
console.log(`only in gem ${[...a].filter(k => !b.has(k)).length} · only in research ${[...b].filter(k => !a.has(k)).length}`);
const d = (e: number) => new Date(e * 1000).toISOString().slice(0, 16);
for (const k of [...b].filter(k => !a.has(k))) console.log('research only', d(+k.split(':')[0]), k);
for (const k of [...a].filter(k => !b.has(k))) console.log('gem only', d(+k.split(':')[0]), k);
