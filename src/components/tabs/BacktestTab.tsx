import { TradingInstrument } from '@/types/trading';
import { BacktestPanel } from '@/components/BacktestPanel';

interface BacktestTabProps {
  instrument: TradingInstrument;
}

export const BacktestTab = ({ instrument }: BacktestTabProps) => (
  <div className="max-w-5xl mx-auto">
    <BacktestPanel instrument={instrument} />
  </div>
);
