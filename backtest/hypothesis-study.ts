/**
 * FxHouse — Forex/Gold per-instrument hypothesis study
 *
 * Tests a small, PRE-SPECIFIED set of simple entry hypotheses per instrument
 * on the saved 12-month history, with a chronological train/holdout split.
 * Nothing here touches the live engine.
 *
 * Discipline:
 *   - Train = first 8 months, holdout = last 4 months (split by entry time).
 *   - Configs are selected on TRAIN only (n >= 30, avg R > 0, t >= 2).
 *   - Holdout is read once, for the selected configs. The all-config
 *     train-vs-holdout rank correlation is a diagnostic, never a selector.
 *   - Signals use closed H1 bars only; entry is the NEXT bar's open.
 *   - Costs: symmetric half-spread on entry and exit (src/lib/spreadConfig.ts).
 *   - Resolution on M15 candles; SL is checked before TP inside a candle
 *     (conservative), and a gap through the stop exits at the gap open.
 *
 * Input:  ./backtest/data.json   (from download-data.ts)
 * Output: console report + ./backtest/hypothesis-results.json
 *
 * Run with:
 *   bun run .\backtest\hypothesis-study.ts
 */

import { writeFileSync } from 'node:fs';
import { getSpread } from '../src/lib/spreadConfig';
import {
  TRAIN_END, atrPercentileSeries, atrSeries, cleanSeries, dayOf, emaSeries, fmtR, fmtStats, hourOf,
  loadData, median, rsiSeries, simulate, spearman, stats,
} from './lib';
import type { Candle, Series, Stats, Trade } from './lib';

const INPUT = './backtest/data.json';
const OUTPUT = './backtest/hypothesis-results.json';

const INSTRUMENTS = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'GBP/JPY', 'XAU/USD'];

const STOP_ATR = 1.5;          // stop distance in H1 ATR(14)
const TP_R = [1, 2, 3];        // single target, in R
const MAX_HOLD_HOURS = 48;     // time stop
const WARMUP = 260;            // bars before the first signal (EMA200 + ATR percentile)

const MIN_TRAIN_N = 30;
const MIN_TRAIN_T = 2;
const MIN_HOLDOUT_N = 15;
const MIN_HOLDOUT_T = 1.65;    // one-sided 5%

// =================== ENTRY HYPOTHESES ===================
type Signal = { i: number; dir: 1 | -1 };
type StrategyId = 'asian_breakout' | 'asian_fade' | 'donchian_48h' | 'trend_pullback' | 'rsi_reversion';

const STRATEGY_LABEL: Record<StrategyId, string> = {
  asian_breakout: 'Asian-range breakout (London, follow)',
  asian_fade: 'Asian-range sweep (London, fade)',
  donchian_48h: '48h high/low breakout (follow)',
  trend_pullback: 'EMA50/200 trend + RSI pullback',
  rsi_reversion: 'RSI 30/70 mean reversion',
};

interface Indicators {
  ema50: number[]; ema200: number[]; rsi: number[]; atr: number[]; atrPct: number[];
}

