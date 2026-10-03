import { analyzeMarket } from '../_shared/analysis/marketAnalysis.ts';
import type { AnalysisResult } from '../_shared/analysis/marketAnalysis.ts';
import { computeSwingConfidence } from '../_shared/analysis/swingConfidence.ts';
import type { TradingInstrument, TrendDirection } from '../_shared/analysis/core.ts';
import { findOrderBlocks as findOrderBlocksShared, findFairValueGaps as findFairValueGapsShared, analyzeAsianSession } from '../_shared/analysis/smcAnalysis.ts';
import type { OrderBlock, FairValueGap } from '../_shared/analysis/smcAnalysis.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// =================== DERIV CONFIG ===================
// Mirrors src/lib/deriv.ts — the public market-data endpoint first, legacy
// app_id endpoints as fallbacks. The engine previously used only the legacy
// ws.derivws.com endpoint, which went dark on 2026-09-20 while the public one
// stayed up, so the engine lost data while the app kept working.
const DERIV_APP_ID = Deno.env.get('DERIV_APP_ID') ?? '33WEdZurDjmrV0NAA8yZC';

// --- Telegram alert helpers (mirrors src/hooks/useTelegramAlert.ts formatting) ---
const escapeMd = (text: string): string => text.replace(/[_*`\[\]]/g, '');

const extractStructuralGate = (reasoning: string): string => {
  const triggers: string[] = [];
  if (/BOS confirmed/i.test(reasoning)) triggers.push('BOS ✅');
  if (/CHoCH confirmed/i.test(reasoning)) triggers.push('CHoCH ✅');
  if (/Liquidity sweep.*confirmed/i.test(reasoning)) triggers.push('Liq Sweep ✅');
  if (/HH.HL structure/i.test(reasoning)) triggers.push('HH/HL Structure ✅');
  if (/LH.LL structure/i.test(reasoning)) triggers.push('LH/LL Structure ✅');
  if (/unmitigated OB/i.test(reasoning)) {
    const match = reasoning.match(/(\d+)\s*unmitigated OB/i);
    triggers.push(`${match ? match[1] : ''} OBs ✅`);
  }
  return triggers.length > 0 ? triggers.join(' | ') : 'Structure Aligned ✅';
};

async function sendTelegramSignalAlert(
  supabase: ReturnType<typeof createClient>,
  settings: Record<string, any>,
  saved: Record<string, any>,
) {
  if (!settings.telegram_enabled || !settings.telegram_bot_token || !settings.telegram_chat_id) return;

  const direction = saved.direction === 'bullish' ? '🟢 LONG' : '🔴 SHORT';
  const rr = saved.entry_price && saved.stop_loss && saved.take_profit_2
    ? Math.abs(saved.take_profit_2 - saved.entry_price) / Math.abs(saved.entry_price - saved.stop_loss)
    : 0;
  const gate = extractStructuralGate(saved.reasoning || '');

  const message = [
    `📊 *FX Swing Bot Signal*`,
    ``,
    `🏷 *${saved.instrument}* — ${direction}`,
    `📈 Type: ${saved.trade_type.toUpperCase()}`,
    `🎯 Confidence: ${saved.confidence}%`,
    ``,
    `▶️ Entry: \`${saved.entry_price}\``,
    `🛑 Stop Loss: \`${saved.stop_loss}\``,
    `✅ TP1: \`${saved.take_profit_1}\``,
    `✅ TP2: \`${saved.take_profit_2}\``,
    `✅ TP3: \`${saved.take_profit_3}\``,
    `📐 R:R: \`${rr.toFixed(1)}\``,
    ``,
    `🔒 Gate: ${gate}`,
    ``,
    saved.reasoning ? `💡 ${escapeMd(saved.reasoning)}` : '',
    ``,
    `🕐 ${new Date(saved.generated_at).toUTCString()}`,
    `🆔 \`${String(saved.id).slice(0, 8)}\``,
  ].filter(Boolean).join('\n');

  try {
    await supabase.functions.invoke('send-telegram', {
      body: {
        action: 'send',
        bot_token: settings.telegram_bot_token,
        chat_id: settings.telegram_chat_id,
        message,
      },
    });
  } catch (err) {
    console.error(`[Telegram] Failed to send alert for ${saved.instrument}:`, err);
  }
}
const DERIV_WS_URLS = [
  'wss://api.derivws.com/trading/v1/options/ws/public',
  `wss://ws.derivws.com/websockets/v3?app_id=${DERIV_APP_ID}`,
  `wss://ws.derivws.com/websockets/v3?app_id=1089`,
  `wss://ws.binaryws.com/websockets/v3?app_id=1089`,
];

// Try each endpoint in order; resolve on the first that answers.
async function derivRequest(payload: Record<string, unknown>, timeoutMs: number): Promise<any> {
  let lastError: Error = new Error('no endpoint attempted');
  for (const url of DERIV_WS_URLS) {
    try {
      return await new Promise<any>((resolve, reject) => {
        const ws = new WebSocket(url);
        const timeout = setTimeout(() => { try { ws.close(); } catch { /* noop */ } reject(new Error('Timeout')); }, timeoutMs);
        ws.onopen = () => ws.send(JSON.stringify(payload));
        ws.onmessage = (event: MessageEvent) => {
          clearTimeout(timeout);
          let data: any;
          try { data = JSON.parse(event.data); } catch (e) { try { ws.close(); } catch { /* noop */ } reject(e as Error); return; }
          try { ws.close(); } catch { /* noop */ }
          if (data.error) { reject(new Error(data.error.message)); return; }
          resolve(data);
        };
        ws.onerror = () => { clearTimeout(timeout); reject(new Error('WebSocket error')); };
      });
    } catch (e) {
      lastError = e as Error;
    }
  }
  throw lastError;
}

const DERIV_SYMBOL_MAP: Record<string, string> = {
  'EUR/USD': 'frxEURUSD', 'GBP/USD': 'frxGBPUSD', 'USD/JPY': 'frxUSDJPY',
  'AUD/USD': 'frxAUDUSD', 'GBP/JPY': 'frxGBPJPY', 'XAU/USD': 'frxXAUUSD',
  'V10': 'R_10', 'V25': 'R_25', 'V50': 'R_50', 'V75': 'R_75', 'V100': 'R_100', 'BOOM1000': 'BOOM1000',
};

const SYNTHETIC_INDICES = ['V10', 'V25', 'V50', 'V75', 'V100', 'BOOM1000'];
const FOREX_INSTRUMENTS = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'GBP/JPY', 'XAU/USD'];
const ALL_INSTRUMENTS = [...FOREX_INSTRUMENTS, ...SYNTHETIC_INDICES];

const isSyntheticIndex = (instrument: string) => SYNTHETIC_INDICES.includes(instrument);
const getPipValue = (instrument: string) => {
  if (isSyntheticIndex(instrument)) return 0.01;
  if (instrument === 'USD/JPY' || instrument === 'GBP/JPY') return 0.01;
  return 0.0001;
};
const getDecimals = (instrument: string) => {
  if (isSyntheticIndex(instrument) || instrument.includes('JPY') || instrument === 'XAU/USD') return 2;
  return 4;
};

interface CandleData { open: number; high: number; low: number; close: number; epoch: number; }

// =================== DERIV DATA FETCHING ===================
async function fetchCandles(symbol: string, granularity: number, count: number): Promise<CandleData[]> {
  const data = await derivRequest({
    ticks_history: symbol, adjust_start_time: 1,
    count, end: 'latest', granularity, style: 'candles',
  }, 15000);
  if (!data.candles) throw new Error('No candles returned');
  return data.candles.map((c: any) => ({
    open: c.open, high: c.high, low: c.low, close: c.close, epoch: c.epoch,
  }));
}

// =================== TECHNICAL INDICATORS ===================
function calculateSMA(data: number[], period: number): number {
  if (data.length < period) return 0;
  return data.slice(-period).reduce((s, v) => s + v, 0) / period;
}

function calculateEMA(data: number[], period: number): number[] {
  if (data.length < period) return [];
  const m = 2 / (period + 1);
  const ema: number[] = [data.slice(0, period).reduce((s, v) => s + v, 0) / period];
  for (let i = period; i < data.length; i++) ema.push((data[i] - ema[ema.length - 1]) * m + ema[ema.length - 1]);
  return ema;
}

function calculateRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain += change; else avgLoss += Math.abs(change);
  }
  avgGain /= period; avgLoss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (change < 0 ? Math.abs(change) : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

function calculateMACD(closes: number[]) {
  const fast = calculateEMA(closes, 12), slow = calculateEMA(closes, 26);
  if (!fast.length || !slow.length) return { histogram: 0, signal: 'neutral' as const };
  const offset = fast.length - slow.length;
  const macdVals = slow.map((_, i) => fast[i + offset] - slow[i]);
  const sig = calculateEMA(macdVals, 9);
  const macdLine = macdVals[macdVals.length - 1] || 0;
  const signalLine = sig[sig.length - 1] || 0;
  const histogram = macdLine - signalLine;
  return { histogram, signal: histogram > 0 && macdLine > 0 ? 'bullish' as const : histogram < 0 && macdLine < 0 ? 'bearish' as const : 'neutral' as const };
}

function calculateATR(candles: CandleData[], period = 14): number {
  if (candles.length < period + 1) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    trs.push(Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - candles[i - 1].close), Math.abs(candles[i].low - candles[i - 1].close)));
  }
  return trs.slice(-period).reduce((s, v) => s + v, 0) / period;
}

function analyzeMovingAverages(closes: number[]) {
  const ma20 = calculateSMA(closes, 20), ma50 = calculateSMA(closes, 50), ma200 = calculateSMA(closes, 200);
  const trend = ma20 > ma50 && ma50 > ma200 ? 'bullish' : ma20 < ma50 && ma50 < ma200 ? 'bearish' : 'neutral';
  return { ma20, ma50, ma200, trend };
}

// =================== MARKET STRUCTURE ===================
function findSwingPoints(candles: CandleData[], lookback = 3) {
  const points: { price: number; type: 'high' | 'low'; index: number }[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isHigh = true, isLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i - j].high >= candles[i].high || candles[i + j].high >= candles[i].high) isHigh = false;
      if (candles[i - j].low <= candles[i].low || candles[i + j].low <= candles[i].low) isLow = false;
    }
    if (isHigh) points.push({ price: candles[i].high, type: 'high', index: i });
    if (isLow) points.push({ price: candles[i].low, type: 'low', index: i });
  }
  return points;
}

