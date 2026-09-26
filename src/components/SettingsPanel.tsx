import { useState, useEffect } from 'react';
import { useUserSettings } from '@/hooks/useUserSettings';
import { ALL_INSTRUMENTS } from '@/types/trading';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Bell, Shield, Bot, Send, Zap, AlertTriangle } from 'lucide-react';

export const SettingsPanel = () => {
  const { settings, loading, updateSettings, testTelegram } = useUserSettings();
  const [localSettings, setLocalSettings] = useState(settings);
  const [isTesting, setIsTesting] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (settings) { setLocalSettings(settings); setIsDirty(false); }
  }, [settings]);

  if (loading || !localSettings) {
    return <div className="animate-pulse space-y-4">{[1,2,3].map(i => <div key={i} className="h-32 bg-muted rounded-xl" />)}</div>;
  }

  const update = (key: string, value: any) => {
    setLocalSettings(prev => prev ? { ...prev, [key]: value } : null);
    setIsDirty(true);
  };

  const save = async () => {
    if (!localSettings) return;
    const { id, user_id, ...rest } = localSettings;
    await updateSettings(rest);
    setIsDirty(false);
  };

  const handleTestTelegram = async () => {
    if (!localSettings?.telegram_bot_token || !localSettings?.telegram_chat_id) return;
    setIsTesting(true);
    await testTelegram(localSettings.telegram_bot_token, localSettings.telegram_chat_id);
    setIsTesting(false);
  };

  const toggleInstrument = (instrument: string) => {
    const current = localSettings.notify_instruments || [];
    const updated = current.includes(instrument)
      ? current.filter(i => i !== instrument)
      : [...current, instrument];
    update('notify_instruments', updated);
  };

  return (
    <div className="space-y-6">
      {/* Signal Engine */}
      <Card className="glass-card">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><Zap className="w-4 h-4 text-primary" /> Signal Engine</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">24/7 Auto Engine</Label>
              <p className="text-xs text-muted-foreground">Runs every 4H candle close (02, 06, 10, 14, 18, 22 GMT)</p>
            </div>
            <Switch checked={localSettings.auto_engine_enabled} onCheckedChange={(v) => update('auto_engine_enabled', v)} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Ignore Counter-Trend</Label>
              <p className="text-xs text-muted-foreground">Only take signals aligned with daily trend</p>
            </div>
            <Switch checked={localSettings.ignore_counter_trend} onCheckedChange={(v) => update('ignore_counter_trend', v)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs text-muted-foreground">Forex Min R:R</Label>
              <Input type="number" step="0.1" min="1" max="5" value={localSettings.forex_min_rr} onChange={(e) => update('forex_min_rr', Number(e.target.value))} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Synthetic Min R:R</Label>
              <Input type="number" step="0.1" min="1" max="5" value={localSettings.synthetic_min_rr} onChange={(e) => update('synthetic_min_rr', Number(e.target.value))} className="mt-1" />
            </div>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Min Confidence: {localSettings.notify_min_confidence}%</Label>
            <Slider value={[localSettings.notify_min_confidence]} min={50} max={95} step={5} onValueChange={([v]) => update('notify_min_confidence', v)} className="mt-2" />
          </div>
        </CardContent>
      </Card>

      {/* Risk Controls */}
      <Card className="glass-card">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><Shield className="w-4 h-4 text-bullish" /> Risk Controls</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {localSettings.signals_paused && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
              <AlertTriangle className="w-4 h-4 text-destructive" />
              <span className="text-sm text-destructive">Signals paused due to drawdown limit</span>
              <Button size="sm" variant="outline" className="ml-auto" onClick={() => update('signals_paused', false)}>Resume</Button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs text-muted-foreground">Risk % Per Trade</Label>
              <Input type="number" step="0.5" min="0.5" max="5" value={localSettings.risk_percent_per_trade} onChange={(e) => update('risk_percent_per_trade', Number(e.target.value))} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Max Daily Loss %</Label>
              <Input type="number" step="1" min="1" max="20" value={localSettings.max_daily_loss_percent} onChange={(e) => update('max_daily_loss_percent', Number(e.target.value))} className="mt-1" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs text-muted-foreground">Max Drawdown %</Label>
              <Input type="number" step="1" min="5" max="30" value={localSettings.max_drawdown_percent} onChange={(e) => update('max_drawdown_percent', Number(e.target.value))} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Max Trades/Day</Label>
              <Input type="number" step="1" min="1" max="50" value={localSettings.max_trades_per_day} onChange={(e) => update('max_trades_per_day', Number(e.target.value))} className="mt-1" />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Auto-Pause on Drawdown</Label>
              <p className="text-xs text-muted-foreground">Stop signals when max drawdown is hit</p>
            </div>
            <Switch checked={localSettings.auto_disable_on_drawdown} onCheckedChange={(v) => update('auto_disable_on_drawdown', v)} />
          </div>
        </CardContent>
      </Card>

      {/* Telegram */}
      <Card className="glass-card">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><Bell className="w-4 h-4 text-info" /> Telegram Alerts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Enable Notifications</Label>
              <p className="text-xs text-muted-foreground">Send signals to Telegram bot</p>
            </div>
            <Switch checked={localSettings.telegram_enabled} onCheckedChange={(v) => update('telegram_enabled', v)} />
          </div>
          {localSettings.telegram_enabled && (
            <>
              <div>
                <Label className="text-xs text-muted-foreground">Bot Token</Label>
                <Input type="password" placeholder="123456:ABC-DEF..." value={localSettings.telegram_bot_token || ''} onChange={(e) => update('telegram_bot_token', e.target.value.trim())} className="mt-1 font-mono text-xs" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Chat ID</Label>
                <Input placeholder="-1001234567890" value={localSettings.telegram_chat_id || ''} onChange={(e) => update('telegram_chat_id', e.target.value.trim())} className="mt-1 font-mono text-xs" />
              </div>
              <Button size="sm" variant="outline" className="gap-2" onClick={handleTestTelegram} disabled={isTesting || !localSettings.telegram_bot_token || !localSettings.telegram_chat_id}>
                <Send className="w-3 h-3" />
                {isTesting ? 'Sending...' : 'Test Connection'}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* Instrument Filter */}
      <Card className="glass-card">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><Bot className="w-4 h-4 text-accent" /> Instrument Filter</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">Select instruments to monitor. Leave empty for all.</p>
          <div className="flex flex-wrap gap-2">
            {ALL_INSTRUMENTS.map(inst => (
              <Badge
                key={inst}
                variant={localSettings.notify_instruments?.includes(inst) ? 'default' : 'outline'}
                className="cursor-pointer transition-all"
                onClick={() => toggleInstrument(inst)}
              >
                {inst}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Save Button */}
      {isDirty && (
        <div className="sticky bottom-4 z-10">
          <Button onClick={save} className="w-full gap-2 shadow-lg">Save Settings</Button>
        </div>
      )}
    </div>
  );
};
