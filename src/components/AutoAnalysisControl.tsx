import { useState, useEffect } from 'react';
import { Play, Pause, RefreshCw, Clock, AlertCircle, CheckCircle, Activity } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AutoAnalysisState } from '@/hooks/useAutoAnalysis';
import { ALL_INSTRUMENTS } from '@/types/trading';

interface AutoAnalysisControlProps {
  state: AutoAnalysisState;
  isAutoEnabled: boolean;
  onToggle: (enabled: boolean) => void;
  onRunNow: () => void;
}

export const AutoAnalysisControl = ({
  state,
  isAutoEnabled,
  onToggle,
  onRunNow,
}: AutoAnalysisControlProps) => {
  const [countdown, setCountdown] = useState<string>('');
  
  // Update countdown every second
  useEffect(() => {
    if (!state.nextRunTime) {
      setCountdown('');
      return;
    }
    
    const interval = setInterval(() => {
      const now = new Date();
      const diff = state.nextRunTime!.getTime() - now.getTime();
      
      if (diff <= 0) {
        setCountdown('Running...');
        return;
      }
      
      const minutes = Math.floor(diff / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      setCountdown(`${minutes}m ${seconds}s`);
    }, 1000);
    
    return () => clearInterval(interval);
  }, [state.nextRunTime]);
  
  const progress = state.totalCount > 0 
    ? (state.analyzedCount / state.totalCount) * 100 
    : 0;
  
  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            <CardTitle className="text-lg">Auto-Analysis</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="auto-analysis" className="text-sm text-muted-foreground">
              {isAutoEnabled ? 'Enabled' : 'Disabled'}
            </Label>
            <Switch
              id="auto-analysis"
              checked={isAutoEnabled}
              onCheckedChange={onToggle}
            />
          </div>
        </div>
        <CardDescription>
          Automatically analyze all instruments every hour
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Status */}
        <div className="flex items-center gap-3">
          {state.isRunning ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin text-primary" />
              <span className="text-sm">
                Analyzing {state.currentlyAnalyzing}...
              </span>
            </>
          ) : isAutoEnabled ? (
            <>
              <CheckCircle className="w-4 h-4 text-bullish" />
              <span className="text-sm text-muted-foreground">Ready</span>
            </>
          ) : (
            <>
              <Pause className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Paused</span>
            </>
          )}
        </div>
        
        {/* Progress bar when running */}
        {state.isRunning && (
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Progress</span>
              <span>{state.analyzedCount} / {state.totalCount}</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>
        )}
        
        {/* Timing info */}
        <div className="flex flex-wrap gap-2 text-xs">
          {state.lastRunTime && (
            <Badge variant="outline" className="gap-1">
              <Clock className="w-3 h-3" />
              Last: {state.lastRunTime.toLocaleTimeString('en-GB', { timeZone: 'GMT', hour12: false })} GMT
            </Badge>
          )}
          {countdown && isAutoEnabled && (
            <Badge variant="secondary" className="gap-1">
              <RefreshCw className="w-3 h-3" />
              Next: {countdown}
            </Badge>
          )}
        </div>
        
        {/* Errors */}
        {state.errors.length > 0 && (
          <div className="flex items-start gap-2 text-xs text-warning">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{state.errors.length} instrument(s) failed</span>
          </div>
        )}
        
        {/* Manual run button */}
        <Button
          variant="outline"
          size="sm"
          onClick={onRunNow}
          disabled={state.isRunning}
          className="w-full gap-2"
        >
          {state.isRunning ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : (
            <Play className="w-4 h-4" />
          )}
          {state.isRunning ? 'Analyzing...' : 'Run Analysis Now'}
        </Button>
        
        {/* Instrument count */}
        <p className="text-xs text-center text-muted-foreground">
          Monitoring {ALL_INSTRUMENTS.length} instruments
        </p>
      </CardContent>
    </Card>
  );
};
