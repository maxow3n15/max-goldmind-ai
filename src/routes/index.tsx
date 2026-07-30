import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, ShieldCheck, Zap, LineChart, Brain, Layers, BellRing } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Landing,
  head: () => ({
    meta: [
      { title: "GoldMind AI — Institutional XAUUSD Trading Intelligence" },
      { name: "description", content: "AI-powered gold market analysis using Smart Money Concepts. Real-time XAUUSD setups, explained decisions, risk-managed paper trading." },
      { property: "og:title", content: "GoldMind AI — Institutional XAUUSD Trading Intelligence" },
      { property: "og:description", content: "AI-powered gold market analysis using Smart Money Concepts. Real-time XAUUSD setups, explained decisions, risk-managed paper trading." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

function Landing() {
  return (
    <div className="min-h-screen">
      <header className="max-w-6xl mx-auto px-6 py-6 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-lg flex items-center justify-center" style={{ background: "var(--gradient-gold)" }}>
            <Zap className="h-5 w-5 text-[color:var(--gold-foreground)]" />
          </div>
          <div className="font-display font-semibold text-lg">GoldMind<span className="gold-text"> AI</span></div>
        </div>
        <Link to="/auth" className="text-sm px-4 py-2 rounded-md bg-primary text-primary-foreground hover:opacity-90 font-medium">
          Sign in
        </Link>
      </header>

      <section className="max-w-5xl mx-auto px-6 pt-20 pb-24 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground mb-6">
          <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--success)] ticker-pulse" />
          Live XAUUSD analysis · Smart Money Concepts
        </div>
        <h1 className="font-display text-5xl md:text-7xl font-semibold tracking-tight leading-[1.05]">
          Institutional-grade <span className="gold-text">gold intelligence</span>,
          <br className="hidden md:block" /> built for serious traders.
        </h1>
        <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto">
          GoldMind AI analyses XAUUSD in real time using ICT / Smart Money Concepts,
          explains every decision in plain English, and never guarantees profits — only high-probability setups with transparent reasoning.
        </p>
        <div className="mt-10 flex items-center justify-center gap-3">
          <Link to="/auth" className="inline-flex items-center gap-2 px-6 py-3 rounded-lg font-medium text-[color:var(--gold-foreground)]" style={{ background: "var(--gradient-gold)", boxShadow: "var(--shadow-gold)" }}>
            Start paper trading <ArrowRight className="h-4 w-4" />
          </Link>
          <a href="#features" className="px-6 py-3 rounded-lg border border-border text-sm font-medium hover:bg-accent">
            See how it works
          </a>
        </div>
      </section>

      <section id="features" className="max-w-6xl mx-auto px-6 pb-24 grid md:grid-cols-3 gap-4">
        {[
          { icon: Brain, title: "ICT / SMC engine", body: "BOS, CHOCH, liquidity sweeps, FVGs, order blocks, premium/discount — every confluence checked before a setup is suggested." },
          { icon: LineChart, title: "TradingView charts", body: "Interactive multi-timeframe charts with the AI running commentary on your selected timeframe while holding HTF context." },
          { icon: Layers, title: "Transparent reasoning", body: "Every trade idea comes with a plain-English explanation, confidence score, and clear invalidation." },
          { icon: ShieldCheck, title: "Hard risk limits", body: "Daily / weekly loss caps, max open trades, risk per trade — the platform stops itself when limits are hit." },
          { icon: Zap, title: "Paper execution", body: "Simulate the full trading loop safely. Live MT5 execution is opt-in and off by default." },
          { icon: BellRing, title: "News awareness", body: "High-impact events (FOMC, CPI, NFP) surfaced before they hit — with an option to stand aside." },
        ].map(({ icon: Icon, title, body }) => (
          <div key={title} className="glass-panel rounded-2xl p-6">
            <div className="h-10 w-10 rounded-lg flex items-center justify-center gold-border mb-4">
              <Icon className="h-5 w-5 text-[color:var(--gold)]" />
            </div>
            <h3 className="font-display font-semibold text-lg">{title}</h3>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{body}</p>
          </div>
        ))}
      </section>

      <footer className="border-t border-border/60 py-8 text-center text-xs text-muted-foreground px-6">
        <p className="max-w-2xl mx-auto">
          Trading gold carries substantial risk. GoldMind AI provides analysis and educational reasoning — not financial advice.
          Past performance does not guarantee future results. Never risk capital you cannot afford to lose.
        </p>
        <p className="mt-3">© {new Date().getFullYear()} GoldMind AI</p>
      </footer>
    </div>
  );
}
