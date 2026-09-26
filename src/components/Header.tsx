import { Clock, Shield, Zap, WifiOff, BookOpen, LogOut, User, History, BarChart3, Menu } from 'lucide-react';
import appIcon from '@/assets/app-icon.png';
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ThemeToggle } from '@/components/ThemeToggle';

interface HeaderProps {
  isConnected?: boolean;
  error?: string | null;
  isMarketClosed?: boolean;
}

export const Header = ({ isConnected = false, error, isMarketClosed = false }: HeaderProps) => {
  const [time, setTime] = useState(new Date());
  const { user, signOut } = useAuth();
  const location = useLocation();

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const gmtTime = time.toLocaleTimeString('en-GB', { timeZone: 'GMT', hour12: false });
  const gmtDate = time.toLocaleDateString('en-GB', { 
    timeZone: 'GMT', 
    weekday: 'short', 
    day: 'numeric', 
    month: 'short', 
    year: 'numeric' 
  });

  // Session detection with semantic colors
  const getSessionDisplay = (date: Date): { name: string; color: string } => {
    const hour = date.getUTCHours();
    if (hour >= 0 && hour < 7) return { name: 'Asian', color: 'text-info' };
    if (hour >= 7 && hour < 8) return { name: 'Pre-London', color: 'text-warning' };
    if (hour >= 8 && hour < 12) return { name: 'London', color: 'text-bullish' };
    if (hour >= 12 && hour < 17) return { name: 'London/NY', color: 'text-primary' };
    if (hour >= 17 && hour < 21) return { name: 'New York', color: 'text-accent' };
    return { name: 'After Hours', color: 'text-muted-foreground' };
  };
  
  const sessionDisplay = getSessionDisplay(time);

  return (
    <header className="glass-card border-b border-border/30 px-6 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/" className="flex items-center gap-3 group">
            <div className="w-9 h-9 rounded-lg bg-card border border-border/30 flex items-center justify-center group-hover:border-primary/30 transition-colors overflow-hidden">
              <img src={appIcon} alt="FX Swing" className="w-7 h-7 object-contain" />
            </div>
            <div>
              <h1 className="text-base font-semibold text-foreground">FxHouse</h1>
              <p className="text-[11px] text-muted-foreground -mt-0.5">Multi-Session</p>
            </div>
          </Link>
          
          {/* Navigation */}
          <nav className="hidden sm:flex items-center gap-1 ml-4">
            <Link to="/">
              <Button 
                variant={location.pathname === '/' ? 'secondary' : 'ghost'} 
                size="sm"
                className="gap-2"
              >
                <BarChart3 className="w-4 h-4" />
                Analysis
              </Button>
            </Link>
            <Link to="/journal">
              <Button 
                variant={location.pathname === '/journal' ? 'secondary' : 'ghost'} 
                size="sm"
                className="gap-2"
              >
                <BookOpen className="w-4 h-4" />
                Journal
              </Button>
            </Link>
            <Link to="/signals">
              <Button 
                variant={location.pathname === '/signals' ? 'secondary' : 'ghost'} 
                size="sm"
                className="gap-2"
              >
                <History className="w-4 h-4" />
                Signals
              </Button>
            </Link>
          </nav>
          
          {/* Connection Status */}
          <div className={cn(
            'flex items-center gap-2 px-2.5 py-1 rounded-lg text-xs font-medium border',
            isMarketClosed 
              ? 'bg-warning/10 text-warning border-warning/20'
              : isConnected 
                ? 'bg-bullish/10 text-bullish border-bullish/20' 
                : 'bg-muted text-muted-foreground border-border'
          )}>
            {isMarketClosed ? (
              <>
                <Clock className="w-3.5 h-3.5" />
                <span>Closed</span>
              </>
            ) : isConnected ? (
              <>
                <span className="status-dot-live" />
                <span>Live</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3.5 h-3.5" />
                <span>Offline</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="hidden md:flex items-center gap-2 text-sm">
            <Shield className="w-4 h-4 text-bullish" />
            <span className="text-muted-foreground">Risk:</span>
            <span className="font-mono font-semibold text-foreground">1-2%</span>
          </div>

          <div className="hidden lg:flex items-center gap-2 text-sm">
            <Zap className="w-4 h-4 text-accent" />
            <span className="text-muted-foreground">Session:</span>
            <span className={cn("font-semibold", sessionDisplay.color)}>{sessionDisplay.name}</span>
          </div>

          <div className="hidden sm:flex items-center gap-3 pl-4 border-l border-border">
            <Clock className="w-4 h-4 text-muted-foreground" />
            <div className="text-right">
              <div className="font-mono text-lg font-semibold tracking-tight">{gmtTime}</div>
              <div className="text-xs text-muted-foreground">{gmtDate} GMT</div>
            </div>
          </div>

          {/* Mobile Navigation Menu */}
          <div className="sm:hidden">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-full">
                  <Menu className="w-5 h-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link to="/" className="flex items-center gap-2">
                    <BarChart3 className="w-4 h-4" />
                    Analysis
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/journal" className="flex items-center gap-2">
                    <BookOpen className="w-4 h-4" />
                    Journal
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/signals" className="flex items-center gap-2">
                    <History className="w-4 h-4" />
                    Signal History
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Theme Toggle */}
          <ThemeToggle />

          {/* User Menu */}
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-full">
                  <User className="w-5 h-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem className="text-muted-foreground text-xs" disabled>
                  {user.email}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={signOut} className="text-destructive">
                  <LogOut className="w-4 h-4 mr-2" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Link to="/auth">
              <Button variant="outline" size="sm">
                Sign In
              </Button>
            </Link>
          )}
        </div>
      </div>
    </header>
  );
};