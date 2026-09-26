/**
 * Walk-forward backtest of the SERVER signal-engine generator, before vs after
 * genuine arbitration (public.arbitrate_signal, mirrored offline by ./arbiterModel).
 *
 * BEFORE: the engine's old rule — one pending signal per instrument, no cross-instrument
 *         correlation blocking, no confidence-based reversal replacement.
 * AFTER:  a single shared pending book across all instruments, arbitrated.
 */
import { generateSignal } from '/tmp/bt/engine_base.ts';
import { arbitrateSignal, loadCorrelationPairsForHarness, type PendingSignalLike } from './arbiterModel';
import type { TradingInstrument } from '@/types/trading';

type C = { epoch: number; open: number; high: number; low: number; close: number };
const data: Record<string, { h1: C[]; h4: C[]; d1: C[] }> = JSON.parse(
  await Bun.file('/tmp/bt/data.json').text()
);

const SPREAD: Record<string, number> = {
  'EUR/USD': 0.00008, 'GBP/USD': 0.00012, 'AUD/USD': 0.00011, 'USD/JPY': 0.010,
  'GBP/JPY': 0.025, 'XAU/USD': 0.30, V10: 0.02, V25: 0.10, V50: 0.60, V75: 2.50,
  V100: 1.20, BOOM1000: 0.60,
};
const isSynth = (i: string) => /^(V\d+|BOOM|CRASH)/i.test(i);
const mult = (p: number | null) => (p == null ? 1 : p >= 95 ? 3 : p >= 80 ? 2 : p >= 50 ? 1.4 : 1);

const path = (c: C) => (c.close >= c.open ? [c.open, c.low, c.high, c.close] : [c.open, c.high, c.low, c.close]);
const hit = (dir: 'bullish' | 'bearish', level: number, price: number, isTarget: boolean) => {
  const above = dir === 'bullish' ? isTarget : !isTarget;
  return above ? price >= level : price <= level;
};
function forming(h1: C[], T: number, bucket: number, closed: C[]): C[] {
  const lastClose = closed.length ? closed[closed.length - 1].epoch + bucket : 0;
  const parts = h1.filter(c => c.epoch >= lastClose && c.epoch + 3600 <= T);
  if (!parts.length) return closed;
  return [...closed, {
    epoch: lastClose, open: parts[0].open, close: parts[parts.length - 1].close,
    high: Math.max(...parts.map(p => p.high)), low: Math.min(...parts.map(p => p.low)),
  }];
}

const settings = { forex_min_rr: 2.0, synthetic_min_rr: Number(process.env.SMINRR ?? 2.4), ignore_counter_trend: true };
(globalThis as any).__CLAMP = true; // stop clamp is deployed

interface Rec {
  id: string; inst: string; conf: number; r: number | null; filled: boolean;
  spreadRiskPct: number; exit: number; cancelled: boolean;
}

function simulate(inst: string, sig: any, T: number, h1: C[]) {
  const dir = sig.direction as 'bullish' | 'bearish';
  const entry = sig.entry_price, sl = sig.stop_loss;
  const tps = [sig.take_profit_1, sig.take_profit_2, sig.take_profit_3];
  const risk = Math.abs(entry - sl);
  if (!risk || !isFinite(risk)) return null;
  const spread = (SPREAD[inst] ?? 0.0001) * (isSynth(inst) ? mult(sig.atr_percentile_at_entry) : 1);
  const horizon = h1.filter(c => c.epoch >= T).slice(0, 720);
  const horizonEnd = horizon.length ? horizon[horizon.length - 1].epoch + 3600 : T + 720 * 3600;
  const sh = dir === 'bullish' ? spread / 2 : -spread / 2;
  const effEntry = entry + sh;
  const riskAdj = Math.abs(effEntry - sl);
  const qFill = entry - sh, qSL = sl + sh;
  const q = tps.map((t: number) => t + sh);
  const R = (p: number) => (dir === 'bullish' ? p - effEntry : effEntry - p) / riskAdj;
  let filled = false, out: number | null = null, exit = horizonEnd;
  for (const c of horizon) {
    if (!filled) { if (c.low <= qFill && c.high >= qFill) filled = true; else continue; }
    for (const p of path(c)) {
      if (hit(dir, qSL, p, false)) { out = -1; break; }
      if (hit(dir, q[2], p, true)) { out = R(q[2]); break; }
      if (hit(dir, q[1], p, true)) { out = R(q[1]); break; }
    }
    if (out !== null) { exit = c.epoch + 3600; break; }
  }
  return { r: filled ? out : null, filled, spreadRiskPct: (spread / riskAdj) * 100, exit };
}

