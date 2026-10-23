/**
 * FxHouse — weekly strategy research (runs in GitHub Actions, see
 * .github/workflows/strategy-research.yml; Esi reports the result).
 *
 * On a fresh year of Deriv candles (backtest/download-data.ts) it backtests a
 * fixed library of rule families on every instrument, costs on, one trade at a
 * time, and compares each with the strategy the app trades there now.
 *
 * A candidate becomes a suggestion only if ALL of these hold:
 *   1. at least 30 trades, positive average R in the train AND the holdout part
 *      (first 60% / last 40% of the data), full-year t >= 2;
 *   2. it beats the live strategy on average R (full and holdout), win rate and
 *      max drawdown — or, where nothing is live, keeps max drawdown <= 15R;
 *   3. fewer than 1% of 200 random-walk years at the instrument's own realised
 *      volatility do as well (the library tests hundreds of rules, so the bar is
 *      stricter than the 5% used for a single pre-registered rule).
 * Nothing is applied automatically.
 *
 * Run with:
 *   bun run .\backtest\research-agent.ts            (prints only)
 *   SUPABASE_URL=... SB_SECRET_KEY=... bun run .\backtest\research-agent.ts --save
 */

import { getVolatilityAdjustedSpread } from '../src/lib/spreadConfig';
import { atrSeries, cleanSeries, loadData, simulate, stats } from './lib';
import type { Series, Stats, Trade } from './lib';
import { donchianMarubozu, insideBarHourly, randomWalk } from './synthetic-pick-study';
import { candlePattern, h4ImpulseD1, starReversal, sweepPinBar } from './unserved-synthetics-study';
import { PRIMARY, runInstrument } from './smc-choch-fvg';

const FOREX = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'GBP/JPY', 'XAU/USD'];
const SYNTHETICS = ['V10', 'V25', 'V50', 'V75', 'V100', 'BOOM1000'];
const TRAIN_SHARE = 0.6;
const LUCK_PATHS = 200;
const LUCK_MAX = 0.01;
const NO_INCUMBENT_MAX_DD = 15;

type Run = (instrument: string, s: Series) => Trade[];
interface Config { family: string; params: Record<string, number | string>; run: Run; forexOnly?: boolean }

// ---- Donchian body breakout, generalised (the live V10 rule is h1 / 20 / 0.7 / 0.8 / 2.5) ----
function donchian(tf: 'h1' | 'h4', lookback: number, bodyMin: number, rangeMin: number, tpR: number): Run {
  return (instrument, s) => {
    const cs = s[tf], atr = atrSeries(cs, 14), g = tf === 'h1' ? 3600 : 14400;
    const spread = getVolatilityAdjustedSpread(instrument as never, null);
    const out: Trade[] = [];
    let busyUntil = 0;
    for (let i = Math.max(52, lookback + 1); i < cs.length - 1; i++) {
      const c = cs[i], close = c.epoch + g, a = atr[i];
      if (close < busyUntil || !a) continue;
      const range = c.high - c.low, body = Math.abs(c.close - c.open);
      if (range < rangeMin * a || body / range < bodyMin) continue;
      let hi = -Infinity, lo = Infinity;
      for (let k = 1; k <= lookback; k++) { hi = Math.max(hi, cs[i - k].high); lo = Math.min(lo, cs[i - k].low); }
      const dir = c.close > hi && c.close > c.open ? 1 : c.close < lo && c.close < c.open ? -1 : 0;
      if (!dir) continue;
      const t = simulate(s.m15, close, c.close, dir, 1.5 * a, tpR, spread, tf === 'h1' ? 72 : 168);
      if (t) { out.push(t); busyUntil = t.exitEpoch; }
    }
    return out;
  };
}

