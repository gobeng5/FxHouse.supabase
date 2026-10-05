import { ReactNode, useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const location = useLocation();

  const [adminLoading, setAdminLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const checkAdmin = async () => {
      if (!user) {
        setIsAdmin(false);
        setAdminLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("user_settings")
        .select("is_admin")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) {
        console.error("Failed to check admin status:", error);
        setIsAdmin(false);
      } else {
        setIsAdmin(data?.is_admin === true);
      }

      setAdminLoading(false);
    };

    if (!authLoading) {
      checkAdmin();
    }
  }, [user, authLoading]);

  if (authLoading || adminLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace state={{ from: location }} />;
  }

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}