function analyzeStructure(candles: CandleData[]) {
  const swings = findSwingPoints(candles);
  const highs = swings.filter(s => s.type === 'high').slice(-4);
  const lows = swings.filter(s => s.type === 'low').slice(-4);
  if (highs.length < 2 || lows.length < 2) return { trend: 'ranging' as const, structure: 'ranging' as const, lastHigh: candles[candles.length - 1].high, lastLow: candles[candles.length - 1].low, bos: null as string | null, choch: null as string | null };
  
  const lastH = highs[highs.length - 1].price, prevH = highs[highs.length - 2].price;
  const lastL = lows[lows.length - 1].price, prevL = lows[lows.length - 2].price;
  const hh = lastH > prevH, hl = lastL > prevL, lh = lastH < prevH, ll = lastL < prevL;
  
  let trend: 'bullish' | 'bearish' | 'ranging' = 'ranging';
  let structure: 'HH_HL' | 'LH_LL' | 'ranging' = 'ranging';
  if (hh && hl) { trend = 'bullish'; structure = 'HH_HL'; }
  else if (lh && ll) { trend = 'bearish'; structure = 'LH_LL'; }
  
  const price = candles[candles.length - 1].close;
  let bos: string | null = null;
  if (price > lastH && trend === 'bearish') bos = 'bullish';
  else if (price < lastL && trend === 'bullish') bos = 'bearish';
  
  let choch: string | null = null;
  if (!bos && highs.length >= 3 && lows.length >= 3) {
    if ((trend === 'bearish' || structure === 'LH_LL') && lastL > prevL && lastH > prevH) {
      choch = 'bullish';
    }
    if ((trend === 'bullish' || structure === 'HH_HL') && lastH < prevH && lastL < prevL) {
      choch = 'bearish';
    }
  }
  
  return { trend, structure, lastHigh: lastH, lastLow: lastL, bos, choch };
}

function findOrderBlocks(candles: CandleData[]) {
  const obs: { type: 'bullish' | 'bearish'; high: number; low: number; mitigated: boolean }[] = [];
  for (let i = 2; i < candles.length - 1; i++) {
    const curr = candles[i], next = candles[i + 1];
    if (curr.close < curr.open && next.close > next.open && next.close > curr.high) {
      let mitigated = false;
      for (let j = i + 2; j < candles.length; j++) if (candles[j].low <= curr.high && candles[j].low >= curr.low) { mitigated = true; break; }
      obs.push({ type: 'bullish', high: curr.high, low: curr.low, mitigated });
    }
    if (curr.close > curr.open && next.close < next.open && next.close < curr.low) {
      let mitigated = false;
      for (let j = i + 2; j < candles.length; j++) if (candles[j].high >= curr.low && candles[j].high <= curr.high) { mitigated = true; break; }
      obs.push({ type: 'bearish', high: curr.high, low: curr.low, mitigated });
    }
  }
  return obs.slice(-6);
}

function findFVGs(candles: CandleData[]) {
  const fvgs: { type: 'bullish' | 'bearish'; high: number; low: number }[] = [];
  for (let i = 2; i < candles.length; i++) {
    if (candles[i].low > candles[i - 2].high) {
      let filled = false;
      for (let j = i + 1; j < candles.length; j++) if (candles[j].low <= candles[i].low) { filled = true; break; }
      if (!filled) fvgs.push({ type: 'bullish', high: candles[i].low, low: candles[i - 2].high });
    }
    if (candles[i].high < candles[i - 2].low) {
      let filled = false;
      for (let j = i + 1; j < candles.length; j++) if (candles[j].high >= candles[i].high) { filled = true; break; }
      if (!filled) fvgs.push({ type: 'bearish', high: candles[i - 2].low, low: candles[i].high });
    }
  }
  return fvgs.slice(-4);
}

// =================== VOLUME ANALYSIS ===================
function calculateOBV(candles: CandleData[]) {
  if (candles.length < 10) return { trend: 'neutral' as const, divergence: 'none' as const };
  const obv: number[] = [0];
  for (let i = 1; i < candles.length; i++) {
    const vol = (candles[i].high - candles[i].low) * 100000;
    if (candles[i].close > candles[i - 1].close) obv.push(obv[obv.length - 1] + vol);
    else if (candles[i].close < candles[i - 1].close) obv.push(obv[obv.length - 1] - vol);
    else obv.push(obv[obv.length - 1]);
  }
  const recent = obv.slice(-10);
  const sma = recent.reduce((s, v) => s + v, 0) / recent.length;
  const trend = obv[obv.length - 1] > sma * 1.02 ? 'bullish' : obv[obv.length - 1] < sma * 0.98 ? 'bearish' : 'neutral';
  
  let divergence: 'bullish_divergence' | 'bearish_divergence' | 'none' = 'none';
  if (candles.length >= 20) {
    const priceUp = candles[candles.length - 1].close > candles[candles.length - 20].close;
    const obvUp = obv[obv.length - 1] > obv[obv.length - 20];
    if (priceUp && !obvUp) divergence = 'bearish_divergence';
    if (!priceUp && obvUp) divergence = 'bullish_divergence';
  }
  return { trend, divergence };
}

// =================== LIQUIDITY SWEEP DETECTION ===================
function detectLiquiditySweep(candles: CandleData[], tolerance = 0.0002): { detected: boolean; direction: 'bullish' | 'bearish' | null } {
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const recentRange = 10;
  
  for (let i = 0; i < lows.length - 2; i++) {
    for (let j = i + 1; j < lows.length - 1; j++) {
      if (Math.abs(lows[i] - lows[j]) < tolerance * lows[i]) {
        const eqLow = (lows[i] + lows[j]) / 2;
        for (let k = Math.max(j + 1, candles.length - recentRange); k < candles.length; k++) {
          if (candles[k].low < eqLow * (1 - tolerance) && candles[k].close > eqLow) {
            return { detected: true, direction: 'bullish' };
          }
        }
      }
    }
  }
  
  for (let i = 0; i < highs.length - 2; i++) {
    for (let j = i + 1; j < highs.length - 1; j++) {
      if (Math.abs(highs[i] - highs[j]) < tolerance * highs[i]) {
        const eqHigh = (highs[i] + highs[j]) / 2;
        for (let k = Math.max(j + 1, candles.length - recentRange); k < candles.length; k++) {
          if (candles[k].high > eqHigh * (1 + tolerance) && candles[k].close < eqHigh) {
            return { detected: true, direction: 'bearish' };
          }
        }
      }
    }
  }
  
  return { detected: false, direction: null };
}

// =================== SPIKE DETECTION (Synthetics) ===================
function detectSpike(candles: CandleData[]): boolean {
  if (candles.length < 5) return false;
  const last = candles[candles.length - 1];
  const avgRange = candles.slice(-20).reduce((s, c) => s + (c.high - c.low), 0) / 20;
  const lastRange = last.high - last.low;
  return lastRange > avgRange * 3;
}

// =================== SYNTHETIC INDEX BEHAVIOR PROFILES ===================
interface SyntheticProfileEdge {
  volatilityTier: number;
  structureClarity: number;
  slAtrMultiplier: number;
  volumeExpansionMult: number;
  maxConfluenceScore: number;
  minScoreDifference: number;
  consolidationBeforeBreakout: boolean;
  meanReversionAtExtremes: boolean;
  liquiditySweepWeightBoost: number;
  behaviorNotes: string[];
}

const SYNTH_PROFILES: Record<string, SyntheticProfileEdge> = {
  V10: { volatilityTier: 1, structureClarity: 5, slAtrMultiplier: 1.5, volumeExpansionMult: 0.5, maxConfluenceScore: 44, minScoreDifference: 2, consolidationBeforeBreakout: false, meanReversionAtExtremes: false, liquiditySweepWeightBoost: 1.5, behaviorNotes: ['Cleanest structure — HH/HL hold reliably', 'Minimal false breaks'] },
  V25: { volatilityTier: 2, structureClarity: 5, slAtrMultiplier: 1.8, volumeExpansionMult: 0.5, maxConfluenceScore: 44, minScoreDifference: 2, consolidationBeforeBreakout: false, meanReversionAtExtremes: false, liquiditySweepWeightBoost: 1.5, behaviorNotes: ['Excellent structure clarity', 'FVGs between OBs especially reliable'] },
  V50: { volatilityTier: 3, structureClarity: 4, slAtrMultiplier: 2.0, volumeExpansionMult: 0.55, maxConfluenceScore: 44, minScoreDifference: 3, consolidationBeforeBreakout: true, meanReversionAtExtremes: false, liquiditySweepWeightBoost: 1.3, behaviorNotes: ['Strong displacement candles define OB boundaries', 'Consolidation before explosive breaks'] },
  V75: { volatilityTier: 4, structureClarity: 3, slAtrMultiplier: 2.5, volumeExpansionMult: 0.6, maxConfluenceScore: 44, minScoreDifference: 3, consolidationBeforeBreakout: false, meanReversionAtExtremes: false, liquiditySweepWeightBoost: 1.5, behaviorNotes: ['Deep 50-61.8% retracements', 'Frequent liquidity sweeps', 'Strong 2-6hr trend phases'] },
  V100: { volatilityTier: 5, structureClarity: 2, slAtrMultiplier: 3.0, volumeExpansionMult: 0.6, maxConfluenceScore: 44, minScoreDifference: 4, consolidationBeforeBreakout: false, meanReversionAtExtremes: true, liquiditySweepWeightBoost: 1.5, behaviorNotes: ['BOS/CHoCH form very fast', 'Large FVGs partially fill', 'Strong mean reversion at extremes'] },
  BOOM1000: { volatilityTier: 4, structureClarity: 3, slAtrMultiplier: 2.5, volumeExpansionMult: 0.6, maxConfluenceScore: 44, minScoreDifference: 3, consolidationBeforeBreakout: false, meanReversionAtExtremes: false, liquiditySweepWeightBoost: 1.3, behaviorNotes: ['Spike-driven structure', 'Demand zone retests after bearish candles'] },
};

function getSynthProfile(instrument: string): SyntheticProfileEdge | null {
  return SYNTH_PROFILES[instrument] ?? null;
}

// =================== KILL ZONE CHECK ===================
function isInForexKillZone(): boolean {
  const now = new Date();
  const hour = now.getUTCHours();
  return (hour >= 7 && hour < 9) || (hour >= 12 && hour < 14);
}

// =================== ADVANCED SMC CONCEPTS ===================

// ===== BREAKER BLOCKS =====
// A Breaker Block is an Order Block that was violated (price closed through it).
// The broken OB flips polarity: failed bullish OB becomes bearish breaker, and vice versa.
interface BreakerBlock {
  type: 'bullish' | 'bearish'; // New polarity after flip
  high: number;
  low: number;
  qualityScore: number;
}

