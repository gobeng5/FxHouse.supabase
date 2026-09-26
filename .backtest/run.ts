/**
 * Walk-forward backtest variant: partial-close-at-TP1 study.
 * Measurement only — imports live signal logic, changes nothing.
 */
import { generateTradePlan } from '@/lib/tradeSignalGenerator';
import { getVolatilityAdjustedSpread, computeAtrPercentile, appliedSpreadMultiplier } from '@/lib/spreadConfig';
import type { TradingInstrument } from '@/types/trading';

type C = { epoch: number; open: number; high: number; low: number; close: number };
const data: Record<string, { h1: C[]; h4: C[]; d1: C[] }> = JSON.parse(
  await Bun.file('/tmp/bt/data.json').text()
);

const FOREX = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'GBP/JPY', 'XAU/USD'];

const path = (c: C) => (c.close >= c.open ? [c.open, c.low, c.high, c.close] : [c.open, c.high, c.low, c.close]);
const hit = (dir: 'bullish' | 'bearish', level: number, price: number, isTarget: boolean) => {
  const above = dir === 'bullish' ? isTarget : !isTarget;
  return above ? price >= level : price <= level;
};

interface Sim {
  inst: string; type: 'swing' | 'day'; dir: 'bullish' | 'bearish'; conf: number;
  month: string;
  filled: boolean;
  baseOutcome: 'won' | 'lost' | null; baseTarget: string | null; baseR: number | null;
  tp1First: boolean;             // TP1 touched before SL (after fill)
  r1: number;                    // R if TP1 portion closed
  remOutcome: 'TP2' | 'TP3' | 'BE' | 'OPEN' | null; remR: number | null;
}

function simulate(
  inst: string, type: 'swing' | 'day', rec: any, genEpoch: number, candles: C[], atrPct: number | null
): Sim | null {
  const dir = rec.direction as 'bullish' | 'bearish';
  const entry = rec.risk.entry, sl = rec.risk.stopLoss;
  const tp1 = rec.risk.takeProfit1, tp2 = rec.risk.takeProfit2, tp3 = rec.risk.takeProfit3;
  const risk = Math.abs(entry - sl);
  if (!risk || !isFinite(risk)) return null;

  const mult = appliedSpreadMultiplier(inst, atrPct);
  const spread = getVolatilityAdjustedSpread(inst, atrPct);
  const shift = dir === 'bullish' ? spread / 2 : -spread / 2;
  const effEntry = entry + shift;
  const qFill = entry - shift;
  const qSL = sl + shift;
  const qBE = entry + 2 * shift;      // exit at breakeven price = effEntry
  const q1 = tp1 + shift, q2 = tp2 + shift, q3 = tp3 + shift;
  const R = (realized: number) => ((dir === 'bullish' ? realized - effEntry : effEntry - realized) / risk);

  const sim: Sim = {
    inst, type, dir, conf: rec.confidence, month: new Date(genEpoch * 1000).toISOString().slice(0, 7),
    filled: !rec.preferPendingOrder,
    baseOutcome: null, baseTarget: null, baseR: null,
    tp1First: false, r1: R(tp1), remOutcome: null, remR: null,
  };

  const horizon = candles.filter(c => c.epoch >= genEpoch).slice(0, type === 'swing' ? 720 : 240);
  let filled = sim.filled;
  let tp1Done = false;
  let done = false;

  for (const c of horizon) {
    if (!filled) {
      if (c.low <= qFill && c.high >= qFill) filled = true;
      else continue;
    }
    const slInCandle = dir === 'bullish' ? c.low <= qSL : c.high >= qSL;
    for (const p of path(c)) {
      if (!tp1Done && hit(dir, q1, p, true)) tp1Done = true;
      if (hit(dir, qSL, p, false)) {
        sim.baseOutcome = 'lost'; sim.baseTarget = 'SL'; sim.baseR = -1;
        sim.tp1First = tp1Done;
        // remainder under partial rule: if TP1 was hit first, stop is at BE
        sim.remOutcome = tp1Done ? 'BE' : null;
        sim.remR = tp1Done ? 0 : null;
        done = true; break;
      }
      if (tp1Done && hit(dir, qBE, p, false)) {
        // breakeven stop only exists in the partial model; baseline keeps running
        if (sim.remOutcome === null) { sim.remOutcome = 'BE'; sim.remR = 0; }
      }
      if (hit(dir, q3, p, true)) {
        sim.baseOutcome = 'won'; sim.baseTarget = 'TP3'; sim.baseR = slInCandle ? -1 : R(tp3);
        if (slInCandle) { sim.baseOutcome = 'lost'; sim.baseTarget = 'SL'; }
        sim.tp1First = tp1Done;
        if (sim.remOutcome === null) { sim.remOutcome = slInCandle ? 'BE' : 'TP3'; sim.remR = slInCandle ? 0 : R(tp3); }
        done = true; break;
      }
      if (hit(dir, q2, p, true)) {
        sim.baseOutcome = 'won'; sim.baseTarget = 'TP2'; sim.baseR = slInCandle ? -1 : R(tp2);
        if (slInCandle) { sim.baseOutcome = 'lost'; sim.baseTarget = 'SL'; }
        sim.tp1First = tp1Done;
        if (sim.remOutcome === null) { sim.remOutcome = slInCandle ? 'BE' : 'TP2'; sim.remR = slInCandle ? 0 : R(tp2); }
        done = true; break;
      }
    }
    if (done) break;
  }
  sim.filled = filled;
  if (!filled) return null;
  if (!sim.baseOutcome) { sim.remOutcome = sim.remOutcome ?? 'OPEN'; return null; } // unresolved -> excluded
  sim.tp1First = sim.tp1First || tp1Done;
  return sim;
}

