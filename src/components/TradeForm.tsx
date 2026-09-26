import { useState, useEffect, useCallback } from 'react';
import { Trade, TradeInput, calculatePnlPips, getPipValue } from '@/hooks/useTrades';
import { ALL_INSTRUMENTS } from '@/types/trading';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calculator } from 'lucide-react';

const SETUP_TYPES = [
  'Order Block',
  'Fair Value Gap',
  'Liquidity Sweep',
  'Break of Structure',
  'Change of Character',
  'Supply/Demand Zone',
  'Support/Resistance',
  'Trend Continuation',
  'Reversal',
  'Breakout',
  'Other',
];

interface TradeFormProps {
  onSubmit: (trade: TradeInput) => void;
  onCancel: () => void;
  initialData?: Trade;
}

export function TradeForm({ onSubmit, onCancel, initialData }: TradeFormProps) {
  const [instrument, setInstrument] = useState(initialData?.instrument || 'EUR/USD');
  const [direction, setDirection] = useState<'BUY' | 'SELL'>(initialData?.direction || 'BUY');
  const [entryPrice, setEntryPrice] = useState(initialData?.entry_price?.toString() || '');
  const [exitPrice, setExitPrice] = useState(initialData?.exit_price?.toString() || '');
  const [stopLoss, setStopLoss] = useState(initialData?.stop_loss?.toString() || '');
  const [takeProfit, setTakeProfit] = useState(initialData?.take_profit?.toString() || '');
  const [takeProfit2, setTakeProfit2] = useState(initialData?.take_profit_2?.toString() || '');
  const [takeProfit3, setTakeProfit3] = useState(initialData?.take_profit_3?.toString() || '');
  const [lotSize, setLotSize] = useState(initialData?.lot_size?.toString() || '0.01');
  const [setupType, setSetupType] = useState(initialData?.setup_type || '');
  const [notes, setNotes] = useState(initialData?.notes || '');
  const [outcome, setOutcome] = useState<'WIN' | 'LOSS' | 'BREAKEVEN' | 'ACTIVE' | 'PENDING' | ''>(initialData?.outcome || 'PENDING');
  const [targetHit, setTargetHit] = useState(initialData?.target_hit || '');
  const [pnlPips, setPnlPips] = useState(initialData?.pnl_pips?.toString() || '');
  const [pnlAmount, setPnlAmount] = useState(initialData?.pnl_amount?.toString() || '');
  const [entryTime, setEntryTime] = useState(
    initialData?.entry_time 
      ? new Date(initialData.entry_time).toISOString().slice(0, 16)
      : new Date().toISOString().slice(0, 16)
  );
  const [exitTime, setExitTime] = useState(
    initialData?.exit_time 
      ? new Date(initialData.exit_time).toISOString().slice(0, 16)
      : ''
  );

  // Auto-calculate P&L pips and detect target hit when exit price changes
  const autoCalcPnl = useCallback(() => {
    const entry = parseFloat(entryPrice);
    const exit = parseFloat(exitPrice);
    if (!isNaN(entry) && !isNaN(exit) && entry > 0 && exit > 0) {
      const pips = calculatePnlPips(instrument, direction, entry, exit);
      setPnlPips(pips.toFixed(1));
      
      // Auto-determine outcome
      if (pips > 0) setOutcome('WIN');
      else if (pips < 0) setOutcome('LOSS');
      else setOutcome('BREAKEVEN');

      // Auto-detect which target was hit based on exit price proximity
      const sl = parseFloat(stopLoss);
      const tp1 = parseFloat(takeProfit);
      const tp2 = parseFloat(takeProfit2);
      const tp3 = parseFloat(takeProfit3);
      const pip = getPipValue(instrument);
      const tolerance = pip * 5; // 5 pip tolerance

      if (!isNaN(sl) && Math.abs(exit - sl) <= tolerance) {
        setTargetHit('SL');
      } else if (!isNaN(tp3) && Math.abs(exit - tp3) <= tolerance) {
        setTargetHit('TP3');
      } else if (!isNaN(tp2) && Math.abs(exit - tp2) <= tolerance) {
        setTargetHit('TP2');
      } else if (!isNaN(tp1) && Math.abs(exit - tp1) <= tolerance) {
        setTargetHit('TP1');
      }
    }
  }, [entryPrice, exitPrice, instrument, direction, stopLoss, takeProfit, takeProfit2, takeProfit3]);

  useEffect(() => {
    if (exitPrice) {
      autoCalcPnl();
    }
  }, [exitPrice, autoCalcPnl]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const trade: TradeInput = {
      instrument,
      direction,
      entry_price: parseFloat(entryPrice),
      exit_price: exitPrice ? parseFloat(exitPrice) : null,
      stop_loss: stopLoss ? parseFloat(stopLoss) : null,
      take_profit: takeProfit ? parseFloat(takeProfit) : null,
      take_profit_2: takeProfit2 ? parseFloat(takeProfit2) : null,
      take_profit_3: takeProfit3 ? parseFloat(takeProfit3) : null,
      lot_size: parseFloat(lotSize),
      setup_type: setupType || null,
      notes: notes || null,
      outcome: outcome || null,
      target_hit: targetHit || null,
      pnl_pips: pnlPips ? parseFloat(pnlPips) : null,
      pnl_amount: pnlAmount ? parseFloat(pnlAmount) : null,
      entry_time: new Date(entryTime).toISOString(),
      exit_time: exitTime ? new Date(exitTime).toISOString() : null,
    };
    
    onSubmit(trade);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Instrument</Label>
          <Select value={instrument} onValueChange={setInstrument}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ALL_INSTRUMENTS.map((inst) => (
                <SelectItem key={inst} value={inst}>{inst}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Direction</Label>
          <Select value={direction} onValueChange={(v) => setDirection(v as 'BUY' | 'SELL')}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="BUY">BUY</SelectItem>
              <SelectItem value="SELL">SELL</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Entry Price *</Label>
          <Input
            type="number"
            step="any"
            value={entryPrice}
            onChange={(e) => setEntryPrice(e.target.value)}
            required
            placeholder="1.0850"
          />
        </div>

        <div className="space-y-2">
          <Label className="flex items-center gap-1">
            Exit Price
            <Calculator className="w-3 h-3 text-muted-foreground" />
          </Label>
          <Input
            type="number"
            step="any"
            value={exitPrice}
            onChange={(e) => setExitPrice(e.target.value)}
            placeholder="Auto-calculates P&L"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Stop Loss</Label>
          <Input
            type="number"
            step="any"
            value={stopLoss}
            onChange={(e) => setStopLoss(e.target.value)}
            placeholder="1.0820"
          />
        </div>

        <div className="space-y-2">
          <Label>TP1</Label>
          <Input
            type="number"
            step="any"
            value={takeProfit}
            onChange={(e) => setTakeProfit(e.target.value)}
            placeholder="1.0880"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>TP2</Label>
          <Input
            type="number"
            step="any"
            value={takeProfit2}
            onChange={(e) => setTakeProfit2(e.target.value)}
            placeholder="1.0920"
          />
        </div>

        <div className="space-y-2">
          <Label>TP3</Label>
          <Input
            type="number"
            step="any"
            value={takeProfit3}
            onChange={(e) => setTakeProfit3(e.target.value)}
            placeholder="1.0960"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Lot Size *</Label>
          <Input
            type="number"
            step="0.01"
            min="0.01"
            value={lotSize}
            onChange={(e) => setLotSize(e.target.value)}
            required
          />
        </div>

        <div className="space-y-2">
          <Label>Setup Type</Label>
          <Select value={setupType} onValueChange={setSetupType}>
            <SelectTrigger>
              <SelectValue placeholder="Select setup..." />
            </SelectTrigger>
            <SelectContent>
              {SETUP_TYPES.map((setup) => (
                <SelectItem key={setup} value={setup}>{setup}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Entry Time</Label>
          <Input
            type="datetime-local"
            value={entryTime}
            onChange={(e) => setEntryTime(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label>Exit Time</Label>
          <Input
            type="datetime-local"
            value={exitTime}
            onChange={(e) => setExitTime(e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Outcome</Label>
          <Select value={outcome} onValueChange={(v) => setOutcome(v as 'WIN' | 'LOSS' | 'BREAKEVEN' | 'ACTIVE' | 'PENDING' | '')}>
            <SelectTrigger>
              <SelectValue placeholder="Select..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ACTIVE">Active</SelectItem>
              <SelectItem value="PENDING">Pending</SelectItem>
              <SelectItem value="WIN">Win</SelectItem>
              <SelectItem value="LOSS">Loss</SelectItem>
              <SelectItem value="BREAKEVEN">Breakeven</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Target Hit</Label>
          <Select value={targetHit} onValueChange={setTargetHit}>
            <SelectTrigger>
              <SelectValue placeholder="Which target?" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="TP1">TP1</SelectItem>
              <SelectItem value="TP2">TP2</SelectItem>
              <SelectItem value="TP3">TP3</SelectItem>
              <SelectItem value="SL">SL</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>P&L (pips)</Label>
          <Input
            type="number"
            step="0.1"
            value={pnlPips}
            onChange={(e) => setPnlPips(e.target.value)}
            placeholder="Auto"
            className={pnlPips && parseFloat(pnlPips) !== 0 ? (parseFloat(pnlPips) > 0 ? 'text-bullish' : 'text-bearish') : ''}
          />
        </div>

        <div className="space-y-2">
          <Label>P&L ($)</Label>
          <Input
            type="number"
            step="0.01"
            value={pnlAmount}
            onChange={(e) => setPnlAmount(e.target.value)}
            placeholder="255.00"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Notes</Label>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Trade analysis, lessons learned, market conditions..."
          rows={3}
        />
      </div>

      <div className="flex justify-end gap-3 pt-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">
          {initialData ? 'Update Trade' : 'Log Trade'}
        </Button>
      </div>
    </form>
  );
}