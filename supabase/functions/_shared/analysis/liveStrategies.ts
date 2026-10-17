/**
 * Which setups the live rules produce for an instrument at a moment — the same
 * decision the signal engine makes each hour, without saving or sending anything.
 *
 *   Forex and gold: SMC CHoCH + FVG; if none, EUR/USD also checks its Z-score gem.
 *   V10: Donchian marubozu gem.  V75: inside-bar breakout gem.
 *   Every other instrument issues no signals.
 *
 * Ama (ai-employees) replays recent hours with this and compares the result to
 * the saved signals, so a strategy that silently stops firing shows up as a
 * problem. Keep it in step with the engine's generation branch.
 *
 * Runtime-neutral: relative `.ts` imports only (runs in both Vite and Deno).
 */

import type { CandleData, TradingInstrument } from './core.ts';
import { evaluateSmcChochFvg, SMC_SETUP_TYPE } from './smcChochFvg.ts';
import { evaluateEurUsdZScore, evaluateV10DonchianMarubozu, evaluateV75InsideBar } from './selectiveGems.ts';

export const LIVE_FOREX = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'GBP/JPY', 'XAU/USD'] as const;
export const LIVE_SYNTHETICS = ['V10', 'V75'] as const;
export const LIVE_INSTRUMENTS: readonly string[] = [...LIVE_FOREX, ...LIVE_SYNTHETICS];

export interface LiveCandles { d1: CandleData[]; h4: CandleData[]; h1: CandleData[]; m15: CandleData[] }
export interface LiveSetup { setupType: string; direction: 'bullish' | 'bearish' }

export function evaluateLiveSetups(instrument: string, c: LiveCandles, nowEpoch: number): LiveSetup | null {
  if ((LIVE_FOREX as readonly string[]).includes(instrument)) {
    const { setup } = evaluateSmcChochFvg(instrument as TradingInstrument, c.h4, c.h1, nowEpoch);
    if (setup) return { setupType: SMC_SETUP_TYPE, direction: setup.direction };
    if (instrument === 'EUR/USD') {
      const gem = evaluateEurUsdZScore(c.d1, c.h1, nowEpoch);
      if (gem) return { setupType: gem.setupType, direction: gem.direction };
    }
    return null;
  }
  const gem = instrument === 'V10'
    ? evaluateV10DonchianMarubozu(c.h1, nowEpoch)
    : instrument === 'V75'
      ? evaluateV75InsideBar(c.h4, c.h1, c.m15, nowEpoch)
      : null;
  return gem ? { setupType: gem.setupType, direction: gem.direction } : null;
}
