/**
 * FxHouse — parity check for the two gems adopted from Esi's research run:
 * the shared evaluateV10StarReversal / evaluateBoom1000Donchian (what the app and
 * the engine run) against the research rules they came from.
 *
 * Replays each gem once an hour over the saved year, a minute after each hour, with
 * the 250 H4 candles the engine fetches, and follows each market order the way the
 * research does (same spread, one trade at a time). Totals must match.
 *
 * Run with:
 *   bun run .\backtest\new-gems-parity.ts
 */

import { getVolatilityAdjustedSpread } from '../src/lib/spreadConfig';
import { evaluateBoom1000Donchian, evaluateV10StarReversal } from '../supabase/functions/_shared/analysis/selectiveGems.ts';
import { cleanSeries, firstIndexAtOrAfter, fmtStats, loadData, simulate, stats } from './lib';
import type { Candle, Series, Trade } from './lib';
import { candlePattern, starReversal } from './unserved-synthetics-study';
import { donchian } from './research-agent';

const raw = loadData('./backtest/data.json');
const window = (c: Candle[], t: number, n: number) => c.slice(Math.max(0, firstIndexAtOrAfter(c, t) - n), firstIndexAtOrAfter(c, t));

function replay(instrument: string, s: Series, evaluate: (h4: Candle[], t: number) => ReturnType<typeof evaluateV10StarReversal>, tpR: number): Trade[] {
  const spread = getVolatilityAdjustedSpread(instrument as never, null);
  const trades: Trade[] = [];
  let busyUntil = 0;
  for (let grid = Math.ceil(s.h4[0].epoch / 3600) * 3600; grid < s.m15[s.m15.length - 1].epoch; grid += 3600) {
    const t = grid + 60;
    if (grid < busyUntil) continue;
    const g = evaluate(window(s.h4, t, 250), t);
    if (!g) continue;
    const stopDist = Math.abs(g.entry - g.stopLoss);
    const tr = simulate(s.m15, g.triggerCloseEpoch!, g.entry, g.direction === 'bullish' ? 1 : -1, stopDist, tpR, spread, 168);
    if (tr) { trades.push(tr); busyUntil = tr.exitEpoch; }
  }
  return trades;
}

function compare(label: string, gem: Trade[], research: Trade[]) {
  console.log(`\n${label}\n  shared gem  ${fmtStats(stats(gem))}\n  research    ${fmtStats(stats(research))}`);
  const key = (x: Trade) => `${x.entryEpoch}:${x.dir}:${x.exit}`;
  const a = new Set(gem.map(key)), b = new Set(research.map(key));
  console.log(`  only in gem ${[...a].filter(k => !b.has(k)).length} · only in research ${[...b].filter(k => !a.has(k)).length}`);
}

const v10 = cleanSeries(raw['V10']).series;
compare('V10 H4 star reversal (TP 2R)', replay('V10', v10, evaluateV10StarReversal, 2), candlePattern('V10', v10, 'h4', starReversal, 2));
const boom = cleanSeries(raw['BOOM1000']).series;
compare('BOOM1000 H4 Donchian (40 / 60% body / 1.2 ATR / TP 3R)', replay('BOOM1000', boom, evaluateBoom1000Donchian, 3), donchian('h4', 40, 0.6, 1.2, 3)('BOOM1000', boom));
