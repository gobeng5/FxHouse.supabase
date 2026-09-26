/**
 * FINAL production-accurate walk-forward (2026-09-25).
 * Manual (client generateTradePlan) and engine (server generateSignal, extracted verbatim
 * from signal-engine/index.ts into /tmp/bt/engine_base.ts) share ONE pending book,
 * arbitrated by the offline mirror of public.arbitrate_signal (parity-verified 336/336),
 * with the DB slot-live window (day 4h / swing 24h) and unfilled-expiry at the same window.
 * Costs: getVolatilityAdjustedSpread (ATR percentile) on both paths. Wick (OHLC-path) resolution.
 * Engine: synthetic_min_rr 2.4, stop clamp (in engine code), notify_min_confidence 70.
 * Manual: confidence >= 55. Unified swing confidence is inside both generators.
 */
import { generateTradePlan } from '@/lib/tradeSignalGenerator';
import { getVolatilityAdjustedSpread, computeAtrPercentile } from '@/lib/spreadConfig';
import { arbitrateSignal, loadCorrelationPairsForHarness, type PendingSignalLike } from './arbiterModel';
import { generateSignal } from '/tmp/bt/engine_base.ts';
import type { TradingInstrument } from '@/types/trading';

type C = { epoch: number; open: number; high: number; low: number; close: number };
const data: Record<string, { h1: C[]; h4: C[]; d1: C[] }> = JSON.parse(await Bun.file('/tmp/bt/data.json').text());
for (const [k, v] of Object.entries(data)) if (!v.h1.length || !v.h4.length || !v.d1.length) throw new Error(`empty ${k}`);

const path = (c: C) => (c.close >= c.open ? [c.open, c.low, c.high, c.close] : [c.open, c.high, c.low, c.close]);
const hit = (dir: string, level: number, p: number, isTarget: boolean) =>
  (dir === 'bullish' ? isTarget : !isTarget) ? p >= level : p <= level;
const WIN = (t: string) => (t === 'day' ? 4 : 24) * 3600;

interface Rec { id: string; src: 'manual' | 'engine'; inst: string; type: string; conf: number; T: number;
  r: number | null; filled: boolean; exit: number; cancelled: boolean; expired: boolean }

function sim(inst: string, type: string, dir: string, entry: number, sl: number, tp2: number, tp3: number,
  pending: boolean, T: number, h1: C[], atrPct: number | null) {
  const risk = Math.abs(entry - sl);
  if (!risk || !isFinite(risk)) return null;
  const spread = getVolatilityAdjustedSpread(inst, atrPct);
  const horizon = h1.filter(c => c.epoch >= T).slice(0, type === 'swing' ? 720 : 240);
  const end = horizon.length ? horizon[horizon.length - 1].epoch + 3600 : T;
  const sh = dir === 'bullish' ? spread / 2 : -spread / 2;
  const eff = entry + sh, riskAdj = Math.abs(eff - sl);
  const qFill = entry - sh, qSL = sl + sh, q2 = tp2 + sh, q3 = tp3 + sh;
  const R = (p: number) => (dir === 'bullish' ? p - eff : eff - p) / riskAdj;
  let filled = !pending, out: number | null = null, exit = end;
  for (const c of horizon) {
    if (!filled) {
      if (c.epoch >= T + WIN(type)) return { r: null, filled: false, exit: T + WIN(type), expired: true };
      if (c.low <= qFill && c.high >= qFill) filled = true; else continue;
    }
    for (const p of path(c)) {
      if (hit(dir, qSL, p, false)) { out = -1; break; }
      if (hit(dir, q3, p, true)) { out = R(q3); break; }
      if (hit(dir, q2, p, true)) { out = R(q2); break; }
    }
    if (out !== null) { exit = c.epoch + 3600; break; }
  }
  return { r: filled ? out : null, filled, exit, expired: false };
}

function forming(h1: C[], T: number, bucket: number, closed: C[]): C[] {
  const lc = closed.length ? closed[closed.length - 1].epoch + bucket : 0;
  const parts = h1.filter(c => c.epoch >= lc && c.epoch + 3600 <= T);
  if (!parts.length) return closed;
  return [...closed, { epoch: lc, open: parts[0].open, close: parts[parts.length - 1].close,
    high: Math.max(...parts.map(p => p.high)), low: Math.min(...parts.map(p => p.low)) }];
}

await loadCorrelationPairsForHarness();
const settings = { forex_min_rr: 2.0, synthetic_min_rr: 2.4, ignore_counter_trend: true };
const recs: Rec[] = []; const byId = new Map<string, Rec>();
let book: (PendingSignalLike & { gen: number })[] = [];
let seq = 0; const blocked = { manual: 0, engine: 0 }; let replaced = 0;

const hours = [...new Set(Object.values(data).flatMap(d => d.h1.map(c => c.epoch + 3600)))].sort((a, b) => a - b);

