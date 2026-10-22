/**
 * FxHouse — does a volume-profile filter improve the live strategies?
 *
 * Deriv candles carry no traded volume (synthetics and OTC forex have none), so
 * the profile is a TPO / time-at-price profile: every M15 candle spreads equal
 * weight across the prices it traded. Over the lookback before each entry:
 *   POC  — the price bin with the most weight
 *   VA   — value area: bins around the POC holding 70% of the weight (VAL..VAH)
 *
 * Each live strategy's trades (the same research runners the parity checks use)
 * are tagged by where the entry sat, relative to the trade's direction:
 *   with    — long above VAH / short below VAL (breaking out of value)
 *   inside  — entry inside the value area
 *   against — long below VAL / short above VAH (stretched against value)
 *   POC with / against — long above / below the POC (short mirrored)
 * A filter only helps if the kept group beats "all" in BOTH the train and the
 * holdout half; otherwise it is noise. Filtering after the fact ignores that a
 * skipped trade could free the slot for another, which slightly understates
 * filtered volume.
 *
 * Run with:
 *   bun run .\backtest\volume-profile-study.ts
 */

import { writeFileSync } from 'node:fs';
import { cleanSeries, firstIndexAtOrAfter, loadData, stats } from './lib';
import type { Candle, Series, Trade } from './lib';
import { insideBarHourly, donchianMarubozu } from './synthetic-pick-study';
import { PRIMARY, runInstrument } from './smc-choch-fvg';
import { VARIANTS, run as runGem } from './gem-candle-fix-study';

const SPLIT = Date.UTC(2026, 4, 1) / 1000;
const BINS = 50;
const VALUE_SHARE = 0.7;
const LOOKBACKS = [24, 120]; // hours: one day (primary), one week (robustness)

interface Profile { poc: number; val: number; vah: number }

function profileBefore(m15: Candle[], epoch: number, hours: number): Profile | null {
  const end = firstIndexAtOrAfter(m15, epoch);
  const start = firstIndexAtOrAfter(m15, epoch - hours * 3600);
  const win = m15.slice(start, end);
  if (win.length < hours * 2) return null; // under half the candles: market was shut
  let lo = Infinity, hi = -Infinity;
  for (const c of win) { lo = Math.min(lo, c.low); hi = Math.max(hi, c.high); }
  if (!(hi > lo)) return null;
  const step = (hi - lo) / BINS;
  const w = new Array<number>(BINS).fill(0);
  for (const c of win) {
    const a = Math.min(BINS - 1, Math.floor((c.low - lo) / step));
    const b = Math.min(BINS - 1, Math.floor((c.high - lo) / step));
    for (let k = a; k <= b; k++) w[k] += 1 / (b - a + 1);
  }
  let p = 0;
  for (let k = 1; k < BINS; k++) if (w[k] > w[p]) p = k;
  const total = w.reduce((x, y) => x + y, 0);
  let inVa = w[p], a = p, b = p;
  while (inVa < VALUE_SHARE * total && (a > 0 || b < BINS - 1)) {
    const up = b < BINS - 1 ? w[b + 1] : -1, down = a > 0 ? w[a - 1] : -1;
    if (up >= down) inVa += w[++b]; else inVa += w[--a];
  }
  return { poc: lo + (p + 0.5) * step, val: lo + a * step, vah: lo + (b + 1) * step };
}

/** Price at entry: the open of the M15 candle the trade entered in. */
const entryPrice = (m15: Candle[], t: Trade) => m15[Math.max(0, firstIndexAtOrAfter(m15, Math.floor(t.entryEpoch / 900) * 900))]?.open;

type Tag = 'with' | 'inside' | 'against';
function tag(p: number, dir: 1 | -1, pr: Profile): { va: Tag; poc: 'with' | 'against' } {
  const va: Tag = p > pr.vah ? (dir === 1 ? 'with' : 'against') : p < pr.val ? (dir === 1 ? 'against' : 'with') : 'inside';
  return { va, poc: dir * (p - pr.poc) >= 0 ? 'with' : 'against' };
}

