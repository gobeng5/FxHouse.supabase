/**
 * FxHouse — the EUR/USD Z-score gem, unchanged, on the other forex pairs and gold.
 *
 * The gem was built on EUR/USD, so every other pair is out-of-sample: nothing about
 * them shaped its settings. Rule (selectiveGems.ts evaluateEurUsdZScore): daily close
 * above both EMA50 and EMA200 (below for shorts), then on H1 a 30-bar Z-score beyond
 * -1.8 / +1.8 with RSI(14) under 40 / over 60; market entry at the H1 close, SL 1.0
 * ATR(H1), TP 1.6 ATR, out after 120h. Replayed hourly on closed candles exactly as
 * the engine runs it (400 daily candles, 200 H1), one trade at a time, each pair's
 * own spread.
 *
 * Deriv keeps only ~1 year of daily candles, so the live rule's 200-day EMA leaves it
 * the last ~2.5 months of the year to trade in. A labelled VARIANT takes the daily trend
 * from EMA50 alone (close above / below it), which needs 50 days and so covers ~10 of
 * the 12 months. Everything else is identical (same shared indicator functions).
 *
 * Pass bar, as for every study: >= 30 trades, profit in train (first 60%) and holdout,
 * profit in at least two of three equal periods including the last, t >= 2, and fewer
 * than 1% of 200 random-walk years at the pair's volatility doing as well.
 *
 * Run with:
 *   bun run .\backtest\zscore-forex-forward.ts
 */

import { writeFileSync } from 'node:fs';
import { getVolatilityAdjustedSpread } from '../src/lib/spreadConfig';
import { evaluateEurUsdZScore } from '../supabase/functions/_shared/analysis/selectiveGems.ts';
import { calculateATR, calculateEMA, calculateRSI } from '../supabase/functions/_shared/analysis/indicators.ts';
import { cleanSeries, firstIndexAtOrAfter, loadData, simulate, stats } from './lib';
import type { Candle, Series, Stats, Trade } from './lib';
import { annualVol, compact } from './research-agent';
import { randomWalk } from './synthetic-pick-study';

const PAIRS = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'GBP/JPY', 'XAU/USD'];
const upTo = (c: Candle[], t: number, n: number) => c.slice(Math.max(0, firstIndexAtOrAfter(c, t) - n), firstIndexAtOrAfter(c, t));

/** The gem with the daily trend from EMA50 only (the variant). */
function zscoreEma50(d1: Candle[], h1: Candle[], t: number) {
  const daily = d1.filter(c => c.epoch + 86400 <= t), hourly = h1.filter(c => c.epoch + 3600 <= t);
  if (daily.length < 60 || hourly.length < 50) return null;
  const dc = daily.map(c => c.close), e50 = calculateEMA(dc, 50);
  if (!e50.length) return null;
  const last = dc[dc.length - 1], bias = last > e50[e50.length - 1] ? 1 : last < e50[e50.length - 1] ? -1 : 0;
  if (!bias) return null;
  const hc = hourly.map(c => c.close), w = hc.slice(-30), m = w.reduce((a, b) => a + b, 0) / 30;
  const sd = Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / 30);
  const z = sd > 0 ? (hc[hc.length - 1] - m) / sd : 0, rsi = calculateRSI(hc, 14);
  const dir = z < -1.8 && rsi < 40 && bias === 1 ? 1 : z > 1.8 && rsi > 60 && bias === -1 ? -1 : 0;
  if (!dir) return null;
  const atr = calculateATR(hourly, 14);
  if (atr <= 0) return null;
  const entry = hc[hc.length - 1];
  return { direction: dir === 1 ? 'bullish' : 'bearish', entry, stopLoss: entry - dir * atr, takeProfit: entry + dir * 1.6 * atr };
}

