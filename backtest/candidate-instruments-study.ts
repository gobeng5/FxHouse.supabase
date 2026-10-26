/**
 * FxHouse — six candidate instruments: which rules work there, and is their
 * expectancy better than the instruments the app trades now?
 *
 *   US100 (Deriv OTC_NDX), BTC/USD, XAG/USD, EUR/JPY, EUR/GBP, NZD/JPY
 *   data: backtest/data-candidates.json (download-data.ts with those names)
 *   costs: spreadConfig.ts — ESTIMATED spreads for these six until confirmed in MT5
 *
 * Every instrument gets Esi's whole rule library (research-agent.ts CONFIGS, SMC
 * included). A rule passes only if ALL hold, decided before running:
 *   1. >= 30 trades, profit in train (first 60%) AND holdout (last 40%), t >= 2;
 *   2. walk-forward: the year in three equal periods — profit in at least two,
 *      including the last (the most recent months, closest to a forward test);
 *   3. stability: at least half of its neighbours (same family and timeframe,
 *      one setting different) are also profitable over the year;
 *   4. luck: fewer than 1% of 200 random-walk years at the instrument's own
 *      volatility do as well.
 * The live rules are also run unchanged ("transferred") to show whether they carry over.
 *
 * Run with:
 *   bun run .\backtest\candidate-instruments-study.ts
 */

import { writeFileSync } from 'node:fs';
import { cleanSeries, loadData, stats } from './lib';
import type { Series, Stats, Trade } from './lib';
import { annualVol, CONFIGS, compact, donchian, score } from './research-agent';
import type { Config } from './research-agent';
import { insideBarHourly, randomWalk } from './synthetic-pick-study';
import { candlePattern, starReversal } from './unserved-synthetics-study';
import { PRIMARY, runInstrument } from './smc-choch-fvg';

const INSTRUMENTS = ['US100', 'BTC/USD', 'XAG/USD', 'EUR/JPY', 'EUR/GBP', 'NZD/JPY'];
const LUCK_PATHS = 200;
const LUCK_MAX = 0.01;

/** Live benchmarks (strategyHealth.ts): average R per trade and trades per year. */
const LIVE = [
  { name: 'BOOM1000 Donchian', avgR: 0.559, perYear: 48 },
  { name: 'V75 inside-bar', avgR: 0.476, perYear: 96 },
  { name: 'V10 star', avgR: 0.409, perYear: 44 },
  { name: 'SMC (6 pairs)', avgR: 0.392, perYear: 59 },
  { name: 'EUR/USD Z-score', avgR: 0.126, perYear: 35 },
];

const TRANSFERRED: Config[] = [
  { family: 'Live SMC CHoCH + FVG (forex/gold rule)', params: {}, run: (i, s) => runInstrument(i, s, PRIMARY) },
  { family: 'Live V75 inside-bar rule', params: {}, run: (i, s) => insideBarHourly(i, s, 'level') },
  { family: 'Live V10 star reversal rule', params: {}, run: (i, s) => candlePattern(i, s, 'h4', starReversal, 2) },
  { family: 'Live BOOM1000 Donchian rule', params: {}, run: (i, s) => donchian('h4', 40, 0.6, 1.2, 3)(i, s) },
];

const thirds = (ts: Trade[], from: number, to: number): Stats[] => {
  const w = (to - from) / 3;
  return [0, 1, 2].map(k => stats(ts.filter(t => t.entryEpoch >= from + k * w && t.entryEpoch < from + (k + 1) * w)));
};

/** Same family and timeframe, exactly one other setting different. */
function neighbours(c: Config): Config[] {
  return CONFIGS.filter(o => o !== c && o.family === c.family && o.params.tf === c.params.tf &&
    Object.keys(c.params).filter(k => c.params[k] !== o.params[k]).length === 1);
}

