import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface PerformanceMetrics {
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  averageR: number;
  maxDrawdownPercent: number;
  totalRMultiple: number;
  byInstrument: Record<string, {
    total: number; won: number; lost: number; winRate: number;
    avgR: number; totalR: number; disabled: boolean;
  }>;
  equityCurve: { date: string; equity: number }[];
  recentSignals: any[];
}

export const usePerformanceMetrics = () => {
  const { user } = useAuth();
  const [signals, setSignals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSignals = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('generated_signals')
        .select('*')
        .eq('user_id', user.id)
        .order('generated_at', { ascending: false })
        .limit(1000);

      if (error) throw error;
      setSignals(data || []);
    } catch (err) {
      console.error('Error fetching performance data:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { fetchSignals(); }, [fetchSignals]);

  const metrics: PerformanceMetrics = useMemo(() => {
    const closed = signals.filter(s => s.outcome === 'won' || s.outcome === 'lost');
    const won = closed.filter(s => s.outcome === 'won');
    const lost = closed.filter(s => s.outcome === 'lost');
    const winRate = closed.length > 0 ? (won.length / closed.length) * 100 : 0;

    const totalWinR = won.reduce((s, sig) => s + (sig.r_multiple || 0), 0);
    const totalLossR = lost.reduce((s, sig) => s + Math.abs(sig.r_multiple || 0), 0);
    const profitFactor = totalLossR > 0 ? totalWinR / totalLossR : totalWinR > 0 ? Infinity : 0;
    
    const totalR = closed.reduce((s, sig) => s + (sig.r_multiple || 0), 0);
    const avgR = closed.length > 0 ? totalR / closed.length : 0;

    // By instrument
    const byInstrument: PerformanceMetrics['byInstrument'] = {};
    signals.forEach(sig => {
      if (!byInstrument[sig.instrument]) {
        byInstrument[sig.instrument] = { total: 0, won: 0, lost: 0, winRate: 0, avgR: 0, totalR: 0, disabled: false };
      }
      byInstrument[sig.instrument].total++;
      if (sig.outcome === 'won') { byInstrument[sig.instrument].won++; byInstrument[sig.instrument].totalR += (sig.r_multiple || 0); }
      if (sig.outcome === 'lost') { byInstrument[sig.instrument].lost++; byInstrument[sig.instrument].totalR += (sig.r_multiple || 0); }
    });
    Object.keys(byInstrument).forEach(key => {
      const inst = byInstrument[key];
      const completedInst = inst.won + inst.lost;
      inst.winRate = completedInst > 0 ? (inst.won / completedInst) * 100 : 0;
      inst.avgR = completedInst > 0 ? inst.totalR / completedInst : 0;
      inst.disabled = completedInst >= 10 && inst.winRate < 50; // Auto-disable below 50% win rate with enough samples
    });

    // Equity curve (simplified - cumulative R)
    const sortedClosed = [...closed].sort((a, b) => new Date(a.closed_at || a.generated_at).getTime() - new Date(b.closed_at || b.generated_at).getTime());
    let cumR = 100;
    let maxEquity = 100;
    let maxDrawdown = 0;
    const equityCurve = sortedClosed.map(sig => {
      cumR += (sig.r_multiple || 0);
      maxEquity = Math.max(maxEquity, cumR);
      const drawdown = ((maxEquity - cumR) / maxEquity) * 100;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
      return {
        date: (sig.closed_at || sig.generated_at).split('T')[0],
        equity: Number(cumR.toFixed(2)),
      };
    });

    return {
      totalTrades: closed.length,
      winRate: Number(winRate.toFixed(1)),
      profitFactor: Number(profitFactor.toFixed(2)),
      averageR: Number(avgR.toFixed(2)),
      maxDrawdownPercent: Number(maxDrawdown.toFixed(1)),
      totalRMultiple: Number(totalR.toFixed(2)),
      byInstrument,
      equityCurve,
      recentSignals: signals.slice(0, 20),
    };
  }, [signals]);

  return { metrics, loading, refetch: fetchSignals };
};
