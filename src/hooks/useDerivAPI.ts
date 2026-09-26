import { useState, useEffect, useCallback, useRef } from 'react';
import { TradingInstrument, ALL_INSTRUMENTS } from '@/types/trading';
import {
  DEFAULT_DERIV_APP_ID,
  DERIV_SYMBOL_MAP,
  DERIV_WS_BASE_URLS,
  getDerivWsUrl,
} from '@/lib/deriv';

export interface TickData {
  symbol: string;
  quote: number;
  epoch: number;
}

export interface PriceData {
  price: number;
  change: number;
  changePercent: number;
  trend: 'up' | 'down' | 'flat';
  lastUpdate: Date;
}

export interface CandleData {
  open: number;
  high: number;
  low: number;
  close: number;
  epoch: number;
}

const createInitialPrices = (): Record<TradingInstrument, PriceData> => {
  const prices: Partial<Record<TradingInstrument, PriceData>> = {};
  ALL_INSTRUMENTS.forEach(instrument => {
    prices[instrument] = { price: 0, change: 0, changePercent: 0, trend: 'flat', lastUpdate: new Date() };
  });
  return prices as Record<TradingInstrument, PriceData>;
};

const createInitialEpochs = (): Record<TradingInstrument, number> => {
  const epochs: Partial<Record<TradingInstrument, number>> = {};
  ALL_INSTRUMENTS.forEach(instrument => {
    epochs[instrument] = 0;
  });
  return epochs as Record<TradingInstrument, number>;
};

interface UseDerivAPIReturn {
  prices: Record<TradingInstrument, PriceData>;
  isConnected: boolean;
  error: string | null;
  isMarketClosed: boolean;
  reconnect: () => void;
  getCandles: (instrument: TradingInstrument, granularity: number, count: number) => Promise<CandleData[]>;
}

export const useDerivAPI = (): UseDerivAPIReturn => {
  const [prices, setPrices] = useState<Record<TradingInstrument, PriceData>>(createInitialPrices);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMarketClosed, setIsMarketClosed] = useState(false);
  
  const wsRef = useRef<WebSocket | null>(null);
  const previousPricesRef = useRef<Record<string, number>>({});
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsUrlIndexRef = useRef(0);
  const lastTickEpochRef = useRef<Record<TradingInstrument, number>>(createInitialEpochs());

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    try {
      console.log('Connecting to Deriv API...');
      const wsUrl = getDerivWsUrl(DEFAULT_DERIV_APP_ID, wsUrlIndexRef.current);
      console.log('Deriv WS URL:', wsUrl);

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('Deriv WebSocket connected');
        setIsConnected(true);
        setError(null);

        // Subscribe to tick streams for all pairs
        Object.entries(DERIV_SYMBOL_MAP).forEach(([pair, symbol]) => {
          const msg = { ticks: symbol, subscribe: 1 };
          ws.send(JSON.stringify(msg));
          console.log(`Subscribed to ${symbol} for ${pair}`);
        });

        // Keep connection alive with ping
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ ping: 1 }));
          }
        }, 30000);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.error) {
            console.error('Deriv API error:', data.error);
            if (data.error.code === 'MarketIsClosed') {
              setIsMarketClosed(true);
              setError('Market is closed (weekends/holidays)');
            } else {
              setError(data.error.message);
            }
            return;
          }
          
          // Market is open if we receive ticks
          setIsMarketClosed(false);

          if (data.msg_type === 'tick') {
            const tick = data.tick;
            const symbol = tick.symbol;
            const quote = tick.quote;
            
            // Find the instrument for this symbol
            const instrumentEntry = Object.entries(DERIV_SYMBOL_MAP).find(([_, sym]) => sym === symbol);
            if (instrumentEntry) {
              const instrument = instrumentEntry[0] as TradingInstrument;
              lastTickEpochRef.current[instrument] = tick.epoch;
              const prevPrice = previousPricesRef.current[symbol] || quote;
              const change = quote - prevPrice;
              const changePercent = prevPrice > 0 ? (change / prevPrice) * 100 : 0;
              
              previousPricesRef.current[symbol] = quote;

              setPrices(prev => ({
                ...prev,
                [instrument]: {
                  price: quote,
                  change: change,
                  changePercent: changePercent,
                  trend: change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
                  lastUpdate: new Date(tick.epoch * 1000),
                },
              }));
            }
          }
        } catch (e) {
          console.error('Error parsing Deriv message:', e);
        }
      };

      ws.onerror = (event) => {
        console.error('Deriv WebSocket error:', event);
        setError(`WebSocket connection error (endpoint: ${DERIV_WS_BASE_URLS[wsUrlIndexRef.current]})`);
      };

      ws.onclose = (event) => {
        console.log('Deriv WebSocket closed:', event.code, event.reason);
        setIsConnected(false);

        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
        }

        // Rotate endpoint on abnormal close (1006 etc.)
        if (event.code !== 1000) {
          wsUrlIndexRef.current = (wsUrlIndexRef.current + 1) % DERIV_WS_BASE_URLS.length;
        }

        // Auto-reconnect after 5 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          console.log('Attempting to reconnect...');
          connect();
        }, 5000);
      };
    } catch (e) {
      console.error('Failed to create WebSocket:', e);
      setError('Failed to connect to Deriv API');
    }
  }, []);

  const waitForOpen = useCallback((timeoutMs: number = 8000) => {
    return new Promise<void>((resolve, reject) => {
      const started = Date.now();

      const check = () => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          resolve();
          return;
        }

        if (Date.now() - started > timeoutMs) {
          reject(new Error('WebSocket connection timeout'));
          return;
        }

        setTimeout(check, 150);
      };

      check();
    });
  }, []);

  const disconnect = useCallback(() => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const reconnect = useCallback(() => {
    disconnect();
    connect();
  }, [connect, disconnect]);

  const getCandles = useCallback(async (
    instrument: TradingInstrument, 
    granularity: number = 86400, // Default: daily (seconds)
    count: number = 100
  ): Promise<CandleData[]> => {
    return new Promise((resolve, reject) => {
      const ensureConnected = async () => {
        try {
          if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
            connect();
            await waitForOpen();
          }
        } catch (e) {
          reject(e instanceof Error ? e : new Error('Failed to connect'));
        }
      };

      const symbol = DERIV_SYMBOL_MAP[instrument];
      const requestId = Date.now();

      const handleMessage = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          if (data.req_id === requestId) {
            wsRef.current?.removeEventListener('message', handleMessage);
            
            if (data.error) {
              reject(new Error(data.error.message));
              return;
            }

            if (data.candles) {
              const candles: CandleData[] = data.candles.map((c: any) => ({
                open: c.open,
                high: c.high,
                low: c.low,
                close: c.close,
                epoch: c.epoch,
              }));
              resolve(candles);
            }
          }
        } catch (e) {
          reject(e);
        }
      };

      ensureConnected().then(() => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          reject(new Error('WebSocket not connected'));
          return;
        }

        wsRef.current.addEventListener('message', handleMessage);

        wsRef.current.send(JSON.stringify({
          ticks_history: symbol,
          adjust_start_time: 1,
          count: count,
          end: 'latest',
          granularity: granularity,
          style: 'candles',
          req_id: requestId,
        }));
      }).catch(reject);

      // Timeout after 10 seconds
      setTimeout(() => {
        wsRef.current?.removeEventListener('message', handleMessage);
        reject(new Error('Request timeout'));
      }, 10000);
    });
  }, [connect, waitForOpen]);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return {
    prices,
    isConnected,
    error,
    isMarketClosed,
    reconnect,
    getCandles,
  };
};
