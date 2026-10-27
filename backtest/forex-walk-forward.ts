/**
 * FxHouse — walk-forward test of every forex instrument.
 *
 * Instruments: the six live ones (data.json) and the three forex candidates
 * EUR/JPY, EUR/GBP, NZD/JPY (data-candidates.json). About 290 candidate strategies
 * each: Esi's rule library (research-agent.ts CONFIGS, SMC variants included) plus
 * the 216 Z-score versions (zscore-per-pair-design.ts).
 *
 * Forward test: three rounds over the year. In each, a strategy is CHOSEN from the
 * past only (best t-score with >= 20 trades) and then TRADED on the next ~2 months it
 * never saw:
 *   round 1  choose on months 1–6   → trade months 7–8
 *   round 2  choose on months 1–8   → trade months 9–10
 *   round 3  choose on months 1–10  → trade months 11–12
 * The three unseen periods together are the forward result. The live SMC rule is
 * scored over the same unseen months for comparison. Nothing of a period is used to
 * choose the strategy traded in it.
 *
 * Run with:
 *   bun run .\backtest\forex-walk-forward.ts
 */

import { writeFileSync } from 'node:fs';
import { cleanSeries, loadData, stats } from './lib';
import type { Series, Stats, Trade } from './lib';
import { CONFIGS, compact } from './research-agent';
import { label, prepare, run as runZ, VERSIONS } from './zscore-per-pair-design';
import { PRIMARY, runInstrument } from './smc-choch-fvg';

const LIVE = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'GBP/JPY', 'XAU/USD'];
const CANDIDATES = ['EUR/JPY', 'EUR/GBP', 'NZD/JPY'];
const ROUNDS = [[6, 8], [8, 10], [10, 12]] as const; // [choose up to month, trade up to month]

interface Candidate { name: string; trades: Trade[] }

function main() {
  const live = loadData('./backtest/data.json'), cand = loadData('./backtest/data-candidates.json');
  const results: Record<string, unknown>[] = [];
  const sign = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(2)}`;
  const fmt = (x: Stats) => `n ${String(x.n).padStart(3)}  win ${x.winRate.toFixed(0).padStart(2)}%  avg ${sign(x.avgR)}R  t ${x.t.toFixed(1).padStart(4)}  total ${sign(x.totalR)}R  DD ${x.maxDrawdownR.toFixed(1)}R`;

  for (const inst of [...LIVE, ...CANDIDATES]) {
    const raw = (LIVE.includes(inst) ? live : cand)[inst];
    if (!raw) { console.log(`${inst}: no data`); continue; }
    const s: Series = cleanSeries(raw).series;
    const from = s.h1[60].epoch, to = s.m15[s.m15.length - 1].epoch, month = (to - from) / 12;

    const p = prepare(s);
    const pool: Candidate[] = [
      ...CONFIGS.map(c => ({ name: `${c.family} ${JSON.stringify(c.params)}`, trades: c.run(inst, s) })),
      ...VERSIONS.map(v => ({ name: `Z-score ${label(v)}`, trades: runZ(inst, s, p, v) })),
    ];
    const smc = runInstrument(inst, s, PRIMARY);

    const forward: Trade[] = [], smcForward: Trade[] = [], picks: string[] = [];
    for (const [chooseTo, tradeTo] of ROUNDS) {
      const cut = from + chooseTo * month, end = from + tradeTo * month;
      const inWin = (ts: Trade[], a: number, b: number) => ts.filter(t => t.entryEpoch >= a && t.entryEpoch < b);
      const best = pool
        .map(c => ({ c, past: stats(inWin(c.trades, from, cut)) }))
        .filter(x => x.past.n >= 20)
        .sort((a, b) => b.past.t - a.past.t)[0];
      if (best) { forward.push(...inWin(best.c.trades, cut, end)); picks.push(best.c.name); } else picks.push('none');
      smcForward.push(...inWin(smc, cut, end));
    }

    const f = stats(forward), sm = stats(smcForward);
    const perRound = ROUNDS.map(([a, b]) => stats(forward.filter(t => t.entryEpoch >= from + a * month && t.entryEpoch < from + b * month)));
    const sameEachRound = new Set(picks).size === 1;
    console.log(`\n=== ${inst}${CANDIDATES.includes(inst) ? ' (candidate)' : ''}  — ${pool.length} strategies`);
    picks.forEach((x, k) => console.log(`  round ${k + 1} pick: ${x}`));
    console.log(`  FORWARD (unseen months)  ${fmt(f)}   rounds ${perRound.map(x => `${sign(x.avgR)}(${x.n})`).join(' / ')}`);
    console.log(`  live SMC, same months    ${fmt(sm)}`);
    console.log(`  ${sameEachRound ? 'same pick every round (stable)' : 'pick changed between rounds (unstable)'}`);
    results.push({ instrument: inst, candidate: CANDIDATES.includes(inst), picks, stable: sameEachRound, forward: compact(f), rounds: perRound.map(compact), smcSameMonths: compact(sm) });
  }
  writeFileSync('./backtest/forex-walk-forward-results.json', JSON.stringify({ generatedAt: new Date().toISOString(), rounds: ROUNDS, results }, null, 2));
}

if (import.meta.main) main();
