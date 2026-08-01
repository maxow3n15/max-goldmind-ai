import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Zap } from "lucide-react";
import { toast } from "sonner";
import { installSessionPersistence, purgeUnconsentedSession, setRememberMe } from "@/lib/session-persistence";


export const Route = createFileRoute("/auth")({
  component: AuthPage,
  head: () => ({
    meta: [
      { title: "Sign in · GoldMind AI" },
      { name: "description", content: "Sign in or create your GoldMind AI trader account." },
      { property: "og:title", content: "Sign in · GoldMind AI" },
      { property: "og:description", content: "Access your secure GoldMind AI XAUUSD trading workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

type Mode = "signin" | "signup" | "forgot";

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  // Remember me is OFF by default — automatic login requires explicit opt-in.
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    installSessionPersistence();
    const purged = purgeUnconsentedSession();
    if (purged) {
      supabase.auth.signOut({ scope: "local" }).catch(() => {});
      return;
    }
    // Only auto-continue when the user previously opted into being remembered
    // (or is still inside the current browser session).
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: "/dashboard", replace: true });
    });
  }, [navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        toast.success("Password reset link sent. Check your inbox.");
        setMode("signin");
        return;
      }

      setRememberMe(remember);
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { display_name: displayName || email.split("@")[0] },
          },
        });
        if (error) throw error;
        toast.success("Account created. Check your email if confirmation is required.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      const { data } = await supabase.auth.getUser();
      if (data.user) navigate({ to: "/dashboard", replace: true });
    } catch (err: any) {
      toast.error(err?.message ?? "Authentication failed");
    } finally { setLoading(false); }
  };


  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2.5 justify-center mb-8">
          <div className="h-10 w-10 rounded-lg flex items-center justify-center" style={{ background: "var(--gradient-gold)" }}>
            <Zap className="h-5 w-5 text-[color:var(--gold-foreground)]" />
          </div>
          <div className="font-display font-semibold text-xl">GoldMind<span className="gold-text"> AI</span></div>
        </div>
        <div className="glass-panel rounded-2xl p-8">
          <div className="flex gap-1 p-1 bg-secondary rounded-lg mb-6">
            {(["signin", "signup"] as const).map((m) => (
              <button key={m} type="button" onClick={() => setMode(m)}
                className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${mode === m ? "bg-background text-foreground" : "text-muted-foreground"}`}>
                {m === "signin" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>

          {mode === "forgot" && (
            <p className="mb-4 text-xs text-muted-foreground">
              Enter your email and we'll send you a secure link to set a new password.
            </p>
          )}

          <form onSubmit={submit} className="space-y-4">
            {mode === "signup" && (
              <div>
                <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Display name</label>
                <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Alex Trader"
                  className="w-full px-3 py-2.5 rounded-lg bg-input border border-border focus:outline-none focus:ring-2 focus:ring-[color:var(--gold)]/40 text-sm" />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Email</label>
              <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com"
                className="w-full px-3 py-2.5 rounded-lg bg-input border border-border focus:outline-none focus:ring-2 focus:ring-[color:var(--gold)]/40 text-sm" />
            </div>

            {mode !== "forgot" && (
              <>
                <div>
                  <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Password</label>
                  <input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} placeholder="••••••••"
                    className="w-full px-3 py-2.5 rounded-lg bg-input border border-border focus:outline-none focus:ring-2 focus:ring-[color:var(--gold)]/40 text-sm" />
                </div>

                <div>
                  <label className="flex items-center gap-2.5 text-xs cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={(e) => setRemember(e.target.checked)}
                      className="h-4 w-4 rounded border-border bg-input accent-[color:var(--gold)]"
                    />
                    Remember me
                  </label>
                  <p className="mt-1.5 pl-[26px] text-[11px] leading-relaxed text-muted-foreground">
                    Keep me signed in on this device. Leave unchecked if you're using a shared or public computer.
                  </p>
                </div>
              </>
            )}

            <button type="submit" disabled={loading}
              className="w-full py-2.5 rounded-lg font-medium text-[color:var(--gold-foreground)] disabled:opacity-60"
              style={{ background: "var(--gradient-gold)", boxShadow: "var(--shadow-gold)" }}>
              {loading ? "Please wait…" : mode === "signin" ? "Log in" : mode === "signup" ? "Create account" : "Send reset link"}
            </button>
          </form>

          <div className="mt-4 text-center">
            {mode === "forgot" ? (
              <button type="button" onClick={() => setMode("signin")} className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2">
                Back to sign in
              </button>
            ) : (
              <button type="button" onClick={() => setMode("forgot")} className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2">
                Forgot password?
              </button>
            )}
          </div>

          <p className="mt-6 text-[11px] text-muted-foreground text-center leading-relaxed">
            By continuing you acknowledge that trading involves risk. GoldMind AI provides analysis, not financial advice.
          </p>
        </div>
      </div>
    </div>
  );
}
