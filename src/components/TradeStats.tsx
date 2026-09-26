import { TradeStats as TradeStatsType } from '@/hooks/useTrades';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { TrendingUp, TrendingDown, Target, Award, BarChart3, PieChart, Crosshair } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface TradeStatsProps {
  stats: TradeStatsType;
}

export function TradeStats({ stats }: TradeStatsProps) {
  if (stats.totalTrades === 0) {
    return (
      <Card className="glass-card">
        <CardContent className="py-12 text-center">
          <p className="text-muted-foreground">No closed trades yet. Complete some trades to see your analytics!</p>
        </CardContent>
      </Card>
    );
  }

  const formatNumber = (num: number, decimals = 1) => {
    if (num === Infinity) return '∞';
    return num.toFixed(decimals);
  };

  return (
    <div className="space-y-6">
      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="glass-card">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
              <Target className="w-4 h-4" />
              Win Rate
            </div>
            <div className="text-3xl font-bold">
              {stats.winRate.toFixed(1)}%
            </div>
            <Progress 
              value={stats.winRate} 
              className="mt-2 h-2" 
            />
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
              <Award className="w-4 h-4" />
              Profit Factor
            </div>
            <div className={`text-3xl font-bold ${
              stats.profitFactor >= 1 ? 'text-bullish' : 'text-bearish'
            }`}>
              {formatNumber(stats.profitFactor)}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {stats.profitFactor >= 2 ? 'Excellent' : 
               stats.profitFactor >= 1.5 ? 'Good' : 
               stats.profitFactor >= 1 ? 'Break-even' : 'Needs work'}
            </p>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
              <TrendingUp className="w-4 h-4" />
              Total P&L (pips)
            </div>
            <div className={`text-3xl font-bold font-mono ${
              stats.totalPnlPips >= 0 ? 'text-bullish' : 'text-bearish'
            }`}>
              {stats.totalPnlPips >= 0 ? '+' : ''}{formatNumber(stats.totalPnlPips)}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {stats.totalTrades} closed trades
            </p>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
              <BarChart3 className="w-4 h-4" />
              Total P&L ($)
            </div>
            <div className={`text-3xl font-bold font-mono ${
              stats.totalPnlAmount >= 0 ? 'text-bullish' : 'text-bearish'
            }`}>
              {stats.totalPnlAmount >= 0 ? '+' : ''}${formatNumber(stats.totalPnlAmount, 2)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Win/Loss Metrics */}
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <BarChart3 className="w-5 h-5" />
              Trade Metrics
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Average Win</p>
                <p className="text-xl font-mono font-semibold text-bullish">
                  +{formatNumber(stats.averageWin)} pips
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Average Loss</p>
                <p className="text-xl font-mono font-semibold text-bearish">
                  -{formatNumber(stats.averageLoss)} pips
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Largest Win</p>
                <p className="text-xl font-mono font-semibold text-bullish">
                  +{formatNumber(stats.largestWin)} pips
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Largest Loss</p>
                <p className="text-xl font-mono font-semibold text-bearish">
                  -{formatNumber(stats.largestLoss)} pips
                </p>
              </div>
            </div>
            
            <div className="pt-4 border-t border-border">
              <p className="text-sm text-muted-foreground mb-2">Risk/Reward Ratio</p>
              <p className="text-xl font-mono font-semibold">
                1 : {stats.averageLoss > 0 ? formatNumber(stats.averageWin / stats.averageLoss) : '—'}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Performance by Instrument */}
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <PieChart className="w-5 h-5" />
              Performance by Pair
            </CardTitle>
          </CardHeader>
          <CardContent>
            {Object.entries(stats.byInstrument).length === 0 ? (
              <p className="text-muted-foreground text-center py-4">No data yet</p>
            ) : (
              <div className="space-y-3">
                {Object.entries(stats.byInstrument)
                  .sort((a, b) => b[1].pnl - a[1].pnl)
                  .slice(0, 6)
                  .map(([instrument, data]) => {
                    const total = data.wins + data.losses;
                    const winRate = total > 0 ? (data.wins / total) * 100 : 0;
                    return (
                      <div key={instrument} className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="font-medium w-20">{instrument}</span>
                          <span className="text-xs text-muted-foreground">
                            {data.wins}W / {data.losses}L ({winRate.toFixed(0)}%)
                          </span>
                        </div>
                        <span className={`font-mono font-semibold ${
                          data.pnl >= 0 ? 'text-bullish' : 'text-bearish'
                        }`}>
                          {data.pnl >= 0 ? '+' : ''}{data.pnl.toFixed(1)}
                        </span>
                      </div>
                    );
                  })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Performance by Setup */}
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Target className="w-5 h-5" />
              Performance by Setup Type
            </CardTitle>
          </CardHeader>
          <CardContent>
            {Object.entries(stats.bySetup).length === 0 ? (
              <p className="text-muted-foreground text-center py-4">No data yet</p>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={Object.entries(stats.bySetup)
                      .sort((a, b) => (b[1].wins + b[1].losses) - (a[1].wins + a[1].losses))
                      .map(([setup, d]) => ({
                        setup,
                        wins: d.wins,
                        losses: d.losses,
                        pnl: Number(d.pnl.toFixed(1)),
                        winRate: d.wins + d.losses > 0 ? Math.round((d.wins / (d.wins + d.losses)) * 100) : 0,
                      }))}
                    margin={{ top: 8, right: 8, left: -20, bottom: 0 }}
                    barGap={4}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="setup" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" interval={0} angle={-20} textAnchor="end" height={50} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                    <Tooltip
                      cursor={{ fill: 'hsl(var(--muted) / 0.3)' }}
                      contentStyle={{
                        background: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                        fontSize: '12px',
                      }}
                      formatter={(value: number, name: string, item: any) =>
                        name === 'wins'
                          ? [`${value} (${item?.payload?.winRate}% WR)`, 'Wins']
                          : [`${value}`, 'Losses']
                      }
                      labelFormatter={(label, payload) => {
                        const p = payload?.[0]?.payload;
                        return p ? `${label} — ${p.pnl >= 0 ? '+' : ''}${p.pnl} pips` : String(label);
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                    <Bar dataKey="wins" name="Wins" fill="hsl(var(--bullish))" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="losses" name="Losses" fill="hsl(var(--bearish))" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* TP Hit Distribution */}
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Crosshair className="w-5 h-5" />
              Target Hit Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const { tp1, tp2, tp3, sl } = stats.targetHitDistribution;
              const total = tp1 + tp2 + tp3 + sl;
              if (total === 0) {
                return <p className="text-muted-foreground text-center py-4">No auto-tracked trades yet. Trades with SL/TP levels will show which targets get hit most.</p>;
              }
              const items = [
                { label: 'TP1', count: tp1, color: 'text-bullish', bgColor: 'bg-bullish/20', borderColor: 'border-bullish/30' },
                { label: 'TP2', count: tp2, color: 'text-bullish', bgColor: 'bg-bullish/20', borderColor: 'border-bullish/30' },
                { label: 'TP3', count: tp3, color: 'text-bullish', bgColor: 'bg-bullish/20', borderColor: 'border-bullish/30' },
                { label: 'SL', count: sl, color: 'text-bearish', bgColor: 'bg-bearish/20', borderColor: 'border-bearish/30' },
              ];
              return (
                <div className="space-y-4">
                  {items.map(item => {
                    const pct = total > 0 ? (item.count / total) * 100 : 0;
                    return (
                      <div key={item.label} className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className={`inline-flex items-center justify-center w-8 h-6 rounded text-xs font-bold border ${item.bgColor} ${item.color} ${item.borderColor}`}>
                              {item.label}
                            </span>
                            <span className="text-sm text-muted-foreground">
                              {item.count} hit{item.count !== 1 ? 's' : ''}
                            </span>
                          </div>
                          <span className={`font-mono font-semibold text-sm ${item.color}`}>
                            {pct.toFixed(0)}%
                          </span>
                        </div>
                        <Progress value={pct} className="h-2" />
                      </div>
                    );
                  })}
                  <div className="pt-3 border-t border-border">
                    <p className="text-xs text-muted-foreground">
                      {tp1 + tp2 + tp3 > 0 
                        ? `Most common exit: ${tp3 >= tp2 && tp3 >= tp1 ? 'TP3 (full runner)' : tp2 >= tp1 ? 'TP2 (partial)' : 'TP1 (first target)'}`
                        : 'Most exits are stop losses — consider adjusting your entries or SL placement.'}
                    </p>
                  </div>
                </div>
              );
            })()}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}