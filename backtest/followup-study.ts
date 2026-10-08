/**
 * FxHouse — follow-up study: three fixed ideas, 22 tests
 *
 * Follows strategy-candidates.ts, where no candidate held up. Every rule below
 * was written down BEFORE running, and nothing is tuned afterwards. The holdout
 * period has now been looked at in two earlier studies, so anything that passes
 * here is a paper-trading candidate at most.
 *
 *   A. Gold trend-following (6 tests) — does "trade with the trend" survive
 *      other definitions, or was it only gold rising all year? The always-long
 *      control answers that.
 *   B. Synthetics on H4 (10 tests) — same ideas on 4H candles with 4H-sized
 *      stops, so the spread is a much smaller share of each trade.
 *   C. Exit management (6 tests) — break-even and partial exits on the two
 *      least-bad H1 entries (V10 impulse, EUR/USD pullback).
 *
 * Conventions are those of lib.ts / strategy-candidates.ts: closed candles
 * only, entry at the next open, spread included, M15 resolution with the stop
 * checked first, no overlapping trades, train before 2026-06-07 / holdout after.
 *
 * Input:  ./backtest/data.json
 * Output: console report + ./backtest/followup-results.json
 *
 * Run with:
 *   bun run .\backtest\followup-study.ts
 */

import { writeFileSync } from 'node:fs';
import { getVolatilityAdjustedSpread } from '../src/lib/spreadConfig';
import {
  GRANULARITY, TRAIN_END, atrPercentileSeries, atrSeries, cleanSeries, fmtR, hourOf, loadData, median,
  simulateManaged, stats,
} from './lib';
import type { Candle, ExitPlan, Series, Stats, Trade } from './lib';
import {
  buildContext, impulseContinuation, lastCompleted, trendD1, trendH4, trendPullback, verdictOf,
} from './strategy-candidates';
import type { Ctx, Dir, Verdict } from './strategy-candidates';

const INPUT = './backtest/data.json';
const OUTPUT = './backtest/followup-results.json';

const WARMUP = 220;
const STOP_ATR = 1.5;

/** A fully specified trade idea: where and when to enter, and how far the stop is. */
interface Setup { entryEpoch: number; entry: number; dir: Dir; stopDist: number; spread: number }

interface Row {
  group: 'A' | 'B' | 'C'; instrument: string; test: string; exit: string;
  setups: number; full: Stats; train: Stats; holdout: Stats; long: Stats; short: Stats; verdict: Verdict;
}

const sign = (v: number): 0 | Dir => (v > 0 ? 1 : v < 0 ? -1 : 0);

function run(m15: Candle[], setups: Setup[], plan: ExitPlan, maxHoldHours: number): Trade[] {
  const trades: Trade[] = [];
  let busyUntil = 0;
  for (const s of setups) {
    if (s.entryEpoch < busyUntil || !(s.stopDist > 0)) continue; // no overlapping trades
    const trade = simulateManaged(m15, s.entryEpoch, s.entry, s.dir, s.stopDist, plan, s.spread, maxHoldHours);
    if (!trade) continue;
    trades.push(trade);
    busyUntil = trade.exitEpoch;
  }
  return trades;
}

const describe = (p: ExitPlan) =>
  [`TP ${p.tpR}R`, p.partialAtR !== undefined ? `half off at ${p.partialAtR}R` : '', p.beAtR !== undefined ? `stop to entry at ${p.beAtR}R` : '']
    .filter(Boolean).join(', ');

function evaluate(
  group: Row['group'], instrument: string, test: string, m15: Candle[], setups: Setup[], plan: ExitPlan, maxHoldHours: number,
): Row {
  const trades = run(m15, setups, plan, maxHoldHours);
  const train = stats(trades.filter(t => t.entryEpoch < TRAIN_END));
  const holdout = stats(trades.filter(t => t.entryEpoch >= TRAIN_END));
  return {
    group, instrument, test, exit: describe(plan), setups: setups.length,
    full: stats(trades), train, holdout,
    long: stats(trades.filter(t => t.dir === 1)), short: stats(trades.filter(t => t.dir === -1)),
    verdict: verdictOf(train, holdout),
  };
}

