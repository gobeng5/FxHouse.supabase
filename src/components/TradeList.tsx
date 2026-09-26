import { Trade } from '@/hooks/useTrades';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { MoreHorizontal, Pencil, Trash2, TrendingUp, TrendingDown, Minus, Activity, Clock, Target, ShieldAlert } from 'lucide-react';
import { format } from 'date-fns';

interface TargetProgress {
  tp1Hit: boolean;
  tp2Hit: boolean;
  tp3Hit: boolean;
  slHit: boolean;
  currentPnlPips: number;
}

interface TradeListProps {
  trades: Trade[];
  onEdit: (trade: Trade) => void;
  onDelete: (id: string) => void;
  getTradeProgress?: (trade: Trade) => TargetProgress | null;
}

export function TradeList({ trades, onEdit, onDelete, getTradeProgress }: TradeListProps) {
  const formatSetup = (setup: string | null) =>
    setup
      ? setup
          .split(/[\s_]+/)
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ')
      : null;

  if (trades.length === 0) {
    return (
      <Card className="glass-card">
        <CardContent className="py-12 text-center">
          <p className="text-muted-foreground">No trades logged yet. Start by logging your first trade!</p>
        </CardContent>
      </Card>
    );
  }

  const getOutcomeBadge = (outcome: Trade['outcome']) => {
    switch (outcome) {
      case 'WIN':
        return (
          <Badge className="bg-bullish/20 text-bullish border-bullish/30">
            <TrendingUp className="w-3 h-3 mr-1" /> Win
          </Badge>
        );
      case 'LOSS':
        return (
          <Badge className="bg-bearish/20 text-bearish border-bearish/30">
            <TrendingDown className="w-3 h-3 mr-1" /> Loss
          </Badge>
        );
      case 'BREAKEVEN':
        return (
          <Badge className="bg-muted text-muted-foreground border-muted-foreground/30">
            <Minus className="w-3 h-3 mr-1" /> BE
          </Badge>
        );
      case 'ACTIVE':
        return (
          <Badge className="bg-primary/20 text-primary border-primary/30">
            <Activity className="w-3 h-3 mr-1 animate-pulse" /> Active
          </Badge>
        );
      case 'PENDING':
        return (
          <Badge className="bg-accent text-accent-foreground border-accent-foreground/30">
            <Clock className="w-3 h-3 mr-1" /> Pending
          </Badge>
        );
      default:
        return <Badge variant="outline"><Activity className="w-3 h-3 mr-1 animate-pulse" /> Open</Badge>;
    }
  };

  const getDirectionBadge = (direction: Trade['direction']) => {
    return direction === 'BUY' 
      ? <Badge className="bg-bullish/20 text-bullish border-bullish/30">BUY</Badge>
      : <Badge className="bg-bearish/20 text-bearish border-bearish/30">SELL</Badge>;
  };

  const renderTargetProgress = (trade: Trade) => {
    if (trade.outcome || !getTradeProgress) return null;
    const progress = getTradeProgress(trade);
    if (!progress) return null;

    const hasAnyTarget = trade.take_profit || trade.take_profit_2 || trade.take_profit_3 || trade.stop_loss;
    if (!hasAnyTarget) return null;

    return (
      <TooltipProvider>
        <div className="flex items-center gap-1 mt-1">
          {trade.stop_loss && (
            <Tooltip>
              <TooltipTrigger>
                <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold border ${
                  progress.slHit 
                    ? 'bg-bearish/20 text-bearish border-bearish/40' 
                    : 'bg-muted/50 text-muted-foreground border-border'
                }`}>
                  SL
                </span>
              </TooltipTrigger>
              <TooltipContent><p>Stop Loss: {trade.stop_loss}</p></TooltipContent>
            </Tooltip>
          )}
          {trade.take_profit && (
            <Tooltip>
              <TooltipTrigger>
                <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold border ${
                  progress.tp1Hit 
                    ? 'bg-bullish/20 text-bullish border-bullish/40' 
                    : 'bg-muted/50 text-muted-foreground border-border'
                }`}>
                  1
                </span>
              </TooltipTrigger>
              <TooltipContent><p>TP1: {trade.take_profit}</p></TooltipContent>
            </Tooltip>
          )}
          {trade.take_profit_2 && (
            <Tooltip>
              <TooltipTrigger>
                <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold border ${
                  progress.tp2Hit 
                    ? 'bg-bullish/20 text-bullish border-bullish/40' 
                    : 'bg-muted/50 text-muted-foreground border-border'
                }`}>
                  2
                </span>
              </TooltipTrigger>
              <TooltipContent><p>TP2: {trade.take_profit_2}</p></TooltipContent>
            </Tooltip>
          )}
          {trade.take_profit_3 && (
            <Tooltip>
              <TooltipTrigger>
                <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold border ${
                  progress.tp3Hit 
                    ? 'bg-bullish/20 text-bullish border-bullish/40' 
                    : 'bg-muted/50 text-muted-foreground border-border'
                }`}>
                  3
                </span>
              </TooltipTrigger>
              <TooltipContent><p>TP3: {trade.take_profit_3}</p></TooltipContent>
            </Tooltip>
          )}
          <span className={`ml-1 text-xs font-mono ${
            progress.currentPnlPips > 0 ? 'text-bullish' : progress.currentPnlPips < 0 ? 'text-bearish' : 'text-muted-foreground'
          }`}>
            {progress.currentPnlPips > 0 ? '+' : ''}{progress.currentPnlPips.toFixed(1)}p
          </span>
        </div>
      </TooltipProvider>
    );
  };

  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="text-lg">Trade History</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Instrument</TableHead>
                <TableHead>Direction</TableHead>
                <TableHead>Entry</TableHead>
                <TableHead>Exit</TableHead>
                <TableHead>Lot Size</TableHead>
                <TableHead className="hidden lg:table-cell">Setup</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead className="text-right">P&L (pips)</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trades.map((trade) => (
                <TableRow key={trade.id}>
                  <TableCell className="font-mono text-sm">
                    {format(new Date(trade.entry_time), 'MMM dd, HH:mm')}
                  </TableCell>
                  <TableCell className="font-medium">
                    <div className="flex flex-col gap-1">
                      <span>{trade.instrument}</span>
                      <Badge variant="outline" className="lg:hidden w-fit text-[10px] font-normal">
                        {formatSetup(trade.setup_type) || 'No setup'}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell>{getDirectionBadge(trade.direction)}</TableCell>
                  <TableCell className="font-mono">{trade.entry_price.toFixed(5)}</TableCell>
                  <TableCell className="font-mono">
                    {trade.exit_price?.toFixed(5) || '—'}
                  </TableCell>
                  <TableCell className="font-mono">{trade.lot_size.toFixed(2)}</TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {trade.setup_type ? (
                      <Badge variant="outline" className="text-xs whitespace-nowrap">{formatSetup(trade.setup_type)}</Badge>
                    ) : '—'}
                  </TableCell>
                  <TableCell>
                    {getOutcomeBadge(trade.outcome)}
                    {renderTargetProgress(trade)}
                  </TableCell>
                  <TableCell className={`text-right font-mono font-semibold ${
                    trade.pnl_pips === null ? '' :
                    trade.pnl_pips > 0 ? 'text-bullish' : 
                    trade.pnl_pips < 0 ? 'text-bearish' : ''
                  }`}>
                    {trade.pnl_pips !== null ? (
                      <>
                        {trade.pnl_pips > 0 ? '+' : ''}{trade.pnl_pips.toFixed(1)}
                      </>
                    ) : '—'}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => onEdit(trade)}>
                          <Pencil className="w-4 h-4 mr-2" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onClick={() => onDelete(trade.id)}
                          className="text-destructive"
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
