import { SessionReview } from '@/types/trading';
import { cn } from '@/lib/utils';
import { Moon, Activity, Bell, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';

interface SessionReviewCardProps {
  review: SessionReview;
}

export const SessionReviewCard = ({ review }: SessionReviewCardProps) => {
  const PositionIcon = review.relativeToYesterdayClose === 'above' ? ArrowUpRight : 
                       review.relativeToYesterdayClose === 'below' ? ArrowDownRight : Minus;

  const positionColor = review.relativeToYesterdayClose === 'above' ? 'text-bullish' : 
                        review.relativeToYesterdayClose === 'below' ? 'text-bearish' : 'text-muted-foreground';

  const volatilityColor = review.volatility === 'high' ? 'text-bearish bg-bearish/10 border-bearish/30' :
                          review.volatility === 'medium' ? 'text-accent bg-accent/10 border-accent/30' :
                          'text-bullish bg-bullish/10 border-bullish/30';

  return (
    <div className="glass-card p-5 animate-fade-in-up">
      <div className="flex items-center gap-2 mb-4">
        <Moon className="w-4 h-4 text-primary" />
        <h3 className="section-title mb-0">Session Review (12am-6am GMT)</h3>
      </div>

      <p className="text-sm text-foreground mb-4 leading-relaxed">{review.asianSummary}</p>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="p-3 rounded-lg bg-muted/50">
          <div className="flex items-center gap-1 mb-1">
            <Activity className="w-3 h-3 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Volatility</span>
          </div>
          <span className={cn(
            'inline-block px-2 py-0.5 text-xs font-semibold rounded border capitalize',
            volatilityColor
          )}>
            {review.volatility}
          </span>
        </div>

        <div className="p-3 rounded-lg bg-muted/50">
          <div className="flex items-center gap-1 mb-1">
            <PositionIcon className={cn('w-3 h-3', positionColor)} />
            <span className="text-xs text-muted-foreground">vs Yesterday</span>
          </div>
          <span className={cn('text-sm font-semibold capitalize', positionColor)}>
            {review.relativeToYesterdayClose}
          </span>
        </div>

        <div className="p-3 rounded-lg bg-muted/50">
          <div className="flex items-center gap-1 mb-1">
            <Bell className="w-3 h-3 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">News Impact</span>
          </div>
          <span className="text-sm font-semibold text-muted-foreground">
            {review.newsImpact || 'None'}
          </span>
        </div>
      </div>

      <div>
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Key Levels Tested</span>
        <div className="mt-2 flex flex-wrap gap-2">
          {review.keyLevelsTested.map((level, i) => (
            <span key={i} className="px-2 py-1 text-xs rounded bg-muted border border-border text-foreground">
              {level}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};
