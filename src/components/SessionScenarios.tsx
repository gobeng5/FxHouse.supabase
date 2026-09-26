import { useState, useEffect } from 'react';
import { SessionScenario, TrendDirection, TradingInstrument, getInstrumentDecimals, isSyntheticIndex } from '@/types/trading';
import { cn } from '@/lib/utils';
import { 
  TrendingUp, TrendingDown, Minus, Clock, AlertTriangle, 
  Target, XCircle, Lightbulb, Timer, Zap, Moon, Sun
} from 'lucide-react';
import { 
  getCurrentSession, 
  getSessionInfo, 
  getNextSession, 
  getTimeUntilNextSession,
  getSessionRecommendation,
  TradingSession,
  SessionInfo
} from '@/lib/sessionUtils';
import { Badge } from '@/components/ui/badge';

interface SessionScenariosProps {
  london: SessionScenario;
  londonNY: {
    probableDirection: TrendDirection;
    stopHuntZones: number[];
  };
  pair: TradingInstrument;
}

const SessionBadge = ({ session, isActive }: { session: SessionInfo; isActive: boolean }) => {
  const volatilityColors = {
    low: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    very_high: 'bg-red-500/20 text-red-400 border-red-500/30'
  };

  return (
    <Badge 
      variant="outline" 
      className={cn(
        'text-xs',
        isActive ? 'bg-primary/20 text-primary border-primary animate-pulse' : volatilityColors[session.volatility]
      )}
    >
      {session.volatility.replace('_', ' ')} volatility
    </Badge>
  );
};

const SessionIcon = ({ session }: { session: TradingSession }) => {
  switch (session) {
    case 'asian':
      return <Moon className="w-4 h-4" />;
    case 'pre_london':
    case 'london':
      return <Sun className="w-4 h-4" />;
    case 'london_ny':
      return <Zap className="w-4 h-4" />;
    case 'new_york':
      return <Sun className="w-4 h-4" />;
    case 'after_hours':
      return <Moon className="w-4 h-4" />;
  }
};

