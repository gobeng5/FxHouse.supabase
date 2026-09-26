import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { toast } from 'sonner';

export interface Trade {
  id: string;
  user_id: string;
  instrument: string;
  direction: 'BUY' | 'SELL';
  entry_price: number;
  /** Realistic fill price after spread */
  effective_entry?: number | null;
  /** Spread applied, in absolute price units */
  spread_applied?: number | null;

  exit_price: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  take_profit_2: number | null;
  take_profit_3: number | null;
  lot_size: number;
  setup_type: string | null;
  notes: string | null;
  outcome: 'WIN' | 'LOSS' | 'BREAKEVEN' | 'ACTIVE' | 'PENDING' | null;
  pnl_pips: number | null;
  pnl_amount: number | null;
  entry_time: string;
  exit_time: string | null;
  target_hit: string | null;
  created_at: string;
  updated_at: string;
}

export interface TradeInput {
  instrument: string;
  direction: 'BUY' | 'SELL';
  entry_price: number;
  effective_entry?: number | null;
  spread_applied?: number | null;

  exit_price?: number | null;
  stop_loss?: number | null;
  take_profit?: number | null;
  take_profit_2?: number | null;
  take_profit_3?: number | null;
  lot_size: number;
  setup_type?: string | null;
  notes?: string | null;
  outcome?: 'WIN' | 'LOSS' | 'BREAKEVEN' | 'ACTIVE' | 'PENDING' | null;
  pnl_pips?: number | null;
  pnl_amount?: number | null;
  entry_time?: string;
  exit_time?: string | null;
  target_hit?: string | null;
}

export function getPipValue(instrument: string): number {
  const syntheticIndices = ['V10', 'V25', 'V50', 'V75', 'V100', 'BOOM1000'];
  if (syntheticIndices.includes(instrument)) return 0.01;
  if (instrument === 'USD/JPY' || instrument === 'GBP/JPY') return 0.01;
  if (instrument === 'XAU/USD') return 0.01;
  return 0.0001;
}

export function calculatePnlPips(instrument: string, direction: 'BUY' | 'SELL', entryPrice: number, exitPrice: number): number {
  const pipVal = getPipValue(instrument);
  const diff = direction === 'BUY' ? exitPrice - entryPrice : entryPrice - exitPrice;
  return diff / pipVal;
}

export interface TradeStats {
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  totalPnlPips: number;
  totalPnlAmount: number;
  averageWin: number;
  averageLoss: number;
  largestWin: number;
  largestLoss: number;
  byInstrument: Record<string, { wins: number; losses: number; pnl: number }>;
  bySetup: Record<string, { wins: number; losses: number; pnl: number }>;
  targetHitDistribution: { tp1: number; tp2: number; tp3: number; sl: number };
}

