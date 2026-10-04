/**
 * Head-to-head: client's generateTradePlan (clean, single shared-source swing
 * path) vs the frozen generateServerSignal (signal-engine's independent local
 * re-implementation of structure/OB/FVG/etc.) — same historical candles, same
 * walk-forward simulation, same win/loss determination.
 *
 * Answers: do they actually disagree in practice, and if so, does one have a
 * meaningfully better win rate on the cases where they disagree? Each saved
 * trade is also tagged with whether the OTHER engine agreed, disagreed, or
 * was silent at that same event — so serverVsClientStats.ts can check whether
 * agreement itself predicts quality, and whether each side's own confidence
 * score is actually correlated with real outcomes.
 *
 * Measurement only — changes no live code. Requires /tmp/bt/data.json
 * (run `bun .backtest/fetch.ts` first if it doesn't exist).
 */
import { generateTradePlan } from '@/lib/tradeSignalGenerator';
import { getVolatilityAdjustedSpread, computeAtrPercentile } from '@/lib/spreadConfig';
import { arbitrateSignal, type PendingSignalLike } from './arbiterModel';
import type { TradingInstrument } from '@/types/trading';
import { generateServerSignal } from './serverEngineSignal';

type C = { epoch: number; open: number; high: number; low: number; close: number };
const data: Record<string, { h1: C[]; h4: C[]; d1: C[] }> = JSON.parse(
  await Bun.file('/tmp/bt/data.json').text()
);

const path = (c: C) => (c.close >= c.open ? [c.open, c.low, c.high, c.close] : [c.open, c.high, c.low, c.close]);
const hit = (dir: 'bullish' | 'bearish', level: number, price: number, isTarget: boolean) => {
  const above = dir === 'bullish' ? isTarget : !isTarget;
  return above ? price >= level : price <= level;
};

type Agreement = 'both_same' | 'both_opp' | 'client_only' | 'server_only';
type BItem = { label: string; value: string; weight: number; maxWeight: number; contributing: boolean };

interface SimRec {
  id: string; source: 'client' | 'server'; inst: string; dir: 'bullish' | 'bearish'; conf: number;
  genEpoch: number; exitEpoch: number; filled: boolean; base: number | null; cancelled: boolean;
  agreement: Agreement; breakdown: BItem[];
}

