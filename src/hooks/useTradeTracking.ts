import { useCallback, useEffect, useRef } from 'react';
import { Trade, TradeInput, calculatePnlPips, getPipValue } from './useTrades';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { resolveIntrabar, IntrabarCandle } from '@/lib/intrabarResolution';
import { getSpread, appliedSpreadMultiplier } from '@/lib/spreadConfig';


const TRADE_CHECK_INTERVAL = 30 * 1000; // 30 seconds

export type CandleFetcher = (
  instrument: string,
  granularity: number,
  count: number
) => Promise<IntrabarCandle[]>;

export type TargetHit = 'TP1' | 'TP2' | 'TP3' | 'SL' | null;

export interface TradeCheckResult {
  outcome: 'WIN' | 'LOSS' | 'BREAKEVEN';
  exitPrice: number;
  pnlPips: number;
  targetHit: TargetHit;
}

/**
 * Checks a single open trade against the current price to see if any target was hit.
 * TP1 is partial — trade stays open. TP2/TP3 or SL finalizes the trade.
 */
export function checkTradeOutcome(
  trade: Trade,
  currentPrice: number
): TradeCheckResult | null {
  // Only check trades that are still open/active (skip closed and pending)
  if (trade.outcome && trade.outcome !== 'ACTIVE') return null;
  // Need at least entry + either SL or a TP
  if (!trade.stop_loss && !trade.take_profit) return null;
  // Guard against zero/stale prices (e.g. during reconnect)
  if (currentPrice <= 0) return null;

  const entry = trade.entry_price;
  const sl = trade.stop_loss;
  const tp1 = trade.take_profit;
  const tp2 = trade.take_profit_2;
  const tp3 = trade.take_profit_3;

  if (trade.direction === 'BUY') {
    // Stop loss hit
    if (sl && currentPrice <= sl) {
      const pnlPips = calculatePnlPips(trade.instrument, 'BUY', entry, sl);
      return { outcome: 'LOSS', exitPrice: sl, pnlPips, targetHit: 'SL' };
    }
    // TP3 hit (best case)
    if (tp3 && currentPrice >= tp3) {
      const pnlPips = calculatePnlPips(trade.instrument, 'BUY', entry, tp3);
      return { outcome: 'WIN', exitPrice: tp3, pnlPips, targetHit: 'TP3' };
    }
    // TP2 hit
    if (tp2 && currentPrice >= tp2) {
      const pnlPips = calculatePnlPips(trade.instrument, 'BUY', entry, tp2);
      return { outcome: 'WIN', exitPrice: tp2, pnlPips, targetHit: 'TP2' };
    }
    // TP1 is NOT a closing trigger — trade stays open (partial take)
  } else {
    // SELL direction
    if (sl && currentPrice >= sl) {
      const pnlPips = calculatePnlPips(trade.instrument, 'SELL', entry, sl);
      return { outcome: 'LOSS', exitPrice: sl, pnlPips, targetHit: 'SL' };
    }
    if (tp3 && currentPrice <= tp3) {
      const pnlPips = calculatePnlPips(trade.instrument, 'SELL', entry, tp3);
      return { outcome: 'WIN', exitPrice: tp3, pnlPips, targetHit: 'TP3' };
    }
    if (tp2 && currentPrice <= tp2) {
      const pnlPips = calculatePnlPips(trade.instrument, 'SELL', entry, tp2);
      return { outcome: 'WIN', exitPrice: tp2, pnlPips, targetHit: 'TP2' };
    }
  }

  return null;
}

/**
 * Returns which targets have been "touched" by current price (for live status display),
 * even if the trade isn't finalized yet.
 */
export function getTargetProgress(
  trade: Trade,
  currentPrice: number
): { tp1Hit: boolean; tp2Hit: boolean; tp3Hit: boolean; slHit: boolean; currentPnlPips: number } {
  if (trade.outcome && trade.outcome !== 'ACTIVE') {
    return {
      tp1Hit: false,
      tp2Hit: false,
      tp3Hit: false,
      slHit: false,
      currentPnlPips: trade.pnl_pips || 0,
    };
  }

  const entry = trade.entry_price;
  const isBuy = trade.direction === 'BUY';
  const currentPnlPips = calculatePnlPips(trade.instrument, trade.direction, entry, currentPrice);

  let tp1Hit = false, tp2Hit = false, tp3Hit = false, slHit = false;

  if (isBuy) {
    if (trade.take_profit && currentPrice >= trade.take_profit) tp1Hit = true;
    if (trade.take_profit_2 && currentPrice >= trade.take_profit_2) tp2Hit = true;
    if (trade.take_profit_3 && currentPrice >= trade.take_profit_3) tp3Hit = true;
    if (trade.stop_loss && currentPrice <= trade.stop_loss) slHit = true;
  } else {
    if (trade.take_profit && currentPrice <= trade.take_profit) tp1Hit = true;
    if (trade.take_profit_2 && currentPrice <= trade.take_profit_2) tp2Hit = true;
    if (trade.take_profit_3 && currentPrice <= trade.take_profit_3) tp3Hit = true;
    if (trade.stop_loss && currentPrice >= trade.stop_loss) slHit = true;
  }

  return { tp1Hit, tp2Hit, tp3Hit, slHit, currentPnlPips };
}

