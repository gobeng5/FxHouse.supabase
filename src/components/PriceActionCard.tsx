import { PriceActionAnalysis } from '@/lib/priceActionAnalysis';
import { cn } from '@/lib/utils';
import { 
  TrendingUp, TrendingDown, Minus, CandlestickChart, 
  Triangle, Flag, BarChart2, Target
} from 'lucide-react';

interface PriceActionCardProps {
  analysis: PriceActionAnalysis;
}

export const PriceActionCard = ({ analysis }: PriceActionCardProps) => {
  const getSignalIcon = (signal: 'bullish' | 'bearish' | 'neutral') => {
    switch (signal) {
      case 'bullish': return <TrendingUp className="w-4 h-4 text-emerald-400" />;
      case 'bearish': return <TrendingDown className="w-4 h-4 text-red-400" />;
      default: return <Minus className="w-4 h-4 text-amber-400" />;
    }
  };

  const getStrengthBadge = (strength: 'strong' | 'moderate' | 'weak') => {
    const colors = {
      strong: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
      moderate: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
      weak: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
    };
    return (
      <span className={cn('px-2 py-0.5 text-xs font-medium rounded-full border', colors[strength])}>
        {strength}
      </span>
    );
  };

  const getPatternIcon = (type: string) => {
    if (type.includes('triangle') || type.includes('wedge')) return <Triangle className="w-4 h-4" />;
    if (type.includes('flag') || type.includes('channel')) return <Flag className="w-4 h-4" />;
    if (type.includes('double') || type.includes('head')) return <BarChart2 className="w-4 h-4" />;
    return <CandlestickChart className="w-4 h-4" />;
  };

  const signalColors = {
    bullish: 'text-emerald-400',
    bearish: 'text-red-400',
    neutral: 'text-amber-400',
  };

  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <CandlestickChart className="w-5 h-5 text-purple-400" />
          <h3 className="text-lg font-semibold text-white">Price Action Analysis</h3>
          <span className="text-[10px] font-mono text-muted-foreground bg-muted/30 border border-border/30 rounded px-1.5 py-0.5"><span className="text-[10px] font-mono text-muted-foreground bg-muted/30 border border-border/30 rounded px-1.5 py-0.5">200D / 300 4H / 200 1H</span></span>
        </div>
        <div className="flex items-center gap-2">
          {getSignalIcon(analysis.dominantSignal)}
          <span className={cn('font-medium capitalize', signalColors[analysis.dominantSignal])}>
            {analysis.dominantSignal}
          </span>
          {analysis.signalStrength > 0 && (
            <span className="text-sm text-slate-400">
              ({analysis.signalStrength.toFixed(0)}%)
            </span>
          )}
        </div>
      </div>

      {/* Summary */}
      <p className="text-sm text-slate-300 mb-4 p-3 bg-slate-900/50 rounded-lg">
        {analysis.summary}
      </p>

      {/* Candlestick Patterns */}
      {analysis.candlestickPatterns.length > 0 && (
        <div className="mb-4">
          <h4 className="text-sm font-medium text-slate-400 mb-2 flex items-center gap-2">
            <CandlestickChart className="w-4 h-4" />
            Candlestick Patterns
          </h4>
          <div className="space-y-2">
            {analysis.candlestickPatterns.map((pattern, idx) => (
              <div 
                key={idx} 
                className="bg-slate-900/50 rounded-lg p-3 border border-slate-700/50"
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    {getSignalIcon(pattern.signal)}
                    <span className="font-medium text-white">{pattern.name}</span>
                  </div>
                  {getStrengthBadge(pattern.strength)}
                </div>
                <p className="text-xs text-slate-400">{pattern.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Chart Patterns */}
      {analysis.chartPatterns.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-slate-400 mb-2 flex items-center gap-2">
            <BarChart2 className="w-4 h-4" />
            Chart Patterns
          </h4>
          <div className="space-y-2">
            {analysis.chartPatterns.map((pattern, idx) => (
              <div 
                key={idx} 
                className="bg-slate-900/50 rounded-lg p-3 border border-slate-700/50"
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    {getPatternIcon(pattern.type)}
                    {getSignalIcon(pattern.signal)}
                    <span className="font-medium text-white">{pattern.name}</span>
                  </div>
                  {getStrengthBadge(pattern.strength)}
                </div>
                <p className="text-xs text-slate-400 mb-2">{pattern.description}</p>
                {(pattern.priceTarget || pattern.breakoutLevel) && (
                  <div className="flex gap-4 text-xs">
                    {pattern.breakoutLevel && (
                      <div className="flex items-center gap-1">
                        <Target className="w-3 h-3 text-blue-400" />
                        <span className="text-slate-500">Breakout:</span>
                        <span className="text-blue-400">{pattern.breakoutLevel.toFixed(5)}</span>
                      </div>
                    )}
                    {pattern.priceTarget && (
                      <div className="flex items-center gap-1">
                        <Target className="w-3 h-3 text-purple-400" />
                        <span className="text-slate-500">Target:</span>
                        <span className="text-purple-400">{pattern.priceTarget.toFixed(5)}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* No patterns */}
      {analysis.candlestickPatterns.length === 0 && analysis.chartPatterns.length === 0 && (
        <div className="text-center py-6 text-slate-500">
          <CandlestickChart className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>No significant patterns detected in current data</p>
        </div>
      )}
    </div>
  );
};
