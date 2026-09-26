import { TradingInstrument, TradePlan } from '@/types/trading';
import { AutoAnalysisControl } from '@/components/AutoAnalysisControl';
import PositionSizeCalculator from '@/components/PositionSizeCalculator';
import { KillZoneIndicator } from '@/components/KillZoneIndicator';

interface ToolsTabProps {
  currentPlan: TradePlan;
  instrument: TradingInstrument;
  currentPrice: number;
  autoAnalysisState: any;
  isAutoEnabled: boolean;
  onToggleAuto: (enabled: boolean) => void;
  onRunNow: () => void;
}

export const ToolsTab = ({ currentPlan, instrument, currentPrice, autoAnalysisState, isAutoEnabled, onToggleAuto, onRunNow }: ToolsTabProps) => (
  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
    <div className="space-y-6">
      <AutoAnalysisControl
        state={autoAnalysisState}
        isAutoEnabled={isAutoEnabled}
        onToggle={onToggleAuto}
        onRunNow={onRunNow}
      />
      <KillZoneIndicator instrument={instrument} />
    </div>
    <div className="space-y-6">
      <PositionSizeCalculator
        instrument={instrument}
        suggestedStopLoss={currentPlan.recommendation.risk?.stopLoss
          ? Math.abs(currentPlan.currentPrice - currentPlan.recommendation.risk.stopLoss) * 10000
          : undefined}
        atr4H={currentPlan.atr4H}
      />
    </div>
  </div>
);