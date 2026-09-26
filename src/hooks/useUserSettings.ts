import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export interface UserSettings {
  id: string;
  user_id: string;
  risk_percent_per_trade: number;
  max_daily_loss_percent: number;
  max_drawdown_percent: number;
  max_trades_per_day: number;
  auto_disable_on_drawdown: boolean;
  signals_paused: boolean;
  telegram_enabled: boolean;
  telegram_bot_token: string | null;
  telegram_chat_id: string | null;
  notify_min_confidence: number;
  notify_instruments: string[];
  forex_min_rr: number;
  synthetic_min_rr: number;
  ignore_counter_trend: boolean;
  auto_engine_enabled: boolean;
}

const DEFAULT_SETTINGS: Omit<UserSettings, 'id' | 'user_id'> = {
  risk_percent_per_trade: 1.0,
  max_daily_loss_percent: 5.0,
  max_drawdown_percent: 15.0,
  max_trades_per_day: 10,
  auto_disable_on_drawdown: true,
  signals_paused: false,
  telegram_enabled: false,
  telegram_bot_token: null,
  telegram_chat_id: null,
  notify_min_confidence: 70,
  notify_instruments: [],
  forex_min_rr: 2.0,
  synthetic_min_rr: 2.5,
  ignore_counter_trend: true,
  auto_engine_enabled: true,
};

export const useUserSettings = () => {
  const { user } = useAuth();
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSettings = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    
    try {
      const { data, error } = await supabase
        .from('user_settings')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setSettings(data as unknown as UserSettings);
      } else {
        // Create default settings
        const { data: newData, error: insertErr } = await supabase
          .from('user_settings')
          .insert({ user_id: user.id, ...DEFAULT_SETTINGS })
          .select()
          .single();
        
        if (insertErr) throw insertErr;
        setSettings(newData as unknown as UserSettings);
      }
    } catch (err) {
      console.error('Error fetching settings:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  const updateSettings = useCallback(async (updates: Partial<UserSettings>) => {
    if (!user || !settings) return false;
    
    try {
      const { error } = await supabase
        .from('user_settings')
        .update(updates as any)
        .eq('user_id', user.id);

      if (error) throw error;
      setSettings(prev => prev ? { ...prev, ...updates } : null);
      toast.success('Settings saved');
      return true;
    } catch (err) {
      console.error('Error updating settings:', err);
      toast.error('Failed to save settings');
      return false;
    }
  }, [user, settings]);

  const testTelegram = useCallback(async (botToken: string, chatId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('send-telegram', {
        body: { action: 'test', bot_token: botToken, chat_id: chatId },
      });
      
      if (error) throw error;
      if (data?.success) {
        toast.success('Test message sent to Telegram!');
        return true;
      } else {
        toast.error(data?.error || 'Telegram test failed');
        return false;
      }
    } catch (err) {
      toast.error('Failed to test Telegram connection');
      return false;
    }
  }, []);

  return { settings, loading, updateSettings, testTelegram, refetch: fetchSettings };
};
