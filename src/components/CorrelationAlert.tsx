import { useMemo } from 'react';
import { TradingInstrument, TradePlan } from '@/types/trading';
import { checkCorrelationConflicts, getCorrelationRiskScore, SignalDirection, CorrelationConflict } from '@/lib/correlation';
import { useCorrelationPairs } from '@/hooks/useCorrelationPairs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, ShieldAlert, CheckCircle2 } from 'lucide-react';

interface CorrelationAlertProps {
  currentPlan: TradePlan;
  /** Any other active signals from other instruments the user has analyzed */
  otherSignals?: SignalDirection[];
}

export const CorrelationAlert = ({ currentPlan, otherSignals = [] }: CorrelationAlertProps) => {
  const activeSignals: SignalDirection[] = useMemo(() => {
    const signals: SignalDirection[] = [...otherSignals];

    // Add current plan's swing recommendation
    if (currentPlan.recommendation.direction !== 'ranging') {
      // Avoid duplicates
      if (!signals.find(s => s.instrument === currentPlan.pair)) {
        signals.push({
          instrument: currentPlan.pair,
          direction: currentPlan.recommendation.direction,
          confidence: currentPlan.recommendation.confidence,
        });
      }
    }

    return signals;
  }, [currentPlan, otherSignals]);

  const { pairs } = useCorrelationPairs();
  const conflicts = useMemo(() => checkCorrelationConflicts(activeSignals, pairs), [activeSignals, pairs]);
  const riskScore = useMemo(() => getCorrelationRiskScore(conflicts), [conflicts]);

  if (activeSignals.length < 2) {
    return (
      <Card className="glass-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-muted-foreground" />
            Multi-Pair Correlation
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            Run analysis on 2+ forex pairs to check for signal conflicts between correlated instruments.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="glass-card">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-primary" />
            Correlation Filter
          </CardTitle>
          <Badge variant={riskScore === 0 ? 'default' : riskScore < 50 ? 'secondary' : 'destructive'} className="text-[10px]">
            {riskScore === 0 ? 'Clear' : `Risk: ${riskScore}`}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* Active signals summary */}
        <div className="flex flex-wrap gap-1.5 mb-2">
          {activeSignals.map(s => (
            <Badge key={s.instrument} variant="outline" className="text-[10px] gap-1">
              <span className={s.direction === 'bullish' ? 'text-bullish' : 'text-bearish'}>
                {s.direction === 'bullish' ? '▲' : '▼'}
              </span>
              {s.instrument}
            </Badge>
          ))}
        </div>

        {conflicts.length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-bullish">
            <CheckCircle2 className="w-3.5 h-3.5" />
            No conflicting signals detected — correlations are aligned.
          </div>
        ) : (
          <div className="space-y-2">
            {conflicts.map((c, i) => (
              <Alert key={i} className={`py-2 ${c.severity === 'critical' ? 'border-destructive/50 bg-destructive/10' : 'border-warning/50 bg-warning/10'}`}>
                <AlertTriangle className={`h-3.5 w-3.5 ${c.severity === 'critical' ? 'text-destructive' : 'text-warning'}`} />
                <AlertDescription className="text-xs">
                  <span className="font-medium">{c.pair1} ↔ {c.pair2}:</span> {c.conflict}
                </AlertDescription>
              </Alert>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
