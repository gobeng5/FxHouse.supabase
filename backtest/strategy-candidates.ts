/**
 * FxHouse — per-instrument strategy candidate check
 *
 * Reconstructs the candidate strategies named in the research spec with
 * explicit rules and evaluates each one on the saved 12-month history, for the
 * instruments the spec assigns it to. Nothing here touches the live engine.
 *
 * Where the spec leaves a rule open (trend filter, reclaim/touch conditions,
 * "extreme" thresholds, sweep distance), the choice made here is written next
 * to the rule. Those choices were fixed BEFORE any result was seen and are not
 * tuned: this script evaluates, it does not search.
 *
 * Shared conventions (see lib.ts):
 *   - Signals use completed H1 candles and completed H4/D1 candles only;
 *     entry is the next H1 open.
 *   - Stop 1.5x H1 ATR unless the strategy defines its own invalidation level.
 *   - Targets 2R and 3R, 48h time stop, no overlapping trades per strategy.
 *   - Spread included (volatility-scaled for synthetics); M15 resolution with
 *     the stop checked first inside a candle.
 *   - Train = entries before 2026-06-07, holdout = entries on/after.
 *
 * Input:  ./backtest/data.json
 * Output: console report + ./backtest/strategy-candidates-results.json
 *
 * Run with:
 *   bun run .\backtest\strategy-candidates.ts
 */

import { writeFileSync } from 'node:fs';
import { getVolatilityAdjustedSpread } from '../src/lib/spreadConfig';
import {
  GRANULARITY, TRAIN_END, atrPercentileSeries, atrSeries, cleanSeries, emaSeries, firstIndexAtOrAfter,
  fmtR, loadData, median, rsiSeries, simulate, stats,
} from './lib';
import type { Candle, CleanReport, Series, Stats, Trade } from './lib';

const INPUT = './backtest/data.json';
const OUTPUT = './backtest/strategy-candidates-results.json';

const STOP_ATR = 1.5;
const TP_R = [2, 3];
const MAX_HOLD_HOURS = 48;
const WARMUP = 220;            // H1 bars before the first signal (ATR percentile lookback)
const RANGE_MEDIAN_BARS = 20;  // "rolling median" window for candle range

const MIN_TRAIN_N = 30;
const MIN_HOLDOUT_N = 15;
const MIN_HOLDOUT_T = 1.65;    // one-sided 5%

// =================== CONTEXT ===================
export type Dir = 1 | -1;
export type Signal = { i: number; dir: Dir; /** Price that invalidates the setup; default stop is STOP_ATR x ATR. */ stopLevel?: number };

export interface Ctx {
  instrument: string;
  s: Series;
  ema20: number[]; ema50: number[]; rsi: number[]; atr: number[]; atrPct: number[];
  /** Median range of the RANGE_MEDIAN_BARS candles BEFORE bar i. */
  medRange: number[];
  /** D1 and H4 trend agree: +1 / -1, else 0. Uses only candles completed by bar i's close. */
  aligned: (0 | Dir)[];
}

const sign = (v: number): 0 | Dir => (v > 0 ? 1 : v < 0 ? -1 : 0);
const candleDir = (c: Candle) => sign(c.close - c.open);

/**
 * Higher-timeframe trend, evaluated per completed candle.
 *   H4: close and EMA20 both above EMA50 (below for a downtrend).
 *   D1: close above EMA20 and EMA20 higher than 5 days earlier (mirror for down).
 * The D1 rule avoids EMA50 because only ~260 daily candles exist.
 */
export function trendH4(candles: Candle[]): (0 | Dir)[] {
  const closes = candles.map(c => c.close);
  const e20 = emaSeries(closes, 20), e50 = emaSeries(closes, 50);
  return candles.map((c, k) =>
    c.close > e50[k] && e20[k] > e50[k] ? 1 : c.close < e50[k] && e20[k] < e50[k] ? -1 : 0);
}

export function trendD1(candles: Candle[]): (0 | Dir)[] {
  const closes = candles.map(c => c.close);
  const e20 = emaSeries(closes, 20);
  return candles.map((c, k) =>
    k < 5 ? 0 : c.close > e20[k] && e20[k] > e20[k - 5] ? 1 : c.close < e20[k] && e20[k] < e20[k - 5] ? -1 : 0);
}

/** Index of the last candle of a timeframe that has fully closed by `closeEpoch`. */
export const lastCompleted = (candles: Candle[], granularity: number, closeEpoch: number) =>
  firstIndexAtOrAfter(candles, closeEpoch - granularity + 1) - 1;

