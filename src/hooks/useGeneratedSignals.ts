import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { TradingInstrument, TrendDirection, TradeRecommendation } from '@/types/trading';
import { useAuth } from '@/hooks/useAuth';
import { getCurrentSessionInfo } from '@/lib/sessionUtils';

import { resolveIntrabar, pipsBetween, pipSize, IntrabarCandle } from '@/lib/intrabarResolution';
import { getSpread, appliedSpreadMultiplier, effectiveEntry as calcEffectiveEntry } from '@/lib/spreadConfig';


export type CandleFetcher = (
  instrument: string,
  granularity: number,
  count: number
) => Promise<IntrabarCandle[]>;

export interface GeneratedSignal {
  id: string;
  user_id: string | null;
  instrument: string;
  direction: TrendDirection;
  trade_type: 'swing' | 'day';
  confidence: number;
  setup_type: string | null;
  entry_price: number;
  /** Realistic fill price after spread (theoretical entry ± half spread) */
  effective_entry?: number | null;
  /** Spread used for the adjustment, in absolute price units (volatility-scaled) */
  spread_applied?: number | null;
  /** ATR percentile (0-100) at generation time */
  atr_percentile_at_entry?: number | null;
  /** Volatility multiplier applied to the base spread */
  spread_multiplier_applied?: number | null;

