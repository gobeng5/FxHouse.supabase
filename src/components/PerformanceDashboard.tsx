import { usePerformanceMetrics } from '@/hooks/usePerformanceMetrics';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, Target, BarChart3, Activity, AlertTriangle } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

export const PerformanceDashboard = () => {
  const { metrics, loading } = usePerformanceMetrics();

  if (loading) {
    return <div className="animate-pulse space-y-4">{[1,2,3].map(i => <div key={i} className="h-32 bg-muted rounded-xl" />)}</div>;
  }

  const statCards = [
    { label: 'Win Rate', value: `${metrics.winRate}%`, icon: Target, color: metrics.winRate >= 50 ? 'text-bullish' : 'text-bearish' },
    { label: 'Profit Factor', value: metrics.profitFactor === Infinity ? '∞' : `${metrics.profitFactor}`, icon: TrendingUp, color: metrics.profitFactor >= 1.5 ? 'text-bullish' : 'text-bearish' },
    { label: 'Avg R', value: `${metrics.averageR}R`, icon: BarChart3, color: metrics.averageR > 0 ? 'text-bullish' : 'text-bearish' },
    { label: 'Max Drawdown', value: `${metrics.maxDrawdownPercent}%`, icon: TrendingDown, color: metrics.maxDrawdownPercent < 10 ? 'text-bullish' : 'text-warning' },
    { label: 'Total R', value: `${metrics.totalRMultiple}R`, icon: Activity, color: metrics.totalRMultiple > 0 ? 'text-bullish' : 'text-bearish' },
    { label: 'Total Trades', value: `${metrics.totalTrades}`, icon: Target, color: 'text-primary' },
  ];

  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {statCards.map((stat) => (
          <Card key={stat.label} className="glass-card">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <stat.icon className={`w-4 h-4 ${stat.color}`} />
                <span className="text-xs text-muted-foreground">{stat.label}</span>
              </div>
              <span className={`text-xl font-bold font-mono ${stat.color}`}>{stat.value}</span>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Equity Curve */}
      {metrics.equityCurve.length > 1 && (
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Equity Curve (R-Multiple)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={metrics.equityCurve}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                  <Tooltip
                    contentStyle={{
                      background: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                  />
                  <Line type="monotone" dataKey="equity" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Instrument Performance */}
      <Card className="glass-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Performance by Instrument</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {Object.entries(metrics.byInstrument)
              .sort(([, a], [, b]) => b.winRate - a.winRate)
              .map(([instrument, data]) => (
                <div key={instrument} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-medium">{instrument}</span>
                    {data.disabled && (
                      <Badge variant="destructive" className="text-[10px] px-1.5 py-0 gap-1">
                        <AlertTriangle className="w-2.5 h-2.5" />
                        Auto-disabled
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-xs font-mono">
                    <span className="text-muted-foreground">{data.won}W / {data.lost}L</span>
                    <span className={data.winRate >= 50 ? 'text-bullish' : 'text-bearish'}>
                      {data.winRate.toFixed(0)}%
                    </span>
                    <span className={data.avgR > 0 ? 'text-bullish' : 'text-bearish'}>
                      {data.avgR > 0 ? '+' : ''}{data.avgR.toFixed(2)}R
                    </span>
                  </div>
                </div>
              ))}
            {Object.keys(metrics.byInstrument).length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No trade data yet. Signals will appear once the engine generates them.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
