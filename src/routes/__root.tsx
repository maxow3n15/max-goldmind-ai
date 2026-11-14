import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { Toaster } from "sonner";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { supabase } from "@/integrations/supabase/client";
import { getDiagnostics } from "@/lib/platform-context";
import { Button } from "@/components/ui/button";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";
import { Compass, LayoutDashboard, Bot, ArrowRight } from "lucide-react";

function NotFoundComponent() {
  const { isAuthenticated } = useSupabaseSession();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <Compass className="mx-auto h-16 w-16 text-gold mb-6" aria-hidden="true" />
        <p className="font-mono text-sm text-gold">GOLDMIND AI · 404</p>
        <h1 className="mt-4 text-4xl font-semibold">Off the chart</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This page isn’t on the map. Your trading workspace is still where you left it.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild><Link to="/dashboard"><LayoutDashboard /> Dashboard</Link></Button>
          <Button variant="outline" asChild><Link to="/autopilot"><Bot /> Autopilot</Link></Button>
          {!isAuthenticated && <Button variant="ghost" asChild><Link to="/auth">Sign in <ArrowRight /></Link></Button>}
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  const diag = getDiagnostics();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component", ...diag });
    console.error("[GoldMind diagnostics]", diag);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  const rows: Array<[string, string]> = [
    ["Route", diag.route ?? "—"],
    ["User", diag.userEmail ?? diag.userId ?? "anonymous"],
    ["Symbol", diag.symbol],
    ["Timeframe", diag.timeframe],
    ["Market", diag.marketStatus],
    ["Broker", diag.brokerStatus],
    ["AI engine", diag.aiStatus],
    ["Current trade", diag.currentTrade ?? "none"],
  ];

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-lg glass-panel rounded-2xl p-8">
        <h1 className="text-xl font-semibold tracking-tight">Trading terminal error</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The interface hit an unexpected problem. Your data and any open positions are unaffected.
        </p>
        <p className="mt-3 rounded-md border border-border/60 bg-background/50 p-2.5 font-mono text-[11px] text-muted-foreground break-words">
          {error instanceof Error ? error.message : "Unknown error"}
        </p>

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2 border-b border-border/40 py-1">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="truncate font-mono">{v}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-6 flex flex-wrap gap-2">
          <button
            onClick={() => { router.invalidate(); reset(); }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Retry
          </button>
          <a href="/dashboard" className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent">
            Back to dashboard
          </a>
        </div>
      </div>
    </div>
  );
}


export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "GoldMind AI — Institutional XAUUSD Trading Intelligence" },
      { name: "description", content: "AI-powered gold market analysis using Smart Money Concepts. Real-time XAUUSD setups, explained decisions, risk-managed paper trading." },
      { name: "author", content: "GoldMind AI" },
      { property: "og:title", content: "GoldMind AI — Institutional XAUUSD Trading Intelligence" },
      { property: "og:description", content: "AI-powered gold market analysis using Smart Money Concepts. Real-time XAUUSD setups, explained decisions, risk-managed paper trading." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "GoldMind AI — Institutional XAUUSD Trading Intelligence" },
      { name: "twitter:description", content: "AI-powered gold market analysis using Smart Money Concepts. Real-time XAUUSD setups, explained decisions, risk-managed paper trading." },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head><HeadContent /></head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      router.invalidate();
      if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
    });
    return () => { sub.subscription.unsubscribe(); };
  }, [queryClient, router]);

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
      <Toaster theme="dark" position="top-right" toastOptions={{ style: { background: "oklch(0.19 0.007 260)", border: "1px solid oklch(0.26 0.008 260)", color: "oklch(0.96 0.01 90)" } }} />
    </QueryClientProvider>
  );
}