function buildSignals(h1: Candle[], ind: Indicators): Record<StrategyId, Signal[]> {
  const out: Record<StrategyId, Signal[]> = {
    asian_breakout: [], asian_fade: [], donchian_48h: [], trend_pullback: [], rsi_reversion: [],
  };

  // Asian range (00:00-07:00 UTC) and the first London-open (07-10 UTC) close outside it.
  let day = -1, hi = -Infinity, lo = Infinity, asianBars = 0, triggered = false;
  for (let i = 0; i < h1.length - 1; i++) {
    const c = h1[i];
    const d = dayOf(c.epoch), h = hourOf(c.epoch);
    if (d !== day) { day = d; hi = -Infinity; lo = Infinity; asianBars = 0; triggered = false; }
    if (h < 7) { hi = Math.max(hi, c.high); lo = Math.min(lo, c.low); asianBars++; }
    else if (h < 10 && !triggered && asianBars >= 5 && i >= WARMUP) {
      const dir = c.close > hi ? 1 : c.close < lo ? -1 : 0;
      if (dir !== 0) {
        triggered = true;
        out.asian_breakout.push({ i, dir: dir as 1 | -1 });
        out.asian_fade.push({ i, dir: -dir as 1 | -1 });
      }
    }
  }

  for (let i = WARMUP; i < h1.length - 1; i++) {
    const c = h1[i];

    // Close beyond the prior 48 bars' extreme.
    let hh = -Infinity, ll = Infinity;
    for (let j = i - 48; j < i; j++) { hh = Math.max(hh, h1[j].high); ll = Math.min(ll, h1[j].low); }
    if (c.close > hh) out.donchian_48h.push({ i, dir: 1 });
    else if (c.close < ll) out.donchian_48h.push({ i, dir: -1 });

    // Trend + pullback: RSI recovers through 40 in an uptrend / falls through 60 in a downtrend.
    const up = ind.ema50[i] > ind.ema200[i] && c.close > ind.ema200[i];
    const down = ind.ema50[i] < ind.ema200[i] && c.close < ind.ema200[i];
    if (up && ind.rsi[i - 1] < 40 && ind.rsi[i] >= 40) out.trend_pullback.push({ i, dir: 1 });
    else if (down && ind.rsi[i - 1] > 60 && ind.rsi[i] <= 60) out.trend_pullback.push({ i, dir: -1 });

    // Mean reversion: RSI exits an extreme.
    if (ind.rsi[i - 1] < 30 && ind.rsi[i] >= 30) out.rsi_reversion.push({ i, dir: 1 });
    else if (ind.rsi[i - 1] > 70 && ind.rsi[i] <= 70) out.rsi_reversion.push({ i, dir: -1 });
  }

  return out;
}

// =================== CONFIG GRID ===================
type VolFilter = 'any' | 'low' | 'high';
type SessionFilter = 'any' | 'killzone';

interface Config { instrument: string; strategy: StrategyId; tpR: number; vol: VolFilter; session: SessionFilter }
interface Result extends Config { train: Stats; holdout: Stats }

const KILL_ZONE_HOURS = new Set([7, 8, 12, 13]); // London 07-09, New York 12-14 UTC

function runConfig(cfg: Config, s: Series, ind: Indicators, signals: Signal[], spread: number): Result {
  const trades: Trade[] = [];
  let busyUntil = 0;

  for (const sig of signals) {
    const entryBar = s.h1[sig.i + 1];
    if (entryBar.epoch < busyUntil) continue; // one open trade per instrument per config

    const pct = ind.atrPct[sig.i];
    if (cfg.vol === 'low' && !(pct < 50)) continue;
    if (cfg.vol === 'high' && !(pct >= 50)) continue;
    if (cfg.session === 'killzone' && !KILL_ZONE_HOURS.has(hourOf(entryBar.epoch))) continue;

    const stopDist = STOP_ATR * ind.atr[sig.i];
    if (!(stopDist > 0)) continue;

    const trade = simulate(s.m15, entryBar.epoch, entryBar.open, sig.dir, stopDist, cfg.tpR, spread, MAX_HOLD_HOURS);
    if (!trade) continue;
    trades.push(trade);
    busyUntil = trade.exitEpoch;
  }

  return {
    ...cfg,
    train: stats(trades.filter(t => t.entryEpoch < TRAIN_END)),
    holdout: stats(trades.filter(t => t.entryEpoch >= TRAIN_END)),
  };
}

// =================== REPORT ===================
const cfgLabel = (c: Config) =>
  `${STRATEGY_LABEL[c.strategy]} | TP ${c.tpR}R | vol ${c.vol} | session ${c.session}`;

