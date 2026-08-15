// Modular broker connectors (server-only).
//
// The AI produces ONE standard trade instruction (StandardOrder). Each
// connector translates that instruction into the broker's own API format.
// Adding a broker means adding one object to CONNECTORS — no change to the
// AI, risk or execution logic.

export interface BrokerAccountInfo {
  account_name: string | null;
  account_number: string | null;
  account_type: "demo" | "live";
  currency: string;
  balance: number;
  equity: number;
  free_margin: number;
  margin_level: number | null;
  open_positions: number;
}

/** Broker-agnostic instruction emitted by the execution engine. */
export interface StandardOrder {
  symbol: string;              // logical symbol, e.g. XAUUSD
  direction: "BUY" | "SELL";
  volume: number;              // lots
  stop_loss?: number | null;
  take_profit?: number | null;
  comment?: string;
}

export interface BrokerConnector {
  id: string;
  fetchAccount(creds: Record<string, string>): Promise<BrokerAccountInfo>;
  /**
   * Real contract specification for the symbol, straight from the broker.
   * Optional: connectors that cannot supply verified spec data omit it, and
   * callers must then refuse to size the trade rather than assume defaults.
   */
  fetchSymbolSpec?(creds: Record<string, string>, symbol: string): Promise<SymbolSpec>;
  placeOrder(creds: Record<string, string>, order: StandardOrder): Promise<{ broker_order_id: string }>;
  closePosition(creds: Record<string, string>, positionId: string): Promise<void>;
  modifyPosition(
    creds: Record<string, string>,
    positionId: string,
    patch: { stop_loss?: number; take_profit?: number },
  ): Promise<void>;
}

/** Throws when a required numeric spec field is missing — never guess. */
function reqNum(v: unknown, field: string, label: string): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${label}: broker did not report a usable "${field}" for this symbol`);
  }
  return n;
}


async function req(url: string, init: RequestInit & { label: string }): Promise<any> {
  const { label, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(url, rest);
  } catch (e: any) {
    throw new Error(`${label}: network error — ${e?.message ?? "unreachable"}`);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`${label} failed [${res.status}]: ${text.slice(0, 400)}`);
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

const num = (v: unknown, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

/* ------------------------------------------------------------------ */
/* MetaApi — MT4 / MT5 (covers most brokers, funded + prop accounts)   */
/* ------------------------------------------------------------------ */

const metaapiBase = (region: string) =>
  `https://mt-client-api-v1.${region || "new-york"}.agiliumtrade.ai`;

const metaapiHeaders = (c: Record<string, string>) => ({
  "auth-token": c["token"] ?? "",
  "content-type": "application/json",
});

const metaapi: BrokerConnector = {
  id: "metaapi",
  async fetchAccount(c) {
    const base = metaapiBase(c["region"] ?? "");
    const id = c["accountId"];
    const info = await req(`${base}/users/current/accounts/${id}/account-information`, {
      label: "MetaApi account information",
      headers: metaapiHeaders(c),
    });
    const positions = await req(`${base}/users/current/accounts/${id}/positions`, {
      label: "MetaApi positions",
      headers: metaapiHeaders(c),
    });
    return {
      account_name: info.name ?? null,
      account_number: info.login != null ? String(info.login) : null,
      account_type: String(info.type ?? "").toUpperCase().includes("DEMO") ? "demo" : "live",
      currency: info.currency ?? "USD",
      balance: num(info.balance),
      equity: num(info.equity),
      free_margin: num(info.freeMargin),
      margin_level: info.marginLevel != null ? num(info.marginLevel) : null,
      open_positions: Array.isArray(positions) ? positions.length : 0,
    };
  },
  async placeOrder(c, o) {
    const base = metaapiBase(c["region"] ?? "");
    const res = await req(`${base}/users/current/accounts/${c["accountId"]}/trade`, {
      label: "MetaApi trade",
      method: "POST",
      headers: metaapiHeaders(c),
      body: JSON.stringify({
        actionType: o.direction === "BUY" ? "ORDER_TYPE_BUY" : "ORDER_TYPE_SELL",
        symbol: c["symbol"] || o.symbol,
        volume: o.volume,
        stopLoss: o.stop_loss ?? undefined,
        takeProfit: o.take_profit ?? undefined,
        comment: (o.comment ?? "GoldMind AI").slice(0, 26),
      }),
    });
    return { broker_order_id: String(res.positionId ?? res.orderId ?? "") };
  },
  async closePosition(c, positionId) {
    const base = metaapiBase(c["region"] ?? "");
    await req(`${base}/users/current/accounts/${c["accountId"]}/trade`, {
      label: "MetaApi close",
      method: "POST",
      headers: metaapiHeaders(c),
      body: JSON.stringify({ actionType: "POSITION_CLOSE_ID", positionId }),
    });
  },
  async modifyPosition(c, positionId, patch) {
    const base = metaapiBase(c["region"] ?? "");
    await req(`${base}/users/current/accounts/${c["accountId"]}/trade`, {
      label: "MetaApi modify",
      method: "POST",
      headers: metaapiHeaders(c),
      body: JSON.stringify({
        actionType: "POSITION_MODIFY",
        positionId,
        stopLoss: patch.stop_loss,
        takeProfit: patch.take_profit,
      }),
    });
  },
};

