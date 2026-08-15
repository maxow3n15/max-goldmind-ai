// Administrative gate on broker order placement.
//
// Two distinct environments, deliberately NOT sharing permission:
//
//   * DEMO / PRACTICE (e.g. OANDA Practice) — may execute autonomously, but
//     only through a connection whose own credentials say "practice", and
//     still subject to every risk, confidence and safety gate.
//
//   * LIVE (real money) — locked by default. Unlocking requires BOTH a
//     deployment environment variable that no client request can influence
//     AND an explicit per-user confirmation stored server-side.
//
// To unlock live: set LIVE_TRADING_UNLOCK to exactly "UNLOCK_LIVE_TRADING".
// Anything else — including it being unset — keeps real-money trading locked.

import type { ExecutionEnvironment } from "@/lib/brokers/environment.server";
import { isDemoEnvironment } from "@/lib/brokers/environment.server";

export const LIVE_UNLOCK_ENV = "LIVE_TRADING_UNLOCK";
export const LIVE_UNLOCK_VALUE = "UNLOCK_LIVE_TRADING";

export interface LiveLockState {
  locked: boolean;
  reason: string | null;
}

/** Read the real-money lock. Default (env missing or wrong value) is LOCKED. */
export function getLiveExecutionLock(): LiveLockState {
  // Read at call time: env injection happens per-request, not at module load.
  const value = process.env[LIVE_UNLOCK_ENV];
  if (value === LIVE_UNLOCK_VALUE) return { locked: false, reason: null };
  return {
    locked: true,
    reason:
      "Real-money live execution is administratively locked. Live order placement is implemented, but a server-side lock must be lifted by an administrator before any real order can be sent. Demo/practice execution is unaffected.",
  };
}

export function isLiveExecutionLocked(): boolean {
  return getLiveExecutionLock().locked;
}

export interface ExecutionPermission {
  allowed: boolean;
  reason: string | null;
  /** True when the target environment is real money. */
  realMoney: boolean;
}

/**
 * The single authority on "may an order be sent to this environment?".
 *
 * `settings` is the user_settings row; live additionally requires
 * `live_trading_enabled` (explicit user confirmation) to be true.
 */
export function getExecutionPermission(
  env: ExecutionEnvironment,
  settings: any | null | undefined,
): ExecutionPermission {
  if (isDemoEnvironment(env)) {
    return { allowed: true, reason: null, realMoney: false };
  }

  const lock = getLiveExecutionLock();
  if (lock.locked) return { allowed: false, reason: lock.reason, realMoney: true };

  if (!settings?.live_trading_enabled) {
    return {
      allowed: false,
      reason: "Real-money trading requires explicit user confirmation, which has not been given.",
      realMoney: true,
    };
  }
  return { allowed: true, reason: null, realMoney: true };
}
