/**
 * FxHouse — the instrument playbook, tested as written.
 *
 *   BTC      trend following + SMC     liquidity sweep, then confirmed retracement   days–weeks
 *   EUR/JPY  trend continuation + SMC  4H zone, sweep, then 1H structure confirmation hours–days
 *   EUR/GBP  range reversal + SMC      range-boundary sweep, then reversal close      hours–days
 *   NZD/JPY  trend continuation + SMC  pullback into a 4H zone, then 1H confirmation   days–weeks
 *
 * Each description is pinned to one exact rule below, fixed before running (no
 * tuning). Building blocks, all on closed candles only:
 *   trend   H4 close above EMA50 and EMA50 above its value 6 H4 candles earlier (down mirrored)
 *   swings  H1 fractal (3 candles each side), usable 3 candles after the swing
 *           H4 fractal (2 each side), usable 2 H4 candles after it
 *   zone    the body-to-wick span of the last usable H4 swing low (demand) / high (supply)
 *   entry   market at the close of the confirming H1 candle; one trade at a time;
 *           spread from spreadConfig.ts (estimates for these instruments)
 *
 * Pass bar, as for every study: >= 30 trades, profit in train (first 60%) and holdout,
 * profit in at least two of three equal periods including the last, t >= 2, and fewer
 * than 1% of 200 random-walk years at the instrument's volatility doing as well.
 * Every rule also runs on every candidate instrument, to see whether it travels.
 *
 * Run with:
 *   bun run .\backtest\smc-playbook-study.ts
 */

import { writeFileSync } from 'node:fs';
import { getVolatilityAdjustedSpread } from '../src/lib/spreadConfig';
import { GRANULARITY, atrSeries, cleanSeries, emaSeries, loadData, simulate, stats } from './lib';
import type { Candle, Series, Stats, Trade } from './lib';
import { lastCompleted } from './strategy-candidates';
import { annualVol, compact } from './research-agent';
import { randomWalk } from './synthetic-pick-study';

type Dir = 1 | -1;
const H1 = GRANULARITY.h1, H4 = GRANULARITY.h4;
const INSTRUMENTS = ['BTC/USD', 'EUR/JPY', 'EUR/GBP', 'NZD/JPY', 'XAG/USD', 'US100'];

interface Ctx {
  s: Series; atr1: number[]; atr4: number[];
  /** +1 / -1 / 0 trend from the last H4 candle closed by the end of H1 bar i. */
  trend: (i: number) => 0 | Dir;
  h4At: (i: number) => number;
  /** H1 swing lows / highs known by the close of H1 bar i (index of the swing bar). */
  lastSwingLow1: (i: number) => number; lastSwingHigh1: (i: number) => number;
  lastSwingLow4: (k: number) => number; lastSwingHigh4: (k: number) => number;
}

function fractals(c: Candle[], n: number) {
  const lows: number[] = [], highs: number[] = [];
  for (let i = n; i < c.length - n; i++) {
    let lo = true, hi = true;
    for (let k = 1; k <= n; k++) {
      if (!(c[i].low < c[i - k].low && c[i].low < c[i + k].low)) lo = false;
      if (!(c[i].high > c[i - k].high && c[i].high > c[i + k].high)) hi = false;
    }
    if (lo) lows.push(i);
    if (hi) highs.push(i);
  }
  return { lows, highs };
}

/** Last swing index usable at bar `i` (confirmed `n` bars after it). */
const lastUsable = (idx: number[], i: number, n: number) => {
  let r = -1;
  for (const j of idx) { if (j + n <= i) r = j; else break; }
  return r;
};

