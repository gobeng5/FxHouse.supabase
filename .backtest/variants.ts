/**
 * Day-trade geometry variants against the production-accurate harness.
 * Uses the REAL deployed arbiter (imported, not copied).
 * Variants (day trades only; swing untouched):
 *   base : live geometry
 *   A    : day stop widened 1.5x -> 2.0x ATR1H (risk distance x 4/3), same TP ladder
 *   B    : live stop, terminal first target at 0.8R (inside measured MFE ceiling)
 *   C    : both
 */
import { generateTradePlan } from '@/lib/tradeSignalGenerator';
import { getVolatilityAdjustedSpread, computeAtrPercentile } from '@/lib/spreadConfig';
import { arbitrateSignal, type PendingSignalLike } from './arbiterModel';
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

type V = 'base' | 'A' | 'B' | 'C';
const VARIANTS: V[] = ['base', 'A', 'B', 'C'];

interface Rec {
  id: string; inst: string; type: 'swing' | 'day'; conf: number; exitEpoch: number;
  filled: boolean; r: Partial<Record<V, number | null>>; cancelled: boolean;
}

function sim(
  inst: string, type: 'swing' | 'day', rec: any, genEpoch: number, candles: C[], atrPct: number | null, id: string
): Rec | null {
  const dir = rec.direction as 'bullish' | 'bearish';
  const entry = rec.risk.entry, sl = rec.risk.stopLoss;
  const tps = [rec.risk.takeProfit1, rec.risk.takeProfit2, rec.risk.takeProfit3];
  const risk0 = Math.abs(entry - sl);
  if (!risk0 || !isFinite(risk0)) return null;
  const spread = getVolatilityAdjustedSpread(inst, atrPct);
  const maxBars = type === 'swing' ? 720 : 240;
  const horizon = candles.filter(c => c.epoch >= genEpoch).slice(0, maxBars);
  const horizonEnd = horizon.length ? horizon[horizon.length - 1].epoch + 3600 : genEpoch + maxBars * 3600;
  const sgn = dir === 'bullish' ? 1 : -1;

  const run = (stopMult: number, firstTargetR: number | null) => {
    const sh = sgn * spread / 2;
    const effEntry = entry + sh;
    const slAdj = entry - sgn * risk0 * stopMult;
    const riskAdj = Math.abs(effEntry - slAdj);
    const qFill = entry - sh, qSL = slAdj + sh;
    const targets = firstTargetR !== null
      ? [entry + sgn * risk0 * firstTargetR]
      : [tps[2], tps[1]];
    const q = targets.map(t => t + sh);
    const R = (p: number) => (sgn * (p - effEntry)) / riskAdj;
    let filled = !rec.preferPendingOrder, out: number | null = null, exit = horizonEnd;
    for (const c of horizon) {
      if (!filled) { if (c.low <= qFill && c.high >= qFill) filled = true; else continue; }
      for (const p of path(c)) {
        if (hit(dir, qSL, p, false)) { out = -1; break; }
        let done = false;
        for (const t of q) if (hit(dir, t, p, true)) { out = R(t); done = true; break; }
        if (done) break;
      }
      if (out !== null) { exit = c.epoch + 3600; break; }
    }
    return { r: filled ? out : null, filled, exit };
  };

  const b = run(1, null);
  const r: Rec['r'] = { base: b.r };
  if (type === 'day') {
    r.A = run(4 / 3, null).r;
    r.B = run(1, 0.8).r;
    r.C = run(4 / 3, 0.8).r;
  } else {
    r.A = b.r; r.B = b.r; r.C = b.r;
  }
  return { id, inst, type, conf: rec.confidence, exitEpoch: b.exit, filled: b.filled, r, cancelled: false };
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
const byId = new Map<string, Rec>();
let book: PendingSignalLike[] = [];
let seq = 0;

for (const ev of events) {
  const { T, inst } = ev;
  book = book.filter(p => (byId.get(p.id)?.exitEpoch ?? 0) > T);
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
  const atrPct = computeAtrPercentile(c1, 14, 200);

  for (const [type, rec] of [['swing', plan.recommendation], ['day', plan.dayTradeRecommendation]] as const) {
    if (!rec || rec.direction === 'ranging' || rec.confidence < 55) continue;
    const verdict = arbitrateSignal(
      { instrument: inst as TradingInstrument, direction: rec.direction, tradeType: type, confidence: rec.confidence },
      book
    );
    if (!verdict.allowed) continue;
    const id = `s${seq++}`;
    const s = sim(inst, type, rec, T, d.h1, atrPct, id);
    if (!s) continue;
    for (const cid of verdict.cancelIds) {
      const victim = byId.get(cid);
      if (victim) victim.cancelled = true;
      book = book.filter(p => p.id !== cid);
    }
    recs.push(s); byId.set(id, s);
    book.push({ id, instrument: inst, direction: rec.direction, trade_type: type, confidence: rec.confidence });
  }
}

const f = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(3);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const tstat = (a: number[]) => {
  if (a.length < 2) return NaN;
  const m = mean(a);
  const sd = Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
  return m / (sd / Math.sqrt(a.length));
};
const live = recs.filter(r => !r.cancelled && r.filled);
const report = (label: string, g: Rec[]) => {
  console.log('\n--- ' + label + ' ---');
  for (const v of VARIANTS) {
    const rs = g.map(x => x.r[v]).filter(x => x !== null && x !== undefined) as number[];
    if (!rs.length) continue;
    console.log(
      v.padEnd(5), `n=${String(rs.length).padStart(4)}`,
      `WR ${(rs.filter(x => x > 0).length / rs.length * 100).toFixed(1).padStart(5)}%`,
      `avgR ${f(mean(rs))}`, `netR ${f(rs.reduce((a, b) => a + b, 0)).padStart(9)}`,
      `t=${tstat(rs).toFixed(2)}`
    );
  }
};
console.log('generated', recs.length, '| cancelled', recs.filter(r => r.cancelled).length,
  '| filled+kept', live.length);
report('DAY trades', live.filter(r => r.type === 'day'));
report('SWING trades', live.filter(r => r.type === 'swing'));
report('ALL', live);
