/**
 * FxHouse — replay of the SHIPPED SMC CHoCH + FVG module over the saved history
 *
 * Calls `evaluateSmcChochFvg` (the module the app and the signal engine both
 * use) once per closed H1 candle, exactly as the hourly engine would, and then
 * follows each signal the way the app handles it:
 *   - limit order, live from the trigger candle's close;
 *   - dropped if still unfilled 24 hours later (the app's existing rule for swing setups);
 *   - no cancellation when the target is touched first, no time limit on an open trade;
 *   - one live signal per instrument (the arbiter's one-setup-per-pair rule).
 *
 * Reports three things:
 *   1. Parity   — do the module's setups match the research script (smc-choch-fvg.ts)?
 *   2. Outcomes on M15 candles with spread — the best estimate of real results.
 *   3. Outcomes as the app's own 1H wick resolver would record them — what the
 *      Signal History page will show.
 *
 * Input:  ./backtest/data.json
 * Output: console report + ./backtest/smc-app-replay-results.json
 *
 * Run with:
 *   bun run .\backtest\smc-app-replay.ts
 */

import { writeFileSync } from 'node:fs';
import { evaluateSmcChochFvg } from '../supabase/functions/_shared/analysis/smcChochFvg';
import type { SmcSetup } from '../supabase/functions/_shared/analysis/smcChochFvg';
import type { TradingInstrument } from '../supabase/functions/_shared/analysis/core';
import { resolveIntrabar } from '../src/lib/intrabarResolution';
import { getSpread, getVolatilityAdjustedSpread } from '../src/lib/spreadConfig';
import {
  GRANULARITY, TRAIN_END, atrPercentileSeries, atrSeries, cleanSeries, firstIndexAtOrAfter, fmtR, loadData, simulate, stats,
} from './lib';
import type { Series, Stats, Trade } from './lib';
import { PRIMARY, setups as researchSetups } from './smc-choch-fvg';

const INPUT = './backtest/data.json';
const OUTPUT = './backtest/smc-app-replay-results.json';
const FOREX: TradingInstrument[] = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'GBP/JPY', 'XAU/USD'];
const WARMUP = 220;
const EXPIRY_SECONDS = 24 * 3600;
const HALF_YEAR = Date.UTC(2026, 3, 7) / 1000;

interface Signal { instrument: TradingInstrument; setup: SmcSetup; atrPct: number }

/** The hourly engine: one evaluation just after every H1 close, on the candles it would have fetched. */
function replay(instrument: TradingInstrument, s: Series): Signal[] {
  const atrPct = atrPercentileSeries(atrSeries(s.h1));
  const out: Signal[] = [];
  for (let i = WARMUP; i < s.h1.length - 1; i++) {
    const now = s.h1[i].epoch + GRANULARITY.h1 + 5;
    // 200 H1 and 100 H4 candles ending with the one still forming — what the engine fetches.
    const h1 = s.h1.slice(Math.max(0, i - 198), i + 2);
    const h4End = firstIndexAtOrAfter(s.h4, now);
    const h4 = s.h4.slice(Math.max(0, h4End - 100), h4End);
    const { setup } = evaluateSmcChochFvg(instrument, h4, h1, now);
    if (setup) out.push({ instrument, setup, atrPct: atrPct[i] });
  }
  return out;
}

interface Result { trade: Trade | null; freeAt: number; status: 'closed' | 'expired' | 'open' }
const dirOf = (setup: SmcSetup): 1 | -1 => (setup.direction === 'bullish' ? 1 : -1);