export function buildContext(instrument: string, s: Series): Ctx {
  const h1 = s.h1;
  const closes = h1.map(c => c.close);
  const atr = atrSeries(h1);

  const medRange = new Array<number>(h1.length).fill(NaN);
  for (let i = RANGE_MEDIAN_BARS; i < h1.length; i++) {
    medRange[i] = median(h1.slice(i - RANGE_MEDIAN_BARS, i).map(c => c.high - c.low));
  }

  const h4T = trendH4(s.h4), d1T = trendD1(s.d1);
  const aligned = h1.map(c => {
    const close = c.epoch + GRANULARITY.h1;
    const a = h4T[lastCompleted(s.h4, GRANULARITY.h4, close)] ?? 0;
    const b = d1T[lastCompleted(s.d1, GRANULARITY.d1, close)] ?? 0;
    return a !== 0 && a === b ? a : 0;
  });

  return {
    instrument, s,
    ema20: emaSeries(closes, 20), ema50: emaSeries(closes, 50),
    rsi: rsiSeries(closes), atr, atrPct: atrPercentileSeries(atr), medRange, aligned,
  };
}

// =================== STRATEGIES ===================
const eachBar = (ctx: Ctx, fn: (i: number, c: Candle) => void) => {
  // The last bar is excluded: a signal there has no next open to enter on.
  for (let i = WARMUP; i < ctx.s.h1.length - 1; i++) fn(i, ctx.s.h1[i]);
};

/**
 * Impulse continuation (spec parameters): candle range >= 1.5x the rolling
 * median range AND >= 1.2x ATR, in the direction of the aligned D1/H4 trend,
 * with the prior 3 bars' net move in the same direction.
 * ATR is the value BEFORE the impulse candle, so the candle is not measured against itself.
 */
export function impulseContinuation(ctx: Ctx, rangeMult = 1.5, atrMult = 1.2): Signal[] {
  const out: Signal[] = [];
  const h1 = ctx.s.h1;
  eachBar(ctx, (i, c) => {
    const range = c.high - c.low;
    const dir = candleDir(c);
    if (dir === 0 || ctx.aligned[i] !== dir) return;
    if (!(range >= rangeMult * ctx.medRange[i] && range >= atrMult * ctx.atr[i - 1])) return;
    if (sign(h1[i - 1].close - h1[i - 4].close) !== dir) return;
    out.push({ i, dir });
  });
  return out;
}

/**
 * EMA reclaim: with D1/H4 aligned, the previous H1 candle closed on the wrong
 * side of EMA20 and this one closes back across it as a candle in the trend direction.
 */
function emaReclaim(ctx: Ctx): Signal[] {
  const out: Signal[] = [];
  const h1 = ctx.s.h1;
  eachBar(ctx, (i, c) => {
    const dir = ctx.aligned[i];
    if (dir === 0 || candleDir(c) !== dir) return;
    const wasBeyond = dir * (h1[i - 1].close - ctx.ema20[i - 1]) < 0;
    const reclaimed = dir * (c.close - ctx.ema20[i]) > 0;
    if (wasBeyond && reclaimed) out.push({ i, dir });
  });
  return out;
}

/**
 * Trend pullback: D1, H4 and H1 (EMA20 vs EMA50, close beyond EMA50) all agree;
 * price was already on the trend side of EMA20, this candle's wick touches
 * EMA20 and it closes back on the trend side as a candle in the trend direction.
 * Distinct from the reclaim: the prior close never crossed EMA20.
 */
export function trendPullback(ctx: Ctx): Signal[] {
  const out: Signal[] = [];
  const h1 = ctx.s.h1;
  eachBar(ctx, (i, c) => {
    const dir = ctx.aligned[i];
    if (dir === 0 || candleDir(c) !== dir) return;
    const h1Trend = dir * (ctx.ema20[i] - ctx.ema50[i]) > 0 && dir * (c.close - ctx.ema50[i]) > 0;
    if (!h1Trend) return;
    const heldBefore = dir * (h1[i - 1].close - ctx.ema20[i - 1]) > 0;
    const touched = dir === 1 ? c.low <= ctx.ema20[i] : c.high >= ctx.ema20[i];
    const closedBack = dir * (c.close - ctx.ema20[i]) > 0;
    if (heldBefore && touched && closedBack) out.push({ i, dir });
  });
  return out;
}

interface ExtremeOptions {
  /** 'reversal' fades the extreme candle, 'continuation' follows it (the competing hypothesis). */
  mode: 'reversal' | 'continuation';
  /** Only act on bullish (+1) or bearish (-1) extreme candles. */
  only?: Dir;
  /** Require RSI >= 70 after a bullish extreme / <= 30 after a bearish one. */
  rsiFilter?: boolean;
}

