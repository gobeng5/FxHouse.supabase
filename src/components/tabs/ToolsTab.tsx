import { TradingInstrument, TradePlan } from '@/types/trading';
import { AutoAnalysisControl } from '@/components/AutoAnalysisControl';
import PositionSizeCalculator from '@/components/PositionSizeCalculator';

// The signal to size: the swing trade if there is one, otherwise the day trade.
const activeRisk = (plan: TradePlan) =>
  [plan.recommendation, plan.dayTradeRecommendation].find(r => r && r.direction !== 'ranging')?.risk;
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
        entry={activeRisk(currentPlan)?.entry}
        stopLoss={activeRisk(currentPlan)?.stopLoss}
      />
    </div>
  </div>
);