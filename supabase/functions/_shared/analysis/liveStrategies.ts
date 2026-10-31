/**
 * Which setups the live rules produce for an instrument at a moment — the same
 * decision the signal engine makes each hour, without saving or sending anything.
 *
 *   Forex and gold: SMC CHoCH + FVG; if none, EUR/USD and USD/JPY check their Z-score gems.
 *   US100: SMC CHoCH + FVG under its own setup type.  XAG/USD: H4 Donchian gem.
 *   V10: H4 star reversal gem.  V75: inside-bar breakout gem.  BOOM1000: H4 Donchian gem.
 *   Every other instrument issues no signals.
 *
 * Ama (ai-employees) replays recent hours with this and compares the result to
 * the saved signals, so a strategy that silently stops firing shows up as a
 * problem. Keep it in step with the engine's generation branch.
 *
 * Runtime-neutral: relative `.ts` imports only (runs in both Vite and Deno).
 */

import type { CandleData, TradingInstrument } from './core.ts';
import { evaluateSmcChochFvg, SMC_SETUP_TYPE, SMC_US100_SETUP_TYPE } from './smcChochFvg.ts';
import { evaluateBoom1000Donchian, evaluateEurUsdZScore, evaluateUsdJpyZScore, evaluateV10StarReversal, evaluateV75InsideBar, evaluateXagDonchian } from './selectiveGems.ts';

export const LIVE_FOREX = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'GBP/JPY', 'XAU/USD'] as const;
export const LIVE_MARKETS = ['XAG/USD', 'US100'] as const;
export const LIVE_SYNTHETICS = ['V10', 'V75', 'BOOM1000'] as const;
export const LIVE_INSTRUMENTS: readonly string[] = [...LIVE_FOREX, ...LIVE_MARKETS, ...LIVE_SYNTHETICS];

export interface LiveCandles { d1: CandleData[]; h4: CandleData[]; h1: CandleData[]; m15: CandleData[] }
export interface LiveSetup { setupType: string; direction: 'bullish' | 'bearish' }

export function evaluateLiveSetups(instrument: string, c: LiveCandles, nowEpoch: number): LiveSetup | null {
  if (instrument === 'US100') {
    const { setup } = evaluateSmcChochFvg(instrument, c.h4, c.h1, nowEpoch);
    return setup ? { setupType: SMC_US100_SETUP_TYPE, direction: setup.direction } : null;
  }
  if (instrument === 'XAG/USD') {
    const gem = evaluateXagDonchian(c.h4, nowEpoch);
    return gem ? { setupType: gem.setupType, direction: gem.direction } : null;
  }
  if ((LIVE_FOREX as readonly string[]).includes(instrument)) {
    const { setup } = evaluateSmcChochFvg(instrument as TradingInstrument, c.h4, c.h1, nowEpoch);
    if (setup) return { setupType: SMC_SETUP_TYPE, direction: setup.direction };
    if (instrument === 'EUR/USD') {
      const gem = evaluateEurUsdZScore(c.d1, c.h1, nowEpoch);
      if (gem) return { setupType: gem.setupType, direction: gem.direction };
    }
    if (instrument === 'USD/JPY') {
      const gem = evaluateUsdJpyZScore(c.h1, c.h4, nowEpoch);
      if (gem) return { setupType: gem.setupType, direction: gem.direction };
    }
    return null;
  }
  const gem = instrument === 'V10'
    ? evaluateV10StarReversal(c.h4, nowEpoch)
    : instrument === 'V75'
      ? evaluateV75InsideBar(c.h4, c.h1, c.m15, nowEpoch)
      : instrument === 'BOOM1000'
        ? evaluateBoom1000Donchian(c.h4, nowEpoch)
        : null;
  return gem ? { setupType: gem.setupType, direction: gem.direction } : null;
}
