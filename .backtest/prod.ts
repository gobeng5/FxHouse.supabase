/**
 * Production-accurate walk-forward backtest.
 * Uses the REAL deployed arbiter: imports arbitrateSignal from src/lib/signalArbiter.ts.
 * Measurement only — changes no live code.
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

interface Rec {
  id: string; inst: string; type: 'swing' | 'day'; dir: 'bullish' | 'bearish'; conf: number;
  month: string; genEpoch: number; exitEpoch: number; filled: boolean;
  base: number | null; nospread: number | null; w15: number | null; w20: number | null;
  mfe: number; mae: number; spreadRiskPct: number; cancelled: boolean;
}

function sim(
  inst: string, type: 'swing' | 'day', rec: any, genEpoch: number, candles: C[], atrPct: number | null, id: string
): Rec | null {
  const dir = rec.direction as 'bullish' | 'bearish';
  const entry = rec.risk.entry, sl = rec.risk.stopLoss;
  const tps = [rec.risk.takeProfit1, rec.risk.takeProfit2, rec.risk.takeProfit3];
  const risk = Math.abs(entry - sl);
  if (!risk || !isFinite(risk)) return null;
  const spread = getVolatilityAdjustedSpread(inst, atrPct);
  const maxBars = type === 'swing' ? 720 : 240;
  const horizon = candles.filter(c => c.epoch >= genEpoch).slice(0, maxBars);
  const horizonEnd = horizon.length ? horizon[horizon.length - 1].epoch + 3600 : genEpoch + maxBars * 3600;

  const run = (spreadUse: number, stopMult: number) => {
    const sh = dir === 'bullish' ? spreadUse / 2 : -spreadUse / 2;
    const effEntry = entry + sh;
    const slAdj = dir === 'bullish' ? entry - risk * stopMult : entry + risk * stopMult;
    const riskAdj = Math.abs(effEntry - slAdj);
    const qFill = entry - sh, qSL = slAdj + sh;
    const q = tps.map(t => t + sh);
    const R = (p: number) => (dir === 'bullish' ? p - effEntry : effEntry - p) / riskAdj;
    let filled = !rec.preferPendingOrder, out: number | null = null, mfe = -99, mae = 99;
    let exit = horizonEnd;
    for (const c of horizon) {
      if (!filled) { if (c.low <= qFill && c.high >= qFill) filled = true; else continue; }
      for (const p of path(c)) {
        const r = R(p);
        if (r > mfe) mfe = r; if (r < mae) mae = r;
        if (hit(dir, qSL, p, false)) { out = -1; break; }
        if (hit(dir, q[2], p, true)) { out = R(q[2]); break; }
        if (hit(dir, q[1], p, true)) { out = R(q[1]); break; }
      }
      if (out !== null) { exit = c.epoch + 3600; break; }
    }
    return { r: filled ? out : null, filled, mfe: mfe === -99 ? 0 : mfe, mae: mae === 99 ? 0 : mae, exit };
  };

  const b = run(spread, 1);
  const ns = run(0, 1), w15 = run(spread, 1.5), w20 = run(spread, 2.0);
  return {
    id, inst, type, dir, conf: rec.confidence, genEpoch,
    month: new Date(genEpoch * 1000).toISOString().slice(0, 7),
    exitEpoch: b.exit, filled: b.filled,
    base: b.r, nospread: ns.r, w15: w15.r, w20: w20.r,
    mfe: b.mfe, mae: b.mae, spreadRiskPct: (spread / risk) * 100, cancelled: false,
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

// ---- global chronological event grid across ALL instruments ----
const events: { T: number; inst: string; k: number }[] = [];
for (const [inst, d] of Object.entries(data)) {
  const start = d.h1[0].epoch + 75 * 86400;
  for (let k = 0; k < d.h1.length; k += 4) {
    const T = d.h1[k].epoch + 3600;
    if (T >= start) events.push({ T, inst, k });
  }
}
events.sort((a, b) => a.T - b.T);

const recs: Rec[] = [];
const byId = new Map<string, Rec>();
let book: PendingSignalLike[] = [];
let blocked = 0, replaced = 0, corrBlocked = 0;
let seq = 0;

for (const ev of events) {
  const { T, inst } = ev;
  // retire book entries whose simulated trade has finished / expired
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

    // *** REAL production arbiter, imported directly ***
    const verdict = arbitrateSignal(
      { instrument: inst as TradingInstrument, direction: rec.direction, tradeType: type, confidence: rec.confidence },
      book
    );
    if (!verdict.allowed) {
      blocked++;
      if (verdict.code === 'correlation_conflict') corrBlocked++;
      continue;
    }

    const id = `s${seq++}`;
    const s = sim(inst, type, rec, T, d.h1, atrPct, id);
    if (!s) continue;

    for (const cid of verdict.cancelIds) {
      const victim = byId.get(cid);
      if (victim) { victim.cancelled = true; replaced++; }
      book = book.filter(p => p.id !== cid);
    }

    recs.push(s); byId.set(id, s);
    book.push({ id, instrument: inst, direction: rec.direction, trade_type: type, confidence: rec.confidence });
  }
}

await Bun.write('/tmp/bt/prod.json', JSON.stringify(recs));
console.log('generated', recs.length, '| blocked by arbiter', blocked, '(correlation', corrBlocked + ')', '| replaced by reversal', replaced);
