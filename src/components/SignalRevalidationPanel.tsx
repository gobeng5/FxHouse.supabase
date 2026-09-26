import { useMemo, useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ShieldCheck, ShieldAlert, Clock, Compass, XCircle, RefreshCw, TrendingDown } from 'lucide-react';
import { useGeneratedSignals } from '@/hooks/useGeneratedSignals';
import { useSignalRevalidation, RevalidationStatus } from '@/hooks/useSignalRevalidation';
import { TradingInstrument } from '@/types/trading';
import { toast } from 'sonner';

interface Props {
  prices: Record<string, { price: number }>;
  onReanalyze?: (instrument: TradingInstrument) => void;
}

const STATUS_META: Record<RevalidationStatus, { label: string; tone: string; icon: React.ComponentType<{ className?: string }> }> = {
  valid: { label: 'Valid', tone: 'bg-bullish/15 text-bullish border-bullish/30', icon: ShieldCheck },
  stale: { label: 'Stale', tone: 'bg-amber-500/15 text-amber-500 border-amber-500/30', icon: Clock },
  drifted: { label: 'Drifted', tone: 'bg-orange-500/15 text-orange-500 border-orange-500/30', icon: Compass },
  invalidated: { label: 'Invalidated', tone: 'bg-bearish/15 text-bearish border-bearish/30', icon: ShieldAlert },
};