function findBreakerBlocks(candles: CandleData[]): BreakerBlock[] {
  const breakers: BreakerBlock[] = [];
  const totalCandles = candles.length;

  for (let i = 2; i < candles.length - 1; i++) {
    const current = candles[i];
    const next = candles[i + 1];

    // Detect original bullish OB candidate
    if (current.close < current.open && next.close > next.open && next.close > current.high) {
      // Check if this bullish OB was later violated (price closed below its low)
      for (let j = i + 2; j < candles.length; j++) {
        if (candles[j].close < current.low) {
          const recency = Math.max(0, Math.min(1, j / (totalCandles - 1)));
          let retested = false;
          for (let k = j + 1; k < candles.length; k++) {
            if (candles[k].high >= current.low && candles[k].high <= current.high && candles[k].close < current.low) {
              retested = true;
              break;
            }
          }
          breakers.push({
            type: 'bearish', // Bullish OB failed → bearish breaker
            high: current.high,
            low: current.low,
            qualityScore: Math.round(recency * 50 + (retested ? 0 : 30) + 20),
          });
          break;
        }
      }
    }

    // Detect original bearish OB candidate
    if (current.close > current.open && next.close < next.open && next.close < current.low) {
      for (let j = i + 2; j < candles.length; j++) {
        if (candles[j].close > current.high) {
          const recency = Math.max(0, Math.min(1, j / (totalCandles - 1)));
          let retested = false;
          for (let k = j + 1; k < candles.length; k++) {
            if (candles[k].low <= current.high && candles[k].low >= current.low && candles[k].close > current.high) {
              retested = true;
              break;
            }
          }
          breakers.push({
            type: 'bullish', // Bearish OB failed → bullish breaker
            high: current.high,
            low: current.low,
            qualityScore: Math.round(recency * 50 + (retested ? 0 : 30) + 20),
          });
          break;
        }
      }
    }
  }

  return breakers.sort((a, b) => b.qualityScore - a.qualityScore).slice(0, 4);
}

// ===== PREMIUM / DISCOUNT ZONES =====
interface PremiumDiscountResult {
  currentZone: 'premium' | 'discount' | 'equilibrium';
  zoneAlignment: boolean; // true if zone matches trade direction
  equilibrium: number;
}

function analyzePremiumDiscount(
  swingHigh: number,
  swingLow: number,
  currentPrice: number,
  direction: 'bullish' | 'bearish'
): PremiumDiscountResult {
  const range = swingHigh - swingLow;
  const equilibrium = swingLow + range * 0.5;
  const premiumStart = swingLow + range * 0.75;
  const discountEnd = swingLow + range * 0.25;

  let currentZone: 'premium' | 'discount' | 'equilibrium';
  if (currentPrice >= premiumStart) currentZone = 'premium';
  else if (currentPrice <= discountEnd) currentZone = 'discount';
  else currentZone = 'equilibrium';

  const zoneAlignment =
    (direction === 'bullish' && currentZone === 'discount') ||
    (direction === 'bearish' && currentZone === 'premium');

  return { currentZone, zoneAlignment, equilibrium };
}

// ===== CONSEQUENT ENCROACHMENT (CE) =====
// The 50% midpoint of an FVG — a key retest/entry level.
interface ConsequentEncroachment {
  fvgType: 'bullish' | 'bearish';
  cePrice: number;
  priceNearCE: boolean;
}

function findConsequentEncroachments(
  fvgs: { type: 'bullish' | 'bearish'; high: number; low: number }[],
  currentPrice: number,
  atr: number
): ConsequentEncroachment[] {
  return fvgs.map(fvg => {
    const cePrice = (fvg.high + fvg.low) / 2;
    const proximity = Math.abs(currentPrice - cePrice);
    return {
      fvgType: fvg.type,
      cePrice,
      priceNearCE: proximity <= atr * 0.5,
    };
  });
}

// ===== INDUCEMENT DETECTION =====
// False breakouts of swing points that quickly reverse, trapping retail traders.
interface InducementResult {
  detected: boolean;
  direction: 'bullish' | 'bearish' | null; // True direction after inducement
  type: string | null;
}

function detectInducement(candles: CandleData[], lookback = 15): InducementResult {
  const swings = findSwingPoints(candles, 3);
  const startIdx = candles.length - lookback;
  const recentCandles = candles.slice(-lookback);

  // False breakout HIGH: retail buys breakout → SM sells → bearish
  const recentHighs = swings.filter(s => s.type === 'high' && s.index < startIdx).slice(-3);
  for (const sh of recentHighs) {
    for (let i = 0; i < recentCandles.length; i++) {
      const c = recentCandles[i];
      if (c.high > sh.price && c.close < sh.price && c.close < c.open) {
        return { detected: true, type: 'false_breakout_high', direction: 'bearish' };
      }
    }
  }

  // False breakout LOW: retail sells breakdown → SM buys → bullish
  const recentLows = swings.filter(s => s.type === 'low' && s.index < startIdx).slice(-3);
  for (const sl of recentLows) {
    for (let i = 0; i < recentCandles.length; i++) {
      const c = recentCandles[i];
      if (c.low < sl.price && c.close > sl.price && c.close > c.open) {
        return { detected: true, type: 'false_breakout_low', direction: 'bullish' };
      }
    }
  }

  return { detected: false, type: null, direction: null };
}

// ===== DISPLACEMENT DETECTION =====
// Strong impulsive moves: large-bodied candles with minimal wicks.
interface DisplacementResult {
  detected: boolean;
  direction: 'bullish' | 'bearish' | null;
  strength: number; // 0-100
}

function detectDisplacement(candles: CandleData[], lookback = 10): DisplacementResult {
  const recent = candles.slice(-lookback);
  const avgBody = candles.slice(-50).reduce((s, c) => s + Math.abs(c.close - c.open), 0) / Math.min(50, candles.length);

  let bestStrength = 0;
  let bestDir: 'bullish' | 'bearish' | null = null;

  for (let i = 0; i < recent.length; i++) {
    const c = recent[i];
    const body = Math.abs(c.close - c.open);
    const totalRange = c.high - c.low;
    const wickRatio = totalRange > 0 ? body / totalRange : 0;

    // Displacement: body >2x average AND wicks small (>65% body ratio)
    if (body > avgBody * 2 && wickRatio > 0.65) {
      const strength = Math.min(Math.round((body / avgBody) * 25 + wickRatio * 50), 100);
      if (strength > bestStrength) {
        bestStrength = strength;
        bestDir = c.close > c.open ? 'bullish' : 'bearish';
      }
    }
  }

  return { detected: bestStrength > 0, direction: bestDir, strength: bestStrength };
}

// =================== SPREAD CONFIG ===================
// Mirror of src/lib/spreadConfig.ts. Typical spreads in ABSOLUTE price units.
// Symmetric half-spread convention: ask = quote + spread/2, bid = quote - spread/2.
const SPREAD_TABLE: Record<string, number> = {
  'EUR/USD': 0.00008,
  'GBP/USD': 0.00012,
  'AUD/USD': 0.00011,
  'USD/JPY': 0.010,
  'GBP/JPY': 0.025,
  'XAU/USD': 0.30,
  'V10': 0.02,
  'V25': 0.10,
  'V50': 0.60,
  'V75': 2.50,
  'V100': 1.20,
  'BOOM1000': 0.60,
};
const DEFAULT_SPREAD = 0.0001;

function getSpread(instrument: string): number {
  return SPREAD_TABLE[instrument] ?? DEFAULT_SPREAD;
}

/** +half spread for longs, -half for shorts. */
function spreadShift(instrument: string, direction: 'bullish' | 'bearish'): number {
  const half = getSpread(instrument) / 2;
  return direction === 'bullish' ? half : -half;
}

function effectiveEntry(instrument: string, direction: 'bullish' | 'bearish', entry: number): number {
  return entry + spreadShift(instrument, direction);
}

// ---- Volatility-scaled spread (synthetics only) ----
// Mirror of src/lib/spreadConfig.ts. Bands over the ATR percentile:
//   <50 -> x1.0, 50-80 -> x1.4, 80-95 -> x2.0, >=95 -> x3.0
const VOLATILITY_BANDS: Array<{ minPercentile: number; multiplier: number }> = [
  { minPercentile: 95, multiplier: 3.0 },
  { minPercentile: 80, multiplier: 2.0 },
  { minPercentile: 50, multiplier: 1.4 },
  { minPercentile: 0, multiplier: 1.0 },
];

function isVolatilityScaledInstrument(instrument: string): boolean {
  return /^(V\d+|BOOM|CRASH)/i.test(instrument);
}

function getSpreadMultiplier(atrPercentile?: number | null): number {
  if (atrPercentile === null || atrPercentile === undefined || !isFinite(atrPercentile)) return 1;
  return VOLATILITY_BANDS.find(b => atrPercentile >= b.minPercentile)?.multiplier ?? 1;
}

function appliedSpreadMultiplier(instrument: string, atrPercentile?: number | null): number {
  return isVolatilityScaledInstrument(instrument) ? getSpreadMultiplier(atrPercentile) : 1;
}

function getVolatilityAdjustedSpread(instrument: string, atrPercentile?: number | null): number {
  return getSpread(instrument) * appliedSpreadMultiplier(instrument, atrPercentile);
}

function effectiveEntryWithSpread(direction: 'bullish' | 'bearish', entry: number, spread: number): number {
  return entry + (direction === 'bullish' ? spread / 2 : -spread / 2);
}

/**
 * Percentile rank (0-100) of the latest ATR against its trailing distribution.
 * Reuses candles already fetched for analysis.
 */
function computeAtrPercentile(candles: CandleData[], period = 14, lookback = 200): number | null {
  if (!candles || candles.length < period + 2) return null;
  const tr: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prevClose = candles[i - 1].close;
    tr.push(Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - prevClose),
      Math.abs(candles[i].low - prevClose),
    ));
  }
  if (tr.length < period) return null;
  const atrs: number[] = [];
  let sum = 0;
  for (let i = 0; i < tr.length; i++) {
    sum += tr[i];
    if (i >= period) sum -= tr[i - period];
    if (i >= period - 1) atrs.push(sum / period);
  }
  if (atrs.length < 20) return null;
  const window = atrs.slice(-lookback);
  const current = window[window.length - 1];
  return (window.filter(v => v < current).length / window.length) * 100;
}

// =================== SIGNAL GENERATION ===================
interface SignalOutput {
  instrument: string;
  direction: 'bullish' | 'bearish';
  entry_price: number;
  effective_entry: number;
  spread_applied: number;
  atr_percentile_at_entry: number | null;
  spread_multiplier_applied: number;

  stop_loss: number;
  take_profit_1: number;
  take_profit_2: number;
  take_profit_3: number;
  risk_reward_ratio: number;
  confidence: number;
  trade_type: 'swing' | 'day';
  setup_type: string;
  reasoning: string;
  confluence_breakdown: { label: string; value: string; weight: number; maxWeight: number; contributing: boolean }[];
  confluence_score_total: number;
  confluence_score_max: number;
}


