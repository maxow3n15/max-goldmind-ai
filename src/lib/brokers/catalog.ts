// Client-safe broker catalogue.
//
// Every supported broker is described purely as metadata here: which
// credentials it needs, what it is called, and how it executes. The server
// side (connectors.server.ts) holds one connector implementation per entry.
// Adding a new broker = one catalogue entry + one connector.

export type BrokerCategory = "mt5-cloud" | "rest-api" | "bridge";

export interface BrokerFieldSpec {
  key: string;
  label: string;
  type: "text" | "password" | "select";
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
  optional?: boolean;
}

export interface BrokerSpec {
  id: string;
  name: string;
  category: BrokerCategory;
  /** Short line shown on the connect card. */
  description: string;
  /** Emoji/monogram used where a real logo is not licensed for use. */
  monogram: string;
  accentColor: string;
  /** True when the provider issues refreshable/long-lived tokens. */
  persistentAuth: boolean;
  supportsPropFirms: boolean;
  fields: BrokerFieldSpec[];
}

export const BROKERS: BrokerSpec[] = [
  {
    id: "metaapi",
    name: "MetaTrader 4 / 5 (MetaApi)",
    category: "mt5-cloud",
    description:
      "Connect any MT4/MT5 broker, funded challenge or prop-firm account through the MetaApi cloud terminal.",
    monogram: "MT",
    accentColor: "#3b82f6",
    persistentAuth: true,
    supportsPropFirms: true,
    fields: [
      { key: "token", label: "MetaApi auth token", type: "password", placeholder: "eyJhbGciOi…" },
      { key: "accountId", label: "MetaApi account ID", type: "text", placeholder: "0d1f…-a2b3" },
      {
        key: "region",
        label: "Region",
        type: "select",
        options: [
          { value: "new-york", label: "New York" },
          { value: "london", label: "London" },
          { value: "singapore", label: "Singapore" },
        ],
      },
      { key: "symbol", label: "Gold symbol", type: "text", placeholder: "XAUUSD", optional: true },
    ],
  },
  {
    id: "oanda",
    name: "OANDA",
    category: "rest-api",
    description: "Official OANDA v3 REST API. Spot gold trades as XAU_USD.",
    monogram: "OA",
    accentColor: "#f59e0b",
    persistentAuth: true,
    supportsPropFirms: false,
    fields: [
      { key: "token", label: "API token", type: "password", placeholder: "Personal access token" },
      { key: "accountId", label: "Account ID", type: "text", placeholder: "001-004-1234567-001" },
      {
        key: "environment",
        label: "Environment",
        type: "select",
        options: [
          { value: "practice", label: "Practice (demo)" },
          { value: "live", label: "Live" },
        ],
      },
    ],
  },
  {
    id: "capital",
    name: "Capital.com",
    category: "rest-api",
    description: "Capital.com REST API with CFD gold execution.",
    monogram: "CA",
    accentColor: "#22d3ee",
    persistentAuth: true,
    supportsPropFirms: false,
    fields: [
      { key: "apiKey", label: "API key", type: "password" },
      { key: "identifier", label: "Account email", type: "text", placeholder: "you@email.com" },
      { key: "password", label: "API password", type: "password" },
      {
        key: "environment",
        label: "Environment",
        type: "select",
        options: [
          { value: "demo", label: "Demo" },
          { value: "live", label: "Live" },
        ],
      },
    ],
  },
  {
    id: "alpaca",
    name: "Alpaca",
    category: "rest-api",
    description: "Alpaca trading API (paper or live keys).",
    monogram: "AL",
    accentColor: "#facc15",
    persistentAuth: true,
    supportsPropFirms: false,
    fields: [
      { key: "keyId", label: "API key ID", type: "password" },
      { key: "secretKey", label: "API secret key", type: "password" },
      {
        key: "environment",
        label: "Environment",
        type: "select",
        options: [
          { value: "paper", label: "Paper" },
          { value: "live", label: "Live" },
        ],
      },
      { key: "symbol", label: "Instrument", type: "text", placeholder: "GLD", optional: true },
    ],
  },
  {
    id: "bridge",
    name: "Custom broker bridge",
    category: "bridge",
    description:
      "Point GoldMind at your own hosted bridge (MT5 EA, cTrader, DXtrade, TradeLocker…) that speaks the GoldMind execution contract.",
    monogram: "BR",
    accentColor: "#a78bfa",
    persistentAuth: true,
    supportsPropFirms: true,
    fields: [
      { key: "baseUrl", label: "Bridge URL", type: "text", placeholder: "https://my-bridge.example.com" },
      { key: "token", label: "Bridge token", type: "password" },
      { key: "symbol", label: "Gold symbol", type: "text", placeholder: "XAUUSD", optional: true },
    ],
  },
];

export function brokerSpec(id: string): BrokerSpec | undefined {
  return BROKERS.find((b) => b.id === id);
}

export function maskAccountNumber(value: string | null | undefined): string {
  if (!value) return "—";
  const s = String(value);
  if (s.length <= 4) return `••${s.slice(-2)}`;
  return `${s.slice(0, 2)}••••${s.slice(-4)}`;
}
