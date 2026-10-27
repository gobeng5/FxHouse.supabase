/**
 * FxHouse — a Z-score mean-reversion rule designed for each forex pair (and gold).
 *
 * Grid on H1 (288 versions per pair):
 *   lookback 20 / 30 / 50 bars · entry |z| beyond 1.5 / 1.8 / 2.2 / 2.5
 *   RSI(14) filter off / on (< 35 for longs, > 65 for shorts)
 *   trend filter: none / with H4 EMA50 / with daily EMA50 (long only above it, short below)
 *   target 1.0 / 1.6 / 2.0 ATR(14, H1), stop 1.0 ATR, out after 72h
 * Long when z < -threshold (price stretched below its mean), short when z > +threshold.
 * Market entry at the H1 close; one trade at a time; each pair's spread.
 *
 * Honest design: each pair's version is CHOSEN on the first 60% of the year only (best
 * t-score with >= 20 trades), then JUDGED on the last 40% it never saw. It passes if the
 * holdout average is positive over >= 15 trades and the last third of the year is too.
 * The share of all 288 versions that were profitable in the holdout shows whether a
 * pass reflects a real effect or the luck of picking from many.
 *
 * Run with:
 *   bun run .\backtest\zscore-per-pair-design.ts
 */

import { writeFileSync } from 'node:fs';
import { getVolatilityAdjustedSpread } from '../src/lib/spreadConfig';
import { GRANULARITY, atrSeries, cleanSeries, emaSeries, loadData, rsiSeries, simulate, stats } from './lib';
import type { Series, Stats, Trade } from './lib';
import { lastCompleted } from './strategy-candidates';
import { compact } from './research-agent';

const PAIRS = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'GBP/JPY', 'XAU/USD'];
const LOOKBACKS = [20, 30, 50], THRESHOLDS = [1.5, 1.8, 2.2, 2.5], TARGETS = [1.0, 1.6, 2.0];
const RSI_FILTER = [false, true], TRENDS = ['none', 'h4', 'd1'] as const;
type Trend = typeof TRENDS[number];
export interface Version { lookback: number; threshold: number; rsi: boolean; trend: Trend; target: number }

export const VERSIONS: Version[] = [];
for (const lookback of LOOKBACKS) for (const threshold of THRESHOLDS) for (const rsi of RSI_FILTER) for (const trend of TRENDS) for (const target of TARGETS) {
  VERSIONS.push({ lookback, threshold, rsi, trend, target });
}

export function prepare(s: Series) {
  const h1 = s.h1, closes = h1.map(c => c.close);
  const atr = atrSeries(h1), rsi = rsiSeries(closes, 14);
  const z: Record<number, number[]> = {};
  for (const L of LOOKBACKS) {
    const out = new Array<number>(closes.length).fill(NaN);
    let sum = 0, sq = 0;
    for (let i = 0; i < closes.length; i++) {
      sum += closes[i]; sq += closes[i] ** 2;
      if (i >= L) { sum -= closes[i - L]; sq -= closes[i - L] ** 2; }
      if (i >= L - 1) {
        const m = sum / L, v = Math.max(0, sq / L - m * m);
        out[i] = v > 0 ? (closes[i] - m) / Math.sqrt(v) : 0;
      }
    }
    z[L] = out;
  }
  const e4 = emaSeries(s.h4.map(c => c.close), 50), e1d = emaSeries(s.d1.map(c => c.close), 50);
  const trendOf = (i: number, which: Trend): 0 | 1 | -1 => {
    if (which === 'none') return 0;
    const close = h1[i].epoch + GRANULARITY.h1;
    const [cs, es, g] = which === 'h4' ? [s.h4, e4, GRANULARITY.h4] : [s.d1, e1d, GRANULARITY.d1];
    const k = lastCompleted(cs, g, close);
    if (k < 0 || Number.isNaN(es[k])) return 0;
    return cs[k].close > es[k] ? 1 : cs[k].close < es[k] ? -1 : 0;
  };
  return { atr, rsi, z, trendOf };
}