/** BEFORE: per-instrument lockout only (the engine's pre-arbiter behaviour) */
function runBefore(): Rec[] {
  const recs: Rec[] = [];
  let seq = 0;
  for (const [inst, d] of Object.entries(data)) {
    const start = d.h1[0].epoch + 75 * 86400;
    let busyUntil = 0;
    for (let k = 0; k < d.h1.length; k++) {
      const T = d.h1[k].epoch + 3600;
      if (T < start || T <= busyUntil) continue;
      const cd = d.d1.filter(c => c.epoch + 86400 <= T).slice(-200);
      const c4 = d.h4.filter(c => c.epoch + 14400 <= T).slice(-300);
      const c1 = d.h1.filter(c => c.epoch + 3600 <= T).slice(-250);
      if (cd.length < 55 || c4.length < 55 || c1.length < 60) continue;
      let sig: any = null;
      try { sig = generateSignal(inst, forming(d.h1, T, 86400, cd), forming(d.h1, T, 14400, c4), [], c1, settings); } catch { continue; }
      if (!sig) continue;
      const s = simulate(inst, sig, T, d.h1);
      if (!s) continue;
      recs.push({ id: `b${seq++}`, inst, conf: sig.confidence, cancelled: false, ...s });
      busyUntil = s.exit;
    }
  }
  return recs;
}

/** AFTER: one shared, arbitrated pending book across all instruments */
function runAfter(): { recs: Rec[]; blocked: number; corrBlocked: number; replaced: number } {
  const recs: Rec[] = [];
  const byId = new Map<string, Rec>();
  let book: (PendingSignalLike & { exit: number })[] = [];
  let seq = 0, blocked = 0, corrBlocked = 0, replaced = 0;

  const hours = [...new Set(Object.values(data).flatMap(d => d.h1.map(c => c.epoch + 3600)))].sort((a, b) => a - b);

  for (const T of hours) {
    book = book.filter(p => p.exit > T);
    for (const [inst, d] of Object.entries(data)) {
      const start = d.h1[0].epoch + 75 * 86400;
      if (T < start) continue;

      const cd = d.d1.filter(c => c.epoch + 86400 <= T).slice(-200);
      const c4 = d.h4.filter(c => c.epoch + 14400 <= T).slice(-300);
      const c1 = d.h1.filter(c => c.epoch + 3600 <= T).slice(-250);
      if (cd.length < 55 || c4.length < 55 || c1.length < 60) continue;
      if (c1[c1.length - 1].epoch + 3600 !== T) continue; // instrument has no candle closing at T
      let sig: any = null;
      try { sig = generateSignal(inst, forming(d.h1, T, 86400, cd), forming(d.h1, T, 14400, c4), [], c1, settings); } catch { continue; }
      if (!sig) continue;

      const verdict = arbitrateSignal(
        { instrument: inst as TradingInstrument, direction: sig.direction, tradeType: sig.trade_type, confidence: Math.round(sig.confidence) },
        book
      );
      if (!verdict.allowed) {
        blocked++;
        if (verdict.code === 'correlation_conflict') corrBlocked++;
        continue;
      }
      const s = simulate(inst, sig, T, d.h1);
      if (!s) continue;
      for (const cid of verdict.cancelIds) {
        const victim = byId.get(cid);
        if (victim) { victim.cancelled = true; replaced++; }
        book = book.filter(p => p.id !== cid);
      }
      const id = `a${seq++}`;
      const rec: Rec = { id, inst, conf: sig.confidence, cancelled: false, ...s };
      recs.push(rec); byId.set(id, rec);
      book.push({ id, instrument: inst, direction: sig.direction, trade_type: sig.trade_type, confidence: Math.round(sig.confidence), exit: s.exit });
    }
  }
  return { recs, blocked, corrBlocked, replaced };
}

const fmt = (label: string, rs: Rec[]) => {
  const res = rs.filter(r => !r.cancelled && r.filled && r.r !== null);
  const wins = res.filter(r => (r.r as number) > 0).length;
  const avg = res.length ? res.reduce((s, r) => s + (r.r as number), 0) / res.length : 0;
  const net = res.reduce((s, r) => s + (r.r as number), 0);
  const sd = res.length > 1 ? Math.sqrt(res.reduce((s, r) => s + ((r.r as number) - avg) ** 2, 0) / (res.length - 1)) : 0;
  const t = sd > 0 ? avg / (sd / Math.sqrt(res.length)) : 0;
  console.log(`${label.padEnd(26)} n=${String(res.length).padStart(4)}  win=${((wins / (res.length || 1)) * 100).toFixed(1)}%  avgR=${avg >= 0 ? '+' : ''}${avg.toFixed(3)}  net=${net.toFixed(1)}R  t=${t.toFixed(2)}`);
};

await loadCorrelationPairsForHarness();

const before = runBefore();
console.log(`\n=== BEFORE (no arbiter) — generated ${before.length} ===`);
fmt('ALL', before); fmt('SYNTHETICS', before.filter(r => isSynth(r.inst))); fmt('FOREX/METALS', before.filter(r => !isSynth(r.inst)));

const after = runAfter();
console.log(`\n=== AFTER (arbitrated) — generated ${after.recs.length}, blocked ${after.blocked} (correlation ${after.corrBlocked}), replaced ${after.replaced} ===`);
fmt('ALL', after.recs); fmt('SYNTHETICS', after.recs.filter(r => isSynth(r.inst))); fmt('FOREX/METALS', after.recs.filter(r => !isSynth(r.inst)));
