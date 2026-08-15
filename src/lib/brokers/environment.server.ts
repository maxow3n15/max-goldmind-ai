// Authoritative, server-side resolution of the execution environment.
//
// The environment is NEVER taken from the browser. It is derived from the
// stored broker connection's own credentials, and the credentials handed to a
// connector are re-pinned to that environment so a practice account can never
// address a live endpoint.

export type ExecutionEnvironment =
  | "paper"
  | "oanda_practice"
  | "oanda_live"
  | "broker_demo"
  | "broker_live";

export interface ResolvedEnvironment {
  env: ExecutionEnvironment;
  brokerId: string;
  /** True only when the broker itself reports a demo/practice environment. */
  isDemo: boolean;
  /** Human label shown in the UI. */
  label: string;
  /** Credentials with the environment field pinned — use these, not the raw ones. */
  credentials: Record<string, string>;
}

const DEMO_TOKENS = ["practice", "demo", "paper", "sandbox"];

/**
 * Resolve the environment for a broker connection.
 *
 * Fail safe: anything we cannot positively identify as a demo environment is
 * treated as LIVE, which is the locked-by-default path.
 */
export function resolveBrokerEnvironment(
  brokerId: string,
  credentials: Record<string, string>,
): ResolvedEnvironment {
  const raw = String(credentials["environment"] ?? "").trim().toLowerCase();
  const isDemo = DEMO_TOKENS.includes(raw);

  if (brokerId === "oanda") {
    // Pin explicitly: only the exact string "live" may reach the live endpoint.
    const pinned = { ...credentials, environment: isDemo ? "practice" : "live" };
    return isDemo
      ? {
          env: "oanda_practice",
          brokerId,
          isDemo: true,
          label: "OANDA PRACTICE",
          credentials: pinned,
        }
      : { env: "oanda_live", brokerId, isDemo: false, label: "OANDA LIVE", credentials: pinned };
  }

  const pinned = { ...credentials, ...(raw ? { environment: raw } : {}) };
  return isDemo
    ? { env: "broker_demo", brokerId, isDemo: true, label: `${brokerId.toUpperCase()} DEMO`, credentials: pinned }
    : { env: "broker_live", brokerId, isDemo: false, label: `${brokerId.toUpperCase()} LIVE`, credentials: pinned };
}

export function isDemoEnvironment(env: ExecutionEnvironment): boolean {
  return env === "oanda_practice" || env === "broker_demo" || env === "paper";
}

/**
 * Sanity assertion used right before an order leaves our infrastructure:
 * the credentials must still address the environment we resolved.
 */
export function assertEnvironmentPinned(resolved: ResolvedEnvironment): void {
  const value = String(resolved.credentials["environment"] ?? "").toLowerCase();
  if (resolved.brokerId === "oanda") {
    const expected = resolved.env === "oanda_live" ? "live" : "practice";
    if (value !== expected) {
      throw new Error(
        `Environment mismatch: OANDA credentials address "${value || "unset"}" but the resolved environment is ${resolved.env}.`,
      );
    }
  }
  if (resolved.isDemo && value === "live") {
    throw new Error("Environment mismatch: a demo connection resolved to live credentials.");
  }
}