export const SessionScenarios = ({ london, londonNY, pair }: SessionScenariosProps) => {
  const [currentTime, setCurrentTime] = useState(new Date());
  const decimals = getInstrumentDecimals(pair);
  const isSynthetic = isSyntheticIndex(pair);

  // Update time every minute
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(interval);
  }, []);

  const currentSession = getCurrentSession(currentTime);
  const sessionInfo = getSessionInfo(currentSession);
  const nextSessionInfo = getSessionInfo(getNextSession(currentSession));
  const timeUntilNext = getTimeUntilNextSession(currentTime);
  const sessionRecommendation = getSessionRecommendation(currentSession, londonNY.probableDirection, isSynthetic);

  const DirectionIcon = londonNY.probableDirection === 'bullish' ? TrendingUp : 
                        londonNY.probableDirection === 'bearish' ? TrendingDown : Minus;

  return (
    <div className="glass-card p-5 animate-fade-in-up" style={{ animationDelay: '0.25s' }}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-primary" />
          <h3 className="section-title mb-0">Session Analysis</h3>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Timer className="w-3 h-3" />
          <span>
            {timeUntilNext.minutes} min until {nextSessionInfo.shortName}
          </span>
        </div>
      </div>

      {/* Current Session Card */}
      <div className="mb-4 p-4 rounded-lg bg-primary/5 border border-primary/20">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-full bg-primary/20">
              <SessionIcon session={currentSession} />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-foreground">{sessionInfo.name}</h4>
              <span className="text-xs text-muted-foreground">{sessionInfo.timeRange}</span>
            </div>
          </div>
          <SessionBadge session={sessionInfo} isActive={true} />
        </div>

        <p className="text-xs text-muted-foreground mb-3">{sessionInfo.description}</p>

        {/* Session Recommendation */}
        <div className="p-3 rounded-lg bg-accent/10 border border-accent/30">
          <div className="flex items-start gap-2">
            <Lightbulb className="w-4 h-4 text-accent flex-shrink-0 mt-0.5" />
            <div>
              <span className="text-xs font-semibold text-accent uppercase">Session Recommendation</span>
              <p className="text-sm text-foreground mt-1">{sessionRecommendation}</p>
            </div>
          </div>
        </div>

        {/* Session Tips */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          {sessionInfo.tradingTips.slice(0, 2).map((tip, i) => (
            <div key={i} className="text-xs text-muted-foreground flex items-start gap-1">
              <span className="text-primary">•</span>
              <span>{tip}</span>
            </div>
          ))}
        </div>

        {/* Best For */}
        <div className="mt-3 flex flex-wrap gap-1">
          {sessionInfo.bestFor.map((item, i) => (
            <Badge key={i} variant="secondary" className="text-xs">
              {item}
            </Badge>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        {/* Current Session Scenarios - Dynamic based on active session */}
        <div>
          <h4 className="text-sm font-semibold text-foreground mb-3">
            {currentSession === 'london' ? 'London Session' : 
             currentSession === 'london_ny' ? 'London/NY Overlap' :
             currentSession === 'asian' ? 'Asian Session' :
             currentSession === 'new_york' ? 'New York Session' :
             'Current Session'} Scenarios
          </h4>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Bull Scenario */}
            <div className="p-3 rounded-lg bg-bullish/10 border border-bullish/30">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-4 h-4 text-bullish" />
                <span className="text-sm font-semibold text-bullish">Bull Scenario</span>
                <span className="ml-auto text-xs font-mono text-bullish">{london.bullScenario.probability}%</span>
              </div>
              <p className="text-xs text-muted-foreground mb-2">{london.bullScenario.trigger}</p>
              <div className="flex items-center gap-1">
                <Target className="w-3 h-3 text-bullish" />
                <span className="text-xs text-muted-foreground">Target:</span>
                <span className="font-mono text-xs font-semibold text-bullish">
                  {london.bullScenario.target.toFixed(decimals)}
                </span>
              </div>
            </div>

            {/* Bear Scenario */}
            <div className="p-3 rounded-lg bg-bearish/10 border border-bearish/30">
              <div className="flex items-center gap-2 mb-2">
                <TrendingDown className="w-4 h-4 text-bearish" />
                <span className="text-sm font-semibold text-bearish">Bear Scenario</span>
                <span className="ml-auto text-xs font-mono text-bearish">{london.bearScenario.probability}%</span>
              </div>
              <p className="text-xs text-muted-foreground mb-2">{london.bearScenario.trigger}</p>
              <div className="flex items-center gap-1">
                <Target className="w-3 h-3 text-bearish" />
                <span className="text-xs text-muted-foreground">Target:</span>
                <span className="font-mono text-xs font-semibold text-bearish">
                  {london.bearScenario.target.toFixed(decimals)}
                </span>
              </div>
            </div>

            {/* Range Scenario */}
            <div className="p-3 rounded-lg bg-muted border border-border">
              <div className="flex items-center gap-2 mb-2">
                <Minus className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-semibold text-muted-foreground">Range Scenario</span>
              </div>
              <p className="text-xs text-muted-foreground mb-2">{london.rangeScenario.condition}</p>
              <div className="text-xs">
                <span className="text-muted-foreground">Range: </span>
                <span className="font-mono font-semibold">
                  {london.rangeScenario.range.low.toFixed(decimals)} - {london.rangeScenario.range.high.toFixed(decimals)}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-3 p-2 rounded bg-bearish/5 border border-bearish/20 flex items-center gap-2">
            <XCircle className="w-4 h-4 text-bearish flex-shrink-0" />
            <span className="text-xs text-muted-foreground">Invalidation:</span>
            <span className="font-mono text-sm font-semibold text-bearish">
              {london.invalidation.toFixed(decimals)}
            </span>
          </div>
        </div>

        {/* Overlap Info */}
        <div>
          <h4 className="text-sm font-semibold text-foreground mb-3">
            {currentSession === 'london_ny' ? 'Current Overlap Analysis' : 'Upcoming Overlap Forecast'}
          </h4>
          
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-lg bg-muted/50">
              <div className="flex items-center gap-2 mb-2">
                <DirectionIcon className={cn(
                  'w-4 h-4',
                  londonNY.probableDirection === 'bullish' ? 'text-bullish' :
                  londonNY.probableDirection === 'bearish' ? 'text-bearish' :
                  'text-muted-foreground'
                )} />
                <span className="text-xs font-semibold text-muted-foreground uppercase">Probable Direction</span>
              </div>
              <span className={cn(
                'text-lg font-bold capitalize',
                londonNY.probableDirection === 'bullish' ? 'text-bullish' :
                londonNY.probableDirection === 'bearish' ? 'text-bearish' :
                'text-muted-foreground'
              )}>
                {londonNY.probableDirection}
              </span>
            </div>

            <div className="p-3 rounded-lg bg-warning/10 border border-warning/30">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-warning" />
                <span className="text-xs font-semibold text-muted-foreground uppercase">Stop Hunt Zones</span>
              </div>
              <div className="space-y-1">
                {londonNY.stopHuntZones.length > 0 ? (
                  londonNY.stopHuntZones.map((zone, i) => (
                    <div key={i} className="font-mono text-sm text-warning">{zone.toFixed(decimals)}</div>
                  ))
                ) : (
                  <div className="text-xs text-muted-foreground">No zones identified</div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Session Characteristics */}
        <div className="p-3 rounded-lg bg-muted/30 border border-border">
          <h5 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Session Characteristics</h5>
          <div className="grid grid-cols-2 gap-2">
            {sessionInfo.characteristics.map((char, i) => (
              <div key={i} className="text-xs text-foreground flex items-start gap-1">
                <span className="text-primary">→</span>
                <span>{char}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
