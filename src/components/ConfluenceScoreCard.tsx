import { ConfluenceScore } from '@/types/trading';
import { cn } from '@/lib/utils';
import { Target, Activity, Layers, Scale, CloudSun, Brain } from 'lucide-react';

interface ConfluenceScoreCardProps {
  score: ConfluenceScore;
}

const scoreItems = [
  { key: 'priceAction', label: 'Price Action', icon: Target, max: 8 },
  { key: 'indicators', label: 'Indicators', icon: Activity, max: 8 },
  { key: 'multiTimeframe', label: 'MTF Alignment', icon: Layers, max: 8 },
  { key: 'smcConfluence', label: 'SMC Confluence', icon: Brain, max: 12 },
  { key: 'riskReward', label: 'Risk/Reward', icon: Scale, max: 4 },
  { key: 'marketConditions', label: 'Market Conditions', icon: CloudSun, max: 4 },
] as const;

const getLevelColor = (level: ConfluenceScore['level']) => {
  switch (level) {
    case 'excellent': return 'text-bullish';
    case 'good': return 'text-primary';
    case 'marginal': return 'text-accent';
    case 'no_trade': return 'text-bearish';
  }
};

const getLevelBg = (level: ConfluenceScore['level']) => {
  switch (level) {
    case 'excellent': return 'bg-bullish/20 border-bullish/40';
    case 'good': return 'bg-primary/20 border-primary/40';
    case 'marginal': return 'bg-accent/20 border-accent/40';
    case 'no_trade': return 'bg-bearish/20 border-bearish/40';
  }
};

export const ConfluenceScoreCard = ({ score }: ConfluenceScoreCardProps) => {
  const maxScore = 48;
  const percentage = (score.total / maxScore) * 100;

  return (
    <div className="glass-card p-5 animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
      <h3 className="section-title">Confluence Score</h3>

      <div className="flex items-center gap-6 mb-6">
        <div className="relative w-24 h-24">
          <svg className="w-full h-full transform -rotate-90">
            <circle
              cx="48"
              cy="48"
              r="40"
              fill="none"
              stroke="hsl(var(--muted))"
              strokeWidth="8"
            />
            <circle
              cx="48"
              cy="48"
              r="40"
              fill="none"
              stroke="hsl(var(--primary))"
              strokeWidth="8"
              strokeDasharray={`${percentage * 2.51} 251`}
              strokeLinecap="round"
              className="transition-all duration-1000 ease-out"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-mono text-2xl font-bold">{score.total}</span>
            <span className="text-xs text-muted-foreground">/{maxScore}</span>
          </div>
        </div>

        <div className="flex-1">
          <div className={cn(
            'inline-flex items-center px-3 py-1.5 rounded-full text-sm font-semibold uppercase tracking-wide border mb-2',
            getLevelBg(score.level),
            getLevelColor(score.level)
          )}>
            {score.level.replace('_', ' ')}
          </div>
          <p className="text-sm text-muted-foreground">
            {score.level === 'excellent' && 'High probability setup. Consider full position size.'}
            {score.level === 'good' && 'Solid setup. Standard position size recommended.'}
            {score.level === 'marginal' && 'Borderline setup. Reduce position size or wait.'}
            {score.level === 'no_trade' && 'Insufficient confluence. No trade recommended.'}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {scoreItems.map(({ key, label, icon: Icon, max }) => {
          const value = score[key];
          const width = (value / max) * 100;

          return (
            <div key={key} className="flex items-center gap-3">
              <Icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <span className="text-sm text-muted-foreground w-28 flex-shrink-0">{label}</span>
              <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-700 ease-out",
                    key === 'smcConfluence' 
                      ? "bg-gradient-to-r from-accent to-primary" 
                      : "bg-gradient-to-r from-primary to-info"
                  )}
                  style={{ width: `${width}%` }}
                />
              </div>
              <span className="font-mono text-sm font-medium w-10 text-right">{value}/{max}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
