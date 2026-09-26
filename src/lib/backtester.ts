import { CandleData } from '@/hooks/useDerivAPI';
import { TradingInstrument, getInstrumentDecimals } from '@/types/trading';
import { generateTradePlan } from './tradeSignalGenerator';

export interface BacktestTrade {
  entryDate: string;
  direction: 'bullish' | 'bearish';
  entryPrice: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  exitPrice: number;
  outcome: 'won' | 'lost';
  rMultiple: number;
  confidence: number;
  pnlPips: number;
  session: 'london' | 'ny' | 'asian' | 'overlap';
  holdBars: number;
  setupType: string;
}

export interface SessionStats {
  session: string;
  trades: number;
  wins: number;
  winRate: number;
  totalR: number;
  avgR: number;
}

export interface StreakInfo {
  currentStreak: number;
  currentType: 'win' | 'loss' | 'none';
  longestWinStreak: number;
  longestLossStreak: number;
}

export interface MonteCarloResult {
  median: number;
  p5: number;   // 5th percentile (worst case)
  p25: number;
  p75: number;
  p95: number;  // 95th percentile (best case)
  probabilityOfRuin: number; // % of paths that hit -10R
  curves: { trade: number; equity: number }[][]; // sample paths for chart
}

export interface BacktestResult {
  instrument: TradingInstrument;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalR: number;
  avgR: number;
  maxDrawdownR: number;
  profitFactor: number;
  equityCurve: { date: string; equity: number }[];
  trades: BacktestTrade[];
  daysAnalyzed: number;
  // Enhanced metrics
  sharpeRatio: number;
  avgWinR: number;
  avgLossR: number;
  expectancy: number;
  sessionStats: SessionStats[];
  streakInfo: StreakInfo;
  monteCarlo: MonteCarloResult;
  consecutiveDrawdowns: number;
  recoveryFactor: number;
  bestTrade: BacktestTrade | null;
  worstTrade: BacktestTrade | null;
}

/**
 * Determine trading session from epoch timestamp
 */
const getSession = (epoch: number): 'london' | 'ny' | 'asian' | 'overlap' => {
  const hour = new Date(epoch * 1000).getUTCHours();
  if (hour >= 13 && hour < 17) return 'overlap'; // London-NY overlap
  if (hour >= 8 && hour < 13) return 'london';
  if (hour >= 13 && hour < 22) return 'ny';
  return 'asian';
};

/**
 * Calculate streak information from trade results
 */
const calculateStreaks = (trades: BacktestTrade[]): StreakInfo => {
  let longestWin = 0, longestLoss = 0;
  let currentWin = 0, currentLoss = 0;

  for (const t of trades) {
    if (t.outcome === 'won') {
      currentWin++;
      currentLoss = 0;
      longestWin = Math.max(longestWin, currentWin);
    } else {
      currentLoss++;
      currentWin = 0;
      longestLoss = Math.max(longestLoss, currentLoss);
    }
  }

  const last = trades[trades.length - 1];
  return {
    currentStreak: last ? (last.outcome === 'won' ? currentWin : currentLoss) : 0,
    currentType: last ? (last.outcome === 'won' ? 'win' : 'loss') : 'none',
    longestWinStreak: longestWin,
    longestLossStreak: longestLoss,
  };
};

/**
 * Monte Carlo simulation — shuffles trade R-multiples 500 times
 * to estimate distribution of outcomes and probability of ruin.
 */
const runMonteCarlo = (trades: BacktestTrade[], simulations = 500): MonteCarloResult => {
  const rValues = trades.map(t => t.rMultiple);
  const n = rValues.length;
  if (n === 0) return { median: 0, p5: 0, p25: 0, p75: 0, p95: 0, probabilityOfRuin: 0, curves: [] };

  const finalEquities: number[] = [];
  const sampleCurves: { trade: number; equity: number }[][] = [];
  let ruinCount = 0;
  const RUIN_THRESHOLD = -10;

  for (let sim = 0; sim < simulations; sim++) {
    // Fisher-Yates shuffle
    const shuffled = [...rValues];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    let equity = 0;
    let hitRuin = false;
    const curve: { trade: number; equity: number }[] = [{ trade: 0, equity: 0 }];

    for (let t = 0; t < n; t++) {
      equity += shuffled[t];
      curve.push({ trade: t + 1, equity: Number(equity.toFixed(2)) });
      if (equity <= RUIN_THRESHOLD) hitRuin = true;
    }

    finalEquities.push(equity);
    if (hitRuin) ruinCount++;
    if (sim < 20) sampleCurves.push(curve); // keep 20 paths for visualization
  }

  finalEquities.sort((a, b) => a - b);
  const percentile = (p: number) => finalEquities[Math.floor(p / 100 * finalEquities.length)] ?? 0;

  return {
    median: Number(percentile(50).toFixed(2)),
    p5: Number(percentile(5).toFixed(2)),
    p25: Number(percentile(25).toFixed(2)),
    p75: Number(percentile(75).toFixed(2)),
    p95: Number(percentile(95).toFixed(2)),
    probabilityOfRuin: Number(((ruinCount / simulations) * 100).toFixed(1)),
    curves: sampleCurves,
  };
};

