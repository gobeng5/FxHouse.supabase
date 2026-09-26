import { TradingInstrument, TradePlan } from '@/types/trading';
import { PriceActionAnalysis } from '@/lib/priceActionAnalysis';
import { PriceActionCard } from '@/components/PriceActionCard';
import { AnalysisSection } from '@/components/AnalysisSection';
import { SessionScenarios } from '@/components/SessionScenarios';
import { KeyLevelsTable } from '@/components/KeyLevelsTable';
import { CorrelationAlert } from '@/components/CorrelationAlert';
import { SyntheticProfileCard } from '@/components/SyntheticProfileCard';
import { SignalDirection } from '@/lib/correlation';

interface AnalysisTabProps {
  currentPlan: TradePlan;
  instrument: TradingInstrument;
  priceActionAnalysis: PriceActionAnalysis | null;
  otherSignals?: SignalDirection[];
}

export const AnalysisTab = ({ currentPlan, instrument, priceActionAnalysis, otherSignals }: AnalysisTabProps) => (
  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
    <div className="lg:col-span-2 space-y-6">
      {priceActionAnalysis && <PriceActionCard analysis={priceActionAnalysis} />}
      <AnalysisSection
        daily={currentPlan.dailyAnalysis}
        fourHour={currentPlan.fourHourAnalysis}
        indicators={currentPlan.indicators}
        candlesticks={currentPlan.candlesticks}
        pair={instrument}
        currentPrice={currentPlan.currentPrice}
        priceActionAnalysis={priceActionAnalysis}
      />
      <SessionScenarios
        london={currentPlan.londonSession}
        londonNY={currentPlan.londonNYOverlap}
        pair={instrument}
      />
    </div>
    <div className="space-y-6">
      <SyntheticProfileCard instrument={instrument} />
      <CorrelationAlert currentPlan={currentPlan} otherSignals={otherSignals} />
      <KeyLevelsTable
        levels={currentPlan.keyLevels}
        currentPrice={currentPlan.currentPrice}
        criticalInvalidation={currentPlan.criticalInvalidation}
        pair={instrument}
      />
    </div>
  </div>
);
