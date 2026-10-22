import { TradingInstrument, TradePlan } from '@/types/trading';
import { TradeRecommendation } from '@/components/TradeRecommendation';
import { ExecutionPlan } from '@/components/ExecutionPlan';
import PositionSizeCalculator from '@/components/PositionSizeCalculator';

// The signal to size: the swing trade if there is one, otherwise the day trade.
const activeRisk = (plan: TradePlan) =>
  [plan.recommendation, plan.dayTradeRecommendation].find(r => r && r.direction !== 'ranging')?.risk;
import { KeyLevelsTable } from '@/components/KeyLevelsTable';
import { SignalRevalidationPanel } from '@/components/SignalRevalidationPanel';

interface SignalsTabProps {
  currentPlan: TradePlan;
  instrument: TradingInstrument;
  prices: Record<string, { price: number }>;
  onReanalyze: (instrument: TradingInstrument) => void;
}

export const SignalsTab = ({ currentPlan, instrument, prices, onReanalyze }: SignalsTabProps) => (
  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
    <div className="lg:col-span-2 space-y-6">
      <TradeRecommendation
        recommendation={currentPlan.recommendation}
        dayTradeRecommendation={currentPlan.dayTradeRecommendation}
        pair={instrument}
      />
      <ExecutionPlan plan={currentPlan} />
      <SignalRevalidationPanel prices={prices} onReanalyze={onReanalyze} />
    </div>
    <div className="space-y-6">
      <PositionSizeCalculator
        instrument={instrument}
        entry={activeRisk(currentPlan)?.entry}
        stopLoss={activeRisk(currentPlan)?.stopLoss}
        usdJpy={prices['USD/JPY']?.price}
      />
      <KeyLevelsTable
        levels={currentPlan.keyLevels}
        currentPrice={currentPlan.currentPrice}
        criticalInvalidation={currentPlan.criticalInvalidation}
        pair={instrument}
      />
    </div>
  </div>
);
