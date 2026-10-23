/**
 * FxHouse — does the V10 Donchian marubozu gem enter late?
 *
 * The rule waits for an H1 candle to close beyond the 20-hour range with a big
 * body, then buys/sells at that close. By then the move may be spent. Three checks
 * on the saved year (same rule, costs and one-trade-at-a-time as the live gem):
 *
 *   1. Stretch: do entries far beyond the broken level (in ATR) lose more?
 *   2. Acting late: a user who reads the alert and enters 5 / 15 / 30 / 60 minutes
 *      after the close, at the price then, with the alert's stop and target.
 *   3. Entering better: a limit order back at the breakout level, or at the middle
 *      of the signal candle's body, live 4 hours, same stop and target.
 *
 * All variants keep the alert's absolute stop and target, so results are in R of
 * the alert's risk (what a user sizing from the alert gains or loses).
 *
 * Run with:
 *   bun run .\backtest\v10-late-entry-study.ts
 */

import { writeFileSync } from 'node:fs';
import { getVolatilityAdjustedSpread } from '../src/lib/spreadConfig';
import { GRANULARITY, atrSeries, cleanSeries, firstIndexAtOrAfter, fmtStats, loadData, simulate, stats } from './lib';
import type { Candle, Trade } from './lib';

const SPLIT = Date.UTC(2026, 4, 1) / 1000;
type Dir = 1 | -1;

interface Signal { close: number; epoch: number; dir: Dir; atr: number; level: number; bodyMid: number; stretchAtr: number; rangeAtr: number }

const s = cleanSeries(loadData('./backtest/data.json')['V10']).series;
const h1 = s.h1, m15 = s.m15, atr = atrSeries(h1, 14);
const spread = getVolatilityAdjustedSpread('V10' as never, null);

// The live rule (selectiveGems.ts evaluateV10DonchianMarubozu), every signal before slot handling.
const signals: Signal[] = [];
for (let i = 52; i < h1.length - 1; i++) {
  const c = h1[i], a = atr[i];
  if (!a) continue;
  const range = c.high - c.low, body = Math.abs(c.close - c.open);
  if (range < 0.8 * a || body / range < 0.7) continue;
  let hi = -Infinity, lo = Infinity;
  for (let k = 1; k <= 20; k++) { hi = Math.max(hi, h1[i - k].high); lo = Math.min(lo, h1[i - k].low); }
  const dir: Dir | 0 = c.close > hi && c.close > c.open ? 1 : c.close < lo && c.close < c.open ? -1 : 0;
  if (!dir) continue;
  const level = dir === 1 ? hi : lo;
  signals.push({ close: c.close, epoch: c.epoch + GRANULARITY.h1, dir, atr: a, level, bodyMid: (c.open + c.close) / 2, stretchAtr: (dir * (c.close - level)) / a, rangeAtr: range / a });
}

/** Alert levels: SL 1.5 ATR, TP 2.5R from the signal close. */
const levels = (g: Signal) => ({ sl: g.close - g.dir * 1.5 * g.atr, tp: g.close + g.dir * 3.75 * g.atr, risk: 1.5 * g.atr });

/** A trade entered at `price` / `epoch` with the alert's absolute stop and target, in R of the alert's risk. */
function tradeAt(g: Signal, epoch: number, price: number): Trade | null {
  const { sl, tp, risk } = levels(g);
  const stopDist = g.dir * (price - sl), reward = g.dir * (tp - price);
  if (!(stopDist > 0) || !(reward > 0)) return null; // price already through a level: no trade
  const t = simulate(m15, epoch, price, g.dir, stopDist, reward / stopDist, spread, 72);
  return t ? { ...t, r: (t.r * stopDist) / risk } : null;
}

type Entry = (g: Signal) => Trade | null;

function run(entry: Entry): { trades: Trade[]; skipped: number } {
  const trades: Trade[] = [];
  let busyUntil = 0, skipped = 0;
  for (const g of signals) {
    if (g.epoch < busyUntil) continue;
    const t = entry(g);
    if (!t) { skipped++; continue; }
    trades.push(t);
    busyUntil = t.exitEpoch;
  }
  return { trades, skipped };
}

const atClose: Entry = g => tradeAt(g, g.epoch, g.close);

