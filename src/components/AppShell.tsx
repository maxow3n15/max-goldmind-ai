import { Link, useNavigate, useLocation } from "@tanstack/react-router";
import { LayoutDashboard, BookOpen, BarChart3, Settings, Sparkles, LogOut, Zap, Bot, Newspaper } from "lucide-react";
import type { ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/autopilot", label: "Autopilot", icon: Bot },
  { to: "/macro", label: "Market Intel", icon: Newspaper },
  { to: "/assistant", label: "AI Assistant", icon: Sparkles },
  { to: "/journal", label: "Journal", icon: BookOpen },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      {/* Sidebar (desktop) */}
      <aside className="hidden md:flex md:w-60 flex-col border-r border-border/60 glass-panel rounded-none">
        <div className="p-5 flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-lg flex items-center justify-center" style={{ background: "var(--gradient-gold)" }}>
            <Zap className="h-5 w-5 text-[color:var(--gold-foreground)]" />
          </div>
          <div>
            <div className="font-display font-semibold leading-none">GoldMind<span className="gold-text"> AI</span></div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1">XAUUSD Intelligence</div>
          </div>
        </div>
        <nav className="flex-1 px-3 py-2 space-y-1">
          {NAV.map(({ to, label, icon: Icon }) => {
            const active = location.pathname === to;
            return (
              <Link key={to} to={to} className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                active ? "bg-[color:var(--gold)]/10 text-[color:var(--gold)] gold-border" : "text-muted-foreground hover:text-foreground hover:bg-accent"
              )}>
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-border/60">
          <button onClick={signOut} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="md:hidden flex items-center justify-between px-4 py-3 border-b border-border/60 glass-panel rounded-none">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-md flex items-center justify-center" style={{ background: "var(--gradient-gold)" }}>
            <Zap className="h-4 w-4 text-[color:var(--gold-foreground)]" />
          </div>
          <div className="font-display font-semibold">GoldMind<span className="gold-text"> AI</span></div>
        </div>
        <button onClick={signOut} className="p-2 text-muted-foreground"><LogOut className="h-4 w-4" /></button>
      </div>

      <main className="flex-1 min-w-0 pb-24 md:pb-8">{children}</main>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 glass-panel rounded-none border-t border-border/60 flex justify-around py-2">
        {NAV.map(({ to, label, icon: Icon }) => {
          const active = location.pathname === to;
          return (
            <Link key={to} to={to} className={cn("flex flex-col items-center gap-0.5 px-2 py-1 text-[10px]",
              active ? "text-[color:var(--gold)]" : "text-muted-foreground")}>
              <Icon className="h-5 w-5" />
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
