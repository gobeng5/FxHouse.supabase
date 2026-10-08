import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';

/** Whether the signed-in user is flagged `is_admin` in user_settings. */
export function useIsAdmin() {
  const { user, loading: authLoading } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    let active = true;

    const checkAdmin = async () => {
      if (!user) {
        setIsAdmin(false);
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('user_settings')
        .select('is_admin')
        .eq('user_id', user.id)
        .maybeSingle();

      if (!active) return;
      if (error) {
        console.error('Failed to check admin status:', error);
        setIsAdmin(false);
      } else {
        setIsAdmin((data as { is_admin?: boolean } | null)?.is_admin === true);
      }
      setLoading(false);
    };

    checkAdmin();
    return () => { active = false; };
  }, [user, authLoading]);

  return { user, isAdmin, loading: authLoading || loading };
}
