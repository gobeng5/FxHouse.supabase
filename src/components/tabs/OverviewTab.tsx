import { TradingInstrument, TradePlan } from '@/types/trading';
import { CandleData } from '@/hooks/useDerivAPI';
import { OrderBlock, FairValueGap, SMCChartPoints } from '@/lib/smcAnalysis';
import { PriceActionAnalysis } from '@/lib/priceActionAnalysis';
import { OBVResult } from '@/lib/indicators';
import { PriceChart } from '@/components/PriceChart';
import { SessionReviewCard } from '@/components/SessionReviewCard';
import { KillZoneIndicator } from '@/components/KillZoneIndicator';
import { ConfluenceScoreCard } from '@/components/ConfluenceScoreCard';
import { VolumeAnalysisCard } from '@/components/VolumeAnalysisCard';

interface OverviewTabProps {
  chartCandles: CandleData[];
  orderBlocks: OrderBlock[];
  fairValueGaps: FairValueGap[];
  instrument: TradingInstrument;
  currentPlan: TradePlan;
  priceActionAnalysis: PriceActionAnalysis | null;
  obvData: OBVResult | null;
  smcChartPoints?: SMCChartPoints | null;
}

export const OverviewTab = ({ chartCandles, orderBlocks, fairValueGaps, instrument, currentPlan, priceActionAnalysis, obvData, smcChartPoints }: OverviewTabProps) => (
  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
    <div className="lg:col-span-2 space-y-6">
      <PriceChart
        candles={chartCandles}
        orderBlocks={orderBlocks}
        fairValueGaps={fairValueGaps}
        pair={instrument}
        currentPrice={currentPlan.currentPrice}
        candlestickPatterns={priceActionAnalysis?.candlestickPatterns}
        chartPatterns={priceActionAnalysis?.chartPatterns}
        smcChartPoints={smcChartPoints}
      />
      <SessionReviewCard review={currentPlan.sessionReview} />
    </div>
    <div className="space-y-6">
      <KillZoneIndicator instrument={instrument} />
      <ConfluenceScoreCard score={currentPlan.confluenceScore} />
      {obvData && <VolumeAnalysisCard obv={obvData} />}
    </div>
  </div>
);
