/**
 * Shared pieces for the offline research scripts in this folder:
 * data loading/cleaning, H1 indicators, the trade simulator and trade statistics.
 * Nothing here is used by the app or the signal engine.
 */

import { readFileSync } from 'node:fs';

export type Candle = { epoch: number; open: number; high: number; low: number; close: number };
export type Series = { m15: Candle[]; h1: Candle[]; h4: Candle[]; d1: Candle[] };

export const GRANULARITY: Record<keyof Series, number> = { m15: 900, h1: 3600, h4: 14400, d1: 86400 };

// Fixed UTC boundary: data starts 2025-10-07, so this is 8 months train / 4 months holdout.
export const TRAIN_END = Date.UTC(2026, 5, 7) / 1000;

export const hourOf = (epoch: number) => new Date(epoch * 1000).getUTCHours();
export const dayOf = (epoch: number) => Math.floor(epoch / 86400);

// =================== DATA ===================
export interface CleanReport { timeframe: keyof Series; kept: number; droppedOffGrid: number; droppedBadOHLC: number }

/**
 * Drops candles that are not real bars of their timeframe. The downloader's
 * oldest pages come back clamped to the retention window, which leaves partial
 * candles stamped off the timeframe grid (about 100 of them in every D1 series).
 */
export function cleanSeries(raw: Series): { series: Series; report: CleanReport[] } {
  const report: CleanReport[] = [];
  const series = {} as Series;
  for (const tf of Object.keys(GRANULARITY) as (keyof Series)[]) {
    const seen = new Set<number>();
    let droppedOffGrid = 0, droppedBadOHLC = 0;
    series[tf] = (raw[tf] ?? [])
      .filter(c => {
        if (c.epoch % GRANULARITY[tf] !== 0) { droppedOffGrid++; return false; }
        const ok = c.low > 0 && c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close);
        if (!ok || seen.has(c.epoch)) { droppedBadOHLC++; return false; }
        seen.add(c.epoch);
        return true;
      })
      .sort((a, b) => a.epoch - b.epoch);
    report.push({ timeframe: tf, kept: series[tf].length, droppedOffGrid, droppedBadOHLC });
  }
  return { series, report };
}

export function loadData(path: string): Record<string, Series> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, Series>;
}

// =================== INDICATORS ===================
export function emaSeries(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((s, v) => s + v, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = (values[i] - prev) * k + prev;
    out[i] = prev;
  }
  return out;
}

export function rsiSeries(closes: number[], period = 14): number[] {
  const out = new Array<number>(closes.length).fill(NaN);
  if (closes.length < period + 1) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = closes[i] - closes[i - 1];
    if (ch > 0) gain += ch; else loss -= ch;
  }
  gain /= period; loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + (ch > 0 ? ch : 0)) / period;
    loss = (loss * (period - 1) + (ch < 0 ? -ch : 0)) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

// Simple average of the last `period` true ranges — same definition as the app's calculateATR.
export function atrSeries(candles: Candle[], period = 14): number[] {
  const out = new Array<number>(candles.length).fill(NaN);
  let sum = 0;
  const tr: number[] = [0];
  for (let i = 1; i < candles.length; i++) {
    const pc = candles[i - 1].close;
    tr.push(Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - pc), Math.abs(candles[i].low - pc)));
    sum += tr[i];
    if (i > period) sum -= tr[i - period];
    if (i >= period) out[i] = sum / period;
  }
  return out;
}

// Percentile rank (0-100) of the current ATR against its trailing 200 readings.
export function atrPercentileSeries(atr: number[], lookback = 200): number[] {
  const out = new Array<number>(atr.length).fill(NaN);
  for (let i = 0; i < atr.length; i++) {
    const start = i - lookback + 1;
    if (start < 0 || Number.isNaN(atr[start])) continue;
    let below = 0;
    for (let j = start; j <= i; j++) if (atr[j] < atr[i]) below++;
    out[i] = (below / lookback) * 100;
  }
  return out;
}

// =================== TRADE SIMULATION ===================
export function firstIndexAtOrAfter(candles: Candle[], epoch: number): number {
  let lo = 0, hi = candles.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].epoch < epoch) lo = mid + 1; else hi = mid;
  }
  return lo;
}