function generateSignal(
  instrument: string,
  dailyCandles: CandleData[],
  fourHourCandles: CandleData[],
  fifteenMinCandles: CandleData[],
  oneHourCandles: CandleData[],
  settings: { forex_min_rr: number; synthetic_min_rr: number; ignore_counter_trend: boolean }
): SignalOutput | null {
  const isSynthetic = isSyntheticIndex(instrument);
  const synthProfile = getSynthProfile(instrument);
  const pip = getPipValue(instrument);
  const closes4h = fourHourCandles.map(c => c.close);
  const closesDaily = dailyCandles.map(c => c.close);
  const closes1h = oneHourCandles.map(c => c.close);
  
  // Daily bias
  const dailyStruct = analyzeStructure(dailyCandles);
  const fourHourStruct = analyzeStructure(fourHourCandles);
  const oneHourStruct = analyzeStructure(oneHourCandles);
  const dailyMAs = analyzeMovingAverages(closesDaily);
  const dailyRSI = calculateRSI(closesDaily);
  const fourHourRSI = calculateRSI(closes4h);
  const oneHourRSI = calculateRSI(closes1h);
  const dailyMACD = calculateMACD(closesDaily);
  const fourHourMACD = calculateMACD(closes4h);
  const oneHourMACD = calculateMACD(closes1h);
  const fourHourATR = calculateATR(fourHourCandles);
  const obs = findOrderBlocks(fourHourCandles);
  const obs1h = findOrderBlocks(oneHourCandles);
  const fvgs = findFVGs(fourHourCandles);
  const fvgs1h = findFVGs(oneHourCandles);
  const obv4h = calculateOBV(fourHourCandles);
  const obv1h = calculateOBV(oneHourCandles);
  const liqSweep4H = detectLiquiditySweep(fourHourCandles);
  const liqSweep1H = detectLiquiditySweep(oneHourCandles);
  const liqSweepDaily = detectLiquiditySweep(dailyCandles);
  
  // Advanced SMC analysis
  const breakers4H = findBreakerBlocks(fourHourCandles);
  const breakersDaily = findBreakerBlocks(dailyCandles);
  const inducement4H = detectInducement(fourHourCandles);
  const inducementDaily = detectInducement(dailyCandles);
  const displacement4H = detectDisplacement(fourHourCandles);
  const displacementDaily = detectDisplacement(dailyCandles);
  const currentPrice = fourHourCandles[fourHourCandles.length - 1].close;
  const ces = findConsequentEncroachments(fvgs, currentPrice, fourHourATR);
  
  // Synthetic-specific: spike detection
  if (isSynthetic && detectSpike(fourHourCandles)) {
    console.log(`Spike detected on ${instrument}, skipping signal`);
    return null;
  }
  
  // Score direction
  let bullScore = 0, bearScore = 0;
  
  // Daily trend bias (weight: 3)
  if (dailyStruct.trend === 'bullish') bullScore += 3;
  if (dailyStruct.trend === 'bearish') bearScore += 3;
  
  // 4H structure (weight: 3)
  if (fourHourStruct.structure === 'HH_HL') bullScore += 3;
  if (fourHourStruct.structure === 'LH_LL') bearScore += 3;
  
  // 1H structure — early trend shift detection (weight: 2)
  if (oneHourStruct.structure === 'HH_HL') bullScore += 2;
  if (oneHourStruct.structure === 'LH_LL') bearScore += 2;
  
  // 1H BOS — early breakout detection (weight: 2)
  if (oneHourStruct.bos === 'bullish') bullScore += 2;
  if (oneHourStruct.bos === 'bearish') bearScore += 2;
  
  // 1H CHoCH — early reversal detection (weight: 2)
  if (oneHourStruct.choch === 'bullish') bullScore += 2;
  if (oneHourStruct.choch === 'bearish') bearScore += 2;
  
  // BOS 4H (weight: 3)
  if (fourHourStruct.bos === 'bullish') bullScore += 3;
  if (fourHourStruct.bos === 'bearish') bearScore += 3;
  
  // CHoCH 4H (weight: 2)
  if (fourHourStruct.choch === 'bullish') bullScore += 2;
  if (fourHourStruct.choch === 'bearish') bearScore += 2;
  if (dailyStruct.choch === 'bullish') bullScore += 1;
  if (dailyStruct.choch === 'bearish') bearScore += 1;
  
  // Liquidity Sweep (weight: 2)
  if (liqSweep4H.detected && liqSweep4H.direction === 'bullish') bearScore += 2;
  if (liqSweep4H.detected && liqSweep4H.direction === 'bearish') bullScore += 2;
  if (liqSweep1H.detected && liqSweep1H.direction === 'bullish') bearScore += 1;
  if (liqSweep1H.detected && liqSweep1H.direction === 'bearish') bullScore += 1;
  if (liqSweepDaily.detected && liqSweepDaily.direction === 'bullish') bearScore += 1;
  if (liqSweepDaily.detected && liqSweepDaily.direction === 'bearish') bullScore += 1;
  
  // MAs (weight: 2)
  if (dailyMAs.trend === 'bullish') bullScore += 2;
  if (dailyMAs.trend === 'bearish') bearScore += 2;
  
  // MACD (weight: 1 each)
  if (dailyMACD.signal === 'bullish') bullScore += 1;
  if (dailyMACD.signal === 'bearish') bearScore += 1;
  if (fourHourMACD.signal === 'bullish') bullScore += 1;
  if (fourHourMACD.signal === 'bearish') bearScore += 1;
  if (oneHourMACD.signal === 'bullish') bullScore += 1;
  if (oneHourMACD.signal === 'bearish') bearScore += 1;
  
  // RSI (weight: 1)
  if (dailyRSI > 50) bullScore += 1; else bearScore += 1;
  if (fourHourRSI > 50) bullScore += 1; else bearScore += 1;
  if (oneHourRSI > 50) bullScore += 1; else bearScore += 1;
  
  // OBs and FVGs (weight: 1 each)
  const bullOBs = obs.filter(o => o.type === 'bullish' && !o.mitigated).length + obs1h.filter(o => o.type === 'bullish' && !o.mitigated).length;
  const bearOBs = obs.filter(o => o.type === 'bearish' && !o.mitigated).length + obs1h.filter(o => o.type === 'bearish' && !o.mitigated).length;
  if (bullOBs > bearOBs) bullScore += 1; else if (bearOBs > bullOBs) bearScore += 1;
  
  const bullFVGs = fvgs.filter(f => f.type === 'bullish').length + fvgs1h.filter(f => f.type === 'bullish').length;
  const bearFVGs = fvgs.filter(f => f.type === 'bearish').length + fvgs1h.filter(f => f.type === 'bearish').length;
  if (bullFVGs > bearFVGs) bullScore += 1; else if (bearFVGs > bullFVGs) bearScore += 1;
  
  // Volume (weight: 2)
  if (obv4h.trend === 'bullish') bullScore += 1; else if (obv4h.trend === 'bearish') bearScore += 1;
  if (obv1h.trend === 'bullish') bullScore += 1; else if (obv1h.trend === 'bearish') bearScore += 1;
  if (obv4h.divergence === 'bullish_divergence') bullScore += 2;
  if (obv4h.divergence === 'bearish_divergence') bearScore += 2;
  if (obv1h.divergence === 'bullish_divergence') bullScore += 1;
  if (obv1h.divergence === 'bearish_divergence') bearScore += 1;
  
  // ===== NEW: Advanced SMC Scoring =====
  
  // Breaker Blocks (weight: 2) — violated OBs that flipped polarity
  const bullBreakers = breakers4H.filter(b => b.type === 'bullish' && b.qualityScore >= 40).length +
                       breakersDaily.filter(b => b.type === 'bullish' && b.qualityScore >= 40).length;
  const bearBreakers = breakers4H.filter(b => b.type === 'bearish' && b.qualityScore >= 40).length +
                       breakersDaily.filter(b => b.type === 'bearish' && b.qualityScore >= 40).length;
  if (bullBreakers > 0) bullScore += 2;
  if (bearBreakers > 0) bearScore += 2;
  
  // Inducement (weight: 2) — false breakouts confirming direction
  if (inducement4H.detected && inducement4H.direction === 'bullish') bullScore += 1;
  if (inducement4H.detected && inducement4H.direction === 'bearish') bearScore += 1;
  if (inducementDaily.detected && inducementDaily.direction === 'bullish') bullScore += 1;
  if (inducementDaily.detected && inducementDaily.direction === 'bearish') bearScore += 1;
  
  // Displacement (weight: 2) — strong impulsive moves
  if (displacement4H.detected && displacement4H.direction === 'bullish') bullScore += 1;
  if (displacement4H.detected && displacement4H.direction === 'bearish') bearScore += 1;
  if (displacementDaily.detected && displacementDaily.direction === 'bullish') bullScore += 1;
  if (displacementDaily.detected && displacementDaily.direction === 'bearish') bearScore += 1;
  
  const minDiff = synthProfile ? synthProfile.minScoreDifference : 3;
  const diff = Math.abs(bullScore - bearScore);
  if (diff < minDiff) return null; // No clear direction
  
  const direction: 'bullish' | 'bearish' = bullScore > bearScore ? 'bullish' : 'bearish';
  
  // Premium/Discount zone analysis (post-direction determination)
  let pdResult: PremiumDiscountResult | null = null;
  if (fourHourStruct.trend !== 'ranging') {
    pdResult = analyzePremiumDiscount(fourHourStruct.lastHigh, fourHourStruct.lastLow, currentPrice, direction);
    // Bonus for zone alignment: buy in discount, sell in premium (weight: 2)
    if (pdResult.zoneAlignment) {
      if (direction === 'bullish') bullScore += 2; else bearScore += 2;
    }
  }
  
  // Consequent Encroachment bonus (weight: 1)
  const ceAligned = ces.some(ce => ce.fvgType === direction && ce.priceNearCE);
  if (ceAligned) {
    if (direction === 'bullish') bullScore += 1; else bearScore += 1;
  }
  
  // Counter-trend filter
  if (settings.ignore_counter_trend) {
    if (direction === 'bullish' && dailyStruct.trend === 'bearish') return null;
    if (direction === 'bearish' && dailyStruct.trend === 'bullish') return null;
  }
  
  // STRICT STRUCTURAL GATE
  const hasBOS = fourHourStruct.bos === direction || dailyStruct.bos === direction || oneHourStruct.bos === direction;
  const hasCHoCH = fourHourStruct.choch === direction || dailyStruct.choch === direction || oneHourStruct.choch === direction;
  const sweepConfirms = direction === 'bearish' ? 'bullish' : 'bearish';
  const hasLiqSweep = (liqSweep4H.detected && liqSweep4H.direction === sweepConfirms) || (liqSweep1H.detected && liqSweep1H.direction === sweepConfirms) || (liqSweepDaily.detected && liqSweepDaily.direction === sweepConfirms);
  const hasStructAlign = fourHourStruct.trend === direction && dailyStruct.trend === direction;
  const has1HEarlyShift = (oneHourStruct.bos === direction || oneHourStruct.choch === direction) && fourHourStruct.trend !== direction;
  // NEW: Displacement can also serve as structural confirmation
  const hasDisplacement = (displacement4H.detected && displacement4H.direction === direction) || (displacementDaily.detected && displacementDaily.direction === direction);
  if (!hasBOS && !hasCHoCH && !hasLiqSweep && !hasStructAlign && !has1HEarlyShift && !hasDisplacement) return null;
  
  // Require OB, FVG, or Breaker Block validation
  const hasOB = obs.some(o => o.type === direction && !o.mitigated) || obs1h.some(o => o.type === direction && !o.mitigated);
  const hasFVG = fvgs.some(f => f.type === direction) || fvgs1h.some(f => f.type === direction);
  const hasBreaker = breakers4H.some(b => b.type === direction && b.qualityScore >= 40) || breakersDaily.some(b => b.type === direction && b.qualityScore >= 40);
  if (!hasOB && !hasFVG && !hasBreaker) return null;
  
  // Volume expansion check
  if (!isSynthetic) {
    const recentRanges = fourHourCandles.slice(-20).map(c => c.high - c.low);
    const avgRange = recentRanges.reduce((s, v) => s + v, 0) / recentRanges.length;
    const lastRange = fourHourCandles[fourHourCandles.length - 1].high - fourHourCandles[fourHourCandles.length - 1].low;
    if (lastRange < avgRange * 0.8) return null;
  } else {
    const volExpMult = synthProfile ? synthProfile.volumeExpansionMult : 0.6;
    const recentRanges = fourHourCandles.slice(-20).map(c => c.high - c.low);
    const avgRange = recentRanges.reduce((s, v) => s + v, 0) / recentRanges.length;
    const recentAvg = fourHourCandles.slice(-3).reduce((s, c) => s + (c.high - c.low), 0) / 3;
    if (recentAvg < avgRange * volExpMult) return null;
  }
  
  // Calculate entry, SL, TPs
  let entry: number, stopLoss: number, tp1: number, tp2: number, tp3: number;
  
  const slMult = synthProfile ? synthProfile.slAtrMultiplier : 1.5;

  // Volatility-scaled spread — computed BEFORE the stop so the cost floor below
  // can use it. Mirror of src/lib/spreadConfig.ts.
  const atrPercentile = computeAtrPercentile(oneHourCandles, 14, 200);
  const spreadMultiplierApplied = appliedSpreadMultiplier(instrument, atrPercentile);
  const spreadApplied = getVolatilityAdjustedSpread(instrument, atrPercentile);

  // ---- Synthetic-aware stop clamp (port of src/lib/tradeSignalGenerator.ts
  // lines ~869-875). Identical thresholds/formula so the two paths cannot drift:
  // cost floor = 8x volatility-adjusted spread; min/max ATR band around it.
  const isSynth = synthProfile !== null && synthProfile !== undefined;
  const costFloorDist = isSynth ? spreadApplied * 8 : 0;
  const minStopDist = Math.max(isSynth ? fourHourATR * 1.0 : fourHourATR * 0.8, costFloorDist);
  const maxStopDist = Math.max(
    isSynth ? fourHourATR * slMult * 1.3 : fourHourATR * slMult * 2,
    minStopDist
  );
  const clampStopDistance = (dist: number) => Math.min(Math.max(dist, minStopDist), maxStopDist);

  if (direction === 'bullish') {
    const ob = obs.find(o => o.type === 'bullish' && !o.mitigated);
    const fvg = fvgs.find(f => f.type === 'bullish');
    const breaker = breakers4H.find(b => b.type === 'bullish' && b.qualityScore >= 40);
    entry = ob ? (ob.high + ob.low) / 2 : fvg ? (fvg.high + fvg.low) / 2 : breaker ? (breaker.high + breaker.low) / 2 : currentPrice - fourHourATR * 0.5;
    const rawStop = Math.min(fourHourStruct.lastLow - fourHourATR * 0.5, entry - fourHourATR * slMult);
    stopLoss = entry - clampStopDistance(entry - rawStop);
    const risk = entry - stopLoss;
    tp1 = entry + risk * 1.5;
    tp2 = entry + risk * 2.5;
    tp3 = entry + risk * 4;
  } else {
    const ob = obs.find(o => o.type === 'bearish' && !o.mitigated);
    const fvg = fvgs.find(f => f.type === 'bearish');
    const breaker = breakers4H.find(b => b.type === 'bearish' && b.qualityScore >= 40);
    entry = ob ? (ob.high + ob.low) / 2 : fvg ? (fvg.high + fvg.low) / 2 : breaker ? (breaker.high + breaker.low) / 2 : currentPrice + fourHourATR * 0.5;
    const rawStop = Math.max(fourHourStruct.lastHigh + fourHourATR * 0.5, entry + fourHourATR * slMult);
    stopLoss = entry + clampStopDistance(rawStop - entry);
    const risk = stopLoss - entry;
    tp1 = entry - risk * 1.5;
    tp2 = entry - risk * 2.5;
    tp3 = entry - risk * 4;
  }
  
  // Spread-adjusted risk/reward — mirror of src/lib/spreadConfig.ts.
  // Symmetric half-spread: buy fills at quote + spread/2, sell at quote - spread/2.
  const effEntry = effectiveEntryWithSpread(direction, entry, spreadApplied);
  const risk = Math.abs(effEntry - stopLoss);
  const reward = Math.abs(tp2 - effEntry);
  const rr = risk > 0 ? reward / risk : 0;
  const minRR = isSynthetic ? settings.synthetic_min_rr : settings.forex_min_rr;

  // Setups that only clear the threshold on paper are rejected here.
  if (rr < minRR) return null;

  
  // Confidence — canonical shared module, byte-identical to the web app.
  // The persisted breakdown IS the scored items, so total/max reproduces the number.
  const swingScore = computeSwingConfidence(
    // Closed candles only — same input rule as the app (generateTradePlan drops the forming bar).
    analyzeMarket(dailyCandles.slice(0, -1), fourHourCandles.slice(0, -1), oneHourCandles.slice(0, -1), instrument as TradingInstrument),
    direction,
  );
  const confidence = swingScore.confidence;
  const confluenceBreakdown = [
    ...swingScore.items,
    { label: 'Risk/Reward (info, unscored)', value: `${rr.toFixed(2)}:1`, weight: 0, maxWeight: 0, contributing: false },
  ];
  const totalScore = swingScore.total;
  const maxScore = swingScore.max;

  // Setup type
  const setupType = fourHourStruct.bos ? 'breakout' : fourHourStruct.choch ? 'reversal' : fourHourStruct.trend === dailyStruct.trend ? 'trend_continuation' : 'reversal';
  
  const decimals = getDecimals(instrument);
  const reasoning = [
    synthProfile ? `[${instrument}] Structure clarity: ${synthProfile.structureClarity}/5, Volatility tier: ${synthProfile.volatilityTier}/5.` : '',
    `Daily ${dailyStruct.trend} bias (${dailyStruct.structure}).`,
    `4H ${fourHourStruct.structure}${fourHourStruct.bos ? ` with ${fourHourStruct.bos} BOS` : ''}${fourHourStruct.choch ? ` with ${fourHourStruct.choch} CHoCH` : ''}.`,
    `1H ${oneHourStruct.structure}${oneHourStruct.bos ? ` with ${oneHourStruct.bos} BOS` : ''}${oneHourStruct.choch ? ` with ${oneHourStruct.choch} CHoCH` : ''}.`,
    has1HEarlyShift ? '⚡ 1H early trend shift detected against 4H.' : '',
    hasOB ? 'Unmitigated order block validates entry.' : '',
    hasFVG ? 'Fair value gap provides confluence.' : '',
    hasBreaker ? `Breaker block (flipped OB) confirms ${direction} bias.` : '',
    pdResult?.zoneAlignment ? `Price in ${pdResult.currentZone} zone (${direction === 'bullish' ? 'discount buy' : 'premium sell'}).` : '',
    ceAligned ? 'Consequent encroachment near FVG midpoint.' : '',
    inducement4H.detected && inducement4H.direction === direction ? `4H inducement (${inducement4H.type}) confirms ${direction}.` : '',
    inducementDaily.detected && inducementDaily.direction === direction ? `Daily inducement confirms ${direction}.` : '',
    displacement4H.detected && displacement4H.direction === direction ? `4H displacement detected (strength: ${displacement4H.strength}).` : '',
    displacementDaily.detected && displacementDaily.direction === direction ? `Daily displacement confirms momentum.` : '',
    synthProfile?.consolidationBeforeBreakout ? 'Watching for consolidation-before-breakout signature.' : '',
    synthProfile?.meanReversionAtExtremes ? 'Mean reversion tendency active at extremes.' : '',
    liqSweep4H.detected ? `4H liquidity sweep confirmed (${liqSweep4H.direction}).` : '',
    liqSweep1H.detected ? `1H liquidity sweep confirmed (${liqSweep1H.direction}).` : '',
    `OBV 4H ${obv4h.trend}${obv4h.divergence !== 'none' ? ` with ${obv4h.divergence}` : ''}, 1H ${obv1h.trend}${obv1h.divergence !== 'none' ? ` with ${obv1h.divergence}` : ''}.`,
    `R:R ${rr.toFixed(1)}:1. SL at ${slMult}x ATR.`,
  ].filter(Boolean).join(' ');
  
  return {
    instrument, direction, entry_price: Number(entry.toFixed(decimals)),
    effective_entry: Number(effEntry.toFixed(decimals + 1)),
    spread_applied: spreadApplied,
    atr_percentile_at_entry: atrPercentile !== null ? Number(atrPercentile.toFixed(1)) : null,
    spread_multiplier_applied: spreadMultiplierApplied,

    stop_loss: Number(stopLoss.toFixed(decimals)),
    take_profit_1: Number(tp1.toFixed(decimals)),
    take_profit_2: Number(tp2.toFixed(decimals)),
    take_profit_3: Number(tp3.toFixed(decimals)),
    risk_reward_ratio: Number(rr.toFixed(2)),
    confidence, trade_type: 'swing', setup_type: setupType, reasoning,
    confluence_breakdown: confluenceBreakdown,
    confluence_score_total: totalScore,
    confluence_score_max: maxScore,
  };
}

