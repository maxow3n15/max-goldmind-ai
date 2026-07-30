import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { Toaster } from "sonner";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { supabase } from "@/integrations/supabase/client";
import { getDiagnostics } from "@/lib/platform-context";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold gold-text">404</h1>
        <h2 className="mt-4 text-xl font-semibold">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          This route doesn't exist in the platform.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
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
          {error?.message ?? "Unknown error"}
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
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/241f7b8d-c132-4522-bd80-491aaf9abc29/id-preview-74fe1276--e6af7af9-9ab4-44c0-b52b-fe50f301646e.lovable.app-1785370739411.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/241f7b8d-c132-4522-bd80-491aaf9abc29/id-preview-74fe1276--e6af7af9-9ab4-44c0-b52b-fe50f301646e.lovable.app-1785370739411.png" },
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
