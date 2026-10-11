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

type BreakdownItem = { label?: string; value?: string; contributing?: boolean };

// The parameters that produced a signal, one line each — the stored breakdown's contributing items.
const triggerLines = (breakdown: unknown): string[] => {
  const items = (Array.isArray(breakdown) ? breakdown : []) as BreakdownItem[];
  const lines = items
    .filter(i => i && i.contributing && i.label)
    .slice(0, 12)
    .map(i => `• ${escapeMd(String(i.label))}: ${escapeMd(String(i.value ?? ''))}`);
  return lines.length ? [``, `📋 *What triggered this signal*`, ...lines] : [];
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
    // SMC CHoCH + FVG is rule-based: a limit order with one target and no score,
    // so the confidence threshold does not apply to it.
    const isSmc = signal.setup_type === 'smc_choch_fvg';
    if (!isSmc && signal.confidence < (settings.notify_min_confidence ?? 70)) return;
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
      `📈 Type: ${isSmc ? 'SMC CHoCH + FVG (limit order)' : signal.trade_type.toUpperCase()}`,
      isSmc ? '' : `🎯 Confidence: ${signal.confidence}%`,
      ``,
      `▶️ Entry: \`${signal.entry_price}\``,
      `🛑 Stop Loss: \`${signal.stop_loss}\``,
      ...(isSmc
        ? [`✅ Target: \`${signal.take_profit_2}\``]
        : [
            `✅ TP1: \`${signal.take_profit_1}\``,
            `✅ TP2: \`${signal.take_profit_2}\``,
            `✅ TP3: \`${signal.take_profit_3}\``,
          ]),
      `📐 R:R: \`${rr.toFixed(1)}\``,
      isSmc ? `⏳ Dropped if not filled within 24h` : '',
      ...triggerLines(signal.confluence_breakdown),
      ``,
      `🔒 Gate: ${gate}`,
      ``,
      // The checklist above already says everything the SMC reasoning sentence does.
      signal.reasoning && !isSmc ? `💡 ${escapeMd(signal.reasoning)}` : '',
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
    const isSmc = rec.setupType === 'smc_choch_fvg';
    const message = [
      `📊 *FxHouse Signal*`,
      ``,
      `🏷 *${pair}* — ${direction}`,
      isSmc
        ? `📈 Type: SMC CHoCH + FVG (limit order)`
        : `📈 Type: ${rec.tradeType.toUpperCase()} | Setup: ${escapeMd(rec.setupType.replace('_', ' '))}`,
      isSmc ? '' : `🎯 Confidence: ${rec.confidence}%`,
      ``,
      `▶️ Entry: \`${rec.risk.entry.toFixed(decimals)}\``,
      `🛑 Stop Loss: \`${rec.risk.stopLoss.toFixed(decimals)}\``,
      ...(isSmc
        ? [`✅ Target: \`${rec.risk.takeProfit2.toFixed(decimals)}\``]
        : [
            `✅ TP1: \`${rec.risk.takeProfit1.toFixed(decimals)}\``,
            `✅ TP2: \`${rec.risk.takeProfit2.toFixed(decimals)}\``,
            `✅ TP3: \`${rec.risk.takeProfit3.toFixed(decimals)}\``,
          ]),
      `📐 R:R: \`${rr.toFixed(1)}\``,
      `⏱ Hold: ${rec.holdingPeriod}`,
      ...triggerLines(rec.confidenceBreakdown),
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
