/**
 * FxHouse — check of the 12 "demo candidates" in fxhouse strategies.json (v2.0)
 *
 * Rebuilds each candidate from the rules in that file and runs it on the saved
 * 12-month history, twice: without costs (to compare with the file's own
 * backtest figures) and with the app's spread model (what a trader would get).
 *
 * R is the stop distance (stop_loss_atr x H1 ATR(14) at the signal). Each
 * candidate is run on its own with one open trade at a time. Interpretations
 * where the file is not explicit are written next to the rule. The news filter
 * is not applied (no event history here), and V10 is disabled in the file.
 *
 * The file says these rules were selected from many variations on this same
 * year, so the whole year is in-sample: the train/holdout columns only show
 * whether a result is spread over the year or comes from one part of it.
 *
 * Input:  ./backtest/data.json
 * Output: console report + ./backtest/demo-candidates-results.json
 *
 * Run with:
 *   bun run .\backtest\demo-candidates.ts
 */

import { writeFileSync } from 'node:fs';
import { getVolatilityAdjustedSpread } from '../src/lib/spreadConfig';
import {
  GRANULARITY, TRAIN_END, atrPercentileSeries, atrSeries, cleanSeries, emaSeries, firstIndexAtOrAfter, fmtR,
  hourOf, loadData, rsiSeries, simulate, stats,
} from './lib';
import type { Candle, Series, Stats, Trade } from './lib';
import { lastCompleted } from './strategy-candidates';
import type { Dir } from './strategy-candidates';

const INPUT = './backtest/data.json';
const OUTPUT = './backtest/demo-candidates-results.json';
const WARMUP = 220; // H1 bars before the first signal (ATR percentile lookback)
const NO_TARGET = 1e6;

interface Setup { entryEpoch: number; entry: number; dir: Dir; atr: number; atrPct: number; holdHours?: number }
interface Exit { slAtr: number; tpAtr: number | null; maxHoldHours: number }

interface Ctx {
  instrument: string; s: Series;
  atr: number[]; atrPct: number[]; rsi2: number[];
  /** +1 / -1 from the last closed H4 candle's close vs its EMA50. */
  h4Trend: (i: number) => 0 | Dir;
}

function context(instrument: string, s: Series): Ctx {
  const closes = s.h1.map(c => c.close);
  const atr = atrSeries(s.h1);
  const h4Ema = emaSeries(s.h4.map(c => c.close), 50);
  return {
    instrument, s, atr, atrPct: atrPercentileSeries(atr), rsi2: rsiSeries(closes, 2),
    h4Trend: i => {
      const k = lastCompleted(s.h4, GRANULARITY.h4, s.h1[i].epoch + GRANULARITY.h1);
      const c = s.h4[k], e = h4Ema[k];
      return !c || Number.isNaN(e) ? 0 : c.close > e ? 1 : c.close < e ? -1 : 0;
    },
  };
}

/** Session test on the entry time, start inclusive, end exclusive. null = always open. */
type Session = [number, number] | null;
const inSession = (epoch: number, session: Session) => !session || (hourOf(epoch) >= session[0] && hourOf(epoch) < session[1]);

/** "Market at close of signal candle": filled at the next H1 open. */
function marketSetups(ctx: Ctx, session: Session, dirAt: (i: number) => 0 | Dir): Setup[] {
  const out: Setup[] = [];
  const h1 = ctx.s.h1;
  for (let i = WARMUP; i < h1.length - 1; i++) {
    const dir = dirAt(i);
    if (dir === 0 || !inSession(h1[i + 1].epoch, session)) continue;
    out.push({ entryEpoch: h1[i + 1].epoch, entry: h1[i + 1].open, dir, atr: ctx.atr[i], atrPct: ctx.atrPct[i] });
  }
  return out;
}

// ---- Entry rules ----
const rsi2Pullback = (ctx: Ctx, session: Session) => marketSetups(ctx, session, i => {
  const trend = ctx.h4Trend(i);
  return trend === 1 && ctx.rsi2[i] < 10 ? 1 : trend === -1 && ctx.rsi2[i] > 90 ? -1 : 0;
});

