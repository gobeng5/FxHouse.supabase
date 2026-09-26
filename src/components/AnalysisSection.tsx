import { DailyAnalysis, FourHourAnalysis, IndicatorAnalysis, CandlestickAnalysis, TradingInstrument, getInstrumentDecimals } from '@/types/trading';
import { PriceActionAnalysis } from '@/lib/priceActionAnalysis';
import { cn } from '@/lib/utils';
import { 
  TrendingUp, TrendingDown, Minus, BarChart3, LineChart, 
  Activity, Layers, CandlestickChart
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface AnalysisSectionProps {
  daily: DailyAnalysis;
  fourHour: FourHourAnalysis;
  indicators: IndicatorAnalysis;
  candlesticks: CandlestickAnalysis;
  pair: TradingInstrument;
  currentPrice: number;
  priceActionAnalysis?: PriceActionAnalysis | null;
}

export const AnalysisSection = ({ daily, fourHour, indicators, candlesticks, pair, currentPrice, priceActionAnalysis }: AnalysisSectionProps) => {
  const decimals = pair === 'USD/JPY' ? 2 : 4;

  const TrendIcon = daily.trend === 'bullish' ? TrendingUp : daily.trend === 'bearish' ? TrendingDown : Minus;
  const trendColor = daily.trend === 'bullish' ? 'text-bullish' : daily.trend === 'bearish' ? 'text-bearish' : 'text-muted-foreground';

  return (
    <div className="glass-card p-5 animate-fade-in-up" style={{ animationDelay: '0.15s' }}>
      <Tabs defaultValue="daily" className="w-full">
        <TabsList className="grid w-full grid-cols-4 bg-muted/50 p-1 mb-4">
          <TabsTrigger value="daily" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-xs">
            <BarChart3 className="w-3 h-3 mr-1" /> Daily
          </TabsTrigger>
          <TabsTrigger value="4h" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-xs">
            <LineChart className="w-3 h-3 mr-1" /> 4H
          </TabsTrigger>
          <TabsTrigger value="indicators" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-xs">
            <Activity className="w-3 h-3 mr-1" /> Indicators
          </TabsTrigger>
          <TabsTrigger value="candles" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-xs">
            <CandlestickChart className="w-3 h-3 mr-1" /> Candles
          </TabsTrigger>
        </TabsList>

        <TabsContent value="daily" className="space-y-4 mt-0">
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
            <div className="flex items-center gap-2">
              <TrendIcon className={cn('w-5 h-5', trendColor)} />
              <span className={cn('font-semibold capitalize', trendColor)}>{daily.trend} Trend</span>
            </div>
            <span className="text-sm text-muted-foreground capitalize">Phase: {daily.marketPhase}</span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Resistance Levels</h4>
              <div className="space-y-1">
                {daily.resistanceLevels.slice(0, 3).map((level, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span className="text-muted-foreground truncate mr-2">{level.description}</span>
                    <span className="font-mono text-bearish">{level.price.toFixed(decimals)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Support Levels</h4>
              <div className="space-y-1">
                {daily.supportLevels.slice(0, 3).map((level, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span className="text-muted-foreground truncate mr-2">{level.description}</span>
                    <span className="font-mono text-bullish">{level.price.toFixed(decimals)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Patterns & Trendlines</h4>
            <div className="flex flex-wrap gap-2">
              {[...daily.patterns, ...daily.trendlines].map((item, i) => (
                <span key={i} className="px-2 py-1 text-xs rounded bg-primary/10 text-primary border border-primary/20">
                  {item}
                </span>
              ))}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="4h" className="space-y-4 mt-0">
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
            <div className="flex items-center gap-2">
              <Layers className={cn('w-5 h-5', fourHour.alignmentWithDaily ? 'text-bullish' : 'text-bearish')} />
              <span className={fourHour.alignmentWithDaily ? 'text-bullish' : 'text-bearish'}>
                {fourHour.alignmentWithDaily ? 'Aligned with Daily' : 'Diverging from Daily'}
              </span>
            </div>
            <span className="text-sm text-muted-foreground">
              Structure: {fourHour.structure.replace('_', '/')}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Fibonacci Retracement</h4>
              <div className="space-y-1">
                {fourHour.fibLevels.map((fib, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{fib.level}</span>
                    <span className="font-mono text-primary">{fib.price.toFixed(decimals)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Pullback Zones</h4>
              <div className="space-y-1">
                {fourHour.pullbackZones.map((zone, i) => (
                  <div key={i} className="text-sm font-mono text-foreground">
                    {zone.toFixed(decimals)}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Supply & Demand Zones</h4>
            <div className="space-y-2">
              {fourHour.supplyDemandZones.map((zone, i) => (
                <div 
                  key={i} 
                  className={cn(
                    'flex justify-between p-2 rounded text-sm border',
                    zone.type === 'supply' ? 'bg-bearish/10 border-bearish/30' : 'bg-bullish/10 border-bullish/30'
                  )}
                >
                  <span className={zone.type === 'supply' ? 'text-bearish' : 'text-bullish'}>
                    {zone.type === 'supply' ? 'Supply Zone' : 'Demand Zone'}
                  </span>
                  <span className="font-mono">
                    {zone.low.toFixed(decimals)} - {zone.high.toFixed(decimals)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="indicators" className="space-y-4 mt-0">
          <div className="grid grid-cols-2 gap-4">
            <div className="p-3 rounded-lg bg-muted/30">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Daily RSI</h4>
              <div className="flex items-center gap-3">
                <span className="font-mono text-2xl font-bold">{indicators.dailyRSI.value}</span>
                <span className={cn(
                  'px-2 py-0.5 text-xs font-semibold rounded uppercase',
                  indicators.dailyRSI.status === 'overbought' ? 'bg-bearish/20 text-bearish' :
                  indicators.dailyRSI.status === 'oversold' ? 'bg-bullish/20 text-bullish' :
                  'bg-muted text-muted-foreground'
                )}>
                  {indicators.dailyRSI.status}
                </span>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-muted/30">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">4H RSI</h4>
              <div className="flex items-center gap-3">
                <span className="font-mono text-2xl font-bold">{indicators.fourHourRSI.value}</span>
                <span className={cn(
                  'px-2 py-0.5 text-xs font-semibold rounded uppercase',
                  indicators.fourHourRSI.status === 'overbought' ? 'bg-bearish/20 text-bearish' :
                  indicators.fourHourRSI.status === 'oversold' ? 'bg-bullish/20 text-bullish' :
                  'bg-muted text-muted-foreground'
                )}>
                  {indicators.fourHourRSI.status}
                </span>
              </div>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-muted/30">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">MACD</h4>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Histogram:</span>
                <span className={cn(
                  'font-mono font-semibold',
                  indicators.dailyMACD.histogram >= 0 ? 'text-bullish' : 'text-bearish'
                )}>
                  {indicators.dailyMACD.histogram.toFixed(4)}
                </span>
              </div>
              <span className={cn(
                'px-2 py-0.5 text-xs font-semibold rounded uppercase',
                indicators.dailyMACD.signal === 'bullish' ? 'bg-bullish/20 text-bullish' :
                indicators.dailyMACD.signal === 'bearish' ? 'bg-bearish/20 text-bearish' :
                'bg-muted text-muted-foreground'
              )}>
                {indicators.dailyMACD.signal}
              </span>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-muted/30">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Moving Averages</h4>
            <div className="grid grid-cols-3 gap-4 mb-3">
              <div>
                <span className="text-xs text-muted-foreground">20 MA</span>
                <div className="font-mono text-sm">{indicators.movingAverages.ma20.toFixed(decimals)}</div>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">50 MA</span>
                <div className="font-mono text-sm">{indicators.movingAverages.ma50.toFixed(decimals)}</div>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">200 MA</span>
                <div className="font-mono text-sm">{indicators.movingAverages.ma200.toFixed(decimals)}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Price Position:</span>
              <span className={cn(
                'text-xs font-semibold',
                indicators.movingAverages.pricePosition === 'above_all' ? 'text-bullish' :
                indicators.movingAverages.pricePosition === 'below_all' ? 'text-bearish' :
                'text-accent'
              )}>
                {indicators.movingAverages.pricePosition.replace('_', ' ').toUpperCase()}
              </span>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="candles" className="space-y-4 mt-0">
          <div className="p-4 rounded-lg bg-muted/30">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Daily Candle</h4>
            <div className="text-lg font-semibold text-primary mb-1">{candlesticks.dailyCandle.type}</div>
            <p className="text-sm text-muted-foreground">{candlesticks.dailyCandle.interpretation}</p>
          </div>

          {/* Show detailed detected patterns from priceActionAnalysis when available */}
          {priceActionAnalysis && priceActionAnalysis.candlestickPatterns.length > 0 ? (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                Detected Candlestick Patterns ({priceActionAnalysis.candlestickPatterns.length})
              </h4>
              <div className="space-y-2">
                {priceActionAnalysis.candlestickPatterns.map((pattern, i) => (
                  <div key={i} className="p-3 rounded-lg bg-muted/30 border border-border/50">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        {pattern.signal === 'bullish' ? (
                          <TrendingUp className="w-4 h-4 text-bullish" />
                        ) : pattern.signal === 'bearish' ? (
                          <TrendingDown className="w-4 h-4 text-bearish" />
                        ) : (
                          <Minus className="w-4 h-4 text-muted-foreground" />
                        )}
                        <span className="font-medium text-foreground">{pattern.name}</span>
                      </div>
                      <span className={cn(
                        'px-2 py-0.5 text-xs font-medium rounded-full border',
                        pattern.strength === 'strong' ? 'bg-bullish/20 text-bullish border-bullish/30' :
                        pattern.strength === 'moderate' ? 'bg-accent/20 text-accent border-accent/30' :
                        'bg-muted text-muted-foreground border-border/30'
                      )}>
                        {pattern.strength}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">{pattern.description}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Identified Patterns</h4>
              <div className="flex flex-wrap gap-2">
                {candlesticks.patterns.map((pattern, i) => (
                  <span key={i} className="px-2 py-1 text-xs rounded bg-primary/10 text-primary border border-primary/20">
                    {pattern}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Show chart patterns from priceActionAnalysis when available */}
          {priceActionAnalysis && priceActionAnalysis.chartPatterns.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                Detected Chart Patterns ({priceActionAnalysis.chartPatterns.length})
              </h4>
              <div className="space-y-2">
                {priceActionAnalysis.chartPatterns.map((pattern, i) => (
                  <div key={i} className="p-3 rounded-lg bg-muted/30 border border-border/50">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        {pattern.signal === 'bullish' ? (
                          <TrendingUp className="w-4 h-4 text-bullish" />
                        ) : pattern.signal === 'bearish' ? (
                          <TrendingDown className="w-4 h-4 text-bearish" />
                        ) : (
                          <Minus className="w-4 h-4 text-muted-foreground" />
                        )}
                        <span className="font-medium text-foreground">{pattern.name}</span>
                      </div>
                      <span className={cn(
                        'px-2 py-0.5 text-xs font-medium rounded-full border',
                        pattern.strength === 'strong' ? 'bg-bullish/20 text-bullish border-bullish/30' :
                        pattern.strength === 'moderate' ? 'bg-accent/20 text-accent border-accent/30' :
                        'bg-muted text-muted-foreground border-border/30'
                      )}>
                        {pattern.strength}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">{pattern.description}</p>
                    {(pattern.priceTarget || pattern.breakoutLevel) && (
                      <div className="flex gap-4 text-xs mt-1">
                        {pattern.breakoutLevel && (
                          <span className="text-muted-foreground">
                            Breakout: <span className="text-primary font-mono">{pattern.breakoutLevel.toFixed(pair === 'USD/JPY' ? 2 : 4)}</span>
                          </span>
                        )}
                        {pattern.priceTarget && (
                          <span className="text-muted-foreground">
                            Target: <span className="text-primary font-mono">{pattern.priceTarget.toFixed(pair === 'USD/JPY' ? 2 : 4)}</span>
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="p-3 rounded-lg bg-muted/30">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">4H Micro Structure</h4>
            <p className="text-sm text-foreground">
              {priceActionAnalysis ? priceActionAnalysis.summary : candlesticks.microStructure}
            </p>
          </div>

          {/* Dominant signal summary when priceActionAnalysis is available */}
          {priceActionAnalysis && (
            <div className={cn(
              'p-3 rounded-lg border',
              priceActionAnalysis.dominantSignal === 'bullish' ? 'bg-bullish/10 border-bullish/30' :
              priceActionAnalysis.dominantSignal === 'bearish' ? 'bg-bearish/10 border-bearish/30' :
              'bg-muted/30 border-border/50'
            )}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {priceActionAnalysis.dominantSignal === 'bullish' ? (
                    <TrendingUp className="w-4 h-4 text-bullish" />
                  ) : priceActionAnalysis.dominantSignal === 'bearish' ? (
                    <TrendingDown className="w-4 h-4 text-bearish" />
                  ) : (
                    <Minus className="w-4 h-4 text-muted-foreground" />
                  )}
                  <span className={cn(
                    'font-medium capitalize',
                    priceActionAnalysis.dominantSignal === 'bullish' ? 'text-bullish' :
                    priceActionAnalysis.dominantSignal === 'bearish' ? 'text-bearish' :
                    'text-muted-foreground'
                  )}>
                    {priceActionAnalysis.dominantSignal} Bias
                  </span>
                </div>
                <span className="text-sm text-muted-foreground">
                  Signal Strength: {priceActionAnalysis.signalStrength.toFixed(0)}%
                </span>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};
