/**
 * FxHouse — end-to-end check that the server engine and the web app issue the
 * SAME forex/gold signal from the shared SMC CHoCH + FVG module.
 *
 * Runs the real signal-engine source (its only edits: the Supabase import, the
 * Deriv request and the shared-module paths are pointed at local stand-ins) at
 * a moment in the saved history where a setup is known to trigger, with a fake
 * database that records what the engine tries to save and send. Then builds
 * the web app's trade plan for the same moment and compares the two.
 *
 * Nothing is read from or written to the live database, and no message is sent.
 *
 * Run with:
 *   bun run .\backtest\smc-engine-check.ts
 */

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cleanSeries, firstIndexAtOrAfter, loadData } from './lib';
import type { Candle, Series } from './lib';
import { PRIMARY, setups as researchSetups } from './smc-choch-fvg';
import { evaluateSmcChochFvg, SMC_CONFIDENCE, SMC_SETUP_TYPE, SMC_US100_SETUP_TYPE } from '../supabase/functions/_shared/analysis/smcChochFvg';
import { evaluateXagDonchian } from '../supabase/functions/_shared/analysis/selectiveGems';
import { generateTradePlan } from '../src/lib/tradeSignalGenerator';
import type { TradingInstrument } from '../src/types/trading';

const SYMBOLS: Record<string, string> = {
  frxEURUSD: 'EUR/USD', frxGBPUSD: 'GBP/USD', frxUSDJPY: 'USD/JPY', frxAUDUSD: 'AUD/USD', frxGBPJPY: 'GBP/JPY', frxXAUUSD: 'XAU/USD',
  R_10: 'V10', R_25: 'V25', R_50: 'V50', R_75: 'V75', R_100: 'V100', BOOM1000: 'BOOM1000',
  frxXAGUSD: 'XAG/USD', OTC_NDX: 'US100',
};
const TF: Record<number, keyof Series> = { 900: 'm15', 3600: 'h1', 14400: 'h4', 86400: 'd1' };
const USER = '00000000-0000-0000-0000-000000000001';

// Silver and US100 come from the candidate-instrument history.
const data = { ...loadData('./backtest/data.json'), ...loadData('./backtest/data-candidates.json') };
const series = new Map<string, Series>(Object.keys(data).map(k => [k, cleanSeries(data[k]).series]));

// ---- stand-ins the engine copy talks to ----
let nowEpoch = 0;
let existingSmcSignal = false;
let inserts: any[] = [];
let telegram: string[] = [];
let arbitrations = 0;

/** What Deriv would return at `nowEpoch`: the last `count` candles, including the one still forming. */
const candlesAt = (instrument: string, granularity: number, count: number): Candle[] => {
  const all = series.get(instrument)![TF[granularity]];
  return all.slice(Math.max(0, firstIndexAtOrAfter(all, nowEpoch + 1) - count), firstIndexAtOrAfter(all, nowEpoch + 1));
};

(globalThis as any).__deriv = async (payload: any) =>
  ({ candles: candlesAt(SYMBOLS[payload.ticks_history], payload.granularity, payload.count) });

function table(name: string) {
  let op = 'select', row: any = null;
  const filters: Record<string, any> = {};
  const result = () => {
    if (op === 'insert') { inserts.push(row); return { data: { ...row, id: `test-${inserts.length}`, generated_at: new Date(nowEpoch * 1000).toISOString() }, error: null }; }
    if (op !== 'select') return { data: null, error: null };
    if (name === 'user_settings') {
      return { data: [{
        user_id: USER, auto_engine_enabled: true, signals_paused: false, notify_instruments: [], notify_min_confidence: 70,
        max_daily_loss_percent: 5, max_trades_per_day: 50, forex_min_rr: 2, synthetic_min_rr: 1.5, ignore_counter_trend: true,
        telegram_enabled: true, telegram_bot_token: 'test', telegram_chat_id: 'test',
      }], error: null };
    }
    if (name === 'generated_signals' && filters.setup_type === SMC_SETUP_TYPE) return { data: existingSmcSignal ? [{ id: 'earlier' }] : [], error: null };
    return { data: [], error: null };
  };
  const q: any = {
    select: () => q, gte: () => q, neq: () => q, order: () => q, limit: () => q, range: () => q,
    eq: (k: string, v: any) => { filters[k] = v; return q; },
    insert: (r: any) => { op = 'insert'; row = r; return q; },
    update: () => { op = 'update'; return q; },
    upsert: () => { op = 'upsert'; return q; },
    single: async () => result(),
    maybeSingle: async () => ({ data: null, error: null }),
    then: (res: any, rej: any) => Promise.resolve(result()).then(res, rej),
  };
  return q;
}

