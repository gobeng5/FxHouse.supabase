import { useEffect, useRef, useState, useCallback } from 'react';
import { getSpread, effectiveEntry } from '@/lib/spreadConfig';

import { Link, useNavigate } from 'react-router-dom';
import { TradeRecommendation as TradeRecType, TradingInstrument, TrendDirection, getInstrumentDecimals, ConfidenceBreakdownItem } from '@/types/trading';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Minus, Clock, Target, Shield, Crosshair, Calendar, Zap, AlertCircle, History, ChevronDown, ChevronUp, ExternalLink, Info, BookOpen, Loader2, Send } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { playDirectionChangeAlert } from '@/lib/soundAlerts';
import { toast } from 'sonner';
import { SignalHistory, SignalHistoryEntry } from './SignalHistory';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useTrades } from '@/hooks/useTrades';
import { useTelegramAlert } from '@/hooks/useTelegramAlert';


interface TradeRecommendationProps {
  recommendation: TradeRecType;
  dayTradeRecommendation: TradeRecType;
  pair: TradingInstrument;
  onDirectionChange?: (direction: TrendDirection, tradeType: 'swing' | 'day') => void;
}

const TradeCard = ({ recommendation, pair, onJournal, isJournaling, onSendTelegram, isSendingTelegram }: { recommendation: TradeRecType; pair: TradingInstrument; showTradeButton?: boolean; onJournal?: () => void; isJournaling?: boolean; onSendTelegram?: () => void; isSendingTelegram?: boolean }) => {
  const { direction, confidence, setupType, preferPendingOrder, risk, tradeType, holdingPeriod, reasoning } = recommendation;
  const decimals = pair === 'USD/JPY' ? 2 : 4;
  const isRanging = direction === 'ranging';

  const DirectionIcon = direction === 'bullish' ? TrendingUp : direction === 'bearish' ? TrendingDown : Minus;
  
  // Color classes for each direction
  const getDirectionStyles = () => {
    if (direction === 'bullish') {
      return {
        bg: 'bg-bullish-muted border-bullish/30',
        iconBg: 'bg-bullish/20',
        text: 'text-bullish',
      };
    } else if (direction === 'bearish') {
      return {
        bg: 'bg-bearish-muted border-bearish/30',
        iconBg: 'bg-bearish/20',
        text: 'text-bearish',
      };
    } else {
      return {
        bg: 'bg-amber-500/10 border-amber-500/30',
        iconBg: 'bg-amber-500/20',
        text: 'text-amber-500',
      };
    }
  };

  const styles = getDirectionStyles();

  const riskReward1 = direction === 'bearish' 
    ? ((risk.entry - risk.takeProfit1) / (risk.stopLoss - risk.entry)).toFixed(2)
    : ((risk.takeProfit1 - risk.entry) / (risk.entry - risk.stopLoss)).toFixed(2);
  const riskReward2 = direction === 'bearish'
    ? ((risk.entry - risk.takeProfit2) / (risk.stopLoss - risk.entry)).toFixed(2)
    : ((risk.takeProfit2 - risk.entry) / (risk.entry - risk.stopLoss)).toFixed(2);
  const riskReward3 = direction === 'bearish'
    ? ((risk.entry - risk.takeProfit3) / (risk.stopLoss - risk.entry)).toFixed(2)
    : ((risk.takeProfit3 - risk.entry) / (risk.entry - risk.stopLoss)).toFixed(2);

  // For ranging, show "NO TRADE" prominently
  const displayDirection = isRanging ? 'NO TRADE' : direction;
  const displaySetup = isRanging ? 'Wait for clarity' : setupType.replace('_', ' ');

  return (
    <div className="space-y-4">
      {/* Direction & Confidence */}
      <div className={cn('flex items-center justify-between p-4 rounded-lg border', styles.bg)}>
        <div className="flex items-center gap-3">
          <div className={cn('w-12 h-12 rounded-full flex items-center justify-center', styles.iconBg)}>
            <DirectionIcon className={cn('w-6 h-6', styles.text)} />
          </div>
          <div>
            <span className={cn('text-xl font-bold uppercase', styles.text)}>
              {displayDirection}
            </span>
            <p className="text-sm text-muted-foreground capitalize">
              {displaySetup}
            </p>
          </div>
        </div>
        <div className="text-right flex items-center gap-2">
          <div>
            <div className="text-sm text-muted-foreground mb-1">{isRanging ? 'Clarity' : 'Confidence'}</div>
            <div className={cn('font-mono text-3xl font-bold', styles.text)}>
              {confidence}%
            </div>
          </div>
          {recommendation.confidenceBreakdown && recommendation.confidenceBreakdown.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <button className="p-1.5 rounded-full hover:bg-muted/50 transition-colors">
                  <Info className="w-4 h-4 text-muted-foreground" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-80 max-h-96 overflow-y-auto p-0" align="end">
                <div className="p-3 border-b border-border">
                  <h4 className="text-sm font-semibold">Confidence Breakdown</h4>
                  <p className="text-xs text-muted-foreground mt-0.5">Factors contributing to this signal</p>
                </div>
                <div className="p-2 space-y-1">
                  {recommendation.confidenceBreakdown.map((item, idx) => (
                    <div
                      key={idx}
                      className={cn(
                        'flex items-center justify-between px-2 py-1.5 rounded text-xs',
                        item.contributing ? 'bg-primary/10' : 'bg-muted/30 opacity-60'
                      )}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={cn(
                          'w-1.5 h-1.5 rounded-full shrink-0',
                          item.contributing ? 'bg-primary' : 'bg-muted-foreground/30'
                        )} />
                        <span className="font-medium truncate">{item.label}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="text-muted-foreground">{item.value}</span>
                        <span className={cn(
                          'font-mono font-semibold',
                          item.contributing ? 'text-primary' : 'text-muted-foreground'
                        )}>
                          {item.weight}/{item.maxWeight}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
      </div>

      {/* Trade Details Row */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/50 text-sm">
          <Clock className="w-3.5 h-3.5 text-primary" />
          <span className="text-muted-foreground">Hold:</span>
          <span className="font-medium text-foreground">{holdingPeriod}</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/50 text-sm">
          {tradeType === 'swing' ? <Calendar className="w-3.5 h-3.5 text-primary" /> : <Zap className="w-3.5 h-3.5 text-primary" />}
          <span className="font-medium text-foreground capitalize">{tradeType} Trade</span>
        </div>
        <div className={cn(
          "flex items-center gap-2 px-3 py-1.5 rounded-full text-sm",
          recommendation.entryStale
            ? 'bg-warning/15 border border-warning/40'
            : preferPendingOrder ? 'bg-muted/50' : 'bg-bullish/15 border border-bullish/30'
        )}>
          {recommendation.entryStale ? (
            <Clock className="w-3.5 h-3.5 text-warning" />
          ) : preferPendingOrder ? (
            <Clock className="w-3.5 h-3.5 text-muted-foreground" />
          ) : (
            <Zap className="w-3.5 h-3.5 text-bullish" />
          )}
          <span className={cn(
            "font-semibold",
            recommendation.entryStale ? 'text-warning' : preferPendingOrder ? 'text-foreground' : 'text-bullish'
          )}>
            {recommendation.entryStale
              ? `Stale Entry — Re-analyze (${recommendation.entryDriftAtr?.toFixed(2)}x ATR drift)`
              : preferPendingOrder ? 'Pending Order' : '⚡ Execute Now'}
          </span>
        </div>
      </div>

      {/* Reasoning */}
      <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
        <p className="text-sm text-muted-foreground">{reasoning}</p>
      </div>

      {/* Entry & Exit Levels */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 rounded-lg bg-primary/10 border border-primary/30">
          <div className="flex items-center gap-2 mb-2">
            <Crosshair className="w-4 h-4 text-primary" />
            <span className="text-xs font-semibold text-muted-foreground uppercase">Entry</span>
          </div>
          <span className="font-mono text-lg font-bold text-primary">
            {risk.entry.toFixed(decimals)}
          </span>
        </div>

        <div className="p-3 rounded-lg bg-bearish/10 border border-bearish/30">
          <div className="flex items-center gap-2 mb-2">
            <Shield className="w-4 h-4 text-bearish" />
            <span className="text-xs font-semibold text-muted-foreground uppercase">Stop Loss</span>
          </div>
          <span className="font-mono text-lg font-bold text-bearish">
            {risk.stopLoss.toFixed(decimals)}
          </span>
          <span className="block text-xs text-muted-foreground mt-1">
            {risk.stopDistance} pips | {risk.riskPercent}% risk
          </span>
        </div>
      </div>

      {/* Take Profits */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 mb-2">
          <Target className="w-4 h-4 text-bullish" />
          <span className="text-xs font-semibold text-muted-foreground uppercase">Take Profit Targets</span>
        </div>
        
        {[
          { label: 'TP1', price: risk.takeProfit1, rr: riskReward1 },
          { label: 'TP2', price: risk.takeProfit2, rr: riskReward2 },
          { label: 'TP3', price: risk.takeProfit3, rr: riskReward3 },
        ].map(({ label, price, rr }) => (
          <div key={label} className="flex items-center justify-between p-2 rounded bg-bullish/5 border border-bullish/20">
            <span className="text-sm font-medium text-bullish">{label}</span>
            <div className="flex items-center gap-4">
              <span className="font-mono font-semibold text-bullish">{price.toFixed(decimals)}</span>
              <span className="text-xs text-muted-foreground">R:R {rr}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Risk Rules */}
      <div className="space-y-2 text-sm">
        <div className="p-2 rounded bg-muted/50">
          <span className="text-muted-foreground">Trailing: </span>
          <span className="text-foreground">{risk.trailingStopLogic}</span>
        </div>
        <div className="p-2 rounded bg-muted/50">
          <span className="text-muted-foreground">Breakeven: </span>
          <span className="text-foreground">{risk.breakevenRule}</span>
        </div>
      </div>

      {/* Action Buttons */}
      {!isRanging && (
        <div className="pt-3 border-t border-border/50 flex gap-2">
          {onJournal && (
            <Button
              onClick={onJournal}
              disabled={isJournaling}
              variant="outline"
              size="sm"
              className="flex-1 gap-2"
            >
              {isJournaling ? <Loader2 className="w-4 h-4 animate-spin" /> : <BookOpen className="w-4 h-4" />}
              {isJournaling ? 'Journaling...' : 'Journal Signal'}
            </Button>
          )}
          {onSendTelegram && (
            <Button
              onClick={onSendTelegram}
              disabled={isSendingTelegram}
              variant="outline"
              size="sm"
              className="flex-1 gap-2"
            >
              {isSendingTelegram ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {isSendingTelegram ? 'Sending...' : 'Send to Telegram'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
};

export const TradeRecommendation = ({ recommendation, dayTradeRecommendation, pair, onDirectionChange }: TradeRecommendationProps) => {
  const prevSwingDirection = useRef<TrendDirection | null>(null);
  const prevDayDirection = useRef<TrendDirection | null>(null);
  const [signalHistory, setSignalHistory] = useState<SignalHistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [isJournaling, setIsJournaling] = useState(false);
  const [isSendingTelegram, setIsSendingTelegram] = useState(false);
  const { addTrade } = useTrades();
  const { sendTradeRecommendation } = useTelegramAlert();
  const navigate = useNavigate();

  const handleJournalSignal = useCallback(async (rec: TradeRecType) => {
    setIsJournaling(true);
    try {
      const decimals = getInstrumentDecimals(pair);
      const result = await addTrade({
        instrument: pair,
        direction: rec.direction === 'bullish' ? 'BUY' : 'SELL',
        entry_price: rec.risk.entry,
        effective_entry:
          rec.risk.effectiveEntry ??
          effectiveEntry(pair, rec.direction === 'bearish' ? 'bearish' : 'bullish', rec.risk.entry),
        spread_applied: rec.risk.spreadApplied ?? getSpread(pair),

        stop_loss: rec.risk.stopLoss,
        take_profit: rec.risk.takeProfit1,
        take_profit_2: rec.risk.takeProfit2,
        take_profit_3: rec.risk.takeProfit3,
        lot_size: 0.01,
        setup_type: rec.setupType
          ? rec.setupType
              .replace(/_/g, ' ')
              .split(' ')
              .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
              .join(' ')
          : 'SMC Signal',
        notes: `${rec.tradeType} trade | Confidence: ${rec.confidence}% | ${rec.reasoning}`,
        // Pending-limit setups stay PENDING until price actually trades through
        // the entry; only market/instant setups start ACTIVE.
        outcome: rec.preferPendingOrder === false ? 'ACTIVE' : 'PENDING',
      });
      if (result) {
        toast.success('Signal journaled!', {
          description: 'View it in your Trade Journal',
          action: { label: 'Go to Journal', onClick: () => navigate('/journal') },
        });
      }
    } catch (err) {
      toast.error('Failed to journal signal');
    }
    setIsJournaling(false);
  }, [pair, addTrade, navigate]);

  const handleSendTelegram = useCallback(async (rec: TradeRecType) => {
    setIsSendingTelegram(true);
    await sendTradeRecommendation(rec, pair);
    setIsSendingTelegram(false);
  }, [pair, sendTradeRecommendation]);

  const addHistoryEntry = useCallback((direction: TrendDirection, tradeType: 'swing' | 'day') => {
    const entry: SignalHistoryEntry = {
      id: `${Date.now()}-${tradeType}`,
      direction,
      tradeType,
      timestamp: new Date(),
      pair,
    };
    setSignalHistory(prev => [entry, ...prev].slice(0, 20)); // Keep last 20 entries
  }, [pair]);

  // Detect direction changes and play alerts
  useEffect(() => {
    // Check swing trade direction change
    if (prevSwingDirection.current !== null && prevSwingDirection.current !== recommendation.direction) {
      playDirectionChangeAlert(recommendation.direction);
      toast.info(`Swing Signal Changed: ${recommendation.direction.toUpperCase()}`, {
        description: recommendation.direction === 'ranging' 
          ? 'Market is ranging - no clear trade setup'
          : `New ${recommendation.direction === 'bullish' ? 'BUY' : 'SELL'} signal detected`,
        icon: recommendation.direction === 'bullish' ? '📈' : recommendation.direction === 'bearish' ? '📉' : '↔️',
      });
      addHistoryEntry(recommendation.direction, 'swing');
      onDirectionChange?.(recommendation.direction, 'swing');
    }
    prevSwingDirection.current = recommendation.direction;
  }, [recommendation.direction, onDirectionChange, addHistoryEntry]);

  useEffect(() => {
    // Check day trade direction change
    if (prevDayDirection.current !== null && prevDayDirection.current !== dayTradeRecommendation.direction) {
      addHistoryEntry(dayTradeRecommendation.direction, 'day');
      onDirectionChange?.(dayTradeRecommendation.direction, 'day');
    }
    prevDayDirection.current = dayTradeRecommendation.direction;
  }, [dayTradeRecommendation.direction, onDirectionChange, addHistoryEntry]);

  const isRanging = recommendation.direction === 'ranging';

  return (
    <div className="glass-card p-5 animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="section-title">Trade Recommendations</h3>
        {signalHistory.length > 0 && (
          <span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary font-medium">
            {signalHistory.length} changes
          </span>
        )}
      </div>

      {/* Ranging Market Alert */}
      {isRanging && (
        <div className="mb-4 p-4 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-amber-500">Market is Ranging</p>
            <p className="text-sm text-muted-foreground mt-1">
              No clear directional bias detected. Multi-timeframe analysis shows conflicting signals. 
              Wait for clearer price action before entering trades.
            </p>
          </div>
        </div>
      )}

      <Tabs defaultValue="swing" className="w-full">
        <TabsList className="grid w-full grid-cols-2 mb-4">
          <TabsTrigger value="swing" className="gap-2">
            <Calendar className="w-4 h-4" />
            Swing Trade
          </TabsTrigger>
          <TabsTrigger value="day" className="gap-2">
            <Zap className="w-4 h-4" />
            Day Trade
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="swing">
          <TradeCard recommendation={recommendation} pair={pair} onJournal={() => handleJournalSignal(recommendation)} isJournaling={isJournaling} onSendTelegram={() => handleSendTelegram(recommendation)} isSendingTelegram={isSendingTelegram} />
        </TabsContent>
        
        <TabsContent value="day">
          <TradeCard recommendation={dayTradeRecommendation} pair={pair} onJournal={() => handleJournalSignal(dayTradeRecommendation)} isJournaling={isJournaling} onSendTelegram={() => handleSendTelegram(dayTradeRecommendation)} isSendingTelegram={isSendingTelegram} />
        </TabsContent>
      </Tabs>

      {/* Signal History */}
      <Collapsible open={historyOpen} onOpenChange={setHistoryOpen} className="mt-4">
        <CollapsibleTrigger className="flex items-center justify-between w-full p-3 rounded-lg bg-muted/30 border border-border/50 hover:bg-muted/50 transition-colors">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">Signal History</span>
          </div>
          {historyOpen ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          <SignalHistory history={signalHistory} />
          <div className="mt-3 text-center">
            <Link to="/signals">
              <Button variant="ghost" size="sm" className="gap-2 text-xs">
                <ExternalLink className="w-3 h-3" />
                View Full Signal History & Stats
              </Button>
            </Link>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
};