/* ------------------------------------------------------------------ */
/* OANDA v3                                                            */
/* ------------------------------------------------------------------ */

const oandaBase = (env: string) =>
  env === "live" ? "https://api-fxtrade.oanda.com" : "https://api-fxpractice.oanda.com";

const oandaHeaders = (c: Record<string, string>) => ({
  Authorization: `Bearer ${c["token"] ?? ""}`,
  "Content-Type": "application/json",
});

const oanda: BrokerConnector = {
  id: "oanda",
  async fetchAccount(c) {
    const base = oandaBase(c["environment"] ?? "practice");
    const res = await req(`${base}/v3/accounts/${c["accountId"]}/summary`, {
      label: "OANDA account summary",
      headers: oandaHeaders(c),
    });
    const a = res.account ?? {};
    return {
      account_name: a.alias ?? null,
      account_number: a.id ?? c["accountId"] ?? null,
      account_type: (c["environment"] ?? "practice") === "live" ? "live" : "demo",
      currency: a.currency ?? "USD",
      balance: num(a.balance),
      equity: num(a.NAV, num(a.balance)),
      free_margin: num(a.marginAvailable),
      margin_level: num(a.marginUsed) > 0 ? (num(a.NAV) / num(a.marginUsed)) * 100 : null,
      open_positions: num(a.openPositionCount),
    };
  },
  async placeOrder(c, o) {
    const base = oandaBase(c["environment"] ?? "practice");
    // OANDA sizes gold in ounces: 1 lot = 100 oz.
    const units = Math.round(o.volume * 100) * (o.direction === "BUY" ? 1 : -1);
    const res = await req(`${base}/v3/accounts/${c["accountId"]}/orders`, {
      label: "OANDA order",
      method: "POST",
      headers: oandaHeaders(c),
      body: JSON.stringify({
        order: {
          type: "MARKET",
          instrument: "XAU_USD",
          units: String(units),
          timeInForce: "FOK",
          positionFill: "DEFAULT",
          stopLossOnFill: o.stop_loss ? { price: o.stop_loss.toFixed(2) } : undefined,
          takeProfitOnFill: o.take_profit ? { price: o.take_profit.toFixed(2) } : undefined,
        },
      }),
    });
    return {
      broker_order_id: String(
        res.orderFillTransaction?.tradeOpened?.tradeID ?? res.orderCreateTransaction?.id ?? "",
      ),
    };
  },
  async closePosition(c, positionId) {
    const base = oandaBase(c["environment"] ?? "practice");
    await req(`${base}/v3/accounts/${c["accountId"]}/trades/${positionId}/close`, {
      label: "OANDA close",
      method: "PUT",
      headers: oandaHeaders(c),
      body: JSON.stringify({ units: "ALL" }),
    });
  },
  async modifyPosition(c, positionId, patch) {
    const base = oandaBase(c["environment"] ?? "practice");
    await req(`${base}/v3/accounts/${c["accountId"]}/trades/${positionId}/orders`, {
      label: "OANDA modify",
      method: "PUT",
      headers: oandaHeaders(c),
      body: JSON.stringify({
        stopLoss: patch.stop_loss ? { price: patch.stop_loss.toFixed(2) } : undefined,
        takeProfit: patch.take_profit ? { price: patch.take_profit.toFixed(2) } : undefined,
      }),
    });
  },
};

/* ------------------------------------------------------------------ */
/* Capital.com                                                         */
/* ------------------------------------------------------------------ */

const capitalBase = (env: string) =>
  env === "live" ? "https://api-capital.backend-capital.com" : "https://demo-api-capital.backend-capital.com";

