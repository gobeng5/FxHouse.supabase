/**
 * SMC CHoCH + FVG strategy — the forex and gold signal source.
 *
 * One implementation for the web app (Vite) and the signal engine (Deno), so
 * the two paths cannot drift. Runtime-neutral: relative `.ts` imports only.
 *
 * Rules (all on closed candles):
 *   1. H4 trend   — direction of the latest H4 close beyond the latest unbroken
 *                   confirmed swing (fractal, 2 candles each side).
 *   2. H1 trigger — the candle that just closed breaks the latest unbroken H1
 *                   swing (fractal, 3 candles each side) in the OPPOSITE direction
 *                   to the previous H1 break (a change of character), in the
 *                   direction of the H4 trend, closing between 07:00 and 17:00 UTC.
 *   3. Leg        — from the broken swing's candle to the trigger candle.
 *   4. Entry      — limit order at the midpoint of the most recent fair value gap
 *                   in the leg that starts at or after the leg extreme. It must be
 *                   on the pullback side of the trigger close.
 *   5. Stop       — leg extreme, 0.1 x ATR(14, H1) beyond. Skipped if the risk is
 *                   under 0.2 x ATR.
 *   6. Target     — one target at 2R.
 *
 * A setup exists only on the hour its trigger candle closes. The signal's
 * lifecycle (fill gate, unfilled-order expiry, one setup per pair) is the
 * app's existing one — nothing strategy-specific is added here.
 */

import type { CandleData, TradingInstrument, TrendDirection } from './core.ts';
import { getInstrumentDecimals } from './core.ts';
import { calculateATR } from './indicators.ts';
import { GEM_SETUP_TYPES } from './selectiveGems.ts';

/** Stored in `generated_signals.setup_type`; identifies signals from this strategy. */
export const SMC_SETUP_TYPE = 'smc_choch_fvg';

/**
 * This strategy has no per-signal score: a setup either meets every rule or it
 * does not exist. The stored confidence is one fixed figure, the share of
 * setups that reached target in the 12-month backtest (about half).
 */
export const SMC_CONFIDENCE = 50;

export const SMC_RULES = {
  h4Fractal: 2,
  h1Fractal: 3,
  sessionStartHourUtc: 7,
  sessionEndHourUtc: 17,
  stopBufferAtr: 0.1,
  minRiskAtr: 0.2,
  rewardRisk: 2,
  atrPeriod: 14,
  /** Closed candles analysed. Fixed so both runtimes see the same window whatever they fetched. */
  h4Window: 90,
  h1Window: 190,
} as const;

const H1_SECONDS = 3600;
const H4_SECONDS = 14400;

type Dir = 1 | -1;

export interface StructureBreak {
  /** Index of the candle whose close broke the swing. */
  index: number;
  dir: Dir;
  /** Index of the swing candle that was broken. */
  swingIndex: number;
  /** BOS = same direction as the previous break, CHoCH = opposite, FIRST = no previous break in the window. */
  label: 'BOS' | 'CHoCH' | 'FIRST';
}

/**
 * Fractal swings with `n` candles each side (strictly higher / lower than all
 * of them), usable `n` candles later. A break is a CLOSE beyond the latest
 * confirmed swing that has not been broken yet; a newer confirmed swing
 * replaces an older unbroken one.
 */
export function detectStructureBreaks(candles: CandleData[], n: number): StructureBreak[] {
  const breaks: StructureBreak[] = [];
  let high: { index: number; level: number } | null = null;
  let low: { index: number; level: number } | null = null;
  let prev: 0 | Dir = 0;

  const isSwing = (k: number, side: 'high' | 'low'): boolean => {
    if (k < n || k + n >= candles.length) return false;
    for (let d = 1; d <= n; d++) {
      const ok = side === 'high'
        ? candles[k].high > candles[k - d].high && candles[k].high > candles[k + d].high
        : candles[k].low < candles[k - d].low && candles[k].low < candles[k + d].low;
      if (!ok) return false;
    }
    return true;
  };

  for (let j = 0; j < candles.length; j++) {
    const k = j - n; // the swing that candle j completes
    if (k >= 0 && isSwing(k, 'high')) high = { index: k, level: candles[k].high };
    if (k >= 0 && isSwing(k, 'low')) low = { index: k, level: candles[k].low };

    const note = (dir: Dir, swingIndex: number) => {
      breaks.push({ index: j, dir, swingIndex, label: prev === 0 ? 'FIRST' : prev === dir ? 'BOS' : 'CHoCH' });
      prev = dir;
    };
    if (high && candles[j].close > high.level) { note(1, high.index); high = null; }
    if (low && candles[j].close < low.level) { note(-1, low.index); low = null; }
  }
  return breaks;
}

