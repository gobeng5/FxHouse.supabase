export type TradingSession = 'asian' | 'pre_london' | 'london' | 'london_ny' | 'new_york' | 'after_hours';

export interface SessionInfo {
  id: TradingSession;
  name: string;
  shortName: string;
  timeRange: string;
  description: string;
  characteristics: string[];
  tradingTips: string[];
  volatility: 'low' | 'medium' | 'high' | 'very_high';
  bestFor: string[];
}

export const SESSION_INFO: Record<TradingSession, SessionInfo> = {
  asian: {
    id: 'asian',
    name: 'Asian Session',
    shortName: 'Asian',
    timeRange: '00:00-07:00 UTC',
    description: 'Range-building session with lower volatility. Key for establishing session highs/lows.',
    characteristics: [
      'Lower volatility and tighter ranges',
      'JPY and AUD pairs most active',
      'Consolidation patterns common',
      'Range highs/lows form key levels for London'
    ],
    tradingTips: [
      'Focus on range trading strategies',
      'Mark Asian session high/low for London breakouts',
      'Avoid major trades before London open',
      'Watch for false breakouts near session end'
    ],
    volatility: 'low',
    bestFor: ['Range trading', 'Level identification', 'JPY/AUD pairs']
  },
  pre_london: {
    id: 'pre_london',
    name: 'Pre-London Session',
    shortName: 'Pre-London',
    timeRange: '07:00-08:00 UTC',
    description: 'Transition period as European traders prepare. Watch for early moves.',
    characteristics: [
      'Volatility starting to increase',
      'Early European flows begin',
      'Stop hunts may target Asian levels',
      'Setup formations for London moves'
    ],
    tradingTips: [
      'Prepare entries near Asian session extremes',
      'Check economic calendar for London releases',
      'Wait for confirmation before entering',
      'Watch for liquidity sweeps of overnight levels'
    ],
    volatility: 'medium',
    bestFor: ['Entry preparation', 'Level confirmation', 'Setup identification']
  },
  london: {
    id: 'london',
    name: 'London Session',
    shortName: 'London',
    timeRange: '08:00-12:00 UTC',
    description: 'Highest volume session. Major moves and trend initiations occur here.',
    characteristics: [
      'Highest liquidity and volume',
      'Strong directional moves common',
      'EUR, GBP pairs most active',
      'Asian range breakouts typical'
    ],
    tradingTips: [
      'Trade breakouts of Asian range',
      'Use momentum strategies',
      'Best time for major forex pairs',
      'Watch for stop hunts then reversals'
    ],
    volatility: 'high',
    bestFor: ['Trend trading', 'Breakouts', 'EUR/GBP pairs']
  },
  london_ny: {
    id: 'london_ny',
    name: 'London/NY Overlap',
    shortName: 'Overlap',
    timeRange: '12:00-17:00 UTC',
    description: 'Most volatile period. Maximum liquidity and strongest moves.',
    characteristics: [
      'Highest volatility of the day',
      'Major economic releases',
      'All major pairs extremely active',
      'Strong continuation or reversal moves'
    ],
    tradingTips: [
      'Best time for scalping and day trades',
      'Trade with the established London trend',
      'Watch for NY reversal patterns',
      'US news can cause sharp reversals'
    ],
    volatility: 'very_high',
    bestFor: ['Day trading', 'Scalping', 'News trading']
  },
  new_york: {
    id: 'new_york',
    name: 'New York Session',
    shortName: 'New York',
    timeRange: '17:00-21:00 UTC',
    description: 'US-focused trading with moderate volatility. Trend continuation or profit-taking.',
    characteristics: [
      'Moderate volatility',
      'USD pairs most active',
      'Profit-taking from earlier moves',
      'Can see trend continuations or reversals'
    ],
    tradingTips: [
      'Trade USD pairs for best moves',
      'Watch for end-of-day positioning',
      'Manage open trades from earlier sessions',
      'Look for pullback entries in trends'
    ],
    volatility: 'medium',
    bestFor: ['USD pairs', 'Trend continuation', 'Position management']
  },
  after_hours: {
    id: 'after_hours',
    name: 'After Hours',
    shortName: 'After Hours',
    timeRange: '21:00-00:00 UTC',
    description: 'Low liquidity period. Avoid new positions unless trading Asian open.',
    characteristics: [
      'Very low liquidity',
      'Wider spreads',
      'Minimal price movement',
      'Preparation for Asian session'
    ],
    tradingTips: [
      'Avoid opening new positions',
      'Best time for analysis and planning',
      'Set up orders for Asian session',
      'Review day trades and update journal'
    ],
    volatility: 'low',
    bestFor: ['Analysis', 'Planning', 'Journal updates']
  }
};

