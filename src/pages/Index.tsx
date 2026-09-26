import { useMemo, useState, useCallback } from 'react';
import { getInstrumentDecimals } from '@/types/trading';
import { useAnalysis } from '@/hooks/useAnalysis';
import { SignalDirection } from '@/lib/correlation';
import { Header } from '@/components/Header';
import { CurrencySelector } from '@/components/CurrencySelector';
import { Disclaimer } from '@/components/Disclaimer';
import { BrandedBackground } from '@/components/BrandedBackground';
import { OverviewTab } from '@/components/tabs/OverviewTab';
import { AnalysisTab } from '@/components/tabs/AnalysisTab';
import { SignalsTab } from '@/components/tabs/SignalsTab';
import { ToolsTab } from '@/components/tabs/ToolsTab';
import { BacktestTab } from '@/components/tabs/BacktestTab';
import { PerformanceDashboard } from '@/components/PerformanceDashboard';
import { SettingsPanel } from '@/components/SettingsPanel';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { PriceInlineSkeleton } from '@/components/PriceSkeleton';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RefreshCw, Download, Zap, AlertTriangle, Clock, BarChart3, Target, Settings2, Activity, TrendingUp, FlaskConical } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
const Index = () => {
  const {
    selectedInstrument, setSelectedInstrument,
    isAnalyzing, hasRealAnalysis,
    chartCandles, orderBlocks, fairValueGaps,
    priceActionAnalysis, signalTimestamp, obvData, smcChartPoints,
    prices, isConnected, error, isCurrentMarketClosed,
    reconnect, pairData, currentPlan,
    handleAnalyze, handleExport,
    autoAnalysisState, isAutoEnabled, toggleAutoAnalysis, runFullAnalysis,
  } = useAnalysis();

  // Track signals from all analyzed pairs for correlation checking
  const [analyzedSignals, setAnalyzedSignals] = useState<SignalDirection[]>([]);

  // Update correlation signals when a new analysis completes
  const otherSignals = useMemo(() => {
    if (!hasRealAnalysis || !currentPlan) return analyzedSignals;
    
    const current: SignalDirection = {
      instrument: selectedInstrument,
      direction: currentPlan.recommendation.direction,
      confidence: currentPlan.recommendation.confidence,
    };
    
    // Merge: replace existing signal for same instrument, add new ones
    const merged = analyzedSignals.filter(s => s.instrument !== selectedInstrument);
    if (current.direction !== 'ranging') merged.push(current);
    
    // Only update state if different to avoid infinite loops
    if (JSON.stringify(merged) !== JSON.stringify(analyzedSignals)) {
      // Use setTimeout to avoid setState during render
      setTimeout(() => setAnalyzedSignals(merged), 0);
    }
    
    return merged;
  }, [hasRealAnalysis, currentPlan, selectedInstrument, analyzedSignals]);

  const decimals = getInstrumentDecimals(selectedInstrument);

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      <BrandedBackground variant="subtle" animated={true} />
      <Header isConnected={isConnected} error={error} isMarketClosed={isCurrentMarketClosed} />

      <main className="container mx-auto px-4 py-6 max-w-7xl">
        <section className="mb-4">
          <CurrencySelector selected={selectedInstrument} onChange={setSelectedInstrument} pairData={pairData} />
        </section>

        {isCurrentMarketClosed && (
          <Alert className="mb-4 border-amber-500/50 bg-amber-500/10">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <AlertDescription className="text-amber-500">
              Forex market is currently closed (weekends: Friday 5PM - Sunday 5PM EST). Historical data and analysis are still available.
            </AlertDescription>
          </Alert>
        )}

        {/* Action Bar */}
        <section className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${isConnected && !isCurrentMarketClosed ? 'bg-bullish' : isCurrentMarketClosed ? 'bg-amber-500' : 'bg-bearish'} animate-pulse`} />
              <span className="text-sm text-muted-foreground">
                {isCurrentMarketClosed
                  ? 'Forex market closed - using last available prices'
                  : isConnected && prices[selectedInstrument].price > 0
                    ? `Live price: ${prices[selectedInstrument].price.toFixed(decimals)}`
                    : isConnected
                      ? <span className="inline-flex items-center gap-2">Live price: <PriceInlineSkeleton /></span>
                      : 'Connecting to live feed...'}
              </span>
              {!isConnected && !isCurrentMarketClosed && (
                <Button variant="ghost" size="sm" onClick={reconnect} className="text-xs">Retry</Button>
              )}
            </div>
            {signalTimestamp && hasRealAnalysis && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground bg-muted/50 px-2 py-1 rounded">
                <Clock className="w-3 h-3" />
                <span>Signal generated: {signalTimestamp.toLocaleTimeString('en-GB', { timeZone: 'GMT', hour12: false })} GMT</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={handleExport} className="gap-2">
              <Download className="w-4 h-4" /> Export
            </Button>
            {hasRealAnalysis && (
              <Button variant="outline" size="sm" onClick={() => handleAnalyze(true)} disabled={isAnalyzing} className="gap-2">
                <RefreshCw className="w-4 h-4" /> Refresh
              </Button>
            )}
            <Button size="sm" onClick={() => handleAnalyze(false)} disabled={isAnalyzing} className="gap-2 bg-primary hover:bg-primary/90">
              {isAnalyzing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              {isAnalyzing ? 'Analyzing...' : 'Run Analysis'}
            </Button>
          </div>
        </section>

        {!hasRealAnalysis && (
          <Alert className="mb-4 border-warning/50 bg-warning/10">
            <AlertTriangle className="h-4 w-4 text-warning" />
            <AlertDescription className="text-warning">
              Showing mock data. Click "Run Analysis" to generate real SMC-based trade signals from live chart data.
            </AlertDescription>
          </Alert>
        )}

        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="flex w-full overflow-x-auto no-scrollbar bg-muted/50 p-1 mb-6 h-auto md:grid md:grid-cols-7">
            <TabsTrigger value="overview" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground gap-1.5 py-2.5 px-3 text-xs sm:text-sm flex-shrink-0">
              <BarChart3 className="w-4 h-4" /><span className="hidden sm:inline">Overview</span>
            </TabsTrigger>
            <TabsTrigger value="analysis" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground gap-1.5 py-2.5 px-3 text-xs sm:text-sm flex-shrink-0">
              <Activity className="w-4 h-4" /><span className="hidden sm:inline">Analysis</span>
            </TabsTrigger>
            <TabsTrigger value="signals" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground gap-1.5 py-2.5 px-3 text-xs sm:text-sm flex-shrink-0">
              <Target className="w-4 h-4" /><span className="hidden sm:inline">Signals</span>
            </TabsTrigger>
            <TabsTrigger value="backtest" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground gap-1.5 py-2.5 px-3 text-xs sm:text-sm flex-shrink-0">
              <FlaskConical className="w-4 h-4" /><span className="hidden sm:inline">Backtest</span>
            </TabsTrigger>
            <TabsTrigger value="performance" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground gap-1.5 py-2.5 px-3 text-xs sm:text-sm flex-shrink-0">
              <TrendingUp className="w-4 h-4" /><span className="hidden sm:inline">Performance</span>
            </TabsTrigger>
            <TabsTrigger value="tools" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground gap-1.5 py-2.5 px-3 text-xs sm:text-sm flex-shrink-0">
              <Settings2 className="w-4 h-4" /><span className="hidden sm:inline">Tools</span>
            </TabsTrigger>
            <TabsTrigger value="settings" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground gap-1.5 py-2.5 px-3 text-xs sm:text-sm flex-shrink-0">
              <Zap className="w-4 h-4" /><span className="hidden sm:inline">Settings</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-0">
            <ErrorBoundary fallbackTitle="Overview tab crashed">
              <OverviewTab
                chartCandles={chartCandles} orderBlocks={orderBlocks} fairValueGaps={fairValueGaps}
                instrument={selectedInstrument} currentPlan={currentPlan}
                priceActionAnalysis={priceActionAnalysis} obvData={obvData}
                smcChartPoints={smcChartPoints}
              />
            </ErrorBoundary>
          </TabsContent>

          <TabsContent value="analysis" className="mt-0">
            <ErrorBoundary fallbackTitle="Analysis tab crashed">
              <AnalysisTab
                currentPlan={currentPlan} instrument={selectedInstrument}
                priceActionAnalysis={priceActionAnalysis} otherSignals={otherSignals}
              />
            </ErrorBoundary>
          </TabsContent>

          <TabsContent value="signals" className="mt-0">
            <ErrorBoundary fallbackTitle="Signals tab crashed">
              <SignalsTab
                currentPlan={currentPlan}
                instrument={selectedInstrument}
                prices={prices}
                onReanalyze={(inst) => {
                  setSelectedInstrument(inst);
                  setTimeout(() => handleAnalyze(true), 50);
                }}
              />
            </ErrorBoundary>
          </TabsContent>

          <TabsContent value="backtest" className="mt-0">
            <ErrorBoundary fallbackTitle="Backtest tab crashed">
              <BacktestTab instrument={selectedInstrument} />
            </ErrorBoundary>
          </TabsContent>

          <TabsContent value="performance" className="mt-0">
            <ErrorBoundary fallbackTitle="Performance tab crashed">
              <PerformanceDashboard />
            </ErrorBoundary>
          </TabsContent>

          <TabsContent value="tools" className="mt-0">
            <ErrorBoundary fallbackTitle="Tools tab crashed">
              <ToolsTab
                currentPlan={currentPlan} instrument={selectedInstrument}
                currentPrice={prices[selectedInstrument].price}
                autoAnalysisState={autoAnalysisState} isAutoEnabled={isAutoEnabled}
                onToggleAuto={toggleAutoAnalysis} onRunNow={runFullAnalysis}
              />
            </ErrorBoundary>
          </TabsContent>

          <TabsContent value="settings" className="mt-0">
            <ErrorBoundary fallbackTitle="Settings crashed">
              <div className="max-w-2xl mx-auto"><SettingsPanel /></div>
            </ErrorBoundary>
          </TabsContent>
        </Tabs>

        <section className="mt-8"><Disclaimer /></section>
      </main>
    </div>
  );
};

export default Index;