function context(s: Series): Ctx {
  const atr1 = atrSeries(s.h1), atr4 = atrSeries(s.h4);
  const ema4 = emaSeries(s.h4.map(c => c.close), 50);
  const f1 = fractals(s.h1, 3), f4 = fractals(s.h4, 2);
  const h4At = (i: number) => lastCompleted(s.h4, H4, s.h1[i].epoch + H1);
  return {
    s, atr1, atr4, h4At,
    trend: i => {
      const k = h4At(i);
      if (k < 56 || Number.isNaN(ema4[k]) || Number.isNaN(ema4[k - 6])) return 0;
      const c = s.h4[k].close;
      return c > ema4[k] && ema4[k] > ema4[k - 6] ? 1 : c < ema4[k] && ema4[k] < ema4[k - 6] ? -1 : 0;
    },
    lastSwingLow1: i => lastUsable(f1.lows, i, 3), lastSwingHigh1: i => lastUsable(f1.highs, i, 3),
    lastSwingLow4: k => lastUsable(f4.lows, k, 2), lastSwingHigh4: k => lastUsable(f4.highs, k, 2),
  };
}

interface Signal { i: number; dir: Dir; stopDist: number; tpR: number; hold: number }
type Rule = (x: Ctx) => Signal[];

// ---- BTC: trend following + SMC — liquidity sweep, then confirmed retracement ----
const trendSweep: Rule = x => {
  const { h1 } = x.s, out: Signal[] = [];
  for (let i = 60; i < h1.length - 1; i++) {
    const dir = x.trend(i);
    if (!dir) continue;
    const sw = dir === 1 ? x.lastSwingLow1(i - 1) : x.lastSwingHigh1(i - 1);
    if (sw < 0) continue;
    const level = dir === 1 ? h1[sw].low : h1[sw].high;
    const c = h1[i];
    const swept = dir === 1 ? c.low < level && c.close > level : c.high > level && c.close < level;
    if (!swept) continue;
    let ext = -Infinity * dir;
    for (let k = sw; k < i; k++) ext = dir === 1 ? Math.max(ext, h1[k].high) : Math.min(ext, h1[k].low);
    for (let j = i + 1; j <= i + 12 && j < h1.length - 1; j++) {
      if (dir * (h1[j].close - ext) > 0) {
        const wick = dir === 1 ? Math.min(...h1.slice(i, j + 1).map(b => b.low)) : Math.max(...h1.slice(i, j + 1).map(b => b.high));
        out.push({ i: j, dir, stopDist: dir * (h1[j].close - wick) + 0.2 * x.atr1[j], tpR: 3, hold: 336 });
        break;
      }
    }
  }
  return out;
};

/** The H4 zone at the last usable H4 swing in the trend direction: [low, top of body] for demand. */
const zoneAt = (x: Ctx, i: number, dir: Dir): [number, number] | null => {
  const k = x.h4At(i);
  const z = dir === 1 ? x.lastSwingLow4(k) : x.lastSwingHigh4(k);
  if (z < 0) return null;
  const b = x.s.h4[z];
  return dir === 1 ? [b.low, Math.max(b.open, b.close)] : [Math.min(b.open, b.close), b.high];
};

// ---- EUR/JPY: trend continuation + SMC — 4H zone, sweep, 1H structure confirmation ----
const zoneSweep: Rule = x => {
  const { h1 } = x.s, out: Signal[] = [];
  for (let i = 60; i < h1.length - 1; i++) {
    const dir = x.trend(i);
    if (!dir) continue;
    const zone = zoneAt(x, i, dir);
    if (!zone) continue;
    const c = h1[i];
    const inZone = dir === 1 ? c.low <= zone[1] && c.high >= zone[0] : c.high >= zone[0] && c.low <= zone[1];
    if (!inZone) continue;
    const sw = dir === 1 ? x.lastSwingLow1(i - 1) : x.lastSwingHigh1(i - 1);
    if (sw < 0) continue;
    const level = dir === 1 ? h1[sw].low : h1[sw].high;
    if (!(dir === 1 ? c.low < level && c.close > level : c.high > level && c.close < level)) continue;
    for (let j = i + 1; j <= i + 8 && j < h1.length - 1; j++) {
      const sh = dir === 1 ? x.lastSwingHigh1(j - 1) : x.lastSwingLow1(j - 1);
      if (sh < 0) continue;
      const brk = dir === 1 ? h1[sh].high : h1[sh].low;
      if (dir * (h1[j].close - brk) > 0) {
        const far = dir === 1 ? Math.min(zone[0], c.low) : Math.max(zone[1], c.high);
        out.push({ i: j, dir, stopDist: dir * (h1[j].close - far) + 0.1 * x.atr1[j], tpR: 2, hold: 72 });
        break;
      }
    }
  }
  return out;
};