function main() {
  const raw = loadData('./backtest/data-candidates.json');
  const out: Record<string, unknown> = {};

  for (const inst of INSTRUMENTS) {
    if (!raw[inst]) { console.log(`\n${inst}: no data`); continue; }
    const s: Series = cleanSeries(raw[inst]).series;
    const from = s.m15[0].epoch, to = s.m15[s.m15.length - 1].epoch;
    const split = from + (to - from) * 0.6;
    const years = (to - from) / (365 * 86400);

    const runs = new Map<Config, Trade[]>();
    const tradesOf = (c: Config) => { if (!runs.has(c)) runs.set(c, c.run(inst, s)); return runs.get(c)!; };

    const evaluate = (c: Config) => {
      const ts = tradesOf(c), sc = score(ts, split), seg = thirds(ts, from, to);
      const base = sc.full.n >= 30 && sc.train.avgR > 0 && sc.holdout.avgR > 0 && sc.full.t >= 2;
      const walk = seg.filter(x => x.n > 0 && x.avgR > 0).length >= 2 && seg[2].avgR > 0;
      return { c, sc, seg, base, walk };
    };

    const evals = CONFIGS.map(evaluate);
    const shortlisted = evals.filter(e => e.base && e.walk).map(e => {
      const nb = neighbours(e.c);
      const ok = nb.filter(o => stats(tradesOf(o)).avgR > 0).length;
      return { ...e, stability: nb.length ? ok / nb.length : 0 };
    }).filter(e => e.stability >= 0.5).sort((a, b) => b.sc.holdout.avgR - a.sc.holdout.avgR).slice(0, 3);

    let paths: Series[] | null = null;
    const finalists = shortlisted.map(e => {
      paths ??= Array.from({ length: LUCK_PATHS }, () => randomWalk(s, annualVol(s)));
      const luck = paths.filter(p => stats(e.c.run(inst, p)).totalR >= e.sc.full.totalR).length / LUCK_PATHS;
      return { ...e, luck, pass: luck < LUCK_MAX };
    });

    const transferred = TRANSFERRED.map(evaluate);
    const fmt = (sc: { full: Stats; holdout: Stats }, seg: Stats[]) =>
      `n ${String(sc.full.n).padStart(3)}  win ${sc.full.winRate.toFixed(0).padStart(2)}%  avg ${sc.full.avgR >= 0 ? '+' : ''}${sc.full.avgR.toFixed(2)}R  t ${sc.full.t.toFixed(1).padStart(4)}  ${(sc.full.totalR / years).toFixed(0).padStart(3)}R/yr  DD ${sc.full.maxDrawdownR.toFixed(0)}R  holdout ${sc.holdout.avgR >= 0 ? '+' : ''}${sc.holdout.avgR.toFixed(2)}  thirds ${seg.map(x => (x.avgR >= 0 ? '+' : '') + x.avgR.toFixed(2)).join('/')}`;

    console.log(`\n=== ${inst}  (${new Date(from * 1000).toISOString().slice(0, 10)} → ${new Date(to * 1000).toISOString().slice(0, 10)}, ${CONFIGS.length} rules tested)`);
    console.log(`  passed train/holdout/t: ${evals.filter(e => e.base).length} · + walk-forward: ${evals.filter(e => e.base && e.walk).length} · + stability: ${shortlisted.length} (top 3 luck-tested)`);
    for (const f of finalists) console.log(`  ${f.pass ? 'PASS' : 'luck'} ${f.c.family} ${JSON.stringify(f.c.params)}\n       ${fmt(f.sc, f.seg)}  stability ${(f.stability * 100).toFixed(0)}%  luck ${(f.luck * 100).toFixed(1)}%`);
    console.log('  transferred live rules:');
    for (const t of transferred) console.log(`    ${t.c.family.padEnd(38)} ${fmt(t.sc, t.seg)}`);

    out[inst] = {
      period: { from: new Date(from * 1000).toISOString(), to: new Date(to * 1000).toISOString() },
      rulesTested: CONFIGS.length,
      passedBase: evals.filter(e => e.base).length,
      passedWalkForward: evals.filter(e => e.base && e.walk).length,
      finalists: finalists.map(f => ({ family: f.c.family, params: f.c.params, pass: f.pass, luckShare: f.luck, stability: f.stability, perYearR: f.sc.full.totalR / years, full: compact(f.sc.full), train: compact(f.sc.train), holdout: compact(f.sc.holdout), thirds: f.seg.map(compact) })),
      transferred: transferred.map(t => ({ family: t.c.family, perYearR: t.sc.full.totalR / years, full: compact(t.sc.full), holdout: compact(t.sc.holdout), thirds: t.seg.map(compact) })),
    };
  }

  console.log('\nLive benchmarks (avg R per trade, trades per year):');
  for (const l of LIVE) console.log(`  ${l.name.padEnd(20)} ${l.avgR >= 0 ? '+' : ''}${l.avgR.toFixed(2)}R  ${l.perYear}/yr  ≈ ${(l.avgR * l.perYear).toFixed(0)}R/yr`);
  writeFileSync('./backtest/candidate-instruments-results.json', JSON.stringify({ generatedAt: new Date().toISOString(), live: LIVE, results: out }, null, 2));
}

if (import.meta.main) main();
