import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTrades, Trade, TradeInput } from '@/hooks/useTrades';
import { useDerivAPI } from '@/hooks/useDerivAPI';
import { useTradeTracking } from '@/hooks/useTradeTracking';
import { Header } from '@/components/Header';
import { BrandedBackground } from '@/components/BrandedBackground';
import { TradeForm } from '@/components/TradeForm';
import { TradeList } from '@/components/TradeList';
import { TradeStats } from '@/components/TradeStats';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Plus, BarChart3, List, Loader2, Activity } from 'lucide-react';

const TradeJournal = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { trades, stats, loading: tradesLoading, addTrade, updateTrade, deleteTrade, refreshTrades } = useTrades();
  const { prices, isConnected, getCandles } = useDerivAPI();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingTrade, setEditingTrade] = useState<Trade | null>(null);

  const { getTradeProgress, openTradeCount } = useTradeTracking({
    trades,
    prices,
    isConnected,
    onTradeUpdated: refreshTrades,
    getCandles: getCandles as any,
  });

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [user, authLoading, navigate]);

  const handleAddTrade = async (trade: TradeInput) => {
    const result = await addTrade(trade);
    if (result) {
      setIsFormOpen(false);
    }
  };

  const handleUpdateTrade = async (trade: TradeInput) => {
    if (!editingTrade) return;
    const result = await updateTrade(editingTrade.id, trade);
    if (result) {
      setEditingTrade(null);
    }
  };

  const handleEditTrade = (trade: Trade) => {
    setEditingTrade(trade);
  };

  const handleDeleteTrade = async (id: string) => {
    await deleteTrade(id);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      <BrandedBackground variant="subtle" animated={true} />
      <Header isConnected={isConnected} />
      
      <main className="container mx-auto px-4 py-6 max-w-7xl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold">Trade Journal</h1>
            <p className="text-muted-foreground">Track, analyze, and improve your trading performance</p>
          </div>
          
          <div className="flex items-center gap-3">
            {openTradeCount > 0 && (
              <Badge variant="outline" className="gap-1.5 py-1.5 px-3">
                <Activity className="w-3 h-3 animate-pulse text-primary" />
                {openTradeCount} tracking
              </Badge>
            )}
            
            <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2">
                  <Plus className="w-4 h-4" />
                  Log Trade
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Log New Trade</DialogTitle>
                </DialogHeader>
                <TradeForm onSubmit={handleAddTrade} onCancel={() => setIsFormOpen(false)} />
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <Tabs defaultValue="stats" className="space-y-6">
          <TabsList>
            <TabsTrigger value="stats" className="gap-2">
              <BarChart3 className="w-4 h-4" />
              Analytics
            </TabsTrigger>
            <TabsTrigger value="trades" className="gap-2">
              <List className="w-4 h-4" />
              Trade History
            </TabsTrigger>
          </TabsList>

          <TabsContent value="stats">
            {tradesLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : stats ? (
              <TradeStats stats={stats} />
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                No trades logged yet. Start by logging your first trade!
              </div>
            )}
          </TabsContent>

          <TabsContent value="trades">
            {tradesLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : (
              <TradeList 
                trades={trades} 
                onEdit={handleEditTrade} 
                onDelete={handleDeleteTrade}
                getTradeProgress={getTradeProgress}
              />
            )}
          </TabsContent>
        </Tabs>

        {/* Edit Trade Dialog */}
        <Dialog open={!!editingTrade} onOpenChange={(open) => !open && setEditingTrade(null)}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit Trade</DialogTitle>
            </DialogHeader>
            {editingTrade && (
              <TradeForm 
                onSubmit={handleUpdateTrade} 
                onCancel={() => setEditingTrade(null)}
                initialData={editingTrade}
              />
            )}
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
};

export default TradeJournal;
