// The single vocabulary for "what is the execution layer doing right now?".
//
// Pure and shared: the server derives the authoritative snapshot, the UI only
// renders it. Nothing here reads React state or the browser.

export type ExecutionStateName =
  | "DISCONNECTED"
  | "CONNECTED"
  | "ANALYSING"
  | "SIGNAL_FOUND"
  | "SIGNAL_REJECTED"
  | "RISK_REJECTED"
  | "ARMED"
  | "EXECUTING"
  | "ORDER_SUBMITTED"
  | "ORDER_FILLED"
  | "MONITORING"
  | "CLOSING"
  | "CLOSED"
  | "FAILED"
  | "KILL_SWITCH"
  | "ADMIN_LOCKED";

export type ArmingState = "DISARMED" | "ARMED_PRACTICE" | "ARMED_LIVE_LOCKED" | "ARMED_LIVE";

export interface ArmingRequirement {
  key: string;
  label: string;
  ok: boolean;
  detail?: string;
}

export interface ExecutionStateSnapshot {
  state: ExecutionStateName;
  arming: ArmingState;
  /** paper | oanda_practice | oanda_live | broker_demo | broker_live */
  environment: string;
  environment_label: string;
  real_money: boolean;
  broker_id: string | null;
  broker_connection: "CONNECTED" | "DISCONNECTED" | "DEGRADED";
  broker_last_check: string | null;
  auto_execute: boolean;
  kill_switch: { active: boolean; reason: string | null; since: string | null };
  admin_lock: { active: boolean; reason: string | null };
  confidence_threshold: number;
  account: {
    source: string;
    currency: string;
    balance: number | null;
    equity: number | null;
    free_margin: number | null;
    open_positions: number | null;
  };
  today: {
    pnl: number;
    trades: number;
    daily_loss_limit_pct: number;
    daily_loss_used_pct: number;
  };
  open_trades: number;
  reconciliation_required: number;
  requirements: ArmingRequirement[];
  blocking_reasons: string[];
  as_of: string;
}

/** Derive the arming state and the reasons preventing it. */
export function deriveArming(input: {
  autoExecute: boolean;
  realMoney: boolean;
  adminLocked: boolean;
  requirements: ArmingRequirement[];
}): { arming: ArmingState; blocking: string[] } {
  const blocking = input.requirements.filter((r) => !r.ok).map((r) => r.detail ?? r.label);
  if (input.realMoney && input.adminLocked) return { arming: "ARMED_LIVE_LOCKED", blocking };
  if (!input.autoExecute || blocking.length > 0) return { arming: "DISARMED", blocking };
  return { arming: input.realMoney ? "ARMED_LIVE" : "ARMED_PRACTICE", blocking };
}

export function deriveState(input: {
  arming: ArmingState;
  killSwitch: boolean;
  adminLockedRealMoney: boolean;
  brokerConnected: boolean;
  openTrades: number;
  reconciliationRequired: number;
}): ExecutionStateName {
  if (input.killSwitch) return "KILL_SWITCH";
  if (input.adminLockedRealMoney) return "ADMIN_LOCKED";
  if (!input.brokerConnected) return "DISCONNECTED";
  if (input.reconciliationRequired > 0) return "FAILED";
  if (input.openTrades > 0) return "MONITORING";
  if (input.arming === "ARMED_PRACTICE" || input.arming === "ARMED_LIVE") return "ARMED";
  return "CONNECTED";
}