// Faithful port of src/lib/tradeSignalGenerator.ts's generateDayTradeRecommendation,
// operating on the same shared AnalysisResult the swing path already uses.
// Output shape matches generateSignal() above so both flow through the same
// arbitration/insert/Telegram pipeline at the call site.
function generateDaySignal(
  instrument: TradingInstrument,
  dailyCandles: CandleData[],
  fourHourCandles: CandleData[],
  fifteenMinCandles: CandleData[],
  oneHourCandles: CandleData[],
) {
  if (fifteenMinCandles.length < 20 || oneHourCandles.length < 20) return null;

  const analysis: AnalysisResult = analyzeMarket(
    dailyCandles.slice(0, -1), fourHourCandles.slice(0, -1), oneHourCandles.slice(0, -1), instrument,
  );

  const isSynth = isSyntheticIndex(instrument);
  const decimals = getDecimals(instrument);
  const currentPrice = fourHourCandles[fourHourCandles.length - 1].close;
  // No live tick subscription server-side (unlike the client's WebSocket feed) —
  // the freshest price available is the latest closed 15m candle.
  const livePrice = fifteenMinCandles[fifteenMinCandles.length - 1].close;

  const sessionAnalysis = analyzeAsianSession(fourHourCandles, currentPrice);
  const atrPercentile = computeAtrPercentile(fifteenMinCandles, 14, 200);
  const oneHourOrderBlocks: OrderBlock[] = findOrderBlocksShared(fifteenMinCandles, '1H');
  const oneHourFVGs: FairValueGap[] = findFairValueGapsShared(fifteenMinCandles, '1H');

  let dayDirection: TrendDirection = analysis.oneHourStructure.trend;
  if (dayDirection === 'ranging') dayDirection = analysis.fourHourStructure.trend;

  let gateReason: string | null = null;

  if (dayDirection !== 'ranging') {
    const hasBOS1H = analysis.oneHourStructure.breakOfStructure === dayDirection;
    const hasCHoCH1H = analysis.oneHourStructure.changeOfCharacter === dayDirection;
    const sweepConfirms = dayDirection === 'bearish' ? 'bullish' : 'bearish';
    const hasSweep = analysis.liquiditySweep4H.detected && analysis.liquiditySweep4H.direction === sweepConfirms;
    const tfAligned = analysis.oneHourStructure.trend === dayDirection &&
                      analysis.fourHourStructure.trend === dayDirection;

    if (!hasBOS1H && !hasCHoCH1H && !hasSweep && !tfAligned) {
      gateReason = `No 1H structural confirmation for ${dayDirection}`;
      dayDirection = 'ranging';
    }
  }

  const zoneProximity = analysis.oneHourATR * 1.0;
  const nearZone = (low: number, high: number) =>
    currentPrice >= low - zoneProximity && currentPrice <= high + zoneProximity;
  const dayOBs = oneHourOrderBlocks.length ? oneHourOrderBlocks : analysis.orderBlocks;
  const dayFVGs = oneHourFVGs.length ? oneHourFVGs : analysis.fairValueGaps;

  const qualifyingOB = (dir: TrendDirection) =>
    dayOBs.find(ob => ob.type === dir && !ob.mitigated && ob.qualityScore >= 30 && nearZone(ob.low, ob.high)) ?? null;
  const qualifyingFVG = (dir: TrendDirection) =>
    dayFVGs.find(fvg => fvg.type === dir && fvg.qualityScore >= 30 && nearZone(fvg.low, fvg.high)) ?? null;

  if (dayDirection !== 'ranging') {
    if (!qualifyingOB(dayDirection) && !qualifyingFVG(dayDirection)) {
      gateReason = `No unmitigated 1H OB/FVG (quality >= 30) within 1x 1H ATR for ${dayDirection}`;
      dayDirection = 'ranging';
    }
  }

  if (gateReason || dayDirection === 'ranging') return null;

  // --- Confluence score (12 pts), mirroring the client exactly ---
  let dayScore = 0;
  const tfAlign = analysis.oneHourStructure.trend === analysis.fourHourStructure.trend ? 3 : 0;
  dayScore += tfAlign;

  const bosCHoCH = analysis.oneHourStructure.breakOfStructure === dayDirection ||
                   analysis.oneHourStructure.changeOfCharacter === dayDirection;
  const sweepDir = dayDirection === 'bearish' ? 'bullish' : 'bearish';
  const sweepConfirm = analysis.liquiditySweep4H.detected && analysis.liquiditySweep4H.direction === sweepDir;
  dayScore += (bosCHoCH || sweepConfirm) ? 1 : 0;

  const paMatch = analysis.oneHourPriceAction.dominantSignal === dayDirection ? 2 : 0;
  dayScore += paMatch;

  let rsi1HScore = 0, rsi4hScore = 0;
  if (dayDirection === 'bullish') {
    if (analysis.oneHourRSI > 40 && analysis.oneHourRSI < 70) rsi1HScore = 1;
    if (analysis.fourHourRSI > 40 && analysis.fourHourRSI < 70) rsi4hScore = 1;
  } else {
    if (analysis.oneHourRSI > 30 && analysis.oneHourRSI < 60) rsi1HScore = 1;
    if (analysis.fourHourRSI > 30 && analysis.fourHourRSI < 60) rsi4hScore = 1;
  }
  dayScore += rsi1HScore + rsi4hScore;

  const gateOB = qualifyingOB(dayDirection);
  const gateFVG = qualifyingFVG(dayDirection);
  dayScore += gateOB ? (gateOB.qualityScore >= 60 ? 2 : 1) : 0;
  dayScore += gateFVG ? (gateFVG.qualityScore >= 60 ? 2 : 1) : 0;

  const dayConfidence = Math.min(Math.round((dayScore / 12) * 100), 95);

  // --- Risk geometry ---
  const dayAtr = analysis.oneHourATR;
  const atrTp1Mult = isSynth ? 1.0 : 1.5;
  const atrTp2Mult = isSynth ? 1.8 : 2.5;
  const atrTp3Mult = isSynth ? 2.8 : 4.0;

  const execPrice = livePrice && livePrice > 0 ? livePrice : currentPrice;
  const entryDriftAtr = dayAtr > 0 ? Math.abs(execPrice - currentPrice) / dayAtr : 0;
  const entryStale = entryDriftAtr > 0.5;
  const dayEntry = execPrice;

  const daySpreadForFloor = getVolatilityAdjustedSpread(instrument, atrPercentile);
  const dayMinStopDist = isSynth ? daySpreadForFloor * 8 : 0;

  let dayStopLoss: number, dayTp1: number, dayTp2: number, dayTp3: number;

  if (dayDirection === 'bullish') {
    const asianStop = sessionAnalysis.asianLow - (dayAtr * 0.5);
    const atrStop = execPrice - (dayAtr * 1.5);
    dayStopLoss = Math.max(asianStop, atrStop);
    if (dayEntry - dayStopLoss < dayMinStopDist) dayStopLoss = dayEntry - dayMinStopDist;
    const dayRisk = dayEntry - dayStopLoss;
    dayTp1 = dayEntry + (dayRisk * atrTp1Mult);
    dayTp2 = dayEntry + (dayRisk * atrTp2Mult);
    dayTp3 = dayEntry + (dayRisk * atrTp3Mult);
  } else {
    const asianStop = sessionAnalysis.asianHigh + (dayAtr * 0.5);
    const atrStop = execPrice + (dayAtr * 1.5);
    dayStopLoss = Math.min(asianStop, atrStop);
    if (dayStopLoss - dayEntry < dayMinStopDist) dayStopLoss = dayEntry + dayMinStopDist;
    const dayRisk = dayStopLoss - dayEntry;
    dayTp1 = dayEntry - (dayRisk * atrTp1Mult);
    dayTp2 = dayEntry - (dayRisk * atrTp2Mult);
    dayTp3 = dayEntry - (dayRisk * atrTp3Mult);
  }

  // Stale entries (live price drifted too far from the structural read) are
  // suppressed rather than shipped — matches the client's safety behavior.
  if (entryStale) return null;

  const daySpread = getVolatilityAdjustedSpread(instrument, atrPercentile);
  const daySpreadMultiplier = appliedSpreadMultiplier(instrument, atrPercentile);
  const dayEffectiveEntry = effectiveEntryWithSpread(dayDirection as 'bullish' | 'bearish', dayEntry, daySpread);

  const setupType = analysis.oneHourStructure.structureBreak ? 'breakout' :
    analysis.oneHourStructure.trend === analysis.fourHourStructure.trend ? 'trend_continuation' : 'range';

  const reasoning = `⚡ Day trade: 1H ${analysis.oneHourStructure.trend} structure, ${dayDirection} bias. ` +
    `${analysis.oneHourPriceAction.candlestickPatterns.length > 0 ? analysis.oneHourPriceAction.candlestickPatterns[0].name + ' pattern. ' : ''}` +
    `Asian session ${sessionAnalysis.volatility} volatility. RSI 1H ${analysis.oneHourRSI.toFixed(1)}, 4H ${analysis.fourHourRSI.toFixed(1)}.`;

  return {
    instrument, direction: dayDirection as 'bullish' | 'bearish',
    entry_price: Number(dayEntry.toFixed(decimals)),
    effective_entry: Number(dayEffectiveEntry.toFixed(decimals + 1)),
    spread_applied: daySpread,
    atr_percentile_at_entry: atrPercentile !== null ? Number(atrPercentile.toFixed(1)) : null,
    spread_multiplier_applied: daySpreadMultiplier,
    stop_loss: Number(dayStopLoss.toFixed(decimals)),
    take_profit_1: Number(dayTp1.toFixed(decimals)),
    take_profit_2: Number(dayTp2.toFixed(decimals)),
    take_profit_3: Number(dayTp3.toFixed(decimals)),
    risk_reward_ratio: Number((Math.abs(dayTp2 - dayEntry) / Math.abs(dayEntry - dayStopLoss)).toFixed(2)),
    confidence: dayConfidence, trade_type: 'day' as const, setup_type: setupType, reasoning,
    confluence_breakdown: [],
    confluence_score_total: dayScore,
    confluence_score_max: 12,
  };
}

