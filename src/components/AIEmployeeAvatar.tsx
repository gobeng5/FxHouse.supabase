import { cn } from '@/lib/utils';

export type EmployeeStatus = 'idle' | 'working' | 'done' | 'error';

interface AIEmployeeAvatarProps {
  status: EmployeeStatus;
  /** Boss gets the brand accent so the floor reads at a glance. */
  accent?: boolean;
  className?: string;
}

const SCREEN_FILL: Record<EmployeeStatus, string> = {
  idle: 'hsl(var(--muted))',
  working: 'hsl(var(--primary) / 0.18)',
  done: 'hsl(var(--bullish) / 0.2)',
  error: 'hsl(var(--bearish) / 0.25)',
};

/**
 * A small animated figure at a desk whose motion reflects the employee's status:
 * typing while working, dozing when idle, a ticked screen when done, an alert on error.
 * Motion is defined in index.css (.ai-*) and is disabled for prefers-reduced-motion.
 */
export const AIEmployeeAvatar = ({ status, accent = false, className }: AIEmployeeAvatarProps) => {
  const body = accent ? 'hsl(var(--primary))' : 'hsl(var(--foreground) / 0.75)';
  const skin = 'hsl(var(--muted-foreground))';

  return (
    <svg
      viewBox="0 0 120 84"
      role="img"
      aria-label={`Employee at desk, ${status}`}
      className={cn('ai-avatar', `ai-avatar--${status}`, className)}
    >
      {/* Monitor */}
      <rect x="66" y="22" width="40" height="30" rx="3" fill="hsl(var(--card))" stroke="hsl(var(--border))" strokeWidth="1.5" />
      <rect className="ai-screen" x="69" y="25" width="34" height="24" rx="1.5" fill={SCREEN_FILL[status]} />
      <rect x="84" y="52" width="4" height="8" fill="hsl(var(--border))" />
      <rect x="78" y="59" width="16" height="2.5" rx="1" fill="hsl(var(--border))" />

      {status === 'working' && (
        <g fill="hsl(var(--primary))">
          <rect className="ai-code-line" x="72" y="29" width="26" height="2.5" rx="1" />
          <rect className="ai-code-line ai-delay-1" x="72" y="35" width="18" height="2.5" rx="1" />
          <rect className="ai-code-line ai-delay-2" x="72" y="41" width="22" height="2.5" rx="1" />
        </g>
      )}
      {status === 'done' && (
        <path className="ai-check" d="M78 37 l6 6 l11 -12" fill="none" stroke="hsl(var(--bullish))" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      )}
      {status === 'error' && (
        <g className="ai-alert" fill="hsl(var(--bearish))">
          <rect x="84.5" y="28" width="3" height="11" rx="1.5" />
          <circle cx="86" cy="44" r="2" />
        </g>
      )}

      {/* Person */}
      <g className="ai-person">
        <rect x="20" y="38" width="26" height="30" rx="11" fill={body} />
        <circle cx="33" cy="26" r="10" fill={skin} />
        {status === 'idle' ? (
          // Closed eyes while dozing
          <g stroke="hsl(var(--background))" strokeWidth="1.5" strokeLinecap="round">
            <path d="M28 26 h4" />
            <path d="M35 26 h4" />
          </g>
        ) : (
          <g fill="hsl(var(--background))">
            <circle cx="31" cy="25" r="1.4" />
            <circle cx="37" cy="25" r="1.4" />
          </g>
        )}
        {/* Arm reaching the keyboard */}
        <path d="M42 46 Q52 50 58 59" fill="none" stroke={body} strokeWidth="5" strokeLinecap="round" />
      </g>

      {/* Hands */}
      <circle className="ai-hand" cx="58" cy="60" r="3" fill={skin} />
      <circle className="ai-hand ai-delay-1" cx="51" cy="61" r="3" fill={skin} />

      {/* Keyboard and desk */}
      <rect x="46" y="63" width="20" height="3" rx="1.5" fill="hsl(var(--muted-foreground) / 0.6)" />
      <rect x="6" y="66" width="108" height="4" rx="2" fill="hsl(var(--border))" />
      <rect x="14" y="70" width="3" height="12" fill="hsl(var(--border))" />
      <rect x="103" y="70" width="3" height="12" fill="hsl(var(--border))" />

      {status === 'idle' && (
        <g fill="hsl(var(--muted-foreground))" fontSize="9" fontWeight="700" fontFamily="inherit">
          <text className="ai-zzz" x="46" y="18">z</text>
          <text className="ai-zzz ai-delay-2" x="53" y="11">z</text>
        </g>
      )}
    </svg>
  );
};
