/**
 * FxHouse — parity check for the day-trade shadow gems (gold Asian breakout, V75 H1 inside
 * bar): the shared evaluators replayed once an hour, a minute after the hour, with the
 * candle windows the engine fetches (120 M15, 200 H1). Writes the signals to
 * backtest/py/out/day_gems_ts.json for backtest/py/day_gems_parity.py.
 *
 * Run with:
 *   bun run .\backtest\day-gems-parity.ts
 */
import { writeFileSync } from 'node:fs';
import { evaluateV75InsideBarH1, evaluateXauAsianBreakout } from '../supabase/functions/_shared/analysis/selectiveGems.ts';
import { cleanSeries, firstIndexAtOrAfter, loadData } from './lib';

const data = loadData('./backtest/data.json');
const out: Record<string, { gen: number; trigger: number; dir: number; entry: number; stop: number; target: number }[]> = {};
for (const [inst, run] of [
  ['XAU/USD', (s: any, now: number) => { const e = firstIndexAtOrAfter(s.m15, now); return evaluateXauAsianBreakout(s.m15.slice(Math.max(0, e - 120), e), now); }],
  ['V75', (s: any, now: number) => { const e = firstIndexAtOrAfter(s.h1, now); return evaluateV75InsideBarH1(s.h1.slice(Math.max(0, e - 200), e), now); }],
] as const) {
  const s = cleanSeries(data[inst]).series;
  out[inst] = [];
  for (let t = Math.ceil(s.h1[0].epoch / 3600) * 3600 + 3600; t < s.h1[s.h1.length - 1].epoch; t += 3600) {
    const g = run(s, t + 60);
    if (g) out[inst].push({ gen: t, trigger: g.triggerCloseEpoch!, dir: g.direction === 'bullish' ? 1 : -1, entry: g.entry, stop: g.stopLoss, target: g.takeProfit });
  }
  console.log(`${inst}: ${out[inst].length} signals`);
}
writeFileSync('./backtest/py/out/day_gems_ts.json', JSON.stringify(out));