/** Market entry `minutes` after the close, at the M15 price then (open of that M15 candle or its later quarter). */
const late = (minutes: number): Entry => g => {
  const t = g.epoch + minutes * 60;
  const k = firstIndexAtOrAfter(m15, Math.floor(t / 900) * 900);
  const c = m15[k];
  if (!c) return null;
  // Inside a 15-minute candle, approximate the price by interpolating open -> close.
  const frac = (t - c.epoch) / 900;
  const price = c.open + (c.close - c.open) * Math.min(1, Math.max(0, frac));
  return tradeAt(g, t, price);
};

/** Limit order at `price(g)`, live 4h from the close; filled on the first M15 candle that trades through it. */
const limit = (price: (g: Signal) => number): Entry => g => {
  const p = price(g);
  for (let k = firstIndexAtOrAfter(m15, g.epoch); k < m15.length && m15[k].epoch < g.epoch + 4 * 3600; k++) {
    const c: Candle = m15[k];
    const { sl, tp } = levels(g);
    // Target or stop reached before the order fills: the setup is gone.
    if (g.dir === 1 ? c.high >= tp || c.low <= sl : c.low <= tp || c.high >= sl) {
      if (!(c.low <= p && c.high >= p)) return null;
    }
    if (c.low <= p && c.high >= p) return tradeAt(g, c.epoch, p);
  }
  return null;
};

const line = (label: string, ts: Trade[], extra = '') => {
  const tr = stats(ts.filter(t => t.entryEpoch < SPLIT)), ho = stats(ts.filter(t => t.entryEpoch >= SPLIT));
  console.log(`  ${label.padEnd(34)} ${fmtStats(stats(ts))} | train ${tr.avgR >= 0 ? '+' : ''}${tr.avgR.toFixed(3)} holdout ${ho.avgR >= 0 ? '+' : ''}${ho.avgR.toFixed(3)}${extra}`);
  return { label, all: stats(ts), train: tr, holdout: ho };
};

function main() {
  const out: Record<string, unknown> = {};

  console.log('\n1. Stretch at entry (the live trades, split by how far the close sat beyond the broken level)');
  const base = run(atClose).trades;
  const sigAt = new Map(signals.map(g => [g.epoch, g]));
  const withStretch = base.map(t => ({ t, g: sigAt.get(t.entryEpoch)! })).sort((a, b) => a.g.stretchAtr - b.g.stretchAtr);
  const third = Math.ceil(withStretch.length / 3);
  const buckets = [withStretch.slice(0, third), withStretch.slice(third, 2 * third), withStretch.slice(2 * third)];
  out.stretch = buckets.map((b, k) => line(`${['low', 'mid', 'high'][k]} stretch ${b[0].g.stretchAtr.toFixed(2)}-${b[b.length - 1].g.stretchAtr.toFixed(2)} ATR`, b.map(x => x.t)));
  const byRange = [...withStretch].sort((a, b) => a.g.rangeAtr - b.g.rangeAtr);
  out.range = [byRange.slice(0, third), byRange.slice(third, 2 * third), byRange.slice(2 * third)]
    .map((b, k) => line(`${['small', 'mid', 'big'][k]} candle ${b[0].g.rangeAtr.toFixed(2)}-${b[b.length - 1].g.rangeAtr.toFixed(2)} ATR`, b.map(x => x.t)));

  console.log('\n2. Acting late on the alert (market entry, alert stop and target)');
  out.late = [0, 5, 15, 30, 60].map(m => {
    const r = run(m === 0 ? atClose : late(m));
    return line(m === 0 ? 'at the close (backtest/engine)' : `${m} min after the close`, r.trades, r.skipped ? ` | skipped ${r.skipped} (price already past a level)` : '');
  });

  console.log('\n3. Entering better (limit order, live 4h, alert stop and target)');
  out.better = [
    line('market at the close (live rule)', base),
    line('limit at the breakout level', run(limit(g => g.level)).trades),
    line('limit at the signal body midpoint', run(limit(g => g.bodyMid)).trades),
    line('limit 0.5 ATR back from the close', run(limit(g => g.close - g.dir * 0.5 * g.atr)).trades),
  ];

  writeFileSync('./backtest/v10-late-entry-results.json', JSON.stringify({ generatedAt: new Date().toISOString(), split: '2026-05-01', ...out }, null, 2));
}

if (import.meta.main) main();