/**
 * Calculate session-based statistics
 */
const calculateSessionStats = (trades: BacktestTrade[]): SessionStats[] => {
  const sessions = ['london', 'ny', 'asian', 'overlap'] as const;
  return sessions.map(session => {
    const sessionTrades = trades.filter(t => t.session === session);
    const wins = sessionTrades.filter(t => t.outcome === 'won').length;
    const totalR = sessionTrades.reduce((s, t) => s + t.rMultiple, 0);
    return {
      session,
      trades: sessionTrades.length,
      wins,
      winRate: sessionTrades.length > 0 ? Number(((wins / sessionTrades.length) * 100).toFixed(1)) : 0,
      totalR: Number(totalR.toFixed(2)),
      avgR: sessionTrades.length > 0 ? Number((totalR / sessionTrades.length).toFixed(2)) : 0,
    };
  }).filter(s => s.trades > 0);
};

/**
 * Enhanced 30-day replay backtester with Monte Carlo, session stats, and streaks.
 */
export const runBacktest = (
  instrument: TradingInstrument,
  dailyCandles: CandleData[],
  fourHourCandles: CandleData[],
  oneHourCandles: CandleData[]
): BacktestResult => {
  const trades: BacktestTrade[] = [];
  const pipMultiplier = instrument.includes('JPY') || instrument === 'XAU/USD' ? 100 : 10000;
  
  if (fourHourCandles.length < 70) {
    return emptyResult(instrument);
  }

  const step = 6;
  const lookback = 50;
  const walkForward = 18;

  for (let i = lookback; i < fourHourCandles.length - walkForward; i += step) {
    const windowDaily = dailyCandles.slice(0, Math.min(dailyCandles.length, Math.floor(i / 6) + 10));
    const window4H = fourHourCandles.slice(Math.max(0, i - lookback), i);
    const window1H = oneHourCandles.slice(0, Math.min(oneHourCandles.length, i * 4));

    if (windowDaily.length < 50 || window4H.length < 50) continue;
    const trimmed1H = window1H.length >= 30 ? window1H.slice(-50) : oneHourCandles.slice(0, 50);
    if (trimmed1H.length < 30) continue;

    try {
      const currentPrice = window4H[window4H.length - 1].close;
      const plan = generateTradePlan(instrument, windowDaily, window4H, trimmed1H, currentPrice);

      const rec = plan.recommendation;
      if (rec.direction === 'ranging' || rec.confidence < 55) continue;

      const entry = rec.risk.entry;
      const sl = rec.risk.stopLoss;
      const tp2 = rec.risk.takeProfit2;
      const risk = Math.abs(entry - sl);

      if (risk === 0) continue;

      const futureCandles = fourHourCandles.slice(i, i + walkForward);
      let outcome: 'won' | 'lost' | null = null;
      let exitPrice = entry;
      let holdBars = 0;

      for (const candle of futureCandles) {
        holdBars++;
        if (rec.direction === 'bullish') {
          if (candle.low <= sl) { outcome = 'lost'; exitPrice = sl; break; }
          if (candle.high >= tp2) { outcome = 'won'; exitPrice = tp2; break; }
        } else {
          if (candle.high >= sl) { outcome = 'lost'; exitPrice = sl; break; }
          if (candle.low <= tp2) { outcome = 'won'; exitPrice = tp2; break; }
        }
      }

      if (!outcome) continue;

      const pnlPips = rec.direction === 'bullish'
        ? (exitPrice - entry) * pipMultiplier
        : (entry - exitPrice) * pipMultiplier;
      const rMultiple = outcome === 'won' ? Math.abs(exitPrice - entry) / risk : -1;

      trades.push({
        entryDate: new Date(fourHourCandles[i].epoch * 1000).toISOString().split('T')[0],
        direction: rec.direction as 'bullish' | 'bearish',
        entryPrice: entry,
        stopLoss: sl,
        tp1: rec.risk.takeProfit1,
        tp2,
        tp3: rec.risk.takeProfit3,
        exitPrice,
        outcome,
        rMultiple: Number(rMultiple.toFixed(2)),
        confidence: rec.confidence,
        pnlPips: Number(pnlPips.toFixed(1)),
        session: getSession(fourHourCandles[i].epoch),
        holdBars,
        setupType: rec.reasoning?.split('.')[0]?.trim() || 'SMC',
      });
    } catch {
      continue;
    }
  }

  if (trades.length === 0) return emptyResult(instrument);

  const wins = trades.filter(t => t.outcome === 'won').length;
  const losses = trades.filter(t => t.outcome === 'lost').length;
  const totalR = trades.reduce((sum, t) => sum + t.rMultiple, 0);
  const winTrades = trades.filter(t => t.outcome === 'won');
  const lossTrades = trades.filter(t => t.outcome === 'lost');
  const grossWins = winTrades.reduce((s, t) => s + t.rMultiple, 0);
  const grossLosses = Math.abs(lossTrades.reduce((s, t) => s + t.rMultiple, 0));

  const avgWinR = winTrades.length > 0 ? Number((grossWins / winTrades.length).toFixed(2)) : 0;
  const avgLossR = lossTrades.length > 0 ? Number((grossLosses / lossTrades.length).toFixed(2)) : 0;
  const winRate = wins / trades.length;
  const expectancy = Number((winRate * avgWinR - (1 - winRate) * avgLossR).toFixed(2));

  // Sharpe ratio (using R-multiples as returns)
  const meanR = totalR / trades.length;
  const variance = trades.reduce((s, t) => s + Math.pow(t.rMultiple - meanR, 2), 0) / trades.length;
  const stdDev = Math.sqrt(variance);
  const sharpeRatio = stdDev > 0 ? Number((meanR / stdDev).toFixed(2)) : 0;

  // Equity curve & drawdown
  let equity = 0, maxEquity = 0, maxDrawdown = 0;
  let consecutiveDrawdowns = 0, currentDD = 0;
  const equityCurve = trades.map(t => {
    equity += t.rMultiple;
    maxEquity = Math.max(maxEquity, equity);
    const dd = maxEquity - equity;
    if (dd > 0) { currentDD++; consecutiveDrawdowns = Math.max(consecutiveDrawdowns, currentDD); }
    else { currentDD = 0; }
    maxDrawdown = Math.max(maxDrawdown, dd);
    return { date: t.entryDate, equity: Number(equity.toFixed(2)) };
  });

  const recoveryFactor = maxDrawdown > 0 ? Number((totalR / maxDrawdown).toFixed(2)) : totalR > 0 ? Infinity : 0;

  const firstCandle = fourHourCandles[lookback];
  const lastCandle = fourHourCandles[fourHourCandles.length - walkForward - 1];
  const daysAnalyzed = Math.round((lastCandle.epoch - firstCandle.epoch) / 86400);

  // Best/worst trades
  const sorted = [...trades].sort((a, b) => b.rMultiple - a.rMultiple);
  const bestTrade = sorted[0] || null;
  const worstTrade = sorted[sorted.length - 1] || null;

  return {
    instrument,
    totalTrades: trades.length,
    wins,
    losses,
    winRate: Number((winRate * 100).toFixed(1)),
    totalR: Number(totalR.toFixed(2)),
    avgR: Number(meanR.toFixed(2)),
    maxDrawdownR: Number(maxDrawdown.toFixed(2)),
    profitFactor: grossLosses > 0 ? Number((grossWins / grossLosses).toFixed(2)) : grossWins > 0 ? Infinity : 0,
    equityCurve,
    trades,
    daysAnalyzed,
    sharpeRatio,
    avgWinR,
    avgLossR,
    expectancy,
    sessionStats: calculateSessionStats(trades),
    streakInfo: calculateStreaks(trades),
    monteCarlo: runMonteCarlo(trades),
    consecutiveDrawdowns,
    recoveryFactor,
    bestTrade,
    worstTrade,
  };
};

const emptyResult = (instrument: TradingInstrument): BacktestResult => ({
  instrument,
  totalTrades: 0,
  wins: 0,
  losses: 0,
  winRate: 0,
  totalR: 0,
  avgR: 0,
  maxDrawdownR: 0,
  profitFactor: 0,
  equityCurve: [],
  trades: [],
  daysAnalyzed: 0,
  sharpeRatio: 0,
  avgWinR: 0,
  avgLossR: 0,
  expectancy: 0,
  sessionStats: [],
  streakInfo: { currentStreak: 0, currentType: 'none', longestWinStreak: 0, longestLossStreak: 0 },
  monteCarlo: { median: 0, p5: 0, p25: 0, p75: 0, p95: 0, probabilityOfRuin: 0, curves: [] },
  consecutiveDrawdowns: 0,
  recoveryFactor: 0,
  bestTrade: null,
  worstTrade: null,
});