export interface SmcSetup {
  direction: 'bullish' | 'bearish';
  /** Limit order price: midpoint of the fair value gap. */
  entry: number;
  stopLoss: number;
  /** The single target, 2R from the entry. */
  takeProfit: number;
  /** H1 ATR(14) at the trigger candle. */
  atr: number;
  /** Close time of the trigger candle (UTC epoch seconds) — when the order becomes live. */
  triggerCloseEpoch: number;
  legExtreme: number;
  fvgLow: number;
  fvgHigh: number;
  /** The conditions that produced this setup, in rule order, with the values that met them. */
  parameters: SmcParameter[];
}

/**
 * One rule and the value that satisfied it. Shaped like a confidence
 * breakdown item so it is stored and shown through the same fields, but it is
 * a checklist, not a score: every rule is met (1 of 1) or the setup does not exist.
 */
export interface SmcParameter {
  label: string;
  value: string;
  weight: 1;
  maxWeight: 1;
  contributing: true;
}

export interface SmcEvaluation {
  setup: SmcSetup | null;
  h4Trend: TrendDirection;
  /** Why there is no setup, or a one-line description of the one found. */
  reason: string;
}

const toTrend = (dir: 0 | Dir): TrendDirection => (dir === 1 ? 'bullish' : dir === -1 ? 'bearish' : 'ranging');

/** Levels are rounded to the precision the app displays, so what is stored is what is shown. */
const priceDecimals = (instrument: TradingInstrument): number => getInstrumentDecimals(instrument);

const roundTo = (value: number, decimals: number): number => Number(value.toFixed(decimals));

/** Candles of a timeframe that have fully closed by `nowEpoch`, oldest first, trimmed to `window`. */
const closedWindow = (candles: CandleData[], seconds: number, nowEpoch: number, window: number): CandleData[] =>
  candles
    .filter(c => c.epoch + seconds <= nowEpoch)
    .sort((a, b) => a.epoch - b.epoch)
    .slice(-window);

/**
 * Evaluates the strategy for the H1 candle that has just closed.
 * `h4Candles` / `h1Candles` may include the still-forming candle; it is dropped here.
 */