export const getCurrentSession = (date: Date = new Date()): TradingSession => {
  const hour = date.getUTCHours();
  
  if (hour >= 0 && hour < 7) return 'asian';
  if (hour >= 7 && hour < 8) return 'pre_london';
  if (hour >= 8 && hour < 12) return 'london';
  if (hour >= 12 && hour < 17) return 'london_ny';
  if (hour >= 17 && hour < 21) return 'new_york';
  return 'after_hours';
};

export const getSessionInfo = (session: TradingSession): SessionInfo => {
  return SESSION_INFO[session];
};

export const getCurrentSessionInfo = (date: Date = new Date()): SessionInfo => {
  return SESSION_INFO[getCurrentSession(date)];
};

export const getNextSession = (current: TradingSession): TradingSession => {
  const order: TradingSession[] = ['asian', 'pre_london', 'london', 'london_ny', 'new_york', 'after_hours'];
  const currentIndex = order.indexOf(current);
  return order[(currentIndex + 1) % order.length];
};

export const getTimeUntilNextSession = (date: Date = new Date()): { session: TradingSession; minutes: number } => {
  const hour = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const totalMinutes = hour * 60 + minutes;
  
  const sessionStarts: { session: TradingSession; start: number }[] = [
    { session: 'asian', start: 0 },
    { session: 'pre_london', start: 7 * 60 },
    { session: 'london', start: 8 * 60 },
    { session: 'london_ny', start: 12 * 60 },
    { session: 'new_york', start: 17 * 60 },
    { session: 'after_hours', start: 21 * 60 },
  ];
  
  for (let i = 0; i < sessionStarts.length; i++) {
    if (totalMinutes < sessionStarts[i].start) {
      return {
        session: sessionStarts[i].session,
        minutes: sessionStarts[i].start - totalMinutes
      };
    }
  }
  
  // After 21:00, next session is Asian at 00:00
  return {
    session: 'asian',
    minutes: 24 * 60 - totalMinutes
  };
};

export const getSessionRecommendation = (
  session: TradingSession,
  direction: 'bullish' | 'bearish' | 'ranging',
  isSynthetic: boolean = false
): string => {
  if (isSynthetic) {
    return 'Synthetic indices trade 24/7 with consistent volatility. Apply SMC analysis regardless of session.';
  }
  
  const recommendations: Record<TradingSession, Record<string, string>> = {
    asian: {
      bullish: 'Wait for London session for momentum entries. Mark Asian high for potential breakout target.',
      bearish: 'Wait for London session for momentum entries. Mark Asian low for potential breakdown target.',
      ranging: 'Range trading favorable. Set limit orders at Asian session extremes with tight stops.'
    },
    pre_london: {
      bullish: 'Prepare buy limit near Asian low if swept. Wait for 8AM UTC confirmation.',
      bearish: 'Prepare sell limit near Asian high if swept. Wait for 8AM UTC confirmation.',
      ranging: 'Wait for London open to establish direction. Mark key levels for breakout entries.'
    },
    london: {
      bullish: 'Optimal entry window. Look for Asian low sweep and reclaim for long entries.',
      bearish: 'Optimal entry window. Look for Asian high sweep and rejection for short entries.',
      ranging: 'Wait for directional break. Trade the first clear breakout with momentum.'
    },
    london_ny: {
      bullish: 'Continue with London trend. Scale into longs on pullbacks. Target daily levels.',
      bearish: 'Continue with London trend. Scale into shorts on pullbacks. Target daily levels.',
      ranging: 'High volatility expected. Wait for clear break or trade mean reversion at extremes.'
    },
    new_york: {
      bullish: 'Manage existing longs. Consider partial profits. New entries only on strong pullbacks.',
      bearish: 'Manage existing shorts. Consider partial profits. New entries only on strong pullbacks.',
      ranging: 'Focus on position management. Avoid new entries unless clear opportunity appears.'
    },
    after_hours: {
      bullish: 'No new entries recommended. Plan for Asian session. Review daily analysis.',
      bearish: 'No new entries recommended. Plan for Asian session. Review daily analysis.',
      ranging: 'Best time for analysis and journaling. Set alerts for key levels.'
    }
  };
  
  return recommendations[session][direction];
};

// ===== Kill Zone Detection =====

export type KillZoneId = 'london_open' | 'ny_open' | 'london_close' | 'asian_open';