const CONFIGS: Config[] = [];
for (const tf of ['h1', 'h4'] as const) for (const lookback of [20, 40]) for (const bodyMin of [0.6, 0.7]) for (const rangeMin of [0.8, 1.2]) for (const tpR of [2, 2.5, 3]) {
  CONFIGS.push({ family: 'Donchian body breakout', params: { tf, lookback, bodyMin, rangeMinAtr: rangeMin, tpR, slAtr: 1.5 }, run: donchian(tf, lookback, bodyMin, rangeMin, tpR) });
}
for (const slAtr of [1.5, 2]) for (const tpR of [1.5, 2, 2.5]) {
  CONFIGS.push({ family: 'H4 inside-bar breakout (pending at the broken level)', params: { slAtr, tpR }, run: (i, s) => insideBarHourly(i, s, 'level', slAtr, tpR) });
}
for (const tpR of [2, 3]) CONFIGS.push({ family: 'H4 impulse continuation with D1 trend', params: { tpR, slAtr: 1.5 }, run: (i, s) => h4ImpulseD1(i, s, tpR) });
for (const tf of ['h1', 'h4'] as const) for (const tpR of [1.5, 2, 2.5]) CONFIGS.push({ family: 'Liquidity sweep + rejection pin bar', params: { tf, tpR }, run: (i, s) => candlePattern(i, s, tf, sweepPinBar, tpR) });
for (const tf of ['h1', 'h4'] as const) for (const tpR of [1.5, 2]) CONFIGS.push({ family: 'Morning/evening star reversal', params: { tf, tpR }, run: (i, s) => candlePattern(i, s, tf, starReversal, tpR) });
for (const rr of [1.5, 2, 2.5, 3]) for (const h1Fractal of [2, 3]) {
  CONFIGS.push({ family: 'SMC CHoCH + FVG', params: { rr, h1Fractal }, forexOnly: true, run: (i, s) => runInstrument(i, s, { ...PRIMARY, rr, h1Fractal }) });
}

/** What the app trades on each instrument now (null = nothing). */
const INCUMBENT: Record<string, { name: string; run: Run } | null> = {
  ...Object.fromEntries(FOREX.map(i => [i, { name: 'SMC CHoCH + FVG (live)', run: (inst: string, s: Series) => runInstrument(inst, s, PRIMARY) }])),
  V10: { name: 'V10 Donchian marubozu (live)', run: (i, s) => donchianMarubozu(i, s) },
  V75: { name: 'V75 inside-bar (live)', run: (i, s) => insideBarHourly(i, s, 'level') },
  V25: null, V50: null, V100: null, BOOM1000: null,
};

interface Scored { full: Stats; train: Stats; holdout: Stats }
function score(trades: Trade[], split: number): Scored {
  return { full: stats(trades), train: stats(trades.filter(t => t.entryEpoch < split)), holdout: stats(trades.filter(t => t.entryEpoch >= split)) };
}

function annualVol(s: Series): number {
  const c = s.h1.map(x => x.close), r = c.slice(1).map((v, k) => Math.log(v / c[k]));
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  return Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1)) * Math.sqrt(24 * 365);
}

const compact = (x: Stats) => ({ n: x.n, winRate: +x.winRate.toFixed(1), avgR: +x.avgR.toFixed(3), totalR: +x.totalR.toFixed(1), t: +x.t.toFixed(2), maxDrawdownR: +x.maxDrawdownR.toFixed(1), profitFactor: +x.profitFactor.toFixed(2) });
const compactScore = (sc: Scored) => ({ full: compact(sc.full), train: compact(sc.train), holdout: compact(sc.holdout) });

