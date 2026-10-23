import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useUserSettings } from '@/hooks/useUserSettings';
import { GeneratedSignal } from '@/hooks/useGeneratedSignals';
import { TradeRecommendation as TradeRecType, TradingInstrument } from '@/types/trading';
import { GEM_SETUP_TYPES } from '@/lib/selectiveGems';
import { toast } from 'sonner';
import { formatLotSuggestion, suggestLots } from '../../supabase/functions/_shared/analysis/positionSize.ts';
import { alertHeader, strategyLabel } from '../../supabase/functions/_shared/analysis/strategyNames.ts';

// "💰 Lot size: …" from the saved balance and risk %; empty when no balance is set.
const lotLine = (instrument: string, entry: number, stopLoss: number, balance: number | null | undefined, riskPercent: number | undefined) => {
  if (!balance || !(balance > 0)) return '';
  const s = suggestLots({ instrument, entry, stopLoss, balance, riskPercent: riskPercent || 1 });
  return s ? `💰 Lot size: ${formatLotSuggestion(s, balance)} — check the symbol's minimum lot in MT5` : '';
};

const isGemSetupType = (type?: string | null): boolean =>
  typeof type === 'string' && Object.values(GEM_SETUP_TYPES).includes(type as any);

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
    // SMC CHoCH + FVG and Validated Gems are rule-based: the arbitrary confidence threshold does not apply.
    const isSmc = signal.setup_type === 'smc_choch_fvg';
    const isGem = isGemSetupType(signal.setup_type);
    // The V75 inside-bar gem waits at the broken level, like the SMC limit order.
    const isPendingGem = signal.setup_type === GEM_SETUP_TYPES.V75_INSIDEBAR;
    const isRuleBased = isSmc || isGem;
    if (!isRuleBased && signal.confidence < (settings.notify_min_confidence ?? 70)) return;
    if (settings.notify_instruments && settings.notify_instruments.length > 0) {
      if (!settings.notify_instruments.includes(signal.instrument)) return;
    }

    const direction = signal.direction === 'bullish' ? '🟢 LONG' : '🔴 SHORT';
    const targetPrice = signal.take_profit_1 ?? signal.take_profit_2;
    const rr = signal.entry_price && signal.stop_loss && targetPrice
      ? Math.abs(targetPrice - signal.entry_price) / Math.abs(signal.entry_price - signal.stop_loss)
      : 0;

    const gate = extractStructuralGate(signal.reasoning || '');
    const message = [
      `📊 *${alertHeader(signal.trade_type)}*`,
      ``,
      `🏷 *${signal.instrument}* — ${direction}`,
      `📈 Strategy: ${strategyLabel(signal.setup_type)}`,
      // Gem confidence is a fixed number and the gate a default label, so gem alerts leave both out.
      isSmc || isGem ? '' : `🎯 Confidence: ${signal.confidence}%`,
      ``,
      `▶️ Entry: \`${signal.entry_price}\``,
      `🛑 Stop Loss: \`${signal.stop_loss}\``,
      ...(isSmc || isGem
        ? [`✅ Target: \`${targetPrice}\``]
        : [
            `✅ TP1: \`${signal.take_profit_1}\``,
            `✅ TP2: \`${signal.take_profit_2}\``,
            `✅ TP3: \`${signal.take_profit_3}\``,
          ]),
      `📐 R:R: \`${rr.toFixed(1)}\``,
      lotLine(signal.instrument, Number(signal.entry_price), Number(signal.stop_loss), settings.account_balance, settings.risk_percent_per_trade),
      isSmc ? `⏳ Dropped if not filled within 24h` : isPendingGem ? `⏳ Dropped if not filled within 4h` : isGem ? `⚡ Market order: enter now` : '',
      ...triggerLines(signal.confluence_breakdown),
      ``,
      isGem ? '' : `🔒 Gate: ${gate}`,
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
    const decimals = pair.includes('JPY') || pair === 'XAU/USD' || pair.startsWith('V') || pair.startsWith('BOOM') ? 2 : 4;
    const direction = rec.direction === 'bullish' ? '🟢 LONG' : rec.direction === 'bearish' ? '🔴 SHORT' : '⚠️ RANGING';
    const isSmc = rec.setupType === 'smc_choch_fvg';
    const isGem = isGemSetupType(rec.setupType);
    const targetPrice = isSmc || isGem ? rec.risk.takeProfit1 : rec.risk.takeProfit2;
    const rr = rec.direction !== 'ranging' && targetPrice
      ? Math.abs(targetPrice - rec.risk.entry) / Math.abs(rec.risk.entry - rec.risk.stopLoss)
      : 0;

    const gate = extractStructuralGate(rec.reasoning);
    const message = [
      `📊 *${alertHeader(rec.tradeType)}*`,
      ``,
      `🏷 *${pair}* — ${direction}`,
      `📈 Strategy: ${strategyLabel(rec.setupType)}`,
      isSmc || isGem ? '' : `🎯 Confidence: ${rec.confidence}%`,
      ``,
      `▶️ Entry: \`${rec.risk.entry.toFixed(decimals)}\``,
      `🛑 Stop Loss: \`${rec.risk.stopLoss.toFixed(decimals)}\``,
      ...(isSmc || isGem
        ? [`✅ Target: \`${targetPrice.toFixed(decimals)}\``]
        : [
            `✅ TP1: \`${rec.risk.takeProfit1.toFixed(decimals)}\``,
            `✅ TP2: \`${rec.risk.takeProfit2.toFixed(decimals)}\``,
            `✅ TP3: \`${rec.risk.takeProfit3.toFixed(decimals)}\``,
          ]),
      `📐 R:R: \`${rr.toFixed(1)}\``,
      rec.direction !== 'ranging' ? lotLine(pair, rec.risk.entry, rec.risk.stopLoss, settings?.account_balance, settings?.risk_percent_per_trade) : '',
      `⏱ Hold: ${rec.holdingPeriod}`,
      ...triggerLines(rec.confidenceBreakdown),
      ``,
      isGem ? '' : `🔒 Gate: ${gate}`,
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