(globalThis as any).__fakeClient = {
  from: (name: string) => table(name),
  rpc: async (fn: string) => { if (fn === 'arbitrate_signal') arbitrations++; return { data: { allowed: true, reason: 'ok', code: 'approved', cancel_ids: [] }, error: null }; },
  functions: { invoke: async (_n: string, o: any) => { telegram.push(o.body.message); return { data: { success: true, message_id: 1 }, error: null }; } },
};

let handler: (req: Request) => Promise<Response>;
(globalThis as any).Deno = { env: { get: () => 'local' }, serve: (h: any) => { handler = h; } };
const realNow = Date.now;
Date.now = () => (nowEpoch ? nowEpoch * 1000 : realNow());

// ---- load the engine: real source, three lines pointed at the stand-ins ----
const shared = pathToFileURL(resolve('supabase/functions/_shared/analysis')).href;
let src = readFileSync('supabase/functions/signal-engine/index.ts', 'utf8');
const swap = (from: string | RegExp, to: string) => {
  const next = src.replace(from, to);
  if (next === src) throw new Error(`engine source changed: could not find ${from}`);
  src = next;
};
swap("import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';", 'const createClient = (..._a: any[]): any => (globalThis as any).__fakeClient;');
swap(/'\.\.\/_shared\/analysis\//g, `'${shared}/`);
swap('async function derivRequest(', 'async function derivRequest(payload: Record<string, unknown>, _t: number): Promise<any> { return (globalThis as any).__deriv(payload); }\nasync function derivRequestLive(');
const copy = join(mkdtempSync(join(tmpdir(), 'fxhouse-engine-')), 'engine.ts');
writeFileSync(copy, src);
await import(pathToFileURL(copy).href);

const runEngine = async () => {
  inserts = []; telegram = []; arbitrations = 0;
  const res = await handler!(new Request('http://local/signal-engine', { method: 'POST', body: '{}', headers: { 'x-engine-secret': 'local' } }));
  return (await res.json()) as any;
};

// ---- pick moments where the research script says a setup triggers ----
const checks: boolean[] = [];
const check = (label: string, ok: boolean, detail = '') => { checks.push(ok); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`); };