function submit(src: 'manual' | 'engine', inst: string, type: string, dir: string, conf: number,
  s: ReturnType<typeof sim>, T: number) {
  if (!s) return;
  const live = book.filter(p => (byId.get(p.id)!.exit > T) && T < p.gen + WIN(p.trade_type));
  const v = arbitrateSignal({ instrument: inst as TradingInstrument, direction: dir as any, tradeType: type as any, confidence: Math.round(conf) }, live);
  if (!v.allowed) { blocked[src]++; return; }
  for (const cid of v.cancelIds) { const x = byId.get(cid); if (x && !x.cancelled) { x.cancelled = true; replaced++; } book = book.filter(p => p.id !== cid); }
  const id = `${src[0]}${seq++}`;
  const r: Rec = { id, src, inst, type, conf, T, cancelled: false, ...s };
  recs.push(r); byId.set(id, r);
  book.push({ id, instrument: inst, direction: dir as any, trade_type: type as any, confidence: Math.round(conf), gen: T });
}

for (const T of hours) {
  book = book.filter(p => byId.get(p.id)!.exit > T && T < p.gen + WIN(p.trade_type));
  for (const [inst, d] of Object.entries(data)) {
    if (T < d.h1[0].epoch + 75 * 86400) continue;
    const cd = d.d1.filter(c => c.epoch + 86400 <= T).slice(-200);
    const c4 = d.h4.filter(c => c.epoch + 14400 <= T).slice(-300);
    const c1 = d.h1.filter(c => c.epoch + 3600 <= T).slice(-250);
    if (cd.length < 55 || c4.length < 55 || c1.length < 60) continue;
    if (c1[c1.length - 1].epoch + 3600 !== T) continue;
    const atrPct = computeAtrPercentile(c1, 14, 200);
    const fd = forming(d.h1, T, 86400, cd), f4 = forming(d.h1, T, 14400, c4);

    // Engine (hourly cron, runs first in the hour)
    let sig: any = null;
    try { sig = generateSignal(inst, fd, f4, [], c1, settings); } catch { sig = null; }
    if (sig && sig.confidence >= 70) {
      submit('engine', inst, sig.trade_type, sig.direction, sig.confidence,
        sim(inst, sig.trade_type, sig.direction, sig.entry_price, sig.stop_loss, sig.take_profit_2, sig.take_profit_3, true, T, d.h1, atrPct), T);
    }

    // Manual (same 4-hour cadence as prod.ts)
    const k = d.h1.findIndex(c => c.epoch + 3600 === T);
    if (k % 4 !== 0) continue;
    let plan;
    try { plan = generateTradePlan(inst as TradingInstrument, fd, f4, [...c1, c1[c1.length - 1]], c1[c1.length - 1].close, c1[c1.length - 1].close); } catch { continue; }
    for (const [type, rec] of [['swing', plan.recommendation], ['day', plan.dayTradeRecommendation]] as const) {
      if (!rec || rec.direction === 'ranging' || rec.confidence < 55) continue;
      submit('manual', inst, type, rec.direction, rec.confidence,
        sim(inst, type, rec.direction, rec.risk.entry, rec.risk.stopLoss, rec.risk.takeProfit2, rec.risk.takeProfit3, !!rec.preferPendingOrder, T, d.h1, atrPct), T);
    }
  }
}

await Bun.write('/tmp/bt/final.json', JSON.stringify(recs));
const stat = (label: string, rs: Rec[]) => {
  const x = rs.filter(r => !r.cancelled && r.filled && r.r !== null).map(r => r.r as number);
  const n = x.length, m = n ? x.reduce((a, b) => a + b, 0) / n : 0;
  const sd = n > 1 ? Math.sqrt(x.reduce((s, v) => s + (v - m) ** 2, 0) / (n - 1)) : 0;
  const se = n ? sd / Math.sqrt(n) : 0, w = x.filter(v => v > 0).length;
  console.log(`${label.padEnd(22)} gen=${String(rs.length).padStart(4)} n=${String(n).padStart(4)} win=${(n ? w / n * 100 : 0).toFixed(1)}% avgR=${m.toFixed(3)} CI=[${(m - 1.96 * se).toFixed(3)}, ${(m + 1.96 * se).toFixed(3)}] t=${se ? (m / se).toFixed(2) : 'n/a'} net=${(m * n).toFixed(1)}R`);
};
console.log('blocked', blocked, 'replaced', replaced, 'expired', recs.filter(r => r.expired).length);
const M = recs.filter(r => r.src === 'manual'), E = recs.filter(r => r.src === 'engine');
stat('MANUAL all', M); stat('MANUAL swing', M.filter(r => r.type === 'swing')); stat('MANUAL day', M.filter(r => r.type === 'day'));
stat('ENGINE all', E); stat('COMBINED', recs);
