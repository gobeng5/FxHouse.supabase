import { TradingInstrument } from '@/types/trading';
import { getSyntheticProfile } from '@/lib/syntheticProfiles';
import { Shield, Zap, BarChart2, Target, Clock, ArrowDownUp, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SyntheticProfileCardProps {
  instrument: TradingInstrument;
}

export const SyntheticProfileCard = ({ instrument }: SyntheticProfileCardProps) => {
  const profile = getSyntheticProfile(instrument);
  if (!profile) return null;

  const clarityLabel = ['', 'Noisy', 'Moderate', 'Good', 'Excellent', 'Cleanest'][profile.structureClarity];
  const volatilityLabel = ['', 'Very Low', 'Low', 'Medium', 'High', 'Very High'][profile.volatilityTier];

  const clarityColor = profile.structureClarity >= 4
    ? 'text-emerald-400'
    : profile.structureClarity >= 3
      ? 'text-amber-400'
      : 'text-red-400';

  const volColor = profile.volatilityTier <= 2
    ? 'text-emerald-400'
    : profile.volatilityTier <= 3
      ? 'text-amber-400'
      : 'text-red-400';

  const stats = [
    { icon: Shield, label: 'Structure Clarity', value: `${clarityLabel} (${profile.structureClarity}/5)`, color: clarityColor },
    { icon: Zap, label: 'Volatility Tier', value: `${volatilityLabel} (${profile.volatilityTier}/5)`, color: volColor },
    { icon: Target, label: 'SL / TP ATR Mult', value: `${profile.slAtrMultiplier}x / ${profile.tpAtrMultiplier}x`, color: 'text-blue-400' },
    { icon: ArrowDownUp, label: 'Retracement Depth', value: `${(profile.retracementDepth * 100).toFixed(1)}%`, color: 'text-purple-400' },
    { icon: Clock, label: 'Trend Duration', value: `${profile.trendDurationHours[0]}–${profile.trendDurationHours[1]}h`, color: 'text-cyan-400' },
    { icon: BarChart2, label: 'FVG Fill', value: profile.fvgFillExpectation === 'high' ? 'High' : 'Moderate', color: profile.fvgFillExpectation === 'high' ? 'text-emerald-400' : 'text-amber-400' },
  ];

  const features = [
    { label: 'Wick-tip OB refinement', active: profile.useWickTipRefinement },
    { label: 'Consolidation → breakout', active: profile.consolidationBeforeBreakout },
    { label: 'Mean reversion at extremes', active: profile.meanReversionAtExtremes },
    { label: 'Liquidity sweep boost', active: profile.liquiditySweepWeightBoost > 1 },
  ];

  return (
    <div className="bg-card/50 border border-border rounded-xl p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Info className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-semibold text-foreground">{profile.name} Profile</h3>
        </div>
        <span className="text-xs font-mono text-muted-foreground bg-muted/30 border border-border/30 rounded px-1.5 py-0.5">
          {profile.maxConfluenceScore}-pt scale
        </span>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
        {stats.map(({ icon: Icon, label, value, color }) => (
          <div key={label} className="bg-background/50 rounded-lg p-2.5 border border-border/50">
            <div className="flex items-center gap-1.5 mb-1">
              <Icon className={cn('w-3.5 h-3.5', color)} />
              <span className="text-[11px] text-muted-foreground">{label}</span>
            </div>
            <span className={cn('text-sm font-medium', color)}>{value}</span>
          </div>
        ))}
      </div>

      {/* Feature Flags */}
      <div className="flex flex-wrap gap-2 mb-4">
        {features.map(({ label, active }) => (
          <span
            key={label}
            className={cn(
              'text-[11px] px-2 py-1 rounded-full border',
              active
                ? 'bg-primary/10 text-primary border-primary/30'
                : 'bg-muted/20 text-muted-foreground border-border/30 opacity-50'
            )}
          >
            {active ? '✓' : '✗'} {label}
          </span>
        ))}
      </div>

      {/* Behavior Notes */}
      <div className="space-y-1.5">
        <h4 className="text-xs font-medium text-muted-foreground">Behavioral Notes</h4>
        {profile.behaviorNotes.map((note, i) => (
          <p key={i} className="text-xs text-muted-foreground/80 pl-3 border-l-2 border-primary/30">
            {note}
          </p>
        ))}
      </div>
    </div>
  );
};
