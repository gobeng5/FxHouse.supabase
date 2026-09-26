import { forwardRef } from 'react';
import { AlertTriangle } from 'lucide-react';

export const Disclaimer = forwardRef<HTMLDivElement>((_, ref) => {
  return (
    <div ref={ref} className="glass-card p-4 border-warning/30 bg-warning/5">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
        <div>
          <h4 className="text-sm font-semibold text-warning mb-1">Risk Disclaimer</h4>
          <p className="text-xs text-muted-foreground leading-relaxed">
            This tool is for educational and analytical purposes only. Forex trading involves substantial 
            risk of loss and is not suitable for all investors. Past performance is not indicative of 
            future results. No guarantee of profits is made or implied. Always conduct your own analysis 
            and consult with a qualified financial advisor before making trading decisions.
          </p>
        </div>
      </div>
    </div>
  );
});

Disclaimer.displayName = 'Disclaimer';