// forming-candle aggregation from 1H
function forming(h1: C[], T: number, bucket: number, closed: C[]): C[] {
  const lastClose = closed.length ? closed[closed.length - 1].epoch + bucket : 0;
  const parts = h1.filter(c => c.epoch >= lastClose && c.epoch + 3600 <= T);
  if (!parts.length) return closed;
  const f: C = {
    epoch: lastClose, open: parts[0].open, close: parts[parts.length - 1].close,
    high: Math.max(...parts.map(p => p.high)), low: Math.min(...parts.map(p => p.low)),
  };
  return [...closed, f];
}

const sims: Sim[] = [];
for (const [inst, d] of Object.entries(data)) {
  const { h1, h4, d1 } = d;
  const start = h1[0].epoch + 75 * 86400; // warm-up
  const openUntil: Record<string, number> = { swing: 0, day: 0 };
  for (let k = 0; k < h1.length; k++) {
    const T = h1[k].epoch + 3600;
    if (T < start) continue;
    if ((k % 4) !== 0) continue; // step 4h
    const cd = d1.filter(c => c.epoch + 86400 <= T).slice(-200);
    const c4 = h4.filter(c => c.epoch + 14400 <= T).slice(-300);
    const c1 = h1.filter(c => c.epoch + 3600 <= T).slice(-250);
    if (cd.length < 55 || c4.length < 55 || c1.length < 60) continue;
    const dailyIn = forming(h1, T, 86400, cd);
    const fourIn = forming(h1, T, 14400, c4);
    const oneIn = [...c1, c1[c1.length - 1]]; // generator drops last as "forming"
    const live = c1[c1.length - 1].close;
    let plan;
    try { plan = generateTradePlan(inst as TradingInstrument, dailyIn, fourIn, oneIn, live, live); }
    catch { continue; }
    const atrPct = computeAtrPercentile(c1, 14, 200);
    for (const [type, rec] of [['swing', plan.recommendation], ['day', plan.dayTradeRecommendation]] as const) {
      if (!rec || rec.direction === 'ranging' || rec.confidence < 55) continue;
      if (T < openUntil[type]) continue; // one open setup per instrument+type
      const s = simulate(inst, type, rec, T, h1, atrPct);
      if (!s) continue;
      sims.push(s);
      openUntil[type] = T + (type === 'swing' ? 5 : 2) * 86400;
    }
  }
  console.error('done', inst, sims.length);
}

await Bun.write('/tmp/bt/sims.json', JSON.stringify(sims));
console.log('total sims', sims.length);
