import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getKillZoneStatus, KillZoneStatus } from '@/lib/sessionUtils';
import { cn } from '@/lib/utils';
import { Crosshair, Clock, Zap } from 'lucide-react';
import { TradingInstrument } from '@/types/trading';

interface KillZoneIndicatorProps {
  instrument: TradingInstrument;
}

export const KillZoneIndicator = ({ instrument }: KillZoneIndicatorProps) => {
  const [status, setStatus] = useState<KillZoneStatus>(() => getKillZoneStatus());

  useEffect(() => {
    const interval = setInterval(() => {
      setStatus(getKillZoneStatus());
    }, 30000); // Update every 30 seconds
    return () => clearInterval(interval);
  }, []);

  const formatTime = (minutes: number) => {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  const colorMap: Record<string, string> = {
    info: 'text-info border-info/30 bg-info/10',
    bullish: 'text-bullish border-bullish/30 bg-bullish/10',
    primary: 'text-primary border-primary/30 bg-primary/10',
    warning: 'text-warning border-warning/30 bg-warning/10',
  };

  const dotColorMap: Record<string, string> = {
    info: 'bg-info',
    bullish: 'bg-bullish',
    primary: 'bg-primary',
    warning: 'bg-warning',
  };

  return (
    <Card className="bg-card/50 backdrop-blur border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Crosshair className="w-4 h-4 text-primary" />
          Kill Zones
          {status.isInKillZone && (
            <span className="ml-auto flex items-center gap-1.5 text-xs font-medium text-primary animate-pulse">
              <Zap className="w-3.5 h-3.5" />
              ACTIVE
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {status.allZones.map((kz) => {
          const isPairRelevant = kz.bestPairs.includes(instrument);
          return (
            <div
              key={kz.id}
              className={cn(
                'flex items-center justify-between p-2.5 rounded-lg border transition-all',
                kz.isActive
                  ? colorMap[kz.color]
                  : 'border-border/30 bg-muted/20',
                kz.isActive && 'ring-1 ring-offset-1 ring-offset-background',
                kz.isActive && kz.color === 'bullish' && 'ring-bullish/40',
                kz.isActive && kz.color === 'primary' && 'ring-primary/40',
                kz.isActive && kz.color === 'warning' && 'ring-warning/40',
                kz.isActive && kz.color === 'info' && 'ring-info/40',
              )}
            >
              <div className="flex items-center gap-2.5">
                <div className={cn(
                  'w-2 h-2 rounded-full',
                  kz.isActive ? `${dotColorMap[kz.color]} animate-pulse` : 'bg-muted-foreground/30'
                )} />
                <div>
                  <div className={cn(
                    'text-xs font-semibold',
                    kz.isActive ? '' : 'text-muted-foreground'
                  )}>
                    {kz.shortName}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {String(kz.startHour).padStart(2, '0')}:{String(kz.startMinute).padStart(2, '0')} - {String(kz.endHour).padStart(2, '0')}:{String(kz.endMinute).padStart(2, '0')} UTC
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {isPairRelevant && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                    {instrument}
                  </span>
                )}
                {kz.isActive ? (
                  <span className="text-[10px] font-bold uppercase">Now</span>
                ) : (
                  <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <Clock className="w-2.5 h-2.5" />
                    {formatTime(kz.minutesUntil)}
                  </span>
                )}
              </div>
            </div>
          );
        })}

        {/* Active Kill Zone Detail */}
        {status.active && (
          <div className={cn('mt-3 p-3 rounded-lg border', colorMap[status.active.color])}>
            <p className="text-xs leading-relaxed">{status.active.description}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {status.active.bestPairs.map(pair => (
                <span
                  key={pair}
                  className={cn(
                    'text-[10px] px-1.5 py-0.5 rounded',
                    pair === instrument
                      ? 'bg-primary/20 text-primary font-semibold'
                      : 'bg-muted/30 text-muted-foreground'
                  )}
                >
                  {pair}
                </span>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
