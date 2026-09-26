import { TradePlan } from '@/types/trading';
import { cn } from '@/lib/utils';
import { CheckCircle2, AlertTriangle, RotateCcw, Clipboard, Play, Moon } from 'lucide-react';

interface ExecutionPlanProps {
  plan: TradePlan;
}

export const ExecutionPlan = ({ plan }: ExecutionPlanProps) => {
  const { alternativeScenarios, executionPlan } = plan;

  return (
    <div className="glass-card p-5 animate-fade-in-up" style={{ animationDelay: '0.35s' }}>
      <div className="flex items-center gap-2 mb-4">
        <Clipboard className="w-4 h-4 text-primary" />
        <h3 className="section-title mb-0">Execution Plan</h3>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {/* Pre-London Checklist */}
        <div className="p-4 rounded-lg bg-muted/30 border border-border">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 className="w-4 h-4 text-primary" />
            <h4 className="text-sm font-semibold">Pre-London Checklist</h4>
          </div>
          <ul className="space-y-2">
            {executionPlan.preLondonChecklist.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="w-5 h-5 rounded-full bg-primary/20 text-primary text-xs flex items-center justify-center flex-shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <span className="text-muted-foreground">{item}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* London Open Logic */}
        <div className="p-4 rounded-lg bg-muted/30 border border-border">
          <div className="flex items-center gap-2 mb-3">
            <Play className="w-4 h-4 text-bullish" />
            <h4 className="text-sm font-semibold">London Open Logic</h4>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {executionPlan.londonOpenLogic}
          </p>
        </div>

        {/* End of Day Review */}
        <div className="p-4 rounded-lg bg-muted/30 border border-border">
          <div className="flex items-center gap-2 mb-3">
            <Moon className="w-4 h-4 text-accent" />
            <h4 className="text-sm font-semibold">End of Day Review</h4>
          </div>
          <ul className="space-y-2">
            {executionPlan.endOfDayReview.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0 mt-2" />
                <span className="text-muted-foreground">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Alternative Scenarios */}
      <div className="border-t border-border pt-4">
        <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <RotateCcw className="w-4 h-4 text-accent" />
          Alternative Scenarios
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-3 rounded-lg bg-accent/10 border border-accent/30">
            <span className="text-xs font-semibold text-accent uppercase">Plan B</span>
            <p className="text-sm text-muted-foreground mt-1">{alternativeScenarios.planB}</p>
          </div>

          <div className="p-3 rounded-lg bg-bearish/10 border border-bearish/30">
            <span className="text-xs font-semibold text-bearish uppercase">Bias Flip Condition</span>
            <p className="text-sm text-muted-foreground mt-1">{alternativeScenarios.biasFlipCondition}</p>
          </div>
        </div>

        <div className="mt-4 p-3 rounded-lg bg-warning/10 border border-warning/30">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-warning" />
            <span className="text-xs font-semibold text-warning uppercase">Warning Signals</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {alternativeScenarios.warningSignals.map((signal, i) => (
              <span key={i} className="px-2 py-1 text-xs rounded bg-warning/20 text-warning border border-warning/30">
                {signal}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
