import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Calculator, DollarSign, Percent, Target } from 'lucide-react';
import { TradingInstrument } from '@/types/trading';
import { useUserSettings } from '@/hooks/useUserSettings';
import { formatLotSuggestion, suggestLots } from '../../supabase/functions/_shared/analysis/positionSize.ts';

interface PositionSizeCalculatorProps {
  instrument: TradingInstrument;
  /** The active signal's entry and stop; the user can still edit them. */
  entry?: number;
  stopLoss?: number;
  /** Live USD/JPY rate, for converting GBP/JPY risk to USD. */
  usdJpy?: number | null;
}

const PositionSizeCalculator = ({ instrument, entry, stopLoss, usdJpy }: PositionSizeCalculatorProps) => {
  const { settings } = useUserSettings();
  const [balance, setBalance] = useState('');
  const [riskPercent, setRiskPercent] = useState('1');
  const [entryText, setEntryText] = useState('');
  const [stopText, setStopText] = useState('');

  // Start from the saved balance and risk %, and from the signal's own levels.
  useEffect(() => {
    if (settings?.account_balance) setBalance(String(settings.account_balance));
    if (settings?.risk_percent_per_trade) setRiskPercent(String(settings.risk_percent_per_trade));
  }, [settings?.account_balance, settings?.risk_percent_per_trade]);
  useEffect(() => { setEntryText(entry ? String(entry) : ''); }, [entry]);
  useEffect(() => { setStopText(stopLoss ? String(stopLoss) : ''); }, [stopLoss]);

  const suggestion = useMemo(() => suggestLots({
    instrument,
    entry: parseFloat(entryText),
    stopLoss: parseFloat(stopText),
    balance: parseFloat(balance),
    riskPercent: parseFloat(riskPercent),
    usdJpy,
  }), [instrument, entryText, stopText, balance, riskPercent, usdJpy]);

  const field = (id: string, label: string, icon: JSX.Element, value: string, set: (v: string) => void, placeholder: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground flex items-center gap-1">{icon}{label}</Label>
      <Input id={id} type="number" value={value} onChange={(e) => set(e.target.value)} placeholder={placeholder} className="h-9" />
    </div>
  );

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Calculator className="h-5 w-5 text-primary" />
          Lot Size (Deriv MT5)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {field('balance', 'Balance (USD)', <DollarSign className="h-3 w-3" />, balance, setBalance, 'Set it in Settings')}
          {field('risk', 'Risk %', <Percent className="h-3 w-3" />, riskPercent, setRiskPercent, '1')}
          {field('entry', 'Entry', <Target className="h-3 w-3" />, entryText, setEntryText, 'Signal entry')}
          {field('stop', 'Stop loss', <Target className="h-3 w-3" />, stopText, setStopText, 'Signal stop')}
        </div>

        {suggestion ? (
          <div className="space-y-3 pt-1">
            <div className={`p-3 rounded-lg border text-center ${suggestion.belowMin ? 'bg-destructive/10 border-destructive/20' : 'bg-primary/10 border-primary/20'}`}>
              <div className="text-xs text-muted-foreground mb-1">{suggestion.belowMin ? 'Balance too small for this stop' : 'Suggested lot size'}</div>
              <div className={`text-2xl font-bold ${suggestion.belowMin ? 'text-destructive' : 'text-primary'}`}>
                {suggestion.belowMin ? '—' : suggestion.lots}
              </div>
              <div className="text-xs text-muted-foreground mt-1">{formatLotSuggestion(suggestion, parseFloat(balance))}</div>
            </div>
            <div className="text-xs text-muted-foreground bg-muted/30 p-2 rounded space-y-1">
              <div>Rounded down to the {suggestion.lotStep} lot step, so the risk never goes above {riskPercent}%.</div>
              {suggestion.usedFallbackRate && <div>GBP/JPY converted at USD/JPY ≈ 150 (no live rate).</div>}
              <div>Lot limits vary by symbol and account: check the symbol's Specification in MT5 (minimum volume, volume step).</div>
            </div>
          </div>
        ) : (
          <div className="text-center py-4 text-muted-foreground text-sm">
            {balance ? 'No active signal: enter an entry and a stop to size a trade.' : 'Add your trading balance in Settings to get a lot size for every signal.'}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default PositionSizeCalculator;
