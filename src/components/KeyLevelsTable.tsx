import { PriceLevel, TradingInstrument, getInstrumentDecimals } from '@/types/trading';
import { cn } from '@/lib/utils';
import { ArrowUp, ArrowDown, Target, XCircle, CircleDot } from 'lucide-react';

interface KeyLevelsTableProps {
  levels: PriceLevel[];
  currentPrice: number;
  criticalInvalidation: number;
  pair: TradingInstrument;
}

const getTypeIcon = (type: PriceLevel['type']) => {
  switch (type) {
    case 'resistance': return ArrowUp;
    case 'support': return ArrowDown;
    case 'entry': return Target;
    case 'stop_loss': return XCircle;
    case 'take_profit': return CircleDot;
  }
};

const getTypeColor = (type: PriceLevel['type']) => {
  switch (type) {
    case 'resistance': return 'text-bearish';
    case 'support': return 'text-bullish';
    case 'entry': return 'text-primary';
    case 'stop_loss': return 'text-bearish';
    case 'take_profit': return 'text-bullish';
  }
};

const getStrengthBadge = (strength: PriceLevel['strength']) => {
  switch (strength) {
    case 'strong': return 'bg-bullish/20 text-bullish border-bullish/30';
    case 'moderate': return 'bg-accent/20 text-accent border-accent/30';
    case 'weak': return 'bg-muted text-muted-foreground border-border';
  }
};

export const KeyLevelsTable = ({ levels, currentPrice, criticalInvalidation, pair }: KeyLevelsTableProps) => {
  const decimals = pair === 'USD/JPY' ? 2 : 4;
  const sortedLevels = [...levels].sort((a, b) => b.price - a.price);

  return (
    <div className="glass-card p-5 animate-fade-in-up" style={{ animationDelay: '0.3s' }}>
      <h3 className="section-title">Key Levels Summary</h3>

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              <th className="px-4 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Level</th>
              <th className="px-4 py-2 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Price</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Description</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider">Strength</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sortedLevels.map((level, index) => {
              const Icon = getTypeIcon(level.type);
              const isCurrentPrice = Math.abs(level.price - currentPrice) < (pair === 'USD/JPY' ? 0.05 : 0.0005);

              return (
                <tr 
                  key={index} 
                  className={cn(
                    'transition-colors hover:bg-muted/30',
                    isCurrentPrice && 'bg-primary/10'
                  )}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Icon className={cn('w-4 h-4', getTypeColor(level.type))} />
                      <span className={cn('text-sm font-medium capitalize', getTypeColor(level.type))}>
                        {level.type.replace('_', ' ')}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      'font-mono text-sm font-semibold',
                      level.price > currentPrice ? 'text-bearish' : 'text-bullish'
                    )}>
                      {level.price.toFixed(decimals)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-muted-foreground">{level.description}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={cn(
                      'inline-block px-2 py-0.5 text-xs font-medium rounded border capitalize',
                      getStrengthBadge(level.strength)
                    )}>
                      {level.strength}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 p-3 rounded-lg bg-bearish/10 border border-bearish/30">
        <div className="flex items-center gap-2">
          <XCircle className="w-4 h-4 text-bearish" />
          <span className="text-sm font-semibold text-bearish">Critical Invalidation</span>
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Analysis invalidated below this level</span>
          <span className="font-mono text-lg font-bold text-bearish">{criticalInvalidation.toFixed(decimals)}</span>
        </div>
      </div>
    </div>
  );
};