interface UseTradeTrackingOptions {
  trades: Trade[];
  prices: Record<string, { price: number }>;
  isConnected: boolean;
  onTradeUpdated: () => void;
  /** Optional 1H OHLC fetcher — enables wick-based intrabar resolution */
  getCandles?: CandleFetcher;
}

export function useTradeTracking({ trades, prices, isConnected, onTradeUpdated, getCandles }: UseTradeTrackingOptions) {
  const isCheckingRef = useRef(false);

  const checkAllTrades = useCallback(async () => {
    if (isCheckingRef.current || !isConnected) return;

    const openTrades = trades.filter(t => (!t.outcome || t.outcome === 'ACTIVE' || t.outcome === 'PENDING') && (t.stop_loss || t.take_profit));
    if (openTrades.length === 0) return;

    isCheckingRef.current = true;
    let updatedCount = 0;

    try {
      for (const trade of openTrades) {
        const priceData = prices[trade.instrument];
        if (!priceData && !getCandles) continue;

        // ---- Preferred path: wick-based intrabar resolution over 1H OHLC ----
        if (getCandles && trade.stop_loss) {
          try {
            const candles = await getCandles(trade.instrument, 3600, 300);
            const dir = trade.direction === 'BUY' ? 'bullish' : 'bearish';
            const startEpoch = Math.floor(new Date(trade.entry_time).getTime() / 1000);
            const intrabar = resolveIntrabar(
              {
                direction: dir,
                entryPrice: trade.entry_price,
                stopLoss: trade.stop_loss,
                takeProfit1: trade.take_profit,
                takeProfit2: trade.take_profit_2,
                takeProfit3: trade.take_profit_3,
                generatedAtEpoch: startEpoch,
                // Anything not explicitly ACTIVE is treated as an unfilled order:
                // it must trade through the entry before it can resolve.
                requiresFill: trade.outcome !== 'ACTIVE',
                spread: getSpread(trade.instrument),
                // Volatility regime captured when the trade was opened.
                spreadMultiplier:
                  (trade as { spread_multiplier_applied?: number | null }).spread_multiplier_applied ??
                  appliedSpreadMultiplier(
                    trade.instrument,
                    (trade as { atr_percentile_at_entry?: number | null }).atr_percentile_at_entry ?? null
                  ),
              },
              candles
            );

            // PENDING → ACTIVE when a candle traded through the entry
            if (trade.outcome !== 'ACTIVE' && intrabar.entryFilled && !intrabar.outcome) {
              const { error } = await supabase
                .from('trades')
                .update({
                  outcome: 'ACTIVE',
                  effective_entry: intrabar.effectiveEntry,
                  spread_applied: intrabar.spreadApplied,
                  notes: trade.notes
                    ? `${trade.notes}\nAuto-activated (1H wick fill) at ${intrabar.effectiveEntry}`
                    : `Auto-activated (1H wick fill) at ${intrabar.effectiveEntry}`,
                })
                .eq('id', trade.id);
              if (!error) {
                updatedCount++;
                toast.success('📋 Trade Activated', {
                  description: `${trade.instrument} ${trade.direction} pending order filled at ~${intrabar.effectiveEntry}`,
                });
              }
              continue;
            }

            if (intrabar.outcome && intrabar.exitPrice !== null && intrabar.targetHit) {
              const exitPrice = intrabar.exitPrice;
              // P&L from the spread-adjusted fill, not the theoretical entry.
              const pnlPips = calculatePnlPips(trade.instrument, trade.direction, intrabar.effectiveEntry, exitPrice);
              const when = intrabar.resolvedAtEpoch
                ? new Date(intrabar.resolvedAtEpoch * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' GMT'
                : 'unknown time';
              const note =
                `Intrabar (1H wick) resolution: ${intrabar.targetHit} hit first at ${exitPrice} (${when}); fill ${intrabar.effectiveEntry} after ${intrabar.spreadApplied} spread` +
                (intrabar.ambiguous ? ' — SL and TP inside same candle, resolved conservatively to SL' : '');
              const existing = trade.notes ? `${trade.notes}\n${note}` : note;

              const { error } = await supabase
                .from('trades')
                .update({
                  outcome: intrabar.outcome === 'won' ? 'WIN' : 'LOSS',
                  exit_price: exitPrice,
                  pnl_pips: parseFloat(pnlPips.toFixed(1)),
                  exit_time: new Date((intrabar.resolvedAtEpoch ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
                  notes: existing,
                  target_hit: intrabar.targetHit,
                  resolution_method: 'wick',
                  effective_entry: intrabar.effectiveEntry,
                  spread_applied: intrabar.spreadApplied,
                })
                .eq('id', trade.id);


              if (!error) {
                updatedCount++;
                const emoji = intrabar.outcome === 'won' ? '🎯' : '🛑';
                toast.success(`${emoji} Trade Auto-Updated`, {
                  description: `${trade.instrument} ${trade.direction} — ${intrabar.targetHit} hit (${pnlPips > 0 ? '+' : ''}${pnlPips.toFixed(1)} pips)`,
                });
              }
              continue;
            }
          } catch (err) {
            console.error('Journal intrabar resolution failed, falling back to tick check:', err);
          }
        }

        if (!priceData) continue;

        // PENDING → ACTIVE: activate when current price reaches entry price
        if (trade.outcome !== 'ACTIVE') {
          const price = priceData.price;
          if (price <= 0) continue;
          const entry = trade.entry_price;
          const pip = getPipValue(trade.instrument);
          const tolerance = pip * 3; // 3 pip tolerance for fill
          const filled = trade.direction === 'BUY'
            ? price <= entry + tolerance
            : price >= entry - tolerance;

          if (filled) {
            const { error } = await supabase
              .from('trades')
              .update({ outcome: 'ACTIVE', notes: trade.notes ? `${trade.notes}\nAuto-activated at ${price}` : `Auto-activated at ${price}` })
              .eq('id', trade.id);

            if (!error) {
              updatedCount++;
              toast.success('📋 Trade Activated', {
                description: `${trade.instrument} ${trade.direction} pending order filled at ~${price}`,
              });
            }
          }
          continue; // Don't check TP/SL for pending trades
        }

        const result = checkTradeOutcome(trade, priceData.price);
        if (!result) continue;

        const now = new Date().toISOString();
        const targetNote = `Auto-closed (tick price): ${result.targetHit} hit at ${result.exitPrice}`;
        const existingNotes = trade.notes ? `${trade.notes}\n${targetNote}` : targetNote;

        const { error } = await supabase
          .from('trades')
          .update({
            outcome: result.outcome,
            exit_price: result.exitPrice,
            pnl_pips: parseFloat(result.pnlPips.toFixed(1)),
            exit_time: now,
            notes: existingNotes,
            target_hit: result.targetHit,
            resolution_method: 'tick',
          })
          .eq('id', trade.id);

        if (!error) {
          updatedCount++;
          const emoji = result.outcome === 'WIN' ? '🎯' : '🛑';
          toast.success(`${emoji} Trade Auto-Updated`, {
            description: `${trade.instrument} ${trade.direction} — ${result.targetHit} hit (${result.pnlPips > 0 ? '+' : ''}${result.pnlPips.toFixed(1)} pips)`,
          });
        }
      }

      if (updatedCount > 0) {
        onTradeUpdated();
      }
    } finally {
      isCheckingRef.current = false;
    }
  }, [trades, prices, isConnected, onTradeUpdated, getCandles]);

  // Auto-check on interval
  useEffect(() => {
    if (!isConnected) return;

    const interval = setInterval(checkAllTrades, TRADE_CHECK_INTERVAL);
    // Initial check after a short delay for prices to load
    const initialTimeout = setTimeout(checkAllTrades, 5000);

    return () => {
      clearInterval(interval);
      clearTimeout(initialTimeout);
    };
  }, [isConnected, checkAllTrades]);

  // Get live progress for all open trades
  const getTradeProgress = useCallback((trade: Trade) => {
    const priceData = prices[trade.instrument];
    if (!priceData || (trade.outcome && trade.outcome !== 'ACTIVE')) return null;
    return getTargetProgress(trade, priceData.price);
  }, [prices]);

  return {
    checkAllTrades,
    getTradeProgress,
    openTradeCount: trades.filter(t => (!t.outcome || t.outcome === 'ACTIVE') && (t.stop_loss || t.take_profit)).length,
  };
}
