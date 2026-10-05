import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Header } from '@/components/Header';
import { ShieldCheck, LineChart, Newspaper, ClipboardCheck, Briefcase, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

interface Employee {
  id: string;
  name: string;
  role_title: string;
  description: string;
  display_order: number;
}

interface Activity {
  employee_id: string;
  status: 'idle' | 'working' | 'done' | 'error';
  current_task: string | null;
  last_report: string | null;
  started_at: string | null;
  updated_at: string;
}

const ICONS: Record<string, typeof Briefcase> = {
  boss: Briefcase,
  kofi: ShieldCheck,
  ama: ClipboardCheck,
  yaw: LineChart,
  kobby: Newspaper,
};

const STATUS_STYLE: Record<Activity['status'], string> = {
  idle: 'bg-muted text-muted-foreground',
  working: 'bg-amber-500/15 text-amber-500',
  done: 'bg-emerald-500/15 text-emerald-500',
  error: 'bg-red-500/15 text-red-500',
};

function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function Desk({ employee, activity }: { employee: Employee; activity: Activity | undefined }) {
  const Icon = ICONS[employee.id] ?? Briefcase;
  const status = activity?.status ?? 'idle';
  const isBoss = employee.id === 'boss';

  return (
    <Card className={`relative overflow-hidden transition-colors ${isBoss ? 'border-primary/40' : ''}`}>
      {status === 'working' && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-amber-500 animate-pulse" />
      )}
      <CardHeader className="flex flex-row items-center justify-between gap-3 pb-2">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isBoss ? 'bg-primary/15 text-primary' : 'bg-muted text-foreground'}`}>
            <Icon className="w-5 h-5" />
          </div>
          <div>
            <CardTitle className="text-base leading-tight">{employee.name}</CardTitle>
            <p className="text-xs text-muted-foreground">{employee.role_title}</p>
          </div>
        </div>
        <Badge variant="outline" className={STATUS_STYLE[status]}>
          {status === 'working' ? (
            <span className="flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> working</span>
          ) : status}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">{employee.description}</p>
        {activity?.current_task && (
          <p className="text-sm"><span className="text-muted-foreground">At desk: </span>{activity.current_task}</p>
        )}
        {activity?.last_report && (
          <div className="rounded-md bg-muted/50 p-3 text-sm whitespace-pre-wrap">
            {activity.last_report}
          </div>
        )}
        <p className="text-xs text-muted-foreground">Last updated {timeAgo(activity?.updated_at ?? null)}</p>
      </CardContent>
    </Card>
  );
}

export default function AdminAITeam() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [activity, setActivity] = useState<Record<string, Activity>>({});
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const fetchAll = async () => {
    const [{ data: emp }, { data: act }] = await Promise.all([
      supabase.from('ai_employees').select('*').order('display_order'),
      supabase.from('ai_employee_activity').select('*'),
    ]);
    if (emp) setEmployees(emp as Employee[]);
    if (act) setActivity(Object.fromEntries((act as Activity[]).map(a => [a.employee_id, a])));
    setLoading(false);
  };

  useEffect(() => {
    fetchAll();
    const channel = supabase
      .channel('ai-employee-activity')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ai_employee_activity' }, fetchAll)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const runNow = async () => {
    setRunning(true);
    try {
      const { error } = await supabase.functions.invoke('ai-employees', { body: {} });
      if (error) throw error;
      toast.success('Team is on it — watch the desks update live.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start the team');
    } finally {
      setRunning(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const boss = employees.find(e => e.id === 'boss');
  const workers = employees.filter(e => e.id !== 'boss');

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="container max-w-5xl mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">AI Team</h1>
            <p className="text-sm text-muted-foreground">They work automatically on a schedule — this is the floor.</p>
          </div>
          <Button onClick={runNow} disabled={running} size="sm" variant="outline">
            {running ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            Run now
          </Button>
        </div>

        {boss && (
          <Desk employee={boss} activity={activity[boss.id]} />
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {workers.map(e => (
            <Desk key={e.id} employee={e} activity={activity[e.id]} />
          ))}
        </div>
      </div>
    </div>
  );
}