export interface Trade {
  entryEpoch: number; exitEpoch: number; dir: 1 | -1; r: number; exit: 'SL' | 'TP' | 'TIME';
  /** Best and worst excursion before exit, in R (worst is <= 0). */
  mfeR: number; maeR: number;
}

/**
 * Market entry at `entry` (a quote), resolved on M15 candles. Levels are set
 * from the quote; the fill and every exit pay half a spread, so a full stop
 * costs slightly more than 1R. Inside a candle the stop is checked before the
 * target (conservative), and a gap through the stop exits at the gap open.
 */
export function simulate(
  m15: Candle[], entryEpoch: number, entry: number, dir: 1 | -1,
  stopDist: number, tpR: number, spread: number, maxHoldHours: number,
): Trade | null {
  const half = spread / 2;
  const fill = entry + dir * half;
  const sl = entry - dir * stopDist;
  const tp = entry + dir * stopDist * tpR;
  // Quote levels at which the exit side of the book reaches SL / TP.
  const slQ = sl + dir * half;
  const tpQ = tp + dir * half;
  const deadline = entryEpoch + maxHoldHours * 3600;
  let mfeR = 0, maeR = 0;

  for (let k = firstIndexAtOrAfter(m15, entryEpoch); k < m15.length; k++) {
    const c = m15[k];
    const done = (r: number, exit: Trade['exit']): Trade =>
      ({ entryEpoch, exitEpoch: c.epoch, dir, exit, r, mfeR, maeR: Math.min(maeR, r) });
    const rAtQuote = (quote: number) => (dir * (quote - dir * half - fill)) / stopDist;

    if (c.epoch >= deadline) return done(rAtQuote(c.open), 'TIME');

    const gapThroughStop = dir === 1 ? c.open <= slQ : c.open >= slQ;
    if (gapThroughStop) return done(rAtQuote(c.open), 'SL');

    const stopHit = dir === 1 ? c.low <= slQ : c.high >= slQ;
    if (stopHit) return done((dir * (sl - fill)) / stopDist, 'SL');

    const targetHit = dir === 1 ? c.high >= tpQ : c.low <= tpQ;
    if (targetHit) { mfeR = Math.max(mfeR, tpR); return done((dir * (tp - fill)) / stopDist, 'TP'); }

    mfeR = Math.max(mfeR, rAtQuote(dir === 1 ? c.high : c.low));
    maeR = Math.min(maeR, rAtQuote(dir === 1 ? c.low : c.high));
  }
  return null; // still open at the end of the data
}

export interface ExitPlan {
  tpR: number;
  /** Move the stop to the entry price once the trade has been this many R in profit. */
  beAtR?: number;
  /** Close `partialFrac` of the position at this many R; the rest runs to tpR. */
  partialAtR?: number;
  partialFrac?: number;
}

/**
 * `simulate` with trade management. With only `tpR` set it gives the same
 * result as `simulate`. A break-even stop takes effect on the candle AFTER the
 * one that triggered it, because the order of moves inside a candle is unknown.
 * `r` is the blended result of all parts of the position.
 */
