// Administrative hard-lock on live order placement.
//
// This is the last, non-bypassable gate before real money moves. It lives
// server-side and is driven ONLY by a deployment environment variable, so no
// client request, replayed payload, or account-settings change can unlock it.
//
// To unlock: set LIVE_TRADING_UNLOCK to exactly "UNLOCK_LIVE_TRADING".
// Anything else — including it being unset — keeps live execution locked.

export const LIVE_UNLOCK_ENV = "LIVE_TRADING_UNLOCK";
export const LIVE_UNLOCK_VALUE = "UNLOCK_LIVE_TRADING";

export interface LiveLockState {
  locked: boolean;
  reason: string | null;
}

/** Read the lock. Default (env missing or wrong value) is LOCKED. */
export function getLiveExecutionLock(): LiveLockState {
  // Read at call time: env injection happens per-request, not at module load.
  const value = process.env[LIVE_UNLOCK_ENV];
  if (value === LIVE_UNLOCK_VALUE) return { locked: false, reason: null };
  return {
    locked: true,
    reason:
      "Live execution is administratively locked. Live order placement is implemented, but a server-side lock must be lifted by an administrator before any real order can be sent.",
  };
}

export function isLiveExecutionLocked(): boolean {
  return getLiveExecutionLock().locked;
}