// =================== INTRABAR (WICK) RESOLUTION ===================
// Mirror of src/lib/intrabarResolution.ts — path assumption:
//   bullish candle (close >= open): open -> low  -> high -> close
//   bearish candle (close <  open): open -> high -> low  -> close
// Same-candle SL + TP is resolved conservatively to the stop.
type IntrabarTarget = 'SL' | 'TP1' | 'TP2' | 'TP3';

interface IntrabarSetup {
  direction: 'bullish' | 'bearish';
  entryPrice: number;
  stopLoss: number;
  takeProfit1?: number | null;
  takeProfit2?: number | null;
  takeProfit3?: number | null;
  generatedAtEpoch: number;
  requiresFill?: boolean;
  /** Typical spread in absolute price units (see SPREAD_TABLE). */
  spread?: number;
  /** Volatility multiplier from the ATR percentile AT GENERATION TIME. */
  spreadMultiplier?: number;
}

interface IntrabarResolution {
  outcome: 'won' | 'lost' | null;
  targetHit: IntrabarTarget | null;
  exitPrice: number | null;
  resolvedAtEpoch: number | null;
  entryFilled: boolean;
  entryFilledAtEpoch: number | null;
  tp1Hit: boolean;
  ambiguous: boolean;
  candlesScanned: number;
  effectiveEntry: number;
  spreadApplied: number;
  spreadMultiplierApplied: number;
}

