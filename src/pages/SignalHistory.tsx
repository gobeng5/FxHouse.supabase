import { useState, useMemo } from 'react';
import { Header } from '@/components/Header';
import { BrandedBackground } from '@/components/BrandedBackground';
import { useGeneratedSignals, GeneratedSignal, SignalStats } from '@/hooks/useGeneratedSignals';
import { useDerivAPI } from '@/hooks/useDerivAPI';
import { toast } from 'sonner';
import { useTelegramAlert } from '@/hooks/useTelegramAlert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  TrendingUp, TrendingDown, Minus, Trophy, XCircle, Clock, 
  BarChart3, Target, Filter, RefreshCw, Loader2, CheckCircle,
  AlertCircle, Calendar, Zap, Send
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ALL_INSTRUMENTS, TradingInstrument, getInstrumentDecimals } from '@/types/trading';
import { format } from 'date-fns';

const SignalHistoryPage = () => {
  const { signals, stats, loading, updateSignalOutcome, refreshSignals, reconcileClosedOutcomes } = useGeneratedSignals();
  const { getCandles } = useDerivAPI();
  const [auditing, setAuditing] = useState(false);

  const handleWickAudit = async () => {
    setAuditing(true);
    try {
      const { checked, corrected, reset } = await reconcileClosedOutcomes((instrument, granularity, count) =>
        getCandles(instrument as TradingInstrument, granularity, count)
      );
      toast.success('Wick audit complete', {
        description: corrected > 0 || reset > 0
          ? `${checked} checked · ${corrected} outcome(s) corrected · ${reset} phantom resolution(s) reset to pending.`
          : `All ${checked} closed outcomes match fill-gated 1H intrabar order.`,
      });

      await refreshSignals();
    } catch (err) {
      toast.error('Wick audit failed', { description: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setAuditing(false);
    }
  };
  const { sendSignalAlert } = useTelegramAlert();
  const [filterInstrument, setFilterInstrument] = useState<string>('all');
  const [filterOutcome, setFilterOutcome] = useState<string>('all');
  const [filterTradeType, setFilterTradeType] = useState<string>('all');
  const [selectedSignal, setSelectedSignal] = useState<GeneratedSignal | null>(null);
  const [outcomeForm, setOutcomeForm] = useState({
    outcome: '' as 'won' | 'lost' | 'breakeven' | 'cancelled' | '',
    exitPrice: '',
    pnlPips: '',
    notes: '',
  });

  const filteredSignals = useMemo(() => {
    return signals.filter(signal => {
      if (filterInstrument !== 'all' && signal.instrument !== filterInstrument) return false;
      if (filterOutcome !== 'all') {
        if (filterOutcome === 'pending' && signal.outcome && signal.outcome !== 'pending') return false;
        if (filterOutcome !== 'pending' && signal.outcome !== filterOutcome) return false;
      }
      if (filterTradeType !== 'all' && signal.trade_type !== filterTradeType) return false;
      return true;
    });
  }, [signals, filterInstrument, filterOutcome, filterTradeType]);

  const handleUpdateOutcome = async () => {
    if (!selectedSignal || !outcomeForm.outcome) return;
    
    const success = await updateSignalOutcome(
      selectedSignal.id,
      outcomeForm.outcome,
      outcomeForm.exitPrice ? parseFloat(outcomeForm.exitPrice) : undefined,
      outcomeForm.pnlPips ? parseFloat(outcomeForm.pnlPips) : undefined,
      outcomeForm.notes || undefined
    );

    if (success) {
      setSelectedSignal(null);
      setOutcomeForm({ outcome: '', exitPrice: '', pnlPips: '', notes: '' });
    }
  };

  const getDirectionIcon = (direction: string) => {
    if (direction === 'bullish') return TrendingUp;
    if (direction === 'bearish') return TrendingDown;
    return Minus;
  };

  const getDirectionStyles = (direction: string) => {
    if (direction === 'bullish') return { bg: 'bg-bullish/10', text: 'text-bullish', label: 'BUY' };
    if (direction === 'bearish') return { bg: 'bg-bearish/10', text: 'text-bearish', label: 'SELL' };
    return { bg: 'bg-amber-500/10', text: 'text-amber-500', label: 'RANGE' };
  };

  const getOutcomeBadge = (outcome: string | null) => {
    switch (outcome) {
      case 'won':
        return <Badge className="bg-bullish/20 text-bullish border-bullish/30"><Trophy className="w-3 h-3 mr-1" />Won</Badge>;
      case 'lost':
        return <Badge className="bg-bearish/20 text-bearish border-bearish/30"><XCircle className="w-3 h-3 mr-1" />Lost</Badge>;
      case 'breakeven':
        return <Badge className="bg-amber-500/20 text-amber-500 border-amber-500/30"><Minus className="w-3 h-3 mr-1" />BE</Badge>;
      case 'cancelled':
        return <Badge className="bg-muted text-muted-foreground"><AlertCircle className="w-3 h-3 mr-1" />Cancelled</Badge>;
      default:
        return <Badge className="bg-primary/20 text-primary border-primary/30"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
    }
  };

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      <BrandedBackground variant="subtle" animated={true} />
      <Header isConnected={true} />
      
      <main className="container mx-auto px-4 py-6 max-w-7xl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold">Signal History</h1>
            <p className="text-muted-foreground">Track and analyze app-generated trade signals</p>
          </div>
          
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleWickAudit} disabled={auditing || loading} className="gap-2">
              {auditing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Wick audit
            </Button>
            <Button variant="outline" onClick={refreshSignals} disabled={loading} className="gap-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh
            </Button>
          </div>
        </div>

        {/* Stats Overview */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-6">
            <StatsCard 
              title="Total Signals" 
              value={stats.totalSignals} 
              icon={<BarChart3 className="w-4 h-4 text-primary" />} 
            />
            <StatsCard 
              title="Win Rate" 
              value={`${stats.winRate.toFixed(1)}%`} 
              icon={<Target className="w-4 h-4 text-bullish" />}
              valueColor={stats.winRate >= 50 ? 'text-bullish' : 'text-bearish'}
            />
            <StatsCard 
              title="Won" 
              value={stats.wonSignals} 
              icon={<Trophy className="w-4 h-4 text-bullish" />}
              valueColor="text-bullish"
            />
            <StatsCard 
              title="Lost" 
              value={stats.lostSignals} 
              icon={<XCircle className="w-4 h-4 text-bearish" />}
              valueColor="text-bearish"
            />
            <StatsCard 
              title="Pending" 
              value={stats.pendingSignals} 
              icon={<Clock className="w-4 h-4 text-primary" />}
            />
            <StatsCard 
              title="Breakeven" 
              value={stats.breakevenSignals} 
              icon={<Minus className="w-4 h-4 text-amber-500" />}
            />
          </div>
        )}

        <Tabs defaultValue="signals" className="space-y-6">
          <TabsList>
            <TabsTrigger value="signals" className="gap-2">
              <Clock className="w-4 h-4" />
              All Signals
            </TabsTrigger>
            <TabsTrigger value="analytics" className="gap-2">
              <BarChart3 className="w-4 h-4" />
              Analytics
            </TabsTrigger>
          </TabsList>

          <TabsContent value="signals" className="space-y-4">
            {/* Filters */}
            <Card>
              <CardContent className="pt-4">
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Filter className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Filters:</span>
                  </div>
                  
                  <Select value={filterInstrument} onValueChange={setFilterInstrument}>
                    <SelectTrigger className="w-[140px]">
                      <SelectValue placeholder="Instrument" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Pairs</SelectItem>
                      {ALL_INSTRUMENTS.map(inst => (
                        <SelectItem key={inst} value={inst}>{inst}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select value={filterOutcome} onValueChange={setFilterOutcome}>
                    <SelectTrigger className="w-[130px]">
                      <SelectValue placeholder="Outcome" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Outcomes</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="won">Won</SelectItem>
                      <SelectItem value="lost">Lost</SelectItem>
                      <SelectItem value="breakeven">Breakeven</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>

                  <Select value={filterTradeType} onValueChange={setFilterTradeType}>
                    <SelectTrigger className="w-[130px]">
                      <SelectValue placeholder="Trade Type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Types</SelectItem>
                      <SelectItem value="swing">Swing</SelectItem>
                      <SelectItem value="day">Day</SelectItem>
                    </SelectContent>
                  </Select>

                  <span className="text-sm text-muted-foreground">
                    Showing {filteredSignals.length} of {signals.length} signals
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Signal List */}
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : filteredSignals.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Clock className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                  <p className="text-muted-foreground">No signals found</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Run analysis on instruments to generate signals
                  </p>
                </CardContent>
              </Card>
            ) : (
              <ScrollArea className="h-[600px]">
                <div className="space-y-3">
                  {filteredSignals.map(signal => (
                    <SignalCard 
                      key={signal.id} 
                      signal={signal}
                      onSendTelegram={() => sendSignalAlert(signal)}
                      onMarkOutcome={() => {
                        setSelectedSignal(signal);
                        setOutcomeForm({ 
                          outcome: '', 
                          exitPrice: signal.actual_exit_price?.toString() || '', 
                          pnlPips: signal.actual_pnl_pips?.toString() || '',
                          notes: signal.notes || ''
                        });
                      }}
                      getDirectionIcon={getDirectionIcon}
                      getDirectionStyles={getDirectionStyles}
                      getOutcomeBadge={getOutcomeBadge}
                    />
                  ))}
                </div>
              </ScrollArea>
            )}
          </TabsContent>

          <TabsContent value="analytics">
            <AnalyticsTab stats={stats} />
          </TabsContent>
        </Tabs>

        {/* Update Outcome Dialog */}
        <Dialog open={!!selectedSignal} onOpenChange={(open) => !open && setSelectedSignal(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Update Signal Outcome</DialogTitle>
            </DialogHeader>
            {selectedSignal && (
              <div className="space-y-4">
                <div className="p-3 rounded-lg bg-muted/50">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium">{selectedSignal.instrument}</span>
                    <Badge variant="outline" className="capitalize">{selectedSignal.trade_type}</Badge>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Entry: {selectedSignal.entry_price.toFixed(getInstrumentDecimals(selectedSignal.instrument as TradingInstrument))}
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <Label>Outcome</Label>
                    <Select 
                      value={outcomeForm.outcome} 
                      onValueChange={(v) => setOutcomeForm(prev => ({ ...prev, outcome: v as any }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select outcome" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="won">Won</SelectItem>
                        <SelectItem value="lost">Lost</SelectItem>
                        <SelectItem value="breakeven">Breakeven</SelectItem>
                        <SelectItem value="cancelled">Cancelled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>Exit Price (optional)</Label>
                    <Input 
                      type="number" 
                      step="0.00001"
                      placeholder="0.00000"
                      value={outcomeForm.exitPrice}
                      onChange={(e) => setOutcomeForm(prev => ({ ...prev, exitPrice: e.target.value }))}
                    />
                  </div>

                  <div>
                    <Label>P&L in Pips (optional)</Label>
                    <Input 
                      type="number" 
                      step="0.1"
                      placeholder="0.0"
                      value={outcomeForm.pnlPips}
                      onChange={(e) => setOutcomeForm(prev => ({ ...prev, pnlPips: e.target.value }))}
                    />
                  </div>

                  <div>
                    <Label>Notes (optional)</Label>
                    <Textarea 
                      placeholder="Add notes about this trade..."
                      value={outcomeForm.notes}
                      onChange={(e) => setOutcomeForm(prev => ({ ...prev, notes: e.target.value }))}
                    />
                  </div>
                </div>

                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline">Cancel</Button>
                  </DialogClose>
                  <Button onClick={handleUpdateOutcome} disabled={!outcomeForm.outcome}>
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Update Outcome
                  </Button>
                </DialogFooter>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
};

const StatsCard = ({ title, value, icon, valueColor = 'text-foreground' }: { 
  title: string; 
  value: string | number; 
  icon: React.ReactNode;
  valueColor?: string;
}) => (
  <Card>
    <CardContent className="pt-4">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-xs text-muted-foreground">{title}</span>
      </div>
      <p className={cn("text-2xl font-bold", valueColor)}>{value}</p>
    </CardContent>
  </Card>
);

const SignalCard = ({ 
  signal, 
  onMarkOutcome,
  onSendTelegram,
  getDirectionIcon,
  getDirectionStyles,
  getOutcomeBadge,
}: { 
  signal: GeneratedSignal;
  onMarkOutcome: () => void;
  onSendTelegram: () => void;
  getDirectionIcon: (d: string) => any;
  getDirectionStyles: (d: string) => { bg: string; text: string; label: string };
  getOutcomeBadge: (o: string | null) => React.ReactNode;
}) => {
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    setSending(true);
    await onSendTelegram();
    setSending(false);
  };
  const Icon = getDirectionIcon(signal.direction);
  const styles = getDirectionStyles(signal.direction);
  const decimals = getInstrumentDecimals(signal.instrument as TradingInstrument);
  const isPending = !signal.outcome || signal.outcome === 'pending';

  return (
    <Card className={cn('transition-all', isPending && 'border-primary/30')}>
      <CardContent className="pt-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className={cn('w-10 h-10 rounded-full flex items-center justify-center', styles.bg)}>
              <Icon className={cn('w-5 h-5', styles.text)} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold">{signal.instrument}</span>
                <span className={cn('text-xs font-medium px-1.5 py-0.5 rounded', styles.bg, styles.text)}>
                  {styles.label}
                </span>
                <Badge variant="outline" className="capitalize text-xs">
                  {signal.trade_type === 'swing' ? <Calendar className="w-3 h-3 mr-1" /> : <Zap className="w-3 h-3 mr-1" />}
                  {signal.trade_type}
                </Badge>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                <span>Entry: {signal.entry_price.toFixed(decimals)}</span>
                <span>SL: {signal.stop_loss.toFixed(decimals)}</span>
                <span>TP1: {signal.take_profit_1.toFixed(decimals)}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-xs text-muted-foreground">
                {format(new Date(signal.generated_at), 'MMM d, yyyy')}
              </div>
              <div className="text-xs text-muted-foreground">
                {format(new Date(signal.generated_at), 'HH:mm')} · {signal.session || 'Unknown'}
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              {getOutcomeBadge(signal.outcome)}
              <Button size="sm" variant="outline" onClick={handleSend} disabled={sending} className="gap-1">
                <Send className="w-3 h-3" />
                {sending ? 'Sending...' : 'Telegram'}
              </Button>
              {isPending && (
                <Button size="sm" variant="outline" onClick={onMarkOutcome}>
                  Mark Result
                </Button>
              )}
            </div>
          </div>
        </div>

        {signal.reasoning && (
          <p className="text-xs text-muted-foreground mt-3 line-clamp-2">{signal.reasoning}</p>
        )}

        {signal.notes && (
          <p className="text-xs text-primary/80 mt-2 p-2 rounded bg-primary/5">{signal.notes}</p>
        )}
      </CardContent>
    </Card>
  );
};

const AnalyticsTab = ({ stats }: { stats: SignalStats | null }) => {
  if (!stats) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* By Instrument */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Performance by Instrument</CardTitle>
        </CardHeader>
        <CardContent>
          {Object.entries(stats.byInstrument).length === 0 ? (
            <p className="text-muted-foreground text-sm">No data yet</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(stats.byInstrument)
                .sort((a, b) => b[1].total - a[1].total)
                .map(([instrument, data]) => (
                  <div key={instrument} className="flex items-center justify-between p-2 rounded bg-muted/30">
                    <span className="font-medium">{instrument}</span>
                    <div className="flex items-center gap-4 text-sm">
                      <span className="text-muted-foreground">{data.total} signals</span>
                      <span className="text-bullish">{data.won}W</span>
                      <span className="text-bearish">{data.lost}L</span>
                      <span className={cn(
                        "font-semibold",
                        data.winRate >= 50 ? 'text-bullish' : 'text-bearish'
                      )}>
                        {data.winRate.toFixed(0)}%
                      </span>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* By Trade Type */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Performance by Trade Type</CardTitle>
        </CardHeader>
        <CardContent>
          {Object.entries(stats.byTradeType).length === 0 ? (
            <p className="text-muted-foreground text-sm">No data yet</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(stats.byTradeType).map(([type, data]) => (
                <div key={type} className="flex items-center justify-between p-3 rounded bg-muted/30">
                  <div className="flex items-center gap-2">
                    {type === 'swing' ? <Calendar className="w-4 h-4" /> : <Zap className="w-4 h-4" />}
                    <span className="font-medium capitalize">{type} Trades</span>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-muted-foreground">{data.total} signals</span>
                    <span className="text-bullish">{data.won}W</span>
                    <span className="text-bearish">{data.lost}L</span>
                    <span className={cn(
                      "font-semibold",
                      data.winRate >= 50 ? 'text-bullish' : 'text-bearish'
                    )}>
                      {data.winRate.toFixed(0)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default SignalHistoryPage;
