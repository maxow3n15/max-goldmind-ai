import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Zap } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/reset-password")({
  component: ResetPasswordPage,
  head: () => ({
    meta: [
      { title: "Reset password · GoldMind AI" },
      { name: "description", content: "Choose a new password for your GoldMind AI trading account." },
      { property: "og:title", content: "Reset password · GoldMind AI" },
      { property: "og:description", content: "Choose a new password for your GoldMind AI trading account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      toast.error("Passwords do not match");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Password updated. Please sign in again.");
      await supabase.auth.signOut();
      navigate({ to: "/auth", replace: true });
    } catch (err: any) {
      toast.error(err?.message ?? "Could not update password");
    } finally {
      setLoading(false);
    }
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
          <h1 className="text-lg font-semibold">Set a new password</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Open this page from the reset link in your email, then choose a new password.
          </p>
          <form onSubmit={submit} className="space-y-4 mt-6">
            <div>
              <label className="block text-xs font-medium mb-1.5 text-muted-foreground">New password</label>
              <input required type="password" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
                className="w-full px-3 py-2.5 rounded-lg bg-input border border-border focus:outline-none focus:ring-2 focus:ring-[color:var(--gold)]/40 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Confirm password</label>
              <input required type="password" minLength={6} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••"
                className="w-full px-3 py-2.5 rounded-lg bg-input border border-border focus:outline-none focus:ring-2 focus:ring-[color:var(--gold)]/40 text-sm" />
            </div>
            <button type="submit" disabled={loading}
              className="w-full py-2.5 rounded-lg font-medium text-[color:var(--gold-foreground)] disabled:opacity-60"
              style={{ background: "var(--gradient-gold)", boxShadow: "var(--shadow-gold)" }}>
              {loading ? "Updating…" : "Update password"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
