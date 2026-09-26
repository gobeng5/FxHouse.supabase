import { TrendDirection } from '@/types/trading';
import { TrendingUp, TrendingDown, Minus, History } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';

export interface SignalHistoryEntry {
  id: string;
  direction: TrendDirection;
  tradeType: 'swing' | 'day';
  timestamp: Date;
  pair: string;
}

interface SignalHistoryProps {
  history: SignalHistoryEntry[];
}

const getDirectionIcon = (direction: TrendDirection) => {
  switch (direction) {
    case 'bullish':
      return TrendingUp;
    case 'bearish':
      return TrendingDown;
    default:
      return Minus;
  }
};

const getDirectionStyles = (direction: TrendDirection) => {
  switch (direction) {
    case 'bullish':
      return {
        bg: 'bg-bullish/10',
        border: 'border-bullish/30',
        text: 'text-bullish',
        label: 'BUY',
      };
    case 'bearish':
      return {
        bg: 'bg-bearish/10',
        border: 'border-bearish/30',
        text: 'text-bearish',
        label: 'SELL',
      };
    default:
      return {
        bg: 'bg-amber-500/10',
        border: 'border-amber-500/30',
        text: 'text-amber-500',
        label: 'RANGE',
      };
  }
};

const formatTime = (date: Date) => {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'GMT',
  }) + ' GMT';
};

const formatDate = (date: Date) => {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) {
    return 'Today';
  } else if (date.toDateString() === yesterday.toDateString()) {
    return 'Yesterday';
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

export const SignalHistory = ({ history }: SignalHistoryProps) => {
  if (history.length === 0) {
    return (
      <div className="p-4 text-center text-muted-foreground text-sm">
        <History className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p>No signal changes yet</p>
        <p className="text-xs mt-1">Direction changes will appear here</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-[200px]">
      <div className="space-y-2 pr-4">
        {history.map((entry, index) => {
          const Icon = getDirectionIcon(entry.direction);
          const styles = getDirectionStyles(entry.direction);
          const isLatest = index === 0;

          return (
            <div
              key={entry.id}
              className={cn(
                'flex items-center gap-3 p-3 rounded-lg border transition-all',
                styles.bg,
                styles.border,
                isLatest && 'ring-1 ring-primary/50'
              )}
            >
              <div className={cn('w-8 h-8 rounded-full flex items-center justify-center', styles.bg)}>
                <Icon className={cn('w-4 h-4', styles.text)} />
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={cn('font-semibold text-sm', styles.text)}>
                    {styles.label}
                  </span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground capitalize">
                    {entry.tradeType}
                  </span>
                  {isLatest && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-primary/20 text-primary font-medium">
                      Latest
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {entry.pair}
                </p>
              </div>
              
              <div className="text-right shrink-0">
                <p className="text-sm font-medium text-foreground">{formatTime(entry.timestamp)}</p>
                <p className="text-xs text-muted-foreground">{formatDate(entry.timestamp)}</p>
              </div>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
};