export function run(inst: string, s: Series, p: ReturnType<typeof prepare>, v: Version): Trade[] {
  const h1 = s.h1, spread = getVolatilityAdjustedSpread(inst as never, null), out: Trade[] = [];
  let busyUntil = 0;
  for (let i = 60; i < h1.length - 1; i++) {
    const close = h1[i].epoch + GRANULARITY.h1;
    if (close < busyUntil) continue;
    const z = p.z[v.lookback][i], a = p.atr[i];
    if (Number.isNaN(z) || !(a > 0)) continue;
    let dir: 0 | 1 | -1 = z < -v.threshold ? 1 : z > v.threshold ? -1 : 0;
    if (!dir) continue;
    if (v.rsi && !(dir === 1 ? p.rsi[i] < 35 : p.rsi[i] > 65)) continue;
    if (v.trend !== 'none') { const t = p.trendOf(i, v.trend); if (t !== dir) dir = 0; }
    if (!dir) continue;
    const t = simulate(s.m15, close, h1[i].close, dir, a, v.target, spread, 72);
    if (t) { out.push(t); busyUntil = t.exitEpoch; }
  }
  return out;
}

export const label = (v: Version) => `L${v.lookback} z${v.threshold} rsi:${v.rsi ? 'on' : 'off'} trend:${v.trend} TP${v.target}ATR`;

function main() {
  const raw = loadData('./backtest/data.json');
  const results: Record<string, unknown>[] = [];
  const sign = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(2)}`;
  for (const inst of PAIRS) {
    const s = cleanSeries(raw[inst]).series;
    const from = s.h1[60].epoch, to = s.m15[s.m15.length - 1].epoch, split = from + 0.6 * (to - from), w = (to - from) / 3;
    const years = (to - from) / (365 * 86400);
    const p = prepare(s);
    const all = VERSIONS.map(v => {
      const ts = run(inst, s, p, v);
      return { v, ts, train: stats(ts.filter(t => t.entryEpoch < split)), hold: stats(ts.filter(t => t.entryEpoch >= split)) };
    });
    const eligible = all.filter(r => r.train.n >= 20);
    const chosen = eligible.sort((a, b) => b.train.t - a.train.t)[0];
    const profitableInHoldout = all.filter(r => r.hold.n >= 10 && r.hold.avgR > 0).length;
    if (!chosen) { console.log(`${inst.padEnd(8)} no version with 20 train trades`); continue; }
    const full = stats(chosen.ts);
    const seg: Stats[] = [0, 1, 2].map(k => stats(chosen.ts.filter(t => t.entryEpoch >= from + k * w && t.entryEpoch < from + (k + 1) * w)));
    const pass = chosen.hold.n >= 15 && chosen.hold.avgR > 0 && seg[2].avgR > 0;
    console.log(`\n${inst}  chosen on the first 60%: ${label(chosen.v)}`);
    console.log(`  design (train) n ${chosen.train.n}  avg ${sign(chosen.train.avgR)}R  t ${chosen.train.t.toFixed(1)}`);
    console.log(`  TEST (holdout) n ${chosen.hold.n}  win ${chosen.hold.winRate.toFixed(0)}%  avg ${sign(chosen.hold.avgR)}R  t ${chosen.hold.t.toFixed(1)}  total ${sign(chosen.hold.totalR)}R`);
    console.log(`  full year      n ${full.n}  avg ${sign(full.avgR)}R  ${(full.totalR / years).toFixed(1)}R/yr  DD ${full.maxDrawdownR.toFixed(1)}R  thirds ${seg.map(x => `${sign(x.avgR)}(${x.n})`).join(' / ')}`);
    console.log(`  versions profitable in the holdout: ${profitableInHoldout} of ${VERSIONS.length}   VERDICT ${pass ? 'PASS' : 'fail'}`);
    results.push({ instrument: inst, chosen: chosen.v, pass, train: compact(chosen.train), holdout: compact(chosen.hold), full: compact(full), thirds: seg.map(compact), perYearR: full.totalR / years, versionsProfitableInHoldout: profitableInHoldout, versionsTested: VERSIONS.length });
  }
  writeFileSync('./backtest/zscore-per-pair-results.json', JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
}

if (import.meta.main) main();