function replay(inst: string, s: Series, variant = false): Trade[] {
  const spread = getVolatilityAdjustedSpread(inst as never, null);
  const trades: Trade[] = [];
  let busyUntil = 0;
  const start = Math.ceil((s.m15[0].epoch + 30 * 86400) / 3600) * 3600, end = s.m15[s.m15.length - 1].epoch;
  for (let grid = start; grid < end; grid += 3600) {
    const t = grid + 60;
    if (t < busyUntil) continue;
    const g = variant ? zscoreEma50(upTo(s.d1, t, 400), upTo(s.h1, t, 200), t) : evaluateEurUsdZScore(upTo(s.d1, t, 400), upTo(s.h1, t, 200), t);
    if (!g) continue;
    const dir = g.direction === 'bullish' ? 1 : -1;
    const stopDist = Math.abs(g.entry - g.stopLoss);
    const tr = simulate(s.m15, t, g.entry, dir, stopDist, Math.abs(g.takeProfit - g.entry) / stopDist, spread, 120);
    if (tr) { trades.push(tr); busyUntil = tr.exitEpoch; }
  }
  return trades;
}

function main() {
  const raw = loadData('./backtest/data.json');
  const out: Record<string, unknown>[] = [];
  const sign = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
  for (const variant of [false, true]) {
  console.log(variant ? '\n=== VARIANT: daily trend from EMA50 only (covers ~10 months)' : '=== LIVE RULE: daily EMA50 + EMA200 (data allows only the last ~2.5 months)');
  for (const inst of PAIRS) {
    const s = cleanSeries(raw[inst]).series;
    const from = s.m15[0].epoch + 30 * 86400, to = s.m15[s.m15.length - 1].epoch, years = (to - from) / (365 * 86400);
    const ts = replay(inst, s, variant);
    const full = stats(ts), split = from + 0.6 * (to - from);
    const train = stats(ts.filter(t => t.entryEpoch < split)), hold = stats(ts.filter(t => t.entryEpoch >= split));
    const w = (to - from) / 3;
    const seg: Stats[] = [0, 1, 2].map(k => stats(ts.filter(t => t.entryEpoch >= from + k * w && t.entryEpoch < from + (k + 1) * w)));
    const base = full.n >= 30 && train.avgR > 0 && hold.avgR > 0 && full.t >= 2 && seg.filter(x => x.avgR > 0).length >= 2 && seg[2].avgR > 0;
    let luck: number | null = null;
    if (base) {
      const paths = Array.from({ length: 200 }, () => randomWalk(s, annualVol(s)));
      luck = paths.filter(p => stats(replay(inst, p, variant)).totalR >= full.totalR).length / 200;
    }
    const pass = base && luck !== null && luck < 0.01;
    console.log(`${(inst === 'EUR/USD' ? '*' : ' ')}${inst.padEnd(8)} n ${String(full.n).padStart(3)}  win ${full.winRate.toFixed(0).padStart(2)}%  avg ${sign(full.avgR)}R  t ${full.t.toFixed(1).padStart(4)}  ${(full.totalR / years).toFixed(1).padStart(5)}R/yr  DD ${full.maxDrawdownR.toFixed(1)}R  train ${sign(train.avgR)} holdout ${sign(hold.avgR)}  thirds ${seg.map(x => `${sign(x.avgR)}(${x.n})`).join(' / ')}${luck !== null ? `  luck ${(luck * 100).toFixed(1)}%` : ''}  ${pass ? 'PASS' : 'fail'}`);
    out.push({ variant: variant ? 'ema50_only' : 'live', instrument: inst, pass, luckShare: luck, perYearR: full.totalR / years, full: compact(full), train: compact(train), holdout: compact(hold), thirds: seg.map(compact) });
  }
  }
  console.log('\n* = the pair the gem was built on (in-sample).');
  writeFileSync('./backtest/zscore-forex-forward-results.json', JSON.stringify({ generatedAt: new Date().toISOString(), results: out }, null, 2));
}

if (import.meta.main) main();
