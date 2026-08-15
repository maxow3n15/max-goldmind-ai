// Broker / database reconciliation.
//
// The database is only ever our *belief* about the broker's state. This routine
// compares every live-mode trade we think is open (plus anything already flagged
// RECONCILIATION_REQUIRED) against what the broker actually reports, and marks
// mismatches so automation stops touching them.
//
// It deliberately does not auto-resolve: closing or reopening positions on the
// strength of an ambiguous read is more dangerous than surfacing the conflict.

import { RECONCILIATION_REQUIRED } from "@/lib/brokers/live-execution.server";

export interface ReconciliationMismatch {
  trade_id: string;
  broker_id: string;
  broker_order_id: string | null;
  kind: "missing_at_broker" | "unverifiable" | "still_flagged";
  detail: string;
}

export interface ReconciliationReport {
  checked: number;
  mismatches: ReconciliationMismatch[];
  flagged: number;
}

/**
 * Reconcile one user's live positions.
 * `supabase` must be a client that can read/write this user's trades.
 */
export async function reconcileUserPositions(
  supabase: any,
  userId: string,
): Promise<ReconciliationReport> {
  const { data: rows } = await supabase
    .from("trades")
    .select("*")
    .eq("user_id", userId)
    .eq("mode", "live")
    .in("status", ["open", RECONCILIATION_REQUIRED]);

  const trades = rows ?? [];
  const report: ReconciliationReport = { checked: trades.length, mismatches: [], flagged: 0 };
  if (trades.length === 0) return report;

  const { getConnector } = await import("@/lib/brokers/connectors.server");
  const { decryptCredentials } = await import("@/lib/brokers/crypto.server");

  const connCache = new Map<string, any>();
  const loadConn = async (brokerId: string) => {
    if (connCache.has(brokerId)) return connCache.get(brokerId);
    const { data } = await supabase
      .from("broker_connections")
      .select("*")
      .eq("user_id", userId)
      .eq("broker_id", brokerId)
      .maybeSingle();
    connCache.set(brokerId, data ?? null);
    return data ?? null;
  };

  for (const trade of trades) {
    const meta: any = trade.ai_analysis ?? {};
    const brokerId = String(meta.broker_id ?? "");
    const positionId = meta.broker_order_id ? String(meta.broker_order_id) : null;

    const flag = async (kind: ReconciliationMismatch["kind"], detail: string) => {
      report.mismatches.push({ trade_id: trade.id, broker_id: brokerId, broker_order_id: positionId, kind, detail });
      console.error(
        `[reconcile] mismatch — user=${userId} trade=${trade.id} broker=${brokerId || "unknown"} kind=${kind}: ${detail}`,
      );
      if (trade.status !== RECONCILIATION_REQUIRED) {
        report.flagged += 1;
        await supabase
          .from("trades")
          .update({
            status: RECONCILIATION_REQUIRED,
            reason_exit: `Reconciliation: ${detail}`.slice(0, 500),
          })
          .eq("id", trade.id)
          .eq("user_id", userId);
      }
    };

    if (!positionId || !brokerId) {
      await flag("unverifiable", "live trade has no broker order id recorded");
      continue;
    }

    const conn = await loadConn(brokerId);
    if (!conn) {
      await flag("unverifiable", `no stored connection for broker ${brokerId}`);
      continue;
    }

    const connector = getConnector(brokerId);
    if (!connector.positionExists) {
      await flag("unverifiable", `connector ${brokerId} cannot verify position state`);
      continue;
    }

    let exists: boolean;
    try {
      exists = await connector.positionExists(decryptCredentials(conn.credentials_ciphertext), positionId);
    } catch (e: any) {
      await flag("unverifiable", String(e?.message ?? "broker state query failed").slice(0, 300));
      continue;
    }

    if (!exists) {
      // The broker has no such position: our "open" row is wrong either way.
      await flag("missing_at_broker", "broker reports no open position for this trade");
      continue;
    }

    if (trade.status === RECONCILIATION_REQUIRED) {
      // Still open at the broker and still flagged — report it every cycle so
      // it cannot quietly linger, but leave resolution to a human.
      report.mismatches.push({
        trade_id: trade.id,
        broker_id: brokerId,
        broker_order_id: positionId,
        kind: "still_flagged",
        detail: "position is open at the broker but the trade is awaiting manual reconciliation",
      });
    }
  }

  return report;
}