export const SignalRevalidationPanel = ({ prices, onReanalyze }: Props) => {
  const { signals, updateSignalOutcome } = useGeneratedSignals();
  const results = useSignalRevalidation(signals, prices);

  const AUTO_KEY = 'auto-revalidate-signals';
  const COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes per instrument
  const [autoRevalidate, setAutoRevalidate] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(AUTO_KEY) === '1';
  });
  const lastTriggered = useRef<Record<string, number>>({});

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(AUTO_KEY, autoRevalidate ? '1' : '0');
    }
  }, [autoRevalidate]);

  useEffect(() => {
    if (!autoRevalidate || !onReanalyze) return;
    const now = Date.now();
    const candidates = results.filter(r => r.status === 'stale' || r.status === 'drifted');
    for (const r of candidates) {
      const inst = r.signal.instrument as TradingInstrument;
      const last = lastTriggered.current[inst] ?? 0;
      if (now - last < COOLDOWN_MS) continue;
      lastTriggered.current[inst] = now;
      toast.info(`Auto re-analyzing ${inst} (${r.status})`);
      onReanalyze(inst);
      break; // one at a time to avoid stampede
    }
  }, [results, autoRevalidate, onReanalyze]);

  const summary = useMemo(() => {
    return results.reduce(
      (acc, r) => {
        acc[r.status] = (acc[r.status] || 0) + 1;
        return acc;
      },
      { valid: 0, stale: 0, drifted: 0, invalidated: 0 } as Record<RevalidationStatus, number>
    );
  }, [results]);

  const sorted = useMemo(() => {
    const order: Record<RevalidationStatus, number> = { invalidated: 0, drifted: 1, stale: 2, valid: 3 };
    return [...results].sort((a, b) => order[a.status] - order[b.status]);
  }, [results]);

  const handleCancel = async (id: string, reason: string) => {
    const ok = await updateSignalOutcome(id, 'cancelled', undefined, undefined, `Cancelled via re-validation: ${reason}`);
    if (ok) toast.success('Signal cancelled');
    else toast.error('Could not cancel signal');
  };

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="w-4 h-4 text-primary" />
            Pending Signal Re-Validation
          </CardTitle>
          <div className="flex items-center gap-1.5 text-xs">
            {(['invalidated', 'drifted', 'stale', 'valid'] as RevalidationStatus[]).map(s => (
              <Badge key={s} variant="outline" className={`${STATUS_META[s].tone} text-[10px] px-1.5 py-0`}>
                {summary[s]} {STATUS_META[s].label}
              </Badge>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-border/40">
          <Label htmlFor="auto-reval" className="text-xs text-muted-foreground cursor-pointer flex items-center gap-1.5">
            <RefreshCw className="w-3 h-3" />
            Auto re-analyze stale / drifted signals
          </Label>
          <Switch
            id="auto-reval"
            checked={autoRevalidate}
            onCheckedChange={setAutoRevalidate}
            disabled={!onReanalyze}
          />
        </div>
        {autoRevalidate && (
          <p className="text-[10px] text-muted-foreground mt-1">
            Triggers automatically when a pending signal goes stale or drifts. Throttled to once per 10 min per instrument.
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {sorted.length === 0 && (
          <p className="text-xs text-muted-foreground py-3 text-center">No pending signals to re-validate.</p>
        )}
        {sorted.map(({ signal, status, ageHours, currentPrice, distanceToEntryPips, reason, decayedConfidence, confidenceDelta, decayFactors, liveRiskReward, liveStopDistancePips, liveTargetDistancePips }) => {
          const meta = STATUS_META[status];
          const Icon = meta.icon;
          const decayed = confidenceDelta < 0;
          return (
            <div
              key={signal.id}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 rounded-md border border-border/40 bg-muted/20"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className={`${meta.tone} gap-1 text-[10px]`}>
                    <Icon className="w-3 h-3" />
                    {meta.label}
                  </Badge>
                  <span className="text-xs font-medium">{signal.instrument}</span>
                  <span className={`text-[10px] uppercase ${signal.direction === 'bullish' ? 'text-bullish' : 'text-bearish'}`}>
                    {signal.direction}
                  </span>
                  <span className="text-[10px] text-muted-foreground uppercase">{signal.trade_type}</span>
                  <span className="text-[10px] text-muted-foreground">
                    conf{' '}
                    {decayed ? (
                      <>
                        <span className="line-through opacity-60">{signal.confidence}%</span>{' '}
                        <span className={decayedConfidence < 60 ? 'text-bearish font-medium' : 'text-amber-500 font-medium'}>
                          {decayedConfidence}%
                        </span>
                      </>
                    ) : (
                      <>{signal.confidence}%</>
                    )}
                  </span>
                  {decayed && (
                    <span className="text-[10px] text-muted-foreground inline-flex items-center gap-0.5">
                      <TrendingDown className="w-3 h-3" />
                      {confidenceDelta}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{reason}</p>
                <div className="flex gap-3 text-[10px] text-muted-foreground mt-0.5">
                  <span>age {ageHours.toFixed(1)}h</span>
                  {currentPrice !== null && <span>price {currentPrice}</span>}
                  {distanceToEntryPips !== null && <span>Δentry {distanceToEntryPips.toFixed(0)}p</span>}
                </div>
                <div className="flex gap-3 text-[10px] text-muted-foreground mt-0.5 flex-wrap">
                  {liveRiskReward !== null && (
                    <span className={liveRiskReward < 1.5 ? 'text-bearish' : ''}>live RR {liveRiskReward.toFixed(2)}</span>
                  )}
                  {liveStopDistancePips !== null && <span>risk {liveStopDistancePips.toFixed(0)}p</span>}
                  {liveTargetDistancePips !== null && <span>reward {liveTargetDistancePips.toFixed(0)}p</span>}
                  {decayed && (
                    <span className="opacity-70">
                      decay: age -{decayFactors.time} / drift -{decayFactors.drift} / SL -{decayFactors.slProximity}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-1.5">
                {onReanalyze && (status === 'stale' || status === 'drifted') && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px] gap-1"
                    onClick={() => onReanalyze(signal.instrument as TradingInstrument)}
                  >
                    <RefreshCw className="w-3 h-3" /> Re-analyze
                  </Button>
                )}
                {(status === 'invalidated' || status === 'drifted' || status === 'stale') && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-[11px] gap-1 text-bearish hover:text-bearish hover:bg-bearish/10"
                    onClick={() => handleCancel(signal.id, status)}
                  >
                    <XCircle className="w-3 h-3" /> Cancel
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
};