function main() {
  const data = loadData(INPUT);
  const all: Result[] = [];

  for (const instrument of INSTRUMENTS) {
    if (!data[instrument]) throw new Error(`${instrument}: missing from ${INPUT}`);
    const s = cleanSeries(data[instrument]).series;
    if (!s.h1.length || !s.m15.length) throw new Error(`${instrument}: missing h1/m15 data in ${INPUT}`);

    const closes = s.h1.map(c => c.close);
    const atr = atrSeries(s.h1);
    const ind: Indicators = {
      ema50: emaSeries(closes, 50), ema200: emaSeries(closes, 200),
      rsi: rsiSeries(closes), atr, atrPct: atrPercentileSeries(atr),
    };
    const signals = buildSignals(s.h1, ind);
    const spread = getSpread(instrument);

    for (const strategy of Object.keys(signals) as StrategyId[]) {
      // The Asian-range strategies are already tied to the London open.
      const sessions: SessionFilter[] = strategy.startsWith('asian') ? ['any'] : ['any', 'killzone'];
      for (const tpR of TP_R) for (const vol of ['any', 'low', 'high'] as VolFilter[]) for (const session of sessions) {
        all.push(runConfig({ instrument, strategy, tpR, vol, session }, s, ind, signals[strategy], spread));
      }
    }
  }

  console.log('FxHouse forex/gold hypothesis study');
  console.log(`Train: entries before ${new Date(TRAIN_END * 1000).toISOString().slice(0, 10)} | Holdout: entries on/after`);
  console.log(`Stop ${STOP_ATR}x H1 ATR, time stop ${MAX_HOLD_HOURS}h, spread included, ${all.length} configs\n`);

  const selected: Result[] = [];

  for (const instrument of INSTRUMENTS) {
    const rows = all.filter(r => r.instrument === instrument);
    const eligible = rows.filter(r => r.train.n >= MIN_TRAIN_N).sort((a, b) => b.train.t - a.train.t);
    const passing = eligible.filter(r => r.train.avgR > 0 && r.train.t >= MIN_TRAIN_T);

    console.log(`===== ${instrument} (spread ${getSpread(instrument)}) =====`);
    console.log(`Train: ${eligible.length} configs with n >= ${MIN_TRAIN_N}; ${passing.length} pass avgR > 0 and t >= ${MIN_TRAIN_T}`);
    console.log('Top 5 on train:');
    for (const r of eligible.slice(0, 5)) console.log(`  ${fmtStats(r.train)}  ${cfgLabel(r)}`);

    if (!passing.length) { console.log('Selected: none — nothing cleared the train bar.\n'); continue; }

    console.log('Selected on train -> holdout:');
    for (const r of passing.slice(0, 3)) {
      const confirmed = r.holdout.n >= MIN_HOLDOUT_N && r.holdout.avgR > 0 && r.holdout.t >= MIN_HOLDOUT_T;
      console.log(`  ${cfgLabel(r)}`);
      console.log(`    train    ${fmtStats(r.train)}`);
      console.log(`    holdout  ${fmtStats(r.holdout)}  => ${confirmed ? 'CONFIRMED' : 'not confirmed'}`);
      selected.push(r);
    }
    console.log('');
  }

  // Multiplicity context and train -> holdout persistence across every config.
  const eligibleAll = all.filter(r => r.train.n >= MIN_TRAIN_N);
  const passingAll = eligibleAll.filter(r => r.train.avgR > 0 && r.train.t >= MIN_TRAIN_T);
  const both = eligibleAll.filter(r => r.holdout.n >= MIN_HOLDOUT_N);
  const rho = spearman(both.map(r => r.train.avgR), both.map(r => r.holdout.avgR));
  const holdoutPositive = both.filter(r => r.holdout.avgR > 0).length;

  console.log('===== Overall =====');
  console.log(`Configs with train n >= ${MIN_TRAIN_N}: ${eligibleAll.length}`);
  console.log(`Passing the train bar: ${passingAll.length} (about ${(eligibleAll.length * 0.023).toFixed(1)} expected by chance alone at t >= 2)`);
  console.log(`Train avgR vs holdout avgR, Spearman rho across ${both.length} configs: ${rho.toFixed(3)}`);
  console.log(`Configs with positive holdout avgR: ${holdoutPositive}/${both.length} (${((holdoutPositive / Math.max(1, both.length)) * 100).toFixed(1)}%)`);
  console.log(`Median train avgR ${fmtR(median(eligibleAll.map(r => r.train.avgR)))} | median holdout avgR ${fmtR(median(both.map(r => r.holdout.avgR)))}`);

  writeFileSync(OUTPUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    trainEnd: new Date(TRAIN_END * 1000).toISOString(),
    params: { STOP_ATR, TP_R, MAX_HOLD_HOURS, MIN_TRAIN_N, MIN_TRAIN_T, MIN_HOLDOUT_N, MIN_HOLDOUT_T },
    selected,
    results: all,
  }, null, 2));
  console.log(`\nFull results written to ${OUTPUT}`);
}

main();