export function evaluateSmcChochFvg(
  instrument: TradingInstrument,
  h4Candles: CandleData[],
  h1Candles: CandleData[],
  nowEpoch: number,
): SmcEvaluation {
  const R = SMC_RULES;
  const h4 = closedWindow(h4Candles, H4_SECONDS, nowEpoch, R.h4Window);
  const h1 = closedWindow(h1Candles, H1_SECONDS, nowEpoch, R.h1Window);
  const none = (reason: string, h4Trend: TrendDirection = 'ranging'): SmcEvaluation => ({ setup: null, h4Trend, reason });

  if (h4.length < 30 || h1.length < 60) return none('Not enough closed candles to read structure.');

  const h4Breaks = detectStructureBreaks(h4, R.h4Fractal);
  const h4Dir: 0 | Dir = h4Breaks.length ? h4Breaks[h4Breaks.length - 1].dir : 0;
  const h4Trend = toTrend(h4Dir);
  if (h4Dir === 0) return none('No H4 structure break yet — no trend to trade with.');

  const t = h1.length - 1;
  const triggerCloseEpoch = h1[t].epoch + H1_SECONDS;
  // The setup belongs to the hour its trigger closes. An older last candle means the market is shut.
  if (nowEpoch - triggerCloseEpoch >= H1_SECONDS) return none(`H4 trend ${h4Trend}. Market closed — no new H1 candle.`, h4Trend);

  const h1Breaks = detectStructureBreaks(h1, R.h1Fractal);
  const last = h1Breaks[h1Breaks.length - 1];
  const waiting = `H4 trend ${h4Trend}. Waiting for an H1 change of character in that direction.`;
  if (!last || last.index !== t) return none(waiting, h4Trend);
  if (last.label !== 'CHoCH') return none(`H4 trend ${h4Trend}. The last H1 candle broke structure as a continuation (BOS), which is not traded.`, h4Trend);
  if (last.dir !== h4Dir) return none(`H4 trend ${h4Trend}. H1 changed character against it — no trade.`, h4Trend);

  const hour = new Date(triggerCloseEpoch * 1000).getUTCHours();
  if (!(hour >= R.sessionStartHourUtc && hour < R.sessionEndHourUtc)) {
    return none(`H4 trend ${h4Trend}. H1 change of character outside 07:00–17:00 UTC — not traded.`, h4Trend);
  }

  const dir = last.dir;
  // Leg: from the broken swing's candle to the trigger candle.
  let ext = last.swingIndex;
  for (let m = last.swingIndex; m <= t; m++) {
    if (dir === 1 ? h1[m].low < h1[ext].low : h1[m].high > h1[ext].high) ext = m;
  }

  // Most recent fair value gap whose three candles lie in the leg, starting at or after the extreme.
  let fvgLow = NaN, fvgHigh = NaN;
  for (let m = t; m >= ext + 2; m--) {
    const gap = dir === 1 ? h1[m].low > h1[m - 2].high : h1[m].high < h1[m - 2].low;
    if (!gap) continue;
    fvgLow = dir === 1 ? h1[m - 2].high : h1[m].high;
    fvgHigh = dir === 1 ? h1[m].low : h1[m - 2].low;
    break;
  }
  if (Number.isNaN(fvgLow)) return none(`H4 trend ${h4Trend}. H1 change of character confirmed, but the move left no fair value gap to enter on.`, h4Trend);

  const decimals = priceDecimals(instrument);
  const entry = roundTo((fvgLow + fvgHigh) / 2, decimals);
  // A limit order has to sit on the pullback side of the trigger close.
  if (!(dir * (h1[t].close - entry) > 0)) return none(`H4 trend ${h4Trend}. Price has already traded back through the fair value gap — no entry.`, h4Trend);

  const atr = calculateATR(h1, R.atrPeriod);
  if (!(atr > 0)) return none('ATR unavailable.', h4Trend);
  const legExtreme = dir === 1 ? h1[ext].low : h1[ext].high;
  const stopLoss = roundTo(legExtreme - dir * R.stopBufferAtr * atr, decimals);
  const risk = dir * (entry - stopLoss);
  if (!(risk >= R.minRiskAtr * atr)) return none(`H4 trend ${h4Trend}. Setup found but the stop is too tight (under ${R.minRiskAtr} ATR) — skipped.`, h4Trend);

  const takeProfit = roundTo(entry + dir * risk * R.rewardRisk, decimals);
  const direction = dir === 1 ? 'bullish' : 'bearish';
  const at = new Date(triggerCloseEpoch * 1000).toISOString().slice(11, 16);

  const px = (v: number) => v.toFixed(decimals);
  const side = (d: Dir) => (d === 1 ? 'high' : 'low');
  const h4Break = h4Breaks[h4Breaks.length - 1];
  const h4Level = dir === 1 ? h4[h4Break.swingIndex].high : h4[h4Break.swingIndex].low;
  const h1Level = dir === 1 ? h1[last.swingIndex].high : h1[last.swingIndex].low;
  const item = (label: string, value: string): SmcParameter => ({ label, value, weight: 1, maxWeight: 1, contributing: true });
  const parameters: SmcParameter[] = [
    item('H4 trend', `${direction} — last H4 structure break was a close ${dir === 1 ? 'above' : 'below'} the swing ${side(dir)} ${px(h4Level)}`),
    item('H1 change of character', `H1 closed ${dir === 1 ? 'above' : 'below'} the swing ${side(dir)} ${px(h1Level)} at ${at} UTC; the previous H1 break was ${dir === 1 ? 'bearish' : 'bullish'}`),
    item('Session', `trigger closed at ${at} UTC, inside 07:00–17:00 UTC`),
    item('Fair value gap', `${px(fvgLow)}–${px(fvgHigh)} in the trigger leg; entry at its midpoint ${px(entry)}`),
    item('Stop', `leg ${side(-dir as Dir)} ${px(legExtreme)} ${dir === 1 ? 'minus' : 'plus'} ${R.stopBufferAtr} x ATR (H1 ATR ${atr.toFixed(decimals + 1)})`),
    item('Risk size', `${px(risk)} per unit, above the ${R.minRiskAtr} x ATR minimum`),
    item('Target', `${R.rewardRisk}R from the entry — ${px(takeProfit)}`),
  ];
  const reason =
    `SMC CHoCH + FVG. H4 structure ${direction}. H1 CHoCH confirmed at ${at} UTC in the H4 direction. ` +
    `${dir === 1 ? 'Buy' : 'Sell'} limit at the midpoint of the fair value gap ${fvgLow.toFixed(decimals)}–${fvgHigh.toFixed(decimals)}. ` +
    `Stop beyond the leg ${dir === 1 ? 'low' : 'high'} ${legExtreme.toFixed(decimals)} with a 0.1 ATR buffer. One target at ${R.rewardRisk}R; no partial exits.`;

  return {
    setup: { direction, entry, stopLoss, takeProfit, atr, triggerCloseEpoch, legExtreme, fvgLow, fvgHigh, parameters },
    h4Trend,
    reason,
  };
}

/**
 * Where outcome replay starts for a stored signal. The app's wick resolver
 * skips the candle a signal was generated in; an SMC order is live from the
 * top of that hour (its trigger candle has just closed), and many fill within
 * it, so for this strategy the replay starts at the hour boundary. The V75
 * inside-bar gem is also a pending order issued just after the hour, so it
 * starts there too.
 */
const HOUR_START_TYPES: readonly string[] = [SMC_SETUP_TYPE, GEM_SETUP_TYPES.V75_INSIDEBAR];
export const resolutionStartEpoch = (setupType: string | null | undefined, generatedAtEpoch: number): number =>
  setupType && HOUR_START_TYPES.includes(setupType) ? Math.floor(generatedAtEpoch / H1_SECONDS) * H1_SECONDS : generatedAtEpoch;