/**
 * Extreme move: a candle with range >= 2.5x the rolling median AND >= 2x the
 * prior ATR. Confirmation is the NEXT candle closing against it (reversal) or
 * with it (continuation); entry follows the confirmation candle.
 */
function extremeMove(ctx: Ctx, opt: ExtremeOptions): Signal[] {
  const out: Signal[] = [];
  const h1 = ctx.s.h1;
  for (let i = WARMUP; i < h1.length - 2; i++) {
    const c = h1[i];
    const range = c.high - c.low;
    const dir = candleDir(c);
    if (dir === 0 || (opt.only && dir !== opt.only)) continue;
    if (!(range >= 2.5 * ctx.medRange[i] && range >= 2.0 * ctx.atr[i - 1])) continue;
    if (opt.rsiFilter && !(dir === 1 ? ctx.rsi[i] >= 70 : ctx.rsi[i] <= 30)) continue;

    const confirm = candleDir(h1[i + 1]);
    const want = opt.mode === 'reversal' ? -dir : dir;
    if (confirm === want) out.push({ i: i + 1, dir: want as Dir });
  }
  return out;
}

/**
 * Liquidity sweep reversal: the candle trades at least 0.1x ATR beyond the
 * highest high / lowest low of the prior 24 completed H1 candles and closes
 * back inside that range. Invalidation is the sweep extreme plus 0.25x ATR.
 */
function liquiditySweep(ctx: Ctx): Signal[] {
  const out: Signal[] = [];
  const h1 = ctx.s.h1;
  eachBar(ctx, (i, c) => {
    let hh = -Infinity, ll = Infinity;
    for (let j = i - 24; j < i; j++) { hh = Math.max(hh, h1[j].high); ll = Math.min(ll, h1[j].low); }
    const atr = ctx.atr[i - 1];
    const sweptHigh = c.high >= hh + 0.1 * atr && c.close < hh;
    const sweptLow = c.low <= ll - 0.1 * atr && c.close > ll;
    if (sweptHigh === sweptLow) return; // neither, or an outside bar that took both sides
    if (sweptHigh) out.push({ i, dir: -1, stopLevel: c.high + 0.25 * atr });
    else out.push({ i, dir: 1, stopLevel: c.low - 0.25 * atr });
  });
  return out;
}

/**
 * BOOM spike: a bullish H1 candle with range >= 3x the rolling median.
 * 'reversal' sells the next open, 'continuation' buys it.
 */
function boomSpike(ctx: Ctx, mode: 'reversal' | 'continuation'): Signal[] {
  const out: Signal[] = [];
  eachBar(ctx, (i, c) => {
    if (candleDir(c) !== 1 || !(c.high - c.low >= 3 * ctx.medRange[i])) return;
    out.push({ i, dir: mode === 'reversal' ? -1 : 1 });
  });
  return out;
}

/** Baseline: always in the market in the aligned D1/H4 direction, same exits. */
export function trendBaseline(ctx: Ctx): Signal[] {
  const out: Signal[] = [];
  eachBar(ctx, i => { if (ctx.aligned[i] !== 0) out.push({ i, dir: ctx.aligned[i] as Dir }); });
  return out;
}

const merge = (...lists: Signal[][]) => lists.flat().sort((a, b) => a.i - b.i);

// =================== CANDIDATES PER INSTRUMENT (from the research spec) ===================
type Build = (ctx: Ctx) => Signal[];
interface Candidate { label: string; build: Build }

const IMPULSE: Candidate = { label: 'H1 Impulse Continuation', build: ctx => impulseContinuation(ctx) };
const RECLAIM: Candidate = { label: 'EMA Reclaim', build: emaReclaim };
const PULLBACK: Candidate = { label: 'Trend Pullback', build: trendPullback };
const extreme = (label: string, opt: ExtremeOptions): Candidate => ({ label, build: ctx => extremeMove(ctx, opt) });
const EXTREME_SET = (only?: Dir, name = 'Extreme-Move'): Candidate[] => [
  extreme(`${name} Reversal`, { mode: 'reversal', only }),
  extreme(`${name} Reversal + RSI filter`, { mode: 'reversal', only, rsiFilter: true }),
  extreme(`${name} Continuation (competing)`, { mode: 'continuation', only }),
];