// Body larger than 2x the previous candle's ATR; trade against it.
const bigBarFade = (ctx: Ctx, session: Session) => marketSetups(ctx, session, i => {
  const c = ctx.s.h1[i];
  if (!(Math.abs(c.close - c.open) > 2 * ctx.atr[i - 1])) return 0;
  return c.close < c.open ? 1 : c.close > c.open ? -1 : 0;
});

// H1 high/low beyond the 40 H4 candles before the H4 candle this H1 bar belongs to.
const h4ChannelBreakout = (ctx: Ctx, session: Session, lookback = 40) => marketSetups(ctx, session, i => {
  const { h1, h4 } = ctx.s;
  const cur = firstIndexAtOrAfter(h4, Math.floor(h1[i].epoch / GRANULARITY.h4) * GRANULARITY.h4);
  if (cur < lookback) return 0;
  let hi = -Infinity, lo = Infinity;
  for (let k = cur - lookback; k < cur; k++) { hi = Math.max(hi, h4[k].high); lo = Math.min(lo, h4[k].low); }
  const up = h1[i].high > hi, down = h1[i].low < lo;
  return up === down ? 0 : up ? 1 : -1;
});

/** The last daily candle fully closed before the UTC day containing `epoch`. */
const previousDay = (s: Series, epoch: number): Candle | undefined =>
  s.d1[lastCompleted(s.d1, GRANULARITY.d1, Math.floor(epoch / GRANULARITY.d1) * GRANULARITY.d1)];

// V25: an H1 candle is the first to trade beyond yesterday's high/low.
const prevDayBreakoutMarket = (ctx: Ctx) => marketSetups(ctx, null, i => {
  const h1 = ctx.s.h1, pd = previousDay(ctx.s, h1[i].epoch);
  if (!pd) return 0;
  const up = h1[i].high > pd.high && h1[i - 1].high <= pd.high;
  const down = h1[i].low < pd.low && h1[i - 1].low >= pd.low;
  return up === down ? 0 : up ? 1 : -1;
});

/**
 * First M15 candle in [from, to) to trade through a buy-stop at `hi` or a
 * sell-stop at `lo`. A side already breached at `from` is not placed (a stop
 * order has to sit beyond the price). A candle that takes both sides is
 * skipped, since the order of the two fills cannot be known.
 */
function stopOrderFill(m15: Candle[], from: number, to: number, hi: number, lo: number) {
  let k = firstIndexAtOrAfter(m15, from);
  if (!m15[k] || m15[k].epoch >= to) return null;
  const buyLive = m15[k].open < hi, sellLive = m15[k].open > lo;
  for (; k < m15.length && m15[k].epoch < to; k++) {
    const c = m15[k];
    const up = buyLive && c.high >= hi, down = sellLive && c.low <= lo;
    if (up && down) return null;
    if (up) return { epoch: c.epoch, price: Math.max(c.open, hi), dir: 1 as Dir };
    if (down) return { epoch: c.epoch, price: Math.min(c.open, lo), dir: -1 as Dir };
  }
  return null;
}

function stopSetup(ctx: Ctx, fill: NonNullable<ReturnType<typeof stopOrderFill>>, holdHours?: number): Setup | null {
  const i = lastCompleted(ctx.s.h1, GRANULARITY.h1, fill.epoch);
  if (i < WARMUP) return null;
  return { entryEpoch: fill.epoch, entry: fill.price, dir: fill.dir, atr: ctx.atr[i], atrPct: ctx.atrPct[i], holdHours };
}

// USD/JPY: buy-stop at yesterday's high, sell-stop at yesterday's low, placed at
// 07:00 UTC, live until 16:00, one fill per day; flat by 20:00 UTC at the latest.
function prevDayBreakoutStops(ctx: Ctx, maxHoldHours: number): Setup[] {
  const out: Setup[] = [];
  const { d1, m15 } = ctx.s;
  for (let j = 1; j < d1.length; j++) {
    const day = d1[j].epoch, pd = d1[j - 1];
    if (day - pd.epoch > 4 * GRANULARITY.d1) continue;
    const fill = stopOrderFill(m15, day + 7 * 3600, day + 16 * 3600, pd.high, pd.low);
    if (!fill) continue;
    const setup = stopSetup(ctx, fill, Math.min(maxHoldHours, (day + 20 * 3600 - fill.epoch) / 3600));
    if (setup) out.push(setup);
  }
  return out;
}

