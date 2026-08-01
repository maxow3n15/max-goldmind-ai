import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { PlatformProviders } from "@/providers/PlatformProviders";
import { GlobalStatusBar } from "@/components/GlobalStatusBar";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { setDiagnostics } from "@/lib/platform-context";
import { PlatformLoading } from "@/components/PlatformLoading";
import { AutopilotWidget } from "@/components/AutopilotWidget";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    installSessionPersistence();
    // Drop any persisted session the user never consented to (no "Remember me").
    if (purgeUnconsentedSession()) {
      await supabase.auth.signOut({ scope: "local" }).catch(() => {});
      throw redirect({ to: "/auth" });
    }
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    setDiagnostics({ userId: data.user.id, userEmail: data.user.email ?? null });
    return { user: data.user };
  },

  pendingComponent: () => <PlatformLoading stage="Checking Authentication…" />,
  component: AuthenticatedLayout,
});

function ShellBody() {
  useKeyboardShortcuts();
  const { user } = Route.useRouteContext();

  useEffect(() => {
    setDiagnostics({ userId: user?.id ?? null, userEmail: user?.email ?? null });
  }, [user]);

  return (
    <AppShell>
      <GlobalStatusBar />
      <div className="animate-in fade-in duration-200">
        <Outlet />
      </div>
      <AutopilotWidget />
    </AppShell>
  );
}

function AuthenticatedLayout() {
  return (
    <PlatformProviders>
      <ShellBody />
    </PlatformProviders>
  );
}