const CANDIDATES: Record<string, Candidate[]> = {
  'EUR/USD': [IMPULSE, RECLAIM, PULLBACK],
  'GBP/USD': [IMPULSE, RECLAIM, PULLBACK],
  'USD/JPY': [PULLBACK, IMPULSE],
  'AUD/USD': [RECLAIM, IMPULSE],
  'GBP/JPY': [IMPULSE, RECLAIM, PULLBACK],
  'XAU/USD': [{ label: 'Liquidity Sweep Reversal', build: liquiditySweep }, ...EXTREME_SET(), IMPULSE],
  'V10': [RECLAIM, ...EXTREME_SET(), IMPULSE],
  'V25': [IMPULSE, ...EXTREME_SET()],
  'V50': [
    IMPULSE,
    { label: 'Hybrid Continuation + Reversal', build: ctx => merge(impulseContinuation(ctx), extremeMove(ctx, { mode: 'reversal' })) },
  ],
  'V75': [RECLAIM, ...EXTREME_SET(1, 'Extreme-Bullish-Candle'), IMPULSE],
  'V100': [PULLBACK, ...EXTREME_SET(-1, 'Extreme-Bearish-Move'), IMPULSE],
  'BOOM1000': [
    { label: 'Spike Reversal', build: ctx => boomSpike(ctx, 'reversal') },
    { label: 'Spike Continuation (competing)', build: ctx => boomSpike(ctx, 'continuation') },
    IMPULSE,
  ],
};

// =================== RUNNER ===================
function runTrades(ctx: Ctx, signals: Signal[], tpR: number): Trade[] {
  const trades: Trade[] = [];
  let busyUntil = 0;
  for (const sig of signals) {
    const entryBar = ctx.s.h1[sig.i + 1];
    if (!entryBar || entryBar.epoch < busyUntil) continue; // no overlapping trades

    const atr = ctx.atr[sig.i];
    if (!(atr > 0)) continue;
    const stopDist = sig.stopLevel === undefined
      ? STOP_ATR * atr
      : Math.max(Math.abs(entryBar.open - sig.stopLevel), 0.5 * atr);

    const spread = getVolatilityAdjustedSpread(ctx.instrument, ctx.atrPct[sig.i]);
    const trade = simulate(ctx.s.m15, entryBar.epoch, entryBar.open, sig.dir, stopDist, tpR, spread, MAX_HOLD_HOURS);
    if (!trade) continue;
    trades.push(trade);
    busyUntil = trade.exitEpoch;
  }
  return trades;
}

export type Verdict = 'holds' | 'positive in both, not significant' | 'too few trades' | 'fails';

interface Row {
  instrument: string; strategy: string; tpR: number; signals: number;
  full: Stats; train: Stats; holdout: Stats; long: Stats; short: Stats; verdict: Verdict;
  avgMfeR: number; avgMaeR: number;
}

export function verdictOf(train: Stats, holdout: Stats): Verdict {
  if (train.n < MIN_TRAIN_N || holdout.n < MIN_HOLDOUT_N) return 'too few trades';
  if (train.avgR > 0 && holdout.avgR > 0) {
    return holdout.t >= MIN_HOLDOUT_T ? 'holds' : 'positive in both, not significant';
  }
  return 'fails';
}

function evaluate(ctx: Ctx, strategy: string, signals: Signal[], tpR: number): Row {
  const trades = runTrades(ctx, signals, tpR);
  const train = stats(trades.filter(t => t.entryEpoch < TRAIN_END));
  const holdout = stats(trades.filter(t => t.entryEpoch >= TRAIN_END));
  const avg = (pick: (t: Trade) => number) => (trades.length ? trades.reduce((s, t) => s + pick(t), 0) / trades.length : 0);
  return {
    instrument: ctx.instrument, strategy, tpR, signals: signals.length,
    full: stats(trades), train, holdout,
    long: stats(trades.filter(t => t.dir === 1)), short: stats(trades.filter(t => t.dir === -1)),
    verdict: verdictOf(train, holdout),
    avgMfeR: avg(t => t.mfeR), avgMaeR: avg(t => t.maeR),
  };
}

// =================== REPORT ===================
const cell = (s: Stats) =>
  `n=${String(s.n).padStart(3)} win ${s.winRate.toFixed(0).padStart(3)}% avgR ${fmtR(s.avgR)} t ${s.t.toFixed(2).padStart(5)}`;

