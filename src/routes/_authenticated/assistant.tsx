import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { askAssistant, getChatHistory } from "@/lib/ai.functions";
import { Send, Sparkles, User } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/assistant")({
  component: Assistant,
  head: () => ({
    meta: [
      { title: "AI Assistant · GoldMind AI" },
      { name: "description", content: "Chat with GoldMind's trading assistant about setups, structure, and reasoning." },
      { property: "og:title", content: "AI Assistant · GoldMind AI" },
      { property: "og:description", content: "Ask GoldMind AI about XAUUSD setups, market structure, liquidity and risk." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

const SUGGESTIONS = [
  "Why did you buy here?",
  "Where is the current liquidity?",
  "Explain the last CHOCH on 15m",
  "Why did confidence drop?",
];

function Assistant() {
  const askFn = useServerFn(askAssistant);
  const histFn = useServerFn(getChatHistory);
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const history = useQuery({ queryKey: ["chat"], queryFn: () => histFn() });

  const send = useMutation({
    mutationFn: (message: string) => askFn({ data: { message } }),
    onMutate: async (message) => {
      await qc.cancelQueries({ queryKey: ["chat"] });
      const prev = qc.getQueryData(["chat"]) as any[] | undefined;
      qc.setQueryData(["chat"], [...(prev ?? []), { id: `tmp-${Date.now()}`, role: "user", content: message, created_at: new Date().toISOString() }]);
      return { prev };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chat"] }),
    onError: (e: any, _v, ctx) => { toast.error(e?.message ?? "Failed"); if (ctx?.prev) qc.setQueryData(["chat"], ctx.prev); },
  });

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [history.data, send.isPending]);

  useEffect(() => { inputRef.current?.focus(); }, [history.data, send.isPending]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const val = input.trim();
    if (!val || send.isPending) return;
    setInput("");
    send.mutate(val);
  };

  const messages = history.data ?? [];

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] md:h-screen max-w-3xl mx-auto p-4 md:p-6">
      <header className="mb-4">
        <h1 className="font-display text-2xl font-semibold flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-[color:var(--gold)]" /> AI Assistant
        </h1>
        <p className="text-sm text-muted-foreground">Ask about setups, structure, liquidity, or risk — in plain English.</p>
      </header>

      <div ref={scroller} className="flex-1 overflow-y-auto space-y-4 pr-1 pb-4">
        {messages.length === 0 && !send.isPending && (
          <div className="glass-panel rounded-2xl p-6 text-center text-sm text-muted-foreground">
            <Sparkles className="h-6 w-6 text-[color:var(--gold)] mx-auto mb-3" />
            Start a conversation with GoldMind AI. Try one of these:
            <div className="mt-4 flex flex-wrap gap-2 justify-center">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => { setInput(s); inputRef.current?.focus(); }}
                  className="text-xs px-3 py-1.5 rounded-full border border-border hover:bg-accent">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m: any) => (
          <div key={m.id} className={`flex gap-2.5 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
            <div className={`h-8 w-8 rounded-lg shrink-0 flex items-center justify-center ${m.role === "user" ? "bg-secondary" : "gold-border"}`}>
              {m.role === "user" ? <User className="h-4 w-4" /> : <Sparkles className="h-4 w-4 text-[color:var(--gold)]" />}
            </div>
            <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${m.role === "user" ? "bg-primary text-primary-foreground rounded-tr-sm" : "glass-panel rounded-tl-sm"}`}>
              {m.content}
            </div>
          </div>
        ))}
        {send.isPending && (
          <div className="flex gap-2.5">
            <div className="h-8 w-8 rounded-lg gold-border flex items-center justify-center">
              <Sparkles className="h-4 w-4 text-[color:var(--gold)] animate-pulse" />
            </div>
            <div className="glass-panel rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-muted-foreground">
              <span className="inline-flex gap-1">
                <span className="h-1.5 w-1.5 bg-[color:var(--gold)] rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="h-1.5 w-1.5 bg-[color:var(--gold)] rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="h-1.5 w-1.5 bg-[color:var(--gold)] rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </span>
            </div>
          </div>
        )}
      </div>

      <form onSubmit={submit} className="flex gap-2 glass-panel rounded-2xl p-2">
        <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about the market…"
          className="flex-1 bg-transparent px-3 py-2 text-sm focus:outline-none" />
        <button type="submit" disabled={!input.trim() || send.isPending}
          className="h-9 w-9 rounded-lg flex items-center justify-center text-[color:var(--gold-foreground)] disabled:opacity-40"
          style={{ background: "var(--gradient-gold)" }}>
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