for (const instrument of ['GBP/JPY', 'XAU/USD', 'EUR/USD'] as TradingInstrument[]) {
  const s = series.get(instrument)!;
  const all = researchSetups(s, PRIMARY);
  const pick = all[Math.floor(all.length / 2)];
  nowEpoch = pick.trigClose + 5;
  existingSmcSignal = false;
  console.log(`\n===== ${instrument} at ${new Date(nowEpoch * 1000).toISOString()} =====`);

  const body = await runEngine();
  const saved = inserts.filter(r => r.instrument === instrument);
  const mod = evaluateSmcChochFvg(instrument, candlesAt(instrument, 14400, 100), candlesAt(instrument, 3600, 200), nowEpoch).setup!;
  check('engine saved exactly one signal for the instrument', saved.length === 1, `saved ${saved.length}; engine errors: ${JSON.stringify(body.errors ?? [])}`);
  const row = saved[0] ?? {};
  check('it is the SMC strategy, swing type, fixed confidence', row.setup_type === SMC_SETUP_TYPE && row.trade_type === 'swing' && row.confidence === SMC_CONFIDENCE);
  check('levels equal the shared module', row.entry_price === mod.entry && row.stop_loss === mod.stopLoss && row.take_profit_2 === mod.takeProfit,
    `entry ${row.entry_price} stop ${row.stop_loss} target ${row.take_profit_2}`);
  check('one target in all three slots, 2R', row.take_profit_1 === row.take_profit_3 && Math.abs(row.risk_reward_ratio - 2) < 0.05, `R:R ${row.risk_reward_ratio?.toFixed(2)}`);
  check('levels match the research script within rounding', Math.abs(row.entry_price - pick.entry) < 1e-2 * (instrument === 'EUR/USD' ? 0.01 : 1) && Math.abs(row.stop_loss - pick.stop) < 1e-2 * (instrument === 'EUR/USD' ? 0.01 : 1));
  check('Telegram alert sent although confidence 50 is under the user threshold of 70', telegram.some(m => m.includes(instrument)));
  const msg = telegram.find(m => m.includes(instrument)) ?? '';
  check('alert shows one target and no confidence score', msg.includes('Target:') && !msg.includes('TP1') && !msg.includes('Confidence'));
  check('alert lists the parameters that triggered the signal', ['H4 trend', 'H1 change of character', 'Session', 'Fair value gap', 'Stop', 'Risk size'].every(p => msg.includes(`• ${p}:`)));
  check('the same parameters are stored with the signal', Array.isArray(row.confluence_breakdown) && row.confluence_breakdown.length === mod.parameters.length && row.confluence_score_total === row.confluence_score_max);

  // The web app, same moment, same candles it would fetch (200 D1, 300 H4, 200 H1).
  const h4 = candlesAt(instrument, 14400, 300);
  const plan = generateTradePlan(instrument, candlesAt(instrument, 86400, 200), h4, candlesAt(instrument, 3600, 200), h4[h4.length - 2].close, null, nowEpoch);
  const rec = plan.recommendation;
  check('web app recommendation equals the engine signal', rec.direction === row.direction && rec.risk.entry === row.entry_price && rec.risk.stopLoss === row.stop_loss && rec.risk.takeProfit2 === row.take_profit_2 && rec.setupType === SMC_SETUP_TYPE,
    `app: ${rec.direction} entry ${rec.risk.entry} stop ${rec.risk.stopLoss} target ${rec.risk.takeProfit2}`);
  check('web app day-trade recommendation is retired', plan.dayTradeRecommendation.direction === 'ranging');
  check('web app carries the same parameters', JSON.stringify(rec.confidenceBreakdown) === JSON.stringify(row.confluence_breakdown));
  if (instrument === 'GBP/JPY') console.log(`\n--- Telegram alert as sent ---\n${msg}\n`);

  // Same hour again, after a signal already exists for that trigger candle.
  existingSmcSignal = true;
  await runEngine();
  check('not issued twice for the same trigger candle', inserts.filter(r => r.instrument === instrument).length === 0);

  // One hour later the setup is gone (unless a new trigger happened to close).
  existingSmcSignal = false;
  nowEpoch += 3600;
  await runEngine();
  const later = inserts.filter(r => r.instrument === instrument);
  const expectLater = researchSetups(s, PRIMARY).some(x => x.trigClose === nowEpoch - 5);
  check('next hour: no signal unless a new trigger closed', (later.length === 1) === expectLater, `saved ${later.length}`);
}