async function main() {
  const save = process.argv.includes('--save');
  const raw = loadData('./backtest/data.json');
  const summary: Record<string, unknown> = {};
  const suggestions: Record<string, unknown>[] = [];
  let tested = 0, dataFrom = Infinity, dataTo = -Infinity;

  for (const inst of [...FOREX, ...SYNTHETICS]) {
    if (!raw[inst]) continue;
    const s = cleanSeries(raw[inst]).series;
    const from = s.m15[0].epoch, to = s.m15[s.m15.length - 1].epoch;
    dataFrom = Math.min(dataFrom, from); dataTo = Math.max(dataTo, to);
    const split = from + (to - from) * TRAIN_SHARE;
    const inc = INCUMBENT[inst];
    const incScore = inc ? score(inc.run(inst, s), split) : null;

    const scored = CONFIGS.filter(c => !c.forexOnly || FOREX.includes(inst)).map(c => {
      tested++;
      return { c, sc: score(c.run(inst, s), split) };
    });
    const passes = scored.filter(({ sc }) => {
      if (sc.full.n < 30 || !(sc.train.avgR > 0) || !(sc.holdout.avgR > 0) || sc.full.t < 2) return false;
      if (!incScore) return sc.full.maxDrawdownR <= NO_INCUMBENT_MAX_DD;
      return sc.full.avgR > incScore.full.avgR && sc.holdout.avgR > incScore.holdout.avgR
        && sc.full.winRate >= incScore.full.winRate && sc.full.maxDrawdownR <= incScore.full.maxDrawdownR;
    }).sort((a, b) => b.sc.holdout.avgR - a.sc.holdout.avgR);

    // Luck test only for the finalists (it is the slow part).
    let paths: Series[] | null = null;
    const finalists: { c: Config; sc: Scored; luck: number }[] = [];
    for (const p of passes.slice(0, 3)) {
      paths ??= Array.from({ length: LUCK_PATHS }, () => randomWalk(s, annualVol(s)));
      const luck = paths.filter(w => stats(p.c.run(inst, w)).totalR >= p.sc.full.totalR).length / LUCK_PATHS;
      finalists.push({ ...p, luck });
    }
    const winner = finalists.filter(f => f.luck < LUCK_MAX).sort((a, b) => b.sc.holdout.avgR - a.sc.holdout.avgR)[0];
    const best = [...scored].sort((a, b) => b.sc.holdout.avgR - a.sc.holdout.avgR)[0];

    summary[inst] = {
      incumbent: inc ? { name: inc.name, ...compactScore(incScore!) } : null,
      configsTested: scored.length,
      passedComparison: passes.length,
      finalists: finalists.map(f => ({ family: f.c.family, params: f.c.params, luckShare: f.luck, ...compactScore(f.sc) })),
      bestHoldout: best ? { family: best.c.family, params: best.c.params, ...compactScore(best.sc) } : null,
      suggestion: winner ? { family: winner.c.family, params: winner.c.params } : null,
    };
    console.log(`${inst.padEnd(8)} tested ${scored.length}, beat the incumbent ${passes.length}, finalists ${finalists.length}${winner ? `, SUGGEST ${winner.c.family} ${JSON.stringify(winner.c.params)} (holdout ${winner.sc.holdout.avgR.toFixed(3)}R, luck ${(winner.luck * 100).toFixed(1)}%)` : ''}`);
    if (winner) {
      suggestions.push({ instrument: inst, family: winner.c.family, params: winner.c.params, candidate: { ...compactScore(winner.sc), luckShare: winner.luck }, incumbent: inc ? { name: inc.name, ...compactScore(incScore!) } : null });
    }
  }

  console.log(`\n${tested} configurations tested, ${suggestions.length} suggestion(s).`);
  if (!save) return;

  const url = process.env.SUPABASE_URL, key = process.env.SB_SECRET_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SB_SECRET_KEY are required with --save');
  const post = async (table: string, body: unknown) => {
    const res = await fetch(`${url}/rest/v1/${table}`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`);
    return res.json();
  };
  const [run] = await post('strategy_research_runs', {
    data_from: new Date(dataFrom * 1000).toISOString(), data_to: new Date(dataTo * 1000).toISOString(), configs_tested: tested, summary,
  });
  if (suggestions.length) await post('strategy_suggestions', suggestions.map(x => ({ ...x, run_id: run.id })));
  console.log(`Saved run ${run.id}.`);
}

if (import.meta.main) await main();