function candlePath(candle: CandleData): number[] {
  return candle.close >= candle.open
    ? [candle.open, candle.low, candle.high, candle.close]
    : [candle.open, candle.high, candle.low, candle.close];
}

function touched(direction: 'bullish' | 'bearish', level: number, price: number, isTarget: boolean): boolean {
  const above = direction === 'bullish' ? isTarget : !isTarget;
  return above ? price >= level : price <= level;
}

function resolveIntrabar(setup: IntrabarSetup, candles: CandleData[]): IntrabarResolution {
  const relevant = candles
    .filter(c => c.epoch >= setup.generatedAtEpoch)
    .sort((a, b) => a.epoch - b.epoch);

  const { direction, entryPrice, stopLoss } = setup;

  // Candles are quotes; shift every level into quote space by half a spread.
  const spreadMultiplier = setup.spreadMultiplier && setup.spreadMultiplier > 0 ? setup.spreadMultiplier : 1;
  const spread = (setup.spread ?? 0) * spreadMultiplier;
  const shift = direction === 'bullish' ? spread / 2 : -spread / 2;
  const qFill = entryPrice - shift;   // pending order fills when ask/bid reaches entry
  const effEntry = entryPrice + shift; // realistic fill price

  const result: IntrabarResolution = {
    outcome: null, targetHit: null, exitPrice: null, resolvedAtEpoch: null,
    entryFilled: !setup.requiresFill, entryFilledAtEpoch: null,
    tp1Hit: false, ambiguous: false, candlesScanned: relevant.length,
    effectiveEntry: effEntry, spreadApplied: spread, spreadMultiplierApplied: spreadMultiplier,
  };

  const qSL = stopLoss + shift;
  const tp1 = setup.takeProfit1 ?? null;
  const tp2 = setup.takeProfit2 ?? null;
  const tp3 = setup.takeProfit3 ?? null;
  const qTP1 = tp1 !== null ? tp1 + shift : null;
  const qTP2 = tp2 !== null ? tp2 + shift : null;
  const qTP3 = tp3 !== null ? tp3 + shift : null;

  for (const candle of relevant) {
    const path = candlePath(candle);

    if (!result.entryFilled) {
      if (candle.low <= qFill && candle.high >= qFill) {
        result.entryFilled = true;
        result.entryFilledAtEpoch = candle.epoch;
      } else {
        continue;
      }
    }

    const slExtreme = direction === 'bullish' ? candle.low : candle.high;
    const slInCandle = touched(direction, qSL, slExtreme, false);

    let decided = false;
    for (const price of path) {
      if (!result.tp1Hit && qTP1 !== null && touched(direction, qTP1, price, true)) {
        result.tp1Hit = true; // partial only, does not close
      }
      if (touched(direction, qSL, price, false)) {
        result.outcome = 'lost'; result.targetHit = 'SL'; result.exitPrice = stopLoss;
        result.resolvedAtEpoch = candle.epoch; decided = true; break;
      }
      if (qTP3 !== null && touched(direction, qTP3, price, true)) {
        result.outcome = 'won'; result.targetHit = 'TP3'; result.exitPrice = tp3;
        result.resolvedAtEpoch = candle.epoch; result.ambiguous = slInCandle; decided = true; break;
      }
      if (qTP2 !== null && touched(direction, qTP2, price, true)) {
        result.outcome = 'won'; result.targetHit = 'TP2'; result.exitPrice = tp2;
        result.resolvedAtEpoch = candle.epoch; result.ambiguous = slInCandle; decided = true; break;
      }
    }



    if (decided) {
      if (result.outcome === 'won' && result.ambiguous) {
        result.outcome = 'lost'; result.targetHit = 'SL'; result.exitPrice = stopLoss;
      }
      break;
    }
  }

  return result;
}

// =================== OUTCOME CHECKING ===================
async function getCurrentPrice(symbol: string): Promise<number> {
  const data = await derivRequest({
    ticks_history: symbol, adjust_start_time: 1,
    count: 1, end: 'latest', granularity: 60, style: 'candles',
  }, 8000);
  if (!data.candles?.length) throw new Error('No price returned');
  return data.candles[data.candles.length - 1].close;
}