// An H4 candle inside the previous one; stop orders at the mother candle's
// high and low for the 4 hours after the inside candle closes.
function insideBarBreakout(ctx: Ctx): Setup[] {
  const out: Setup[] = [];
  const { h4, m15 } = ctx.s;
  for (let k = 1; k < h4.length; k++) {
    const mother = h4[k - 1], inside = h4[k];
    if (!(inside.high <= mother.high && inside.low >= mother.low)) continue;
    const from = inside.epoch + GRANULARITY.h4;
    const fill = stopOrderFill(m15, from, from + 4 * 3600, mother.high, mother.low);
    const setup = fill && stopSetup(ctx, fill);
    if (setup) out.push(setup);
  }
  return out;
}

// ---- Candidates (from the file) ----
const DAY: Session = [7, 17];
interface Candidate {
  id: string; instrument: string; exit: Exit; build: (ctx: Ctx) => Setup[];
  claimed: { trades: number; winRate: number; totalR: number; note?: string };
}

const CANDIDATES: Candidate[] = [
  { id: 'xau_rsi2_pullback', instrument: 'XAU/USD', exit: { slAtr: 2, tpAtr: 3, maxHoldHours: 24 }, build: c => rsi2Pullback(c, DAY), claimed: { trades: 121, winRate: 52, totalR: 26.8 } },
  { id: 'gbpusd_rsi2_pullback', instrument: 'GBP/USD', exit: { slAtr: 1.5, tpAtr: 1.5, maxHoldHours: 24 }, build: c => rsi2Pullback(c, DAY), claimed: { trades: 137, winRate: 61, totalR: 21.1 } },
  { id: 'gbpusd_swing_breakout_40', instrument: 'GBP/USD', exit: { slAtr: 1.5, tpAtr: 3, maxHoldHours: 240 }, build: c => h4ChannelBreakout(c, DAY), claimed: { trades: 44, winRate: 45.5, totalR: 12.9, note: 'out-of-sample part only' } },
  { id: 'usdjpy_prevday_breakout', instrument: 'USD/JPY', exit: { slAtr: 1.5, tpAtr: null, maxHoldHours: 8 }, build: c => prevDayBreakoutStops(c, 8), claimed: { trades: 117, winRate: 42, totalR: 25.7 } },
  { id: 'eurusd_bigbar_fade', instrument: 'EUR/USD', exit: { slAtr: 1, tpAtr: 2, maxHoldHours: 8 }, build: c => bigBarFade(c, DAY), claimed: { trades: 64, winRate: 50, totalR: 17.8 } },
  { id: 'audusd_bigbar_fade', instrument: 'AUD/USD', exit: { slAtr: 1.5, tpAtr: 2.25, maxHoldHours: 8 }, build: c => bigBarFade(c, DAY), claimed: { trades: 55, winRate: 61.8, totalR: 18.3 } },
  { id: 'gbpjpy_bigbar_fade', instrument: 'GBP/JPY', exit: { slAtr: 2, tpAtr: 4, maxHoldHours: 8 }, build: c => bigBarFade(c, DAY), claimed: { trades: 60, winRate: 56.7, totalR: 10.3 } },
  { id: 'v25_prevday_breakout', instrument: 'V25', exit: { slAtr: 2, tpAtr: 4, maxHoldHours: 8 }, build: prevDayBreakoutMarket, claimed: { trades: 383, winRate: 54.3, totalR: 49.0 } },
  { id: 'v50_rsi2_pullback', instrument: 'V50', exit: { slAtr: 1, tpAtr: 1, maxHoldHours: 24 }, build: c => rsi2Pullback(c, null), claimed: { trades: 429, winRate: 55.2, totalR: 34.4 } },
  { id: 'v75_insidebar_breakout', instrument: 'V75', exit: { slAtr: 2, tpAtr: 4, maxHoldHours: 48 }, build: insideBarBreakout, claimed: { trades: 124, winRate: 50, totalR: 49.1 } },
  { id: 'v100_insidebar_breakout', instrument: 'V100', exit: { slAtr: 1, tpAtr: 1.5, maxHoldHours: 48 }, build: insideBarBreakout, claimed: { trades: 174, winRate: 47.1, totalR: 28.5 } },
  { id: 'boom1000_insidebar_breakout', instrument: 'BOOM1000', exit: { slAtr: 2, tpAtr: 4, maxHoldHours: 48 }, build: insideBarBreakout, claimed: { trades: 128, winRate: 46.1, totalR: 43.1 } },
];

