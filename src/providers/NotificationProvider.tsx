import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { AppNotification, NotificationLevel } from "@/types/platform";

interface NotificationContextValue {
  notifications: AppNotification[];
  notify: (level: NotificationLevel, title: string, detail?: string) => void;
  clear: () => void;
}

const Ctx = createContext<NotificationContextValue | null>(null);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  const notify = useCallback((level: NotificationLevel, title: string, detail?: string) => {
    const entry: AppNotification = {
      id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
      level, title, detail, ts: Date.now(),
    };
    setNotifications((prev) => [entry, ...prev].slice(0, 100));
    const fn = level === "error" ? toast.error : level === "success" ? toast.success : level === "warning" ? toast.warning : toast.message;
    fn(title, detail ? { description: detail } : undefined);
  }, []);

  const clear = useCallback(() => setNotifications([]), []);

  const value = useMemo(() => ({ notifications, notify, clear }), [notifications, notify, clear]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNotifications(): NotificationContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useNotifications must be used inside <NotificationProvider>");
  return ctx;
}
