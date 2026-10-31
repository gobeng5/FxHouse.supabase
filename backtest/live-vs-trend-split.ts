/**
 * FxHouse — live strategies on the same train/holdout split as the SSRN trend test
 * (backtest/py/ssrn_trend_holdout.py): first 60% of each instrument's year = train,
 * last 40% = holdout. Live rules unchanged:
 *   XAU/USD, AUD/USD, GBP/USD  — SMC CHoCH + FVG (PRIMARY, with costs)
 *   V10                        — V10 Star (H4 star reversal, TP 2R), as replayed in new-gems-parity.ts
 *
 * Run with:
 *   bun run .\backtest\live-vs-trend-split.ts
 */

import { cleanSeries, loadData, simulate, stats, firstIndexAtOrAfter } from './lib';
import type { Candle, Series, Trade } from './lib';
import { PRIMARY, runInstrument } from './smc-choch-fvg';
import { evaluateV10StarReversal } from '../supabase/functions/_shared/analysis/selectiveGems.ts';
import { getVolatilityAdjustedSpread } from '../src/lib/spreadConfig';

const raw = loadData('./backtest/data.json');
const sign = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(3)}`;

function line(label: string, ts: { r: number }[]) {
  const s = stats(ts as Trade[]);
  return `${label} n ${String(s.n).padStart(3)}  win ${s.winRate.toFixed(0).padStart(3)}%  exp ${sign(s.avgR)}R  total ${sign(s.totalR)}R  t ${s.t.toFixed(2)}  DD ${s.maxDrawdownR.toFixed(1)}R`;
}

function v10Star(s: Series): Trade[] {
  const spread = getVolatilityAdjustedSpread('V10' as never, null);
  const win = (c: Candle[], t: number, n: number) => c.slice(Math.max(0, firstIndexAtOrAfter(c, t) - n), firstIndexAtOrAfter(c, t));
  const out: Trade[] = [];
  let busy = 0;
  for (let g = Math.ceil(s.h4[0].epoch / 3600) * 3600; g < s.m15[s.m15.length - 1].epoch; g += 3600) {
    if (g < busy) continue;
    const gem = evaluateV10StarReversal(win(s.h4, g + 60, 250), g + 60);
    if (!gem) continue;
    const tr = simulate(s.m15, gem.triggerCloseEpoch!, gem.entry, gem.direction === 'bullish' ? 1 : -1, Math.abs(gem.entry - gem.stopLoss), 2, spread, 168);
    if (tr) { out.push(tr); busy = tr.exitEpoch; }
  }
  return out;
}

for (const inst of ['XAU/USD', 'AUD/USD', 'GBP/USD', 'V10']) {
  const s = cleanSeries(raw[inst]).series;
  const from = s.h1[0].epoch, to = s.h1[s.h1.length - 1].epoch, cut = from + (to - from) * 0.6;
  const ts: { entryEpoch: number; r: number }[] = inst === 'V10' ? v10Star(s) : runInstrument(inst, s, PRIMARY);
  const label = inst === 'V10' ? 'V10 Star' : 'SMC CHoCH+FVG';
  console.log(`\n=== ${inst} — ${label}  holdout from ${new Date(cut * 1000).toISOString().slice(0, 10)}`);
  console.log('  ' + line('full   ', ts));
  console.log('  ' + line('train  ', ts.filter(t => t.entryEpoch < cut)));
  console.log('  ' + line('holdout', ts.filter(t => t.entryEpoch >= cut)));
}
