import { useEffect, useState } from 'react';

interface LoadingScreenProps {
  onComplete?: () => void;
  minDuration?: number;
}

export const LoadingScreen = ({ onComplete, minDuration = 2000 }: LoadingScreenProps) => {
  const [progress, setProgress] = useState(0);
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const newProgress = Math.min((elapsed / minDuration) * 100, 100);
      setProgress(newProgress);

      if (newProgress >= 100) {
        clearInterval(interval);
        setFadeOut(true);
        setTimeout(() => {
          onComplete?.();
        }, 500);
      }
    }, 50);

    return () => clearInterval(interval);
  }, [minDuration, onComplete]);

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-background transition-opacity duration-500 ${
        fadeOut ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      {/* Animated background gradient */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-1/2 -left-1/2 w-full h-full bg-gradient-to-br from-primary/5 via-transparent to-transparent rounded-full animate-pulse" />
        <div className="absolute -bottom-1/2 -right-1/2 w-full h-full bg-gradient-to-tl from-accent/5 via-transparent to-transparent rounded-full animate-pulse" style={{ animationDelay: '1s' }} />
      </div>

      {/* Logo container */}
      <div className="relative mb-8">
        <div className="w-28 h-28 rounded-2xl bg-card border border-border/50 shadow-2xl flex items-center justify-center overflow-hidden">
          <img
            src="/app-icon.png"
            alt="FX Swing"
            className="w-24 h-24 object-contain animate-scale-in"
          />
        </div>
        
        {/* Glow effect */}
        <div className="absolute inset-0 rounded-2xl bg-primary/10 blur-xl -z-10 animate-pulse" />
      </div>

      {/* App name */}
      <div className="text-center mb-8 animate-fade-in" style={{ animationDelay: '0.3s' }}>
        <h1 className="text-2xl font-bold text-foreground tracking-tight">FX Swing</h1>
        <p className="text-sm text-muted-foreground mt-1">Multi-Session Analyzer</p>
      </div>

      {/* Progress bar */}
      <div className="w-48 h-1 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-primary to-accent transition-all duration-100 ease-out rounded-full"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Loading text */}
      <p className="mt-4 text-xs text-muted-foreground font-mono animate-pulse">
        {progress < 30 ? 'Initializing...' : progress < 70 ? 'Loading markets...' : 'Ready'}
      </p>
    </div>
  );
};