function printRow(r: Row) {
  console.log(`  ${r.strategy} | TP ${r.tpR}R  (${r.signals} signals)  => ${r.verdict.toUpperCase()}`);
  console.log(`      train    ${cell(r.train)}`);
  console.log(`      holdout  ${cell(r.holdout)}`);
  console.log(`      full     ${cell(r.full)}  total ${fmtR(r.full.totalR)}R  PF ${r.full.profitFactor.toFixed(2)}  maxDD ${r.full.maxDrawdownR.toFixed(1)}R  max losing streak ${r.full.maxConsecLosses}`);
  console.log(`               exits TP ${r.full.tpRate.toFixed(0)}% / SL ${r.full.slRate.toFixed(0)}% / time ${r.full.timeRate.toFixed(0)}%  long ${fmtR(r.long.avgR)} (n=${r.long.n})  short ${fmtR(r.short.avgR)} (n=${r.short.n})`);
}

function main() {
  const data = loadData(INPUT);
  const rows: Row[] = [];
  const baselines: Row[] = [];
  const dataQuality: Record<string, CleanReport[]> = {};
  const contexts: Record<string, Ctx> = {};

  console.log('FxHouse strategy candidate check');
  console.log(`Train: entries before ${new Date(TRAIN_END * 1000).toISOString().slice(0, 10)} | Holdout: entries on/after`);
  console.log(`Stop ${STOP_ATR}x H1 ATR (or the setup's invalidation level), time stop ${MAX_HOLD_HOURS}h, spread included\n`);

  for (const [instrument, candidates] of Object.entries(CANDIDATES)) {
    if (!data[instrument]) throw new Error(`${instrument}: missing from ${INPUT}`);
    const { series, report } = cleanSeries(data[instrument]);
    dataQuality[instrument] = report;
    const ctx = contexts[instrument] = buildContext(instrument, series);

    console.log(`===== ${instrument} =====`);
    const base = evaluate(ctx, 'Baseline: always with D1/H4 trend', trendBaseline(ctx), 2);
    baselines.push(base);
    console.log(`  baseline (always with the D1/H4 trend, TP 2R): train ${cell(base.train)} | holdout ${cell(base.holdout)}`);

    for (const candidate of candidates) {
      const signals = candidate.build(ctx);
      for (const tpR of TP_R) {
        const row = evaluate(ctx, candidate.label, signals, tpR);
        rows.push(row);
        printRow(row);
      }
    }
    console.log('');
  }

  // Sensitivity of the spec's priority-1 candidate to nearby parameter values.
  console.log('===== EUR/USD impulse continuation — nearby parameters (TP 3R, full period) =====');
  const sensitivity: { rangeMult: number; atrMult: number; n: number; avgR: number; holdoutAvgR: number; holdoutN: number }[] = [];
  for (const rangeMult of [1.25, 1.5, 1.75]) for (const atrMult of [1.0, 1.2, 1.4]) {
    const row = evaluate(contexts['EUR/USD'], 'sensitivity', impulseContinuation(contexts['EUR/USD'], rangeMult, atrMult), 3);
    sensitivity.push({ rangeMult, atrMult, n: row.full.n, avgR: row.full.avgR, holdoutAvgR: row.holdout.avgR, holdoutN: row.holdout.n });
    console.log(`  range x${rangeMult.toFixed(2)} / ATR x${atrMult.toFixed(1)}: full n=${String(row.full.n).padStart(3)} avgR ${fmtR(row.full.avgR)} | holdout n=${String(row.holdout.n).padStart(3)} avgR ${fmtR(row.holdout.avgR)}`);
  }

  console.log('\n===== Summary =====');
  const count = (v: Verdict) => rows.filter(r => r.verdict === v).length;
  console.log(`Rows tested: ${rows.length} (strategy x target, across ${Object.keys(CANDIDATES).length} instruments)`);
  for (const v of ['holds', 'positive in both, not significant', 'too few trades', 'fails'] as Verdict[]) console.log(`  ${v}: ${count(v)}`);
  console.log(`At a one-sided 5% bar, about ${(rows.length * 0.05).toFixed(1)} rows would show a "significant" holdout by chance alone.`);

  console.log('\nData cleaning (candles dropped as off-grid / invalid):');
  for (const [instrument, report] of Object.entries(dataQuality)) {
    console.log(`  ${instrument.padEnd(9)} ${report.map(r => `${r.timeframe} kept ${r.kept} (-${r.droppedOffGrid + r.droppedBadOHLC})`).join(' | ')}`);
  }

  writeFileSync(OUTPUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    trainEnd: new Date(TRAIN_END * 1000).toISOString(),
    params: { STOP_ATR, TP_R, MAX_HOLD_HOURS, MIN_TRAIN_N, MIN_HOLDOUT_N, MIN_HOLDOUT_T },
    rows, baselines, sensitivity, dataQuality,
  }, null, 2));
  console.log(`\nFull results written to ${OUTPUT}`);
}

if (import.meta.main) main();