async function checkOutcomes(supabase: any) {
  // Oldest pending first, paged until exhausted — an unordered capped fetch let
  // older signals sit unresolved indefinitely once pending count exceeded 50.
  const PAGE = 200;
  const MAX_PAGES = 25;
  const pending: any[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await supabase
      .from('generated_signals')
      .select('*')
      .eq('outcome', 'pending')
      .order('generated_at', { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) { console.error('pending fetch failed:', error); break; }
    if (!data?.length) break;
    pending.push(...data);
    if (data.length < PAGE) break;
  }

  if (!pending.length) return { updated: 0, won: 0, lost: 0 };
  
  const instruments = [...new Set(pending.map((s: any) => s.instrument))];

  // Fetch 1H OHLC once per instrument for wick replay. Wick replay is the ONLY
  // resolution path — tick checks were retired (no fill gate, no path order).
  const candleMap = new Map<string, CandleData[]>();

  for (const inst of instruments) {
    const symbol = DERIV_SYMBOL_MAP[inst as string];
    if (!symbol) continue;
    try {
      const candles = await fetchCandles(symbol, 3600, 300);
      if (candles.length) candleMap.set(inst as string, candles);
    } catch (err) {
      console.error(`1H candle fetch failed for ${inst}:`, err);
    }
  }


  let updated = 0, won = 0, lost = 0;

  for (const signal of pending) {
    try {
      const pipMult = signal.instrument.includes('JPY') ? 100 : isSyntheticIndex(signal.instrument) ? 100 : signal.instrument === 'XAU/USD' ? 100 : 10000;
      const direction: 'bullish' | 'bearish' = signal.direction === 'bearish' ? 'bearish' : 'bullish';

      let outcome: string | null = null;
      let exitPrice = 0, pnlPips = 0;
      let resolutionMethod: 'tick' | 'wick' = 'tick';
      let note = '';
      let closedAt = new Date().toISOString();

      const candles = candleMap.get(signal.instrument);

      // ---- Preferred path: wick-based intrabar resolution over 1H OHLC ----
      if (candles?.length) {
        const intrabar = resolveIntrabar({
          direction,
          entryPrice: signal.entry_price,
          stopLoss: signal.stop_loss,
          takeProfit1: signal.take_profit_1,
          takeProfit2: signal.take_profit_2,
          takeProfit3: signal.take_profit_3,
          generatedAtEpoch: Math.floor(new Date(signal.generated_at).getTime() / 1000),
          requiresFill: true,
          spread: getSpread(signal.instrument),
          spreadMultiplier: signal.spread_multiplier_applied ??
            appliedSpreadMultiplier(signal.instrument, signal.atr_percentile_at_entry ?? null),
        }, candles);

        if (intrabar.outcome && intrabar.exitPrice !== null) {
          outcome = intrabar.outcome;
          exitPrice = intrabar.exitPrice;
          // P&L from the spread-adjusted fill, not the theoretical entry.
          const fill = intrabar.effectiveEntry;
          pnlPips = (direction === 'bullish' ? exitPrice - fill : fill - exitPrice) * pipMult;
          resolutionMethod = 'wick';
          if (intrabar.resolvedAtEpoch) closedAt = new Date(intrabar.resolvedAtEpoch * 1000).toISOString();
          const when = intrabar.resolvedAtEpoch
            ? new Date(intrabar.resolvedAtEpoch * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' GMT'
            : 'unknown time';
          note = `Intrabar (1H wick) resolution: ${intrabar.targetHit} hit first at ${exitPrice} (${when}); fill ${fill} after ${intrabar.spreadApplied} spread` +
            (intrabar.ambiguous ? ' — SL and TP inside same candle, resolved conservatively to SL' : '');
        }

        // ---- Expiry sweep: an unfilled setup stops occupying its pair slot ----
        // Windows mirror the app's staleness thresholds (swing 24h, day 4h).
        // Expired setups are marked 'cancelled', never won/lost, so they can
        // never become phantom losses.
        if (!intrabar.outcome && !intrabar.entryFilled) {
          const windowMs = (signal.trade_type === 'day' ? 4 : 24) * 3600 * 1000;
          const ageMs = Date.now() - new Date(signal.generated_at).getTime();
          if (ageMs > windowMs) {
            await supabase.from('generated_signals').update({
              outcome: 'cancelled',
              closed_at: new Date().toISOString(),
              notes: 'Expired unfilled: setup window lapsed before entry was touched — excluded from win/loss stats.',
            }).eq('id', signal.id);
            continue;
          }
        }
      }

      // Tick-based resolution has been retired: it cannot tell which level was
      // touched first and, worse, it never checked that the entry was filled,
      // which produced instant phantom wins/losses. No candles => no outcome.
      if (!outcome) continue;


      if (outcome) {
        const riskPips = Math.abs(signal.entry_price - signal.stop_loss) * pipMult;
        const rMultiple = riskPips > 0 ? pnlPips / riskPips : 0;
        const durationMs = new Date(closedAt).getTime() - new Date(signal.generated_at).getTime();

        await supabase.from('generated_signals').update({
          outcome, actual_exit_price: exitPrice, actual_pnl_pips: Number(pnlPips.toFixed(1)),
          r_multiple: Number(rMultiple.toFixed(2)), duration_minutes: Math.max(0, Math.round(durationMs / 60000)),
          closed_at: closedAt,
          resolution_method: resolutionMethod,
          notes: note,
        }).eq('id', signal.id);

        updated++; if (outcome === 'won') won++; else lost++;
      }
    } catch (err) {
      console.error(`Outcome check failed for ${signal.instrument}:`, err);
    }
  }

  return { updated, won, lost };
}

/**
 * Bulk re-resolution: replays every signal since `from` against 1H OHLC with a
 * hard entry-fill gate. Rows whose entry never filled (or that are still live)
 * are reset to pending, which removes the phantom instant win/loss outcomes the
 * old tick checker produced.
 */
async function reresolveHistory(supabase: any, from: string, limit = 5000) {
  const { data: rows, error } = await supabase
    .from('generated_signals')
    .select('*')
    .gte('generated_at', from)
    .neq('outcome', 'cancelled')
    .order('generated_at', { ascending: true })
    .limit(limit);

  if (error) throw new Error(error.message);
  if (!rows?.length) return { scanned: 0, changed: 0, reset: 0, resolved: 0 };

  const instruments = [...new Set(rows.map((s: any) => s.instrument))];
  const candleMap = new Map<string, CandleData[]>();
  for (const inst of instruments) {
    const symbol = DERIV_SYMBOL_MAP[inst as string];
    if (!symbol) continue;
    try {
      // 5000 x 1H ≈ 208 days of history.
      const candles = await fetchCandles(symbol, 3600, 5000);
      if (candles.length) candleMap.set(inst as string, candles);
    } catch (err) {
      console.error(`re-resolve candle fetch failed for ${inst}:`, err);
    }
  }

  let changed = 0, reset = 0, resolved = 0, scanned = 0;

  for (const signal of rows) {
    const candles = candleMap.get(signal.instrument);
    if (!candles?.length) continue;
    const genEpoch = Math.floor(new Date(signal.generated_at).getTime() / 1000);
    // Candle window does not reach back to this signal — leave it untouched.
    if (candles[0].epoch > genEpoch) continue;
    scanned++;

    const direction: 'bullish' | 'bearish' = signal.direction === 'bearish' ? 'bearish' : 'bullish';
    const pipMult = getPipValue(signal.instrument) === 0.01 ? 100 : 10000;

    const intrabar = resolveIntrabar({
      direction,
      entryPrice: signal.entry_price,
      stopLoss: signal.stop_loss,
      takeProfit1: signal.take_profit_1,
      takeProfit2: signal.take_profit_2,
      takeProfit3: signal.take_profit_3,
      generatedAtEpoch: genEpoch,
      requiresFill: true,
      spread: getSpread(signal.instrument),
      spreadMultiplier: signal.spread_multiplier_applied ??
        appliedSpreadMultiplier(signal.instrument, signal.atr_percentile_at_entry ?? null),
    }, candles);

    if (!intrabar.outcome || intrabar.exitPrice === null) {
      if (signal.outcome !== 'pending') {
        await supabase.from('generated_signals').update({
          outcome: 'pending',
          actual_exit_price: null,
          actual_pnl_pips: null,
          r_multiple: null,
          duration_minutes: null,
          closed_at: null,
          resolution_method: null,
          effective_entry: intrabar.effectiveEntry,
          spread_applied: intrabar.spreadApplied,
          notes: intrabar.entryFilled
            ? 'Re-resolved (fill-gated 1H wick replay): entry filled, no level touched yet — reset to pending'
            : 'Re-resolved (fill-gated 1H wick replay): entry never filled — previous outcome was a phantom resolution',
        }).eq('id', signal.id);
        changed++; reset++;
      }
      continue;
    }

    const fill = intrabar.effectiveEntry;
    const exitPrice = intrabar.exitPrice;
    const pnlPips = (direction === 'bullish' ? exitPrice - fill : fill - exitPrice) * pipMult;
    const riskPips = Math.abs(fill - signal.stop_loss) * pipMult;
    const closedAt = new Date((intrabar.resolvedAtEpoch ?? genEpoch) * 1000).toISOString();
    const durationMs = new Date(closedAt).getTime() - new Date(signal.generated_at).getTime();
    const outcome = intrabar.outcome === 'won' ? 'won' : 'lost';

    const same = signal.outcome === outcome &&
      signal.resolution_method === 'wick' &&
      Math.abs((signal.actual_exit_price ?? 0) - exitPrice) < 1e-9;
    if (same) continue;

    await supabase.from('generated_signals').update({
      outcome,
      actual_exit_price: exitPrice,
      actual_pnl_pips: Number(pnlPips.toFixed(1)),
      r_multiple: riskPips > 0 ? Number((pnlPips / riskPips).toFixed(2)) : 0,
      duration_minutes: Math.max(0, Math.round(durationMs / 60000)),
      closed_at: closedAt,
      resolution_method: 'wick',
      effective_entry: fill,
      spread_applied: intrabar.spreadApplied,
      notes: `Re-resolved (fill-gated 1H wick replay): ${intrabar.targetHit} hit first at ${exitPrice}; fill ${fill}` +
        (intrabar.ambiguous ? ' — SL and TP in same candle, resolved to SL' : ''),
    }).eq('id', signal.id);
    changed++; resolved++;
  }

  return { scanned, changed, reset, resolved };
}

// =================== MAIN HANDLER ===================
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const body = await req.json().catch(() => ({}));
    const action = body.action || 'analyze';
    
    if (action === 'check_outcomes') {
      const result = await checkOutcomes(supabase);
      return new Response(JSON.stringify({ success: true, ...result }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'reresolve') {
      const from = body.from || '2026-08-01';
      const result = await reresolveHistory(supabase, from, body.limit ?? 5000);
      return new Response(JSON.stringify({ success: true, from, ...result }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    
    // Get all users with auto_engine_enabled
    const { data: userSettings } = await supabase.from('user_settings').select('*').eq('auto_engine_enabled', true);
    
    if (!userSettings?.length) {
      return new Response(JSON.stringify({ success: true, message: 'No users with engine enabled', signals: 0 }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    
    let totalSignals = 0;
    const errors: string[] = [];
    
    for (const settings of userSettings) {
      if (settings.signals_paused) {
        console.log(`Signals paused for user ${settings.user_id}`);
        continue;
      }
      
      const today = new Date().toISOString().split('T')[0];
      const { data: dailyPerf } = await supabase
        .from('daily_performance')
        .select('*')
        .eq('user_id', settings.user_id)
        .eq('trade_date', today)
        .maybeSingle();
      
      if (dailyPerf && dailyPerf.daily_pnl_percent <= -settings.max_daily_loss_percent) {
        console.log(`Daily loss limit hit for user ${settings.user_id}`);
        if (settings.auto_disable_on_drawdown) {
          await supabase.from('user_settings').update({ signals_paused: true }).eq('user_id', settings.user_id);
        }
        continue;
      }
      
      if (dailyPerf && dailyPerf.signals_generated >= settings.max_trades_per_day) {
        console.log(`Max trades/day reached for user ${settings.user_id}`);
        continue;
      }
      
      for (const instrument of ALL_INSTRUMENTS) {
        const isForex = FOREX_INSTRUMENTS.includes(instrument);
        const inKillZone = isInForexKillZone();
        
        if (settings.notify_instruments?.length > 0 && !settings.notify_instruments.includes(instrument)) continue;
        
        try {
          const symbol = DERIV_SYMBOL_MAP[instrument];
          const [daily, fourHour, oneHour, fifteenMin] = await Promise.all([
            fetchCandles(symbol, 86400, 100),
            fetchCandles(symbol, 14400, 100),
            fetchCandles(symbol, 3600, 200),
            fetchCandles(symbol, 900, 50),
          ]);
          
          if (daily.length < 50 || fourHour.length < 50) {
            errors.push(`${instrument}: Insufficient data`);
            continue;
          }
          
          const swingSignal = generateSignal(instrument, daily, fourHour, fifteenMin, oneHour, {
            forex_min_rr: settings.forex_min_rr,
            synthetic_min_rr: settings.synthetic_min_rr,
            ignore_counter_trend: settings.ignore_counter_trend,
          });
          const daySignal = generateDaySignal(instrument, daily, fourHour, fifteenMin, oneHour);

          // Process both candidates through the same arbitration/insert/Telegram
          // pipeline. Each is independent — a block or failure on one does not
          // stop the other from being attempted.
          for (const signal of [swingSignal, daySignal]) {
            if (!signal) continue;
            if (signal.confidence < settings.notify_min_confidence) continue;

            // ---- Unified arbitration: the Postgres function is the single source of truth ----
            // Fail closed: any error, missing verdict, or unexpected shape blocks the signal.
            const { data: verdict, error: arbErr } = await supabase.rpc('arbitrate_signal', {
              p_user_id: settings.user_id,
              p_instrument: signal.instrument,
              p_direction: signal.direction,
              p_trade_type: signal.trade_type,
              p_confidence: Math.round(signal.confidence),
            });

            if (arbErr || !verdict || typeof verdict.allowed !== 'boolean') {
              errors.push(`${instrument} (${signal.trade_type}): arbitration unavailable — signal blocked (fail-closed)${arbErr ? `: ${arbErr.message}` : ''}`);
              continue;
            }

            if (!verdict.allowed) {
              console.log(`[Arbiter] Blocked ${signal.direction} ${signal.trade_type} ${instrument}: ${verdict.reason}`);
              continue;
            }

            for (const cancelId of (verdict.cancel_ids ?? []) as string[]) {
              await supabase.from('generated_signals')
                .update({
                  outcome: 'cancelled',
                  closed_at: new Date().toISOString(),
                  notes: `Auto-cancelled by arbiter: ${verdict.reason}`,
                })
                .eq('id', cancelId);
            }

            const { data: savedSignal, error: saveErr } = await supabase
              .from('generated_signals')
              .insert({
                user_id: settings.user_id,
                instrument: signal.instrument,
                direction: signal.direction,
                trade_type: signal.trade_type,
                confidence: signal.confidence,
                setup_type: signal.setup_type,
                entry_price: signal.entry_price,
                effective_entry: signal.effective_entry,
                spread_applied: signal.spread_applied,
                atr_percentile_at_entry: signal.atr_percentile_at_entry,
                spread_multiplier_applied: signal.spread_multiplier_applied,

                stop_loss: signal.stop_loss,
                take_profit_1: signal.take_profit_1,
                take_profit_2: signal.take_profit_2,
                take_profit_3: signal.take_profit_3,
                risk_reward_ratio: signal.risk_reward_ratio,
                reasoning: signal.reasoning,
                confluence_breakdown: signal.confluence_breakdown,
                confluence_score_total: signal.confluence_score_total,
                confluence_score_max: signal.confluence_score_max,
                outcome: 'pending',
                engine_generated: true,
                session: new Date().getUTCHours() < 7 ? 'Asian' : new Date().getUTCHours() < 12 ? 'London' : new Date().getUTCHours() < 17 ? 'London/NY' : 'New York',
              })
              .select()
              .single();

            if (saveErr) { errors.push(`${instrument} (${signal.trade_type}): Save failed - ${saveErr.message}`); continue; }

            totalSignals++;

            // Respect each user's own notify_min_confidence threshold for Telegram alerts.
            if (savedSignal && signal.confidence >= (settings.notify_min_confidence ?? 70)) {
              await sendTelegramSignalAlert(supabase, settings, savedSignal);
            }

            await supabase.from('daily_performance').upsert({
              user_id: settings.user_id,
              trade_date: today,
              signals_generated: (dailyPerf?.signals_generated || 0) + 1,
            }, { onConflict: 'user_id,trade_date' });

            await new Promise(r => setTimeout(r, 500));
          }

        } catch (err) {
          errors.push(`${instrument}: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      }
    }
    
    const outcomeResult = await checkOutcomes(supabase);
    
    return new Response(JSON.stringify({
      success: true,
      signals_generated: totalSignals,
      outcomes_updated: outcomeResult.updated,
      outcomes_won: outcomeResult.won,
      outcomes_lost: outcomeResult.lost,
      errors: errors.length > 0 ? errors : undefined,
      timestamp: new Date().toISOString(),
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    
  } catch (err) {
    console.error('Signal engine error:', err);
    return new Response(JSON.stringify({ success: false, error: err instanceof Error ? err.message : 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});