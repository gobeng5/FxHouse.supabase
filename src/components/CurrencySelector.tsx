import { TradingInstrument, FOREX_PAIRS, SYNTHETIC_INDICES, isSyntheticIndex, getInstrumentDecimals } from '@/types/trading';
import { INSTRUMENT_DISPLAY_NAMES } from '@/lib/deriv';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Minus, Zap } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { useState } from 'react';

interface InstrumentSelectorProps {
  selected: TradingInstrument;
  onChange: (instrument: TradingInstrument) => void;
  pairData: Record<TradingInstrument, { price: number; change: number; trend: 'up' | 'down' | 'flat' }>;
}

export const CurrencySelector = ({ selected, onChange, pairData }: InstrumentSelectorProps) => {
  const [activeTab, setActiveTab] = useState<'forex' | 'synthetic'>(
    isSyntheticIndex(selected) ? 'synthetic' : 'forex'
  );

  const instruments = activeTab === 'forex' ? FOREX_PAIRS : SYNTHETIC_INDICES;

  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'forex' | 'synthetic')}>
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="forex" className="gap-2">
            <span className="font-medium">Forex</span>
          </TabsTrigger>
          <TabsTrigger value="synthetic" className="gap-2">
            <Zap className="w-4 h-4" />
            <span className="font-medium">Synthetics 24/7</span>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
        {instruments.map((instrument) => {
          const data = pairData[instrument];
          const isSelected = selected === instrument;
          const TrendIcon = data.trend === 'up' ? TrendingUp : data.trend === 'down' ? TrendingDown : Minus;
          const decimals = getInstrumentDecimals(instrument);
          const displayName = INSTRUMENT_DISPLAY_NAMES[instrument];

          return (
            <button
              key={instrument}
              onClick={() => onChange(instrument)}
              className={cn(
                'glass-card px-5 py-4 transition-all duration-300 group',
                isSelected 
                  ? 'border-primary/50 glow-primary' 
                  : 'hover:border-border/80 hover:bg-card/90'
              )}
            >
              <div className="flex items-center justify-between mb-2">
                <span className={cn(
                  'font-semibold text-lg tracking-tight transition-colors',
                  isSelected ? 'text-primary' : 'text-foreground group-hover:text-primary'
                )}>
                  {displayName}
                </span>
                <TrendIcon className={cn(
                  'w-4 h-4',
                  data.trend === 'up' ? 'text-bullish' : data.trend === 'down' ? 'text-bearish' : 'text-muted-foreground'
                )} />
              </div>
              <div className="flex items-end justify-between">
                {data.price > 0 ? (
                  <>
                    <span className="font-mono text-2xl font-bold tracking-tight">
                      {data.price.toFixed(decimals)}
                    </span>
                    <span className={cn(
                      'font-mono text-sm font-medium',
                      data.change >= 0 ? 'text-bullish' : 'text-bearish'
                    )}>
                      {`${data.change >= 0 ? '+' : ''}${data.change.toFixed(decimals)}`}
                    </span>
                  </>
                ) : (
                  <>
                    <Skeleton className="h-8 w-24 rounded" />
                    <Skeleton className="h-4 w-14 rounded" />
                  </>
                )}
              </div>
              {isSyntheticIndex(instrument) && (
                <div className="mt-2 flex items-center gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-bullish animate-pulse" />
                  <span className="text-xs text-muted-foreground">24/7 Trading</span>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