function sim(
  source: 'client' | 'server', inst: string, dir: 'bullish' | 'bearish', conf: number,
  entry: number, sl: number, tps: number[], preferPendingOrder: boolean,
  genEpoch: number, candles: C[], atrPct: number | null, id: string, agreement: Agreement, breakdown: BItem[],
): SimRec | null {
  const risk = Math.abs(entry - sl);
  if (!risk || !isFinite(risk)) return null;
  const spread = getVolatilityAdjustedSpread(inst, atrPct);
  const maxBars = 720; // swing horizon, matches swingscore.ts
  const horizon = candles.filter(c => c.epoch >= genEpoch).slice(0, maxBars);
  const horizonEnd = horizon.length ? horizon[horizon.length - 1].epoch + 3600 : genEpoch + maxBars * 3600;

  const sh = dir === 'bullish' ? spread / 2 : -spread / 2;
  const effEntry = entry + sh;
  const riskAdj = Math.abs(effEntry - sl);
  const qFill = entry - sh, qSL = sl + sh;
  const q = tps.map(t => t + sh);
  const R = (p: number) => (dir === 'bullish' ? p - effEntry : effEntry - p) / riskAdj;
  let filled = !preferPendingOrder, out: number | null = null;
  let exit = horizonEnd;
  for (const c of horizon) {
    if (!filled) { if (c.low <= qFill && c.high >= qFill) filled = true; else continue; }
    for (const p of path(c)) {
      if (hit(dir, qSL, p, false)) { out = -1; break; }
      if (hit(dir, q[2], p, true)) { out = R(q[2]); break; }
      if (hit(dir, q[1], p, true)) { out = R(q[1]); break; }
    }
    if (out !== null) { exit = c.epoch + 3600; break; }
  }

  return { id, source, inst, dir, conf, genEpoch, exitEpoch: exit, filled, base: filled ? out : null, cancelled: false, agreement, breakdown };
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

const DEFAULT_SETTINGS = { forex_min_rr: 1.5, synthetic_min_rr: 1.5, ignore_counter_trend: false };

const recs: SimRec[] = [];
const byId = new Map<string, SimRec>();
let clientBook: PendingSignalLike[] = [];
let serverBook: PendingSignalLike[] = [];
let seq = 0;

let bothFiredSameDir = 0, bothFiredOppDir = 0;
let clientOnlyFired = 0, serverOnlyFired = 0, neitherFired = 0;

for (const ev of events) {
  const { T, inst } = ev;
  clientBook = clientBook.filter(p => (byId.get(p.id)?.exitEpoch ?? 0) > T);
  serverBook = serverBook.filter(p => (byId.get(p.id)?.exitEpoch ?? 0) > T);

  const d = data[inst];
  const cd = d.d1.filter(c => c.epoch + 86400 <= T).slice(-200);
  const c4 = d.h4.filter(c => c.epoch + 14400 <= T).slice(-300);
  const c1 = d.h1.filter(c => c.epoch + 3600 <= T).slice(-250);
  if (cd.length < 55 || c4.length < 55 || c1.length < 60) continue;
  const live = c1[c1.length - 1].close;
  const atrPct = computeAtrPercentile(c1, 14, 200);

  const dailyForm = forming(d.h1, T, 86400, cd);
  const fourHourForm = forming(d.h1, T, 14400, c4);

  let clientPlan;
  try {
    clientPlan = generateTradePlan(inst as TradingInstrument, dailyForm, fourHourForm, [...c1, c1[c1.length - 1]], live, live);
  } catch { clientPlan = null; }
  const clientRec = clientPlan?.recommendation;

  let serverSig;
  try {
    serverSig = generateServerSignal(inst, dailyForm, fourHourForm, c1, c1, DEFAULT_SETTINGS);
  } catch { serverSig = null; }

  const clientFires = !!clientRec && clientRec.direction !== 'ranging';
  const serverFires = !!serverSig;

  // Determine this event's agreement category once, then tag whichever
  // side(s) actually get simulated with the SAME tag — so later analysis can
  // ask "do agreed-upon trades perform differently than solo calls?"
  let agreement: Agreement;
  if (clientFires && serverFires) {
    if (clientRec!.direction === serverSig!.direction) { agreement = 'both_same'; bothFiredSameDir++; }
    else { agreement = 'both_opp'; bothFiredOppDir++; }
  } else if (clientFires) { agreement = 'client_only'; clientOnlyFired++; }
  else if (serverFires) { agreement = 'server_only'; serverOnlyFired++; }
  else { agreement = 'client_only'; neitherFired++; } // unused placeholder; nothing fires below

  // --- Simulate the client signal, if any ---
  if (clientFires) {
    const verdict = arbitrateSignal({ instrument: inst as TradingInstrument, direction: clientRec!.direction, tradeType: 'swing', confidence: clientRec!.confidence }, clientBook);
    if (verdict.allowed) {
      const id = `c${seq++}`;
      const s = sim('client', inst, clientRec!.direction as 'bullish' | 'bearish', clientRec!.confidence,
        clientRec!.risk.entry, clientRec!.risk.stopLoss, [clientRec!.risk.takeProfit1, clientRec!.risk.takeProfit2, clientRec!.risk.takeProfit3],
        clientRec!.preferPendingOrder, T, d.h1, atrPct, id, agreement, clientRec!.confidenceBreakdown ?? []);
      if (s) {
        for (const cid of verdict.cancelIds) { const v = byId.get(cid); if (v) v.cancelled = true; clientBook = clientBook.filter(p => p.id !== cid); }
        recs.push(s); byId.set(id, s);
        clientBook.push({ id, instrument: inst, direction: clientRec!.direction, trade_type: 'swing', confidence: clientRec!.confidence });
      }
    }
  }

  // --- Simulate the server signal, if any ---
  if (serverFires) {
    const verdict = arbitrateSignal({ instrument: inst as TradingInstrument, direction: serverSig!.direction, tradeType: 'swing', confidence: serverSig!.confidence }, serverBook);
    if (verdict.allowed) {
      const id = `s${seq++}`;
      // Parity with the client: a swing entry at an OB/FVG level is a pending
      // limit order, not a market fill — price must actually retrace to it.
      const s = sim('server', inst, serverSig!.direction, serverSig!.confidence,
        serverSig!.entry_price, serverSig!.stop_loss, [serverSig!.take_profit_1, serverSig!.take_profit_2, serverSig!.take_profit_3],
        true, T, d.h1, atrPct, id, agreement, serverSig!.confluence_breakdown ?? []);
      if (s) {
        for (const cid of verdict.cancelIds) { const v = byId.get(cid); if (v) v.cancelled = true; serverBook = serverBook.filter(p => p.id !== cid); }
        recs.push(s); byId.set(id, s);
        serverBook.push({ id, instrument: inst, direction: serverSig!.direction, trade_type: 'swing', confidence: serverSig!.confidence });
      }
    }
  }
}

await Bun.write('/tmp/bt/serverVsClient.json', JSON.stringify(recs));

console.log('=== Agreement (per 4-bar event where either side had a directional read) ===');
console.log('Both fired, SAME direction:', bothFiredSameDir);
console.log('Both fired, OPPOSITE direction:', bothFiredOppDir);
console.log('Client fired, server did not:', clientOnlyFired);
console.log('Server fired, client did not:', serverOnlyFired);
console.log('Neither fired:', neitherFired);
console.log('Total events:', bothFiredSameDir + bothFiredOppDir + clientOnlyFired + serverOnlyFired + neitherFired);

function stats(source: 'client' | 'server') {
  const resolved = recs.filter(r => r.source === source && !r.cancelled && r.filled && r.base !== null);
  const wins = resolved.filter(r => (r.base as number) > 0);
  const avgR = resolved.length ? resolved.reduce((s, r) => s + (r.base as number), 0) / resolved.length : 0;
  const winRate = resolved.length ? (wins.length / resolved.length) * 100 : 0;
  return { generated: recs.filter(r => r.source === source).length, resolved: resolved.length, winRate, avgR };
}

console.log('\n=== Client (generateTradePlan, shared-source) ===');
const cs = stats('client');
console.log(`Generated: ${cs.generated} | Resolved: ${cs.resolved} | Win rate: ${cs.winRate.toFixed(1)}% | Avg R: ${cs.avgR.toFixed(3)}`);

console.log('\n=== Server (frozen local-analysis engine) ===');
const ss = stats('server');
console.log(`Generated: ${ss.generated} | Resolved: ${ss.resolved} | Win rate: ${ss.winRate.toFixed(1)}% | Avg R: ${ss.avgR.toFixed(3)}`);

console.log('\nNote: this is a single run, not a train/holdout study. Run serverVsClientStats.ts');
console.log('for the proper train/holdout breakdown, agreement analysis, and confidence calibration check.');