// Silver and US100: live (not shadow) signals from the main path, matching the web app.
{
  const s = series.get('XAG/USD')!;
  const closes = s.h4.map(c => c.epoch + 14400).filter(t => evaluateXagDonchian(s.h4.filter(c => c.epoch + 14400 <= t), t + 5));
  nowEpoch = closes[Math.floor(closes.length / 2)] + 5;
  console.log(`
===== XAG/USD at ${new Date(nowEpoch * 1000).toISOString()} =====`);
  const body = await runEngine();
  const saved = inserts.filter(r => r.instrument === 'XAG/USD');
  const gem = evaluateXagDonchian(candlesAt('XAG/USD', 14400, 250), nowEpoch)!;
  check('engine saved one live silver Donchian signal', saved.length === 1 && saved[0].setup_type === 'gem_xag_donchian' && !saved[0].shadow, `saved ${saved.length}; errors ${JSON.stringify(body.errors ?? [])}`);
  const row = saved[0] ?? {};
  check('levels equal the shared gem', row.entry_price === gem.entry && row.stop_loss === gem.stopLoss && row.take_profit_2 === gem.takeProfit);
  check('it went through the arbiter', arbitrations > 0);
  const msg = telegram.find(m => m.includes('XAG/USD')) ?? '';
  check('alert sent, not marked shadow', msg.length > 0 && !msg.includes('SHADOW'));
  const h4 = candlesAt('XAG/USD', 14400, 300);
  const plan = generateTradePlan('XAG/USD', candlesAt('XAG/USD', 86400, 200), h4, candlesAt('XAG/USD', 3600, 200), h4[h4.length - 2].close, null, nowEpoch);
  check('web app recommendation equals the engine signal', plan.recommendation.setupType === 'gem_xag_donchian' && plan.recommendation.risk.entry === row.entry_price && plan.recommendation.risk.stopLoss === row.stop_loss,
    `app: ${plan.recommendation.setupType} ${plan.recommendation.direction} entry ${plan.recommendation.risk.entry}`);
}
{
  const s = series.get('US100')!;
  const all = researchSetups(s, PRIMARY);
  const pick = all[Math.floor(all.length / 2)];
  nowEpoch = pick.trigClose + 5;
  console.log(`
===== US100 at ${new Date(nowEpoch * 1000).toISOString()} =====`);
  const body = await runEngine();
  const saved = inserts.filter(r => r.instrument === 'US100');
  const mod = evaluateSmcChochFvg('US100', candlesAt('US100', 14400, 100), candlesAt('US100', 3600, 200), nowEpoch).setup!;
  check('engine saved one live US100 SMC signal', saved.length === 1 && saved[0].setup_type === SMC_US100_SETUP_TYPE && !saved[0].shadow, `saved ${saved.length}; errors ${JSON.stringify(body.errors ?? [])}`);
  const row = saved[0] ?? {};
  check('levels equal the shared module', row.entry_price === mod.entry && row.stop_loss === mod.stopLoss && row.take_profit_2 === mod.takeProfit);
  const msg = telegram.find(m => m.includes('US100')) ?? '';
  check('alert sent although confidence is under the user threshold, not marked shadow', msg.length > 0 && !msg.includes('SHADOW'));
  const h4 = candlesAt('US100', 14400, 300);
  const plan = generateTradePlan('US100', candlesAt('US100', 86400, 200), h4, candlesAt('US100', 3600, 200), h4[h4.length - 2].close, null, nowEpoch);
  check('web app recommendation equals the engine signal', plan.recommendation.setupType === SMC_US100_SETUP_TYPE && plan.recommendation.risk.entry === row.entry_price && plan.recommendation.risk.stopLoss === row.stop_loss,
    `app: ${plan.recommendation.setupType} ${plan.recommendation.direction} entry ${plan.recommendation.risk.entry}`);
  console.log(`
--- US100 Telegram alert as sent ---
${msg}
`);
}

// Synthetics still go through the existing engine path.
nowEpoch = researchSetups(series.get('GBP/JPY')!, PRIMARY)[3].trigClose + 5;
existingSmcSignal = false;
const body = await runEngine();
const synth = inserts.filter(r => ['V10', 'V25', 'V50', 'V75', 'V100', 'BOOM1000'].includes(r.instrument));
check('V50 and V100 are no longer scanned', !synth.some(r => r.instrument === 'V50' || r.instrument === 'V100'));
console.log('\n===== Synthetics =====');
check('synthetic path runs without errors', !(body.errors ?? []).length, JSON.stringify(body.errors ?? []));
check('no synthetic signal uses the SMC strategy', synth.every(r => r.setup_type !== SMC_SETUP_TYPE), `${synth.length} synthetic signals saved this run`);

console.log(`\n${checks.filter(Boolean).length} of ${checks.length} checks passed`);
process.exit(checks.every(Boolean) ? 0 : 1);