// ---- Runner ----
function run(ctx: Ctx, setups: Setup[], exit: Exit, withCosts: boolean): Trade[] {
  const trades: Trade[] = [];
  let busyUntil = 0;
  for (const s of [...setups].sort((a, b) => a.entryEpoch - b.entryEpoch)) {
    if (s.entryEpoch < busyUntil || !(s.atr > 0)) continue; // one open trade at a time
    const spread = withCosts ? getVolatilityAdjustedSpread(ctx.instrument, s.atrPct) : 0;
    const tpR = exit.tpAtr === null ? NO_TARGET : exit.tpAtr / exit.slAtr;
    const trade = simulate(ctx.s.m15, s.entryEpoch, s.entry, s.dir, exit.slAtr * s.atr, tpR, spread, s.holdHours ?? exit.maxHoldHours);
    if (!trade) continue;
    trades.push(trade);
    busyUntil = trade.exitEpoch;
  }
  return trades;
}

interface Row {
  id: string; instrument: string; claimed: Candidate['claimed']; setups: number;
  noCost: Stats; withCost: Stats; train: Stats; holdout: Stats; long: Stats; short: Stats;
  /** Typical spread as a share of the stop distance. */
  spreadShareOfStop: number;
}

const brief = (s: Stats) => `n=${String(s.n).padStart(3)} win ${s.winRate.toFixed(1).padStart(5)}% avgR ${fmtR(s.avgR)} total ${fmtR(s.totalR).padStart(8)}R t ${s.t.toFixed(2).padStart(5)}`;

