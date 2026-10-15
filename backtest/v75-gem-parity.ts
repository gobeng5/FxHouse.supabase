/**
 * FxHouse — parity check: the shared V75 inside-bar gem (what the app and the
 * engine run) against the research version in synthetic-pick-study.ts.
 *
 * Replays the gem once an hour over the saved year, a minute after each hour,
 * with the candle windows the engine fetches, then follows each pending order
 * the way the research version does. Totals must match the study's
 * "pending at broken level" row.
 *
 * Run with:
 *   bun run .\backtest\v75-gem-parity.ts
 */

import { getVolatilityAdjustedSpread } from '../src/lib/spreadConfig';
import { evaluateV75InsideBar } from '../supabase/functions/_shared/analysis/selectiveGems.ts';
import { GRANULARITY, atrPercentileSeries, atrSeries, cleanSeries, firstIndexAtOrAfter, fmtStats, loadData, simulate, stats } from './lib';
import type { Candle, Series, Trade } from './lib';
import { lastCompleted } from './strategy-candidates';
import { insideBarHourly } from './synthetic-pick-study';

const s: Series = cleanSeries(loadData('./backtest/data.json')['V75']).series;
const window = (c: Candle[], g: number, t: number, n: number) => c.slice(Math.max(0, firstIndexAtOrAfter(c, t) - n), firstIndexAtOrAfter(c, t));

const atrPct = atrPercentileSeries(atrSeries(s.h1));
const trades: Trade[] = [];
let busyUntil = 0;
for (let grid = Math.ceil(s.m15[0].epoch / 3600) * 3600; grid < s.m15[s.m15.length - 1].epoch; grid += 3600) {
  const t = grid + 60;
  if (t < busyUntil) continue;
  const g = evaluateV75InsideBar(window(s.h4, GRANULARITY.h4, t, 250), window(s.h1, GRANULARITY.h1, t, 200), window(s.m15, GRANULARITY.m15, t, 60), t);
  if (!g) continue;
  const i = lastCompleted(s.h1, GRANULARITY.h1, t);
  if (i < 220) continue; // the research version needs 220 H1 bars for the ATR percentile
  const spread = getVolatilityAdjustedSpread('V75' as never, atrPct[i]);
  const dir = g.direction === 'bullish' ? 1 : -1;
  for (let j = firstIndexAtOrAfter(s.m15, Math.floor(t / 900) * 900); j < s.m15.length && s.m15[j].epoch < t + 4 * 3600; j++) {
    const c = s.m15[j];
    if (c.low <= g.entry && c.high >= g.entry) {
      const tr = simulate(s.m15, c.epoch, g.entry, dir, Math.abs(g.entry - g.stopLoss), Math.abs(g.takeProfit - g.entry) / Math.abs(g.entry - g.stopLoss), spread, 48);
      if (tr) { trades.push(tr); busyUntil = tr.exitEpoch; }
      break;
    }
  }
}
const research = insideBarHourly('V75', s, 'level');
console.log(`shared gem  ${fmtStats(stats(trades))}`);
console.log(`research    ${fmtStats(stats(research))}`);
const key = (x: Trade) => `${x.entryEpoch}:${x.dir}:${x.exit}`;
const a = new Set(trades.map(key)), b = new Set(research.map(key));
console.log(`only in gem ${[...a].filter(k => !b.has(k)).length} · only in research ${[...b].filter(k => !a.has(k)).length}`);
const d = (e: number) => new Date(e * 1000).toISOString().slice(0, 16);
for (const k of [...b].filter(k => !a.has(k))) { const e = +k.split(':')[0]; console.log('research only', d(e), k, 'gem near:', trades.filter(x => Math.abs(x.entryEpoch - e) < 86400).map(x => d(x.entryEpoch) + ' ' + x.dir).join(', ')); }
for (const k of [...a].filter(k => !b.has(k))) console.log('gem only', d(+k.split(':')[0]), k);
