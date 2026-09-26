import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Calculator, DollarSign, Percent, Target, Activity } from 'lucide-react';
import { TradingInstrument, isSyntheticIndex } from '@/types/trading';

interface PositionSizeCalculatorProps {
  instrument: TradingInstrument;
  suggestedStopLoss?: number;
  atr4H?: number;
  atrMultiplier?: number;
}

const PositionSizeCalculator = ({ instrument, suggestedStopLoss, atr4H, atrMultiplier = 1.5 }: PositionSizeCalculatorProps) => {
  const [accountBalance, setAccountBalance] = useState<string>('10000');
  const [riskPercentage, setRiskPercentage] = useState<string>('1');
  const [stopLossPips, setStopLossPips] = useState<string>(suggestedStopLoss?.toString() || '50');

  // Auto-update SL when ATR-based suggestion changes
  useEffect(() => {
    if (suggestedStopLoss) {
      setStopLossPips(suggestedStopLoss.toString());
    }
  }, [suggestedStopLoss]);

  const atrInfo = useMemo(() => {
    if (!atr4H) return null;
    const pip = isSyntheticIndex(instrument) ? 0.01 : 
      (instrument === 'USD/JPY' || instrument === 'GBP/JPY' ? 0.01 : 
       instrument === 'XAU/USD' ? 0.01 : 0.0001);
    const atrPips = atr4H / pip;
    const dynamicSL = atrPips * atrMultiplier;
    return { atrPips: atrPips.toFixed(1), dynamicSL: dynamicSL.toFixed(1), raw: atr4H };
  }, [atr4H, atrMultiplier, instrument]);

  const calculation = useMemo(() => {
    const balance = parseFloat(accountBalance) || 0;
    const riskPct = parseFloat(riskPercentage) || 0;
    const slPips = parseFloat(stopLossPips) || 0;

    if (balance <= 0 || riskPct <= 0 || slPips <= 0) return null;

    const riskAmount = balance * (riskPct / 100);
    let pipValue = 10;
    if (isSyntheticIndex(instrument)) {
      if (instrument.includes('Volatility')) pipValue = 1;
    }

    const positionSizeLots = riskAmount / (slPips * pipValue);
    return {
      riskAmount,
      standardLots: positionSizeLots,
      miniLots: positionSizeLots * 10,
      microLots: positionSizeLots * 100,
      pipValue,
    };
  }, [accountBalance, riskPercentage, stopLossPips, instrument]);

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Calculator className="h-5 w-5 text-primary" />
          Position Size Calculator
          {atrInfo && (
            <Badge variant="outline" className="ml-auto text-xs font-normal">
              <Activity className="h-3 w-3 mr-1" />
              ATR-Dynamic
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* ATR Info Bar */}
        {atrInfo && (
          <div className="flex items-center gap-2 p-2.5 rounded-lg bg-primary/10 border border-primary/20 text-xs">
            <Activity className="h-3.5 w-3.5 text-primary flex-shrink-0" />
            <span className="text-muted-foreground">
              4H ATR: <span className="text-foreground font-medium">{atrInfo.atrPips} pips</span>
              {' · '}
              Dynamic SL ({atrMultiplier}x): <span className="text-foreground font-medium">{atrInfo.dynamicSL} pips</span>
            </span>
          </div>
        )}

        {/* Inputs */}
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="balance" className="text-xs text-muted-foreground flex items-center gap-1">
              <DollarSign className="h-3 w-3" />
              Account Balance
            </Label>
            <Input
              id="balance"
              type="number"
              value={accountBalance}
              onChange={(e) => setAccountBalance(e.target.value)}
              placeholder="10000"
              className="h-9"
            />
          </div>
          
          <div className="space-y-1.5">
            <Label htmlFor="risk" className="text-xs text-muted-foreground flex items-center gap-1">
              <Percent className="h-3 w-3" />
              Risk %
            </Label>
            <Input
              id="risk"
              type="number"
              value={riskPercentage}
              onChange={(e) => setRiskPercentage(e.target.value)}
              placeholder="1"
              min="0.1"
              max="10"
              step="0.1"
              className="h-9"
            />
          </div>
          
          <div className="space-y-1.5">
            <Label htmlFor="sl" className="text-xs text-muted-foreground flex items-center gap-1">
              <Target className="h-3 w-3" />
              Stop Loss (pips)
            </Label>
            <Input
              id="sl"
              type="number"
              value={stopLossPips}
              onChange={(e) => setStopLossPips(e.target.value)}
              placeholder="50"
              className="h-9"
            />
          </div>
        </div>

        {/* Results */}
        {calculation && (
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between p-3 rounded-lg bg-destructive/10 border border-destructive/20">
              <span className="text-sm text-muted-foreground">Amount at Risk</span>
              <span className="text-lg font-bold text-destructive">
                ${calculation.riskAmount.toFixed(2)}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="p-3 rounded-lg bg-primary/10 border border-primary/20 text-center">
                <div className="text-xs text-muted-foreground mb-1">Standard Lots</div>
                <div className="text-lg font-bold text-primary">
                  {calculation.standardLots.toFixed(2)}
                </div>
              </div>
              
              <div className="p-3 rounded-lg bg-secondary/50 border border-border/50 text-center">
                <div className="text-xs text-muted-foreground mb-1">Mini Lots</div>
                <div className="text-lg font-bold text-foreground">
                  {calculation.miniLots.toFixed(2)}
                </div>
              </div>
              
              <div className="p-3 rounded-lg bg-secondary/50 border border-border/50 text-center">
                <div className="text-xs text-muted-foreground mb-1">Micro Lots</div>
                <div className="text-lg font-bold text-foreground">
                  {calculation.microLots.toFixed(2)}
                </div>
              </div>
            </div>

            <div className="text-xs text-muted-foreground bg-muted/30 p-2 rounded">
              <strong>Quick Reference:</strong> 1 Standard = 10 Mini = 100 Micro lots
            </div>
          </div>
        )}

        {!calculation && (
          <div className="text-center py-4 text-muted-foreground text-sm">
            Enter valid values to calculate position size
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default PositionSizeCalculator;