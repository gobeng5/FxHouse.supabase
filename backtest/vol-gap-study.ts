/**
 * FxHouse — can the volatility-arbitrage idea help signal generation?
 *
 * True volatility arbitrage needs option prices (implied volatility). There is
 * no option history here, so this tests the two parts that can be tested:
 *
 *   A. Is there a volatility gap to trade on the synthetics? A Vxx index is
 *      generated at a fixed, published volatility (V75 = 75% a year), so its
 *      realized volatility should sit on that number month after month.
 *
 *   B. Does the gap between short-term and long-term REALIZED volatility work
 *      as an entry filter? vol ratio = stdev of the last 24 H1 log returns /
 *      stdev of the last 480, both from candles closed before entry.
 *      Ratio < 1 is a calm market (the "options look overpriced" side);
 *      ratio > 1 is a market moving more than its norm.
 *      Trades come from the SMC CHoCH + FVG research run and the fixed gem replay.
 *      Bucket edges are terciles of the TRAIN trades only, then applied unchanged
 *      to the holdout. A filter is worth keeping only if the bucket it keeps is
 *      also the better one in the holdout.
 *
 * Input:  ./backtest/data.json
 * Output: console report + ./backtest/vol-gap-results.json
 *
 * Run with:
 *   bun run .\backtest\vol-gap-study.ts
 */

import { writeFileSync } from 'node:fs';
import { TRAIN_END, cleanSeries, firstIndexAtOrAfter, fmtStats, loadData, stats } from './lib';
import type { Candle, Series, Trade } from './lib';
import { PRIMARY, runInstrument } from './smc-choch-fvg';
import { VARIANTS, run as runGem } from './gem-candle-fix-study';

const INPUT = './backtest/data.json';
const OUTPUT = './backtest/vol-gap-results.json';
const SHORT = 24;
const LONG = 480;

const raw = loadData(INPUT);
const clean = new Map<string, Series>();
const series = (inst: string) => {
  if (!clean.has(inst)) clean.set(inst, cleanSeries(raw[inst]).series);
  return clean.get(inst)!;
};

const stdev = (v: number[]) => {
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
};
const logReturns = (c: Candle[]) => c.slice(1).map((x, i) => Math.log(x.close / c[i].close));

// =================== A. synthetic realized vs stated volatility ===================
const NOMINAL: Record<string, number> = { V10: 0.10, V25: 0.25, V50: 0.50, V75: 0.75, V100: 1.00 };
const M15_PER_YEAR = 365 * 96; // synthetics trade around the clock

console.log('A. Synthetic indices — realized volatility (annualized, monthly, from M15 closes) vs stated');
const partA: Record<string, unknown> = {};
for (const inst of ['V10', 'V25', 'V50', 'V75', 'V100', 'BOOM1000']) {
  const m15 = series(inst).m15;
  const byMonth = new Map<string, Candle[]>();
  for (const c of m15) {
    const k = new Date(c.epoch * 1000).toISOString().slice(0, 7);
    if (!byMonth.has(k)) byMonth.set(k, []);
    byMonth.get(k)!.push(c);
  }
  const monthly = [...byMonth.values()].filter(c => c.length > 1000).map(c => stdev(logReturns(c)) * Math.sqrt(M15_PER_YEAR));
  const mean = monthly.reduce((a, b) => a + b, 0) / monthly.length;
  const nominal = NOMINAL[inst];
  const line = `  ${inst.padEnd(9)} stated ${nominal ? (nominal * 100).toFixed(0).padStart(4) + '%' : '    —'}` +
    `  realized mean ${(mean * 100).toFixed(1).padStart(6)}%  monthly range ${(Math.min(...monthly) * 100).toFixed(1)}–${(Math.max(...monthly) * 100).toFixed(1)}%`;
  console.log(line);
  partA[inst] = { nominal: nominal ?? null, realizedMean: mean, monthlyMin: Math.min(...monthly), monthlyMax: Math.max(...monthly), months: monthly.length };
}