// ---- NZD/JPY: trend continuation + SMC — pullback into a 4H zone, 1H confirmation ----
const zonePullback: Rule = x => {
  const { h1 } = x.s, out: Signal[] = [];
  for (let i = 60; i < h1.length - 1; i++) {
    const dir = x.trend(i);
    if (!dir) continue;
    const zone = zoneAt(x, i, dir);
    if (!zone) continue;
    const c = h1[i];
    const touched = dir === 1 ? c.low <= zone[1] && h1[i - 1].low > zone[1] : c.high >= zone[0] && h1[i - 1].high < zone[0];
    if (!touched) continue; // first touch of the zone
    for (let j = i + 1; j <= i + 12 && j < h1.length - 1; j++) {
      if (dir === 1 ? h1[j].close < zone[0] : h1[j].close > zone[1]) break; // zone failed
      const sh = dir === 1 ? x.lastSwingHigh1(j - 1) : x.lastSwingLow1(j - 1);
      if (sh < 0) continue;
      const brk = dir === 1 ? h1[sh].high : h1[sh].low;
      if (dir * (h1[j].close - brk) > 0) {
        const far = dir === 1 ? zone[0] : zone[1];
        out.push({ i: j, dir, stopDist: dir * (h1[j].close - far) + 0.1 * x.atr1[j], tpR: 3, hold: 336 });
        break;
      }
    }
  }
  return out;
};

// ---- EUR/GBP: range reversal + SMC — range-boundary sweep, reversal confirmation ----
function rangeSweep(x: Ctx): Signal[] {
  const { h1, h4 } = x.s, out: Signal[] = [];
  const ema4 = emaSeries(h4.map(c => c.close), 50);
  for (let i = 60; i < h1.length - 1; i++) {
    const k = x.h4At(i);
    if (k < 60 || Number.isNaN(ema4[k - 10])) continue;
    if (Math.abs(ema4[k] - ema4[k - 10]) >= 0.1 * x.atr4[k]) continue; // flat = ranging
    let hi = -Infinity, lo = Infinity;
    for (let m = k - 29; m <= k; m++) { hi = Math.max(hi, h4[m].high); lo = Math.min(lo, h4[m].low); }
    const c = h1[i];
    const dir: 0 | Dir = c.high > hi && c.close < hi ? -1 : c.low < lo && c.close > lo ? 1 : 0;
    if (!dir) continue;
    const trigger = dir === 1 ? c.high : c.low;
    for (let j = i + 1; j <= i + 4 && j < h1.length - 1; j++) {
      if (dir * (h1[j].close - trigger) > 0) {
        const wick = dir === 1 ? c.low : c.high;
        const stopDist = dir * (h1[j].close - wick) + 0.1 * x.atr1[j];
        const tpR = (dir * ((hi + lo) / 2 - h1[j].close)) / stopDist;
        if (tpR >= 1) out.push({ i: j, dir, stopDist, tpR, hold: 72 });
        break;
      }
    }
  }
  return out;
}