export function simulateManaged(
  m15: Candle[], entryEpoch: number, entry: number, dir: 1 | -1,
  stopDist: number, plan: ExitPlan, spread: number, maxHoldHours: number,
): Trade | null {
  const half = spread / 2;
  const fill = entry + dir * half;
  const tp = entry + dir * stopDist * plan.tpR;
  const deadline = entryEpoch + maxHoldHours * 3600;
  // R of exiting at `level` (our side of the book) / reached at a mid `quote`.
  const rAt = (level: number) => (dir * (level - fill)) / stopDist;
  const reached = (c: Candle, level: number) => (dir === 1 ? c.high >= level + half : c.low <= level - half);

  let sl = entry - dir * stopDist;
  let remaining = 1, realized = 0, partialDone = false, beDone = false;
  let mfeR = 0, maeR = 0;

  for (let k = firstIndexAtOrAfter(m15, entryEpoch); k < m15.length; k++) {
    const c = m15[k];
    const done = (r: number, exit: Trade['exit']): Trade => {
      const total = realized + remaining * r;
      return { entryEpoch, exitEpoch: c.epoch, dir, exit, r: total, mfeR, maeR: Math.min(maeR, r) };
    };
    const slQ = sl + dir * half;

    if (c.epoch >= deadline) return done(rAt(c.open - dir * half), 'TIME');
    if (dir === 1 ? c.open <= slQ : c.open >= slQ) return done(rAt(c.open - dir * half), 'SL');
    if (dir === 1 ? c.low <= slQ : c.high >= slQ) return done(rAt(sl), 'SL');

    if (!partialDone && plan.partialAtR !== undefined) {
      const level = entry + dir * stopDist * plan.partialAtR;
      if (reached(c, level)) {
        const frac = plan.partialFrac ?? 0.5;
        realized += frac * rAt(level); remaining -= frac; partialDone = true;
      }
    }
    if (reached(c, tp)) { mfeR = Math.max(mfeR, plan.tpR); return done(rAt(tp), 'TP'); }

    if (!beDone && plan.beAtR !== undefined && reached(c, entry + dir * stopDist * plan.beAtR)) { sl = entry; beDone = true; }

    mfeR = Math.max(mfeR, rAt((dir === 1 ? c.high : c.low) - dir * half));
    maeR = Math.min(maeR, rAt((dir === 1 ? c.low : c.high) - dir * half));
  }
  return null; // still open at the end of the data
}

// =================== STATS ===================
export interface Stats {
  n: number; winRate: number; avgR: number; medianR: number; totalR: number; t: number;
  avgWinR: number; profitFactor: number; maxDrawdownR: number; maxConsecLosses: number;
  tpRate: number; slRate: number; timeRate: number; avgHoldHours: number;
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function stats(trades: Trade[]): Stats {
  const n = trades.length;
  if (n === 0) {
    return { n: 0, winRate: 0, avgR: 0, medianR: 0, totalR: 0, t: 0, avgWinR: 0, profitFactor: 0,
      maxDrawdownR: 0, maxConsecLosses: 0, tpRate: 0, slRate: 0, timeRate: 0, avgHoldHours: 0 };
  }
  const rs = trades.map(t => t.r);
  const total = rs.reduce((s, v) => s + v, 0);
  const mean = total / n;
  const sd = n > 1 ? Math.sqrt(rs.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)) : 0;
  const wins = rs.filter(v => v > 0);
  const grossWin = wins.reduce((s, v) => s + v, 0);
  const grossLoss = -rs.filter(v => v <= 0).reduce((s, v) => s + v, 0);

  let equity = 0, peak = 0, maxDrawdownR = 0, streak = 0, maxConsecLosses = 0;
  for (const r of rs) {
    equity += r; peak = Math.max(peak, equity); maxDrawdownR = Math.max(maxDrawdownR, peak - equity);
    streak = r <= 0 ? streak + 1 : 0; maxConsecLosses = Math.max(maxConsecLosses, streak);
  }
  const share = (exit: Trade['exit']) => (trades.filter(t => t.exit === exit).length / n) * 100;

  return {
    n,
    winRate: (wins.length / n) * 100,
    avgR: mean,
    medianR: median(rs),
    totalR: total,
    t: sd > 0 ? mean / (sd / Math.sqrt(n)) : 0,
    avgWinR: wins.length ? grossWin / wins.length : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    maxDrawdownR, maxConsecLosses,
    tpRate: share('TP'), slRate: share('SL'), timeRate: share('TIME'),
    avgHoldHours: trades.reduce((s, t) => s + (t.exitEpoch - t.entryEpoch), 0) / n / 3600,
  };
}

export function spearman(a: number[], b: number[]): number {
  const rank = (v: number[]) => {
    const order = v.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array<number>(v.length);
    order.forEach(([, i], pos) => { r[i] = pos; });
    return r;
  };
  const ra = rank(a), rb = rank(b), n = a.length;
  const ma = (n - 1) / 2;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (ra[i] - ma) * (rb[i] - ma); da += (ra[i] - ma) ** 2; db += (rb[i] - ma) ** 2; }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

export const fmtR = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(3)}`;
export const fmtStats = (s: Stats) =>
  `n=${String(s.n).padStart(3)} win ${s.winRate.toFixed(1).padStart(5)}% avgR ${fmtR(s.avgR)} t ${s.t.toFixed(2).padStart(5)} total ${fmtR(s.totalR)}R`;