const STRATEGIES: { name: string; instrument: string; trades: (s: Series) => Trade[] }[] = [
  { name: 'V75 inside-bar gem', instrument: 'V75', trades: s => insideBarHourly('V75', s, 'level') },
  { name: 'V10 Donchian gem', instrument: 'V10', trades: s => donchianMarubozu('V10', s) },
  { name: 'EUR/USD Z-score gem', instrument: 'EUR/USD', trades: s => runGem(VARIANTS.find(v => v.name.startsWith('EUR/USD — fixed'))!, s).trades },
  ...['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'GBP/JPY', 'XAU/USD'].map(i => ({ name: `SMC ${i}`, instrument: i, trades: (s: Series) => runInstrument(i, s, PRIMARY) })),
];

const row = (label: string, ts: Trade[]) => {
  const all = stats(ts), tr = stats(ts.filter(t => t.entryEpoch < SPLIT)), ho = stats(ts.filter(t => t.entryEpoch >= SPLIT));
  return { label, n: all.n, win: all.winRate, avgR: all.avgR, totalR: all.totalR, trainN: tr.n, trainAvgR: tr.avgR, holdN: ho.n, holdAvgR: ho.avgR };
};
const fmt = (r: ReturnType<typeof row>) =>
  `  ${r.label.padEnd(16)} n ${String(r.n).padStart(4)}  win ${r.win.toFixed(0).padStart(3)}%  avgR ${r.avgR >= 0 ? '+' : ''}${r.avgR.toFixed(3)}  total ${r.totalR >= 0 ? '+' : ''}${r.totalR.toFixed(1).padStart(5)}R  | train n ${String(r.trainN).padStart(3)} ${r.trainAvgR >= 0 ? '+' : ''}${r.trainAvgR.toFixed(3)}  holdout n ${String(r.holdN).padStart(3)} ${r.holdAvgR >= 0 ? '+' : ''}${r.holdAvgR.toFixed(3)}`;

function main() {
  const raw = loadData('./backtest/data.json');
  const series = new Map<string, Series>();
  const out: Record<string, unknown>[] = [];
  const smcPool: Record<number, { va: Record<Tag, Trade[]>; poc: Record<'with' | 'against', Trade[]>; all: Trade[] }> = {};
  for (const st of STRATEGIES) {
    if (!series.has(st.instrument)) series.set(st.instrument, cleanSeries(raw[st.instrument]).series);
    const s = series.get(st.instrument)!;
    const trades = st.trades(s);
    for (const hours of LOOKBACKS) {
      const va: Record<Tag, Trade[]> = { with: [], inside: [], against: [] };
      const poc: Record<'with' | 'against', Trade[]> = { with: [], against: [] };
      const tagged: Trade[] = [];
      for (const t of trades) {
        const p = entryPrice(s.m15, t), pr = profileBefore(s.m15, t.entryEpoch, hours);
        if (p === undefined || !pr) continue;
        const g = tag(p, t.dir, pr);
        va[g.va].push(t); poc[g.poc].push(t); tagged.push(t);
      }
      const rows = [row('all', tagged), row('VA with', va.with), row('VA inside', va.inside), row('VA against', va.against), row('POC with', poc.with), row('POC against', poc.against)];
      console.log(`\n${st.name} — ${hours}h profile`);
      rows.forEach(r => console.log(fmt(r)));
      out.push({ strategy: st.name, lookbackHours: hours, rows });
      if (st.name.startsWith('SMC')) {
        const pool = (smcPool[hours] ??= { va: { with: [], inside: [], against: [] }, poc: { with: [], against: [] }, all: [] });
        pool.all.push(...tagged);
        (['with', 'inside', 'against'] as Tag[]).forEach(k => pool.va[k].push(...va[k]));
        (['with', 'against'] as const).forEach(k => pool.poc[k].push(...poc[k]));
      }
    }
  }
  for (const hours of LOOKBACKS) {
    const p = smcPool[hours];
    const rows = [row('all', p.all), row('VA with', p.va.with), row('VA inside', p.va.inside), row('VA against', p.va.against), row('POC with', p.poc.with), row('POC against', p.poc.against)];
    console.log(`\nSMC, all six pooled — ${hours}h profile`);
    rows.forEach(r => console.log(fmt(r)));
    out.push({ strategy: 'SMC pooled', lookbackHours: hours, rows });
  }
  writeFileSync('./backtest/volume-profile-results.json', JSON.stringify({ generatedAt: new Date().toISOString(), split: '2026-05-01', results: out }, null, 2));
}

if (import.meta.main) main();
