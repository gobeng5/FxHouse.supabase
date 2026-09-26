import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useUserSettings } from '@/hooks/useUserSettings';
import { GeneratedSignal } from '@/hooks/useGeneratedSignals';
import { TradeRecommendation as TradeRecType, TradingInstrument } from '@/types/trading';
import { toast } from 'sonner';

// Strip Telegram Markdown special characters from plain text to avoid parse errors
const escapeMd = (text: string): string =>
  text.replace(/[_*`\[\]]/g, '');

// Extract structural gate triggers from reasoning text
const extractStructuralGate = (reasoning: string): string => {
  const triggers: string[] = [];
  if (/BOS confirmed/i.test(reasoning)) triggers.push('BOS ✅');
  if (/CHoCH confirmed/i.test(reasoning)) triggers.push('CHoCH ✅');
  if (/Liquidity sweep.*confirmed/i.test(reasoning)) triggers.push('Liq Sweep ✅');
  if (/HH.HL structure/i.test(reasoning)) triggers.push('HH/HL Structure ✅');
  if (/LH.LL structure/i.test(reasoning)) triggers.push('LH/LL Structure ✅');
  if (/unmitigated OB/i.test(reasoning)) {
    const match = reasoning.match(/(\d+)\s*unmitigated OB/i);
    triggers.push(`${match ? match[1] : ''} OBs ✅`);
  }
  return triggers.length > 0 ? triggers.join(' | ') : 'Structure Aligned ✅';
};

export const useTelegramAlert = () => {
  const { settings } = useUserSettings();

  const sendMessage = useCallback(async (message: string) => {
    if (!settings?.telegram_enabled || !settings?.telegram_bot_token || !settings?.telegram_chat_id) {
      toast.error('Telegram not configured. Go to Settings to set up.');
      return false;
    }
    try {
      await supabase.functions.invoke('send-telegram', {
        body: { action: 'send', bot_token: settings.telegram_bot_token, chat_id: settings.telegram_chat_id, message },
      });
      return true;
    } catch (err) {
      console.error('Failed to send Telegram alert:', err);
      toast.error('Failed to send Telegram message');
      return false;
    }
  }, [settings]);

  const sendSignalAlert = useCallback(async (signal: GeneratedSignal) => {
    if (!settings?.telegram_enabled || !settings?.telegram_bot_token || !settings?.telegram_chat_id) return;
    if (signal.confidence < (settings.notify_min_confidence ?? 70)) return;
    if (settings.notify_instruments && settings.notify_instruments.length > 0) {
      if (!settings.notify_instruments.includes(signal.instrument)) return;
    }

    const direction = signal.direction === 'bullish' ? '🟢 LONG' : '🔴 SHORT';
    const rr = signal.entry_price && signal.stop_loss && signal.take_profit_2
      ? Math.abs(signal.take_profit_2 - signal.entry_price) / Math.abs(signal.entry_price - signal.stop_loss)
      : 0;

    const gate = extractStructuralGate(signal.reasoning || '');
    const message = [
      `📊 *FX Swing Bot Signal*`,
      ``,
      `🏷 *${signal.instrument}* — ${direction}`,
      `📈 Type: ${signal.trade_type.toUpperCase()}`,
      `🎯 Confidence: ${signal.confidence}%`,
      ``,
      `▶️ Entry: \`${signal.entry_price}\``,
      `🛑 Stop Loss: \`${signal.stop_loss}\``,
      `✅ TP1: \`${signal.take_profit_1}\``,
      `✅ TP2: \`${signal.take_profit_2}\``,
      `✅ TP3: \`${signal.take_profit_3}\``,
      `📐 R:R: \`${rr.toFixed(1)}\``,
      ``,
      `🔒 Gate: ${gate}`,
      ``,
      signal.reasoning ? `💡 ${escapeMd(signal.reasoning)}` : '',
      ``,
      `🕐 ${new Date(signal.generated_at).toUTCString()}`,
      `🆔 \`${signal.id.slice(0, 8)}\``,
    ].filter(Boolean).join('\n');

    await sendMessage(message);
  }, [settings, sendMessage]);

  const sendTradeRecommendation = useCallback(async (rec: TradeRecType, pair: TradingInstrument) => {
    const decimals = pair === 'USD/JPY' ? 2 : 4;
    const direction = rec.direction === 'bullish' ? '🟢 LONG' : rec.direction === 'bearish' ? '🔴 SHORT' : '⚠️ RANGING';
    const rr = rec.direction !== 'ranging'
      ? Math.abs(rec.risk.takeProfit2 - rec.risk.entry) / Math.abs(rec.risk.entry - rec.risk.stopLoss)
      : 0;

    const gate = extractStructuralGate(rec.reasoning);
    const message = [
      `📊 *FxHouse Signal*`,
      ``,
      `🏷 *${pair}* — ${direction}`,
      `📈 Type: ${rec.tradeType.toUpperCase()} | Setup: ${escapeMd(rec.setupType.replace('_', ' '))}`,
      `🎯 Confidence: ${rec.confidence}%`,
      ``,
      `▶️ Entry: \`${rec.risk.entry.toFixed(decimals)}\``,
      `🛑 Stop Loss: \`${rec.risk.stopLoss.toFixed(decimals)}\``,
      `✅ TP1: \`${rec.risk.takeProfit1.toFixed(decimals)}\``,
      `✅ TP2: \`${rec.risk.takeProfit2.toFixed(decimals)}\``,
      `✅ TP3: \`${rec.risk.takeProfit3.toFixed(decimals)}\``,
      `📐 R:R: \`${rr.toFixed(1)}\``,
      `⏱ Hold: ${rec.holdingPeriod}`,
      ``,
      `🔒 Gate: ${gate}`,
      ``,
      `💡 ${escapeMd(rec.reasoning)}`,
      ``,
      `🕐 ${new Date().toUTCString()}`,
    ].filter(Boolean).join('\n');

    const success = await sendMessage(message);
    if (success) toast.success('Signal sent to Telegram!');
    return success;
  }, [sendMessage]);

  return { sendSignalAlert, sendTradeRecommendation };
};