/** Truth model: M15 candles, spread charged, stop checked first in the fill candle. */
function followM15(s: Series, sig: Signal): Result {
  const { setup } = sig;
  const dir = dirOf(setup);
  const risk = dir * (setup.entry - setup.stopLoss);
  const spread = getVolatilityAdjustedSpread(sig.instrument, sig.atrPct);
  const half = spread / 2;
  const expiry = setup.triggerCloseEpoch + EXPIRY_SECONDS;

  for (let k = firstIndexAtOrAfter(s.m15, setup.triggerCloseEpoch); k < s.m15.length && s.m15[k].epoch < expiry; k++) {
    const c = s.m15[k];
    if (!(dir === 1 ? c.low <= setup.entry : c.high >= setup.entry)) continue;
    const stopQuote = setup.stopLoss + dir * half;
    if (dir === 1 ? c.low <= stopQuote : c.high >= stopQuote) {
      const trade: Trade = { entryEpoch: c.epoch, exitEpoch: c.epoch, dir, exit: 'SL', r: -(risk + half) / risk, mfeR: 0, maeR: -1 };
      return { trade, freeAt: c.epoch, status: 'closed' };
    }
    const t = simulate(s.m15, c.epoch + GRANULARITY.m15, setup.entry, dir, risk, 2, spread, 1e6);
    if (!t) return { trade: null, freeAt: Infinity, status: 'open' };
    return { trade: { ...t, entryEpoch: c.epoch }, freeAt: t.exitEpoch, status: 'closed' };
  }
  return { trade: null, freeAt: expiry, status: 'expired' };
}

/** The app's own outcome tracker: 1H wick replay with a fill gate, as checkOutcomes runs it. */
function followAppResolver(s: Series, sig: Signal): Result {
  const { setup } = sig;
  const dir = dirOf(setup);
  const expiry = setup.triggerCloseEpoch + EXPIRY_SECONDS;
  const r = resolveIntrabar({
    direction: setup.direction, entryPrice: setup.entry, stopLoss: setup.stopLoss,
    takeProfit1: setup.takeProfit, takeProfit2: setup.takeProfit, takeProfit3: setup.takeProfit,
    generatedAtEpoch: setup.triggerCloseEpoch, requiresFill: true,
    spread: getSpread(sig.instrument), spreadMultiplier: 1,
  }, s.h1);

  if (!r.entryFilled || r.entryFilledAtEpoch === null || r.entryFilledAtEpoch >= expiry) {
    return { trade: null, freeAt: expiry, status: 'expired' };
  }
  if (!r.outcome || r.exitPrice === null || r.resolvedAtEpoch === null) return { trade: null, freeAt: Infinity, status: 'open' };
  // Same arithmetic as checkOutcomes: P&L from the spread-adjusted fill over the entry-to-stop distance.
  const rMultiple = (dir * (r.exitPrice - r.effectiveEntry)) / Math.abs(setup.entry - setup.stopLoss);
  const trade: Trade = {
    entryEpoch: r.entryFilledAtEpoch, exitEpoch: r.resolvedAtEpoch, dir, exit: r.outcome === 'won' ? 'TP' : 'SL',
    r: rMultiple, mfeR: 0, maeR: 0,
  };
  return { trade, freeAt: r.resolvedAtEpoch + GRANULARITY.h1, status: 'closed' };
}

interface Run { trades: (Trade & { instrument: string })[]; signals: number; blocked: number; expired: number; open: number }

/** One live signal per instrument: a new setup is blocked while an earlier one is pending or open. */
function run(signals: Signal[], s: Series, follow: (s: Series, sig: Signal) => Result): Run {
  const out: Run = { trades: [], signals: 0, blocked: 0, expired: 0, open: 0 };
  let freeAt = 0;
  for (const sig of signals) {
    if (sig.setup.triggerCloseEpoch < freeAt) { out.blocked++; continue; }
    out.signals++;
    const res = follow(s, sig);
    freeAt = res.freeAt;
    if (res.status === 'expired') out.expired++;
    else if (res.status === 'open') out.open++;
    else if (res.trade) out.trades.push({ ...res.trade, instrument: sig.instrument });
  }
  return out;
}

const brief = (s: Stats) => `n=${String(s.n).padStart(3)} win ${s.winRate.toFixed(0).padStart(3)}% avgR ${fmtR(s.avgR)} total ${fmtR(s.totalR).padStart(8)}R t ${s.t.toFixed(2).padStart(5)}`;