// =================== B. realized-vol gap as an entry filter ===================
function volRatio(s: Series, entryEpoch: number): number | null {
  const h1 = s.h1;
  const end = firstIndexAtOrAfter(h1, entryEpoch - 3600 + 1); // H1 bars closed by entry
  if (end < LONG + 1) return null;
  const long = logReturns(h1.slice(end - LONG - 1, end));
  const short = long.slice(-SHORT);
  const sl = stdev(long);
  return sl > 0 ? stdev(short) / sl : null;
}

type Tagged = Trade & { ratio: number };

function report(name: string, tagged: Tagged[]) {
  const train = tagged.filter(t => t.entryEpoch < TRAIN_END);
  const hold = tagged.filter(t => t.entryEpoch >= TRAIN_END);
  const sorted = train.map(t => t.ratio).sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length / 3)];
  const q2 = sorted[Math.floor((2 * sorted.length) / 3)];
  const bucket = (r: number) => (r < q1 ? 'calm' : r < q2 ? 'normal' : 'active');
  const rows: Record<string, unknown> = {};
  console.log(`\n${name}   (bucket edges from train: calm < ${q1?.toFixed(2)} ≤ normal < ${q2?.toFixed(2)} ≤ active)`);
  console.log(`  all trades   train ${fmtStats(stats(train))}`);
  console.log(`               hold  ${fmtStats(stats(hold))}`);
  for (const b of ['calm', 'normal', 'active']) {
    const tr = stats(train.filter(t => bucket(t.ratio) === b));
    const ho = stats(hold.filter(t => bucket(t.ratio) === b));
    console.log(`  ${b.padEnd(7)}      train ${fmtStats(tr)}`);
    console.log(`               hold  ${fmtStats(ho)}`);
    rows[b] = { train: tr, holdout: ho };
  }
  // The filter a trader would pick from train: drop the worst train bucket.
  const worst = (['calm', 'normal', 'active'] as const)
    .map(b => ({ b, r: stats(train.filter(t => bucket(t.ratio) === b)).totalR }))
    .sort((x, y) => x.r - y.r)[0].b;
  const kept = hold.filter(t => bucket(t.ratio) !== worst);
  const base = stats(hold), filt = stats(kept);
  console.log(`  filter "skip ${worst}" (chosen on train) — holdout: ${base.totalR.toFixed(1)}R on ${base.n} → ${filt.totalR.toFixed(1)}R on ${filt.n}`);
  return { edges: [q1, q2], buckets: rows, chosenSkip: worst, holdoutBase: base, holdoutFiltered: filt };
}

const tag = (inst: string, trades: Trade[]): Tagged[] =>
  trades.map(t => ({ ...t, ratio: volRatio(series(inst), t.entryEpoch) ?? NaN })).filter(t => Number.isFinite(t.ratio));

console.log(`\nB. Realized-vol gap filter (ratio = σ last ${SHORT} H1 / σ last ${LONG} H1). Train < ${new Date(TRAIN_END * 1000).toISOString().slice(0, 10)} ≤ holdout`);
const partB: Record<string, unknown> = {};

const smc: Tagged[] = [];
for (const inst of ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'GBP/JPY', 'XAU/USD']) {
  smc.push(...tag(inst, runInstrument(inst, series(inst), PRIMARY)));
}
partB['SMC CHoCH + FVG (6 forex/gold, pooled)'] = report('SMC CHoCH + FVG (6 forex/gold, pooled)', smc);

const gemPicks = [
  'BOOM1000 reference — fixed, run every 15 min',
  'GBP/JPY — fixed (closed 1H)',
  'EUR/USD — fixed (closed D1 + 1H)',
];
const allGems: Tagged[] = [];
for (const name of gemPicks) {
  const v = VARIANTS.find(x => x.name === name)!;
  const tagged = tag(v.instrument, runGem(v, series(v.instrument)).trades);
  allGems.push(...tagged);
  partB[name] = report(name, tagged);
}
partB['All gems pooled'] = report('All gems pooled', allGems);

writeFileSync(OUTPUT, JSON.stringify({ generatedAt: new Date().toISOString(), short: SHORT, long: LONG, partA, partB }, null, 2));
console.log(`\nSaved ${OUTPUT}`);
