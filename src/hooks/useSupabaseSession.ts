import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Tracks whether a Supabase session exists in the browser.
 *
 * Protected server functions require a bearer token; querying them before the
 * session is known (SSR, signed-out visitors, first paint) throws
 * "Unauthorized: No authorization header provided". Gate those queries with
 * `enabled: isAuthenticated`.
 */
export function useSupabaseSession() {
  const [state, setState] = useState<{ ready: boolean; userId: string | null }>({
    ready: false,
    userId: null,
  });

  useEffect(() => {
    let active = true;

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setState({ ready: true, userId: session?.user?.id ?? null });
    });

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setState({ ready: true, userId: data.session?.user?.id ?? null });
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return {
    ready: state.ready,
    userId: state.userId,
    isAuthenticated: state.ready && !!state.userId,
  };
}