function main() {
  const data = loadData(INPUT);
  const perInstrument: Record<string, unknown> = {};
  const pooled = { m15: [] as Run['trades'], app: [] as Run['trades'] };
  const totals = { signals: 0, blocked: 0, expired: 0, open: 0, setups: 0 };
  let parityMissing = 0, parityExtra = 0, parityPriceDiffs = 0, researchTotal = 0;

  console.log('FxHouse replay of the shipped SMC CHoCH + FVG module\n');
  console.log('===== Per instrument =====');
  for (const instrument of FOREX) {
    if (!data[instrument]) throw new Error(`${instrument}: missing from ${INPUT}`);
    const s = cleanSeries(data[instrument]).series;
    const signals = replay(instrument, s);

    // Parity with the research script (which reads the whole history at once).
    const research = new Map(researchSetups(s, PRIMARY).map(r => [r.trigClose, r]));
    const mine = new Map(signals.map(x => [x.setup.triggerCloseEpoch, x.setup]));
    researchTotal += research.size;
    for (const [epoch, r] of research) {
      const m = mine.get(epoch);
      if (!m) { parityMissing++; continue; }
      // The module rounds levels to the precision the app displays (1 pip / 1 cent).
      const tol = 0.6 * 10 ** -(instrument === 'XAU/USD' || instrument.includes('JPY') ? 2 : 4);
      if (Math.abs(m.entry - r.entry) > tol || Math.abs(m.stopLoss - r.stop) > tol) parityPriceDiffs++;
    }
    for (const epoch of mine.keys()) if (!research.has(epoch)) parityExtra++;

    const m15 = run(signals, s, followM15);
    const app = run(signals, s, followAppResolver);
    pooled.m15.push(...m15.trades); pooled.app.push(...app.trades);
    totals.setups += signals.length; totals.signals += m15.signals; totals.blocked += m15.blocked; totals.expired += m15.expired; totals.open += m15.open;
    perInstrument[instrument] = { setups: signals.length, m15: { ...m15, trades: undefined, stats: stats(m15.trades) }, app: { ...app, trades: undefined, stats: stats(app.trades) } };
    console.log(`  ${instrument.padEnd(8)} setups ${String(signals.length).padStart(3)} | issued ${String(m15.signals).padStart(3)} blocked ${String(m15.blocked).padStart(2)} expired unfilled ${String(m15.expired).padStart(2)} | M15 ${brief(stats(m15.trades))} | app resolver ${brief(stats(app.trades))}`);
  }

  console.log('\n===== Parity with the research script =====');
  console.log(`  research setups ${researchTotal} | missing from the module ${parityMissing} | extra in the module ${parityExtra} | entry/stop differences ${parityPriceDiffs}`);

  const section = (title: string, trades: Run['trades']) => {
    const st = stats(trades);
    console.log(`\n===== ${title} =====`);
    console.log(`  all            ${brief(st)}  PF ${st.profitFactor.toFixed(2)}  maxDD ${st.maxDrawdownR.toFixed(1)}R  losing streak ${st.maxConsecLosses}  avg hold ${st.avgHoldHours.toFixed(0)}h`);
    console.log(`  first half     ${brief(stats(trades.filter(t => t.entryEpoch < HALF_YEAR)))}`);
    console.log(`  second half    ${brief(stats(trades.filter(t => t.entryEpoch >= HALF_YEAR)))}`);
    console.log(`  first 8 months ${brief(stats(trades.filter(t => t.entryEpoch < TRAIN_END)))}`);
    console.log(`  last 4 months  ${brief(stats(trades.filter(t => t.entryEpoch >= TRAIN_END)))}`);
    console.log(`  long           ${brief(stats(trades.filter(t => t.dir === 1)))}`);
    console.log(`  short          ${brief(stats(trades.filter(t => t.dir === -1)))}`);
    return st;
  };
  console.log(`\nSignals: ${totals.setups} setups found | ${totals.signals} issued | ${totals.blocked} blocked (pair already had a live setup) | ${totals.expired} expired unfilled after 24h | ${totals.open} still open at the end`);
  const m15Stats = section('Outcomes on M15 candles with spread (best estimate)', pooled.m15.sort((a, b) => a.entryEpoch - b.entryEpoch));
  const appStats = section("Outcomes as the app's 1H resolver records them", pooled.app.sort((a, b) => a.entryEpoch - b.entryEpoch));

  writeFileSync(OUTPUT, JSON.stringify({
    generatedAt: new Date().toISOString(), totals, parity: { researchTotal, parityMissing, parityExtra, parityPriceDiffs },
    perInstrument, pooled: { m15: m15Stats, app: appStats },
  }, null, 2));
  console.log(`\nFull results written to ${OUTPUT}`);
}

if (import.meta.main) main();
