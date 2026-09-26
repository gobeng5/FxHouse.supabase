/**
 * Item: do the day-trade HARD GATES (structural, zone) predict realized R?
 * Measurement only. Uses a gate-bypassed copy of the live generator so we can see
 * what the suppressed candidates would have done. Nothing here touches the app.
 */
import { generateTradePlan } from './genUngated';
import { getVolatilityAdjustedSpread, computeAtrPercentile } from '@/lib/spreadConfig';
import type { TradingInstrument } from '@/types/trading';

type C = { epoch: number; open: number; high: number; low: number; close: number };
const data: Record<string, { h1: C[]; h4: C[]; d1: C[] }> = JSON.parse(
  await Bun.file('/tmp/bt/data.json').text()
);

const path = (c: C) => (c.close >= c.open ? [c.open, c.low, c.high, c.close] : [c.open, c.high, c.low, c.close]);
const hit = (dir: 'bullish' | 'bearish', level: number, price: number, isTarget: boolean) => {
  const above = dir === 'bullish' ? isTarget : !isTarget;
  return above ? price >= level : price <= level;
};

interface Rec {
  inst: string; dir: 'bullish' | 'bearish'; conf: number; genEpoch: number; exitEpoch: number;
  filled: boolean; R: number | null; gS: boolean; gZ: boolean;
}

function sim(inst: string, rec: any, genEpoch: number, candles: C[], atrPct: number | null): Rec | null {
  const dir = rec.direction as 'bullish' | 'bearish';
  const entry = rec.risk.entry, sl = rec.risk.stopLoss;
  const tps = [rec.risk.takeProfit1, rec.risk.takeProfit2, rec.risk.takeProfit3];
  const risk = Math.abs(entry - sl);
  if (!risk || !isFinite(risk)) return null;
  const spread = getVolatilityAdjustedSpread(inst, atrPct);
  const horizon = candles.filter(c => c.epoch >= genEpoch).slice(0, 240);
  const horizonEnd = horizon.length ? horizon[horizon.length - 1].epoch + 3600 : genEpoch + 240 * 3600;
  const sh = dir === 'bullish' ? spread / 2 : -spread / 2;
  const effEntry = entry + sh;
  const riskAdj = Math.abs(effEntry - sl);
  const qFill = entry - sh, qSL = sl + sh;
  const q = tps.map(t => t + sh);
  const R = (p: number) => (dir === 'bullish' ? p - effEntry : effEntry - p) / riskAdj;
  let filled = !rec.preferPendingOrder, out: number | null = null, exit = horizonEnd;
  for (const c of horizon) {
    if (!filled) { if (c.low <= qFill && c.high >= qFill) filled = true; else continue; }
    for (const p of path(c)) {
      if (hit(dir, qSL, p, false)) { out = -1; break; }
      if (hit(dir, q[2], p, true)) { out = R(q[2]); break; }
      if (hit(dir, q[1], p, true)) { out = R(q[1]); break; }
    }
    if (out !== null) { exit = c.epoch + 3600; break; }
  }
  return {
    inst, dir, conf: rec.confidence, genEpoch, exitEpoch: exit, filled,
    R: filled ? out : null, gS: rec.gateStructural !== false, gZ: rec.gateZone !== false,
  };
}

function forming(h1: C[], T: number, bucket: number, closed: C[]): C[] {
  const lastClose = closed.length ? closed[closed.length - 1].epoch + bucket : 0;
  const parts = h1.filter(c => c.epoch >= lastClose && c.epoch + 3600 <= T);
  if (!parts.length) return closed;
  return [...closed, {
    epoch: lastClose, open: parts[0].open, close: parts[parts.length - 1].close,
    high: Math.max(...parts.map(p => p.high)), low: Math.min(...parts.map(p => p.low)),
  }];
}

const events: { T: number; inst: string }[] = [];
for (const [inst, d] of Object.entries(data)) {
  const start = d.h1[0].epoch + 75 * 86400;
  for (let k = 0; k < d.h1.length; k += 4) {
    const T = d.h1[k].epoch + 3600;
    if (T >= start) events.push({ T, inst });
  }
}
events.sort((a, b) => a.T - b.T);

const recs: Rec[] = [];
const openUntil = new Map<string, number>(); // neutral de-overlap: one open day trade per instrument
let gated = 0;