async function capitalSession(c: Record<string, string>) {
  const base = capitalBase(c["environment"] ?? "demo");
  const res = await fetch(`${base}/api/v1/session`, {
    method: "POST",
    headers: { "X-CAP-API-KEY": c["apiKey"] ?? "", "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: c["identifier"], password: c["password"] }),
  });
  if (!res.ok) throw new Error(`Capital.com session failed [${res.status}]: ${(await res.text()).slice(0, 300)}`);
  const body = await res.json().catch(() => ({}) as any);
  return {
    base,
    headers: {
      CST: res.headers.get("CST") ?? "",
      "X-SECURITY-TOKEN": res.headers.get("X-SECURITY-TOKEN") ?? "",
      "Content-Type": "application/json",
    },
    body,
  };
}

const capital: BrokerConnector = {
  id: "capital",
  async fetchAccount(c) {
    const s = await capitalSession(c);
    const accounts = await req(`${s.base}/api/v1/accounts`, { label: "Capital.com accounts", headers: s.headers });
    const positions = await req(`${s.base}/api/v1/positions`, { label: "Capital.com positions", headers: s.headers }).catch(() => ({ positions: [] }));
    const list = accounts.accounts ?? [];
    const a = list.find((x: any) => x.preferred) ?? list[0] ?? {};
    const bal = a.balance ?? {};
    return {
      account_name: a.accountName ?? null,
      account_number: a.accountId != null ? String(a.accountId) : null,
      account_type: (c["environment"] ?? "demo") === "live" ? "live" : "demo",
      currency: a.currency ?? "USD",
      balance: num(bal.balance),
      equity: num(bal.balance) + num(bal.profitLoss),
      free_margin: num(bal.available),
      margin_level: num(bal.deposit) > 0 ? (num(bal.balance) / num(bal.deposit)) * 100 : null,
      open_positions: Array.isArray(positions.positions) ? positions.positions.length : 0,
    };
  },
  async placeOrder(c, o) {
    const s = await capitalSession(c);
    const res = await req(`${s.base}/api/v1/positions`, {
      label: "Capital.com order",
      method: "POST",
      headers: s.headers,
      body: JSON.stringify({
        epic: c["symbol"] || "GOLD",
        direction: o.direction,
        size: o.volume,
        stopLevel: o.stop_loss ?? undefined,
        profitLevel: o.take_profit ?? undefined,
      }),
    });
    return { broker_order_id: String(res.dealReference ?? "") };
  },
  async closePosition(c, positionId) {
    const s = await capitalSession(c);
    await req(`${s.base}/api/v1/positions/${positionId}`, {
      label: "Capital.com close",
      method: "DELETE",
      headers: s.headers,
    });
  },
  async modifyPosition(c, positionId, patch) {
    const s = await capitalSession(c);
    await req(`${s.base}/api/v1/positions/${positionId}`, {
      label: "Capital.com modify",
      method: "PUT",
      headers: s.headers,
      body: JSON.stringify({ stopLevel: patch.stop_loss, profitLevel: patch.take_profit }),
    });
  },
};

/* ------------------------------------------------------------------ */
/* Alpaca                                                              */
/* ------------------------------------------------------------------ */

const alpacaBase = (env: string) =>
  env === "live" ? "https://api.alpaca.markets" : "https://paper-api.alpaca.markets";

const alpacaHeaders = (c: Record<string, string>) => ({
  "APCA-API-KEY-ID": c["keyId"] ?? "",
  "APCA-API-SECRET-KEY": c["secretKey"] ?? "",
  "Content-Type": "application/json",
});

const ALPACA_UNSUPPORTED =
  "Alpaca does not support XAUUSD spot/CFD trading — GLD is a different instrument and cannot be used for this strategy's live execution";

const alpaca: BrokerConnector = {
  id: "alpaca",
  async fetchAccount(c) {
    const base = alpacaBase(c["environment"] ?? "paper");
    const a = await req(`${base}/v2/account`, { label: "Alpaca account", headers: alpacaHeaders(c) });
    const positions = await req(`${base}/v2/positions`, { label: "Alpaca positions", headers: alpacaHeaders(c) }).catch(() => []);
    return {
      account_name: a.account_number ? `Alpaca ${a.account_number}` : null,
      account_number: a.account_number ?? null,
      account_type: (c["environment"] ?? "paper") === "live" ? "live" : "demo",
      currency: a.currency ?? "USD",
      balance: num(a.cash),
      equity: num(a.equity),
      free_margin: num(a.buying_power),
      margin_level: num(a.initial_margin) > 0 ? (num(a.equity) / num(a.initial_margin)) * 100 : null,
      open_positions: Array.isArray(positions) ? positions.length : 0,
    };
  },
  async placeOrder() {
    // Alpaca has no XAUUSD spot/CFD instrument. Submitting a GLD (ETF) order
    // here would give basis-risk exposure that does not track the gold analysis.
    throw new Error(ALPACA_UNSUPPORTED);
  },
  async closePosition(c, positionId) {
    const base = alpacaBase(c["environment"] ?? "paper");
    await req(`${base}/v2/positions/${positionId}`, {
      label: "Alpaca close",
      method: "DELETE",
      headers: alpacaHeaders(c),
    });
  },
  async modifyPosition(c, positionId, patch) {
    const base = alpacaBase(c["environment"] ?? "paper");
    await req(`${base}/v2/orders/${positionId}`, {
      label: "Alpaca modify",
      method: "PATCH",
      headers: alpacaHeaders(c),
      body: JSON.stringify({ stop_price: patch.stop_loss, limit_price: patch.take_profit }),
    });
  },
};

/* ------------------------------------------------------------------ */
/* Custom bridge (MT5 EA / cTrader / DXtrade / TradeLocker …)          */
/* ------------------------------------------------------------------ */

const bridgeHeaders = (c: Record<string, string>) => ({
  Authorization: `Bearer ${c["token"] ?? ""}`,
  "Content-Type": "application/json",
});

/** Validate a user-supplied bridge URL to prevent SSRF against internal hosts. */
function bridgeBase(c: Record<string, string>): string {
  const raw = (c["baseUrl"] ?? "").trim();
  if (!raw) throw new Error("Bridge URL is required");

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Bridge URL is not a valid URL");
  }

  if (url.protocol !== "https:") {
    throw new Error("Bridge URL must use https://");
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  const blockedNames = ["localhost", "0.0.0.0", "::", "::1", "[::1]", "metadata.google.internal"];
  if (blockedNames.includes(host) || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    throw new Error(`Bridge URL host "${url.hostname}" is not allowed (internal address)`);
  }

  // IPv4 literal checks (loopback, private, link-local).
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    const isPrivate =
      a === 0 ||
      a === 127 ||
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254);
    if (isPrivate) {
      throw new Error(`Bridge URL host "${url.hostname}" is not allowed (private or loopback address)`);
    }
  }

  // IPv6 loopback / unique-local / link-local literals.
  if (host.includes(":")) {
    if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) {
      throw new Error(`Bridge URL host "${url.hostname}" is not allowed (private or loopback address)`);
    }
  }

  return `${url.origin}${url.pathname.replace(/\/$/, "")}`;
}