const RULES: { id: string; name: string; home: string; rule: Rule }[] = [
  { id: 'trend_sweep', name: 'Trend + liquidity sweep + confirmed retracement (TP 3R, 14d)', home: 'BTC/USD', rule: trendSweep },
  { id: 'zone_sweep', name: 'Trend + 4H zone + sweep + 1H structure break (TP 2R, 72h)', home: 'EUR/JPY', rule: zoneSweep },
  { id: 'range_sweep', name: 'Range + boundary sweep + reversal close (TP mid-range, 72h)', home: 'EUR/GBP', rule: rangeSweep },
  { id: 'zone_pullback', name: 'Trend + pullback into 4H zone + 1H structure break (TP 3R, 14d)', home: 'NZD/JPY', rule: zonePullback },
];

function trades(inst: string, s: Series, rule: Rule): Trade[] {
  const x = context(s), out: Trade[] = [];
  const spread = getVolatilityAdjustedSpread(inst as never, null);
  let busyUntil = 0;
  for (const g of rule(x).sort((a, b) => a.i - b.i)) {
    const close = s.h1[g.i].epoch + H1;
    if (close < busyUntil || !(g.stopDist > 0)) continue;
    const t = simulate(s.m15, close, s.h1[g.i].close, g.dir, g.stopDist, g.tpR, spread, g.hold);
    if (t) { out.push(t); busyUntil = t.exitEpoch; }
  }
  return out;
}

function main() {
  const raw = loadData('./backtest/data-candidates.json');
  const results: Record<string, unknown>[] = [];
  const pct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
  for (const r of RULES) {
    console.log(`\n=== ${r.name}  [home: ${r.home}]`);
    for (const inst of INSTRUMENTS) {
      if (!raw[inst]) continue;
      const s = cleanSeries(raw[inst]).series;
      const from = s.m15[0].epoch, to = s.m15[s.m15.length - 1].epoch, years = (to - from) / (365 * 86400);
      const ts = trades(inst, s, r.rule);
      const full = stats(ts), train = stats(ts.filter(t => t.entryEpoch < from + 0.6 * (to - from))), hold = stats(ts.filter(t => t.entryEpoch >= from + 0.6 * (to - from)));
      const w = (to - from) / 3;
      const seg: Stats[] = [0, 1, 2].map(k => stats(ts.filter(t => t.entryEpoch >= from + k * w && t.entryEpoch < from + (k + 1) * w)));
      const base = full.n >= 30 && train.avgR > 0 && hold.avgR > 0 && full.t >= 2 && seg.filter(x => x.avgR > 0).length >= 2 && seg[2].avgR > 0;
      let luck: number | null = null;
      if (base) {
        const paths = Array.from({ length: 200 }, () => randomWalk(s, annualVol(s)));
        luck = paths.filter(p => stats(trades(inst, p, r.rule)).totalR >= full.totalR).length / 200;
      }
      const pass = base && luck !== null && luck < 0.01;
      console.log(`  ${(inst === r.home ? '*' : ' ')}${inst.padEnd(8)} n ${String(full.n).padStart(3)}  win ${full.winRate.toFixed(0).padStart(2)}%  avg ${pct(full.avgR)}R  t ${full.t.toFixed(1).padStart(4)}  ${(full.totalR / years).toFixed(0).padStart(3)}R/yr  DD ${full.maxDrawdownR.toFixed(0).padStart(2)}R  train ${pct(train.avgR)} holdout ${pct(hold.avgR)}  thirds ${seg.map(x => pct(x.avgR)).join('/')}${luck !== null ? `  luck ${(luck * 100).toFixed(1)}%` : ''}  ${pass ? 'PASS' : ''}`);
      results.push({ rule: r.id, instrument: inst, home: inst === r.home, pass, luckShare: luck, perYearR: full.totalR / years, full: compact(full), train: compact(train), holdout: compact(hold), thirds: seg.map(compact) });
    }
  }
  console.log('\n* = the instrument the playbook assigns the rule to.');
  writeFileSync('./backtest/smc-playbook-results.json', JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
}

if (import.meta.main) main();