function main() {
  const data = loadData(INPUT);
  const contexts = new Map<string, Ctx>();
  const rows: Row[] = [];

  console.log('FxHouse demo-candidate check (fxhouse strategies.json v2.0)');
  console.log(`Train: entries before ${new Date(TRAIN_END * 1000).toISOString().slice(0, 10)} | Holdout: entries on/after (both in-sample for these rules)\n`);

  for (const cand of CANDIDATES) {
    if (!data[cand.instrument]) throw new Error(`${cand.instrument}: missing from ${INPUT}`);
    if (!contexts.has(cand.instrument)) contexts.set(cand.instrument, context(cand.instrument, cleanSeries(data[cand.instrument]).series));
    const ctx = contexts.get(cand.instrument)!;

    const setups = cand.build(ctx);
    const free = run(ctx, setups, cand.exit, false);
    const paid = run(ctx, setups, cand.exit, true);
    const shares = setups.filter(s => s.atr > 0).map(s => getVolatilityAdjustedSpread(cand.instrument, s.atrPct) / (cand.exit.slAtr * s.atr));
    const row: Row = {
      id: cand.id, instrument: cand.instrument, claimed: cand.claimed, setups: setups.length,
      noCost: stats(free), withCost: stats(paid),
      train: stats(paid.filter(t => t.entryEpoch < TRAIN_END)), holdout: stats(paid.filter(t => t.entryEpoch >= TRAIN_END)),
      long: stats(paid.filter(t => t.dir === 1)), short: stats(paid.filter(t => t.dir === -1)),
      spreadShareOfStop: shares.length ? shares.reduce((a, b) => a + b, 0) / shares.length : 0,
    };
    rows.push(row);

    console.log(`===== ${cand.id} (${cand.instrument}) — SL ${cand.exit.slAtr} ATR / TP ${cand.exit.tpAtr ?? 'none'} ATR / hold ${cand.exit.maxHoldHours}h =====`);
    console.log(`  file claims   n=${String(cand.claimed.trades).padStart(3)} win ${cand.claimed.winRate.toFixed(1).padStart(5)}%             total ${fmtR(cand.claimed.totalR).padStart(8)}R${cand.claimed.note ? `  (${cand.claimed.note})` : ''}`);
    console.log(`  no costs      ${brief(row.noCost)}`);
    console.log(`  with spread   ${brief(row.withCost)}  PF ${row.withCost.profitFactor.toFixed(2)}  maxDD ${row.withCost.maxDrawdownR.toFixed(1)}R  losing streak ${row.withCost.maxConsecLosses}`);
    console.log(`    first 8 mo  ${brief(row.train)}`);
    console.log(`    last 4 mo   ${brief(row.holdout)}`);
    console.log(`    long ${fmtR(row.long.avgR)} (n=${row.long.n})  short ${fmtR(row.short.avgR)} (n=${row.short.n})  exits TP ${row.withCost.tpRate.toFixed(0)}% / SL ${row.withCost.slRate.toFixed(0)}% / time ${row.withCost.timeRate.toFixed(0)}%  spread = ${(row.spreadShareOfStop * 100).toFixed(1)}% of stop\n`);
  }

  console.log('===== Summary (with spread) =====');
  const positive = rows.filter(r => r.withCost.avgR > 0);
  const both = rows.filter(r => r.train.avgR > 0 && r.holdout.avgR > 0);
  const significant = rows.filter(r => r.withCost.t >= 1.65);
  console.log(`Candidates: ${rows.length} | positive over the year: ${positive.length} | positive in both parts: ${both.length} | full-year t >= 1.65: ${significant.length}`);
  console.log(`Sum of total R: file ${fmtR(rows.reduce((s, r) => s + r.claimed.totalR, 0))}R | no costs ${fmtR(rows.reduce((s, r) => s + r.noCost.totalR, 0))}R | with spread ${fmtR(rows.reduce((s, r) => s + r.withCost.totalR, 0))}R`);

  // Each rule, unchanged, on every instrument. A rule that captures something real
  // about markets should not work only on the one instrument it was picked for.
  console.log('\n===== Same rule on every instrument (avg R per trade, no costs so the V50/V100 spread does not mask it) =====');
  const instruments = Object.keys(data).filter(k => data[k]?.h1?.length);
  for (const k of instruments) if (!contexts.has(k)) contexts.set(k, context(k, cleanSeries(data[k]).series));
  const short = (k: string) => k.replace('/', '').replace('BOOM1000', 'BOOM').padStart(7);
  console.log(`${''.padEnd(28)}${instruments.map(short).join('')}   others>0`);
  const cross: { id: string; avgR: Record<string, number> }[] = [];
  for (const cand of CANDIDATES) {
    const avgR: Record<string, number> = {};
    for (const k of instruments) avgR[k] = stats(run(contexts.get(k)!, cand.build(contexts.get(k)!), cand.exit, false)).avgR;
    cross.push({ id: cand.id, avgR });
    const others = instruments.filter(k => k !== cand.instrument);
    const cells = instruments.map(k => `${k === cand.instrument ? '*' : ' '}${fmtR(avgR[k]).slice(0, 6)}`.padStart(7)).join('');
    console.log(`${cand.id.padEnd(28)}${cells}   ${others.filter(k => avgR[k] > 0).length}/${others.length}`);
  }
  console.log('* = the instrument the file assigns the rule to');

  writeFileSync(OUTPUT, JSON.stringify({ generatedAt: new Date().toISOString(), trainEnd: new Date(TRAIN_END * 1000).toISOString(), rows, cross }, null, 2));
  console.log(`\nFull results written to ${OUTPUT}`);
}

if (import.meta.main) main();