// =================== H1 SETUPS ===================
/** Turns "signal on closed H1 bar i" into a setup entered at the next H1 open. */
function h1Setups(ctx: Ctx, picks: { i: number; dir: Dir }[], stopDistAt = (i: number) => STOP_ATR * ctx.atr[i]): Setup[] {
  const out: Setup[] = [];
  for (const { i, dir } of picks) {
    const entryBar = ctx.s.h1[i + 1];
    if (!entryBar) continue;
    out.push({
      entryEpoch: entryBar.epoch, entry: entryBar.open, dir, stopDist: stopDistAt(i),
      spread: getVolatilityAdjustedSpread(ctx.instrument, ctx.atrPct[i]),
    });
  }
  return out;
}

function h1Picks(ctx: Ctx, dirAt: (i: number) => 0 | Dir, keep: (i: number) => boolean = () => true) {
  const out: { i: number; dir: Dir }[] = [];
  for (let i = WARMUP; i < ctx.s.h1.length - 1; i++) {
    const dir = dirAt(i);
    if (dir !== 0 && keep(i)) out.push({ i, dir });
  }
  return out;
}

// =================== A. GOLD ===================
function goldTests(ctx: Ctx): Row[] {
  const { s } = ctx;
  const d1T = trendD1(s.d1), d1Atr = atrSeries(s.d1);
  const d1Index = (i: number) => lastCompleted(s.d1, GRANULARITY.d1, s.h1[i].epoch + GRANULARITY.h1);
  const d1Trend = (i: number): 0 | Dir => d1T[d1Index(i)] ?? 0;
  const aligned = (i: number) => ctx.aligned[i];
  // The H1 bar that closes at 07:00 UTC, so the entry is the 07:00 (London) open — at most one per day.
  const londonOpen = (i: number) => hourOf(s.h1[i].epoch) === 6;

  const test = (name: string, picks: { i: number; dir: Dir }[], plan: ExitPlan, hold = 48, stop?: (i: number) => number) =>
    evaluate('A', ctx.instrument, name, s.m15, h1Setups(ctx, picks, stop), plan, hold);

  return [
    test('A1 with D1+H4 trend, any hour', h1Picks(ctx, aligned), { tpR: 2 }),
    test('A2 with D1+H4 trend, any hour', h1Picks(ctx, aligned), { tpR: 3 }),
    test('A3 CONTROL: always long, trend ignored', h1Picks(ctx, () => 1), { tpR: 2 }),
    test('A4 with D1 trend only, 07:00 UTC entry', h1Picks(ctx, d1Trend, londonOpen), { tpR: 2 }),
    test('A5 with D1+H4 trend, 07:00 UTC entry', h1Picks(ctx, aligned, londonOpen), { tpR: 2 }),
    test('A6 with D1+H4 trend, stop 1x daily ATR, 5-day hold', h1Picks(ctx, aligned), { tpR: 2 }, 120, i => d1Atr[d1Index(i)]),
  ];
}

// =================== B. SYNTHETICS ON H4 ===================
const H4_HOLD_HOURS = 192; // 8 days: the H1 tests' 48 bars, in 4H bars

function h4Tests(instrument: string, s: Series): Row[] {
  const h4 = s.h4;
  const atr = atrSeries(h4), atrPct = atrPercentileSeries(atr);
  const d1T = trendD1(s.d1);
  const trend = (i: number): 0 | Dir => d1T[lastCompleted(s.d1, GRANULARITY.d1, h4[i].epoch + GRANULARITY.h4)] ?? 0;

  const setups = (keep: (i: number, dir: Dir) => boolean): Setup[] => {
    const out: Setup[] = [];
    for (let i = WARMUP; i < h4.length - 1; i++) {
      const dir = trend(i);
      if (dir === 0 || !keep(i, dir)) continue;
      out.push({
        entryEpoch: h4[i + 1].epoch, entry: h4[i + 1].open, dir, stopDist: STOP_ATR * atr[i],
        spread: getVolatilityAdjustedSpread(instrument, atrPct[i]),
      });
    }
    return out;
  };

  // Same impulse rule as the H1 study, on 4H candles: range >= 1.5x the median of the
  // prior 20 ranges and >= 1.2x the prior ATR, candle and prior 3-bar move with the D1 trend.
  const impulse = (i: number, dir: Dir) => {
    const c = h4[i], range = c.high - c.low;
    const med = median(h4.slice(i - 20, i).map(b => b.high - b.low));
    return sign(c.close - c.open) === dir && range >= 1.5 * med && range >= 1.2 * atr[i - 1]
      && sign(h4[i - 1].close - h4[i - 4].close) === dir;
  };

  return [
    evaluate('B', instrument, 'H4 impulse continuation with D1 trend', s.m15, setups(impulse), { tpR: 2 }, H4_HOLD_HOURS),
    evaluate('B', instrument, 'H4 always with D1 trend', s.m15, setups(() => true), { tpR: 2 }, H4_HOLD_HOURS),
  ];
}

