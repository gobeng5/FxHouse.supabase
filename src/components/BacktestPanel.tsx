import { useState } from 'react';
import { TradingInstrument } from '@/types/trading';
import { useDerivAPI } from '@/hooks/useDerivAPI';
import { runBacktest, BacktestResult } from '@/lib/backtester';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Target, TrendingUp, TrendingDown, BarChart3, Play, Loader2,
  Flame, Shield, Zap, Clock, Activity, Shuffle,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine, BarChart, Bar, Cell, Area, AreaChart,
} from 'recharts';
import { toast } from 'sonner';

interface BacktestPanelProps {
  instrument: TradingInstrument;
}

export const BacktestPanel = ({ instrument }: BacktestPanelProps) => {
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const { getCandles } = useDerivAPI();

  const handleRun = async () => {
    setIsRunning(true);
    toast.info(`Running backtest on ${instrument}...`, { description: 'Replaying historical data through the signal engine + Monte Carlo sim' });

    try {
      const [daily, fourHour, oneHour] = await Promise.all([
        getCandles(instrument, 86400, 500),
        getCandles(instrument, 14400, 500),
        getCandles(instrument, 3600, 500),
      ]);

      const res = runBacktest(instrument, daily, fourHour, oneHour);
      setResult(res);

      if (res.totalTrades === 0) {
        toast.warning('Backtest Complete', { description: 'Not enough qualifying signals found in the data window.' });
      } else {
        toast.success('Backtest Complete', {
          description: `${res.totalTrades} trades | ${res.winRate}% WR | ${res.totalR}R | Sharpe ${res.sharpeRatio}`,
        });
      }
    } catch (err) {
      console.error('Backtest error:', err);
      toast.error('Backtest Failed', { description: 'Could not fetch enough historical data.' });
    }

    setIsRunning(false);
  };

  const sessionColors: Record<string, string> = {
    london: 'hsl(var(--chart-1))',
    ny: 'hsl(var(--chart-2))',
    asian: 'hsl(var(--chart-3))',
    overlap: 'hsl(var(--chart-4))',
  };

  return (
    <div className="space-y-4">
      <Card className="glass-card">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary" />
              Backtest — {instrument}
            </CardTitle>
            <Button size="sm" onClick={handleRun} disabled={isRunning} className="gap-2">
              {isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {isRunning ? 'Running...' : 'Run Backtest'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Replays the signal engine over historical data with Monte Carlo simulation (500 paths). Not a guarantee of future performance.
          </p>
        </CardHeader>
      </Card>

      {result && result.totalTrades > 0 && (
        <>
          {/* Primary Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Win Rate', value: `${result.winRate}%`, icon: Target, color: result.winRate >= 50 ? 'text-bullish' : 'text-bearish' },
              { label: 'Total R', value: `${result.totalR > 0 ? '+' : ''}${result.totalR}R`, icon: TrendingUp, color: result.totalR > 0 ? 'text-bullish' : 'text-bearish' },
              { label: 'Sharpe', value: `${result.sharpeRatio}`, icon: Activity, color: result.sharpeRatio >= 1 ? 'text-bullish' : result.sharpeRatio >= 0.5 ? 'text-warning' : 'text-bearish' },
              { label: 'Expectancy', value: `${result.expectancy > 0 ? '+' : ''}${result.expectancy}R`, icon: Zap, color: result.expectancy > 0 ? 'text-bullish' : 'text-bearish' },
            ].map(stat => (
              <Card key={stat.label} className="glass-card">
                <CardContent className="p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <stat.icon className={`w-3.5 h-3.5 ${stat.color}`} />
                    <span className="text-[11px] text-muted-foreground">{stat.label}</span>
                  </div>
                  <span className={`text-lg font-bold font-mono ${stat.color}`}>{stat.value}</span>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Secondary Stats */}
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
            {[
              { label: 'Avg Win', value: `+${result.avgWinR}R` },
              { label: 'Avg Loss', value: `-${result.avgLossR}R` },
              { label: 'PF', value: result.profitFactor === Infinity ? '∞' : `${result.profitFactor}` },
              { label: 'Max DD', value: `${result.maxDrawdownR}R` },
              { label: 'Recovery', value: result.recoveryFactor === Infinity ? '∞' : `${result.recoveryFactor}` },
              { label: 'Trades', value: `${result.totalTrades}` },
            ].map(s => (
              <div key={s.label} className="bg-card/50 border border-border/30 rounded-lg px-2.5 py-2 text-center">
                <div className="text-[10px] text-muted-foreground">{s.label}</div>
                <div className="text-sm font-bold font-mono">{s.value}</div>
              </div>
            ))}
          </div>

          {/* Tabs for detailed views */}
          <Tabs defaultValue="equity" className="space-y-3">
            <TabsList className="grid grid-cols-4 w-full">
              <TabsTrigger value="equity" className="text-xs">Equity</TabsTrigger>
              <TabsTrigger value="montecarlo" className="text-xs">Monte Carlo</TabsTrigger>
              <TabsTrigger value="sessions" className="text-xs">Sessions</TabsTrigger>
              <TabsTrigger value="trades" className="text-xs">Trades</TabsTrigger>
            </TabsList>

            {/* Equity Curve */}
            <TabsContent value="equity">
              <Card className="glass-card">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Equity Curve (R-Multiple)</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {result.wins}W {result.losses}L over ~{result.daysAnalyzed} days
                  </p>
                </CardHeader>
                <CardContent>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={result.equityCurve}>
                        <defs>
                          <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={result.totalR >= 0 ? 'hsl(var(--chart-2))' : 'hsl(var(--destructive))'} stopOpacity={0.3} />
                            <stop offset="95%" stopColor={result.totalR >= 0 ? 'hsl(var(--chart-2))' : 'hsl(var(--destructive))'} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="date" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" />
                        <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                        <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                        <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }} />
                        <Area type="monotone" dataKey="equity" stroke={result.totalR >= 0 ? 'hsl(var(--chart-2))' : 'hsl(var(--destructive))'} strokeWidth={2} fill="url(#equityGrad)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  {/* Streak info */}
                  <div className="flex items-center gap-4 mt-3 text-xs">
                    <div className="flex items-center gap-1.5">
                      <Flame className="w-3.5 h-3.5 text-bullish" />
                      <span className="text-muted-foreground">Best streak:</span>
                      <span className="font-bold text-bullish">{result.streakInfo.longestWinStreak}W</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <TrendingDown className="w-3.5 h-3.5 text-bearish" />
                      <span className="text-muted-foreground">Worst streak:</span>
                      <span className="font-bold text-bearish">{result.streakInfo.longestLossStreak}L</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Shield className="w-3.5 h-3.5 text-warning" />
                      <span className="text-muted-foreground">Max consec DD:</span>
                      <span className="font-bold">{result.consecutiveDrawdowns}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Monte Carlo */}
            <TabsContent value="montecarlo">
              <Card className="glass-card">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <Shuffle className="w-4 h-4 text-primary" />
                    <CardTitle className="text-sm">Monte Carlo Simulation</CardTitle>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    500 randomized trade sequences — shows range of possible outcomes
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Percentile stats */}
                  <div className="grid grid-cols-5 gap-2">
                    {[
                      { label: 'Worst 5%', value: `${result.monteCarlo.p5}R`, color: 'text-bearish' },
                      { label: '25th', value: `${result.monteCarlo.p25}R`, color: 'text-warning' },
                      { label: 'Median', value: `${result.monteCarlo.median}R`, color: 'text-primary' },
                      { label: '75th', value: `${result.monteCarlo.p75}R`, color: 'text-bullish' },
                      { label: 'Best 5%', value: `${result.monteCarlo.p95}R`, color: 'text-bullish' },
                    ].map(p => (
                      <div key={p.label} className="text-center bg-card/50 border border-border/30 rounded-lg py-2">
                        <div className="text-[10px] text-muted-foreground">{p.label}</div>
                        <div className={`text-sm font-bold font-mono ${p.color}`}>{p.value}</div>
                      </div>
                    ))}
                  </div>

                  {/* Ruin probability */}
                  <div className="flex items-center justify-between bg-card/50 border border-border/30 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Shield className="w-4 h-4 text-bearish" />
                      <span className="text-xs">Probability of Ruin (hitting -10R)</span>
                    </div>
                    <span className={`font-bold font-mono text-sm ${result.monteCarlo.probabilityOfRuin > 20 ? 'text-bearish' : result.monteCarlo.probabilityOfRuin > 5 ? 'text-warning' : 'text-bullish'}`}>
                      {result.monteCarlo.probabilityOfRuin}%
                    </span>
                  </div>

                  {/* Monte Carlo paths chart */}
                  {result.monteCarlo.curves.length > 0 && (
                    <div className="h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis dataKey="trade" type="number" domain={[0, result.totalTrades]} tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" label={{ value: 'Trade #', position: 'insideBottom', offset: -2, fontSize: 10 }} />
                          <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" label={{ value: 'R', angle: -90, position: 'insideLeft', fontSize: 10 }} />
                          <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                          <ReferenceLine y={-10} stroke="hsl(var(--destructive))" strokeDasharray="5 5" strokeWidth={1.5} />
                          <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '11px' }} />
                          {result.monteCarlo.curves.map((curve, idx) => (
                            <Line
                              key={idx}
                              data={curve}
                              dataKey="equity"
                              stroke={`hsl(var(--chart-${(idx % 4) + 1}))`}
                              strokeWidth={1}
                              dot={false}
                              opacity={0.4}
                              isAnimationActive={false}
                            />
                          ))}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Session Stats */}
            <TabsContent value="sessions">
              <Card className="glass-card">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-primary" />
                    <CardTitle className="text-sm">Performance by Session</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Session bars */}
                  {result.sessionStats.length > 0 && (
                    <div className="h-48">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={result.sessionStats}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis dataKey="session" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                          <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                          <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }} />
                          <Bar dataKey="totalR" name="Total R" radius={[4, 4, 0, 0]}>
                            {result.sessionStats.map((entry, i) => (
                              <Cell key={i} fill={sessionColors[entry.session] || 'hsl(var(--primary))'} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  {/* Session table */}
                  <div className="space-y-1.5">
                    {result.sessionStats.map(s => (
                      <div key={s.session} className="flex items-center justify-between text-xs bg-card/50 border border-border/30 rounded-lg px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: sessionColors[s.session] }} />
                          <span className="capitalize font-medium">{s.session}</span>
                        </div>
                        <div className="flex items-center gap-4 font-mono">
                          <span>{s.trades} trades</span>
                          <span className={s.winRate >= 50 ? 'text-bullish' : 'text-bearish'}>{s.winRate}% WR</span>
                          <span className={`font-bold ${s.totalR >= 0 ? 'text-bullish' : 'text-bearish'}`}>
                            {s.totalR > 0 ? '+' : ''}{s.totalR}R
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Trade Log */}
            <TabsContent value="trades">
              <Card className="glass-card">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">Trade Log</CardTitle>
                    <div className="flex items-center gap-2 text-[10px]">
                      {result.bestTrade && (
                        <Badge variant="outline" className="text-bullish border-bullish/30">
                          Best: +{result.bestTrade.rMultiple}R
                        </Badge>
                      )}
                      {result.worstTrade && (
                        <Badge variant="outline" className="text-bearish border-bearish/30">
                          Worst: {result.worstTrade.rMultiple}R
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="max-h-72 overflow-y-auto space-y-1.5">
                    {result.trades.map((t, i) => (
                      <div key={i} className="flex items-center justify-between text-xs font-mono py-1.5 border-b border-border/30 last:border-0">
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground w-20">{t.entryDate}</span>
                          <Badge variant={t.direction === 'bullish' ? 'default' : 'destructive'} className="text-[10px] px-1.5">
                            {t.direction === 'bullish' ? '▲' : '▼'}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground capitalize">{t.session}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-muted-foreground">{t.confidence}%</span>
                          <span className="text-muted-foreground">{t.holdBars}×4H</span>
                          <span className={t.outcome === 'won' ? 'text-bullish' : 'text-bearish'}>
                            {t.rMultiple > 0 ? '+' : ''}{t.rMultiple}R
                          </span>
                          <Badge variant={t.outcome === 'won' ? 'default' : 'destructive'} className="text-[10px] w-10 justify-center">
                            {t.outcome === 'won' ? 'W' : 'L'}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}

      {result && result.totalTrades === 0 && (
        <Card className="glass-card">
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            No qualifying signals were generated during the test period. Try a different instrument or wait for more historical data.
          </CardContent>
        </Card>
      )}
    </div>
  );
};