export function useTrades() {
  const { user } = useAuth();
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<TradeStats | null>(null);

  const fetchTrades = useCallback(async () => {
    if (!user) {
      setTrades([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const { data, error } = await supabase
      .from('trades')
      .select('*')
      .eq('user_id', user.id)
      .order('entry_time', { ascending: false });

    if (error) {
      toast.error('Failed to load trades', { description: error.message });
      setLoading(false);
      return;
    }

    const typedTrades = (data || []).map(trade => ({
      ...trade,
      entry_price: Number(trade.entry_price),
      effective_entry: trade.effective_entry != null ? Number(trade.effective_entry) : null,
      spread_applied: trade.spread_applied != null ? Number(trade.spread_applied) : null,

      exit_price: trade.exit_price ? Number(trade.exit_price) : null,
      stop_loss: trade.stop_loss ? Number(trade.stop_loss) : null,
      take_profit: trade.take_profit ? Number(trade.take_profit) : null,
      take_profit_2: trade.take_profit_2 ? Number(trade.take_profit_2) : null,
      take_profit_3: trade.take_profit_3 ? Number(trade.take_profit_3) : null,
      lot_size: Number(trade.lot_size),
      pnl_pips: trade.pnl_pips ? Number(trade.pnl_pips) : null,
      pnl_amount: trade.pnl_amount ? Number(trade.pnl_amount) : null,
    })) as Trade[];

    setTrades(typedTrades);
    calculateStats(typedTrades);
    setLoading(false);
  }, [user]);

  const calculateStats = (tradeList: Trade[]) => {
    const closedTrades = tradeList.filter(t => t.outcome && t.outcome !== 'ACTIVE' && t.outcome !== 'PENDING');
    const wins = closedTrades.filter(t => t.outcome === 'WIN');
    const losses = closedTrades.filter(t => t.outcome === 'LOSS');

    const totalWinPips = wins.reduce((sum, t) => sum + (t.pnl_pips || 0), 0);
    const totalLossPips = Math.abs(losses.reduce((sum, t) => sum + (t.pnl_pips || 0), 0));

    const byInstrument: Record<string, { wins: number; losses: number; pnl: number }> = {};
    const bySetup: Record<string, { wins: number; losses: number; pnl: number }> = {};

    closedTrades.forEach(trade => {
      // By instrument
      if (!byInstrument[trade.instrument]) {
        byInstrument[trade.instrument] = { wins: 0, losses: 0, pnl: 0 };
      }
      if (trade.outcome === 'WIN') byInstrument[trade.instrument].wins++;
      if (trade.outcome === 'LOSS') byInstrument[trade.instrument].losses++;
      byInstrument[trade.instrument].pnl += trade.pnl_pips || 0;

      // By setup
      const setupKey = trade.setup_type || 'Unknown';
      if (!bySetup[setupKey]) {
        bySetup[setupKey] = { wins: 0, losses: 0, pnl: 0 };
      }
      if (trade.outcome === 'WIN') bySetup[setupKey].wins++;
      if (trade.outcome === 'LOSS') bySetup[setupKey].losses++;
      bySetup[setupKey].pnl += trade.pnl_pips || 0;
    });

    const winPnls = wins.map(t => t.pnl_pips || 0);
    const lossPnls = losses.map(t => Math.abs(t.pnl_pips || 0));

    // Target hit distribution - parse from target_hit column or notes
    const targetHitDistribution = { tp1: 0, tp2: 0, tp3: 0, sl: 0 };
    closedTrades.forEach(trade => {
      const hit = trade.target_hit?.toUpperCase() || '';
      if (hit === 'TP1') targetHitDistribution.tp1++;
      else if (hit === 'TP2') targetHitDistribution.tp2++;
      else if (hit === 'TP3') targetHitDistribution.tp3++;
      else if (hit === 'SL') targetHitDistribution.sl++;
      else if (trade.notes) {
        // Fallback: parse from auto-close notes
        if (trade.notes.includes('TP3 hit')) targetHitDistribution.tp3++;
        else if (trade.notes.includes('TP2 hit')) targetHitDistribution.tp2++;
        else if (trade.notes.includes('TP1 hit')) targetHitDistribution.tp1++;
        else if (trade.notes.includes('SL hit')) targetHitDistribution.sl++;
      }
    });

    setStats({
      totalTrades: closedTrades.length,
      winRate: closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0,
      profitFactor: totalLossPips > 0 ? totalWinPips / totalLossPips : totalWinPips > 0 ? Infinity : 0,
      totalPnlPips: closedTrades.reduce((sum, t) => sum + (t.pnl_pips || 0), 0),
      totalPnlAmount: closedTrades.reduce((sum, t) => sum + (t.pnl_amount || 0), 0),
      averageWin: wins.length > 0 ? totalWinPips / wins.length : 0,
      averageLoss: losses.length > 0 ? totalLossPips / losses.length : 0,
      largestWin: winPnls.length > 0 ? Math.max(...winPnls) : 0,
      largestLoss: lossPnls.length > 0 ? Math.max(...lossPnls) : 0,
      byInstrument,
      bySetup,
      targetHitDistribution,
    });
  };

  useEffect(() => {
    fetchTrades();
  }, [fetchTrades]);

  const addTrade = async (trade: TradeInput) => {
    if (!user) {
      toast.error('Please sign in to add trades');
      return null;
    }

    const { data, error } = await supabase
      .from('trades')
      .insert({
        ...trade,
        user_id: user.id,
      })
      .select()
      .single();

    if (error) {
      toast.error('Failed to add trade', { description: error.message });
      return null;
    }

    toast.success('Trade logged successfully');
    await fetchTrades();
    return data;
  };

  const updateTrade = async (id: string, updates: Partial<TradeInput>) => {
    const { error } = await supabase
      .from('trades')
      .update(updates)
      .eq('id', id);

    if (error) {
      toast.error('Failed to update trade', { description: error.message });
      return false;
    }

    toast.success('Trade updated');
    await fetchTrades();
    return true;
  };

  const deleteTrade = async (id: string) => {
    const { error } = await supabase
      .from('trades')
      .delete()
      .eq('id', id);

    if (error) {
      toast.error('Failed to delete trade', { description: error.message });
      return false;
    }

    toast.success('Trade deleted');
    await fetchTrades();
    return true;
  };

  return {
    trades,
    stats,
    loading,
    addTrade,
    updateTrade,
    deleteTrade,
    refreshTrades: fetchTrades,
  };
}