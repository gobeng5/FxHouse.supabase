import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { OBVResult } from '@/lib/indicators';
import { cn } from '@/lib/utils';
import { BarChart3, TrendingUp, TrendingDown, Minus, AlertTriangle } from 'lucide-react';

interface VolumeAnalysisCardProps {
  obv: OBVResult;
}

export const VolumeAnalysisCard = ({ obv }: VolumeAnalysisCardProps) => {
  const trendIcon = obv.trend === 'bullish' ? TrendingUp : obv.trend === 'bearish' ? TrendingDown : Minus;
  const TrendIcon = trendIcon;

  const signalConfig: Record<string, { label: string; color: string; bg: string }> = {
    strong_buy: { label: 'STRONG BUY', color: 'text-bullish', bg: 'bg-bullish/15 border-bullish/30' },
    buy: { label: 'BUY', color: 'text-bullish', bg: 'bg-bullish/10 border-bullish/20' },
    neutral: { label: 'NEUTRAL', color: 'text-muted-foreground', bg: 'bg-muted/30 border-border/30' },
    sell: { label: 'SELL', color: 'text-bearish', bg: 'bg-bearish/10 border-bearish/20' },
    strong_sell: { label: 'STRONG SELL', color: 'text-bearish', bg: 'bg-bearish/15 border-bearish/30' },
  };

  const config = signalConfig[obv.signal];
  const hasDivergence = obv.divergence !== 'none';

  return (
    <Card className="bg-card/50 backdrop-blur border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary" />
          Volume Analysis (OBV)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Signal Badge */}
        <div className={cn('flex items-center justify-between p-3 rounded-lg border', config.bg)}>
          <div className="flex items-center gap-2">
            <TrendIcon className={cn('w-5 h-5', config.color)} />
            <div>
              <div className={cn('text-sm font-bold', config.color)}>{config.label}</div>
              <div className="text-[10px] text-muted-foreground">OBV Signal</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Trend</div>
            <div className={cn(
              'text-sm font-semibold capitalize',
              obv.trend === 'bullish' ? 'text-bullish' : obv.trend === 'bearish' ? 'text-bearish' : 'text-muted-foreground'
            )}>
              {obv.trend}
            </div>
          </div>
        </div>

        {/* Divergence Alert */}
        {hasDivergence && (
          <div className={cn(
            'flex items-center gap-2 p-2.5 rounded-lg border',
            obv.divergence === 'bullish_divergence'
              ? 'bg-bullish/10 border-bullish/20 text-bullish'
              : 'bg-bearish/10 border-bearish/20 text-bearish'
          )}>
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <div>
              <div className="text-xs font-semibold">
                {obv.divergence === 'bullish_divergence' ? 'Bullish Divergence' : 'Bearish Divergence'}
              </div>
              <div className="text-[10px] opacity-80">
                {obv.divergence === 'bullish_divergence'
                  ? 'Price falling but volume rising — potential reversal up'
                  : 'Price rising but volume falling — potential reversal down'}
              </div>
            </div>
          </div>
        )}

        {/* OBV Mini Chart (simplified bar representation) */}
        <div>
          <div className="text-[10px] text-muted-foreground uppercase font-semibold mb-2">OBV Momentum (Last 20)</div>
          <div className="flex items-end gap-0.5 h-12">
            {obv.values.slice(-20).map((val, i, arr) => {
              const min = Math.min(...arr);
              const max = Math.max(...arr);
              const range = max - min || 1;
              const height = Math.max(4, ((val - min) / range) * 48);
              const isRising = i > 0 ? val > arr[i - 1] : true;
              return (
                <div
                  key={i}
                  className={cn(
                    'flex-1 rounded-t-sm transition-all',
                    isRising ? 'bg-bullish/60' : 'bg-bearish/60'
                  )}
                  style={{ height: `${height}px` }}
                />
              );
            })}
          </div>
        </div>

        <p className="text-[10px] text-muted-foreground leading-relaxed">
          OBV uses price range as volume proxy. Rising OBV confirms price trends; divergences warn of potential reversals.
        </p>
      </CardContent>
    </Card>
  );
};
