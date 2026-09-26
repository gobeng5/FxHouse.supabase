import { useEffect, useRef, useState } from 'react';
import { createChart, CandlestickSeries, IChartApi, ISeriesApi, CandlestickData, Time, createSeriesMarkers, SeriesMarker } from 'lightweight-charts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CandleData } from '@/hooks/useDerivAPI';
import { OrderBlock, FairValueGap, SMCChartPoints } from '@/lib/smcAnalysis';
import { CandlestickPattern, ChartPattern } from '@/lib/priceActionAnalysis';
import { TradingInstrument } from '@/types/trading';
import { SMCBoxPrimitive, SMCLinePrimitive, buildBoxZones, buildLabeledLines, SMCChartData } from '@/lib/chartPlugins';
import { BarChart3 } from 'lucide-react';

interface PriceChartProps {
  candles: CandleData[];
  orderBlocks: OrderBlock[];
  fairValueGaps: FairValueGap[];
  pair: TradingInstrument;
  currentPrice?: number;
  candlestickPatterns?: CandlestickPattern[];
  chartPatterns?: ChartPattern[];
  smcChartPoints?: SMCChartPoints | null;
}

export const PriceChart = ({
  candles,
  orderBlocks,
  fairValueGaps,
  pair,
  currentPrice,
  candlestickPatterns = [],
  chartPatterns = [],
  smcChartPoints,
}: PriceChartProps) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const markersRef = useRef<ReturnType<typeof createSeriesMarkers> | null>(null);
  const boxPrimitiveRef = useRef<SMCBoxPrimitive | null>(null);
  const linePrimitiveRef = useRef<SMCLinePrimitive | null>(null);
  const [isReady, setIsReady] = useState(false);

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: 'transparent' },
        textColor: '#9ca3af',
      },
      grid: {
        vertLines: { color: 'rgba(156, 163, 175, 0.1)' },
        horzLines: { color: 'rgba(156, 163, 175, 0.1)' },
      },
      crosshair: {
        mode: 1,
        vertLine: { color: 'rgba(156, 163, 175, 0.5)', width: 1, style: 2 },
        horzLine: { color: 'rgba(156, 163, 175, 0.5)', width: 1, style: 2 },
      },
      rightPriceScale: {
        borderColor: 'rgba(156, 163, 175, 0.2)',
        scaleMargins: { top: 0.1, bottom: 0.2 },
      },
      timeScale: {
        borderColor: 'rgba(156, 163, 175, 0.2)',
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: { vertTouchDrag: false },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });

    // Attach SMC primitives
    const boxPrimitive = new SMCBoxPrimitive(candleSeries, chart);
    const linePrimitive = new SMCLinePrimitive(candleSeries, chart);
    candleSeries.attachPrimitive(boxPrimitive);
    candleSeries.attachPrimitive(linePrimitive);

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    boxPrimitiveRef.current = boxPrimitive;
    linePrimitiveRef.current = linePrimitive;
    setIsReady(true);

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, []);

  // Update candle data
  useEffect(() => {
    if (!candleSeriesRef.current || !isReady || candles.length === 0) return;

    const chartData: CandlestickData<Time>[] = candles.map((c) => ({
      time: c.epoch as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    candleSeriesRef.current.setData(chartData);
    chartRef.current?.timeScale().fitContent();
  }, [candles, isReady]);

  // Draw SMC zones and structural lines
  useEffect(() => {
    if (!candleSeriesRef.current || !isReady || candles.length === 0) return;

    const lastEpoch = candles[candles.length - 1].epoch;

    // Build SMC chart data
    const smcData: SMCChartData = {
      orderBlocks,
      fairValueGaps,
      swingPoints: smcChartPoints?.swingPoints ?? [],
      choch: smcChartPoints?.choch ?? [],
      bos: smcChartPoints?.bos ?? [],
      liquidityZones: smcChartPoints?.liquidityZones ?? [],
      lastCandleEpoch: lastEpoch,
    };

    // Update box zones (OBs + FVGs as rectangles)
    boxPrimitiveRef.current?.setZones(buildBoxZones(smcData));

    // Build labeled lines (CHoCH, BOS, liquidity, current price)
    const lines = buildLabeledLines(smcData);

    // Current price line
    if (currentPrice) {
      lines.push({
        price: currentPrice,
        time: (lastEpoch - 100 * 14400) as Time,
        endTime: lastEpoch as Time,
        color: '#f59e0b',
        lineStyle: 'solid',
        lineWidth: 2,
        label: 'Current',
        labelColor: '#f59e0b',
        labelBg: 'rgba(100, 70, 0, 0.8)',
      });
    }

    linePrimitiveRef.current?.setLines(lines);

    // Candlestick pattern markers only
    const patternMarkers: SeriesMarker<Time>[] = candlestickPatterns.map((pattern) => ({
      time: pattern.epoch as Time,
      position: pattern.signal === 'bullish' ? 'belowBar' : pattern.signal === 'bearish' ? 'aboveBar' : 'inBar',
      color: pattern.signal === 'bullish' ? '#10b981' : pattern.signal === 'bearish' ? '#f43f5e' : '#f59e0b',
      shape: pattern.strength === 'strong' ? 'circle' : 'arrowUp',
      text: pattern.name.substring(0, 3).toUpperCase(),
      size: pattern.strength === 'strong' ? 2 : 1,
    }));

    const sortedMarkers = patternMarkers.sort((a, b) => Number(a.time) - Number(b.time));

    if (markersRef.current) {
      markersRef.current.setMarkers(sortedMarkers);
    } else if (sortedMarkers.length > 0) {
      markersRef.current = createSeriesMarkers(candleSeriesRef.current, sortedMarkers);
    }
  }, [orderBlocks, fairValueGaps, candlestickPatterns, currentPrice, isReady, candles, smcChartPoints]);

  return (
    <Card className="bg-card/50 backdrop-blur border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-primary" />
            {pair} Price Chart (4H)
          </CardTitle>
          <span className="text-[10px] font-mono text-muted-foreground bg-muted/30 border border-border/30 rounded px-1.5 py-0.5">200D / 300 4H / 200 1H</span>
        </div>
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground mt-2">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm border border-dashed border-green-500/70 bg-green-500/15" />
            <span>OB ▲</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm border border-dashed border-red-500/70 bg-red-500/15" />
            <span>OB ▼</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-blue-500/20 border border-blue-500/50" />
            <span>FVG</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-0.5 bg-amber-400" />
            <span>CHoCH</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-0.5 bg-emerald-400" />
            <span>BOS</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-0.5 bg-orange-400 border-dashed" style={{ borderBottom: '1px dotted' }} />
            <span>Liquidity</span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {candles.length === 0 ? (
          <div className="h-[400px] flex items-center justify-center text-muted-foreground">
            Run analysis to load chart data
          </div>
        ) : (
          <div ref={chartContainerRef} className="h-[400px] w-full" />
        )}
      </CardContent>
    </Card>
  );
};