export interface KillZone {
  id: KillZoneId;
  name: string;
  shortName: string;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  description: string;
  volatility: 'high' | 'very_high';
  bestPairs: string[];
  color: string;
}

export const KILL_ZONES: KillZone[] = [
  {
    id: 'asian_open',
    name: 'Asian Kill Zone',
    shortName: 'Asia KZ',
    startHour: 0,
    startMinute: 0,
    endHour: 3,
    endMinute: 0,
    description: 'JPY/AUD pairs active. Lower volatility but key for range establishment.',
    volatility: 'high',
    bestPairs: ['USD/JPY', 'AUD/USD', 'GBP/JPY'],
    color: 'info',
  },
  {
    id: 'london_open',
    name: 'London Kill Zone',
    shortName: 'London KZ',
    startHour: 7,
    startMinute: 0,
    endHour: 9,
    endMinute: 0,
    description: 'Highest probability setups. Asian range sweeps and trend initiations happen here.',
    volatility: 'very_high',
    bestPairs: ['EUR/USD', 'GBP/USD', 'GBP/JPY', 'XAU/USD'],
    color: 'bullish',
  },
  {
    id: 'ny_open',
    name: 'New York Kill Zone',
    shortName: 'NY KZ',
    startHour: 12,
    startMinute: 0,
    endHour: 14,
    endMinute: 0,
    description: 'Major reversals or continuations. News-driven volatility. Best for USD pairs.',
    volatility: 'very_high',
    bestPairs: ['EUR/USD', 'GBP/USD', 'USD/JPY', 'XAU/USD'],
    color: 'primary',
  },
  {
    id: 'london_close',
    name: 'London Close Kill Zone',
    shortName: 'LDN Close KZ',
    startHour: 15,
    startMinute: 0,
    endHour: 17,
    endMinute: 0,
    description: 'Profit-taking and reversals common. Watch for stop hunts at day extremes.',
    volatility: 'high',
    bestPairs: ['EUR/USD', 'GBP/USD', 'GBP/JPY'],
    color: 'warning',
  },
];

export interface KillZoneStatus {
  active: KillZone | null;
  upcoming: KillZone | null;
  minutesUntilNext: number;
  isInKillZone: boolean;
  allZones: (KillZone & { isActive: boolean; minutesUntil: number })[];
}

// Forex/XAU trade Sunday ~22:00 UTC through Friday ~22:00 UTC. Outside that
// window the market is closed: Deriv's candle feed still returns the last
// historical candles on request, but they stop advancing — analyzing them as
// if live produces a signal priced at a stale close that will have gapped by
// the time the market actually reopens. Synthetic indices are unaffected;
// they trade 24/7 and should never be passed through this check.
// Note: this uses a fixed UTC cutover, not NY-session DST rules, so the real
// open/close can drift by up to an hour around the US/UK DST changeover weeks.
export const isForexMarketClosed = (now: Date = new Date()): boolean => {
  const day = now.getUTCDay(); // 0 = Sunday, 6 = Saturday
  const hour = now.getUTCHours();
  if (day === 6) return true; // all day Saturday
  if (day === 0 && hour < 22) return true; // Sunday before ~22:00 UTC open
  if (day === 5 && hour >= 22) return true; // Friday from ~22:00 UTC close
  return false;
};

export const getKillZoneStatus = (date: Date = new Date()): KillZoneStatus => {
  const hour = date.getUTCHours();
  const minute = date.getUTCMinutes();
  const totalMinutes = hour * 60 + minute;

  let active: KillZone | null = null;
  let upcoming: KillZone | null = null;
  let minutesUntilNext = Infinity;

  const allZones = KILL_ZONES.map(kz => {
    const start = kz.startHour * 60 + kz.startMinute;
    const end = kz.endHour * 60 + kz.endMinute;
    const isActive = totalMinutes >= start && totalMinutes < end;

    let minutesUntil = 0;
    if (isActive) {
      minutesUntil = 0;
    } else if (totalMinutes < start) {
      minutesUntil = start - totalMinutes;
    } else {
      minutesUntil = (24 * 60 - totalMinutes) + start;
    }

    if (isActive) active = kz;
    if (!isActive && minutesUntil < minutesUntilNext) {
      minutesUntilNext = minutesUntil;
      upcoming = kz;
    }

    return { ...kz, isActive, minutesUntil };
  });

  return {
    active,
    upcoming,
    minutesUntilNext: minutesUntilNext === Infinity ? 0 : minutesUntilNext,
    isInKillZone: active !== null,
    allZones,
  };
};