  stop_loss: number;
  take_profit_1: number;
  take_profit_2: number;
  take_profit_3: number;
  reasoning: string | null;
  outcome: 'pending' | 'won' | 'lost' | 'breakeven' | 'cancelled' | null;
  actual_exit_price: number | null;
  actual_pnl_pips: number | null;
  notes: string | null;
  /** How the outcome was decided: 'wick' = 1H OHLC path replay, 'tick' = live price compare */
  resolution_method?: 'tick' | 'wick' | null;
  session: string | null;
  generated_at: string;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SignalStats {
  totalSignals: number;
  pendingSignals: number;
  wonSignals: number;
  lostSignals: number;
  breakevenSignals: number;
  cancelledSignals: number;
  winRate: number;
  byInstrument: Record<string, { total: number; won: number; lost: number; winRate: number }>;
  byTradeType: Record<string, { total: number; won: number; lost: number; winRate: number }>;
}

export const useGeneratedSignals = () => {
  const { user } = useAuth();
  const [signals, setSignals] = useState<GeneratedSignal[]>([]);
  const [stats, setStats] = useState<SignalStats | null>(null);
  const [loading, setLoading] = useState(true);

  const calculateStats = useCallback((signalList: GeneratedSignal[]): SignalStats => {
    const closedSignals = signalList.filter(s => s.outcome && s.outcome !== 'pending');
    const wonSignals = signalList.filter(s => s.outcome === 'won').length;
    const lostSignals = signalList.filter(s => s.outcome === 'lost').length;
    const breakevenSignals = signalList.filter(s => s.outcome === 'breakeven').length;
    const cancelledSignals = signalList.filter(s => s.outcome === 'cancelled').length;
    const pendingSignals = signalList.filter(s => !s.outcome || s.outcome === 'pending').length;

    const completedTrades = wonSignals + lostSignals;
    const winRate = completedTrades > 0 ? (wonSignals / completedTrades) * 100 : 0;

    // By instrument
    const byInstrument: Record<string, { total: number; won: number; lost: number; winRate: number }> = {};
    signalList.forEach(signal => {
      if (!byInstrument[signal.instrument]) {
        byInstrument[signal.instrument] = { total: 0, won: 0, lost: 0, winRate: 0 };
      }
      byInstrument[signal.instrument].total++;
      if (signal.outcome === 'won') byInstrument[signal.instrument].won++;
      if (signal.outcome === 'lost') byInstrument[signal.instrument].lost++;
    });
    Object.keys(byInstrument).forEach(key => {
      const completed = byInstrument[key].won + byInstrument[key].lost;
      byInstrument[key].winRate = completed > 0 ? (byInstrument[key].won / completed) * 100 : 0;
    });

    // By trade type
    const byTradeType: Record<string, { total: number; won: number; lost: number; winRate: number }> = {};
    signalList.forEach(signal => {
      if (!byTradeType[signal.trade_type]) {
        byTradeType[signal.trade_type] = { total: 0, won: 0, lost: 0, winRate: 0 };
      }
      byTradeType[signal.trade_type].total++;
      if (signal.outcome === 'won') byTradeType[signal.trade_type].won++;
      if (signal.outcome === 'lost') byTradeType[signal.trade_type].lost++;
    });
    Object.keys(byTradeType).forEach(key => {
      const completed = byTradeType[key].won + byTradeType[key].lost;
      byTradeType[key].winRate = completed > 0 ? (byTradeType[key].won / completed) * 100 : 0;
    });

    return {
      totalSignals: signalList.length,
      pendingSignals,
      wonSignals,
      lostSignals,
      breakevenSignals,
      cancelledSignals,
      winRate,
      byInstrument,
      byTradeType,
    };
  }, []);

  const fetchSignals = useCallback(async () => {
    if (!user) {
      setSignals([]);
      setStats(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('generated_signals')
        .select('*')
        .eq('user_id', user.id)
        .order('generated_at', { ascending: false })
        .limit(500);

      if (error) {
        console.error('Error fetching signals:', error);
        return;
      }

      const typedSignals = (data || []) as GeneratedSignal[];
      setSignals(typedSignals);
      setStats(calculateStats(typedSignals));
    } catch (err) {
      console.error('Error fetching signals:', err);
    } finally {
      setLoading(false);
    }
  }, [user, calculateStats]);

  useEffect(() => {
    fetchSignals();
  }, [fetchSignals]);

  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel(`generated-signals-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'generated_signals',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          fetchSignals();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, fetchSignals]);

  const logSignal = useCallback(async (
    instrument: TradingInstrument,
    recommendation: TradeRecommendation,
    tradeType: 'swing' | 'day'
  ): Promise<GeneratedSignal | null> => {
    if (!user) return null;

    // Skip if direction is ranging
    if (recommendation.direction === 'ranging') {
      return null;
    }

    // --- Unified arbiter: the Postgres function `arbitrate_signal` is the single source
    //     of truth for conflicts, one-setup-per-pair and correlation blocking.
    //     Fail closed: if arbitration cannot be reached, the signal is not saved. ---
    try {
      const { data: verdict, error: arbErr } = await supabase.rpc('arbitrate_signal', {
        p_user_id: user.id,
        p_instrument: instrument,
        p_direction: recommendation.direction,
        p_trade_type: tradeType,
        p_confidence: Math.round(recommendation.confidence),
      });

      const v = verdict as { allowed?: boolean; reason?: string; code?: string; cancel_ids?: string[] } | null;

      if (arbErr || !v || typeof v.allowed !== 'boolean') {
        console.error('Arbitration unavailable — signal blocked (fail-closed):', arbErr);
        return null;
      }

      if (!v.allowed) {
        console.log(`[Arbiter] Blocked ${recommendation.direction} ${tradeType} ${instrument}: ${v.reason}`);
        return null;
      }

      for (const id of v.cancel_ids ?? []) {
        await supabase
          .from('generated_signals')
          .update({
            outcome: 'cancelled',
            closed_at: new Date().toISOString(),
            notes: `Auto-cancelled by arbiter: ${v.reason}`,
          })
          .eq('id', id);
      }
    } catch (err) {
      console.error('Arbiter check failed — signal blocked (fail-closed):', err);
      return null;
    }

    const sessionInfo = getCurrentSessionInfo(new Date());

    try {
      const { data, error } = await supabase
        .from('generated_signals')
        .insert({
          user_id: user.id,
          instrument,
          direction: recommendation.direction,
          trade_type: tradeType,
          confidence: recommendation.confidence,
          setup_type: recommendation.setupType,
          entry_price: recommendation.risk.entry,
          effective_entry:
            recommendation.risk.effectiveEntry ??
            calcEffectiveEntry(
              instrument,
              recommendation.direction === 'bearish' ? 'bearish' : 'bullish',
              recommendation.risk.entry
            ),
          spread_applied: recommendation.risk.spreadApplied ?? getSpread(instrument),
          atr_percentile_at_entry: recommendation.risk.atrPercentile ?? null,
          spread_multiplier_applied:
            recommendation.risk.spreadMultiplier ??
            appliedSpreadMultiplier(instrument, recommendation.risk.atrPercentile ?? null),

          stop_loss: recommendation.risk.stopLoss,
          take_profit_1: recommendation.risk.takeProfit1,
          take_profit_2: recommendation.risk.takeProfit2,
          take_profit_3: recommendation.risk.takeProfit3,
          reasoning: recommendation.reasoning,
          outcome: 'pending',
          session: sessionInfo.name,
          // Full per-component confluence breakdown, so future diagnostics never
          // have to infer components from the code that produced them.
          confluence_breakdown: recommendation.confidenceBreakdown?.length
            ? JSON.parse(JSON.stringify(recommendation.confidenceBreakdown))
            : null,
          confluence_score_total: recommendation.confidenceBreakdown?.length
            ? recommendation.confidenceBreakdown.reduce((s, i) => s + (i.weight ?? 0), 0)
            : null,
          confluence_score_max: recommendation.confidenceBreakdown?.length
            ? recommendation.confidenceBreakdown.reduce((s, i) => s + (i.maxWeight ?? 0), 0)
            : null,

        })
        .select()
        .single();

      if (error) {
        console.error('Error logging signal:', error);
        return null;
      }

      const typedSignal = data as GeneratedSignal;
      setSignals(prev => {
        const next = [typedSignal, ...prev];
        setStats(calculateStats(next));
        return next;
      });

      return typedSignal;
    } catch (err) {
      console.error('Error logging signal:', err);
      return null;
    }
  }, [user, calculateStats]);

  const updateSignalOutcome = useCallback(async (
    signalId: string,
    outcome: 'won' | 'lost' | 'breakeven' | 'cancelled',
    actualExitPrice?: number,
    actualPnlPips?: number,
    notes?: string,
    resolutionMethod?: 'tick' | 'wick'
  ): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from('generated_signals')
        .update({
          outcome,
          actual_exit_price: actualExitPrice,
          actual_pnl_pips: actualPnlPips,
          notes,
          resolution_method: resolutionMethod ?? null,
          closed_at: new Date().toISOString(),
        })
        .eq('id', signalId);

      if (error) {
        console.error('Error updating signal:', error);
        return false;
      }

      setSignals(prev => {
        const next = prev.map(s =>
          s.id === signalId
            ? { ...s, outcome, actual_exit_price: actualExitPrice || null, actual_pnl_pips: actualPnlPips || null, notes: notes || null, resolution_method: resolutionMethod ?? null, closed_at: new Date().toISOString() }
            : s
        );
        setStats(calculateStats(next));
        return next;
      });
      
      return true;
    } catch (err) {
      console.error('Error updating signal:', err);
      return false;
    }
  }, [calculateStats]);

  const deleteSignal = useCallback(async (signalId: string): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from('generated_signals')
        .delete()
        .eq('id', signalId);

      if (error) {
        console.error('Error deleting signal:', error);
        return false;
      }

      setSignals(prev => {
        const updatedSignals = prev.filter(s => s.id !== signalId);
        setStats(calculateStats(updatedSignals));
        return updatedSignals;
      });
      
      return true;
    } catch (err) {
      console.error('Error deleting signal:', err);
      return false;
    }
  }, [calculateStats]);

  // Check and auto-update signal outcome based on current price
  const checkSignalOutcome = useCallback((
    signal: GeneratedSignal,
    currentPrice: number
  ): { outcome: 'won' | 'lost' | null; exitPrice: number; pnlPips: number } | null => {
    if (signal.outcome !== 'pending') return null;
    
    const entryPrice = signal.entry_price;
    const stopLoss = signal.stop_loss;
    const tp1 = signal.take_profit_1;
    const tp2 = signal.take_profit_2;
    const tp3 = signal.take_profit_3;
    
    // Instrument-aware pip divisor (JPY, gold and synthetics use 0.01),
    // mirroring the server engine — a flat 10000 inflated index P&L massively.
    const pipMultiplier = 1 / pipSize(signal.instrument);

    
    if (signal.direction === 'bullish') {
      // Check stop loss hit
      if (currentPrice <= stopLoss) {
        const pnlPips = (stopLoss - entryPrice) * pipMultiplier;
        return { outcome: 'lost', exitPrice: stopLoss, pnlPips };
      }
      // Check TP3 hit (full target)
      if (currentPrice >= tp3) {
        const pnlPips = (tp3 - entryPrice) * pipMultiplier;
        return { outcome: 'won', exitPrice: tp3, pnlPips };
      }
      // Check TP2 hit (consider as win with partial)
      if (currentPrice >= tp2) {
        const pnlPips = (tp2 - entryPrice) * pipMultiplier;
        return { outcome: 'won', exitPrice: tp2, pnlPips };
      }
      // TP1 is NOT a closing trigger — trade stays open
    } else if (signal.direction === 'bearish') {
      // Check stop loss hit
      if (currentPrice >= stopLoss) {
        const pnlPips = (entryPrice - stopLoss) * pipMultiplier;
        return { outcome: 'lost', exitPrice: stopLoss, pnlPips };
      }
      // Check TP3 hit (full target)
      if (currentPrice <= tp3) {
        const pnlPips = (entryPrice - tp3) * pipMultiplier;
        return { outcome: 'won', exitPrice: tp3, pnlPips };
      }
      // Check TP2 hit
      if (currentPrice <= tp2) {
        const pnlPips = (entryPrice - tp2) * pipMultiplier;
        return { outcome: 'won', exitPrice: tp2, pnlPips };
      }
      // TP1 is NOT a closing trigger — trade stays open
    }
    
    return null;
  }, []);

  // Auto-update pending signals based on prices
  const autoCheckOutcomes = useCallback(async (
    prices: Record<string, { price: number }>,
    getCandles?: CandleFetcher
  ): Promise<{ updated: number; won: number; lost: number }> => {
    const pendingSignals = signals.filter(s => s.outcome === 'pending');
    let updated = 0;
    let won = 0;
    let lost = 0;
    
    for (const signal of pendingSignals) {
      const priceData = prices[signal.instrument];

      // Preferred path: wick-based intrabar resolution over 1H OHLC so that
      // "which level was hit first" is decided by candle path, not by whichever
      // tick we happened to sample.
      let result: { outcome: 'won' | 'lost' | null; exitPrice: number; pnlPips: number } | null = null;
      let note = '';
      let resolutionMethod: 'tick' | 'wick' = 'tick';

      if (getCandles) {
        try {
          const candles = await getCandles(signal.instrument, 3600, 300);
          const intrabar = resolveIntrabar(
            {
              direction: signal.direction === 'bearish' ? 'bearish' : 'bullish',
              entryPrice: signal.entry_price,
              stopLoss: signal.stop_loss,
              takeProfit1: signal.take_profit_1,
              takeProfit2: signal.take_profit_2,
              takeProfit3: signal.take_profit_3,
              generatedAtEpoch: Math.floor(new Date(signal.generated_at).getTime() / 1000),
              requiresFill: true,
              // Regime at generation time, not now — see spreadConfig.ts.
              spread: getSpread(signal.instrument),
              spreadMultiplier:
                signal.spread_multiplier_applied ??
                appliedSpreadMultiplier(signal.instrument, signal.atr_percentile_at_entry ?? null),
            },
            candles
          );

          if (intrabar.outcome && intrabar.exitPrice !== null) {
            const dir = signal.direction === 'bearish' ? 'bearish' : 'bullish';
            result = {
              outcome: intrabar.outcome,
              exitPrice: intrabar.exitPrice,
              // P&L measured from the realistic fill, not the theoretical entry.
              pnlPips: pipsBetween(signal.instrument, dir, intrabar.effectiveEntry, intrabar.exitPrice),
            };
            const when = intrabar.resolvedAtEpoch
              ? new Date(intrabar.resolvedAtEpoch * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' GMT'
              : 'unknown time';
            note = `Intrabar (1H wick) resolution: ${intrabar.targetHit} hit first at ${intrabar.exitPrice} (${when}); fill ${intrabar.effectiveEntry} after ${intrabar.spreadApplied} spread` +
              (intrabar.ambiguous ? ' — SL and TP inside same candle, resolved conservatively to SL' : '');

            resolutionMethod = 'wick';
          }
        } catch (err) {
          console.error('Intrabar resolution failed; signal left pending:', err);
        }
      }

      // Tick-based closing is retired. It had no entry-fill gate and no
      // intrabar ordering, which produced instant phantom wins/losses.
      // If wick replay cannot resolve a signal, it stays pending.
      void priceData;


      if (result?.outcome) {
        const success = await updateSignalOutcome(
          signal.id,
          result.outcome,
          result.exitPrice,
          parseFloat(result.pnlPips.toFixed(1)),
          note,
          resolutionMethod
        );
        
        if (success) {
          updated++;
          if (result.outcome === 'won') won++;
          if (result.outcome === 'lost') lost++;
        }
      }
    }
    
    return { updated, won, lost };
  }, [signals, checkSignalOutcome, updateSignalOutcome]);

  /**
   * Re-audits closed signals against 1H OHLC with a hard entry-fill gate.
   * Corrects outcomes where the stop was actually touched first, and resets to
   * pending any row whose entry never filled (phantom tick resolutions).
   */
  const reconcileClosedOutcomes = useCallback(async (
    getCandles: CandleFetcher
  ): Promise<{ checked: number; corrected: number; reset: number }> => {
    const closed = signals.filter(s => s.outcome === 'won' || s.outcome === 'lost');
    let corrected = 0;
    let reset = 0;

    // One candle pull per instrument (5000 x 1H ≈ 208 days), reused for all rows.
    const candleCache = new Map<string, IntrabarCandle[]>();
    const candlesFor = async (instrument: string) => {
      if (!candleCache.has(instrument)) {
        candleCache.set(instrument, await getCandles(instrument, 3600, 5000));
      }
      return candleCache.get(instrument)!;
    };

    for (const signal of closed) {
      try {
        const candles = await candlesFor(signal.instrument);
        if (!candles.length) continue;
        const genEpoch = Math.floor(new Date(signal.generated_at).getTime() / 1000);
        // Candle window does not reach this signal — cannot re-audit it.
        if (candles[0].epoch > genEpoch) continue;

        const dir = signal.direction === 'bearish' ? 'bearish' : 'bullish';
        const intrabar = resolveIntrabar(
          {
            direction: dir,
            entryPrice: signal.entry_price,
            stopLoss: signal.stop_loss,
            takeProfit1: signal.take_profit_1,
            takeProfit2: signal.take_profit_2,
            takeProfit3: signal.take_profit_3,
            generatedAtEpoch: genEpoch,
            requiresFill: true,
            spread: getSpread(signal.instrument),
            spreadMultiplier:
              signal.spread_multiplier_applied ??
              appliedSpreadMultiplier(signal.instrument, signal.atr_percentile_at_entry ?? null),
          },
          candles
        );

        if (!intrabar.outcome || intrabar.exitPrice === null) {
          // Never filled, or filled but still live → the recorded outcome was a phantom.
          const { error } = await supabase
            .from('generated_signals')
            .update({
              outcome: 'pending',
              actual_exit_price: null,
              actual_pnl_pips: null,
              closed_at: null,
              resolution_method: null,
              notes: intrabar.entryFilled
                ? '1H wick audit: entry filled, no level touched yet — reset to pending'
                : '1H wick audit: entry never filled — previous outcome was a phantom resolution',
            })
            .eq('id', signal.id);
          if (!error) reset++;
          continue;
        }

        if (intrabar.outcome === signal.outcome && signal.resolution_method === 'wick') continue;

        // P&L from the realistic fill, not the theoretical entry.
        const pnlPips = pipsBetween(signal.instrument, dir, intrabar.effectiveEntry, intrabar.exitPrice);
        const ok = await updateSignalOutcome(
          signal.id,
          intrabar.outcome,
          intrabar.exitPrice,
          parseFloat(pnlPips.toFixed(1)),
          `Corrected by fill-gated 1H wick audit: ${intrabar.targetHit} was hit first (was recorded as ${signal.outcome})`,
          'wick'
        );
        if (ok) corrected++;
      } catch (err) {
        console.error('Reconcile failed for signal', signal.id, err);
      }
    }

    await fetchSignals();
    return { checked: closed.length, corrected, reset };
  }, [signals, updateSignalOutcome, fetchSignals]);


  // Get all pending signals
  const getPendingSignals = useCallback(() => {
    return signals.filter(s => s.outcome === 'pending');
  }, [signals]);

  return {
    signals,
    stats,
    loading,
    logSignal,
    updateSignalOutcome,
    deleteSignal,
    refreshSignals: fetchSignals,
    checkSignalOutcome,
    autoCheckOutcomes,
    reconcileClosedOutcomes,
    getPendingSignals,
  };
};