const bridge: BrokerConnector = {
  id: "bridge",
  async fetchAccount(c) {
    const base = bridgeBase(c);
    const a = await req(`${base}/account`, { label: "Bridge account", headers: bridgeHeaders(c) });
    return {
      account_name: a.account_name ?? a.name ?? null,
      account_number: a.account_number != null ? String(a.account_number) : null,
      account_type: String(a.account_type ?? "demo").toLowerCase() === "live" ? "live" : "demo",
      currency: a.currency ?? "USD",
      balance: num(a.balance),
      equity: num(a.equity, num(a.balance)),
      free_margin: num(a.free_margin, num(a.balance)),
      margin_level: a.margin_level != null ? num(a.margin_level) : null,
      open_positions: num(a.open_positions),
    };
  },
  async placeOrder(c, o) {
    const base = bridgeBase(c);
    const res = await req(`${base}/orders`, {
      label: "Bridge order",
      method: "POST",
      headers: bridgeHeaders(c),
      body: JSON.stringify({ ...o, symbol: c["symbol"] || o.symbol }),
    });
    return { broker_order_id: String(res.id ?? res.order_id ?? "") };
  },
  async closePosition(c, positionId) {
    const base = bridgeBase(c);
    await req(`${base}/positions/${positionId}/close`, {
      label: "Bridge close",
      method: "POST",
      headers: bridgeHeaders(c),
    });
  },
  async modifyPosition(c, positionId, patch) {
    const base = bridgeBase(c);
    await req(`${base}/positions/${positionId}`, {
      label: "Bridge modify",
      method: "PATCH",
      headers: bridgeHeaders(c),
      body: JSON.stringify(patch),
    });
  },
};

const CONNECTORS: Record<string, BrokerConnector> = {
  metaapi,
  oanda,
  capital,
  alpaca,
  bridge,
};

export function getConnector(brokerId: string): BrokerConnector {
  const c = CONNECTORS[brokerId];
  if (!c) throw new Error(`No connector registered for broker "${brokerId}"`);
  return c;
}
