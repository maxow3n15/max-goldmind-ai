import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAI } from "@/providers/PlatformProviders";

/**
 * Global keyboard shortcuts.
 *  Space   — refresh AI analysis
 *  Ctrl+D  — dashboard
 *  Ctrl+J  — journal
 *  Ctrl+T  — trade screen (autopilot)
 *  Esc     — close the active dialog / overlay
 */
export function useKeyboardShortcuts() {
  const navigate = useNavigate();
  const ai = useAI();

  useEffect(() => {
    const isTyping = (el: EventTarget | null) => {
      const n = el as HTMLElement | null;
      if (!n) return false;
      const tag = n.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || n.isContentEditable;
    };

    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;

      if (e.code === "Space" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        void ai.refresh();
        return;
      }
      if (e.key === "Escape") {
        document.dispatchEvent(new CustomEvent("goldmind:cancel"));
        (document.activeElement as HTMLElement | null)?.blur?.();
        return;
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === "d") { e.preventDefault(); void navigate({ to: "/dashboard" }); }
      else if (key === "j") { e.preventDefault(); void navigate({ to: "/journal" }); }
      else if (key === "t") { e.preventDefault(); void navigate({ to: "/autopilot" }); }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, ai]);
}
