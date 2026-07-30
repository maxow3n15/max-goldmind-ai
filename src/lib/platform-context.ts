// Mutable diagnostic snapshot of the platform. Providers write to it; the
// global error boundary reads it so crash reports carry real context.

export interface PlatformDiagnostics {
  route: string | null;
  userId: string | null;
  userEmail: string | null;
  symbol: string;
  timeframe: string;
  marketStatus: string;
  brokerStatus: string;
  aiStatus: string;
  currentTrade: string | null;
}

const diagnostics: PlatformDiagnostics = {
  route: null,
  userId: null,
  userEmail: null,
  symbol: "XAUUSD",
  timeframe: "15",
  marketStatus: "unknown",
  brokerStatus: "unknown",
  aiStatus: "idle",
  currentTrade: null,
};

export function setDiagnostics(patch: Partial<PlatformDiagnostics>) {
  Object.assign(diagnostics, patch);
}

export function getDiagnostics(): PlatformDiagnostics {
  return { ...diagnostics, route: typeof window !== "undefined" ? window.location.pathname : diagnostics.route };
}
