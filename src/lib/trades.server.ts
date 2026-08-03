// Server-only account-protection checks that apply to *every* order,
// regardless of whether the engine or the user initiated it.
//
// Deliberately excludes the AI-specific gates (confidence threshold,
// minimum R:R, "a setup must exist") — those only make sense for an
// AI-generated entry.

export interface ProtectionResult {
  ok: boolean;
  reason?: string;
  openCount: number;
  settings: any | null;
}

export async function checkAccountProtection(
  supabase: any,
  userId: string,
  mode: "paper" | "live",
): Promise<ProtectionResult> {
  const [{ data: settings }, { data: openRows }] = await Promise.all([
    supabase.from("user_settings").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("trades").select("id").eq("user_id", userId).eq("status", "open"),
  ]);

  const openCount = (openRows ?? []).length;
  const base = { openCount, settings: settings ?? null };

  if (settings?.kill_switch_active) {
    return { ok: false, reason: `Kill switch active — ${settings.kill_switch_reason ?? "trading halted"}`, ...base };
  }
  const maxOpen = Number(settings?.max_open_trades ?? 3) || 3;
  if (openCount >= maxOpen) {
    return { ok: false, reason: `Maximum open positions reached (${openCount}/${maxOpen}).`, ...base };
  }
  if (mode === "live") {
    if (!settings?.live_trading_enabled || settings?.trading_mode !== "live") {
      return { ok: false, reason: "Live trading is not authorised in settings.", ...base };
    }
    const { data: conn } = await supabase
      .from("broker_connections")
      .select("id, status")
      .eq("user_id", userId)
      .eq("is_default", true)
      .maybeSingle();
    if (!conn) return { ok: false, reason: "No default broker account selected.", ...base };
    if (conn.status !== "connected") {
      return { ok: false, reason: `Broker connection is ${conn.status}. Reconnect required.`, ...base };
    }
  }
  return { ok: true, ...base };
}