// =================== C. EXIT MANAGEMENT ===================
const EXIT_PLANS: ExitPlan[] = [
  { tpR: 2 },
  { tpR: 3, beAtR: 1 },
  { tpR: 3, beAtR: 1, partialAtR: 1, partialFrac: 0.5 },
];

function exitTests(ctx: Ctx, name: string, picks: { i: number; dir: Dir }[]): Row[] {
  return EXIT_PLANS.map(plan => evaluate('C', ctx.instrument, name, ctx.s.m15, h1Setups(ctx, picks), plan, 48));
}

// =================== REPORT ===================
const cell = (s: Stats) =>
  `n=${String(s.n).padStart(3)} win ${s.winRate.toFixed(0).padStart(3)}% avgR ${fmtR(s.avgR)} t ${s.t.toFixed(2).padStart(5)}`;

function printRow(r: Row) {
  console.log(`  ${r.instrument} | ${r.test} | ${r.exit}  (${r.setups} setups)  => ${r.verdict.toUpperCase()}`);
  console.log(`      train    ${cell(r.train)}`);
  console.log(`      holdout  ${cell(r.holdout)}`);
  console.log(`      full     ${cell(r.full)}  total ${fmtR(r.full.totalR)}R  PF ${r.full.profitFactor.toFixed(2)}  maxDD ${r.full.maxDrawdownR.toFixed(1)}R  losing streak ${r.full.maxConsecLosses}  avg hold ${r.full.avgHoldHours.toFixed(0)}h`);
  console.log(`               long ${fmtR(r.long.avgR)} (n=${r.long.n})  short ${fmtR(r.short.avgR)} (n=${r.short.n})`);
}

function main() {
  const data = loadData(INPUT);
  const series = (instrument: string) => {
    if (!data[instrument]) throw new Error(`${instrument}: missing from ${INPUT}`);
    return cleanSeries(data[instrument]).series;
  };
  const rows: Row[] = [];
  const section = (title: string, add: Row[]) => {
    console.log(`\n===== ${title} =====`);
    for (const r of add) { rows.push(r); printRow(r); }
  };

  console.log('FxHouse follow-up study');
  console.log(`Train: entries before ${new Date(TRAIN_END * 1000).toISOString().slice(0, 10)} | Holdout: entries on/after`);

  const gold = buildContext('XAU/USD', series('XAU/USD'));
  section('A. Gold trend-following (H1 entries, stop 1.5x H1 ATR unless stated, 48h hold)', goldTests(gold));

  const b: Row[] = [];
  for (const instrument of ['V10', 'V25', 'V50', 'V75', 'V100']) b.push(...h4Tests(instrument, series(instrument)));
  section(`B. Synthetics on H4 (stop 1.5x H4 ATR, TP 2R, ${H4_HOLD_HOURS}h hold)`, b);

  const v10 = buildContext('V10', series('V10'));
  const eur = buildContext('EUR/USD', series('EUR/USD'));
  section('C. Exit management (H1 entries, stop 1.5x H1 ATR, 48h hold)', [
    ...exitTests(v10, 'H1 impulse continuation', impulseContinuation(v10)),
    ...exitTests(eur, 'H1 trend pullback', trendPullback(eur)),
  ]);

  console.log('\n===== Summary =====');
  console.log(`Tests: ${rows.length}`);
  for (const v of ['holds', 'positive in both, not significant', 'too few trades', 'fails'] as Verdict[]) {
    console.log(`  ${v}: ${rows.filter(r => r.verdict === v).length}`);
  }
  console.log(`At a one-sided 5% bar, about ${(rows.length * 0.05).toFixed(1)} tests would "hold" by chance alone.`);

  writeFileSync(OUTPUT, JSON.stringify({
    generatedAt: new Date().toISOString(), trainEnd: new Date(TRAIN_END * 1000).toISOString(), rows,
  }, null, 2));
  console.log(`\nFull results written to ${OUTPUT}`);
}

if (import.meta.main) main();