for (const ev of events) {
  const { T, inst } = ev;
  if ((openUntil.get(inst) ?? 0) > T) continue;
  const d = data[inst];
  const cd = d.d1.filter(c => c.epoch + 86400 <= T).slice(-200);
  const c4 = d.h4.filter(c => c.epoch + 14400 <= T).slice(-300);
  const c1 = d.h1.filter(c => c.epoch + 3600 <= T).slice(-250);
  if (cd.length < 55 || c4.length < 55 || c1.length < 60) continue;
  const live = c1[c1.length - 1].close;
  let plan;
  try {
    plan = generateTradePlan(
      inst as TradingInstrument,
      forming(d.h1, T, 86400, cd), forming(d.h1, T, 14400, c4),
      [...c1, c1[c1.length - 1]], live, live
    );
  } catch { continue; }
  const rec: any = plan.dayTradeRecommendation;
  if (!rec || rec.direction === 'ranging') continue;
  const s = sim(inst, rec, T, d.h1, computeAtrPercentile(c1, 14, 200));
  if (!s) continue;
  if (!s.gS || !s.gZ) gated++;
  recs.push(s);
  openUntil.set(inst, s.exitEpoch);
}

await Bun.write('/tmp/bt/gates.json', JSON.stringify(recs));
const res = recs.filter(r => r.filled && r.R !== null);
console.log(`candidates ${recs.length} | would-be-suppressed ${gated} | resolved ${res.length}`);

res.sort((a, b) => a.genEpoch - b.genEpoch);
const cut = res[Math.floor(res.length / 2)].genEpoch;
const train = res.filter(r => r.genEpoch < cut), test = res.filter(r => r.genEpoch >= cut);
const dt = (e: number) => new Date(e * 1000).toISOString().slice(0, 10);
console.log(`TRAIN ${train.length} (${dt(res[0].genEpoch)} -> ${dt(cut)}) | HOLDOUT ${test.length} (${dt(cut)} -> ${dt(res[res.length - 1].genEpoch)})`);

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const corr = (x: number[], y: number[]) => {
  const n = x.length; if (n < 3) return NaN;
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const a = x[i] - mx, b = y[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
  if (!sxx || !syy) return NaN;
  return sxy / Math.sqrt(sxx * syy);
};
const tOf = (r: number, n: number) => r * Math.sqrt((n - 2) / (1 - r * r));

function report(set: Rec[], label: string) {
  console.log(`\n=== ${label} (n=${set.length}, avgR ${mean(set.map(r => r.R!)).toFixed(3)}) ===`);
  const gates: [string, (r: Rec) => boolean][] = [
    ['structural gate', r => r.gS],
    ['zone gate', r => r.gZ],
    ['both gates', r => r.gS && r.gZ],
  ];
  console.log('gate'.padEnd(18), 'corr'.padStart(8), 't'.padStart(7), 'nPass'.padStart(6), 'avgR|pass'.padStart(10), 'WR|pass'.padStart(8), 'nFail'.padStart(6), 'avgR|fail'.padStart(10), 'WR|fail'.padStart(8));
  for (const [name, f] of gates) {
    const x = set.map(r => (f(r) ? 1 : 0)), y = set.map(r => r.R!);
    const pass = set.filter(f), fail = set.filter(r => !f(r));
    const c = corr(x, y);
    const wr = (g: Rec[]) => (g.length ? (g.filter(r => r.R! > 0).length / g.length * 100).toFixed(1) + '%' : '-');
    console.log(
      name.padEnd(18),
      (isNaN(c) ? 'const' : c.toFixed(3)).padStart(8),
      (isNaN(c) ? '-' : tOf(c, set.length).toFixed(2)).padStart(7),
      String(pass.length).padStart(6),
      (pass.length ? mean(pass.map(r => r.R!)).toFixed(3) : '-').padStart(10),
      wr(pass).padStart(8),
      String(fail.length).padStart(6),
      (fail.length ? mean(fail.map(r => r.R!)).toFixed(3) : '-').padStart(10),
      wr(fail).padStart(8),
    );
  }
}
report(train, 'TRAIN');
report(test, 'HOLDOUT');
report(res, 'FULL (reference only)');
